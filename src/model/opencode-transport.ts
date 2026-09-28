import { isAbsolute } from "node:path"
import { Ajv } from "ajv"
import type {
  CompilerModelRequest,
  CompilerModelTransport,
} from "./compiler-model.js"
import type {
  CompilerModelV2Call,
  CompilerModelV2CheckInput,
  CompilerModelV2FailureDiagnostic,
  CompilerModelV2Input,
} from "./compiler-model-v2.js"
import { buildStrictCandidateExample, buildStrictCandidateSchema } from "./candidate-schema-strict.js"
import { buildStrictCandidateCheckSchema } from "./candidate-check-schema-strict.js"

/**
 * The OpenCode surface used by this Adapter is intentionally narrow.  The
 * caller owns the directory isolation rule; this module only requires an
 * absolute directory and never receives an executor-workspace path to compare.
 */
export interface OpenCodeModelClient {
  readonly session?: {
    readonly create?: (request: {
      readonly query: { readonly directory: string }
      readonly body: { readonly title: string }
    }) => Promise<unknown>
    readonly prompt?: (request: {
      readonly path: { readonly id: string }
      readonly query: { readonly directory: string }
      readonly body: {
        readonly model: { readonly providerID: string; readonly modelID: string }
        readonly variant?: string
        readonly agent: string
        readonly system: string
        readonly tools: { readonly "*": false; readonly StructuredOutput?: true }
        readonly format?: {
          readonly type: "json_schema"
          readonly schema: unknown
          readonly retryCount?: number
        }
        readonly parts: readonly [{ readonly type: "text"; readonly text: string }]
      }
    }) => Promise<unknown>
  }
}

export interface OpenCodeModelTransportOptions {
  readonly client: OpenCodeModelClient
  readonly directory: string
  readonly providerId: string
  readonly modelId: string
  readonly variant?: string
  readonly agent?: string
  readonly onSessionCreated?: (sessionId: string) => void
}

export type OpenCodeModelTransportV2Options = OpenCodeModelTransportOptions
export type OpenCodeModelTransportV2 = (request: CompilerModelV2Input) => Promise<CompilerModelV2Call>
export type OpenCodeModelCheckTransportV2 = (request: CompilerModelV2CheckInput) => Promise<CompilerModelV2Call>

export type OpenCodeModelTransportErrorCode =
  | "INVALID_CLIENT"
  | "DIRECTORY_NOT_ABSOLUTE"
  | "PROVIDER_ID_REQUIRED"
  | "MODEL_ID_REQUIRED"
  | "AGENT_INVALID"
  | "VARIANT_INVALID"
  | "REQUEST_SERIALIZATION_FAILED"
  | "SDK_ERROR_RESPONSE"
  | "SESSION_CREATE_FAILED"
  | "SESSION_CREATE_SHAPE"
  | "SESSION_PROMPT_FAILED"
  | "SESSION_PROMPT_SHAPE"
  | "TOOL_PART_RETURNED"
  | "EMPTY_TEXT_RESPONSE"
  | "MODEL_ERROR_RESPONSE"
  | "EMPTY_STRUCTURED_RESPONSE"
  | "STRUCTURED_RESULT_INVALID"

export class OpenCodeModelTransportError extends Error {
  readonly code: OpenCodeModelTransportErrorCode
  readonly cause?: unknown
  readonly diagnostic?: CompilerModelV2FailureDiagnostic

  constructor(code: OpenCodeModelTransportErrorCode, message: string, cause?: unknown, diagnostic?: CompilerModelV2FailureDiagnostic) {
    super(message)
    this.name = "OpenCodeModelTransportError"
    this.code = code
    this.cause = cause
    this.diagnostic = diagnostic
  }
}

const MODEL_SYSTEM_PROMPT = [
  "You are the read-only model adapter for an Intent Compiler.",
  "Interpret only the supplied Compiler request and return exactly one JSON proposal envelope matching its response contract.",
  "Do not execute the task, inspect or modify the workspace, call tools, access Compiler state, write files, or produce a plan, replacement prompt, executor answer, or Compiled Intent.",
  "Use only the supplied user input and admitted evidence; preserve uncertainty and let deterministic code validate the proposal.",
].join(" ")

const MODEL_SYSTEM_PROMPT_V2 = [
  "You are the read-only management model for an Intent Compiler v2.",
  "Interpret the supplied v2 Compiler request and return exactly one JSON result matching the supplied JSON Schema through OpenCode's StructuredOutput response channel.",
  "OpenCode's internal StructuredOutput submission is allowed only to return the schema-constrained management result. All business tools remain disabled. Do not execute the task, inspect or modify the workspace, access Compiler state, write files, return business answers, or invent execution identities.",
  "If the request includes schema_rejected_draft, it is prior JSON rejected by the Candidate schema, not a valid Candidate or accepted work. Use it and validation_errors only as revision context; return one complete schema-valid Candidate while preserving the supplied input facts.",
  "Preserve the current delegation, material roles, output scope, and uncertainty; deterministic code validates references, versions, and authority.",
].join(" ")

export const CHECK_SYSTEM_PROMPT = [
  "You are the independent check of one Intent Compiler v2 management candidate.",
  "Return exactly one JSON object matching the supplied JSON Schema.",
  "Use OpenCode's internal StructuredOutput submission only for this check result; business tools remain disabled. Do not execute the task or perform business work.",
  "You may only report inconsistencies with the original input and the current IR.",
  "Do not supply the business answer, widen or narrow Authority, or rewrite the candidate.",
].join(" ")

/**
 * Create one OpenCode-backed CompilerModelTransport.  Each invocation creates
 * a fresh OpenCode session and returns only the response text assembled from
 * text parts; module 04 remains responsible for JSON and proposal validation.
 */
export function createOpenCodeModelTransport(options: OpenCodeModelTransportOptions): CompilerModelTransport {
  validateOptions(options)
  const agent = options.agent ?? "build"

  return async (request: Readonly<CompilerModelRequest>): Promise<string> => {
    let serializedRequest: string
    try {
      serializedRequest = stableJson(request)
    } catch (error: unknown) {
      throw new OpenCodeModelTransportError(
        "REQUEST_SERIALIZATION_FAILED",
        `Compiler request could not be serialized as stable JSON: ${errorMessage(error)}`,
        error,
      )
    }

    const created = await callSessionCreate(options.client, options.directory)
    const sessionId = sessionIdFromResponse(created)
    options.onSessionCreated?.(sessionId)
    const completed = await callSessionPrompt(options.client, {
      sessionId,
      directory: options.directory,
      providerId: options.providerId,
      modelId: options.modelId,
      ...(options.variant === undefined ? {} : { variant: options.variant }),
      agent,
      requestText: serializedRequest,
      system: MODEL_SYSTEM_PROMPT,
    })
    return textFromPromptResponse(completed)
  }
}

/**
 * OpenCode-backed v2 management transport. It creates a fresh isolated session
 * and returns only OpenCode's structured response; the v2 model module owns
 * Candidate parsing and schema validation.
 */
export function createOpenCodeModelTransportV2(
  options: OpenCodeModelTransportV2Options,
): OpenCodeModelTransportV2 {
  return createOpenCodeV2Transport(
    options,
    MODEL_SYSTEM_PROMPT_V2,
    buildStrictCandidateSchema("openai"),
    (request) => {
      if (!("example_candidate" in request.contract)) return request
      const proposalRequest = request as CompilerModelV2Input
      return {
        ...proposalRequest,
        contract: {
          ...proposalRequest.contract,
          example_candidate: JSON.stringify(buildStrictCandidateExample("openai"), null, 2),
        },
      }
    },
  )
}

/**
 * OpenCode-backed independent v2 candidate checker.  It uses its own prompt,
 * schema, and fresh session for each check invocation.
 */
export function createOpenCodeCheckTransportV2(
  options: OpenCodeModelTransportV2Options,
): OpenCodeModelCheckTransportV2 {
  return createOpenCodeV2Transport(options, CHECK_SYSTEM_PROMPT, buildStrictCandidateCheckSchema("openai"))
}

function createOpenCodeV2Transport(
  options: OpenCodeModelTransportV2Options,
  system: string,
  schema: unknown,
  prepareRequest: (request: CompilerModelV2Input | CompilerModelV2CheckInput) => CompilerModelV2Input | CompilerModelV2CheckInput = (request) => request,
): (request: CompilerModelV2Input | CompilerModelV2CheckInput) => Promise<CompilerModelV2Call> {
  validateOptions(options)
  const agent = options.agent ?? "build"

  return async (request: CompilerModelV2Input | CompilerModelV2CheckInput): Promise<CompilerModelV2Call> => {
    let serializedRequest: string
    try {
      serializedRequest = stableJson(prepareRequest(request))
    } catch (error: unknown) {
      throw new OpenCodeModelTransportError(
        "REQUEST_SERIALIZATION_FAILED",
        `Compiler request could not be serialized as stable JSON: ${errorMessage(error)}`,
        error,
      )
    }

    const created = await callSessionCreate(options.client, options.directory)
    const sessionId = sessionIdFromResponse(created)
    options.onSessionCreated?.(sessionId)
    const startedAt = new Date().toISOString()
    const completed = await callSessionPrompt(options.client, {
      sessionId,
      directory: options.directory,
      providerId: options.providerId,
      modelId: options.modelId,
      ...(options.variant === undefined ? {} : { variant: options.variant }),
      agent,
      requestText: serializedRequest,
      system,
      format: {
        type: "json_schema",
        schema,
        // Structured-output retries are a separate retry layer. Keep them
        // disabled so one management prompt cannot silently expand here.
        retryCount: 0,
      },
    })
    const call = v2CallFromPromptResponse(completed, startedAt, sessionId)
    // info.structured is a host container, not evidence of schema validation.
    // Keep raw output and usage, and report schema failures as candidate errors
    // rather than transport failures that could trigger a network retry.
    const validate = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true }).compile(schema as Record<string, unknown>)
    if (!validate(JSON.parse(call.text))) call.structured_schema_errors = (validate.errors ?? []).map(error =>
      `${error.instancePath || "/"}: ${error.message ?? "invalid"} ${JSON.stringify(error.params)}`)
    return call
  }
}

function validateOptions(options: OpenCodeModelTransportOptions): void {
  if (!isRecord(options) || !isRecord(options.client)) {
    throw new OpenCodeModelTransportError("INVALID_CLIENT", "OpenCode model transport requires a client object")
  }
  if (typeof options.client.session?.create !== "function" || typeof options.client.session?.prompt !== "function") {
    throw new OpenCodeModelTransportError("INVALID_CLIENT", "OpenCode model transport requires session.create and session.prompt")
  }
  if (typeof options.directory !== "string" || !isAbsolute(options.directory)) {
    throw new OpenCodeModelTransportError("DIRECTORY_NOT_ABSOLUTE", "OpenCode model transport directory must be absolute")
  }
  if (typeof options.providerId !== "string" || options.providerId.trim().length === 0) {
    throw new OpenCodeModelTransportError("PROVIDER_ID_REQUIRED", "OpenCode model transport providerId must be non-empty text")
  }
  if (typeof options.modelId !== "string" || options.modelId.trim().length === 0) {
    throw new OpenCodeModelTransportError("MODEL_ID_REQUIRED", "OpenCode model transport modelId must be non-empty text")
  }
  if (options.agent !== undefined && (typeof options.agent !== "string" || options.agent.trim().length === 0)) {
    throw new OpenCodeModelTransportError("AGENT_INVALID", "OpenCode model transport agent must be non-empty text when supplied")
  }
  if (options.variant !== undefined && (typeof options.variant !== "string" || options.variant.trim().length === 0)) {
    throw new OpenCodeModelTransportError("VARIANT_INVALID", "OpenCode model transport variant must be non-empty text when supplied")
  }
}

async function callSessionCreate(client: OpenCodeModelClient, directory: string): Promise<unknown> {
  let response: unknown
  try {
    response = await client.session!.create!({
      query: { directory },
      body: { title: "Intent Compiler" },
    })
  } catch (error: unknown) {
    throw new OpenCodeModelTransportError(
      "SESSION_CREATE_FAILED",
      `OpenCode session.create failed: ${errorMessage(error)}`,
      error,
    )
  }
  return unwrapSdkResponse(response, "session.create")
}

async function callSessionPrompt(
  client: OpenCodeModelClient,
  input: {
    readonly sessionId: string
    readonly directory: string
    readonly providerId: string
    readonly modelId: string
    readonly variant?: string
    readonly agent: string
    readonly requestText: string
    readonly system: string
    readonly format?: {
      readonly type: "json_schema"
      readonly schema: unknown
      readonly retryCount?: number
    }
  },
): Promise<unknown> {
  let response: unknown
  try {
    response = await client.session!.prompt!({
      path: { id: input.sessionId },
      query: { directory: input.directory },
      body: {
        model: { providerID: input.providerId, modelID: input.modelId },
        ...(input.variant === undefined ? {} : { variant: input.variant }),
        agent: input.agent,
        system: input.system,
        // OpenCode 1.18.31 converts this ordered map to permission rules. The
        // later exact allow overrides the preceding wildcard deny for its
        // internal structured-result tool; business tools stay denied.
        tools: input.format === undefined
          ? { "*": false }
          : { "*": false, StructuredOutput: true },
        ...(input.format === undefined ? {} : { format: input.format }),
        parts: [{ type: "text", text: input.requestText }],
      },
    })
  } catch (error: unknown) {
    throw new OpenCodeModelTransportError(
      "SESSION_PROMPT_FAILED",
      `OpenCode session.prompt failed: ${sanitizeProviderMessage(errorMessage(error))}`,
      error,
      {
        phase: "opencode_session_prompt",
        opencode_response: { session_id: input.sessionId },
      },
    )
  }
  try {
    return unwrapSdkResponse(response, "session.prompt")
  } catch (error: unknown) {
    const cause = error instanceof OpenCodeModelTransportError ? error.cause : error
    const code = error instanceof OpenCodeModelTransportError ? error.code : "SESSION_PROMPT_FAILED"
    const message = error instanceof OpenCodeModelTransportError ? error.message : errorMessage(error)
    const responseRecord = isRecord(response) ? response : undefined
    const sdkError = responseRecord?.error === undefined ? undefined : hostErrorDetails(responseRecord.error)
    throw new OpenCodeModelTransportError(
      code,
      `OpenCode session.prompt response could not be used: ${sanitizeProviderMessage(message)}`,
      cause,
      {
        phase: "opencode_session_prompt",
        response_received: true,
        opencode_response: {
          session_id: input.sessionId,
          ...(sdkError === undefined ? {} : { sdk_error: sdkError }),
        },
      },
    )
  }
}

type SdkOperation = "session.create" | "session.prompt"

function unwrapSdkResponse(value: unknown, operation: SdkOperation): Record<string, unknown> {
  let current = value
  for (let depth = 0; ; depth += 1) {
    if (!isRecord(current)) throw sdkShapeError(operation, "response must be an object")
    if (Object.prototype.hasOwnProperty.call(current, "error")) {
      throw new OpenCodeModelTransportError(
        "SDK_ERROR_RESPONSE",
        `OpenCode ${operation} returned an error response: ${errorMessage(current.error)}`,
        current.error,
      )
    }
    if (!Object.prototype.hasOwnProperty.call(current, "data")) return current
    if (depth >= 2 || !isRecord(current.data)) {
      throw sdkShapeError(operation, "response data must contain at most two object wrapper levels")
    }
    current = current.data
  }
}

function sdkShapeError(operation: SdkOperation, message: string): OpenCodeModelTransportError {
  const code = operation === "session.create" ? "SESSION_CREATE_SHAPE" : "SESSION_PROMPT_SHAPE"
  return new OpenCodeModelTransportError(code, `OpenCode ${operation} returned an invalid SDK shape: ${message}`)
}

function sessionIdFromResponse(value: unknown): string {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    throw new OpenCodeModelTransportError("SESSION_CREATE_SHAPE", "OpenCode session.create returned no session ID")
  }
  return value.id
}

function textFromPromptResponse(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.parts)) {
    throw new OpenCodeModelTransportError("SESSION_PROMPT_SHAPE", "OpenCode session.prompt returned no parts array")
  }

  const textParts: string[] = []
  for (let index = 0; index < value.parts.length; index += 1) {
    const part = value.parts[index]
    if (!isRecord(part) || typeof part.type !== "string") {
      throw new OpenCodeModelTransportError("SESSION_PROMPT_SHAPE", `OpenCode session.prompt returned an invalid part at index ${index}`)
    }
    if (part.type === "tool") {
      throw new OpenCodeModelTransportError("TOOL_PART_RETURNED", "OpenCode model transport rejected a tool part from the Compiler session")
    }
    if (part.type !== "text") continue
    if (typeof part.text !== "string") {
      throw new OpenCodeModelTransportError("SESSION_PROMPT_SHAPE", `OpenCode text part at index ${index} has no text`)
    }
    textParts.push(part.text)
  }

  const text = textParts.join("\n")
  if (textParts.length === 0 || text.trim().length === 0) {
    throw new OpenCodeModelTransportError("EMPTY_TEXT_RESPONSE", "OpenCode model transport returned no non-empty text")
  }
  return text
}

function v2CallFromPromptResponse(value: unknown, startedAt: string, sessionId: string): CompilerModelV2Call {
  const diagnostic = opencodeResponseDiagnostic(value, sessionId)
  if (!isRecord(value) || !Array.isArray(value.parts)) {
    throw new OpenCodeModelTransportError("SESSION_PROMPT_SHAPE", "OpenCode session.prompt returned no parts array", undefined, diagnostic)
  }
  const partTypes: string[] = []
  let structuredToolError: unknown
  for (let index = 0; index < value.parts.length; index += 1) {
    const part = value.parts[index]
    if (!isRecord(part) || typeof part.type !== "string") {
      throw new OpenCodeModelTransportError("SESSION_PROMPT_SHAPE", `OpenCode session.prompt returned an invalid part at index ${index}`, undefined, diagnostic)
    }
    partTypes.push(part.type)
    if (part.type === "tool" && part.tool !== "StructuredOutput") {
      const toolName = typeof part.tool === "string" ? part.tool : "<unknown>"
      throw new OpenCodeModelTransportError(
        "TOOL_PART_RETURNED",
        `OpenCode model transport rejected non-StructuredOutput tool part '${toolName}' from the Compiler session`,
        undefined,
        diagnostic,
      )
    }
    if (part.type === "tool" && part.tool === "StructuredOutput" && isRecord(part.state)
      && part.state.status === "error" && part.state.error !== undefined) {
      structuredToolError = part.state.error
    }
  }
  const info = isRecord(value.info) ? value.info : undefined
  const hostError = info?.error ?? structuredToolError
  if (hostError !== undefined && hostError !== null) {
    const details = hostErrorDetails(hostError)
    const cause = new Error(details.message)
    cause.name = details.name
    throw new OpenCodeModelTransportError(
      "MODEL_ERROR_RESPONSE",
      `OpenCode session.prompt returned ${details.name}: ${details.message}`,
      cause,
      diagnostic,
    )
  }
  if (info === undefined || !Object.prototype.hasOwnProperty.call(info, "structured") || info.structured === undefined) {
    throw new OpenCodeModelTransportError(
      "EMPTY_STRUCTURED_RESPONSE",
      `OpenCode model transport returned no structured result; text and reasoning parts are not candidates; part types: ${partTypes.join(", ") || "<none>"}`,
      undefined,
      diagnostic,
    )
  }
  let text: string
  try {
    text = stableJson(info.structured)
  } catch (error: unknown) {
    throw new OpenCodeModelTransportError(
      "STRUCTURED_RESULT_INVALID",
      `OpenCode structured result could not be serialized: ${errorMessage(error)}`,
      error,
      diagnostic,
    )
  }
  const time = isRecord(info?.time) ? info.time : undefined
  const usage = usageFromInfo(info)

  return {
    text,
    text_source: "structured",
    raw: value,
    ...(typeof info?.providerID === "string" ? { provider: info.providerID } : {}),
    ...(typeof info?.modelID === "string" ? { model: info.modelID } : {}),
    started_at: typeof time?.start === "string" ? time.start : typeof time?.created === "string" ? time.created : startedAt,
    completed_at: typeof time?.end === "string" ? time.end : typeof time?.completed === "string" ? time.completed : new Date().toISOString(),
    ...(usage === undefined ? {} : { usage }),
  }
}

function opencodeResponseDiagnostic(value: unknown, sessionId: string): CompilerModelV2FailureDiagnostic {
  const response = isRecord(value) ? value : undefined
  const info = isRecord(response?.info) ? response.info : undefined
  const time = isRecord(info?.time) ? info.time : undefined
  const parts = Array.isArray(response?.parts) ? response.parts : undefined
  const toolStatuses = parts?.flatMap((part) => {
    if (!isRecord(part) || part.type !== "tool") return []
    const state = isRecord(part.state) ? part.state : undefined
    const error = state?.error === undefined ? undefined : hostErrorDetails(state.error)
    return [{
      tool: typeof part.tool === "string" ? part.tool : "<unknown>",
      ...(typeof part.callID === "string" ? { call_id: part.callID } : {}),
      status: typeof state?.status === "string" ? state.status : "unknown",
      ...(error === undefined ? {} : { error }),
    }]
  })
  const usage = usageFromInfo(info)
  const infoError = info?.error === undefined || info.error === null ? undefined : hostErrorDetails(info.error)
  const completedAt = time?.completed ?? time?.end
  return {
    phase: "opencode_session_prompt",
    response_received: true,
    opencode_response: {
      session_id: sessionId,
      ...(typeof info?.id === "string" ? { message_id: info.id } : {}),
      ...(infoError === undefined ? {} : { info_error: infoError }),
      ...(typeof info?.finish === "string" ? { finish_reason: info.finish } : {}),
      ...(typeof completedAt === "string" || typeof completedAt === "number" ? { completed_at: completedAt } : {}),
      ...(info === undefined ? {} : {
        structured_result_present: Object.prototype.hasOwnProperty.call(info, "structured")
          && info.structured !== undefined
          && info.structured !== null,
      }),
      ...(toolStatuses === undefined ? {} : { tool_statuses: toolStatuses }),
      ...(typeof info?.providerID === "string" ? { provider: info.providerID } : {}),
      ...(typeof info?.modelID === "string" ? { model: info.modelID } : {}),
      ...(usage === undefined ? {} : { usage }),
    },
  }
}

function usageFromInfo(info: Record<string, any> | undefined): CompilerModelV2Call["usage"] | undefined {
  const tokens = isRecord(info?.tokens) ? info.tokens : undefined
  const usage: NonNullable<CompilerModelV2Call["usage"]> = {}
  if (finiteNumber(tokens?.input)) usage.input_tokens = tokens.input as number
  if (finiteNumber(tokens?.output)) usage.output_tokens = tokens.output as number
  if (finiteNumber(tokens?.reasoning)) usage.reasoning_tokens = tokens.reasoning as number
  if (isRecord(tokens?.cache)) {
    if (finiteNumber(tokens.cache.read)) usage.cache_read_tokens = tokens.cache.read as number
    if (finiteNumber(tokens.cache.write)) usage.cache_write_tokens = tokens.cache.write as number
  }
  if (finiteNumber(info?.cost)) usage.cost = info.cost as number
  return Object.keys(usage).length === 0 ? undefined : usage
}

function hostErrorDetails(value: unknown): { name: string; message: string } {
  if (typeof value === "string") return { name: "OpenCodeError", message: sanitizeProviderMessage(value) }
  if (isRecord(value)) {
    const data = isRecord(value.data) ? value.data : undefined
    const name = sanitizeProviderMessage(typeof value.name === "string" && value.name.length > 0 ? value.name : "OpenCodeError")
    const message = typeof value.message === "string" ? value.message
      : typeof data?.message === "string" ? data.message
        : `OpenCode returned ${name}`
    return { name, message: sanitizeProviderMessage(message) }
  }
  return { name: "OpenCodeError", message: sanitizeProviderMessage(errorMessage(value)) }
}

function sanitizeProviderMessage(message: string): string {
  return message
    .replace(/(Bearer\s+)[^\s"']+/giu, "$1[redacted]")
    .replace(/\b(?:sk|ds)-[A-Za-z0-9_-]{12,}\b/gu, "[redacted]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization)\s*[:=]\s*)(?:Bearer\s+)?(?:["']?)[^"'&\s,}]+/giu, "$1[redacted]")
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|key)=)[^&\s]+/giu, "$1[redacted]")
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function stableJson(value: unknown): string {
  const encoded = JSON.stringify(sortValue(value))
  if (encoded === undefined) throw new Error("value is not JSON-serializable")
  return encoded
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item))
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  )
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return "unknown error"
  }
}
