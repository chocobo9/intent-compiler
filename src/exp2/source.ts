import { createHash } from "node:crypto"

/**
 * Exp2 source log: each round's text is cut into three layers by text structure alone (DESIGN §4.2).
 * Lines may end in \n or \r\n; either way no byte of the text is changed.
 * Every block is a slice [start, end) of its round's text, and each layer tiles its parent exactly, so joining
 * any layer gives back the original byte for byte. Ids are positional (round, section, paragraph, unit, clause)
 * and carry a content hash; the same text always yields the same ids.
 *
 * - section: a heading and everything under it up to the next heading of the same or a higher level; text before
 *   the first heading is section S0. Sections nest; their children are their own paragraphs, then subsections.
 * - paragraph: the section's own content cut at blank lines; a blank line inside a fenced code block does not cut.
 * - sentence layer ("s"): the paragraph's units. A fenced code block, a table and a list item (with its continuation
 *   lines and any code inside it) are each one unit; prose is cut into sentences.
 * - clause ("c"): a sentence or a list item cut at commas, semicolons and parenthesised groups, never inside inline or
 *   fenced code. Code blocks and tables have no clauses.
 */

export type Level = "section" | "paragraph" | "sentence" | "clause"
export type BlockKind = "section" | "prose" | "list" | "code" | "table" | "mixed" | "sentence" | "item" | "clause"

export interface SourceBlock {
  id: string
  round: number
  level: Level
  kind: BlockKind
  parent: string | null
  children: string[]
  start: number
  end: number
  text: string
  hash: string
  /** Sections only: the heading line (without its newline) and its level; S0 has neither. */
  heading?: string
  heading_level?: number
}

export interface RoundSource {
  round: number
  text: string
  hash: string
  blocks: SourceBlock[]
}

export const LEVEL_RANK: Record<Level, number> = { section: 0, paragraph: 1, sentence: 2, clause: 3 }

export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 8)
}

interface Line { start: number; end: number; text: string }

function linesOf(text: string, start: number, end: number): Line[] {
  const out: Line[] = []
  let at = start
  while (at < end) {
    const nl = text.indexOf("\n", at)
    const stop = nl === -1 || nl >= end ? end : nl + 1
    out.push({ start: at, end: stop, text: text.slice(at, stop).replace(/\r?\n$/u, "") })
    at = stop
  }
  return out
}

const FENCE = /^\s*(```|~~~)/u
const HEADING = /^(#{1,6})\s+\S/u
const ITEM = /^\s*(?:[-*+]|\d+[.)]|[a-z][.)])\s+\S/u
const TABLE = /^\s*\|/u
const blank = (line: Line) => line.text.trim() === ""

/** Marks lines inside fenced code (fence lines included). */
function fenced(lines: Line[]): boolean[] {
  const inside: boolean[] = []
  let open = false
  for (const line of lines) {
    if (FENCE.test(line.text)) { inside.push(true); open = !open } else inside.push(open)
  }
  return inside
}

export function splitRound(round: number, text: string): RoundSource {
  if (!Number.isSafeInteger(round) || round < 1) throw new Error(`Invalid round ${round}`)
  const blocks: SourceBlock[] = []
  const lines = linesOf(text, 0, text.length)
  const code = fenced(lines)
  const headings = lines.flatMap((line, i) => {
    const m = !code[i] && HEADING.exec(line.text)
    return m ? [{ index: i, level: m[1].length }] : []
  })
  const make = (id: string, level: Level, kind: BlockKind, parent: string | null, start: number, end: number, extra: Partial<SourceBlock> = {}): SourceBlock => {
    const body = text.slice(start, end)
    const block: SourceBlock = { id, round, level, kind, parent, children: [], start, end, text: body, hash: contentHash(body), ...extra }
    blocks.push(block)
    if (parent) byId.get(parent)!.children.push(id)
    byId.set(id, block)
    return block
  }
  const byId = new Map<string, SourceBlock>()
  const prefix = `R${round}`
  // Sections in document order; a stack gives each its enclosing section.
  const firstHeading = headings.length ? lines[headings[0].index].start : text.length
  if (text.slice(0, firstHeading).trim() !== "") {
    const s0 = make(`${prefix}.S0`, "section", "section", null, 0, firstHeading)
    paragraphs(s0, 0, firstHeading)
  }
  const stack: { level: number; block: SourceBlock }[] = []
  headings.forEach((h, n) => {
    let endLine = lines.length
    for (let k = n + 1; k < headings.length; k++) if (headings[k].level <= h.level) { endLine = headings[k].index; break }
    const start = lines[h.index].start
    const end = endLine < lines.length ? lines[endLine].start : text.length
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop()
    const parent = stack.length ? stack[stack.length - 1].block.id : null
    const section = make(`${prefix}.S${n + 1}`, "section", "section", parent, start, end, { heading: lines[h.index].text, heading_level: h.level })
    stack.push({ level: h.level, block: section })
    // Own content: after the heading line, up to the next heading of any level.
    const ownEnd = n + 1 < headings.length ? Math.min(end, lines[headings[n + 1].index].start) : end
    paragraphs(section, lines[h.index].end, ownEnd)
  })
  // Children were appended in creation order: own paragraphs first, then subsections, as required.

  function paragraphs(section: SourceBlock, start: number, end: number): void {
    const own = linesOf(text, start, end)
    const inCode = fenced(own)
    let current: Line[] = []
    let gap = false
    let count = 0
    const flush = (until: number) => {
      if (!current.length) return
      // A paragraph keeps the blank lines after it, so the layer tiles the section exactly.
      const p = make(`${section.id}.P${++count}`, "paragraph", paragraphKind(current, fenced(current)), section.id, current[0].start, until)
      units(p, current)
      current = []
    }
    own.forEach((line, i) => {
      if (blank(line) && !inCode[i]) { gap = current.length > 0; return }
      if (gap) { flush(line.start); gap = false }
      current.push(line)
    })
    flush(end)
    // Blank lines before the first paragraph belong to the heading; there is nothing to attach them to otherwise.
    if (!count && text.slice(start, end).trim() !== "") throw new Error(`Section ${section.id} has content but no paragraph`)
  }

  function units(p: SourceBlock, plines: Line[]): void {
    const inCode = fenced(plines)
    type Group = { kind: "sentence" | "item" | "code" | "table"; lines: Line[] }
    const groups: Group[] = []
    let inItem = false
    plines.forEach((line, i) => {
      const last = groups[groups.length - 1]
      if (inCode[i]) {
        // A fence inside a list item stays with the item.
        if (inItem) { last.lines.push(line); return }
        const opening = FENCE.test(line.text) && !(last?.kind === "code" && !closed(last))
        if (opening) groups.push({ kind: "code", lines: [line] }); else last.lines.push(line)
        return
      }
      if (ITEM.test(line.text)) { groups.push({ kind: "item", lines: [line] }); inItem = true; return }
      if (inItem) { last.lines.push(line); return }
      if (TABLE.test(line.text)) {
        if (last?.kind === "table") last.lines.push(line); else groups.push({ kind: "table", lines: [line] })
        return
      }
      if (last?.kind === "sentence") last.lines.push(line); else groups.push({ kind: "sentence", lines: [line] })
    })
    let count = 0
    groups.forEach((g, gi) => {
      const start = gi === 0 ? p.start : g.lines[0].start
      const end = gi === groups.length - 1 ? p.end : groups[gi + 1].lines[0].start
      if (g.kind !== "sentence") {
        const unit = make(`${p.id}.s${++count}`, "sentence", g.kind, p.id, start, end)
        // A list item may be cut into clauses (to say which part a partial revision changes); code and tables are not.
        if (g.kind === "item") clauses(unit)
        return
      }
      for (const [a, b] of sentences(start, end)) {
        const s = make(`${p.id}.s${++count}`, "sentence", "sentence", p.id, a, b)
        clauses(s)
      }
    })
  }

  function closed(group: { lines: Line[] }): boolean {
    return group.lines.length > 1 && FENCE.test(group.lines[group.lines.length - 1].text)
  }

  function sentences(start: number, end: number): [number, number][] {
    const cuts = boundaries(start, end, (i, depth) => {
      if (depth > 0) return null
      const ch = text[i]
      if (ch !== "." && ch !== "!" && ch !== "?") return null
      let j = i + 1
      while (j < end && /["')\]*]/u.test(text[j])) j++
      if (j < end && !/\s/u.test(text[j])) return null
      if (ch === "." && abbreviation(i)) return null
      while (j < end && /\s/u.test(text[j])) j++
      return j < end ? j : null
    })
    return spans(start, end, cuts)
  }

  function clauses(s: SourceBlock): void {
    const cuts = boundaries(s.start, s.end, (i, depth) => {
      const ch = text[i]
      if (depth === 0 && (ch === "," || ch === ";") && /\s/u.test(text[i + 1] ?? "")) {
        let j = i + 1
        while (j < s.end && /\s/u.test(text[j])) j++
        return j < s.end ? j : null
      }
      if (ch === "(" && depth === 0) return i
      if (ch === ")" && depth === 1) {
        let j = i + 1
        while (j < s.end && /[.,;:\s]/u.test(text[j])) j++
        return j < s.end ? j : null
      }
      return null
    })
    // A piece with no letters or digits (stray punctuation) joins its neighbour, so no clause is empty of content.
    const pieces = spans(s.start, s.end, cuts)
    const merged: [number, number][] = []
    for (const piece of pieces) {
      if (merged.length && !/[\p{L}\p{N}]/u.test(text.slice(piece[0], piece[1]))) merged[merged.length - 1][1] = piece[1]
      else if (merged.length && !/[\p{L}\p{N}]/u.test(text.slice(...merged[merged.length - 1]))) merged[merged.length - 1][1] = piece[1]
      else merged.push([...piece])
    }
    merged.forEach(([a, b], k) => make(`${s.id}.c${k + 1}`, "clause", "clause", s.id, a, b))
  }

  /**
   * Scans [start, end) outside inline code and fenced code; `at` gets the bracket depth before the character and
   * returns where a new piece starts, or null.
   */
  function boundaries(start: number, end: number, at: (i: number, depth: number) => number | null): number[] {
    const out: number[] = []
    const range = linesOf(text, start, end)
    const inFence = fenced(range)
    const skip = new Map(range.filter((_, k) => inFence[k]).map(l => [l.start, l.end]))
    let depth = 0
    let tick = false
    for (let i = start; i < end; i++) {
      if (skip.has(i)) { i = skip.get(i)! - 1; continue }
      const ch = text[i]
      if (ch === "`") { tick = !tick; continue }
      if (tick) continue
      const cut = at(i, depth)
      if (ch === "(") depth++
      else if (ch === ")" && depth > 0) depth--
      if (cut !== null && cut > start && cut < end && (!out.length || cut > out[out.length - 1])) out.push(cut)
    }
    return out
  }

  function abbreviation(dot: number): boolean {
    const before = text.slice(Math.max(0, dot - 5), dot + 1).toLowerCase()
    return /(?:^|[^a-z])(?:e\.g|i\.e|etc|vs|cf|approx)\.$/u.test(before)
  }

  return { round, text, hash: contentHash(text), blocks }
}

function paragraphKind(lines: Line[], inCode: boolean[]): BlockKind {
  const content = lines.filter((_, i) => !inCode[i])
  const hasCode = inCode.some(Boolean)
  if (!content.length) return "code"
  if (content.every(l => TABLE.test(l.text))) return hasCode ? "mixed" : "table"
  if (ITEM.test(content[0].text)) return "list"
  if (content.some(l => ITEM.test(l.text)) || hasCode) return "mixed"
  return "prose"
}

function spans(start: number, end: number, cuts: number[]): [number, number][] {
  const points = [start, ...cuts.filter(c => c > start && c < end), end]
  return points.slice(0, -1).map((p, i) => [p, points[i + 1]])
}

/** Every layer's blocks, in document order, must tile the text with no empty block. */
export function tilingProblems(source: RoundSource): string[] {
  const problems: string[] = []
  const byId = new Map(source.blocks.map(b => [b.id, b]))
  for (const b of source.blocks) {
    if (b.text !== source.text.slice(b.start, b.end)) problems.push(`${b.id}: text differs from its slice`)
    if (b.text.trim() === "") problems.push(`${b.id}: empty block`)
    if (b.hash !== contentHash(b.text)) problems.push(`${b.id}: hash mismatch`)
  }
  const top = source.blocks.filter(b => b.level === "section" && b.parent === null)
  if (top.map(b => b.text).join("") !== source.text) problems.push("sections do not tile the round")
  for (const b of source.blocks) {
    if (!b.children.length) continue
    const kids = b.children.map(id => byId.get(id)!)
    // A section's heading line sits before its first child; everything else must be covered by the children.
    const head = b.level === "section" ? source.text.slice(b.start, kids[0].start) : ""
    if (b.level === "section" && b.heading !== undefined && head.split(/\r?\n/u)[0] !== b.heading) problems.push(`${b.id}: heading not before children`)
    if (head.trim() !== "" && b.heading === undefined) problems.push(`${b.id}: uncovered text before children`)
    if (b.level === "section" && head.replace(b.heading ?? "", "").trim() !== "") problems.push(`${b.id}: uncovered text after heading`)
    if (head + kids.map(k => k.text).join("") !== b.text) problems.push(`${b.id}: children do not tile it`)
  }
  return problems
}

/**
 * The round's text annotated with block ids, for the model. Sections and paragraphs get a line marker; units
 * (‹s2›) and clauses (‹s2.c1›) get inline markers only where a paragraph or sentence has more than one.
 */
export function annotate(source: RoundSource): string {
  const byId = new Map(source.blocks.map(b => [b.id, b]))
  const marks = new Map<number, string[]>()
  // A paragraph marker takes its own line, ended the way the text ends its lines.
  const eol = source.text.includes("\r\n") ? "\r\n" : "\n"
  const put = (at: number, mark: string) => marks.set(at, [...(marks.get(at) ?? []), mark])
  for (const b of source.blocks) {
    if (b.level === "section") put(b.start, `⟦${b.id}#${b.hash}⟧ `)
    else if (b.level === "paragraph") put(b.start, `⟦${b.id}#${b.hash}⟧${eol}`)
    else {
      const parent = byId.get(b.parent!)!
      if (parent.children.length < 2) continue
      const rel = b.level === "sentence" ? b.id.slice(parent.id.length + 1) : b.id.slice(byId.get(parent.parent!)!.id.length + 1)
      // A unit that starts on a new line (item, code, table) gets its marker at the line start, before indentation.
      const lineStart = source.text.lastIndexOf("\n", b.start - 1) + 1
      const at = source.text.slice(lineStart, b.start).trim() === "" && b.kind !== "clause" ? lineStart : b.start
      put(Math.max(at, parent.start), `‹${rel}›`)
    }
  }
  let out = ""
  for (let i = 0; i <= source.text.length; i++) {
    for (const m of marks.get(i) ?? []) out += m
    if (i < source.text.length) out += source.text[i]
  }
  return out
}

/** Block ids may be cited with a hash suffix (`R3.S2.P1#ab12cd34`); returns the bare id and the hash, if any. */
export function parseRef(ref: string): { id: string; hash?: string } {
  const at = ref.indexOf("#")
  return at === -1 ? { id: ref.trim() } : { id: ref.slice(0, at).trim(), hash: ref.slice(at + 1).trim() }
}

export function roundOf(id: string): number {
  const m = /^R(\d+)\./u.exec(id)
  return m ? Number(m[1]) : NaN
}
