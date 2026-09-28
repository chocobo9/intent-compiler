import type {
  CompilerModelV2Call,
  CompilerModelV2CheckInput,
  CompilerModelV2FailureDiagnostic,
  CompilerModelV2Input,
} from "./compiler-model-v2.js"
import { CANDIDATE_JSON_SCHEMA } from "./candidate-schema.js"
import { canonicalJson } from "../core/intent-contract.js"
import { MANAGEMENT_SYSTEM_PROMPT } from "./management-instructions.js"

export interface StructuredProviderTransportOptions {
  endpoint?: string
  providerId?: string
  modelId: string
  apiKey?: string
  /** Provider-side strict mode.  Some providers require a strict-compatible
   *  schema when true; false requests valid-JSON-only enforcement. */
  strict?: boolean
  /** Schema sent to the provider.  Strict mode typically needs the strict
   *  variant from candidate-schema-strict. */
  schema?: unknown
  /** Extra body fields, e.g. {"enable_thinking": false} for Qwen. */
  bodyExtras?: Record<string, unknown>
  /** Assemble the answer from a server-sent-event stream.  A provider that
   *  thinks for minutes before answering sends no response headers on the
   *  non-streaming path, which trips the runtime's own header timeout (Node's
   *  fetch gives up after 300s); streamed chunks start arriving immediately. */
  stream?: boolean
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number
  /** System prompt for this transport; the check transport uses its own. */
  systemPrompt?: string
  agent?: string
  fetch?: typeof fetch
}

export class StructuredProviderTransportError extends Error {
  readonly code: string
  readonly status?: number
  readonly cause?: unknown
  readonly diagnostic: CompilerModelV2FailureDiagnostic

  constructor(code: string, message: string, status?: number, cause?: unknown, diagnostic?: CompilerModelV2FailureDiagnostic) {
    super(message)
    this.name = "StructuredProviderTransportError"
    this.code = code
    this.status = status
    this.cause = cause
    this.diagnostic = diagnostic ?? {
      phase: "provider_transport",
      response_received: status !== undefined,
      ...(status === undefined ? {} : { http_status: status }),
      ...(cause === undefined ? {} : { exception_chain: exceptionChain(cause) }),
    }
  }
}

const SYSTEM_PROMPT = [
  MANAGEMENT_SYSTEM_PROMPT,
  "Return exactly one Candidate as a JSON text response matching the supplied JSON Schema.",
].join(" ")

export function createStructuredProviderTransport<Request extends CompilerModelV2Input | CompilerModelV2CheckInput = CompilerModelV2Input>(
  options: StructuredProviderTransportOptions,
): (request: Request) => Promise<CompilerModelV2Call> {
  const endpoint = options.endpoint ?? "https://api.deepseek.com/chat/completions"
  const providerId = options.providerId ?? "deepseek"
  const modelId = options.modelId
  const fetchImpl = options.fetch ?? fetch
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY
  const strict = options.strict ?? true
  const stream = options.stream ?? false
  const timeoutMs = options.timeoutMs ?? 240_000

  return async (request: Request): Promise<CompilerModelV2Call> => {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new StructuredProviderTransportError("API_KEY_REQUIRED", "DEEPSEEK_API_KEY is required for the structured management transport", undefined, undefined, { phase: "configuration", response_received: false })
    }
    const startedAt = new Date().toISOString()
    let response: Response
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(stream ? { Accept: "text/event-stream" } : {}),
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: "system", content: options.systemPrompt ?? SYSTEM_PROMPT },
            { role: "user", content: canonicalJson(request) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "candidate_v2",
              strict,
              schema: options.schema ?? CANDIDATE_JSON_SCHEMA,
            },
          },
          ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
          ...(options.bodyExtras ?? {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new StructuredProviderTransportError("FETCH_FAILED", `structured provider request failed: ${errorMessage(error)}`, undefined, error, {
        phase: "request",
        response_received: false,
        exception_chain: exceptionChain(error),
      })
    }
    if (stream && response.ok) {
      let assembled: Awaited<ReturnType<typeof collectEventStream>>
      try {
        assembled = await collectEventStream(response)
      } catch (error) {
        if (error instanceof StructuredProviderTransportError) throw error
        throw new StructuredProviderTransportError("STREAM_FAILED", `structured provider response stream failed: ${errorMessage(error)}`, response.status, error, {
          phase: "response_stream",
          response_received: true,
          http_status: response.status,
          exception_chain: exceptionChain(error),
        })
      }
      const content = assembled.content.trim().length > 0 ? assembled.content : assembled.reasoning
      if (content.trim().length === 0) {
        throw new StructuredProviderTransportError("EMPTY_RESPONSE", "structured provider stream returned no content", response.status, undefined, {
          phase: "empty_response",
          response_received: true,
          stream_started: assembled.stream_started,
          stream_completed: assembled.stream_completed,
          stream_eof_observed: assembled.stream_eof_observed,
          ...(assembled.stream_first_data_ms === undefined ? {} : { stream_first_data_ms: assembled.stream_first_data_ms }),
          ...(assembled.stream_last_progress_ms === undefined ? {} : { stream_last_progress_ms: assembled.stream_last_progress_ms }),
          stream_content_chars: assembled.content.length,
          stream_reasoning_chars: assembled.reasoning.length,
          completion_marker_seen: assembled.completion_marker_seen,
          http_status: response.status,
        })
      }
      return {
        text: content,
        text_source: assembled.content.trim().length > 0 ? "text" : "reasoning",
        provider: providerId,
        model: modelId,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        ...(assembled.usage === undefined ? {} : { usage: usageOf(assembled.usage) }),
        raw: {
          streamed: true,
          content_chars: assembled.content.length,
          reasoning_chars: assembled.reasoning.length,
          stream_completed: assembled.stream_completed,
          stream_eof_observed: assembled.stream_eof_observed,
          stream_first_data_ms: assembled.stream_first_data_ms,
          stream_last_progress_ms: assembled.stream_last_progress_ms,
          completion_marker_seen: assembled.completion_marker_seen,
        },
      }
    }
    let payload: Record<string, any> | Array<Record<string, any>>
    try {
      payload = await response.json() as Record<string, any> | Array<Record<string, any>>
    } catch (error) {
      if (!response.ok) {
        throw new StructuredProviderTransportError("PROVIDER_ERROR", `structured provider returned HTTP ${response.status}`, response.status, error, {
          phase: "provider_response",
          response_received: true,
          http_status: response.status,
          exception_chain: exceptionChain(error),
        })
      }
      throw new StructuredProviderTransportError("RESPONSE_PARSE_FAILED", `structured provider response JSON could not be parsed: ${errorMessage(error)}`, response.status, error, {
        phase: "response_json_parse",
        response_received: true,
        http_status: response.status,
        exception_chain: exceptionChain(error),
      })
    }
    if (!response.ok) {
      const errorInfo = Array.isArray(payload)
        ? payload.find((item) => isRecord(item) && isRecord(item.error))?.error
        : payload.error
      const message = (errorInfo as Record<string, any> | undefined)?.message ?? `structured provider returned HTTP ${response.status}`
      const code = /response_format|not supported|unavailable/iu.test(String(message))
        ? "STRUCTURED_UNSUPPORTED"
        : "PROVIDER_ERROR"
      throw new StructuredProviderTransportError(
        code,
        message,
        response.status,
        payload,
        { phase: "provider_response", response_received: true, http_status: response.status },
      )
    }
    const body = Array.isArray(payload) ? (payload[0] ?? {}) : payload
    const choice = Array.isArray(body.choices) ? body.choices[0] : undefined
    const content = typeof choice?.message?.content === "string"
      ? choice.message.content
      : typeof choice?.message?.reasoning_content === "string"
        ? choice.message.reasoning_content
        : ""
    if (content.trim().length === 0) {
      throw new StructuredProviderTransportError("EMPTY_RESPONSE", "structured provider returned no content", response.status, undefined, {
        phase: "empty_response",
        response_received: true,
        http_status: response.status,
      })
    }
    const usage = isRecord(body.usage) ? body.usage : undefined
    return {
      text: content,
      text_source: typeof choice?.message?.content === "string" ? "text" : "reasoning",
      provider: providerId,
      model: modelId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      ...(usage === undefined ? {} : { usage: usageOf(usage) }),
      raw: body,
    }
  }
}

function usageOf(usage: Record<string, any>): NonNullable<CompilerModelV2Call["usage"]> {
  return {
    ...(finiteNumber(usage.prompt_tokens) ? { input_tokens: usage.prompt_tokens } : {}),
    ...(finiteNumber(usage.completion_tokens) ? { output_tokens: usage.completion_tokens } : {}),
    ...(finiteNumber(usage.completion_tokens_details?.reasoning_tokens) ? { reasoning_tokens: usage.completion_tokens_details.reasoning_tokens } : {}),
    ...(finiteNumber(usage.prompt_tokens_details?.cached_tokens) ? { cache_read_tokens: usage.prompt_tokens_details.cached_tokens } : {}),
  }
}

/**
 * Assemble an OpenAI-compatible SSE stream: the answer arrives as
 * `data: {...}` lines carrying delta.content (and delta.reasoning_content for
 * thinking models), ending with `data: [DONE]`.  Usage arrives on the chunk
 * that `stream_options.include_usage` asks for, i.e. after the last delta.
 */
async function collectEventStream(response: Response): Promise<{
  content: string
  reasoning: string
  usage?: Record<string, any>
  stream_started: boolean
  stream_completed: boolean
  stream_eof_observed: boolean
  stream_first_data_ms?: number
  stream_last_progress_ms?: number
  completion_marker_seen: boolean
}> {
  const body = response.body
  if (body === null) {
    throw new StructuredProviderTransportError("EMPTY_RESPONSE", "structured provider returned an empty stream body", response.status, undefined, {
      phase: "empty_response",
      response_received: true,
      stream_started: false,
      stream_completed: false,
      stream_eof_observed: false,
      stream_content_chars: 0,
      stream_reasoning_chars: 0,
      completion_marker_seen: false,
      http_status: response.status,
    })
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const readStartedAt = performance.now()
  let buffer = ""
  let content = ""
  let reasoning = ""
  let usage: Record<string, any> | undefined
  let completionMarkerSeen = false
  let streamCompleted = false
  let streamEofObserved = false
  let streamStarted = false
  let firstDataMs: number | undefined
  let lastProgressMs: number | undefined
  const elapsedMs = (): number => Math.max(0, Math.round(performance.now() - readStartedAt))
  const markValidData = (): void => {
    firstDataMs ??= elapsedMs()
  }
  const diagnostic = (phase: string, cause?: unknown): CompilerModelV2FailureDiagnostic => ({
    phase,
    response_received: true,
    stream_started: streamStarted,
    stream_completed: streamCompleted,
    stream_eof_observed: streamEofObserved,
    ...(firstDataMs === undefined ? {} : { stream_first_data_ms: firstDataMs }),
    ...(lastProgressMs === undefined ? {} : { stream_last_progress_ms: lastProgressMs }),
    stream_content_chars: content.length,
    stream_reasoning_chars: reasoning.length,
    completion_marker_seen: completionMarkerSeen,
    http_status: response.status,
    ...(cause === undefined ? {} : { exception_chain: exceptionChain(cause) }),
  })
  const consumeLine = (line: string): boolean => {
    const trimmed = line.trim()
    if (!trimmed.startsWith("data:")) return false
    const payload = trimmed.slice(5).trim()
    if (payload.length === 0) return false
    if (payload === "[DONE]") {
      markValidData()
      completionMarkerSeen = true
      streamCompleted = true
      return true
    }
    let chunk: unknown
    try {
      chunk = JSON.parse(payload)
    } catch (error) {
      throw new StructuredProviderTransportError(
        "STREAM_PARSE_FAILED",
        `structured provider stream contained invalid JSON: ${errorMessage(error)}`,
        response.status,
        error,
        diagnostic("stream_json_parse", error),
      )
    }
    markValidData()
    if (!isRecord(chunk)) return false
    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined
    const delta = isRecord(choice) && isRecord(choice.delta) ? choice.delta : undefined
    if (typeof delta?.content === "string") content += delta.content
    if (typeof delta?.reasoning_content === "string") reasoning += delta.reasoning_content
    if (isRecord(chunk.usage)) usage = chunk.usage
    return false
  }
  try {
    for (;;) {
      let part: ReadableStreamReadResult<Uint8Array>
      try {
        part = await reader.read()
      } catch (error) {
        throw new StructuredProviderTransportError(
          "STREAM_FAILED",
          `structured provider response stream failed: ${errorMessage(error)}`,
          response.status,
          error,
          diagnostic("response_stream", error),
        )
      }
      const { value, done } = part
      if (done) {
        streamEofObserved = true
        streamCompleted = true
        buffer += decoder.decode()
        if (buffer.length > 0) consumeLine(buffer)
        break
      }
      if (value.byteLength > 0) {
        streamStarted = true
        lastProgressMs = elapsedMs()
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      let completionSeen = false
      for (const line of lines) {
        if (consumeLine(line)) {
          completionSeen = true
          break
        }
      }
      if (completionSeen) {
        // [DONE] is the provider's protocol completion signal. Do not wait for a
        // server-side connection close that may never arrive after the answer.
        void reader.cancel().catch(() => undefined)
        break
      }
    }
  } catch (error) {
    if (error instanceof StructuredProviderTransportError) throw error
    throw new StructuredProviderTransportError(
      "STREAM_FAILED",
      `structured provider response stream failed: ${errorMessage(error)}`,
      response.status,
      error,
      diagnostic("response_stream", error),
    )
  } finally {
    reader.releaseLock()
  }
  return {
    content,
    reasoning,
    ...(usage === undefined ? {} : { usage }),
    stream_started: streamStarted,
    stream_completed: streamCompleted,
    stream_eof_observed: streamEofObserved,
    ...(firstDataMs === undefined ? {} : { stream_first_data_ms: firstDataMs }),
    ...(lastProgressMs === undefined ? {} : { stream_last_progress_ms: lastProgressMs }),
    completion_marker_seen: completionMarkerSeen,
  }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function exceptionChain(error: unknown): NonNullable<CompilerModelV2FailureDiagnostic["exception_chain"]> {
  const result: NonNullable<CompilerModelV2FailureDiagnostic["exception_chain"]> = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== undefined && current !== null && !seen.has(current) && result.length < 8) {
    seen.add(current)
    if (current instanceof Error) {
      result.push({ name: current.name || "Error", message: redactSecrets(current.message) })
      current = current.cause
    } else {
      result.push({ name: typeof current === "object" && "name" in current ? String((current as { name: unknown }).name) : typeof current, message: redactSecrets(String(current)) })
      current = typeof current === "object" && current !== null && "cause" in current ? (current as { cause?: unknown }).cause : undefined
    }
  }
  return result
}

function redactSecrets(message: string): string {
  return message.replace(/(Bearer\s+)[^\s"']+/giu, "$1[redacted]")
}
