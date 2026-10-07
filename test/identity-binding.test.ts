import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IntentStoreV2 } from "../src/core/compiler-store-v2.js"
import { createIntentCompilerV2 } from "../src/core/intent-compiler-v2.js"
import { bindContentRefs } from "../src/core/parent-generation.js"
import { createCompilerModelV2, V2_COMPILER_CONTRACT } from "../src/model/compiler-model-v2.js"
import { CANDIDATE_EXAMPLE, CANDIDATE_EXAMPLE_INPUT } from "../src/model/candidate-example.js"
import { atomRef, settleAtomRevisions } from "../src/core/compiled-intent.js"
import { digestOf, type AtomDraft } from "../src/core/intent-contract.js"
import { buildGenerationSchema, generationContract, generationStageInstruction } from "../src/model/generation-schema.js"
import { buildStrictCandidateSchema } from "../src/model/candidate-schema-strict.js"

function parentAnswer() {
  const c = structuredClone(CANDIDATE_EXAMPLE)
  return { ...c, groups: c.groups.map(({ compilation: _a, coverage: _b, execution_decisions: _c, assessments: _d, checks: _e, ...group }) => group) }
}
function childAnswer(edit: (draft: Record<string, unknown>) => void) {
  const c = structuredClone(CANDIDATE_EXAMPLE)
  return { schema_version: 2, groups: c.groups.map(({ ir_changes: _i, task_refs: _t, depends_on: _d, ...group }) => {
    if (group.compilation.decision !== "replace") throw Error("fixture")
    const drafts = group.compilation.drafts.map(({ task_id: _task, ...draft }) => draft as Record<string, unknown>)
    drafts.forEach(edit)
    return { ...group, coverage: group.coverage.map(entry => ({ ...entry, requirement: { local_ref: "local_ref" in entry.requirement ? entry.requirement.local_ref : entry.requirement.id } })),
      compilation: { decision: "replace", drafts } }
  }) }
}
async function run(edit: (draft: Record<string, unknown>) => void) {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "identity-binding-")), runId: "r" })
  const answers: string[] = []
  const compiler = createIntentCompilerV2({ store, model: createCompilerModelV2(async input => {
    const text = JSON.stringify(input.generation_stage === "ir" ? parentAnswer() : childAnswer(edit))
    answers.push(text)
    return text
  }, async () => JSON.stringify({ schema_version: 2, verdict: "consistent", findings: [] })) })
  await compiler.acceptEvent({ schema_version: 2, run_id: "r", event_id: "input-event-id", kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text: CANDIDATE_EXAMPLE_INPUT } })
  const result = await compiler.advance({ runId: "r" })
  return { store, result }
}

test("compilation.intent_basis names the task and content by id; code binds the parent's versions", async () => {
  const { store, result } = await run(draft => {
    draft.intent_basis = [{ local_ref: "t1" }, { id: "r-common", revision: 9, digest: "sha256:stale" }, { local_ref: "r-common" }]
  })
  assert.equal(result.ok, true, result.message)
  const group = store.current().management_log.at(-1)!.candidate!.groups[0]!
  if (group.compilation.decision !== "replace") throw Error("fixture")
  const basis = group.compilation.drafts[0]!.intent_basis
  const common = store.current().ir.t1!.content.find(item => item.item_id === "r-common")!
  assert.deepEqual(basis.map(ref => ref.id), ["t1", "r-common"], "each named object once")
  assert.deepEqual(basis[1], { id: "r-common", revision: common.revision, digest: digestOf(common) })
  assert.equal(basis[0]!.revision, 0)
})

test("compilation.intent_basis naming no task or content item is rejected with the reason", async () => {
  const { result } = await run(draft => { draft.intent_basis = [{ local_ref: "r-nowhere" }] })
  assert.equal(result.ok, false)
  assert.match(result.message!, /intent_basis names r-nowhere, which is no task or content item of parent task t1/)
})

test("an Atom's revision is settled on the stored content: new 0, unchanged kept, changed plus one", () => {
  const source = (CANDIDATE_EXAMPLE.groups[0]!.compilation as { drafts: Array<{ atoms: AtomDraft[] }> }).drafts[0]!.atoms[0]!
  const held = { ...structuredClone(source), revision: 2 }
  const heldRef = atomRef(held)
  // New id: 0, whatever the answer wrote.
  assert.equal(settleAtomRevisions([], [{ ...structuredClone(source), revision: 9 }])[0]!.revision, 0)
  // Unchanged content resubmitted with any revision keeps the held one and the held bound authority.
  const rebound = { ...structuredClone(held), revision: 7, authority: { ...held.authority, basis: [{ id: "t1", revision: 5, digest: "sha256:new" }] } }
  const [unchanged] = settleAtomRevisions([held], [rebound])
  assert.equal(unchanged!.revision, 2)
  assert.deepEqual(unchanged!.authority.basis, held.authority.basis)
  assert.equal(atomRef(unchanged as never).digest, heldRef.digest)
  // A supersession an unchanged Atom names of itself is dropped; one naming another id stays.
  const selfRef = { ...rebound, previous_atom_ref: heldRef }
  assert.equal(settleAtomRevisions([held], [selfRef])[0]!.previous_atom_ref, undefined)
  const other = { id: "other", revision: 0, digest: "sha256:o" }
  assert.deepEqual(settleAtomRevisions([held], [{ ...rebound, previous_atom_ref: other }])[0]!.previous_atom_ref, other)
  // Changed content: latest held revision plus one, even when an older version exists too.
  const older = { ...structuredClone(held), revision: 1, task: "older" }
  const [changed] = settleAtomRevisions([older, held], [{ ...rebound, task: `${held.task}\n\nchanged` }])
  assert.equal(changed!.revision, 3)
})

test("strict stages no longer ask the answer for the versions code binds", () => {
  const needsVersion = /revision|digest/i
  for (const profile of [undefined, "openai", "groq"] as const) for (const assessment of [false, true]) {
    const label = `${profile ?? "canonical"}, assessment=${assessment}`
    const schema = buildGenerationSchema("ci", profile, { assessment, activeExecutions: true }) as { definitions: Record<string, { properties: Record<string, unknown>; required: string[] }>; properties: Record<string, unknown> }
    const group = schema.definitions.group as unknown as { properties: Record<string, { items?: { properties: Record<string, unknown> }; oneOf?: unknown[]; anyOf?: unknown[] }> }
    assert.equal("revision" in schema.definitions.atom_draft!.properties, false, `Atom revision is code's (${label})`)
    assert.equal("revision" in schema.definitions.atom!.properties, false, label)
    assert.equal("basis" in group.properties.execution_decisions!.items!.properties, false, `a decision's basis is derived (${label})`)
    const compilation = group.properties.compilation!
    const reuse = ((compilation.oneOf ?? compilation.anyOf) as Array<{ properties: Record<string, unknown> }>).find(branch => "reason" in branch.properties && !("drafts" in branch.properties))!
    assert.equal("current" in reuse.properties, false, `reuse.current is code's (${label})`)
    const idOnly = (node: unknown) => { const text = JSON.stringify(node, (key, value) => key === "description" ? undefined : value); assert.doesNotMatch(text, needsVersion, `${label}: ${text}`) }
    idOnly(schema.definitions.atom_draft!.properties.previous_atom_ref)
    if (assessment) idOnly(group.properties.assessments!.items!.properties.criteria_refs)
    else assert.equal("assessments" in group.properties, false, `a delegation batch writes no assessments (${label})`)
    idOnly(schema.definitions.draft!.properties.intent_basis)
    idOnly(schema.definitions.coverage!.properties.refs)
    idOnly(schema.definitions.coverage!.properties.requirement)
  }
  // A requirement's about and support are ids in the staged strict schema, and still full Refs in the legacy one.
  const staged = JSON.stringify(buildGenerationSchema("ir", "openai"))
  const legacy = JSON.stringify(buildStrictCandidateSchema("openai"))
  assert.ok(staged.length < legacy.length)
  for (const stage of ["ir", "ci"] as const) {
    const contract = generationContract(V2_COMPILER_CONTRACT, stage, "openai")
    const text = [contract.reference_contract, contract.atom_contract, ...contract.rules, contract.compilation_contract, contract.coverage_contract].join("\n")
    assert.doesNotMatch(text, /raise an Atom revision/i, "the Atom revision duty is gone")
    if (stage === "ci") {
      assert.doesNotMatch(contract.atom_contract, /Each Atom needs atom_id, revision/)
      assert.doesNotMatch(contract.atom_contract, /requires a new revision/)
      assert.doesNotMatch(contract.compilation_contract, /"current": \[Ref\]|"intent_basis":\[Ref\]/)
      assert.doesNotMatch(contract.coverage_contract, /<Ref\|\{local_ref\}>/)
      assert.match(contract.atom_contract, /Management assigns the revision/)
      assert.match(generationStageInstruction("ci", true), /previous_atom_ref \{id\}/)
    }
  }
  assert.match(V2_COMPILER_CONTRACT.atom_contract, /requires a new revision/, "the base contract is untouched")
})

test("every unknown name a content value cites is reported in one rejection", () => {
  const change = (local_ref: string, about: string) => ({ action: "create", target: "content", local_ref, value: { text: "x", about: [{ id: about }], scope: [], support: [] }, sources: [] })
  const candidate = { schema_version: 2, basis: { event_ids: [], refs: [] }, source_coverage: [], groups: [{ ir_changes: [change("r1", "nowhere-1"), change("r2", "nowhere-2")] }] } as never
  assert.throws(() => bindContentRefs(candidate, {}), (error: Error) => {
    const parts = error.message.split(" | ")
    return parts.length === 2 && parts[0]!.includes("content r1 about names nowhere-1") && parts[1]!.includes("content r2 about names nowhere-2")
  })
})
