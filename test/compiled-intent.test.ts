import assert from "node:assert/strict"
import test from "node:test"
import {
  type InputContext,
  type IntentState,
  type ProposalOperation,
  applyProposal,
  createInitialIntentState,
  projectCompiledIntent,
  CompiledIntentProjectionError,
} from "../src/core/intent-state.js"

const text = "Keep the selected task, preserve history, and wait for a choice."
const input: InputContext = { input_identity: "compiled-input", input_digest: "compiled-digest", text }
const userSource = { channel: "user" as const, input_identity: input.input_identity, input_digest: input.input_digest, start: 0, end: text.length }

function proposal(state: IntentState, operations: ProposalOperation[], context: InputContext = input) {
  return { base_state_version: state.state_version, input_identity: context.input_identity, input_digest: context.input_digest, operations }
}

function apply(state: IntentState, operations: ProposalOperation[], context: InputContext = input): IntentState {
  const result = applyProposal(state, proposal(state, operations, context), context)
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("; "))
  return result.state
}

function selectedState(): IntentState {
  let state = createInitialIntentState()
  state = apply(state, [
    { operation: "create_task", local_ref: "first", description: "[LLM-PROTOTYPE] First task", source: userSource },
    { operation: "create_task", local_ref: "second", description: "[LLM-PROTOTYPE] Second task", source: userSource },
    { operation: "select_task", task_id: "first", source: userSource },
    { operation: "add_requirement", task_id: "first", local_ref: "first-requirement", text: "[LLM-PROTOTYPE] Keep the parser behavior.", source: userSource },
    { operation: "add_requirement", task_id: "second", local_ref: "second-requirement", text: "[LLM-PROTOTYPE] This belongs to another occurrence.", source: userSource },
    { operation: "add_authority", scope: "global", local_ref: "global-authority", text: "[LLM-PROTOTYPE] Global authority", source: userSource },
    { operation: "add_authority", scope: "task", task_id: "first", local_ref: "first-authority", text: "[LLM-PROTOTYPE] First-task authority", source: userSource },
    { operation: "add_authority", scope: "task", task_id: "second", local_ref: "second-authority", text: "[LLM-PROTOTYPE] Second-task authority", source: userSource },
    { operation: "add_unresolved", task_id: "first", local_ref: "first-unresolved", alternatives: ["[LLM-PROTOTYPE] A", "[LLM-PROTOTYPE] B"], source: userSource },
  ])
  return state
}

test("compiled intent has stable canonical artifact and rendered digests", () => {
  const state = selectedState()
  const first = projectCompiledIntent(state)
  const second = projectCompiledIntent(state, { previous: first })
  assert.equal(first.artifact_digest, second.artifact_digest)
  assert.equal(first.rendered_digest, second.rendered_digest)
  assert.equal(first.canonical_artifact, second.canonical_artifact)
  assert.equal(first.artifact.artifact_version, second.artifact.artifact_version)
  assert.equal(first.artifact.state_digest, state.state_digest)
  assert.match(first.rendered_text, /"artifact_digest"/)
  assert.match(first.rendered_text, /"selected_task"/)
})

test("projection is selective to the selected task and Authority scope", () => {
  const artifact = projectCompiledIntent(selectedState()).artifact
  assert.equal(artifact.selected_task?.id, "task-0001")
  assert.deepEqual(artifact.active_requirements.map((requirement) => requirement.task_id), ["task-0001"])
  assert.equal(artifact.active_requirements.some((requirement) => requirement.text.includes("another occurrence")), false)
  assert.deepEqual(artifact.authorities.map((authority) => authority.text), ["[LLM-PROTOTYPE] Global authority", "[LLM-PROTOTYPE] First-task authority"])
  assert.equal(artifact.authorities.some((authority) => authority.text === "[LLM-PROTOTYPE] Second-task authority"), false)
})

test("inactive requirements are retained as do-not-apply history and unresolved content adds a fixed restriction", () => {
  let state = selectedState()
  const requirementId = state.requirements.find((requirement) => requirement.task_id === "task-0001")!.id
  state = apply(state, [{ operation: "withdraw_requirement", requirement_id: requirementId, source: userSource }])
  const projection = projectCompiledIntent(state)
  assert.equal(projection.artifact.inactive_requirements[0].status, "withdrawn")
  assert.equal(projection.artifact.inactive_requirements[0].executor_use, "do_not_apply")
  assert.equal(projection.artifact.open_unresolved.length, 1)
  assert.equal(projection.artifact.unresolved_restriction, "Do not make workspace changes that depend on choosing one alternative.")
  assert.match(projection.rendered_text, /unresolved_restriction/)
})

test("execution facts and statuses are included only when admitted and tied to selected task", () => {
  const evidence = { id: "ev-1", digest: "ev-digest", kind: "assistant_step", task_id: "task-0001" }
  const context: InputContext = { ...input, admitted_evidence: [evidence] }
  let state = selectedState()
  state = apply(state, [{ operation: "record_execution_fact", task_id: "task-0001", local_ref: "fact-local", content: "[LLM-PROTOTYPE] step observed", evidence_ids: [evidence.id] }], context)
  const projection = projectCompiledIntent(state)
  assert.deepEqual(projection.artifact.execution_facts.map((fact) => fact.evidence_ids), [["ev-1"]])
  assert.equal(projection.artifact.source_ids.includes("ev-1"), true)
  assert.equal(projection.artifact.execution_facts.some((fact) => fact.content.includes("raw")), false)
})

test("no selected task produces no coding instruction and excludes task records", () => {
  let state = createInitialIntentState()
  state = apply(state, [{ operation: "create_task", local_ref: "task", description: "[LLM-PROTOTYPE] Unselected", source: userSource }])
  const artifact = projectCompiledIntent(state).artifact
  assert.equal(artifact.selected_task, null)
  assert.deepEqual(artifact.active_requirements, [])
  assert.deepEqual(artifact.inactive_requirements, [])
  assert.deepEqual(artifact.open_unresolved, [])
  assert.deepEqual(artifact.execution_facts, [])
  assert.equal(artifact.authorities.length, 0)
})

test("a genuine no-op reuses state and Compiled Intent version/digest", () => {
  const state = selectedState()
  const before = projectCompiledIntent(state)
  const result = applyProposal(state, proposal(state, [{ operation: "no_change" }]), input)
  assert.equal(result.ok, true)
  assert.equal(result.changed, false)
  const after = projectCompiledIntent(result.state, { previous: before })
  assert.equal(after.artifact.artifact_version, before.artifact.artifact_version)
  assert.equal(after.artifact_digest, before.artifact_digest)
  assert.equal(after.rendered_digest, before.rendered_digest)
})

test("artifact and rendered UTF-8 limits fail without truncating output", () => {
  const state = selectedState()
  assert.throws(
    () => projectCompiledIntent(state, { max_artifact_bytes: 10 }),
    (error: unknown) => error instanceof CompiledIntentProjectionError && error.code === "artifact_too_large",
  )
  assert.throws(
    () => projectCompiledIntent(state, { max_rendered_bytes: 10 }),
    (error: unknown) => error instanceof CompiledIntentProjectionError && error.code === "rendered_text_too_large",
  )
  assert.throws(
    () => projectCompiledIntent(state, { maxArtifactBytes: 10 } as never),
    /unknown projection option maxArtifactBytes/,
  )
})
