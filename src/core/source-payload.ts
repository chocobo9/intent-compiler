import { digestOf, digestText, type Candidate, type CompilerEvent, type ContentItem, type IrChange, type LocalSourceEditRecord, type SourceDisposition, type SourceRef, type SourceSegment, type TaskIntent } from "./intent-contract.js"

export function userText(event: CompilerEvent): string | undefined {
  const value = event.payload as { text?: unknown } | undefined
  return event.source.channel === "user" && typeof value?.text === "string" ? value.text : undefined
}

/** Addressing boundaries only. The model, not paragraph layout, decides role. */
export function sourceSegments(events: readonly CompilerEvent[]): SourceSegment[] {
  return events.flatMap(event => {
    const text = userText(event)
    if (text === undefined) return []
    const ends = [...text.matchAll(/\r?\n[ \t]*\r?\n/gu)].map(match => match.index! + match[0].length)
    ends.push(text.length)
    let start = 0
    const segments: SourceSegment[] = []
    for (const end of ends) {
      if (end > start && text.slice(start, end).trim()) segments.push({ source_id: event.event_id, segment_id: `s${segments.length + 1}`, span: { unit: "utf16", start, end }, text: text.slice(start, end) })
      start = end
    }
    return segments
  })
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

/** Every byte in the range is selected, whitespace, or the host's own wrapper. */
function disposed(text: string, start: number, end: number, spans: readonly { start: number; end: number }[]): boolean {
  return residualRanges(text, start, end, spans).length === 0
}

/**
 * The disposition code writes for text a batch never names.  It says what the
 * accounting says and nothing about meaning: the passage stays available, and a
 * later delegation may still select it into IR.
 */
export const DEFAULT_SOURCE_REASON = "unselected by this batch (code default; not adopted as a requirement)"

export interface SourceCoverageOptions {
  /**
   * Delegations carried from earlier turns because no batch has compiled them
   * yet.  Their text stays addressable and the code default still covers the
   * passages the model leaves unnamed, but the candidate has to name each
   * carried delegation at least once: either by selecting its operative text
   * into IR content, or by writing an explicit source_coverage entry for it
   * (with a question when it still cannot be compiled).  Silence about a
   * carried delegation is rejected; acknowledgment alone does not register it.
   */
  carriedEventIds?: ReadonlySet<string>
  /** How a message writes one event id: the alias this request showed, when it did. */
  display?: EventIdDisplay
}

/** Closed source accounting, without guessing whether the model chose the right role. */
export function validateSourceCoverage(candidate: Candidate, currentEvents: readonly CompilerEvent[], sources: readonly CompilerEvent[], previous: Record<string, TaskIntent>, current: Record<string, TaskIntent>, options: SourceCoverageOptions = {}): void {
  if (!Array.isArray(candidate.source_coverage)) throw new Error("source_coverage must explicitly list remaining source dispositions (or [] when all text is selected into IR)")
  const display = options.display ?? identityDisplay
  const entries = candidate.source_coverage
  const texts = sourceTexts(sources)
  const currentIds = new Set(currentEvents.filter(event => userText(event) !== undefined).map(event => event.event_id))
  const taskIds = new Set(candidate.groups.flatMap(group => group.task_refs))
  const items = Object.entries(current).filter(([id]) => taskIds.has(id)).flatMap(([, task]) => task.content)
  const oldItems = Object.entries(previous).filter(([id]) => taskIds.has(id)).flatMap(([, task]) => task.content)
  const activeSources = items.flatMap(item => item.sources)
  const oldSources = oldItems.flatMap(item => item.sources)
  const spansFor = (refs: readonly SourceRef[], sourceId: string) => refs.filter(ref => ref.source_id === sourceId).map(ref => validSpan(ref, texts, display))
  const superseded: SourceRef[] = []
  const adoptedByItem = new Map<ContentItem, SourceRef[]>()
  // Selecting source text into an IR item is already the model's normative
  // adoption decision. Derive its exact destination rather than asking for a
  // second copy. Other text still needs an explicit model-authored disposition.
  const selectedSources = items.filter(item => item.text_origin === "source").flatMap(item => item.sources)
  // The contract requires sources on every ir_change, so citing the text a
  // task, scope, binding or output change is based on is required behavior.
  // Such a citation declares where that text goes as well; it just cannot
  // dispose of a paragraph on its own (see the segment loop below).
  const citedSources = candidate.groups
    .filter(group => group.task_refs.some(taskId => taskIds.has(taskId)))
    .flatMap(group => group.ir_changes.flatMap(change => change.action === "edit" ? change.add : change.sources))
    .filter(source => source.span !== undefined)
  for (const item of items) if (item.text_origin === "source") adoptedByItem.set(item, item.sources)

  for (const [index, entry] of entries.entries()) {
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
      if (!covered(text, span.start, span.end, spansFor(recipients.flatMap(item => item.sources), entry.source.source_id))) throw new Error(`normative source_coverage[${index}] omits source text from its IR destinations`)
      for (const item of recipients) adoptedByItem.set(item, [...(adoptedByItem.get(item) ?? []), entry.source])
    } else {
      if (entry.requirements.length > 0) throw new Error(`non-normative source_coverage[${index}] cannot assign an IR requirement`)
      const overlapping = spansFor(activeSources, entry.source.source_id).some(active => text.slice(Math.max(active.start, span.start), Math.min(active.end, span.end)).trim() && active.start < span.end && span.start < active.end)
      if (overlapping) throw new Error(`source_coverage[${index}] classifies actively adopted text as ${entry.disposition}`)
      if (entry.disposition === "superseded") {
        const basisOk = entry.basis.some(ref => {
          if (!texts.has(ref.source_id)) return false
          try { validSpan(ref, texts, display); return true } catch { return false }
        })
        // "Available" is exactly what this check can prove: the reference
        // resolves inside the source set this batch's validation was given.  It
        // is not a claim about which sources the model request displayed.
        if (!basisOk) throw new Error(`superseded source_coverage[${index}] needs a resolvable source available to this batch as its change basis`)
        if (!covered(text, span.start, span.end, spansFor(oldSources, entry.source.source_id))) throw new Error(`superseded source_coverage[${index}] was not previously normative text`)
        superseded.push(entry.source)
      }
    }
  }
  // A paragraph this batch never names is not a contradiction to resolve: it is
  // background for the delegations the batch did make. The code writes that
  // default itself, so one unmentioned passage cannot invalidate an otherwise
  // complete batch, and the model writes an entry only to override it. The
  // default never covers text the batch adopted, cited or classified itself.
  // A citation on a task, scope, binding or output change proves where that
  // change came from; it is not a disposition, so the segment check below still
  // wants this text named.  The default has to be computed against the same set
  // that check accepts, or a cited-but-unclassified paragraph gets no default
  // and the batch dies on the very rule the default exists to relax.
  const entrySources = entries.map(entry => entry.source)
  const accounted = [...selectedSources, ...entrySources]
  const defaults: SourceDisposition[] = []
  for (const segment of sourceSegments(currentEvents)) {
    const text = texts.get(segment.source_id)!
    for (const range of residualRanges(text, segment.span.start, segment.span.end, spansFor(accounted, segment.source_id))) {
      defaults.push({
        source: { source_id: segment.source_id, digest: digestText(text), span: { unit: "utf16", start: range.start, end: range.end } },
        disposition: "context",
        requirements: [],
        reason: DEFAULT_SOURCE_REASON,
        basis: [],
      })
    }
  }
  if (defaults.length > 0) candidate.source_coverage = [...entries, ...defaults]
  // A carried delegation is an unresolved task from an earlier turn, not
  // background for this one.  It may be adopted, or explicitly deferred with a
  // reason, but it cannot be passed over in silence.
  for (const eventId of options.carriedEventIds ?? []) {
    const named = selectedSources.some(source => source.source_id === eventId)
      // Defaults do not count: falling through to "unselected by this batch"
      // is not an acknowledgment of the earlier delegation.
      || entries.some(entry => entry.source.source_id === eventId)
    if (!named) {
      throw new Error(`carried delegation ${display(eventId)} has no disposition: select its operative text into IR content, or write a source_coverage entry naming its passage (and a question when it still cannot be compiled)`)
    }
  }
  const allEntrySources = candidate.source_coverage.map(entry => entry.source)
  for (const segment of sourceSegments(currentEvents)) {
    const text = texts.get(segment.source_id)!
    const stored = spansFor([...selectedSources, ...allEntrySources], segment.source_id)
    // A change's citation can only account for the remainder of a paragraph
    // that the batch actually stores as a requirement or classifies.
    if (!stored.some(span => span.start < segment.span.end && segment.span.start < span.end)) {
      throw new Error(`source segment ${display(segment.source_id)}/${segment.segment_id} has no complete disposition: no content selection or source_coverage entry names it; select its operative text into IR or explicitly classify its remaining text`)
    }
    if (!disposed(text, segment.span.start, segment.span.end, spansFor([...selectedSources, ...citedSources, ...allEntrySources], segment.source_id))) {
      throw new Error(`source segment ${display(segment.source_id)}/${segment.segment_id} has no complete disposition; select its operative text into IR or explicitly classify its remaining text`)
    }
  }
  for (const item of items) for (const source of item.sources) {
    const span = validSpan(source, texts, display), text = texts.get(source.source_id)!
    const retained = oldItems.filter(old => old.item_id === item.item_id).flatMap(old => old.sources).filter(old => !currentIds.has(old.source_id))
    if (!covered(text, span.start, span.end, spansFor([...(adoptedByItem.get(item) ?? []), ...retained], source.source_id))) throw new Error(`new normative selection ${display(source.source_id)} in ${item.item_id} has no matching source_coverage assignment`)
  }
  for (const source of oldSources) {
    const span = validSpan(source, texts, display), text = texts.get(source.source_id)!
    if (!disposed(text, span.start, span.end, spansFor([...activeSources, ...superseded], source.source_id))) throw new Error(`previously normative source ${display(source.source_id)} was dropped without an explicit superseded disposition and current change basis`)
  }
}
