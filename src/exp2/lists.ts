import type { CheckRecord } from "./checks.js"
import type { ExecutionRecord } from "./execution.js"
import { programArgs, type SessionFile } from "./materials.js"
import type { Registry } from "./registry.js"
import type { ProgramRun } from "./review.js"
import { objectsNamed, type ChangeUnit } from "./units.js"
import { contextOf, currentView, headingPath, paragraphInForce } from "./view.js"

/**
 * The review's scope (batch 4 E4, DESIGN-DEEP §2.2, the design session's choices of 2026-10-25): which commands are
 * put before the reviewer this round besides this round's text, and why, from facts code holds (no model):
 * - the open list: commands with a failing check, an untouched item or an open item as the round starts. An earlier
 *   library check that fails gives one line (its id and why; it goes to the reviewer as a lead already); an item
 *   carried in gives the paragraphs its units are in, as they stand;
 * - the patrol list: earlier commands that had findings and none for PATROL_QUIET rounds or more, PATROL_MAX a round,
 *   the longest unvisited first (a command patrolled counts as visited), each with its text in force up to
 *   PATROL_TEXT_MAX characters (past that, its heading paths and its first paragraph);
 * - change units of this round across commands, each command named; global units ("any `X` command").
 * Past the soft cap the patrol text goes first, then the carried items' paragraphs, the earliest items first; the
 * commands and their reasons always stay. Afterwards the reviewer's sessions say which commands it ran.
 */

export const PATROL_MAX = 2
/** Rounds without any item before an earlier command is patrolled. */
export const PATROL_QUIET = 2
/** A patrolled command's text at most; past it, its heading paths and first paragraph. */
export const PATROL_TEXT_MAX = 3_000
/** Soft cap on the characters the lists add to a review request (the design session's decision 6). */
export const LISTS_SOFT_CAP = 15_000

/** A paragraph a listed command comes with, and the round of the item that brought it (the cap drops the earliest first). */
export interface ListedText { paragraph: string; text: string; round: number }
export interface ListedCommand { object: string; name: string; reasons: string[]; texts: ListedText[] }
export interface ReviewLists {
  open: ListedCommand[]
  patrol: ListedCommand[]
  /** This round's units across two commands or more: each of their commands needs a run. */
  cross: { id: string; name: string; objects: string[]; names: string[] }[]
  /** This round's global units, and the flag a run shows it by (null: none could be read from the text). */
  global: { id: string; text: string; flag: string | null }[]
  /** Characters the lists add, and what the cap left out (patrol commands, carried items' paragraphs). */
  chars: number
  dropped_text: string[]
}

/** An open fact as the round starts: a carried item (its units' paragraphs come along) or a failing check (a line). */
export interface OpenFact { id: string; kind: "carried" | "check"; round: number; object: string | null; units: readonly string[]; why: string }

const owner = (registry: Registry, u: string) => { const o = registry.coverOf(u)?.owner; return o && o !== "none" ? o : null }

/** The commands an item's units fall on (or its check's object). */
export function objectsOfItem(registry: Registry, item: { object?: string | null; units: readonly string[] }): string[] {
  if (item.object && item.object !== "none" && registry.objects.has(item.object)) return [item.object]
  return [...new Set(item.units.map(u => owner(registry, u)).filter((o): o is string => !!o))]
}

/** The open list: each command with its open facts' reasons, and the paragraphs its carried items rest on. */
export function openList(registry: Registry, round: number, facts: readonly OpenFact[]): ListedCommand[] {
  const by = new Map<string, ListedCommand>()
  for (const f of facts) for (const o of objectsOfItem(registry, f)) {
    const c = by.get(o) ?? { object: o, name: registry.objects.get(o)?.name ?? o, reasons: [], texts: [] }
    c.reasons.push(`${f.id}: ${f.why}`)
    if (f.kind === "carried") for (const u of f.units.filter(x => registry.block(x) && owner(registry, x) === o)) {
      const p = contextOf(registry, u).id
      const text = paragraphInForce(registry, p, round)
      if (text.trim() && !c.texts.some(t => t.paragraph === p)) c.texts.push({ paragraph: p, text, round: f.round })
    }
    by.set(o, c)
  }
  return [...by.values()].sort((a, b) => Number(a.object.slice(1)) - Number(b.object.slice(1)))
}

/** A patrolled command's text in force, within PATROL_TEXT_MAX: else its heading paths and its first paragraph. */
export function patrolText(registry: Registry, object: string, round: number): string {
  const view = currentView(registry, object, round)
  if (view.length <= PATROL_TEXT_MAX) return view
  const paras = [...new Set((registry.objects.get(object)?.blocks ?? []).filter(b => b.round <= round).map(b => contextOf(registry, b.block).id))]
  const live = paras.filter(p => paragraphInForce(registry, p, round).trim())
  const paths = [...new Set(live.map(p => headingPath(registry, registry.block(p)!).map(h => h.replace(/^#+\s*/u, "")).join(" › ")).filter(Boolean))]
  return [...paths.map(p => `- ${p}`), "", live.length ? paragraphInForce(registry, live[0], round).trim() : ""].join("\n")
}

/**
 * The patrol list: commands of earlier rounds that had review items, none in the last PATROL_QUIET rounds or more,
 * not on the open list; the ones longest since an item or a patrol first, PATROL_MAX of them.
 */
export function patrolList(registry: Registry, round: number, executions: readonly ExecutionRecord[], open: readonly string[]): ListedCommand[] {
  const last = new Map<string, number>()
  const seen = (o: string, r: number) => last.set(o, Math.max(last.get(o) ?? 0, r))
  const items = new Set<string>()
  for (const e of executions.filter(x => x.round < round)) {
    for (const i of e.review_items ?? []) for (const o of objectsOfItem(registry, { units: i.units })) { seen(o, e.round); items.add(o) }
    for (const p of e.accept?.lists?.patrol ?? []) seen(p, e.round)
  }
  return [...items]
    .filter(o => !open.includes(o) && registry.objects.has(o) && (last.get(o) ?? 0) <= round - 1 - PATROL_QUIET && currentView(registry, o, round).trim())
    .sort((a, b) => (last.get(a)! - last.get(b)!) || Number(a.slice(1)) - Number(b.slice(1)))
    .slice(0, PATROL_MAX)
    .map(o => ({ object: o, name: registry.objects.get(o)!.name, reasons: [`last item in round ${last.get(o)}`], texts: [{ paragraph: o, text: patrolText(registry, o, round), round: 0 }] }))
}

/** The flag a global unit's sentence names (`--audit`), by which a run shows the behaviour; null when it names none. */
export function globalFlag(text: string): string | null {
  return /`(--[a-z][\w-]*)/iu.exec(text)?.[1] ?? null
}

/** The lists of a round within the soft cap: past it, the patrol text goes, then carried items' paragraphs, the earliest first. */
export function reviewLists(registry: Registry, round: number, facts: readonly OpenFact[], executions: readonly ExecutionRecord[], cap = LISTS_SOFT_CAP): ReviewLists {
  const open = openList(registry, round, facts)
  const patrol = patrolList(registry, round, executions, open.map(c => c.object))
  const units: ChangeUnit[] = registry.units(round).filter(u => u.round === round && u.source !== "revision")
  const cross = units.filter(u => !u.all && u.objects.length >= 2).map(u => ({ id: u.id, name: u.name, objects: u.objects, names: u.objects.map(o => registry.objects.get(o)?.name ?? o) }))
  const global = units.filter(u => u.all).map(u => { const text = u.members.map(m => registry.block(m)?.text.trim() ?? "").join(" "); return { id: u.id, text, flag: globalFlag(text) } })
  const size = () => [...open, ...patrol].reduce((n, c) => n + c.name.length + c.reasons.join("; ").length + c.texts.reduce((m, t) => m + t.text.length, 0), 0) + cross.reduce((n, u) => n + u.name.length + u.names.join(", ").length, 0) + global.reduce((n, g) => n + g.text.length, 0)
  const dropped: string[] = []
  for (const c of [...patrol].reverse()) { if (size() <= cap) break; if (c.texts.length) { c.texts = []; dropped.push(`patrol ${c.object}`) } }
  const carried = open.flatMap(c => c.texts.map(t => ({ c, t }))).sort((a, b) => a.t.round - b.t.round || a.t.paragraph.localeCompare(b.t.paragraph))
  for (const { c, t } of carried) { if (size() <= cap) break; c.texts = c.texts.filter(x => x !== t); dropped.push(`${c.object} ${t.paragraph}`) }
  return { open, patrol, cross, global, chars: size(), dropped_text: dropped }
}

/** A run's arguments, and the commands it exercised: its subcommand, and for a transform the ops of the recipe it read. */
function runCommands(registry: Registry, run: ProgramRun, files: readonly SessionFile[], binary: string): { args: string[]; objects: string[] } | null {
  const args = programArgs(run.command, binary)
  if (!args?.length) return null
  const objects = [...objectsNamed(registry, args[0])]
  const recipe = args.includes("--recipe") ? args[args.indexOf("--recipe") + 1] : undefined
  if (recipe) {
    const f = files.find(x => x.path.replace(/\\/gu, "/").split("/").pop() === recipe.replace(/\\/gu, "/").split("/").pop())
    try {
      const j = JSON.parse(f?.content ?? "null") as unknown
      const ops = (Array.isArray(j) ? j : (j as { steps?: unknown[] } | null)?.steps ?? []) as { op?: unknown }[]
      for (const op of ops) if (typeof op?.op === "string") objects.push(...objectsNamed(registry, op.op))
    } catch { /* a recipe that does not parse names no op */ }
  }
  return { args, objects: [...new Set(objects)] }
}

/** The commands the reviews exercised (units.ts objectsNamed on each run's subcommand and recipe ops). */
export function exercised(registry: Registry, runs: readonly ProgramRun[], files: readonly SessionFile[], binary: string): Set<string> {
  return new Set(runs.flatMap(r => runCommands(registry, r, files, binary)?.objects ?? []))
}

/** For each global unit with a flag: the subcommands its runs used it with (strict: the flag on the command line). */
export function globalCoverage(registry: Registry, lists: ReviewLists, runs: readonly ProgramRun[], files: readonly SessionFile[], binary: string): { id: string; flag: string | null; commands: string[] }[] {
  return lists.global.map(g => {
    if (!g.flag) return { id: g.id, flag: null, commands: [] }
    const subs = new Set(runs.flatMap(r => { const c = runCommands(registry, r, files, binary); return c && c.args.includes(g.flag!) ? [c.args[0]] : [] }))
    return { id: g.id, flag: g.flag, commands: [...subs].sort() }
  })
}

/**
 * What the lists asked that the reviews did not run: listed commands never run, units across commands short of a
 * command, global units used on fewer than two commands (one whose flag cannot be read is undecided, no gap).
 */
export function coverageGaps(lists: ReviewLists, ran: ReadonlySet<string>, global: readonly { id: string; flag: string | null; commands: string[] }[]): string[] {
  const gaps: string[] = []
  for (const c of [...lists.open, ...lists.patrol]) if (!ran.has(c.object)) gaps.push(`${c.object} ${c.name}: listed, never run`)
  for (const u of lists.cross) { const missing = u.objects.filter(o => !ran.has(o)); if (missing.length) gaps.push(`${u.id} ${u.name}: not run on ${missing.join(", ")}`) }
  for (const g of global) if (g.flag && g.commands.length < 2) gaps.push(`${g.id}: ${g.flag} used on ${g.commands.length} command${g.commands.length === 1 ? "" : "s"}`)
  return gaps
}

/** A failing earlier library check as an open fact: one line, its id and why. */
export const checkFact = (k: Pick<CheckRecord, "id" | "round" | "object" | "blocks">, why = "fails on the program as it stands"): OpenFact => ({ id: k.id, kind: "check", round: k.round, object: k.object, units: k.blocks, why })
