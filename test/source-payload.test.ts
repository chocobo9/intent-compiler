import { test } from "node:test"
import assert from "node:assert/strict"
import { digestText, type Candidate, type CompilerEvent, type ContentItem, type SourceRef, type TaskIntent } from "../src/core/intent-contract.js"
import { locateQuote, materializeSourceContent, recordedDispositions, selectedSourceHistory, SourceLedger, sourceSegments, validateSourceCoverage, withdrawnPassages } from "../src/core/source-payload.js"
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
  const stats = resolveSourceRefs(c, [e])
  assert.equal(stats.unresolved, 1)
  assert.equal(stats.unresolvedRefs[0]?.reason, "selector_conflict")
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

test("execution returns, unchanged batches and earlier inputs are not held to the ledger", () => {
  const old = event("old", "An earlier sentence nobody adopted.\n\nAn adopted rule.")
  const now = event("now", "A new rule.")
  const ir = task(adopted("r1", [whole(old, "An adopted rule.")]), adopted("r2", [whole(now, "A new rule.")]))
  // The earlier input keeps its unplaced sentence; only this turn's input is checked.
  assert.doesNotThrow(() => validateSourceCoverage(changing(candidate()), [now], [old, now], {}, { t: ir }, { ownEventIds: new Set(["now"]) }))
  // A batch that changes no IR is not checked, even for its own input.
  assert.doesNotThrow(() => validateSourceCoverage(candidate(), [old], [old, now], {}, { t: ir }, { ownEventIds: new Set(["old"]) }))
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
