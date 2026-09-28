import { test } from "node:test"
import assert from "node:assert/strict"
import { ExecutionStateManager, evaluateCondition } from "../src/core/execution-state.js"
import type { AssessmentDraft, CompiledIntent, Condition, Ref, TaskIntent } from "../src/core/intent-contract.js"

const RESOURCE = { source_id: "tool:write", digest: "sha256:0000000000000000000000000000000000000000000000000000000000000001" }

const intent: CompiledIntent = {
  schema_version: 2,
  artifact_type: "compiled_intent",
  compiled_intent_id: "ci-1",
  task_id: "t",
  compiled_revision: 0,
  intent_basis: [],
  atoms: [{
    atom_id: "a",
    revision: 0,
    goal_refs: [],
    task: "create hello.txt",
    inputs: [],
    outputs: [],
    constraints: [],
    optional_tools: ["write"],
    authority: {
      basis: [],
      rules: [{
        operation_id: "write",
        resource_ref: RESOURCE,
        input_refs: [],
        output_refs: [],
        conditions: [],
        allowed_use: "write the requested file",
      }],
      lifetime: "this_execution",
      delegation: "not_supported",
    },
    preconditions: [],
    completion: [],
    return_when: [],
    intent_judgments: [],
  }],
  relations: [],
  attachments: [],
}

function taskIntent(disposition: "proceed" | "paused" | "withdrawn" | "conditional"): TaskIntent {
  return {
    task_id: "t",
    revision: 0,
    goal: { text: "write hello", sources: [] },
    bindings: [],
    outputs: [],
    content: [],
    current_scope: { text: "scope", disposition, sources: [] },
    unresolved: [],
  }
}

test("host-resolved operation is authorized and its raw args digest is audited", () => {
  const manager = new ExecutionStateManager()
  const dispatch = manager.createDispatch(intent, "a")
  const start = manager.authorizeStart({
    kind: "start",
    run_id: "run-1",
    dispatch_id: dispatch.dispatch_id,
    host_identity: "session-1",
  })
  assert.equal(start.ok, true)

  const result = manager.authorizeOperation({
    kind: "operation",
    run_id: "run-1",
    execution_id: start.execution_id as string,
    host_identity: "session-1",
    host_call_id: "call-1",
    operation_id: "write",
    resource_ref: RESOURCE,
    input_refs: [],
    output_refs: [],
    invocation: {
      tool: "write",
      args_digest: "sha256:abcdef",
      raw_args: { path: "/app/hello.txt", content: "hello" },
    },
  }, { intent })
  assert.equal(result.ok, true)
  const execution = manager.getExecution(start.execution_id as string)
  assert.deepEqual(execution?.allowed_calls[0]?.tool, "write")
  assert.deepEqual(execution?.allowed_calls[0]?.args_digest, "sha256:abcdef")
})

test("an operation not granted by the atom is denied", () => {
  const manager = new ExecutionStateManager()
  const dispatch = manager.createDispatch(intent, "a")
  const start = manager.authorizeStart({
    kind: "start",
    run_id: "run-1",
    dispatch_id: dispatch.dispatch_id,
    host_identity: "session-1",
  })
  const result = manager.authorizeOperation({
    kind: "operation",
    run_id: "run-1",
    execution_id: start.execution_id as string,
    host_identity: "session-1",
    host_call_id: "call-2",
    operation_id: "bash",
    resource_ref: { source_id: "tool:bash", digest: "sha256:1234" },
    input_refs: [],
    output_refs: [],
    invocation: { tool: "bash", args_digest: "sha256:1234" },
  }, { intent })
  assert.equal(result.ok, false)
  assert.equal(result.code, "capability_unsupported")
})

test("a scope_allows condition is satisfied when the task scope proceeds", () => {
  const manager = new ExecutionStateManager()
  const conditionalIntent: CompiledIntent = {
    ...intent,
    atoms: [{
      ...intent.atoms[0] as NonNullable<CompiledIntent["atoms"][number]>,
      authority: {
        ...(intent.atoms[0]?.authority as NonNullable<CompiledIntent["atoms"][number]>["authority"]),
        rules: [{
          operation_id: "write",
          resource_ref: RESOURCE,
          input_refs: [],
          output_refs: [],
          conditions: [{ kind: "scope_allows", refs: [] }],
          allowed_use: "write the requested file",
        }],
      },
    }],
  }
  const dispatch = manager.createDispatch(conditionalIntent, "a")
  const start = manager.authorizeStart({
    kind: "start",
    run_id: "run-1",
    dispatch_id: dispatch.dispatch_id,
    host_identity: "session-1",
  })
  const result = manager.authorizeOperation({
    kind: "operation",
    run_id: "run-1",
    execution_id: start.execution_id as string,
    host_identity: "session-1",
    host_call_id: "call-3",
    operation_id: "write",
    resource_ref: RESOURCE,
    input_refs: [],
    output_refs: [],
  }, { intent: conditionalIntent, ir: { t: taskIntent("proceed") } })
  assert.equal(result.ok, true)
})

test("a scope_allows condition blocks an operation when the task scope is paused", () => {
  const manager = new ExecutionStateManager()
  const conditionalIntent: CompiledIntent = {
    ...intent,
    atoms: [{
      ...intent.atoms[0] as NonNullable<CompiledIntent["atoms"][number]>,
      authority: {
        ...(intent.atoms[0]?.authority as NonNullable<CompiledIntent["atoms"][number]>["authority"]),
        rules: [{
          operation_id: "write",
          resource_ref: RESOURCE,
          input_refs: [],
          output_refs: [],
          conditions: [{ kind: "scope_allows", refs: [] }],
          allowed_use: "write the requested file",
        }],
      },
    }],
  }
  const dispatch = manager.createDispatch(conditionalIntent, "a")
  const start = manager.authorizeStart({
    kind: "start",
    run_id: "run-1",
    dispatch_id: dispatch.dispatch_id,
    host_identity: "session-1",
  })
  const result = manager.authorizeOperation({
    kind: "operation",
    run_id: "run-1",
    execution_id: start.execution_id as string,
    host_identity: "session-1",
    host_call_id: "call-4",
    operation_id: "write",
    resource_ref: RESOURCE,
    input_refs: [],
    output_refs: [],
  }, { intent: conditionalIntent, ir: { t: taskIntent("paused") } })
  assert.equal(result.ok, false)
  assert.equal(result.code, "execution_inactive")
})

test("an unsupported condition kind denies rather than silently widening permission", () => {
  const target: Ref = { id: "a", revision: 0, digest: "sha256:0000000000000000000000000000000000000000000000000000000000000002" }
  const condition: Condition = { kind: "assessment_supports", refs: [target] }
  const satisfied: AssessmentDraft = {
    target_ref: target,
    criteria_refs: [],
    evidence_refs: [],
    result: "satisfied",
    explanation: "verified",
    method: "deterministic",
  }
  const notSatisfied: AssessmentDraft = { ...satisfied, result: "not_satisfied", explanation: "withdrawn after review" }

  assert.equal(evaluateCondition(condition, { assessments: [satisfied] }), "satisfied")
  assert.equal(evaluateCondition(condition, { assessments: [satisfied, notSatisfied] }), "unsatisfied", "the newest judgement wins")
  assert.equal(evaluateCondition(condition, { assessments: [notSatisfied, satisfied] }), "satisfied")
  assert.equal(evaluateCondition(condition, {}), "unsupported", "without an assessment record source the condition cannot be evaluated")
  assert.equal(
    evaluateCondition({ kind: "capability_available", refs: [], expectation: "bash" }, { capabilities: { operations: [] } }),
    "unsatisfied",
  )
  assert.equal(
    evaluateCondition({ kind: "capability_available", refs: [], expectation: "" }, { capabilities: { operations: ["bash"] } }),
    "unsupported",
    "a condition without an operation id is not silently satisfied",
  )
})

test("an unknown condition kind still denies", () => {
  const manager = new ExecutionStateManager()
  const conditionalIntent: CompiledIntent = {
    ...intent,
    atoms: [{
      ...intent.atoms[0] as NonNullable<CompiledIntent["atoms"][number]>,
      authority: {
        ...(intent.atoms[0]?.authority as NonNullable<CompiledIntent["atoms"][number]>["authority"]),
        rules: [{
          operation_id: "write",
          resource_ref: RESOURCE,
          input_refs: [],
          output_refs: [],
          conditions: [{ kind: "a_kind_this_implementation_does_not_have", refs: [RESOURCE] } as unknown as Condition],
          allowed_use: "write the requested file",
        }],
      },
    }],
  }
  const dispatch = manager.createDispatch(conditionalIntent, "a")
  const start = manager.authorizeStart({
    kind: "start",
    run_id: "run-1",
    dispatch_id: dispatch.dispatch_id,
    host_identity: "session-1",
  })
  const result = manager.authorizeOperation({
    kind: "operation",
    run_id: "run-1",
    execution_id: start.execution_id as string,
    host_identity: "session-1",
    host_call_id: "call-5",
    operation_id: "write",
    resource_ref: RESOURCE,
    input_refs: [],
    output_refs: [],
  }, { intent: conditionalIntent, ir: { t: taskIntent("proceed") } })
  assert.equal(result.ok, false)
  assert.equal(result.code, "capability_unsupported")
})
