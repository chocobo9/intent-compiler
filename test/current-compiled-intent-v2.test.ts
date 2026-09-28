import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IntentStoreV2 } from "../src/core/compiler-store-v2.js"
import { readCurrentCompiledIntentV2 } from "../src/runtime/current-compiled-intent-v2.js"
import type { CompilerEvent } from "../src/core/intent-contract.js"

test("v2 current compiled intent read returns the per-task index without mutation", () => {
  const storeDir = mkdtempSync(join(tmpdir(), "intent-v2-read-"))
  const store = new IntentStoreV2({ storeDir, runId: "run-1" })
  const event: CompilerEvent = {
    schema_version: 2,
    run_id: "run-1",
    event_id: "e1",
    kind: "user_input",
    source: { producer_id: "host", channel: "user" },
    task_ids: ["t"],
    payload: { text: "hello" },
  }
  assert.equal(store.acceptEvent(event).ok, true)
  const view = readCurrentCompiledIntentV2({ storeDir, runId: "run-1" })
  assert.equal(view.runId, "run-1")
  assert.deepEqual(view.pendingEventIds, ["e1"])
  assert.deepEqual(view.compiled, {})
  assert.throws(
    () => readCurrentCompiledIntentV2({ storeDir, runId: "run-1", taskId: "missing" }),
    (error: unknown) => (error as { code?: string }).code === "TASK_NOT_FOUND",
  )
})

