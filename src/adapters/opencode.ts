import { isAbsolute, relative, resolve } from "node:path"
import { sha256, stableJson } from "../observer/codec.js"
import { ObserverRuntime } from "../observer/runtime.js"
import type {
  ChatMessageInput,
  ChatMessageOutput,
  ModelRequestInput,
  ModelRequestOutput,
  ObserverEventEnvelope,
  Registration,
  ToolAfterOutput,
  ToolBeforeOutput,
  ToolHookInput,
} from "../observer/types.js"
import type { IntentCompiler } from "../core/intent-compiler.js"
import type { IntentCompilerV2 } from "../core/intent-compiler-v2.js"
import type {
  AdvanceResult,
  AuthorizationResult,
  Atom,
  CompilerEvent,
  EventReceipt,
  ExecutionOutcome,
  OperationRequest,
  Ref,
  SourceRef,
} from "../core/intent-contract.js"
import type { CommitReference } from "../core/compiler-store.js"
import { createOpenCodeCompilerRuntime } from "../runtime/opencode-compiler.js"
import { createOpenCodeCompilerRuntimeV2 } from "../runtime/opencode-compiler-v2.js"
import type { OpenCodeModelClient } from "../model/opencode-transport.js"

export type OpenCodeArm = "raw" | "compiler"

export interface OpenCodeClient {
  session?: {
    create?: NonNullable<OpenCodeModelClient["session"]>["create"]
    prompt?: NonNullable<OpenCodeModelClient["session"]>["prompt"]
    messages?: (options: { path: { id: string } }) => Promise<unknown>
  }
}

export interface OpenCodeObserver {
  captureRawInput(input: ChatMessageInput, output: ChatMessageOutput): boolean | Promise<boolean>
  expectDelivery(input: ChatMessageInput, output: ChatMessageOutput): boolean | Promise<boolean>
  observeEvent(event: ObserverEventEnvelope): boolean | Promise<boolean>
  modelRequested?(input: ModelRequestInput, output: ModelRequestOutput): boolean | Promise<boolean>
  toolBefore?(input: ToolHookInput, output: ToolBeforeOutput): boolean | Promise<boolean>
  toolAfter?(input: ToolHookInput, output: ToolAfterOutput): boolean | Promise<boolean>
  scheduleReconciliation?(sessionId: string): Promise<boolean>
  dispose?(): Promise<void>
}

export interface OpenCodeTurnIdentity {
  runId: string
  inputIdentity: string
  taskIds?: string[]
  source?: unknown
  currentWorkspaceSnapshotId?: string
  userInputText?: string
  harnessSystemText?: string
}

export type ResolveOpenCodeTurn = (
  input: ChatMessageInput,
  output: ChatMessageOutput,
) => OpenCodeTurnIdentity | Promise<OpenCodeTurnIdentity>

export interface OpenCodeSystemTransformInput {
  sessionID: string
  [key: string]: any
}

export interface OpenCodeSystemTransformOutput {
  system: string[]
  [key: string]: any
}

export interface OpenCodeAdapterOptions {
  arm: OpenCodeArm
  client: OpenCodeClient
  observer: OpenCodeObserver
  compiler?: IntentCompiler | IntentCompilerV2
  resolveTurn?: ResolveOpenCodeTurn
  /** Trusted host-side parse of an OpenCode tool call into a v2 operation request. */
  resolveV2Operation?: ResolveV2Operation
  ignoreSession?: (sessionId: string) => boolean
}

export type ResolveV2Operation = (
  input: ToolHookInput,
  executionId: string,
) => OperationRequest | undefined

export interface OpenCodeV2Delivery {
  dispatch_id: string
  task_id: string
  atom_id: string
  digest: string
  compiled_revision: number
  /** The compiled work sent to the executor, with dispatch identity kept by the host. */
  atom: Atom
}

export interface OpenCodeAdapterHooks {
  "chat.message": (input: ChatMessageInput, output: ChatMessageOutput) => Promise<void>
  "chat.params": (input: ModelRequestInput, output: ModelRequestOutput) => Promise<void>
  "experimental.chat.system.transform": (
    input: OpenCodeSystemTransformInput,
    output: OpenCodeSystemTransformOutput,
  ) => Promise<void>
  "tool.execute.before": (input: ToolHookInput, output: ToolBeforeOutput) => void
  "tool.execute.after": (input: ToolHookInput, output: ToolAfterOutput) => void
  event: (input: { event: ObserverEventEnvelope }) => Promise<void>
  dispose: () => Promise<void>
}

export interface OpenCodeAdapter {
  hooks(): OpenCodeAdapterHooks
  dispose(): Promise<void>
}

export class OpenCodeAdapterError extends Error {
  readonly code: string
  readonly retryable: false
  managementOutcome?: AdvanceResult

  constructor(code: string, message: string) {
    super(message)
    this.name = "OpenCodeAdapterError"
    this.code = code
    this.retryable = false
  }
}

interface ExpectedPart {
  id: string
  text: string
}

interface PendingDelivery {
  sessionId: string
  messageId: string
  runId: string
  inputIdentity: string
  artifactVersion?: number
  commit?: CommitReference
  source?: unknown
  harnessSystemText?: string
  expectedParts: ExpectedPart[]
  expectedPartDigest: string
  compiler: boolean
  attemptId?: string
  confirmed: boolean
  rejected: boolean
  systemApplied: boolean
  reconciled: boolean
  compilerV2?: boolean
  v2Deliveries?: OpenCodeV2Delivery[]
  v2ExecutionIds?: string[]
  v2Returned?: boolean
}

interface ManagedInputs {
  sessions: Set<string>
  messages: Set<string>
}

export function createOpenCodeAdapter(options: OpenCodeAdapterOptions): OpenCodeAdapter {
  if (options.arm !== "raw" && options.arm !== "compiler") {
    throw new OpenCodeAdapterError("ARM_INVALID", `unknown OpenCode arm: ${String(options.arm)}`)
  }
  if (options.arm === "compiler" && (!options.compiler || !options.resolveTurn)) {
    throw new OpenCodeAdapterError("COMPILER_DEPENDENCY_REQUIRED", "compiler arm requires an injected Compiler and turn identity resolver")
  }
  const pending = new Map<string, PendingDelivery>()
  const managed: ManagedInputs = { sessions: new Set(), messages: new Set() }
  const reconciliations = new Map<string, Promise<boolean>>()
  const v2Calls = new Map<string, { runId: string; executionId: string; hostCallId: string }>()

  const adapter: OpenCodeAdapter = {
    hooks: () => ({
      "chat.message": async (input, output) => {
        if (options.ignoreSession?.(input.sessionID)) return
        await onChatMessage(options, pending, managed, input, output)
      },
      "chat.params": async (input, output) => {
        if (options.ignoreSession?.(input.sessionID)) return
        await onChatParams(options, pending, managed, input, output)
      },
      "experimental.chat.system.transform": async (input, output) => {
        if (options.ignoreSession?.(input.sessionID)) return
        await onSystemTransform(pending, managed, input, output)
      },
      "tool.execute.before": (input, output) => {
        if (options.ignoreSession?.(input.sessionID)) return
        void options.observer.toolBefore?.(input, output)
        authorizeV2Tool(options, pending, v2Calls, input, output)
      },
      "tool.execute.after": (input, output) => {
        if (options.ignoreSession?.(input.sessionID)) return
        void options.observer.toolAfter?.(input, output)
        recordV2OperationResult(options, v2Calls, input, output)
      },
      event: async ({ event }) => {
        const sessionId = eventSessionId(event)
        if (sessionId && options.ignoreSession?.(sessionId)) return
        await onEvent(options, pending, reconciliations, event)
      },
      dispose: async () => {
        await adapter.dispose()
      },
    }),
    dispose: async () => {
      await Promise.allSettled(reconciliations.values())
      await options.observer.dispose?.()
    },
  }
  return adapter
}

function isV2Compiler(compiler: IntentCompiler | IntentCompilerV2 | undefined): compiler is IntentCompilerV2 {
  return Boolean(compiler && typeof (compiler as IntentCompilerV2).acceptEvent === "function")
}

function authorizeV2Tool(
  options: OpenCodeAdapterOptions,
  pending: Map<string, PendingDelivery>,
  v2Calls: Map<string, { runId: string; executionId: string; hostCallId: string }>,
  input: ToolHookInput,
  output: ToolBeforeOutput,
): void {
  if (!isV2Compiler(options.compiler)) return
  const executionIds = v2ExecutionIdsForSession(pending, input.sessionID)
  const v2Delivery = v2PendingForSession(pending, input.sessionID)
  if (executionIds.length === 0) {
    if (v2Delivery?.confirmed) {
      throw new OpenCodeAdapterError("V2_EXECUTION_NOT_ACTIVE", "no v2 execution is active for this session")
    }
    return
  }
  let request: OperationRequest | undefined
  let executionId: string | undefined
  for (const candidate of executionIds) {
    request = options.resolveV2Operation
      ? options.resolveV2Operation(input, candidate)
      : defaultResolveV2Operation(v2Delivery?.runId ?? "unknown", input, output, candidate, v2Delivery?.sessionId ?? "")
    if (request) {
      executionId = candidate
      break
    }
  }
  if (!request || !executionId) {
    throw new OpenCodeAdapterError("V2_OPERATION_UNRESOLVED", `tool call ${input.callID} did not resolve to an authorized v2 operation`)
  }
  const result = options.compiler.authorize(request)
  if (!result.ok) {
    throw new OpenCodeAdapterError("TOOL_AUTHORIZATION_DENIED", result.message ?? result.code ?? "v2 Compiler denied the tool operation")
  }
  const delivery = v2PendingForSession(pending, input.sessionID)
  v2Calls.set(v2CallKey(input.sessionID, input.callID), {
    runId: delivery?.runId ?? request.run_id,
    executionId,
    hostCallId: input.callID,
  })
}

function recordV2OperationResult(
  options: OpenCodeAdapterOptions,
  v2Calls: Map<string, { runId: string; executionId: string; hostCallId: string }>,
  input: ToolHookInput,
  output: ToolAfterOutput,
): void {
  if (!isV2Compiler(options.compiler)) return
  const call = v2Calls.get(v2CallKey(input.sessionID, input.callID))
  if (!call) return
  const compiler = options.compiler
  void (async () => {
    const receipt = await compiler.acceptEvent({
      schema_version: 2,
      run_id: call.runId,
      event_id: v2ToolEventId(call.executionId, input.callID),
      kind: "operation_result",
      source: { producer_id: "host", channel: "executor" },
      execution_id: call.executionId,
      payload: {
        call_id: input.callID,
        title: output.title,
        output: output.output,
        metadata: output.metadata,
      },
    })
    if (!receipt.ok && receipt.status !== "duplicate") {
      // The Observer still records the tool result; Compiler event failure is not silently ignored.
      void options.observer.observeEvent({
        type: "opencode.v2.operation_result_rejected",
        properties: { sessionID: input.sessionID, callID: input.callID, code: receipt.code, message: receipt.message },
      })
    }
  })().catch((error: unknown) => {
    void options.observer.observeEvent({
      type: "opencode.v2.operation_result_failed",
      properties: { sessionID: input.sessionID, callID: input.callID, error: errorMessage(error) },
    })
  })
}

function v2ExecutionIdsForSession(pending: Map<string, PendingDelivery>, sessionId: string): string[] {
  const delivery = v2PendingForSession(pending, sessionId)
  return delivery?.confirmed ? delivery.v2ExecutionIds ?? [] : []
}

function v2PendingForSession(pending: Map<string, PendingDelivery>, sessionId: string): PendingDelivery | undefined {
  for (const delivery of pending.values()) {
    if (delivery.compilerV2 && delivery.sessionId === sessionId) return delivery
  }
  return undefined
}

function defaultResolveV2Operation(
  runId: string,
  input: ToolHookInput,
  output: ToolBeforeOutput,
  executionId: string,
  hostIdentity: string,
): OperationRequest {
  const rawArgs = output.args ?? {}
  const argsDigest = `sha256:${sha256(stableJson(rawArgs))}`
  const tool = typeof input.tool === "string" && input.tool.length > 0 ? input.tool : "unknown"
  return {
    kind: "operation",
    run_id: runId,
    execution_id: executionId,
    host_identity: hostIdentity,
    host_call_id: input.callID,
    operation_id: tool,
    resource_ref: { source_id: `tool:${tool}`, digest: argsDigest },
    input_refs: [],
    output_refs: [],
    invocation: { tool, args_digest: argsDigest, raw_args: rawArgs },
  }
}

function v2CallKey(sessionId: string, callId: string): string {
  return `${sessionId}\u0000${callId}`
}

function v2UserEventId(runId: string, sessionId: string, messageId: string): string {
  return `${runId}:user:${sessionId}:${messageId}`
}

function v2ToolEventId(executionId: string, callId: string): string {
  return `${executionId}:tool:${callId}`
}

function v2ReturnEventId(executionId: string): string {
  return `${executionId}:return`
}

function v2DeliveryAckEventId(messageId: string): string {
  return `delivery-ack:${messageId}`
}

async function onChatMessage(
  options: OpenCodeAdapterOptions,
  pending: Map<string, PendingDelivery>,
  managed: ManagedInputs,
  input: ChatMessageInput,
  output: ChatMessageOutput,
): Promise<void> {
  const captured = await options.observer.captureRawInput(input, output)
  if (!captured) return

  managed.sessions.add(input.sessionID)
  const messageId = messageIdentity(input, output)
  const key = pendingKey(input.sessionID, messageId)
  managed.messages.add(key)
  const textParts = textPartsOf(output.parts)
  if (textParts.length === 0) throw new OpenCodeAdapterError("TEXT_PART_REQUIRED", "registered OpenCode input must contain a text part")
  if (pending.has(key)) throw new OpenCodeAdapterError("DELIVERY_ALREADY_PENDING", `delivery is already pending for ${key}`)

  if (options.arm === "raw") {
    const expectedParts = expectedPartsOf(textParts)
    const expectedPartDigest = partDigest(expectedParts)
    const observed = await options.observer.expectDelivery(input, output)
    if (!observed) throw new OpenCodeAdapterError("OBSERVER_EXPECTATION_REJECTED", "Observer rejected raw delivery expectation")
    pending.set(key, {
      sessionId: input.sessionID,
      messageId,
      runId: "raw",
      inputIdentity: messageId,
      expectedParts,
      expectedPartDigest,
      compiler: false,
      confirmed: false,
      rejected: false,
      systemApplied: false,
      reconciled: false,
    })
    return
  }

  if (output.parts.some((part) => part.type !== "text")) {
    throw new OpenCodeAdapterError("NON_TEXT_INPUT", "compiler arm rejects image, file, and other task-content parts before Compiler use")
  }

  const candidateCompiler = options.compiler
  if (isV2Compiler(candidateCompiler)) {
    await onV2ChatMessage(options, candidateCompiler, pending, input, output, textParts)
    return
  }
  const compiler = candidateCompiler as IntentCompiler
  const resolveTurn = options.resolveTurn as ResolveOpenCodeTurn
  const identity = await resolveTurn(input, output)
  const incomingText = textParts.map((part) => part.text).join("\n")
  const harness = harnessTexts(identity)
  if (harness && !matchesDeclaredHarness(incomingText, harness.harnessSystemText)) {
    throw new OpenCodeAdapterError(
      "HARNESS_SYSTEM_TEXT_MISMATCH",
      "Compiler input text must exactly match the declared harnessSystemText",
    )
  }
  const raw = harness?.userInputText ?? incomingText
  const parts = harness === undefined
    ? output.parts.map((part) => ({ ...part }))
    : [{ type: "text", text: raw }]
  const prepared = await compiler.prepareTurn({
    runId: identity.runId,
    input: {
      inputIdentity: identity.inputIdentity,
      raw,
      ...(identity.source === undefined ? {} : { source: identity.source }),
      parts,
    },
    ...(identity.currentWorkspaceSnapshotId === undefined ? {} : { currentWorkspaceSnapshotId: identity.currentWorkspaceSnapshotId }),
  })
  if (!prepared.ok) throw new OpenCodeAdapterError("COMPILER_PREPARE_REJECTED", prepared.message)

  mutateTextPartsInPlace(output.parts, prepared.renderedText)
  const expectedParts = expectedPartsOf(textPartsOf(output.parts))
  const delivery: PendingDelivery = {
    sessionId: input.sessionID,
    messageId,
    runId: prepared.runId,
    inputIdentity: prepared.inputIdentity,
    artifactVersion: prepared.artifactVersion,
    commit: prepared.commit,
    ...(identity.source === undefined ? {} : { source: identity.source }),
    ...(harness === undefined ? {} : { harnessSystemText: harness.harnessSystemText }),
    expectedParts,
    expectedPartDigest: partDigest(expectedParts),
    compiler: true,
    confirmed: false,
    rejected: false,
    systemApplied: false,
    reconciled: false,
  }
  let observed = false
  try {
    observed = await options.observer.expectDelivery(input, output)
  } catch (error: unknown) {
    await rejectCompilerDelivery(options, delivery, `Observer delivery expectation failed: ${errorMessage(error)}`, undefined)
    delivery.rejected = true
    throw new OpenCodeAdapterError("OBSERVER_EXPECTATION_REJECTED", `Observer delivery expectation failed: ${errorMessage(error)}`)
  }
  if (!observed) {
    await rejectCompilerDelivery(options, delivery, "Observer rejected Compiler delivery expectation", undefined)
    delivery.rejected = true
    throw new OpenCodeAdapterError("OBSERVER_EXPECTATION_REJECTED", "Observer rejected Compiler delivery expectation")
  }
  pending.set(key, delivery)
}

/**
 * A second round is only worth its minutes when the first one died on the way
 * to the model (transport, unparseable answer): only those failures come back
 * with `retryable: true` from advance().  A semantic or mechanical rejection
 * is a statement about the contract, and re-rolling it spends the task's
 * remaining budget to fail the same way.  The retry is also time-guarded —
 * management calls take minutes — and the run-level request budget still
 * bounds the total.
 */
const ADVANCE_ATTEMPTS = 2
const ADVANCE_RETRY_WINDOW_MS = 10 * 60_000

export async function advanceForTurn(compiler: IntentCompilerV2, runId: string): Promise<AdvanceResult> {
  const startedAt = Date.now()
  let last: AdvanceResult | undefined
  let attempts = 0
  for (let attempt = 1; attempt <= ADVANCE_ATTEMPTS; attempt += 1) {
    attempts = attempt
    let advanced: AdvanceResult
    try {
      advanced = await compiler.advance({ runId })
    } catch (error: unknown) {
      throw new OpenCodeAdapterError("COMPILER_ADVANCE_FAILED", `Compiler advance failed: ${errorMessage(error)}`)
    }
    if (advanced.ok) return advanced
    last = advanced
    if (advanced.retryable !== true) break
    if (Date.now() - startedAt > ADVANCE_RETRY_WINDOW_MS) break
  }
  const detail = last?.message ?? last?.code ?? "Compiler advance failed"
  throw new OpenCodeAdapterError(
    "COMPILER_ADVANCE_REJECTED",
    attempts > 1 ? `${detail} (after ${attempts} advance attempts)` : detail,
  )
}

async function onV2ChatMessage(
  options: OpenCodeAdapterOptions,
  compiler: IntentCompilerV2,
  pending: Map<string, PendingDelivery>,
  input: ChatMessageInput,
  output: ChatMessageOutput,
  textParts: Array<{ id: string; type: "text"; text: string }>,
): Promise<void> {
  const resolveTurn = options.resolveTurn as ResolveOpenCodeTurn
  const identity = await resolveTurn(input, output)
  const incomingText = textParts.map((part) => part.text).join("\n")
  const harness = harnessTexts(identity)
  if (harness && !matchesDeclaredHarness(incomingText, harness.harnessSystemText)) {
    throw new OpenCodeAdapterError(
      "HARNESS_SYSTEM_TEXT_MISMATCH",
      "Compiler input text must exactly match the declared harnessSystemText",
    )
  }
  const raw = harness?.userInputText ?? incomingText
  const event: CompilerEvent = {
    schema_version: 2,
    run_id: identity.runId,
    event_id: v2UserEventId(identity.runId, input.sessionID, textParts[0]?.id ?? input.messageID ?? "message"),
    kind: "user_input",
    source: { producer_id: "host", channel: "user" },
    ...(identity.taskIds === undefined ? {} : { task_ids: identity.taskIds }),
    payload: {
      text: raw,
      ...(identity.source === undefined ? {} : { source: identity.source }),
    },
  }
  let receipt: EventReceipt
  try {
    receipt = await compiler.acceptEvent(event)
  } catch (error: unknown) {
    throw new OpenCodeAdapterError("COMPILER_ACCEPT_EVENT_FAILED", `Compiler acceptEvent failed: ${errorMessage(error)}`)
  }
  if (!receipt.ok && receipt.status !== "duplicate") {
    throw new OpenCodeAdapterError("COMPILER_ACCEPT_EVENT_REJECTED", receipt.message ?? receipt.code ?? "Compiler rejected the event")
  }

  const advanced = await advanceForTurn(compiler, identity.runId)

  const deliveries: OpenCodeV2Delivery[] = (advanced.deliveries ?? []).map((delivery) => {
    return {
      dispatch_id: delivery.dispatch_id,
      task_id: delivery.task_id,
      atom_id: delivery.atom_id,
      digest: delivery.digest,
      compiled_revision: delivery.compiled_revision,
      atom: delivery.atom,
    }
  })
  if (deliveries.length === 0) {
    // Never hand the executor an empty prompt: a batch that ends without work
    // is a management outcome the host has to see (disposition, questions),
    // not a silent no-op.  Sending the raw user text instead would run the
    // task unmanaged, which is the other arm of the experiment.
    const blocked = new OpenCodeAdapterError(
      "COMPILER_HOST_WAIT_UNSUPPORTED",
      `Compiler handled this turn (disposition=${advanced.disposition}); this adapter cannot suspend a chat turn without aborting its execution hook${advanced.questions?.length ? `; questions: ${advanced.questions.join(" | ")}` : ""}`,
    )
    blocked.managementOutcome = structuredClone(advanced)
    throw blocked
  }
  mutateTextPartsInPlace(output.parts, stableJson(deliveries.map((delivery) => delivery.atom)))

  const expectedParts = expectedPartsOf(textPartsOf(output.parts))
  const delivery: PendingDelivery = {
    sessionId: input.sessionID,
    messageId: messageIdentity(input, output),
    runId: identity.runId,
    inputIdentity: v2UserEventId(identity.runId, input.sessionID, textParts[0]?.id ?? input.messageID ?? "message"),
    ...(identity.source === undefined ? {} : { source: identity.source }),
    ...(harness === undefined ? {} : { harnessSystemText: harness.harnessSystemText }),
    expectedParts,
    expectedPartDigest: partDigest(expectedParts),
    compiler: true,
    compilerV2: true,
    v2Deliveries: deliveries,
    confirmed: false,
    rejected: false,
    systemApplied: false,
    reconciled: false,
  }
  let observed = false
  try {
    observed = await options.observer.expectDelivery(input, output)
  } catch (error: unknown) {
    delivery.rejected = true
    throw new OpenCodeAdapterError("OBSERVER_EXPECTATION_REJECTED", `Observer delivery expectation failed: ${errorMessage(error)}`)
  }
  if (!observed) {
    delivery.rejected = true
    throw new OpenCodeAdapterError("OBSERVER_EXPECTATION_REJECTED", "Observer rejected Compiler delivery expectation")
  }
  pending.set(pendingKey(delivery.sessionId, delivery.messageId), delivery)
}

async function onChatParams(
  options: OpenCodeAdapterOptions,
  pending: Map<string, PendingDelivery>,
  managed: ManagedInputs,
  input: ModelRequestInput,
  output: ModelRequestOutput,
): Promise<void> {
  const messageId = input.message?.id
  if (typeof messageId !== "string" || messageId.length === 0) {
    if (!managed.sessions.has(input.sessionID)) return
    throw new OpenCodeAdapterError("DELIVERY_GUARD_MESSAGE_ID_MISSING", "chat.params supplied no target message ID")
  }
  const key = pendingKey(input.sessionID, messageId)
  const delivery = pending.get(key)
  if (!delivery && !managed.sessions.has(input.sessionID) && !managed.messages.has(key)) return
  if (!delivery && v2PendingForSession(pending, input.sessionID)?.confirmed && !managed.messages.has(key)) return
  if (!delivery) throw new OpenCodeAdapterError("DELIVERY_GUARD_PENDING_MISSING", `no prepared delivery for ${input.sessionID}/${messageId}`)
  if (delivery.rejected) throw new OpenCodeAdapterError("DELIVERY_GUARD_ALREADY_REJECTED", "the prepared delivery was already rejected")
  if (delivery.reconciled) throw new OpenCodeAdapterError("DELIVERY_GUARD_RECONCILIATION_REQUIRED", "reconciled delivery cannot be reused")
  if (delivery.harnessSystemText !== undefined && !delivery.systemApplied) {
    await rejectCompilerDelivery(options, delivery, "required harness system transform was not applied", undefined)
    delivery.rejected = true
    throw new OpenCodeAdapterError(
      "DELIVERY_GUARD_SYSTEM_TRANSFORM_REQUIRED",
      "Compiler delivery requires experimental.chat.system.transform before chat.params",
    )
  }

  let actualParts: ExpectedPart[]
  let actualPartDigest: string
  let actualRenderedText: string
  try {
    const messages = await readSessionMessages(options.client, input.sessionID)
    const target = messages.find((message) => message.info?.id === messageId)
    if (!target) {
      await rejectCompilerDelivery(options, delivery, "target message is missing from SDK readback", undefined)
      delivery.rejected = true
      throw new OpenCodeAdapterError("DELIVERY_GUARD_TARGET_MISSING", `SDK readback did not contain message ${messageId}`)
    }
    actualParts = expectedPartsOf(textPartsOf(target.parts ?? []))
    actualPartDigest = partDigest(actualParts)
    if (actualPartDigest !== delivery.expectedPartDigest || !sameParts(delivery.expectedParts, actualParts)) {
      await rejectCompilerDelivery(options, delivery, "SDK target-message text parts do not match expected delivery", actualPartDigest)
      delivery.rejected = true
      throw new OpenCodeAdapterError("DELIVERY_GUARD_PART_MISMATCH", "SDK target-message text parts differ from expected delivery")
    }
    actualRenderedText = actualParts.map((part) => part.text).join("")
  } catch (error: unknown) {
    if (
      error instanceof OpenCodeAdapterError &&
      (error.code.startsWith("DELIVERY_GUARD_") || error.code === "DELIVERY_REJECT_RECORD_FAILED")
    ) {
      throw error
    }
    await rejectCompilerDelivery(options, delivery, `SDK message read failed: ${errorMessage(error)}`, undefined)
    delivery.rejected = true
    throw new OpenCodeAdapterError("DELIVERY_GUARD_READ_FAILURE", `SDK target-message read failed: ${errorMessage(error)}`)
  }

  let observed = true
  try {
    observed = (await options.observer.modelRequested?.(input, output)) ?? true
  } catch (error: unknown) {
    throw new OpenCodeAdapterError("OBSERVER_MODEL_REQUEST_FAILED", `Observer model-request recording failed: ${errorMessage(error)}`)
  }
  if (!observed) throw new OpenCodeAdapterError("OBSERVER_MODEL_REQUEST_REJECTED", "Observer rejected model-request recording")
  if (delivery.harnessSystemText !== undefined) delivery.systemApplied = false

  if (delivery.confirmed) return

  if (delivery.compilerV2) {
    await confirmV2Delivery(options, delivery, actualRenderedText)
    return
  }

  if (!delivery.compiler) {
    delivery.confirmed = true
    return
  }
  const commit = compilerCommit(delivery)
  let actualArtifact: unknown
  try {
    actualArtifact = JSON.parse(actualRenderedText) as unknown
  } catch (error: unknown) {
    await rejectCompilerDelivery(
      options,
      delivery,
      `delivered Compiled Intent is not valid JSON: ${errorMessage(error)}`,
      actualPartDigest,
    )
    delivery.rejected = true
    throw new OpenCodeAdapterError(
      "DELIVERY_GUARD_ARTIFACT_INVALID",
      `SDK target-message Compiled Intent is not valid JSON: ${errorMessage(error)}`,
    )
  }
  const actualCompiledIntentDigest = `sha256:${sha256(stableJson(actualArtifact))}`
  const actualRenderedTextDigest = `sha256:${sha256(actualRenderedText)}`
  const compiler = options.compiler as IntentCompiler
  let confirmed
  try {
    confirmed = compiler.recordDelivery({
      runId: delivery.runId,
      inputIdentity: delivery.inputIdentity,
      artifactVersion: delivery.artifactVersion,
      expectedDigest: commit.compiledIntent.digest,
      expectedRenderedDigest: commit.renderedText.digest,
      readbackDigest: actualCompiledIntentDigest,
      readbackRenderedDigest: actualRenderedTextDigest,
      status: "confirmed",
      metadata: {
        expectedPartDigest: delivery.expectedPartDigest,
        readbackPartDigest: actualPartDigest,
        ...(delivery.source === undefined ? {} : { source: delivery.source }),
      },
    })
  } catch (error: unknown) {
    delivery.rejected = true
    throw new OpenCodeAdapterError("DELIVERY_CONFIRM_REJECTED", `Compiler delivery confirmation failed: ${errorMessage(error)}`)
  }
  if (!confirmed.ok || !confirmed.attempt || confirmed.attempt.status !== "confirmed") {
    delivery.rejected = true
    throw new OpenCodeAdapterError("DELIVERY_CONFIRM_REJECTED", confirmed.message ?? "Compiler rejected confirmed delivery")
  }
  delivery.attemptId = confirmed.attempt.attemptId
  delivery.confirmed = true
}

async function confirmV2Delivery(
  options: OpenCodeAdapterOptions,
  delivery: PendingDelivery,
  actualRenderedText: string,
): Promise<void> {
  const compiler = options.compiler as IntentCompilerV2
  if (!delivery.v2Deliveries) {
    delivery.rejected = true
    throw new OpenCodeAdapterError("DELIVERY_V2_PAYLOAD_MISSING", "v2 delivery has no dispatch payload")
  }
  let actualDeliveries: unknown
  try {
    actualDeliveries = JSON.parse(actualRenderedText)
  } catch (error: unknown) {
    delivery.rejected = true
    throw new OpenCodeAdapterError(
      "DELIVERY_GUARD_ARTIFACT_INVALID",
      `v2 delivery payload is not valid JSON: ${errorMessage(error)}`,
    )
  }
  const expectedPayload = delivery.v2Deliveries.map((item) => item.atom)
  if (stableJson(actualDeliveries) !== stableJson(expectedPayload)) {
    delivery.rejected = true
    throw new OpenCodeAdapterError("DELIVERY_GUARD_PART_MISMATCH", "SDK readback v2 dispatch payload differs from expected delivery")
  }

  const ack = await compiler.acceptEvent({
    schema_version: 2,
    run_id: delivery.runId,
    event_id: v2DeliveryAckEventId(delivery.messageId),
    kind: "delivery_ack",
    source: { producer_id: "host", channel: "host" },
    task_ids: delivery.v2Deliveries.map((item) => item.task_id),
    payload: {
      dispatch_ids: delivery.v2Deliveries.map((item) => item.dispatch_id),
      readback_digest: delivery.expectedPartDigest,
    },
  })
  if (!ack.ok && ack.status !== "duplicate") {
    delivery.rejected = true
    throw new OpenCodeAdapterError("DELIVERY_ACK_REJECTED", ack.message ?? ack.code ?? "Compiler rejected delivery_ack")
  }

  const executionIds: string[] = []
  for (const dispatched of delivery.v2Deliveries) {
    let authorized: AuthorizationResult
    try {
      authorized = compiler.authorize({
        kind: "start",
        run_id: delivery.runId,
        dispatch_id: dispatched.dispatch_id,
        host_identity: delivery.sessionId,
      })
    } catch (error: unknown) {
      delivery.rejected = true
      throw new OpenCodeAdapterError("DELIVERY_START_REJECTED", `v2 start authorization failed: ${errorMessage(error)}`)
    }
    if (!authorized.ok || !authorized.execution_id) {
      delivery.rejected = true
      throw new OpenCodeAdapterError("DELIVERY_START_REJECTED", authorized.message ?? authorized.code ?? "Compiler rejected start authorization")
    }
    executionIds.push(authorized.execution_id)
  }
  delivery.v2ExecutionIds = executionIds
  delivery.confirmed = true
}

async function onSystemTransform(
  pending: Map<string, PendingDelivery>,
  managed: ManagedInputs,
  input: OpenCodeSystemTransformInput,
  output: OpenCodeSystemTransformOutput,
): Promise<void> {
  if (typeof input.sessionID !== "string" || input.sessionID.length === 0) {
    throw new OpenCodeAdapterError("SYSTEM_TRANSFORM_SESSION_MISSING", "system transform requires a session ID")
  }

  const all = [...pending.values()].filter((delivery) => delivery.sessionId === input.sessionID)
  if (!managed.sessions.has(input.sessionID) && all.length === 0) return

  const active = all.filter((delivery) => !delivery.rejected && !delivery.reconciled)
  if (active.length === 0) {
    throw new OpenCodeAdapterError("SYSTEM_TRANSFORM_ORDER", "system transform arrived without an active pending delivery")
  }
  if (active.length !== 1) {
    throw new OpenCodeAdapterError("SYSTEM_TRANSFORM_MULTIPLE_PENDING", "system transform requires exactly one pending delivery per session")
  }

  const delivery = active[0]
  if (delivery.harnessSystemText === undefined) return
  if (delivery.systemApplied) {
    throw new OpenCodeAdapterError("SYSTEM_TRANSFORM_ORDER", "harness system text was already applied")
  }
  if (!Array.isArray(output.system)) {
    throw new OpenCodeAdapterError("SYSTEM_TRANSFORM_OUTPUT_INVALID", "system transform output must expose a mutable system array")
  }
  try {
    output.system.push(delivery.harnessSystemText)
  } catch (error: unknown) {
    throw new OpenCodeAdapterError("SYSTEM_TRANSFORM_APPLY_FAILED", `harness system text could not be appended: ${errorMessage(error)}`)
  }
  delivery.systemApplied = true
}

async function onEvent(
  options: OpenCodeAdapterOptions,
  pending: Map<string, PendingDelivery>,
  reconciliations: Map<string, Promise<boolean>>,
  event: ObserverEventEnvelope,
): Promise<void> {
  await options.observer.observeEvent(event)
  if (!isTerminalEvent(event)) return
  const sessionId = eventSessionId(event)
  if (!sessionId || !options.observer.scheduleReconciliation) return
  const existing = reconciliations.get(sessionId)
  if (existing) {
    await existing
    return
  }
  const scheduled = options.observer.scheduleReconciliation(sessionId)
  const reconciliation = scheduled.finally(() => {
    if (reconciliations.get(sessionId) === reconciliation) reconciliations.delete(sessionId)
  })
  reconciliations.set(sessionId, reconciliation)
  const succeeded = await reconciliation
  const compiler = options.compiler
  if (isV2Compiler(compiler)) {
    const advancedRuns = new Set<string>()
    for (const delivery of pending.values()) {
      if (
        !delivery.compilerV2 ||
        delivery.sessionId !== sessionId ||
        !delivery.confirmed ||
        delivery.v2Returned ||
        !delivery.v2ExecutionIds
      ) continue
      for (let index = 0; index < delivery.v2ExecutionIds.length; index += 1) {
        const executionId = delivery.v2ExecutionIds[index] as string
        const dispatched = delivery.v2Deliveries?.[index]
        if (!dispatched) {
          delivery.rejected = true
          throw new OpenCodeAdapterError(
            "DELIVERY_RETURN_DISPATCH_MISSING",
            `execution ${executionId} has no matching v2 dispatch payload`,
          )
        }
        const stateClaim = succeeded ? "completed" as const : "stopped" as const
        const outcome: ExecutionOutcome = {
          schema_version: 2,
          execution_id: executionId,
          atom_ref: {
            id: dispatched.atom_id,
            revision: dispatched.atom.revision,
            digest: dispatched.digest,
          },
          suggested_status: succeeded ? "completed" : "ready",
          product_refs: [],
          file_changes: [],
          evidence_refs: [],
          ...(succeeded ? {} : { failure_reason: "opencode-sdk-reconciliation-failed" }),
        }
        const result = await compiler.acceptEvent({
          schema_version: 2,
          run_id: delivery.runId,
          event_id: v2ReturnEventId(executionId),
          kind: "execution_return",
          source: { producer_id: "host", channel: "executor" },
          execution_id: executionId,
          payload: {
            state_claim: stateClaim,
            reason: succeeded ? "opencode-sdk-reconciliation-succeeded" : "opencode-sdk-reconciliation-failed",
            outcome,
          },
        })
        if (!result.ok && result.status !== "duplicate") {
          throw new OpenCodeAdapterError("DELIVERY_RETURN_REJECTED", result.message ?? result.code ?? "Compiler rejected execution return")
        }
      }
      delivery.v2Returned = true
      if (!advancedRuns.has(delivery.runId)) {
        advancedRuns.add(delivery.runId)
        let advanced: AdvanceResult
        try {
          advanced = await compiler.advance({ runId: delivery.runId })
        } catch (error: unknown) {
          throw new OpenCodeAdapterError("DELIVERY_RETURN_ADVANCE_FAILED", `Compiler advance after execution return failed: ${errorMessage(error)}`)
        }
        if (!advanced.ok) {
          throw new OpenCodeAdapterError("DELIVERY_RETURN_ADVANCE_REJECTED", advanced.message ?? advanced.code ?? "Compiler rejected post-return advance")
        }
      }
    }
    return
  }
  if (!compiler) return
  for (const delivery of pending.values()) {
    if (!delivery.compiler || delivery.sessionId !== sessionId || !delivery.confirmed || delivery.reconciled || !delivery.attemptId) continue
    const result = compiler.recordDelivery({
      runId: delivery.runId,
      inputIdentity: delivery.inputIdentity,
      attemptId: delivery.attemptId,
      reconciliation: {
        terminal: true,
        status: succeeded ? "complete" : "failed",
        ...(succeeded ? {} : { executionTrace: { assistantStep: true } }),
        result: { source: "opencode-sdk-reconciliation", succeeded },
      },
    })
    if (!result.ok) throw new OpenCodeAdapterError("DELIVERY_RECONCILIATION_REJECTED", result.message ?? "Compiler rejected delivery reconciliation")
    delivery.reconciled = true
  }
}

async function rejectCompilerDelivery(
  options: OpenCodeAdapterOptions,
  delivery: PendingDelivery,
  reason: string,
  actualPartDigest: string | undefined,
): Promise<void> {
  if (delivery.compilerV2) {
    delivery.rejected = true
    return
  }
  if (!delivery.compiler) return
  const commit = compilerCommit(delivery)
  const compiler = options.compiler as IntentCompiler
  const result = compiler.recordDelivery({
    runId: delivery.runId,
    inputIdentity: delivery.inputIdentity,
    artifactVersion: delivery.artifactVersion,
    expectedDigest: commit.compiledIntent.digest,
    expectedRenderedDigest: commit.renderedText.digest,
    status: "rejected",
    reason,
    metadata: {
      expectedPartDigest: delivery.expectedPartDigest,
      ...(actualPartDigest === undefined ? {} : { readbackPartDigest: actualPartDigest }),
      ...(delivery.source === undefined ? {} : { source: delivery.source }),
    },
  })
  if (!result.ok) throw new OpenCodeAdapterError("DELIVERY_REJECT_RECORD_FAILED", result.message ?? "Compiler rejected delivery failure record")
}

function compilerCommit(delivery: PendingDelivery): CommitReference {
  if (!delivery.commit) throw new OpenCodeAdapterError("DELIVERY_COMMIT_MISSING", "Compiler delivery has no committed artifact reference")
  return delivery.commit
}

async function readSessionMessages(client: OpenCodeClient, sessionId: string): Promise<SdkMessageLike[]> {
  const messagesMethod = client.session?.messages
  if (typeof messagesMethod !== "function") throw new Error("client.session.messages is unavailable")
  const response = await messagesMethod.call(client.session, { path: { id: sessionId } })
  if (Array.isArray(response)) return response as SdkMessageLike[]
  if (response && typeof response === "object" && Array.isArray((response as Record<string, unknown>).data)) {
    return (response as Record<string, unknown>).data as SdkMessageLike[]
  }
  const nested = response && typeof response === "object" ? (response as Record<string, unknown>).data : undefined
  if (nested && typeof nested === "object" && Array.isArray((nested as Record<string, unknown>).data)) {
    return (nested as Record<string, unknown>).data as SdkMessageLike[]
  }
  throw new Error("unexpected client.session.messages response shape")
}

interface SdkMessageLike {
  info?: { id?: string }
  parts?: Array<{ id?: string; type?: string; text?: string }>
}

function mutateTextPartsInPlace(parts: Array<{ type?: string; text?: string }>, renderedText: string): void {
  let first = true
  for (const part of parts) {
    if (part.type !== "text") continue
    part.text = first ? renderedText : ""
    first = false
  }
}

function textPartsOf(parts: Array<{ id?: string; type?: string; text?: string }>): Array<{ id: string; type: "text"; text: string }> {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => {
      if (typeof part.id !== "string" || typeof part.text !== "string") throw new OpenCodeAdapterError("TEXT_PART_ID_OR_TEXT_MISSING", "text delivery parts require stable id and text")
      return { id: part.id, type: "text", text: part.text }
    })
}

function expectedParts(parts: Array<{ id: string; text: string }>): ExpectedPart[] {
  return parts.map(({ id, text }) => ({ id, text }))
}

function expectedPartsOf(parts: Array<{ id: string; type?: string; text: string }>): ExpectedPart[] {
  return expectedParts(parts.map(({ id, text }) => ({ id, text })))
}

function partDigest(parts: readonly ExpectedPart[]): string {
  return `sha256:${sha256(stableJson(parts))}`
}

function sameParts(expected: readonly ExpectedPart[], actual: readonly ExpectedPart[]): boolean {
  return expected.length === actual.length && expected.every((part, index) => part.id === actual[index]?.id && part.text === actual[index]?.text)
}

function harnessTexts(identity: OpenCodeTurnIdentity): { userInputText: string; harnessSystemText: string } | undefined {
  const hasUserInput = identity.userInputText !== undefined
  const hasHarness = identity.harnessSystemText !== undefined
  if (hasUserInput !== hasHarness) {
    throw new OpenCodeAdapterError(
      "HARNESS_TEXT_PAIR_REQUIRED",
      "userInputText and harnessSystemText must be provided together",
    )
  }
  if (!hasUserInput) return undefined
  if (typeof identity.userInputText !== "string" || typeof identity.harnessSystemText !== "string") {
    throw new OpenCodeAdapterError(
      "HARNESS_TEXT_PAIR_REQUIRED",
      "userInputText and harnessSystemText must both be text",
    )
  }
  return { userInputText: identity.userInputText, harnessSystemText: identity.harnessSystemText }
}

function matchesDeclaredHarness(incomingText: string, declaredText: string): boolean {
  if (incomingText === declaredText) return true
  return incomingText === openCodeRunSingleArgumentText(declaredText)
}

// OpenCode 1.18.31's `run` command wraps each positional argument containing
// an ASCII space in quotes before creating the user text part. The supported
// host passes the complete harness as one argument, so reproduce only that
// documented transformation; do not trim or otherwise normalize either side.
function openCodeRunSingleArgumentText(text: string): string {
  return text.includes(" ") ? `"${text.replace(/"/gu, '\\"')}"` : text
}

function messageIdentity(input: ChatMessageInput, output: ChatMessageOutput): string {
  const value = input.messageID ?? output.message?.id
  if (typeof value !== "string" || value.length === 0) throw new OpenCodeAdapterError("MESSAGE_ID_REQUIRED", "OpenCode message requires a stable message ID")
  return value
}

function pendingKey(sessionId: string, messageId: string): string {
  return `${sessionId}\u0000${messageId}`
}

function eventSessionId(event: ObserverEventEnvelope): string | undefined {
  const properties = event.properties ?? {}
  const value =
    properties.sessionID ??
    (properties.info as Record<string, unknown> | undefined)?.sessionID ??
    (properties.part as Record<string, unknown> | undefined)?.sessionID
  return typeof value === "string" ? value : undefined
}

function isTerminalEvent(event: ObserverEventEnvelope): boolean {
  if (event.type === "session.idle" || event.type === "session.error") return true
  if (event.type !== "session.status") return false
  const status = (event.properties?.status as Record<string, unknown> | undefined)?.type
  return status === "idle" || status === "error" || status === "completed"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface ExperimentRuntimePluginContext {
  client: OpenCodeClient
  directory: string
  arm?: OpenCodeArm
  observer?: OpenCodeObserver
  compiler?: IntentCompiler | IntentCompilerV2
  resolveTurn?: ResolveOpenCodeTurn
  resolveV2Operation?: ResolveV2Operation
  env?: NodeJS.ProcessEnv
}

export async function ExperimentRuntimePlugin(context: ExperimentRuntimePluginContext): Promise<OpenCodeAdapterHooks> {
  const runtimeEnv = context.env ?? process.env
  const client = context.client
  const directory = context.directory
  const arm = context.arm ?? (runtimeEnv.EXPERIMENT_ARM_MODE === "compiler" ? "compiler" : "raw")
  const observer = context.observer
  const compiler = context.compiler
  const compilerModelSessions = new Set<string>()
  const resolveTurn = context.resolveTurn
  const resolvedObserver = observer ?? createObserverRuntime(client, directory, runtimeEnv)
  let resolvedCompiler: IntentCompiler | IntentCompilerV2 | undefined = compiler
  if (arm === "compiler" && !resolvedCompiler) {
    if (runtimeEnv.EXPERIMENT_COMPILER_SCHEMA === "legacy") {
      resolvedCompiler = createOpenCodeCompilerRuntime({
        client,
        executorDirectory: directory,
        observerStoreDirectory: configuredObserverStoreDirectory(runtimeEnv),
        env: runtimeEnv,
        onModelSessionCreated: (sessionId) => compilerModelSessions.add(sessionId),
      })
    } else {
      resolvedCompiler = createOpenCodeCompilerRuntimeV2({
        client,
        executorDirectory: directory,
        observerStoreDirectory: configuredObserverStoreDirectory(runtimeEnv),
        env: runtimeEnv,
        onModelSessionCreated: (sessionId) => compilerModelSessions.add(sessionId),
      })
    }
  }
  const resolvedTurn = resolveTurn ?? defaultTurnResolver(resolvedObserver)
  const adapter = createOpenCodeAdapter({
    arm,
    client,
    observer: resolvedObserver,
    compiler: resolvedCompiler,
    resolveTurn: resolvedTurn,
    resolveV2Operation: context.resolveV2Operation,
    ignoreSession: (sessionId) => compilerModelSessions.has(sessionId),
  })
  return adapter.hooks()
}

interface RuntimeObserver extends OpenCodeObserver {
  registry: { resolve(sessionId: string): Registration | undefined }
}

function createObserverRuntime(client: OpenCodeClient, directory: string, env: NodeJS.ProcessEnv): RuntimeObserver {
  const storeDir = configuredObserverStoreDirectory(env)
  const fromWorkspace = relative(resolve(directory), storeDir)
  if (fromWorkspace === "" || (!fromWorkspace.startsWith("..") && !isAbsolute(fromWorkspace))) {
    throw new OpenCodeAdapterError("OBSERVER_STORE_PATH_INVALID", "EXPERIMENT_OBSERVER_STORE must be outside the OpenCode workspace")
  }
  const runtime = new ObserverRuntime({ storeDir, client })
  return {
    registry: runtime.registry,
    captureRawInput: (input, output) => runtime.captureRawInput(input, output),
    expectDelivery: (input, output) => runtime.expectDelivery(input, output),
    observeEvent: (event) => runtime.observeEvent(event),
    modelRequested: (input, output) => runtime.modelRequested(input, output),
    toolBefore: (input, output) => runtime.toolBefore(input, output),
    toolAfter: (input, output) => runtime.toolAfter(input, output),
    scheduleReconciliation: (sessionId) => runtime.scheduleReconciliation(sessionId),
    dispose: async () => {
      await Promise.allSettled(runtime.reconciliations.values())
    },
  }
}

function configuredObserverStoreDirectory(env: NodeJS.ProcessEnv): string {
  return resolve(env.EXPERIMENT_OBSERVER_STORE ?? `${env.LOCALAPPDATA ?? process.cwd()}/opencode-experiment-observer`)
}

function defaultTurnResolver(observer: OpenCodeObserver): ResolveOpenCodeTurn {
  const runtime = observer as OpenCodeObserver & { registry?: { resolve(sessionId: string): Registration | undefined } }
  return (input, output) => {
    const messageId = messageIdentity(input, output)
    const registration = runtime.registry?.resolve(input.sessionID)
    if (!registration) throw new OpenCodeAdapterError("SESSION_NOT_REGISTERED", `session ${input.sessionID} is not registered for Compiler use`)
  return {
    runId: registration.run_id,
    inputIdentity: registration.input_identity ?? `${registration.run_id}:${registration.turn_id}:${registration.session_id}:${messageId}`,
    taskIds: [registration.task_id],
      source: {
        ...(registration.source_category === undefined ? {} : { source_category: registration.source_category }),
        run_id: registration.run_id,
        ...(registration.stage_id === undefined ? {} : { stage_id: registration.stage_id }),
        ...(registration.path_id === undefined ? {} : { path_id: registration.path_id }),
        ...(registration.round === undefined ? {} : { round: registration.round }),
        ...(registration.task_occurrence_id === undefined ? {} : { task_occurrence_id: registration.task_occurrence_id }),
        turn_id: registration.turn_id,
        session_id: registration.session_id,
        message_id: messageId,
        ...(registration.workspace_snapshot_id === undefined ? {} : { workspace_snapshot_id: registration.workspace_snapshot_id }),
        ...(registration.produced_at === undefined ? {} : { produced_at: registration.produced_at }),
      },
      ...(registration.workspace_snapshot_id === undefined
        ? {}
        : { currentWorkspaceSnapshotId: registration.workspace_snapshot_id }),
      ...(registration.user_input_text === undefined ? {} : { userInputText: registration.user_input_text }),
      ...(registration.harness_system_text === undefined ? {} : { harnessSystemText: registration.harness_system_text }),
    }
  }
}
