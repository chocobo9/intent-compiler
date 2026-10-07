import { atomRef, type AtomStateLedger } from "./compiled-intent.js"
import { assessmentVerdict, evaluateCondition, type DispatchRecord, type ExecutionRecord } from "./execution-state.js"
import { refKey, type AssessmentDraft, type Atom, type CompiledIntent, type Ref, type TaskIntent } from "./intent-contract.js"
import type { ExecutionOutcomeRecord } from "./compiler-store-v2.js"

export interface AtomAdmissionContext {
  compiled: Record<string, CompiledIntent>
  ir: Record<string, TaskIntent>
  atoms: AtomStateLedger
  assessments: readonly AssessmentDraft[]
  capabilities?: { operations: readonly string[] }
  execution_outcomes?: readonly ExecutionOutcomeRecord[]
  /** The run's dispatches and executions as they stand now; an ordering Relation reads them. */
  runs?: () => { dispatches: readonly DispatchRecord[]; executions: readonly ExecutionRecord[] }
  /** Atom versions (refKey) this batch offers again (a retry or a rerun) once admission is decided. */
  rerunning?: ReadonlySet<string>
}

export function incomingRelations(atom: Atom, context: Pick<AtomAdmissionContext, "compiled">) {
  const key = refKey(atomRef(atom))
  return Object.values(context.compiled).flatMap(intent => intent.relations).filter(relation => refKey(relation.successor) === key)
}

function completedOutcome(predecessor: import("./intent-contract.js").Ref, context: Pick<AtomAdmissionContext, "execution_outcomes">) {
  return [...(context.execution_outcomes ?? [])].reverse().find(record => !record.historical && record.state_claim === "completed" && refKey(record.outcome.atom_ref) === refKey(predecessor))?.outcome
}

/**
 * An ordering Relation (serial_write, user_order) waits only until the exact
 * predecessor version has run: at least one closed execution with a return, no
 * execution still open and no dispatch still waiting to start (a pending
 * retry).  Its result and assessment do not matter.
 */
function orderingBlock(predecessor: Ref, context: AtomAdmissionContext): string | undefined {
  const { dispatches, executions } = context.runs?.() ?? { dispatches: [], executions: [] }
  const offered = dispatches.filter(dispatch => dispatch.atom_id === predecessor.id && dispatch.atom_revision === predecessor.revision && dispatch.digest === predecessor.digest)
  if (offered.length === 0) return `predecessor ${predecessor.id} has not been dispatched`
  const ids = new Set(offered.map(dispatch => dispatch.dispatch_id))
  const runs = executions.filter(execution => ids.has(execution.dispatch_id))
  if (runs.some(execution => execution.status !== "closed")) return `predecessor ${predecessor.id} is still running`
  if (offered.some(dispatch => !runs.some(execution => execution.dispatch_id === dispatch.dispatch_id)) || context.rerunning?.has(refKey(predecessor))) return `predecessor ${predecessor.id} is offered to run again`
  if (!runs.some(execution => (context.execution_outcomes ?? []).some(outcome => outcome.execution_id === execution.execution_id))) return `predecessor ${predecessor.id} has not returned`
  return undefined
}

/**
 * A result dependency (consumes, the default) needs the exact predecessor version's completed result
 * and a management judgement of it (its latest assessing batch, see
 * assessmentVerdict) that is not not_satisfied: satisfied, or unknown, which
 * keeps the current plan going.  An explicit assessment_supports condition an
 * Atom or Relation states keeps its own meaning (satisfied only).
 */
export function atomAdmission(taskId: string, atom: Atom, context: AtomAdmissionContext): string | undefined {
  const intent = context.compiled[taskId]
  const conditions = { intent, ir: context.ir, assessments: context.assessments, capabilities: context.capabilities }
  if (atom.preconditions.some(condition => evaluateCondition(condition, conditions) !== "satisfied")) return "Atom preconditions are not satisfied"
  for (const relation of incomingRelations(atom, context)) {
    if (relation.kind === "serial_write" || relation.kind === "user_order") {
      const blocked = orderingBlock(relation.predecessor, context)
      if (blocked !== undefined) return blocked
      if (relation.conditions.some(condition => evaluateCondition(condition, conditions) !== "satisfied")) return `dependency ${relation.predecessor.id} conditions are not satisfied`
      continue
    }
    const owner = Object.values(context.compiled).find(candidate => candidate.atoms.some(prior => refKey(atomRef(prior)) === refKey(relation.predecessor)))
    const prior = owner?.atoms.find(candidate => refKey(atomRef(candidate)) === refKey(relation.predecessor))
    if (!owner || !prior || !["completed", "legacy"].includes(context.atoms.status(owner.task_id, prior)) || !completedOutcome(relation.predecessor, context)) return `predecessor ${relation.predecessor.id} has no completed result`
    const verdict = assessmentVerdict(relation.predecessor, context.assessments)
    if (verdict === undefined) return `predecessor ${relation.predecessor.id} has not been assessed for this dependency`
    if (verdict === "not_satisfied") return `predecessor ${relation.predecessor.id} was assessed not_satisfied`
    if (relation.conditions.some(condition => evaluateCondition(condition, conditions) !== "satisfied")) return `dependency ${relation.predecessor.id} conditions are not satisfied`
  }
  return undefined
}
