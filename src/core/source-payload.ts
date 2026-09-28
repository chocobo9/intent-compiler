import { digestOf, digestText, type Candidate, type CompilerEvent, type ContentItem, type IrChange, type SourceRef, type SourceSegment, type TaskIntent } from "./intent-contract.js"

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

function validSpan(source: SourceRef, texts: Map<string, string>): NonNullable<SourceRef["span"]> {
  const text = texts.get(source.source_id), span = source.span
  if (text === undefined || !span || span.unit !== "utf16" || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > text.length || source.digest !== digestText(text)) {
    throw new Error(`source payload requires a resolvable user text span: ${source.source_id}`)
  }
  return span
}

function sourceTexts(events: readonly CompilerEvent[]): Map<string, string> {
  return new Map(events.flatMap(event => { const text = userText(event); return text === undefined ? [] : [[event.event_id, text] as const] }))
}

/** Interpretation never overwrites selected source bytes. Adjacent selections merge. */
export function materializeSourceContent(task: TaskIntent, changes: readonly IrChange[], events: readonly CompilerEvent[]): void {
  const ids = new Set(changes.flatMap(change => change.action === "create" && change.target === "content" ? [change.local_ref] : change.action === "revise" && change.target === "content" ? [change.id] : []))
  const texts = sourceTexts(events)
  for (const item of task.content) {
    if (!ids.has(item.item_id)) continue
    if (item.sources.length === 0) throw new Error(`IR content ${item.item_id} has no selected normative source`)
    const sources: SourceRef[] = []
    for (const sourceId of texts.keys()) {
      const spans = item.sources.filter(source => source.source_id === sourceId).map(source => validSpan(source, texts)).sort((a, b) => a.start - b.start)
      for (const span of spans) {
        const last = sources.at(-1)
        if (last?.source_id === sourceId && last.span!.end >= span.start) last.span!.end = Math.max(last.span!.end, span.end)
        else sources.push({ source_id: sourceId, digest: digestText(texts.get(sourceId)!), span: { ...span } })
      }
    }
    item.interpretation = item.text
    item.text = sources.map(source => texts.get(source.source_id)!.slice(source.span!.start, source.span!.end)).join("\n\n")
    item.text_origin = "source"
    item.sources = sources
  }
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

/** Closed source accounting, without guessing whether the model chose the right role. */
export function validateSourceCoverage(candidate: Candidate, currentEvents: readonly CompilerEvent[], sources: readonly CompilerEvent[], previous: Record<string, TaskIntent>, current: Record<string, TaskIntent>): void {
  if (!Array.isArray(candidate.source_coverage)) throw new Error("source_coverage must explicitly list remaining source dispositions (or [] when all text is selected into IR)")
  const entries = candidate.source_coverage
  const texts = sourceTexts(sources)
  const currentIds = new Set(currentEvents.filter(event => userText(event) !== undefined).map(event => event.event_id))
  const taskIds = new Set(candidate.groups.flatMap(group => group.task_refs))
  const items = Object.entries(current).filter(([id]) => taskIds.has(id)).flatMap(([, task]) => task.content)
  const oldItems = Object.entries(previous).filter(([id]) => taskIds.has(id)).flatMap(([, task]) => task.content)
  const activeSources = items.flatMap(item => item.sources)
  const oldSources = oldItems.flatMap(item => item.sources)
  const spansFor = (refs: readonly SourceRef[], sourceId: string) => refs.filter(ref => ref.source_id === sourceId).map(ref => validSpan(ref, texts))
  const superseded: SourceRef[] = []
  const adoptedByItem = new Map<ContentItem, SourceRef[]>()
  // Selecting source text into an IR item is already the model's normative
  // adoption decision. Derive its exact destination rather than asking for a
  // second copy. Other text still needs an explicit model-authored disposition.
  const selectedSources = items.filter(item => item.text_origin === "source").flatMap(item => item.sources)
  for (const item of items) if (item.text_origin === "source") adoptedByItem.set(item, item.sources)

  for (const [index, entry] of entries.entries()) {
    const span = validSpan(entry.source, texts), text = texts.get(entry.source.source_id)!
    if (!entry.reason.trim()) throw new Error(`source_coverage[${index}] needs a role/revision explanation`)
    if (entry.disposition === "normative") {
      if (entry.requirements.length === 0) throw new Error(`normative source_coverage[${index}] has no IR destination`)
      const recipients: ContentItem[] = entry.requirements.map(ref => {
        const id = "local_ref" in ref ? ref.local_ref : ref.id
        const matches = items.filter(item => item.item_id === id)
        if (matches.length !== 1) throw new Error(`source_coverage[${index}] names unknown or ambiguous IR ${id}`)
        const item = matches[0]!
        if ("revision" in ref && (item.revision !== ref.revision || digestOf(item) !== ref.digest)) throw new Error(`source_coverage[${index}] names stale IR ${id}`)
        return item
      })
      if (!covered(text, span.start, span.end, spansFor(recipients.flatMap(item => item.sources), entry.source.source_id))) throw new Error(`normative source_coverage[${index}] omits source text from its IR destinations`)
      for (const item of recipients) adoptedByItem.set(item, [...(adoptedByItem.get(item) ?? []), entry.source])
    } else {
      if (entry.requirements.length > 0) throw new Error(`non-normative source_coverage[${index}] cannot assign an IR requirement`)
      const overlapping = spansFor(activeSources, entry.source.source_id).some(active => text.slice(Math.max(active.start, span.start), Math.min(active.end, span.end)).trim() && active.start < span.end && span.start < active.end)
      if (overlapping) throw new Error(`source_coverage[${index}] classifies actively adopted text as ${entry.disposition}`)
      if (entry.disposition === "superseded") {
        if (!entry.basis.some(ref => currentIds.has(ref.source_id) && validSpan(ref, texts))) throw new Error(`superseded source_coverage[${index}] needs the current user's change as basis`)
        if (!covered(text, span.start, span.end, spansFor(oldSources, entry.source.source_id))) throw new Error(`superseded source_coverage[${index}] was not previously normative text`)
        superseded.push(entry.source)
      }
    }
  }
  for (const segment of sourceSegments(currentEvents)) {
    if (!covered(texts.get(segment.source_id)!, segment.span.start, segment.span.end, spansFor([...selectedSources, ...entries.map(entry => entry.source)], segment.source_id))) throw new Error(`source segment ${segment.source_id}/${segment.segment_id} has no complete disposition; select its operative text into IR or explicitly classify its remaining text`)
  }
  for (const item of items) for (const source of item.sources) {
    const span = validSpan(source, texts), text = texts.get(source.source_id)!
    const retained = oldItems.filter(old => old.item_id === item.item_id).flatMap(old => old.sources).filter(old => !currentIds.has(old.source_id))
    if (!covered(text, span.start, span.end, spansFor([...(adoptedByItem.get(item) ?? []), ...retained], source.source_id))) throw new Error(`new normative selection ${source.source_id} in ${item.item_id} has no matching source_coverage assignment`)
  }
  for (const source of oldSources) {
    const span = validSpan(source, texts), text = texts.get(source.source_id)!
    if (!covered(text, span.start, span.end, spansFor([...activeSources, ...superseded], source.source_id))) throw new Error(`previously normative source ${source.source_id} was dropped without an explicit superseded disposition and current change basis`)
  }
}
