import assert from "node:assert/strict"
import test from "node:test"
import { PROPOSAL_OPERATION_NAMES, applyProposal, createInitialIntentState } from "../src/core/intent-state.js"
import {
  createCompilerModel,
  type CompilerModelInput,
  type CompilerModelRequest,
} from "../src/model/compiler-model.js"

function input(overrides: Partial<CompilerModelInput> = {}): CompilerModelInput {
  return {
    base_state_version: 0,
    current_state: { state_version: 0, selected_task_id: null, requirements: [] },
    input_identity: "input-1",
    input_digest: "digest-1",
    input_text: "Create the parser.",
    input_parts: [{ id: "part-1", type: "text", text: "Create the parser." }],
    admitted_evidence: [],
    ...overrides,
  }
}

function userSource() {
  return {
    channel: "user" as const,
    input_identity: "input-1",
    input_digest: "digest-1",
    start: 0,
    end: "Create the parser.".length,
  }
}

function orderedEnvelope() {
  return {
    base_state_version: 0,
    input_identity: "input-1",
    input_digest: "digest-1",
    operations: [
      {
        operation: "create_task",
        local_ref: "task-local",
        description: "[LLM-PROTOTYPE] Create the parser.",
        source: userSource(),
      },
      {
        operation: "select_task",
        task_id: "task-local",
        source: userSource(),
      },
    ],
  }
}

test("accepts a closed ordered proposal and preserves proposal-local references", async () => {
  const raw = `${JSON.stringify(orderedEnvelope(), null, 2)}\n`
  const result = await createCompilerModel(async () => raw).propose(input())

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.raw_response, raw)
  assert.deepEqual(result.request.allowed_operations, PROPOSAL_OPERATION_NAMES)
  assert.deepEqual(
    result.proposal.operations.map((operation) => operation.operation),
    ["create_task", "select_task"],
  )
  assert.equal((result.proposal.operations[0] as unknown as Record<string, unknown>).local_ref, "task-local")
  assert.equal(Object.hasOwn(result.proposal.operations[0], "id"), false)
  assert.equal(Object.hasOwn(result.proposal.operations[0], "operation_id"), false)
})

test("model-visible local reference rules agree with the reducer (semantic-001)", async () => {
  const result = await createCompilerModel(() => JSON.stringify(orderedEnvelope())).propose(input())
  assert.ok(result.ok)
  const contract = result.request.operation_contract.local_references as { reserved_pattern: string; examples: { allowed: string[]; forbidden: string[] } }
  const reserved = new RegExp(contract.reserved_pattern, "u")
  for (const ref of [...contract.examples.allowed, ...contract.examples.forbidden, "task-12-extra", "timer"] ) {
    const envelope = orderedEnvelope()
    envelope.operations[0].local_ref = ref
    envelope.operations[1].task_id = ref
    const parsed = await createCompilerModel(() => JSON.stringify(envelope)).propose(input())
    assert.ok(parsed.ok)
    const reduced = applyProposal(createInitialIntentState(), parsed.proposal, { input_identity: "input-1", input_digest: "digest-1", text: input().input_text })
    assert.equal(reduced.errors.some((error) => error.code === "persistent_id_in_proposal"), reserved.test(ref))
    if (!reserved.test(ref)) assert.equal(reduced.ok, true)
  }
  assert.match(String(result.request.operation_contract.task_selection), /does NOT select/u)
  assert.match(String(result.request.operation_contract.task_selection), /select_task/u)
})

test("rejects a non-text task message before calling the transport", async () => {
  let calls = 0
  const result = await createCompilerModel(async () => {
    calls += 1
    return JSON.stringify(orderedEnvelope())
  }).propose(
    input({
      input_parts: [
        { id: "part-1", type: "text", text: "Create the parser." },
        { id: "part-2", type: "file", path: "src/parser.ts" },
      ],
    }),
  )

  assert.equal(calls, 0)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.kind, "input")
  assert.equal(result.error.code, "non_text_task_message")
  assert.equal(result.request, undefined)
})

test("passes only a frozen read-only request with tools disabled", async () => {
  let seen: CompilerModelRequest | undefined
  const model = createCompilerModel(async (request) => {
    seen = request
    return JSON.stringify({
      base_state_version: 0,
      input_identity: "input-1",
      input_digest: "digest-1",
      operations: [{ operation: "no_change" }],
    })
  })
  const originalState = input().current_state as { nested?: { value?: string } }
  originalState.nested = { value: "caller-owned" }

  const result = await model.propose(input({ current_state: originalState }))

  assert.equal(result.ok, true)
  assert.ok(seen)
  assert.equal(Object.isFrozen(seen), true)
  assert.equal(Object.isFrozen(seen!.current_state), true)
  assert.equal(Object.isFrozen(seen!.admitted_evidence), true)
  assert.deepEqual(seen!.tools, [])
  assert.equal(seen!.tool_choice, "none")
  assert.notEqual(seen!.current_state, originalState)
  assert.equal((seen!.current_state as { nested: { value: string } }).nested.value, "caller-owned")

  for (const forbidden of ["workspace", "store", "compiler_store", "open_code_client", "exec_loop", "client"]) {
    assert.equal(Object.hasOwn(seen!, forbidden), false, `request leaked ${forbidden}`)
  }
})

test("keeps transport, JSON, and schema errors distinguishable and preserves raw responses", async () => {
  const transportFailure = await createCompilerModel(async () => {
    throw new Error("network unavailable")
  }).propose(input())
  assert.equal(transportFailure.ok, false)
  if (!transportFailure.ok) assert.equal(transportFailure.error.kind, "transport")

  const rawInvalidJson = "{not-json"
  const invalidJson = await createCompilerModel(async () => rawInvalidJson).propose(input())
  assert.equal(invalidJson.ok, false)
  if (!invalidJson.ok) {
    assert.equal(invalidJson.error.kind, "json")
    assert.equal(invalidJson.raw_response, rawInvalidJson)
  }

  const rawSchemaError = JSON.stringify({
    base_state_version: 0,
    input_identity: "input-1",
    operations: [{ operation: "no_change" }],
  })
  const schemaError = await createCompilerModel(async () => rawSchemaError).propose(input())
  assert.equal(schemaError.ok, false)
  if (!schemaError.ok) {
    assert.equal(schemaError.error.kind, "schema")
    assert.equal(schemaError.raw_response, rawSchemaError)
    assert.ok(schemaError.error.errors?.some((error) => error.path === "input_digest"))
  }
})

test("rejects forbidden next-state, compiled-intent, replacement, plan, answer, and unknown operations", async () => {
  for (const field of [
    "next_private_state",
    "compiled_intent",
    "replacement_prompt",
    "plan",
    "executor_answer",
  ]) {
    const response = { ...orderedEnvelope(), [field]: "must not be returned" }
    const result = await createCompilerModel(async () => JSON.stringify(response)).propose(input())
    assert.equal(result.ok, false, field)
    if (!result.ok) assert.ok(result.error.errors?.some((error) => error.code === "forbidden_output_field"), field)
  }

  const unknownOperation = {
    ...orderedEnvelope(),
    operations: [{ operation: "invent_operation", source: userSource() }],
  }
  const result = await createCompilerModel(async () => JSON.stringify(unknownOperation)).propose(input())
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.error.errors?.some((error) => error.code === "unknown_operation"))

  for (const alias of ["name", "op"]) {
    const aliasResponse = {
      ...orderedEnvelope(),
      operations: [{ [alias]: "no_change" }],
    }
    const aliasResult = await createCompilerModel(async () => JSON.stringify(aliasResponse)).propose(input())
    assert.equal(aliasResult.ok, false, alias)
    if (!aliasResult.ok) {
      assert.ok(aliasResult.error.errors?.some((error) => error.code === "invalid_field"), alias)
      assert.ok(aliasResult.error.errors?.some((error) => error.path === `operations[0].${alias}`), alias)
    }
  }

  for (const extraField of ["source_span", "source_ref", "extra_field"]) {
    const extraResponse = {
      ...orderedEnvelope(),
      operations: [{ operation: "no_change", [extraField]: {} }],
    }
    const extraResult = await createCompilerModel(async () => JSON.stringify(extraResponse)).propose(input())
    assert.equal(extraResult.ok, false, extraField)
    if (!extraResult.ok) {
      assert.ok(extraResult.error.errors?.some((error) => error.code === "invalid_field"), extraField)
      assert.ok(extraResult.error.errors?.some((error) => error.path === `operations[0].${extraField}`), extraField)
    }
  }

  const responseSchemaVersion = {
    ...orderedEnvelope(),
    schema_version: "0.1",
  }
  const schemaVersionResult = await createCompilerModel(async () => JSON.stringify(responseSchemaVersion)).propose(input())
  assert.equal(schemaVersionResult.ok, false)
  if (!schemaVersionResult.ok) {
    assert.ok(schemaVersionResult.error.errors?.some((error) => error.code === "invalid_field" && error.path === "schema_version"))
  }

  const missingSourceDigest = {
    ...orderedEnvelope(),
    operations: [{
      operation: "create_task",
      local_ref: "task-local",
      description: "[LLM-PROTOTYPE] Create the parser.",
      source: { channel: "user", input_identity: "input-1", start: 0, end: "Create the parser.".length },
    }],
  }
  const missingSourceDigestResult = await createCompilerModel(async () => JSON.stringify(missingSourceDigest)).propose(input())
  assert.equal(missingSourceDigestResult.ok, false)
  if (!missingSourceDigestResult.ok) {
    assert.ok(missingSourceDigestResult.error.errors?.some((error) => error.path === "operations[0].source.input_digest"))
  }
})

test("rejects model-interpreted text that is not visibly marked as prototype output", async () => {
  const response = orderedEnvelope()
  response.operations[0]!.description = "Create the parser."
  const result = await createCompilerModel(async () => JSON.stringify(response)).propose(input())
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.error.errors?.some((error) => (
      error.code === "prototype_label_required" &&
      error.path === "operations[0].description"
    )))
  }
})

test("rejects missing envelope identity fields and mismatched echoes", async () => {
  const missing = await createCompilerModel(async () => JSON.stringify({ operations: [{ operation: "no_change" }] })).propose(input())
  assert.equal(missing.ok, false)
  if (!missing.ok) {
    assert.deepEqual(
      missing.error.errors?.filter((error) => error.code === "missing_field").map((error) => error.path),
      ["base_state_version", "input_identity", "input_digest"],
    )
  }

  const mismatch = await createCompilerModel(async () => JSON.stringify({
    base_state_version: 9,
    input_identity: "other-input",
    input_digest: "other-digest",
    operations: [{ operation: "no_change" }],
  })).propose(input())
  assert.equal(mismatch.ok, false)
  if (!mismatch.ok) {
    assert.ok(mismatch.error.errors?.some((error) => error.code === "base_version_mismatch"))
    assert.ok(mismatch.error.errors?.some((error) => error.code === "input_identity_mismatch"))
    assert.ok(mismatch.error.errors?.some((error) => error.code === "digest_mismatch"))
  }
})

test("a retry request changes only by adding deterministic validation errors", async () => {
  const requests: CompilerModelRequest[] = []
  const model = createCompilerModel(async (request) => {
    requests.push(request)
    return JSON.stringify({
      base_state_version: 0,
      input_identity: "input-1",
      input_digest: "digest-1",
      operations: [{ operation: "no_change" }],
    })
  })
  await model.propose(input())
  await model.propose(input(), [
    { code: "unknown_operation", path: "operations[0].operation", message: "unknown operation" },
  ])
  const first = requests[0]
  const retry = requests[1]
  const withoutRetryErrors = (request: CompilerModelRequest) => {
    const { validation_errors: _validationErrors, ...rest } = request
    return rest
  }

  assert.deepEqual(withoutRetryErrors(retry), first)
  assert.deepEqual(retry.validation_errors, [
    { code: "unknown_operation", path: "operations[0].operation", message: "unknown operation" },
  ])
  assert.equal(Object.isFrozen(retry.validation_errors), true)
})

test("does not retry an invalid response inside module 04", async () => {
  let calls = 0
  const model = createCompilerModel(async () => {
    calls += 1
    return "not-json"
  })
  const result = await model.propose(input())

  assert.equal(calls, 1)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.kind, "json")
})
