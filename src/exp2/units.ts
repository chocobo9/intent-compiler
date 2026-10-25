import type { CheckRecord } from "./checks.js"
import type { GuardRecord } from "./guards.js"
import { nameKey, type Modification, type Registry } from "./registry.js"
import type { SourceBlock } from "./source.js"

/**
 * Change units and revision provenance (batch 4 E1, DESIGN-DEEP §1). A change unit is a set of sentences that are
 * changed together, possibly across commands; objects (commands) are labels on sentences, not units of delivery.
 * Sources, each labelled:
 * - cue: what the author wrote down, found by code (never by the model): a "Changes to `X`" section; the sentences of
 *   one section that revise a command by name ("`manifest` command: produces BLAKE2b … instead of SHA256",
 *   "`ingest` … no longer writes"); a Previous/New pair; an author's id (F12, Section 21) cited in several places;
 * - revision: a recorded revision joins the new text and the old text it replaces;
 * - guard: a check's units (what one run reads together); one unit a check, never merged with others;
 * - model: the attribution model's, where no cue gives one (E1b).
 * Everything here is derived from the source log, the accepted rounds and the checks: nothing is stored twice.
 * Revision provenance: a revision is `cue` when its new text carries a revision cue (previously, instead of, no longer,
 * Changes to, an author's id), with the cue's words; else `inferred`.
 */

export type UnitSource = "cue" | "revision" | "guard" | "model"
export type CueKind = "changes_to" | "cmd_in_revision" | "prev_new" | "author_id" | "cross_list" | "scope_unchanged"

export interface ChangeUnit {
  id: string
  source: UnitSource
  /** The round the unit belongs to: the round of its newest member. */
  round: number
  name: string
  /** Sentences (or paragraphs without sentences), by id. */
  members: string[]
  /** The commands it touches: those its cue names, else the owners of its members. */
  objects: string[]
  /** cue units: what kind of cue, and its words. */
  cue?: { kind: CueKind; text: string }
  /**
   * cross_list cues ("all commands", "any `dpipe` command"): a global unit. It is never expanded over the commands:
   * its objects are the one the sentence names (the program: `dpipe` → dpipe CLI) and its owner; the review asks for
   * the behaviour on two commands at least (the design session's decision, 2026-10-25).
   */
  all?: boolean
}

export interface CueHit { kind: CueKind; block: string; text: string; names: string[] }

const CUE: Record<Exclude<CueKind, "cmd_in_revision">, RegExp> = {
  changes_to: /^\s*(?:\*\*|#{1,4}\s*)?changes? to `?([^`*\n]+)`?/imu,
  cross_list: /\b(?:across|affects?|applies to|for)\s+(?:all|every|each|multiple)\s+(?:commands?|stages?|endpoints?)|\ball (?:existing |deployment-related )?commands\b|\b(?:every|each)\s+(?:`[^`\n]+`\s+)?(?:command|subcommand)\b|\bany\s+`[^`\n]+`\s+(?:command|subcommand)s?\b/iu,
  prev_new: /(?:#{2,3}\s*previous behaviou?r|#{2,3}\s*new behaviou?r|\bpreviously\b[^.\n]{0,120}\b(?:now|corrected|instead)\b|\binstead of\b|\bno longer\b|\brather than\b|\bis now replaced\b|\bnow (?:defaults?|uses|maps|returns|emits|requires|must|produces)\b|\(not [^)]{1,40}\))/iu,
  scope_unchanged: /(?:unchanged behaviou?r|all (?:other |existing )?(?:behaviou?rs?|functionality|commands|endpoints)[^.\n]{0,80}(?:unchanged|as before|continue|remain|still hold)|not mentioned above|continues? to hold|remains? (?:unchanged|the same|as before))/iu,
  author_id: /\b(?:F\d{1,3}|Section \d+(?:\.\d+)?|§\s?\d+)\b/gu,
}
/** A command named in backticks in a sentence that revises it ("`X` … now / no longer / instead / still", or after). */
const CMD_IN_REVISION = /(?:`([a-z][\w.-]{2,})`[^.\n]{0,80}\b(?:now|no longer|instead|unchanged|still)\b)|(?:\b(?:now|no longer|instead)\b[^.\n]{0,80}`([a-z][\w.-]{2,})`)/giu
const BACKTICKED = /`([a-z][\w.-]{2,})`/giu

/** The leaves of a round: sentences, and paragraphs that have none; heading lines are not (their section is read apart). */
export function leaves(registry: Registry, round: number): SourceBlock[] {
  return (registry.sources.get(round)?.blocks ?? []).filter(b => b.kind !== "heading" && (b.level === "sentence" || (b.level === "paragraph" && !b.children.some(c => registry.block(c)?.level === "sentence"))))
}

/** The top section a block is in (its outermost section ancestor). */
function topSection(registry: Registry, id: string): string | null {
  const sections = registry.lineage(id).filter(b => b.level === "section")
  return sections.at(-1)?.id ?? null
}

/**
 * The objects a backticked name means: the one named so ("verify", "verify command", "pivot operation"); only when
 * there is none, every object whose name starts with it ("ingest validation").
 */
export function objectsNamed(registry: Registry, name: string): string[] {
  const k = nameKey(name), all = [...registry.objects.values()]
  const exact = all.filter(o => [k, `${k} command`, `${k} operation`].includes(nameKey(o.name)))
  return (exact.length ? exact : all.filter(o => nameKey(o.name).startsWith(`${k} `))).map(o => o.id)
}

/** Every cue in a round's text, sentence by sentence. Code only. */
export function cuesIn(registry: Registry, round: number): CueHit[] {
  const out: CueHit[] = []
  for (const b of leaves(registry, round)) {
    const t = b.text
    for (const kind of ["changes_to", "cross_list", "prev_new", "scope_unchanged"] as const) {
      const m = CUE[kind].exec(t)
      if (m) out.push({ kind, block: b.id, text: m[0].trim(), names: kind === "changes_to" ? [m[1].trim()] : [] })
    }
    const named = [...new Set([...t.matchAll(CMD_IN_REVISION)].map(m => (m[1] ?? m[2]).toLowerCase()))]
    if (named.length) out.push({ kind: "cmd_in_revision", block: b.id, text: t.trim().slice(0, 200), names: [...new Set([...named, ...[...t.matchAll(BACKTICKED)].map(m => m[1].toLowerCase())])] })
    for (const m of t.matchAll(CUE.author_id)) out.push({ kind: "author_id", block: b.id, text: m[0], names: [] })
  }
  // A heading line: "Changes to `X`" and Previous/New headings are on the section's own text.
  for (const s of (registry.sources.get(round)?.blocks ?? []).filter(x => x.level === "section" && x.heading)) {
    const m = CUE.changes_to.exec(s.heading!)
    if (m) out.push({ kind: "changes_to", block: s.id, text: s.heading!.trim(), names: [m[1].trim()] })
  }
  return out
}

const ownerOf = (registry: Registry, id: string) => { const o = registry.coverOf(id)?.owner; return o && o !== "none" ? o : null }
const objectsOf = (registry: Registry, members: readonly string[]) => [...new Set(members.map(m => ownerOf(registry, m)).filter((o): o is string => !!o))]

/** The cue units of a round: code finds them; the model may confirm or narrow their members (E1b), never invent. */
export function cueUnits(registry: Registry, round: number): ChangeUnit[] {
  const hits = cuesIn(registry, round), units: ChangeUnit[] = []
  const add = (u: Omit<ChangeUnit, "id" | "source" | "round">) => units.push({ id: `U${round}.c${units.length + 1}`, source: "cue", round, ...u })
  // "Changes to `X`": the section, every leaf under it, X named.
  for (const h of hits.filter(x => x.kind === "changes_to")) {
    const sec = registry.block(h.block)?.level === "section" ? h.block : topSection(registry, h.block)
    const members = sec ? leaves(registry, round).filter(b => registry.lineage(b.id).some(x => x.id === sec)).map(b => b.id) : [h.block]
    const named = h.names.flatMap(n => objectsNamed(registry, n.replace(/`/gu, "")))
    add({ name: `Changes to ${h.names[0]}`, members, objects: named.length ? named : objectsOf(registry, members), cue: { kind: "changes_to", text: h.text } })
  }
  // Revisions of named commands in one section: one unit across the commands it names.
  const bySection = new Map<string, CueHit[]>()
  for (const h of hits.filter(x => x.kind === "cmd_in_revision" || x.kind === "prev_new")) { const s = topSection(registry, h.block) ?? h.block; bySection.set(s, [...(bySection.get(s) ?? []), h]) }
  for (const [sec, hs] of bySection) {
    const members = [...new Set(hs.map(h => h.block))]
    const named = [...new Set(hs.flatMap(h => h.names.flatMap(n => objectsNamed(registry, n))))]
    const objects = named.length ? [...new Set([...named, ...objectsOf(registry, members)])] : objectsOf(registry, members)
    if (members.length < 2 && objects.length < 2) continue
    const heading = registry.block(sec)?.heading?.replace(/^#+\s*/u, "").trim()
    add({ name: heading || `revisions in ${sec}`, members, objects, cue: { kind: hs.some(h => h.kind === "cmd_in_revision") ? "cmd_in_revision" : "prev_new", text: hs[0].text } })
  }
  // An author's id cited in several sentences of this round and earlier rounds: one unit.
  const ids = new Map<string, string[]>()
  for (let r = 1; r <= round; r++) for (const h of cuesIn(registry, r).filter(x => x.kind === "author_id")) ids.set(h.text, [...new Set([...(ids.get(h.text) ?? []), h.block])])
  for (const [id, members] of ids) if (members.length >= 2 && members.some(m => registry.block(m)?.round === round)) add({ name: id, members, objects: objectsOf(registry, members), cue: { kind: "author_id", text: id } })
  // "All commands", "any `X` command": a global unit, never expanded; its objects are what the sentence names and its owner.
  for (const h of hits.filter(x => x.kind === "cross_list")) {
    const named = [...(registry.block(h.block)?.text ?? "").matchAll(BACKTICKED)].flatMap(m => objectsNamed(registry, m[1]))
    add({ name: "all commands", members: [h.block], objects: [...new Set([...named, ...objectsOf(registry, [h.block])])], cue: { kind: "cross_list", text: h.text }, all: true })
  }
  return units
}

/** Revision units: each recorded revision joins its new text and the earlier text it replaced, withdrew or overrode. */
export function revisionUnits(registry: Registry, round?: number): ChangeUnit[] {
  const out: ChangeUnit[] = []
  for (const o of registry.objects.values()) for (const b of o.blocks) for (const m of b.modifications) {
    if (round !== undefined && m.round !== round) continue
    const members = [...new Set([...m.parts, ...m.by])]
    out.push({ id: `U${m.round}.r${out.filter(u => u.round === m.round).length + 1}`, source: "revision", round: m.round, name: `${m.kind} of ${m.parts.join(", ")}`, members, objects: [...new Set([b.object, m.by_object])] })
  }
  return out
}

/** Guard units: each check's units (a library check, or a guard born from a review item), one unit a check. */
export function guardUnits(registry: Registry, checks: readonly Pick<CheckRecord, "id" | "round" | "blocks">[], guards: readonly Pick<GuardRecord, "id" | "round" | "source" | "units">[] = []): ChangeUnit[] {
  const fromChecks = checks.map(k => ({ id: `U${k.round}.g${k.id}`, source: "guard" as const, round: k.round, name: `check ${k.id}`, members: [...k.blocks], objects: objectsOf(registry, k.blocks) }))
  const fromReview = guards.filter(g => g.source === "review").map(g => ({ id: `U${g.round}.g${g.id}`, source: "guard" as const, round: g.round, name: `guard ${g.id}`, members: [...g.units], objects: objectsOf(registry, g.units) }))
  return [...fromChecks, ...fromReview]
}

/** The units of rounds 1..round from code: cue units of each round, every revision, every check. */
export function codeUnits(registry: Registry, round: number, checks: readonly Pick<CheckRecord, "id" | "round" | "blocks">[] = [], guards: readonly Pick<GuardRecord, "id" | "round" | "source" | "units">[] = []): ChangeUnit[] {
  const out: ChangeUnit[] = []
  for (let r = 1; r <= round; r++) out.push(...cueUnits(registry, r))
  out.push(...revisionUnits(registry).filter(u => u.round <= round), ...guardUnits(registry, checks.filter(k => k.round <= round), guards.filter(g => g.round <= round)))
  return out
}

/** Where a revision comes from: a revision cue in its new text (with the cue's words), or inferred. */
export function provenance(registry: Registry, m: Pick<Modification, "by">): { kind: "cue"; text: string } | { kind: "inferred" } {
  const texts = m.by.flatMap(id => { const b = registry.block(id); if (!b) return []; const sec = registry.lineage(id).find(x => x.level === "section"); return [b.text, ...(sec?.heading ? [sec.heading] : [])] })
  for (const t of texts) {
    for (const re of [CUE.prev_new, CUE.changes_to]) { const x = re.exec(t); if (x) return { kind: "cue", text: x[0].trim() } }
    const id = t.match(/\b(?:F\d{1,3}|Section \d+(?:\.\d+)?|§\s?\d+)\b/u)
    if (id) return { kind: "cue", text: id[0] }
  }
  return { kind: "inferred" }
}

const overlapping = (registry: Registry, a: string, b: string) => registry.lineage(a).some(x => x.id === b) || registry.lineage(b).some(x => x.id === a)

/**
 * The sentences that share a change unit with any of `units` (a cue, revision or model unit up to `round`; guard
 * units never: a check's own units would vouch for themselves), with the unit, members overlapping `units` left out.
 */
export function coMembers(registry: Registry, units: readonly string[], round: number): { unit: ChangeUnit; members: string[] }[] {
  return registry.units(round).flatMap(u => {
    if (!u.members.some(m => units.some(x => overlapping(registry, m, x)))) return []
    const others = u.members.filter(m => !units.some(x => overlapping(registry, m, x)))
    return others.length ? [{ unit: u, members: others }] : []
  })
}

/** The sentences of a round that declare earlier behaviour unchanged (E2): "remains unchanged", "continues to hold". */
export function scopeDeclarations(registry: Registry, round: number): { block: string; text: string }[] {
  return cuesIn(registry, round).filter(h => h.kind === "scope_unchanged").map(h => ({ block: h.block, text: h.text }))
}
