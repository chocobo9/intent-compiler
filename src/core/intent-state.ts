import { createHash } from "node:crypto"

/** The only operation names understood by the first candidate. */
export const PROPOSAL_OPERATION_NAMES = [
  "create_task",
  "select_task",
  "suspend_task",
  "resume_task",
  "add_requirement",
  "replace_requirement",
  "withdraw_requirement",
  "add_unresolved",
  "resolve_unresolved",
  "add_authority",
  "replace_authority",
  "withdraw_authority",
  "record_execution_fact",
  "record_execution_status",
  "no_change",
] as const

export type ProposalOperationName = (typeof PROPOSAL_OPERATION_NAMES)[number]
export type RecordStatus = "active" | "suspended" | "superseded" | "withdrawn" | "open" | "resolved"
export type ExecutionStatus =
  | "unknown"
  | "in_progress"
  | "reported_complete"
  | "check_failed"
  | "verified_complete"

export type SourceChannel = "user" | "evidence"

/** A source span is deliberately data, not a recovered excerpt. */
export interface UserSourceSpan {
  channel: "user"
  input_identity: string
  input_digest: string
  start: number
  end: number
}

export interface EvidenceSource {
  channel: "evidence"
  evidence_ids: readonly string[]
}

export type SourceReference = UserSourceSpan | EvidenceSource

export interface InputContext {
  input_identity: string
  input_digest: string
  text: string
  admitted_evidence?: readonly AdmittedEvidence[]
  evidence_digest?: string
  current_workspace_snapshot_id?: string
}

export interface AdmittedEvidence {
  id: string
  digest: string
  kind: string
  task_id?: string
  task_occurrence_id?: string
  run_id?: string
  turn_id?: string
  session_id?: string
  message_id?: string
  call_id?: string
  causal_parent_id?: string
  workspace_snapshot_id?: string
  workspace_changed?: boolean
  compiler_visible?: boolean
  predeclared?: boolean
  exact_workspace_snapshot?: boolean
  complete?: boolean
}

export interface TaskOccurrenceRecord {
  id: string
  description: string
  status: "active" | "suspended"
  source: UserSourceSpan
  created_order: number
}

export interface RequirementRecord {
  id: string
  task_id: string
  text: string
  status: "active" | "superseded" | "withdrawn"
  source: UserSourceSpan
  created_order: number
  replacement_of?: string
  replaced_by?: string
}

export interface UnresolvedContentRecord {
  id: string
  task_id: string
  alternatives: readonly string[]
  status: "open" | "resolved"
  source: UserSourceSpan
  created_order: number
  resolution?: string
  resolved_source?: UserSourceSpan
}

export interface AuthorityRecord {
  id: string
  scope: "global" | "task"
  task_id?: string
  text: string
  status: "active" | "superseded" | "withdrawn"
  source: UserSourceSpan
  created_order: number
  replacement_of?: string
  replaced_by?: string
}

export interface ExecutionFactRecord {
  id: string
  task_id: string
  content: string
  evidence_ids: readonly string[]
  source: EvidenceSource
  created_order: number
}

export interface ExecutionStatusHistoryEntry {
  status: ExecutionStatus
  evidence_ids: readonly string[]
  workspace_snapshot_id?: string
}

export interface ExecutionStatusRecord {
  id: string
  task_id: string
  status: ExecutionStatus
  evidence_ids: readonly string[]
  workspace_snapshot_id?: string
  history: readonly ExecutionStatusHistoryEntry[]
}

/** The complete minimum state for the first candidate. All arrays are creation ordered. */
export interface IntentState {
  state_version: number
  state_digest: string
  selected_task_id: string | null
  task_occurrences: TaskOccurrenceRecord[]
  requirements: RequirementRecord[]
  unresolved_content: UnresolvedContentRecord[]
  authorities: AuthorityRecord[]
  execution_facts: ExecutionFactRecord[]
  execution_statuses: ExecutionStatusRecord[]
}

/** The exact user-source object accepted by every user operation. */
interface UserOperationBase {
  operation: "create_task" | "select_task" | "suspend_task" | "resume_task" | "add_requirement" | "replace_requirement" | "withdraw_requirement" | "add_unresolved" | "resolve_unresolved" | "add_authority" | "replace_authority" | "withdraw_authority"
  source: UserSourceSpan
}

export interface CreateTaskOperation extends UserOperationBase {
  operation: "create_task"
  local_ref: string
  description: string
}

export interface SelectTaskOperation extends UserOperationBase {
  operation: "select_task" | "suspend_task" | "resume_task"
  task_id: string
}

export interface AddRequirementOperation extends UserOperationBase {
  operation: "add_requirement"
  task_id: string
  local_ref: string
  text: string
}

export interface ReplaceRequirementOperation extends UserOperationBase {
  operation: "replace_requirement"
  requirement_id: string
  local_ref: string
  text: string
}

export interface WithdrawRequirementOperation extends UserOperationBase {
  operation: "withdraw_requirement"
  requirement_id: string
}

export interface AddUnresolvedOperation extends UserOperationBase {
  operation: "add_unresolved"
  task_id: string
  local_ref: string
  alternatives: readonly string[]
}

export interface ResolveUnresolvedOperation extends UserOperationBase {
  operation: "resolve_unresolved"
  unresolved_id: string
  resolution: string
}

export interface AddAuthorityOperation extends UserOperationBase {
  operation: "add_authority"
  scope: "global" | "task"
  task_id?: string
  local_ref: string
  text: string
}

export interface ReplaceAuthorityOperation extends UserOperationBase {
  operation: "replace_authority"
  authority_id: string
  local_ref: string
  text: string
}

export interface WithdrawAuthorityOperation extends UserOperationBase {
  operation: "withdraw_authority"
  authority_id: string
}

export interface RecordExecutionFactOperation {
  operation: "record_execution_fact"
  task_id: string
  local_ref: string
  content: string
  evidence_ids: readonly string[]
}

export interface RecordExecutionStatusOperation {
  operation: "record_execution_status"
  task_id: string
  status: ExecutionStatus
  evidence_ids: readonly string[]
  workspace_snapshot_id?: string
}

export interface NoChangeOperation {
  operation: "no_change"
}

/** An ordered proposal returned by the model adapter. No other fields are accepted. */
export type ProposalOperation =
  | CreateTaskOperation
  | SelectTaskOperation
  | AddRequirementOperation
  | ReplaceRequirementOperation
  | WithdrawRequirementOperation
  | AddUnresolvedOperation
  | ResolveUnresolvedOperation
  | AddAuthorityOperation
  | ReplaceAuthorityOperation
  | WithdrawAuthorityOperation
  | RecordExecutionFactOperation
  | RecordExecutionStatusOperation
  | NoChangeOperation

export interface ProposalEnvelope {
  base_state_version: number
  input_identity: string
  input_digest: string
  operations: readonly ProposalOperation[]
  evidence_digest?: string
}

export interface ValidationError {
  code: string
  message: string
  operation_index?: number
  field?: string
}

export interface ApplyProposalResult {
  ok: boolean
  accepted: boolean
  changed: boolean
  state: IntentState
  errors: readonly ValidationError[]
  operation_ids: readonly string[]
  proposal_local_ids: Readonly<Record<string, string>>
}

export interface CompiledIntentTask {
  id: string
  description: string
  source: UserSourceSpan
  source_ids: readonly string[]
}

export interface CompiledIntentRequirement {
  id: string
  task_id: string
  text: string
  status: "active" | "superseded" | "withdrawn"
  source: UserSourceSpan
  source_ids: readonly string[]
  replacement_of?: string
  replaced_by?: string
  executor_use: "apply" | "do_not_apply"
}

export interface CompiledIntentUnresolved {
  id: string
  task_id: string
  alternatives: readonly string[]
  status: "open"
  source: UserSourceSpan
  source_ids: readonly string[]
}

export interface CompiledIntentAuthority {
  id: string
  scope: "global" | "task"
  task_id?: string
  text: string
  status: "active"
  source: UserSourceSpan
  source_ids: readonly string[]
}

export interface CompiledIntentExecutionFact {
  id: string
  task_id: string
  content: string
  evidence_ids: readonly string[]
  source_ids: readonly string[]
}

export interface CompiledIntentExecutionStatus {
  id: string
  task_id: string
  status: ExecutionStatus
  evidence_ids: readonly string[]
  source_ids: readonly string[]
  workspace_snapshot_id?: string
}

export interface CompiledIntentArtifact {
  artifact_type: "compiled_intent"
  schema_version: 1
  artifact_version: number
  state_version: number
  state_digest: string
  selected_task: CompiledIntentTask | null
  active_requirements: readonly CompiledIntentRequirement[]
  inactive_requirements: readonly CompiledIntentRequirement[]
  open_unresolved: readonly CompiledIntentUnresolved[]
  authorities: readonly CompiledIntentAuthority[]
  execution_facts: readonly CompiledIntentExecutionFact[]
  execution_statuses: readonly CompiledIntentExecutionStatus[]
  source_ids: readonly string[]
  unresolved_restriction?: string
  artifact_digest: string
}

export interface CompiledIntentProjection {
  artifact: CompiledIntentArtifact
  canonical_artifact: string
  rendered_text: string
  artifact_digest: string
  rendered_digest: string
}

export interface ProjectionOptions {
  max_artifact_bytes?: number
  max_rendered_bytes?: number
  previous?: CompiledIntentProjection
}

export class CompiledIntentProjectionError extends Error {
  readonly code: "artifact_too_large" | "rendered_text_too_large"
  readonly byte_length: number
  readonly max_bytes: number

  constructor(code: "artifact_too_large" | "rendered_text_too_large", byteLength: number, maxBytes: number) {
    super(`${code}: ${byteLength} UTF-8 bytes exceeds ${maxBytes}`)
    this.name = "CompiledIntentProjectionError"
    this.code = code
    this.byte_length = byteLength
    this.max_bytes = maxBytes
  }
}

const FORBIDDEN_MODEL_KEYS = new Set([
  "next_private_state",
  "next_state",
  "compiled_intent",
  "replacement_prompt",
  "replacement_message",
  "plan",
  "executor_answer",
  "executor_message",
])

const EXECUTION_STATUSES = new Set<ExecutionStatus>([
  "unknown",
  "in_progress",
  "reported_complete",
  "check_failed",
  "verified_complete",
])

const PROTOTYPE_PREFIX = "[LLM-PROTOTYPE]"

const OPERATION_FIELDS: Readonly<Record<ProposalOperationName, readonly string[]>> = {
  create_task: ["operation", "local_ref", "description", "source"],
  select_task: ["operation", "task_id", "source"],
  suspend_task: ["operation", "task_id", "source"],
  resume_task: ["operation", "task_id", "source"],
  add_requirement: ["operation", "task_id", "local_ref", "text", "source"],
  replace_requirement: ["operation", "requirement_id", "local_ref", "text", "source"],
  withdraw_requirement: ["operation", "requirement_id", "source"],
  add_unresolved: ["operation", "task_id", "local_ref", "alternatives", "source"],
  resolve_unresolved: ["operation", "unresolved_id", "resolution", "source"],
  add_authority: ["operation", "scope", "task_id", "local_ref", "text", "source"],
  replace_authority: ["operation", "authority_id", "local_ref", "text", "source"],
  withdraw_authority: ["operation", "authority_id", "source"],
  record_execution_fact: ["operation", "task_id", "local_ref", "content", "evidence_ids"],
  record_execution_status: ["operation", "task_id", "status", "evidence_ids", "workspace_snapshot_id"],
  no_change: ["operation"],
}

const INPUT_CONTEXT_FIELDS = new Set(["input_identity", "input_digest", "text", "admitted_evidence", "evidence_digest", "current_workspace_snapshot_id"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) output[key] = canonicalize(value[key])
  }
  return output
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function digest(value: unknown): string {
  return createHash("sha256").update(Buffer.from(stableJson(value), "utf8")).digest("hex")
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, "utf8")
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function sourceId(source: SourceReference): string[] {
  if (source.channel === "evidence") return [...source.evidence_ids]
  return [`${source.input_identity}:${source.start}-${source.end}`]
}

function statePayload(state: Omit<IntentState, "state_digest">): unknown {
  return {
    state_version: state.state_version,
    selected_task_id: state.selected_task_id,
    task_occurrences: state.task_occurrences,
    requirements: state.requirements,
    unresolved_content: state.unresolved_content,
    authorities: state.authorities,
    execution_facts: state.execution_facts,
    execution_statuses: state.execution_statuses,
  }
}

function stripStateDigest(state: IntentState): Omit<IntentState, "state_digest"> {
  return {
    state_version: state.state_version,
    selected_task_id: state.selected_task_id,
    task_occurrences: state.task_occurrences,
    requirements: state.requirements,
    unresolved_content: state.unresolved_content,
    authorities: state.authorities,
    execution_facts: state.execution_facts,
    execution_statuses: state.execution_statuses,
  }
}

function withStateDigest(state: Omit<IntentState, "state_digest">): IntentState {
  const payload = statePayload(state)
  return { ...clone(state), state_digest: digest(payload) }
}

function canonicalState(state: IntentState): IntentState {
  const withoutDigest: Omit<IntentState, "state_digest"> = {
    state_version: state.state_version,
    selected_task_id: state.selected_task_id,
    task_occurrences: clone(state.task_occurrences),
    requirements: clone(state.requirements),
    unresolved_content: clone(state.unresolved_content),
    authorities: clone(state.authorities),
    execution_facts: clone(state.execution_facts),
    execution_statuses: clone(state.execution_statuses),
  }
  const expected = digest(statePayload(withoutDigest))
  if (state.state_digest && state.state_digest !== expected) {
    throw new Error("state_digest does not match the state payload")
  }
  return withStateDigest(withoutDigest)
}

export function createInitialIntentState(): IntentState {
  return withStateDigest({
    state_version: 0,
    selected_task_id: null,
    task_occurrences: [],
    requirements: [],
    unresolved_content: [],
    authorities: [],
    execution_facts: [],
    execution_statuses: [],
  })
}

function normalizeUserSource(
  operation: UserOperationBase,
  input: InputContext,
  errors: ValidationError[],
  operationIndex: number,
): UserSourceSpan | undefined {
  const raw = operation.source
  if (!isRecord(raw)) {
    errors.push({ code: "invalid_source_span", message: "user operation requires an exact source span", operation_index: operationIndex, field: "source" })
    return undefined
  }
  const sourceKeys = new Set(["channel", "input_identity", "input_digest", "start", "end"])
  for (const key of Object.keys(raw)) {
    if (!sourceKeys.has(key)) errors.push({ code: "unknown_source_field", message: `source field ${key} is not accepted`, operation_index: operationIndex, field: `source.${key}` })
  }
  const identity = raw.input_identity
  const inputDigest = raw.input_digest
  const start = raw.start
  const end = raw.end
  if (raw.channel !== "user") {
    errors.push({ code: "wrong_source_channel", message: "intent and Authority operations require user source", operation_index: operationIndex, field: "source.channel" })
    return undefined
  }
  if (identity !== input.input_identity) {
    errors.push({ code: "input_identity_mismatch", message: "source span is not from the current input", operation_index: operationIndex, field: "source.input_identity" })
  }
  if (inputDigest !== input.input_digest) {
    errors.push({ code: "input_digest_mismatch", message: "source span digest differs from the current input", operation_index: operationIndex, field: "source.input_digest" })
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 0 || (end as number) <= (start as number) || (end as number) > input.text.length) {
    errors.push({ code: "invalid_source_span", message: "source span must be an exact non-empty range inside the current input", operation_index: operationIndex, field: "source" })
    return undefined
  }
  return {
    channel: "user",
    input_identity: input.input_identity,
    input_digest: input.input_digest,
    start: start as number,
    end: end as number,
  }
}

function operationRecord(operation: ProposalOperation): Record<string, unknown> {
  return operation as unknown as Record<string, unknown>
}

function readString(operation: ProposalOperation, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = operationRecord(operation)[key]
    if (typeof value === "string") return value
  }
  return undefined
}

function readStringArray(operation: ProposalOperation, ...keys: string[]): string[] | undefined {
  for (const key of keys) {
    const value = operationRecord(operation)[key]
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return [...value]
  }
  return undefined
}

function localReference(operation: ProposalOperation, ...keys: string[]): string | undefined {
  return readString(operation, ...keys)
}

export const PROPOSAL_LOCAL_REFERENCE_RESERVED_PATTERN = "^(task|requirement|unresolved|authority|fact|execution-status)-\\d+"

function isLikelyPersistentId(value: string): boolean {
  return new RegExp(PROPOSAL_LOCAL_REFERENCE_RESERVED_PATTERN, "u").test(value)
}

function prototypeText(value: unknown, field: string, errors: ValidationError[], operationIndex: number): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    errors.push({ code: "missing_text", message: `${field} is required`, operation_index: operationIndex, field })
    return undefined
  }
  if (!value.startsWith(PROTOTYPE_PREFIX)) {
    errors.push({ code: "text_not_normalized", message: `${field} must begin with ${PROTOTYPE_PREFIX}`, operation_index: operationIndex, field })
    return undefined
  }
  return value
}

function nextId(records: readonly { id: string }[], prefix: string): string {
  let highest = 0
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, "u")
  for (const record of records) {
    const match = pattern.exec(record.id)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `${prefix}-${String(highest + 1).padStart(4, "0")}`
}

function localKey(value: string): string {
  return value.trim()
}

function hasForbiddenKey(value: unknown): string | undefined {
  if (!isRecord(value)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const nested = hasForbiddenKey(entry)
        if (nested) return nested
      }
    }
    return undefined
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    if (FORBIDDEN_MODEL_KEYS.has(key)) return key
    const nested = hasForbiddenKey(nestedValue)
    if (nested) return nested
  }
  return undefined
}

function stateRecord<T extends { id: string }>(records: readonly T[], id: string): T | undefined {
  return records.find((record) => record.id === id)
}

function resolveTask(
  raw: unknown,
  tasks: readonly TaskOccurrenceRecord[],
  locals: ReadonlyMap<string, string>,
  errors: ValidationError[],
  operationIndex: number,
): TaskOccurrenceRecord | undefined {
  if (typeof raw !== "string" || raw.length === 0) {
    errors.push({ code: "missing_task_reference", message: "task reference is required", operation_index: operationIndex, field: "task_id" })
    return undefined
  }
  const id = locals.get(localKey(raw)) ?? raw
  const task = stateRecord(tasks, id)
  if (!task) {
    errors.push({ code: "unknown_task", message: `task ${raw} does not exist`, operation_index: operationIndex, field: "task_id" })
  }
  return task
}

function resolveRequirement(
  raw: unknown,
  requirements: readonly RequirementRecord[],
  locals: ReadonlyMap<string, string>,
  errors: ValidationError[],
  operationIndex: number,
): RequirementRecord | undefined {
  if (typeof raw !== "string" || raw.length === 0) {
    errors.push({ code: "missing_requirement_reference", message: "requirement reference is required", operation_index: operationIndex, field: "requirement_id" })
    return undefined
  }
  const id = locals.get(localKey(raw)) ?? raw
  const requirement = stateRecord(requirements, id)
  if (!requirement) errors.push({ code: "unknown_requirement", message: `requirement ${raw} does not exist`, operation_index: operationIndex, field: "requirement_id" })
  return requirement
}

function resolveUnresolved(
  raw: unknown,
  unresolved: readonly UnresolvedContentRecord[],
  locals: ReadonlyMap<string, string>,
  errors: ValidationError[],
  operationIndex: number,
): UnresolvedContentRecord | undefined {
  if (typeof raw !== "string" || raw.length === 0) {
    errors.push({ code: "missing_unresolved_reference", message: "unresolved reference is required", operation_index: operationIndex, field: "unresolved_id" })
    return undefined
  }
  const id = locals.get(localKey(raw)) ?? raw
  const item = stateRecord(unresolved, id)
  if (!item) errors.push({ code: "unknown_unresolved", message: `unresolved ${raw} does not exist`, operation_index: operationIndex, field: "unresolved_id" })
  return item
}

function resolveAuthority(
  raw: unknown,
  authorities: readonly AuthorityRecord[],
  locals: ReadonlyMap<string, string>,
  errors: ValidationError[],
  operationIndex: number,
): AuthorityRecord | undefined {
  if (typeof raw !== "string" || raw.length === 0) {
    errors.push({ code: "missing_authority_reference", message: "Authority reference is required", operation_index: operationIndex, field: "authority_id" })
    return undefined
  }
  const id = locals.get(localKey(raw)) ?? raw
  const item = stateRecord(authorities, id)
  if (!item) errors.push({ code: "unknown_authority", message: `Authority ${raw} does not exist`, operation_index: operationIndex, field: "authority_id" })
  return item
}

function evidenceKindIs(evidence: AdmittedEvidence, ...kinds: string[]): boolean {
  return kinds.includes(evidence.kind)
}

function workspaceMutation(evidence: AdmittedEvidence): boolean {
  return evidence.kind === "workspace_diff" && evidence.workspace_changed !== false
}

function normalizeEvidence(
  context: InputContext,
  errors: ValidationError[],
): AdmittedEvidence[] {
  const evidence = context.admitted_evidence ?? []
  const byId = new Map<string, AdmittedEvidence>()
  for (const item of evidence) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.digest !== "string" || typeof item.kind !== "string") {
      errors.push({ code: "invalid_evidence", message: "admitted evidence must have id, digest, and kind" })
      continue
    }
    const previous = byId.get(item.id)
    if (previous && previous.digest !== item.digest) {
      errors.push({ code: "evidence_identity_conflict", message: `evidence ${item.id} has multiple digests` })
      continue
    }
    byId.set(item.id, clone(item))
  }
  return [...byId.values()]
}

function evidenceDigest(evidence: readonly AdmittedEvidence[]): string {
  return digest(evidence.map((item) => ({ id: item.id, digest: item.digest })).sort((a, b) => a.id.localeCompare(b.id)))
}

function evidenceForOperation(
  operation: ProposalOperation,
  evidence: readonly AdmittedEvidence[],
  task: TaskOccurrenceRecord | undefined,
  errors: ValidationError[],
  operationIndex: number,
): AdmittedEvidence[] {
  const rawValue = operationRecord(operation).evidence_ids
  const raw = rawValue
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((id) => typeof id === "string")) {
    errors.push({ code: "missing_evidence_ids", message: "evidence operation requires one or more admitted evidence IDs", operation_index: operationIndex, field: "evidence_ids" })
    return []
  }
  const byId = new Map(evidence.map((item) => [item.id, item]))
  const selected: AdmittedEvidence[] = []
  const seen = new Set<string>()
  for (const rawId of raw) {
    const id = rawId as string
    if (seen.has(id)) {
      errors.push({ code: "duplicate_evidence_id", message: `evidence ${id} is cited more than once`, operation_index: operationIndex, field: "evidence_ids" })
      continue
    }
    seen.add(id)
    const item = byId.get(id)
    if (!item) {
      errors.push({ code: "unknown_evidence", message: `evidence ${id} was not admitted`, operation_index: operationIndex, field: "evidence_ids" })
      continue
    }
    if (task && item.task_id && item.task_id !== task.id) {
      errors.push({ code: "evidence_task_mismatch", message: `evidence ${id} belongs to another task`, operation_index: operationIndex, field: "evidence_ids" })
    }
    if (task && item.task_occurrence_id && item.task_occurrence_id !== task.id) {
      errors.push({ code: "evidence_task_mismatch", message: `evidence ${id} belongs to another task occurrence`, operation_index: operationIndex, field: "evidence_ids" })
    }
    selected.push(item)
  }
  return selected
}

function statusEvidenceAllowed(
  status: ExecutionStatus,
  evidence: readonly AdmittedEvidence[],
  context: InputContext,
  errors: ValidationError[],
  operationIndex: number,
): boolean {
  if (status === "unknown") {
    if (evidence.length > 0) errors.push({ code: "unknown_status_evidence", message: "unknown status cannot be asserted from execution evidence", operation_index: operationIndex, field: "status" })
    return evidence.length === 0
  }
  const allowed = evidence.some((item) => {
    if (status === "in_progress") return evidenceKindIs(item, "assistant_step", "step_finish", "tool_result", "tool_error", "workspace_diff", "environment_observation")
    if (status === "reported_complete") return evidenceKindIs(item, "executor_statement", "executor_completion")
    if (status === "check_failed") return evidenceKindIs(item, "verifier_failure", "test_failure", "check_failure")
    if (status === "verified_complete") {
      const currentSnapshotId = context.current_workspace_snapshot_id
      const snapshotMatches = typeof currentSnapshotId === "string" && currentSnapshotId.length > 0 && item.workspace_snapshot_id === currentSnapshotId
      const verifierEvidence = evidence.filter((candidate) => evidenceKindIs(candidate, "verifier_pass", "test_pass", "check_pass", "verifier_result"))
      const verifierSnapshotsMatch = verifierEvidence.length > 0 && verifierEvidence.every((candidate) => candidate.workspace_snapshot_id === currentSnapshotId)
      return evidenceKindIs(item, "verifier_pass", "test_pass", "check_pass", "verifier_result") && item.compiler_visible === true && item.predeclared !== false && item.exact_workspace_snapshot !== false && item.complete !== false && snapshotMatches && verifierSnapshotsMatch
    }
    return false
  })
  if (!allowed) {
    errors.push({ code: "evidence_cannot_establish_status", message: `the cited evidence cannot establish ${status}`, operation_index: operationIndex, field: "status" })
  }
  if (status === "verified_complete" && evidence.some(workspaceMutation)) {
    errors.push({ code: "workspace_mutated_before_verification", message: "a workspace mutation cannot establish verified_complete", operation_index: operationIndex, field: "evidence_ids" })
  }
  return allowed
}

function statusTransitionAllowed(current: ExecutionStatus, next: ExecutionStatus, evidence: readonly AdmittedEvidence[]): boolean {
  if (current === next) return true
  if (current === "verified_complete") return evidence.some(workspaceMutation) && next === "in_progress"
  if (next === "in_progress" || next === "reported_complete" || next === "check_failed" || next === "verified_complete") return true
  return false
}

function operationId(stateVersion: number, index: number): string {
  return `operation-${String(stateVersion + 1).padStart(4, "0")}-${String(index + 1).padStart(4, "0")}`
}

function addError(errors: ValidationError[], code: string, message: string, operationIndex?: number, field?: string): void {
  errors.push({ code, message, operation_index: operationIndex, field })
}

function registerLocalRef(
  operation: ProposalOperation,
  operationIndex: number,
  locals: Map<string, string>,
  errors: ValidationError[],
): string | undefined {
  const ref = operationRecord(operation).local_ref
  if (typeof ref !== "string" || ref.length === 0) {
    addError(errors, "missing_local_ref", "new records require an explicit local_ref", operationIndex, "local_ref")
    return undefined
  }
  if (isLikelyPersistentId(ref)) addError(errors, "persistent_id_in_proposal", `local_ref ${ref} matches reserved pattern ${PROPOSAL_LOCAL_REFERENCE_RESERVED_PATTERN}; use a proposal-local name such as task-local or requirement-local and use that same name in later references; code assigns persistent IDs`, operationIndex, "local_ref")
  const key = localKey(ref)
  if (locals.has(key)) addError(errors, "duplicate_local_reference", `proposal-local reference ${ref} is declared more than once`, operationIndex, "local_ref")
  else locals.set(key, "")
  return key
}

function operationNameAndShape(operationValue: unknown, operationIndex: number, errors: ValidationError[]): ProposalOperationName | undefined {
  if (!isRecord(operationValue)) {
    addError(errors, "invalid_operation", "each operation must be an object", operationIndex)
    return undefined
  }
  const rawName = operationValue.operation
  if (typeof rawName !== "string" || !(PROPOSAL_OPERATION_NAMES as readonly string[]).includes(rawName)) {
    addError(errors, "unknown_operation", `operation ${String(rawName)} is not in the closed proposal operation set`, operationIndex, "operation")
    return undefined
  }
  const operationName = rawName as ProposalOperationName
  const allowed = new Set(OPERATION_FIELDS[operationName])
  for (const key of Object.keys(operationValue)) {
    if (!allowed.has(key)) addError(errors, "unknown_operation_field", `field ${key} is not accepted for ${operationName}`, operationIndex, key)
  }
  return operationName
}

function validateInputContextShape(context: InputContext, errors: ValidationError[]): void {
  for (const key of Object.keys(context as unknown as Record<string, unknown>)) {
    if (!INPUT_CONTEXT_FIELDS.has(key)) errors.push({ code: "unknown_input_context_field", message: `input context field ${key} is not accepted`, field: key })
  }
}

function appendStatusHistory(record: ExecutionStatusRecord, status: ExecutionStatus, evidenceIds: readonly string[], workspaceSnapshotId?: string): ExecutionStatusRecord {
  return {
    ...record,
    status,
    evidence_ids: [...evidenceIds],
    workspace_snapshot_id: workspaceSnapshotId,
    history: [...record.history, { status, evidence_ids: [...evidenceIds], workspace_snapshot_id: workspaceSnapshotId }],
  }
}

function validateEnvelope(
  state: IntentState,
  proposal: ProposalEnvelope,
  context: InputContext,
  evidence: readonly AdmittedEvidence[],
): ValidationError[] {
  const errors: ValidationError[] = []
  if (!isRecord(proposal)) {
    return [{ code: "invalid_proposal", message: "proposal must be an object" }]
  }
  const proposalFields = new Set(["base_state_version", "input_identity", "input_digest", "operations", "evidence_digest"])
  for (const key of Object.keys(proposal)) {
    if (!proposalFields.has(key)) addError(errors, "unknown_proposal_field", `proposal field ${key} is not accepted`, undefined, key)
  }
  const forbidden = hasForbiddenKey(proposal)
  if (forbidden) addError(errors, "forbidden_model_field", `proposal contains forbidden model field ${forbidden}`)
  if (!Number.isInteger(proposal.base_state_version) || proposal.base_state_version < 0) addError(errors, "invalid_base_state_version", "base_state_version must be a non-negative integer", undefined, "base_state_version")
  else if (proposal.base_state_version !== state.state_version) addError(errors, "base_state_version_mismatch", "proposal was not based on the current state version", undefined, "base_state_version")
  if (proposal.input_identity !== context.input_identity) addError(errors, "input_identity_mismatch", "proposal input identity differs from the admitted input", undefined, "input_identity")
  if (proposal.input_digest !== context.input_digest) addError(errors, "input_digest_mismatch", "proposal input digest differs from the admitted input", undefined, "input_digest")
  if (proposal.evidence_digest !== undefined && proposal.evidence_digest !== evidenceDigest(evidence)) addError(errors, "evidence_digest_mismatch", "proposal evidence digest differs from admitted evidence", undefined, "evidence_digest")
  if (!Array.isArray(proposal.operations)) {
    addError(errors, "invalid_operations", "proposal operations must be an array", undefined, "operations")
  } else if (proposal.operations.length === 0) {
    addError(errors, "invalid_operations", "proposal operations must contain an explicit no_change or another operation", undefined, "operations")
  }
  return errors
}

/**
 * Validate and reduce one complete proposal. The returned state is a new value;
 * on any error the current state and all records remain unchanged.
 */
export function applyProposal(
  inputState: IntentState,
  proposal: ProposalEnvelope,
  context: InputContext,
): ApplyProposalResult {
  let state: IntentState
  try {
    state = canonicalState(inputState)
  } catch (error) {
    return {
      ok: false,
      accepted: false,
      changed: false,
      state: clone(inputState),
      errors: [{ code: "invalid_state_digest", message: error instanceof Error ? error.message : String(error) }],
      operation_ids: [],
      proposal_local_ids: {},
    }
  }
  const contextErrors: ValidationError[] = []
  if (!isRecord(context) || typeof context.input_identity !== "string" || typeof context.input_digest !== "string" || typeof context.text !== "string") {
    return {
      ok: false,
      accepted: false,
      changed: false,
      state,
      errors: [{ code: "invalid_input_context", message: "input context requires input_identity, input_digest, and text" }],
      operation_ids: [],
      proposal_local_ids: {},
    }
  }
  validateInputContextShape(context, contextErrors)
  const admittedEvidence = normalizeEvidence(context, contextErrors)
  if (context.evidence_digest !== undefined && context.evidence_digest !== evidenceDigest(admittedEvidence)) {
    contextErrors.push({ code: "evidence_digest_mismatch", message: "input context evidence digest does not match admitted evidence", field: "evidence_digest" })
  }
  const errors = [...contextErrors, ...validateEnvelope(state, proposal, context, admittedEvidence)]
  const operationIds = Array.isArray(proposal.operations) ? proposal.operations.map((_, index) => operationId(state.state_version, index)) : []
  if (errors.length > 0 || !Array.isArray(proposal.operations)) {
    return { ok: false, accepted: false, changed: false, state, errors, operation_ids: operationIds, proposal_local_ids: {} }
  }

  const next = clone(state)
  const locals = new Map<string, string>()
  const localKinds = new Map<string, "task" | "requirement" | "unresolved" | "authority" | "fact">()
  const conflicts = new Set<string>()
  const operationLocalIds: Record<string, string> = {}
  let sawNoChange = false

  const markConflict = (key: string, operationIndex: number): void => {
    if (conflicts.has(key)) addError(errors, "duplicate_or_conflicting_operation", `operation conflicts with another operation for ${key}`, operationIndex)
    conflicts.add(key)
  }

  const bindLocal = (ref: string, id: string, kind: "task" | "requirement" | "unresolved" | "authority" | "fact"): void => {
    locals.set(ref, id)
    localKinds.set(ref, kind)
    operationLocalIds[ref] = id
  }

  const checkTargetKind = (raw: string | undefined, expected: string, operationIndex: number): void => {
    if (!raw) return
    const kind = localKinds.get(localKey(raw))
    if (kind && kind !== expected) addError(errors, "wrong_local_reference_type", `proposal-local reference ${raw} is a ${kind}, not a ${expected}`, operationIndex)
  }

  for (let index = 0; index < proposal.operations.length; index += 1) {
    const operationValue: unknown = proposal.operations[index]
    if (!isRecord(operationValue)) {
      addError(errors, "invalid_operation", "each operation must be an object", index)
      continue
    }
    const name = operationNameAndShape(operationValue, index, errors)
    if (!name) continue
    const operation = operationValue as unknown as ProposalOperation
    if (name === "no_change") {
      if (proposal.operations.length !== 1) addError(errors, "conflicting_no_change", "no_change must be the only operation", index)
      sawNoChange = true
      continue
    }
    if (sawNoChange) addError(errors, "conflicting_no_change", "no_change must be the only operation", index)

    const userSourceRequired = new Set([
      "create_task",
      "select_task",
      "suspend_task",
      "resume_task",
      "add_requirement",
      "replace_requirement",
      "withdraw_requirement",
      "add_unresolved",
      "resolve_unresolved",
      "add_authority",
      "replace_authority",
      "withdraw_authority",
    ]).has(name)
    const userSource = userSourceRequired ? normalizeUserSource(operation as UserOperationBase, context, errors, index) : undefined

    if (name === "create_task") {
      const description = prototypeText(
        operationRecord(operation).description,
        "description",
        errors,
        index,
      )
      const ref = registerLocalRef(operation, index, locals, errors)
      if (description && userSource && ref) {
        const id = nextId(next.task_occurrences, "task")
        next.task_occurrences.push({ id, description, status: "active", source: userSource, created_order: next.task_occurrences.length + 1 })
        if (ref) bindLocal(ref, id, "task")
      }
      continue
    }

    if (name === "select_task") {
      const rawTask = readString(operation, "task_id")
      const task = resolveTask(rawTask, next.task_occurrences, locals, errors, index)
      if (rawTask) checkTargetKind(rawTask, "task", index)
      markConflict("selection", index)
      if (task && task.status !== "active") addError(errors, "suspended_task_cannot_be_selected", "only an active task may be selected", index, "task_id")
      if (task) next.selected_task_id = task.id
      continue
    }

    if (name === "suspend_task" || name === "resume_task") {
      const rawTask = readString(operation, "task_id")
      const task = resolveTask(rawTask, next.task_occurrences, locals, errors, index)
      if (rawTask) checkTargetKind(rawTask, "task", index)
      if (task) {
        markConflict(`task:${task.id}:lifecycle`, index)
        const expected = name === "suspend_task" ? "active" : "suspended"
        if (task.status !== expected) addError(errors, "invalid_task_status_transition", `${name} requires task ${task.id} to be ${expected}`, index, "task_id")
        else task.status = name === "suspend_task" ? "suspended" : "active"
        if (task.status === "suspended" && next.selected_task_id === task.id) next.selected_task_id = null
      }
      continue
    }

    if (name === "add_requirement") {
      const rawTask = readString(operation, "task_id")
      const task = resolveTask(rawTask, next.task_occurrences, locals, errors, index)
      if (rawTask) checkTargetKind(rawTask, "task", index)
      const text = prototypeText(operationRecord(operation).text, "text", errors, index)
      const ref = registerLocalRef(operation, index, locals, errors)
      if (task && text && userSource && ref) {
        const id = nextId(next.requirements, "requirement")
        next.requirements.push({ id, task_id: task.id, text, status: "active", source: userSource, created_order: next.requirements.length + 1 })
        if (ref) bindLocal(ref, id, "requirement")
      }
      continue
    }

    if (name === "replace_requirement") {
      const rawRequirement = readString(operation, "requirement_id")
      const old = resolveRequirement(rawRequirement, next.requirements, locals, errors, index)
      if (rawRequirement) checkTargetKind(rawRequirement, "requirement", index)
      if (old) markConflict(`requirement:${old.id}:terminal`, index)
      const text = prototypeText(operationRecord(operation).text, "text", errors, index)
      const ref = registerLocalRef(operation, index, locals, errors)
      if (old && text && userSource && ref && old.status === "active") {
        const id = nextId(next.requirements, "requirement")
        old.status = "superseded"
        old.replaced_by = id
        next.requirements.push({ id, task_id: old.task_id, text, status: "active", source: userSource, created_order: next.requirements.length + 1, replacement_of: old.id })
        if (ref) bindLocal(ref, id, "requirement")
      } else if (old && old.status !== "active") {
        addError(errors, "invalid_requirement_status_transition", "only an active requirement may be replaced", index, "requirement_id")
      }
      continue
    }

    if (name === "withdraw_requirement") {
      const rawRequirement = readString(operation, "requirement_id")
      const requirement = resolveRequirement(rawRequirement, next.requirements, locals, errors, index)
      if (rawRequirement) checkTargetKind(rawRequirement, "requirement", index)
      if (requirement) {
        markConflict(`requirement:${requirement.id}:terminal`, index)
        if (requirement.status !== "active") addError(errors, "invalid_requirement_status_transition", "only an active requirement may be withdrawn", index, "requirement_id")
        else requirement.status = "withdrawn"
      }
      continue
    }

    if (name === "add_unresolved") {
      const rawTask = readString(operation, "task_id")
      const task = resolveTask(rawTask, next.task_occurrences, locals, errors, index)
      if (rawTask) checkTargetKind(rawTask, "task", index)
      const alternatives = readStringArray(operation, "alternatives")
      if (!alternatives || alternatives.length < 2) addError(errors, "invalid_unresolved_alternatives", "add_unresolved requires at least two alternatives", index, "alternatives")
      else alternatives.forEach((alternative) => prototypeText(alternative, "alternative", errors, index))
      const ref = registerLocalRef(operation, index, locals, errors)
      if (task && alternatives && alternatives.length >= 2 && userSource && ref && alternatives.every((alternative) => alternative.startsWith(PROTOTYPE_PREFIX))) {
        const id = nextId(next.unresolved_content, "unresolved")
        next.unresolved_content.push({ id, task_id: task.id, alternatives, status: "open", source: userSource, created_order: next.unresolved_content.length + 1 })
        if (ref) bindLocal(ref, id, "unresolved")
      }
      continue
    }

    if (name === "resolve_unresolved") {
      const rawUnresolved = readString(operation, "unresolved_id")
      const item = resolveUnresolved(rawUnresolved, next.unresolved_content, locals, errors, index)
      if (rawUnresolved) checkTargetKind(rawUnresolved, "unresolved", index)
      if (item) {
        markConflict(`unresolved:${item.id}:terminal`, index)
        if (item.status !== "open") addError(errors, "invalid_unresolved_status_transition", "only open unresolved content may be resolved", index, "unresolved_id")
        const resolution = readString(operation, "resolution")
        if (!resolution) addError(errors, "missing_resolution", "resolve_unresolved requires a resolution", index, "resolution")
        if (resolution && !item.alternatives.includes(resolution)) addError(errors, "resolution_not_an_alternative", "resolution must be one of the recorded alternatives", index, "resolution")
        if (item.status === "open" && userSource && resolution && item.alternatives.includes(resolution)) {
          item.status = "resolved"
          item.resolution = resolution
          item.resolved_source = userSource
        }
      }
      continue
    }

    if (name === "add_authority") {
      const scope = readString(operation, "scope")
      const text = prototypeText(operationRecord(operation).text, "text", errors, index)
      if (scope !== "global" && scope !== "task") addError(errors, "invalid_authority_scope", "Authority scope must be global or task", index, "scope")
      let task: TaskOccurrenceRecord | undefined
      if (scope === "task") {
        const rawTask = readString(operation, "task_id")
        task = resolveTask(rawTask, next.task_occurrences, locals, errors, index)
        if (rawTask) checkTargetKind(rawTask, "task", index)
      } else if (scope === "global" && Object.prototype.hasOwnProperty.call(operationRecord(operation), "task_id")) {
        addError(errors, "global_authority_has_task", "global Authority cannot carry task_id", index, "task_id")
      }
      const ref = registerLocalRef(operation, index, locals, errors)
      if ((scope === "global" || task) && text && userSource && ref) {
        const id = nextId(next.authorities, "authority")
        next.authorities.push({ id, scope: scope as "global" | "task", task_id: task?.id, text, status: "active", source: userSource, created_order: next.authorities.length + 1 })
        if (ref) bindLocal(ref, id, "authority")
      }
      continue
    }

    if (name === "replace_authority") {
      const rawAuthority = readString(operation, "authority_id")
      const old = resolveAuthority(rawAuthority, next.authorities, locals, errors, index)
      if (rawAuthority) checkTargetKind(rawAuthority, "authority", index)
      if (old) markConflict(`authority:${old.id}:terminal`, index)
      const text = prototypeText(operationRecord(operation).text, "text", errors, index)
      const ref = registerLocalRef(operation, index, locals, errors)
      if (old && text && userSource && ref && old.status === "active") {
        if (old.scope === "global" || old.task_id !== undefined) {
          const id = nextId(next.authorities, "authority")
          old.status = "superseded"
          old.replaced_by = id
          next.authorities.push({ id, scope: old.scope, task_id: old.task_id, text, status: "active", source: userSource, created_order: next.authorities.length + 1, replacement_of: old.id })
          if (ref) bindLocal(ref, id, "authority")
        }
      } else if (old && old.status !== "active") {
        addError(errors, "invalid_authority_status_transition", "only an active Authority may be replaced", index, "authority_id")
      }
      continue
    }

    if (name === "withdraw_authority") {
      const rawAuthority = readString(operation, "authority_id")
      const authority = resolveAuthority(rawAuthority, next.authorities, locals, errors, index)
      if (rawAuthority) checkTargetKind(rawAuthority, "authority", index)
      if (authority) {
        markConflict(`authority:${authority.id}:terminal`, index)
        if (authority.status !== "active") addError(errors, "invalid_authority_status_transition", "only an active Authority may be withdrawn", index, "authority_id")
        else authority.status = "withdrawn"
      }
      continue
    }

    if (name === "record_execution_fact") {
      const rawTask = readString(operation, "task_id")
      const task = resolveTask(rawTask, next.task_occurrences, locals, errors, index)
      if (rawTask) checkTargetKind(rawTask, "task", index)
      const selectedEvidence = evidenceForOperation(operation, admittedEvidence, task, errors, index)
      const content = prototypeText(operationRecord(operation).content, "content", errors, index)
      const ref = registerLocalRef(operation, index, locals, errors)
      if (task && selectedEvidence.length > 0 && content && ref) {
        const id = nextId(next.execution_facts, "fact")
        next.execution_facts.push({ id, task_id: task.id, content, evidence_ids: selectedEvidence.map((item) => item.id), source: { channel: "evidence", evidence_ids: selectedEvidence.map((item) => item.id) }, created_order: next.execution_facts.length + 1 })
        bindLocal(ref, id, "fact")
        if (selectedEvidence.some(workspaceMutation)) {
          const status = next.execution_statuses.find((record) => record.task_id === task.id)
          if (status && status.status === "verified_complete") next.execution_statuses[next.execution_statuses.indexOf(status)] = appendStatusHistory(status, "in_progress", selectedEvidence.map((item) => item.id), selectedEvidence.find((item) => item.workspace_snapshot_id)?.workspace_snapshot_id)
        }
      }
      continue
    }

    if (name === "record_execution_status") {
      const rawTask = readString(operation, "task_id")
      const task = resolveTask(rawTask, next.task_occurrences, locals, errors, index)
      if (rawTask) checkTargetKind(rawTask, "task", index)
      const statusValue = readString(operation, "status")
      if (!statusValue || !EXECUTION_STATUSES.has(statusValue as ExecutionStatus)) addError(errors, "invalid_execution_status", "execution status is not recognized", index, "status")
      const selectedEvidence = evidenceForOperation(operation, admittedEvidence, task, errors, index)
      const nextStatus = statusValue as ExecutionStatus
      const workspaceSnapshotId = readString(operation, "workspace_snapshot_id")
      if (nextStatus === "verified_complete") {
        const currentSnapshotId = context.current_workspace_snapshot_id
        if (typeof currentSnapshotId !== "string" || currentSnapshotId.length === 0) {
          addError(errors, "missing_workspace_snapshot", "verified_complete requires the current workspace snapshot", index, "workspace_snapshot_id")
        } else {
          if (workspaceSnapshotId !== undefined && workspaceSnapshotId !== currentSnapshotId) {
            addError(errors, "workspace_snapshot_mismatch", "workspace_snapshot_id must match the current workspace snapshot", index, "workspace_snapshot_id")
          }
          const verifierEvidence = selectedEvidence.filter((item) => evidenceKindIs(item, "verifier_pass", "test_pass", "check_pass", "verifier_result"))
          if (verifierEvidence.some((item) => item.workspace_snapshot_id !== currentSnapshotId)) {
            addError(errors, "evidence_workspace_snapshot_mismatch", "verifier evidence must reference the current workspace snapshot", index, "evidence_ids")
          }
        }
      }
      if (statusValue && EXECUTION_STATUSES.has(nextStatus) && !statusEvidenceAllowed(nextStatus, selectedEvidence, context, errors, index)) {
        // statusEvidenceAllowed records the precise reason.
      }
      if (task && statusValue && EXECUTION_STATUSES.has(nextStatus) && statusEvidenceAllowed(nextStatus, selectedEvidence, context, [], index)) {
        const current = next.execution_statuses.find((record) => record.task_id === task.id)
        const currentStatus = current?.status ?? "unknown"
        if (!statusTransitionAllowed(currentStatus, nextStatus, selectedEvidence)) addError(errors, "invalid_execution_status_transition", `cannot change execution status from ${currentStatus} to ${nextStatus}`, index, "status")
        const effectiveWorkspaceSnapshotId = workspaceSnapshotId ?? selectedEvidence.find((item) => item.workspace_snapshot_id)?.workspace_snapshot_id
        if (!current) {
          const id = `execution-status-${task.id}`
          next.execution_statuses.push({ id, task_id: task.id, status: nextStatus, evidence_ids: selectedEvidence.map((item) => item.id), workspace_snapshot_id: effectiveWorkspaceSnapshotId, history: [{ status: nextStatus, evidence_ids: selectedEvidence.map((item) => item.id), workspace_snapshot_id: effectiveWorkspaceSnapshotId }] })
        } else if (statusTransitionAllowed(currentStatus, nextStatus, selectedEvidence)) {
          const sameEvidence = current.evidence_ids.length === selectedEvidence.length && current.evidence_ids.every((id, evidenceIndex) => id === selectedEvidence[evidenceIndex].id)
          if (current.status === nextStatus && sameEvidence && current.workspace_snapshot_id === effectiveWorkspaceSnapshotId) continue
          next.execution_statuses[next.execution_statuses.indexOf(current)] = appendStatusHistory(current, nextStatus, selectedEvidence.map((item) => item.id), effectiveWorkspaceSnapshotId)
        }
      }
      continue
    }
  }

  if (errors.length > 0) return { ok: false, accepted: false, changed: false, state, errors, operation_ids: operationIds, proposal_local_ids: operationLocalIds }

  const withoutDigest = stripStateDigest(next)
  const candidatePayload = statePayload(withoutDigest)
  const previousPayload = statePayload(stripStateDigest(state))
  const changed = stableJson(candidatePayload) !== stableJson(previousPayload)
  const committed = changed
    ? withStateDigest({ ...withoutDigest, state_version: state.state_version + 1 })
    : state
  return {
    ok: true,
    accepted: true,
    changed,
    state: committed,
    errors: [],
    operation_ids: operationIds,
    proposal_local_ids: operationLocalIds,
  }
}

function compiledPayload(state: IntentState): Omit<CompiledIntentArtifact, "artifact_digest" | "artifact_version"> {
  const selected = state.selected_task_id ? state.task_occurrences.find((task) => task.id === state.selected_task_id) : undefined
  const task = selected
    ? {
        id: selected.id,
        description: selected.description,
        source: selected.source,
        source_ids: sourceId(selected.source),
      }
    : null
  const selectedRequirements = selected ? state.requirements.filter((requirement) => requirement.task_id === selected.id) : []
  const activeRequirements = selectedRequirements.filter((requirement) => requirement.status === "active").map((requirement) => ({
    ...requirement,
    source_ids: sourceId(requirement.source),
    executor_use: "apply" as const,
  }))
  const inactiveRequirements = selectedRequirements.filter((requirement) => requirement.status !== "active").map((requirement) => ({
    ...requirement,
    source_ids: sourceId(requirement.source),
    executor_use: "do_not_apply" as const,
  }))
  const openUnresolved = selected
    ? state.unresolved_content.filter((item) => item.task_id === selected.id && item.status === "open").map((item) => ({
        id: item.id,
        task_id: item.task_id,
        alternatives: item.alternatives,
        status: "open" as const,
        source: item.source,
        source_ids: sourceId(item.source),
      }))
    : []
  const authorities = state.authorities
    .filter((authority) => authority.status === "active" && (authority.scope === "global" || (selected && authority.task_id === selected.id)))
    .map((authority) => ({
      id: authority.id,
      scope: authority.scope,
      ...(authority.task_id ? { task_id: authority.task_id } : {}),
      text: authority.text,
      status: "active" as const,
      source: authority.source,
      source_ids: sourceId(authority.source),
    }))
  const executionFacts = selected
    ? state.execution_facts.filter((fact) => fact.task_id === selected.id).map((fact) => ({
        id: fact.id,
        task_id: fact.task_id,
        content: fact.content,
        evidence_ids: fact.evidence_ids,
        source_ids: [...fact.evidence_ids],
      }))
    : []
  const executionStatuses = selected
    ? state.execution_statuses.filter((status) => status.task_id === selected.id).map((status) => ({
        id: status.id,
        task_id: status.task_id,
        status: status.status,
        evidence_ids: status.evidence_ids,
        source_ids: [...status.evidence_ids],
        ...(status.workspace_snapshot_id ? { workspace_snapshot_id: status.workspace_snapshot_id } : {}),
      }))
    : []
  const sourceIds = [
    ...(task?.source_ids ?? []),
    ...activeRequirements.flatMap((item) => item.source_ids),
    ...inactiveRequirements.flatMap((item) => item.source_ids),
    ...openUnresolved.flatMap((item) => item.source_ids),
    ...authorities.flatMap((item) => item.source_ids),
    ...executionFacts.flatMap((item) => item.source_ids),
    ...executionStatuses.flatMap((item) => item.source_ids),
  ]
  const uniqueSourceIds = [...new Set(sourceIds)]
  return {
    artifact_type: "compiled_intent",
    schema_version: 1,
    state_version: state.state_version,
    state_digest: state.state_digest,
    selected_task: task,
    active_requirements: activeRequirements,
    inactive_requirements: inactiveRequirements,
    open_unresolved: openUnresolved,
    authorities,
    execution_facts: executionFacts,
    execution_statuses: executionStatuses,
    source_ids: uniqueSourceIds,
    ...(openUnresolved.length > 0 ? { unresolved_restriction: "Do not make workspace changes that depend on choosing one alternative." } : {}),
  }
}

/** Deterministically project one committed state; no model, file, or client is touched. */
export function projectCompiledIntent(stateInput: IntentState, options: ProjectionOptions = {}): CompiledIntentProjection {
  const projectionFields = new Set(["max_artifact_bytes", "max_rendered_bytes", "previous"])
  for (const key of Object.keys(options as unknown as Record<string, unknown>)) {
    if (!projectionFields.has(key)) throw new Error(`unknown projection option ${key}`)
  }
  const state = canonicalState(stateInput)
  const payload = compiledPayload(state)
  const payloadDigest = digest(payload)
  let artifactVersion = state.state_version
  // The state version and digest are part of the canonical artifact. When
  // both match, projection is necessarily the same payload, so an earlier
  // artifact version can be reused (notably across a genuine no-op turn).
  if (options.previous && options.previous.artifact.state_version === state.state_version && options.previous.artifact.state_digest === state.state_digest) {
    artifactVersion = options.previous.artifact.artifact_version
  }
  const artifactWithoutDigest = { ...payload, artifact_version: artifactVersion }
  const artifactDigest = digest(artifactWithoutDigest)
  const artifact: CompiledIntentArtifact = { ...artifactWithoutDigest, artifact_digest: artifactDigest }
  const canonicalArtifact = stableJson(artifact)
  const renderedText = `${JSON.stringify(canonicalize(artifact), null, 2)}\n`
  const artifactMax = options.max_artifact_bytes
  const renderedMax = options.max_rendered_bytes
  const artifactBytes = utf8Length(canonicalArtifact)
  const renderedBytes = utf8Length(renderedText)
  if (artifactMax !== undefined && artifactBytes > artifactMax) throw new CompiledIntentProjectionError("artifact_too_large", artifactBytes, artifactMax)
  if (renderedMax !== undefined && renderedBytes > renderedMax) throw new CompiledIntentProjectionError("rendered_text_too_large", renderedBytes, renderedMax)
  return {
    artifact,
    canonical_artifact: canonicalArtifact,
    rendered_text: renderedText,
    artifact_digest: artifactDigest,
    rendered_digest: digest(renderedText),
  }
}
