import { test } from "node:test"
import assert from "node:assert/strict"
import { Ajv } from "ajv"
import { resolve } from "node:path"
import { buildGenerationSchema, validateGenerationProposal } from "../src/model/generation-schema.js"
import { createOpenCodeModelTransportV2 } from "../src/model/opencode-transport.js"
import { createStructuredProviderTransport } from "../src/model/structured-provider-transport.js"
import { V2_COMPILER_CONTRACT, type CompilerModelV2Input } from "../src/model/compiler-model-v2.js"
import { validateCandidateCheckSchema } from "../src/model/candidate-check-schema.js"
import { buildStrictCandidateCheckSchema } from "../src/model/candidate-check-schema-strict.js"

const basis = { event_ids: ["user-1"], refs: [] }
const irGroup = {
  local_ref: "g1", task_refs: ["t1"], depends_on: [], ir_changes: [],
  execution_decisions: [], assessments: [], checks: [], questions: [],
}

test("IR generation admits only intent changes, never a hidden compiled plan", () => {
  const proposal = { schema_version: 2, basis, source_coverage: [], groups: [irGroup] }
  assert.equal(validateGenerationProposal("ir", proposal).ok, true)
  const mixed = { ...proposal, groups: [{ ...irGroup, compilation: { decision: "replace", drafts: [] } }] }
  assert.equal(validateGenerationProposal("ir", mixed).ok, false)
  for (const profile of [undefined, "openai", "groq"] as const) {
    const validate = new Ajv({ strict: false, allowUnionTypes: true }).compile(buildGenerationSchema("ir", profile))
    assert.equal(validate(proposal), true)
    assert.equal(validate(mixed), false)
  }
})

test("CI generation binds a parent and cannot carry intent edits or compile a disputed parent", () => {
  const { ir_changes: _changes, ...group } = irGroup
  const proposal = {
    schema_version: 2, basis, parent_basis: "parent-1", parent_issues: [],
    groups: [{ ...group, compilation: { decision: "replace", drafts: [] }, coverage: [] }],
  }
  assert.equal(validateGenerationProposal("ci", proposal).ok, true)
  assert.equal(validateGenerationProposal("ci", { ...proposal, groups: [{ ...proposal.groups[0], ir_changes: [] }] }).ok, false)
  assert.equal(validateGenerationProposal("ci", { ...proposal, source_coverage: [] }).ok, false)
  assert.equal(validateGenerationProposal("ci", { ...proposal, parent_basis: "" }).ok, false)
  assert.equal(validateGenerationProposal("ci", { ...proposal, parent_issues: ["The parent omitted a user's requirement."] }).ok, false)
  assert.equal(validateGenerationProposal("ci", { ...proposal, parent_issues: ["The parent omitted a user's requirement."], groups: [] }).ok, true)
})

function request(stage: "ir" | "ci"): CompilerModelV2Input & { generation_stage: "ir" | "ci"; parent_basis?: string } {
  return {
    run_id: "run-1", events: [], ir: {}, compiled: {}, atom_refs: {}, executions: [],
    budget: { requests_used: 0, max_requests: 4 }, contract: V2_COMPILER_CONTRACT,
    generation_stage: stage, ...(stage === "ci" ? { parent_basis: "actual-parent" } : {}),
  }
}

test("OpenCode receives the stage boundary and a stage-valid example, and rejects cross-stage output", async () => {
  for (const stage of ["ir", "ci"] as const) {
    const transport = createOpenCodeModelTransportV2({
      directory: resolve("management-only"), providerId: "openai", modelId: "test",
      client: { session: {
        create: async () => ({ data: { id: "session" } }),
        prompt: async ({ body }) => {
          const validate = new Ajv({ strict: false, allowUnionTypes: true }).compile(body.format!.schema as object)
          const sent = JSON.parse(body.parts[0].text)
          const example = JSON.parse(sent.contract.example_candidate)
          assert.equal(validate(example), true)
          assert.equal("ir_changes" in example.groups[0], stage === "ir")
          assert.equal("compilation" in example.groups[0], stage === "ci")
          assert.match(body.system, new RegExp(`${stage.toUpperCase()} stage`))
          assert.doesNotMatch(body.system, /Generate these directly in the existing Candidate fields/)
          assert.deepEqual(body.tools, { "*": false, StructuredOutput: true })
          // Valid JSON in the old Candidate shape is no longer valid for either stage.
          return { data: { info: { structured: { schema_version: 2, basis, source_coverage: [], groups: [{ ...irGroup, compilation: { decision: "replace", drafts: [] }, coverage: [] }] } }, parts: [] } }
        },
      } },
    })
    const result = await transport(request(stage))
    assert.ok(result.structured_schema_errors?.length)
  }
})

test("structured provider sends the same stage boundary instead of a configured full Candidate schema", async () => {
  for (const stage of ["ir", "ci"] as const) {
    const transport = createStructuredProviderTransport({
      modelId: "test", providerId: "openai", apiKey: "test-only", schema: { type: "object" },
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body))
        const sent = JSON.parse(body.messages[1].content)
        const example = JSON.parse(sent.contract.example_candidate)
        const validate = new Ajv({ strict: false, allowUnionTypes: true }).compile(body.response_format.json_schema.schema)
        assert.equal(validate(example), true)
        assert.equal("ir_changes" in example.groups[0], stage === "ir")
        assert.equal("compilation" in example.groups[0], stage === "ci")
        assert.match(body.messages[0].content, new RegExp(`${stage.toUpperCase()} stage`))
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(example) } }] }))
      },
    })
    const result = await transport(request(stage))
    assert.ok(result.text.length > 0)
  }
})

test("checks may name the repair layer while legacy verdicts remain canonical-compatible", () => {
  const verdict = { schema_version: 2, verdict: "inconsistent", findings: [{ dimension: "D7", claim: "omitted requirement", expected: "retain it", observed: "missing", refs: [] }] }
  assert.equal(validateCandidateCheckSchema(verdict).ok, true)
  for (const repair_target of ["ir", "ci"] as const) {
    assert.equal(validateCandidateCheckSchema({ ...verdict, repair_target }).ok, true)
    const strict = new Ajv({ strict: false }).compile(buildStrictCandidateCheckSchema("openai"))
    assert.equal(strict({ ...verdict, repair_target }), true)
  }
  assert.equal(validateCandidateCheckSchema({ ...verdict, repair_target: "execute" }).ok, false)
  const strict = new Ajv({ strict: false }).compile(buildStrictCandidateCheckSchema("openai"))
  assert.equal(strict({ schema_version: 2, verdict: "consistent", findings: [], repair_target: null }), true)
})
