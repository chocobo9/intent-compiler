import { rmSync } from "node:fs"
import { anchorNames } from "./execution.js"
import type { Anchor } from "./anchors.js"
import type { BuildResult } from "./execution.js"
import { mapPool } from "./pool.js"
import { applyMutation, mutationSites, type MutationSite } from "./mutation.js"
import type { PlatformOptions } from "./platform.js"
import { runProbes, type ProbeOutput, type ProbeRecord } from "./probes.js"
import type { Registry } from "./registry.js"
import type { CheckRunner, ProgramRef } from "./runner.js"
import type { AnchorLink } from "./workorder.js"

/**
 * Whether the probes tell right from wrong, measured by code (BLOCK10 §7.3), independently of what the writer says:
 * mutants of the program under test (a comparison negated or its boundary moved by one, a constant ±1, a branch
 * emptied) are built, and the probes of the object whose code was changed are run on each. A mutant no probe's
 * output tells from the program is a weak spot of that object's probes. Objects come from the anchor the mutated
 * line is in: its links (named, or changed by a cycle that worked on the object) or its name.
 */

export interface MutantOutcome {
  site: MutationSite
  /** The function the site is in, and the objects it belongs to. */
  anchor: string | null
  objects: string[]
  status: "killed" | "survived" | "build_failed"
  killed_by: string[]
}

export interface WeakSpot { object: string; units: string[]; probes: string[]; sites: string[]; message: string }

export interface Discrimination {
  /** Sites found, attributed to an object with probes, and run. */
  sites: { found: number; attributed: number; run: number }
  mutants: MutantOutcome[]
  counts: { killed: number; survived: number; build_failed: number }
  /** killed / (killed + survived); null when none built. */
  score: number | null
  weak: WeakSpot[]
}

export interface DiscriminationDeps {
  build: (dir: string, label: string) => BuildResult
  /** A non-blocking build: with it, mutants are built and run `concurrency` at a time (default MUTANT_CONCURRENCY). */
  buildAsync?: (dir: string, label: string) => Promise<BuildResult>
  concurrency?: number
  runner: CheckRunner
  registry: Registry
  anchors: readonly Anchor[]
  links: readonly AnchorLink[]
  timeoutMs: number
  /** Mutants run at most (spread over the objects round-robin). */
  max: number
  /** Only sites in these objects' code (the round's task); all objects when absent. */
  objects?: ReadonlySet<string>
  platform?: PlatformOptions
}

const TIME = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/gu
/** An output as compared: timestamps blanked, as the judge's kept verdicts are. */
const steady = (o: ProbeOutput) => JSON.stringify(o).replace(TIME, "<time>")

/** Mutants built and run side by side, and probes per mutant at a time: at most 2 × 2 programs under test at once. */
export const MUTANT_CONCURRENCY = 2
const PROBES_PER_MUTANT = 2

const buildOf = (deps: DiscriminationDeps) => deps.buildAsync ?? (async (dir: string, label: string) => deps.build(dir, label))

/** How a mutant changed the program, in words the writer can use without seeing the code. */
export function describeSite(site: MutationSite): string {
  if (site.kind === "branch") return "the body of an if statement emptied"
  if (site.kind === "constant") return `a constant ${site.from} changed to ${site.to}`
  return `a comparison ${site.from} changed to ${site.to}`
}

/** The objects an anchor belongs to: by its links, else by its name. */
export function objectsOfAnchor(registry: Registry, links: readonly AnchorLink[], anchor: Anchor): string[] {
  const linked = [...new Set(links.filter(l => l.anchor === anchor.id).map(l => l.object))]
  if (linked.length) return linked
  return [...registry.objects.values()].filter(o => anchorNames(anchor.id, o.name)).map(o => o.id)
}

export async function discriminate(source: string, program: ProgramRef, probes: readonly ProbeRecord[], deps: DiscriminationDeps): Promise<Discrimination> {
  const owner = (unit: string) => deps.registry.coverOf(unit)?.owner
  const probesOf = new Map<string, ProbeRecord[]>()
  for (const p of probes) for (const o of new Set(p.covers.map(c => owner(c.unit)).filter((x): x is string => !!x && x !== "none"))) probesOf.set(o, [...(probesOf.get(o) ?? []), p])
  const all = mutationSites(source, deps.platform)
  const funcs = deps.anchors.filter(a => a.kind === "func")
  const placed = all.map(site => {
    const anchor = funcs.filter(a => a.file === site.file && a.start_line <= site.line && site.line <= a.end_line).sort((x, y) => (x.end_line - x.start_line) - (y.end_line - y.start_line))[0] ?? null
    const objects = anchor ? objectsOfAnchor(deps.registry, deps.links, anchor).filter(o => probesOf.has(o) && (!deps.objects || deps.objects.has(o))) : []
    return { site, anchor, objects }
  }).filter(x => x.objects.length)
  // Round-robin over objects, each object's sites in file order, so every object gets its share of the budget.
  const queues = new Map<string, typeof placed>()
  for (const x of placed) queues.set(x.objects[0], [...(queues.get(x.objects[0]) ?? []), x])
  const chosen: typeof placed = []
  for (let k = 0; chosen.length < deps.max && [...queues.values()].some(q => q.length > k); k++) for (const q of queues.values()) if (q[k] && chosen.length < deps.max) chosen.push(q[k])
  const relevant = (objects: string[]) => [...new Set(objects.flatMap(o => probesOf.get(o) ?? []))]
  const baseline = new Map((await runProbes(relevant([...queues.keys()]), program, deps.runner, deps.timeoutMs)).map(r => [r.probe, steady(r.output)]))
  const mutants: MutantOutcome[] = await mapPool(chosen, deps.buildAsync ? deps.concurrency ?? MUTANT_CONCURRENCY : 1, async x => {
    const dir = applyMutation(source, x.site)
    try {
      const built = await buildOf(deps)(dir, `mutant-${x.site.id}`)
      if (!built.ok) return { site: x.site, anchor: x.anchor?.id ?? null, objects: x.objects, status: "build_failed" as const, killed_by: [] }
      const runs = await runProbes(relevant(x.objects), built.program!, deps.runner, deps.timeoutMs, PROBES_PER_MUTANT)
      const killed_by = runs.filter(r => steady(r.output) !== baseline.get(r.probe)).map(r => r.probe)
      return { site: x.site, anchor: x.anchor?.id ?? null, objects: x.objects, status: killed_by.length ? "killed" as const : "survived" as const, killed_by }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  const counts = { killed: mutants.filter(m => m.status === "killed").length, survived: mutants.filter(m => m.status === "survived").length, build_failed: mutants.filter(m => m.status === "build_failed").length }
  const weak: WeakSpot[] = []
  for (const object of [...new Set(mutants.filter(m => m.status === "survived").flatMap(m => m.objects))]) {
    const survived = mutants.filter(m => m.status === "survived" && m.objects.includes(object))
    const mine = probesOf.get(object) ?? []
    const units = [...new Set(mine.flatMap(p => p.covers.map(c => c.unit)).filter(u => owner(u) === object))]
    weak.push({
      object, units, probes: mine.map(p => p.id), sites: survived.map(m => m.site.id),
      message: `The probes of ${units.join(", ")} gave the same output for the program and for variants of it changed where it implements these rules (${[...new Set(survived.map(m => describeSite(m.site)))].join("; ")}). Add probes whose output would differ between the program and such a variant; the text of these units says which output it requires.`,
    })
  }
  const run = counts.killed + counts.survived
  return { sites: { found: all.length, attributed: placed.length, run: chosen.length }, mutants, counts, score: run ? counts.killed / run : null, weak }
}

/** The survivors of an earlier measure, run again with the probes as they are now (after strengthening). */
export async function remeasure(source: string, program: ProgramRef, probes: readonly ProbeRecord[], earlier: Discrimination, deps: DiscriminationDeps): Promise<{ still: string[]; killed: string[] }> {
  const owner = (unit: string) => deps.registry.coverOf(unit)?.owner
  const survivors = earlier.mutants.filter(m => m.status === "survived")
  if (!survivors.length) return { still: [], killed: [] }
  const relevant = (objects: string[]) => probes.filter(p => p.covers.some(c => objects.includes(owner(c.unit) ?? "")))
  const baseline = new Map((await runProbes(relevant([...new Set(survivors.flatMap(m => m.objects))]), program, deps.runner, deps.timeoutMs)).map(r => [r.probe, steady(r.output)]))
  const told = await mapPool(survivors, deps.buildAsync ? deps.concurrency ?? MUTANT_CONCURRENCY : 1, async m => {
    const dir = applyMutation(source, m.site)
    try {
      const built = await buildOf(deps)(dir, `mutant-${m.site.id}-again`)
      if (!built.ok) return null
      const runs = await runProbes(relevant(m.objects), built.program!, deps.runner, deps.timeoutMs, PROBES_PER_MUTANT)
      return runs.some(r => steady(r.output) !== baseline.get(r.probe))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  return { still: survivors.filter((_, i) => told[i] === false).map(m => m.site.id), killed: survivors.filter((_, i) => told[i] === true).map(m => m.site.id) }
}
