import { createHash } from "node:crypto"
import type {
  AdmittedEvidence,
  ApplyProposalResult,
  CompiledIntentArtifact,
  CompiledIntentProjection,
  InputContext,
  IntentState,
  ProposalEnvelope,
  ProjectionOptions,
  ValidationError,
} from "./intent-state.js"
import { applyProposal, createInitialIntentState, projectCompiledIntent } from "./intent-state.js"
import type {
  CompilerModel,
  CompilerModelInput,
  CompilerModelResult,
  ProposalValidationError,
} from "../model/compiler-model.js"
import type {
  CommitReference,
  CompilerInput,
  DeliveryAttempt,
  DeliveryAttemptInput,
  EvidenceDecision,
  RecoveryResult,
} from "./compiler-store.js"
import {
  CompilerStore,
  DeliveryBlockedError,
  IdentityConflictError,
  InputContentError,
} from "./compiler-store.js"

/**
 * The host sees only this four-operation seam.  It cannot write a proposal,
 * state, commit marker, or artifact directly.
 */
export interface IntentCompiler {
  prepareTurn(request: PrepareTurnRequest): Promise<PrepareTurnResult>
  recordDelivery(request: DeliveryRequest): DeliveryResult
  admitEvidence(request: EvidenceRequest): EvidenceResult
  recover(request: RecoveryRequest): RecoveryResult
}

export interface IntentCompilerOptions {
  store: CompilerStore
  model: CompilerModel
  projection?: Pick<ProjectionOptions, "max_artifact_bytes" | "max_rendered_bytes">
}

export interface PrepareTurnRequest {
  runId: string
  input: CompilerInput
  /** Workspace snapshot visible to this input boundary, when one exists. */
  currentWorkspaceSnapshotId?: string
}

export interface PrepareTurnSuccess {
  ok: true
  status: "committed" | "reused" | "noop"
  runId: string
  inputIdentity: string
  inputDigest: string
  stateVersion: number
  artifactVersion: number
  artifact: CompiledIntentArtifact
  canonicalArtifact: string
  renderedText: string
  compiledIntentDigest: string
  renderedTextDigest: string
  commit: CommitReference
  modelCalls: number
  retried: boolean
}

export interface PrepareTurnFailure {
  ok: false
  status: "rejected" | "blocked" | "conflict"
  runId: string
  inputIdentity: string
  code: string
  message: string
  errors?: readonly CompilerErrorDetail[]
  modelCalls: number
  retried: boolean
  recovery: RecoveryResult
}

export type PrepareTurnResult = PrepareTurnSuccess | PrepareTurnFailure

export interface CompilerErrorDetail {
  code: string
  message: string
  path?: string
  operation_index?: number
  field?: string
}

export interface DeliveryRequest {
  runId: string
  /** Omit this for a new attempt; provide it for a reconciliation-only call. */
  attemptId?: string
  inputIdentity: string
  artifactVersion?: number
  expectedDigest?: string
  expectedRenderedDigest?: string
  readbackDigest?: string
  readbackRenderedDigest?: string
  status?: DeliveryAttemptInput["status"]
  reason?: string
  executionTrace?: DeliveryAttemptInput["executionTrace"]
  metadata?: unknown
  reconciliation?: {
    terminal?: boolean
    status?: "complete" | "pending" | "failed"
    executionTrace?: DeliveryAttemptInput["executionTrace"]
    workspaceSnapshotDigest?: string
    result?: unknown
  }
}

export interface DeliveryResult {
  ok: boolean
  runId: string
  inputIdentity: string
  attempt?: DeliveryAttempt
  recovery: RecoveryResult
  code?: string
  message?: string
}

export interface EvidenceRequest {
  runId: string
  evidence: CompilerEvidenceInput
}

/**
 * Evidence is admitted only for an explicitly named next-input boundary.
 * Provenance lives in the payload so the Compiler can check it before the
 * record becomes visible to the model; the store receives the same payload.
 */
export interface CompilerEvidenceInput {
  evidenceId: string
  payload: unknown
  digest?: string
  boundaryInputIdentity: string
}

export interface EvidenceResult {
  ok: boolean
  runId: string
  evidence?: EvidenceDecision
  code?: string
  message?: string
}

export interface RecoveryRequest {
  runId: string
}

export class IntentCompilerError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "IntentCompilerError"
    this.code = code
  }
}

const DEFAULT_MAX_ARTIFACT_BYTES = 1_048_576
const DEFAULT_MAX_RENDERED_BYTES = 1_048_576

/** Construct the only host-facing Compiler interface. */
export function createIntentCompiler(options: IntentCompilerOptions): IntentCompiler {
  if (!(options.store instanceof CompilerStore)) throw new IntentCompilerError("STORE_REQUIRED", "an injected CompilerStore is required")
  if (!options.model || typeof options.model.propose !== "function") throw new IntentCompilerError("MODEL_REQUIRED", "an injected CompilerModel is required")
  const projection = {
    max_artifact_bytes: options.projection?.max_artifact_bytes ?? DEFAULT_MAX_ARTIFACT_BYTES,
    max_rendered_bytes: options.projection?.max_rendered_bytes ?? DEFAULT_MAX_RENDERED_BYTES,
  }

  return Object.freeze({
    prepareTurn: (request: PrepareTurnRequest) => prepareTurn(options.store, options.model, projection, request),
    recordDelivery: (request: DeliveryRequest) => recordDelivery(options.store, request),
    admitEvidence: (request: EvidenceRequest) => admitEvidenceToStore(options.store, request),
    recover: (request: RecoveryRequest) => options.store.openRun(request.runId).recover(),
  })
}

// State operations also support inspecting unselected tasks. At the public
// turn boundary, a newly created active task must not silently disappear from
// delivery because the proposal forgot selection. Never select on the model's
// behalf: reject before commit and use the existing bounded proposal retry.
function applyTurnProposal(state: IntentState, proposal: ProposalEnvelope, context: InputContext): ApplyProposalResult {
  const applied = applyProposal(state, proposal, context)
  if (!applied.ok || applied.state.selected_task_id !== null) return applied
  const priorIds = new Set(state.task_occurrences.map((task) => task.id))
  const unselectedNewTasks = applied.state.task_occurrences.filter((task) => task.status === "active" && !priorIds.has(task.id))
  if (unselectedNewTasks.length === 0) return applied
  return {
    ...applied,
    ok: false,
    accepted: false,
    changed: false,
    state,
    proposal_local_ids: {},
    errors: [{
      code: "new_active_task_not_selected",
      field: "operations",
      message: "The proposal creates an active task but selects none, so Compiled Intent would contain no task or requirements. Include select_task for the user-requested current task using its local_ref. Only if the user explicitly deferred all new tasks, suspend them instead. Do not invent a selection or deferral unsupported by the input.",
    }],
  }
}

async function prepareTurn(
  store: CompilerStore,
  model: CompilerModel,
  projectionOptions: Required<Pick<ProjectionOptions, "max_artifact_bytes" | "max_rendered_bytes">>,
  request: PrepareTurnRequest,
): Promise<PrepareTurnResult> {
  const inputIdentity = request.input.inputIdentity
  const baseFailure = (status: PrepareTurnFailure["status"], code: string, message: string, modelCalls: number, retried: boolean, errors?: readonly CompilerErrorDetail[]): PrepareTurnFailure => ({
    ok: false,
    status,
    runId: request.runId,
    inputIdentity,
    code,
    message,
    ...(errors === undefined ? {} : { errors }),
    modelCalls,
    retried,
    recovery: store.openRun(request.runId).recover(),
  })

  let run: ReturnType<CompilerStore["openRun"]>
  try {
    run = store.openRun(request.runId)
    run.configureProjectionLimits({
      maxArtifactBytes: projectionOptions.max_artifact_bytes,
      maxRenderedBytes: projectionOptions.max_rendered_bytes,
    })
  } catch (error: unknown) {
    return baseFailure("blocked", errorCode(error), errorMessage(error), 0, false)
  }

  let saved: ReturnType<typeof run.saveInput>
  try {
    validateTextInput(request.input)
    saved = run.saveInput(request.input)
  } catch (error: unknown) {
    const status = error instanceof IdentityConflictError ? "conflict" : error instanceof DeliveryBlockedError ? "blocked" : "rejected"
    return baseFailure(status, errorCode(error), errorMessage(error), 0, false)
  }

  const inputDigest = saved.record.digest
  const replay = run.replay()
  const recovery = run.recover()

  // A duplicate with a complete commit is idempotent.  It may be reused for
  // delivery, but confirmed/pending or contaminated attempts must reconcile
  // before this interface emits the artifact again.
  if (saved.status === "duplicate" && saved.commit) {
    if (recovery.action === "reconcile" || recovery.action === "retry_delivery" || recovery.action === "contaminated" || recovery.action === "blocked") {
      return baseFailure("blocked", "recovery_required", recovery.reason ?? `recovery action ${recovery.action} must complete first`, 0, false)
    }
    return successFromReplay(run, saved.commit.stateVersion, inputIdentity, inputDigest, "reused", 0, false)
  }
  if (saved.status === "duplicate" && recovery.action === "blocked") {
    return baseFailure("blocked", "TURN_STOPPED", recovery.reason ?? "the previously persisted turn stopped without a commit", 0, false)
  }

  const state = currentIntentState(replay.current)
  const evidence = admittedEvidence(run.eligibleEvidence(inputIdentity))
  const text = request.input.raw as string
  const modelInput: CompilerModelInput = {
    base_state_version: state.state_version,
    current_state: state,
    input_identity: inputIdentity,
    input_digest: inputDigest,
    input_text: text,
    ...(request.input.parts === undefined ? {} : { input_parts: request.input.parts as CompilerModelInput["input_parts"] }),
    admitted_evidence: evidence,
  }

  let modelCalls = 0
  let retried = false
  let proposal: ProposalEnvelope | undefined = saved.status === "duplicate" ? savedProposal(saved.proposal?.proposal) : undefined
  let rawResponse: string | undefined

  if (!proposal) {
    const first = await callModel(model, modelInput)
    modelCalls += 1
    if (first.ok) {
      proposal = first.proposal
      rawResponse = first.raw_response
      run.saveProposal(inputIdentity, { proposal, raw_response: rawResponse, status: "accepted" })
    } else {
      rawResponse = first.raw_response
      // A transport failure has no model proposal to recover.  Preserve the
      // durable raw-input point and let recovery repeat only the model call;
      // parsing/schema failures do have a saved rejected proposal and follow
      // the one-retry rule below.
      if (first.error.kind === "transport") {
        return baseFailure("rejected", first.error.code, first.error.message, modelCalls, retried, modelErrors(first.error))
      }
      run.saveProposal(inputIdentity, { raw_response: rawResponse, model_error: serializableModelError(first.error), status: "rejected" })
      const validation = run.recordValidation({ inputIdentity, valid: false, errors: modelErrors(first.error) })
      if (!retryableModelError(first.error)) return baseFailure("rejected", first.error.code, first.error.message, modelCalls, retried, modelErrors(first.error))
      retried = true
      const retry = await callModel(model, modelInput, modelErrors(first.error))
      modelCalls += 1
      if (!retry.ok) {
        const retryProposal = run.saveProposal(inputIdentity, { raw_response: retry.raw_response, model_error: serializableModelError(retry.error), status: "rejected", retry: true })
        run.recordValidation({ inputIdentity, proposalId: retryProposal.proposalId, valid: false, errors: modelErrors(retry.error) })
        return baseFailure("rejected", retry.error.code, retry.error.message, modelCalls, retried, modelErrors(retry.error))
      }
      proposal = retry.proposal
      rawResponse = retry.raw_response
      run.saveProposal(inputIdentity, { proposal, raw_response: rawResponse, status: "accepted", retry: true })
    }
  }

  let applied = applyTurnProposal(state, proposal as ProposalEnvelope, {
    input_identity: inputIdentity,
    input_digest: inputDigest,
    text,
    admitted_evidence: evidence,
    ...(request.currentWorkspaceSnapshotId === undefined ? {} : { current_workspace_snapshot_id: request.currentWorkspaceSnapshotId }),
  } satisfies InputContext)
  let validation = run.recordValidation({
    inputIdentity,
    proposalId: latestProposalId(run, inputIdentity),
    valid: applied.ok,
    errors: applied.errors,
    result: { changed: applied.changed, accepted: applied.accepted },
  })

  if (!applied.ok && !retried) {
    retried = true
    const retryErrors = stateErrors(applied.errors)
    const retry = await callModel(model, modelInput, retryErrors)
    modelCalls += 1
    if (!retry.ok) {
      run.saveProposal(inputIdentity, { raw_response: retry.raw_response, model_error: serializableModelError(retry.error), status: "rejected", retry: true })
      run.recordValidation({ inputIdentity, proposalId: latestProposalId(run, inputIdentity), valid: false, errors: modelErrors(retry.error) })
      return baseFailure("rejected", retry.error.code, retry.error.message, modelCalls, retried, modelErrors(retry.error))
    }
    proposal = retry.proposal
    rawResponse = retry.raw_response
    const retryProposal = run.saveProposal(inputIdentity, { proposal, raw_response: rawResponse, status: "accepted", retry: true })
    applied = applyTurnProposal(state, proposal, {
      input_identity: inputIdentity,
      input_digest: inputDigest,
      text,
      admitted_evidence: evidence,
      ...(request.currentWorkspaceSnapshotId === undefined ? {} : { current_workspace_snapshot_id: request.currentWorkspaceSnapshotId }),
    } satisfies InputContext)
    validation = run.recordValidation({ inputIdentity, proposalId: retryProposal.proposalId, valid: applied.ok, errors: applied.errors, result: { changed: applied.changed, accepted: applied.accepted } })
  }

  if (!applied.ok) {
    return baseFailure("rejected", "proposal_validation_failed", "the complete proposal was rejected; no state or delivery was produced", modelCalls, retried, stateErrors(applied.errors))
  }

  let projection: CompiledIntentProjection
  try {
    const projected = projectCompiledIntent(applied.state, {
      ...projectionOptions,
      previous: previousProjection(replay.current),
    })
    projection = {
      ...projected,
      rendered_digest: digestRenderedText(projected.rendered_text),
    }
  } catch (error: unknown) {
    return baseFailure("rejected", errorCode(error), errorMessage(error), modelCalls, retried)
  }

  let committed: ReturnType<typeof run.commit>
  try {
    committed = run.commit({
      inputIdentity,
      proposalId: validation.proposalId,
      validationId: validation.validationId,
      baseVersion: state.state_version,
      state: applied.state,
      compiledIntent: projection.artifact,
      renderedText: projection.rendered_text,
      operationIds: [...applied.operation_ids],
      sourceDigests: [inputDigest, ...run.eligibleEvidence(inputIdentity).map((item) => item.digest)],
    })
  } catch (error: unknown) {
    return baseFailure("blocked", errorCode(error), errorMessage(error), modelCalls, retried)
  }
  const status = "status" in committed ? committed.status : "committed"
  const stateVersion = committed.stateVersion
  const artifactVersion = committed.artifactVersion
  const commitReference = "commit" in committed ? committed.commit : committed
  return {
    ok: true,
    status: status === "noop" ? "noop" : "committed",
    runId: request.runId,
    inputIdentity,
    inputDigest,
    stateVersion,
    artifactVersion,
    artifact: projection.artifact,
    canonicalArtifact: projection.canonical_artifact,
    renderedText: projection.rendered_text,
    compiledIntentDigest: projection.artifact.artifact_digest,
    renderedTextDigest: projection.rendered_digest,
    commit: commitReference,
    modelCalls,
    retried,
  }
}

function recordDelivery(store: CompilerStore, request: DeliveryRequest): DeliveryResult {
  const run = store.openRun(request.runId)
  try {
    const before = run.recover()
    if (!request.attemptId && (before.action === "reconcile" || before.action === "contaminated" || before.action === "blocked")) {
      return { ok: false, runId: request.runId, inputIdentity: request.inputIdentity, recovery: before, code: "RECOVERY_REQUIRED", message: before.reason ?? `delivery is blocked by ${before.action}` }
    }
    let attempt: DeliveryAttempt | undefined
    if (request.attemptId) {
      if (!request.reconciliation) throw new IntentCompilerError("RECONCILIATION_REQUIRED", "attemptId requires a reconciliation payload")
      const attemptEvent = [...run.history()].reverse().find((event) => {
        const data = objectValue((event as unknown as { data?: unknown }).data)
        return event.type === "delivery.attempt" && data?.attemptId === request.attemptId
      })
      const attemptInputIdentity = attemptEvent === undefined
        ? undefined
        : textValue(objectValue((attemptEvent as unknown as { data?: unknown }).data)?.inputIdentity)
      if (attemptInputIdentity === undefined) {
        throw new IntentCompilerError("DELIVERY_NOT_FOUND", `unknown delivery attempt ${request.attemptId}`)
      }
      if (attemptInputIdentity !== request.inputIdentity) {
        throw new IntentCompilerError(
          "DELIVERY_INPUT_MISMATCH",
          "delivery reconciliation inputIdentity does not match the recorded attempt",
        )
      }
      run.reconcileDelivery(request.attemptId, request.reconciliation)
    } else {
      if (request.status === undefined) throw new IntentCompilerError("DELIVERY_STATUS_REQUIRED", "a new delivery attempt requires status")
      if (
        request.status === "confirmed" &&
        (
          request.artifactVersion === undefined ||
          request.expectedDigest === undefined ||
          request.expectedRenderedDigest === undefined ||
          request.readbackDigest === undefined ||
          request.readbackRenderedDigest === undefined
        )
      ) {
        throw new IntentCompilerError(
          "DELIVERY_READBACK_REQUIRED",
          "confirmed delivery requires artifactVersion and expected/readback digests for artifact and rendered text",
        )
      }
      const current = run.replay().current
      attempt = run.recordDeliveryAttempt({
        inputIdentity: request.inputIdentity,
        artifactVersion: request.artifactVersion ?? current.artifactVersion,
        expectedDigest: request.expectedDigest,
        expectedRenderedDigest: request.expectedRenderedDigest,
        readbackDigest: request.readbackDigest,
        readbackRenderedDigest: request.readbackRenderedDigest,
        status: request.status,
        reason: request.reason,
        executionTrace: request.executionTrace,
        metadata: request.metadata,
      })
      if (request.reconciliation) run.reconcileDelivery(attempt.attemptId, request.reconciliation)
    }
    const recovery = run.recover()
    return { ok: true, runId: request.runId, inputIdentity: request.inputIdentity, ...(attempt === undefined ? {} : { attempt }), recovery }
  } catch (error: unknown) {
    return { ok: false, runId: request.runId, inputIdentity: request.inputIdentity, recovery: run.recover(), code: errorCode(error), message: errorMessage(error) }
  }
}

/** Internal runtime entry for admitting evidence without constructing a model transport. */
export function admitEvidenceToStore(store: CompilerStore, request: EvidenceRequest): EvidenceResult {
  const run = store.openRun(request.runId)
  try {
    const recovery = run.recover()
    if (recovery.action !== "idle" && recovery.action !== "complete") {
      return { ok: false, runId: request.runId, code: "RECOVERY_REQUIRED", message: recovery.reason ?? `evidence admission waits for ${recovery.action}` }
    }
    const validation = validateEvidenceBoundary(run, request)
    if (validation !== undefined) return rejectEvidence(run, request, validation.code, validation.message)
    const evidence = run.recordEvidenceDecision({ ...request.evidence, decision: "admitted" })
    return { ok: true, runId: request.runId, evidence }
  } catch (error: unknown) {
    return { ok: false, runId: request.runId, code: errorCode(error), message: errorMessage(error) }
  }
}

interface EvidenceBoundaryError {
  code: string
  message: string
}

function validateEvidenceBoundary(
  run: ReturnType<CompilerStore["openRun"]>,
  request: EvidenceRequest,
): EvidenceBoundaryError | undefined {
  const evidence = request.evidence as unknown as Record<string, unknown>
  const boundary = textValue(evidence.boundaryInputIdentity)
  if (!boundary) return { code: "EVIDENCE_BOUNDARY_REQUIRED", message: "evidence must name the next input boundary" }
  const payload = objectValue(evidence.payload)
  if (!payload) return { code: "EVIDENCE_PAYLOAD_INVALID", message: "evidence payload must be a provenance object" }
  const kind = textValue(payload.kind)
  if (!kind) return { code: "EVIDENCE_KIND_REQUIRED", message: "evidence payload must declare kind" }
  const allowedKinds = new Set([
    "tool_result",
    "tool_error",
    "assistant_step",
    "step_finish",
    "workspace_diff",
    "verifier_pass",
    "test_pass",
    "check_pass",
    "verifier_result",
    "verifier_failure",
    "test_failure",
    "check_failure",
    "executor_statement",
    "executor_completion",
    "environment_observation",
  ])
  if (!allowedKinds.has(kind)) return { code: "EVIDENCE_KIND_FORBIDDEN", message: `evidence kind ${kind} is not in the Compiler evidence contract` }

  const required = [
    "run_id",
    "task_id",
    "turn_id",
    "causal_parent_id",
    "input_workspace_snapshot_id",
    "workspace_snapshot_id",
  ] as const
  for (const field of required) {
    if (!textValue(payload[field])) return { code: "EVIDENCE_PROVENANCE_REQUIRED", message: `evidence payload requires ${field}` }
  }
  const producedAt = textValue(payload.produced_at)
  if (!producedAt) {
    return { code: "EVIDENCE_PROVENANCE_REQUIRED", message: "evidence payload requires produced_at" }
  }
  const producedAtMilliseconds = Date.parse(producedAt)
  if (!Number.isFinite(producedAtMilliseconds)) {
    return { code: "EVIDENCE_TIMESTAMP_INVALID", message: "evidence produced_at must be a valid timestamp" }
  }
  if (payload.run_id !== request.runId) return { code: "EVIDENCE_RUN_MISMATCH", message: "evidence run_id does not match the Compiler run" }
  if (payload.complete !== true) {
    return { code: "EVIDENCE_NOT_TERMINAL", message: `${kind} evidence must be a persisted terminal result` }
  }

  const toolKinds = new Set(["tool_result", "tool_error", "environment_observation"])
  if (toolKinds.has(kind)) {
    for (const field of ["session_id", "message_id", "call_id"] as const) {
      if (!textValue(payload[field])) return { code: "EVIDENCE_SOURCE_ID_REQUIRED", message: `${kind} evidence requires ${field}` }
    }
  } else if (new Set(["assistant_step", "step_finish", "executor_statement", "executor_completion"]).has(kind)) {
    for (const field of ["session_id", "message_id"] as const) {
      if (!textValue(payload[field])) return { code: "EVIDENCE_SOURCE_ID_REQUIRED", message: `${kind} evidence requires ${field}` }
    }
  }

  const verifierKinds = new Set(["verifier_pass", "test_pass", "check_pass", "verifier_result", "verifier_failure", "test_failure", "check_failure"])
  if (verifierKinds.has(kind)) {
    if (payload.compiler_visible !== true || payload.predeclared !== true) {
      return { code: "EVIDENCE_VERIFIER_NOT_DECLARED", message: "verifier evidence must be predeclared and Compiler-visible" }
    }
    if (payload.exact_workspace_snapshot !== true || payload.complete !== true) {
      return { code: "EVIDENCE_SNAPSHOT_UNVERIFIED", message: "verifier evidence must be complete and tied to an exact workspace snapshot" }
    }
  }
  if (kind === "workspace_diff" || verifierKinds.has(kind)) {
    if (!textValue(payload.workspace_snapshot_id)) return { code: "EVIDENCE_WORKSPACE_SNAPSHOT_REQUIRED", message: `${kind} evidence requires workspace_snapshot_id` }
  }

  const parent = textValue(payload.causal_parent_id) as string
  const history = run.history()
  const replayed = run.replay()
  const committedInputIdentity = replayed.current.commit?.inputIdentity
  if (!committedInputIdentity) return { code: "EVIDENCE_COMMIT_REQUIRED", message: "execution evidence requires a committed preceding turn" }
  const currentState = objectValue(replayed.current.state)
  const selectedTaskId = textValue(currentState?.selected_task_id)
  if (!selectedTaskId) return { code: "EVIDENCE_TASK_REQUIRED", message: "execution evidence requires a currently selected task occurrence" }
  if (payload.task_id !== selectedTaskId) {
    return {
      code: "EVIDENCE_TASK_MISMATCH",
      message: "evidence task_id does not match the committed selected task",
    }
  }
  const latestInput = [...history].reverse().find((event) => {
    const data = objectValue((event as unknown as { data?: unknown }).data)
    return event.type === "input.admitted" && data?.inputIdentity === committedInputIdentity
  })
  const latestAttempt = [...history].reverse().find((event) => {
    const data = objectValue((event as unknown as { data?: unknown }).data)
    return event.type === "delivery.attempt" && data?.inputIdentity === committedInputIdentity
  })
  const latestAttemptId = latestAttempt === undefined ? undefined : textValue(objectValue((latestAttempt as unknown as { data?: unknown }).data)?.attemptId)
  if (!latestAttemptId || parent !== latestAttemptId) {
    return { code: "EVIDENCE_CAUSAL_PARENT_STALE", message: "evidence causal_parent_id must be the latest completed delivery attempt for the committed turn" }
  }
  const parentExists = history.some((event) => {
    const data = objectValue((event as unknown as { data?: unknown }).data)
    return event.type === "delivery.attempt" && event.eventId === latestAttempt?.eventId && data?.attemptId === parent
  })
  if (!parentExists) return { code: "EVIDENCE_CAUSAL_PARENT_MISSING", message: `causal parent ${parent} is not present in Compiler history` }

  const attemptData = objectValue((latestAttempt as unknown as { data?: unknown }).data)
  if (attemptData?.status !== "confirmed") {
    return {
      code: "EVIDENCE_DELIVERY_NOT_CONFIRMED",
      message: "execution evidence requires a confirmed delivery attempt",
    }
  }
  const attemptMilliseconds = Date.parse(latestAttempt?.timestamp ?? "")
  if (!Number.isFinite(attemptMilliseconds) || producedAtMilliseconds < attemptMilliseconds) {
    return {
      code: "EVIDENCE_BEFORE_DELIVERY",
      message: "evidence produced_at must not precede its confirmed delivery attempt",
    }
  }
  const latestReconciliation = [...history].reverse().find((event) => {
    const data = objectValue((event as unknown as { data?: unknown }).data)
    return event.type === "delivery.reconciliation" && data?.attemptId === parent
  })
  const reconciliationData = latestReconciliation === undefined
    ? undefined
    : objectValue((latestReconciliation as unknown as { data?: unknown }).data)
  if (reconciliationData?.terminal !== true || reconciliationData.status !== "complete") {
    return {
      code: "EVIDENCE_DELIVERY_NOT_RECONCILED",
      message: "execution evidence requires a terminal successful delivery reconciliation",
    }
  }

  const inputSource = latestInput === undefined
    ? undefined
    : objectValue((latestInput as unknown as { data?: unknown }).data)?.source
  const attemptMetadata = objectValue(attemptData?.metadata)
  const deliverySource = objectValue(attemptMetadata?.source)
  const sourceObject = deliverySource ?? objectValue(inputSource)
  if (sourceObject) {
    for (const field of [
      "run_id",
      "stage_id",
      "path_id",
      "round",
      "task_occurrence_id",
      "turn_id",
      "session_id",
      "message_id",
    ] as const) {
      if (sourceObject[field] !== undefined && payload[field] !== sourceObject[field]) {
        return { code: "EVIDENCE_SOURCE_MISMATCH", message: `evidence ${field} does not match the committed input source` }
      }
    }
    if (
      sourceObject.workspace_snapshot_id !== undefined &&
      payload.input_workspace_snapshot_id !== sourceObject.workspace_snapshot_id
    ) {
      return {
        code: "EVIDENCE_SOURCE_MISMATCH",
        message: "evidence input_workspace_snapshot_id does not match the delivered input source",
      }
    }
  }

  const boundaryAlreadyAdmitted = history.some((event) => {
    const data = objectValue((event as unknown as { data?: unknown }).data)
    return event.type === "input.admitted" && data?.inputIdentity === boundary
  })
  if (boundaryAlreadyAdmitted) return { code: "EVIDENCE_BOUNDARY_CLOSED", message: `input boundary ${boundary} has already been admitted` }
  const previousInputExists = history.some((event) => event.type === "input.admitted")
  if (!previousInputExists) return { code: "EVIDENCE_NO_PREVIOUS_INPUT", message: "execution evidence requires a preceding admitted input" }
  return undefined
}

function rejectEvidence(
  run: ReturnType<CompilerStore["openRun"]>,
  request: EvidenceRequest,
  code: string,
  message: string,
): EvidenceResult {
  try {
    const evidence = run.recordEvidenceDecision({
      evidenceId: request.evidence.evidenceId,
      payload: request.evidence.payload,
      digest: request.evidence.digest,
      boundaryInputIdentity: request.evidence.boundaryInputIdentity,
      decision: "rejected",
      reason: message,
    })
    return { ok: false, runId: request.runId, evidence, code, message }
  } catch (error: unknown) {
    return { ok: false, runId: request.runId, code: errorCode(error), message: errorMessage(error) }
  }
}

async function callModel(model: CompilerModel, input: CompilerModelInput, errors: readonly CompilerErrorDetail[] = []): Promise<CompilerModelResult> {
  try {
    return await model.propose(input, errors as readonly ProposalValidationError[])
  } catch (error: unknown) {
    return {
      ok: false,
      status: "rejected",
      error: {
        kind: "transport",
        code: "transport_failure",
        message: errorMessage(error),
        cause: error,
      },
    }
  }
}

function validateTextInput(input: CompilerInput): void {
  if (typeof input.raw !== "string") throw new IntentCompilerError("TEXT_INPUT_REQUIRED", "Compiler task input must be exact text")
  if (input.parts !== undefined) {
    if (!Array.isArray(input.parts) || input.parts.length === 0) throw new IntentCompilerError("TEXT_PARTS_INVALID", "registered Compiler input must contain text parts")
    for (const part of input.parts) {
      if (!part || typeof part !== "object" || (part as Record<string, unknown>).type !== "text" || typeof (part as Record<string, unknown>).text !== "string") {
        throw new InputContentError("Compiler accepts text-only task messages")
      }
    }
  }
}

function currentIntentState(current: ReturnType<ReturnType<CompilerStore["openRun"]>["replay"]>["current"]): IntentState {
  return current.state === undefined ? createInitialIntentState() : current.state as unknown as IntentState
}

function previousProjection(current: ReturnType<ReturnType<CompilerStore["openRun"]>["replay"]>["current"]): CompiledIntentProjection | undefined {
  if (!current.compiledIntent || !current.renderedText) return undefined
  const artifact = current.compiledIntent as unknown as CompiledIntentArtifact
  return {
    artifact,
    canonical_artifact: JSON.stringify(artifact),
    rendered_text: current.renderedText,
    artifact_digest: artifact.artifact_digest,
    rendered_digest: digestRenderedText(current.renderedText),
  }
}

function digestRenderedText(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex")
}

function successFromReplay(
  run: ReturnType<CompilerStore["openRun"]>,
  stateVersion: number,
  inputIdentity: string,
  inputDigest: string,
  status: "reused" | "noop",
  modelCalls: number,
  retried: boolean,
): PrepareTurnSuccess {
  const replay = run.replay(stateVersion)
  const current = replay.current
  if (!current.compiledIntent || !current.renderedText || !current.compiledIntentRef || !current.renderedTextRef || !current.commit) throw new IntentCompilerError("COMMITTED_ARTIFACT_MISSING", "committed turn has no complete Compiled Intent artifact")
  const artifact = current.compiledIntent as unknown as CompiledIntentArtifact
  return {
    ok: true,
    status,
    runId: current.runId,
    inputIdentity,
    inputDigest,
    stateVersion: current.version,
    artifactVersion: current.artifactVersion,
    artifact,
    canonicalArtifact: JSON.stringify(artifact),
    renderedText: current.renderedText,
    compiledIntentDigest: artifact.artifact_digest,
    renderedTextDigest: digestRenderedText(current.renderedText),
    commit: { ...current.commit, inputIdentity },
    modelCalls,
    retried,
  }
}

function savedProposal(value: unknown): ProposalEnvelope | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const wrapper = value as Record<string, unknown>
  const proposal = wrapper.proposal
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) return undefined
  return proposal as ProposalEnvelope
}

function latestProposalId(run: ReturnType<CompilerStore["openRun"]>, inputIdentity: string, preferred?: string): string {
  if (preferred) return preferred
  const record = [...run.history()].reverse().find((item) => item.type === "proposal.saved" && (item.data as Record<string, unknown>).inputIdentity === inputIdentity)
  const id = record ? (record.data as Record<string, unknown>).proposalId : undefined
  if (typeof id !== "string") throw new IntentCompilerError("PROPOSAL_NOT_PERSISTED", "model proposal was not persisted")
  return id
}

function admittedEvidence(decisions: readonly EvidenceDecision[]): AdmittedEvidence[] {
  return decisions.map((decision) => {
    const payload = decision.payload && typeof decision.payload === "object" && !Array.isArray(decision.payload)
      ? { ...(decision.payload as Record<string, unknown>) }
      : {}
    const kind = payload.kind
    if (typeof kind !== "string" || kind.length === 0) throw new IntentCompilerError("EVIDENCE_KIND_REQUIRED", `admitted evidence ${decision.evidenceId} has no declared kind`)
    return {
      ...(payload as Partial<AdmittedEvidence>),
      id: decision.evidenceId,
      digest: decision.digest,
      kind,
    }
  })
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function stateErrors(errors: readonly ValidationError[]): CompilerErrorDetail[] {
  return errors.map((error) => ({
    code: error.code,
    message: error.message,
    ...(error.operation_index === undefined ? {} : { operation_index: error.operation_index }),
    ...(error.field === undefined ? {} : { field: error.field }),
  }))
}

function modelErrors(error: { errors?: readonly ProposalValidationError[]; code: string; message: string }): CompilerErrorDetail[] {
  if (error.errors && error.errors.length > 0) return error.errors.map((item) => ({ code: item.code, message: item.message, ...(item.path === undefined ? {} : { path: item.path }), ...(item.operation_index === undefined ? {} : { operation_index: item.operation_index }), ...(item.field === undefined ? {} : { field: item.field }) }))
  return [{ code: error.code, message: error.message }]
}

function retryableModelError(error: { kind: string }): boolean {
  return error.kind === "json" || error.kind === "schema"
}

function serializableModelError(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") return { message: String(error) }
  const value = error as Record<string, unknown>
  return {
    kind: value.kind,
    code: value.code,
    message: value.message,
    ...(value.path === undefined ? {} : { path: value.path }),
    ...(value.errors === undefined ? {} : { errors: value.errors }),
  }
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string") return (error as { code: string }).code
  return "COMPILER_ERROR"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
