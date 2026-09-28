import { PROPOSAL_OPERATION_NAMES, PROPOSAL_LOCAL_REFERENCE_RESERVED_PATTERN } from "../core/intent-state.js"
import type { ProposalEnvelope, ProposalOperation } from "../core/intent-state.js"

/** The state module owns the version; this adapter only echoes it. */
export type CompilerStateVersion = ProposalEnvelope["base_state_version"]

/**
 * Input identity is deliberately opaque here.  The caller owns the identity
 * schema (run, task, turn, session and message identifiers where applicable),
 * while this module only requires it to be echoed exactly by the model.
 */
export type CompilerInputIdentity = ProposalEnvelope["input_identity"]

export interface CompilerTaskContentPart {
  readonly type: string
  readonly text?: string
  readonly [key: string]: unknown
}

export interface CompilerModelInput {
  readonly base_state_version: CompilerStateVersion
  readonly current_state: unknown
  readonly input_identity: CompilerInputIdentity
  readonly input_digest: string
  readonly input_text: string
  /**
   * The registered task message parts.  Omitting this field is allowed for
   * callers that have already reduced a message to its text-only form.  When
   * supplied, every part is checked before the transport is called.
   */
  readonly input_parts?: readonly CompilerTaskContentPart[]
  readonly admitted_evidence: readonly unknown[]
  readonly evidence_digest?: string
}

export interface ProposalValidationError {
  readonly code: string
  readonly message: string
  readonly path?: string
  readonly operation_index?: number
  readonly field?: string
}

export interface CompilerModelRequest {
  readonly schema_version: "0.1"
  readonly base_state_version: CompilerStateVersion
  readonly current_state: unknown
  readonly input_identity: CompilerInputIdentity
  readonly input_digest: string
  readonly input_text: string
  readonly input_parts?: readonly CompilerTaskContentPart[]
  readonly input_source: Readonly<{
    readonly kind: "user_input"
    readonly start: 0
    readonly end: number
  }>
  readonly admitted_evidence: readonly unknown[]
  readonly evidence_digest?: string
  readonly allowed_operations: readonly string[]
  readonly operation_contract: Readonly<Record<string, unknown>>
  readonly response_contract: Readonly<Record<string, unknown>>
  /** Empty tools and an explicit no-tool choice are part of the request contract. */
  readonly tools: readonly []
  readonly tool_choice: "none"
  /** Present only for the one validation-error retry chosen by module 05. */
  readonly validation_errors?: readonly ProposalValidationError[]
}

export type CompilerModelTransport = (
  request: Readonly<CompilerModelRequest>,
) => Promise<unknown> | unknown

export type CompilerModelErrorKind = "input" | "transport" | "json" | "schema"

export interface CompilerModelError {
  readonly kind: CompilerModelErrorKind
  readonly code: string
  readonly message: string
  readonly path?: string
  readonly errors?: readonly ProposalValidationError[]
  readonly cause?: unknown
}

export interface CompilerModelAcceptedResult {
  readonly ok: true
  readonly status: "accepted"
  readonly request: CompilerModelRequest
  readonly raw_response: string
  readonly proposal: ProposalEnvelope
}

export interface CompilerModelRejectedResult {
  readonly ok: false
  readonly status: "rejected"
  readonly request?: CompilerModelRequest
  readonly raw_response?: string
  readonly error: CompilerModelError
}

export type CompilerModelResult = CompilerModelAcceptedResult | CompilerModelRejectedResult

interface ProposalEnvelopeExpectation {
  readonly base_state_version: CompilerStateVersion
  readonly input_identity: CompilerInputIdentity
  readonly input_digest: string
  readonly input_text?: string
  readonly evidence_digest?: string
}

interface ProposalParseAcceptedResult {
  readonly ok: true
  readonly envelope: ProposalEnvelope
}

interface ProposalParseRejectedResult {
  readonly ok: false
  readonly error: CompilerModelError
}

type ProposalParseResult = ProposalParseAcceptedResult | ProposalParseRejectedResult

export interface CompilerModel {
  readonly propose: (
    input: CompilerModelInput,
    validationErrors?: readonly ProposalValidationError[],
  ) => Promise<CompilerModelResult>
}

const FORBIDDEN_OUTPUT_FIELDS = new Set([
  "next_private_state",
  "next_state",
  "compiled_intent",
  "replacement_prompt",
  "replacement_message",
  "replacementPrompt",
  "plan",
  "execution_plan",
  "executor_answer",
  "executor_message",
  "executor_text",
  "final_answer",
])

const ENVELOPE_FIELDS = new Set([
  "base_state_version",
  "input_identity",
  "input_digest",
  "evidence_digest",
  "operations",
])

interface OperationSchema {
  readonly required: readonly string[]
  readonly optional?: readonly string[]
}

const OPERATION_SCHEMAS: Readonly<Record<string, OperationSchema>> = {
  create_task: { required: ["operation", "local_ref", "description", "source"] },
  select_task: { required: ["operation", "task_id", "source"] },
  suspend_task: { required: ["operation", "task_id", "source"] },
  resume_task: { required: ["operation", "task_id", "source"] },
  add_requirement: { required: ["operation", "task_id", "local_ref", "text", "source"] },
  replace_requirement: { required: ["operation", "requirement_id", "local_ref", "text", "source"] },
  withdraw_requirement: { required: ["operation", "requirement_id", "source"] },
  add_unresolved: { required: ["operation", "task_id", "local_ref", "alternatives", "source"] },
  resolve_unresolved: { required: ["operation", "unresolved_id", "resolution", "source"] },
  add_authority: { required: ["operation", "scope", "local_ref", "text", "source"], optional: ["task_id"] },
  replace_authority: { required: ["operation", "authority_id", "local_ref", "text", "source"] },
  withdraw_authority: { required: ["operation", "authority_id", "source"] },
  record_execution_fact: { required: ["operation", "task_id", "local_ref", "content", "evidence_ids"] },
  record_execution_status: { required: ["operation", "task_id", "status", "evidence_ids"], optional: ["workspace_snapshot_id"] },
  no_change: { required: ["operation"] },
}

const ALL_OPERATION_FIELDS = new Set(
  Object.values(OPERATION_SCHEMAS).flatMap((schema) => [...schema.required, ...(schema.optional ?? [])]),
)
const SOURCE_SPAN_FIELDS = new Set(["channel", "input_identity", "input_digest", "start", "end"])
const EVIDENCE_OPERATION_NAMES = new Set(["record_execution_fact", "record_execution_status"])
const NO_CHANGE_OPERATION_NAME = "no_change"
const EXECUTION_STATUSES = new Set([
  "unknown",
  "in_progress",
  "reported_complete",
  "check_failed",
  "verified_complete",
])
const PROTOTYPE_PREFIX = "[LLM-PROTOTYPE]"
const PROTOTYPE_TEXT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  create_task: ["description"],
  add_requirement: ["text"],
  replace_requirement: ["text"],
  resolve_unresolved: ["resolution"],
  add_authority: ["text"],
  replace_authority: ["text"],
  record_execution_fact: ["content"],
}

/**
 * Build the only request shape the independent model transport can receive.
 * The returned object is a deep-frozen snapshot, so a transport cannot mutate
 * caller-owned state/evidence or use the request as a write channel.
 */
function buildCompilerModelRequest(
  input: CompilerModelInput,
  validationErrors: readonly ProposalValidationError[] = [],
): CompilerModelRequest {
  const normalized = normalizeInput(input)
  const retryErrors = normalizeRetryErrors(validationErrors)
  const operationNames = readOperationNames()

  const request: Record<string, unknown> = {
    schema_version: "0.1",
    base_state_version: normalized.base_state_version,
    current_state: cloneValue(normalized.current_state),
    input_identity: cloneValue(normalized.input_identity),
    input_digest: normalized.input_digest,
    input_text: normalized.input_text,
    input_source: {
      kind: "user_input",
      start: 0,
      end: normalized.input_text.length,
    },
    admitted_evidence: cloneValue(normalized.admitted_evidence),
    allowed_operations: operationNames,
    operation_contract: {
      operation_field: "operation",
      ordering: "operations are applied in the order returned",
      local_references: {
        rule: "Choose a unique local_ref for each new record. Later operations in this proposal refer to it using the same string in task_id/requirement_id/etc. Existing records use the IDs in current_state. Never invent persistent IDs.",
        reserved_pattern: PROPOSAL_LOCAL_REFERENCE_RESERVED_PATTERN,
        examples: { allowed: ["task-local", "requirement-local"], forbidden: ["task-1", "requirement-1"] },
      },
      task_selection: "create_task creates an active task but does NOT select it. select_task explicitly sets the current task. Compiled Intent includes task content only for the selected task. For a first request to perform a task, propose create_task, its requirements, and select_task using the new task's local_ref. Creating a new active task with no selected task is rejected at the turn boundary. If the user explicitly defers all new tasks, suspend them instead of selecting; do not invent deferral.",
      requirements: "Record each explicit behavior or constraint as an add_requirement for its task, not only inside the task description. Preserve all stated requirements without adding implementation choices or unstated features. Preserve explicit optionality, priority and release conditions as well: do not drop them as non-requirements or turn optional work into mandatory work.",
      requirement_revisions: "When the user revises a requirement, use replace_requirement with text that states the complete currently intended requirement, including its revised scope, timing, conditions and exceptions. Resolve references against current_state and the new input. When a deferral is withdrawn or previously planned work is included in the current task, explicitly preserve that inclusion in the replacement text; restoring an old future-tense sentence or changing record status alone may lose the revision. Preserve any release/version target without confusing it with exclusion from current work. Retain unaffected requirements. If the input genuinely leaves the intended scope unresolved, record the alternatives rather than inventing a decision. Before choosing no_change, check whether the existing text actually expresses the new input, even if the input describes itself as a restatement.",
      lifecycle: "suspend_task clears selection if that task was selected. resume_task makes a suspended task active but does not select it; select it explicitly when the user asks to work on it. Creating another task does not switch away from an existing selected task; select the intended current task explicitly.",
      no_change: "Use no_change alone only when the new input makes no change to managed intent or admitted execution facts. An explicit first task request requires task creation, requirements and selection; empty prior state is not a reason to return no_change. Greetings or non-task text may legitimately leave state empty.",
      source_fields: ["channel", "input_identity", "input_digest", "start", "end"],
      source_rule: "user and Authority operations use only source with channel user and an exact [start,end) span",
      evidence_rule: "execution operations use only evidence_ids that were already admitted",
      operation_fields: Object.fromEntries(
        operationNames.map((name) => [name, operationSchemaForRequest(name)]),
      ),
      persistent_metadata: "Echo the supplied envelope base_state_version, input_identity and input_digest exactly; copy source identity/digest and existing record IDs when referenced. Do not allocate new persistent IDs, operation IDs, versions, timestamps or digests; use local_ref for new records.",
      evidence_authority: "evidence operations cannot add, replace, or withdraw requirements or Authority",
      model_interpreted_text: `description, text, resolution, content, and every unresolved alternative must begin with ${PROTOTYPE_PREFIX}`,
    },
    response_contract: {
      format: "one JSON proposal envelope",
      required_fields: ["base_state_version", "input_identity", "input_digest", "operations"],
      forbidden_fields: Array.from(FORBIDDEN_OUTPUT_FIELDS),
      no_free_text_fallback: true,
    },
    tools: [],
    tool_choice: "none",
  }

  if (normalized.input_parts !== undefined) request.input_parts = cloneValue(normalized.input_parts)
  if (normalized.evidence_digest !== undefined) request.evidence_digest = normalized.evidence_digest
  if (retryErrors.length > 0) request.validation_errors = retryErrors

  return freezeDeep(request) as unknown as CompilerModelRequest
}

/**
 * Call one model attempt and parse only the closed proposal envelope.  This
 * function never retries: module 05 owns whether a second call is allowed.
 */
async function callCompilerModel(
  input: CompilerModelInput,
  transport: CompilerModelTransport,
  validationErrors: readonly ProposalValidationError[] = [],
): Promise<CompilerModelResult> {
  let request: CompilerModelRequest
  try {
    request = buildCompilerModelRequest(input, validationErrors)
  } catch (error: unknown) {
    return rejected(undefined, undefined, inputError(error))
  }

  if (typeof transport !== "function") {
    return rejected(request, undefined, {
      kind: "transport",
      code: "missing_transport",
      message: "an injected model transport function is required",
    })
  }

  let rawResponse: unknown
  try {
    rawResponse = await transport(request)
  } catch (error: unknown) {
    return rejected(request, undefined, {
      kind: "transport",
      code: "transport_failure",
      message: errorMessage(error),
      cause: error,
    })
  }

  if (typeof rawResponse !== "string") {
    return rejected(request, undefined, {
      kind: "transport",
      code: "non_text_response",
      message: "the model transport must return the raw response as text",
      cause: rawResponse,
    })
  }

  const parsed = parseProposalEnvelope(rawResponse, expectationFromInput(input))
  if (!parsed.ok) return rejected(request, rawResponse, parsed.error)
  return {
    ok: true,
    status: "accepted",
    request,
    raw_response: rawResponse,
    proposal: parsed.envelope,
  }
}

/**
 * Parse a raw response without invoking a model.  Supplying an expectation
 * also checks that the envelope is tied to the exact state/input/evidence
 * supplied for the turn.
 */
function parseProposalEnvelope(
  rawResponse: string,
  expected?: ProposalEnvelopeExpectation | CompilerModelInput,
): ProposalParseResult {
  if (typeof rawResponse !== "string") {
    return {
      ok: false,
      error: {
        kind: "json",
        code: "non_text_response",
        message: "a proposal response must be raw text",
      },
    }
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(rawResponse) as unknown
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        kind: "json",
        code: "invalid_json",
        message: errorMessage(error),
        cause: error,
      },
    }
  }

  const expectation = expected ? expectationFromValue(expected) : undefined
  const errors = validateEnvelope(decoded, expectation)
  if (errors.length > 0) {
    return {
      ok: false,
      error: {
        kind: "schema",
        code: "invalid_proposal_envelope",
        message: "the model response is not a valid proposal envelope",
        errors: freezeDeep(errors),
      },
    }
  }

  return { ok: true, envelope: normalizeEnvelope(decoded as Record<string, unknown>) }
}

/** Create a model module around one injected transport adapter. */
export function createCompilerModel(transport: CompilerModelTransport): CompilerModel {
  if (typeof transport !== "function") {
    throw new TypeError("createCompilerModel requires an injected model transport function")
  }

  return Object.freeze({
    propose: (input: CompilerModelInput, validationErrors?: readonly ProposalValidationError[]) =>
      callCompilerModel(input, transport, validationErrors),
  })
}

class CompilerModelInputError extends Error {
  readonly kind = "input" as const
  readonly code: string
  readonly path?: string

  constructor(code: string, message: string, path?: string) {
    super(message)
    this.name = "CompilerModelInputError"
    this.code = code
    this.path = path
  }
}

function normalizeInput(input: CompilerModelInput): CompilerModelInput {
  if (!isRecord(input)) throw new CompilerModelInputError("invalid_input", "model input must be an object")
  if (!hasOwn(input, "base_state_version")) {
    throw new CompilerModelInputError("missing_base_state_version", "model input must provide base_state_version")
  }
  if (!validStateVersion(input.base_state_version)) {
    throw new CompilerModelInputError("invalid_base_state_version", "base_state_version must be a non-negative integer")
  }
  if (!hasOwn(input, "current_state") || input.current_state === undefined) {
    throw new CompilerModelInputError("missing_current_state", "model input must provide the current state")
  }
  if (!hasOwn(input, "input_identity") || input.input_identity === undefined || input.input_identity === null) {
    throw new CompilerModelInputError("missing_input_identity", "model input must provide input_identity")
  }
  if (typeof input.input_digest !== "string" || input.input_digest.length === 0) {
    throw new CompilerModelInputError("missing_input_digest", "model input must provide a non-empty input_digest")
  }
  if (typeof input.input_text !== "string") {
    throw new CompilerModelInputError("invalid_input_text", "model input must provide input_text as text")
  }
  if (!Array.isArray(input.admitted_evidence)) {
    throw new CompilerModelInputError(
      "invalid_admitted_evidence",
      "model input must provide admitted_evidence as an array",
    )
  }
  if (input.evidence_digest !== undefined && typeof input.evidence_digest !== "string") {
    throw new CompilerModelInputError("invalid_evidence_digest", "evidence_digest must be text when supplied")
  }
  if (input.input_parts !== undefined) validateTextOnlyParts(input.input_parts)

  return input
}

function validateTextOnlyParts(parts: readonly CompilerTaskContentPart[]): void {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new CompilerModelInputError(
      "invalid_task_message_parts",
      "a registered Compiler task message must contain at least one text part",
      "input_parts",
    )
  }
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (!isRecord(part) || part.type !== "text") {
      throw new CompilerModelInputError(
        "non_text_task_message",
        "Compiler model input accepts only text task-message parts; the whole turn was rejected",
        `input_parts[${index}]`,
      )
    }
    if (typeof part.text !== "string") {
      throw new CompilerModelInputError(
        "invalid_text_task_part",
        "a text task-message part must contain text",
        `input_parts[${index}].text`,
      )
    }
  }
}

function normalizeRetryErrors(errors: readonly ProposalValidationError[]): readonly ProposalValidationError[] {
  if (!Array.isArray(errors)) {
    throw new CompilerModelInputError("invalid_retry_errors", "validation errors must be an array")
  }
  const normalized = errors.map((error, index) => {
    if (!isRecord(error)) {
      throw new CompilerModelInputError("invalid_retry_error", "each retry item must be a validation error", `validation_errors[${index}]`)
    }
    if (typeof error.code !== "string" || error.code.length === 0 || /\s/u.test(error.code)) {
      throw new CompilerModelInputError(
        "invalid_retry_error_code",
        "retry input may contain only deterministic proposal validation errors",
        `validation_errors[${index}].code`,
      )
    }
    if (typeof error.message !== "string" || error.message.length === 0) {
      throw new CompilerModelInputError(
        "invalid_retry_error_message",
        "a retry validation error must contain a message",
        `validation_errors[${index}].message`,
      )
    }
    if (error.path !== undefined && typeof error.path !== "string") {
      throw new CompilerModelInputError(
        "invalid_retry_error_path",
        "a retry validation error path must be text",
        `validation_errors[${index}].path`,
      )
    }
    if (error.operation_index !== undefined && (!Number.isInteger(error.operation_index) || error.operation_index < 0)) {
      throw new CompilerModelInputError(
        "invalid_retry_error_operation",
        "a retry validation error operation_index must be a non-negative integer",
        `validation_errors[${index}].operation_index`,
      )
    }
    if (error.field !== undefined && typeof error.field !== "string") {
      throw new CompilerModelInputError(
        "invalid_retry_error_field",
        "a retry validation error field must be text",
        `validation_errors[${index}].field`,
      )
    }
    return {
      code: error.code,
      message: error.message,
      ...(error.path === undefined ? {} : { path: error.path }),
      ...(error.operation_index === undefined ? {} : { operation_index: error.operation_index }),
      ...(error.field === undefined ? {} : { field: error.field }),
    }
  })
  return freezeDeep(normalized)
}

function expectationFromInput(input: CompilerModelInput): ProposalEnvelopeExpectation {
  return {
    base_state_version: input.base_state_version,
    input_identity: input.input_identity,
    input_digest: input.input_digest,
    input_text: input.input_text,
    evidence_digest: input.evidence_digest,
  }
}

function expectationFromValue(value: ProposalEnvelopeExpectation | CompilerModelInput): ProposalEnvelopeExpectation {
  if (hasOwn(value, "current_state") || hasOwn(value, "input_text")) return expectationFromInput(value as CompilerModelInput)
  return value as ProposalEnvelopeExpectation
}

function validateEnvelope(decoded: unknown, expected?: ProposalEnvelopeExpectation): ProposalValidationError[] {
  const errors: ProposalValidationError[] = []
  if (!isRecord(decoded)) {
    return [issue("invalid_type", "proposal envelope must be a JSON object", "")]
  }

  collectForbiddenFields(decoded, "", errors)

  for (const key of Object.keys(decoded)) {
    if (ENVELOPE_FIELDS.has(key) || FORBIDDEN_OUTPUT_FIELDS.has(key)) continue
    errors.push(issue("invalid_field", `unknown proposal envelope field: ${key}`, key))
  }

  if (!hasOwn(decoded, "base_state_version")) {
    errors.push(issue("missing_field", "proposal envelope must contain base_state_version", "base_state_version"))
  } else if (!validStateVersion(decoded.base_state_version)) {
    errors.push(issue("invalid_type", "base_state_version must be a non-negative integer", "base_state_version"))
  }

  if (!hasOwn(decoded, "input_identity")) {
    errors.push(issue("missing_field", "proposal envelope must contain input_identity", "input_identity"))
  } else if (decoded.input_identity === null || decoded.input_identity === undefined) {
    errors.push(issue("invalid_type", "input_identity must not be null", "input_identity"))
  }

  if (!hasOwn(decoded, "input_digest")) {
    errors.push(issue("missing_field", "proposal envelope must contain input_digest", "input_digest"))
  } else if (typeof decoded.input_digest !== "string" || decoded.input_digest.length === 0) {
    errors.push(issue("invalid_type", "input_digest must be non-empty text", "input_digest"))
  }

  if (hasOwn(decoded, "evidence_digest") && typeof decoded.evidence_digest !== "string") {
    errors.push(issue("invalid_type", "evidence_digest must be text when supplied", "evidence_digest"))
  }

  if (expected) {
    if (hasOwn(decoded, "base_state_version") && !sameJson(decoded.base_state_version, expected.base_state_version)) {
      errors.push(issue("base_version_mismatch", "proposal base_state_version does not match the requested state", "base_state_version"))
    }
    if (hasOwn(decoded, "input_identity") && !sameJson(decoded.input_identity, expected.input_identity)) {
      errors.push(issue("input_identity_mismatch", "proposal input_identity does not match the current input", "input_identity"))
    }
    if (hasOwn(decoded, "input_digest") && decoded.input_digest !== expected.input_digest) {
      errors.push(issue("digest_mismatch", "proposal input_digest does not match the current input", "input_digest"))
    }
    if (
      expected.evidence_digest !== undefined &&
      hasOwn(decoded, "evidence_digest") &&
      decoded.evidence_digest !== expected.evidence_digest
    ) {
      errors.push(issue("digest_mismatch", "proposal evidence_digest does not match admitted evidence", "evidence_digest"))
    }
  }

  if (!hasOwn(decoded, "operations")) {
    errors.push(issue("missing_field", "proposal envelope must contain operations", "operations"))
  } else if (!Array.isArray(decoded.operations)) {
    errors.push(issue("invalid_type", "operations must be an array", "operations"))
  } else if (decoded.operations.length === 0) {
    errors.push(issue("invalid_value", "operations must contain an explicit no_change or another operation", "operations"))
  } else {
    const operationNames = new Set(readOperationNames())
    decoded.operations.forEach((operation, index) =>
      validateOperation(operation, index, operationNames, expected, errors),
    )
  }

  return errors
}

function validateOperation(
  operation: unknown,
  index: number,
  operationNames: ReadonlySet<string>,
  expected: ProposalEnvelopeExpectation | undefined,
  errors: ProposalValidationError[],
): void {
  const path = `operations[${index}]`
  if (!isRecord(operation)) {
    errors.push(issue("invalid_type", "each operation must be an object", path))
    return
  }

  collectForbiddenFields(operation, path, errors)
  if (typeof operation.operation !== "string" || operation.operation.length === 0) {
    for (const key of Object.keys(operation)) {
      if (!ALL_OPERATION_FIELDS.has(key)) {
        errors.push(issue("invalid_field", `unknown operation field: ${key}`, `${path}.${key}`))
      }
    }
    errors.push(issue("missing_field", "each operation must contain a string operation", `${path}.operation`))
    return
  }
  const operationName = operation.operation
  if (!operationNames.has(operationName)) {
    errors.push(issue("unknown_operation", `operation is not in the closed proposal set: ${operationName}`, `${path}.operation`))
    return
  }

  const schema = OPERATION_SCHEMAS[operationName]
  if (!schema) {
    errors.push(issue("invalid_field", `no schema is defined for operation ${operationName}`, `${path}.operation`))
    return
  }
  const allowedFields = new Set([...(schema.required ?? []), ...(schema.optional ?? [])])
  for (const key of Object.keys(operation)) {
    if (!allowedFields.has(key)) {
      errors.push(issue("invalid_field", `unknown operation field: ${key}`, `${path}.${key}`))
    }
  }
  for (const required of schema.required) {
    if (!hasOwn(operation, required)) {
      errors.push(issue("missing_field", `${operationName} requires ${required}`, `${path}.${required}`))
    }
  }

  if (operationName === NO_CHANGE_OPERATION_NAME) return

  if (operationName === "add_authority") {
    if (operation.scope !== "global" && operation.scope !== "task") {
      errors.push(issue("invalid_value", "Authority scope must be global or task", `${path}.scope`))
    } else if (operation.scope === "task" && !hasOwn(operation, "task_id")) {
      errors.push(issue("missing_field", "task-scoped Authority requires task_id", `${path}.task_id`))
    } else if (operation.scope === "global" && hasOwn(operation, "task_id")) {
      errors.push(issue("invalid_field", "global Authority cannot contain task_id", `${path}.task_id`))
    }
  }

  for (const field of [
    "local_ref",
    "task_id",
    "requirement_id",
    "unresolved_id",
    "authority_id",
    "description",
    "text",
    "resolution",
    "content",
    "workspace_snapshot_id",
  ]) {
    if (hasOwn(operation, field) && (typeof operation[field] !== "string" || operation[field].length === 0)) {
      errors.push(issue("invalid_value", `${field} must be non-empty text`, `${path}.${field}`))
    }
  }

  if (hasOwn(operation, "alternatives") && !validAlternatives(operation.alternatives)) {
    errors.push(issue("invalid_value", "alternatives must contain at least two non-empty strings", `${path}.alternatives`))
  }

  for (const field of PROTOTYPE_TEXT_FIELDS[operationName] ?? []) {
    if (
      typeof operation[field] === "string" &&
      !operation[field].startsWith(PROTOTYPE_PREFIX)
    ) {
      errors.push(issue(
        "prototype_label_required",
        `${field} must begin with ${PROTOTYPE_PREFIX}`,
        `${path}.${field}`,
      ))
    }
  }
  if (
    operationName === "add_unresolved" &&
    Array.isArray(operation.alternatives)
  ) {
    operation.alternatives.forEach((alternative, index) => {
      if (typeof alternative === "string" && !alternative.startsWith(PROTOTYPE_PREFIX)) {
        errors.push(issue(
          "prototype_label_required",
          `alternatives must begin with ${PROTOTYPE_PREFIX}`,
          `${path}.alternatives[${index}]`,
        ))
      }
    })
  }

  if (EVIDENCE_OPERATION_NAMES.has(operationName)) {
    if (!validEvidenceIds(operation.evidence_ids)) {
      errors.push(issue("invalid_reference", "evidence_ids must be a non-empty string array", `${path}.evidence_ids`))
    }
    if (operationName === "record_execution_status" && (typeof operation.status !== "string" || !EXECUTION_STATUSES.has(operation.status))) {
      errors.push(issue("invalid_value", "execution status is not in the frozen status set", `${path}.status`))
    }
    return
  }

  validateSourceSpan(operation.source, "source", path, expected, errors)
}

function validateSourceSpan(
  source: unknown,
  sourceField: string,
  operationPath: string,
  expected: ProposalEnvelopeExpectation | undefined,
  errors: ProposalValidationError[],
): void {
  if (!isRecord(source)) {
    errors.push(issue("invalid_source_span", "source must be an object containing an exact span", `${operationPath}.${sourceField}`))
    return
  }

  for (const key of Object.keys(source)) {
    if (!SOURCE_SPAN_FIELDS.has(key)) {
      errors.push(issue("invalid_field", `unknown source field: ${key}`, `${operationPath}.${sourceField}.${key}`))
    }
  }
  const start = numericField(source, ["start"])
  const end = numericField(source, ["end"])
  if (
    start === undefined ||
    end === undefined ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start
  ) {
    errors.push(issue("invalid_source_span", "source span must be a non-empty [start,end) integer range", `${operationPath}.${sourceField}`))
    return
  }
  if (expected?.input_text !== undefined) {
    if (end > expected.input_text.length) {
      errors.push(issue("invalid_source_span", "source span must lie within the current user input", `${operationPath}.${sourceField}`))
    }
  }
  if (source.channel !== "user") {
    errors.push(issue("invalid_source_span", "source channel must be user", `${operationPath}.${sourceField}.channel`))
  }
  if (typeof source.input_identity !== "string" || source.input_identity.length === 0) {
    errors.push(issue("invalid_source_span", "source.input_identity must be non-empty text", `${operationPath}.${sourceField}.input_identity`))
  } else if (expected && source.input_identity !== expected.input_identity) {
    errors.push(issue("input_identity_mismatch", "source span is not from the current input", `${operationPath}.${sourceField}.input_identity`))
  }
  if (typeof source.input_digest !== "string" || source.input_digest.length === 0) {
    errors.push(issue("invalid_source_span", "source.input_digest must be non-empty text", `${operationPath}.${sourceField}.input_digest`))
  } else if (expected && source.input_digest !== expected.input_digest) {
    errors.push(issue("digest_mismatch", "source span digest differs from the current input", `${operationPath}.${sourceField}.input_digest`))
  }
}

function normalizeEnvelope(decoded: Record<string, unknown>): ProposalEnvelope {
  const normalized: Record<string, unknown> = {
    base_state_version: cloneValue(decoded.base_state_version),
    input_identity: cloneValue(decoded.input_identity),
    input_digest: decoded.input_digest,
    ...(hasOwn(decoded, "evidence_digest") ? { evidence_digest: decoded.evidence_digest } : {}),
    operations: (decoded.operations as unknown[]).map((operation) => cloneValue(operation)) as ProposalOperation[],
  }
  return freezeDeep(normalized) as unknown as ProposalEnvelope
}

function readOperationNames(): string[] {
  const value = PROPOSAL_OPERATION_NAMES as unknown
  const names = Array.isArray(value)
    ? value
    : value instanceof Set
      ? Array.from(value)
      : value && typeof value === "object" && Symbol.iterator in value
        ? Array.from(value as Iterable<unknown>)
        : []
  if (names.length === 0 || names.some((name) => typeof name !== "string" || name.length === 0)) {
    throw new Error("intent-state did not export a valid PROPOSAL_OPERATION_NAMES collection")
  }
  if (new Set(names).size !== names.length) throw new Error("PROPOSAL_OPERATION_NAMES contains duplicate operation names")
  return names as string[]
}

function operationSchemaForRequest(name: string): Readonly<Record<string, unknown>> {
  const schema = OPERATION_SCHEMAS[name]
  if (!schema) return { required: ["operation"], optional: [], unsupported: true }
  return {
    required: [...schema.required],
    optional: [...(schema.optional ?? [])],
  }
}

function inputError(error: unknown): CompilerModelError {
  if (error instanceof CompilerModelInputError) {
    return {
      kind: "input",
      code: error.code,
      message: error.message,
      ...(error.path === undefined ? {} : { path: error.path }),
    }
  }
  return { kind: "input", code: "invalid_input", message: errorMessage(error) }
}

function rejected(
  request: CompilerModelRequest | undefined,
  rawResponse: string | undefined,
  error: CompilerModelError,
): CompilerModelRejectedResult {
  return {
    ok: false,
    status: "rejected",
    ...(request === undefined ? {} : { request }),
    ...(rawResponse === undefined ? {} : { raw_response: rawResponse }),
    error,
  }
}

function issue(code: string, message: string, path?: string): ProposalValidationError {
  return { code, message, ...(path === undefined ? {} : { path }) }
}

function validStateVersion(value: unknown): value is CompilerStateVersion {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function validEvidenceIds(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string" && entry.length > 0)
}

function validAlternatives(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length >= 2 && value.every((entry) => typeof entry === "string" && entry.length > 0)
}

function numericField(record: Record<string, unknown>, names: readonly string[]): number | undefined {
  for (const name of names) {
    if (typeof record[name] === "number") return record[name]
  }
  return undefined
}

function collectForbiddenFields(value: unknown, path: string, errors: ProposalValidationError[], seen = new Set<object>()): void {
  if (!isRecord(value) && !Array.isArray(value)) return
  const object = value as object
  if (seen.has(object)) return
  seen.add(object)

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenFields(item, `${path}[${index}]`, errors, seen))
    return
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key
    if (FORBIDDEN_OUTPUT_FIELDS.has(key)) {
      errors.push(issue("forbidden_output_field", `proposal cannot contain ${key}`, childPath))
    }
    collectForbiddenFields(child, childPath, errors, seen)
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right)
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item))
  if (isRecord(value)) {
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key])
    return output
  }
  return value
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T
  if (isRecord(value)) {
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) output[key] = cloneValue(child)
    return output as T
  }
  return value
}

function freezeDeep<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object") return value
  const object = value as object
  if (seen.has(object)) return value
  seen.add(object)
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item, seen)
  } else {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child, seen)
  }
  return Object.freeze(value)
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
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
