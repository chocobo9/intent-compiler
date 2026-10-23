import type { BlockState, Modification, Registry } from "./registry.js"
import type { SourceBlock } from "./source.js"

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

/**
 * A block as it is in force after `round` (DESIGN §6a step 2): text later rounds replaced or withdrew inside it is left
 * out, with the id of what replaced it in its place; amended parts (code, tables) stay, with what amends them. Null when
 * the block as a whole is no longer in force.
 */
export function effectiveText(registry: Registry, block: string, round: number): string | null {
  const b = registry.block(block)!
  const own = registry.objects.get(registry.assigned.get(block) ?? "")?.blocks.find(x => x.block === block)
  const mods = own?.modifications.filter(m => m.round <= round) ?? []
  if (mods.some(m => m.parts.includes(block) && !(m.amended ?? []).includes(block))) return null
  const cuts: { start: number; end: number; note: string }[] = []
  for (const m of mods) for (const p of m.parts) {
    const part = registry.block(p)
    if (!part || part.start < b.start || part.end > b.end) continue
    const amended = (m.amended ?? []).includes(p)
    const note = amended ? `⟦${p} amended by ${m.by.join(", ")}; where they differ, ${m.by.join(", ")} wins⟧ ` : m.kind === "withdraw" ? `⟦${p} withdrawn⟧ ` : `⟦${p} replaced by ${m.by.join(", ")}⟧ `
    // The replaced text goes; it ends where its content ends, so the layout around it stays.
    cuts.push(amended ? { start: part.start - b.start, end: part.start - b.start, note } : { start: part.start - b.start, end: part.start - b.start + part.text.trimEnd().length, note })
  }
  let text = b.text
  for (const c of cuts.sort((x, y) => y.start - x.start)) text = `${text.slice(0, c.start)}${c.note}${text.slice(c.end)}`
  return text
}

export interface PackageBlock { id: string; round: number; object: string | null; text: string; why: "this round" | "object changed" | "related" | "open item" }

/**
 * The round's package (DESIGN §6a step 3, §12j.7 items 6, 9): what the executor and the reviewer are given of the
 * requirements. This round's text; every block in force of the objects this round adds or revises; the blocks of
 * earlier objects a relation edge connects to those objects; the blocks open items rest on. Each block once, in force
 * as it stands now, in round and document order.
 */
export function roundPackage(registry: Registry, round: number, openUnits: readonly string[] = []): PackageBlock[] {
  const changed = new Set(registry.roundScope(round).map(c => c.object))
  const ownerOf = (id: string) => /^O\d+$/u.test(id) ? id : registry.coverOf(id)?.owner
  const related = new Set<string>()
  for (const e of registry.references.filter(x => x.round <= round)) {
    const from = ownerOf(e.from), to = ownerOf(e.to)
    if (from && changed.has(from) && to && to !== "none" && !changed.has(to)) related.add(to)
    if (to && changed.has(to) && from && from !== "none" && !changed.has(from)) related.add(from)
  }
  const within = (inner: string, outer: string) => registry.lineage(inner).some(b => b.id === outer)
  const open = new Set<string>()
  for (const u of openUnits) for (const [id] of registry.assigned) if (within(u, id) || within(id, u)) open.add(id)
  const out: PackageBlock[] = []
  for (const source of [...registry.sources.values()].filter(s => s.round <= round).sort((a, b) => a.round - b.round)) {
    for (const b of source.blocks) {
      const owner = registry.assigned.get(b.id)
      if (owner === undefined) continue
      const why: PackageBlock["why"] | null = b.round === round ? "this round" : changed.has(owner) ? "object changed" : related.has(owner) ? "related" : open.has(b.id) ? "open item" : null
      if (!why) continue
      const text = b.round === round ? b.text : effectiveText(registry, b.id, round)
      if (text === null) continue
      out.push({ id: b.id, round: b.round, object: owner === "none" ? null : owner, text, why })
    }
  }
  return out
}

/**
 * The package as the reviewer reads it, round by round as the control group's text is laid out (§12j.7 item 6): this
 * round's text whole, and of each earlier round the package's blocks, adjacent ones joined as in the source.
 */
export function packageSources(registry: Registry, round: number, blocks: readonly PackageBlock[]): { round: number; text: string }[] {
  const out: { round: number; text: string }[] = []
  for (const r of [...new Set(blocks.map(b => b.round))].sort((a, b) => a - b)) {
    if (r === round) { out.push({ round: r, text: registry.sources.get(r)!.text }); continue }
    let text = "", end = -1
    for (const b of blocks.filter(x => x.round === r)) {
      const at = registry.block(b.id)!
      text += end === at.start ? b.text : `${text ? "\n\n" : ""}${b.text.replace(/^\n+/u, "")}`
      end = at.end
    }
    out.push({ round: r, text: text.trimEnd() + "\n" })
  }
  return out
}
