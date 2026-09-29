import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IntentStoreV2 } from "../src/core/compiler-store-v2.js"
import { createIntentCompilerV2 } from "../src/core/intent-compiler-v2.js"
import { createCompilerModelV2 } from "../src/model/compiler-model-v2.js"
import { CANDIDATE_EXAMPLE, CANDIDATE_EXAMPLE_INPUT } from "../src/model/candidate-example.js"
import { atomRef, compiledIntentRef } from "../src/core/compiled-intent.js"

function parent() {
  const c = structuredClone(CANDIDATE_EXAMPLE)
  return { ...c, groups: c.groups.map(({ compilation, coverage, ...group }) => group) }
}
function child(basis: string) {
  const c = structuredClone(CANDIDATE_EXAMPLE)
  return { schema_version: 2, basis: c.basis, parent_basis: basis, parent_issues: [],
    groups: c.groups.map(({ ir_changes, ...group }) => group) }
}
const consistent = async () => JSON.stringify({ schema_version: 2, verdict: "consistent", findings: [] })

test("CI basis repair names the changed field and supplies the unchanged parent value", async () => {
  let children = 0
  const { store, compiler } = await setup(async input => {
    if (input.generation_stage === "ir") return JSON.stringify(parent())
    const next = child(input.parent_basis!)
    if (++children === 1) {
      const task = input.existing_objects!.tasks[0]!
      next.basis.refs = [{ id: task.task_id, revision: task.task_revision, digest: task.task_digest }]
    } else {
      const feedback = input.validation_errors!.join("\n")
      assert.match(feedback, /basis\.refs/)
      assert.match(feedback, /expected=\[\]/)
      assert.match(feedback, /received=\[\{/)
      assert.deepEqual(store.current().ir, {})
      assert.deepEqual(input.generation_repair!.ir_proposal!.basis.refs, [])
    }
    return JSON.stringify(next)
  })
  store.applyDeltas({ max_management_requests: 4 })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
  assert.equal(children, 2)
  assert.equal(store.current().budget.total_management_requests, 4)
})
async function setup(transport: Parameters<typeof createCompilerModelV2>[0], checker = consistent) {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "parent-generation-")), runId: "parent" })
  const compiler = createIntentCompilerV2({ store, model: createCompilerModelV2(transport, checker) })
  await compiler.acceptEvent({ schema_version: 2, run_id: "parent", event_id: "input-event-id", kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text: CANDIDATE_EXAMPLE_INPUT } })
  return { store, compiler }
}

test("CI generation reads the materialized parent before any child can be committed", async () => {
  const stages: string[] = []
  const { store, compiler } = await setup(async request => {
    const input = request as typeof request & { generation_stage: string; parent_basis: string }
    stages.push(input.generation_stage)
    assert.deepEqual(store.current().ir, {})
    assert.deepEqual(store.current().compiled, {})
    if (stages.length === 1) {
      assert.equal(input.generation_stage, "ir")
      return JSON.stringify(parent())
    }
    assert.equal(input.generation_stage, "ci")
    assert.equal(input.ir.t1!.content.length, 4)
    const shared = input.ir.t1!.content.find(c => c.item_id === "r-common")!
    assert.match(shared.text, /INPUT_MISSING/)
    assert.notEqual(shared.text, shared.interpretation)
    assert.ok(input.parent_basis)
    return JSON.stringify(child(input.parent_basis))
  })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
  assert.deepEqual(stages, ["ir", "ci"])
  assert.equal(store.current().ir.t1!.content.length, 4)
  assert.equal(store.current().compiled.t1!.atoms.length, 2)
  assert.equal(store.current().budget.total_management_requests, 3)
  assert.equal(store.current().executions.length, 0)
})

test("an IR selecting only the tail never reaches CI generation", async () => {
  const stages: string[] = []
  const { store, compiler } = await setup(async input => {
    stages.push(input.generation_stage!)
    const proposal = parent()
    for (const change of proposal.groups[0]!.ir_changes) {
      if (change.action === "create" && change.target === "content") change.sources = [{
        ...change.sources[0]!, quote: CANDIDATE_EXAMPLE_INPUT.slice(-9), segment_id: undefined,
      }]
    }
    return JSON.stringify(proposal)
  })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, false)
  assert.match(result.message!, /no complete disposition/)
  assert.deepEqual(stages, ["ir"])
  assert.deepEqual(store.current().ir, {})
  assert.deepEqual(store.current().compiled, {})
})

test("resume after a CI transport failure reuses the exact temporary parent without committing it early", async () => {
  const stages: string[] = []
  const parents: unknown[] = []
  let broken = true
  const { store, compiler } = await setup(async input => {
    stages.push(input.generation_stage!)
    if (input.generation_stage === "ir") return JSON.stringify(parent())
    parents.push(structuredClone(input.ir))
    if (broken) throw Error("CI connection interrupted")
    return JSON.stringify(child(input.parent_basis!))
  })
  assert.equal((await compiler.advance({ runId: "parent" })).ok, false)
  const saved = store.current().management_log.at(-1)!
  assert.equal(saved.candidate, undefined)
  assert.equal(saved.generation!.phase, "ci")
  assert.equal(saved.generation!.parent!.ir.t1!.content.length, 4)
  assert.deepEqual(store.current().ir, {})
  broken = false
  const resumed = await compiler.advance({ runId: "parent" })
  assert.equal(resumed.ok, true, resumed.message)
  assert.deepEqual(stages, ["ir", "ci", "ci"])
  assert.deepEqual(parents[0], parents[1])
  assert.equal(store.current().budget.total_management_requests, 4)
  assert.equal(store.current().ir.t1!.content[0]!.revision, 0)
})

test("a child cannot attach to another parent or spend a check on it", async () => {
  let checks = 0
  const { store, compiler } = await setup(async input => JSON.stringify(input.generation_stage === "ir"
    ? parent() : child("a-different-parent")), async () => { checks++; return consistent() })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, false)
  assert.match(result.message!, /different parent basis/)
  assert.equal(checks, 0)
  assert.equal(store.current().budget.total_management_requests, 2)
  assert.deepEqual(store.current().compiled, {})
})

test("generation reserves the complete chain before spending the first request", async () => {
  let calls = 0
  const { store, compiler } = await setup(async () => { calls++; return JSON.stringify(parent()) })
  store.applyDeltas({ max_management_requests: 2 })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, false)
  assert.equal(result.code, "budget_exhausted")
  assert.equal(calls, 0)
  assert.equal(store.current().budget.total_management_requests, 0)
})

test("a reported parent defect returns to IR and invalidates the previous child basis", async () => {
  const stages: string[] = [], bases: string[] = []
  let parents = 0
  const { store, compiler } = await setup(async input => {
    stages.push(input.generation_stage!)
    if (input.generation_stage === "ir") {
      const next = parent()
      if (++parents > 1) {
        const creation = next.groups[0]!.ir_changes[0]!
        if (creation.action === "create") (creation.value as any).current_scope.text += " Preserve the required command interfaces."
      }
      return JSON.stringify(next)
    }
    bases.push(input.parent_basis!)
    if (parents === 1) return JSON.stringify({ ...child(input.parent_basis!), groups: [], parent_issues: ["Clarify the authorized scope in the parent before planning."] })
    return JSON.stringify(child(input.parent_basis!))
  })
  store.applyDeltas({ max_management_requests: 5 })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
  assert.deepEqual(stages, ["ir", "ci", "ir", "ci"])
  assert.notEqual(bases[0], bases[1])
  assert.equal(store.current().budget.total_management_requests, 5)
})

test("a checker identifying an IR defect repairs the parent before recompiling and counts every call", async () => {
  const stages: string[] = []
  let checks = 0, parents = 0
  const { store, compiler } = await setup(async input => {
    stages.push(input.generation_stage!)
    const proposal = parent()
    if (input.generation_stage === "ir" && ++parents > 1) {
      const change = proposal.groups[0]!.ir_changes[0]!
      if (change.action === "create") (change.value as any).current_scope.text += " Retain all required behavior."
    }
    return { text: JSON.stringify(input.generation_stage === "ir" ? proposal : child(input.parent_basis!)), usage: { input_tokens: 2, output_tokens: 1 } }
  }, async () => {
    checks++
    if (checks > 1) return consistent()
    return JSON.stringify({ schema_version: 2, verdict: "inconsistent", repair_target: "ir", findings: [{
      dimension: "D2", claim: "Parent scope needs correction", expected: "Retain all required behavior", observed: "Parent scope omits required scope detail",
      refs: [{ source_id: "input-event-id", digest: CANDIDATE_EXAMPLE.groups[0]!.ir_changes[0]!.sources[0]!.digest, span: { unit: "utf16", start: 0, end: CANDIDATE_EXAMPLE_INPUT.indexOf("\n\n") } }],
    }] })
  })
  store.applyDeltas({ max_management_requests: 6 })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
  assert.deepEqual(stages, ["ir", "ci", "ir", "ci"])
  assert.equal(checks, 2)
  assert.equal(store.current().budget.total_management_requests, 6)
  assert.deepEqual(store.current().management_calls.filter(c => c.kind === "propose").map(c => c.generation_stage), stages)
  assert.equal(store.current().ir.t1!.revision, 0, "temporary creation is applied only once to the original baseline")
})

test("changed host facts invalidate a saved temporary parent before resume", async () => {
  const { store, compiler } = await setup(async input => {
    if (input.generation_stage === "ir") return JSON.stringify(parent())
    throw Error("CI connection interrupted")
  })
  assert.equal((await compiler.advance({ runId: "parent" })).ok, false)
  const stages: string[] = []
  const resumed = createIntentCompilerV2({ store,
    capabilities: { operations: ["read", "edit", "bash"], workspace_root: "D:/changed-authorized-workspace" },
    model: createCompilerModelV2(async input => {
      stages.push(input.generation_stage!)
      return JSON.stringify(input.generation_stage === "ir" ? parent() : child(input.parent_basis!))
    }, consistent),
  })
  const result = await resumed.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
  assert.deepEqual(stages, ["ir", "ci"])
})

test("Resume returns a rejected stage response to that stage and clears its feedback before compiling", async () => {
  let broken = true
  const invalid = JSON.stringify({ ...parent(), forbidden_plan: "not an IR field" })
  const { store, compiler } = await setup(async input => {
    if (broken) return invalid
    if (input.generation_stage === "ir") {
      assert.equal(input.schema_rejected_draft?.text, invalid)
      return JSON.stringify(parent())
    }
    assert.equal(input.schema_rejected_draft, undefined)
    assert.deepEqual(input.validation_errors ?? [], [])
    return JSON.stringify(child(input.parent_basis!))
  })
  assert.equal((await compiler.advance({ runId: "parent" })).ok, false)
  assert.deepEqual(store.current().ir, {})
  broken = false
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
})

test("an execution return is assessed by the CI stage alone and can never become an IR source", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "assessment-batch-")), runId: "assess" })
  const batches: Array<{ stage?: string; assessment?: boolean }> = []
  let returned = false
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async input => {
      batches.push({ stage: input.generation_stage, assessment: input.assessment_batch })
      if (!returned) return JSON.stringify(input.generation_stage === "ir" ? parent() : child(input.parent_basis!))
      // The assessment batch: no IR stage ran, so this stage authors the
      // decisions the plan is committed from, with the return as evidence.
      const atom = input.compiled.t1!.atoms[0]!
      return JSON.stringify({
        schema_version: 2,
        basis: { event_ids: ["return"], refs: [] },
        parent_basis: input.parent_basis!,
        parent_issues: [],
        groups: [{
          local_ref: "t1", task_refs: ["t1"], depends_on: [],
          compilation: { decision: "reuse", current: [compiledIntentRef(input.compiled.t1!)], reason: "the plan is unchanged" },
          execution_decisions: [],
          assessments: [{
            target_ref: atomRef(atom), criteria_refs: atom.goal_refs,
            evidence_refs: [{ source_id: "return", digest: input.event_source_refs!.find(ref => ref.source_id === "return")!.digest }],
            result: "unknown", explanation: "the return reports no products or evidence to accept", method: "model",
          }],
          coverage: [], checks: [], questions: [],
        }],
      })
    }, consistent),
  })
  await compiler.acceptEvent({ schema_version: 2, run_id: "assess", event_id: "input-event-id", kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text: CANDIDATE_EXAMPLE_INPUT } })
  const first = await compiler.advance({ runId: "assess" })
  assert.equal(first.ok, true, first.message)
  const irAfterFirst = structuredClone(store.current().ir)
  const dispatch = first.deliveries![0]!
  const start = compiler.authorize({ kind: "start", run_id: "assess", dispatch_id: dispatch.dispatch_id, host_identity: "host" })
  assert.equal(start.ok, true)
  const receipt = await compiler.acceptEvent({ schema_version: 2, run_id: "assess", event_id: "return", kind: "execution_return",
    source: { producer_id: "host", channel: "executor" }, execution_id: start.execution_id!,
    payload: { state_claim: "stopped", text: "Ran the work; no product references or evidence attached.", outcome: {
      schema_version: 2, execution_id: start.execution_id!, atom_ref: atomRef(dispatch.atom), suggested_status: "ready",
      product_refs: [], file_changes: [], evidence_refs: [],
    } },
  })
  assert.equal(receipt.ok, true)
  returned = true
  const before = batches.length
  const second = await compiler.advance({ runId: "assess" })
  assert.equal(second.ok, true, second.message)
  assert.deepEqual(batches.slice(before), [{ stage: "ci", assessment: true }],
    "a returned execution is assessed by the CI stage alone: no IR stage runs and no IR source is selected")
  assert.deepEqual(store.current().ir, irAfterFirst, "assessing a return must not rewrite the user's IR")
  assert.equal(store.current().assessments.at(-1)!.result, "unknown")
  assert.deepEqual(store.current().assessments.at(-1)!.basis_event_ids, ["return"])
})

test("an assessment that finds the stored IR defective records it and still completes the return batch", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "assessment-repair-")), runId: "repair" })
  store.applyDeltas({ max_management_requests: 6 })
  const batches: Array<{ stage?: string; assessment?: boolean }> = []
  let returned = false
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async input => {
      batches.push({ stage: input.generation_stage, assessment: input.assessment_batch })
      if (!returned) return JSON.stringify(input.generation_stage === "ir" ? parent() : child(input.parent_basis!))
      // The assessment reports a defect in the stored IR instead of compiling around it.
      return JSON.stringify({ schema_version: 2, basis: { event_ids: ["return"], refs: [] },
        parent_basis: input.parent_basis!, parent_issues: ["the stored content selection must exclude the host's wrapper quotes"], groups: [] })
    }, consistent),
  })
  await compiler.acceptEvent({ schema_version: 2, run_id: "repair", event_id: "input-event-id", kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text: CANDIDATE_EXAMPLE_INPUT } })
  const first = await compiler.advance({ runId: "repair" })
  assert.equal(first.ok, true, first.message)
  const start = compiler.authorize({ kind: "start", run_id: "repair", dispatch_id: first.deliveries![0]!.dispatch_id, host_identity: "host" })
  assert.equal(start.ok, true)
  assert.equal((await compiler.acceptEvent({ schema_version: 2, run_id: "repair", event_id: "return", kind: "execution_return",
    source: { producer_id: "host", channel: "executor" }, execution_id: start.execution_id!,
    payload: { state_claim: "stopped", text: "Ran the work.", outcome: {
      schema_version: 2, execution_id: start.execution_id!, atom_ref: atomRef(first.deliveries![0]!.atom), suggested_status: "ready",
      product_refs: [], file_changes: [], evidence_refs: [],
    } },
  })).ok, true)
  returned = true
  const irBeforeReturn = structuredClone(store.current().ir)
  const second = await compiler.advance({ runId: "repair" })
  assert.equal(second.ok, true, second.message)
  assert.deepEqual(batches.slice(-1), [{ stage: "ci", assessment: true }],
    "the return batch assesses through the CI stage only: the IR is not revised from an execution return")
  assert.equal(second.disposition, "waiting")
  assert.match(second.questions?.[0] ?? "", /wrapper quotes/)
  assert.deepEqual(store.current().ir, irBeforeReturn, "the stored IR is unchanged")
  assert.deepEqual(store.current().pending_event_ids, [], "the return is consumed, not requeued")
  const record = store.current().management_log.at(-1)!
  assert.equal(record.status, "accepted")
  assert.equal(record.error_code, "assessment_deferred")
  assert.deepEqual(record.trigger_event_ids, ["return"])
  assert.deepEqual(store.current().questions.map(question => question.text), second.questions)
})
