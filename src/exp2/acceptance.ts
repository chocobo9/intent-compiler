import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { AnchorExtractor } from "./anchors.js"
import type { TokenUsage } from "./attribution.js"
import { codeFacts } from "./checks.js"
import type { Product } from "./detect.js"
import { executeRound, repairMessage, type BuildResult, type ExecutionLimits, type ExecutionRecord, type Executor } from "./execution.js"
import { commitStep, git, head, initRepo } from "./git.js"
import { correctionItems, pairKey, probeStatuses, renderCorrections, type CorrectionItem, type Finding, type JudgeTransport } from "./judge.js"
import { activeProbes, runProbes, type ProbeRoundRecord, type ProbeTransport } from "./probes.js"
import { addUsage } from "./report.js"
import type { CheckRunner, ProgramRef } from "./runner.js"
import type { Exp2Store } from "./store.js"
import { buildWorkOrder } from "./workorder.js"

/**
 * Measurement for the offline acceptance of BLOCK10 (REPAIR-BLOCK §4), local only. Nothing here is read by the
 * system: official results and the defect table are printed next to what the system found.
 */

export interface DefectTable { clean: string[]; defects: { name: string; products: string[]; pattern: string }[] }

export interface ProductFindings { product: string; items: CorrectionItem[]; findings: Finding[]; probeKey: (probe: string) => string }

/** Hits per defect (a product's correction list has an item matching the pattern), and items on the clean products. */
export function scoreDefects(table: DefectTable, lists: readonly ProductFindings[]): { rows: { name: string; hit: string[]; of: string[] }[]; hits: number; total: number; clean: { product: string; items: number }[] } {
  const by = new Map(lists.map(l => [l.product, l]))
  const text = (l: ProductFindings, it: CorrectionItem) => `${l.probeKey(it.probe)} ${it.rule.id} ${it.finding}`
  const rows = table.defects.map(d => {
    const re = new RegExp(d.pattern, "iu")
    return { name: d.name, of: d.products, hit: d.products.filter(p => { const l = by.get(p); return !!l && l.items.some(it => re.test(text(l, it))) }) }
  })
  return {
    rows, hits: rows.reduce((n, r) => n + r.hit.length, 0), total: rows.reduce((n, r) => n + r.of.length, 0),
    clean: table.clean.map(p => ({ product: p, items: by.get(p)?.items.length ?? NaN })),
  }
}

export interface OfficialResult { passed: number; total: number; cases: Map<string, boolean> | null }

const CASE = /CASE_RESULT case_id=(\S+)[^\r\n]*?requirement_ref=(\S+)[^\r\n]*? status=(success|pass|fail)\b[^\r\n]*?intent="([^"]*)" scenario="([^"]*)"/gu

/** Official cases by (requirement, intent, scenario), from a verifier log (case ids change every round). */
export function casesFromLog(text: string): Map<string, boolean> {
  const out = new Map<string, boolean>()
  for (const m of text.matchAll(CASE)) out.set(`${m[2]} | ${m[4]} | ${m[5]}`, m[3] !== "fail")
  return out
}

/**
 * Runs the scoring command ({round}, {commit}, {repo} filled in). It prints {"passed", "total"} and, for the
 * per-case comparison, either "cases" ({key: "pass" | "fail" | boolean}) or "verifier_log" (a path).
 */
export function officialScore(command: readonly string[], round: number, commit: string, repo: string): OfficialResult {
  const fill = (s: string) => s.replaceAll("{round}", String(round)).replaceAll("{commit}", commit).replaceAll("{repo}", repo)
  const [cmd, ...args] = command.map(fill)
  const raw = execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim().split("\n").pop()!
  const o = JSON.parse(raw) as { passed: number; total: number; cases?: Record<string, string | boolean>; verifier_log?: string }
  const cases = o.cases ? new Map(Object.entries(o.cases).map(([k, v]) => [k, v === true || v === "pass" || v === "success"])) : o.verifier_log && existsSync(o.verifier_log) ? casesFromLog(readFileSync(o.verifier_log, "utf8")) : null
  return { passed: o.passed, total: o.total, cases }
}

/** Case by case: fixed (failed before, passes after), broke (passed before, fails after), still failing. */
export function compareCases(before: Map<string, boolean>, after: Map<string, boolean>): { fixed: string[]; broke: string[]; still: string[] } {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort()
  return {
    fixed: keys.filter(k => before.get(k) === false && after.get(k) === true),
    broke: keys.filter(k => before.get(k) === true && after.get(k) === false),
    still: keys.filter(k => before.get(k) === false && after.get(k) === false),
  }
}

/** The first line of a repair harness session: what the session is given. */
export const REPAIR_INTRO = "The Go program in this directory was built from the requirements below. An independent check ran the program and compared what it did with the requirements; the correction list after the requirements is what it found."

// ---------------------------------------------------------------- the two harnesses, with their dependencies passed in

export interface HarnessDeps {
  store: Exp2Store
  judge: JudgeTransport
  build: (dir: string, label: string) => BuildResult
  runner: CheckRunner
  timeoutMs: number
}

export interface DetectedProduct {
  product: Product
  built: boolean
  build_output?: string
  items: CorrectionItem[]
  findings: Finding[]
  ambiguous: Finding[]
  /** Judge calls for this product (outputs seen on an earlier product are not judged again). */
  judge_calls: number
  judge_tokens: TokenUsage
}

/** Writes the round's probes once (unless the state has them), then runs and judges them on each product in turn. */
export async function probeDetect(deps: HarnessDeps & { probes: ProbeTransport }, products: readonly Product[], round = 1): Promise<{ written: ProbeRoundRecord | null; products: DetectedProduct[] }> {
  const { store } = deps
  const written = store.inspect().probe_rounds.some(r => r.round === round && r.status === "accepted") ? null : await store.deriveRoundProbes(round, deps.probes)
  if (written?.status === "interrupted") throw new Error(`probe writing interrupted: ${JSON.stringify(written.issues)}`)
  const out: DetectedProduct[] = []
  for (const p of products) {
    const b = deps.build(p.path, `probe-${p.name}`)
    if (!b.ok) { out.push({ product: p, built: false, build_output: b.output.slice(0, 2000), items: [], findings: [], ambiguous: [], judge_calls: 0, judge_tokens: zero() }); continue }
    const s = store.inspect(), probes = activeProbes(s.probes, s.probe_events).filter(x => x.round <= p.round)
    const runs = await runProbes(probes, b.program!, deps.runner, deps.timeoutMs)
    const before = store.inspect().judge_calls.length
    const findings = await store.judge(p.round, runs, deps.judge)
    const calls = store.inspect().judge_calls.slice(before)
    out.push({
      product: p, built: true, findings, items: correctionItems(store.registry(), probes, runs, findings), ambiguous: findings.filter(f => f.verdict === "ambiguous"),
      judge_calls: calls.length, judge_tokens: calls.reduce((t, c) => addUsage(t, c.usage), zero()),
    })
  }
  return { written, products: out }
}

export interface RepairedProduct {
  product: Product
  base: string
  record: ExecutionRecord | null
  items_before: string[]
  open_after: string[]
  official_before?: OfficialResult
  official_after?: OfficialResult
  cases?: ReturnType<typeof compareCases>
}

/**
 * Repairs each product from its correction list with the round's flow (BLOCK10 §1.5): a copy of its repository, one
 * execution session whose first message is the requirements and the correction list, then the cycles (probes run
 * again on every reply, the judge sees what changed). Scored before and after with the official command, if given.
 */
export async function repairProducts(deps: HarnessDeps & { executor: () => Executor; anchors: AnchorExtractor; limits: ExecutionLimits; binary: string; text: (round: number) => string; score?: (commit: string, repo: string, round: number) => OfficialResult }, products: readonly Product[], root: string): Promise<RepairedProduct[]> {
  const out: RepairedProduct[] = []
  for (const p of products) {
    const workdir = join(root, p.name, "app")
    if (!existsSync(workdir)) {
      mkdirSync(join(root, p.name), { recursive: true })
      if (existsSync(join(p.path, ".git"))) git(join(root, p.name), ["clone", "-q", p.path, workdir])
      else { cpSync(p.path, workdir, { recursive: true }); initRepo(workdir); commitStep(workdir, "product as given", [["IC-Round", "0"]]) }
    }
    const base = head(workdir)
    const registry = deps.store.registry()
    const s = deps.store.inspect(), probes = activeProbes(s.probes, s.probe_events).filter(x => x.round <= p.round)
    const detect = async (program: ProgramRef, before: ReadonlySet<string>, contests: ReadonlyMap<string, string>) => {
      const runs = await runProbes(probes, program, deps.runner, deps.timeoutMs)
      const findings = await deps.store.judge(p.round, runs, deps.judge, { contests })
      return { findings, items: correctionItems(deps.store.registry(), probes, runs, findings, before) }
    }
    const b = deps.build(workdir, `repair-${p.name}-base`)
    if (!b.ok) { out.push({ product: p, base, record: null, items_before: [], open_after: [] }); continue }
    const start = await detect(b.program!, new Set(), new Map())
    const official_before = deps.score?.(base, workdir, p.round)
    if (!start.items.length) { out.push({ product: p, base, record: null, items_before: [], open_after: [], ...(official_before ? { official_before } : {}) }); continue }
    const requirements = [...registry.sources.values()].filter(x => x.round <= p.round).map(x => deps.text(x.round)).join("\n\n")
    const text = [
      REPAIR_INTRO,
      "", "# Requirements", "", requirements, "", "# Correction list", "",
      repairMessage("", { ok: true, output: "" }, renderCorrections(start.items, deps.binary)),
    ].join("\n")
    const workorder = buildWorkOrder({ registry, round: p.round, library: [], events: [], statuses: probeStatuses(registry, start.findings), runs: [], anchors: deps.anchors.extract(workdir), links: [], steps: [], previous_task: [] })
    const passed = new Set(start.findings.filter(f => f.verdict === "ok").map(f => pairKey(f.probe, f.unit)))
    const record = await executeRound(workdir, workorder, text, deps.executor(), {
      registry, library: [], events: [], links: [], anchors: deps.anchors, build: deps.build, runner: deps.runner, facts: codeFacts(registry, p.round),
      detect: { passed, program: deps.binary, run: detect },
    }, deps.limits)
    const official_after = deps.score?.(head(workdir), workdir, p.round)
    out.push({
      product: p, base, record, items_before: start.items.map(i => i.key), open_after: record.open,
      ...(official_before ? { official_before } : {}), ...(official_after ? { official_after } : {}),
      ...(official_before?.cases && official_after?.cases ? { cases: compareCases(official_before.cases, official_after.cases) } : {}),
    })
  }
  return out
}

const zero = (): TokenUsage => ({ input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 })
