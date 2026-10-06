import assert from "node:assert/strict"
import test from "node:test"
import { atomRef } from "../src/core/compiled-intent.js"
import { assessmentVerdict, latestAssessmentBatch } from "../src/core/execution-state.js"
import type { Atom, AtomStateRecord, CompiledIntent, Ref } from "../src/core/intent-contract.js"
import { projectAssessments } from "../src/core/request-projection.js"

const atom = (id: string, revision: number): Atom => ({ atom_id: id, revision, task: `${id} r${revision}` }) as unknown as Atom
const plan = (...atoms: Atom[]): Record<string, CompiledIntent> => ({ t1: { task_id: "t1", compiled_intent_id: "ci", compiled_revision: 0, atoms } as unknown as CompiledIntent })
const state = (a: Atom, status: AtomStateRecord["status"]): AtomStateRecord =>
  ({ task_id: "t1", atom_id: a.atom_id, atom_revision: a.revision, compiled_intent_id: "ci", status, updated_at: "2026-10-06T00:00:00Z" })
const record = (target: Ref, sequence: number, result: "satisfied" | "not_satisfied" | "unknown", explanation: string, criteria = "c1") => ({
  target_ref: target, criteria_refs: [{ id: criteria, revision: 0, digest: "sha256:c" }], evidence_refs: [{ id: `e${sequence}`, revision: 0, digest: "sha256:e" }],
  result, explanation, method: "model" as const, basis_event_ids: [`e${sequence}:return`], sequence,
})

test("only the latest batch that assessed a current version is shown, every record of it, verbatim", () => {
  const a = atom("a-one", 0)
  const ref = atomRef(a)
  const explanation = "The report says \"make check\" passed;\n  line two, with  odd   spacing and 中文."
  const history = [
    record(ref, 3, "not_satisfied", "first batch: build missing"),
    record(ref, 3, "unknown", "first batch: second entry"),
    record(ref, 5, "satisfied", explanation, "c1"),
    record(ref, 5, "not_satisfied", "latest batch: a later entry of the same batch", "c2"),
  ]
  const shown = projectAssessments(history, plan(a), [state(a, "completed")])
  assert.deepEqual(shown, [history[2], history[3]])
  assert.equal(shown[0]!.explanation, explanation, "explanation is not shortened or rewritten")
  assert.deepEqual(shown[1]!.criteria_refs, history[3]!.criteria_refs)
})

test("legacy and superseded versions are not shown; each current version gets its own latest batch", () => {
  const legacy = atom("a-done", 0)
  const old = atom("a-rev", 0)
  const next = atom("a-rev", 1)
  const first = atom("a-first", 0)
  const second = atom("a-second", 0)
  const history = [
    record(atomRef(legacy), 1, "satisfied", "legacy judged"),
    record(atomRef(old), 2, "not_satisfied", "superseded version judged"),
    record(atomRef(first), 3, "unknown", "first early"),
    record(atomRef(second), 4, "satisfied", "second early"),
    record(atomRef(first), 6, "not_satisfied", "first late"),
    record(atomRef(next), 7, "satisfied", "revision 1 judged"),
  ]
  const states = [state(legacy, "legacy"), state(old, "completed"), state(next, "completed"), state(first, "completed"), state(second, "completed")]
  const shown = projectAssessments(history, plan(legacy, old, next, first, second), states)
  assert.deepEqual(shown.map(r => r.explanation), ["second early", "first late", "revision 1 judged"], "record order is kept")
  assert.equal(shown.some(r => ["legacy judged", "superseded version judged", "first early"].includes(r.explanation)), false)
})

test("a version assessed under another digest, or never, contributes nothing", () => {
  const a = atom("a-one", 0)
  const other = { ...atomRef(a), digest: "sha256:other" }
  assert.deepEqual(projectAssessments([record(other, 2, "satisfied", "other content")], plan(a), [state(a, "ready")]), [])
  assert.deepEqual(projectAssessments([], plan(a), []), [])
})

test("the request view and the admission verdict read the same batch", () => {
  const a = atom("a-one", 0)
  const ref = atomRef(a)
  const history = [
    record(ref, 2, "not_satisfied", "earlier"), record(ref, 4, "satisfied", "later one"), record(ref, 4, "unknown", "later two"),
  ]
  const shown = projectAssessments(history, plan(a), [state(a, "completed")])
  assert.deepEqual(shown, latestAssessmentBatch(ref, history))
  // The verdict is decided from the same records the model is shown.
  assert.equal(assessmentVerdict(ref, history), "unknown")
  assert.equal(assessmentVerdict(ref, shown), assessmentVerdict(ref, history))
  // Dropping everything the request omits changes no verdict, for any version.
  for (const draft of [[], [record(ref, 9, "not_satisfied", "draft of the batch being prepared")]]) {
    const withDraft = [...history, ...draft.map(({ sequence: _sequence, ...rest }) => rest)]
    const projected = [...projectAssessments(history, plan(a), [state(a, "completed")]), ...draft.map(({ sequence: _sequence, ...rest }) => rest)]
    assert.equal(assessmentVerdict(ref, projected), assessmentVerdict(ref, withDraft))
  }
})
