import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { buildStrictCandidateSchema } from "../src/model/candidate-schema-strict.js"
import { resolveSourceRefs } from "../src/core/intent-compiler-v2.js"
import { digestText, type Candidate, type CompilerEvent } from "../src/core/intent-contract.js"

/**
 * The shape the provider forces and the shape the resolver accepts are two
 * hand-written halves of one contract.  When they drifted, every answer was
 * rejected as "sources do not resolve" and whole batches died (20260929,
 * probe: 132 of 139 references in one answer).  This file exists to fail on the
 * drift instead of on the next run:
 *
 * - the generated schema is asserted to still require every selector property
 *   and to allow null, because that is what forces the placeholder;
 * - the resolver is asserted to accept exactly that placeholder shape.
 */
const sourceRef = () => {
  const schema = buildStrictCandidateSchema("openai") as { definitions: Record<string, { required?: string[]; properties?: Record<string, unknown> }> }
  return schema.definitions.source_ref!
}

const event = (id: string, text: string): CompilerEvent => ({
  schema_version: 2, run_id: "run", event_id: id, kind: "user_input",
  source: { channel: "user", producer_id: "user" }, payload: { text },
})

function candidateWith(ref: Record<string, unknown>): Candidate {
  return {
    schema_version: 2,
    basis: { event_ids: [], refs: [] },
    source_coverage: [],
    groups: [{
      local_ref: "g", task_refs: ["t"], depends_on: [],
      ir_changes: [{
        action: "create", target: "content", local_ref: "r",
        value: { text: "label", about: [], scope: [{ target_id: "t" }], support: [] },
        sources: [ref],
      }],
      compilation: { decision: "reuse", current: [], reason: "fixture" },
      execution_decisions: [], assessments: [], coverage: [], checks: [], questions: [],
    }],
  } as unknown as Candidate
}

test("a rejected reference records the selector the answer wrote, not a placeholder span", () => {
  const e = event("e", "First behavior.\n\nSecond behavior.")
  const unknownSegment = candidateWith({ source_id: "e", digest: "sha256:x", quote: null, segment_id: "s99", span: null })
  assert.deepEqual(resolveSourceRefs(unknownSegment, [e]).unresolvedRefs,
    [{ source_id: "e", path: "$.groups[0].ir_changes[0].sources[0]", segment_id: "s99", reason: "segment_unknown" }])
  const unknownSource = candidateWith({ source_id: "invented", digest: "sha256:x", quote: null, segment_id: null, span: null })
  assert.deepEqual(resolveSourceRefs(unknownSource, [e]).unresolvedRefs,
    [{ source_id: "invented", path: "$.groups[0].ir_changes[0].sources[0]", reason: "source_unknown" }])
  const badQuote = candidateWith({ source_id: "e", digest: "sha256:x", quote: "not in this text", segment_id: null, span: null })
  const raw = structuredClone(badQuote)
  assert.deepEqual(resolveSourceRefs(badQuote, [e]).unresolvedRefs,
    [{ source_id: "e", path: "$.groups[0].ir_changes[0].sources[0]", quote: "not in this text", reason: "quote_unresolved",
      diagnostic: "No unique exact 16-unit prefix anchor; compare the supplied source text. Ignoring whitespace runs, backticks, backslashes and the quote's edge punctuation, it still occurs nowhere." }])
  assert.deepEqual(badQuote, raw, "failed references retain even nullable placeholders")
})

test("the generated schema still forces a nullable placeholder for every selector", () => {
  const definition = sourceRef()
  assert.deepEqual(definition.required, ["source_id", "digest", "quote", "segment_id", "span"])
  const quote = definition.properties!.quote as { anyOf?: Array<{ type?: string }> }
  assert.ok(quote.anyOf?.some(branch => branch.type === "null"), "quote must stay nullable or the resolver's tolerance is dead code")
})

test("a schema-shaped answer resolves, whether it addresses by segment or by span", () => {
  const e = event("e", "First behavior.\n\nSecond behavior.")
  const digest = digestText((e.payload as { text: string }).text)
  const bySegment = candidateWith({ source_id: "e", digest, quote: null, segment_id: "s1", span: null })
  assert.equal(resolveSourceRefs(bySegment, [e]).unresolved, 0)
  assert.deepEqual((bySegment.groups[0]!.ir_changes[0] as { sources: any[] }).sources[0]!.span, { unit: "utf16", start: 0, end: 17 })
  const bySpan = candidateWith({ source_id: "e", digest, quote: null, segment_id: null, span: { unit: "utf16", start: 0, end: 15 } })
  assert.equal(resolveSourceRefs(bySpan, [e]).unresolved, 0)
  const withQuote = candidateWith({ source_id: "e", digest, quote: "First behavior.", segment_id: null, span: null })
  assert.equal(resolveSourceRefs(withQuote, [e]).unresolved, 0)
})

test("the recorded dpipe answer still resolves every reference", () => {
  const fixture = JSON.parse(readFileSync(resolve("test/fixtures/dpipe-structured-004/candidate.json"), "utf8")) as Candidate
  const event4 = JSON.parse(readFileSync(resolve("test/fixtures/dpipe-structured-004/event.json"), "utf8")) as CompilerEvent
  const stats = resolveSourceRefs(structuredClone(fixture), [event4])
  assert.equal(stats.unresolved, 0)
  assert.ok(stats.total > 20, `the fixture should exercise many references, saw ${stats.total}`)
})
