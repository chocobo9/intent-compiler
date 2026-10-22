import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Anchor } from "./anchors.js"
import { exeName, goCommand, type PlatformOptions } from "./platform.js"

/**
 * What a run executed (DESIGN §12h E4): the program is built with `go build -cover`, each run writes its counters to
 * a directory of its own (GOCOVERDIR), and Go's covdata tool turns them into the text profile. Code maps the blocks
 * that ran onto the function anchors of the tree the program was built from. A cycle then runs the checks and probes
 * whose last run executed a function the cycle changed. Nothing here involves a model.
 */

/** One block of a text profile: file (as Go names it: module path and file), lines, and whether it ran. */
export interface ProfileBlock { file: string; start: number; end: number; count: number }

const LINE = /^(.+):(\d+)\.\d+,(\d+)\.\d+ \d+ (\d+)$/u

export function parseProfile(text: string): ProfileBlock[] {
  return text.split(/\r?\n/u).flatMap(l => { const m = LINE.exec(l.trim()); return m ? [{ file: m[1], start: Number(m[2]), end: Number(m[3]), count: Number(m[4]) }] : [] })
}

/** Only the blocks that ran, which is all the selection needs (the profile of a run gets much shorter). */
export function ranOnly(text: string): string {
  return text.split(/\r?\n/u).filter(l => { const m = LINE.exec(l.trim()); return m && Number(m[4]) > 0 }).join("\n")
}

/** The function anchors (ids) whose lines hold a block that ran; a profile file matches an anchor's relative path. */
export function coveredFunctions(profile: string, anchors: readonly Anchor[]): string[] {
  const funcs = anchors.filter(a => a.kind === "func")
  const byFile = new Map<string, Anchor[]>()
  for (const a of funcs) byFile.set(a.file, [...(byFile.get(a.file) ?? []), a])
  const files = [...byFile.keys()]
  const fileOf = new Map<string, string | null>()
  const out = new Set<string>()
  for (const b of parseProfile(profile)) {
    if (b.count <= 0) continue
    if (!fileOf.has(b.file)) fileOf.set(b.file, files.find(f => b.file === f || b.file.endsWith(`/${f}`)) ?? null)
    const f = fileOf.get(b.file)
    if (!f) continue
    for (const a of byFile.get(f)!) if (b.start <= a.end_line && b.end >= a.start_line) out.add(a.id)
  }
  return [...out].sort()
}

const tools = new Map<string, string | null>()

/** Go's covdata tool, found once through `go env GOTOOLDIR`; null when there is no Go here. */
export function covdataTool(platform: PlatformOptions = {}): string | null {
  const go = goCommand(platform)
  if (tools.has(go)) return tools.get(go)!
  let tool: string | null = null
  try {
    const dir = execFileSync(go, ["env", "GOTOOLDIR"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    const path = join(dir, exeName("covdata", platform))
    tool = dir && existsSync(path) ? path : null
  } catch { tool = null }
  tools.set(go, tool)
  return tool
}

/** The text profile of the counters in `dir` (blocks that ran only), or undefined when the run wrote none. */
export function readCoverage(dir: string, platform: PlatformOptions = {}): string | undefined {
  if (!existsSync(dir) || !readdirSync(dir).some(f => f.startsWith("covmeta."))) return undefined
  const tool = covdataTool(platform)
  if (!tool) return undefined
  const out = join(dir, "profile.txt")
  try { execFileSync(tool, ["textfmt", `-i=${dir}`, `-o=${out}`], { stdio: "ignore" }) } catch { return undefined }
  try { return ranOnly(readFileSync(out, "utf8")) } catch { return undefined }
}

/**
 * Which checks and probes a cycle runs (DESIGN §12h E4), by code: those on the round's changed text, the ledger's open
 * items, and those whose last run executed a function this cycle changed. A change code cannot follow through the
 * coverage (outside any function: a type, a package-level value, a file's top) selects everything; so does an id
 * with no coverage yet.
 */
export interface Selection { all: string | null; changed_functions: string[]; outside: string[] }

/** What a cycle changed, as coverage can follow it: the changed functions, or why everything has to run. */
export function changeScope(before: readonly Anchor[], after: readonly Anchor[]): Selection {
  const hash = (list: readonly Anchor[]) => new Map(list.map(a => [a.id, a.hash]))
  const b = hash(before), a = hash(after)
  const changed = [...new Set([...a.keys(), ...b.keys()])].filter(id => a.get(id) !== b.get(id))
  const all = [...before, ...after]
  const byId = new Map(all.map(x => [x.id, x]))
  const funcs = changed.filter(id => byId.get(id)!.kind === "func")
  // An anchor inside a changed function changed with it; a changed file whose change no inner anchor accounts for
  // changed outside any function.
  const inside = (x: Anchor) => funcs.some(f => { const g = byId.get(f)!; return g.file === x.file && g.start_line <= x.start_line && x.end_line <= g.end_line })
  const outside = changed.filter(id => { const x = byId.get(id)!; return x.kind !== "func" && x.kind !== "file" && !inside(x) })
  for (const id of changed.filter(id => byId.get(id)!.kind === "file")) {
    const file = byId.get(id)!.file
    if (!changed.some(c => c !== id && byId.get(c)!.file === file)) outside.push(id)
  }
  return { all: outside.length ? `a change outside any function: ${outside.slice(0, 5).join(", ")}${outside.length > 5 ? ` and ${outside.length - 5} more` : ""}` : null, changed_functions: funcs.sort(), outside: outside.sort() }
}

/** A check or probe the selection can take: its id and the units it rests on. */
export interface Candidate { id: string; units: readonly string[] }

/** Why a cycle runs a check or probe (DESIGN §12h E4). */
export type SelectReason = "changed text" | "open item" | "executed a changed function" | "no coverage yet" | "everything"

/**
 * The checks or probes a cycle runs, each with its reason: on the round's changed text, an open item of the ledger,
 * a last run that executed a function the cycle changed, or no coverage yet; everything when the change is one
 * coverage cannot follow.
 */
export function selectRuns(candidates: readonly Candidate[], o: { units: ReadonlySet<string>; open: (id: string) => boolean; functions: (id: string) => readonly string[] | undefined; scope: Selection }): Map<string, SelectReason> {
  const changed = new Set(o.scope.changed_functions)
  const out = new Map<string, SelectReason>()
  for (const c of candidates) {
    const f = o.functions(c.id)
    const why: SelectReason | null = c.units.some(u => o.units.has(u)) ? "changed text" : o.open(c.id) ? "open item" : o.scope.all ? "everything" : f === undefined ? "no coverage yet" : f.some(x => changed.has(x)) ? "executed a changed function" : null
    if (why) out.set(c.id, why)
  }
  return out
}
