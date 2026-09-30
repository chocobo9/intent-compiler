import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IntentStoreV2 } from "../src/core/compiler-store-v2.js"
import { createIntentCompilerV2 as createCompilerV2 } from "../src/core/intent-compiler-v2.js"
import type { CompilerEvent } from "../src/core/intent-contract.js"

// The queue rules are independent of the strict requirement flow: these batches
// only have to fail, so the stub answer never has to be a valid candidate.
const createIntentCompilerV2 = (options: Parameters<typeof createCompilerV2>[0]) =>
  createCompilerV2({ ...options, requirement_integrity: "legacy" })

const runId = "batch-queue"
function event(id: string): CompilerEvent {
  return { schema_version: 2, run_id: runId, event_id: id, kind: "user_input", source: { producer_id: "host", channel: "user" }, task_ids: ["t1"], payload: { text: `Delegation ${id}.` } }
}
const failingModel = { propose: async () => ({ ok: false as const, error: { code: "schema" as const, message: "stub rejection" } }) }
const directory = () => mkdtempSync(join(tmpdir(), "intent-batch-queue-"))

test("a batch carries the newest delegation as its own event and the older uncompiled one beside it", async () => {
  const storeDir = directory()
  const s = new IntentStoreV2({ storeDir, runId })
  const compiler = createIntentCompilerV2({ store: s, model: failingModel })
  await compiler.acceptEvent(event("e1"))
  await compiler.acceptEvent(event("e2"))
  const first = await compiler.advance({ runId })
  assert.equal(first.ok, false)
  // The turn answers its own instruction; the earlier uncompiled delegation is
  // carried as an unresolved task instead of being replayed at the head of the
  // queue (the 20260929 run fell rounds behind that way).
  assert.deepEqual(s.current().management_log[0]?.trigger_event_ids, ["e2", "e1"])
  assert.deepEqual(s.current().management_log[0]?.carried_event_ids, ["e1"])
  assert.deepEqual(s.current().management_log[0]?.carried_outcomes, [{ event_id: "e1", adopted: false, failed_batches: 1 }])
  assert.deepEqual([...s.current().pending_event_ids].sort(), ["e1", "e2"], "a failed batch returns every event it carried")
  assert.deepEqual(s.carriedDelegations().map(gap => gap.event_id), ["e1", "e2"])
})

test("a delegation outranks older evidence, so its turn can still dispatch", async () => {
  const storeDir = directory()
  const s = new IntentStoreV2({ storeDir, runId })
  const compiler = createIntentCompilerV2({ store: s, model: failingModel })
  const evidence: CompilerEvent = { schema_version: 2, run_id: runId, event_id: "r1", kind: "capability_change", source: { producer_id: "host", channel: "host" }, task_ids: ["t1"], payload: { operations: ["read"] } }
  const receipt = await compiler.acceptEvent(evidence)
  assert.equal(receipt.ok, true, receipt.message)
  await compiler.acceptEvent(event("u1"))
  assert.equal((await compiler.advance({ runId })).ok, false)
  assert.deepEqual(s.current().management_log[0]?.trigger_event_ids, ["u1"], "an assessment-only batch cannot answer the turn that brought the delegation")
  assert.equal(s.current().pending_event_ids.includes("r1"), true, "the earlier evidence waits for a turn without a delegation")
})

test("an input that outlives three failed batches stays carried and is reported instead of dropped", async () => {
  const storeDir = directory()
  const s = new IntentStoreV2({ storeDir, runId })
  const compiler = createIntentCompilerV2({ store: s, model: failingModel })
  await compiler.acceptEvent(event("e1"))
  await compiler.acceptEvent(event("e2"))
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assert.equal((await compiler.advance({ runId })).ok, false)
    assert.deepEqual(s.current().management_log.at(-1)?.trigger_event_ids, ["e2", "e1"], `attempt ${attempt} answers e2 and carries e1`)
  }
  const records = s.current().management_log
  assert.equal(records.length, 3)
  assert.equal(records.at(-1)?.deferred_event_ids, undefined, "a delegation is no longer set aside")
  assert.match(records.at(-1)?.error_message ?? "", /still carried/)
  // Both delegations remain unresolved work: the next turn's batch carries them
  // again, and the record says the stalled one is still not compiled.
  assert.deepEqual([...s.current().pending_event_ids].sort(), ["e1", "e2"])
  const stalled = s.current().questions.filter(question => question.text.includes("stays carried as an unresolved task"))
  assert.equal(stalled.length, 2, "each stalled delegation is reported once, e1 and e2")
  assert.ok(s.carriedDelegations().every(gap => gap.stalled))
  // The rule reads the journal and the batch log, so a restart reaches the same conclusion.
  const reloaded = new IntentStoreV2({ storeDir, runId })
  assert.deepEqual(reloaded.pendingEvents().map(entry => entry.event_id), ["e1", "e2"])
  assert.deepEqual(reloaded.current().unresolved_user_event_ids, ["e1", "e2"])
  assert.deepEqual(reloaded.carriedDelegations().map(gap => gap.event_id), ["e1", "e2"])
  assert.equal((await compiler.advance({ runId })).ok, false)
  assert.deepEqual(s.current().management_log.at(-1)?.trigger_event_ids, ["e2", "e1"], "the next turn again carries the earlier delegation")
})

test("a delegation stops being carried once the IR registers its text", async () => {
  const storeDir = directory()
  const s = new IntentStoreV2({ storeDir, runId })
  const compiler = createIntentCompilerV2({ store: s, model: failingModel })
  await compiler.acceptEvent(event("e1"))
  await compiler.acceptEvent(event("e2"))
  assert.equal((await compiler.advance({ runId })).ok, false)
  assert.deepEqual(s.carriedDelegations().map(gap => gap.event_id), ["e1", "e2"])
  // The management commit registers e1's text as a requirement; e1 is no longer
  // an unresolved task even though its batch failed earlier.
  const text = "Delegation e1."
  const ir = {
    t1: {
      task_id: "t1", revision: 0,
      goal: { text, sources: [{ source_id: "e1", digest: "sha256:x", span: { unit: "utf16", start: 0, end: text.length } }] },
      bindings: [], outputs: [],
      content: [{ item_id: "r1", revision: 0, text, sources: [{ source_id: "e1", digest: "sha256:x", span: { unit: "utf16", start: 0, end: text.length } }], about: [], scope: [{ target_id: "t1" }], support: [] }],
      current_scope: { text: "proceed", disposition: "proceed", sources: [] }, unresolved: [],
    },
  }
  s.applyDeltas({ ir: ir as never })
  assert.deepEqual(s.carriedDelegations().map(gap => gap.event_id), ["e2"])
})
