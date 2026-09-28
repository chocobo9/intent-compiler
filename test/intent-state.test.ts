import assert from "node:assert/strict"
import test from "node:test"
import {
  PROPOSAL_OPERATION_NAMES,
  type AdmittedEvidence,
  type InputContext,
  type IntentState,
  type ProposalEnvelope,
  type ProposalOperation,
  applyProposal,
  createInitialIntentState,
} from "../src/core/intent-state.js"

const text = "Build the parser and keep the tests green."
const context: InputContext = {
  input_identity: "input-1",
  input_digest: "input-digest-1",
  text,
  admitted_evidence: [],
}

function source(start = 0, end = text.length) {
  return { channel: "user" as const, input_identity: context.input_identity, input_digest: context.input_digest, start, end }
}

function proposal(state: IntentState, operations: ProposalOperation[], input = context): ProposalEnvelope {
  return {
    base_state_version: state.state_version,
    input_identity: input.input_identity,
    input_digest: input.input_digest,
    operations,
  }
}

function apply(state: IntentState, operations: ProposalOperation[], input = context): IntentState {
  const result = applyProposal(state, proposal(state, operations, input), input)
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("; "))
  return result.state
}

function createTask(state: IntentState, ref = "task-local", description = "[LLM-PROTOTYPE] Parser task"): IntentState {
  return apply(state, [{ operation: "create_task", local_ref: ref, description, source: source() }])
}

test("the operation surface is closed and every legal operation is named", () => {
  assert.deepEqual(PROPOSAL_OPERATION_NAMES, [
    "create_task",
    "select_task",
    "suspend_task",
    "resume_task",
    "add_requirement",
    "replace_requirement",
    "withdraw_requirement",
    "add_unresolved",
    "resolve_unresolved",
    "add_authority",
    "replace_authority",
    "withdraw_authority",
    "record_execution_fact",
    "record_execution_status",
    "no_change",
  ])
})

test("create/select/requirement/unresolved/Authority operations use code IDs and preserve source spans", () => {
  let state = createInitialIntentState()
  state = apply(state, [
    { operation: "create_task", local_ref: "task-local", description: "[LLM-PROTOTYPE] Parser task", source: source(0, 5) },
    { operation: "select_task", task_id: "task-local", source: source(0, 5) },
    { operation: "add_requirement", task_id: "task-local", local_ref: "requirement-local", text: "[LLM-PROTOTYPE] Keep parser errors visible.", source: source(6, 15) },
    { operation: "add_unresolved", task_id: "task-local", local_ref: "unresolved-local", alternatives: ["[LLM-PROTOTYPE] use a stream", "[LLM-PROTOTYPE] use a buffer"], source: source(16, 25) },
    { operation: "add_authority", scope: "global", local_ref: "authority-local", text: "[LLM-PROTOTYPE] The user controls the final choice.", source: source(26, text.length) },
  ])

  assert.equal(state.state_version, 1)
  assert.deepEqual(state.task_occurrences.map((task) => task.id), ["task-0001"])
  assert.deepEqual(state.requirements.map((requirement) => requirement.id), ["requirement-0001"])
  assert.deepEqual(state.unresolved_content.map((item) => item.id), ["unresolved-0001"])
  assert.deepEqual(state.authorities.map((authority) => authority.id), ["authority-0001"])
  assert.equal(state.selected_task_id, "task-0001")
  assert.equal(state.requirements[0].source.start, 6)
  assert.equal(state.requirements[0].source.end, 15)
})

test("similar task text creates separate occurrences, never an implicit merge", () => {
  let state = createInitialIntentState()
  state = apply(state, [{ operation: "create_task", local_ref: "a", description: "[LLM-PROTOTYPE] Fix parser", source: source() }])
  state = apply(state, [{ operation: "create_task", local_ref: "b", description: "[LLM-PROTOTYPE] Fix parser", source: source() }])
  assert.deepEqual(state.task_occurrences.map((task) => task.id), ["task-0001", "task-0002"])
})

test("suspended tasks accept requirement changes but cannot be selected until resumed", () => {
  let state = createTask(createInitialIntentState())
  const taskId = state.task_occurrences[0].id
  state = apply(state, [{ operation: "suspend_task", task_id: taskId, source: source() }])
  const suspended = apply(state, [{ operation: "add_requirement", task_id: taskId, local_ref: "suspended-requirement", text: "[LLM-PROTOTYPE] Change while suspended.", source: source() }])
  assert.equal(suspended.requirements.length, 1)
  const rejectedSelection = applyProposal(suspended, proposal(suspended, [{ operation: "select_task", task_id: taskId, source: source() }]), context)
  assert.equal(rejectedSelection.ok, false)
  assert.equal(rejectedSelection.state.state_version, suspended.state_version)
  state = apply(suspended, [{ operation: "resume_task", task_id: taskId, source: source() }])
  state = apply(state, [{ operation: "select_task", task_id: taskId, source: source() }])
  assert.equal(state.selected_task_id, taskId)
})

test("replacement, withdrawal, and resolution keep historical records", () => {
  let state = createTask(createInitialIntentState())
  const taskId = state.task_occurrences[0].id
  state = apply(state, [{ operation: "add_requirement", task_id: taskId, local_ref: "old-r", text: "[LLM-PROTOTYPE] Keep the old behavior.", source: source() }])
  const oldRequirementId = state.requirements[0].id
  state = apply(state, [{ operation: "replace_requirement", requirement_id: oldRequirementId, local_ref: "new-r", text: "[LLM-PROTOTYPE] Use the new behavior.", source: source() }])
  assert.equal(state.requirements.length, 2)
  assert.equal(state.requirements[0].status, "superseded")
  assert.equal(state.requirements[0].replaced_by, state.requirements[1].id)
  state = apply(state, [{ operation: "withdraw_requirement", requirement_id: state.requirements[1].id, source: source() }])
  assert.equal(state.requirements[1].status, "withdrawn")

  state = apply(state, [{ operation: "add_unresolved", task_id: taskId, local_ref: "choice", alternatives: ["[LLM-PROTOTYPE] A", "[LLM-PROTOTYPE] B"], source: source() }])
  const unresolvedId = state.unresolved_content[0].id
  state = apply(state, [{ operation: "resolve_unresolved", unresolved_id: unresolvedId, resolution: "[LLM-PROTOTYPE] B", source: source() }])
  assert.equal(state.unresolved_content.length, 1)
  assert.equal(state.unresolved_content[0].status, "resolved")
  assert.equal(state.unresolved_content[0].resolution, "[LLM-PROTOTYPE] B")
})

test("Authority replacement and withdrawal preserve scope and tombstones", () => {
  let state = createTask(createInitialIntentState())
  const taskId = state.task_occurrences[0].id
  state = apply(state, [{ operation: "add_authority", scope: "task", task_id: taskId, local_ref: "task-authority", text: "[LLM-PROTOTYPE] Only inspect the requested task.", source: source() }])
  const oldId = state.authorities[0].id
  state = apply(state, [{ operation: "replace_authority", authority_id: oldId, local_ref: "replacement-authority", text: "[LLM-PROTOTYPE] Only modify the requested task.", source: source() }])
  assert.equal(state.authorities[0].status, "superseded")
  assert.equal(state.authorities[1].task_id, taskId)
  state = apply(state, [{ operation: "withdraw_authority", authority_id: state.authorities[1].id, source: source() }])
  assert.equal(state.authorities[1].status, "withdrawn")
})

test("invalid operation rejects the whole proposal atomically", () => {
  const initial = createInitialIntentState()
  const result = applyProposal(
    initial,
    proposal(initial, [
      { operation: "create_task", local_ref: "new-task", description: "Will not commit", source: source() },
      { operation: "unknown_operation" as never, source: source() },
    ]),
    context,
  )
  assert.equal(result.ok, false)
  assert.deepEqual(result.state, initial)
  assert.equal(result.state.task_occurrences.length, 0)
})

test("the model cannot choose persistent IDs or versions", () => {
  const initial = createInitialIntentState()
  const result = applyProposal(
    initial,
    proposal(initial, [{ operation: "create_task", local_ref: "local", id: "task-model-chosen", version: 99, description: "Rejected metadata", source: source() } as unknown as ProposalOperation]),
    context,
  )
  assert.equal(result.ok, false)
  assert.deepEqual(result.state, initial)
})

test("user source spans and evidence source channels cannot be crossed", () => {
  const initial = createInitialIntentState()
  const wrongSource = applyProposal(
    initial,
    proposal(initial, [{ operation: "create_task", local_ref: "task", description: "No evidence source", source: { channel: "evidence", evidence_ids: ["ev-1"] } } as unknown as ProposalOperation]),
    context,
  )
  assert.equal(wrongSource.ok, false)
  const outOfRange = applyProposal(
    initial,
    proposal(initial, [{ operation: "create_task", local_ref: "task", description: "No out of range", source: source(0, text.length + 1) }]),
    context,
  )
  assert.equal(outOfRange.ok, false)
})

test("legacy source/target/local-reference aliases and extra operation fields are schema failures", () => {
  const initial = createInitialIntentState()
  const legacySource = applyProposal(
    initial,
    proposal(initial, [{ operation: "create_task", local_ref: "task", description: "Legacy span", source_span: source() } as unknown as ProposalOperation]),
    context,
  )
  assert.equal(legacySource.ok, false)
  const legacyLocalRef = applyProposal(
    initial,
    proposal(initial, [{ operation: "create_task", ref: "task", description: "Legacy local ref", source: source() } as unknown as ProposalOperation]),
    context,
  )
  assert.equal(legacyLocalRef.ok, false)
  const legacySourceKind = applyProposal(
    initial,
    proposal(initial, [{ operation: "create_task", local_ref: "task", description: "Legacy kind", source: { ...source(), kind: "user_input" } } as unknown as ProposalOperation]),
    context,
  )
  assert.equal(legacySourceKind.ok, false)
  const extraTarget = applyProposal(
    initial,
    proposal(initial, [{ operation: "select_task", task_id: "task-0001", task_ref: "task-0001", source: source() } as unknown as ProposalOperation]),
    context,
  )
  assert.equal(extraTarget.ok, false)
  const contextAlias = applyProposal(
    initial,
    proposal(initial, [{ operation: "no_change" }]),
    { ...context, evidence: [] } as unknown as InputContext,
  )
  assert.equal(contextAlias.ok, false)
})

test("evidence operations cannot add or rewrite requirements or Authority", () => {
  const evidence: AdmittedEvidence = { id: "ev-step", digest: "ev-digest", kind: "assistant_step", task_id: "task-0001" }
  const input = { ...context, admitted_evidence: [evidence] }
  let state = createTask(createInitialIntentState(), "task-local")
  const result = applyProposal(
    state,
    proposal(state, [{ operation: "add_requirement", task_id: "task-0001", local_ref: "cross-channel", text: "[LLM-PROTOTYPE] Must not cross channel.", source: { channel: "evidence", evidence_ids: [evidence.id] } } as unknown as ProposalOperation], input),
    input,
  )
  assert.equal(result.ok, false)
  state = apply(state, [{ operation: "select_task", task_id: "task-0001", source: source() }])
  const evidenceResult = applyProposal(
    state,
    proposal(state, [{ operation: "record_execution_fact", task_id: "task-0001", local_ref: "fact-local", content: "[LLM-PROTOTYPE] step observed", evidence_ids: [evidence.id] }], input),
    input,
  )
  assert.equal(evidenceResult.ok, true)
  assert.equal(evidenceResult.state.requirements.length, 0)
  assert.equal(evidenceResult.state.authorities.length, 0)
})

test("deterministic validation rejects unmarked model-interpreted text fields", () => {
  const initial = createInitialIntentState()
  const task = applyProposal(
    initial,
    proposal(initial, [{
      operation: "create_task",
      local_ref: "task",
      description: "Unmarked task description",
      source: source(),
    }]),
    context,
  )
  assert.equal(task.ok, false)
  assert.ok(task.errors.some((error) => error.field === "description"))

  const state = createTask(initial)
  const authority = applyProposal(
    state,
    proposal(state, [{
      operation: "add_authority",
      scope: "global",
      local_ref: "authority",
      text: "Unmarked Authority",
      source: source(),
    }]),
    context,
  )
  assert.equal(authority.ok, false)
  assert.ok(authority.errors.some((error) => error.field === "text"))

  const evidence: AdmittedEvidence = {
    id: "ev-unmarked",
    digest: "ev-unmarked-digest",
    kind: "assistant_step",
    task_id: "task-0001",
  }
  const fact = applyProposal(
    state,
    proposal(state, [{
      operation: "record_execution_fact",
      task_id: "task-0001",
      local_ref: "fact",
      content: "Unmarked execution fact",
      evidence_ids: [evidence.id],
    }], { ...context, admitted_evidence: [evidence] }),
    { ...context, admitted_evidence: [evidence] },
  )
  assert.equal(fact.ok, false)
  assert.ok(fact.errors.some((error) => error.field === "content"))
})

test("execution status is limited by evidence and workspace mutation invalidates verification", () => {
  const pass: AdmittedEvidence = { id: "ev-pass", digest: "pass-digest", kind: "verifier_pass", task_id: "task-0001", compiler_visible: true, predeclared: true, exact_workspace_snapshot: true, workspace_snapshot_id: "ws-1" }
  const diff: AdmittedEvidence = { id: "ev-diff", digest: "diff-digest", kind: "workspace_diff", task_id: "task-0001", workspace_changed: true, workspace_snapshot_id: "ws-2" }
  let state = createTask(createInitialIntentState())
  state = apply(state, [{ operation: "select_task", task_id: "task-0001", source: source() }])
  const bad = applyProposal(
    state,
    proposal(state, [{ operation: "record_execution_status", task_id: "task-0001", status: "verified_complete", evidence_ids: ["missing"] }], { ...context, admitted_evidence: [] }),
    { ...context, admitted_evidence: [] },
  )
  assert.equal(bad.ok, false)
  const missingSnapshot = applyProposal(
    state,
    proposal(state, [{ operation: "record_execution_status", task_id: "task-0001", status: "verified_complete", evidence_ids: [pass.id] }], { ...context, admitted_evidence: [pass] }),
    { ...context, admitted_evidence: [pass] },
  )
  assert.equal(missingSnapshot.ok, false)
  const wrongEvidenceSnapshot = { ...pass, id: "ev-pass-wrong", workspace_snapshot_id: "ws-2" }
  const mismatchedEvidence = applyProposal(
    state,
    proposal(state, [{ operation: "record_execution_status", task_id: "task-0001", status: "verified_complete", evidence_ids: [wrongEvidenceSnapshot.id] }], { ...context, admitted_evidence: [wrongEvidenceSnapshot], current_workspace_snapshot_id: "ws-1" }),
    { ...context, admitted_evidence: [wrongEvidenceSnapshot], current_workspace_snapshot_id: "ws-1" },
  )
  assert.equal(mismatchedEvidence.ok, false)
  const mismatchedOperationSnapshot = applyProposal(
    state,
    proposal(state, [{ operation: "record_execution_status", task_id: "task-0001", status: "verified_complete", evidence_ids: [pass.id], workspace_snapshot_id: "ws-2" }], { ...context, admitted_evidence: [pass], current_workspace_snapshot_id: "ws-1" }),
    { ...context, admitted_evidence: [pass], current_workspace_snapshot_id: "ws-1" },
  )
  assert.equal(mismatchedOperationSnapshot.ok, false)
  const verifiedInput = { ...context, admitted_evidence: [pass], current_workspace_snapshot_id: "ws-1" }
  const verified = applyProposal(
    state,
    proposal(state, [{ operation: "record_execution_status", task_id: "task-0001", status: "verified_complete", evidence_ids: [pass.id], workspace_snapshot_id: "ws-1" }], verifiedInput),
    verifiedInput,
  )
  assert.equal(verified.ok, true)
  assert.equal(verified.state.execution_statuses[0].status, "verified_complete")
  const mutatedInput = { ...context, admitted_evidence: [diff] }
  const mutated = applyProposal(
    verified.state,
    proposal(verified.state, [{ operation: "record_execution_fact", task_id: "task-0001", local_ref: "mutation-fact", content: "[LLM-PROTOTYPE] workspace changed", evidence_ids: [diff.id] }], mutatedInput),
    mutatedInput,
  )
  assert.equal(mutated.ok, true)
  assert.equal(mutated.state.execution_statuses[0].status, "in_progress")
})

test("no_change, deterministic IDs, and repeated valid inputs are stable", () => {
  let state = createTask(createInitialIntentState())
  const add = proposal(state, [{ operation: "add_requirement", task_id: "task-0001", local_ref: "stable", text: "[LLM-PROTOTYPE] Stable requirement.", source: source() }])
  const first = applyProposal(state, add, context)
  const second = applyProposal(state, add, context)
  assert.equal(first.ok, true)
  assert.deepEqual(first.state, second.state)
  const noChange = applyProposal(first.state, proposal(first.state, [{ operation: "no_change" }]), context)
  assert.equal(noChange.ok, true)
  assert.equal(noChange.changed, false)
  assert.equal(noChange.state.state_version, first.state.state_version)
  assert.equal(noChange.state.state_digest, first.state.state_digest)
  const empty = applyProposal(createInitialIntentState(), proposal(createInitialIntentState(), []), context)
  assert.equal(empty.ok, false)
  assert.equal(empty.state.state_version, 0)
})
