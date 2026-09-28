import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IntentStoreV2 } from "../src/core/compiler-store-v2.js"
import { createIntentCompilerV2 } from "../src/core/intent-compiler-v2.js"
import { atomRef, compiledIntentRef } from "../src/core/compiled-intent.js"
import { candidateRepairContext } from "../src/core/candidate-repair.js"
import { createCompilerModelV2, type CompilerModelV2Input, type CompilerModelV2CheckInput } from "../src/model/compiler-model-v2.js"
import { CANDIDATE_EXAMPLE } from "../src/model/candidate-example.js"
import { digestText, type Candidate, type CompilerEvent } from "../src/core/intent-contract.js"

// Fixed model responses exercise the real source/prepare/check/repair/commit/
// return path. They do not measure a model's ability to understand this task.
const passages = [
  "Implement an export command that writes the supplied rows as CSV in the provided workspace.",
  "Then implement a verify command in the same workspace that reports whether the exported file is valid CSV, using the accepted export implementation.",
  "Both commands must exit 1 and print MISSING_INPUT to stderr when their input is missing.",
]
const text = passages.join("\n\n")
const source = { source_id: "e1", digest: digestText(text) }
const event: CompilerEvent = {
  schema_version: 2, run_id: "semantic", event_id: "e1", kind: "user_input",
  source: { producer_id: "user", channel: "user" }, payload: { text },
}

function plan(includeSharedRule: boolean): Candidate {
  const candidate = structuredClone(CANDIDATE_EXAMPLE)
  candidate.basis.event_ids = ["e1"]
  const group = candidate.groups[0]!
  group.ir_changes = [{
    action: "create", target: "task", local_ref: "t1",
    value: { goal: { text: "Implement export and verify commands." }, current_scope: { text: "Implement both commands in the provided workspace.", disposition: "proceed" } },
    sources: [source],
  }, ...passages.map((quote, i) => ({
    action: "create" as const, target: "content" as const, local_ref: `r${i + 1}`,
    value: { text: ["Export", "Verify", "Shared missing-input behavior"][i]!, about: [], scope: [{ target_id: "t1" }], support: [] },
    sources: [{ ...source, quote }],
  }))]
  if (group.compilation.decision !== "replace") throw Error("fixture")
  const draft = group.compilation.drafts[0]!
  const template = draft.atoms[0]!
  draft.atoms = [0, 1].map(i => ({
    ...structuredClone(template), atom_id: `a${i + 1}`,
    task: `${passages[i]}${i === 0 || includeSharedRule ? ` ${passages[2]}` : ""}`,
    outputs: [{ output_id: `o${i + 1}`, description: `${i === 0 ? "Export" : "Verify"} command and verification evidence`, format: "artifact" as const }],
    authority: { ...template.authority, basis: [source], rules: template.authority.rules.map(rule => ({ ...rule, resource_ref: source, allowed_use: `${rule.operation_id} for the ${i === 0 ? "export" : "verify"} implementation and its validation in the provided workspace.` })) },
    completion: [{ text: passages[i]!, evidence_required: "Implementation and command results demonstrating the required behavior" },
      ...(i === 0 || includeSharedRule ? [{ text: passages[2]!, evidence_required: "Missing-input invocation with exit code and stderr" }] : [])],
  }))
  draft.relations = [{ predecessor: { local_ref: "a1" }, successor: { local_ref: "a2" }, requires: "Accepted export implementation and its CSV output evidence in the shared workspace", conditions: [], basis: [{ ...source, quote: passages[1]! }] }]
  group.coverage = [
    { requirement: { local_ref: "t1" }, disposition: "assigned", refs: [{ local_ref: "a1" }, { local_ref: "a2" }], explanation: "Both commands implement the task." },
    ...[1, 2, 3].map(i => ({ requirement: { local_ref: `r${i}` }, disposition: "assigned" as const, refs: (i === 3 ? [1, 2] : [i]).map(n => ({ local_ref: `a${n}` })), explanation: i === 3 ? "The shared rule governs both commands." : "Command behavior." })),
  ]
  return candidate
}

test("whole prepared CI reaches checking and repair before first dispatch, then acceptance releases its successor", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "semantic-compilation-")), runId: event.run_id })
  // Four calls are needed to exercise reject -> repair -> check in one batch.
  store.applyDeltas({ max_management_requests: 4 })
  const proposals: CompilerModelV2Input[] = []
  const checks: CompilerModelV2CheckInput[] = []
  let returned = false
  const model = createCompilerModelV2(async input => {
    proposals.push(structuredClone(input))
    if (returned) {
      assert.deepEqual(input.execution_outcomes, store.current().execution_outcomes)
      assert.deepEqual(input.atom_states, store.current().atom_states)
      assert.deepEqual(input.assessments, store.current().assessments)
      assert.equal(input.execution_outcomes?.[0]?.state_claim, "completed")
      const predecessor = input.compiled.t1!.atoms[0]!
      return JSON.stringify({ schema_version: 2, basis: { event_ids: ["return"], refs: [] }, source_coverage: [], groups: [{
        local_ref: "accept", task_refs: ["t1"], depends_on: [], ir_changes: [],
        compilation: { decision: "reuse", current: [compiledIntentRef(input.compiled.t1!)], reason: "Accepted export implementation releases verify." },
        execution_decisions: [], assessments: [{ target_ref: atomRef(predecessor), criteria_refs: predecessor.goal_refs, evidence_refs: [{ source_id: "return", digest: "resolved-by-management" }], result: "satisfied", explanation: "Returned export implementation and evidence satisfy the required handoff.", method: "model" }],
        coverage: [], checks: [], questions: [],
      }] })
    }
    assert.deepEqual(store.current().compiled, {}, "rejected or unchecked work must not be committed")
    if (proposals.length === 2) {
      assert.ok(input.validation_errors?.some(error => error.includes("waiting verify Atom")))
      assert.ok(input.repair_context?.candidate)
    }
    return JSON.stringify(plan(proposals.length > 1))
  }, async input => {
    checks.push(structuredClone(input))
    const prepared = input.prepared!
    assert.equal(Object.keys(prepared.ir).length, 1)
    assert.equal(prepared.ir.t1!.content.length, 3)
    assert.equal(prepared.compiled.t1!.atoms.length, 2)
    assert.equal(prepared.compiled.t1!.relations.length, 1)
    assert.deepEqual(prepared.dispatchable_atoms.map(atom => atom.atom_id), ["a1"])
    assert.deepEqual(prepared.atom_states.map(state => state.status), ["ready", "ready"])
    const waiting = prepared.compiled.t1!.atoms[1]!
    const requirement = waiting.goal_refs.find(ref => ref.id === "r3")!
    assert.ok(requirement, "shared provenance exists even when the instruction omits its behavior")
    return JSON.stringify(checks.length === 1 ? {
      schema_version: 2, verdict: "inconsistent", findings: [{ dimension: "D7", claim: "waiting verify Atom omits shared missing-input behavior", expected: passages[2], observed: waiting.task, refs: [requirement] }],
    } : { schema_version: 2, verdict: "consistent", findings: [] })
  })
  const compiler = createIntentCompilerV2({ store, model })
  await compiler.acceptEvent(event)
  const first = await compiler.advance({ runId: event.run_id })
  assert.equal(first.ok, true, first.message)
  assert.equal(checks.length, 2)
  assert.equal(store.current().semantic_checks[0]!.findings[0]!.evidence_resolved, true, "newly prepared IR refs must be usable check evidence")
  assert.deepEqual(store.current().compiled, checks[1]!.prepared!.compiled)
  assert.deepEqual(first.deliveries!.map(delivery => delivery.atom_id), ["a1"])
  assert.equal("execution_task" in first.deliveries![0]!, false)
  assert.deepEqual(first.deliveries![0]!.atom, store.current().compiled.t1!.atoms[0])
  assert.match(store.current().compiled.t1!.atoms[1]!.task, /MISSING_INPUT/)

  const started = compiler.authorize({ kind: "start", run_id: event.run_id, dispatch_id: first.deliveries![0]!.dispatch_id, host_identity: "host" })
  assert.equal(started.ok, true)
  const accepted = await compiler.acceptEvent({ ...event, event_id: "return", kind: "execution_return", source: { producer_id: "host", channel: "executor" }, execution_id: started.execution_id!, payload: {
    state_claim: "completed", outcome: { schema_version: 2, execution_id: started.execution_id!, atom_ref: atomRef(first.deliveries![0]!.atom), suggested_status: "completed", product_refs: [], file_changes: [], evidence_refs: [] },
  } })
  assert.equal(accepted.ok, true)
  assert.equal(store.current().dispatches.length, 1, "an executor return alone must not release the successor")
  returned = true
  const second = await compiler.advance({ runId: event.run_id })
  assert.equal(second.ok, true, second.message)
  assert.deepEqual(second.deliveries?.map(delivery => delivery.atom_id), ["a2"])
  assert.deepEqual(store.current().compiled, checks[1]!.prepared!.compiled, "acceptance reuses the whole plan")

  const priorInput = proposals.at(-1)!
  const withHistory = { ...priorInput, source_events: [event] }
  const revisedHistory = structuredClone(withHistory)
  revisedHistory.source_events[0]!.payload = { text: "An earlier requirement with different meaning." }
  assert.equal(candidateRepairContext("old", plan(true), withHistory, revisedHistory).basis_status, "changed", "changed historical requirements must invalidate an unchanged repair basis")
  for (const field of ["atom_states", "execution_outcomes", "assessments"] as const) {
    const changed = structuredClone(priorInput)
    changed[field] = []
    if (priorInput[field]?.length === 0) continue
    assert.equal(candidateRepairContext("old", plan(true), priorInput, changed).basis_status, "changed", `${field} must participate in repair context freshness`)
  }
})
