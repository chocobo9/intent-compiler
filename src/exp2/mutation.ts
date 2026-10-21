import { execFileSync } from "node:child_process"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { buildGoHelper, helperSource } from "./anchors.js"
import type { CheckRecord } from "./checks.js"
import type { BuildResult } from "./execution.js"
import { guardedSync, type PlatformOptions } from "./platform.js"
import type { Registry } from "./registry.js"
import type { CheckRunner } from "./runner.js"
import { runCheck } from "./verdict.js"
import type { CodeFacts } from "./checks.js"

/**
 * Simple mutation testing of produced Go code (DESIGN §12b item 13), to measure how strong the check library is.
 * Local only and on existing products: it never enters the round flow. Each mutant is one mechanical change (a
 * comparison swapped, a constant ±1, an if branch emptied) on a copy of the tree; a mutant is killed when a check
 * that passes on the original fails on it. Mutants that do not build are counted apart.
 */

export interface MutationSite { id: string; kind: "compare" | "boundary" | "constant" | "branch"; file: string; line: number; start: number; end: number; from: string; to: string }

export function mutationSites(dir: string, platform: PlatformOptions = {}): MutationSite[] {
  const bin = buildGoHelper(helperSource("mutate"), "mutate", platform)
  return JSON.parse(guardedSync("the mutate helper", () => execFileSync(bin, [resolve(dir)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }))) as MutationSite[]
}

/** An evenly spread, deterministic choice of at most `max` sites. */
export function sample<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items]
  return Array.from({ length: max }, (_, i) => items[Math.floor((i * items.length) / max)])
}

export interface MutantResult { site: MutationSite; status: "killed" | "survived" | "build_failed"; killed_by: string[] }

export interface MutationReport {
  source: string
  checks: number
  /** Checks passing on the original: only these can kill. */
  baseline_passing: string[]
  sites: number
  mutants: MutantResult[]
  counts: { killed: number; survived: number; build_failed: number }
  /** killed / (killed + survived); null when no mutant built. */
  score: number | null
}

export interface MutationDeps {
  build: (workdir: string, label: string) => BuildResult
  runner: CheckRunner
  registry: Registry
  facts: CodeFacts
  round: number
  checkTimeoutMs?: number
  platform?: PlatformOptions
}

/** Copies the tree (without .git), applies one site, and returns the copy. */
export function applyMutation(source: string, site: MutationSite): string {
  const dir = mkdtempSync(join(tmpdir(), "exp2-mutant-"))
  cpSync(source, dir, { recursive: true, filter: f => !/[\\/]\.git([\\/]|$)/u.test(f.slice(source.length)) })
  const file = join(dir, site.file)
  const text = readFileSync(file)
  if (text.subarray(site.start, site.end).toString("utf8") !== site.from) throw new Error(`${site.id}: ${site.file} changed since the sites were listed`)
  writeFileSync(file, Buffer.concat([text.subarray(0, site.start), Buffer.from(site.to, "utf8"), text.subarray(site.end)]))
  return dir
}

export async function mutationTest(source: string, checks: readonly CheckRecord[], deps: MutationDeps, max = 30): Promise<MutationReport> {
  const timeout = deps.checkTimeoutMs ?? 10_000
  const run = async (dir: string, label: string) => {
    const built = deps.build(dir, label)
    if (!built.ok) return null
    const out = new Map<string, boolean>()
    for (const c of checks) out.set(c.id, (await runCheck(c, built.program!, deps.runner, deps.round, deps.registry, deps.facts, timeout)).outcome === "pass")
    return out
  }
  const original = await run(source, "mutation-original")
  if (!original) throw new Error(`the original in ${source} does not build`)
  const passing = [...original.entries()].filter(([, ok]) => ok).map(([id]) => id)
  const all = mutationSites(source, deps.platform)
  const mutants: MutantResult[] = []
  for (const site of sample(all, max)) {
    const dir = applyMutation(source, site)
    try {
      const r = await run(dir, `mutant-${site.id}`)
      if (!r) { mutants.push({ site, status: "build_failed", killed_by: [] }); continue }
      const killed_by = passing.filter(id => !r.get(id))
      mutants.push({ site, status: killed_by.length ? "killed" : "survived", killed_by })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  const counts = { killed: mutants.filter(m => m.status === "killed").length, survived: mutants.filter(m => m.status === "survived").length, build_failed: mutants.filter(m => m.status === "build_failed").length }
  const built = counts.killed + counts.survived
  return { source, checks: checks.length, baseline_passing: passing, sites: all.length, mutants, counts, score: built ? counts.killed / built : null }
}

export function renderMutationReport(r: MutationReport): string {
  return [
    `# Mutation test of ${r.source}`, "",
    `Sites: ${r.sites}; mutants run: ${r.mutants.length}. Checks: ${r.checks}, passing on the original: ${r.baseline_passing.length}.`,
    `Killed ${r.counts.killed}, survived ${r.counts.survived}, did not build ${r.counts.build_failed}. Score: ${r.score === null ? "—" : r.score.toFixed(2)}.`, "",
    "| mutant | kind | where | change | result | killed by |", "|---|---|---|---|---|---|",
    ...r.mutants.map(m => `| ${m.site.id} | ${m.site.kind} | ${m.site.file}:${m.site.line} | \`${m.site.from.length > 30 ? "{…}" : m.site.from}\` → \`${m.site.to}\` | ${m.status} | ${m.killed_by.join(", ")} |`),
    "",
  ].join("\n")
}
