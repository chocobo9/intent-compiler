import { createHash } from "node:crypto"

/**
 * The v2 Intent Compiler exchange contract.  These types are the single
 * source of truth for the next candidate's events, references, persistent IR,
 * Compiled Intent, execution admission, and failure reporting.
 *
 * This module deliberately contains no host or model transport.  Callers own
 * authentication and provider behaviour; this module owns shapes, identities,
 * version rules, and deterministic validation only.
 */

export const SCHEMA_VERSION = 2 as const

export interface Ref {
  id: string
  revision: number
  digest: string
}

export interface SourceRef {
  source_id: string
  digest: string
  span?: { unit: "utf16"; start: number; end: number }
}

export interface Binding {
  binding_id: string
  revision: number
  ref?: Ref | SourceRef
  role: "task_data" | "context" | "example"
  purpose: string
  sources: SourceRef[]
}

export interface OutputSpec {
  output_id: string
  revision: number
  description: string
  format: "text" | "json" | "artifact"
  sources: SourceRef[]
}

export interface Scope {
  target_id: string
  path?: string
}

export interface Support {
  refs: Ref[]
  explanation: string
}

export interface ContentItem {
  item_id: string
  revision: number
  text: string
  sources: SourceRef[]
  about: Ref[]
  scope: Scope[]
  support: Support[]
}

export interface TaskIntent {
  task_id: string
  revision: number
  goal: { text: string; sources: SourceRef[] }
  bindings: Binding[]
  outputs: OutputSpec[]
  content: ContentItem[]
  current_scope: {
    text: string
    disposition: "proceed" | "paused" | "withdrawn" | "conditional"
    sources: SourceRef[]
  }
  unresolved: Array<{
    id: string
    question: string
    alternatives: string[]
    affects: Ref[]
    evidence_needed: string
  }>
}

export type IrChange =
  | {
      action: "create"
      target: "task" | "binding" | "output" | "content"
      local_ref: string
      value: unknown
      sources: SourceRef[]
    }
  | {
      action: "revise"
      target: "task" | "binding" | "output" | "content" | "current_scope"
      id: string
      expected_revision: number
      value: unknown
      sources: SourceRef[]
    }
  | {
      action: "retire"
      target: "binding" | "output" | "content"
      id: string
      expected_revision: number
      reason: string
      sources: SourceRef[]
    }
  | {
      action: "preserve"
      reason: string
      sources: SourceRef[]
    }

export interface PermissionRule {
  operation_id: string
  resource_ref: Ref | SourceRef
  input_refs: Array<Ref | SourceRef>
  output_refs: Array<Ref | SourceRef>
  conditions: Condition[]
  allowed_use: string
}

export interface Condition {
  kind:
    | "scope_allows"
    | "artifact_exists"
    | "assessment_supports"
    | "user_confirms"
    | "object_version_matches"
    | "capability_available"
    | "all"
    | "any"
  refs: Array<Ref | SourceRef>
  conditions?: Condition[]
  expectation?: string
}

export interface AtomInput {
  binding_id: string
  ref: Ref | SourceRef
  role: "task_data" | "context" | "example"
  use: string
}

export interface AtomOutput {
  output_id: string
  description: string
  format: "text" | "json" | "artifact"
}

export interface IntentJudgment {
  claim: string
  basis: Array<Ref | SourceRef>
  status: "supported" | "inferred" | "unresolved"
  consequence: string
}

export interface Atom {
  atom_id: string
  revision: number
  goal_refs: Ref[]
  task: string
  inputs: AtomInput[]
  outputs: AtomOutput[]
  constraints: Array<{
    text: string
    basis: Array<Ref | SourceRef>
    scope: Scope[]
  }>
  optional_tools: string[]
  authority: {
    basis: Array<Ref | SourceRef>
    rules: PermissionRule[]
    lifetime: "this_execution"
    delegation: "not_supported"
  }
  preconditions: Condition[]
  completion: Array<{ text: string; evidence_required: string }>
  return_when: string[]
  intent_judgments: IntentJudgment[]
}

export type AtomStatus = "ready" | "executing" | "completed" | "legacy" | "failed"

export interface Relation {
  predecessor: Ref
  successor: Ref
  requires: string
  conditions: Condition[]
  basis: Array<Ref | SourceRef>
}

export interface CompiledIntent {
  schema_version: 2
  artifact_type: "compiled_intent"
  compiled_intent_id: string
  task_id: string
  compiled_revision: number
  intent_basis: Ref[]
  atoms: Atom[]
  relations: Relation[]
  attachments: Array<Ref | SourceRef>
}

export interface ExecutionOutcome {
  schema_version: 2
  execution_id: string
  atom_ref: Ref
  suggested_status: AtomStatus
  product_refs: Array<Ref | SourceRef>
  file_changes: Array<{ path: string; digest: string }>
  evidence_refs: Array<Ref | SourceRef>
  failure_reason?: string
}

export interface ExecutionReturnPayload {
  state_claim: "completed" | "failed" | "blocked" | "stopped"
  reason?: string
  outcome: ExecutionOutcome
}

export interface ExecutionTask {
  schema_version: 2
  dispatch_id: string
  task_id: string
  compiled_revision: number
  atom_id: string
  instruction: string
  /** The executor gets the material reference, not just a binding label. */
  inputs: Array<{ id: string; ref: Ref | SourceRef; role: "task_data" | "context" | "example"; description: string }>
  outputs: Array<{ id: string; description: string; format: "text" | "json" | "artifact" }>
  tool_candidates: string[]
  permissions: PermissionRule[]
  completion_rules: string[]
  /** New deliveries always carry these; optional only for old host records. */
  constraints?: Atom["constraints"]
  return_when?: string[]
}

export interface CompiledIntentDraft {
  local_ref: string
  task_id: string
  intent_basis: Ref[]
  atoms: AtomDraft[]
  relations: Relation[]
  attachments: Array<Ref | SourceRef>
}

/**
 * What the model proposes for a new atom.  The atom itself is content only;
 * `previous_atom_ref` is a proposal that management records in the atom state
 * ledger as the supersession link, never on the atom.
 */
export interface AtomDraft extends Atom {
  previous_atom_ref?: Ref
}

/**
 * Lifecycle state lives outside the atom: a ledger keyed by the atom's
 * content identity.  Management code is the only writer; the executor may
 * only suggest a status through an ExecutionOutcome.
 */
export interface AtomStateRecord {
  task_id: string
  atom_id: string
  atom_revision: number
  compiled_intent_id: string
  status: AtomStatus
  updated_at: string
  created_at?: string
  previous_atom_ref?: Ref
  result_ref?: Ref
}

export interface AssessmentDraft {
  target_ref: Ref
  criteria_refs: Array<Ref | SourceRef>
  evidence_refs: Array<Ref | SourceRef>
  result: "satisfied" | "not_satisfied" | "unknown"
  explanation: string
  method: "deterministic" | "model" | "manual"
}

export interface CandidateGroup {
  local_ref: string
  task_refs: string[]
  depends_on: string[]
  ir_changes: IrChange[]
  compilation:
    | { decision: "reuse"; current: Ref[]; reason: string }
    | { decision: "replace"; drafts: CompiledIntentDraft[] }
  execution_decisions: Array<{
    execution_id: string
    decision: "continue" | "stop" | "await_result"
    reason: string
    basis: Ref[]
  }>
  assessments: AssessmentDraft[]
  coverage: Array<{
    requirement: Ref | { local_ref: string }
    disposition: "assigned" | "supported" | "paused" | "unresolved"
    refs: Array<Ref | { local_ref: string }>
    explanation: string
  }>
  checks: Array<{
    scenario: string
    expected: string
    observed_in_candidate: string
    sources: SourceRef[]
    unresolved: boolean
  }>
  questions: Array<{ text: string; affects: string[] }>
}

export interface Candidate {
  schema_version: 2
  basis: { event_ids: string[]; refs: Ref[] }
  groups: CandidateGroup[]
}

/**
 * A management record of where a task's goal went in one batch.  Persisted
 * with the batch that produced it so the destination survives after the
 * candidate itself is gone.
 */
export interface CoverageRecord {
  requirement: Ref | { local_ref: string }
  disposition: "assigned" | "supported" | "paused" | "unresolved"
  refs: Array<Ref | { local_ref: string }>
  explanation: string
  basis_event_ids: string[]
  sequence: number
  task_id?: string
}

/**
 * Facts the host knows and the management model cannot derive: which
 * operations the executor can be granted, where the workspace root is, and
 * whether each path this batch names actually exists and is readable.  The
 * catalog never carries file content or business answers.
 */
export interface MaterialFact {
  path: string
  exists: boolean
  readable_by_executor: boolean
}

export interface CapabilityCatalog {
  operations: string[]
  workspace_root?: string
  material: MaterialFact[]
}

/**
 * The independent semantic check of one batch: it reads the original input,
 * the candidate, and the current IR, and may only report inconsistencies.
 */
export interface SemanticCheckFinding {
  claim: string
  expected: string
  observed: string
  refs: Array<Ref | SourceRef>
  /** Which question the check was answering (D1…D6), as the checker declared it. */
  dimension?: string
  /**
   * Whether any of `refs` resolves against this batch or the current IR.
   * A finding whose evidence does not resolve is recorded but does not block:
   * otherwise an objection that cites nothing can stop a whole batch, which is
   * what happened in r10.
   */
  evidence_resolved?: boolean
}

export interface SemanticCheckRecord {
  basis_event_ids: string[]
  sequence: number
  /**
   * `unavailable` means the check never produced a verdict (its transport
   * failed, or its answer did not fit the contract).  It is not a judgment
   * about the candidate, so it must not be read as one.
   */
  verdict: "consistent" | "inconsistent" | "unavailable"
  findings: SemanticCheckFinding[]
  task_ids: string[]
  provider?: string
  model?: string
  /** Digest of the checker's raw answer, so a rejection stays auditable. */
  response_digest?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    reasoning_tokens?: number
    cache_read_tokens?: number
    cache_write_tokens?: number
    cost?: number
  }
}

export interface CompilerEvent {
  schema_version: 2
  run_id: string
  event_id: string
  kind:
    | "user_input"
    | "execution_progress"
    | "execution_return"
    | "operation_result"
    | "capability_change"
    | "delivery_ack"
  source: { producer_id: string; channel: "user" | "executor" | "host" }
  task_ids?: string[]
  execution_id?: string
  payload: unknown
}

export interface EventReceipt {
  ok: boolean
  run_id: string
  event_id: string
  status: "saved" | "duplicate" | "rejected"
  sequence: number
  code?: string
  message?: string
}

export interface StartRequest {
  kind: "start"
  run_id: string
  dispatch_id: string
  host_identity: string
}

export interface OperationRequest {
  kind: "operation"
  run_id: string
  execution_id: string
  host_identity?: string
  host_call_id: string
  operation_id: string
  resource_ref: Ref | SourceRef
  input_refs: Array<Ref | SourceRef>
  output_refs: Array<Ref | SourceRef>
  invocation?: {
    tool: string
    args_digest: string
    raw_args?: unknown
  }
}

export type AuthorizeRequest = StartRequest | OperationRequest

export interface AuthorizationResult {
  ok: boolean
  run_id: string
  execution_id?: string
  allowed_call_id?: string
  code?: string
  message?: string
}

export interface AdvanceResult {
  ok: boolean
  run_id: string
  disposition:
    | "dispatched"
    | "continuing"
    | "revised"
    | "clarifying"
    | "unchanged"
    | "failed"
    | "waiting"
  pending_events: string[]
  compiled_revisions: Record<string, number>
  ir_revisions: Record<string, number>
  /**
   * Whether spending another advance round on the same pending events is worth
   * it: true only for transport-level failures, where a fresh round can
   * plausibly differ.  Semantic or mechanical rejections set it false — a
   * re-roll of the same contract gap repeats the same failure.
   */
  retryable?: boolean
  deliveries?: Array<{
    dispatch_id: string
    task_id: string
    atom_id: string
    digest: string
    compiled_revision: number
    atom: Atom
    execution_task?: ExecutionTask
  }>
  questions?: string[]
  code?: string
  message?: string
}

export interface RunView {
  run_id: string
  schema_version: 2
  current_ir: Record<string, TaskIntent>
  current_compiled: Record<string, CompiledIntent>
  pending_event_ids: string[]
  unresolved_user_event_ids?: string[]
  execution_eligibility?: { task_ids: string[]; execution_ids: string[] }
  executions: ExecutionView[]
  coverage: CoverageRecord[]
  atom_states: AtomStateRecord[]
  semantic_checks: SemanticCheckRecord[]
  denied_calls: Array<{
    kind: "start" | "operation"
    at: string
    code: string
    message: string
    execution_id?: string
    dispatch_id?: string
    host_call_id?: string
    operation_id?: string
    tool?: string
    args_digest?: string
  }>
}

export interface ExecutionView {
  execution_id: string
  dispatch_id: string
  task_id: string
  atom_id: string
  status: "pending_start" | "active" | "closed" | "blocked"
  host_identity?: string
  closed_reason?: string
}

export class IntentContractError extends Error {
  readonly code: string
  readonly path?: string

  constructor(code: string, message: string, path?: string) {
    super(message)
    this.name = "IntentContractError"
    this.code = code
    this.path = path
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function digestOf(value: unknown): string {
  return `sha256:${createHash("sha256").update(Buffer.from(canonicalJson(value), "utf8")).digest("hex")}`
}

export function digestText(value: string): string {
  return `sha256:${createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex")}`
}

export function isRef(value: unknown): value is Ref {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    Number.isSafeInteger(value.revision) &&
    (value.revision as number) >= 0 &&
    typeof value.digest === "string" &&
    value.digest.length > 0
  )
}

export function isSourceRef(value: unknown): value is SourceRef {
  if (!isRecord(value)) return false
  if (typeof value.source_id !== "string" || value.source_id.length === 0) return false
  if (typeof value.digest !== "string" || value.digest.length === 0) return false
  if (value.span === undefined) return true
  if (!isRecord(value.span) || value.span.unit !== "utf16") return false
  return Number.isSafeInteger(value.span.start) && Number.isSafeInteger(value.span.end) && (value.span.start as number) >= 0 && (value.span.end as number) > (value.span.start as number)
}

export function isRefOrSource(value: unknown): value is Ref | SourceRef {
  return isRef(value) || isSourceRef(value)
}

export function refKey(value: Ref | SourceRef): string {
  if (isRef(value)) return `${value.id}@${value.revision}:${value.digest}`
  return `${value.source_id}:${value.digest}${value.span ? `[${value.span.start},${value.span.end})` : ""}`
}

export function requireNonEmptyString(value: unknown, label: string, path?: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new IntentContractError("INVALID_VALUE", `${label} must be non-empty text`, path)
  }
  return value
}

export function requireNonNegativeInteger(value: unknown, label: string, path?: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new IntentContractError("INVALID_VALUE", `${label} must be a non-negative integer`, path)
  }
  return value as number
}

export function validateEvent(event: unknown): CompilerEvent {
  if (!isRecord(event)) throw new IntentContractError("invalid_candidate", "CompilerEvent must be an object", "$")
  if (!Number.isSafeInteger(event.schema_version) || event.schema_version !== SCHEMA_VERSION) {
    throw new IntentContractError("source_invalid", `unsupported CompilerEvent schema_version: ${String(event.schema_version)}`, "$.schema_version")
  }
  const runId = requireNonEmptyString(event.run_id, "run_id", "$.run_id")
  const eventId = requireNonEmptyString(event.event_id, "event_id", "$.event_id")
  if (!isRecord(event.source)) throw new IntentContractError("invalid_candidate", "source must be an object", "$.source")
  requireNonEmptyString(event.source.producer_id, "source.producer_id", "$.source.producer_id")
  if (!["user", "executor", "host"].includes(event.source.channel)) {
    throw new IntentContractError("invalid_candidate", "source.channel must be user, executor, or host", "$.source.channel")
  }
  if (!["user_input", "execution_progress", "execution_return", "operation_result", "capability_change", "delivery_ack"].includes(event.kind)) {
    throw new IntentContractError("invalid_candidate", `unknown event kind: ${String(event.kind)}`, "$.kind")
  }
  if (event.task_ids !== undefined && !isStringArray(event.task_ids)) {
    throw new IntentContractError("invalid_candidate", "task_ids must be an array of strings", "$.task_ids")
  }
  if (event.execution_id !== undefined) requireNonEmptyString(event.execution_id, "execution_id", "$.execution_id")
  if (event.kind === "execution_return" && !event.execution_id) {
    throw new IntentContractError("invalid_candidate", "execution_return requires execution_id", "$.execution_id")
  }
  if (event.kind === "execution_return") {
    validateExecutionReturnPayload(event.payload, event.execution_id as string)
  }
  return event as CompilerEvent
}

export function validateExecutionOutcome(value: unknown): ExecutionOutcome {
  if (!isRecord(value)) {
    throw new IntentContractError("source_invalid", "execution_return outcome must be an object", "$.payload.outcome")
  }
  if (value.schema_version !== SCHEMA_VERSION) {
    throw new IntentContractError("source_invalid", "outcome schema_version must be 2", "$.payload.outcome.schema_version")
  }
  const executionId = requireNonEmptyString(value.execution_id, "outcome.execution_id", "$.payload.outcome.execution_id")
  if (!isRef(value.atom_ref)) {
    throw new IntentContractError("source_invalid", "outcome.atom_ref must be a valid Ref", "$.payload.outcome.atom_ref")
  }
  if (value.suggested_status !== "completed" && value.suggested_status !== "failed" && value.suggested_status !== "ready") {
    throw new IntentContractError(
      "source_invalid",
      "outcome.suggested_status must be completed, failed, or ready",
      "$.payload.outcome.suggested_status",
    )
  }
  for (const [key, label] of [["product_refs", "product_refs"], ["evidence_refs", "evidence_refs"]] as const) {
    if (!Array.isArray(value[key]) || !value[key].every(isRefOrSource)) {
      throw new IntentContractError("source_invalid", `outcome.${label} must be an array of valid refs`, `$.payload.outcome.${label}`)
    }
  }
  if (!Array.isArray(value.file_changes) || !value.file_changes.every(isFileChange)) {
    throw new IntentContractError(
      "source_invalid",
      "outcome.file_changes must be an array of { path, digest } objects",
      "$.payload.outcome.file_changes",
    )
  }
  if (value.failure_reason !== undefined) {
    requireNonEmptyString(value.failure_reason, "outcome.failure_reason", "$.payload.outcome.failure_reason")
  }
  return value as unknown as ExecutionOutcome
}

export function validateExecutionReturnPayload(payload: unknown, executionId: string): ExecutionReturnPayload {
  if (!isRecord(payload)) {
    throw new IntentContractError("source_invalid", "execution_return payload must be an object", "$.payload")
  }
  const stateClaim = payload.state_claim
  if (stateClaim !== "completed" && stateClaim !== "failed" && stateClaim !== "blocked" && stateClaim !== "stopped") {
    throw new IntentContractError(
      "source_invalid",
      "execution_return payload.state_claim must be completed, failed, blocked, or stopped",
      "$.payload.state_claim",
    )
  }
  if (payload.reason !== undefined) {
    requireNonEmptyString(payload.reason, "payload.reason", "$.payload.reason")
  }
  const outcome = validateExecutionOutcome(payload.outcome)
  if (outcome.execution_id !== executionId) {
    throw new IntentContractError(
      "identity_conflict",
      "outcome.execution_id must match the event execution_id",
      "$.payload.outcome.execution_id",
    )
  }
  const expectedSuggested = stateClaim === "completed" ? "completed" : stateClaim === "failed" ? "failed" : "ready"
  if (outcome.suggested_status !== expectedSuggested) {
    throw new IntentContractError(
      "source_invalid",
      `payload.state_claim ${String(stateClaim)} requires outcome.suggested_status ${expectedSuggested}`,
      "$.payload.outcome.suggested_status",
    )
  }
  return { state_claim: stateClaim, outcome, ...(payload.reason === undefined ? {} : { reason: payload.reason }) }
}

function isFileChange(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    typeof value.digest === "string" &&
    value.digest.length > 0
  )
}

export function validateCandidate(value: unknown): Candidate {
  if (!isRecord(value)) throw new IntentContractError("invalid_candidate", "Candidate must be an object", "$")
  requireNonNegativeInteger(value.schema_version, "schema_version", "$.schema_version")
  if (value.schema_version !== SCHEMA_VERSION) {
    throw new IntentContractError("invalid_candidate", `unsupported Candidate schema_version: ${String(value.schema_version)}`, "$.schema_version")
  }
  if (!isRecord(value.basis) || !Array.isArray(value.basis.event_ids) || !Array.isArray(value.basis.refs)) {
    throw new IntentContractError("invalid_candidate", "basis must contain event_ids and refs arrays", "$.basis")
  }
  if (!Array.isArray(value.groups)) throw new IntentContractError("invalid_candidate", "groups must be an array", "$.groups")
  for (const group of value.groups) {
    if (!isRecord(group)) throw new IntentContractError("invalid_candidate", "each group must be an object", "$.groups")
    requireNonEmptyString(group.local_ref, "group.local_ref", "$.groups.local_ref")
    if (!Array.isArray(group.task_refs)) throw new IntentContractError("invalid_candidate", "group.task_refs must be an array", "$.groups.task_refs")
    if (!Array.isArray(group.ir_changes)) throw new IntentContractError("invalid_candidate", "group.ir_changes must be an array", "$.groups.ir_changes")
    if (!isRecord(group.compilation)) throw new IntentContractError("invalid_candidate", "group.compilation must be an object", "$.groups.compilation")
  }
  return value as unknown as Candidate
}

export function validateCompiledIntent(value: unknown): CompiledIntent {
  if (!isRecord(value)) throw new IntentContractError("invalid_candidate", "CompiledIntent must be an object", "$")
  if (value.schema_version !== SCHEMA_VERSION || value.artifact_type !== "compiled_intent") {
    throw new IntentContractError("invalid_candidate", "CompiledIntent must use schema_version 2 and artifact_type compiled_intent", "$")
  }
  const taskId = requireNonEmptyString(value.task_id, "task_id", "$.task_id")
  requireNonEmptyString(value.compiled_intent_id, "compiled_intent_id", "$.compiled_intent_id")
  requireNonNegativeInteger(value.compiled_revision, "compiled_revision", "$.compiled_revision")
  if (!Array.isArray(value.atoms) || !Array.isArray(value.relations) || !Array.isArray(value.attachments)) {
    throw new IntentContractError("invalid_candidate", "atoms, relations, and attachments must be arrays", "$")
  }
  for (const atom of value.atoms) validateAtom(atom)
  for (const relation of value.relations) {
    if (!isRecord(relation) || !isRef(relation.predecessor) || !isRef(relation.successor)) {
      throw new IntentContractError("invalid_candidate", "each relation must contain valid predecessor and successor refs", "$.relations")
    }
  }
  return value as unknown as CompiledIntent
}

function validateAtom(value: unknown): void {
  if (!isRecord(value)) throw new IntentContractError("invalid_candidate", "each atom must be an object", "$.atoms")
  requireNonEmptyString(value.atom_id, "atom_id", "$.atoms.atom_id")
  requireNonNegativeInteger(value.revision, "atom revision", "$.atoms.revision")
  if (!Array.isArray(value.inputs) || !Array.isArray(value.outputs) || !Array.isArray(value.constraints) || !Array.isArray(value.optional_tools) || !Array.isArray(value.preconditions) || !Array.isArray(value.completion) || !Array.isArray(value.return_when) || !Array.isArray(value.intent_judgments)) {
    throw new IntentContractError("invalid_candidate", "atom collections must be arrays", "$.atoms")
  }
  if (!isRecord(value.authority) || value.authority.lifetime !== "this_execution" || value.authority.delegation !== "not_supported" || !Array.isArray(value.authority.rules)) {
    throw new IntentContractError("invalid_candidate", "atom authority must be this_execution with not_supported delegation and rules", "$.atoms.authority")
  }
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((item) => canonicalize(item))
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    output[key] = canonicalize((value as Record<string, unknown>)[key])
  }
  return output
}

export function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
