import {
  refKey,
  type AuthorizationResult,
  type AssessmentDraft,
  type CapabilityCatalog,
  type ExecutionRetry,
  type Condition,
  type CompiledIntent,
  type OperationRequest,
  type Ref,
  type SourceRef,
  type StartRequest,
  type TaskIntent,
} from "./intent-contract.js"
import { atomRef } from "./compiled-intent.js"

export interface DispatchRecord {
  dispatch_id: string
  task_id: string
  compiled_intent_id: string
  atom_id: string
  atom_revision: number
  compiled_revision: number
  digest: string
  /** The returned execution whose retry decision created this dispatch. */
  retry_of?: string
}

export interface ExecutionRecord {
  execution_id: string
  dispatch_id: string
  task_id: string
  atom_id: string
  status: "pending_start" | "active" | "closed" | "blocked"
  host_identity?: string
  closed_reason?: string
  retry?: ExecutionRetry
  /**
   * Journal sequence of the latest user input when this execution started.
   * Executions of one Atom version are counted per such window; an execution
   * recorded before windows were kept carries none and counts in no window.
   */
  user_input_window?: number
  allowed_calls: Array<{
    allowed_call_id: string
    host_call_id: string
    operation_id: string
    tool?: string
    args_digest?: string
  }>
}

export interface AuthorizationContext {
  intent?: CompiledIntent
  ir?: Record<string, TaskIntent>
  capabilities?: { operations: readonly string[] }
  /** Management assessments recorded for this run, newest last. */
  assessments?: ReadonlyArray<AssessmentDraft & { task_id?: string }>
}

export type ConditionVerdict = "satisfied" | "unsatisfied" | "unsupported"

/**
 * Deterministic evaluation of the first supported condition kinds.  Unknown
 * kinds are reported as unsupported instead of being silently ignored, so a
 * rule whose conditions cannot be evaluated never widens permission.
 */
export function evaluateCondition(condition: Condition, context: AuthorizationContext = {}): ConditionVerdict {
  if (!isConditionRecord(condition)) return "unsupported"
  if (condition.kind === "all") return combineAll((condition.conditions ?? []).map((child) => evaluateCondition(child, context)))
  if (condition.kind === "any") return combineAny((condition.conditions ?? []).map((child) => evaluateCondition(child, context)))
  if (condition.kind === "scope_allows") {
    const taskId = context.intent?.task_id
    if (!taskId) return "unsupported"
    const disposition = context.ir?.[taskId]?.current_scope?.disposition
    if (disposition === "proceed") return "satisfied"
    if (disposition === "paused" || disposition === "withdrawn") return "unsatisfied"
    return "unsupported"
  }
  if (condition.kind === "capability_available") {
    const operation = typeof condition.expectation === "string" ? condition.expectation.trim() : ""
    if (operation.length === 0) return "unsupported"
    const operations = context.capabilities?.operations
    if (operations === undefined) return "unsupported"
    return operations.includes(operation) ? "satisfied" : "unsatisfied"
  }
  if (condition.kind === "assessment_supports") {
    const target = condition.refs.find((ref): ref is Extract<typeof ref, { id: string }> => "id" in ref)
    if (target === undefined) return "unsupported"
    const assessments = context.assessments
    if (assessments === undefined) return "unsupported"
    return assessmentVerdict(target, assessments) === "satisfied" ? "satisfied" : "unsatisfied"
  }
  return "unsupported"
}

/**
 * The assessments that decide a target version: all records of the most recent
 * batch that assessed this exact version (id, revision and digest), in record
 * order.  Recorded assessments carry their batch sequence; drafts the batch
 * being prepared have not committed carry none and are the newest batch.  The
 * admission verdict and the model's request view both read this one rule.
 */
export function latestAssessmentBatch<A extends { target_ref: { id: string; revision: number; digest: string }; sequence?: number }>(
  target: { id: string; revision: number; digest: string },
  assessments: ReadonlyArray<A>,
): A[] {
  const judged = assessments.filter(assessment => assessment.target_ref.id === target.id
    && assessment.target_ref.revision === target.revision && assessment.target_ref.digest === target.digest)
  const latest = judged.at(-1)
  if (latest === undefined) return []
  return judged.filter(assessment => assessment.sequence === latest.sequence)
}

/**
 * Management's current judgement of this exact target version: all of its
 * assessments in the most recent batch that assessed it.  A batch often writes
 * several (one per completion entry); any not_satisfied among them decides,
 * then any unknown, else satisfied.  A later batch revises an earlier one.
 */
export function assessmentVerdict(
  target: Ref,
  assessments: ReadonlyArray<{ target_ref: { id: string; revision: number; digest: string }; result: string; sequence?: number }>,
): "satisfied" | "unknown" | "not_satisfied" | undefined {
  const batch = latestAssessmentBatch(target, assessments)
  if (batch.length === 0) return undefined
  if (batch.some(assessment => assessment.result === "not_satisfied")) return "not_satisfied"
  if (batch.some(assessment => assessment.result === "unknown")) return "unknown"
  return "satisfied"
}

/**
 * Pure execution admission rules.  The manager never calls business tools;
 * it records dispatch identities, execution identities, and per-operation
 * authorizations so the host adapter can enforce the actual call boundary.
 */
export class ExecutionStateManager {
  private readonly dispatches = new Map<string, DispatchRecord>()
  private readonly executions = new Map<string, ExecutionRecord>()
  private readonly byDispatch = new Map<string, ExecutionRecord>()
  private sequence = 0

  constructor(
    dispatches: readonly DispatchRecord[] = [],
    executions: readonly ExecutionRecord[] = [],
    sequence = 0,
  ) {
    for (const dispatch of dispatches) this.dispatches.set(dispatch.dispatch_id, { ...dispatch })
    for (const execution of executions) {
      this.executions.set(execution.execution_id, { ...execution, allowed_calls: [...execution.allowed_calls] })
      this.byDispatch.set(execution.dispatch_id, execution)
    }
    this.sequence = sequence
  }

  createDispatch(intent: CompiledIntent, atomId: string): DispatchRecord {
    const atom = intent.atoms.find((candidate) => candidate.atom_id === atomId)
    if (!atom) throw new Error(`unknown atom ${atomId} in compiled intent ${intent.task_id}`)
    const digest = atomRef(atom).digest
    // An offer is reused while it is unstarted or its execution is still open:
    // recompiling a task re-offers carried atoms, and the host keeps working
    // against the same dispatch.  Once every offer of this content has a closed
    // execution, offering it again means running it again, under a new dispatch
    // the host can tell apart.  New content always gets a new dispatch.
    const existing = [...this.dispatches.values()].find((candidate) => (
      candidate.task_id === intent.task_id
      && candidate.atom_id === atom.atom_id
      && candidate.atom_revision === atom.revision
      && candidate.digest === digest
      && this.byDispatch.get(candidate.dispatch_id)?.status !== "closed"
    ))
    if (existing !== undefined) return { ...existing }
    const dispatch: DispatchRecord = {
      dispatch_id: this.nextId("dispatch"),
      task_id: intent.task_id,
      compiled_intent_id: intent.compiled_intent_id,
      atom_id: atom.atom_id,
      atom_revision: atom.revision,
      compiled_revision: intent.compiled_revision,
      digest,
    }
    this.dispatches.set(dispatch.dispatch_id, dispatch)
    return dispatch
  }

  /**
   * A retry offers the same Atom version again under a dispatch of its own, so
   * the host can tell the new offer from the one that already ran.
   */
  createRetryDispatch(intent: CompiledIntent, atomId: string, retryOf: string): DispatchRecord {
    const atom = intent.atoms.find((candidate) => candidate.atom_id === atomId)
    if (!atom) throw new Error(`unknown atom ${atomId} in compiled intent ${intent.task_id}`)
    const dispatch: DispatchRecord = {
      dispatch_id: this.nextId("dispatch"),
      task_id: intent.task_id,
      compiled_intent_id: intent.compiled_intent_id,
      atom_id: atom.atom_id,
      atom_revision: atom.revision,
      compiled_revision: intent.compiled_revision,
      digest: atomRef(atom).digest,
      retry_of: retryOf,
    }
    this.dispatches.set(dispatch.dispatch_id, dispatch)
    return dispatch
  }

  /** Executions started for this exact Atom version, under any of its dispatches. */
  executionsOfVersion(taskId: string, atomId: string, revision: number, digest: string): ExecutionRecord[] {
    return [...this.executions.values()].filter((execution) => {
      const dispatch = this.dispatches.get(execution.dispatch_id)
      return dispatch !== undefined && dispatch.task_id === taskId && dispatch.atom_id === atomId
        && dispatch.atom_revision === revision && dispatch.digest === digest
    })
  }

  /** Executions of this Atom version since the given user input. */
  executionsInWindow(taskId: string, atomId: string, revision: number, digest: string, userInputWindow: number | undefined): ExecutionRecord[] {
    return this.executionsOfVersion(taskId, atomId, revision, digest)
      .filter((execution) => execution.user_input_window !== undefined && execution.user_input_window === userInputWindow)
  }

  /** Whether any execution was ever started under this dispatch. */
  started(dispatchId: string): boolean {
    return this.byDispatch.has(dispatchId)
  }

  recordRetry(executionId: string, retry: ExecutionRetry): void {
    const execution = this.executions.get(executionId)
    if (execution) execution.retry = retry
  }

  dispatch(dispatchId: string): DispatchRecord | undefined {
    return this.dispatches.get(dispatchId)
  }

  authorizeStart(request: StartRequest, userInputWindow?: number): AuthorizationResult {
    const dispatch = this.dispatches.get(request.dispatch_id)
    if (!dispatch) return deny(request.run_id, "execution_inactive", `unknown dispatch ${request.dispatch_id}`)
    const existing = this.byDispatch.get(dispatch.dispatch_id)
    if (existing && existing.status !== "closed") {
      return {
        ok: false,
        run_id: request.run_id,
        execution_id: existing.execution_id,
        code: "identity_conflict",
        message: `dispatch ${request.dispatch_id} already has an open execution ${existing.execution_id}`,
      }
    }
    const execution: ExecutionRecord = {
      execution_id: this.nextId("execution"),
      dispatch_id: dispatch.dispatch_id,
      task_id: dispatch.task_id,
      atom_id: dispatch.atom_id,
      status: "active",
      host_identity: request.host_identity,
      ...(userInputWindow === undefined ? {} : { user_input_window: userInputWindow }),
      allowed_calls: [],
    }
    this.executions.set(execution.execution_id, execution)
    this.byDispatch.set(dispatch.dispatch_id, execution)
    return { ok: true, run_id: request.run_id, execution_id: execution.execution_id }
  }

  authorizeOperation(request: OperationRequest, context: AuthorizationContext = {}): AuthorizationResult {
    const execution = this.executions.get(request.execution_id)
    if (!execution) return deny(request.run_id, "execution_inactive", `unknown execution ${request.execution_id}`)
    if (execution.status !== "active") return deny(request.run_id, "execution_inactive", `execution ${request.execution_id} is ${execution.status}`)
    if (execution.host_identity !== undefined && execution.host_identity !== request.host_identity) {
      return deny(request.run_id, "identity_conflict", "host identity does not match this execution")
    }
    if (execution.allowed_calls.some((call) => call.host_call_id === request.host_call_id)) {
      return deny(request.run_id, "identity_conflict", `host_call_id ${request.host_call_id} was already authorized`)
    }

    const atom = context.intent?.atoms.find((candidate) => candidate.atom_id === execution.atom_id)
    if (!atom) return deny(request.run_id, "capability_unsupported", `current compiled intent has no atom ${execution.atom_id}`)
    const rule = atom.authority.rules.find((candidate) => {
      if (candidate.operation_id !== request.operation_id) return false
      if (candidate.input_refs.length === 0 && candidate.output_refs.length === 0) {
        // A host-resolved invocation is audited by the trusted resolver's digest;
        // the code still requires the atom to have granted this operation_id.
        return true
      }
      if (refKey(candidate.resource_ref) !== refKey(request.resource_ref)) return false
      const inputKeys = new Set(candidate.input_refs.map(refKey))
      const outputKeys = new Set(candidate.output_refs.map(refKey))
      return request.input_refs.every((ref) => inputKeys.has(refKey(ref))) && request.output_refs.every((ref) => outputKeys.has(refKey(ref)))
    })
    if (!rule) {
      return deny(request.run_id, "capability_unsupported", `operation ${request.operation_id} is not covered by the atom Authority`)
    }
    const conditionVerdict = combineAll(rule.conditions.map((condition) => evaluateCondition(condition, context)))
    if (conditionVerdict === "unsupported") {
      return deny(request.run_id, "capability_unsupported", `operation ${request.operation_id} has conditions this implementation cannot evaluate`)
    }
    if (conditionVerdict === "unsatisfied") {
      return deny(request.run_id, "execution_inactive", `operation ${request.operation_id} conditions are not currently satisfied`)
    }

    const allowedCall = {
      allowed_call_id: this.nextId("call"),
      host_call_id: request.host_call_id,
      operation_id: request.operation_id,
      ...(request.invocation?.tool === undefined ? {} : { tool: request.invocation.tool }),
      ...(request.invocation?.args_digest === undefined ? {} : { args_digest: request.invocation.args_digest }),
    }
    execution.allowed_calls.push(allowedCall)
    return { ok: true, run_id: request.run_id, execution_id: execution.execution_id, allowed_call_id: allowedCall.allowed_call_id }
  }

  closeExecution(executionId: string, reason?: string): void {
    const execution = this.executions.get(executionId)
    if (!execution) return
    execution.status = "closed"
    execution.closed_reason = reason
  }

  blockExecution(executionId: string, reason?: string): void {
    const execution = this.executions.get(executionId)
    if (!execution) return
    execution.status = "blocked"
    execution.closed_reason = reason
  }

  getExecution(executionId: string): ExecutionRecord | undefined {
    return this.executions.get(executionId)
  }

  list(): ExecutionRecord[] {
    return [...this.executions.values()].map((execution) => ({ ...execution, allowed_calls: [...execution.allowed_calls] }))
  }

  dispatchesSnapshot(): DispatchRecord[] {
    return [...this.dispatches.values()].map((dispatch) => ({ ...dispatch }))
  }

  private nextId(prefix: string): string {
    this.sequence += 1
    return `${prefix}-${this.sequence}`
  }
}

function deny(runId: string, code: string, message: string): AuthorizationResult {
  return { ok: false, run_id: runId, code, message }
}

function isConditionRecord(value: unknown): value is Condition {
  return value !== null && typeof value === "object" && !Array.isArray(value) && typeof (value as { kind?: unknown }).kind === "string"
}

function combineAll(verdicts: ConditionVerdict[]): ConditionVerdict {
  if (verdicts.some((verdict) => verdict === "unsatisfied")) return "unsatisfied"
  if (verdicts.some((verdict) => verdict === "unsupported")) return "unsupported"
  return "satisfied"
}

function combineAny(verdicts: ConditionVerdict[]): ConditionVerdict {
  if (verdicts.some((verdict) => verdict === "satisfied")) return "satisfied"
  if (verdicts.some((verdict) => verdict === "unsupported")) return "unsupported"
  return "unsatisfied"
}
