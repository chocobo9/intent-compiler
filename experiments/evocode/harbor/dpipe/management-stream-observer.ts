import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

type Event = { type: string; id?: string; name?: string; text?: string; reason?: unknown }
type Options = {
  path?: string
  sessionID: string
  messageID: string
  enabled: boolean
  intervalMs?: number
  sampleBytes?: number
}

let sequence = 0

/** Run-local diagnostic only: no prompt, tool input or stream event is modified. */
export function createManagementStreamObserver(options: Options) {
  const noop = { observe(_event: Event) {}, close(_outcome: string) {} }
  if (!options.enabled || !options.path) return noop
  const path = options.path
  try { mkdirSync(dirname(path), { recursive: true }) } catch { return noop }
  const start = Date.now()
  const streamID = `${process.pid}-${start}-${++sequence}`
  const sampleLimit = Math.max(0, Math.min(options.sampleBytes ?? 4096, 16384))
  const tools = new Map<string, { deltas: number; bytes: number; first: number | null; last: number | null; ended: boolean }>()
  let events = 0
  let lastEvent = start
  let lastDelta: number | undefined
  let deltas = 0
  let bytes = 0
  let sampled = 0
  let textBytes = 0
  let reasoningBytes = 0
  let finishReason: string | undefined
  let closed = false
  let disabled = false
  const emit = (kind: string, detail: Record<string, unknown> = {}) => {
    if (disabled) return
    const now = Date.now()
    const row = { tag: "dpipe-management-stream-v1", kind, at: new Date(now).toISOString(),
      stream_id: streamID, session_id: options.sessionID, message_id: options.messageID,
      elapsed_ms: now - start, events, idle_event_ms: now - lastEvent,
      parameter_deltas: deltas, parameter_bytes: bytes, sampled_parameter_bytes: sampled,
      idle_parameter_ms: lastDelta === undefined ? null : now - lastDelta,
      text_bytes: textBytes, reasoning_bytes: reasoningBytes, ...detail }
    // Diagnostics must not terminate or retry generation on an I/O failure.
    try { appendFileSync(path, JSON.stringify(row) + "\n", "utf8") } catch { disabled = true }
  }
  emit("stream-start")
  const timer = setInterval(() => emit("heartbeat"), Math.max(10, options.intervalMs ?? 5000))
  timer.unref()
  return {
    observe(event: Event) {
      if (closed || disabled) return
      events++
      lastEvent = Date.now()
      if (event.type === "text-delta") textBytes += Buffer.byteLength(event.text ?? "", "utf8")
      if (event.type === "reasoning-delta") reasoningBytes += Buffer.byteLength(event.text ?? "", "utf8")
      if (event.type === "step-finish") {
        finishReason = typeof event.reason === "string" ? event.reason.slice(0, 80) : "unspecified"
        emit("step-finish", { finish_reason: finishReason })
      }
      if (event.type === "finish") emit("provider-finish", { finish_reason: finishReason ?? null })
      if (event.name !== "StructuredOutput" || !event.id) return
      const state = tools.get(event.id) ?? { deltas: 0, bytes: 0, first: null, last: null, ended: false }
      tools.set(event.id, state)
      if (event.type === "tool-input-start") emit("tool-input-start", { tool_id: event.id })
      if (event.type === "tool-input-delta") {
        const raw = Buffer.from(event.text ?? "", "utf8")
        state.deltas++
        state.bytes += raw.length
        state.first ??= lastEvent
        state.last = lastEvent
        lastDelta = lastEvent
        deltas++
        bytes += raw.length
        if (sampled < sampleLimit && raw.length) {
          const sample = raw.subarray(0, sampleLimit - sampled)
          sampled += sample.length
          // Base64 preserves a fragment cut inside a UTF-8 codepoint exactly.
          emit("parameter-sample", { tool_id: event.id, sample_bytes: sample.length,
            sample_base64: sample.toString("base64"), sample_encoding: "utf8-base64" })
        }
      }
      if (event.type === "tool-input-end" || event.type === "tool-call" || event.type === "tool-result") {
        if (event.type === "tool-input-end") state.ended = true
        emit(event.type, { tool_id: event.id, tool_deltas: state.deltas, tool_bytes: state.bytes,
          first_parameter_at_ms: state.first, last_parameter_at_ms: state.last, input_ended: state.ended })
      }
    },
    close(outcome: string) {
      if (closed) return
      closed = true
      clearInterval(timer)
      emit("stream-close", { outcome, finish_reason: finishReason ?? null,
        tools: [...tools].map(([id, state]) => ({ id, ...state })) })
    },
  }
}
