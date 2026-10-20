import type { CompilerEvent, ContentItem, TaskIntent } from "./intent-contract.js"
import { sourceSegments, userText } from "./source-payload.js"

type Spans = Map<string, Array<{ start: number; end: number; item: ContentItem }>>
export function spansOf(items: Iterable<ContentItem>): Spans {
  const out: Spans = new Map()
  for (const item of items) for (const x of item.sources) if (x.span) out.set(x.source_id, [...(out.get(x.source_id) ?? []), { start: x.span.start, end: x.span.end, item }])
  return out
}

/**
 * Per input, the characters this delivery cuts: what an accepted or the current IR selected and this delivery
 * does not deliver (withdrawn, superseded, paused or unresolved). Text no IR ever selected always stays. A line
 * left holding only its list marker or blanks goes with its cut text; a paragraph cut whole also takes one of the
 * blank lines around it.
 */
export function cutMasks(events: readonly CompilerEvent[], earlier: ReadonlyArray<Record<string, TaskIntent>>, current: Record<string, TaskIntent>,
  delivered: readonly ContentItem[]): Map<string, Uint8Array> {
  const before = spansOf(earlier.flatMap(ir => Object.values(ir).flatMap(t => t.content)))
  const now = spansOf(Object.values(current).flatMap(t => t.content))
  const kept = spansOf(delivered)
  return new Map(events.map((event, index) => {
    const text = userText(event)!
    const mark = (spans: Spans) => {
      const mask = new Uint8Array(text.length)
      for (const x of spans.get(event.event_id) ?? []) {
        if (!(0 <= x.start && x.start <= x.end && x.end <= text.length)) throw Error(`IR span ${x.start}-${x.end} lies outside user input ${index + 1}`)
        mask.fill(1, x.start, x.end)
      }
      return mask
    }
    const earlierMask = mark(before), nowMask = mark(now), keep = mark(kept)
    const cut = earlierMask.map((x, i) => (x === 1 || nowMask[i] === 1) && keep[i] === 0 ? 1 : 0)
    const lines: Array<[number, number]> = []
    for (let start = 0; start < text.length;) { const nl = text.indexOf("\n", start); const end = nl < 0 ? text.length : nl + 1; lines.push([start, end]); start = end }
    const blank = (k: number) => k < 0 || k >= lines.length || /^[ \t]*\r?\n?$/u.test(text.slice(...lines[k]!))
    lines.forEach(([start, end], k) => {
      const rest = [...text.slice(start, end)].filter((_, i) => cut[start + i] === 0).join("")
      if (!cut.subarray(start, end).includes(1) || !/^[ \t]*(?:[-*+]|\d+[.)])?[ \t]*\r?\n?$/u.test(rest)) return
      cut.fill(1, start, end)
      if (blank(k - 1) && k + 1 < lines.length && blank(k + 1)) cut.fill(1, ...lines[k + 1]!)
    })
    return [event.event_id, cut] as const
  }))
}

/** A paragraph of one input as delivered (cut characters removed), with the span it covers. */
export interface Block { source_id: string; input: number; start: number; end: number; text: string }

/**
 * The inputs' paragraphs (blank-line segments, merged so that no code fence is split) with their cut characters
 * removed; a paragraph left blank is dropped.
 */
export function blocks(events: readonly CompilerEvent[], masks: ReadonlyMap<string, Uint8Array>): Block[] {
  const order = new Map(events.map((e, i) => [e.event_id, i + 1]))
  const out: Block[] = []
  let open: { source_id: string; start: number; end: number } | undefined
  const flush = () => {
    if (!open) return
    const text = userText(events.find(e => e.event_id === open!.source_id)!)!
    const mask = masks.get(open.source_id)!
    let kept = ""
    for (let i = open.start; i < open.end; i++) if (mask[i] === 0) kept += text[i]
    if (kept.trim()) out.push({ source_id: open.source_id, input: order.get(open.source_id)!, start: open.start, end: open.end, text: kept })
    open = undefined
  }
  for (const segment of sourceSegments(events)) {
    if (open && open.source_id === segment.source_id) open.end = segment.span.end
    else { flush(); open = { source_id: segment.source_id, start: segment.span.start, end: segment.span.end } }
    // A paragraph inside an unclosed code fence continues into the next one.
    const text = userText(events.find(e => e.event_id === open!.source_id)!)!.slice(open.start, open.end)
    if (((text.match(/^[ \t]*```/gmu) ?? []).length % 2) === 0) flush()
  }
  flush()
  return out
}

export interface Group { number: number; label: string; items: string[]; blocks: Block[]; effective: string[]; see_also: Array<{ group: number; names: string[] }> }

const IDENT = /`([A-Za-z][A-Za-z0-9_-]{2,})`/gu
/** The names a group's paragraphs define: backticked names in their heading lines. */
const definedNames = (g: Group) => new Set(g.blocks.flatMap(b => b.text.split("\n").filter(l => /^\s*#{1,6}\s/u.test(l)).flatMap(l => [...l.matchAll(IDENT)].map(m => m[1]!))))
const writesName = (text: string, name: string) => text.includes(`\`${name}\``) || text.includes(`"${name}"`)

/**
 * v8 (scope item 1): every current paragraph of every input verbatim, exactly once, grouped by the IR content item
 * that selects it (most overlap, then IR order), each labelled with its user update; withdrawn or superseded text is
 * cut. A paragraph no delivered item selects goes to `outside`, in input order. Code adds "see also" pointers by
 * name: a group whose text writes a name another group defines in its headings, or whose item selects a paragraph
 * another group holds.
 */
export function groupOriginals(events: readonly CompilerEvent[], masks: ReadonlyMap<string, Uint8Array>, current: Record<string, TaskIntent>,
  delivered: readonly ContentItem[], effective: ReadonlyArray<{ item: ContentItem; text: string }>): { groups: Group[]; outside: Block[] } {
  const ordered = Object.values(current).flatMap(t => t.content).filter(c => delivered.some(d => d.item_id === c.item_id))
  const rank = new Map(ordered.map((c, i) => [c.item_id, i]))
  const owner = new Map<Block, ContentItem>()
  const all = blocks(events, masks)
  const overlap = (item: ContentItem, b: Block) => item.sources.filter(x => x.span && x.source_id === b.source_id)
    .reduce((n, x) => n + Math.max(0, Math.min(x.span!.end, b.end) - Math.max(x.span!.start, b.start)), 0)
  for (const b of all) {
    const best = ordered.map(item => ({ item, n: overlap(item, b) })).filter(x => x.n > 0).sort((a, c) => c.n - a.n || rank.get(a.item.item_id)! - rank.get(c.item.item_id)!)[0]
    if (best) owner.set(b, best.item)
  }
  // A paragraph of headings only that no item selects goes with the paragraph under it (the next one of the same input).
  const headingOnly = (b: Block) => b.text.split("\n").filter(l => l.trim()).every(l => /^\s*#{1,6}\s/u.test(l))
  for (let i = all.length - 1; i >= 0; i--) {
    const b = all[i]!, next = all[i + 1]
    if (!owner.has(b) && headingOnly(b) && next && next.source_id === b.source_id && owner.has(next)) owner.set(b, owner.get(next)!)
  }
  // A paragraph no item selects inside a requirement's section (after a paragraph a group holds, before the next
  // top-level heading of the same input) goes with that group; text before an input's first section stays outside.
  let context: ContentItem | undefined, source: string | undefined
  for (const b of all) {
    if (b.source_id !== source) { source = b.source_id; context = undefined }
    if (owner.has(b)) { context = owner.get(b); continue }
    if (/^\s*#{1,2}\s/u.test(b.text)) { context = undefined; continue }
    if (context) owner.set(b, context)
  }
  const groups: Group[] = []
  for (const item of ordered) {
    const mine = all.filter(b => owner.get(b) === item)
    const notes = effective.filter(e => e.item.item_id === item.item_id).map(e => e.text)
    if (!mine.length && !notes.length) continue
    // Zero copy: a group is named by its number and the updates it draws from; its own headings name it.
    const inputs = [...new Set(mine.map(b => b.input))].sort((a, c) => a - c)
    groups.push({ number: groups.length + 1, label: inputs.length ? `user update${inputs.length > 1 ? "s" : ""} ${inputs.join(", ")}` : "statement only", items: [item.item_id], blocks: mine, effective: notes, see_also: [] })
  }
  const byItem = new Map(groups.map(g => [g.items[0]!, g]))
  const defined = new Map(groups.map(g => [g.number, definedNames(g)]))
  for (const g of groups) {
    const text = g.blocks.map(b => b.text).join("\n")
    const pointers = new Map<number, Set<string>>()
    for (const h of groups) {
      if (h === g) continue
      const names = [...defined.get(h.number)!].filter(n => !defined.get(g.number)!.has(n) && writesName(text, n))
      if (names.length) pointers.set(h.number, new Set(names))
    }
    // A paragraph this group's item selects that another group holds.
    const item = ordered.find(c => c.item_id === g.items[0])!
    for (const b of all) {
      const holder = owner.get(b)
      if (!holder || holder === item || overlap(item, b) === 0) continue
      const h = byItem.get(holder.item_id)
      if (h && !pointers.has(h.number)) pointers.set(h.number, new Set())
    }
    g.see_also = [...pointers].sort((a, c) => a[0] - c[0]).map(([group, names]) => ({ group, names: [...names].sort() }))
  }
  return { groups, outside: all.filter(b => !owner.has(b)) }
}

/** The grouped original text as delivered. */
export function groupedSection(result: ReturnType<typeof groupOriginals>): string {
  const run = (bs: readonly Block[]) => {
    const parts: string[] = []
    let last: number | undefined
    for (const b of [...bs].sort((a, c) => a.input - c.input || a.start - c.start)) {
      if (b.input !== last) parts.push(`[from user update ${b.input}]`)
      parts.push(b.text.replace(/\s+$/u, ""))
      last = b.input
    }
    return parts.join("\n\n")
  }
  const body = result.groups.map(g => [
    `## Group ${g.number} (${g.label})`,
    run(g.blocks),
    ...g.effective.map(e => e),
    ...(g.see_also.length ? [`See also: ${g.see_also.map(x => `group ${x.group}${x.names.length ? ` (${x.names.map(n => `\`${n}\``).join(", ")})` : ""}`).join("; ")}`] : []),
  ].filter(Boolean).join("\n\n")).join("\n\n")
  const outside = result.outside.length ? `\n\n# Original text outside the groups\n${OUTSIDE_NOTE}\n\n${run(result.outside)}` : ""
  return `# Original requirements, grouped by requirement\n${GROUPED_NOTE}\n\n${body}${outside}\n\n`
}

export const GROUPED_NOTE = "Every current passage of every user update so far, verbatim and once, grouped by the requirement it belongs to; each passage is labelled with the update it comes from, and within a group later updates follow earlier ones (a later update governs what it changes). Text an update withdrew or replaced is left out. This is the authority for what holds."
export const OUTSIDE_NOTE = "Passages of the user updates that belong to no single requirement above (introductions, general statements), verbatim and in order."
