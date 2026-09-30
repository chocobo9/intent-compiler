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

test("a batch carries one event, oldest first, and leaves the rest queued", async () => {
  const storeDir = directory()
  const s = new IntentStoreV2({ storeDir, runId })
  const compiler = createIntentCompilerV2({ store: s, model: failingModel })
  await compiler.acceptEvent(event("e1"))
  await compiler.acceptEvent(event("e2"))
  const first = await compiler.advance({ runId })
  assert.equal(first.ok, false)
  assert.deepEqual(s.current().management_log[0]?.trigger_event_ids, ["e1"])
  assert.deepEqual([...s.current().pending_event_ids].sort(), ["e1", "e2"], "the failed event is retried and the later one waits")
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

test("an input that outlives three failed batches is set aside and stops suspending the run", async () => {
  const storeDir = directory()
  const s = new IntentStoreV2({ storeDir, runId })
  const compiler = createIntentCompilerV2({ store: s, model: failingModel })
  await compiler.acceptEvent(event("e1"))
  await compiler.acceptEvent(event("e2"))
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assert.equal((await compiler.advance({ runId })).ok, false)
    assert.deepEqual(s.current().management_log.at(-1)?.trigger_event_ids, ["e1"], `attempt ${attempt} replays e1 alone`)
  }
  const records = s.current().management_log
  assert.equal(records.length, 3)
  assert.deepEqual(records.at(-1)?.deferred_event_ids, ["e1"], "the third failure sets e1 aside")
  assert.match(records.at(-1)?.error_message ?? "", /set aside/)
  assert.deepEqual(s.current().pending_event_ids, ["e2"], "e1 is no longer offered to a batch")
  assert.deepEqual(s.current().unresolved_user_event_ids, ["e2"], "the set-aside delegation no longer suspends run authority; the queued one still does")
  // The rule reads the batch log, so a restart cannot resurrect the input.
  const reloaded = new IntentStoreV2({ storeDir, runId })
  assert.deepEqual(reloaded.pendingEvents().map(entry => entry.event_id), ["e2"])
  assert.deepEqual(reloaded.current().unresolved_user_event_ids, ["e2"])
  assert.equal((await compiler.advance({ runId })).ok, false)
  assert.deepEqual(s.current().management_log.at(-1)?.trigger_event_ids, ["e2"], "the queue moves on to the next input")
})
