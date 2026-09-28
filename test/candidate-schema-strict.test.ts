import { test } from "node:test"
import assert from "node:assert/strict"
import { buildStrictCandidateExample, buildStrictCandidateSchema } from "../src/model/candidate-schema-strict.js"
import { buildStrictCandidateCheckSchema } from "../src/model/candidate-check-schema-strict.js"
import { CANDIDATE_CHECK_JSON_SCHEMA, validateCandidateCheckSchema } from "../src/model/candidate-check-schema.js"
import { createCompilerModelV2, V2_COMPILER_CONTRACT } from "../src/model/compiler-model-v2.js"
import { CANDIDATE_EXAMPLE } from "../src/model/candidate-example.js"
import { Ajv } from "ajv"
import { CANDIDATE_JSON_SCHEMA } from "../src/model/candidate-schema.js"

test("provider schema preserves field instructions including nullable IR content text", () => {
  const schema = buildStrictCandidateSchema("openai") as Record<string, any>
  const canonical = CANDIDATE_JSON_SCHEMA as Record<string, any>
  assert.equal(schema.definitions.atom_draft.properties.task.description, canonical.definitions.atom_draft.properties.task.description)
  assert.equal(schema.definitions.atom_draft.properties.completion.description, canonical.definitions.atom_draft.properties.completion.description)
  const content = schema.definitions.ir_change.anyOf.find((branch: any) => branch.properties.action.enum.includes("create") && branch.properties.target?.enum.includes("content"))
  assert.ok(content)
  assert.ok(content.properties.value.properties.text.anyOf, "IR text still has its nullable strict shape")
  assert.ok(content.properties.value.properties.text.description, "conversion must not discard the field instruction on a nullable union")
})

test("strict generation requires a non-null source disposition array even when empty", () => {
  const validate = new Ajv({ allErrors: true, strict: false }).compile(buildStrictCandidateSchema("openai"))
  const value = buildStrictCandidateExample("openai")
  value.source_coverage = null
  assert.equal(validate(value), false, "a nullable coverage field silently permits omitting source dispositions")
  value.source_coverage = []
  assert.equal(validate(value), true)
})

test("strict candidate schema requires every property and rejects additional properties", () => {
  const schema = buildStrictCandidateSchema() as Record<string, any>
  const visited = new Set<unknown>()
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node === null || typeof node !== "object" || visited.has(node)) return
    visited.add(node)
    const value = node as Record<string, any>
    if (typeof value.$ref === "string") return
    if (value.properties !== null && typeof value.properties === "object") {
      assert.equal(value.additionalProperties, false)
      assert.deepEqual([...(value.required as string[])].sort(), Object.keys(value.properties).sort())
      Object.values(value.properties).forEach(walk)
    }
    if (Array.isArray(value.oneOf)) value.oneOf.forEach(walk)
    if (Array.isArray(value.anyOf)) value.anyOf.forEach(walk)
  }
  walk(schema)
})

test("OpenAI strict Candidate schema accepts the expanded example and null stripping restores the canonical example", () => {
  const schema = buildStrictCandidateSchema("openai")
  const example = buildStrictCandidateExample("openai")
  const validate = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true }).compile(schema)
  assert.equal(validate(example), true, JSON.stringify(validate.errors))

  const stripNulls = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stripNulls)
    if (value === null || typeof value !== "object") return value
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== null)
      .map(([key, child]) => [key, stripNulls(child)]))
  }
  assert.deepEqual(stripNulls(example), CANDIDATE_EXAMPLE)
})

test("OpenAI strict Candidate and Check schemas use the supported union and literal keywords", () => {
  const schemas = [
    buildStrictCandidateSchema("openai"),
    buildStrictCandidateCheckSchema("openai"),
  ] as Array<Record<string, any>>
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (node === null || typeof node !== "object") return
    const schema = node as Record<string, any>
    assert.equal("oneOf" in schema, false)
    assert.equal("const" in schema, false)
    assert.equal("$schema" in schema, false)
    assert.equal("$id" in schema, false)
    if (schema.properties && typeof schema.properties === "object") Object.values(schema.properties).forEach(visit)
    if (schema.items && typeof schema.items === "object") visit(schema.items)
    if (Array.isArray(schema.anyOf)) schema.anyOf.forEach(visit)
    if (schema.definitions && typeof schema.definitions === "object") Object.values(schema.definitions).forEach(visit)
  }
  schemas.forEach(visit)
})

test("strict ir_change create branch keeps the canonical local_ref requirement", () => {
  const schema = buildStrictCandidateSchema() as Record<string, any>
  const create = schema.definitions.ir_change.anyOf.find((branch: any) => branch.properties?.action?.enum?.[0] === "create")
  assert.ok(create, "create branch must exist")
  assert.equal(create.required.includes("local_ref"), true)
  assert.equal("local_ref" in create.properties, true)
})

test("strict ir_change keeps one value shape per target instead of one merged blob", () => {
  const schema = buildStrictCandidateSchema() as Record<string, any>
  const branches = schema.definitions.ir_change.anyOf as Array<Record<string, any>>
  const valueFields = (action: string, target: string): string[] => {
    const branch = branches.find((item) => item.properties?.action?.enum?.[0] === action && item.properties?.target?.enum?.[0] === target)
    assert.ok(branch, `${action}:${target} branch must exist`)
    const value = branch.properties.value as Record<string, any>
    assert.equal(value.additionalProperties, false)
    assert.deepEqual([...(value.required as string[])].sort(), Object.keys(value.properties as Record<string, unknown>).sort())
    return Object.keys(value.properties as Record<string, unknown>).sort()
  }
  assert.deepEqual(valueFields("create", "task"), ["current_scope", "goal"])
  assert.deepEqual(valueFields("create", "binding"), ["purpose", "ref", "role"])
  assert.deepEqual(valueFields("create", "output"), ["description", "format"])
  assert.deepEqual(valueFields("create", "content"), ["about", "scope", "support", "text"])
  assert.deepEqual(valueFields("revise", "current_scope"), ["disposition", "text"])
  // No branch may accept the merged blob that used to leak output fields into a task create.
  const taskCreate = branches.find((item) => item.properties?.action?.enum?.[0] === "create" && item.properties?.target?.enum?.[0] === "task")
  assert.equal("description" in (taskCreate?.properties?.value?.properties ?? {}), false)
  assert.equal("format" in (taskCreate?.properties?.value?.properties ?? {}), false)
})

test("strict content changes require an exact user quote or supplied source segment", () => {
  const schema = buildStrictCandidateSchema("openai") as Record<string, any>
  const branches = schema.definitions.ir_change.anyOf as Array<Record<string, any>>
  for (const action of ["create", "revise"]) {
    const content = branches.find((item) => item.properties?.action?.enum?.[0] === action && item.properties?.target?.enum?.[0] === "content")
    assert.equal(content?.properties?.sources?.items?.$ref, "#/definitions/source_ref_with_quote")
  }
  const source = schema.definitions.source_ref_with_quote
  assert.equal(source.anyOf[0].required.includes("quote"), true)
  assert.equal(source.anyOf[1].required.includes("segment_id"), true)
  assert.equal(source.anyOf.every((branch: any) => !("span" in branch.properties)), true)
})

test("null-valued optional fields from strict providers are stripped before canonical validation", async () => {
  const candidate = JSON.parse(JSON.stringify(CANDIDATE_EXAMPLE)) as Record<string, any>
  const group = candidate.groups[0] as Record<string, any>
  group.ir_changes[0].sources[0].span = null
  group.compilation.drafts[0].atoms[0].previous_atom_ref = null
  const model = createCompilerModelV2(async () => JSON.stringify(candidate))
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
  assert.equal(result.ok, true, result.error?.message ?? "")
  const out = result.candidate as unknown as Record<string, any>
  assert.equal("span" in (out.groups[0].ir_changes[0].sources[0] ?? {}), false)
  assert.equal("previous_atom_ref" in (out.groups[0].compilation.drafts[0].atoms[0] ?? {}), false)
})

test("the check schema sent to the provider matches the check schema used to validate its answer", () => {
  // These two are written separately (one for constrained decoding, one for
  // validation). When they drift, the provider is free to omit a field the
  // validator requires, and every check answer is rejected as malformed — which
  // is exactly what happened in r11c: `/findings/0: must have required property
  // 'dimension'`, a rejected batch, and no dispatch.
  const strict = buildStrictCandidateCheckSchema() as Record<string, any>
  const strictFinding = strict.properties.findings.items
  const canonicalFinding = (CANDIDATE_CHECK_JSON_SCHEMA as Record<string, any>).properties.findings.items
  assert.deepEqual([...strictFinding.required].sort(), [...canonicalFinding.required].sort())
  assert.deepEqual(Object.keys(strictFinding.properties).sort(), Object.keys(canonicalFinding.properties).sort())
  assert.equal(strictFinding.required.includes("dimension"), true, "the provider must be constrained to name a dimension")
  // Key sets alone would not catch one copy listing a different dimension set:
  // compare the enum values too, since the provider is constrained by ours.
  assert.deepEqual(strictFinding.properties.dimension.enum, canonicalFinding.properties.dimension.enum)
  assert.equal(strictFinding.properties.dimension.enum.includes("D7"), true, "D7 judges whether the plan does the delegated work")

  const withoutDimension = validateCandidateCheckSchema({ schema_version: 2, verdict: "inconsistent", findings: [{ claim: "c", expected: "e", observed: "o", refs: [] }] })
  assert.equal(withoutDimension.ok, false)
  const withDimension = validateCandidateCheckSchema({ schema_version: 2, verdict: "inconsistent", findings: [{ dimension: "D2", claim: "c", expected: "e", observed: "o", refs: [] }] })
  assert.equal(withDimension.ok, true, withDimension.errors.join("; "))
  const planCoverage = validateCandidateCheckSchema({ schema_version: 2, verdict: "inconsistent", findings: [{ dimension: "D7", claim: "c", expected: "e", observed: "o", refs: [] }] })
  assert.equal(planCoverage.ok, true, planCoverage.errors.join("; "))
  const unknownDimension = validateCandidateCheckSchema({ schema_version: 2, verdict: "inconsistent", findings: [{ dimension: "D9", claim: "c", expected: "e", observed: "o", refs: [] }] })
  assert.equal(unknownDimension.ok, false)
})
