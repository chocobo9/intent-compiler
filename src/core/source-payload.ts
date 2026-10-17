import { collectProblem, throwProblems } from "./admission-problems.js"
import { digestOf, digestText, type Candidate, type CandidateGroup, type CompilerEvent, type ContentItem, type IrChange, type LocalSourceEditRecord, type SourceDisposition, type SourceRef, type SourceSegment, type TaskIntent } from "./intent-contract.js"

export function userText(event: CompilerEvent): string | undefined {
  const value = event.payload as { text?: unknown } | undefined
  return event.source.channel === "user" && typeof value?.text === "string" ? value.text : undefined
}

/** Addressing boundaries only. The model, not paragraph layout, decides role. */
export function sourceSegments(events: readonly CompilerEvent[]): SourceSegment[] {
  return events.flatMap(event => {
    const text = userText(event)
    if (text === undefined) return []
    return segmentBounds(text).map(bounds => ({ source_id: event.event_id, segment_id: bounds.segment_id, span: { unit: "utf16" as const, start: bounds.start, end: bounds.end }, text: text.slice(bounds.start, bounds.end) }))
  })
}

/** Paragraph segments of one text, numbered as source_segments numbers them. */
function segmentBounds(text: string): Array<{ segment_id: string; start: number; end: number }> {
  const ends = [...text.matchAll(/\r?\n[ \t]*\r?\n/gu)].map(match => match.index! + match[0].length)
  ends.push(text.length)
  let start = 0
  const segments: Array<{ segment_id: string; start: number; end: number }> = []
  for (const end of ends) {
    if (end > start && text.slice(start, end).trim()) segments.push({ segment_id: `s${segments.length + 1}`, start, end })
    start = end
  }
  return segments
}

const EXCERPT_WHOLE = 160
const EXCERPT_EDGE = 70
const LISTED_RANGES = 3
const LISTED_SOURCES = 4

/**
 * Where a range of one source lies, in the terms a repair can use: its UTF-16
 * offsets, the segments it touches, and its first and last words.  The excerpt
 * is bounded; a long passage is never pasted whole.
 */
function rangeView(text: string, range: { start: number; end: number }): string {
  const touched = segmentBounds(text).filter(segment => segment.start < range.end && range.start < segment.end).map(segment => segment.segment_id)
  const segments = touched.length === 0 ? "" : touched.length === 1 ? ` (segment ${touched[0]})` : ` (segments ${touched[0]}-${touched.at(-1)})`
  const flat = text.slice(range.start, range.end).replace(/\s+/gu, " ").trim()
  const quoted = flat.length <= EXCERPT_WHOLE ? JSON.stringify(flat)
    : `${JSON.stringify(flat.slice(0, EXCERPT_EDGE))} ... ${JSON.stringify(flat.slice(-EXCERPT_EDGE))} (${flat.length} characters)`
  return `utf16 ${range.start}-${range.end}${segments} ${quoted}`
}

function listed<T>(values: readonly T[], limit: number, show: (value: T) => string, separator: string): string {
  const hidden = values.length - limit
  return values.slice(0, limit).map(show).join(separator) + (hidden > 0 ? `${separator}${hidden} more not listed` : "")
}

/** How a message writes one event id: an alias when the request showed one, else the id. */
export type EventIdDisplay = (eventId: string) => string
const identityDisplay: EventIdDisplay = (eventId) => eventId

function validSpan(source: SourceRef, texts: Map<string, string>, display: EventIdDisplay = identityDisplay): NonNullable<SourceRef["span"]> {
  const text = texts.get(source.source_id), span = source.span
  if (text === undefined || !span || span.unit !== "utf16" || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > text.length || source.digest !== digestText(text)) {
    throw new Error(`source payload requires a resolvable user text span: ${display(source.source_id)}`)
  }
  return span
}

function sourceTexts(events: readonly CompilerEvent[]): Map<string, string> {
  return new Map(events.flatMap(event => { const text = userText(event); return text === undefined ? [] : [[event.event_id, text] as const] }))
}

/** Interpretation never overwrites selected source bytes. Adjacent selections merge. */
export function materializeSourceContent(task: TaskIntent, changes: readonly IrChange[], events: readonly CompilerEvent[], display: EventIdDisplay = identityDisplay): void {
  const ids = new Set(changes.flatMap(change => change.action === "create" && change.target === "content" ? [change.local_ref]
    : change.action === "revise" && change.target === "content" ? [change.id]
      : change.action === "edit" && change.target === "content" ? [change.id] : []))
  // Only create/revise state a new label (value.text).  An edit changes sources
  // in place, so the item's existing interpretation stays what it was.
  const labeled = new Set(changes.flatMap(change => change.action === "create" && change.target === "content" ? [change.local_ref]
    : change.action === "revise" && change.target === "content" ? [change.id] : []))
  const texts = sourceTexts(events)
  for (const item of task.content) {
    if (!ids.has(item.item_id)) continue
    if (item.sources.length === 0) throw new Error(`IR content ${item.item_id} has no selected normative source`)
    const sources: SourceRef[] = []
    for (const sourceId of texts.keys()) {
      const spans = item.sources.filter(source => source.source_id === sourceId).map(source => validSpan(source, texts, display)).sort((a, b) => a.start - b.start)
      for (const span of spans) {
        const last = sources.at(-1)
        if (last?.source_id === sourceId && last.span!.end >= span.start) last.span!.end = Math.max(last.span!.end, span.end)
        else sources.push({ source_id: sourceId, digest: digestText(texts.get(sourceId)!), span: { ...span } })
      }
    }
    if (labeled.has(item.item_id)) item.interpretation = item.text
    item.text = sources.map(source => texts.get(source.source_id)!.slice(source.span!.start, source.span!.end)).join("\n\n")
    item.text_origin = "source"
    item.sources = sources
  }
}

/**
 * A local `edit` keeps the item's other sources and hands the batch only the
 * fragments it removed.  The disposal record for those fragments is written
 * here, from the edit's own basis and reason, so the model does not send a
 * second copy of the same removal.  What a current selection still covers -
 * possibly several intervals together, or a partially retained fragment - is
 * not a withdrawal: only the uncovered remainders are recorded, one entry per
 * remainder.
 */
export function recordEditedRemovals(
  candidate: Candidate,
  current: Record<string, TaskIntent>,
  edits: readonly LocalSourceEditRecord[],
): void {
  if (!Array.isArray(candidate.source_coverage) || edits.length === 0) return
  const active = Object.values(current).flatMap(task => task.content).flatMap(item => item.sources)
  for (const edit of edits) {
    for (const removed of edit.removed) {
      const span = removed.span!
      const covered = active
        .filter(source => source.source_id === removed.source_id && source.span !== undefined)
        .map(source => source.span!)
      for (const residual of uncoveredRanges(span.start, span.end, covered)) {
        const source: SourceRef = { ...removed, span: { unit: "utf16", start: residual.start, end: residual.end } }
        // Preparing the same candidate again must not add the record twice: an
        // existing superseded entry that already covers this remainder is the
        // record this operation would have written.
        const alreadyRecorded = candidate.source_coverage.some(entry => entry.disposition === "superseded"
          && entry.source.source_id === source.source_id
          && entry.source.span !== undefined
          && entry.source.span.start <= source.span!.start && entry.source.span.end >= source.span!.end)
        if (alreadyRecorded) continue
        candidate.source_coverage.push({
          source,
          disposition: "superseded",
          requirements: [],
          reason: edit.reason,
          basis: edit.basis.map(ref => ({ ...ref })),
        })
      }
    }
  }
}

/** The parts of one removed range that no current selection of that event covers. */
function uncoveredRanges(start: number, end: number, covered: readonly { start: number; end: number }[]): Array<{ start: number; end: number }> {
  const found: Array<{ start: number; end: number }> = []
  let cursor = start
  for (const span of [...covered].sort((a, b) => a.start - b.start)) {
    if (span.end <= cursor || span.start >= end) continue
    if (span.start > cursor) found.push({ start: cursor, end: Math.min(span.start, end) })
    cursor = Math.max(cursor, span.end)
    if (cursor >= end) return found
  }
  if (cursor < end) found.push({ start: cursor, end })
  return found
}

function covered(text: string, start: number, end: number, spans: readonly { start: number; end: number }[]): boolean {
  // Whitespace between paragraphs is an addressing separator, not an inferred rule.
  const ranges = [...spans].sort((a, b) => a.start - b.start)
  let cursor = start
  for (const range of ranges) {
    if (range.end <= cursor || range.start >= end) continue
    if (range.start > cursor && text.slice(cursor, Math.min(range.start, end)).trim()) return false
    cursor = Math.max(cursor, range.end)
    if (cursor >= end) return true
  }
  return !text.slice(cursor, end).trim()
}

/**
 * The host quotes a whole instruction when it passes it as one command-line
 * argument. Those wrapper bytes are the transport's, not the user's words, so
 * no selection has to adopt them and a revision may leave them out.
 */
export function hostQuotedBounds(text: string): { start: number; end: number } | undefined {
  if (text.length < 3 || !text.startsWith("\"") || !text.endsWith("\"")) return undefined
  const inner = text.slice(1, -1)
  if (!inner.includes(" ") || inner.includes("\"")) return undefined
  return { start: 1, end: text.length - 1 }
}

const allowedByte = (text: string, index: number, wrapper: { start: number; end: number } | undefined): boolean =>
  /\s/u.test(text[index]!) || (wrapper !== undefined && (index < wrapper.start || index >= wrapper.end))

/**
 * The byte ranges of the user's own words that no span accounts for.  Whitespace
 * and the host's command-line quoting are transport, not requirement text, so
 * they never need a disposition.
 */
export function residualRanges(
  text: string,
  start: number,
  end: number,
  spans: readonly { start: number; end: number }[],
  wrapper: { start: number; end: number } | undefined = hostQuotedBounds(text),
): Array<{ start: number; end: number }> {
  const ranges = [...spans].sort((a, b) => a.start - b.start)
  const found: Array<{ start: number; end: number }> = []
  const push = (from: number, to: number): void => {
    let first = from, last = to
    while (first < last && allowedByte(text, first, wrapper)) first += 1
    while (last > first && allowedByte(text, last - 1, wrapper)) last -= 1
    if (last > first) found.push({ start: first, end: last })
  }
  let cursor = start
  for (const range of ranges) {
    if (range.end <= cursor || range.start >= end) continue
    if (range.start > cursor) push(cursor, Math.min(range.start, end))
    cursor = Math.max(cursor, range.end)
    if (cursor >= end) return found
  }
  if (end > cursor) push(cursor, end)
  return found
}

export interface SourceCoverageOptions {
  /**
   * Delegations carried from earlier turns because no batch has compiled them
   * yet. Their text stays addressable, and the candidate has to name each
   * carried delegation at least once: either by selecting its operative text
   * into IR content, or by writing an explicit source_coverage entry for it
   * (with a question when it still cannot be compiled).  Silence about a
   * carried delegation is rejected; acknowledgment alone does not register it.
   */
  carriedEventIds?: ReadonlySet<string>
  /** How a message writes one event id: the alias this request showed, when it did. */
  display?: EventIdDisplay
  /**
   * The user inputs this batch itself processes (its own turn, not carried
   * delegations or execution returns).  Every passage of these inputs needs a
   * destination in the source ledger, whether or not the batch changes the IR.
   */
  ownEventIds?: ReadonlySet<string>
  /**
   * Every span a content item of this run has selected at some time (the
   * accepted batches' selections and the supplied IR), as `selectedSourceHistory`
   * reads it.  Text in it was normative once; a superseded entry naming such
   * text that the supplied IR no longer holds restates an earlier withdrawal.
   */
  history?: readonly SourceRef[]
}

/** Validate explicit dispositions and preserve previously adopted source text. */
export function validateSourceCoverage(candidate: Candidate, currentEvents: readonly CompilerEvent[], sources: readonly CompilerEvent[], previous: Record<string, TaskIntent>, current: Record<string, TaskIntent>, options: SourceCoverageOptions = {}): void {
  if (!Array.isArray(candidate.source_coverage)) throw new Error("source_coverage must explicitly list source dispositions (or [])")
  const display = options.display ?? identityDisplay
  const texts = sourceTexts(sources)
  // Headings are layout: a non-normative entry that names nothing but heading
  // lines states no decision, so code drops it rather than judging it.
  candidate.source_coverage = candidate.source_coverage.filter(entry => {
    if (entry.disposition === "normative") return true
    const text = texts.get(entry.source.source_id)
    try { const span = validSpan(entry.source, texts, display); return !headingOnly(text!, span.start, span.end) } catch { return true }
  })
  let entries = candidate.source_coverage
  const currentIds = new Set(currentEvents.filter(event => userText(event) !== undefined).map(event => event.event_id))
  const taskIds = new Set(candidate.groups.flatMap(group => group.task_refs))
  const items = Object.entries(current).filter(([id]) => taskIds.has(id)).flatMap(([, task]) => task.content)
  const oldItems = Object.entries(previous).filter(([id]) => taskIds.has(id)).flatMap(([, task]) => task.content)
  const activeSources = items.flatMap(item => item.sources)
  const oldSources = oldItems.flatMap(item => item.sources)
  const spansFor = (refs: readonly SourceRef[], sourceId: string) => refs.filter(ref => ref.source_id === sourceId).map(ref => validSpan(ref, texts, display))
  const superseded: SourceRef[] = []
  // Superseded entries that only name text an earlier batch already withdrew.
  const restated = new Set<SourceDisposition>()
  const history = (options.history ?? []).filter(ref => { try { validSpan(ref, texts, display); return true } catch { return false } })
  const adoptedByItem = new Map<ContentItem, SourceRef[]>()
  // Selecting source text into an IR item is already the model's normative
  // adoption decision. Derive its exact destination rather than asking for a
  // second copy.
  const selectedSources = items.filter(item => item.text_origin === "source").flatMap(item => item.sources)
  for (const item of items) if (item.text_origin === "source") adoptedByItem.set(item, item.sources)

  // Each entry is judged on its own; every failing entry is reported together.
  const problems: string[] = []
  for (const [index, entry] of entries.entries()) collectProblem(problems, () => {
    const span = validSpan(entry.source, texts, display), text = texts.get(entry.source.source_id)!
    if (!entry.reason.trim()) throw new Error(`source_coverage[${index}] needs a role/revision explanation`)
    if (entry.disposition === "normative") {
      if (entry.requirements.length === 0) throw new Error(`normative source_coverage[${index}] has no IR destination`)
      const recipients: ContentItem[] = entry.requirements.map(ref => {
        const id = "local_ref" in ref ? ref.local_ref : ref.id
        const matches = items.filter(item => item.item_id === id)
        if (matches.length !== 1) throw new Error(`source_coverage[${index}] names unknown or ambiguous IR ${id}`)
        const item = matches[0]!
        if ("revision" in ref) {
          // Revision is the model's claim and must be current; the digest is
          // code-owned and written back, exactly as for content sources.
          if (item.revision !== ref.revision) throw new Error(`source_coverage[${index}] names stale IR ${id}`)
          ref.digest = digestOf(item)
        }
        return item
      })
      if (!covered(text, span.start, span.end, [...spansFor(recipients.flatMap(item => item.sources), entry.source.source_id), ...markdownHeadings(text)])) throw new Error(`normative source_coverage[${index}] omits source text from its IR destinations`)
      for (const item of recipients) adoptedByItem.set(item, [...(adoptedByItem.get(item) ?? []), entry.source])
    } else {
      if (entry.requirements.length > 0) throw new Error(`non-normative source_coverage[${index}] cannot assign an IR requirement`)
      // Heading lines inside the overlap are layout and do not count.
      const headings = markdownHeadings(text)
      const substantive = (from: number, to: number) => from < to && residualRanges(text, from, to, headings).length > 0
      const overlapping = spansFor(activeSources, entry.source.source_id).some(active => substantive(Math.max(active.start, span.start), Math.min(active.end, span.end)))
      if (overlapping) {
        const adopted = items.flatMap(item => item.sources.filter(source => source.source_id === entry.source.source_id).flatMap(source => {
          const active = validSpan(source, texts, display)
          const range = { start: Math.max(active.start, span.start), end: Math.min(active.end, span.end) }
          return substantive(range.start, range.end) ? [{ item: item.item_id, range }] : []
        }))
        const where = listed(adopted, LISTED_RANGES, overlap => `${rangeView(text, overlap.range)} is a current source of IR ${overlap.item}`, "; ")
        throw new Error(`source_coverage[${index}] classifies actively adopted text as ${entry.disposition}: in ${display(entry.source.source_id)} ${where}`)
      }
      if (entry.disposition === "superseded") {
        const basisOk = entry.basis.some(ref => {
          if (!texts.has(ref.source_id)) return false
          try { validSpan(ref, texts, display); return true } catch { return false }
        })
        // "Available" is exactly what this check can prove: the reference
        // resolves inside the source set this batch's validation was given.  It
        // is not a claim about which sources the model request displayed.
        if (!basisOk) throw new Error(`superseded source_coverage[${index}] needs a resolvable source available to this batch as its change basis`)
        const held = spansFor(oldSources, entry.source.source_id)
        // Previously normative: held by the supplied IR, or selected by an item of this run before
        // and withdrawn since.  Text no item ever selected still cannot be superseded.
        if (!covered(text, span.start, span.end, [...held, ...spansFor(history, entry.source.source_id)])) throw new Error(`superseded source_coverage[${index}] was not previously normative text`)
        // Nothing of it is in the supplied IR: an earlier batch already withdrew it, and naming it
        // again withdraws nothing, so code drops the entry rather than judging it.
        if (!held.some(old => substantive(Math.max(old.start, span.start), Math.min(old.end, span.end)))) { restated.add(entry); return }
        superseded.push(entry.source)
      }
    }
  })
  throwProblems(problems)
  if (restated.size > 0) entries = candidate.source_coverage = entries.filter(entry => !restated.has(entry))
  // A carried delegation is an unresolved task from an earlier turn, not
  // background for this one.  It may be adopted, or explicitly deferred with a
  // reason, but it cannot be passed over in silence.
  const unnamed: string[] = []
  for (const eventId of options.carriedEventIds ?? []) {
    const named = selectedSources.some(source => source.source_id === eventId)
      || entries.some(entry => entry.source.source_id === eventId)
    if (!named) {
      unnamed.push(`carried delegation ${display(eventId)} has no disposition: select its operative text into IR content, or write a source_coverage entry naming its passage (and a question when it still cannot be compiled)`)
    }
  }
  throwProblems(unnamed)
  const unassigned: string[] = []
  for (const item of items) for (const source of item.sources) collectProblem(unassigned, () => {
    const span = validSpan(source, texts, display), text = texts.get(source.source_id)!
    const retained = oldItems.filter(old => old.item_id === item.item_id).flatMap(old => old.sources).filter(old => !currentIds.has(old.source_id))
    if (!covered(text, span.start, span.end, spansFor([...(adoptedByItem.get(item) ?? []), ...retained], source.source_id))) throw new Error(`new normative selection ${display(source.source_id)} in ${item.item_id} has no matching source_coverage assignment`)
  })
  throwProblems(unassigned)
  // The first failing source decides the batch, as before; the message also
  // lists the other prior selections left without a destination.
  const dropped: Array<{ source_id: string; detail: string }> = []
  const droppedError = () => new Error(`previously normative source ${[...new Set(dropped.map(entry => display(entry.source_id)))].join(", ")} was dropped without an explicit superseded disposition and current change basis: ${listed(dropped, LISTED_SOURCES, entry => entry.detail, " | ")}`)
  for (const old of oldItems) for (const source of old.sources) {
    let span: NonNullable<SourceRef["span"]>
    try { span = validSpan(source, texts, display) } catch (error) { if (dropped.length > 0) throw droppedError(); throw error }
    const text = texts.get(source.source_id)!
    // A remainder with no letter or digit (a list marker, a fence) is layout, as the source ledger treats it.
    const residual = residualRanges(text, span.start, span.end, [...spansFor([...activeSources, ...superseded], source.source_id), ...headingLines(text)])
      .filter(range => /[\p{L}\p{N}]/u.test(text.slice(range.start, range.end)))
    if (residual.length === 0) continue
    dropped.push({ source_id: source.source_id, detail: `IR ${old.item_id} selected ${display(source.source_id)} utf16 ${span.start}-${span.end}; no current source or superseded entry covers ${listed(residual, LISTED_RANGES, range => rangeView(text, range), "; ")}` })
  }
  if (dropped.length > 0) throw droppedError()
  // This turn's own input is accounted for in full in every batch that has
  // one: each passage is adopted into a content item, or explicitly said not to
  // be a requirement.  Earlier inputs and carried delegations are not re-examined.
  const ledger = new SourceLedger({ texts, selected: new Map(), dispositions: entries })
  const unplaced = [...(options.ownEventIds ?? [])].flatMap(eventId => ledger.unplaced(eventId, current))
  if (unplaced.length > 0) {
    const listed = unplaced.map(passage => `${display(passage.source_id)}/${passage.segment_id} ${JSON.stringify(shortText(passage.text))}`)
    throw new Error(`this turn's input has text with no destination: ${listed.join("; ")}. Adopt each passage into an IR content item, or give it a source_coverage entry saying why it is not a requirement; a segment_id disposes of the whole segment without copying it`)
  }
}

function shortText(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim()
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat
}

/** One passage this batch withdrew from the IR, with the text that justifies it. */
export interface WithdrawnPassage {
  source: SourceRef
  /** The removed source text, exactly as the user wrote it. */
  text: string
  /** Prior IR content items that selected this text. */
  items: string[]
  reason: string
  basis: Array<{ source: SourceRef; text: string }>
}

/**
 * Every withdrawal in the prepared candidate - the model's superseded entries
 * and the records code wrote for edit removals - resolved to the removed text
 * and its basis text, so a check can judge each removal against what the user
 * actually wrote rather than against the IR's summary of it.
 */
export function withdrawnPassages(candidate: Candidate, previous: Record<string, TaskIntent>, sources: readonly CompilerEvent[]): WithdrawnPassage[] {
  const texts = sourceTexts(sources)
  const slice = (ref: SourceRef): string | undefined => {
    const text = texts.get(ref.source_id)
    return text === undefined ? undefined : ref.span === undefined ? text : text.slice(ref.span.start, ref.span.end)
  }
  const taskIds = new Set(candidate.groups.flatMap(group => group.task_refs))
  const oldItems = Object.entries(previous).filter(([id]) => taskIds.has(id)).flatMap(([, task]) => task.content)
  return (candidate.source_coverage ?? []).filter(entry => entry.disposition === "superseded").flatMap(entry => {
    const text = slice(entry.source)
    if (text === undefined) return []
    const span = entry.source.span
    const items = oldItems.filter(item => item.sources.some(source => source.source_id === entry.source.source_id
      && (span === undefined || source.span === undefined || (source.span.start < span.end && span.start < source.span.end)))).map(item => item.item_id)
    return [{
      source: entry.source,
      text,
      items,
      reason: entry.reason,
      basis: entry.basis.flatMap(ref => { const basisText = slice(ref); return basisText === undefined ? [] : [{ source: ref, text: basisText }] }),
    }]
  })
}

/**
 * Where a quote selects source text.  An exact unique occurrence is the rule.
 * Only when the quote occurs nowhere exactly is it compared again on a
 * simplified form of both texts - whitespace runs as one space, backticks and
 * backslashes dropped, the quote's own leading and trailing whitespace and
 * punctuation set aside - and a unique occurrence there is mapped back to the
 * source's real interval.  The stored text is always that source slice: the
 * quote only locates it.  A result's `match` says which rule located it, so the
 * same function re-run over a recorded answer tells exact from simplified.
 */
export type QuoteLocation =
  | { match: "exact" | "simplified"; start: number; end: number }
  | { match: "none" | "ambiguous"; simplified: "none" | "ambiguous" | "empty" | "not_tried" }

const SKIPPED = /[`\\]/u
const EDGE = /[\s\p{P}`\\]/u

function simplify(text: string, from = 0, to = text.length): { text: string; at: number[] } {
  let out = ""
  const at: number[] = []
  for (let index = from; index < to; index += 1) {
    const character = text[index]!
    if (SKIPPED.test(character)) continue
    if (/\s/u.test(character)) {
      if (out.endsWith(" ")) continue
      out += " "
    } else out += character
    at.push(index)
  }
  return { text: out, at }
}

export function locateQuote(quote: string, text: string): QuoteLocation {
  const start = text.indexOf(quote)
  if (start >= 0) {
    return text.indexOf(quote, start + 1) >= 0 ? { match: "ambiguous", simplified: "not_tried" } : { match: "exact", start, end: start + quote.length }
  }
  let first = 0, last = quote.length
  while (first < last && EDGE.test(quote[first]!)) first += 1
  while (last > first && EDGE.test(quote[last - 1]!)) last -= 1
  const needle = simplify(quote, first, last).text
  if (!needle) return { match: "none", simplified: "empty" }
  const source = simplify(text)
  const found = source.text.indexOf(needle)
  if (found < 0) return { match: "none", simplified: "none" }
  if (source.text.indexOf(needle, found + 1) >= 0) return { match: "none", simplified: "ambiguous" }
  let begin = source.at[found]!, end = source.at[found + needle.length - 1]! + 1
  // Punctuation the quote carried at its edges stays in the selection when the
  // source has it directly adjacent (backticks and backslashes aside).  A full
  // stop the quote took from the previous sentence is separated from the match
  // by whitespace in the source, so it is not pulled in.
  const edge = (part: string) => [...part].filter(c => !/\s/u.test(c) && !SKIPPED.test(c))
  for (const character of edge(quote.slice(last))) {
    let probe = end
    while (probe < text.length && SKIPPED.test(text[probe]!)) probe += 1
    if (text[probe] !== character) break
    end = probe + 1
  }
  for (const character of edge(quote.slice(0, first)).reverse()) {
    let probe = begin - 1
    while (probe >= 0 && SKIPPED.test(text[probe]!)) probe -= 1
    if (text[probe] !== character) break
    begin = probe
  }
  // A code span the simplified match cut in half keeps its other backtick.
  if (([...text.slice(begin, end)].filter(c => c === "`").length % 2) === 1) {
    if (text[end] === "`") end += 1
    else if (text[begin - 1] === "`") begin -= 1
  }
  return { match: "simplified", start: begin, end }
}

export const contentKey = (taskId: string, itemId: string): string => `${taskId}\u0000${itemId}`

/**
 * Every span each content item has selected in this run, read from records the
 * store already keeps: the content changes of every accepted batch (create and
 * revise sources, edit additions) and the sources of the prior IR.  A retire
 * ends the item's history, so a later item reusing the id starts fresh.
 */
export function selectedSourceHistory(
  log: readonly { status: string; candidate?: { groups: readonly CandidateGroup[] } }[],
  ir: Record<string, TaskIntent>,
): Map<string, SourceRef[]> {
  const selected = new Map<string, SourceRef[]>()
  const add = (key: string, sources: readonly SourceRef[] | undefined) => {
    if (!Array.isArray(sources)) return
    selected.set(key, [...(selected.get(key) ?? []), ...sources.filter(source => source.span !== undefined)])
  }
  for (const record of log) {
    if (record.status !== "accepted" || record.candidate === undefined) continue
    for (const group of record.candidate.groups) {
      const taskId = group.task_refs[0]
      if (taskId === undefined) continue
      for (const change of group.ir_changes) {
        if (change.action === "create" && change.target === "content") add(contentKey(taskId, change.local_ref), change.sources)
        else if (change.action === "revise" && change.target === "content") add(contentKey(taskId, change.id), change.sources)
        else if (change.action === "edit" && change.target === "content") add(contentKey(taskId, change.id), change.add as SourceRef[])
        else if (change.action === "retire" && change.target === "content") selected.delete(contentKey(taskId, change.id))
      }
    }
  }
  for (const task of Object.values(ir)) for (const item of task.content) add(contentKey(task.task_id, item.item_id), item.sources)
  return selected
}

/** Explicit dispositions every accepted batch recorded, in log order. */
export function recordedDispositions(log: readonly { status: string; candidate?: { source_coverage?: readonly SourceDisposition[] } }[]): SourceDisposition[] {
  return log.flatMap(record => record.status === "accepted" ? [...(record.candidate?.source_coverage ?? [])] : [])
}

/** Where a range of one user input went. */
export type SourceDestination = "adopted" | "withdrawn" | "not_requirement" | "none"

export interface UnplacedPassage {
  source_id: string
  segment_id: string
  start: number
  end: number
  text: string
}

const NOT_REQUIREMENT = new Set(["context", "material", "management", "unresolved"])

/**
 * The source ledger: where every passage of every user input went, derived from
 * accepted state and never stored.  A passage is adopted by a located content
 * selection or a normative entry,
 * withdrawn when an item once selected it and no item does now (or a superseded
 * entry names it), explicitly not a requirement when a context, material,
 * management or unresolved entry names it, and otherwise has no destination.
 * Blank lines, Markdown heading lines and remainders without a letter or digit
 * (list markers, fences) need no destination.  Re-deriving it
 * after a failure or restart reads the same records, so the answer does not
 * depend on which events a batch happened to carry.
 */
export class SourceLedger {
  constructor(private readonly input: {
    /** Text of every recorded user input, by event id. */
    texts: ReadonlyMap<string, string>
    /** Every span each content item has selected, keyed by `contentKey(task, item)`. */
    selected: ReadonlyMap<string, readonly SourceRef[]>
    /** Explicit source_coverage entries of accepted batches (and the candidate being prepared). */
    dispositions: readonly SourceDisposition[]
  }) {}

  /**
   * The withdrawn part of one item: what it once selected that no current item
   * of its task still selects, as resolvable ranges of the recorded inputs.
   */
  withdrawnFor(task: TaskIntent, itemId: string): Array<{ source_id: string; start: number; end: number }> {
    const active = task.content.flatMap(entry => entry.sources)
    return (this.input.selected.get(contentKey(task.task_id, itemId)) ?? []).flatMap(source => {
      const text = this.input.texts.get(source.source_id)
      if (source.span === undefined || text === undefined || source.digest !== digestText(text) || source.span.end > text.length) return []
      const covering = active.filter(entry => entry.source_id === source.source_id && entry.span !== undefined).map(entry => entry.span!)
      return uncoveredRanges(source.span.start, source.span.end, covering)
        .filter(range => text.slice(range.start, range.end).trim() && !headingOnly(text, range.start, range.end))
        .map(range => ({ source_id: source.source_id, ...range }))
    })
  }

  /** Passages of one input that no selection, withdrawal or explicit entry accounts for. */
  unplaced(eventId: string, ir: Record<string, TaskIntent>): UnplacedPassage[] {
    const text = this.input.texts.get(eventId)
    if (text === undefined) return []
    // Only a located span places text; a reference to a whole input places nothing.
    const of = (refs: readonly SourceRef[]) => refs.filter(ref => ref.source_id === eventId && ref.span !== undefined).map(ref => ref.span!)
    // Adoption is what reaches the delivered task: content selections (and
    // normative entries, below).  Goal, scope, binding and output sources keep
    // their own meaning in the IR but are not delivered, so they place nothing.
    const adopted = of(Object.values(ir).flatMap(task => task.content.flatMap(item => item.sources)))
    const everSelected = of([...this.input.selected.values()].flat())
    const entries = of(this.input.dispositions.filter(entry => entry.disposition === "superseded" || entry.disposition === "normative" || NOT_REQUIREMENT.has(entry.disposition)).map(entry => entry.source))
    const exempt = headingLines(text)
    const segment = sourceSegments([{ schema_version: 2, run_id: "", event_id: eventId, kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text } }])
    return segment.flatMap(part => residualRanges(text, part.span.start, part.span.end, [...adopted, ...everSelected, ...entries, ...exempt])
      // A remainder with no letter or digit (a list marker, a fence, a lone
      // punctuation mark left beside a selection) is layout, like a heading.
      .filter(range => /[\p{L}\p{N}]/u.test(text.slice(range.start, range.end)))
      .map(range => ({ source_id: eventId, segment_id: part.segment_id, start: range.start, end: range.end, text: text.slice(range.start, range.end) })))
  }
}

/** What a check is shown of the ledger: this turn's passages the candidate states are not requirements. */
export interface SourceDispositionView {
  not_requirements: Array<{ source: SourceRef; disposition: SourceDisposition["disposition"]; reason: string; text: string }>
}

export function sourceDispositionView(
  candidateEntries: readonly SourceDisposition[],
  texts: ReadonlyMap<string, string>,
  ownEventIds: ReadonlySet<string>,
): SourceDispositionView {
  return {
    not_requirements: candidateEntries.filter(entry => NOT_REQUIREMENT.has(entry.disposition) && ownEventIds.has(entry.source.source_id)).flatMap(entry => {
      const text = texts.get(entry.source.source_id)
      if (text === undefined) return []
      return [{ source: entry.source, disposition: entry.disposition, reason: entry.reason, text: entry.source.span === undefined ? text : text.slice(entry.source.span.start, entry.source.span.end) }]
    }),
  }
}

/**
 * Earlier inputs' passages with no destination, for review only: re-derived on
 * demand from a store's accepted records, IR and event journal (for example a
 * frozen snapshot.json and events.jsonl).  No batch and no check reads it.
 */
export function unplacedByInput(
  snapshot: { management_log: readonly { status: string; candidate?: Candidate }[]; ir: Record<string, TaskIntent> },
  journal: readonly { event: CompilerEvent }[],
): Record<string, UnplacedPassage[]> {
  const texts = new Map(journal.flatMap(row => { const text = userText(row.event); return text === undefined ? [] : [[row.event.event_id, text] as const] }))
  const ledger = new SourceLedger({ texts, selected: selectedSourceHistory(snapshot.management_log, snapshot.ir), dispositions: recordedDispositions(snapshot.management_log) })
  return Object.fromEntries([...texts.keys()].map(eventId => [eventId, ledger.unplaced(eventId, snapshot.ir)]).filter(([, passages]) => passages.length > 0))
}

/**
 * Markdown heading lines.  The first line may start with the host's opening
 * quote (`"# Title`): that quote is transport, the rest is still a heading.
 */
function markdownHeadings(text: string): Array<{ start: number; end: number }> {
  return [...text.matchAll(/^("?)[ \t]{0,3}#{1,6}(?:[ \t][^\n]*)?$/gmu)]
    .filter(match => match[1] === "" || match.index === 0)
    .map(match => ({ start: match.index!, end: match.index! + match[0].length }))
}

/** Markdown heading lines and code fence lines are layout, not requirement text. */
function headingLines(text: string): Array<{ start: number; end: number }> {
  const fences = [...text.matchAll(/^[ \t]{0,3}```[\w-]*[ \t]*\r?$/gmu)].map(match => ({ start: match.index!, end: match.index! + match[0].length }))
  return [...markdownHeadings(text), ...fences]
}

/** A range that holds nothing but Markdown heading lines, whitespace and host quoting. */
function headingOnly(text: string, start: number, end: number): boolean {
  const headings = markdownHeadings(text)
  return headings.some(heading => heading.start < end && start < heading.end) && residualRanges(text, start, end, headings).length === 0
}
