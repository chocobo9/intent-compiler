import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, mkdtempSync } from "node:fs"
import { resolve, join } from "node:path"
import { tmpdir } from "node:os"
import { Ajv } from "ajv"
import { createOpenCodeModelTransportV2 } from "../src/model/opencode-transport.js"
import { createCompilerModelV2, V2_COMPILER_CONTRACT, type CompilerModelV2Input } from "../src/model/compiler-model-v2.js"
import { buildStrictCandidateSchema } from "../src/model/candidate-schema-strict.js"
import { createIntentCompilerV2 } from "../src/core/intent-compiler-v2.js"
import { IntentStoreV2 } from "../src/core/compiler-store-v2.js"
import { sourceSegments } from "../src/core/source-payload.js"
import { digestText, type CompilerEvent } from "../src/core/intent-contract.js"

const fixtureRoot = resolve("test/fixtures/dpipe-structured-004")
const original = () => JSON.parse(readFileSync(join(fixtureRoot, "candidate.json"), "utf8"))
const userEvent = (): CompilerEvent => JSON.parse(readFileSync(join(fixtureRoot, "event.json"), "utf8"))
const request = (): CompilerModelV2Input => ({ run_id: userEvent().run_id, events: [userEvent()], ir: {}, compiled: {}, atom_refs: {}, executions: [], budget: { requests_used: 0, max_requests: 1 }, contract: V2_COMPILER_CONTRACT })

function replay(structured: unknown) {
  let prompts = 0
  const transport = createOpenCodeModelTransportV2({
    directory: fixtureRoot, providerId: "openai", modelId: "gpt-5.6-sol-fast", variant: "medium",
    client: { session: {
      create: async () => ({ id: "offline-session" }),
      prompt: async input => {
        prompts++
        assert.equal(input.body.format?.retryCount, 0)
        assert.deepEqual(input.body.format?.schema, buildStrictCandidateSchema("openai"))
        const sent = JSON.parse(input.body.parts[0].text)
        const validate = new Ajv({ strict: false }).compile(input.body.format!.schema as object)
        assert.equal(validate(JSON.parse(sent.contract.example_candidate)), true)
        return { parts: [{ type: "tool", tool: "StructuredOutput", state: { status: "completed", input: structured } }], info: { structured, tokens: { input: 30913, output: 11773 } } }
      },
    } },
  })
  return { model: createCompilerModelV2(transport), prompts: () => prompts }
}

// This deliberately edited fixture is a deterministic expectation, NOT a repair
// of model output in production. The original bytes above remain unchanged.
function expectationFixture(includeHeadings: boolean) {
  const value = original()
  for (const field of ["assessments", "checks", "coverage", "execution_decisions", "questions"]) delete value[field]
  value.source_coverage = []
  if (includeHeadings) {
    const destinations: Record<string, string[]> = {
      s2: ["r-overall"], s3: ["r-ingest"],
      s10: ["r-transform-core", "r-expression", "r-window", "r-reshape-fill"],
      s35: ["r-verify"], s38: ["r-manifest"], s41: ["r-pipeline"], s44: ["r-overall"], s46: ["r-errors-build"],
    }
    for (const [segment_id, ids] of Object.entries(destinations)) for (const id of ids) {
      const change = value.groups[0].ir_changes.find((entry: any) => entry.local_ref === id)
      change.sources.push({ source_id: userEvent().event_id, digest: digestText((userEvent().payload as { text: string }).text), segment_id })
    }
  }
  return value
}

test("real -004 output fails the actual generation contract and preserves all six errors and raw evidence", async () => {
  const value = original(), { model, prompts } = replay(value)
  const result = await model.propose(request())
  assert.equal(result.ok, false)
  assert.equal(result.error?.code, "schema", "not a transport error that could trigger retry")
  assert.equal(result.schema_errors?.length, 6)
  assert.match(result.schema_errors!.join("\n"), /source_coverage/)
  for (const field of ["assessments", "checks", "coverage", "execution_decisions", "questions"]) assert.match(result.schema_errors!.join("\n"), new RegExp(field))
  assert.deepEqual(JSON.parse(result.call!.text), value)
  assert.equal(result.call?.usage?.output_tokens, 11773)
  assert.equal(prompts(), 1)
  const cleaned = expectationFixture(false)
  delete cleaned.source_coverage
  const missing = await replay(cleaned).model.propose(request())
  assert.equal(missing.ok, false)
  assert.match(missing.error!.message, /source_coverage/)
})

test("a shape-valid -004 expectation still cannot drop the eight unselected source headings", async () => {
  const { model, prompts } = replay(expectationFixture(false)), event = userEvent()
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "dpipe-gap-")), runId: event.run_id })
  store.applyDeltas({ max_management_requests: 1 })
  const compiler = createIntentCompilerV2({ store, model })
  await compiler.acceptEvent(event)
  const result = await compiler.advance({ runId: event.run_id })
  assert.equal(result.ok, false)
  assert.match(result.message!, /s2.*no complete disposition/)
  assert.deepEqual(store.current().ir, {})
  assert.deepEqual(store.current().compiled, {})
  assert.equal(prompts(), 1)
})

test("complete offline dpipe expectation preserves original rules through strict output, IR, relations and gated dispatch", async () => {
  const { model, prompts } = replay(expectationFixture(true)), event = userEvent()
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "dpipe-chain-")), runId: event.run_id })
  store.applyDeltas({ max_management_requests: 1 })
  const compiler = createIntentCompilerV2({ store, model })
  await compiler.acceptEvent(event)
  const result = await compiler.advance({ runId: event.run_id })
  assert.equal(result.ok, true, result.message)
  const state = store.current(), task = state.ir["t-dpipe"]!, compiled = state.compiled["t-dpipe"]!
  assert.equal(Object.keys(state.ir).length, 1)
  assert.equal(task.content.length, 10)
  assert.equal(compiled.atoms.length, 6)
  assert.equal(compiled.relations.length, 5)
  assert.equal(result.deliveries?.length, 1, "dependent Atoms wait for actual accepted predecessor results")
  assert.equal(result.deliveries![0]!.atom_id, compiled.relations[0]!.predecessor.id)
  const text = (event.payload as { text: string }).text
  for (const content of task.content) {
    assert.equal(content.text_origin, "source")
    assert.equal(content.text, content.sources.map(source => text.slice(source.span!.start, source.span!.end)).join("\n\n"))
  }
  for (const segment of sourceSegments([event])) assert.ok(task.content.some(content => content.sources.some(source => source.span!.start <= segment.span.start && source.span!.end >= segment.span.end)), segment.segment_id)
  assert.deepEqual(result.deliveries![0]!.atom, compiled.atoms.find(atom => atom.atom_id === result.deliveries![0]!.atom_id))
  assert.ok(result.deliveries![0]!.atom.goal_refs.some(ref => task.content.some(content => content.item_id === ref.id)))
  assert.equal("execution_task" in result.deliveries![0]!, false)
  for (const relation of compiled.relations) {
    assert.ok(compiled.atoms.some(atom => atom.atom_id === relation.predecessor.id))
    assert.ok(compiled.atoms.some(atom => atom.atom_id === relation.successor.id))
  }
  assert.equal(prompts(), 1)
})
