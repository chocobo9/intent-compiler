import { digestOf, type Atom, type AtomStateRecord, type CompiledIntent, type Ref, type TaskIntent } from "./intent-contract.js"
import { atomRef } from "./compiled-intent.js"
import { latestAssessmentBatch } from "./execution-state.js"

/**
 * What a CI or check request shows of the plan.  The store, the commit and the
 * evidence resolution keep the complete objects; only the model's view is
 * projected, so one body appears once per request:
 *
 *  - a historical Atom version (superseded or legacy) is shown by identity and
 *    lifecycle status only; every Atom's current version stays complete;
 *  - an attached requirement block whose header names an IR content item that
 *    this same request supplies with the same id, revision and digest, and
 *    whose body is exactly that item's text, is replaced by a pointer to it.
 *    Any other block - an older revision, or one assembled with input labels or
 *    withdrawn passages - is kept verbatim.
 */
export interface AtomVersion {
  id: string
  revision: number
  digest: string
  status: AtomStateRecord["status"] | "unrecorded"
}

export type ProjectedCompiledIntent = CompiledIntent & {
  /** Superseded or legacy versions: identity and lifecycle only. */
  historical_atoms: AtomVersion[]
}

export const REQUIREMENT_POINTER = (ref: Ref): string => `(text identical to IR content ${ref.id}@${ref.revision} ${ref.digest} supplied in this request)`

const BLOCK_HEADER = /(^|\n\n)\[assigned requirement ([^\s@\]]+)@(\d+) (\S+)\]\n/gu

/** Replace each block body that the request already carries verbatim as that IR item's text. */
export function pointAtSuppliedRequirements(task: string, irs: readonly Record<string, TaskIntent>[]): string {
  const headers = [...task.matchAll(BLOCK_HEADER)].map(match => ({
    start: match.index! + match[1]!.length,
    bodyStart: match.index! + match[0].length,
    ref: { id: match[2]!, revision: Number(match[3]), digest: match[4]! },
  }))
  if (headers.length === 0) return task
  const supplied = (ref: Ref, body: string): boolean => irs.some(ir => Object.values(ir).some(entry =>
    entry.content.some(item => item.item_id === ref.id && item.revision === ref.revision && item.text === body && digestOf(item) === ref.digest)))
  let out = task.slice(0, headers[0]!.start)
  headers.forEach((header, index) => {
    const end = index + 1 < headers.length ? headers[index + 1]!.start - 2 : task.length
    const body = task.slice(header.bodyStart, end)
    out += task.slice(header.start, header.bodyStart) + (supplied(header.ref, body) ? REQUIREMENT_POINTER(header.ref) : body)
    if (index + 1 < headers.length) out += "\n\n"
  })
  return out
}

function isHistorical(atom: Atom, intent: CompiledIntent, states: readonly AtomStateRecord[]): boolean {
  const state = states.find(record => record.task_id === intent.task_id && record.atom_id === atom.atom_id && record.atom_revision === atom.revision)
  if (state?.status === "legacy") return true
  return intent.atoms.some(other => other.atom_id === atom.atom_id && other.revision > atom.revision)
}

/** Current Atoms complete (blocks pointed where the request supplies them), historical versions by identity. */
export function projectCompiled(
  compiled: Record<string, CompiledIntent>,
  states: readonly AtomStateRecord[],
  irs: readonly Record<string, TaskIntent>[],
): Record<string, ProjectedCompiledIntent> {
  return Object.fromEntries(Object.entries(compiled).map(([taskId, intent]) => {
    const historical = intent.atoms.filter(atom => isHistorical(atom, intent, states))
    return [taskId, {
      ...intent,
      atoms: intent.atoms.filter(atom => !historical.includes(atom)).map(atom => ({ ...atom, task: pointAtSuppliedRequirements(atom.task, irs) })),
      historical_atoms: historical.map(atom => {
        const state = states.find(record => record.task_id === taskId && record.atom_id === atom.atom_id && record.atom_revision === atom.revision)
        return { ...atomRef(atom), status: state?.status ?? "unrecorded" }
      }),
    }]
  }))
}

/**
 * What a request shows of the assessment history: for each current Atom
 * version (not legacy, and not replaced by a later revision), every record of the latest batch that
 * assessed it, verbatim.  The batch is the one the admission verdict reads
 * (latestAssessmentBatch), so the model sees exactly what code judges by;
 * earlier batches and historical versions are not sent.
 */
export function projectAssessments<A extends { target_ref: Ref; sequence?: number }>(
  assessments: readonly A[],
  compiled: Record<string, CompiledIntent>,
  states: readonly AtomStateRecord[],
): A[] {
  const shown = new Set<A>()
  for (const [taskId, intent] of Object.entries(compiled)) {
    for (const atom of intent.atoms) {
      if (isHistorical(atom, intent, states)) continue
      for (const record of latestAssessmentBatch(atomRef(atom), assessments)) shown.add(record)
    }
  }
  return assessments.filter(record => shown.has(record))
}

/**
 * The pre-candidate state a check needs: only the objects this candidate
 * changed.  A task identical in the prepared IR is left out; a changed task
 * keeps its own fields and only the content, bindings and outputs that differ.
 * A plan keeps only the pre-candidate current Atoms whose current version the
 * candidate replaced or removed, plus its Relations when they changed.
 */
export function changedPriorState(
  priorIr: Record<string, TaskIntent>,
  preparedIr: Record<string, TaskIntent>,
  priorCompiled: Record<string, CompiledIntent>,
  preparedCompiled: Record<string, CompiledIntent>,
  priorStates: readonly AtomStateRecord[],
  preparedStates: readonly AtomStateRecord[],
): { ir: Record<string, TaskIntent>; compiled: Record<string, CompiledIntent> } {
  const ir: Record<string, TaskIntent> = {}
  for (const [taskId, task] of Object.entries(priorIr)) {
    const now = preparedIr[taskId]
    if (now !== undefined && digestOf(now) === digestOf(task)) continue
    const same = <T>(items: readonly T[], others: readonly T[] | undefined) => items.filter(item => !(others ?? []).some(other => digestOf(other) === digestOf(item)))
    ir[taskId] = { ...task, content: same(task.content, now?.content), bindings: same(task.bindings, now?.bindings), outputs: same(task.outputs, now?.outputs) }
  }
  const compiled: Record<string, CompiledIntent> = {}
  for (const [taskId, intent] of Object.entries(priorCompiled)) {
    const now = preparedCompiled[taskId]
    const nowRefs = new Set((now?.atoms ?? []).filter(atom => !isHistorical(atom, now!, preparedStates)).map(atom => digestOf(atomRef(atom))))
    const replaced = intent.atoms.filter(atom => !isHistorical(atom, intent, priorStates) && !nowRefs.has(digestOf(atomRef(atom))))
    const relationsChanged = digestOf(intent.relations) !== digestOf(now?.relations ?? [])
    if (replaced.length === 0 && !relationsChanged) continue
    compiled[taskId] = { ...intent, atoms: replaced, relations: relationsChanged ? intent.relations : [] }
  }
  return { ir, compiled }
}
