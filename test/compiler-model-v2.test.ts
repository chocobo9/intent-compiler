import { test } from "node:test"
import assert from "node:assert/strict"
import { createCompilerModelV2, V2_COMPILER_CONTRACT } from "../src/model/compiler-model-v2.js"

test("v2 model accepts a fenced JSON candidate and reports the source", async () => {
  const model = createCompilerModelV2(async () => "```json\n{\"schema_version\":2,\"basis\":{\"event_ids\":[\"e1\"],\"refs\":[]},\"groups\":[]}\n```")
  const result = await model.propose({
    run_id: "run-1",
    events: [],
    ir: {},
    compiled: {},
    atom_refs: {},
    executions: [],
    budget: { requests_used: 0, max_requests: 3 },
    contract: V2_COMPILER_CONTRACT,
  })
  assert.equal(result.ok, true)
  assert.equal(result.candidate?.schema_version, 2)
  assert.equal(result.call?.text_source, "text")
})

test("v2 model decodes OpenCode DSML structured output", async () => {
  const dsml = [
    '<|DSML|> invoke name="StructuredOutput">',
    '<｜DSML｜> parameter name="schema_version" string="true">2</｜DSML｜> parameter>',
    '<｜DSML｜> parameter name="basis" string="false">{"event_ids":["e1"],"refs":[]}</｜DSML｜> parameter>',
    '<｜DSML｜> parameter name="groups" string="false">[]</｜DSML｜> parameter>',
  ].join("\n")
  const model = createCompilerModelV2(async () => dsml)
  const result = await model.propose({
    run_id: "run-1",
    events: [],
    ir: {},
    compiled: {},
    atom_refs: {},
    executions: [],
    budget: { requests_used: 0, max_requests: 3 },
    contract: V2_COMPILER_CONTRACT,
  })
  assert.equal(result.ok, true)
  assert.equal(result.candidate?.schema_version, 2)
  assert.deepEqual(result.candidate?.groups, [])
})

test("v2 model decodes double-bar fullwidth DSML with string=false parameters", async () => {
  const bar = String.fromCharCode(0xff5c)
  const dsml = [
    `<${bar}${bar}DSML${bar}${bar} calls>`,
    `<${bar}${bar}DSML${bar}${bar} invoke name="StructuredOutput">`,
    `<${bar}${bar}DSML${bar}${bar} parameter name="schema_version" string="false">2</${bar}${bar}DSML${bar}${bar} parameter>`,
    `<${bar}${bar}DSML${bar}${bar} parameter name="basis" string="false">{"event_ids":["e1"],"refs":[]}</${bar}${bar}DSML${bar}${bar} parameter>`,
    `<${bar}${bar}DSML${bar}${bar} parameter name="groups" string="false">[]</${bar}${bar}DSML${bar}${bar} parameter>`,
    `</${bar}${bar}DSML${bar}${bar} invoke>`,
    `</${bar}${bar}DSML${bar}${bar} calls>`,
  ].join("\n")
  const model = createCompilerModelV2(async () => dsml)
  const result = await model.propose({
    run_id: "run-1",
    events: [],
    ir: {},
    compiled: {},
    atom_refs: {},
    executions: [],
    budget: { requests_used: 0, max_requests: 3 },
    contract: V2_COMPILER_CONTRACT,
  })
  assert.equal(result.ok, true)
  assert.equal(result.candidate?.schema_version, 2)
  assert.deepEqual(result.candidate?.groups, [])
})

test("v2 model unwraps a DSML envelope parameter holding the whole candidate", async () => {
  const bar = String.fromCharCode(0xff5c)
  const candidate = {
    schema_version: 2,
    basis: { event_ids: ["e1"], refs: [] },
    groups: [],
  }
  const dsml = [
    `<${bar}${bar}DSML${bar}${bar} calls>`,
    `<${bar}${bar}DSML${bar}${bar} invoke name="StructuredOutput">`,
    `<${bar}${bar}DSML${bar}${bar} parameter name="candidate" string="true">${JSON.stringify(candidate)}</${bar}${bar}DSML${bar}${bar} parameter>`,
    `</${bar}${bar}DSML${bar}${bar} invoke>`,
    `</${bar}${bar}DSML${bar}${bar} calls>`,
  ].join("\n")
  const model = createCompilerModelV2(async () => dsml)
  const result = await model.propose({
    run_id: "run-1",
    events: [],
    ir: {},
    compiled: {},
    atom_refs: {},
    executions: [],
    budget: { requests_used: 0, max_requests: 3 },
    contract: V2_COMPILER_CONTRACT,
  })
  assert.equal(result.ok, true)
  assert.equal(result.candidate?.schema_version, 2)
  assert.deepEqual(result.candidate?.groups, [])
})

test("v2 model retains a parseable schema-invalid draft for the next revision", async () => {
  const draft = { schema_version: 2, basis: { event_ids: ["e1"], refs: [] }, groups: [{}] }
  const text = JSON.stringify(draft)
  const model = createCompilerModelV2(async () => ({ text, text_source: "text" }))
  const result = await model.propose({
    run_id: "run-1",
    events: [],
    ir: {},
    compiled: {},
    atom_refs: {},
    executions: [],
    budget: { requests_used: 0, max_requests: 3 },
    contract: V2_COMPILER_CONTRACT,
  })
  assert.equal(result.ok, false)
  assert.equal(result.error?.code, "schema")
  assert.ok((result.schema_errors?.length ?? 0) > 0)
  assert.deepEqual((result as typeof result & { schema_rejected_draft?: unknown }).schema_rejected_draft, {
    text,
    errors: result.schema_errors,
  })
})
