import { test } from "node:test"
import assert from "node:assert/strict"
import { advanceForTurn } from "../src/adapters/opencode.js"
import type { IntentCompilerV2 } from "../src/core/intent-compiler-v2.js"
import type { AdvanceResult } from "../src/core/intent-contract.js"

function failure(retryable: boolean): AdvanceResult {
  return {
    ok: false,
    run_id: "run-1",
    disposition: "failed",
    pending_events: [],
    compiled_revisions: {},
    ir_revisions: {},
    retryable,
    code: "invalid_candidate",
    message: "boom",
  }
}

function success(): AdvanceResult {
  return {
    ok: true,
    run_id: "run-1",
    disposition: "unchanged",
    pending_events: [],
    compiled_revisions: {},
    ir_revisions: {},
  }
}

/** The host spends a second advance round only where a fresh round can differ. */
test("a transport-level failure gets one more advance round", async () => {
  const replies = [failure(true), success()]
  let calls = 0
  const compiler = { advance: async () => { calls += 1; return replies.shift() as AdvanceResult } } as unknown as IntentCompilerV2
  const result = await advanceForTurn(compiler, "run-1")
  assert.equal(result.ok, true)
  assert.equal(calls, 2)
})

test("a semantic or mechanical failure is not re-rolled", async () => {
  let calls = 0
  const compiler = { advance: async () => { calls += 1; return failure(false) } } as unknown as IntentCompilerV2
  await assert.rejects(advanceForTurn(compiler, "run-1"), /boom/u)
  assert.equal(calls, 1, "a rejection that repeats itself must not spend the task budget twice")
})

test("a retryable failure that repeats is still bounded by the attempt count", async () => {
  let calls = 0
  const compiler = { advance: async () => { calls += 1; return failure(true) } } as unknown as IntentCompilerV2
  await assert.rejects(advanceForTurn(compiler, "run-1"), /after 2 advance attempts/u)
  assert.equal(calls, 2)
})
