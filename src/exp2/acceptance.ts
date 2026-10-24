import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { RoleUnavailable, type AttributionTransport, type TokenUsage } from "./attribution.js"
import { codeFacts, type ChecksTransport } from "./checks.js"
import type { Product } from "./detect.js"
import { type BuildResult } from "./execution.js"
import { head } from "./git.js"
import { addUsage } from "./report.js"
import { nullBaseline, type CheckRunner, type ScriptSandbox } from "./runner.js"
import { Exp2Store } from "./store.js"
import { copyProgram, discardCopy, isNoIssues, reviewEntries, reviewRanProgram, reviewRequest, type Reviewer, type ReviewFocus } from "./review.js"
import { NO_MATERIALS, sessionInput, type ReviewMaterials } from "./materials.js"
import { assessPremises, DEFAULT_PREMISE_BLOCK, formalizeReview, itemCheckRecord, OWN_FAILURES, reproduces, type FormalItem, type FormalizeCallRecord, type FormalizeTransport, type Premise } from "./formalize.js"
import { renderEvidence, type ReviewItemRecord } from "./execution.js"
import { coverage, EMPTY_CHECKS } from "./checks.js"

/**
 * Measurement for the offline acceptance of BLOCK10 (REPAIR-BLOCK §4), local only. Nothing here is read by the
 * system: official results and the defect table are printed next to what the system found.
 */

export interface DefectTable { clean: string[]; defects: { name: string; products: string[]; pattern: string }[] }


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

// ---------------------------------------------------------------- acceptance-only replay (DESIGN §12h E6)

/** Hits per defect over any texts of a product's items, from library checks and probes alike (DESIGN §12h E6). */
export function scoreTexts(table: DefectTable, lists: readonly { product: string; texts: readonly string[] }[]): { rows: { name: string; hit: string[]; of: string[] }[]; hits: number; total: number; clean: { product: string; items: number }[] } {
  const by = new Map(lists.map(l => [l.product, l]))
  const rows = table.defects.map(d => {
    const re = new RegExp(d.pattern, "iu")
    return { name: d.name, of: d.products, hit: d.products.filter(p => by.get(p)?.texts.some(t => re.test(t)) ?? false) }
  })
  return { rows, hits: rows.reduce((n, r) => n + r.hit.length, 0), total: rows.reduce((n, r) => n + r.of.length, 0), clean: table.clean.map(p => ({ product: p, items: by.get(p)?.texts.length ?? NaN })) }
}

// ---------------------------------------------------------------- acceptance-only replay under DESIGN §12i

export interface ReviewReplayDeps {
  store: Exp2Store
  text: (round: number) => string
  attribution: AttributionTransport
  checks: ChecksTransport
  sandbox: ScriptSandbox
  runner: CheckRunner
  build: (dir: string, label: string) => BuildResult
  timeoutMs: number
  root: string
  attributionRepairs?: number
  checkRepairs?: number
  reviewer: Reviewer
  formalize: FormalizeTransport
  /** The program's name, as the requirements call it. */
  binary: string
  /** Reviews per product (default 1: one sample of the reviewer per run; the comparison runs the tool several times). */
  reviews?: number
  /** The blocking tier and the fallback, as the serial has them (fix block A1, A3). */
  premiseBlock?: readonly Premise[]
  fallback?: "items" | "review" | "off"
  voidWithoutRuns?: boolean
}

export interface ReviewedProduct {
  product: Product
  built: boolean
  build_output?: string
  reviews: { n: number; attempts: number; valid: boolean; no_issues: boolean; text: string; usage: TokenUsage; model?: string; program_runs: number }[]
  voided: number
  /**
   * Every entry of the reviews: the formalizer's items and the entries it could not write. `premise` is what stops
   * it under the blocking tier (null: it would be sent, with `disposition`). Another tier is a configuration
   * (`acceptance.premise_block`), not a second column.
   */
  items: (ReviewItemRecord & { review_n: number })[]
  malformed: { review_n: number; message: string }[]
  /** Library checks failing on the product (leads given to the reviewer), and those passing (guards it would have). */
  library: { failing: string[]; passing: string[] }
  usage: { reviewer: TokenUsage; formalizer: TokenUsage }
  calls: { reviews: number; formalize: number }
}

/** A product's own copy of the state, under <root>/products/<name>/store: made from the base the first time. */
export function productStore(base: Exp2Store, root: string, name: string): Exp2Store {
  const dir = join(root, "products", name, "store")
  if (!existsSync(join(dir, "exp2-state.json"))) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "exp2-state.json"), base.exportState(), "utf8") }
  const s = base.inspect()
  return new Exp2Store(dir, s.run_id, s.ablation ?? {})
}

/** A copy of a product's tree for one review: a clone at HEAD when it is a repository, a plain copy otherwise. */
function copyProduct(path: string, dir: string): string {
  if (existsSync(join(path, ".git"))) return copyProgram(path, head(path), dir)
  cpSync(path, dir, { recursive: true })
  return dir
}

/**
 * The new acceptance on frozen programs (DESIGN §12i), no coding: the attribution and library checks of rounds 1..N
 * are built once (as replayAcceptance); each product then gets the library run (its failures are the reviewer's
 * leads), `reviews` reviews in copies of its tree, the formalizer's items, and the code's premise and reproduction
 * checks. Nothing is repaired, so no guard is born; what the table shows is what would have been sent and what the
 * premises stopped, next to the reviewer's raw list.
 */
export async function replayReview(d: ReviewReplayDeps, products: readonly Product[]): Promise<ReviewedProduct[]> {
  const last = Math.max(...products.map(p => p.round))
  const nullProgram = nullBaseline(join(d.root, "null-baseline"))
  for (let r = 1; r <= last; r++) {
    const s = d.store.inspect()
    if (!s.rounds.some(x => x.round === r && x.status === "accepted")) {
      const a = await d.store.ingestRound(r, d.text(r), d.attribution, { maxRepairs: d.attributionRepairs ?? 2 })
      if (a.status !== "accepted") throw new Error(`attribution of round ${r} did not pass (${a.status})`)
    }
    if (d.store.ablation.checks !== false && !d.store.inspect().check_rounds.some(x => x.round === r && x.status === "accepted")) {
      const c = await d.store.deriveRoundChecks(r, d.checks, { sandbox: d.sandbox, runner: d.runner, baseline: nullProgram, maxRepairs: d.checkRepairs ?? 2, timeoutMs: d.timeoutMs, binary: d.binary, admitInLoop: true })
      if (c.status === "interrupted") throw new RoleUnavailable("check derivation", c.issues?.[0]?.message ?? "interrupted")
    }
  }
  const out: ReviewedProduct[] = []
  const block = new Set<Premise>(d.premiseBlock ?? DEFAULT_PREMISE_BLOCK)
  const zeroUsage = (): TokenUsage => ({ input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 })
  for (const p of products) {
    const b = d.build(p.path, `review-${p.name}`)
    if (!b.ok) { out.push({ product: p, built: false, build_output: b.output.slice(0, 2000), reviews: [], voided: 0, items: [], malformed: [], library: { failing: [], passing: [] }, usage: { reviewer: zeroUsage(), formalizer: zeroUsage() }, calls: { reviews: 0, formalize: 0 } }); continue }
    const store = productStore(d.store, d.root, p.name)
    const registry = store.registry()
    const facts = codeFacts(registry, p.round)
    const verdict = await store.runRoundChecks(p.round, b.program!, d.runner, { verdict: true, timeoutMs: d.timeoutMs })
    const s = store.inspect()
    const failing = verdict.runs.filter(r => r.outcome === "fail" && r.failure?.reason !== "timeout")
    const leads: ReviewFocus["leads"] = failing.map(r => ({ id: r.check, text: renderEvidence([r], [r.check], s.checks, registry, new Set()) }))
    const revised = [...registry.objects.values()].flatMap(o => o.blocks.flatMap(bl => bl.modifications.filter(m => m.round === p.round).flatMap(m => m.parts.map(x => ({ id: x, text: `${registry.block(x)?.text.trim() ?? ""} (${m.kind === "withdraw" ? "withdrawn" : m.kind === "partial" ? "partly revised" : "replaced"} by ${m.by.join(", ")} in round ${p.round})` })))))
    const focus: ReviewFocus = { round: p.round, units: p.round === 1 ? [] : [...new Map(revised.map(x => [x.id, x])).values()], guardFailures: [], leads }
    const sources = s.sources.filter(x => x.round <= p.round).map(x => ({ round: x.round, text: x.text }))
    const result: ReviewedProduct = { product: p, built: true, reviews: [], voided: 0, items: [], malformed: [], library: { failing: failing.map(r => r.check), passing: verdict.runs.filter(r => r.outcome === "pass").map(r => r.check) }, usage: { reviewer: zeroUsage(), formalizer: zeroUsage() }, calls: { reviews: 0, formalize: 0 } }
    for (let n = 1; n <= (d.reviews ?? 1); n++) {
      let text: string | null = null, attempts = 0, usage = zeroUsage(), model: string | undefined, runs = 0, session: ReviewMaterials = NO_MATERIALS
      for (; attempts < 2 && text === null; ) {
        attempts++
        const dir = copyProduct(p.path, join(d.root, "review-copies", `${p.name}-${n}-${attempts}`))
        const o = await d.reviewer.review(dir, reviewRequest(sources, focus), `${p.name} review ${n}`)
        discardCopy(dir)
        result.calls.reviews++
        usage = addUsage(usage, o.usage)
        model = o.model
        runs = o.runs.length
        session = { ...NO_MATERIALS, ...(o.materials ?? {}) }
        // Whether the program ran is a soft signal (fix block A2) unless configured to void.
        if (reviewRanProgram(o.runs) || !d.voidWithoutRuns) text = o.text
        else result.voided++
      }
      result.usage.reviewer = addUsage(result.usage.reviewer, usage)
      result.reviews.push({ n, attempts, valid: text !== null, no_issues: text !== null && isNoIssues(text), text: text ?? "", usage, ...(model ? { model } : {}), program_runs: runs })
      if (text === null || isNoIssues(text)) continue
      // What IC holds of this review (batch C, effect 3): the library leads it gave and the reviewer's session.
      const materials: ReviewMaterials = { ...session, leads: failing.flatMap(r => { const k = s.checks.find(c => c.id === r.check); return k ? [{ id: k.id, check: k }] : [] }) }
      const f = await formalizeReview(registry, p.round, text, d.binary, d.formalize, { reviewId: `${p.name}.${n}`, callId: k => `F${n}.${k}`, materials })
      await store.recordFormalizeCalls(f.calls as FormalizeCallRecord[])
      result.calls.formalize += f.calls.length
      for (const c of f.calls) result.usage.formalizer = addUsage(result.usage.formalizer, c.usage)
      if (f.unavailable && (d.fallback ?? "items") === "off") throw new RoleUnavailable("formalize", f.unavailable, f.calls)
      result.malformed.push(...f.malformed.map(m => ({ review_n: n, message: m.message })))
      const entries = reviewEntries(text)
      const own: (ReviewItemRecord & { review_n: number })[] = []
      const ownItem = (k: number, t: string, premise: Premise, detail: string) => own.push({ id: `V${p.round}.${n}.${k}`, round: p.round, review: `${p.name}.${n}`, review_n: n, item: k, text: t, units: [], premise: null, logged: [{ premise, detail }] })
      const handled = new Set<number>()
      if (f.unavailable) entries.forEach((t, k) => ownItem(k + 1, t, "formalize_failed", f.unavailable!))
      else {
        const bad = new Map<number, string[]>()
        for (const m of f.malformed) if (m.item !== null) bad.set(m.item, [...(bad.get(m.item) ?? []), m.message])
        for (const [k, msgs] of bad) { handled.add(k); ownItem(k, entries[k - 1] ?? f.texts.find(x => x.item === k)?.text ?? "", "malformed", msgs.join("; ")) }
        for (const it of f.items) {
          if (handled.has(it.item)) continue
          handled.add(it.item)
          if (it.input && it.produced?.length) for (const pr of it.produced) { const out = await d.runner.run(b.program!, sessionInput(pr.by, materials), d.timeoutMs); if (out.files[pr.path] !== undefined) it.input.files.push({ path: pr.path, content: out.files[pr.path] }) }
          await classify(it, n)
        }
        entries.forEach((t, k) => { if (!handled.has(k + 1)) ownItem(k + 1, t, "not_formalized", "the formalizer wrote no item for this entry of the review") })
      }
      // Code's own failures under the fallback (the serial's rule): sent in the reviewer's words, or blocked.
      const mode = d.fallback ?? "items"
      const fromThis = result.items.filter(i => i.review_n === n)
      const open = mode === "items" || (mode === "review" && !fromThis.some(i => i.premise === null) && !fromThis.some(i => i.disposition === "blocked"))
      for (const o of [...own, ...fromThis.filter(i => i.disposition === "fallback")]) {
        if (open) { o.disposition = "fallback"; o.premise = null } else { o.disposition = "blocked"; o.premise = o.logged?.at(-1)?.premise ?? "malformed" }
      }
      result.items.push(...own)
    }
    async function classify(it: FormalItem, n: number) {
      const id = `V${p.round}.${n}.${it.item}`
      const rec: ReviewItemRecord & { review_n: number } = { id, round: p.round, review: `${p.name}.${n}`, review_n: n, item: it.item, text: it.text, units: it.units, premise: null, ...(it.input_from ? { input_from: it.input_from } : {}) }
      const a = await assessPremises(registry, p.round, it, d.sandbox, d.timeoutMs)
      const failures = [...a.failures]
      if (a.check) {
        const rep = await reproduces(itemCheckRecord(id, p.round, it, a.check), b.program!, d.runner, p.round, registry, facts, d.timeoutMs)
        if (!rep.reproduced) failures.push({ premise: "not_reproduced", detail: `the check passes on the program (exit ${rep.run.exit_code})` })
        else rec.check = a.check
      }
      const stop = failures.find(x => block.has(x.premise))
      const logged = failures.filter(x => !block.has(x.premise))
      if (logged.length) rec.logged = logged
      if (stop) { rec.premise = stop.premise; rec.detail = stop.detail; rec.disposition = "blocked" }
      else rec.disposition = logged.some(x => OWN_FAILURES.has(x.premise)) ? "fallback" : logged.length ? "logged" : "sent"
      result.items.push(rec)
    }
    out.push(result)
  }
  return out
}

/** Rule-bearing units of a round, for the replay's report. */
export function unitsOfRound(registry: Parameters<typeof coverage>[0], round: number): string[] { return coverage(registry, round, EMPTY_CHECKS, [], []).units }
