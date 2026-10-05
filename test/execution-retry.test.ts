import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IntentStoreV2 } from "../src/core/compiler-store-v2.js"
import { createIntentCompilerV2, type IntentCompilerV2 } from "../src/core/intent-compiler-v2.js"
import { createCompilerModelV2, type CompilerModelV2Input } from "../src/model/compiler-model-v2.js"
import { CANDIDATE_EXAMPLE, CANDIDATE_EXAMPLE_INPUT } from "../src/model/candidate-example.js"
import { atomRef, compiledIntentRef } from "../src/core/compiled-intent.js"
import type { AdvanceResult, Atom } from "../src/core/intent-contract.js"

// The R9 shape: an execution returns without the assigned work done, management
// assesses it not_satisfied, and the compiled plan itself needs no change.

function parent() {
  const c = structuredClone(CANDIDATE_EXAMPLE)
  return { ...c, groups: c.groups.map(({ compilation: _c, coverage: _v, execution_decisions: _d, assessments: _a, checks: _k, ...group }) => group) }
}
function child() {
  const c = structuredClone(CANDIDATE_EXAMPLE)
  return { schema_version: 2,
    groups: c.groups.map(({ ir_changes: _i, task_refs: _t, depends_on: _d, ...group }) => ({
      ...group,
      coverage: group.coverage.map(entry => ({ ...entry, requirement: { local_ref: "local_ref" in entry.requirement ? entry.requirement.local_ref : entry.requirement.id } })),
      compilation: group.compilation.decision === "replace"
        ? { ...group.compilation, drafts: group.compilation.drafts.map(({ task_id: _x, ...draft }) => draft) }
        : group.compilation,
    })) }
}
const consistent = async () => JSON.stringify({ schema_version: 2, verdict: "consistent", findings: [] })

type Result = "satisfied" | "not_satisfied" | "unknown"
type Decision = "stop" | "retry"

/** The assessment answer for one returned execution; compilation reuse unless told otherwise. */
function assessment(input: CompilerModelV2Input, executionId: string, result: Result, decision: Decision, replace = false) {
  const atom = input.compiled!.t1!.atoms[0]!
  const event = input.events[0]!.event_id
  return JSON.stringify({
    schema_version: 2, basis: { event_ids: [event], refs: [] }, parent_issues: [],
    groups: [{
      local_ref: "t1", task_refs: ["t1"], depends_on: [],
      compilation: replace
        ? structuredClone(CANDIDATE_EXAMPLE.groups[0]!.compilation)
        : { decision: "reuse", current: [compiledIntentRef(input.compiled!.t1!)], reason: "the plan is unchanged" },
      execution_decisions: [{ execution_id: executionId, decision, reason: `${decision} after ${result}`, basis: [atomRef(atom)] }],
      assessments: [{
        target_ref: atomRef(atom), criteria_refs: atom.goal_refs,
        evidence_refs: [{ source_id: event, digest: input.event_source_refs!.find(ref => ref.source_id === event)!.digest }],
        result, explanation: `the return shows the work is ${result}`, method: "model",
      }],
      coverage: replace ? structuredClone(CANDIDATE_EXAMPLE.groups[0]!.coverage) : [], checks: [], questions: [],
    }],
  })
}

async function setup() {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "execution-retry-")), runId: "retry" })
  store.applyDeltas({ max_management_requests: 8 })
  let answer: (input: CompilerModelV2Input) => string = input => JSON.stringify(input.generation_stage === "ir" ? parent() : child())
  const compiler = createIntentCompilerV2({ store, model: createCompilerModelV2(async input => answer(input), consistent) })
  await compiler.acceptEvent({ schema_version: 2, run_id: "retry", event_id: "input-event-id", kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text: CANDIDATE_EXAMPLE_INPUT } })
  const first = await compiler.advance({ runId: "retry" })
  assert.equal(first.ok, true, first.message)
  return { store, compiler, first, answerWith: (next: typeof answer) => { answer = next } }
}

/** Start a delivered dispatch, return it without the work done, and run its return batch. */
async function runAndReturn(
  compiler: IntentCompilerV2, setAnswer: (next: (input: CompilerModelV2Input) => string) => void,
  delivery: NonNullable<AdvanceResult["deliveries"]>[number], result: Result, decision: Decision, replace = false,
) {
  const start = compiler.authorize({ kind: "start", run_id: "retry", dispatch_id: delivery.dispatch_id, host_identity: `host-${delivery.dispatch_id}` })
  assert.equal(start.ok, true, start.message)
  const executionId = start.execution_id!
  const receipt = await compiler.acceptEvent({ schema_version: 2, run_id: "retry", event_id: `${executionId}:return`, kind: "execution_return",
    source: { producer_id: "host", channel: "executor" }, execution_id: executionId,
    payload: { state_claim: "stopped", text: "Stopped after a denied glob; no product or check output.", outcome: {
      schema_version: 2, execution_id: executionId, atom_ref: atomRef(delivery.atom), suggested_status: "ready",
      product_refs: [], file_changes: [], evidence_refs: [],
    } } })
  assert.equal(receipt.ok, true, receipt.message)
  setAnswer(input => assessment(input, executionId, result, decision, replace))
  return { executionId, advanced: await compiler.advance({ runId: "retry" }) }
}

const version = (atom: Atom) => `${atom.atom_id}@${atom.revision}`

test("a not_satisfied return with a retry decision dispatches the same Atom version again, once", async () => {
  const { store, compiler, first, answerWith } = await setup()
  const delivery = first.deliveries![0]!
  const firstRun = await runAndReturn(compiler, answerWith, delivery, "not_satisfied", "retry")
  assert.equal(firstRun.advanced.ok, true, firstRun.advanced.message)
  assert.equal(firstRun.advanced.disposition, "dispatched")
  const retry = firstRun.advanced.deliveries!
  assert.equal(retry.length, 1)
  assert.equal(version(retry[0]!.atom), version(delivery.atom))
  assert.equal(retry[0]!.digest, delivery.digest)
  assert.notEqual(retry[0]!.dispatch_id, delivery.dispatch_id, "the retry is an offer of its own")
  const state = store.current()
  assert.deepEqual(state.dispatches.find(d => d.dispatch_id === retry[0]!.dispatch_id)!.retry_of, firstRun.executionId)
  const returned = state.executions.find(e => e.execution_id === firstRun.executionId)!
  assert.equal(returned.status, "closed", "the returned execution is not reopened")
  assert.deepEqual(returned.retry, { outcome: "dispatched", dispatch_id: retry[0]!.dispatch_id })
  assert.deepEqual(await compiler.pendingRetryDeliveries({ runId: "retry" }), retry, "the host can read the unstarted offer back")

  // The retry runs and fails again: the version has run twice, so it stays closed and says why.
  const secondRun = await runAndReturn(compiler, answerWith, retry[0]!, "not_satisfied", "retry")
  assert.equal(secondRun.advanced.ok, true, secondRun.advanced.message)
  assert.deepEqual(secondRun.advanced.deliveries ?? [], [])
  assert.notEqual(secondRun.advanced.disposition, "dispatched")
  const after = store.current()
  assert.equal(after.dispatches.length, state.dispatches.length, "no third offer")
  assert.deepEqual(after.executions.find(e => e.execution_id === secondRun.executionId)!.retry, { outcome: "limit_reached", executions: 2 })
  assert.deepEqual(await compiler.pendingRetryDeliveries({ runId: "retry" }), [])
  const view = await compiler.inspect({ runId: "retry" })
  assert.deepEqual(view.executions.find(e => e.execution_id === secondRun.executionId)!.retry, { outcome: "limit_reached", executions: 2 })
  assert.equal(after.atom_states.find(s => s.atom_id === delivery.atom_id && s.atom_revision === delivery.atom.revision)!.status, "ready")
})

test("a stop decision after not_satisfied keeps today's outcome: no new dispatch", async () => {
  const { store, compiler, first, answerWith } = await setup()
  const before = store.current().dispatches.length
  const run = await runAndReturn(compiler, answerWith, first.deliveries![0]!, "not_satisfied", "stop")
  assert.equal(run.advanced.ok, true, run.advanced.message)
  assert.deepEqual(run.advanced.deliveries ?? [], [])
  assert.equal(store.current().dispatches.length, before)
  assert.equal(store.current().executions.find(e => e.execution_id === run.executionId)!.retry, undefined)
})

for (const result of ["unknown", "satisfied"] as const) {
  test(`a ${result} return dispatches nothing, and a retry decision on it is refused`, async () => {
    const stopped = await setup()
    const before = stopped.store.current().dispatches.length
    const stop = await runAndReturn(stopped.compiler, stopped.answerWith, stopped.first.deliveries![0]!, result, "stop")
    assert.equal(stop.advanced.ok, true, stop.advanced.message)
    assert.deepEqual(stop.advanced.deliveries ?? [], [])
    assert.equal(stopped.store.current().dispatches.length, before)

    const retried = await setup()
    const before2 = retried.store.current().dispatches.length
    const retry = await runAndReturn(retried.compiler, retried.answerWith, retried.first.deliveries![0]!, result, "retry")
    assert.equal(retry.advanced.ok, false)
    assert.match(retry.advanced.message!, /retry of execution-\d+ needs a not_satisfied assessment/)
    assert.equal(retried.store.current().dispatches.length, before2)
  })
}

test("a retry combined with replace is refused: replacing dispatches changed work on its own", async () => {
  const { store, compiler, first, answerWith } = await setup()
  const before = store.current().dispatches.length
  const run = await runAndReturn(compiler, answerWith, first.deliveries![0]!, "not_satisfied", "retry", true)
  assert.equal(run.advanced.ok, false)
  assert.match(run.advanced.message!, /retry of execution-\d+ keeps the compiled plan/)
  assert.equal(store.current().dispatches.length, before)
})
