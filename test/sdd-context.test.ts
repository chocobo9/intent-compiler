import { test } from "node:test"
import assert from "node:assert/strict"
import { canonicalJson, digestOf, digestText, type Candidate, type CompilerEvent, type ContentItem, type IrChange, type SourceRef, type TaskIntent } from "../src/core/intent-contract.js"
import { checkRequest, DELIVERY_TEXT_VIEW, deliveryRequest, irRequest, type SegmentView } from "../src/core/sdd-context.js"
import { accumulatedText, resolveCheckFindings, type EffectivePlacement } from "../src/core/sdd-compiler.js"
import { SDD_PROFILE, type CIDelivery, type DeliveryDraft, type SddBatch, type SddRun, type SddSnapshot } from "../src/core/sdd-contract.js"

/*
 * A five-input history built by hand, so each property is checked against a
 * known answer:
 *  1 creates t-a (go, safe, add, mul) and t-b (report);
 *  2 corrects add (the old sentence is withdrawn), pauses t-b, gives one
 *    context passage and one passage nothing ever placed;
 *  3 retires mul and resumes t-b;
 *  4 was never accepted;
 *  5 (current) adds div, which is about the retired mul, and corrects safe.
 */
const T1 = "# Tool\n\nBuild the tool in Go.\n\nNever write outside the workspace.\n\nThe add command prints the sum.\n\nThe mul command prints the product.\n\nThe report command writes report.txt."
const T2 = "The add command prints the sum followed by a newline.\n\nPause the reporting work for now.\n\nBackground: our team likes Go.\n\nRemember to keep logs tidy."
const T3 = "Drop the mul command.\n\nResume the reporting work."
const T4 = "Add a div command."
const T5 = "The div command prints the quotient.\n\nNever write outside the workspace or the temp directory."
const ev = (id: string, text: string): CompilerEvent => ({ schema_version: 2, run_id: "ctx", event_id: id, kind: "user_input", source: { channel: "user", producer_id: "t" }, payload: { text } })
const events = [ev("e1", T1), ev("e2", T2), ev("e3", T3), ev("e4", T4), ev("e5", T5)]
const textOf = (id: string) => (events.find(e => e.event_id === id)!.payload as { text: string }).text
function src(eventId: string, passage: string): SourceRef {
  const text = textOf(eventId), start = text.indexOf(passage)
  assert.ok(start >= 0, passage)
  return { source_id: eventId, digest: digestText(text), span: { unit: "utf16", start, end: start + passage.length } }
}
function item(task: string, id: string, revision: number, eventId: string, passage: string, about: ContentItem["about"] = []): ContentItem {
  return { item_id: id, revision, text: passage, text_origin: "source", sources: [src(eventId, passage)], about, scope: [{ target_id: task }], support: [] }
}
function task(id: string, revision: number, content: ContentItem[], disposition: TaskIntent["current_scope"]["disposition"], scope: SourceRef): TaskIntent {
  return { task_id: id, revision, goal: { text: id, sources: [scope] }, bindings: [], outputs: [], content, current_scope: { text: disposition, disposition, sources: [scope] }, unresolved: [] }
}
const ref = (i: ContentItem) => ({ id: i.item_id, revision: i.revision, digest: digestOf(i) })

const go = item("t-a", "a-go", 0, "e1", "Build the tool in Go.")
const safe0 = item("t-a", "a-safe", 0, "e1", "Never write outside the workspace.")
const add0 = item("t-a", "a-add", 0, "e1", "The add command prints the sum.")
const mul = item("t-a", "a-mul", 0, "e1", "The mul command prints the product.")
const report = item("t-b", "b-report", 0, "e1", "The report command writes report.txt.")
const add1 = item("t-a", "a-add", 1, "e2", "The add command prints the sum followed by a newline.")
const safe1 = item("t-a", "a-safe", 1, "e5", "Never write outside the workspace or the temp directory.")
const div = item("t-a", "a-div", 0, "e5", "The div command prints the quotient.", [ref(mul)])

const ir1 = { "t-a": task("t-a", 0, [go, safe0, add0, mul], "proceed", src("e1", "Build the tool in Go.")), "t-b": task("t-b", 0, [report], "proceed", src("e1", "The report command writes report.txt.")) }
const ir2 = { "t-a": task("t-a", 1, [go, safe0, add1, mul], "proceed", ir1["t-a"].current_scope.sources[0]!), "t-b": task("t-b", 1, [report], "paused", src("e2", "Pause the reporting work for now.")) }
const ir3 = { "t-a": task("t-a", 2, [go, safe0, add1], "proceed", ir1["t-a"].current_scope.sources[0]!), "t-b": task("t-b", 2, [report], "proceed", src("e3", "Resume the reporting work.")) }
const ir5 = { "t-a": task("t-a", 3, [go, safe1, add1, div], "proceed", ir1["t-a"].current_scope.sources[0]!), "t-b": ir3["t-b"] }

const group = (taskId: string, changes: IrChange[]) => ({ local_ref: `g-${taskId}`, task_refs: [taskId], depends_on: [], ir_changes: changes, compilation: { decision: "reuse" as const, current: [], reason: "" }, coverage: [], execution_decisions: [], assessments: [], checks: [], questions: [] })
// value.text is the model's label for an item, stored apart from its selected source text.
const create = (i: ContentItem): IrChange => ({ action: "create", target: "content", local_ref: i.item_id, value: { text: `label of ${i.item_id}` }, sources: i.sources })
const revise = (i: ContentItem): IrChange => ({ action: "revise", target: "content", id: i.item_id, expected_revision: i.revision - 1, value: { text: `label of ${i.item_id}` }, sources: i.sources })
function candidate(eventId: string, groups: Candidate["groups"], coverage: Candidate["source_coverage"] = []): Candidate {
  return { schema_version: 2, basis: { event_ids: [eventId], refs: [] }, groups, source_coverage: coverage }
}
const c1 = candidate("e1", [group("t-a", [go, safe0, add0, mul].map(create)), group("t-b", [create(report)])])
const c2 = candidate("e2", [group("t-a", [revise(add1)]), group("t-b", [{ action: "revise", target: "current_scope", id: "t-b", expected_revision: 0, value: {}, sources: [src("e2", "Pause the reporting work for now.")] }])],
  [{ source: src("e2", "Background: our team likes Go."), disposition: "context", requirements: [], reason: "background", basis: [] }])
const c3 = candidate("e3", [group("t-a", [{ action: "retire", target: "content", id: "a-mul", expected_revision: 0, reason: "dropped", sources: [src("e3", "Drop the mul command.")] }]),
  group("t-b", [{ action: "revise", target: "current_scope", id: "t-b", expected_revision: 1, value: {}, sources: [src("e3", "Resume the reporting work.")] }])])
const c5 = candidate("e5", [group("t-a", [create(div), revise(safe1)])])

/** A delivery as SddCompiler assembles it, for the inputs up to eventId and the IRs accepted before it. */
function delivery(eventId: string, ir: Record<string, TaskIntent>, dispositions: Record<string, DeliveryDraft["tasks"][number]["coverage"][number]["disposition"]>, earlier: Array<Record<string, TaskIntent>>, effective: EffectivePlacement[] = []): CIDelivery {
  const draft: DeliveryDraft = { decision: "deliver", reason: "update", fields: [], acceptance: [], tasks: Object.values(ir).map(t => ({ task_id: t.task_id,
    effective: effective.filter(e => t.content.includes(e.item)).map(e => e.entry), coverage: t.content.map(c => ({ item_id: c.item_id, disposition: dispositions[c.item_id] ?? "assigned", explanation: "x" })) })) }
  const items = Object.values(ir).flatMap(t => t.content)
  const delivered = items.filter(c => ["assigned", "supported"].includes(dispositions[c.item_id] ?? "assigned"))
  const { text, removed } = accumulatedText(events.slice(0, events.findIndex(e => e.event_id === eventId) + 1), earlier, ir, delivered, new Map(items.map(c => [c, dispositions[c.item_id] ?? "assigned"])), effective)
  const content = { profile: SDD_PROFILE, event_id: eventId, ir_digest: digestOf(ir), draft, text, removed, contract: { fields: [], acceptance: [], effective: [], dropped: [] } }
  return { ...content, ref: { id: `ci-${eventId}`, revision: 1, digest: digestOf(content) } }
}
const batch = (eventId: string, ir: Record<string, TaskIntent>, c: Candidate, d?: CIDelivery, state: SddBatch["state"] = "accepted"): SddBatch =>
  ({ event_id: eventId, requests_used: 3, max_requests: 9, state, parent: { ir, candidate: c, digest: digestOf(ir) }, ...(d ? { delivery: d } : {}), calls: [] })
function run(d: CIDelivery, source: string, openGaps: string[] | undefined): SddRun {
  const prd_check = openGaps && { state: openGaps.length ? "NEED_MANUAL_DECISION" : "PASS", status: openGaps.length ? "fail_or_missing_prd_gate" : "pass",
    unresolved: openGaps.length, blocked: 0, manual_review: 0, open_gaps: openGaps.map(title => ({ title, text: `${title} details` })), report: "output/08-验证结果.md" }
  const result = { event_id: `ret-${d.event_id}`, run_id: `sdd-${d.ref.id}`, ci_ref: d.ref, status: "finished" as const, sdd_status: "pass" as const, stages: {}, artifacts: [{ path: `${d.event_id}/verdict.md`, digest: `d-${source}` }], source_digest: source, reason: "", ...(prd_check ? { prd_check } : {}) }
  return { run_id: result.run_id, ci_ref: d.ref, event_id: d.event_id, baseline: { path: "/b", digest: "base" }, config_digest: "c", state: "returned", result }
}

function store(): SddSnapshot {
  const d1 = delivery("e1", ir1, {}, []), d2 = delivery("e2", ir2, { "b-report": "paused" }, [ir1]), d3 = delivery("e3", ir3, {}, [ir1, ir2])
  const r3 = run(d3, "src3", undefined)
  delete r3.result; r3.state = "running"
  return {
    profile: SDD_PROFILE, run_id: "ctx", events: structuredClone(events), ir: ir3,
    batches: [batch("e1", ir1, c1, d1), batch("e2", ir2, c2, d2), batch("e3", ir3, c3, d3),
      { event_id: "e4", requests_used: 9, max_requests: 9, state: "rejected", calls: [], error: "budget" },
      batch("e5", ir5, c5, delivery("e5", ir5, {}, [ir1, ir2, ir3]), "check")],
    runs: [
      run(d1, "src1", ["GAP-001 report.txt is not written"]),
      run(d2, "src2", []),
      r3,
    ],
  }
}
const current = (s: SddSnapshot) => s.batches.at(-1)!
const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1
const fullIrInput = (s: SddSnapshot) => ({ generation_stage: "ir", run_id: "ctx", events: [s.events[4]!], source_events: s.events.slice(0, 4), source_segments: [], ir: s.ir })

test("every original sentence appears once per request, and identical segments point at the IR item carrying them", () => {
  const s = store()
  const ir = irRequest(s, s.events[4]!, fullIrInput(s)).request
  const ci = deliveryRequest(s, current(s)).request
  const check = checkRequest(s, current(s)).request
  for (const [name, request] of [["ir", ir], ["ci", ci], ["check", check]] as const) {
    const json = JSON.stringify(request)
    // The IR stage shows every input once; CI and check show unchanged requirements by id only.
    assert.equal(occurrences(json, "Build the tool in Go."), name === "ir" ? 1 : 0, name)
    assert.equal(occurrences(json, "The report command writes report.txt."), name === "ir" ? 1 : 0, name)
    // The current input appears once in every stage.
    assert.equal(occurrences(json, "The div command prints the quotient."), 1, name)
  }
  // What this round writes for is shown in full: the new div and the corrected safe.
  assert.deepEqual([...ci.to_write].sort(), ["a-div", "a-safe"])
  assert.ok(JSON.stringify(ci).includes("Never write outside the workspace or the temp directory."))
  const run = ir.adopted_segments.find(x => x.source_id === "e1")!.runs.find(r => r.text_in.item_id === "a-go")!
  assert.deepEqual(run, { from: "s2", to: "s2", text_in: { in: "ir", task_id: "t-a", item_id: "a-go", revision: 0 } })
  assert.ok(!ir.source_segments.some(x => x.source_id === "e1" && x.segment_id === "s2"))
  assert.notEqual((ir.source_events[0]!.payload as { text: string }).text, T1)
})

test("an early long-standing constraint stays complete in IR, delivery history and feedback", () => {
  const s = store()
  const ci = deliveryRequest(s, current(s)).request
  // Unchanged, so shown by id for its disposition; its text is delivered verbatim.
  assert.ok(ci.ir["t-a"]!.content.some(c => c.item_id === "a-go" && c.revision === 0 && c.text.startsWith("(text not shown")))
  const coverage = ci.history.coverage.find(c => c.item_id === "a-go")!
  assert.equal(coverage.records[0]!.ci, "ci-e3")
  // Latest returned run: its PRD check passed, but run 3 has not returned yet.
  const latest = ci.feedback.runs.find(r => r.run_id === "sdd-ci-e2")!
  assert.equal(latest.prd_check.state, "PASS")
  assert.equal(latest.code_state, "later_run_not_returned")
})

test("a task paused for a round brings back its last delivery, run and assessment", () => {
  const s = store()
  const ci = deliveryRequest(s, current(s)).request
  // Resumed in input 3 and delivered there; also check a store where input 3 is the current batch.
  const s3 = store(); s3.batches = s3.batches.slice(0, 2).concat([{ ...batch("e3", ir3, c3, delivery("e3", ir3, {}, [ir1, ir2]), "ci") }]); s3.ir = ir2; s3.runs = s3.runs.slice(0, 2)
  const resumed = deliveryRequest(s3, s3.batches.at(-1)!).request
  const records = resumed.history.coverage.find(c => c.item_id === "b-report")!.records
  assert.deepEqual(records.map(r => [r.ci, r.disposition]), [["ci-e2", "paused"], ["ci-e1", "assigned"]])
  assert.ok(resumed.history.runs.some(r => r.ci === "ci-e1" && r.result?.source_digest === "src1"))
  // Run 1's check left a GAP open: it stays visible, stating that run 2 changed that code.
  const old = resumed.feedback.runs.find(r => r.run_id === "sdd-ci-e1")!
  assert.deepEqual(old.prd_check.open_gaps.map(g => g.title), ["GAP-001 report.txt is not written"])
  assert.equal(old.code_state, "changed_by_later_runs")
  assert.deepEqual(old.later_runs, ["sdd-ci-e2"])
  assert.ok(ci.history.coverage.find(c => c.item_id === "b-report")!.records[0]!.disposition === "assigned")
})

test("corrections and withdrawals keep what they correct: withdrawn text, retired and previous versions", () => {
  const s = store()
  const check = checkRequest(s, current(s)).request
  // The add sentence input 2 replaced is no longer adopted: its full text stays.
  const textOfView = (x: SegmentView) => "text" in x ? x.text : ""
  assert.ok(check.sources.inputs[0]!.segments.some(x => textOfView(x).includes("The add command prints the sum.")))
  // safe@0 is what input 5 corrects: the previous version is supplied and named in the change.
  assert.equal(check.ir_change.previous_versions["t-a"]!.content.find(c => c.item_id === "a-safe")!.revision, 0)
  assert.deepEqual(check.ir_change.tasks[0]!.revised, [{ item_id: "a-safe", from: 0, to: 1 }])
  assert.deepEqual(check.ir_change.tasks[0]!.added, ["a-div"])
  // The e1 segment safe@0 selected points at the previous version, not at nothing.
  assert.deepEqual(check.sources.inputs[0]!.segments.find(x => "text_in" in x && x.text_in.item_id === "a-safe"), { from: "s3", to: "s3", text_in: { in: "previous_versions", task_id: "t-a", item_id: "a-safe", revision: 0 } })
  assert.ok(check.ir_update.groups[0]!.ir_changes.some(c => (c as { action: string }).action === "revise"))
  // The retired mul is still present, as the object div is about.
  assert.ok(check.referenced_objects.some(o => o.kind === "content" && (o.object as ContentItem).item_id === "a-mul"))
})

test("feedback is SDD's own PRD check: latest run always, earlier runs only with open GAPs", () => {
  const s = store()
  s.runs[1]!.result!.prd_check!.open_gaps = []
  const extra = run(delivery("e3", ir3, {}, [ir1, ir2]), "src3", [])
  s.runs[2] = extra
  const { request, report } = deliveryRequest(s, current(s))
  assert.deepEqual(request.feedback.runs.map(r => r.run_id), ["sdd-ci-e1", "sdd-ci-e3"])
  assert.ok(report.omitted.some(o => o.kind === "prd_check" && o.id === "sdd-ci-e2"))
  delete s.runs[0]!.result!.prd_check
  const second = deliveryRequest(s, current(s))
  assert.ok(second.report.warnings.some(w => w.includes("sdd-ci-e1") && w.includes("PRD check")))
})

test("passages no record places and inputs no batch accepted keep their text and are reported", () => {
  const s = store()
  const { request, report } = irRequest(s, s.events[4]!, fullIrInput(s))
  assert.ok(request.source_segments.some(x => x.source_id === "e2" && x.text?.includes("Remember to keep logs tidy.")))
  assert.ok(request.source_ledger.unplaced.some(u => u.source_id === "e2"))
  assert.deepEqual(request.source_ledger.unprocessed_inputs, ["e4"])
  assert.ok(request.source_segments.some(x => x.source_id === "e4" && x.text === T4))
  assert.ok(report.warnings.some(w => w.includes("user input 2") && w.includes("no recorded destination")))
  assert.ok(report.warnings.some(w => w.includes("e4") && w.includes("no accepted batch")))
  // The context passage has a recorded disposition: kept, but not reported as unplaced.
  assert.ok(!request.source_ledger.unplaced.some(u => textOf(u.source_id).slice(u.span.start, u.span.end).includes("Background")))
})

test("references that do not resolve fail the build instead of being sent", () => {
  const s = store()
  const ghost = structuredClone(s)
  const b = current(ghost)
  b.parent!.ir["t-a"]!.content.find(c => c.item_id === "a-div")!.about = [{ id: "ghost", revision: 0, digest: "x" }]
  assert.throws(() => deliveryRequest(ghost, b), /ghost@0, which no recorded IR holds/)
  const foreign = structuredClone(s)
  foreign.batches.at(-1)!.parent!.ir["t-a"]!.content[0]!.sources = [{ source_id: "elsewhere", digest: "x", span: { unit: "utf16", start: 0, end: 1 } }]
  assert.throws(() => checkRequest(foreign, foreign.batches.at(-1)!), /cites source elsewhere/)
  const scoped = structuredClone(s)
  scoped.batches.at(-1)!.parent!.ir["t-a"]!.content[0]!.scope = [{ target_id: "undeclared-output" }]
  assert.throws(() => deliveryRequest(scoped, scoped.batches.at(-1)!), /scoped to undeclared-output/)
})

test("a first delivery is every input in the SDD-only arm's form, byte for byte", () => {
  const d1 = delivery("e1", ir1, {}, [])
  assert.equal(d1.text, `# Accumulated original user requirements\nApply each update in order. Later explicit revisions replace only the affected earlier requirements.\n\n\n## Original user update 1\n\n${T1}\n`)
  assert.deepEqual(d1.removed, [])
})

test("code cuts only what an earlier IR selected and this delivery drops, and records why", () => {
  const d5 = current(store()).delivery!
  // Superseded add@0, retired mul and corrected safe@0 are cut from input 1; their replacements stay.
  for (const gone of ["The add command prints the sum.\n", "The mul command prints the product.", "Never write outside the workspace.\n"]) assert.ok(!d5.text.includes(gone), gone)
  for (const kept of ["The add command prints the sum followed by a newline.", "Never write outside the workspace or the temp directory.", "The div command prints the quotient."]) assert.ok(d5.text.includes(kept), kept)
  // Text no IR selected stays: the heading, unplaced and context passages, the update instructions, and an input never accepted.
  for (const kept of ["# Tool", "Remember to keep logs tidy.", "Background: our team likes Go.", "Drop the mul command.", "Pause the reporting work for now.", T4]) assert.ok(d5.text.includes(kept), kept)
  assert.ok(!/\n\n\n/u.test(d5.text.split("## Original user update 1\n\n")[1]!.split("\n\n## Original user update 2")[0]!), "a cut leaves no stacked blank lines")
  // Adjacent whole paragraphs leave as one passage, naming every item that selected it.
  assert.deepEqual(d5.removed.map(r => [r.input, r.text.trim(), r.selected_before, r.now]), [
    [1, "Never write outside the workspace.\n\nThe add command prints the sum.\n\nThe mul command prints the product.", ["a-safe@0", "a-add@0", "a-mul@0"], []],
  ])
  // A paused task's passages are cut while paused and recorded with their disposition.
  const d2 = delivery("e2", ir2, { "b-report": "paused" }, [ir1])
  assert.ok(!d2.text.includes("The report command writes report.txt."))
  assert.deepEqual(d2.removed.find(r => r.text.includes("report"))!.now, [{ item: "b-report@0", disposition: "paused" }])
})

test("an effective statement follows the paragraph of its requirement's first passage", () => {
  const entry = { item_id: "a-add", text: "add prints the sum and a newline.", basis: [{ source_id: "e2", segment_id: "s1" }] }
  const both = { ...add1, sources: [...add0.sources, ...add1.sources] }
  const ir = { ...ir2, "t-a": { ...ir2["t-a"], content: [go, safe0, both, mul] } }
  const d = delivery("e2", ir, {}, [ir1], [{ item: both, entry }])
  assert.ok(d.text.includes("The add command prints the sum.\n\n[requirement as it now holds, per user input 2]\nadd prints the sum and a newline.\n\nThe mul command"), d.text)
})

test("the check is told how the text was built instead of seeing every input twice; findings still match the stored text", () => {
  const s = store()
  const check = checkRequest(s, current(s)).request
  assert.equal(check.delivery.text, DELIVERY_TEXT_VIEW)
  assert.deepEqual(check.delivery.removed, current(s).delivery!.removed)
  const textOfView = (x: SegmentView) => "text" in x ? x.text : ""
  assert.ok(check.sources.inputs[0]!.segments.some(x => textOfView(x).includes("The add command prints the sum.")))
})

test("the same store builds byte-identical requests, also after a JSON round trip", () => {
  const s = store(), copy = JSON.parse(JSON.stringify(s)) as SddSnapshot
  for (const build of [(x: SddSnapshot) => irRequest(x, x.events[4]!, fullIrInput(x)), (x: SddSnapshot) => deliveryRequest(x, current(x)), (x: SddSnapshot) => checkRequest(x, current(x))]) {
    assert.equal(canonicalJson(build(s)), canonicalJson(build(copy)))
    assert.equal(canonicalJson(build(s)), canonicalJson(build(s)))
  }
})

test("check findings resolve only against material the request showed", () => {
  const s = store()
  const request = checkRequest(s, current(s)).request
  const finding = (refs: Array<{ id: string; revision: number; quote: string }>) => ({ severity: "blocking" as const, dimension: "D7", claim: "c", expected: "e", observed: "o", refs })
  const resolved = resolveCheckFindings([
    finding([{ id: "e1", revision: 0, quote: "Never write outside the workspace." }]),
    finding([{ id: "e1", revision: 0, quote: "" }]),
    finding([{ id: "a-safe", revision: 0, quote: "" }]),
    finding([{ id: "a-safe", revision: 7, quote: "" }]),
    finding([{ id: "a-div", revision: 0, quote: "prints the remainder" }]),
    finding([{ id: "ci-e5", revision: 1, quote: "The div command prints the quotient." }]),
    finding([{ id: "ci-e1", revision: 1, quote: "" }]),
  ], request, s)
  assert.deepEqual(resolved.map(f => f.evidence_resolved), [true, false, true, false, false, true, false])
})
