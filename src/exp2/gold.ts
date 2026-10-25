import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Registry } from "./registry.js"

/**
 * Attribution against the corpus gold sets (DESIGN §12j.7 item 12, §6c round package item 6; the chain block, effect
 * 4): how many of the revisions and cross-references a labeller found in a round's text the attribution recorded.
 * The gold sets are exp2/evidence/corpus-scan-2026-10-23/{revision,xref}-gold.json; a task is named as there
 * (deterministic-data-pipeline-go, lsm-kvstore-engine, …). A gold sentence is found in the round's text by its
 * words; one not found is listed apart, not counted as a miss.
 */

export interface GoldRevision { task: string; round: number; kind: string; sentence: string; earlier_round: number; earlier_quote: string }
export interface GoldXref { task: string; round: number; kind: string; sentence: string; earlier_round: number; earlier_quote: string }
export interface GoldSets { task: string; revisions: GoldRevision[]; xrefs: GoldXref[] }

export const GOLD_DIR = join("exp2", "evidence", "corpus-scan-2026-10-23")

/** The task's entries of both gold sets; null when the files are not there. */
export function loadGold(dir: string, task: string): GoldSets | null {
  const r = join(dir, "revision-gold.json"), x = join(dir, "xref-gold.json")
  if (!existsSync(r) || !existsSync(x)) return null
  const pick = <T extends { task: string }>(f: string) => (JSON.parse(readFileSync(f, "utf8")) as T[]).filter(e => e.task === task)
  return { task, revisions: pick<GoldRevision>(r), xrefs: pick<GoldXref>(x) }
}

/** Words only: markdown marks, backticks, quotes and spacing do not count. */
const words = (t: string) => t.toLowerCase().replace(/[`*_~"'“”‘’]/gu, "").replace(/^\s*(?:[-+]|\d+[.)])\s+/gmu, "").replace(/\s+/gu, " ").trim()

/** The smallest unit of round `round` whose words hold the quote's (or its first 60 characters'); null when none does. */
export function locate(registry: Registry, round: number, quote: string): string | null {
  const source = registry.sources.get(round)
  if (!source) return null
  for (const q of [words(quote), words(quote).slice(0, 60)]) {
    if (!q) continue
    const hits = source.blocks.filter(b => words(b.text).includes(q))
    if (hits.length) return hits.sort((a, b) => a.text.length - b.text.length)[0].id
  }
  return null
}

const overlaps = (registry: Registry, a: string, b: string) => registry.lineage(a).some(x => x.id === b) || registry.lineage(b).some(x => x.id === a)
/** The paragraph (or section) a unit is in: revisions and edges are compared at that grain. */
const paragraphOf = (registry: Registry, id: string) => registry.lineage(id).find(b => b.level === "paragraph" || b.level === "section")!.id

export interface RecallLine { gold: number; located: number; hit: number; missed: string[]; unlocated: number; by_unit?: number; by_object?: number; by_kind?: Record<string, { gold: number; hit: number }>; precision?: { recorded: number; on_gold: number } }

/**
 * Revision recall of round `round`: a gold revision is recorded when a modification of that round has a new unit in
 * the gold sentence's paragraph and a part in the earlier quote's paragraph. Precision: of the round's modifications,
 * how many have a new unit in a gold sentence's paragraph.
 */
export function revisionRecall(registry: Registry, round: number, gold: GoldSets): RecallLine {
  const mods = [...registry.objects.values()].flatMap(o => o.blocks.flatMap(b => b.modifications.filter(m => m.round === round)))
  const entries = gold.revisions.filter(e => e.round === round)
  const out: RecallLine = { gold: entries.length, located: 0, hit: 0, missed: [], unlocated: 0 }
  const goldParas: string[] = []
  for (const e of entries) {
    const s = locate(registry, round, e.sentence), q = locate(registry, e.earlier_round, e.earlier_quote)
    if (!s || !q) { out.unlocated++; continue }
    out.located++
    const sp = paragraphOf(registry, s), qp = paragraphOf(registry, q)
    goldParas.push(sp)
    if (mods.some(m => m.by.some(u => overlaps(registry, u, sp)) && m.parts.some(p => overlaps(registry, p, qp)))) out.hit++
    else out.missed.push(`${s} → ${q}`)
  }
  out.precision = { recorded: mods.length, on_gold: mods.filter(m => m.by.some(u => goldParas.some(p => overlaps(registry, u, p)))).length }
  return out
}

/**
 * Relation recall of round `round`: a gold cross-reference is recorded when a change unit of that round holds the gold
 * sentence's paragraph and the earlier quote's paragraph (or touches the object owning it), or when the attribution
 * gave the sentence to the object that owns the quote (an extension of an object is recorded as its ownership). The
 * two are counted apart.
 */
export function relationRecall(registry: Registry, round: number, gold: GoldSets): RecallLine {
  // Batch 4: a change unit of the round (cue, model, revision) relates text in place of object edges.
  const units = registry.units(round).filter(u => u.round === round)
  const entries = gold.xrefs.filter(e => e.round === round)
  const out: RecallLine = { gold: entries.length, located: 0, hit: 0, missed: [], unlocated: 0, by_unit: 0, by_object: 0, by_kind: {} }
  for (const e of entries) {
    const k = (out.by_kind![e.kind] ??= { gold: 0, hit: 0 })
    k.gold++
    const s = locate(registry, round, e.sentence), q = locate(registry, e.earlier_round, e.earlier_quote)
    if (!s || !q) { out.unlocated++; continue }
    out.located++
    const sp = paragraphOf(registry, s), qp = paragraphOf(registry, q), owner = registry.coverOf(q)?.owner
    if (units.some(u => u.members.some(m => overlaps(registry, m, sp)) && (u.members.some(m => overlaps(registry, m, qp)) || (!!owner && u.objects.includes(owner))))) { out.hit++; k.hit++; out.by_unit!++ }
    else if (owner && owner !== "none" && registry.coverOf(s)?.owner === owner) { out.hit++; k.hit++; out.by_object!++ }
    else out.missed.push(`${s} → ${q}`)
  }
  return out
}

export function renderRecall(name: string, r: RecallLine): string {
  const how = r.by_unit !== undefined ? ` (by a change unit ${r.by_unit}, by the same object ${r.by_object})` : ""
  const kinds = r.by_kind ? `; by gold kind ${Object.entries(r.by_kind).map(([k, v]) => `${k} ${v.hit}/${v.gold}`).join(", ")}` : ""
  const precision = r.precision ? `; precision ${r.precision.on_gold}/${r.precision.recorded} of the round's modifications on a gold sentence` : ""
  return `- ${name}: ${r.hit}/${r.located} of the gold set's located entries recorded${how} (${r.gold} in the gold set, ${r.unlocated} not located in the text)${kinds}${precision}${r.missed.length ? `; missed ${r.missed.slice(0, 12).join(", ")}${r.missed.length > 12 ? ` and ${r.missed.length - 12} more` : ""}` : ""}.`
}
