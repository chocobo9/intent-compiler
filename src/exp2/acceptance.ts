import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { discriminate, remeasure } from "./discrimination.js"
import type { PlatformOptions } from "./platform.js"
import { join } from "node:path"
import type { AnchorExtractor } from "./anchors.js"
import { AuthInvalid, QuotaExhausted, RoleUnavailable, type TokenUsage } from "./attribution.js"
import { codeFacts } from "./checks.js"
import type { Product } from "./detect.js"
import { executeRound, repairMessage, type BuildResult, type ExecutionLimits, type ExecutionRecord, type Executor } from "./execution.js"
import { commitStep, git, head, initRepo } from "./git.js"
import { correctionItems, pairKey, probeStatuses, renderCorrections, type CorrectionItem, type Finding, type JudgeTransport } from "./judge.js"
import { activeProbes, runProbes, type ProbeRoundRecord, type ProbeTransport } from "./probes.js"
import { addUsage } from "./report.js"
import type { CheckRunner, ProgramRef, ScriptSandbox } from "./runner.js"
import { Exp2Store } from "./store.js"
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
  /** Where computations the judge asks for run (BLOCK11 §4). */
  sandbox?: ScriptSandbox
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
  judge_calls: number
  judge_tokens: TokenUsage
  /** The discrimination measure on this product and the strengthening it led to (null when off). */
  measure: null | { mutants: number; killed: number; survived: number; build_failed: number; score: number | null; weak_units: string[]; strengthened: string[]; still_weak: number; writer_calls: number; writer_tokens: TokenUsage }
}

/**
 * Writes the round's probes once (unless the state has them). Then, for each product on its own copy of the state:
 * the discrimination measure on the product and the strengthening it calls for (when `mutants` > 0), and the runs
 * and the judge. A product never benefits from another's mutants or verdicts, as a round has only its own program.
 */
export async function probeDetect(deps: HarnessDeps & { probes: ProbeTransport; root: string; anchors?: AnchorExtractor; mutants?: number; platform?: PlatformOptions; maxRepairs?: number; buildAsync?: (dir: string, label: string) => Promise<BuildResult> }, products: readonly Product[], round = 1): Promise<{ written: ProbeRoundRecord | null; products: DetectedProduct[] }> {
  const base = deps.store
  const written = base.inspect().probe_rounds.some(r => r.round === round && r.status === "accepted") ? null : await base.deriveRoundProbes(round, deps.probes)
  // A writer that could not be reached, or wrote nothing usable, is no result: the harness stops with the cause.
  if (written?.status === "interrupted") {
    const i = written.issues?.[0]
    throw i?.code === "quota" ? new QuotaExhausted(`probe writing: ${i.message}`) : i?.code === "auth" ? new AuthInvalid(`probe writing: ${i.message}`) : new RoleUnavailable("probe writing", i?.message ?? "interrupted")
  }
  if (written && written.units.length && !written.entered.length) throw new Error(`probe writing admitted no probe for ${written.units.length} units (${written.calls.length} calls; ${written.dropped.length} dropped)`)
  const out: DetectedProduct[] = []
  for (const p of products) {
    const b = deps.build(p.path, `probe-${p.name}`)
    if (!b.ok) { out.push({ product: p, built: false, build_output: b.output.slice(0, 2000), items: [], findings: [], ambiguous: [], judge_calls: 0, judge_tokens: zero(), measure: null }); continue }
    const store = productStore(base, deps.root, p.name)
    let measure: DetectedProduct["measure"] = null
    if ((deps.mutants ?? 0) > 0 && deps.anchors) {
      const calls0 = store.inspect().probe_calls.length
      const md = { build: deps.build, ...(deps.buildAsync ? { buildAsync: deps.buildAsync } : {}), runner: deps.runner, registry: store.registry(), anchors: deps.anchors.extract(p.path), links: [], timeoutMs: deps.timeoutMs, max: deps.mutants!, platform: deps.platform }
      const s0 = store.inspect()
      const d = await discriminate(p.path, b.program!, activeProbes(s0.probes, s0.probe_events).filter(x => x.round <= p.round), md)
      let entered: string[] = [], after: { still: string[]; killed: string[] } | null = null
      if (d.weak.length) {
        const st = await store.strengthen(round, d.weak, deps.probes, { maxRepairs: deps.maxRepairs ?? 2 })
        if (st.status === "interrupted") throw new RoleUnavailable("probe strengthening", st.issues?.[0]?.message ?? "interrupted")
        entered = st.entered
        if (entered.length) { const s1 = store.inspect(); after = await remeasure(p.path, b.program!, activeProbes(s1.probes, s1.probe_events), d, { ...md, registry: store.registry() }) }
        await store.recordMeasure({ round, label: p.name, sites: d.sites, counts: d.counts, score: d.score, weak: d.weak.map(w => ({ object: w.object, units: w.units, sites: w.sites })), strengthen: { status: st.status, calls: st.calls, entered, dropped: st.dropped }, after })
      } else await store.recordMeasure({ round, label: p.name, sites: d.sites, counts: d.counts, score: d.score, weak: [], strengthen: null, after: null })
      const wc = store.inspect().probe_calls.slice(calls0)
      measure = { mutants: d.mutants.length, ...d.counts, score: d.score, weak_units: [...new Set(d.weak.flatMap(w => w.units))], strengthened: entered, still_weak: after ? after.still.length : d.counts.survived, writer_calls: wc.length, writer_tokens: wc.reduce((t, c) => addUsage(t, c.usage), zero()) }
    }
    const s = store.inspect(), probes = activeProbes(s.probes, s.probe_events).filter(x => x.round <= p.round)
    const runs = await runProbes(probes, b.program!, deps.runner, deps.timeoutMs)
    const before = store.inspect().judge_calls.length
    const findings = await store.judge(p.round, runs, deps.judge, { sandbox: deps.sandbox })
    const calls = store.inspect().judge_calls.slice(before)
    out.push({
      product: p, built: true, findings, items: correctionItems(store.registry(), probes, runs, findings), ambiguous: findings.filter(f => f.verdict === "ambiguous"),
      judge_calls: calls.length, judge_tokens: calls.reduce((t, c) => addUsage(t, c.usage), zero()), measure,
    })
  }
  return { written, products: out }
}

/** A product's own copy of the state, under <root>/products/<name>/store: made from the base the first time. */
export function productStore(base: Exp2Store, root: string, name: string): Exp2Store {
  const dir = join(root, "products", name, "store")
  if (!existsSync(join(dir, "exp2-state.json"))) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "exp2-state.json"), base.exportState(), "utf8") }
  const s = base.inspect()
  return new Exp2Store(dir, s.run_id, s.ablation ?? {})
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
export async function repairProducts(deps: HarnessDeps & { storeFor?: (product: Product) => Exp2Store; executor: () => Executor; anchors: AnchorExtractor; limits: ExecutionLimits; binary: string; text: (round: number) => string; score?: (commit: string, repo: string, round: number) => OfficialResult }, products: readonly Product[], root: string): Promise<RepairedProduct[]> {
  const out: RepairedProduct[] = []
  for (const p of products) {
    const workdir = join(root, p.name, "app")
    if (!existsSync(workdir)) {
      mkdirSync(join(root, p.name), { recursive: true })
      if (existsSync(join(p.path, ".git"))) git(join(root, p.name), ["clone", "-q", p.path, workdir])
      else { cpSync(p.path, workdir, { recursive: true }); initRepo(workdir); commitStep(workdir, "product as given", [["IC-Round", "0"]]) }
    }
    const base = head(workdir)
    const store = deps.storeFor?.(p) ?? deps.store
    const registry = store.registry()
    const s = store.inspect(), probes = activeProbes(s.probes, s.probe_events).filter(x => x.round <= p.round)
    const detect = async (program: ProgramRef, before: ReadonlySet<string>, contests: ReadonlyMap<string, string>) => {
      const runs = await runProbes(probes, program, deps.runner, deps.timeoutMs)
      const findings = await store.judge(p.round, runs, deps.judge, { contests, sandbox: deps.sandbox })
      return { findings, items: correctionItems(store.registry(), probes, runs, findings, before) }
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
