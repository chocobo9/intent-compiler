import { LEDGER_FEEDBACK } from "./sdd-ledger.js"
import { canonicalJson, digestOf, digestText, type CompilerEvent, type ContentItem, type Ref, type SourceRef, type SourceSegment, type TaskIntent } from "./intent-contract.js"
import { changedPriorState } from "./request-projection.js"
import { SourceLedger, recordedDispositions, selectedSourceHistory, sourceSegments, userText } from "./source-payload.js"
import type { CIDelivery, DeliveryDraft, PrdCheckSummary, SddBatch, SddResult, SddRun, SddSnapshot } from "./sdd-contract.js"
import { planCarry, previousContract } from "./sdd-increment.js"

/**
 * What each SDD management request shows of the store.  The store keeps every
 * event, IR version, delivery and result in full; selection happens
 * only here, when a request is built, and every request is rebuilt the same way
 * from the same store.  Nothing is dropped by judging it unimportant:
 *
 *  - every recorded user input stays listed; a segment whose text a content
 *    item of an IR in the same request already carries verbatim points at that
 *    item instead of repeating it, and every other passage keeps its text;
 *  - an older CI is shown by identity and decisions; its text is the user
 *    inputs this request lists;
 *  - for each current requirement, the latest delivery record about it (and,
 *    when that one did not deliver it) and the runs of those deliveries;
 *  - SDD's own PRD check of the latest returned run, and of earlier runs that
 *    left GAPs open, with later code changes stated;
 *  - every reference the request carries must resolve inside it, or the
 *    referenced object is added from history; otherwise building fails.
 */
export const SDD_REQUEST_VIEW = "Request view, built by code; the store keeps every record in full. Each recorded user input is listed once, in input order, as its segments. A run of segments whose text is already carried verbatim by one IR content item in this request is listed as {from, to, text_in: {in, task_id, item_id, revision}} instead of repeating it: that item's text contains each of those segments, and their segment ids still address the original input. Every other segment (partly adopted, withdrawn, context, never placed, or from an input no batch accepted) keeps its full text. Where an IR content item's text equals the passages of a delivered requirement block, the item's text is that block's passages (labels removed) and is shown once, in the delivery. Earlier CI versions are given by identity and decisions; their attached passages are the IR content. A field that names an id is a reference to an object shown in this request, never a substitute for it."

export interface ContextReport {
  stage: "ir" | "ci" | "check"
  /** Characters of the request object as serialized, before the transport adds its contract and schema. */
  request_chars: number
  counts: Record<string, number>
  omitted: Array<{ kind: string; id: string; reason: string }>
  warnings: string[]
}

export interface TextPointer { in: "ir" | "previous_versions"; task_id: string; item_id: string; revision: number }
/** A segment with its text, or a run of consecutive segments one IR item carries verbatim. */
export type SegmentView =
  | { segment_id: string; span: { unit: "utf16"; start: number; end: number }; text: string }
  | { from: string; to: string; text_in: TextPointer }
export interface InputView {
  event_id: string
  /** 1-based position among the run's user inputs. */
  input: number
  digest: string
  state: "current" | "accepted" | "unprocessed"
  segments: SegmentView[]
}
export interface SourceView {
  inputs: InputView[]
  /** Passages of earlier inputs with no recorded destination (no adoption, withdrawal or explicit disposition). */
  unplaced: Array<{ source_id: string; segment_id: string; span: { unit: "utf16"; start: number; end: number } }>
  /** Inputs whose own batch was never accepted: their text is shown in full. */
  unprocessed_inputs: string[]
}

export interface IrChangeView {
  previous_ir_digest: string
  tasks: Array<{ task_id: string; from_revision?: number; to_revision?: number; scope_changed: boolean; added: string[]; revised: Array<{ item_id: string; from: number; to: number }>; retired: string[]; unchanged: number }>
  /** The pre-update versions of exactly the objects this update changed. */
  previous_versions: Record<string, TaskIntent>
}

export interface CoverageRecord { ci: string; input: number; item_revision?: number; same_version: boolean; disposition: string; explanation: string }
export interface DeliveryHistory {
  latest?: { ref: Ref; input: number; decision: DeliveryDraft["decision"]; reason: string; tasks: Array<Omit<DeliveryDraft["tasks"][number], "coverage">> }
  coverage: Array<{ task_id: string; item_id: string; revision: number; records: CoverageRecord[] }>
  runs: Array<{ run_id: string; ci: string; input: number; state: SddRun["state"]; baseline_digest: string; result?: SddResult }>
}
/** SDD's own PRD check of one returned run, bound to that run's CI. */
export interface FeedbackRun {
  run_id: string
  ci_ref: Ref
  input: number
  sdd_status: SddResult["sdd_status"]
  stages: Record<string, string>
  prd_check: PrdCheckSummary
  /** Whether the code the check examined is still the latest returned code. */
  code_state: "latest_returned_code" | "changed_by_later_runs" | "later_run_not_returned"
  later_runs: string[]
}
export interface FeedbackView { runs: FeedbackRun[] }

export interface IrRequestWire {
  [key: string]: unknown
  request_view: string
  source_events: CompilerEvent[]
  /** Segments that keep their text; their ids and spans address the input as before. */
  source_segments: SourceSegment[]
  /** The other segments, per input: runs whose text the named IR item carries verbatim. */
  adopted_segments: Array<{ source_id: string; runs: Array<{ from: string; to: string; text_in: TextPointer }> }>
  source_ledger: Pick<SourceView, "unplaced" | "unprocessed_inputs">
}

export interface DeliveryRequest {
  request_view: string
  ir: Record<string, TaskIntent>
  ir_change: IrChangeView
  sources: SourceView
  history: DeliveryHistory
  feedback: FeedbackView
  referenced_objects: ReferencedObject[]
  issues: string[]
  /** Content items this round writes contract entries for (added or revised, or whose entries code could not carry). */
  to_write: string[]
  /** What code carries unchanged from the accepted delivery, by name only. */
  carried: { fields: Array<{ object: string; fields: string[] }>; acceptance: string[]; effective: string[] }
  /** On a repair: the rejected CI answer, to revise where issues point and keep otherwise. */
  previous_draft?: DeliveryDraft
}
export interface CheckRequest extends Omit<DeliveryRequest, "previous_draft"> {
  delivery: Omit<CIDelivery, "text"> & { text: string }
  ir_update: { basis: unknown; groups: Array<{ local_ref: string; task_refs: string[]; ir_changes: unknown[] }>; source_coverage: Array<Record<string, unknown>> }
}
export interface ReferencedObject { input: number; task_id: string; kind: string; object: unknown; reason: string }

const delivered = (d: DeliveryDraft["tasks"][number]["coverage"][number]) => d.disposition === "assigned" || d.disposition === "supported"

class Report {
  readonly counts: Record<string, number> = {}
  readonly omitted: ContextReport["omitted"] = []
  readonly warnings: string[] = []
  constructor(readonly stage: ContextReport["stage"]) {}
  count(kind: string, n = 1) { this.counts[kind] = (this.counts[kind] ?? 0) + n }
  omit(kind: string, id: string, reason: string) { this.omitted.push({ kind, id, reason }) }
  done(request: unknown): ContextReport {
    return { stage: this.stage, request_chars: canonicalJson(request).length, counts: this.counts, omitted: this.omitted, warnings: this.warnings }
  }
}

/** Each user input's position and its batch state, read from the store's own order. */
function inputs(s: SddSnapshot): Array<{ event: CompilerEvent; input: number; batch?: SddBatch }> {
  return s.events.filter(e => e.kind === "user_input").map((event, i) => ({ event, input: i + 1, batch: s.batches.find(b => b.event_id === event.event_id) }))
}
function inputOf(s: SddSnapshot, eventId: string): number {
  const found = inputs(s).find(x => x.event.event_id === eventId)
  if (!found) throw Error(`Request names an event the store does not record: ${eventId}`)
  return found.input
}
function accepted(s: SddSnapshot, except?: string): SddBatch[] {
  return s.batches.filter(b => b.state === "accepted" && b.event_id !== except)
}

/** The source ledger of accepted state, plus the candidate being prepared. */
function ledgerOf(s: SddSnapshot, ir: Record<string, TaskIntent>, pending?: SddBatch): SourceLedger {
  const log = accepted(s).filter(b => b.parent).map(b => ({ status: "accepted", candidate: b.parent!.candidate }))
  if (pending?.parent) log.push({ status: "accepted", candidate: pending.parent.candidate })
  const texts = new Map(s.events.flatMap(e => { const t = userText(e); return t === undefined ? [] : [[e.event_id, t] as const] }))
  return new SourceLedger({ texts, selected: selectedSourceHistory(log, ir), dispositions: recordedDispositions(log) })
}

/**
 * Every recorded user input, segment by segment.  A segment is shown by pointer
 * only when one content item of a supplied IR selects a span covering it and
 * carries its text verbatim; anything else keeps its text.  The ledger names
 * passages of earlier inputs that have no destination, and inputs whose own
 * batch was never accepted are listed: both stay in full, and are reported.
 */
function sourceView(s: SddSnapshot, currentId: string, irs: ReadonlyArray<{ in: TextPointer["in"]; ir: Record<string, TaskIntent> }>, ledger: SourceLedger, ledgerIr: Record<string, TaskIntent>, report: Report): SourceView {
  const view: SourceView = { inputs: [], unplaced: [], unprocessed_inputs: [] }
  for (const { event, input, batch } of inputs(s)) {
    const text = userText(event)
    if (text === undefined) continue
    const digest = digestText(text)
    const state = event.event_id === currentId ? "current" : batch?.state === "accepted" ? "accepted" : "unprocessed"
    if (state === "unprocessed") {
      view.unprocessed_inputs.push(event.event_id)
      report.warnings.push(`user input ${input} (${event.event_id}) has no accepted batch; its full text is shown`)
    }
    const segments: SegmentView[] = []
    for (const segment of sourceSegments([event])) {
      const pointer = carrier(segment, event.event_id, digest, irs)
      const last = segments.at(-1)
      if (pointer === undefined) {
        report.count("segments_with_text")
        segments.push({ segment_id: segment.segment_id, span: segment.span, text: segment.text })
        continue
      }
      report.count("segments_pointed")
      report.count("segment_chars_pointed", segment.text.length)
      if (last && "text_in" in last && canonicalJson(last.text_in) === canonicalJson(pointer) && segmentNumber(last.to) + 1 === segmentNumber(segment.segment_id)) last.to = segment.segment_id
      else segments.push({ from: segment.segment_id, to: segment.segment_id, text_in: pointer })
    }
    if (state === "accepted") {
      const unplaced = ledger.unplaced(event.event_id, ledgerIr)
      for (const passage of unplaced) view.unplaced.push({ source_id: passage.source_id, segment_id: passage.segment_id, span: { unit: "utf16", start: passage.start, end: passage.end } })
      if (unplaced.length) report.warnings.push(`user input ${input} has ${unplaced.length} passage(s) with no recorded destination; their text is shown in full`)
    }
    view.inputs.push({ event_id: event.event_id, input, digest, state, segments })
  }
  return view
}

const segmentNumber = (id: string) => Number(id.slice(1))

/** The IR item that selects a span covering this segment and carries its text verbatim, if any. */
function carrier(segment: SourceSegment, eventId: string, digest: string, irs: ReadonlyArray<{ in: TextPointer["in"]; ir: Record<string, TaskIntent> }>): TextPointer | undefined {
  const lead = segment.text.length - segment.text.trimStart().length
  const body = segment.text.trim()
  const start = segment.span.start + lead, end = start + body.length
  for (const candidate of irs) for (const task of Object.values(candidate.ir)) {
    const item = task.content.find(item => item.text_origin === "source" && item.text.includes(body) &&
      item.sources.some(source => source.source_id === eventId && source.digest === digest && source.span !== undefined && source.span.start <= start && source.span.end >= end))
    if (item) return { in: candidate.in, task_id: task.task_id, item_id: item.item_id, revision: item.revision }
  }
  return undefined
}

/** The check is shown how the delivered text was built instead of a second copy of every input. */
const withoutReference = ({ reference_text: _r, ...rest }: CIDelivery) => rest
const DELIVERY_TEXT_REST = " from the second update the PRD SDD clarified for an earlier update (delivery.baseline_prd) in place of the inputs up to it, then every later user input verbatim and in input order, minus each passage in delivery.removed, with each effective statement of delivery.contract placed after the paragraph its requirement was changed in; the store keeps the exact text)"
export const DELIVERY_TEXT_VIEW = "(not repeated here: the delivered text is this update's change list (delivery.changes, then the open ledger entries fed back), the field dictionary and acceptance examples of delivery.contract (carried and newly written entries), the section code writes for the open ledger entries fed back (" + (LEDGER_FEEDBACK ? "all open entries of delivery.ledger" : "the open acceptance entries of delivery.ledger") + ": earlier requirements the starting code does not meet; code's, not to be judged), then" + DELIVERY_TEXT_REST

function changeView(previous: Record<string, TaskIntent>, prepared: Record<string, TaskIntent>): IrChangeView {
  const ids = [...new Set([...Object.keys(previous), ...Object.keys(prepared)])]
  return {
    previous_ir_digest: digestOf(previous),
    tasks: ids.flatMap(taskId => {
      const before = previous[taskId], after = prepared[taskId]
      if (before && after && digestOf(before) === digestOf(after)) return []
      const old = new Map((before?.content ?? []).map(item => [item.item_id, item]))
      const now = new Map((after?.content ?? []).map(item => [item.item_id, item]))
      return [{
        task_id: taskId,
        ...(before ? { from_revision: before.revision } : {}), ...(after ? { to_revision: after.revision } : {}),
        scope_changed: canonicalJson(before?.current_scope) !== canonicalJson(after?.current_scope),
        added: [...now.keys()].filter(id => !old.has(id)),
        revised: [...now.values()].filter(item => old.has(item.item_id) && digestOf(old.get(item.item_id)) !== digestOf(item)).map(item => ({ item_id: item.item_id, from: old.get(item.item_id)!.revision, to: item.revision })),
        retired: [...old.keys()].filter(id => !now.has(id)),
        unchanged: [...now.values()].filter(item => old.has(item.item_id) && digestOf(old.get(item.item_id)) === digestOf(item)).length,
      }]
    }),
    previous_versions: changedPriorState(previous, prepared, {}, {}, [], []).ir,
  }
}

/**
 * For each current requirement, its latest delivery record and, when that
 * record did not deliver it, the latest one that did; the runs of those
 * deliveries.  The latest delivery's decisions are kept whole, its body is not.
 */
function historyView(s: SddSnapshot, currentId: string, ir: Record<string, TaskIntent>, report: Report): DeliveryHistory {
  const deliveries = accepted(s, currentId).filter(b => b.delivery)
  const used = new Set<string>()
  const history: DeliveryHistory = { coverage: [], runs: [] }
  const latest = deliveries.at(-1)
  if (latest) {
    const d = latest.delivery!
    used.add(d.ref.id)
    history.latest = { ref: d.ref, input: inputOf(s, latest.event_id), decision: d.draft.decision, reason: d.draft.reason, tasks: d.draft.tasks.map(({ coverage: _coverage, ...rest }) => rest) }
  }
  for (const task of Object.values(ir)) for (const item of task.content) {
    const records: CoverageRecord[] = []
    for (const b of [...deliveries].reverse()) {
      const entry = b.delivery!.draft.tasks.find(t => t.task_id === task.task_id)?.coverage.find(c => c.item_id === item.item_id)
      if (!entry) continue
      const then = b.parent?.ir[task.task_id]?.content.find(x => x.item_id === item.item_id)
      records.push({ ci: b.delivery!.ref.id, input: inputOf(s, b.event_id), ...(then ? { item_revision: then.revision } : {}),
        same_version: then !== undefined && digestOf(then) === digestOf(item), disposition: entry.disposition, explanation: entry.explanation })
      used.add(b.delivery!.ref.id)
      if (delivered(entry)) break
    }
    if (records.length) history.coverage.push({ task_id: task.task_id, item_id: item.item_id, revision: item.revision, records })
    else report.count("requirements_never_in_a_delivery")
  }
  for (const b of deliveries) {
    const d = b.delivery!
    if (!used.has(d.ref.id)) { report.omit("delivery", d.ref.id, "no current requirement's latest delivery record is in it"); continue }
    report.omit("delivery_text", d.ref.id, "identity, decisions and per-requirement coverage kept; its text is the listed user inputs; its cuts stay in the store")
    // The latest run of this delivery; earlier voided attempts of it stay in the store.
    const run = [...s.runs].reverse().find(r => r.ci_ref.id === d.ref.id && !r.superseded)
    if (run) history.runs.push({ run_id: run.run_id, ci: d.ref.id, input: inputOf(s, b.event_id), state: run.state, baseline_digest: run.baseline.digest, ...(run.result ? { result: run.result } : {}) })
    else if (d.draft.decision === "deliver") report.warnings.push(`delivery ${d.ref.id} was approved but never claimed for a run`)
  }
  report.count("deliveries_referenced", used.size)
  return history
}

/**
 * SDD's PRD check of the latest returned run, and of each earlier run whose
 * check left GAPs open.  Later code changes are stated, never resolved: an
 * earlier check describes the code of its own run.
 */
function feedbackView(s: SddSnapshot, report: Report): FeedbackView {
  const view: FeedbackView = { runs: [] }
  // A superseded attempt's code was never continued; its check is not feedback.
  const runs = s.runs.filter(run => !run.superseded).map((run, index) => ({ run, index }))
  const returned = runs.filter(({ run }) => run.result)
  const latest = returned.at(-1)
  for (const { run, index } of returned) {
    const check = run.result!.prd_check
    if (!check) { report.warnings.push(`run ${run.run_id} returned without SDD's PRD check summary`); continue }
    if (run !== latest?.run && check.open_gaps.length === 0) { report.omit("prd_check", run.run_id, "earlier run whose check left no GAP open"); continue }
    const later = runs.filter(x => x.index > index)
    const changed = later.filter(x => x.run.result && x.run.result.source_digest !== run.result!.source_digest)
    const pending = later.filter(x => !x.run.result)
    view.runs.push({ run_id: run.run_id, ci_ref: run.ci_ref, input: inputOf(s, run.event_id), sdd_status: run.result!.sdd_status,
      stages: run.result!.stages, prd_check: check,
      code_state: changed.length ? "changed_by_later_runs" : pending.length ? "later_run_not_returned" : "latest_returned_code",
      later_runs: [...changed, ...pending].map(x => x.run.run_id) })
    report.count("feedback_open_gaps", check.open_gaps.length)
  }
  return view
}

type ObjectIndex = Map<string, Array<{ revision?: number; task_id: string }>>
function objectIndex(irs: ReadonlyArray<Record<string, TaskIntent>>): ObjectIndex {
  const index: ObjectIndex = new Map()
  const add = (id: string, task_id: string, revision?: number) => index.set(id, [...(index.get(id) ?? []), { task_id, ...(revision === undefined ? {} : { revision }) }])
  for (const ir of irs) for (const task of Object.values(ir)) {
    add(task.task_id, task.task_id, task.revision)
    for (const item of task.content) add(item.item_id, task.task_id, item.revision)
    for (const b of task.bindings) add(b.binding_id, task.task_id, b.revision)
    for (const o of task.outputs) add(o.output_id, task.task_id, o.revision)
    for (const u of task.unresolved) add(u.id, task.task_id)
  }
  return index
}

/** The version of `ref` an older batch's IR holds, newest first. */
function historicalObject(s: SddSnapshot, ref: Ref): { input: number; task_id: string; kind: string; object: unknown } | undefined {
  for (const b of [...s.batches].reverse()) {
    if (b.state !== "accepted" || !b.parent) continue
    for (const task of Object.values(b.parent.ir)) {
      const objects: Array<{ kind: string; id: string; revision: number; object: unknown }> = [
        { kind: "task", id: task.task_id, revision: task.revision, object: task },
        ...task.content.map(x => ({ kind: "content", id: x.item_id, revision: x.revision, object: x as ContentItem })),
        ...task.bindings.map(x => ({ kind: "binding", id: x.binding_id, revision: x.revision, object: x })),
        ...task.outputs.map(x => ({ kind: "output", id: x.output_id, revision: x.revision, object: x })),
      ]
      const match = objects.find(x => x.id === ref.id && (ref.revision === undefined || x.revision === ref.revision))
      if (match) return { input: inputOf(s, b.event_id), task_id: task.task_id, kind: match.kind, object: match.object }
    }
  }
  return undefined
}

/**
 * Every source, scope and object reference of the IR objects a request carries
 * must resolve inside the request.  A referenced object no supplied IR holds is
 * added from the newest batch that recorded that version; a reference nothing
 * recorded, or a source the request does not list, fails the build.
 */
function completeReferences(s: SddSnapshot, irs: ReadonlyArray<Record<string, TaskIntent>>, listed: ReadonlySet<string>, report: Report): ReferencedObject[] {
  const index = objectIndex(irs)
  const added: ReferencedObject[] = []
  const addedKeys = new Set<string>()
  const problems: string[] = []
  const known = (ref: Ref) => (index.get(ref.id) ?? []).some(x => x.revision === undefined || ref.revision === undefined || x.revision === ref.revision)
  for (const ir of irs) for (const task of Object.values(ir)) {
    const sources: SourceRef[] = [...task.goal.sources, ...task.current_scope.sources, ...task.bindings.flatMap(b => b.sources), ...task.outputs.flatMap(o => o.sources), ...task.content.flatMap(c => c.sources)]
    for (const source of sources) if (!listed.has(source.source_id)) problems.push(`task ${task.task_id} cites source ${source.source_id}, which this request does not list`)
    const targets = new Set([task.task_id, ...task.bindings.map(b => b.binding_id), ...task.outputs.map(o => o.output_id)])
    for (const item of task.content) for (const scope of item.scope) if (!targets.has(scope.target_id)) problems.push(`content ${task.task_id}/${item.item_id} is scoped to ${scope.target_id}, which its task does not declare`)
    const refs: Array<[string, Ref]> = [
      ...task.content.flatMap(item => [...item.about.map(r => [`${item.item_id}.about`, r] as [string, Ref]), ...item.support.flatMap(sp => sp.refs.map(r => [`${item.item_id}.support`, r] as [string, Ref]))]),
      ...task.unresolved.flatMap(u => u.affects.map(r => [`${u.id}.affects`, r] as [string, Ref])),
    ]
    for (const [where, ref] of refs) {
      const key = `${ref.id}@${ref.revision}`
      if (known(ref) || addedKeys.has(key)) continue
      const old = historicalObject(s, ref)
      if (!old) { problems.push(`${task.task_id} ${where} references ${key}, which no recorded IR holds`); continue }
      addedKeys.add(key)
      added.push({ ...old, reason: `referenced by ${task.task_id} ${where} as ${key}` })
      report.count("referenced_objects_added")
    }
  }
  if (problems.length) throw Error(`Request references do not resolve: ${problems.join("; ")}`)
  return added
}

function listedEvents(view: SourceView): Set<string> { return new Set(view.inputs.map(x => x.event_id)) }

/** The IR request: the current IR, this input, and every recorded input once. Code keeps the full input for preparation. */
export function irRequest(s: SddSnapshot, event: CompilerEvent, full: Record<string, unknown> & { ir: Record<string, TaskIntent> }): { request: IrRequestWire; report: ContextReport } {
  const report = new Report("ir")
  const view = sourceView(s, event.event_id, [{ in: "ir", ir: s.ir }], ledgerOf(s, s.ir), s.ir, report)
  completeReferences(s, [s.ir], listedEvents(view), report)
  const text = "(this input's text is its segments, in order, in source_segments and adopted_segments under its event_id)"
  const note = (e: CompilerEvent): CompilerEvent => ({ ...e, payload: { ...(e.payload as Record<string, unknown>), text } })
  // An earlier input keeps its identity; its host provenance stays in the store.
  const stub = (e: CompilerEvent): CompilerEvent => ({ schema_version: e.schema_version, run_id: e.run_id, event_id: e.event_id, kind: e.kind, source: e.source, payload: { text } })
  const { source_events: _all, source_segments: _segments, ...rest } = full
  report.omit("source_events", "all", "each input's text is shown once, as its segments; earlier inputs' payload provenance stays in the store")
  const request: IrRequestWire = {
    ...rest, request_view: SDD_REQUEST_VIEW,
    events: [note(event)],
    source_events: s.events.filter(e => e.kind === "user_input" && e.event_id !== event.event_id).map(stub),
    source_segments: view.inputs.flatMap(x => x.segments.flatMap(segment => "text" in segment ? [{ source_id: x.event_id, ...segment }] : [])),
    adopted_segments: view.inputs.flatMap(x => {
      const runs = x.segments.flatMap(segment => "text_in" in segment ? [segment] : [])
      return runs.length ? [{ source_id: x.event_id, runs }] : []
    }),
    source_ledger: { unplaced: view.unplaced, unprocessed_inputs: view.unprocessed_inputs },
  }
  return { request, report: report.done(request) }
}

function deliveryRequestOf(s: SddSnapshot, b: SddBatch, report: Report, shown: ReadonlySet<string> = new Set(), spans: ReadonlyArray<{ source_id: string; start: number; end: number }> = []): DeliveryRequest {
  if (!b.parent) throw Error("Missing prepared IR")
  const prepared = b.parent.ir
  const change = changeView(s.ir, prepared)
  const view = sourceView(s, b.event_id, [{ in: "ir", ir: prepared }, { in: "previous_versions", ir: change.previous_versions }], ledgerOf(s, prepared, b), prepared, report)
  const referenced = completeReferences(s, [prepared, change.previous_versions], listedEvents(view), report)
  const plan = planCarry(previousContract(s, b), s.ir, prepared)
  const show = new Set([...plan.toWrite, ...shown])
  const request: DeliveryRequest = { request_view: SDD_REQUEST_VIEW, ir: prepared, ir_change: change, sources: view, history: historyView(s, b.event_id, prepared, report), feedback: feedbackView(s, report),
    referenced_objects: referenced, issues: b.error ? [b.error] : [], to_write: plan.toWrite,
    carried: { fields: plan.fields.map(o => ({ object: o.object, fields: o.fields.map(f => f.field) })), acceptance: plan.acceptance.map(a => a.subject), effective: plan.effective.map(e => e.entry.item_id) } }
  return slim(request, b.event_id, show, spans, report)
}

const NOT_SHOWN = "(text not shown: this requirement is unchanged since the accepted delivery and is delivered verbatim; it needs only a disposition)"

/**
 * Requests show the new input in full, the requirements this round writes for
 * (and, for the check, those its cuts and effective statements touch), and the
 * passages of other inputs those requirements and cuts select. Other
 * requirements are shown by id with their text replaced; other passages are
 * left out. The store keeps everything; the omissions are reported.
 */
function slim<T extends DeliveryRequest | CheckRequest>(request: T, currentId: string, shown: ReadonlySet<string>, cuts: ReadonlyArray<{ source_id: string; start: number; end: number }>, report: Report): T {
  const keep: Array<{ source_id: string; start: number; end: number }> = [...cuts]
  const ir = structuredClone(request.ir)
  for (const task of Object.values(ir)) for (const item of task.content) {
    if (shown.has(item.item_id)) { for (const x of item.sources) if (x.span) keep.push({ source_id: x.source_id, start: x.span.start, end: x.span.end }); continue }
    report.count("ir_texts_not_shown"); report.count("ir_text_chars_not_shown", item.text.length + (item.interpretation?.length ?? 0))
    item.text = NOT_SHOWN
    delete item.interpretation
    item.sources = item.sources.map(({ quote: _quote, ...rest }) => rest)
  }
  for (const task of Object.values(request.ir_change.previous_versions)) for (const item of task.content) for (const x of item.sources) if (x.span) keep.push({ source_id: x.source_id, start: x.span.start, end: x.span.end })
  const inputs = request.sources.inputs.map(input => input.event_id === currentId ? input : {
    ...input,
    segments: input.segments.filter(segment => {
      const visible = "text" in segment
        ? keep.some(k => k.source_id === input.event_id && k.start < segment.span.end && segment.span.start < k.end)
        : segment.text_in.in === "previous_versions" || shown.has(segment.text_in.item_id)
      if (!visible) { report.count("segments_not_shown"); if ("text" in segment) report.count("segment_chars_not_shown", segment.text.length) }
      return visible
    }),
  })
  // The previous delivery's effective statements are carried by code; history keeps their ids only.
  const history = structuredClone(request.history)
  if (history.latest) history.latest.tasks = history.latest.tasks.map(t => ({ ...t, effective: t.effective.map(e => ({ item_id: e.item_id, text: "(carried or replaced by code; see carried.effective)", basis: [] })) }))
  for (const run of history.runs) if (run.result) run.result = { ...run.result, artifacts: run.result.artifacts.map(({ text: _text, ...rest }) => rest) }
  // Objects referenced from history keep their identity; their text only when shown.
  const referenced_objects = request.referenced_objects.map(ref => {
    const object = structuredClone(ref.object) as { item_id?: string; text?: string; interpretation?: string; content?: Array<{ item_id: string; text: string; interpretation?: string }> }
    const hide = (item: { item_id?: string; text?: string; interpretation?: string }) => {
      if (item.item_id === undefined || shown.has(item.item_id) || item.text === undefined) return
      report.count("referenced_text_chars_not_shown", item.text.length + (item.interpretation?.length ?? 0))
      item.text = NOT_SHOWN; delete item.interpretation
    }
    if (ref.kind === "content") hide(object)
    if (ref.kind === "task") object.content?.forEach(hide)
    return { ...ref, object }
  })
  return { ...request, ir, sources: { ...request.sources, inputs }, history, referenced_objects }
}

export function deliveryRequest(s: SddSnapshot, b: SddBatch): { request: DeliveryRequest; report: ContextReport } {
  const report = new Report("ci")
  const request: DeliveryRequest = { ...deliveryRequestOf(s, b, report), ...(b.error && b.last_draft ? { previous_draft: b.last_draft } : {}) }
  return { request, report: report.done(request) }
}

/** The check sees the exact delivery, the IR it came from, what changed, the update itself and every source once. */
export function checkRequest(s: SddSnapshot, b: SddBatch): { request: CheckRequest; report: ContextReport } {
  if (!b.delivery || !b.parent) throw Error("Missing frozen CI/check input")
  const report = new Report("check")
  const d = b.delivery
  // Shown in full: what this round wrote for, and what its cuts and new effective statements touch.
  const touched = new Set([...d.removed.flatMap(r => [...r.selected_before, ...r.now.map(n => n.item)].map(x => x.split("@")[0]!)),
    ...d.draft.tasks.flatMap(t => t.effective.map(e => e.item_id))])
  const base = deliveryRequestOf(s, b, report, touched, d.removed.map(r => ({ source_id: r.source_id, start: r.start, end: r.end })))
  const candidate = b.parent.candidate
  // Carried entries were checked when written: shown by name only.
  // The contract by name: carried entries were checked when written; new ones are in full in delivery.draft.
  const contract = { ...d.contract,
    fields: d.contract.fields.map(o => ({ object: o.object, items: o.items, carried: o.carried, ...(o.carried ? { fields: o.fields.map(f => ({ field: f.field })) } : { written: "in delivery.draft.fields" }) })),
    acceptance: d.contract.acceptance.map(a => ({ subject: a.subject, items: a.items, carried: a.carried, ...(a.carried ? {} : { written: "in delivery.draft.acceptance" }) })),
    effective: d.contract.effective.map(e => ({ task_id: e.task_id, revision: e.revision, carried: e.carried, entry: e.carried ? { item_id: e.entry.item_id } : { item_id: e.entry.item_id, written: "in delivery.draft.tasks[].effective" } })) }
  const request: CheckRequest = {
    ...base,
    // The reference text is every input again; the check reads the inputs from sources.
    delivery: { ...withoutReference(d), text: DELIVERY_TEXT_VIEW, contract: contract as unknown as CIDelivery["contract"] },
    ir_update: {
      basis: candidate.basis,
      groups: candidate.groups.map(g => ({ local_ref: g.local_ref, task_refs: g.task_refs, ir_changes: g.ir_changes })),
      // Each entry's passage is visible in sources, by text or by the item that carries it.
      source_coverage: (candidate.source_coverage ?? []).map(entry => ({ ...entry })),
    },
  }
  return { request, report: report.done(request) }
}
