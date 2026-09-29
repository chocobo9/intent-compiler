import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IntentStoreV2 } from "../src/core/compiler-store-v2.js"

test("reopening recovers a return popped before management finished, but not an accepted return", () => {
  const storeDir = mkdtempSync(join(tmpdir(), "return-recovery-"))
  const options = { storeDir, runId: "r" }
  const store = new IntentStoreV2(options)
  assert.equal(store.acceptEvent({ schema_version: 2, run_id: "r", event_id: "e:return",
    kind: "execution_return", execution_id: "e", source: { producer_id: "host", channel: "executor" },
    payload: { state_claim: "stopped", text: "Implementation built; assess results.", outcome: {
      schema_version: 2, execution_id: "e", atom_ref: { id: "a", revision: 0, digest: `sha256:${"0".repeat(64)}` },
      suggested_status: "ready", product_refs: [], file_changes: [], evidence_refs: [],
    } },
  }).ok, true)
  assert.equal(store.popPending().length, 1)
  assert.deepEqual(new IntentStoreV2(options).pendingEvents().map(event => event.event_id), ["e:return"])
  const path = join(storeDir, "v2-runs", "r", "snapshot.json")
  const saved = JSON.parse(readFileSync(path, "utf8"))
  saved.pending_event_ids = []
  saved.management_log = [{ status: "accepted", trigger_event_ids: ["e:return"] }]
  writeFileSync(path, JSON.stringify(saved))
  assert.deepEqual(new IntentStoreV2(options).pendingEvents(), [])
})
