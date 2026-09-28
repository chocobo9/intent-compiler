import { atomRef, type AtomStateLedger } from "./compiled-intent.js"
import { evaluateCondition } from "./execution-state.js"
import { refKey, type AssessmentDraft, type Atom, type CompiledIntent, type TaskIntent } from "./intent-contract.js"
import type { ExecutionOutcomeRecord } from "./compiler-store-v2.js"

export interface AtomAdmissionContext {
  compiled: Record<string, CompiledIntent>
  ir: Record<string, TaskIntent>
  atoms: AtomStateLedger
  assessments: readonly AssessmentDraft[]
  capabilities?: { operations: readonly string[] }
  execution_outcomes?: readonly ExecutionOutcomeRecord[]
}

export function incomingRelations(atom: Atom, context: Pick<AtomAdmissionContext, "compiled">) {
  const key = refKey(atomRef(atom))
  return Object.values(context.compiled).flatMap(intent => intent.relations).filter(relation => refKey(relation.successor) === key)
}

function completedOutcome(predecessor: import("./intent-contract.js").Ref, context: Pick<AtomAdmissionContext, "execution_outcomes">) {
  return [...(context.execution_outcomes ?? [])].reverse().find(record => !record.historical && record.state_claim === "completed" && refKey(record.outcome.atom_ref) === refKey(predecessor))?.outcome
}

/** A result dependency needs the exact predecessor version and management acceptance. */
export function atomAdmission(taskId: string, atom: Atom, context: AtomAdmissionContext): string | undefined {
  const intent = context.compiled[taskId]
  const conditions = { intent, ir: context.ir, assessments: context.assessments, capabilities: context.capabilities }
  if (atom.preconditions.some(condition => evaluateCondition(condition, conditions) !== "satisfied")) return "Atom preconditions are not satisfied"
  for (const relation of incomingRelations(atom, context)) {
    const owner = Object.values(context.compiled).find(candidate => candidate.atoms.some(prior => refKey(atomRef(prior)) === refKey(relation.predecessor)))
    const prior = owner?.atoms.find(candidate => refKey(atomRef(candidate)) === refKey(relation.predecessor))
    if (!owner || !prior || !["completed", "legacy"].includes(context.atoms.status(owner.task_id, prior)) || !completedOutcome(relation.predecessor, context)) return `predecessor ${relation.predecessor.id} has no completed result`
    const accepted = evaluateCondition({ kind: "assessment_supports", refs: [relation.predecessor] }, conditions)
    if (accepted !== "satisfied") return `predecessor ${relation.predecessor.id} has not been accepted for this dependency`
    if (relation.conditions.some(condition => evaluateCondition(condition, conditions) !== "satisfied")) return `dependency ${relation.predecessor.id} conditions are not satisfied`
  }
  return undefined
}
