import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Ajv } from "ajv"
import { IntentStoreV2 } from "../src/core/compiler-store-v2.js"
import { createIntentCompilerV2, resolveSourceRefs } from "../src/core/intent-compiler-v2.js"
import { IntentStateManager } from "../src/core/intent-state-v2.js"
import { bindExpectedRevisions } from "../src/core/parent-generation.js"
import { materializeSourceContent, recordEditedRemovals, sourceSegments, validateSourceCoverage } from "../src/core/source-payload.js"
import { createCompilerModelV2, V2_COMPILER_CONTRACT, type CompilerModelV2CheckInput } from "../src/model/compiler-model-v2.js"
import { LATER_INPUT_GOVERNS } from "../src/core/requirement-flow.js"
import { buildGenerationSchema } from "../src/model/generation-schema.js"
import { stageCandidate } from "./fixtures/stage-candidate.js"
import {
  digestOf,
  digestText,
  type Candidate,
  type CompilerEvent,
  type ContentItem,
  type IrChange,
  type SourceRef,
  type TaskIntent,
} from "../src/core/intent-contract.js"

/**
 * The fixture records one real edit target: the stored
 * `r-transform-fill@1` of run intent-luna-dpipe-short-r1r3-20261001-102501-7eda30,
 * its three user events (verbatim journal payloads) and the R3 correction that
 * supersedes the R2 sentence.  The edit removes exactly that sentence; nothing
 * in R1/R2/R3 is otherwise touched.
 */
interface FillFixture {
  run_id: string
  events: Array<{ event_id: string; sequence: number; text: string }>
  stored: {
    item_id: string
    revision: number
    interpretation: string
    text_digest: string
    sources: SourceRef[]
    about: unknown[]
    scope: Array<{ target_id: string; path?: string }>
    support: unknown[]
  }
  edit: { remove: SourceRef; add: SourceRef[]; basis: SourceRef; reason: string }
}

const fixture = JSON.parse(readFileSync(join(resolve("test/fixtures/fill-edit"), "sources.json"), "utf8")) as FillFixture
const rawEvents: CompilerEvent[] = fixture.events.map((event) => ({
  schema_version: 2, run_id: fixture.run_id, event_id: event.event_id, kind: "user_input",
  source: { channel: "user", producer_id: "user" }, payload: { text: event.text },
}))
const textOf = new Map(fixture.events.map((event) => [event.event_id, event.text]))
const removedText = textOf.get(fixture.edit.remove.source_id)!.slice(fixture.edit.remove.span!.start, fixture.edit.remove.span!.end)

/** What the documented materialization rule produces for a source list: event order, spans ascending, "\n\n" joins. */
function materialize(sources: readonly SourceRef[]): string {
  return rawEvents.flatMap(event => {
    const spans = sources.filter(source => source.source_id === event.event_id)
      .map(source => source.span!).sort((a, b) => a.start - b.start)
    return spans.length === 0 ? [] : [spans.map(span => textOf.get(event.event_id)!.slice(span.start, span.end)).join("\n\n")]
  }).join("\n\n")
}

/** The stored sources minus the edited fragment, computed from the fixture, never hand-typed. */
function retainedSources(): SourceRef[] {
  const remove = fixture.edit.remove.span!
  return fixture.stored.sources.flatMap(source => {
    const span = source.span!
    if (source.source_id !== fixture.edit.remove.source_id || span.start > remove.start || span.end < remove.end) return [{ ...source }]
    return [
      { ...source, span: { unit: "utf16" as const, start: span.start, end: remove.start } },
      { ...source, span: { unit: "utf16" as const, start: remove.end, end: span.end } },
    ].filter(part => part.span.start < part.span.end)
  })
}

const storedText = materialize(fixture.stored.sources)
const editedSources = retainedSources()
const editedText = materialize(editedSources)

function storedItem(): ContentItem {
  return {
    item_id: fixture.stored.item_id,
    revision: fixture.stored.revision,
    text: storedText,
    interpretation: fixture.stored.interpretation,
    sources: fixture.stored.sources.map(source => ({ ...source, span: { ...source.span! } })),
    about: structuredClone(fixture.stored.about) as ContentItem["about"],
    scope: fixture.stored.scope.map(scope => ({ ...scope })),
    support: structuredClone(fixture.stored.support) as ContentItem["support"],
  }
}

function storedTask(): TaskIntent {
  return {
    task_id: "t-dpipe",
    revision: 1,
    goal: { text: "Build dpipe and apply the recorded corrections.", sources: [] },
    bindings: [], outputs: [], content: [storedItem()],
    current_scope: { text: "proceed", disposition: "proceed", sources: [] },
    unresolved: [],
  }
}

function editChange(): Extract<IrChange, { action: "edit" }> {
  return {
    action: "edit", target: "content", id: fixture.stored.item_id, expected_revision: fixture.stored.revision,
    remove: [{ ...fixture.edit.remove, span: { ...fixture.edit.remove.span! } }],
    add: fixture.edit.add.map(source => ({ ...source })),
    basis: [{ ...fixture.edit.basis, span: { ...fixture.edit.basis.span! } }],
    reason: fixture.edit.reason,
  }
}

function candidateWith(change: IrChange): Candidate {
  return {
    schema_version: 2,
    basis: { event_ids: [rawEvents[2]!.event_id, rawEvents[1]!.event_id], refs: [] },
    source_coverage: [],
    groups: [{
      local_ref: "g-fill", task_refs: ["t-dpipe"], depends_on: [], ir_changes: [change],
      compilation: { decision: "reuse", current: [], reason: "The fixture exercises IR sources only." },
      execution_decisions: [], assessments: [], coverage: [], checks: [], questions: [],
    }],
  }
}

/** Apply one change to the stored task, exactly as the strict flow does before materialization. */
function applyEdit(change: IrChange) {
  const applied = new IntentStateManager({ "t-dpipe": storedTask() }).apply([change], ["t-dpipe"])
  assert.equal(applied.ok, true, applied.errors.map(error => error.message).join("; "))
  const task = applied.tasks["t-dpipe"]!
  materializeSourceContent(task, [change], rawEvents)
  return { task, item: task.content[0]!, edits: applied.edits }
}

/**
 * The stored run the fixture was extracted from: R1/R2/R3 are already in the
 * journal and already compiled into the stored IR, so they are history for the
 * batch under test, not pending input.
 */
function seededStore(): IntentStoreV2 {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "local-edit-")), runId: fixture.run_id })
  for (const event of rawEvents) store.acceptEvent(event)
  store.applyDeltas({ pending_event_ids: [], unresolved_user_event_ids: [], ir: { "t-dpipe": storedTask() } as never })
  return store
}

test("the fixture reproduces the stored item's own materialization", () => {
  assert.equal(fixture.stored.sources.length, 4)
  for (const source of fixture.stored.sources) {
    assert.equal(source.digest, digestText(textOf.get(source.source_id)!), `fixture event text matches the stored digest of ${source.source_id.slice(-12)}`)
  }
  assert.equal(digestText(storedText), fixture.stored.text_digest, "the fixture's sources and texts reproduce the stored materialisation")
  assert.match(removedText, /^4\. If either anchor is \*\*missing\*\*/u)
})

test("a local edit removes exactly the named fragment and keeps the rest of the item", () => {
  const { item } = applyEdit(editChange())
  assert.equal(item.revision, fixture.stored.revision + 1)
  assert.deepEqual(item.sources, editedSources)
  assert.equal(item.text, editedText)
  assert.equal(item.interpretation, fixture.stored.interpretation, "an edit keeps the item's stored label")
  assert.equal(item.text.includes(removedText), false, "the superseded sentence is gone from the materialized text")
  assert.ok(item.text.includes("### Fill linear: boundary extrapolation"), "the R3 correction is part of the same item")
  assert.ok(item.text.includes("5. Non-empty"), "the later steps of the corrected list are retained")
  assert.ok(editedText.length > 0 && editedText.length !== storedText.length)
})

test("manual offline R3 quote selection locates the old zscore rule and preserves parsing/minmax", async () => {
  // Artificial edit and baseline, not the original candidate or a repaired run.
  // Quote and offsets come from the sealed 2026-10-02-source-selection archive:
  // call-13-sent-request.txt, e57/s51 and e114/s7-s11. This existing fixture has
  // the same complete event texts (digests below), with different run/event ids.
  const oldDigest = "sha256:bd34172186843b4cdfcda32263fc92c614fabf2ca32e463a5d844de890e8c922"
  const newDigest = "sha256:675912d5cbc3a79ec20527236147fa2727c43d290b46b5b8272503c0164ed474"
  const oldEvent = rawEvents.find(event => digestText(textOf.get(event.event_id)!) === oldDigest)!
  const newEvent = rawEvents.find(event => digestText(textOf.get(event.event_id)!) === newDigest)!
  assert.ok(oldEvent && newEvent, "reuse only texts identical to the archived full user events")
  const oldText = textOf.get(oldEvent.event_id)!, newText = textOf.get(newEvent.event_id)!
  const quote = "- For `zscore`: compute `mean` and population `stddev` (`sqrt(sum((xi - mean)^2) / n)`)."
  const oldSource: SourceRef = { source_id: oldEvent.event_id, digest: oldDigest, span: { unit: "utf16", start: 10080, end: 10366 } }
  const update: SourceRef = { source_id: newEvent.event_id, digest: newDigest, quote: newText.slice(895, 1475) }
  const item: ContentItem = {
    item_id: "r-normalize-offline", revision: 0, interpretation: "Manual addressing fixture",
    text: oldText.slice(10080, 10366), text_origin: "source", sources: [oldSource],
    about: [], scope: [{ target_id: "t-dpipe" }], support: [],
  }
  const previous = { "t-dpipe": { ...storedTask(), content: [item] } }
  const batch = candidateWith({
    action: "edit", target: "content", id: item.item_id, expected_revision: 0,
    remove: [{ source_id: oldEvent.event_id, digest: oldDigest, quote }],
    add: [update], basis: [update], reason: "Manual offline selection of the recorded sample-deviation update.",
  })
  batch.basis.event_ids = [newEvent.event_id]
  const validate = new Ajv({ strict: false, allowUnionTypes: true }).compile(buildGenerationSchema("ir", "openai"))
  // Fixed in-memory answer: exercise strict shape and the production parser,
  // without contacting a provider or claiming that a model chose this text.
  const model = createCompilerModelV2(async input => {
    const reply = stageCandidate(input, batch)
    assert.equal(validate(reply), true, JSON.stringify(validate.errors))
    return JSON.stringify(reply)
  })
  const parsed = await model.propose({
    run_id: fixture.run_id, generation_stage: "ir", events: [newEvent], source_events: [oldEvent],
    ir: previous, compiled: {}, atom_refs: {}, executions: [],
    budget: { requests_used: 0, max_requests: 1 }, contract: V2_COMPILER_CONTRACT,
  })
  assert.equal(parsed.ok, true, parsed.error?.message)
  batch.groups[0]!.ir_changes = parsed.ir_proposal!.groups[0]!.ir_changes
  // The answer names the item by id; the strict flow fills the revision it expects.
  bindExpectedRevisions(batch.groups[0]!, previous)
  const change = batch.groups[0]!.ir_changes[0]!
  if (change.action !== "edit") throw new Error("fixture")
  assert.equal(resolveSourceRefs(batch, [oldEvent, newEvent]).unresolved, 0)
  assert.deepEqual(change.remove[0], { source_id: oldEvent.event_id, digest: oldDigest, span: { unit: "utf16", start: 10235, end: 10323 } })
  const resolvedUpdate = { source_id: newEvent.event_id, digest: newDigest, span: { unit: "utf16", start: 895, end: 1475 } }
  assert.deepEqual(change.add, [resolvedUpdate])
  assert.deepEqual(change.basis, [resolvedUpdate])

  const applied = new IntentStateManager(previous).apply([change], ["t-dpipe"])
  assert.equal(applied.ok, true, applied.errors.map(error => error.message).join("; "))
  materializeSourceContent(applied.tasks["t-dpipe"]!, [change], [oldEvent, newEvent])
  const actual = applied.tasks["t-dpipe"]!.content[0]!
  assert.equal(actual.text, [oldText.slice(10080, 10235), oldText.slice(10323, 10366), newText.slice(895, 1475)].join("\n\n"))
  assert.ok(actual.text.includes("`strconv.ParseFloat` with bit size 64"))
  assert.ok(actual.text.includes("- For `minmax`: compute `min` and `max`."))
  assert.equal(actual.text.includes(quote), false)
  assert.ok(actual.text.includes("sqrt(sum((xi - mean)^2) / (n - 1))"))
  assert.deepEqual(batch.source_coverage, [], "the artificial response did not duplicate the edit's removal")
  recordEditedRemovals(batch, applied.tasks, applied.edits)
  recordEditedRemovals(batch, applied.tasks, applied.edits)
  assert.deepEqual(batch.source_coverage, [{
    source: change.remove[0], disposition: "superseded", requirements: [],
    reason: change.reason, basis: [resolvedUpdate],
  }], "preparation records the removal once, using the edit's resolved basis")
  assert.doesNotThrow(() => validateSourceCoverage(batch, [newEvent], [oldEvent, newEvent], previous, applied.tasks))
})

test("a pure addition preserves old behavior and adds source text without a withdrawal (synthetic fixture)", () => {
  // Interface verification, not a replay or repair of the real pipeline candidate.
  const oldText = "Execute pipeline steps sequentially. Stop on failure and retain the success and failure messages."
  const newText = "Support a lineage pipeline step."
  const events: CompilerEvent[] = [oldText, newText].map((text, index) => ({
    schema_version: 2, run_id: fixture.run_id, event_id: `append-${index}`, kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text },
  }))
  const oldSource: SourceRef = {
    source_id: events[0]!.event_id, digest: digestText(oldText),
    span: { unit: "utf16", start: 0, end: oldText.length },
  }
  const before: TaskIntent = { ...storedTask(), content: [{
    ...storedItem(), item_id: "r-pipeline", revision: 0, text: oldText, sources: [oldSource],
  }] }
  const addition: SourceRef = { source_id: events[1]!.event_id, digest: digestText(newText), segment_id: "s1" }
  const change: Extract<IrChange, { action: "edit" }> = {
    action: "edit", target: "content", id: "r-pipeline", expected_revision: 0,
    remove: [], add: [addition], basis: [addition], reason: "Add lineage while retaining the existing pipeline behavior.",
  }
  const candidate = candidateWith(change)
  candidate.basis.event_ids = [events[1]!.event_id]
  assert.equal(resolveSourceRefs(candidate, events).unresolved, 0)
  const applied = new IntentStateManager({ "t-dpipe": before }).apply(candidate.groups[0]!.ir_changes, ["t-dpipe"])
  assert.equal(applied.ok, true, applied.errors.map(error => error.message).join("; "))
  materializeSourceContent(applied.tasks["t-dpipe"]!, candidate.groups[0]!.ir_changes, events)
  const item = applied.tasks["t-dpipe"]!.content[0]!
  assert.equal(item.revision, 1)
  assert.deepEqual(item.sources, [oldSource, {
    source_id: events[1]!.event_id, digest: digestText(newText),
    span: { unit: "utf16", start: 0, end: newText.length },
  }])
  assert.equal(item.text, `${oldText}\n\n${newText}`)
  recordEditedRemovals(candidate, applied.tasks, applied.edits)
  assert.deepEqual(candidate.source_coverage, [])
  assert.doesNotThrow(() => validateSourceCoverage(candidate, [events[1]!], events, { "t-dpipe": before }, applied.tasks))
  assert.deepEqual(candidate.source_coverage, [], "source validation also leaves no withdrawal or default record")
})

test("the edit's removal produces one disposal record, and the same batch stays valid without a second copy", () => {
  const candidate = candidateWith(editChange())
  const applied = new IntentStateManager({ "t-dpipe": storedTask() }).apply(candidate.groups[0]!.ir_changes, ["t-dpipe"])
  assert.equal(applied.ok, true)
  materializeSourceContent(applied.tasks["t-dpipe"]!, candidate.groups[0]!.ir_changes, rawEvents)

  const bare = structuredClone(candidate)
  assert.throws(() => validateSourceCoverage(bare, [], rawEvents, { "t-dpipe": storedTask() }, applied.tasks),
    /dropped without an explicit superseded disposition/u, "without the generated record the drop is incomplete")

  recordEditedRemovals(candidate, applied.tasks, applied.edits)
  recordEditedRemovals(candidate, applied.tasks, applied.edits)
  assert.equal(candidate.source_coverage!.length, 1, "the operation writes its record once")
  const entry = candidate.source_coverage![0]!
  assert.equal(entry.disposition, "superseded")
  assert.deepEqual(entry.source, fixture.edit.remove)
  assert.deepEqual(entry.basis, [fixture.edit.basis])
  assert.equal(entry.reason, fixture.edit.reason)
  assert.equal(entry.requirements.length, 0)
  assert.doesNotThrow(() => validateSourceCoverage(candidate, [], rawEvents, { "t-dpipe": storedTask() }, applied.tasks))
})

test("the same edit applied twice produces the same item and digest", () => {
  const first = applyEdit(editChange())
  const second = applyEdit(editChange())
  assert.deepEqual(first.item, second.item)
  assert.equal(digestOf(first.item), digestOf(second.item))
})

test("edit refusals name the failing part of the operation", () => {
  const run = (patch: Partial<Record<string, unknown>>) =>
    new IntentStateManager({ "t-dpipe": storedTask() }).apply([{ ...editChange(), ...patch } as IrChange], ["t-dpipe"])
  assert.match(run({ id: "r-unknown" }).errors[0]!.message, /unknown content r-unknown/u)
  assert.match(run({ expected_revision: 0 }).errors[0]!.message, /expected_revision 0 does not match current 1/u)
  assert.match(run({ remove: [], add: [] }).errors[0]!.message, /at least one remove or add selector/u)
  assert.match(run({ basis: [] }).errors[0]!.message, /at least one source as the change's basis/u)
  const plainRef = { id: "a1", revision: 0, digest: "sha256:x" }
  assert.match(run({ basis: [plainRef] }).errors[0]!.message,
    /edit basis\[0\] must be a SourceRef/u, "a plain Ref is not a removal basis")
  const mixed = run({ basis: [fixture.edit.basis, plainRef] })
  assert.equal(mixed.ok, false, "one illegal member rejects the whole edit")
  assert.deepEqual(mixed.edits, [])
  assert.equal(mixed.tasks["t-dpipe"]!.content[0]!.revision, fixture.stored.revision, "the refusal leaves the item untouched")
  assert.match(mixed.errors[0]!.message, /edit basis\[1\] must be a SourceRef/u)
  assert.match(run({ add: [fixture.edit.basis, plainRef] }).errors[0]!.message, /edit add\[1\] must be a SourceRef/u)
  assert.match(run({ remove: [fixture.edit.remove, plainRef] }).errors[0]!.message, /edit remove\[1\] must be a SourceRef/u)
  assert.match(run({ reason: "  " }).errors[0]!.message, /reason explaining the source change/u)
  assert.match(run({ remove: [{ ...fixture.edit.remove, span: { unit: "utf16", start: 100, end: 200 } }] }).errors[0]!.message,
    /outside the item's current sources/u)
  assert.match(run({ remove: [{ ...fixture.edit.remove, digest: digestText("some other text") }] }).errors[0]!.message,
    /digest does not match the current source/u)
  assert.match(run({ remove: [{ ...fixture.edit.remove, source_id: rawEvents[0]!.event_id, span: { unit: "utf16", start: 0, end: 10 } }] }).errors[0]!.message,
    /outside the item's current sources/u)
})

test("the existing revise replacement keeps its whole-list meaning", () => {
  const change: IrChange = {
    action: "revise", target: "content", id: fixture.stored.item_id, expected_revision: fixture.stored.revision,
    value: { text: "Corrected fill rule", about: [], scope: [{ target_id: "t-dpipe" }], support: [] },
    sources: [fixture.edit.basis],
  }
  const { item } = applyEdit(change)
  assert.equal(item.revision, fixture.stored.revision + 1)
  assert.deepEqual(item.sources, [fixture.edit.basis])
  assert.equal(item.text, materialize([fixture.edit.basis]))
  assert.equal(item.interpretation, "Corrected fill rule")
})

test("a removal and basis addressed by segment ids resolve before the edit runs", () => {
  const text = "Rule one.\n\nOld sentence.\n\nRule two."
  const event: CompilerEvent = {
    schema_version: 2, run_id: fixture.run_id, event_id: "e-segments", kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text },
  }
  const full: SourceRef = { source_id: "e-segments", digest: digestText(text), span: { unit: "utf16", start: 0, end: text.length } }
  const item: ContentItem = {
    item_id: "r", revision: 0, text, sources: [{ ...full }], about: [], scope: [{ target_id: "t" }], support: [],
  }
  const change: IrChange = {
    action: "edit", target: "content", id: "r", expected_revision: 0,
    remove: [{ source_id: "e-segments", digest: digestText(text), segment_id: "s2" }],
    add: [],
    basis: [{ source_id: "e-segments", digest: digestText(text), segment_id: "s1" }],
    reason: "s2 was withdrawn in favour of s1",
  }
  const candidate = candidateWith(change)
  candidate.groups[0]!.task_refs = ["t"]
  assert.equal(resolveSourceRefs(candidate, [event]).unresolved, 0, "the segment ids resolve to spans before apply")
  const segments = sourceSegments([event])
  assert.deepEqual(segments.map(segment => segment.segment_id), ["s1", "s2", "s3"])
  const [first, , third] = segments
  const applied = new IntentStateManager({ t: { task_id: "t", revision: 0, goal: { text: "g", sources: [] }, bindings: [], outputs: [], content: [item], current_scope: { text: "p", disposition: "proceed", sources: [] }, unresolved: [] } })
    .apply(candidate.groups[0]!.ir_changes, ["t"])
  assert.equal(applied.ok, true, applied.errors.map(error => error.message).join("; "))
  const task = applied.tasks.t!
  materializeSourceContent(task, candidate.groups[0]!.ir_changes, [event])
  assert.equal(task.content[0]!.text, [first!, third!].map(segment => text.slice(segment.span.start, segment.span.end)).join("\n\n"))
  assert.equal(task.content[0]!.text.includes("Old sentence."), false)
  assert.deepEqual(task.content[0]!.sources.map(source => [source.span!.start, source.span!.end]),
    [first!, third!].map(segment => [segment.span.start, segment.span.end]))
})

test("an item that keeps two intervals of one event can still be edited", () => {
  const first = rawEvents[0]!
  const second = { start: 15631, end: 15700 }
  const firstText = textOf.get(first.event_id)!
  const change = editChange()
  change.remove = [{ source_id: first.event_id, digest: digestText(firstText), span: { unit: "utf16", ...second } }]
  const { item } = applyEdit(change)
  assert.equal(item.revision, fixture.stored.revision + 1)
  assert.deepEqual(item.sources.map(source => [source.source_id.slice(-12), source.span!.start, source.span!.end]), [
    ["tkTko5nFueZm", 2680, 2782],
    ["tkTko5nFueZm", second.end, 16714],
    ["b0rTd0WuRGQV", 115, 895],
    ["GYgN9AjNwyAE", 10918, 12038],
  ], "the interval that held the removal is split; the other interval of the same event is untouched")
  assert.equal(item.text.includes(firstText.slice(second.start, second.end)), false)
  // The first interval of the same event is also editable.
  const other = editChange()
  other.remove = [{ source_id: first.event_id, digest: digestText(firstText), span: { unit: "utf16", start: 2700, end: 2750 } }]
  const applied = applyEdit(other)
  assert.deepEqual(applied.item.sources[0]!.span, { unit: "utf16", start: 2680, end: 2700 })
  assert.deepEqual(applied.item.sources[1]!.span, { unit: "utf16", start: 2750, end: 2782 })
  assert.deepEqual(applied.item.sources[2]!.span, { unit: "utf16", start: 15631, end: 16714 })
})

test("a second edit runs against the intervals the first edit produced", () => {
  const firstEvent = rawEvents[0]!
  const firstText = textOf.get(firstEvent.event_id)!
  const digest = digestText(firstText)
  const split = editChange()
  split.remove = [{ source_id: firstEvent.event_id, digest, span: { unit: "utf16", start: 2700, end: 2750 } }]
  const first = applyEdit(split)
  assert.deepEqual(first.item.sources.map(source => [source.source_id.slice(-12), source.span!.start, source.span!.end]), [
    ["tkTko5nFueZm", 2680, 2700],
    ["tkTko5nFueZm", 2750, 2782],
    ["tkTko5nFueZm", 15631, 16714],
    ["b0rTd0WuRGQV", 115, 895],
    ["GYgN9AjNwyAE", 10918, 12038],
  ], "the first edit splits the stored interval into two pieces")

  const again = editChange()
  again.expected_revision = first.item.revision
  again.remove = [{ source_id: firstEvent.event_id, digest, span: { unit: "utf16", start: 2690, end: 2695 } }]
  const applied = new IntentStateManager({ "t-dpipe": first.task }).apply([again], ["t-dpipe"])
  assert.equal(applied.ok, true, applied.errors.map(error => error.message).join("; "))
  const task = applied.tasks["t-dpipe"]!
  materializeSourceContent(task, [again], rawEvents)
  assert.deepEqual(task.content[0]!.sources.map(source => [source.source_id.slice(-12), source.span!.start, source.span!.end]), [
    ["tkTko5nFueZm", 2680, 2690],
    ["tkTko5nFueZm", 2695, 2700],
    ["tkTko5nFueZm", 2750, 2782],
    ["tkTko5nFueZm", 15631, 16714],
    ["b0rTd0WuRGQV", 115, 895],
    ["GYgN9AjNwyAE", 10918, 12038],
  ], "the second cut lands inside a piece the first edit created")
  assert.equal(task.content[0]!.revision, first.item.revision + 1)
  const expected = [
    firstText.slice(2680, 2690), firstText.slice(2695, 2700), firstText.slice(2750, 2782), firstText.slice(15631, 16714),
    textOf.get(rawEvents[1]!.event_id)!.slice(115, 895),
    textOf.get(rawEvents[2]!.event_id)!.slice(10918, 12038),
  ].join("\n\n")
  assert.equal(task.content[0]!.text, expected, "the second edit's text is exactly the kept slices, with the new 5-character cut gone")
})

test("a partly re-selected removal is recorded only where nothing selects it any more", () => {
  const text = "Rule one. Rule two. Rule three."
  const event: CompilerEvent = {
    schema_version: 2, run_id: fixture.run_id, event_id: "e-partial", kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text },
  }
  const whole: SourceRef = { source_id: "e-partial", digest: digestText(text), span: { unit: "utf16", start: 0, end: text.length } }
  const kept: SourceRef = { source_id: "e-partial", digest: digestText(text), span: { unit: "utf16", start: 10, end: 19 } }
  const outer: ContentItem = { item_id: "r-outer", revision: 0, text, sources: [{ ...whole }], about: [], scope: [{ target_id: "t" }], support: [] }
  const inner: ContentItem = { item_id: "r-inner", revision: 0, text: text.slice(10, 19), sources: [{ ...kept }], about: [], scope: [{ target_id: "t" }], support: [] }
  const task = (content: ContentItem[]): TaskIntent => ({
    task_id: "t", revision: 0, goal: { text: "g", sources: [] }, bindings: [], outputs: [], content,
    current_scope: { text: "p", disposition: "proceed", sources: [] }, unresolved: [],
  })
  const change: IrChange = {
    action: "edit", target: "content", id: "r-outer", expected_revision: 0,
    remove: [{ source_id: "e-partial", digest: digestText(text), span: { unit: "utf16", start: 5, end: 25 } }],
    add: [],
    basis: [{ source_id: "e-partial", digest: digestText(text), span: { unit: "utf16", start: 0, end: 5 } }],
    reason: "the middle rule moved to its own item",
  }
  const before = task([{ ...outer, sources: [{ ...whole }] }, { ...inner, sources: [{ ...kept }] }])
  const applied = new IntentStateManager({ t: before }).apply([change], ["t"])
  assert.equal(applied.ok, true, applied.errors.map(error => error.message).join("; "))
  const current = applied.tasks.t!
  materializeSourceContent(current, [change], [event])
  const candidate = candidateWith(change)
  candidate.groups[0]!.task_refs = ["t"]
  recordEditedRemovals(candidate, applied.tasks, applied.edits)
  assert.deepEqual(candidate.source_coverage!.map(entry => [entry.disposition, entry.source.span!.start, entry.source.span!.end]), [
    ["superseded", 5, 10],
    ["superseded", 19, 25],
  ], "only the parts no current selection covers become withdrawal records")
  assert.doesNotThrow(() => validateSourceCoverage(candidate, [], [event], { t: before }, applied.tasks))

  // A single record over the whole removed range would collide with the text
  // the inner item still adopts, and the batch is rejected for it.
  const overlapping = candidateWith(change)
  overlapping.groups[0]!.task_refs = ["t"]
  overlapping.source_coverage = [{
    source: { source_id: "e-partial", digest: digestText(text), span: { unit: "utf16", start: 5, end: 25 } },
    disposition: "superseded", requirements: [], reason: change.reason, basis: change.basis,
  }]
  assert.throws(() => validateSourceCoverage(overlapping, [], [event], { t: before }, applied.tasks),
    /classifies actively adopted text/u)
})

test("a removal spanning two overlapping intervals of one event deletes every covered part", () => {
  // Each index is unique in the text, so "is the removed slice still present?"
  // is a real question rather than a periodic-substring accident.
  const text = Array.from({ length: 200 }, (_, index) => `[${index}]`).join("")
  const event: CompilerEvent = {
    schema_version: 2, run_id: fixture.run_id, event_id: "e-overlap", kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text },
  }
  const digest = digestText(text)
  const item: ContentItem = {
    item_id: "r-overlap", revision: 0, text,
    sources: [
      { source_id: "e-overlap", digest, span: { unit: "utf16", start: 0, end: 100 } },
      { source_id: "e-overlap", digest, span: { unit: "utf16", start: 50, end: 150 } },
    ],
    about: [], scope: [{ target_id: "t" }], support: [],
  }
  const change: IrChange = {
    action: "edit", target: "content", id: "r-overlap", expected_revision: 0,
    remove: [{ source_id: "e-overlap", digest, span: { unit: "utf16", start: 60, end: 120 } }],
    add: [],
    basis: [{ source_id: "e-overlap", digest, span: { unit: "utf16", start: 0, end: 10 } }],
    reason: "the declared cut covers text in both stored intervals",
  }
  const before: TaskIntent = {
    task_id: "t", revision: 0, goal: { text: "g", sources: [] }, bindings: [], outputs: [], content: [item],
    current_scope: { text: "p", disposition: "proceed", sources: [] }, unresolved: [],
  }
  const applied = new IntentStateManager({ t: before }).apply([change], ["t"])
  assert.equal(applied.ok, true, applied.errors.map(error => error.message).join("; "))
  assert.deepEqual(applied.tasks.t!.content[0]!.sources.map(source => [source.span!.start, source.span!.end]),
    [[0, 60], [50, 60], [120, 150]],
    "the subtraction itself keeps every surviving piece, including the [50,60) overlap that both intervals still hold")
  const task = applied.tasks.t!
  materializeSourceContent(task, [change], [event])
  const out = task.content[0]!
  assert.deepEqual(out.sources.map(source => [source.span!.start, source.span!.end]), [[0, 60], [120, 150]],
    "the shared materializer then merges the overlapping kept pieces of one event (pre-existing rule), as it does for create/revise")
  assert.equal(out.text.includes(text.slice(60, 120)), false, "no part of the declared removal survives in any interval")
  assert.equal(out.text, `${text.slice(0, 60)}\n\n${text.slice(120, 150)}`)
  const candidate = candidateWith(change)
  candidate.groups[0]!.task_refs = ["t"]
  recordEditedRemovals(candidate, applied.tasks, applied.edits)
  assert.deepEqual(candidate.source_coverage!.map(entry => [entry.disposition, entry.source.span!.start, entry.source.span!.end]),
    [["superseded", 60, 120]], "the declared removal is recorded once, at its full span")
  assert.doesNotThrow(() => validateSourceCoverage(candidate, [], [event], { t: before }, applied.tasks))
})

test("a removal that would include text between intervals the item never selected is refused", () => {
  const text = Array.from({ length: 200 }, (_, index) => `[${index}]`).join("")
  const event: CompilerEvent = {
    schema_version: 2, run_id: fixture.run_id, event_id: "e-gap", kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text },
  }
  const digest = digestText(text)
  const item: ContentItem = {
    item_id: "r-gap", revision: 0, text,
    sources: [
      { source_id: "e-gap", digest, span: { unit: "utf16", start: 0, end: 50 } },
      { source_id: "e-gap", digest, span: { unit: "utf16", start: 100, end: 150 } },
    ],
    about: [], scope: [{ target_id: "t" }], support: [],
  }
  const change: IrChange = {
    action: "edit", target: "content", id: "r-gap", expected_revision: 0,
    remove: [{ source_id: "e-gap", digest, span: { unit: "utf16", start: 40, end: 110 } }],
    add: [], basis: [{ source_id: "e-gap", digest, span: { unit: "utf16", start: 0, end: 10 } }],
    reason: "the gap [50,100) was never part of this item",
  }
  const applied = new IntentStateManager({ t: {
    task_id: "t", revision: 0, goal: { text: "g", sources: [] }, bindings: [], outputs: [], content: [item],
    current_scope: { text: "p", disposition: "proceed", sources: [] }, unresolved: [],
  } }).apply([change], ["t"])
  assert.equal(applied.ok, false, "a cut that leaves the selected union is not a local edit")
  assert.equal(applied.tasks.t!.content[0]!.revision, 0, "the refusal leaves the item untouched")
  assert.match(applied.errors[0]!.message, /outside the item's current sources/u)
})

test("the legacy full-candidate flow refuses an edit before it can be half-applied", async () => {
  const store = seededStore()
  const trigger: CompilerEvent = {
    schema_version: 2, run_id: fixture.run_id, event_id: "e-fill-correction-legacy", kind: "user_input",
    source: { channel: "user", producer_id: "user" },
    payload: { text: "Apply the recorded fill boundary correction to the plan." },
  }
  const legacy = candidateWith(editChange())
  legacy.basis.event_ids = [trigger.event_id]
  const compiler = createIntentCompilerV2({
    store, requirement_integrity: "legacy",
    model: createCompilerModelV2(async () => JSON.stringify(legacy)),
  })
  await compiler.acceptEvent(trigger)
  const result = await compiler.advance({ runId: fixture.run_id })
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /ir_changes/u, "the legacy shape no longer admits the action")
  assert.equal(store.current().ir["t-dpipe"]!.content[0]!.revision, fixture.stored.revision, "the rejected batch leaves the stored IR unchanged")
})

test("a strict batch commits the edited text and the withdrawal record the operation generated", async () => {
  const store = seededStore()
  const trigger: CompilerEvent = {
    schema_version: 2, run_id: fixture.run_id, event_id: "e-fill-correction", kind: "user_input",
    source: { channel: "user", producer_id: "user" },
    payload: { text: "Apply the recorded fill boundary correction to the plan." },
  }
  const change = editChange()
  const source: SourceRef = { source_id: trigger.event_id, digest: digestText((trigger.payload as { text: string }).text), span: { unit: "utf16", start: 0, end: (trigger.payload as { text: string }).text.length } }
  const batch: Candidate = {
    schema_version: 2,
    basis: { event_ids: [trigger.event_id], refs: [] },
    source_coverage: [{ source, disposition: "management", requirements: [], reason: "the stored IR already carries the requirement text; this event only asks for the recorded correction", basis: [] }],
    groups: [{
      local_ref: "g-fill", task_refs: ["t-dpipe"], depends_on: [], ir_changes: [change],
      compilation: {
        decision: "replace",
        drafts: [{
          local_ref: "ci-fill", task_id: "t-dpipe", intent_basis: [], relations: [], attachments: [],
          atoms: [{
            atom_id: fixture.stored.item_id, revision: 0, goal_refs: [],
            task: "Re-implement the fill transform's boundary behavior in the authorized workspace and report the change.",
            inputs: [], outputs: [], constraints: [], optional_tools: [],
            authority: { basis: [fixture.edit.basis], rules: [], lifetime: "this_execution", delegation: "not_supported" },
            preconditions: [],
            completion: [{ text: "Single-anchor cells are filled from the nearest anchor and the corrected rule is the one implemented.", evidence_required: "The changed source and a focused fill-strategy check." }],
            return_when: ["Return the change and evidence, or the blocking missing input."], intent_judgments: [],
          }],
        }],
      },
      execution_decisions: [], assessments: [],
      coverage: [
        { requirement: { local_ref: "t-dpipe" }, disposition: "assigned", refs: [{ local_ref: fixture.stored.item_id }], explanation: "the fill correction belongs to this task" },
        { requirement: { local_ref: fixture.stored.item_id }, disposition: "assigned", refs: [{ local_ref: fixture.stored.item_id }], explanation: "the corrected fill rule is the assigned requirement" },
      ],
      checks: [], questions: [],
    }],
  }
  const checks: CompilerModelV2CheckInput[] = []
  const compiler = createIntentCompilerV2({ store, model: createCompilerModelV2(
    async (input, generation) => JSON.stringify(stageCandidate(input, batch, generation)),
    async input => { checks.push(structuredClone(input)); return JSON.stringify({ schema_version: 2, verdict: "consistent", findings: [] }) },
  ) })
  await compiler.acceptEvent(trigger)
  const result = await compiler.advance({ runId: fixture.run_id })
  assert.equal(result.ok, true, result.message)

  const committed = store.current().ir["t-dpipe"]!.content[0]!
  assert.equal(committed.revision, fixture.stored.revision + 1)
  assert.deepEqual(committed.sources, editedSources)
  assert.equal(committed.text, editedText)
  const recorded = store.current().management_log.at(-1)!.candidate!
  const superseded = recorded.source_coverage!.filter(record => record.disposition === "superseded")
  assert.equal(superseded.length, 1, "the committed run records exactly the one generated withdrawal")
  assert.deepEqual(superseded[0]!.source.span, fixture.edit.remove.span)
  assert.deepEqual(superseded[0]!.basis, [fixture.edit.basis])
  // The check sees the removed sentence and the text the removal relies on.
  assert.equal(checks.length, 1)
  assert.deepEqual(checks[0]!.prepared!.withdrawals, [{
    source: superseded[0]!.source,
    text: removedText,
    items: [fixture.stored.item_id],
    reason: fixture.edit.reason,
    basis: [{ source: fixture.edit.basis, text: textOf.get(fixture.edit.basis.source_id)!.slice(fixture.edit.basis.span!.start, fixture.edit.basis.span!.end) }],
  }])

  // The check sees this turn's passage the candidate states is not a requirement, with its reason.
  const triggerText = (trigger.payload as { text: string }).text
  assert.deepEqual(checks[0]!.prepared!.source_dispositions.not_requirements, [{
    source, disposition: "management", text: triggerText,
    reason: "the stored IR already carries the requirement text; this event only asks for the recorded correction",
  }])

  // The assembled block names each passage's user input by its journal position
  // and still carries the withdrawn sentence: the edit cut it out of the middle
  // of one passage, so the delivered passages are exactly the item's sources
  // before the edit, read input by input.
  const order = new Map(store.readEvents().filter(row => row.event.kind === "user_input").sort((a, b) => a.sequence - b.sequence).map((row, index) => [row.event.event_id, index + 1]))
  const assembled = store.current().compiled["t-dpipe"]!.atoms[0]!.task
  const block = assembled.slice(assembled.indexOf("[assigned requirement "))
  const merged: Array<{ source_id: string; start: number; end: number }> = []
  for (const ref of [...fixture.stored.sources].sort((a, b) => a.source_id.localeCompare(b.source_id) || a.span!.start - b.span!.start)) {
    const last = merged.at(-1)
    if (last?.source_id === ref.source_id && last.end >= ref.span!.start) last.end = Math.max(last.end, ref.span!.end)
    else merged.push({ source_id: ref.source_id, start: ref.span!.start, end: ref.span!.end })
  }
  const passages = merged.map(range => ({ input: order.get(range.source_id)!, start: range.start, text: textOf.get(range.source_id)!.slice(range.start, range.end) }))
    .sort((a, b) => a.input - b.input || a.start - b.start)
  const expected = passages.map(passage => `[user input ${passage.input}]\n${passage.text}`).join("\n\n")
  assert.equal(block, `[assigned requirement ${fixture.stored.item_id}@${committed.revision} ${digestOf(committed)}]\n${LATER_INPUT_GOVERNS}\n${expected}`)
  assert.ok(block.includes(removedText), "the withdrawn sentence is still delivered in its original passage")
  assert.equal(committed.text.includes(removedText), false, "the IR itself no longer carries the withdrawn sentence")
  const delivered = result.deliveries?.[0]?.atom
  if (delivered !== undefined) {
    assert.equal(delivered.task, assembled)
    assert.ok(delivered.task.includes("### Fill linear: boundary extrapolation"))
    assert.ok(delivered.task.includes("5. Non-empty"))
  }
})
