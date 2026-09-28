import { test } from "node:test"
import assert from "node:assert/strict"
import {
  candidateIssues,
  proposalIssues,
  registrationChanges,
  resolveCheckEvidence,
  resolveSourceRefs,
  validateCandidateBasis,
} from "../src/core/intent-compiler-v2.js"

/**
 * The offline gate replay (experiments/evocode/gate-replay.mjs) imports these
 * from dist, so the runtime and the replay must answer with the very same
 * functions.  This is the guard that the export surface still exists and still
 * rejects the shape the live loop rejects.
 */
test("offline gate replay shares the runtime gate functions", () => {
  const events = [{ event_id: "e-1", kind: "user_input", payload: { text: "do the work" } }]
  const empty = validateCandidateBasis({ basis: { event_ids: [], refs: [] } } as never, events as never)
  assert.equal(empty.ok, false)
  assert.match(empty.message ?? "", /basis/i)

  const named = validateCandidateBasis({ basis: { event_ids: ["e-1"], refs: [] } } as never, events as never)
  assert.equal(named.ok, true)

  // The four entry points the replay script calls must be callable functions.
  for (const entry of [proposalIssues, candidateIssues, registrationChanges, resolveCheckEvidence, resolveSourceRefs]) {
    assert.equal(typeof entry, "function")
  }
})
