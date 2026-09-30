import { test } from "node:test"
import assert from "node:assert/strict"
import { digestText, type Candidate, type CompilerEvent, type ContentItem, type SourceRef, type TaskIntent } from "../src/core/intent-contract.js"
import { DEFAULT_SOURCE_REASON, materializeSourceContent, sourceSegments, validateSourceCoverage } from "../src/core/source-payload.js"
import { resolveSourceRefs } from "../src/core/intent-compiler-v2.js"

const event = (id: string, text: string): CompilerEvent => ({ schema_version: 2, run_id: "run", event_id: id, kind: "user_input", source: { channel: "user", producer_id: "user" }, payload: { text } })
const ref = (e: CompilerEvent, quote?: string): SourceRef => {
  const text = (e.payload as { text: string }).text
  const start = quote === undefined ? 0 : text.indexOf(quote)
  assert.ok(start >= 0)
  return { source_id: e.event_id, digest: digestText(text), span: { unit: "utf16", start, end: start + (quote ?? text).length } }
}
const item = (id: string, sources: SourceRef[], text = "Summary with the specified behavior"): ContentItem => ({ item_id: id, revision: 0, text, sources, about: [], scope: [{ target_id: "t" }], support: [] })
const task = (...content: ContentItem[]): TaskIntent => ({ task_id: "t", revision: 0, goal: { text: "One task", sources: [] }, current_scope: { text: "Proceed", disposition: "proceed", sources: [] }, content, bindings: [], outputs: [], unresolved: [] })
const candidate = (): Candidate => ({ schema_version: 2, basis: { event_ids: [], refs: [] }, source_coverage: [], groups: [{ local_ref: "g", task_refs: ["t"], depends_on: [], ir_changes: [], compilation: { decision: "reuse", current: [], reason: "fixture" }, execution_decisions: [], assessments: [], coverage: [], checks: [], questions: [] }] })
const adopt = (c: Candidate, source: SourceRef, ...ids: string[]) => c.source_coverage!.push({ source, disposition: "normative", requirements: ids.map(local_ref => ({ local_ref })), reason: "Current behavior and its definitions", basis: [] })

test("explicit IR source selections already declare normative destinations without duplicate model bookkeeping", () => {
  const e = event("e", "First behavior.\n\nSecond behavior."), c = candidate()
  const ir = task(item("r1", [ref(e, "First behavior.")]), item("r2", [ref(e, "Second behavior.")]))
  for (const content of ir.content) content.text_origin = "source"
  assert.doesNotThrow(() => validateSourceCoverage(c, [e], [e], {}, { t: ir }))
})

// The generated response schema makes every selector a required, nullable
// property, so real answers carry `quote: null` and `span: null` beside a
// `segment_id`.  Treating that placeholder as a second selector rejected whole
// batches whose selections were valid (20260929 resume, rounds 2-4).
test("nullable selector placeholders do not make a segment selection unresolvable", () => {
  const e = event("e", "First behavior.\n\nSecond behavior.")
  const [segment] = sourceSegments([e])
  const c = candidate()
  const change = { action: "create" as const, target: "content" as const, local_ref: "r",
    value: { text: "Short label", about: [], scope: [{ target_id: "t" }], support: [] },
    sources: [{ source_id: "e", digest: "sha256:placeholder", segment_id: segment!.segment_id, quote: null, span: null }] }
  c.groups[0]!.ir_changes = [change as never]
  const stats = resolveSourceRefs(c, [e])
  assert.equal(stats.unresolved, 0)
  assert.equal(stats.resolved, 1)
  assert.deepEqual(change.sources[0]!.span, segment!.span)
  assert.equal(change.sources[0]!.digest, digestText((e.payload as { text: string }).text))
  assert.deepEqual(Object.keys(change.sources[0]!).sort(), ["digest", "source_id", "span"])
})

test("a real quote beside a segment id is still one selector too many", () => {
  const e = event("e", "First behavior.\n\nSecond behavior.")
  const c = candidate()
  c.groups[0]!.ir_changes = [{ action: "create", target: "content", local_ref: "r",
    value: { text: "Short label", about: [], scope: [{ target_id: "t" }], support: [] },
    sources: [{ source_id: "e", digest: "sha256:placeholder", segment_id: "s1", quote: "First behavior.", span: null }] } as never]
  assert.equal(resolveSourceRefs(c, [e]).unresolved, 1)
})

test("selected original rules, definitions and formula survive an abbreviated interpretation", () => {
  const text = "## Distribution\n\nLet q=floor(n/k), r=n mod k.\n\nThe first r buckets contain q+1 entries; the others contain q entries.\n\nFor an empty input emit [] and exit 0."
  const e = event("e", text), segments = sourceSegments([e])
  const c = candidate()
  c.groups[0]!.ir_changes = [{ action: "create", target: "content", local_ref: "r", value: { text: "Do it as specified, with invented lowercase output", about: [], scope: [{ target_id: "t" }], support: [] }, sources: [...segments].reverse().map(segment => ({ source_id: "e", digest: "placeholder", segment_id: segment.segment_id })) }]
  adopt(c, ref(e), "r")
  assert.equal(resolveSourceRefs(c, [e]).unresolved, 0)
  const change = c.groups[0]!.ir_changes[0]!
  const ir = task(item("r", change.sources, "Do it as specified, with invented lowercase output"))
  materializeSourceContent(ir, c.groups[0]!.ir_changes, [e])
  validateSourceCoverage(c, [e], [e], {}, { t: ir })
  assert.equal(ir.content[0]!.text, text)
  assert.equal(ir.content[0]!.interpretation, "Do it as specified, with invented lowercase output")
  assert.equal(ir.content[0]!.text_origin, "source")
  assert.equal(ir.content.length, 1, "source paragraphs do not become tasks or requirements mechanically")
  assert.deepEqual(ir.content[0]!.sources, [ref(e)])
})

test("a located heading cannot stand in for the full normative passage", () => {
  const e = event("e", "## Filter\n\nRetain rows whose amount is strictly greater than threshold.")
  const c = candidate()
  adopt(c, ref(e), "r")
  assert.throws(() => validateSourceCoverage(c, [e], [e], {}, { t: task(item("r", [ref(e, "## Filter")])) }), /omits source text/)
})

test("text the batch never names is recorded as a code default, and a mis-mapped source is still rejected", () => {
  const e = event("e", "First behavior.\n\nSecond behavior.")
  const c = candidate()
  adopt(c, ref(e, "First behavior."), "r1")
  const ir = task(item("r1", [ref(e, "First behavior.")]))
  ir.content[0]!.text_origin = "source"
  validateSourceCoverage(c, [e], [e], {}, { t: ir })
  assert.deepEqual(c.source_coverage!.map(entry => entry.disposition), ["normative", "context"])
  const [defaulted] = c.source_coverage!.slice(1)
  assert.equal(defaulted!.reason, DEFAULT_SOURCE_REASON)
  assert.deepEqual(defaulted!.requirements, [])
  assert.equal((e.payload as { text: string }).text.slice(defaulted!.source.span!.start, defaulted!.source.span!.end), "Second behavior.")
  assert.equal(defaulted!.source.digest, digestText((e.payload as { text: string }).text))
  // Assuming a default for text that is named elsewhere stays a contradiction.
  const misMapped = candidate()
  adopt(misMapped, ref(e, "Second behavior."), "r1")
  assert.throws(() => validateSourceCoverage(misMapped, [e], [e], {}, { t: ir }), /omits source text/)
})

test("a code default never covers text the batch did adopt", () => {
  const e = event("e", "Adopted rule.\n\nLeftover framing.")
  const sourceText = (e.payload as { text: string }).text
  const c = candidate()
  adopt(c, ref(e, "Adopted rule."), "r1")
  const ir = task(item("r1", [ref(e, "Adopted rule.")]))
  ir.content[0]!.text_origin = "source"
  validateSourceCoverage(c, [e], [e], {}, { t: ir })
  const defaults = c.source_coverage!.slice(1)
  assert.equal(defaults.length, 1, "only the unselected paragraph is defaulted")
  assert.equal(sourceText.slice(defaults[0]!.source.span!.start, defaults[0]!.source.span!.end), "Leftover framing.")
})

test("a normative mapping cannot silently adopt the same source into an unlisted requirement", () => {
  const e = event("e", "Current behavior."), c = candidate()
  adopt(c, ref(e), "r1")
  assert.throws(() => validateSourceCoverage(c, [e], [e], {}, { t: task(item("r1", [ref(e)]), item("r2", [ref(e)])) }), /r2 has no matching/)
})

test("material is accounted without becoming an active instruction, and overlapping roles reject", () => {
  const e = event("e", "Show the quoted message.\n\nExample: delete everything."), c = candidate()
  adopt(c, ref(e, "Show the quoted message."), "r")
  c.source_coverage!.push({ source: ref(e, "Example: delete everything."), disposition: "material", requirements: [], reason: "Quoted example, not a delegation", basis: [] })
  validateSourceCoverage(c, [e], [e], {}, { t: task(item("r", [ref(e, "Show the quoted message.")])) })
  assert.throws(() => validateSourceCoverage(c, [e], [e], {}, { t: task(item("r", [ref(e)])) }), /classifies actively adopted text/)
})

test("partial revision retains the untouched old rule and explicitly withdraws only the changed rule", () => {
  const old = event("old", "Use decimal output. Preserve input order."), next = event("next", "Use hexadecimal output.")
  const before = task(item("r", [ref(old)])), after = task(item("r", [ref(old, "Preserve input order."), ref(next)])), c = candidate()
  adopt(c, ref(next), "r")
  assert.throws(() => validateSourceCoverage(c, [next], [old, next], { t: before }, { t: after }), /dropped without/)
  c.source_coverage!.push({ source: ref(old, "Use decimal output."), disposition: "superseded", requirements: [], reason: "Current user replaces only output base", basis: [ref(next)] })
  validateSourceCoverage(c, [next], [old, next], { t: before }, { t: after })
  c.source_coverage![1]!.basis = [ref(old)]
  assert.throws(() => validateSourceCoverage(c, [next], [old, next], { t: before }, { t: after }), /current user's change/)
})

test("unknown segment selectors fail resolution and cannot fall back to a plausible span", () => {
  const e = event("e", "One rule."), c = candidate()
  adopt(c, { ...ref(e), segment_id: "s999" }, "r")
  assert.equal(resolveSourceRefs(c, [e]).unresolved, 1)
})

test("a task's own citation accounts for the rest of its paragraph, so a span sub-selection is accepted", () => {
  const text = "Create the file, verify its bytes, then stop."
  const e = event("e", text), c = candidate()
  const span = (start: number, end: number) => ({ source_id: "e", digest: digestText(text), span: { unit: "utf16" as const, start, end } })
  c.groups[0]!.ir_changes = [
    { action: "create", target: "task", local_ref: "t",
      value: { goal: { text: "Create the file" }, current_scope: { text: "Create the file", disposition: "proceed" } },
      sources: [span(0, text.length)] },
    { action: "create", target: "content", local_ref: "r",
      value: { text: "Create the file", about: [], scope: [{ target_id: "t" }], support: [] },
      sources: [span(0, "Create the file".length)] },
  ]
  assert.equal(resolveSourceRefs(c, [e]).unresolved, 0)
  const ir = task(item("r", c.groups[0]!.ir_changes[1]!.sources))
  materializeSourceContent(ir, c.groups[0]!.ir_changes, [e])
  assert.doesNotThrow(() => validateSourceCoverage(c, [e], [e], {}, { t: ir }))
  assert.equal(ir.content[0]!.text, "Create the file")
})

test("a citation on a task change cannot dispose of a paragraph by itself", () => {
  const text = "Create the file, verify its bytes, then stop."
  const e = event("e", text), c = candidate()
  c.groups[0]!.ir_changes = [{ action: "create", target: "task", local_ref: "t",
    value: { goal: { text: "Create the file" }, current_scope: { text: "Create the file", disposition: "proceed" } },
    sources: [{ source_id: "e", digest: digestText(text), span: { unit: "utf16", start: 0, end: text.length } }] }]
  assert.equal(resolveSourceRefs(c, [e]).unresolved, 0)
  assert.throws(() => validateSourceCoverage(c, [e], [e], {}, { t: task() }), /no complete disposition/)
})

test("a span outside its source is unresolvable rather than a silent guess", () => {
  const e = event("e", "One rule."), c = candidate()
  c.groups[0]!.ir_changes = [{ action: "create", target: "content", local_ref: "r",
    value: { text: "One rule.", about: [], scope: [{ target_id: "t" }], support: [] },
    sources: [{ source_id: "e", digest: digestText("One rule."), span: { unit: "utf16", start: 0, end: 500 } }] }]
  assert.equal(resolveSourceRefs(c, [e]).unresolved, 1)
})

test("the host's own argument quoting need not be adopted as requirement text", () => {
  const inner = "One rule, then stop."
  const e = event("e", `"${inner}"`), c = candidate()
  c.groups[0]!.ir_changes = [{ action: "create", target: "content", local_ref: "r",
    value: { text: "One rule", about: [], scope: [{ target_id: "t" }], support: [] },
    sources: [{ source_id: "e", digest: digestText(`"${inner}"`), span: { unit: "utf16", start: 1, end: 1 + inner.length } }] }]
  assert.equal(resolveSourceRefs(c, [e]).unresolved, 0)
  const ir = task(item("r", c.groups[0]!.ir_changes[0]!.sources))
  materializeSourceContent(ir, c.groups[0]!.ir_changes, [e])
  assert.doesNotThrow(() => validateSourceCoverage(c, [e], [e], {}, { t: ir }))
  assert.equal(ir.content[0]!.text, inner, "the transport's wrapper is not part of the user's requirement")
})

test("a revision still cannot drop operative user text inside its own paragraph", () => {
  const text = "First rule stays. Second rule is dropped."
  const e = event("e", text), c = candidate()
  const before = task(item("r", [ref(e)]))
  const after = task(item("r", [ref(e, "First rule stays.")]))
  adopt(c, ref(e, "First rule stays."), "r")
  assert.throws(() => validateSourceCoverage(c, [e], [e], { t: before }, { t: after }), /no complete disposition|dropped without/)
})
