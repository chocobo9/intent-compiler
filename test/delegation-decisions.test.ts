import { test } from "node:test"
import assert from "node:assert/strict"
import { createCompilerModelV2, V2_COMPILER_CONTRACT } from "../src/model/compiler-model-v2.js"
import { RETRY_IN_DELEGATION_BATCH } from "../src/model/generation-schema.js"

const stage = (executions: unknown[]) => ({
  run_id: "run-1", events: [], ir: {}, compiled: {}, atom_refs: {}, executions, budget: { requests_used: 0, max_requests: 3 },
  contract: V2_COMPILER_CONTRACT, generation_stage: "ci" as const,
})
const running = { execution_id: "exec-running", status: "active" }
const closed = { execution_id: "exec-closed", status: "closed" }
const answer = (decisions: unknown[] | undefined) => JSON.stringify({
  schema_version: 2, parent_issues: [],
  groups: [{ compilation: { decision: "reuse", reason: "r" }, coverage: [], checks: [], questions: [], ...(decisions === undefined ? {} : { execution_decisions: decisions }) }],
})
const decision = (execution_id: string, kind: string) => ({ execution_id, decision: kind, reason: "x" })
const propose = (text: string, executions: unknown[]) => createCompilerModelV2(async () => ({ text, text_source: "text" })).propose(stage(executions) as never)

test("a delegation batch's decision about an execution that is not running is dropped before validation", async () => {
  for (const kind of ["stop", "continue", "await_result"]) {
    const text = answer([decision("exec-closed", kind), decision("exec-running", "continue")])
    const result = await propose(text, [running, closed])
    assert.equal(result.ok, true, `${kind}: ${JSON.stringify(result.schema_errors)}`)
    assert.deepEqual(result.ci_proposal?.groups[0]?.execution_decisions?.map(entry => entry.execution_id), ["exec-running"], "the running execution's decision stays")
    assert.equal(result.call?.text, text, "the recorded text keeps the answer as returned")
  }
})

test("a delegation batch with no running execution drops every decision and carries no list", async () => {
  const result = await propose(answer([decision("exec-closed", "stop"), decision("exec-older", "await_result")]), [closed])
  assert.equal(result.ok, true, JSON.stringify(result.schema_errors))
  assert.equal(result.ci_proposal?.groups[0]?.execution_decisions, undefined)
  assert.equal((await propose(answer([decision("exec-closed", "stop")]), [])).ok, true, "also when the request shows no execution")
})

test("a delegation batch's retry is refused with its reason, for a closed or a running execution", async () => {
  for (const [id, executions] of [["exec-closed", [running, closed]], ["exec-running", [running]], ["exec-closed", [closed]]] as const) {
    const result = await propose(answer([decision(id, "stop"), decision(id, "retry")]), [...executions])
    assert.equal(result.ok, false)
    const message = result.schema_errors?.join("; ") ?? ""
    assert.ok(message.includes(RETRY_IN_DELEGATION_BATCH), message)
    assert.doesNotMatch(message, /additional properties|allowed values|must be equal to one of/, "the reason is not buried in a generic schema error")
  }
})

test("the assessment batch keeps its decisions untouched", async () => {
  const input = { ...stage([closed]), assessment_batch: true as const }
  const text = JSON.stringify({
    schema_version: 2, basis: { refs: [] }, parent_issues: [],
    groups: [{ local_ref: "g1", task_refs: ["t1"], depends_on: [], compilation: { decision: "reuse", reason: "r" }, coverage: [], checks: [], questions: [], assessments: [],
      execution_decisions: [decision("exec-closed", "stop")] }],
  })
  const result = await createCompilerModelV2(async () => ({ text, text_source: "text" })).propose(input as never)
  assert.equal(result.ok, true, JSON.stringify(result.schema_errors))
  assert.deepEqual(result.ci_proposal?.groups[0]?.execution_decisions?.map(entry => entry.execution_id), ["exec-closed"])
})
