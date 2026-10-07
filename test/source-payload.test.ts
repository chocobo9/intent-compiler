import { test } from "node:test"
import assert from "node:assert/strict"
import { digestText, type Candidate, type CompilerEvent, type ContentItem, type SourceRef, type TaskIntent } from "../src/core/intent-contract.js"
import { contentKey, locateQuote, materializeSourceContent, recordedDispositions, selectedSourceHistory, SourceLedger, sourceSegments, unplacedByInput, validateSourceCoverage, withdrawnPassages } from "../src/core/source-payload.js"
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

// Full runs 856312ae and cb04de9f: R1 IR answers named a segment and a quote
// inside it, and were refused as "selector_conflict" until the batch ran out.
function segmentAndQuote(text: string, segment_id: string, quote: string) {
  const e = event("e", text)
  const c = candidate()
  c.groups[0]!.ir_changes = [{ action: "create", target: "content", local_ref: "r",
    value: { text: "Short label", about: [], scope: [{ target_id: "t" }], support: [] },
    sources: [{ source_id: "e", digest: "sha256:placeholder", segment_id, quote, span: null }] } as never]
  const stats = resolveSourceRefs(c, [e])
  const change = c.groups[0]!.ir_changes[0] as unknown as { sources: SourceRef[] }
  return { stats, source: change.sources[0]! }
}

test("a quote inside the segment it names selects the quote", () => {
  const text = "Intro.\n\nFirst behavior. More detail here.\n\nSecond behavior."
  const { stats, source } = segmentAndQuote(text, "s2", "More detail here.")
  assert.equal(stats.unresolved, 0)
  assert.equal(stats.resolved, 1)
  const start = text.indexOf("More detail here.")
  assert.deepEqual(source.span, { unit: "utf16", start, end: start + "More detail here.".length })
  assert.deepEqual(Object.keys(source).sort(), ["digest", "source_id", "span"])
})

test("a quote outside the segment it names is refused and says so", () => {
  const { stats } = segmentAndQuote("First behavior.\n\nSecond behavior.", "s1", "Second behavior.")
  assert.equal(stats.unresolved, 1)
  assert.equal(stats.unresolvedRefs[0]?.reason, "selector_conflict")
  assert.equal(stats.unresolvedRefs[0]?.diagnostic, "the quote is not in segment s1")
})

test("a quote repeated inside the segment it names is refused and says so", () => {
  const { stats } = segmentAndQuote("Then retry once. Later retry once.\n\nOther.", "s1", "retry once")
  assert.equal(stats.unresolved, 1)
  assert.equal(stats.unresolvedRefs[0]?.reason, "selector_conflict")
  assert.equal(stats.unresolvedRefs[0]?.diagnostic, "the quote occurs more than once in segment s1")
})

test("an unresolvable reference records which part failed", () => {
  const e = event("e", "First behavior.\n\nSecond behavior.")
  const c = candidate()
  const value = { text: "Short label", about: [], scope: [{ target_id: "t" }], support: [] }
  c.groups[0]!.ir_changes = [
    { action: "create", target: "content", local_ref: "r1", value, sources: [{ source_id: "e:truncated", digest: "x", segment_id: "s1", quote: null, span: null }] } as never,
    { action: "create", target: "content", local_ref: "r2", value, sources: [{ source_id: "e", digest: "x", segment_id: "s99", quote: null, span: null }] } as never,
    { action: "create", target: "content", local_ref: "r3", value, sources: [{ source_id: "e", digest: "x", segment_id: null, quote: null, span: { unit: "utf16", start: 0, end: 9999 } }] } as never,
  ]
  const stats = resolveSourceRefs(c, [e])
  assert.equal(stats.unresolved, 3)
  assert.deepEqual(stats.unresolvedRefs.map(ref => ref.reason), ["source_unknown", "segment_unknown", "span_invalid"])
})

test("selected original rules, definitions and formula survive an abbreviated interpretation", () => {
  const text = "## Distribution\n\nLet q=floor(n/k), r=n mod k.\n\nThe first r buckets contain q+1 entries; the others contain q entries.\n\nFor an empty input emit [] and exit 0."
  const e = event("e", text), segments = sourceSegments([e])
  const c = candidate()
  c.groups[0]!.ir_changes = [{ action: "create", target: "content", local_ref: "r", value: { text: "Do it as specified, with invented lowercase output", about: [], scope: [{ target_id: "t" }], support: [] }, sources: [...segments].reverse().map(segment => ({ source_id: "e", digest: "placeholder", segment_id: segment.segment_id })) }]
  adopt(c, ref(e), "r")
  assert.equal(resolveSourceRefs(c, [e]).unresolved, 0)
  const change = c.groups[0]!.ir_changes[0]!
  const ir = task(item("r", (change as { sources: any[] }).sources, "Do it as specified, with invented lowercase output"))
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

test("unselected text stays unclassified, and a mis-mapped explicit source is still rejected", () => {
  const e = event("e", "First behavior.\n\nSecond behavior.")
  const c = candidate()
  adopt(c, ref(e, "First behavior."), "r1")
  const ir = task(item("r1", [ref(e, "First behavior.")]))
  ir.content[0]!.text_origin = "source"
  validateSourceCoverage(c, [e], [e], {}, { t: ir })
  assert.deepEqual(c.source_coverage!.map(entry => entry.disposition), ["normative"])
  const misMapped = candidate()
  adopt(misMapped, ref(e, "Second behavior."), "r1")
  assert.throws(() => validateSourceCoverage(misMapped, [e], [e], {}, { t: ir }), /omits source text/)
})

test("unselected ranges and paragraphs need no automatic classification or complete disposition", () => {
  const e = event("e", "Adopted rule. Leftover framing.\n\nAnother paragraph.")
  const c = candidate()
  const ir = task(item("r1", [ref(e, "Adopted rule.")]))
  ir.content[0]!.text_origin = "source"
  validateSourceCoverage(c, [e], [e], {}, { t: ir })
  assert.deepEqual(c.source_coverage, [])
})

test("a citation on a non-content change does not stand in for a disposition", () => {
  const e = event("e", "First behavior.\n\nSecond behavior.")
  const sourceText = (e.payload as { text: string }).text
  const [s1] = sourceSegments([e])
  const c = candidate()
  c.groups[0]!.ir_changes = [{ action: "revise", target: "task", id: "t", expected_revision: 0,
    value: { goal: { text: "One task" }, current_scope: { text: "Proceed", disposition: "proceed" } },
    sources: [{ source_id: "e", digest: digestText(sourceText), span: { ...s1!.span } }] } as never]
  const ir = task(item("r1", [ref(e, "Second behavior.")]))
  ir.content[0]!.text_origin = "source"
  validateSourceCoverage(c, [e], [e], {}, { t: ir })
  assert.deepEqual(c.source_coverage, [])
})

test("a carried delegation is an unresolved task, not background: silence rejects and an explicit disposition passes", () => {
  const carried = event("carried", "Add the profile command.\n\nIt prints p05 and p95.")
  const next = event("next", "Add a status command.")
  const c = candidate()
  c.basis.event_ids = ["next", "carried"]
  const ir = task(item("r-next", [ref(next)], "Status command"))
  ir.content[0]!.text_origin = "source"
  const options = { carriedEventIds: new Set(["carried"]) }
  // An earlier uncompiled delegation still requires explicit acknowledgment.
  assert.throws(() => validateSourceCoverage(c, [next, carried], [next, carried], {}, { t: ir }, options),
    /carried delegation carried has no disposition/)
  // Parking it explicitly satisfies this batch's accounting; the delegation
  // stays unregistered, so the next batch carries it again.
  c.source_coverage!.push({ source: ref(carried), disposition: "unresolved", requirements: [], reason: "Needs the earlier round's command definition before it can be compiled", basis: [] })
  validateSourceCoverage(c, [next, carried], [next, carried], {}, { t: ir }, options)
})

test("selecting a carried delegation's text into IR registers it instead of acknowledging it", () => {
  const carried = event("carried", "Add the profile command.")
  const next = event("next", "Add a status command.")
  const c = candidate()
  c.basis.event_ids = ["next", "carried"]
  const ir = task(item("r-next", [ref(next)], "Status command"), item("r-carried", [ref(carried)], "Profile command"))
  for (const content of ir.content) content.text_origin = "source"
  validateSourceCoverage(c, [next, carried], [next, carried], {}, { t: ir }, { carriedEventIds: new Set(["carried"]) })
  assert.equal(c.source_coverage!.length, 0, "selected text needs no duplicate bookkeeping")
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
  // The mechanical layer only requires a source this batch's validation can
  // resolve: which available text supports the removal is a semantic judgement
  // (the checker's), so a still-resolvable historical source is accepted here.
  validateSourceCoverage(c, [next], [old, next], { t: before }, { t: after })
  c.source_coverage![1]!.basis = [{ ...ref(old), digest: "sha256:not-the-supplied-text" }]
  assert.throws(() => validateSourceCoverage(c, [next], [old, next], { t: before }, { t: after }), /resolvable source available to this batch/)
})

test("unknown segment selectors fail resolution and cannot fall back to a plausible span", () => {
  const e = event("e", "One rule."), c = candidate()
  adopt(c, { ...ref(e), segment_id: "s999" }, "r")
  assert.equal(resolveSourceRefs(c, [e]).unresolved, 1)
})

test("a content sub-selection is accepted without classifying the rest of its paragraph", () => {
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
  const ir = task(item("r", (c.groups[0]!.ir_changes[1] as { sources: any[] }).sources))
  materializeSourceContent(ir, c.groups[0]!.ir_changes, [e])
  assert.doesNotThrow(() => validateSourceCoverage(c, [e], [e], {}, { t: ir }))
  assert.equal(ir.content[0]!.text, "Create the file")
})

test("a citation on a task change does not assign a disposition", () => {
  const text = "Create the file, verify its bytes, then stop."
  const e = event("e", text), c = candidate()
  c.groups[0]!.ir_changes = [{ action: "create", target: "task", local_ref: "t",
    value: { goal: { text: "Create the file" }, current_scope: { text: "Create the file", disposition: "proceed" } },
    sources: [{ source_id: "e", digest: digestText(text), span: { unit: "utf16", start: 0, end: text.length } }] }]
  assert.equal(resolveSourceRefs(c, [e]).unresolved, 0)
  validateSourceCoverage(c, [e], [e], {}, { t: task() })
  assert.deepEqual(c.source_coverage, [])
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
  const ir = task(item("r", (c.groups[0]!.ir_changes[0] as { sources: any[] }).sources))
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
  assert.throws(() => validateSourceCoverage(c, [e], [e], { t: before }, { t: after }), /dropped without/)
})

test("a withdrawal may drop only the voided fragment or a whole sentence whose rest is restated", () => {
  const old = event("old", "Write the result CSV to out.csv, its SHA-256 to out.csv.sha256.")
  const before = { t: task(item("r", [ref(old)])) }
  const withdraw = (c: Candidate, source: SourceRef, basis: SourceRef) =>
    c.source_coverage!.push({ source, disposition: "superseded", requirements: [], reason: "The update replaces the checksum rule.", basis: [basis] })

  // Fragment: the CSV clause stays and the new checksum rule joins it.
  const update = event("new", "Write the checksum with BLAKE2b-256 to out.csv.b2 instead.")
  const fragment = candidate()
  const kept = task(item("r", [ref(old, "Write the result CSV to out.csv"), ref(update)]))
  kept.content[0]!.text_origin = "source"
  withdraw(fragment, ref(old, ", its SHA-256 to out.csv.sha256."), ref(update))
  assert.doesNotThrow(() => validateSourceCoverage(fragment, [update], [old, update], before, { t: kept }))
  assert.deepEqual(withdrawnPassages(fragment, before, [old, update]), [{
    source: ref(old, ", its SHA-256 to out.csv.sha256."), text: ", its SHA-256 to out.csv.sha256.", items: ["r"],
    reason: "The update replaces the checksum rule.", basis: [{ source: ref(update), text: (update.payload as { text: string }).text }],
  }])

  // Whole sentence: the new input restates the clause that would otherwise be lost.
  const restated = event("new", "Write the result CSV to out.csv and its BLAKE2b-256 to out.csv.b2.")
  const whole = candidate()
  const replaced = task(item("r", [ref(restated)]))
  replaced.content[0]!.text_origin = "source"
  withdraw(whole, ref(old), ref(restated))
  assert.doesNotThrow(() => validateSourceCoverage(whole, [restated], [old, restated], before, { t: replaced }))
  assert.equal(withdrawnPassages(whole, before, [old, restated])[0]!.text, (old.payload as { text: string }).text)

  assert.deepEqual(withdrawnPassages(candidate(), before, [old]), [], "no superseded entry, no withdrawal")
})

test("an exact unique quote is located exactly as before; simplification never runs for it", () => {
  const text = "Run `tool check` first.  Then run `tool build`."
  assert.deepEqual(locateQuote("Then run `tool build`.", text), { match: "exact", start: 25, end: 47 })
  assert.deepEqual(locateQuote("tool", text), { match: "ambiguous", simplified: "not_tried" }, "a repeated exact quote stays rejected")
})

test("a quote that differs only in whitespace, backticks, backslashes or edge punctuation locates the real source slice", () => {
  const text = "Intro line.\n\n- Reads `<path>`, computes the digest, compares it with `<sum>`.\n- Writes   the report to `out\\_dir`.\n\nNext paragraph."
  const slice = (quote: string) => {
    const at = locateQuote(quote, text)
    assert.equal(at.match, "simplified", quote)
    if (at.match !== "simplified") throw new Error("fixture")
    return text.slice(at.start, at.end)
  }
  assert.equal(slice("- Reads `<path>`, computes the digest, compares it with `<sum>`. "), "Reads `<path>`, computes the digest, compares it with `<sum>`.", "trailing space dropped, closing full stop kept")
  assert.equal(slice("Reads <path>, computes the digest, compares it with <sum>."), "Reads `<path>`, computes the digest, compares it with `<sum>`.", "missing backticks")
  assert.equal(slice("Writes the report to `out_dir`."), "Writes   the report to `out\\_dir`.", "whitespace run and escape backslash")
  assert.equal(slice(". Reads `<path>`, computes the digest"), "Reads `<path>`, computes the digest", "a full stop from the previous line is not pulled in")
  assert.equal(slice("<path>, computes the digest"), "`<path>`, computes the digest", "a code span the match cut in half keeps its other backtick")
})

test("simplification does not rescue placeholders, joined fragments or ambiguous text", () => {
  const text = "Write the report.\n\nWrite the report.\n\nThen archive it to `store/`."
  assert.deepEqual(locateQuote(". . .", text), { match: "none", simplified: "empty" })
  assert.deepEqual(locateQuote("Write the report.  ", text), { match: "none", simplified: "ambiguous" })
  assert.deepEqual(locateQuote("Write the report. archive it to store/", text), { match: "none", simplified: "none" }, "words joined across a gap")
  assert.deepEqual(locateQuote("Write the report ... archive it to store/", text), { match: "none", simplified: "none" })
})

test("a simplified quote resolves to the source span; a failing one says the simplified comparison also failed", () => {
  const e = event("e", "First behavior.\n\nThe tool writes `out.csv` and exits 0.")
  const c = candidate()
  c.groups[0]!.ir_changes = [{ action: "create", target: "content", local_ref: "r",
    value: { text: "Output", about: [], scope: [{ target_id: "t" }], support: [] },
    sources: [{ source_id: "e", digest: "sha256:placeholder", quote: "The tool writes out.csv and exits 0. " }, { source_id: "e", digest: "sha256:placeholder", quote: ". . ." }] } as never]
  const stats = resolveSourceRefs(c, [e])
  assert.equal(stats.resolved, 1)
  assert.equal(stats.unresolved, 1)
  const resolved = (c.groups[0]!.ir_changes[0] as { sources: SourceRef[] }).sources[0]!
  assert.deepEqual(resolved, { source_id: "e", digest: digestText((e.payload as { text: string }).text), span: { unit: "utf16", start: 17, end: 55 } })
  assert.match(stats.unresolvedRefs[0]!.diagnostic ?? "", /Ignoring whitespace runs, backticks, backslashes and the quote's edge punctuation, it has no words left\./u)
})

// The source ledger: every passage of this turn's input needs a destination once the batch changes the IR.
const LEDGER_TEXT = "# Report command\n\nThanks for the earlier work.\n\n`report` writes `out.json`.\n\nExample:\n\n{\"ok\": true}\n\n   \n"
const changing = (c: Candidate) => { c.groups[0]!.ir_changes = [{ action: "preserve", reason: "fixture", sources: [] }, { action: "create", target: "content", local_ref: "r", value: { text: "x", about: [], scope: [{ target_id: "t" }], support: [] }, sources: [] }] as never; return c }
const whole = (e: CompilerEvent, part: string): SourceRef => ref(e, part)
const adopted = (id: string, sources: SourceRef[]): ContentItem => ({ ...item(id, sources), text_origin: "source" })

test("this turn's unplaced passage is listed by segment; an explicit entry or an adoption places it", () => {
  const e = event("turn", LEDGER_TEXT)
  const ir = task(adopted("r", [whole(e, "`report` writes `out.json`.")]))
  const own = { ownEventIds: new Set(["turn"]) }
  const c = changing(candidate())
  assert.throws(() => validateSourceCoverage(c, [e], [e], {}, { t: ir }, own),
    /this turn's input has text with no destination: turn\/s2 "Thanks for the earlier work\."; turn\/s4 "Example:"; turn\/s5 "\{\\"ok\\": true\}"\. Adopt each passage/)
  // Explicit: the opening line is not a requirement; the example defines the interface and is adopted.
  const placed = changing(candidate())
  placed.source_coverage!.push({ source: whole(e, "Thanks for the earlier work."), disposition: "context", requirements: [], reason: "An opening line, not a requirement.", basis: [] })
  const withExample = task(adopted("r", [whole(e, "`report` writes `out.json`."), whole(e, "Example:\n\n{\"ok\": true}")]))
  assert.doesNotThrow(() => validateSourceCoverage(placed, [e], [e], {}, { t: withExample }, own))
})

test("blank lines, Markdown headings, fence lines and bare list markers need no destination", () => {
  const e = event("turn", "## Title\n\n   \n\n- Do the work.\n\n```json\n{\"a\": 1}\n```\n\n### Notes\n")
  const ir = task(adopted("r", [whole(e, "Do the work."), whole(e, "{\"a\": 1}")]))
  assert.doesNotThrow(() => validateSourceCoverage(changing(candidate()), [e], [e], {}, { t: ir }, { ownEventIds: new Set(["turn"]) }))
})

test("execution returns and earlier inputs are not held to the ledger; an own input is, even without IR changes", () => {
  const old = event("old", "An earlier sentence nobody adopted.\n\nAn adopted rule.")
  const now = event("now", "A new rule.")
  const ir = task(adopted("r1", [whole(old, "An adopted rule.")]), adopted("r2", [whole(now, "A new rule.")]))
  // The earlier input keeps its unplaced sentence; only this turn's input is checked.
  assert.doesNotThrow(() => validateSourceCoverage(changing(candidate()), [now], [old, now], {}, { t: ir }, { ownEventIds: new Set(["now"]) }))
  // A batch that changes no IR is still checked for its own input.
  assert.throws(() => validateSourceCoverage(candidate(), [old], [old, now], {}, { t: ir }, { ownEventIds: new Set(["old"]) }),
    /old\/s1 "An earlier sentence nobody adopted\."/)
  // A batch with no own input (an execution return or an assessment) checks nothing.
  assert.doesNotThrow(() => validateSourceCoverage(candidate(), [], [old, now], {}, { t: ir }, { ownEventIds: new Set() }))
  // An execution return has no user text, so it never has a ledger entry.
  const ret: CompilerEvent = { schema_version: 2, run_id: "run", event_id: "ret", kind: "execution_return", source: { channel: "executor", producer_id: "host" }, payload: { text: "done" } } as never
  const ledger = new SourceLedger({ texts: new Map([["old", (old.payload as { text: string }).text]]), selected: new Map(), dispositions: [] })
  assert.deepEqual(ledger.unplaced(ret.event_id, { t: ir }), [])
  assert.deepEqual(ledger.unplaced("old", { t: ir }).map(passage => passage.text), ["An earlier sentence nobody adopted."], "shown for review")
})

test("the ledger depends on accepted state, not on which events a batch carries", () => {
  const own = event("own", "Rule one.\n\nAn unplaced aside.")
  const carried = [event("c1", "Carried one."), event("c2", "Carried two.")]
  const ir = task(adopted("r", [whole(own, "Rule one.")]))
  const check = (events: CompilerEvent[]) => {
    try { validateSourceCoverage(changing(candidate()), events, events, {}, { t: ir }, { ownEventIds: new Set(["own"]) }); return "ok" } catch (error) { return (error as Error).message }
  }
  const alone = check([own])
  assert.match(alone, /own\/s2 "An unplaced aside\."/)
  assert.equal(check([own, carried[0]!]), alone, "one carried event does not change the answer")
  assert.equal(check([own, ...carried]), alone, "three events do not change the answer")
  assert.equal(check([carried[1]!, own, carried[0]!]), alone, "order does not change the answer")

  // Re-deriving from the same accepted records gives the same ledger.
  const log = [{ status: "accepted", candidate: { groups: [{ local_ref: "g", task_refs: ["t"], ir_changes: [{ action: "create", target: "content", local_ref: "r", sources: [whole(own, "Rule one.")] }] }], source_coverage: [{ source: whole(own, "An unplaced aside."), disposition: "context", requirements: [], reason: "aside", basis: [] }] } },
    { status: "validation_failed", candidate: { groups: [], source_coverage: [{ source: whole(own, "Rule one."), disposition: "context", requirements: [], reason: "rejected batch", basis: [] }] } }] as never
  const texts = new Map([[own.event_id, (own.payload as { text: string }).text], ...carried.map(e => [e.event_id, (e.payload as { text: string }).text] as [string, string])])
  const derive = (order: [string, string][]) => new SourceLedger({ texts: new Map(order), selected: selectedSourceHistory(log, { t: ir }), dispositions: recordedDispositions(log) }).unplaced("own", { t: ir })
  assert.deepEqual(derive([...texts]), [])
  assert.deepEqual(derive([...texts].reverse()), derive([...texts]))
  assert.equal(recordedDispositions(log).length, 1, "a failed batch's entries do not count")
})

test("only content selections place text: a goal citation and a whole-input reference leave it unplaced", () => {
  const e = event("turn", "Build the report tool.\n\nThe report must be sorted by date.")
  const own = { ownEventIds: new Set(["turn"]) }
  const ir = task(adopted("r", [whole(e, "Build the report tool.")]))
  // The rule is cited by the task goal only: it is not delivered, so it is reported.
  ir.goal.sources = [whole(e, "The report must be sorted by date.")]
  assert.throws(() => validateSourceCoverage(changing(candidate()), [e], [e], {}, { t: ir }, own), /turn\/s2 "The report must be sorted by date\."/)
  // A reference to the whole input (no span) in scope or goal places nothing either.
  const spanless = structuredClone(ir)
  spanless.goal.sources = [{ source_id: "turn", digest: digestText((e.payload as { text: string }).text) }]
  spanless.current_scope.sources = [{ source_id: "turn", digest: digestText((e.payload as { text: string }).text) }]
  assert.throws(() => validateSourceCoverage(changing(candidate()), [e], [e], {}, { t: spanless }, own), /turn\/s2 "The report must be sorted by date\."/)
  // Adopting it into content places it.
  const placed = task(adopted("r", [whole(e, "Build the report tool."), whole(e, "The report must be sorted by date.")]))
  assert.doesNotThrow(() => validateSourceCoverage(changing(candidate()), [e], [e], {}, { t: placed }, own))
})

test("earlier inputs' unplaced passages are re-derived for review from accepted records", () => {
  const old = event("old", "Thanks.\n\nA rule.")
  const journal = [{ event: old }, { event: { schema_version: 2, run_id: "run", event_id: "ret", kind: "execution_return", source: { channel: "executor", producer_id: "host" }, payload: { text: "done" } } as never }]
  const ir = { t: task(adopted("r", [whole(old, "A rule.")])) }
  const accepted = { status: "accepted", candidate: { ...candidate(), source_coverage: [] } }
  assert.deepEqual(unplacedByInput({ management_log: [accepted], ir }, journal), { old: [{ source_id: "old", segment_id: "s1", start: 0, end: 7, text: "Thanks." }] })
  const disposed = { status: "accepted", candidate: { ...candidate(), source_coverage: [{ source: whole(old, "Thanks."), disposition: "context" as const, requirements: [], reason: "An opening line.", basis: [] }] } }
  assert.deepEqual(unplacedByInput({ management_log: [accepted, disposed], ir }, journal), {})
  const rejected = { ...disposed, status: "validation_failed" }
  assert.deepEqual(Object.keys(unplacedByInput({ management_log: [accepted, rejected], ir }, journal)), ["old"], "a rejected batch's entry does not place text")
})

// R10 rerun mgmt-20: a revision reselected an earlier input's passage piecewise and
// left out one block; the rejection named only the 19,310-character input, so
// the repair had to guess which text was missing.
test("a dropped earlier selection is named by item, range, segment and a bounded excerpt", () => {
  const fields = Array.from({ length: 60 }, (_, i) => `"field${i}": ${i}`).join(", ")
  const block = `- Writes a JSON manifest to the output:\n{"files": [{${fields}}]}`
  const old = event("old", `Intro line.\n\n${block}\n\n- The files array is sorted by path.`)
  const previous = { t: task(item("r-m", [ref(old, `${block}\n\n- The files array is sorted by path.`)])) }
  const current = { t: task(item("r-m", [ref(old, "- The files array is sorted by path.")])) }
  const text = (old.payload as { text: string }).text
  const start = text.indexOf(block), end = start + block.length
  let message = ""
  assert.throws(() => validateSourceCoverage(candidate(), [], [old], previous, current), (error: Error) => { message = error.message; return true })
  assert.match(message, /^previously normative source old was dropped without an explicit superseded disposition and current change basis: /)
  assert.ok(message.includes(`IR r-m selected old utf16 ${start}-`), message)
  assert.ok(message.includes(`no current source or superseded entry covers utf16 ${start}-${end} (segment s2) "- Writes a JSON manifest to the output:`), message)
  const flat = block.replace(/\s+/gu, " ")
  assert.ok(message.includes(`(${flat.length} characters)`), "a long range shows its first and last words and its length")
  assert.ok(!message.includes('"field30": 30'), "the middle of a long passage is not pasted")
  assert.ok(message.length < 500, `message length ${message.length}`)
})

test("text still adopted by an item cannot be superseded, and the message names the overlap and the item", () => {
  const old = event("old", "Keep the files array sorted by path.\n\nOld rule to replace.")
  const next = event("next", "Replace the old rule.")
  const kept = ref(old, "Keep the files array sorted by path.")
  const previous = { t: task(item("r-m", [kept])) }
  const current = { t: task(item("r-m", [kept])) }
  const c = candidate()
  c.source_coverage!.push({ source: ref(old), disposition: "superseded", requirements: [], reason: "The update replaces it.", basis: [ref(next)] })
  assert.throws(() => validateSourceCoverage(c, [next], [old, next], previous, current),
    (error: Error) => error.message === 'source_coverage[0] classifies actively adopted text as superseded: in old utf16 0-36 (segment s1) "Keep the files array sorted by path." is a current source of IR r-m')
})

test("a dropped selection with many uncovered ranges lists three and counts the rest", () => {
  const parts = ["A1 dropped", "K1 kept", "A2 dropped", "K2 kept", "A3 dropped", "K3 kept", "A4 dropped", "K4 kept", "A5 dropped"]
  const old = event("old", parts.join("\n\n"))
  const previous = { t: task(item("r", [ref(old)])) }
  const current = { t: task(item("r", parts.filter(part => part.endsWith("kept")).map(part => ref(old, part)))) }
  assert.throws(() => validateSourceCoverage(candidate(), [], [old], previous, current), (error: Error) => {
    assert.ok(error.message.includes('"A1 dropped"') && error.message.includes('"A3 dropped"'), error.message)
    assert.ok(!error.message.includes('"A4 dropped"'))
    assert.ok(error.message.endsWith("; 2 more not listed"), error.message)
    return true
  })
})

test("every entry that classes adopted text is named in one rejection, in entry order", () => {
  const e = event("e", "Heading A\n\nBody A.\n\nHeading B\n\nBody B.\n\nHeading C\n\nBody C.")
  const c = candidate()
  const headings = ["Heading A", "Heading B", "Heading C"]
  const bodies = ["Body A.", "Body B.", "Body C."]
  adopt(c, ref(e, "Body A."), "r-a"); adopt(c, ref(e, "Body B."), "r-b"); adopt(c, ref(e, "Body C."), "r-c")
  for (const heading of headings) c.source_coverage!.push({ source: ref(e, heading), disposition: "context", requirements: [], reason: "Heading", basis: [] })
  const current = { t: task(...headings.map((heading, index) => item(`r-${"abc"[index]}`, [ref(e, heading), ref(e, bodies[index]!)]))) }
  assert.throws(() => validateSourceCoverage(c, [e], [e], {}, current), (error: Error) => {
    const parts = error.message.split(" | ")
    return parts.length === 3 && parts.every((part, index) => part.startsWith(`source_coverage[${index + 3}] classifies actively adopted text as context`) && part.includes(headings[index]!))
  })
})

// 53ca6c06 mgmt-19 and mgmt-32: answers wrote context entries for section headings
// that IR items also adopted, and were refused for it.
test("a non-normative entry naming only heading lines is dropped, and heading lines never count as overlap", () => {
  const e = event("e", "## Fill\n\nFill gaps linearly.\n\n## Notes\n\nThanks for the work.")
  const ir = { t: task(adopted("r", [ref(e, "## Fill\n\nFill gaps linearly.\n\n## Notes")])) }
  const context = (c: Candidate, part: string) => c.source_coverage!.push({ source: ref(e, part), disposition: "context", requirements: [], reason: "Not a rule", basis: [] })
  const c = candidate()
  context(c, "## Fill"); context(c, "## Notes"); context(c, "## Notes\n\nThanks for the work.")
  assert.doesNotThrow(() => validateSourceCoverage(c, [e], [e], {}, ir, { ownEventIds: new Set(["e"]) }))
  assert.deepEqual(c.source_coverage!.map(entry => entry.source.span), [ref(e, "## Notes\n\nThanks for the work.").span], "only the heading-only entries are dropped")
  const body = candidate()
  context(body, "## Fill\n\nFill gaps linearly.")
  assert.throws(() => validateSourceCoverage(body, [e], [e], {}, ir), /classifies actively adopted text as context: in e utf16 0-28 \(segments s1-s2\) "## Fill Fill gaps linearly\."/)
})

// 53ca6c06 mgmt-30: R12-R15 inputs open with the host's quote directly before the first heading.
test("a first heading behind the host's opening quote needs no destination", () => {
  const e = event("turn", "\"# Changelog command\n\nWrite the changelog with \\\"quoted\\\" names.\"")
  const ir = task(adopted("r", [ref(e, "Write the changelog with \\\"quoted\\\" names.")]))
  assert.doesNotThrow(() => validateSourceCoverage(changing(candidate()), [e], [e], {}, { t: ir }, { ownEventIds: new Set(["turn"]) }))
  const plain = event("turn", "\"Intro line\n\nWrite the changelog with \\\"quoted\\\" names.\"")
  const plainIr = task(adopted("r", [ref(plain, "Write the changelog with \\\"quoted\\\" names.")]))
  assert.throws(() => validateSourceCoverage(changing(candidate()), [plain], [plain], {}, { t: plainIr }, { ownEventIds: new Set(["turn"]) }), /turn\/s1 "\\"Intro line"/)
})

test("a prior selection whose uncovered remainder is only heading lines is not dropped", () => {
  const old = event("old", "\"# Tool\n\n## Fill\n\nFill gaps linearly.\n\n## Clip\n\nClip to bounds.")
  const previous = { t: task(item("r", [ref(old)])) }
  const kept = { t: task(item("r", [ref(old, "Fill gaps linearly."), ref(old, "Clip to bounds.")])) }
  assert.doesNotThrow(() => validateSourceCoverage(candidate(), [], [old], previous, kept))
  const lost = { t: task(item("r", [ref(old, "Fill gaps linearly.")])) }
  assert.throws(() => validateSourceCoverage(candidate(), [], [old], previous, lost), /dropped without[^|]*"Clip to bounds\."/)
})

test("a withdrawn remainder holding only headings is not delivered as a withdrawal", () => {
  const e = event("e", "## Old\n\nOld rule.\n\n## Fill\n\nFill rule.")
  const text = (e.payload as { text: string }).text
  const current = task(item("r", [ref(e, "Fill rule.")]), item("gone", []))
  const ledger = new SourceLedger({ texts: new Map([["e", text]]), dispositions: [], selected: new Map([
    [contentKey("t", "r"), [ref(e, "## Fill\n\nFill rule.")]],
    [contentKey("t", "gone"), [ref(e, "## Old\n\nOld rule.")]],
  ]) })
  assert.deepEqual(ledger.withdrawnFor(current, "r"), [], "the uncovered heading alone is layout")
  assert.deepEqual(ledger.withdrawnFor(current, "gone").map(range => text.slice(range.start, range.end)), ["## Old\n\nOld rule."], "a heading withdrawn with its rule stays with it")
})

test("every carried delegation and every unassigned selection is reported together", () => {
  const first = event("c1", "First carried work."), second = event("c2", "Second carried work."), extra = event("x", "Extra text one.\n\nExtra text two.")
  const c = candidate()
  assert.throws(() => validateSourceCoverage(c, [], [first, second], {}, { t: task() }, { carriedEventIds: new Set(["c1", "c2"]) }),
    (error: Error) => error.message.split(" | ").length === 2 && /carried delegation c1 has no disposition/.test(error.message) && /carried delegation c2 has no disposition/.test(error.message))
  const adopted = { t: task(item("r1", [ref(extra, "Extra text one.")]), item("r2", [ref(extra, "Extra text two.")])) }
  assert.throws(() => validateSourceCoverage(candidate(), [extra], [extra], {}, adopted),
    (error: Error) => /r1 has no matching/.test(error.message) && /r2 has no matching/.test(error.message) && error.message.split(" | ").length === 2)
})
