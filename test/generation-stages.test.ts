import { test } from "node:test"
import assert from "node:assert/strict"
import { Ajv } from "ajv"
import { resolve } from "node:path"
import { buildGenerationExample, buildGenerationSchema, generationContract, generationStageInstruction, validateGenerationProposal, type CIProposal } from "../src/model/generation-schema.js"
import { createOpenCodeModelTransportV2 } from "../src/model/opencode-transport.js"
import { createStructuredProviderTransport } from "../src/model/structured-provider-transport.js"
import { V2_COMPILER_CONTRACT, type CompilerModelV2Input } from "../src/model/compiler-model-v2.js"
import { validateCandidateCheckSchema } from "../src/model/candidate-check-schema.js"
import { buildStrictCandidateCheckSchema } from "../src/model/candidate-check-schema-strict.js"
import { CANDIDATE_JSON_SCHEMA } from "../src/model/candidate-schema.js"
import { buildStrictCandidateSchema } from "../src/model/candidate-schema-strict.js"
import { CANDIDATE_EXAMPLE } from "../src/model/candidate-example.js"

const basis = { event_ids: ["user-1"], refs: [] }
const irGroup = {
  local_ref: "g1", task_refs: ["t1"], depends_on: [], ir_changes: [], questions: [],
}

test("IR generation admits only intent changes, never a hidden compiled plan", () => {
  const proposal = { schema_version: 2, basis, source_coverage: [], groups: [irGroup] }
  assert.equal(validateGenerationProposal("ir", proposal).ok, true)
  const mixed = { ...proposal, groups: [{ ...irGroup, compilation: { decision: "replace", drafts: [] } }] }
  assert.equal(validateGenerationProposal("ir", mixed).ok, false)
  // Execution decisions, assessments and checks belong to the stage that
  // consumes them; the IR stage must not require or accept them.
  for (const executionFacing of [
    { execution_decisions: [{ execution_id: "exec-1", decision: "stop", reason: "x", basis: [] }] },
    { assessments: [{ target_ref: { id: "a1", revision: 0, digest: "sha256:x" }, criteria_refs: [], evidence_refs: [], result: "unknown", explanation: "x", method: "model" }] },
    { checks: [{ scenario: "s", expected: "e", observed_in_candidate: "o", sources: [], unresolved: false }] },
  ]) {
    assert.equal(validateGenerationProposal("ir", { ...proposal, groups: [{ ...irGroup, ...executionFacing }] }).ok, false)
  }
  for (const profile of [undefined, "openai", "groq"] as const) {
    const validate = new Ajv({ strict: false, allowUnionTypes: true }).compile(buildGenerationSchema("ir", profile))
    assert.equal(validate(proposal), true)
    assert.equal(validate(mixed), false)
    const schema = buildGenerationSchema("ir", profile) as { definitions: { group: { properties: Record<string, unknown>; required: string[] } } }
    for (const key of ["compilation", "coverage", "execution_decisions", "assessments", "checks"]) {
      assert.equal(key in schema.definitions.group.properties, false, `${key} is forbidden in the IR stage (${profile ?? "default"})`)
      assert.equal(schema.definitions.group.required.includes(key), false)
    }
    assert.equal("questions" in schema.definitions.group.properties, true, "questions stay in the IR stage")
  }
})

test("CI generation binds a parent and cannot carry intent edits or compile a disputed parent", () => {
  const { ir_changes: _changes, task_refs: _taskRefs, depends_on: _dependsOn, ...group } = irGroup
  const proposal = {
    schema_version: 2, parent_basis: "parent-1", parent_issues: [],
    groups: [{
      ...group, compilation: { decision: "replace", drafts: [] }, coverage: [],
      execution_decisions: [{ execution_id: "exec-1", decision: "stop", reason: "x", basis: [] }],
      assessments: [{ target_ref: { id: "a1", revision: 0, digest: "sha256:x" }, criteria_refs: [], evidence_refs: [], result: "unknown", explanation: "x", method: "model" }],
      checks: [{ scenario: "s", expected: "e", observed_in_candidate: "o", sources: [], unresolved: false }],
    }],
  }
  assert.equal(validateGenerationProposal("ci", proposal).ok, true)
  assert.equal(validateGenerationProposal("ci", { ...proposal, groups: [{ ...proposal.groups[0], ir_changes: [] }] }).ok, false)
  assert.equal(validateGenerationProposal("ci", { ...proposal, source_coverage: [] }).ok, false)
  // The parent proposal already fixes these; an ordinary CI answer that copies
  // them is refused instead of checked and replaced.
  assert.equal(validateGenerationProposal("ci", { ...proposal, basis }).ok, false)
  assert.equal(validateGenerationProposal("ci", { ...proposal, groups: [{ ...proposal.groups[0], task_refs: ["t1"] }] }).ok, false)
  assert.equal(validateGenerationProposal("ci", { ...proposal, groups: [{ ...proposal.groups[0], depends_on: [] }] }).ok, false)
  assert.equal(validateGenerationProposal("ci", { ...proposal, groups: [{ ...proposal.groups[0], compilation: {
    decision: "replace", drafts: [{ local_ref: "d1", task_id: "t1", intent_basis: [], atoms: [], relations: [], attachments: [] }] } }] }).ok, false)
  assert.equal(validateGenerationProposal("ci", { ...proposal, parent_basis: "" }).ok, false)
  assert.equal(validateGenerationProposal("ci", { ...proposal, parent_issues: ["The parent omitted a user's requirement."] }).ok, false)
  assert.equal(validateGenerationProposal("ci", { ...proposal, parent_issues: ["The parent omitted a user's requirement."], groups: [] }).ok, true)
  // An assessment batch still names its own basis events and task.
  const assessment = { ...proposal, basis, groups: [{ ...proposal.groups[0], task_refs: ["t1"], depends_on: [] }] }
  assert.equal(validateGenerationProposal("ci", assessment, { assessment: true }).ok, true)
  assert.equal(validateGenerationProposal("ci", assessment).ok, false, "the ordinary CI shape does not admit an assessment's copies")
  const { parent_issues: _issues, ...checked } = proposal
  assert.equal(validateGenerationProposal("ci", checked, { checkRequired: true }).ok, true)
  for (const parent_issues of [[], ["The parent omitted a user's requirement."]]) {
    assert.equal(validateGenerationProposal("ci", { ...checked, parent_issues }, { checkRequired: true }).ok, false,
      "checked CI cannot return a parent verdict, including an empty one")
  }
  assert.equal(validateGenerationProposal("ci", checked).ok, false, "without verify the field remains required")
  assert.equal(validateGenerationProposal("ci", assessment, { assessment: true, checkRequired: true }).ok, true)
  const instruction = generationStageInstruction("ci", false, true)
  const contract = generationContract(V2_COMPILER_CONTRACT, "ci", undefined, "parent-1", false, true)
  assert.doesNotMatch(instruction + contract.candidate_shape, /parent_issues/)
  assert.match(instruction, /independent check compares original requirements/)
  assert.match(instruction, /Do not add requirements absent from the parent IR/)
  assert.doesNotMatch(contract.rules.join("\n"), /compare the original delegation with the selected current rules/)
  assert.doesNotMatch(contract.atom_contract, /Revise the affected IR items/)
  assert.match(generationStageInstruction("ci"), /report parent_issues/)
  assert.match(generationStageInstruction("ci", true, true), /Report parent_issues/)
  for (const profile of [undefined, "openai", "groq"] as const) {
    const schema = buildGenerationSchema("ci", profile, { checkRequired: true }) as { properties: Record<string, unknown>; required: string[] }
    assert.equal("parent_issues" in schema.properties, false)
    assert.equal(schema.required.includes("parent_issues"), false)
    assert.equal("parent_issues" in buildGenerationExample("ci", profile, "parent-1", false, true), false)
    assert.equal("parent_issues" in buildGenerationExample("ci", profile, "parent-1", true, true), true)
  }
})

test("the CI projection drops only the parent copies the compiler fills", () => {
  for (const profile of [undefined, "openai", "groq"] as const) {
    const label = profile ?? "default"
    const schema = buildGenerationSchema("ci", profile) as {
      required: string[]
      properties: Record<string, unknown>
      definitions: { group: { properties: Record<string, unknown>; required: string[] }; draft: { properties: Record<string, unknown>; required: string[] } }
    }
    assert.equal("basis" in schema.properties, false, `ordinary CI carries no basis (${label})`)
    assert.equal(schema.required.includes("basis"), false)
    for (const key of ["task_refs", "depends_on"]) {
      assert.equal(key in schema.definitions.group.properties, false, `${key} is filled from the parent (${label})`)
      assert.equal(schema.definitions.group.required.includes(key), false)
    }
    assert.equal("task_id" in schema.definitions.draft.properties, false, `draft task_id is filled from the parent (${label})`)
    assert.equal(schema.definitions.draft.required.includes("task_id"), false)

    const assessment = buildGenerationSchema("ci", profile, { assessment: true }) as typeof schema
    assert.equal("basis" in assessment.properties, true, `an assessment still names its basis (${label})`)
    assert.equal("task_refs" in assessment.definitions.group.properties, true)
    assert.equal("task_id" in assessment.definitions.draft.properties, true)
  }
})

test("ordinary CI coverage selects parent identities while assessment and other references keep versions", () => {
  const canonical = structuredClone(CANDIDATE_JSON_SCHEMA)
  for (const profile of [undefined, "openai", "groq"] as const) {
    const schema = buildGenerationSchema("ci", profile) as { definitions: { ref_or_local: unknown; coverage: { properties: { refs: unknown } } } }
    const baseline = (profile === undefined ? canonical : buildStrictCandidateSchema(profile)) as typeof schema
    assert.deepEqual(schema.definitions.ref_or_local, baseline.definitions.ref_or_local)
    assert.deepEqual(schema.definitions.coverage.properties.refs, baseline.definitions.coverage.properties.refs)
    const assessmentSchema = buildGenerationSchema("ci", profile, { assessment: true }) as typeof schema
    assert.deepEqual(assessmentSchema.definitions.coverage, baseline.definitions.coverage)
    const example = buildGenerationExample("ci", profile) as CIProposal
    const validate = new Ajv({ strict: false, allowUnionTypes: true }).compile({ $ref: "#/definitions/coverage", definitions: schema.definitions })
    const entry = example.groups[0]!.coverage[1]!
    assert.equal(validate(entry), true)
    assert.deepEqual(entry.requirement, { local_ref: "r-common" })
    entry.requirement = { id: "r-common", revision: 0, digest: "sha256:old" }
    assert.equal(validate(entry), false, "a versioned requirement is refused, not overwritten")
    entry.requirement = { local_ref: "r-common", revision: 0 } as never
    assert.equal(validate(entry), false, "the identity selector accepts no extra version field")
  }
  const entry = (buildGenerationExample("ci") as CIProposal).groups[0]!.coverage[1]!
  entry.refs[0] = { id: "a-bundle", revision: 1, digest: "sha256:destination" }
  const validate = new Ajv({ strict: false }).compile({ $ref: "#/definitions/coverage", definitions: buildGenerationSchema("ci").definitions })
  assert.equal(validate(entry), true, "destination references retain their versioned expression")
  const assessment = (buildGenerationExample("ci", undefined, "parent", true) as CIProposal).groups[0]!.coverage[1]!
  assessment.requirement = { id: "r-common", revision: 3, digest: "sha256:assessment" }
  const validateAssessment = new Ajv({ strict: false }).compile({ $ref: "#/definitions/coverage", definitions: buildGenerationSchema("ci", undefined, { assessment: true }).definitions })
  assert.equal(validateAssessment(assessment), true, "assessment requirements retain their versioned expression")
  assert.deepEqual(CANDIDATE_JSON_SCHEMA, canonical, "the shared legacy schema is unchanged")
})

function request(stage: "ir" | "ci"): CompilerModelV2Input & { generation_stage: "ir" | "ci"; parent_basis?: string } {
  return {
    run_id: "run-1", events: [], ir: {}, compiled: {}, atom_refs: {}, executions: [],
    budget: { requests_used: 0, max_requests: 4 }, contract: V2_COMPILER_CONTRACT,
    generation_stage: stage, ...(stage === "ci" ? { parent_basis: "actual-parent" } : {}),
  }
}

test("OpenCode receives the stage boundary and a stage-valid example, and rejects cross-stage output", async () => {
  for (const checkRequired of [false, true]) for (const stage of ["ir", "ci"] as const) {
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
          if (stage === "ci") {
            assert.equal("parent_issues" in example, !checkRequired)
            assert.equal("checkRequired" in sent, false)
            if (checkRequired) assert.doesNotMatch(body.system, /parent_issues/)
          }
          assert.match(body.system, new RegExp(`${stage.toUpperCase()} stage`))
          assert.doesNotMatch(body.system, /Generate these directly in the existing Candidate fields/)
          assert.deepEqual(body.tools, { "*": false, StructuredOutput: true })
          // Valid JSON in the old Candidate shape is no longer valid for either stage.
          return { data: { info: { structured: { schema_version: 2, basis, source_coverage: [], groups: [{ ...irGroup, compilation: { decision: "replace", drafts: [] }, coverage: [] }] } }, parts: [] } }
        },
      } },
    })
    const result = await transport(request(stage), { checkRequired })
    assert.ok(result.structured_schema_errors?.length)
  }
})

test("structured provider sends the same stage boundary instead of a configured full Candidate schema", async () => {
  for (const checkRequired of [false, true]) for (const stage of ["ir", "ci"] as const) {
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
        if (stage === "ci") {
          assert.equal("parent_issues" in example, !checkRequired)
          assert.equal("checkRequired" in sent, false)
          if (checkRequired) assert.doesNotMatch(body.messages[0].content, /parent_issues/)
        }
        assert.match(body.messages[0].content, new RegExp(`${stage.toUpperCase()} stage`))
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(example) } }] }))
      },
    })
    const result = await transport(request(stage), { checkRequired })
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

test("strict stage projections replace the task division while the base contract, schema and example stay untouched", () => {
  const baseContract = structuredClone(V2_COMPILER_CONTRACT)
  const baseSchema = structuredClone(CANDIDATE_JSON_SCHEMA)
  const baseExample = structuredClone(CANDIDATE_EXAMPLE)
  const baseSentence = "copy its applicable current rule blocks verbatim into task"
  const assembledSentence = "Management code attaches the assigned current requirement texts verbatim to the delivered task"
  const schemaTaskDescription = (schema: unknown): string =>
    (schema as { definitions: { atom: { properties: { task: { description: string } } } } }).definitions.atom.properties.task.description
  if (CANDIDATE_EXAMPLE.groups[0]!.compilation.decision !== "replace") throw new Error("fixture")
  const baseExampleTask = CANDIDATE_EXAMPLE.groups[0]!.compilation.drafts[0]!.atoms[0]!.task
  assert.equal(baseExampleTask.includes("bundle accepts a config file path"), true, "the base example is the full-instruction variant")

  for (const stage of ["ir", "ci"] as const) {
    const strict = generationContract(V2_COMPILER_CONTRACT, stage, "openai", "parent-x")
    assert.equal(strict.atom_contract.includes(assembledSentence), true, `${stage} strict contract carries the assembled-task division`)
    assert.equal(strict.atom_contract.includes(baseSentence), false, `${stage} strict contract does not keep the copy-verbatim instruction too`)
    const description = schemaTaskDescription(buildGenerationSchema(stage, "openai"))
    const draftDescription = (buildGenerationSchema(stage, "openai") as { definitions: { atom_draft: { properties: { task: { description: string } } } } }).definitions.atom_draft.properties.task.description
    assert.equal(description, draftDescription)
    assert.equal(description.includes(assembledSentence), true, `${stage} schema description carries the same division`)
    assert.equal(description.includes("copy its applicable current rule blocks verbatim here"), false)
  }

  const ciExample = JSON.parse(generationContract(V2_COMPILER_CONTRACT, "ci", "openai", "parent-x").example_candidate)
  const strictTask = ciExample.groups[0].compilation.drafts[0].atoms[0].task
  assert.equal(strictTask.includes("bundle accepts a config file path"), false, "the strict example does not copy rule text into task")
  assert.ok(strictTask.startsWith("Implement and validate bundle"))

  assert.deepEqual(V2_COMPILER_CONTRACT, baseContract, "projections must not mutate the base contract")
  assert.deepEqual(CANDIDATE_JSON_SCHEMA, baseSchema, "projections must not mutate the base schema")
  assert.deepEqual(CANDIDATE_EXAMPLE, baseExample, "projections must not mutate the base example")
  assert.equal(V2_COMPILER_CONTRACT.atom_contract.includes(baseSentence), true)
  assert.equal(schemaTaskDescription(CANDIDATE_JSON_SCHEMA).includes("copy its applicable current rule blocks verbatim here"), true)
  assert.equal(CANDIDATE_EXAMPLE.groups[0]!.compilation.decision === "replace" ? CANDIDATE_EXAMPLE.groups[0]!.compilation.drafts[0]!.atoms[0]!.task : "", baseExampleTask)
})

test("the local source edit is projected into the strict IR stage only, and the legacy shape never sees it", () => {
  const baseContract = structuredClone(V2_COMPILER_CONTRACT)
  const baseSchema = structuredClone(CANDIDATE_JSON_SCHEMA)
  const editClause = "For a local content source edit that keeps the item's other sources, use edit"
  const legacyBasis = "basis selecting the current user's change"
  const relaxedBasis = "basis selecting the text available to this batch that mandates the change"

  for (const stage of ["ir", "ci"] as const) {
    const strict = generationContract(V2_COMPILER_CONTRACT, stage, "openai", "parent-x")
    assert.equal(strict.ir_change_contract.includes(editClause), stage === "ir", `${stage}: only the IR stage authors IR changes`)
    assert.equal(strict.ir_change_contract.includes(relaxedBasis), true, `${stage}: both strict stages read the same basis rule`)
    assert.equal(strict.ir_change_contract.includes(legacyBasis), false)
    assert.equal(strict.ir_change_contract.includes("can use exact quotes"), false, `${stage}: strict selectors are segment/span only`)
    assert.equal(strict.ir_change_contract.includes("can use explicit spans"), true)
    assert.equal(strict.ir_change_contract.includes("For pure addition use remove: [] and nonempty add"), stage === "ir")
  }
  assert.equal(V2_COMPILER_CONTRACT.ir_change_contract.includes(editClause), false, "the legacy contract does not promise an action it cannot deliver")
  assert.equal(V2_COMPILER_CONTRACT.ir_change_contract.includes(legacyBasis), true, "the legacy basis wording is untouched")
  assert.equal(V2_COMPILER_CONTRACT.ir_change_contract.includes("can use exact quotes"), true, "legacy quote wording is untouched")

  const change = {
    action: "edit", target: "content", id: "c1", expected_revision: 0,
    remove: [{ source_id: "user-1", digest: "sha256:d", span: { unit: "utf16", start: 0, end: 4 } }],
    add: [],
    basis: [{ source_id: "user-1", digest: "sha256:d", span: { unit: "utf16", start: 5, end: 9 } }],
    reason: "recorded correction",
  }
  const proposal = { schema_version: 2, basis, source_coverage: [], groups: [{ ...irGroup, ir_changes: [change] }] }
  assert.equal(validateGenerationProposal("ir", proposal).ok, true, "the IR-stage projection admits the edit")
  const changeOnly = (schema: Record<string, unknown>) => ({ $ref: "#/definitions/ir_change", definitions: schema.definitions })
  const legacyCanonical = new Ajv({ strict: false, allowUnionTypes: true }).compile(changeOnly(CANDIDATE_JSON_SCHEMA as unknown as Record<string, unknown>))
  assert.equal(legacyCanonical(change), false, "the shared canonical shape (legacy answer validation) rejects an edit")
  const legacyStrict = new Ajv({ strict: false, allowUnionTypes: true }).compile(changeOnly(buildStrictCandidateSchema("openai") as unknown as Record<string, unknown>))
  assert.equal(legacyStrict(change), false, "the legacy generation schema keeps its old shape")
  for (const profile of [undefined, "openai", "groq"] as const) {
    const validate = new Ajv({ strict: false, allowUnionTypes: true }).compile(buildGenerationSchema("ir", profile))
    const label = profile ?? "default"
    assert.equal(validate(proposal), true, `${label} schema admits the edit`)
    assert.equal(validate({ ...proposal, groups: [{ ...irGroup, ir_changes: [{ ...change, basis: [] }] }] }), false, `${label}: a basis is required`)
    assert.equal(validate({ ...proposal, groups: [{ ...irGroup, ir_changes: [{ ...change, remove: [], add: change.basis }] }] }), true, `${label}: pure addition needs no removal`)
    assert.equal(validate({ ...proposal, groups: [{ ...irGroup, ir_changes: [{ ...change, target: "task" }] }] }), false, `${label}: an edit only edits content`)
    assert.equal(validate({ ...proposal, groups: [{ ...irGroup, ir_changes: [{ ...change, sources: [] }] }] }), false, `${label}: an edit does not silently mean a revise`)
  }
  assert.deepEqual(V2_COMPILER_CONTRACT, baseContract, "projections must not mutate the base contract")
  assert.deepEqual(CANDIDATE_JSON_SCHEMA, baseSchema, "projections must not mutate the base schema")
})
