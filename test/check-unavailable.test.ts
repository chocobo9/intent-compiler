import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IntentStoreV2 } from "../src/core/compiler-store-v2.js"
import { createIntentCompilerV2 } from "../src/core/intent-compiler-v2.js"
import { createCompilerModelV2 } from "../src/model/compiler-model-v2.js"
import type { Candidate, CompilerEvent, SourceRef } from "../src/core/intent-contract.js"

const SOURCE: SourceRef = { source_id: "s-u1", digest: "sha256:0000000000000000000000000000000000000000000000000000000000000001" }

function event(runId: string, id: string, text: string): CompilerEvent {
  return {
    schema_version: 2,
    run_id: runId,
    event_id: id,
    kind: "user_input",
    source: { producer_id: "host", channel: "user" },
    task_ids: ["t1"],
    payload: { text },
  }
}

/** A first-round candidate that compiles one atom, so the independent check runs. */
function firstTaskCandidate(eventId: string): Candidate {
  return {
    schema_version: 2,
    basis: { event_ids: [eventId], refs: [] },
    groups: [{
      local_ref: "g1",
      task_refs: ["t1"],
      depends_on: [],
      ir_changes: [{
        action: "create",
        target: "task",
        local_ref: "t1",
        value: { goal: { text: "deliver the tool" }, current_scope: { text: "proceed", disposition: "proceed" } },
        sources: [SOURCE],
      }],
      compilation: {
        decision: "replace",
        drafts: [{
          local_ref: "ci-1",
          task_id: "t1",
          intent_basis: [],
          atoms: [{
            atom_id: "a1",
            revision: 0,
            goal_refs: [],
            task: "deliver the tool",
            inputs: [],
            outputs: [],
            constraints: [],
            optional_tools: [],
            authority: { basis: [SOURCE], rules: [], lifetime: "this_execution", delegation: "not_supported" },
            preconditions: [],
            completion: [],
            return_when: [],
            intent_judgments: [],
          }],
          relations: [],
          attachments: [],
        }],
      },
      execution_decisions: [],
      assessments: [],
      coverage: [{ requirement: { local_ref: "t1" }, disposition: "assigned", refs: [{ local_ref: "a1" }], explanation: "delivery" }],
      checks: [],
      questions: [],
    }],
  }
}

test("a check that cannot run fails the batch as infrastructure and is re-sampled once", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-check-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(
      async () => JSON.stringify(firstTaskCandidate("e1")),
      async () => {
        throw new Error("socket reset by peer")
      },
    ),
  })
  await compiler.acceptEvent(event("run-1", "e1", "build the tool"))
  const advanced = await compiler.advance({ runId: "run-1" })
  assert.equal(advanced.ok, false)
  assert.equal(advanced.code, "check_unavailable")
  assert.equal(advanced.retryable, true, "a transport failure on the check is worth one more round")

  const snapshot = store.current()
  assert.equal(snapshot.semantic_checks[0]?.verdict, "unavailable")
  const batch = snapshot.management_log[0]
  assert.equal(batch?.status, "transport_failed")
  assert.equal(batch?.error_code, "check_unavailable")
  // One proposal plus two check samples (the bounded re-check), all recorded.
  const calls = snapshot.management_calls.map((call) => call.kind)
  assert.deepEqual(calls, ["propose", "check", "check"])
  assert.equal(batch?.attempts?.length, 3)
  assert.equal(batch?.attempts?.[0]?.kind, "propose")
  assert.equal(typeof batch?.attempts?.[0]?.text, "string")
  assert.deepEqual(batch?.attempts?.[0]?.issues, [])
})

test("a check answer that does not fit the contract fails immediately and is not re-proposed", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-check-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(
      async () => JSON.stringify(firstTaskCandidate("e1")),
      // A verdict that omits the required dimension: the strict-decoding
      // transports cannot produce this unless the schema we sent is wrong,
      // which is why re-sampling is not attempted.
      async () => JSON.stringify({ schema_version: 2, verdict: "inconsistent", findings: [{ claim: "c", expected: "e", observed: "o", refs: [] }] }),
    ),
  })
  await compiler.acceptEvent(event("run-1", "e1", "build the tool"))
  const advanced = await compiler.advance({ runId: "run-1" })
  assert.equal(advanced.ok, false)
  assert.equal(advanced.code, "check_unavailable")
  assert.equal(advanced.retryable, false, "a contract mismatch repeats itself; a second round would only cost minutes")

  const snapshot = store.current()
  assert.equal(snapshot.semantic_checks[0]?.verdict, "unavailable")
  assert.equal(snapshot.management_log[0]?.status, "schema_failed")
  assert.equal(snapshot.management_log[0]?.error_code, "check_unavailable")
  const calls = snapshot.management_calls.map((call) => call.kind)
  assert.deepEqual(calls, ["propose", "check"], "the candidate is not proposed again after an infrastructure failure")
})
