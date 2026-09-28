import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IntentStoreV2 } from "../src/core/compiler-store-v2.js"
import { createIntentCompilerV2 } from "../src/core/intent-compiler-v2.js"
import { CANDIDATE_EXAMPLE } from "../src/model/candidate-example.js"
import type { CompilerModelV2, CompilerModelV2Input } from "../src/model/compiler-model-v2.js"
import { digestOf, digestText, type Candidate, type CompilerEvent } from "../src/core/intent-contract.js"
import { buildAuditReport } from "../src/runtime/audit-report.js"

// Expectations are fixed in development/validation/2026-09-24-repair-batch/SCOPE.md.
// These use the public compiler and real persistence; model responses are stubs.
const TEXT = "Deliver the requested fix without reading the linked PR."
function event(id = "e1", text = TEXT): CompilerEvent {
  return { schema_version: 2, run_id: "repair-batch", event_id: id, kind: "user_input", source: { producer_id: "host", channel: "user" }, task_ids: ["t1"], payload: { text } }
}
function candidate(): Candidate {
  return JSON.parse(JSON.stringify(CANDIDATE_EXAMPLE)
    .replaceAll("<triggered-event-id>", "e1")
    .replaceAll("input-event-id", "e1")
    .replaceAll("sha256:0000000000000000000000000000000000000000000000000000000000000001", digestText(TEXT))) as Candidate
}
function store(): IntentStoreV2 {
  return new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-repair-batch-")), runId: "repair-batch" })
}
function proposed(value: Candidate) {
  return { ok: true, candidate: value, call: { text: JSON.stringify(value), text_source: "text" as const } }
}
const consistent: NonNullable<CompilerModelV2["verify"]> = async () => ({ verdict: { verdict: "consistent", findings: [] } })
const inconsistent: NonNullable<CompilerModelV2["verify"]> = async () => ({
  verdict: {
    verdict: "inconsistent",
    findings: [{ dimension: "D1", claim: "material use conflicts with the delegation", expected: "do not read the PR", observed: "the stub reports a conflict", refs: [{ source_id: "e1", digest: digestText(TEXT) }] }],
  },
})

// Structural views let the regressions compile against the pre-fix input type.
interface RepairView {
  source_request_id: string
  candidate: Candidate
  candidate_digest: string
  basis_status: "unchanged" | "changed" | "unavailable"
}
function repair(input: CompilerModelV2Input): RepairView | undefined {
  return (input as CompilerModelV2Input & { repair_context?: RepairView }).repair_context
}

test("R1 semantic rejection has the same code in result, record and audit", async () => {
  const s = store()
  const compiler = createIntentCompilerV2({ store: s, model: { propose: async () => proposed(candidate()), verify: inconsistent } })
  await compiler.acceptEvent(event())
  const result = await compiler.advance({ runId: "repair-batch" })
  assert.equal(result.code, "semantic_unresolved")
  assert.equal(s.current().management_log[0]?.error_code, result.code)
  assert.equal(buildAuditReport(s.current()).failures[0]?.code, result.code)
  assert.deepEqual(s.current().pending_event_ids, ["e1"])
  assert.equal(s.current().dispatches.length, 0)
  assert.deepEqual(s.current().compiled, {})
})

test("R1 mechanical and unavailable checks keep their own attribution", async () => {
  for (const kind of ["mechanical", "check"] as const) {
    const s = store()
    const compiler = createIntentCompilerV2({ store: s, model: {
      propose: async () => { const value = candidate(); if (kind === "mechanical") value.basis.event_ids = ["absent"]; return proposed(value) },
      verify: async () => ({ error: { code: "schema", message: "unusable checker response" } }),
    } })
    await compiler.acceptEvent(event())
    const result = await compiler.advance({ runId: "repair-batch" })
    assert.equal(result.code, kind === "mechanical" ? "invalid_candidate" : "check_unavailable")
    assert.equal(s.current().management_log[0]?.error_code, result.code)
    assert.equal(s.current().dispatches.length, 0)
  }
})

test("R1 later mechanical failure does not inherit a prior semantic rejection", async () => {
  const s = store()
  // Four calls are allowed only to reach the later-failure branch. This is not
  // a recovery-benefit test or a change to the production three-call budget.
  s.applyDeltas({ max_management_requests: 4 })
  let proposedCount = 0
  const compiler = createIntentCompilerV2({ store: s, model: {
    propose: async () => { const value = candidate(); if (++proposedCount > 1) value.basis.event_ids = ["absent"]; return proposed(value) },
    verify: inconsistent,
  } })
  await compiler.acceptEvent(event())
  const result = await compiler.advance({ runId: "repair-batch" })
  assert.equal(proposedCount, 2)
  assert.equal(result.code, "invalid_candidate")
  assert.equal(s.current().management_log[0]?.error_code, result.code)
  assert.equal(s.current().semantic_checks[0]?.verdict, "inconsistent", "earlier evidence is retained")
})

test("R1 a check that cannot fit the budget is not a semantic verdict", async () => {
  const s = store()
  s.applyDeltas({ max_management_requests: 1 })
  let checks = 0
  const compiler = createIntentCompilerV2({ store: s, model: { propose: async () => proposed(candidate()), verify: async (input) => { checks++; return consistent(input) } } })
  await compiler.acceptEvent(event())
  const result = await compiler.advance({ runId: "repair-batch" })
  assert.equal(checks, 0)
  assert.equal(result.code, "budget_exhausted")
  assert.equal(s.current().management_log[0]?.error_code, result.code)
  assert.equal(s.current().semantic_checks.length, 0)
})

test("R1 proposal schema failure is the same cause in result and record", async () => {
  const s = store()
  const compiler = createIntentCompilerV2({ store: s, model: { propose: async () => ({ ok: false, error: { code: "schema", message: "bad candidate response" } }) } })
  await compiler.acceptEvent(event())
  const result = await compiler.advance({ runId: "repair-batch" })
  assert.equal(result.code, "schema")
  assert.equal(s.current().management_log[0]?.error_code, result.code)
})

test("R2 an in-batch repair receives the exact rejected draft and records its changes", async () => {
  const s = store()
  const seen: CompilerModelV2Input[] = []
  const rejected = candidate()
  rejected.groups[0]!.coverage = []
  const compiler = createIntentCompilerV2({ store: s, model: {
    propose: async (input) => { seen.push(structuredClone(input)); return proposed(structuredClone(seen.length === 1 ? rejected : candidate())) },
    verify: consistent,
  } })
  await compiler.acceptEvent(event())
  const result = await compiler.advance({ runId: "repair-batch" })
  assert.equal(result.ok, true)
  assert.equal(repair(seen[0]!), undefined)
  const context = repair(seen[1]!)
  assert.ok(context)
  assert.deepEqual(context.candidate, rejected)
  assert.equal(context.candidate_digest, digestOf(rejected))
  assert.equal(context.source_request_id, "mgmt-1")
  assert.equal(context.basis_status, "unchanged")
  const attempts = s.current().management_log[0]!.attempts!
  const changed = (attempts[1] as typeof attempts[number] & { candidate_changes?: { paths: string[] } }).candidate_changes
  assert.ok(changed?.paths.some((path) => path.startsWith("/groups/0/coverage")))
  assert.equal(s.current().management_calls.length, 3)
  assert.equal(s.current().dispatches.length, 1)
})

test("R2 cross-batch repair distinguishes identical input from new user restrictions", async () => {
  for (const changed of [false, true]) {
    const s = store()
    const seen: CompilerModelV2Input[] = []
    const compiler = createIntentCompilerV2({ store: s, model: { propose: async (input) => { seen.push(structuredClone(input)); return proposed(candidate()) }, verify: inconsistent } })
    await compiler.acceptEvent(event())
    await compiler.advance({ runId: "repair-batch" })
    const before = s.current().management_log[0]!
    if (changed) await compiler.acceptEvent(event("e2", "Stop the fix; retain it only as a draft."))
    await compiler.advance({ runId: "repair-batch" })
    const context = repair(seen[1]!)
    assert.ok(context)
    assert.deepEqual(context.candidate, before.candidate)
    assert.equal(context.candidate_digest, before.candidate_digest)
    assert.equal(context.source_request_id, "mgmt-1")
    assert.equal(context.basis_status, changed ? "changed" : "unchanged")
    assert.deepEqual(s.current().management_log[0], before, "old evidence is immutable")
    assert.deepEqual(s.current().compiled, {})
    assert.equal(s.current().dispatches.length, 0)
  }
})

test("R2 a failed call with no candidate does not manufacture a repair draft", async () => {
  const s = store()
  const seen: CompilerModelV2Input[] = []
  const compiler = createIntentCompilerV2({ store: s, model: { propose: async (input) => { seen.push(structuredClone(input)); return { ok: false, error: { code: "schema", message: "no candidate" } } } } })
  await compiler.acceptEvent(event())
  await compiler.advance({ runId: "repair-batch" })
  await compiler.advance({ runId: "repair-batch" })
  assert.equal(repair(seen[1]!), undefined)
  assert.ok(seen[1]?.previous_rejection)
})

test("R3 original counterexample preserves exclusion rather than inventing PR use", () => {
  const fixture = JSON.parse(readFileSync(new URL("../../development/validation/2026-09-24-repair-batch/turn-2-finding-counterexample.json", import.meta.url), "utf8").replace(/^\uFEFF/u, ""))
  assert.deepEqual(fixture.candidate_goal_refs, [])
  assert.equal(fixture.candidate_pr_coverage[0].disposition, "paused")
  assert.match(fixture.candidate_pr_coverage[0].explanation, /no atom reads or fetches it/)
  assert.match(fixture.finding.observed, /goal_refs/)
  assert.match(fixture.runtime_expectation, /^UNDECIDED/)
})
