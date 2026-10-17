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
import { MANAGEMENT_SYSTEM_PROMPT } from "./management-instructions.js"
import { buildGenerationSchema, generationContract, generationStageInstruction, hasActiveExecution, type GenerationSchemaOptions } from "./generation-schema.js"

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
      readonly signal?: AbortSignal
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
    readonly abort?: (request: {
      readonly path: { readonly id: string }
      readonly query: { readonly directory: string }
      readonly signal?: AbortSignal
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
  /** Total time for one v2 management prompt, including a continuously flowing response. */
  readonly timeoutMs?: number
  /** v6 M1: enumerate in the schema the source, segment and item ids each request lists (SDD management only). */
  readonly narrowIds?: boolean
}

export type OpenCodeModelTransportV2Options = OpenCodeModelTransportOptions
export type OpenCodeModelTransportV2 = (request: CompilerModelV2Input, generation?: Pick<GenerationSchemaOptions, "checkRequired">) => Promise<CompilerModelV2Call>
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
  | "SESSION_PROMPT_TIMEOUT"
  | "TIMEOUT_INVALID"

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
  MANAGEMENT_SYSTEM_PROMPT,
  "Interpret the supplied v2 Compiler request and return exactly one JSON result matching the supplied JSON Schema through OpenCode's StructuredOutput response channel.",
  "OpenCode's internal StructuredOutput submission is allowed only to return the schema-constrained management result. All business tools remain disabled. Do not execute the task, inspect or modify the workspace, access Compiler state, write files, return business answers, or invent execution identities.",
].join(" ")

export const CHECK_SYSTEM_PROMPT = [
  "You are the independent check of one Intent Compiler v2 management candidate.",
  "Return exactly one JSON object matching the supplied JSON Schema.",
  "Use OpenCode's internal StructuredOutput submission only for this check result; business tools remain disabled. Do not execute the task or perform business work.",
  "You may only report inconsistencies with the original input and the current IR.",
  "Compare the entire delegation with prepared.ir and the whole prepared.compiled plan, including waiting and retained Atoms and Relations; ir and compiled hold the pre-candidate state only of what the candidate changed. Use prepared.atom_states and historical_atoms to distinguish history; the dispatchable subset alone is not the plan.",
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
  const legacy = createOpenCodeStructuredTransport<CompilerModelV2Input | CompilerModelV2CheckInput>(
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
  return async (request, generation = {}) => {
    const stage = "generation_stage" in request ? request.generation_stage : undefined
    if (stage !== "ir" && stage !== "ci") return legacy(request)
    const assessing = stage === "ci" && "assessment_batch" in request && request.assessment_batch === true
    const active = stage === "ci" && !assessing && hasActiveExecution(request)
    const transport = createOpenCodeStructuredTransport<CompilerModelV2Input | CompilerModelV2CheckInput>(
      options,
      `${generationStageInstruction(stage, assessing, generation.checkRequired, active)} Return this result through OpenCode's StructuredOutput response channel; that internal submission is the only allowed tool.`,
      // M1 (v6): with narrowIds, source and segment ids are the ones this request lists.
      options.narrowIds ? narrowEnums(buildGenerationSchema(stage, "openai", { ...generation, assessment: assessing, activeExecutions: active }), requestIds(request))
        : buildGenerationSchema(stage, "openai", { ...generation, assessment: assessing, activeExecutions: active }),
      () => ({ ...request, contract: generationContract(request.contract, stage, "openai", assessing, generation.checkRequired, active) }),
    )
    return transport(request)
  }
}

/**
 * OpenCode-backed independent v2 candidate checker.  It uses its own prompt,
 * schema, and fresh session for each check invocation.
 */
export function createOpenCodeCheckTransportV2(
  options: OpenCodeModelTransportV2Options,
): OpenCodeModelCheckTransportV2 {
  return createOpenCodeStructuredTransport<CompilerModelV2Input | CompilerModelV2CheckInput>(options, CHECK_SYSTEM_PROMPT, buildStrictCandidateCheckSchema("openai"))
}

export function createOpenCodeStructuredTransport<Request>(
  options: OpenCodeModelTransportV2Options,
  system: string,
  schema: unknown,
  prepareRequest: (request: Request) => Request = (request) => request,
): (request: Request) => Promise<CompilerModelV2Call> {
  validateOptions(options)
  const agent = options.agent ?? "build"

  return async (request: Request): Promise<CompilerModelV2Call> => {
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

    const native = nativeStructuredSchema(schema)
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
      timeoutMs: options.timeoutMs ?? 300_000,
      format: {
        type: "json_schema",
        schema: native.schema,
        // Structured-output retries are a separate retry layer. Keep them
        // disabled so one management prompt cannot silently expand here.
        retryCount: 0,
      },
    })
    const call = v2CallFromPromptResponse(completed, startedAt, sessionId)
    // The answer in the native form goes back to the canonical one before anything reads it.
    call.text = canonicalStructuredText(schema, native.wrapped, call.text)
    // info.structured is a host container, not evidence of schema validation.
    // Keep raw output and usage, and report schema failures as candidate errors
    // rather than transport failures that could trigger a network retry.
    const validate = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true }).compile(schema as Record<string, unknown>)
    if (!validate(JSON.parse(call.text))) call.structured_schema_errors = (validate.errors ?? []).map(error =>
      `${error.instancePath || "/"}: ${error.message ?? "invalid"} ${JSON.stringify(error.params)}`)
    return call
  }
}

type Schema = Record<string, unknown>

/** OpenAI strict output's documented ceiling on enum values in one schema; above it a field stays a free string. */
export const STRICT_ENUM_LIMIT = 1000

/**
 * The ids a request lists, by the property names answers use for them: source_id and segment_id from
 * the inputs and segments it shows, item_id (and an entry's items) from the content items of its IR.
 */
export function requestIds(request: unknown): Record<string, string[]> {
  const sources = new Set<string>(), segments = new Set<string>(), items = new Set<string>(), tasks = new Set<string>()
  const walk = (v: unknown, key = ""): void => {
    if (Array.isArray(v)) { v.forEach(x => walk(x, key)); return }
    if (!isRecord(v)) return
    if (typeof v.source_id === "string") sources.add(v.source_id)
    if (typeof v.event_id === "string" && (key === "inputs" || key === "events" || key === "source_events")) sources.add(v.event_id)
    if (typeof v.segment_id === "string") segments.add(v.segment_id)
    for (const k of ["from", "to"]) if (typeof v[k] === "string" && /^s\d+$/u.test(v[k] as string)) segments.add(v[k] as string)
    if ((key === "content" || key === "requirements") && typeof v.item_id === "string") items.add(v.item_id)
    if (Array.isArray(v.content) && typeof v.task_id === "string") tasks.add(v.task_id)
    for (const [k, x] of Object.entries(v)) walk(x, k)
  }
  walk(request)
  // A run of segments ("from" s3 "to" s7) lists every segment between.
  const numbers = [...segments].map(x => Number(x.slice(1))).filter(Number.isFinite)
  const max = numbers.length ? Math.max(...numbers) : 0
  const allSegments = Array.from({ length: max }, (_, i) => `s${i + 1}`)
  return { source_id: [...sources].sort(), segment_id: allSegments, item_id: [...items].sort(), task_id: [...tasks].sort() }
}

/**
 * The schema with an enum on every string property named in values (and on the string items of an
 * `items` array, when item ids are given). Nothing changes when a list is empty or the schema's enum
 * values would pass STRICT_ENUM_LIMIT; the canonical validation then keeps checking the values.
 */
export function narrowEnums(schema: unknown, values: Record<string, string[]>): Schema {
  const out = structuredClone(schema) as Schema
  let total = 0
  const count = (node: unknown): void => { if (Array.isArray(node)) node.forEach(count); else if (isRecord(node)) { if (Array.isArray(node.enum)) total += node.enum.length; Object.values(node).forEach(count) } }
  count(out)
  // Schemas share node objects (one {type: "string"} for every text field): a narrowed field gets a new node, never a mutated one.
  const isString = (n: unknown) => isRecord(n) && n.type === "string" && !n.enum
  const narrowed = (prop: Schema, list: string[], asItems: boolean): Schema | undefined => {
    if (asItems) return prop.type === "array" && isString(prop.items) ? { ...prop, items: { ...(prop.items as Schema), enum: list } } : undefined
    if (isString(prop)) return { ...prop, enum: list }
    if (Array.isArray(prop.anyOf) && prop.anyOf.some(isString)) return { ...prop, anyOf: prop.anyOf.map(b => isString(b) ? { ...(b as Schema), enum: list } : b) }
    return undefined
  }
  const pending: Array<{ properties: Schema; name: string; value: Schema; size: number }> = []
  const seen = new Set<unknown>()
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (!isRecord(node) || seen.has(node)) return
    seen.add(node)
    if (isRecord(node.properties)) {
      for (const [name, prop] of Object.entries(node.properties)) {
        const list = values[name === "items" ? "item_id" : name]
        if (!list?.length || !isRecord(prop)) continue
        const value = narrowed(prop, list, name === "items")
        if (value) pending.push({ properties: node.properties as Schema, name, value, size: list.length })
      }
    }
    Object.values(node).forEach(walk)
  }
  walk(out)
  // Every narrowed field carries its own copy of the list; past the ceiling nothing is narrowed.
  if (total + pending.reduce((n, p) => n + p.size, 0) > STRICT_ENUM_LIMIT) return out
  for (const { properties, name, value } of pending) properties[name] = value
  return out
}

/**
 * The schema as OpenAI strict structured output accepts it, with the same
 * answers valid: a non-object root is wrapped as {response}; every object
 * lists all its properties as required and closes additional properties, an
 * optional property becoming nullable (null means absent); an unsatisfiable
 * integer range (an empty handle domain) becomes the single value -1, which
 * the canonical schema never accepts. Local validation keeps the canonical schema.
 */
export function nativeStructuredSchema(schema: unknown): { schema: unknown; wrapped: boolean } {
  if (!isRecord(schema)) return { schema, wrapped: false }
  const nullable = (node: unknown): unknown => {
    if (!isRecord(node)) return node
    if (node.type === "null" || (Array.isArray(node.type) && node.type.includes("null"))) return node
    if (Array.isArray(node.anyOf) && node.anyOf.some(x => isRecord(x) && x.type === "null")) return node
    return { anyOf: [{ type: "null" }, node] }
  }
  const project = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(project)
    if (!isRecord(node)) return node
    const out: Schema = {}
    for (const [key, value] of Object.entries(node)) {
      // A keyword strict output does not support is left to the canonical validation.
      if (!STRICT_KEYWORDS.has(key)) continue
      if (key === "properties" || key === "definitions" || key === "$defs") out[key] = isRecord(value) ? Object.fromEntries(Object.entries(value).map(([name, v]) => [name, project(v)])) : value
      else out[key] = key === "enum" || key === "required" || key === "const" ? value : project(value)
    }
    if (isRecord(out.properties)) {
      const required = new Set(Array.isArray(node.required) ? node.required as string[] : [])
      const properties = Object.fromEntries(Object.entries(out.properties).map(([name, v]) => [name, required.has(name) ? v : nullable(v)]))
      out.properties = properties
      out.required = Object.keys(properties)
      if (out.additionalProperties === undefined) out.additionalProperties = false
    }
    if (out.type === "integer" && typeof out.minimum === "number" && typeof out.maximum === "number" && out.maximum < out.minimum) return { type: "integer", enum: [-1] }
    return out
  }
  const projected = project(schema) as Schema
  if (projected.type === "object") return { schema: projected, wrapped: false }
  const { definitions, $defs, $schema: _, ...response } = projected
  return { schema: { type: "object", properties: { response }, required: ["response"], additionalProperties: false,
    ...(definitions === undefined ? {} : { definitions }), ...($defs === undefined ? {} : { $defs }) }, wrapped: true }
}

/** The answer in the canonical form: unwrapped from {response}, and a null given for an optional property removed. */
export function canonicalStructuredText(schema: unknown, wrapped: boolean, text: string): string {
  let value: unknown
  try { value = JSON.parse(text) } catch { return text }
  if (wrapped) {
    if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, "response")) {
      throw new OpenCodeModelTransportError("STRUCTURED_RESULT_INVALID", "Structured result lacks the native response wrapper")
    }
    value = value.response
  }
  return stableJson(dropOptionalNulls(schema as Schema, schema, value))
}

function resolveRef(root: unknown, node: unknown): unknown {
  if (!isRecord(node) || typeof node.$ref !== "string" || !node.$ref.startsWith("#/")) return node
  return node.$ref.slice(2).split("/").reduce<unknown>((at, key) => isRecord(at) ? at[key] : undefined, root)
}

function allowsNull(root: unknown, node: unknown): boolean {
  const n = resolveRef(root, node)
  if (!isRecord(n)) return true
  if (n.type === "null" || (Array.isArray(n.type) && n.type.includes("null"))) return true
  return Array.isArray(n.anyOf) && n.anyOf.some(x => allowsNull(root, x))
}

function dropOptionalNulls(root: Schema, node: unknown, value: unknown): unknown {
  const schema = resolveRef(root, node)
  if (!isRecord(schema)) return value
  if (Array.isArray(value)) return isRecord(schema.items) || isRecord(resolveRef(root, schema.items)) ? value.map(v => dropOptionalNulls(root, schema.items, v)) : value
  if (!isRecord(value)) return value
  if (Array.isArray(schema.anyOf)) {
    // The one object branch whose properties hold every key given.
    const branches = schema.anyOf.map(x => resolveRef(root, x)).filter((x): x is Schema => isRecord(x) && isRecord(x.properties) && Object.keys(value).every(k => k in (x.properties as Schema)))
    return branches.length === 1 ? dropOptionalNulls(root, branches[0], value) : value
  }
  if (!isRecord(schema.properties)) return value
  const properties = schema.properties as Schema
  const required = new Set(Array.isArray(schema.required) ? schema.required as string[] : [])
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    if (v === null && key in properties && !required.has(key) && !allowsNull(root, properties[key])) continue
    out[key] = key in properties ? dropOptionalNulls(root, properties[key], v) : v
  }
  return out
}

const STRICT_KEYWORDS = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "const", "anyOf", "$ref", "$defs", "definitions", "description", "title",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "pattern", "format", "minItems", "maxItems", "$schema"])

/**
 * Where a schema breaks OpenAI strict structured output: a non-object root,
 * an object without every property required or with open additional
 * properties, an unsupported keyword, an empty integer range. Offline check
 * only; the host is the authority.
 */
export function strictSchemaProblems(schema: unknown): string[] {
  const problems: string[] = []
  if (!isRecord(schema) || schema.type !== "object") problems.push("/: root is not an object")
  const walk = (node: unknown, path: string, depth: number) => {
    if (Array.isArray(node)) { node.forEach((x, i) => walk(x, `${path}/${i}`, depth)); return }
    if (!isRecord(node)) return
    for (const key of Object.keys(node)) if (!STRICT_KEYWORDS.has(key)) problems.push(`${path}: keyword ${key} is not supported`)
    if (isRecord(node.properties)) {
      const keys = Object.keys(node.properties)
      const required = Array.isArray(node.required) ? node.required as string[] : []
      const missing = keys.filter(k => !required.includes(k))
      if (missing.length) problems.push(`${path}: properties not required: ${missing.join(", ")}`)
      if (node.additionalProperties !== false) problems.push(`${path}: additionalProperties is not false`)
      for (const [k, v] of Object.entries(node.properties)) walk(v, `${path}/properties/${k}`, depth + 1)
    } else if (node.type === "object" && node.additionalProperties !== false) problems.push(`${path}: object without properties`)
    if (node.type === "integer" && typeof node.minimum === "number" && typeof node.maximum === "number" && node.maximum < node.minimum) problems.push(`${path}: empty integer range`)
    for (const key of ["items", "anyOf"]) if (node[key] !== undefined) walk(node[key], `${path}/${key}`, depth + (key === "items" ? 1 : 0))
    for (const key of ["definitions", "$defs"]) if (isRecord(node[key])) for (const [k, v] of Object.entries(node[key] as Schema)) walk(v, `${path}/${key}/${k}`, depth)
    if (depth > 10) problems.push(`${path}: nested deeper than 10`)
  }
  walk(schema, "", 0)
  return problems
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
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 2_147_483_647)) {
    throw new OpenCodeModelTransportError("TIMEOUT_INVALID", "OpenCode management timeoutMs must be a positive timer-safe integer")
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
    readonly timeoutMs?: number
    readonly format?: {
      readonly type: "json_schema"
      readonly schema: unknown
      readonly retryCount?: number
    }
  },
): Promise<unknown> {
  let response: unknown
  try {
    const promptRequest = {
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
    } satisfies Parameters<NonNullable<NonNullable<OpenCodeModelClient["session"]>["prompt"]>>[0]
    response = input.timeoutMs === undefined
      ? await client.session!.prompt!(promptRequest)
      : await promptWithDeadline(client, promptRequest, input.timeoutMs)
  } catch (error: unknown) {
    if (error instanceof OpenCodeModelTransportError) throw error
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

/** A timeout must stop the host generation, not merely stop awaiting its HTTP response. */
async function promptWithDeadline(
  client: OpenCodeModelClient,
  request: Parameters<NonNullable<NonNullable<OpenCodeModelClient["session"]>["prompt"]>>[0],
  timeoutMs: number,
): Promise<unknown> {
  const promptAbort = new AbortController()
  const expired = Symbol("management deadline")
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const response = await Promise.race([
      client.session!.prompt!({ ...request, signal: promptAbort.signal }),
      new Promise<typeof expired>(resolve => { timer = setTimeout(() => resolve(expired), timeoutMs) }),
    ])
    if (response !== expired) return response

    let confirmed = false
    const cancelAbort = new AbortController()
    let cancelTimer: ReturnType<typeof setTimeout> | undefined
    try {
      if (client.session?.abort) {
        const cancelled = await Promise.race([
          client.session.abort({ path: request.path, query: request.query, signal: cancelAbort.signal }),
          new Promise<undefined>(resolve => { cancelTimer = setTimeout(() => resolve(undefined), 10_000) }),
        ])
        // OpenCode acknowledges only after cancelling the named session.
        confirmed = cancelled === true || (isRecord(cancelled) && !cancelled.error && cancelled.data === true)
      }
    } catch { /* Unknown cancellation status must prevent another generation. */ }
    finally {
      if (cancelTimer !== undefined) clearTimeout(cancelTimer)
      cancelAbort.abort()
      promptAbort.abort()
    }
    throw new OpenCodeModelTransportError(
      "SESSION_PROMPT_TIMEOUT",
      `OpenCode management prompt exceeded ${timeoutMs}ms; session cancellation ${confirmed ? "confirmed" : "unconfirmed; automatic retry blocked"}`,
      undefined,
      { phase: "opencode_session_prompt_timeout", request_timeout_ms: timeoutMs,
        cancellation_confirmed: confirmed, retryable: confirmed,
        opencode_response: { session_id: request.path.id } },
    )
  } finally {
    if (timer !== undefined) clearTimeout(timer)
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
