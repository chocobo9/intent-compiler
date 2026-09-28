import { test } from "node:test"
import assert from "node:assert/strict"
import { buildAuditReport, summarizeAuditReport } from "../src/runtime/audit-report.js"
import type { V2RunSnapshot } from "../src/core/compiler-store-v2.js"

const SOURCE = { source_id: "s-u1", digest: "sha256:0000000000000000000000000000000000000000000000000000000000000001" }

function snapshot(overrides: Partial<V2RunSnapshot> = {}): V2RunSnapshot {
  const base: V2RunSnapshot = {
    schema: "intent-store-v2/0.1",
    run_id: "run-audit",
    ir: {
      "t-1": {
        task_id: "t-1",
        revision: 2,
        goal: { text: "deliver the patch", sources: [] },
        bindings: [{ binding_id: "b-spec", revision: 0, ref: SOURCE, role: "task_data", purpose: "spec", sources: [] }],
        outputs: [
          { output_id: "o-patch", revision: 0, description: "the patch", format: "artifact", sources: [] },
          // Named by the delegation, never taken up by any atom: the audit says so.
          { output_id: "o-unplanned", revision: 0, description: "named but unplanned", format: "text", sources: [] },
        ],
        content: [],
        current_scope: { text: "proceed", disposition: "proceed", sources: [] },
        unresolved: [],
      },
    },
    compiled: {
      "t-1": {
        schema_version: 2,
        artifact_type: "compiled_intent",
        compiled_intent_id: "compiled-1",
        task_id: "t-1",
        compiled_revision: 0,
        intent_basis: [],
        atoms: [
          {
            atom_id: "a-deliver",
            revision: 0,
            goal_refs: [],
            task: "write and build the patch",
            inputs: [{ binding_id: "b-spec", ref: SOURCE, role: "task_data", use: "read the spec" }],
            outputs: [
              { output_id: "o-patch", description: "the patch", format: "artifact" },
              { output_id: "o-never-registered", description: "stale reference", format: "text" },
            ],
            constraints: [],
            optional_tools: ["read", "bash"],
            authority: {
              basis: [SOURCE],
              rules: [
                { operation_id: "read", resource_ref: SOURCE, input_refs: [], output_refs: [], conditions: [], allowed_use: "read the spec" },
                { operation_id: "bash", resource_ref: SOURCE, input_refs: [], output_refs: [], conditions: [], allowed_use: "build" },
              ],
              lifetime: "this_execution",
              delegation: "not_supported",
            },
            preconditions: [],
            completion: [{ text: "patch built", evidence_required: "binary" }],
            return_when: ["atom complete"],
            intent_judgments: [],
          },
        ],
        relations: [],
        attachments: [],
      },
    },
    pending_event_ids: ["e-pending"],
    dispatches: [{
      dispatch_id: "dispatch-1",
      task_id: "t-1",
      compiled_intent_id: "compiled-1",
      atom_id: "a-deliver",
      atom_revision: 0,
      compiled_revision: 0,
      digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }],
    executions: [{
      execution_id: "execution-1",
      dispatch_id: "dispatch-1",
      task_id: "t-1",
      atom_id: "a-deliver",
      status: "closed",
      allowed_calls: [
        { allowed_call_id: "call-1", host_call_id: "host-1", operation_id: "read", tool: "read", args_digest: "sha256:1111" },
      ],
    }],
    execution_outcomes: [{
      execution_id: "execution-1",
      state_claim: "completed",
      outcome: {
        schema_version: 2,
        execution_id: "execution-1",
        atom_ref: { id: "a-deliver", revision: 0, digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        suggested_status: "completed",
        product_refs: [],
        file_changes: [{ path: "out/patch.bin", digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }],
        evidence_refs: [],
      },
      accepted_at: "2026-09-23T00:00:00.000Z",
      atom_status_before: "executing",
      atom_status_after: "completed",
      verified_artifacts: [{ path: "out/patch.bin", digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }],
    }],
    atom_states: [
      { task_id: "t-1", atom_id: "a-preview", atom_revision: 0, compiled_intent_id: "compiled-0", status: "legacy", updated_at: "2026-09-23T00:00:00.000Z" },
      { task_id: "t-1", atom_id: "a-deliver", atom_revision: 0, compiled_intent_id: "compiled-1", status: "completed", updated_at: "2026-09-23T00:00:01.000Z", previous_atom_ref: { id: "a-preview", revision: 0, digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" } },
    ],
    management_log: [
      {
        request_id: "mgmt-1",
        sequence: 1,
        trigger_event_ids: ["e1"],
        started_at: "2026-09-23T00:00:00.000Z",
        completed_at: "2026-09-23T00:01:00.000Z",
        duration_ms: 60_000,
        request: {},
        request_digest: "sha256:dddd",
        source_refs: {
          total: 4,
          resolved: 3,
          normalized: 2,
          unresolved: 1,
          unresolvedRefs: [{ source_id: "s-invented", span: { unit: "utf16", start: 0, end: 5 } }],
        },
        declaration_changes: [{ target: "output", id: "o-patch", from: "text", to: "artifact" }],
        status: "accepted",
        retry: false,
        ir_revisions: { "t-1": 2 },
        compiled_revisions: { "t-1": 0 },
      },
      {
        request_id: "mgmt-2",
        sequence: 2,
        trigger_event_ids: ["e2"],
        started_at: "2026-09-23T00:02:00.000Z",
        completed_at: "2026-09-23T00:03:00.000Z",
        duration_ms: 60_000,
        request: {},
        request_digest: "sha256:eeee",
        status: "validation_failed",
        error_code: "invalid_candidate",
        error_message: "coverage must record where the compiled work goes",
        retry: true,
        ir_revisions: { "t-1": 2 },
        compiled_revisions: { "t-1": 0 },
      },
    ],
    assessments: [],
    checks: [{ scenario: "self check", expected: "x", observed_in_candidate: "y", sources: [], unresolved: false, basis_event_ids: ["e1"], sequence: 1 }],
    questions: [{ text: "which output?", affects: [], basis_event_ids: ["e1"], sequence: 1 }],
    coverage: [{ requirement: { local_ref: "t-1" }, disposition: "assigned", refs: [{ local_ref: "a-deliver" }], explanation: "delivered", basis_event_ids: ["e1"], sequence: 1, task_id: "t-1" }],
    semantic_checks: [
      { basis_event_ids: ["e1"], sequence: 1, verdict: "inconsistent", findings: [{ claim: "c", expected: "e", observed: "o", refs: [] }], task_ids: ["t-1"] },
      { basis_event_ids: ["e2"], sequence: 2, verdict: "consistent", findings: [], task_ids: ["t-1"] },
    ],
    denied_calls: [
      { kind: "operation", at: "2026-09-23T00:00:02.000Z", code: "capability_unsupported", message: "operation op.write is not covered", execution_id: "execution-1", host_call_id: "host-9", operation_id: "op.write" },
    ],
    management_calls: [
      { call_id: "call-1", request_id: "mgmt-1", kind: "propose", started_at: "2026-09-23T00:00:00.000Z", completed_at: "2026-09-23T00:04:00.000Z", duration_ms: 240_000, status: "ok", usage: { input_tokens: 900, output_tokens: 12_000, reasoning_tokens: 9_000 } },
      { call_id: "call-2", request_id: "mgmt-1", kind: "check", started_at: "2026-09-23T00:04:00.000Z", completed_at: "2026-09-23T00:06:00.000Z", duration_ms: 120_000, status: "ok", usage: { input_tokens: 1_000, output_tokens: 6_000, reasoning_tokens: 5_000 } },
    ],
    management_call_sequence: 2,
    compiled_intent_sequence: 1,
    budget: {
      management_requests: 2,
      total_management_requests: 2,
      management_input_tokens: 1000,
      management_output_tokens: 500,
      management_reasoning_tokens: 300,
      management_cache_read_tokens: 0,
      management_cache_write_tokens: 0,
      management_cost: "unavailable",
      max_management_requests: 3,
      max_total_management_requests: 30,
      max_management_input_tokens: 64_000,
      max_management_output_tokens: 6_000,
    },
  }
  return { ...base, ...overrides }
}

test("audit report states the chain, permissions, declarations, checks, and cost", () => {
  const report = buildAuditReport(snapshot())

  const atom = report.chain.tasks[0]?.atoms[0]
  assert.equal(report.chain.tasks[0]?.compiled_intent_id, "compiled-1")
  assert.equal(atom?.status, "completed")
  assert.deepEqual(atom?.dispatch_ids, ["dispatch-1"])
  assert.deepEqual(atom?.execution_ids, ["execution-1"])
  assert.equal(atom?.outcomes[0]?.verified_artifacts, 1)
  // The ledger's supersession link is visible without reading the raw ledger.
  assert.equal(report.chain.tasks[0]?.atoms.length, 1, "only the current artifact's atoms are listed")

  // Granted but never called: the audit shows the gap instead of hiding it.
  assert.deepEqual(report.permissions.granted_unused, [{ atom: "a-deliver@0", operation_id: "bash" }])
  assert.deepEqual(report.permissions.tool_calls_by_operation, { read: 1 })
  assert.equal(report.permissions.denied_calls.length, 1)
  assert.equal(report.permissions.denied_calls[0]?.code, "capability_unsupported")

  // Declared deliverables are listed; one the delegation names but no atom
  // delivers is reported as such, and a shape change the batch made to a
  // derived entry is recorded instead of rejected.
  assert.deepEqual(report.declarations.outputs.map((output) => output.output_id), ["o-patch", "o-unplanned"])
  assert.deepEqual(report.declarations.bindings.map((binding) => binding.binding_id), ["b-spec"])
  assert.deepEqual(report.declarations.declared_not_delivered, [{ task_id: "t-1", target: "output", id: "o-unplanned" }])
  assert.deepEqual(report.declarations.shape_changes, [{ request_id: "mgmt-1", target: "output", id: "o-patch", from: "text", to: "artifact" }])
  assert.deepEqual(report.declarations.verified_artifacts, [{ path: "out/patch.bin", digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }])

  assert.equal(report.checks.self_reported_checks, 1)
  assert.equal(report.checks.independent.length, 2)
  assert.deepEqual(report.checks.independent.map((check) => check.verdict), ["inconsistent", "consistent"])
  assert.equal(report.checks.questions, 1)
  assert.deepEqual(report.checks.coverage, [{ disposition: "assigned", requirement: "t-1", task_id: "t-1" }])

  assert.equal(report.cost.management_requests, 2)
  assert.equal(report.cost.tool_calls, 1)
  assert.deepEqual(report.cost.per_request.map((request) => request.status), ["accepted", "validation_failed"])
  // Each management call is measured on its own; the batch total is an aggregate,
  // not a call duration. The kind split is what answers "propose or check?".
  assert.deepEqual(report.cost.per_call.map((call) => [call.call_id, call.kind, call.duration_ms]), [
    ["call-1", "propose", 240_000],
    ["call-2", "check", 120_000],
  ])
  assert.deepEqual(report.cost.by_kind, {
    propose: { calls: 1, duration_ms: 240_000, output_tokens: 12_000, reasoning_tokens: 9_000 },
    check: { calls: 1, duration_ms: 120_000, output_tokens: 6_000, reasoning_tokens: 5_000 },
  })
  assert.deepEqual(report.failures.map((failure) => failure.code), ["invalid_candidate", "capability_unsupported"])
  assert.deepEqual(report.pending_events, ["e-pending"])
  // Source references: what the candidate claimed, what resolved, and how many
  // digests the mechanical layer had to write because the model cannot hash.
  assert.deepEqual(report.references, {
    claimed: 4,
    resolved: 3,
    normalized: 2,
    unresolvable: 1,
    by_request: [{ request_id: "mgmt-1", claimed: 4, resolved: 3, normalized: 2, unresolvable: 1 }],
    // The invented reference itself, not just its count.
    unresolved_refs: [{ request_id: "mgmt-1", source_id: "s-invented", span: { unit: "utf16", start: 0, end: 5 } }],
  })
  // One line per user event: what that message actually cost, calls included.
  assert.deepEqual(report.cost.by_user_event, [
    { event_ids: ["e1"], batches: 1, calls: 2, propose: 1, check: 1 },
    { event_ids: ["e2"], batches: 1, calls: 1, propose: 1, check: 0, estimated: true },
  ])

  const summary = summarizeAuditReport(report)
  assert.match(summary, /atoms=1 completed=1/)
  assert.match(summary, /refused=1/)
  assert.match(summary, /artifacts_verified=1/)
  assert.match(summary, /independent_checks=inconsistent,consistent/)
  assert.match(summary, /pending=1/)
  assert.match(summary, /management_calls=2 \(propose 1x\/240000ms,check 1x\/120000ms\)/)
  assert.match(summary, /user_events=2 max_calls_per_event=2/)
  assert.match(summary, /source_refs=3\/4 written=2 unresolvable=1/)
})

test("audit report on an empty run states zeros instead of failing", () => {
  const report = buildAuditReport(snapshot({
    ir: {},
    compiled: {},
    dispatches: [],
    executions: [],
    execution_outcomes: [],
    atom_states: [],
    management_log: [],
    checks: [],
    questions: [],
    coverage: [],
    semantic_checks: [],
    denied_calls: [],
    management_calls: [],
    pending_event_ids: [],
  }))

  assert.deepEqual(report.chain.tasks, [])
  assert.deepEqual(report.permissions.granted_unused, [])
  assert.deepEqual(report.failures, [])
  assert.equal(report.cost.tool_calls, 0)
  assert.deepEqual(report.cost.per_call, [])
  assert.deepEqual(report.cost.by_kind, {})
  assert.equal(report.references.claimed, 0)
  assert.deepEqual(report.references.by_request, [])
  assert.equal(summarizeAuditReport(report).includes("atoms=0 completed=0"), true)
})
