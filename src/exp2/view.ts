import { objectsNamed } from "./units.js"
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

export function headingPath(registry: Registry, context: SourceBlock): string[] {
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

/**
 * A paragraph (or section) as it stands after `round`: units later rounds revised replaced in place by the units
 * revising them (each under its id), withdrawn units and revised code blocks or tables gone; hashes dropped. Empty
 * when the paragraph itself, or a block holding it, was wholly replaced or withdrawn.
 */
export function paragraphInForce(registry: Registry, paragraph: string, round: number): string {
  const p = registry.block(paragraph)!
  const mods = [...registry.objects.values()].flatMap(o => o.blocks.flatMap(own => own.modifications.filter(x => x.round <= round)))
  // Wholly replaced or withdrawn (the paragraph itself, or a block holding it): nothing of it is in force; what
  // replaced it is that round's own text.
  if (mods.some(m => m.parts.some(part => registry.lineage(paragraph).some(b => b.id === part)))) return ""
  const cuts: Cut[] = []
  for (const m of mods) {
    const amended = new Set(m.amended ?? [])
    const parts = m.parts.map(x => registry.block(x)!).filter(x => x && x.start >= p.start && x.end <= p.end && x.id !== p.id).sort((a, b) => a.start - b.start)
    const replaced = m.kind === "withdraw" ? [] : parts.filter(x => !amended.has(x.id))
    for (const x of parts) cuts.push({ start: x.start, end: contentEnd(x), note: x === replaced[0] ? inlineText(registry, m.by) : "" })
  }
  return renderSpan(registry, p, cuts)
}

export type SegmentWhy = "this round" | "revised" | "unit" | "open item"
/**
 * A paragraph of the round's package (§6c, the package's revision): whose it is, why it is there, its text in force.
 * unit_source: for a paragraph a change unit brought, cue when a cue unit did (it stays within the budget), else model.
 */
export interface PackageSegment { object: string; name: string; paragraph: string; round: number; path: string; why: SegmentWhy; via: string[]; text: string; unit_source?: "cue" | "model" }
/** Behaviour bound to earlier text this round revises (§6c revision item 4): a guard on a revised unit, what it gets now. */
export interface PackageComparison { guard: string; args: string[]; files: string[]; output: string | null; units: { id: string; earlier: string; now: string[] }[] }
/**
 * Batch 4 E3: the change units this round touches, and each across two commands or more with the commands it
 * involves and those the package's text reaches (a paragraph of theirs, or one that names them).
 */
export interface PackageUnits { touched: number; cross: { id: string; name: string; objects: string[]; delivered: string[] }[] }
export interface RoundPackage { segments: PackageSegment[]; comparisons: PackageComparison[]; units: PackageUnits }

const WHY_RANK: Record<SegmentWhy, number> = { "this round": 0, revised: 1, unit: 2, "open item": 3 }
const paragraphOf = (registry: Registry, id: string) => contextOf(registry, id).id

/**
 * The round's package (DESIGN §6c and its revision of 2026-10-25), by paragraph:
 * - this round: the paragraphs (or sections) holding the units this round attributed, under their object;
 * - revised: the earlier paragraph holding each unit this round revised or withdrew, as it stands now, with the
 *   earlier text of the unit on a line below;
 * - unit (batch 4 E3): each change unit this round touches (a cue or model unit of this round, or an earlier one whose
 *   text this round revises) brings the paragraphs of its earlier sentences; a global unit is never expanded, and a
 *   check's units are no unit here (the check runs every cycle);
 * - open item: the paragraph each open item's unit is in.
 * Each paragraph once (the first reason in that order); nothing inferred.
 */
export function roundPackage(registry: Registry, round: number, open: readonly { id: string; units: readonly string[] }[] = []): RoundPackage {
  const owner = (id: string) => { const o = registry.coverOf(id)?.owner; return o && o !== "none" && registry.objects.has(o) ? o : null }
  const segs = new Map<string, PackageSegment>()
  const earlier = new Map<string, string[]>()
  const add = (paragraph: string, object: string | null, why: SegmentWhy, via: string | null) => {
    if (!object) return
    const b = registry.block(paragraph)!
    const at = segs.get(paragraph)
    if (at && WHY_RANK[at.why] <= WHY_RANK[why]) { if (via && !at.via.includes(via)) at.via.push(via); return }
    const text = b.round === round ? renderSpan(registry, b, []) : paragraphInForce(registry, paragraph, round)
    // A paragraph nothing of which is in force comes only as the earlier text of what this round revised.
    if (!text && why !== "revised") return
    const path = [`R${b.round}`, ...headingPath(registry, contextOf(registry, paragraph)).map(h => h.replace(/^#+\s*/u, ""))].join(" › ")
    segs.set(paragraph, { object, name: registry.objects.get(object)!.name, paragraph, round: b.round, path, why, via: [...(at?.via ?? []), ...(via ? [via] : [])], text })
  }
  // This round's units, by the paragraph (or section) they are in.
  for (const c of registry.roundScope(round)) for (const e of c.entries) add(paragraphOf(registry, e.block), c.object, "this round", null)
  // Earlier units this round revised or withdrew.
  for (const o of registry.objects.values()) for (const own of o.blocks) for (const m of own.modifications.filter(x => x.round === round)) for (const p of m.parts) {
    const para = paragraphOf(registry, p)
    add(para, o.id, "revised", `${p} ${m.kind === "withdraw" ? "withdrawn" : "revised"} by ${m.by.join(", ")}`)
    earlier.set(para, [...new Set([...(earlier.get(para) ?? []), p])])
  }
  // Change units this round touches: their sentences of earlier rounds come in, by paragraph.
  const revisedNow = [...registry.objects.values()].flatMap(o => o.blocks.flatMap(b => b.modifications.filter(m => m.round === round).flatMap(m => m.parts)))
  const touched = registry.units(round).filter(u => u.source !== "revision" && !u.all && (u.round === round || u.members.some(m => revisedNow.some(p => overlaps(registry, m, p)))))
  for (const u of touched) for (const m of u.members.filter(x => (registry.block(x)?.round ?? round) < round)) {
    const para = paragraphOf(registry, m)
    add(para, owner(m), "unit", `${u.id} (${u.source}: ${u.name})`)
    const s = segs.get(para)
    if (s?.why === "unit") s.unit_source = s.unit_source === "cue" || u.source === "cue" ? "cue" : "model"
  }
  for (const item of open) for (const u of item.units) if (registry.block(u)) add(paragraphOf(registry, u), owner(u), "open item", item.id)
  const segments = [...segs.values()]
  for (const s of segments) for (const p of earlier.get(s.paragraph) ?? []) s.text = `${s.text.trimEnd() ? `${s.text.trimEnd()}\n` : ""}earlier text of ${p}: ${registry.block(p)!.text.trim()}`
  return { segments: orderSegments(registry, segments), comparisons: [], units: { touched: touched.length, cross: crossDelivery(registry, touched, segments) } }
}

/** Each unit across two commands or more: the commands it involves, and those the package reaches (a paragraph of theirs, or one that names them). */
export function crossDelivery(registry: Registry, units: readonly { id: string; name: string; objects: readonly string[]; all?: boolean }[], segments: readonly PackageSegment[]): PackageUnits["cross"] {
  const named = new Set(segments.flatMap(s => [...s.text.matchAll(/`([a-z][\w.-]{2,})`/giu)].flatMap(m => objectsNamed(registry, m[1]))))
  const own = new Set(segments.map(s => s.object))
  return units.filter(u => !u.all && u.objects.length >= 2).map(u => ({ id: u.id, name: u.name, objects: [...u.objects], delivered: u.objects.filter(o => own.has(o) || named.has(o)) }))
}

function orderSegments(registry: Registry, segments: PackageSegment[]): PackageSegment[] {
  const num = (o: string) => Number(o.slice(1))
  const rank = new Map<string, number>()
  for (const s of segments) rank.set(s.object, Math.min(rank.get(s.object) ?? 9, WHY_RANK[s.why]))
  return [...segments].sort((a, b) => (rank.get(a.object)! === 0 ? 0 : 1) - (rank.get(b.object)! === 0 ? 0 : 1) || num(a.object) - num(b.object) || a.round - b.round || registry.block(a.paragraph)!.start - registry.block(b.paragraph)!.start)
}

const segmentLabel = (s: PackageSegment) => s.why === "this round" ? "this round" : s.why === "revised" ? `earlier text this round revises (${s.via.join("; ")})` : s.why === "unit" ? `earlier, changing together with this round's text (${s.via.join("; ")})` : `earlier, open item ${s.via.join(", ")}`

/** The package as the executor, the reviewer and the formalizer read it: by object, each paragraph under its heading path and reason. */
export function renderPackage(pkg: RoundPackage): string {
  const out: string[] = []
  let object = "", header = ""
  for (const s of pkg.segments) {
    if (s.object !== object) { out.push(`### ${s.object} ${s.name}`); object = s.object; header = "" }
    // The heading path and reason once for consecutive paragraphs that share them.
    const h = `## ${s.path} — ${segmentLabel(s)}`
    if (h !== header) { out.push(h); header = h }
    out.push(s.text.trimEnd())
  }
  if (pkg.comparisons.length) out.push(renderComparisons(pkg.comparisons))
  return out.length ? out.join("\n\n") + "\n" : ""
}

export function renderComparisons(cs: readonly PackageComparison[]): string {
  const out = ["## Behaviour bound to earlier text this round revises (what the program does now; decide from the requirements as they stand)"]
  for (const c of cs) {
    out.push(`- ${c.guard}: command ${JSON.stringify(c.args)}; input files ${c.files.join(", ") || "none"}${c.output !== null ? `; now: ${c.output}` : ""}`)
    // A whole paragraph or section on either side is quoted to its first 400 characters; the package has the rest.
    const clip = (t: string) => { const one = t.replace(/\s+/gu, " "); return one.length > 400 ? `${one.slice(0, 400)}…` : one }
    for (const u of c.units) out.push(`  - earlier text of ${u.id}: ${clip(u.earlier)}${u.now.length ? `; now: ${clip(u.now.join(" "))}` : "; withdrawn"}`)
  }
  return out.join("\n")
}

/** Characters of the package by zone (§6c revision item 5). */
export function packageSizes(pkg: RoundPackage): Record<SegmentWhy | "comparisons" | "total", number> {
  const by = (w: SegmentWhy) => pkg.segments.filter(s => s.why === w).reduce((n, s) => n + s.text.length, 0)
  return { "this round": by("this round"), revised: by("revised"), unit: by("unit"), "open item": by("open item"), comparisons: pkg.comparisons.length ? renderComparisons(pkg.comparisons).length : 0, total: renderPackage(pkg).length }
}

export interface PackageOverflow { limit: number; chars: number; dropped: string[]; still_over: boolean }

/**
 * The package within its budget (§6c revision item 5; batch 4 E3): first the paragraphs only model units brought go,
 * the last first; then those of the open items. This round's paragraphs, the revised ones and those a cue unit
 * brought stay. Null overflow: it fitted.
 */
export function fitPackage(pkg: RoundPackage, limit = PACKAGE_BUDGET): { pkg: RoundPackage; overflow: PackageOverflow | null } {
  const chars = renderPackage(pkg).length
  if (chars <= limit) return { pkg, overflow: null }
  const segments = [...pkg.segments], dropped: string[] = []
  const goes = [(s: PackageSegment) => s.why === "unit" && s.unit_source === "model", (s: PackageSegment) => s.why === "open item"]
  for (const go of goes) for (let i = segments.length - 1; i >= 0 && renderPackage({ ...pkg, segments }).length > limit; i--) if (go(segments[i])) { dropped.push(segments[i].paragraph); segments.splice(i, 1) }
  const fitted = { ...pkg, segments }
  return { pkg: fitted, overflow: { limit, chars, dropped: dropped.reverse(), still_over: renderPackage(fitted).length > limit } }
}

/**
 * The comparisons of the round (§6c revision item 4): the live guards resting on a unit this round revised or
 * withdrew, each with what it runs, what it gets on the baseline now (`outputs`, by guard; null when not run) and the
 * unit's earlier and present text. Holding the other guards is code's: none of them is delivered.
 */
export function packageComparisons(registry: Registry, round: number, guards: readonly { id: string; units: readonly string[]; input?: { args: string[]; files: { path: string }[] }; check?: string }[], library: readonly { id: string; input: { args: string[]; files: { path: string }[] } }[], outputs: ReadonlyMap<string, string>): PackageComparison[] {
  const revised = [...registry.objects.values()].flatMap(o => o.blocks.flatMap(b => b.modifications.filter(m => m.round === round).flatMap(m => m.parts.map(p => ({ id: p, by: m.by })))))
  const out: PackageComparison[] = []
  for (const g of guards) {
    const units = revised.filter(r => g.units.some(u => overlaps(registry, u, r.id)))
    if (!units.length) continue
    const input = g.input ?? library.find(k => k.id === g.check)?.input
    if (!input) continue
    out.push({ guard: g.id, args: input.args, files: input.files.map(f => f.path), output: outputs.get(g.id) ?? null, units: [...new Map(units.map(u => [u.id, u])).values()].map(u => ({ id: u.id, earlier: registry.block(u.id)!.text.trim(), now: u.by.map(b => registry.block(b)!.text.trim()) })) })
  }
  return out
}

/** The package's budget in characters (§6c revision item 5). */
export const PACKAGE_BUDGET = 40_000
