import { test } from "node:test"
import assert from "node:assert/strict"
import { atomRef } from "../src/core/compiled-intent.js"
import { canonicalJson, digestOf, digestText, type Atom, type AtomStateRecord, type CandidateGroup, type CompiledIntent, type CompilerEvent, type ContentItem, type SourceRef, type TaskIntent } from "../src/core/intent-contract.js"
import { changedPriorState, projectCompiled } from "../src/core/request-projection.js"
import { bindCurrentRequirements, LATER_INPUT_GOVERNS, selectedSourceHistory, userInputOrder } from "../src/core/requirement-flow.js"
import { locateQuote } from "../src/core/source-payload.js"

/**
 * Update behaviors organised by the dpipe update taxonomy
 * (experiments/evocode/harbor/dpipe/records/2026-10-02-prepared-r3-r15/UPDATE-TAXONOMY.md):
 * one case per category, built from the round positions and source fragments
 * that document quotes.  Each case checks the three behaviors this work
 * changed - locating a quote, keeping withdrawn source text in the delivered
 * task in input order, and projecting CI/check requests without losing what
 * they carry.  Open specification items (U4-U8) and difficult items (D1-D6)
 * are not asserted.
 */
interface TaxonomyCase {
  id: string
  category: string
  /** The earlier round and its fragment, when the update touches earlier text. */
  old?: { round: number; text: string }
  update: { round: number; text: string }
  /**
   * What the model did with the earlier text: kept it beside the update, cut
   * the voided fragment, or withdrew the whole sentence.
   */
  withdrawal: "none" | "fragment" | "whole" | "new_item"
  /** The fragment a fragment withdrawal cut, within the earlier text. */
  fragment?: string
  /** A quote for the update text carrying copying noise the model produced. */
  quote: string
}

const cases: TaxonomyCase[] = [
  { id: "2.2", category: "A", update: { round: 2, text: "Remove duplicate rows based on a set of key columns." }, withdrawal: "new_item",
    quote: "Remove duplicate rows based on a set of key columns. " },
  { id: "2.6", category: "B1", old: { round: 1, text: "`strategy`: one of `\"forward\"`, `\"backward\"`, `\"constant\"`" },
    update: { round: 2, text: "The existing `fill` transform now supports an additional strategy" }, withdrawal: "none",
    quote: "The existing fill transform now supports an additional strategy" },
  { id: "3.3", category: "B2", old: { round: 2, text: "Percentile calculation (for `median`, `p25`, `p75`)" },
    update: { round: 3, text: "now include two additional percentile fields" }, withdrawal: "none",
    quote: "now include  two additional\npercentile fields" },
  { id: "5.1", category: "C", old: { round: 1, text: "Reads `<path>`, computes SHA-256, compares against the hex string in `<checksum>`." },
    update: { round: 5, text: "It now uses **BLAKE2b-256** instead." }, withdrawal: "whole",
    quote: "It now uses **BLAKE2b-256** instead. " },
  { id: "3.1", category: "D", old: { round: 2, text: "If either anchor is missing …, the cell remains empty." },
    update: { round: 3, text: "Previously, cells with only one anchor remained empty. This is now corrected" }, withdrawal: "whole",
    quote: ". Previously, cells with only one anchor remained empty. This is now corrected" },
  { id: "5.4", category: "E", old: { round: 1, text: "After all transformations, write the result CSV to `<output>`, its SHA-256 to `<output>.sha256`." },
    update: { round: 5, text: "`transform` command: no longer writes `.sha256` sidecar files." }, withdrawal: "whole",
    quote: "transform command: no longer writes .sha256 sidecar files." },
  { id: "5.4 (fragment)", category: "E", old: { round: 1, text: "After all transformations, write the result CSV to `<output>`, its SHA-256 to `<output>.sha256`." },
    update: { round: 5, text: "`transform` command: no longer writes `.sha256` sidecar files." }, withdrawal: "fragment",
    fragment: ", its SHA-256 to `<output>.sha256`", quote: "`transform` command: no longer writes `.sha256` sidecar files. " },
  { id: "10.1", category: "F", old: { round: 1, text: "{\"path\": …, \"sha256\": \"abcdef...\", \"rows\": 42, \"size_bytes\": 1234}" },
    update: { round: 10, text: "The `blake2b` JSON field is replaced with two new fields" }, withdrawal: "fragment",
    fragment: "\"sha256\": \"abcdef...\", ", quote: "The blake2b JSON field is replaced with two new fields." },
  { id: "12.1", category: "G", old: { round: 2, text: "`method`: `\"zscore\"` or `\"minmax\"`" },
    update: { round: 12, text: "When the `method` field is omitted or empty, normalize should now behave exactly like `\"minmax\"`" }, withdrawal: "none",
    quote: "When the method field is omitted or empty, normalize should now behave exactly like \"minmax\"" },
  { id: "4.2", category: "H", old: { round: 1, text: "Malformed JSON config/schema/recipe" },
    update: { round: 4, text: "Invalid JSON schema: exit 1, `ERROR: invalid schema: <path>`." }, withdrawal: "none",
    quote: "Invalid JSON schema: exit 1, `ERROR: invalid schema: <path>`. " },
]

const BASE = "Build a deterministic data pipeline tool in Go called `dpipe`."
const userEvent = (round: number, text: string): CompilerEvent => ({ schema_version: 2, run_id: "taxonomy", event_id: `round-${round}`, kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text } })
const ref = (event: CompilerEvent, start: number, end: number): SourceRef => {
  const text = (event.payload as { text: string }).text
  return { source_id: event.event_id, digest: digestText(text), span: { unit: "utf16", start, end } }
}
const textOf = (event: CompilerEvent) => (event.payload as { text: string }).text
const item = (id: string, revision: number, sources: SourceRef[], events: CompilerEvent[]): ContentItem => ({
  item_id: id, revision, sources, about: [], scope: [{ target_id: "t1" }], support: [], text_origin: "source",
  text: sources.map(source => textOf(events.find(event => event.event_id === source.source_id)!).slice(source.span!.start, source.span!.end)).join("\n\n"),
})
const task = (revision: number, content: ContentItem[]): TaskIntent => ({
  task_id: "t1", revision, goal: { text: "dpipe", sources: [] }, bindings: [], outputs: [], content, unresolved: [],
  current_scope: { text: "proceed", disposition: "proceed", sources: [] },
})
const atom = (revision: number, task: string, goalRefs: Atom["goal_refs"] = []): Atom => ({
  atom_id: "a1", revision, goal_refs: goalRefs, task, inputs: [], outputs: [], constraints: [], optional_tools: [],
  authority: { basis: [], rules: [], lifetime: "this_execution", delegation: "not_supported" },
  preconditions: [], completion: [{ text: "dpipe builds", evidence_required: "build output" }], return_when: [], intent_judgments: [],
})
const plan = (atoms: Atom[]): CompiledIntent => ({ schema_version: 2, artifact_type: "compiled_intent", compiled_intent_id: "compiled-1", task_id: "t1", compiled_revision: 0, intent_basis: [], atoms, relations: [], attachments: [] })
const state = (revision: number, status: AtomStateRecord["status"]): AtomStateRecord => ({ task_id: "t1", atom_id: "a1", atom_revision: revision, compiled_intent_id: "compiled-1", status, updated_at: "2026-10-05T00:00:00.000Z" })

/** Put pointed requirement blocks back from the IRs a request supplies. */
function expand(text: string, irs: Record<string, TaskIntent>[]): string {
  return text.replace(/\(text identical to IR content (\S+)@(\d+) (\S+) supplied in this request\)/gu, (whole, id: string, revision: string, digest: string) => {
    for (const ir of irs) for (const entry of Object.values(ir)) for (const content of entry.content) {
      if (content.item_id === id && content.revision === Number(revision) && digestOf(content) === digest) return content.text
    }
    assert.fail(`pointer ${whole} has no supplied item`)
  })
}

for (const c of cases) {
  test(`taxonomy ${c.category} (${c.id}): the update locates, its earlier text stays in the delivered task in input order, and requests keep every fact`, () => {
    // Rounds 1..N; the base sentence is in round 1, and filler rounds keep each input's number equal to its round.
    const rounds = Math.max(c.update.round, c.old?.round ?? 1)
    const events = Array.from({ length: rounds }, (_, index) => {
      const round = index + 1
      const parts = [round === 1 ? BASE : `Round ${round} notes.`]
      if (c.old?.round === round) parts.push(c.old.text)
      if (c.update.round === round) parts.push(c.update.text)
      return userEvent(round, parts.join("\n\n"))
    })
    const records = events.map((event, index) => ({ sequence: index + 1, event }))
    const at = (round: number, fragment: string) => {
      const event = events[round - 1]!
      const start = textOf(event).indexOf(fragment)
      assert.ok(start >= 0, `${fragment} in round ${round}`)
      return ref(event, start, start + fragment.length)
    }

    // 1. The update's quote, copied with noise, locates exactly the update text.
    const updateEvent = events[c.update.round - 1]!
    const located = locateQuote(c.quote, textOf(updateEvent))
    assert.ok(located.match === "exact" || located.match === "simplified", `${c.id}: quote located`)
    if (located.match !== "exact" && located.match !== "simplified") return
    assert.equal(textOf(updateEvent).slice(located.start, located.end), c.update.text, `${c.id}: the stored text is the source slice`)

    // 2. Prior and current IR as the model left them.
    const base = item("r-base", 0, [at(1, BASE)], events)
    const oldRef = c.old ? at(c.old.round, c.old.text) : undefined
    const updateRef = at(c.update.round, c.update.text)
    const prior = task(0, c.withdrawal === "new_item" ? [base] : [base, item("r-target", 0, [oldRef!], events)])
    let targetSources: SourceRef[]
    if (c.withdrawal === "new_item" || c.withdrawal === "whole") targetSources = [updateRef]
    else if (c.withdrawal === "none") targetSources = [oldRef!, updateRef]
    else {
      const cut = c.old!.text.indexOf(c.fragment!)
      assert.ok(cut >= 0)
      const start = oldRef!.span!.start
      targetSources = [
        ...(cut > 0 ? [ref(events[c.old!.round - 1]!, start, start + cut)] : []),
        ...(cut + c.fragment!.length < c.old!.text.length ? [ref(events[c.old!.round - 1]!, start + cut + c.fragment!.length, oldRef!.span!.end)] : []),
        updateRef,
      ]
    }
    const current = task(1, [base, item("r-target", c.withdrawal === "new_item" ? 0 : 1, targetSources, events)])
    const group = {
      local_ref: "g1", task_refs: ["t1"], depends_on: [], ir_changes: [], execution_decisions: [], assessments: [], checks: [], questions: [],
      compilation: { decision: "replace", drafts: [{ local_ref: "ci1", task_id: "t1", intent_basis: [], relations: [], attachments: [], atoms: [atom(1, "Implement dpipe and return the change with evidence.")] }] },
      coverage: [
        { requirement: { local_ref: "r-base" }, disposition: "assigned", refs: [{ local_ref: "a1" }], explanation: "" },
        { requirement: { local_ref: "r-target" }, disposition: "assigned", refs: [{ local_ref: "a1" }], explanation: "" },
      ],
    } as unknown as CandidateGroup
    const assembly = { inputOrder: userInputOrder(records), texts: new Map(events.map(event => [event.event_id, textOf(event)])), selected: selectedSourceHistory([], { t1: prior }) }
    const beforeIr = structuredClone(current)
    const delivered = bindCurrentRequirements(group, current, prior, events, [], assembly)[0]!.atoms[0]!
    assert.deepEqual(current, beforeIr, `${c.id}: the IR text, sources and digest are unchanged`)

    const target = current.content[1]!
    const block = delivered.task.slice(delivered.task.indexOf(`[assigned requirement r-target@${target.revision} ${digestOf(target)}]`))
    const expectedPassages = c.old === undefined
      ? [{ round: c.update.round, text: c.update.text }]
      : [{ round: c.old.round, text: c.old.text }, { round: c.update.round, text: c.update.text }]
    const labelled = expectedPassages.map(passage => `[user input ${passage.round}]\n${passage.text}`).join("\n\n")
    assert.equal(block, `[assigned requirement r-target@${target.revision} ${digestOf(target)}]\n${expectedPassages.length > 1 ? `${LATER_INPUT_GOVERNS}\n` : ""}${labelled}`,
      `${c.id}: the earlier text is delivered whole and before the update`)
    assert.doesNotMatch(block, /withdr|supersed|retract|removed|deleted/iu, `${c.id}: no withdrawal mark`)
    const stripped = block.split("\n").slice(1).filter(line => line !== LATER_INPUT_GOVERNS && !/^\[user input \d+\]$/u.test(line)).join("\n")
    assert.equal(stripped, expectedPassages.map(passage => passage.text).join("\n\n"), `${c.id}: without labels, the passages in input order`)

    // 3. Requests: the prior plan carried an older Atom whose blocks repeat the prior IR verbatim.
    const priorBlocks = prior.content.map(entry => `[assigned requirement ${entry.item_id}@${entry.revision} ${digestOf(entry)}]\n${entry.text}`)
    const oldAtom = atom(0, ["Implement dpipe.", ...priorBlocks].join("\n\n"))
    const before = { t1: plan([oldAtom]) }
    const after = { t1: plan([oldAtom, delivered]) }
    const ciRequest = projectCompiled(before, [state(0, "ready")], [{ t1: current }])
    const ciAtom = ciRequest.t1!.atoms[0]!
    assert.equal(expand(ciAtom.task, [{ t1: current }]), oldAtom.task, `${c.id}: CI request loses nothing`)
    assert.ok(ciAtom.task.includes(`(text identical to IR content r-base@0 ${digestOf(base)} supplied in this request)`), `${c.id}: the unchanged item is pointed at`)

    const changed = changedPriorState({ t1: prior }, { t1: current }, before, after, [state(0, "ready")], [state(0, "legacy"), state(1, "ready")])
    const irs = [{ t1: current }, changed.ir]
    const shownPrior = projectCompiled(changed.compiled, [state(0, "ready")], irs)
    const shownPrepared = projectCompiled(after, [state(0, "legacy"), state(1, "ready")], irs)
    assert.deepEqual(shownPrepared.t1!.historical_atoms, [{ ...atomRef(oldAtom), status: "legacy" }], `${c.id}: the superseded version by identity`)
    assert.deepEqual(shownPrepared.t1!.atoms.map(entry => canonicalJson({ ...entry, task: expand(entry.task, irs) })), [canonicalJson(delivered)], `${c.id}: the current Atom complete`)
    assert.deepEqual(shownPrior.t1!.atoms.map(entry => expand(entry.task, irs)), [oldAtom.task], `${c.id}: the replaced Atom's prior state complete`)
    for (const entry of prior.content) {
      const shown = (changed.ir.t1?.content ?? []).some(other => digestOf(other) === digestOf(entry)) || current.content.some(other => digestOf(other) === digestOf(entry))
      assert.ok(shown, `${c.id}: prior item ${entry.item_id} is shown as prior or unchanged`)
    }
    assert.equal(canonicalJson(changed.ir).includes(BASE), false, `${c.id}: the unchanged item is shown once, in the prepared IR`)
  })
}
