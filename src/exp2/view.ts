import type { BlockState, Modification, Registry } from "./registry.js"
import { annotateRange, type SourceBlock } from "./source.js"

/**
 * Object view: every source block an object holds, in round order. Text is always shown as a whole section or
 * paragraph with the headings above it; when the object holds only some units of a paragraph, those units are
 * marked «…», never cut out. Units that later text replaced are marked ⟦…⟧, and each replacement is shown as a
 * pair side by side: the paragraph that holds the changed unit, and the paragraph that holds the new text, each with
 * its heading path.
 */

export interface ViewSide {
  round: number
  context: string
  heading_path: string[]
  text: string
  /** Ids inside the context that the text marks. */
  marked: string[]
}

export interface ViewPair {
  round: number
  change: string
  kind: Modification["kind"]
  by_object: string
  by_object_name: string
  /** The paragraphs (with heading paths) that hold the changed units; a whole section when a section is the unit. */
  old: ViewSide[]
  new: ViewSide[]
}

export interface ViewEntry extends ViewSide {
  owned: string[]
  states: { block: string; state: BlockState }[]
  pairs: ViewPair[]
}

export interface ObjectView {
  id: string
  name: string
  version: number
  entries: ViewEntry[]
}

export function contextOf(registry: Registry, id: string): SourceBlock {
  return registry.lineage(id).find(b => b.level === "section" || b.level === "paragraph")!
}

function headingPath(registry: Registry, context: SourceBlock): string[] {
  const sections = registry.lineage(context.id).slice(context.level === "section" ? 1 : 0).filter(b => b.level === "section" && b.heading)
  return sections.reverse().map(b => b.heading!.trim())
}

/** Inserts marks around the given ids' spans inside the context text. */
function mark(registry: Registry, context: SourceBlock, spans: { id: string; open: string; close: string }[]): string {
  const inserts: { at: number; text: string; order: number }[] = []
  for (const s of spans) {
    if (s.id === context.id) continue
    const b = registry.block(s.id)!
    // Marks sit around the content, not the trailing blank lines.
    const end = b.start + b.text.trimEnd().length
    inserts.push({ at: b.start - context.start, text: s.open, order: 1 }, { at: end - context.start, text: s.close, order: 0 })
  }
  inserts.sort((a, b) => b.at - a.at || a.order - b.order)
  let text = context.text
  for (const i of inserts) text = text.slice(0, i.at) + i.text + text.slice(i.at)
  return text
}

function side(registry: Registry, context: SourceBlock, spans: { id: string; open: string; close: string }[]): ViewSide {
  return { round: context.round, context: context.id, heading_path: headingPath(registry, context), text: mark(registry, context, spans), marked: spans.map(s => s.id).filter(id => id !== context.id) }
}

export function objectView(registry: Registry, objectId: string): ObjectView {
  const object = registry.objects.get(objectId)
  if (!object) throw new Error(`Unknown object ${objectId}`)
  const groups = new Map<string, typeof object.blocks>()
  for (const own of object.blocks) {
    const ctx = contextOf(registry, own.block).id
    groups.set(ctx, [...(groups.get(ctx) ?? []), own])
  }
  const entries = [...groups.entries()].map(([ctxId, owns]): ViewEntry => {
    const context = registry.block(ctxId)!
    // One mark per replaced unit, however many later texts replaced it.
    const labels = new Map<string, string[]>()
    for (const m of owns.flatMap(o => o.modifications)) for (const p of m.parts) labels.set(p, [...new Set([...(labels.get(p) ?? []), `R${m.round} ${(m.amended ?? []).includes(p) ? "amended" : m.kind}`])])
    const replacedSpans = [...labels.entries()].map(([id, l]) => ({ id, open: "⟦", close: `⟧(${l.join(", ")})` }))
    const ownedSpans = owns.map(o => ({ id: o.block, open: "«", close: "»" }))
    const base = side(registry, context, [...ownedSpans, ...replacedSpans])
    const grouped = (ids: string[], open: string, close: string) => {
      const groups = new Map<string, string[]>()
      for (const id of ids) { const c = contextOf(registry, id).id; groups.set(c, [...(groups.get(c) ?? []), id]) }
      return [...groups.entries()].map(([c, members]) => side(registry, registry.block(c)!, members.map(id => ({ id, open, close }))))
    }
    const pairs = owns.flatMap(o => o.modifications.map((m): ViewPair => ({
      round: m.round, change: m.change, kind: m.kind, by_object: m.by_object, by_object_name: registry.objects.get(m.by_object)!.name,
      old: grouped(m.parts, "⟦", "⟧"),
      new: grouped(m.by, "«", "»"),
    })))
    return { ...base, owned: owns.map(o => o.block), states: owns.map(o => ({ block: o.block, state: o.state })), pairs }
  })
  entries.sort((a, b) => a.round - b.round || registry.block(a.context)!.start - registry.block(b.context)!.start)
  return { id: object.id, name: object.name, version: object.version, entries }
}

const cell = (text: string) => text.trimEnd().replace(/\|/gu, "\\|").replace(/\n/gu, "<br>")

export function renderObjectView(view: ObjectView): string {
  const out = [`# ${view.id} ${view.name} @v${view.version}`]
  for (const e of view.entries) {
    const states = e.states.filter(s => s.state !== "active").map(s => `${s.block} ${s.state}`)
    out.push(`\n## R${e.round} · ${e.context}${e.heading_path.length ? ` · ${e.heading_path.join(" › ")}` : ""}${states.length ? ` · [${states.join("; ")}]` : ""}`, "", e.text.trimEnd())
    for (const p of e.pairs) {
      const both = (sides: ViewSide[]) => sides.map(n => cell([...n.heading_path, n.text].join("\n"))).join("<br><br>")
      const label = (sides: ViewSide[]) => sides.map(n => `R${n.round}, ${n.context}`).join("; ")
      out.push("", `### R${p.round} ${p.kind} (${p.change}; new text in ${p.by_object} ${p.by_object_name})`, "", `| old (${label(p.old)}) | new (${label(p.new)}) |`, "|---|---|")
      out.push(`| ${both(p.old)} | ${both(p.new)} |`)
    }
  }
  return out.join("\n") + "\n"
}

// ------------------------------------------------------------------ the current view and the round's package (§6c)

interface Cut { start: number; end: number; note: string }

const within = (registry: Registry, inner: string, outer: string) => registry.lineage(inner).some(b => b.id === outer)
const overlaps = (registry: Registry, a: string, b: string) => within(registry, a, b) || within(registry, b, a)
/** A span's content, without the blank lines that follow it (the layout around a cut stays). */
const contentEnd = (b: SourceBlock) => b.start + b.text.trimEnd().length
const viewCache = new WeakMap<Registry, Map<string, string>>()

/**
 * One object's requirements as they stand after `round` (DESIGN §6c, view; §6a step 2): a pure function of the
 * registry, cached by object, round and the registry's change count.
 * - Its blocks up to `round`, by round and document order; a block wholly replaced or withdrawn is not there.
 * - A unit a later round revised (a sentence, a list item, a clause) is replaced in place by the units revising it,
 *   each under its own id; those units are not given again where they stand.
 * - A withdrawn unit goes; a code block or table revised goes whole. The text that withdrew or revised it is there,
 *   in its own place (its round), whichever object owns it.
 * - A heading path line where it changes; paragraph ids as `⟦R2.S13.P4⟧`, units as `‹s2›` (or their full id when
 *   brought in place). No other marker.
 */
export function currentView(registry: Registry, object: string, round: number): string {
  const key = `${object}@${round}#${registry.changes.length}`
  let cache = viewCache.get(registry)
  if (!cache) viewCache.set(registry, cache = new Map())
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const text = renderView(registry, object, round)
  cache.set(key, text)
  return text
}

function renderView(registry: Registry, object: string, round: number): string {
  const o = registry.objects.get(object)
  if (!o) return ""
  const own = o.blocks.filter(b => b.round <= round)
  const gone = new Set<string>(), inline = new Set<string>(), extra = new Set<string>()
  const cuts = new Map<string, Cut[]>()
  const cut = (block: string, c: Cut) => cuts.set(block, [...(cuts.get(block) ?? []), c])
  for (const b of own) for (const m of b.modifications.filter(x => x.round <= round)) {
    const whole = m.parts.includes(b.block)
    if (whole) gone.add(b.block)
    const amended = new Set(m.amended ?? [])
    const parts = m.parts.filter(p => p !== b.block && within(registry, p, b.block)).map(p => registry.block(p)!).sort((x, y) => x.start - y.start)
    // Revised units (not withdrawn, not a code block or table) take the revising text in place, at the first of them.
    const replaced = m.kind === "withdraw" || whole ? [] : parts.filter(p => !amended.has(p.id))
    for (const p of parts) cut(b.block, { start: p.start, end: contentEnd(p), note: p === replaced[0] ? inlineText(registry, m.by) : "" })
    for (const u of m.by) (replaced.length ? inline : extra).add(u)
  }
  // Units given in place are not given again where they stand: in this object's blocks they are cut.
  for (const b of own) for (const u of inline) if (u !== b.block && within(registry, u, b.block)) { const x = registry.block(u)!; cut(b.block, { start: x.start, end: contentEnd(x), note: "" }) }
  const blocks = own.filter(b => !gone.has(b.block) && !inline.has(b.block)).map(b => b.block)
  for (const u of extra) if (!inline.has(u) && registry.block(u)!.round <= round && !blocks.some(b => overlaps(registry, u, b))) blocks.push(u)
  const ordered = blocks.map(id => registry.block(id)!).sort((x, y) => x.round - y.round || x.start - y.start)
  const out: string[] = []
  let path = ""
  for (const b of ordered) {
    const text = renderSpan(registry, b, cuts.get(b.id) ?? []).trimEnd()
    // A block left with no text of its own (its units given in place elsewhere) is not there.
    if (!text.replace(/⟦[^⟧]*⟧|‹[^›]*›/gu, "").split(/\r?\n/u).some(l => l.trim() && !/^#+\s/u.test(l.trim()))) continue
    const p =[`R${b.round}`, ...headingPath(registry, contextOf(registry, b.id)).map(h => h.replace(/^#+\s*/u, ""))].join(" › ")
    if (p !== path) { out.push(`## ${p}`); path = p }
    out.push(text)
  }
  return out.length ? out.join("\n\n") + "\n" : ""
}

/** A block's annotated text with its cuts; hashes dropped; a unit below a paragraph led by its full id. */
function renderSpan(registry: Registry, b: SourceBlock, cuts: readonly Cut[]): string {
  const source = registry.sources.get(b.round)!
  // Cuts of the same span (two revisions of one unit) give their notes together; a cut inside another goes.
  const merged: Cut[] = []
  for (const c of [...cuts].sort((x, y) => x.start - y.start || y.end - x.end)) {
    const last = merged.at(-1)
    if (last && c.start === last.start && c.end === last.end) { if (c.note && !last.note.includes(c.note)) last.note = [last.note, c.note].filter(Boolean).join(" ") }
    else if (!last || c.start >= last.end) merged.push({ ...c })
  }
  const sorted = merged
  const text = annotateRange(source, b.start, b.end, sorted).replace(/⟦([^#⟧]+)#[0-9a-f]{8}⟧/gu, "⟦$1⟧")
  return b.level === "sentence" || b.level === "clause" ? `⟦${b.id}⟧ ${text.replace(/^‹[^›]*›/u, "")}` : text
}

/** The text of units brought in place of what they revise, each under its full id. */
function inlineText(registry: Registry, units: readonly string[]): string {
  const texts = units.map(u => registry.block(u)!).map(b => `‹${b.id}›${b.text.trim()}`)
  // List items stay one to a line.
  return texts.join(units.some(u => /^\s*(?:[-*+]|\d+[.)])\s/u.test(registry.block(u)!.text)) ? "\n" : " ")
}

export type PackageWhy = "this round" | "edge" | "open item"
export interface PackageObject { object: string; name: string; why: PackageWhy; via: string[]; view: string }

/**
 * The round's package (DESIGN §6c, round package; §6a step 3), by object: the objects this round adds or revises;
 * earlier objects one relation edge of the attribution away from them; the objects the open items' units belong to.
 * One hop only, nothing inferred. Each with its current view; this round's first, then the earlier ones, each in id
 * order.
 */
export function roundPackage(registry: Registry, round: number, open: readonly { id: string; units: readonly string[] }[] = []): PackageObject[] {
  const num = (id: string) => Number(id.slice(1))
  const changed = new Set(registry.roundScope(round).map(c => c.object))
  const ownerOf = (id: string) => { const o = /^O\d+$/u.test(id) ? id : registry.coverOf(id)?.owner; return o && o !== "none" && registry.objects.has(o) ? o : null }
  const earlier = new Map<string, { why: PackageWhy; via: string[] }>()
  const bring = (o: string | null, why: PackageWhy, via: string) => {
    if (!o || changed.has(o)) return
    const e = earlier.get(o) ?? { why, via: [] }
    if (why === "edge") e.why = "edge"
    if (!e.via.includes(via)) e.via.push(via)
    earlier.set(o, e)
  }
  for (const e of registry.references.filter(x => x.round <= round)) {
    const from = ownerOf(e.from), to = ownerOf(e.to)
    if (from && changed.has(from)) bring(to, "edge", `${e.from} ${e.kind} ${e.to}`)
    if (to && changed.has(to)) bring(from, "edge", `${e.from} ${e.kind} ${e.to}`)
  }
  for (const item of open) for (const u of item.units) bring(ownerOf(u), "open item", item.id)
  const make = (object: string, why: PackageWhy, via: string[]): PackageObject => ({ object, name: registry.objects.get(object)!.name, why, via, view: currentView(registry, object, round) })
  return [
    ...[...changed].filter(o => registry.objects.has(o)).sort((a, b) => num(a) - num(b)).map(o => make(o, "this round", [])),
    ...[...earlier.entries()].sort((a, b) => num(a[0]) - num(b[0])).map(([o, e]) => make(o, e.why, e.via)),
  ].filter(p => p.view.trim() !== "")
}

/** A guard of the package (§6c, round package item 3): what it runs and what it gets now, never what it expects. */
export interface PackageGuard { id: string; object: string | null; args: string[]; files: string[]; units: string[]; output: string | null }

export const packageHeader = (p: PackageObject) => `### ${p.object} ${p.name} — ${p.why === "this round" ? "this round" : `earlier, brought in by ${p.why === "edge" ? "the edge" : "the open item"} ${p.via.join("; ")}`}`

/** The package's requirements as the executor, the reviewer and the formalizer read them: each object's header and view. */
export function renderPackage(pkg: readonly PackageObject[]): string {
  return pkg.map(p => `${packageHeader(p)}\n\n${p.view.trimEnd()}\n`).join("\n")
}

export function renderGuardList(guards: readonly PackageGuard[]): string {
  return guards.map(g => `- ${g.id} (rests on ${g.units.join(", ")}): command ${JSON.stringify(g.args)}; input files ${g.files.join(", ") || "none"}${g.output !== null ? `; now: ${g.output}` : ""}`).join("\n")
}

export interface PackageOverflow { limit: number; chars: number; dropped: string[]; outputs_dropped: boolean; still_over: boolean }

/**
 * The package within its limit (§6c, round package item 5: three times this round's text): first the earlier objects
 * brought in only by refers_to edges go, the last in order first; then the guards' outputs. This round's objects and
 * the open items' objects stay. Null overflow: it fitted.
 */
export function fitPackage(registry: Registry, round: number, pkg: readonly PackageObject[], guards: readonly PackageGuard[]): { pkg: PackageObject[]; guards: PackageGuard[]; overflow: PackageOverflow | null } {
  const limit = 3 * (registry.sources.get(round)?.text.length ?? 0)
  const size = (p: readonly PackageObject[], g: readonly PackageGuard[]) => renderPackage(p).length + renderGuardList(g).length
  const p = [...pkg]
  let g = [...guards]
  const chars = size(p, g)
  if (chars <= limit) return { pkg: p, guards: g, overflow: null }
  const dropped: string[] = []
  const droppable = (x: PackageObject) => x.why === "edge" && x.via.every(v => / refers_to /u.test(v))
  for (let i = p.length - 1; i >= 0 && size(p, g) > limit; i--) if (droppable(p[i])) { dropped.push(p[i].object); p.splice(i, 1) }
  let outputs = false
  if (size(p, g) > limit) { g = g.map(x => ({ ...x, output: null })); outputs = true }
  return { pkg: p, guards: g, overflow: { limit, chars, dropped: dropped.reverse(), outputs_dropped: outputs, still_over: size(p, g) > limit } }
}
