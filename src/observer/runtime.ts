import { EventStore, RunStore } from "./event-store.js"
import { SessionRegistry } from "./registry.js"
import { sha256, stableJson } from "./codec.js"
import { projectRun, renderReport } from "./projector.js"
import type {
  ChatMessageInput,
  ChatMessageOutput,
  ErrorValue,
  ModelRequestInput,
  ModelRequestOutput,
  ObserverClient,
  ObserverEventEnvelope,
  ObserverPart,
  PendingDelivery,
  Registration,
  SdkMessage,
  SdkMessageInfo,
  TextPart,
  ToolAfterOutput,
  ToolBeforeOutput,
  ToolHookInput,
} from "./types.js"

export class ObserverRuntime {
  readonly client: ObserverClient
  readonly registry: SessionRegistry
  readonly events: EventStore
  readonly reconciliations: Map<string, Promise<boolean>>

  constructor({
    storeDir,
    client,
    env = process.env,
    clock,
    monotonic,
  }: {
    storeDir: string
    client: ObserverClient
    env?: NodeJS.ProcessEnv
    clock?: () => string
    monotonic?: () => bigint
  }) {
    this.client = client
    this.registry = new SessionRegistry(storeDir, env)
    this.events = new EventStore(storeDir, clock, monotonic)
    this.reconciliations = new Map()
  }

  captureRawInput(input: ChatMessageInput, output: ChatMessageOutput): boolean {
    const context = this.context(input.sessionID, true)
    if (!context) return false
    const { run } = context
    const { messageId, textParts } = requireTextInput(input, output, run)

    const rawArtifact = run.saveArtifact(output.parts, {
      artifactType: "user_input_parts",
      mediaType: "application/json",
    })
    const rawText = joinText(textParts)
    run.append({
      component: "input",
      event_type: "user_input.observed",
      status: "observed",
      message_id: messageId,
      artifact_refs: [rawArtifact],
      data: { digest: `sha256:${sha256(rawText)}`, text_part_count: textParts.length },
    })
    return true
  }

  expectDelivery(input: ChatMessageInput, output: ChatMessageOutput): boolean {
    const context = this.context(input.sessionID)
    if (!context) return false
    const { registration, run } = context
    const { messageId } = requireTextInput(input, output, run)

    const expectedParts = output.parts
      .filter((part) => part.type === "text")
      .map((part) => ({ id: part.id as string, text: part.text as string }))
    const expectedArtifact = run.saveArtifact(expectedParts, {
      artifactType: "executor_message_expected_parts",
      mediaType: "application/json",
    })
    run.writePending(messageId, {
      schema_version: "0.1",
      message_id: messageId,
      session_id: input.sessionID,
      turn_id: registration.turn_id,
      expected_parts: expectedParts,
      expected_digest: `sha256:${sha256(stableJson(expectedParts))}`,
      expected_artifact: expectedArtifact,
      observed_parts: {},
    })
    run.append({
      component: "delivery",
      event_type: "executor_message.readback_expected",
      status: "pending",
      message_id: messageId,
      artifact_refs: [expectedArtifact],
      data: { digest: `sha256:${sha256(stableJson(expectedParts))}` },
    })
    return true
  }

  async observeInput(input: ChatMessageInput, output: ChatMessageOutput): Promise<boolean> {
    if (!this.captureRawInput(input, output)) return false
    return this.expectDelivery(input, output)
  }

  observeEvent(event: ObserverEventEnvelope): boolean {
    const properties = event.properties ?? {}
    const sessionId = eventSessionId(event)
    if (!sessionId) return false
    const context = this.context(sessionId)
    if (!context) return false
    const { run } = context

    if (event.type === "message.part.updated") {
      this.observePart(run, properties.part as ObserverPart)
    } else if (event.type === "message.updated") {
      this.observeMessage(run, properties.info as SdkMessageInfo)
    } else if (event.type === "session.status") {
      const status = (properties.status as Record<string, any> | undefined)?.type ?? "unknown"
      run.append({
        component: "executor",
        event_type: `session.${status}`,
        status,
        data: { native_status: properties.status },
      })
    } else if (event.type === "session.idle") {
      run.append({ component: "executor", event_type: "session.idle", status: "idle" })
      this.scheduleReconciliation(sessionId)
    } else if (event.type === "session.error") {
      run.append({
        component: "executor",
        event_type: "session.error",
        status: "failed",
        error: normalizeError(properties.error),
      })
      this.project(run)
    } else if (event.type === "session.compacted") {
      run.append({ component: "executor", event_type: "session.compacted", status: "completed" })
    } else if (event.type === "session.diff") {
      const artifact = run.saveArtifact(properties.diff ?? [], {
        artifactType: "workspace_diff",
        mediaType: "application/json",
      })
      run.append({
        component: "workspace",
        event_type: "workspace.diff",
        status: "observed",
        artifact_refs: [artifact],
      })
    } else if (event.type?.startsWith("permission.")) {
      const artifact = run.saveArtifact(properties, {
        artifactType: "permission_event",
        mediaType: "application/json",
      })
      run.append({
        component: "tool",
        event_type: event.type,
        status: properties.response ?? "observed",
        call_id: properties.callID,
        artifact_refs: [artifact],
      })
    }
    return true
  }

  toolBefore(input: ToolHookInput, output: ToolBeforeOutput): boolean {
    const context = this.context(input.sessionID)
    if (!context) return false
    const artifact = context.run.saveArtifact(output.args ?? {}, {
      artifactType: "tool_arguments",
      mediaType: "application/json",
    })
    context.run.append({
      component: "tool",
      event_type: "tool.started",
      status: "started",
      call_id: input.callID,
      artifact_refs: [artifact],
      data: { tool: input.tool },
    })
    return true
  }

  modelRequested(input: ModelRequestInput, output: ModelRequestOutput): boolean {
    const context = this.context(input.sessionID)
    if (!context) return false
    context.run.append({
      component: "executor",
      event_type: "model.requested",
      status: "requested",
      message_id: input.message?.id,
      data: {
        role: "executor",
        agent: input.agent,
        model: input.model?.id ?? input.model?.modelID,
        provider: input.model?.providerID,
        parameters: {
          temperature: output.temperature,
          top_p: output.topP,
          top_k: output.topK,
          max_output_tokens: output.maxOutputTokens,
        },
      },
    })
    return true
  }

  toolAfter(input: ToolHookInput, output: ToolAfterOutput): boolean {
    const context = this.context(input.sessionID)
    if (!context) return false
    const artifact = context.run.saveArtifact(
      { title: output.title, output: output.output, metadata: output.metadata },
      { artifactType: "tool_result", mediaType: "application/json" },
    )
    context.run.append({
      component: "tool",
      event_type: "tool.completed",
      status: "completed",
      call_id: input.callID,
      artifact_refs: [artifact],
      data: { tool: input.tool, source: "tool.execute.after" },
    })
    return true
  }

  async reconcileSession(sessionId: string): Promise<boolean> {
    const context = this.context(sessionId)
    if (!context) return false
    const { run } = context
    if (!this.client?.session?.messages) {
      run.append({
        component: "observer",
        event_type: "reconciliation.failed",
        status: "failed",
        error: { type: "MissingClientMethod", message: "client.session.messages is unavailable" },
      })
      this.project(run)
      return false
    }
    try {
      const response = await this.client.session.messages({ path: { id: sessionId } })
      const messages = normalizeSdkData(response)
      const artifact = run.saveArtifact(messages, {
        artifactType: "session_messages_readback",
        mediaType: "application/json",
      })
      const deliveryMatches = this.observeSdkDeliveryReadback(run, messages, sessionId)
      for (const message of messages) {
        for (const part of message.parts ?? []) this.observePart(run, part)
        this.observeMessage(run, message.info)
      }
      if (!deliveryMatches) {
        run.append({
          component: "observer",
          event_type: "reconciliation.failed",
          status: "failed",
          artifact_refs: [artifact],
          error: { type: "SdkReadbackMismatch", message: "one or more expected target messages failed SDK readback" },
        })
        this.project(run)
        return false
      }
      run.append({
        component: "observer",
        event_type: "reconciliation.completed",
        status: "completed",
        artifact_refs: [artifact],
        data: { message_count: messages.length },
      })
      run.append({ component: "run", event_type: "turn.completed", status: "completed" })
      this.project(run)
      return true
    } catch (error: unknown) {
      run.append({
        component: "observer",
        event_type: "reconciliation.failed",
        status: "failed",
        error: normalizeError(error),
      })
      this.project(run)
      return false
    }
  }

  scheduleReconciliation(sessionId: string): Promise<boolean> {
    if (this.reconciliations.has(sessionId)) return this.reconciliations.get(sessionId) as Promise<boolean>
    const promise = this.reconcileSession(sessionId).finally(() => this.reconciliations.delete(sessionId))
    this.reconciliations.set(sessionId, promise)
    return promise
  }

  context(sessionId: string, allowAutoRegistration = false): { registration: Registration; run: RunStore } | undefined {
    const registration = allowAutoRegistration
      ? this.registry.resolve(sessionId)
      : this.registry.resolveExisting(sessionId)
    if (!registration) return undefined
    return { registration, run: this.events.openRun(registration) }
  }

  observePart(run: RunStore, part: ObserverPart): void {
    if (!part || typeof part !== "object") return
    if (part.type === "text") this.observePersistedText(run, part)
    if (part.type === "tool") this.observeToolPart(run, part)
    if (part.type === "step-finish") {
      run.append({
        component: "executor",
        event_type: "llm.step.finished",
        status: "completed",
        message_id: part.messageID,
        metrics: { tokens: part.tokens, cost: numericOrUnavailable(part.cost) },
        data: { reason: part.reason, snapshot: part.snapshot },
      })
    }
    if (part.type === "retry") {
      run.append({
        component: "executor",
        event_type: "model.retried",
        status: "retry",
        message_id: part.messageID,
        error: normalizeError(part.error),
        data: { attempt: part.attempt },
      })
    }
  }

  observePersistedText(run: RunStore, part: ObserverPart): void {
    const messageId = part.messageID as string
    const partId = part.id as string
    const pendingValue = run.readPending(messageId)
    if (!pendingValue || typeof pendingValue !== "object") return
    const pending = pendingValue as PendingDelivery
    if (pending.part_update_resolved ?? pending.resolved) return
    pending.observed_parts[partId] = part.text as string
    const complete = pending.expected_parts.every((item) => Object.hasOwn(pending.observed_parts, item.id))
    if (!complete) {
      run.writePending(messageId, pending)
      return
    }
    const observedParts = pending.expected_parts.map((item) => ({ id: item.id, text: pending.observed_parts[item.id] }))
    const observedArtifact = run.saveArtifact(observedParts, {
      artifactType: "executor_message_persisted_parts",
      mediaType: "application/json",
    })
    const observedDigest = `sha256:${sha256(stableJson(observedParts))}`
    const matches = observedDigest === pending.expected_digest
    pending.part_update_resolved = true
    pending.part_update_digest = observedDigest
    pending.part_update_matches_expected = matches
    run.writePending(messageId, pending)
    run.append({
      component: "delivery",
      event_type: matches ? "executor_message.part_update_observed" : "executor_message.part_update_rejected",
      status: matches ? "observed" : "failed",
      message_id: messageId,
      artifact_refs: [pending.expected_artifact, observedArtifact],
      data: {
        source: "message.part.updated",
        digest: observedDigest,
        expected_digest: pending.expected_digest,
        matches_expected: matches,
      },
      ...(matches
        ? {}
        : { error: { type: "PartUpdateMismatch", message: "observed text-part update differs from expected text" } }),
    })
    this.project(run)
  }

  observeSdkDeliveryReadback(run: RunStore, messages: SdkMessage[], sessionId: string): boolean {
    const expectedMessageIds = run
      .readEvents()
      .filter(
        (event) =>
          event.event_type === "executor_message.readback_expected" &&
          event.session_id === sessionId &&
          typeof event.message_id === "string",
      )
      .map((event) => event.message_id as string)
    let allMatch = true

    for (const messageId of new Set(expectedMessageIds)) {
      const pendingValue = run.readPending(messageId)
      if (!pendingValue || typeof pendingValue !== "object") continue
      const pending = pendingValue as PendingDelivery
      if (pending.sdk_readback_status) {
        if (pending.sdk_readback_status !== "confirmed") allMatch = false
        continue
      }

      const message = messages.find((candidate) => candidate.info?.id === messageId)
      const actualParts = (message?.parts ?? [])
        .filter((part) => part.type === "text")
        .map((part) => ({ id: part.id as string, text: part.text as string }))
      const actualArtifact = run.saveArtifact(actualParts, {
        artifactType: "executor_message_sdk_readback_parts",
        mediaType: "application/json",
      })
      const actualDigest = `sha256:${sha256(stableJson(actualParts))}`
      const matches = Boolean(message) && actualDigest === pending.expected_digest

      pending.sdk_readback_status = matches ? "confirmed" : "rejected"
      pending.sdk_readback_digest = actualDigest
      run.writePending(messageId, pending)
      run.append({
        component: "delivery",
        event_type: matches ? "executor_message.sdk_readback_confirmed" : "executor_message.sdk_readback_rejected",
        status: matches ? "confirmed" : "failed",
        message_id: messageId,
        artifact_refs: [pending.expected_artifact, actualArtifact],
        data: {
          source: "client.session.messages",
          target_present: Boolean(message),
          digest: actualDigest,
          expected_digest: pending.expected_digest,
          matches_expected: matches,
        },
        ...(matches
          ? {}
          : {
              error: {
                type: message ? "SdkReadbackMismatch" : "SdkTargetMissing",
                message: message
                  ? "SDK target-message text parts differ from expected delivery"
                  : "SDK readback did not contain the expected target message",
              },
            }),
      })
      if (!matches) allMatch = false
    }
    return allMatch
  }

  observeToolPart(run: RunStore, part: ObserverPart): void {
    const state = part.state ?? {}
    if (state.status !== "completed" && state.status !== "error") return
    const artifact = run.saveArtifact(state, { artifactType: "tool_part", mediaType: "application/json" })
    run.append({
      component: "tool",
      event_type: state.status === "completed" ? "tool.completed" : "tool.error",
      status: state.status,
      message_id: part.messageID,
      call_id: part.callID,
      artifact_refs: [artifact],
      metrics: { duration_ms: durationMs(state.time) },
      data: { tool: part.tool, source: "persisted_tool_part" },
      ...(state.status === "error" ? { error: { type: "ToolError", message: state.error } } : {}),
    })
  }

  observeMessage(run: RunStore, info?: SdkMessageInfo): void {
    if (!info || info.role !== "assistant" || !info.time?.completed) return
    const marker = `model-completed-${info.id}`
    const pending = run.readPending(marker) as Record<string, any> | undefined
    if (pending?.resolved) return
    const artifact = run.saveArtifact(info, { artifactType: "assistant_message", mediaType: "application/json" })
    run.append({
      component: "executor",
      event_type: info.error ? "model.failed" : "model.completed",
      status: info.error ? "failed" : "completed",
      message_id: info.id,
      artifact_refs: [artifact],
      metrics: {
        tokens: info.tokens,
        cost: numericOrUnavailable(info.cost),
        cost_kind: costKind(info.cost),
        duration_ms: durationMs(info.time),
      },
      data: { role: "executor", model: info.modelID, provider: info.providerID, finish: info.finish },
      ...(info.error ? { error: normalizeError(info.error) } : {}),
    })
    run.writePending(marker, { resolved: true })
  }

  project(run: RunStore): ReturnType<typeof projectRun> {
    const events = run.readEvents()
    const summary = projectRun(events, run.manifest)
    run.writeProjection(summary, renderReport(summary, events))
    return summary
  }
}

function eventSessionId(event: ObserverEventEnvelope): string | undefined {
  const properties = event.properties ?? {}
  return (
    properties.sessionID ??
    (properties.info as Record<string, any> | undefined)?.sessionID ??
    (properties.part as Record<string, any> | undefined)?.sessionID
  )
}

function requireTextInput(
  input: ChatMessageInput,
  output: ChatMessageOutput,
  run: RunStore,
): { messageId: string; textParts: TextPart[] } {
  const messageId = input.messageID ?? output.message?.id
  if (!messageId) {
    run.append({
      component: "observer",
      event_type: "executor_message.rejected",
      status: "failed",
      error: { type: "MissingIdentity", message: "chat.message supplied no message ID" },
    })
    throw new Error("Experiment observer requires a message ID")
  }

  const textParts = output.parts.filter((part) => part.type === "text") as TextPart[]
  if (textParts.length === 0) {
    run.append({
      component: "observer",
      event_type: "executor_message.rejected",
      status: "failed",
      message_id: messageId,
      error: { type: "UnsupportedInput", message: "registered experiment message contains no text part" },
    })
    throw new Error("Experiment observer requires at least one text part")
  }
  return { messageId, textParts }
}

function joinText(parts: TextPart[]): string {
  return parts.map((part) => part.text).join("\n")
}

function durationMs(time: Record<string, any> | undefined): number | "unavailable" {
  const start = time?.start ?? time?.created
  const end = time?.end ?? time?.completed
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "unavailable"
  return end - start
}

function numericOrUnavailable(value: unknown): number | "unavailable" {
  return Number.isFinite(value) ? (value as number) : "unavailable"
}

function costKind(value: unknown): string {
  if (!Number.isFinite(value)) return "unavailable"
  return value === 0 ? "computed_zero" : "computed"
}

function normalizeError(error: unknown): ErrorValue {
  if (!error) return { type: "UnknownError", message: "unknown error" }
  if (error instanceof Error) return { type: error.name, message: error.message }
  if (typeof error === "string") return { type: "Error", message: error }
  const record = error as Record<string, any>
  return {
    type: record.name ?? record._tag ?? "Error",
    message: record.message ?? record.data?.message ?? JSON.stringify(error),
  }
}

function normalizeSdkData(response: unknown): SdkMessage[] {
  if (Array.isArray(response)) return response as SdkMessage[]
  if (response && typeof response === "object" && Array.isArray((response as Record<string, any>).data)) {
    return (response as Record<string, any>).data as SdkMessage[]
  }
  const nested = response && typeof response === "object" ? (response as Record<string, any>).data : undefined
  if (nested && typeof nested === "object" && Array.isArray(nested.data)) return nested.data as SdkMessage[]
  throw new Error("unexpected client.session.messages response shape")
}
