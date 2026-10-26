import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { AnchorExtractor } from "./anchors.js"
import { AuthInvalid, QuotaExhausted, RoleUnavailable, type AttributionTransport, type ModelReply } from "./attribution.js"
import type { Registry } from "./registry.js"
import { coarseUnit, codeFacts, libraryCovers, type CheckRecord, type ChecksTransport } from "./checks.js"
import { type BuildResult, type ExecutionLimits, type ExecutionRecord, type Executor, type SupersededItem } from "./execution.js"
import { head, initRepo, resetTo } from "./git.js"
import { acceptanceFromLedger, acceptanceSummary, buildReport, codingCost, renderReport, type RoundReport, type StageCost } from "./report.js"
import { runDigest, type ObjectStatus } from "./verdict.js"
import { EnvironmentBlocked, EnvironmentUnavailable } from "./platform.js"
import { freezePrediction } from "./prediction.js"
import { nullBaseline, type CheckRunner, type ProgramRef, type ScriptSandbox } from "./runner.js"
import type { Exp2State, Exp2Store } from "./store.js"
import { buildWorkOrder, nameLinks, renderWorkOrder, type PreviousStep, type WorkOrder } from "./workorder.js"
import { type CheckRoundRecord } from "./store.js"
import { gapState } from "./probes.js"
import { ledgerOf, ledgerSummary, renderLedger } from "./ledger.js"
import type { PlatformOptions } from "./platform.js"
import { acceptRound, renderGuardItem, renderReviewList, type CarriedItem } from "./accept.js"
import { guardCheck, guardCoverage, liveGuards, runGuards } from "./guards.js"
import { itemCheckRecord, notInForce, type FormalizeTransport, type Premise } from "./formalize.js"
import { runChecks, type CheckRun } from "./verdict.js"
import { fitPackage, packageComparisons, renderPackage, roundPackage } from "./view.js"
import type { GoldSets } from "./gold.js"
import type { Reviewer } from "./review.js"

/**
 * The end-to-end serial (DESIGN §9, §14). Each round, from the previous round's checkpoint:
 *  1. attribution (the source split and registered; scope from the versions);
 *  2. checks derived for the round's objects and stale checks, admitted against the baseline (the last accepted
 *     program), and the library run on that baseline for the start-of-round statuses;
 *  3. the work order, from statuses, anchors and the previous round's execution;
 *  4. execution, step by step;
 *  5. the verdict run of the whole library on the round's final program, the report, and the checkpoint.
 * A spent quota interrupts the round: what it spent is logged, and the round reruns from the checkpoint after a wait.
 * Attribution that cannot be made to pass stops the serial. Round N only ever starts from round N−1's checkpoint.
 */

export interface SerialLimits {
  attributionRepairs: number
  checkRepairs: number
  /** Watchdog on one management call; a stopped call uses up one attempt. */
  managementTimeoutMs: number
  checkTimeoutMs: number
  execution: ExecutionLimits
}

/**
 * How the round is accepted (DESIGN §12i, §12j): the reviewer is the finder, the formalizer turns its list into checks,
 * guards are code's. Probes, judgments and rulings are out of the round's path (§12j.4); their code stays.
 */
export interface AcceptanceConfig {
  /** Reviews a round at most (default 3), and repairs of a failing trial before the first review (default 2). */
  reviews?: number
  trialFixes?: number
  /** Fix block A1–A3: the blocking tier of the premises, the fallback for items code cannot verify, voiding reviews without runs. */
  premiseBlock?: readonly Premise[]
  fallback?: "items" | "review" | "off"
  voidWithoutRuns?: boolean
  /** Fix block B1: whether reproduced items (guard regressions, reviewer's items with a failing check) expire (default false). */
  expireReproduced?: boolean
  /** Fix block B2: library checks only for text a round adds or revises, and stale checks (default true). */
  checksOnce?: boolean
  /** Fix block B3: the round's library checks are written beside the coding, off the critical path (default true). */
  checksInBackground?: boolean
  /** §12j.7 item 3: units the checks leave uncovered go back to the writer (default false: the report counts them). */
  coverageObligation?: boolean
  /**
   * §12j.7 items 6, 9 (§6a step 3): what of the requirements the executor's work order and the reviewer's request carry.
   * delta (default): this round's objects, early objects their relations reach, and what open items rest on. all/full:
   * every round's text, as the control group gets it (ablation only).
   */
  workorderScope?: "delta" | "all"
  reviewScope?: "delta" | "full"
}

export interface SerialConfig {
  store: Exp2Store
  /** The task's gold sets (the chain block, effect 4): each round's report measures attribution against them. */
  gold?: GoldSets
  workdir: string
  checkpoints: string
  acceptance?: AcceptanceConfig
  /** The reviewer and the formalizer (DESIGN §12i items 1–2). */
  reviewer: Reviewer
  formalize: FormalizeTransport
  /** The target environment's trial (build and test, no network); absent, the build alone. */
  trial?: (workdir: string, label: string) => Promise<{ ok: boolean; output: string }>
  /** Where copies of the program for reviews are made (default under the checkpoints). */
  copies?: string
  text: (round: number) => string
  attribution: AttributionTransport
  checks: ChecksTransport
  /** A fresh executor per round attempt. */
  executor: (round: number) => Executor
  executorIsStub: boolean
  anchors: AnchorExtractor
  runner: CheckRunner
  sandbox: ScriptSandbox
  build: (workdir: string, label: string) => BuildResult
  limits: SerialLimits
  /** The program's name as the requirements call it (for the calls in correction lists). */
  binary?: string
  /** Where the local Go tool is, for the mutation helper. */
  platform?: PlatformOptions
  /**
   * Post-round scoring (the official verifier, locally). Its result is written into that round's checkpoint report
   * only, after the round is complete; nothing in the serial ever reads it back.
   */
  score?: (round: number, commit: string, workdir: string) => Promise<{ passed: number; total: number } | null>
}

export type RoundOutcome =
  | { status: "done"; report: RoundReport }
  | { status: "stopped"; reason: string; issues: unknown[] }

export interface SerialOutcome {
  status: "done" | "stopped" | "suspended"
  last_checkpoint: number
  resumes: number
  stopped?: { round: number; reason: string }
}

export interface InterruptedAttempt {
  round: number
  reason: string
  /** Calls the attempt made (they are spent, though the checkpoint is restored without them). */
  calls: Exp2State["calls"]
  check_calls: Exp2State["check_calls"]
  probe_calls?: Exp2State["probe_calls"]
  judge_calls?: Exp2State["judge_calls"]
  review_calls?: Exp2State["review_calls"]
  formalize_calls?: Exp2State["formalize_calls"]
  execution: ExecutionRecord | null
}

const pad = (n: number) => String(n).padStart(2, "0")
const sha = (s: string) => createHash("sha256").update(s).digest("hex")

export function withWatchdog<R, A>(transport: (request: R) => Promise<A>, ms: number): (request: R) => Promise<A> {
  return async request => {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([transport(request), new Promise<A>((_, reject) => { timer = setTimeout(() => reject(new Error(`watchdog: no answer in ${ms} ms`)), ms) })])
    } finally { clearTimeout(timer) }
  }
}

export class Serial {
  private progress: ExecutionRecord | null = null
  /** Wall-time spans of the round being run (BLOCK10 §9.1). */
  private spans: Span[] = []

  /** Runs `f` and keeps its wall time under `stage`. */
  private async timed<T>(stage: string, f: () => Promise<T>): Promise<T> {
    const start = Date.now()
    try { return await f() } finally { this.spans.push({ stage, start, end: Date.now() }) }
  }
  constructor(private readonly c: SerialConfig) {
    mkdirSync(join(c.checkpoints, "interrupted"), { recursive: true })
  }

  private dir(round: number) { return join(this.c.checkpoints, `round-${pad(round)}`) }

  latestCheckpoint(): number {
    const done = readdirSync(this.c.checkpoints).map(n => /^round-(\d+)$/u.exec(n)).filter(Boolean).map(m => Number(m![1])).filter(n => existsSync(join(this.dir(n), "meta.json")))
    return done.length ? Math.max(...done) : -1
  }

  /** Round 0: the empty state and the empty repository. */
  private ensureStart(): void {
    if (this.latestCheckpoint() >= 0) return
    mkdirSync(this.c.workdir, { recursive: true })
    const commit = existsSync(join(this.c.workdir, ".git")) ? head(this.c.workdir) : initRepo(this.c.workdir)
    this.writeCheckpoint(0, commit, null)
  }

  private writeCheckpoint(round: number, commit: string, report: RoundReport | null): void {
    const d = this.dir(round)
    mkdirSync(d, { recursive: true })
    const state = this.c.store.exportState()
    writeFileSync(join(d, "state.json"), state, "utf8")
    if (report) {
      writeFileSync(join(d, "report.json"), JSON.stringify(report, null, 2) + "\n", "utf8")
      writeFileSync(join(d, "report.md"), renderReport(report), "utf8")
      // The system's call on each object, frozen with its hash before the round is scored (DESIGN §12b item 10).
      const prediction = freezePrediction(round, commit, report.objects)
      writeFileSync(join(d, "prediction.json"), JSON.stringify(prediction, null, 2) + "\n", "utf8")
      writeFileSync(join(this.c.checkpoints, "predictions.jsonl"), JSON.stringify({ round, commit, sha256: prediction.sha256 }) + "\n", { encoding: "utf8", flag: "a" })
    }
    // meta.json last: a checkpoint without it is incomplete and is not used.
    writeFileSync(join(d, "meta.json"), JSON.stringify({ round, head: commit, state_sha256: sha(state) }, null, 2) + "\n", "utf8")
  }

  private checkpoint(round: number): { head: string; state: string } {
    const meta = JSON.parse(readFileSync(join(this.dir(round), "meta.json"), "utf8")) as { head: string; state_sha256: string }
    const state = readFileSync(join(this.dir(round), "state.json"), "utf8")
    if (sha(state) !== meta.state_sha256) throw new Error(`Checkpoint ${round} state does not match its hash`)
    return { head: meta.head, state }
  }

  /** Back to a checkpoint: the state file and the work tree, both from the same moment. */
  async restore(round: number): Promise<void> {
    const cp = this.checkpoint(round)
    await this.c.store.restoreState(cp.state)
    resetTo(this.c.workdir, cp.head)
  }

  /** What an attempt of `round` wrote after the checkpoint, kept before the checkpoint is restored over it. */
  private salvage(round: number, reason: string): void {
    const cp = JSON.parse(this.checkpoint(round - 1).state) as Exp2State
    const now = JSON.parse(this.c.store.exportState()) as Exp2State
    const calls = (now.calls ?? []).slice(cp.calls.length), checkCalls = (now.check_calls ?? []).slice((cp.check_calls ?? []).length)
    const probeCalls = (now.probe_calls ?? []).slice((cp.probe_calls ?? []).length), judgeCalls = (now.judge_calls ?? []).slice((cp.judge_calls ?? []).length)
    const reviewCalls = (now.review_calls ?? []).slice((cp.review_calls ?? []).length), formalizeCalls = (now.formalize_calls ?? []).slice((cp.formalize_calls ?? []).length)
    if (!calls.length && !checkCalls.length && !probeCalls.length && !judgeCalls.length && !reviewCalls.length && !formalizeCalls.length && !this.progress) return
    const n = readdirSync(join(this.c.checkpoints, "interrupted")).filter(f => f.startsWith(`round-${pad(round)}-`)).length + 1
    const attempt: InterruptedAttempt = { round, reason, calls, check_calls: checkCalls, probe_calls: probeCalls, judge_calls: judgeCalls, review_calls: reviewCalls, formalize_calls: formalizeCalls, execution: this.progress }
    writeFileSync(join(this.c.checkpoints, "interrupted", `round-${pad(round)}-${n}.json`), JSON.stringify(attempt, null, 2) + "\n", "utf8")
    this.progress = null
  }

  interruptedAttempts(round: number): InterruptedAttempt[] {
    const dir = join(this.c.checkpoints, "interrupted")
    return readdirSync(dir).filter(f => f.startsWith(`round-${pad(round)}-`)).sort().map(f => JSON.parse(readFileSync(join(dir, f), "utf8")) as InterruptedAttempt)
  }

  async run(options: { to: number; wait?: (ms: number) => Promise<void>; resumeWaitMs?: number; maxResumes?: number; environmentWaitMs?: number }): Promise<SerialOutcome> {
    const wait = options.wait ?? (ms => new Promise(r => setTimeout(r, ms)))
    let resumes = 0
    this.ensureStart()
    for (;;) {
      const last = this.latestCheckpoint()
      if (last >= options.to) return { status: "done", last_checkpoint: last, resumes }
      const round = last + 1
      // Anything written after the checkpoint (a stop that never came back) is kept, then the checkpoint restored.
      this.salvage(round, "state found ahead of the checkpoint (unclean stop)")
      await this.restore(last)
      let outcome: RoundOutcome
      try {
        outcome = await this.runRound(round)
      } catch (e) {
        if (e instanceof EnvironmentUnavailable) {
          // Docker down, a review copy that cannot be made, a missing interpreter (batch 4): nobody is told to fix it.
          // Like a spent quota: keep what the attempt spent, back to the checkpoint, wait, run the round again.
          this.salvage(round, `environment unavailable: ${e.message}`)
          await this.restore(last)
          if (++resumes > (options.maxResumes ?? 48)) return { status: "suspended", last_checkpoint: last, resumes }
          await wait(options.environmentWaitMs ?? 5 * 60_000)
          continue
        }
        if (e instanceof AuthInvalid || e instanceof EnvironmentBlocked || e instanceof RoleUnavailable) {
          // A dead login, or a host that will not start programs, is not waited out: keep what the attempt spent,
          // go back to the checkpoint, stop and report. Neither counts as a failed step.
          const why = e instanceof AuthInvalid ? `login invalid: ${e.message}` : e instanceof RoleUnavailable ? `unavailable: ${e.message}` : `environment: ${e.message}`
          this.salvage(round, why)
          await this.restore(last)
          const stop = { status: "stopped", reason: why, issues: [] }
          writeFileSync(join(this.c.checkpoints, `stopped-round-${pad(round)}.json`), JSON.stringify(stop, null, 2) + "\n", "utf8")
          return { status: "stopped", last_checkpoint: last, resumes, stopped: { round, reason: stop.reason } }
        }
        if (!(e instanceof QuotaExhausted)) throw e
        this.salvage(round, `quota: ${e.message}`)
        await this.restore(last)
        if (++resumes > (options.maxResumes ?? 48)) return { status: "suspended", last_checkpoint: last, resumes }
        await wait(options.resumeWaitMs ?? 30 * 60_000)
        continue
      }
      if (outcome.status === "stopped") {
        writeFileSync(join(this.c.checkpoints, `stopped-round-${pad(round)}.json`), JSON.stringify(outcome, null, 2) + "\n", "utf8")
        return { status: "stopped", last_checkpoint: last, resumes, stopped: { round, reason: outcome.reason } }
      }
    }
  }

  async runRound(round: number): Promise<RoundOutcome> {
    const { store, limits } = this.c
    this.progress = null
    this.spans = []
    const roundStart = Date.now()
    // 1. Attribution.
    const attribution = await this.timed("attribution", () => store.ingestRound(round, this.c.text(round), withWatchdog(this.c.attribution, limits.managementTimeoutMs), { maxRepairs: limits.attributionRepairs }))
    if (attribution.status === "interrupted") throw stopping(attribution.issues ?? [], `attribution, round ${round}`)
    if (attribution.status === "failed") return { status: "stopped", reason: "attribution did not pass within its repair limit", issues: attribution.issues ?? [] }

    // 2. Checks, against the baseline: the last accepted program (the checkpoint's head), or the null program.
    const baseline = this.program(round === 1 ? null : `R${round - 1}-final`)
    // With the check library switched off (ablation), no checks are derived: every status stays unknown.
    const a = this.c.acceptance ?? {}
    let checkWriting: Promise<CheckRoundRecord> | null = null
    if (store.ablation.checks !== false) {
      const deps = { sandbox: this.c.sandbox, runner: this.c.runner, baseline, maxRepairs: limits.checkRepairs, timeoutMs: limits.checkTimeoutMs, ...(a.checksOnce !== false ? { unitsOnce: true } : {}), binary: this.c.binary ?? null, admitInLoop: true, ...(a.coverageObligation ? { coverageObligation: true } : {}) }
      if (a.checksInBackground !== false) {
        // Fix block B3: the checks are written beside the coding; the work order has the library as the round starts.
        await store.beginRoundChecks(round)
        checkWriting = this.timed("check writing", () => store.writeRoundChecks(round, withWatchdog(this.c.checks, limits.managementTimeoutMs), deps))
        checkWriting.catch(() => {})
      } else {
        const derived = await this.timed("checks", () => store.deriveRoundChecks(round, withWatchdog(this.c.checks, limits.managementTimeoutMs), deps))
        if (derived.status === "interrupted") throw stopping(derived.issues ?? [], `checks, round ${round}`)
      }
    }
    // A round that stops waits for the background writing to settle first, so its calls are committed before the
    // checkpoint is restored (and counted with the interrupted attempt), and nothing lands in the restored state later.
    try {
      const start = await this.timed("checks", () => store.runRoundChecks(round, baseline, this.c.runner, { verdict: false, timeoutMs: limits.checkTimeoutMs }))
      return await this.reviewRound(round, baseline, start, roundStart, checkWriting)
    } finally { await checkWriting?.catch(() => {}) }
  }

  /**
   * The round under DESIGN §12i, from the work order to the checkpoint (accept.ts does the cycles): probes only when
   * configured, written once per unit; what the ledger still holds open is carried after the work order; the final
   * library run, the guard coverage, the ledger, the report and the checkpoint follow.
   */
  private async reviewRound(round: number, baseline: ProgramRef, start: { runs: CheckRun[]; statuses: ObjectStatus[] }, roundStart: number, checkWriting: Promise<CheckRoundRecord> | null = null): Promise<RoundOutcome> {
    const { store, workdir, limits } = this.c
    const checksReady = async () => {
      if (!checkWriting) return
      const w = await checkWriting
      if (w.status === "interrupted") throw stopping(w.issues ?? [], `checks, round ${round}`)
    }
    const a = this.c.acceptance ?? {}
    const atStart = store.inspect()
    const registryStart = store.registry(atStart)
    const ledgerOptions = { expireReproduced: a.expireReproduced === true }
    const ledger = ledgerOf(atStart, registryStart, ledgerOptions)
    const quiet = new Map(ledger.filter(e => e.state === "report_only" && e.end?.how === "expired" && e.digest).map(e => [e.id, e.digest!]))
    // Carried in: guards failing and review items not fixed at the end of the last round, as far as they still fail on the baseline.
    const facts = codeFacts(registryStart, round)
    const carried: CarriedItem[] = []
    const superseded: SupersededItem[] = []
    if (baseline.kind !== "null") {
      const openGuards = new Set(ledger.filter(e => e.state === "open" && e.source === "guard").map(e => e.id))
      // A guard whose flip is still the reviewer's question (this round's text changed behind it, no answer yet) is not carried as a regression.
      const asked = (id: string) => { const last = [...atStart.guard_events].reverse().find(e => e.guard === id); return last?.status === "failing" && (last.changed_text?.length ?? 0) > 0 }
      const gs = liveGuards(atStart.guards, atStart.guard_events).filter(g => openGuards.has(g.id) && !asked(g.id))
      const runs = await this.timed("carry-over", () => runGuards(gs, atStart.checks, baseline, this.c.runner, round, registryStart, facts, limits.checkTimeoutMs))
      gs.forEach((g, i) => { if (runs[i].outcome === "fail") carried.push({ id: g.id, text: renderGuardItem(g, guardCheck(g, atStart.checks), runs[i].run, registryStart, true), check: guardCheck(g, atStart.checks), digest: runDigest(runs[i].run) }) })
      const openItems = new Set(ledger.filter(e => e.state === "open" && e.source === "review").map(e => e.id))
      const open = atStart.executions.flatMap(e => e.review_items ?? []).filter(r => openItems.has(r.id) && r.check)
      // An item whose text this round replaced is not carried: it ends as superseded (fix block B1).
      const registryNow = store.registry()
      for (const r of open) { const why = r.units.map(u => notInForce(registryNow, round, u)).find(x => !!x); if (why) superseded.push({ id: r.id, reason: `round ${round}: ${why}` }) }
      const items = open.filter(r => !superseded.some(x => x.id === r.id))
      if (items.length) {
        const records = items.map(r => itemCheckRecord(r.id, r.round, { item: r.item, text: r.text, units: r.units, input: r.check!.input, why_no_input: null, assertions: [], reference_script: r.check!.reference_script }, r.check!))
        const rs = await this.timed("carry-over", () => runChecks(records, baseline, this.c.runner, round, registryStart, facts, limits.checkTimeoutMs))
        items.forEach((r, i) => { if (rs[i].outcome === "fail") carried.push({ id: r.id, text: r.text, check: records[i], digest: runDigest(rs[i]) }) })
      }
    }
    // 3. The work order, as before.
    let state = store.inspect()
    const registry = store.registry(state)
    const anchorsNow = this.c.anchors.extract(workdir)
    const links = [...state.executions.flatMap(e => e.links), ...nameLinks(registry, anchorsNow, round)]
    const steps: PreviousStep[] = state.executions.flatMap(e => e.cycles.filter(c => c.id === e.kept).map(c => ({ id: c.id, round: c.round, status: "committed", objects: e.task.filter(o => !e.carried.includes(o)).map(object => ({ object, coverage: "full" as const })), anchors: c.anchors })))
    const previous = state.reports.find(r => r.round === round - 1)
    // The round's package (§6c): the objects' current views and the guards on them, with what each gets on the baseline now.
    const deltaWork = (a.workorderScope ?? "delta") === "delta", deltaReview = (a.reviewScope ?? "delta") === "delta"
    let pkg: ReturnType<typeof fitPackage> | undefined
    if (deltaWork || deltaReview) {
      const built = roundPackage(registry, round, carried.map(c => ({ id: c.id, units: c.check ? [...c.check.blocks] : [] })))
      // The comparisons (§6c revision item 4): the guards on units this round revises, what they get on the baseline now.
      const live = liveGuards(state.guards, state.guard_events)
      const bound = packageComparisons(registry, round, live, state.checks, new Map())
      const gs = live.filter(g => bound.some(b => b.guard === g.id))
      const runs = baseline.kind !== "null" && gs.length ? await this.timed("comparisons", () => runGuards(gs, state.checks, baseline, this.c.runner, round, registry, codeFacts(registry, round), limits.checkTimeoutMs)) : []
      built.comparisons = packageComparisons(registry, round, live, state.checks, new Map(gs.flatMap((g, i) => runs[i] ? [[g.id, guardOutput(guardCheck(g, state.checks), runs[i].run)] as const] : [])))
      pkg = fitPackage(built)
    }
    const workorder: WorkOrder = buildWorkOrder({
      registry, round, library: state.checks, events: state.check_events, statuses: start.statuses, runs: start.runs, anchors: anchorsNow, links, steps,
      previous_task: previous ? state.executions.find(x => x.round === round - 1)?.task ?? [] : [],
      zoning: store.ablation.zoning,
      // The round's package (§6a step 3) by default; failures in the task zone are confirmed items and guards only.
      scope: a.workorderScope ?? "delta",
      confirmed: carried.map(c => ({ id: c.id, object: c.check && c.check.object !== "none" ? c.check.object : null, units: c.check ? [...c.check.blocks] : [], args: c.check?.input.args ?? [], files: c.check?.input.files.map(f => f.path) ?? [] })),
      ...(deltaWork && pkg ? { package: { pkg: pkg.pkg, overflow: pkg.overflow } } : {}),
    })
    // The reviewer reads the package's views, without the guards (§6c); the formalizer the same text. Full is the
    // control group's text (ablation).
    const body = deltaReview && pkg ? renderPackage(pkg.pkg) : undefined
    const sources = state.sources.map(x => ({ round: x.round, text: x.text }))
    const carriedText = carried.length ? `\n${CARRIED_HEADER_REVIEW}\n\n${renderReviewList(carried)}\n` : ""
    const binary = this.c.binary ?? "app"
    // 4. Execution and acceptance.
    const execution = await acceptRound(workdir, workorder, renderWorkOrder(workorder) + carriedText, this.c.executor(round), {
      registry, library: state.checks, events: state.check_events, facts: codeFacts(registry, round), guards: state.guards, guardEvents: state.guard_events,
      runner: this.c.runner, sandbox: this.c.sandbox, anchors: this.c.anchors, build: this.c.build, ...(this.c.trial ? { trial: this.c.trial } : {}),
      reviewer: this.c.reviewer, formalize: withWatchdog(this.c.formalize, limits.managementTimeoutMs), binary, sources, ...(body ? { body } : {}),
      copyDir: label => join(this.c.copies ?? join(this.c.checkpoints, "review-copies"), label),
      ...(checkWriting ? { libraryNow: async () => { await checksReady(); const n = store.inspect(); return { library: n.checks, events: n.check_events } } } : {}),
      record: { review: r => store.recordReviewCall(r), formalize: c => store.recordFormalizeCalls(c), guards: (b, e) => store.recordGuards(b, e) },
      carried, quiet, superseded, time: (stage: string, x: number, y: number) => { this.spans.push({ stage, start: x, end: y }) }, onProgress: r => { this.progress = r }, checkTimeoutMs: limits.checkTimeoutMs,
    }, { ...limits.execution, ...(a.reviews !== undefined ? { reviews: a.reviews } : {}), ...(a.trialFixes !== undefined ? { trialFixes: a.trialFixes } : {}), ...(a.premiseBlock ? { premiseBlock: a.premiseBlock } : {}), ...(a.fallback ? { fallback: a.fallback } : {}), ...(a.voidWithoutRuns !== undefined ? { voidWithoutRuns: a.voidWithoutRuns } : {}) })
    await this.timed("waiting for checks", checksReady)
    // 5. The library's verdict on the final program, the guard coverage, the ledger, the report, the checkpoint.
    const final = this.program(`R${round}-final`)
    const verdict = await store.runRoundChecks(round, final, this.c.runner, { verdict: true, timeoutMs: limits.checkTimeoutMs })
    state = store.inspect()
    const live = liveGuards(state.guards, state.guard_events)
    const gc = execution.kept ? guardCoverage(registry, round, live, new Set(live.map(g => g.id))) : null
    const cov = gc ? { units: gc.units.length, covered: gc.covered.length, uncovered: gc.uncovered } : null
    const interrupted = this.interruptedAttempts(round)
    const events = state.check_events.filter(e => e.round === round)
    const ledgerNow = ledgerOf({ ...state, executions: [...state.executions, execution] }, registry, ledgerOptions)
    const summary = acceptanceFromLedger(acceptanceSummary({ library: state.checks, runs: verdict.runs, events: state.check_events, findings: [], gaps: gapState(registry, state.probe_rounds, libraryCovers(registry, state.checks, state.check_events)) }).by_kind, ledgerNow)
    const report = buildReport({
      round, registry, workorder, execution, summary, ...(this.c.gold ? { gold: this.c.gold } : {}), ledger: ledgerSummary(ledgerNow, round), executorIsStub: this.c.executorIsStub, wall: wallTimes(this.spans, roundStart, Date.now()), statuses: verdict.statuses,
      understand: state.calls.filter(c => c.round === round), acceptance: state.check_calls.filter(c => c.round === round),
      interrupted: {
        attempts: interrupted.length, understand: interrupted.flatMap(x => x.calls), acceptance: interrupted.flatMap(x => [...x.check_calls, ...(x.probe_calls ?? []), ...(x.judge_calls ?? []), ...(x.review_calls ?? []), ...(x.formalize_calls ?? [])]),
        coding: interrupted.reduce((t: StageCost, x) => { const c = codingCost(x.execution, this.c.executorIsStub); return { calls: t.calls + c.calls, tokens: sumUsage(t.tokens, c.tokens), stub_calls: t.stub_calls + c.stub_calls } }, codingCost(null, false)),
      },
      checks: { entered: state.checks.filter(k => k.round === round).length, stale: events.filter(e => e.status === "stale").length, retired: events.filter(e => e.status === "retired").length, run: verdict.runs.length, passed: verdict.runs.filter(r => r.outcome === "pass").length, failed: verdict.runs.filter(r => r.outcome === "fail").length, ...checkWritingCounts(state, round, execution, registry), ...(state.checks.some(k => k.direction === "withdrawn") ? { read_as_holds: state.checks.filter(k => k.direction === "withdrawn").map(k => k.id) } : {}) },
      review: { accept: execution.accept!, first_delivery: execution.first_delivery ?? null, review_calls: state.review_calls.filter(c => c.round === round), formalize_calls: state.formalize_calls.filter(c => c.round === round), coverage: cov },
    })
    await store.recordRound(execution, report)
    const commit = head(workdir)
    mkdirSync(this.dir(round), { recursive: true })
    writeFileSync(join(this.dir(round), "ledger.json"), JSON.stringify(ledgerNow, null, 1) + "\n", "utf8")
    writeFileSync(join(this.dir(round), "ledger.md"), `# Ledger after round ${round}\n\n${renderLedger(ledgerNow)}\n`, "utf8")
    if (execution.first_delivery) writeFileSync(join(this.c.checkpoints, "first-deliveries.jsonl"), JSON.stringify({ round, ...execution.first_delivery }) + "\n", { encoding: "utf8", flag: "a" })
    // The §12i measures, a line a round, for the comparison (fix block B4; intent-exp2-measures reads them with the scores).
    if (report.measures) writeFileSync(join(this.c.checkpoints, "measures.jsonl"), JSON.stringify(report.measures) + "\n", { encoding: "utf8", flag: "a" })
    this.writeCheckpoint(round, commit, report)
    this.progress = null
    if (this.c.score) await this.writeScore(round, commit, report)
    return { status: "done", report }
  }

  /** The official score goes into the checkpoint's report files and a score log; never into the state. */
  private async writeScore(round: number, commit: string, report: RoundReport): Promise<void> {
    let score: { passed: number; total: number } | null
    try { score = await this.c.score!(round, commit, this.c.workdir) } catch (e) {
      // Scoring is outside the system: a failure is logged, and the serial goes on.
      writeFileSync(join(this.c.checkpoints, "scores.jsonl"), JSON.stringify({ round, commit, error: (e as Error).message }) + "\n", { encoding: "utf8", flag: "a" })
      return
    }
    if (!score) return
    // The first delivery (the commit before the first review) is scored the same way, for the local comparison (DESIGN §12i).
    let first: { passed: number; total: number } | null = null
    const fd = report.review?.first_delivery
    if (fd && fd.commit !== commit) {
      try { first = await this.c.score!(round, fd.commit, this.c.workdir) } catch (e) { writeFileSync(join(this.c.checkpoints, "scores.jsonl"), JSON.stringify({ round, commit: fd.commit, kind: "first_delivery", error: (e as Error).message }) + "\n", { encoding: "utf8", flag: "a" }) }
    } else if (fd) first = score
    const scored: RoundReport = { ...report, official_score: score, ...(fd ? { first_delivery_score: first } : {}) }
    writeFileSync(join(this.dir(round), "report.json"), JSON.stringify(scored, null, 2) + "\n", "utf8")
    writeFileSync(join(this.dir(round), "report.md"), renderReport(scored), "utf8")
    const frozen = JSON.parse(readFileSync(join(this.dir(round), "prediction.json"), "utf8")) as { sha256: string }
    writeFileSync(join(this.c.checkpoints, "scores.jsonl"), JSON.stringify({ round, commit, ...score, prediction_sha256: frozen.sha256 }) + "\n", { encoding: "utf8", flag: "a" })
    if (fd && first) writeFileSync(join(this.c.checkpoints, "scores.jsonl"), JSON.stringify({ round, commit: fd.commit, kind: "first_delivery", ...first }) + "\n", { encoding: "utf8", flag: "a" })
  }

  /** The program at the work tree's current commit, built; the null program when there is nothing to build. */
  private program(label: string | null): ProgramRef {
    if (label) {
      const b = this.c.build(this.c.workdir, label)
      if (b.ok && b.program) return b.program
    }
    return nullBaseline(join(this.c.checkpoints, "null-baseline"))
  }
}

export interface Span { stage: string; start: number; end: number }

/**
 * Wall time per stage: the time covered by its spans (overlaps within a stage counted once), and the round's whole
 * wall time. Stages overlap one another (probe writing runs beside coding), so they need not add up to the round.
 */
export function wallTimes(spans: readonly Span[], start: number, end: number): { round_ms: number; stages: { stage: string; ms: number; spans: number; first_start_ms: number; last_end_ms: number }[] } {
  const by = new Map<string, Span[]>()
  for (const s of spans) by.set(s.stage, [...(by.get(s.stage) ?? []), s])
  const covered = (list: Span[]) => {
    const sorted = [...list].sort((a, b) => a.start - b.start)
    let total = 0, at = -Infinity
    for (const s of sorted) { const from = Math.max(s.start, at); if (s.end > from) total += s.end - from; at = Math.max(at, s.end) }
    return total
  }
  return {
    round_ms: end - start,
    // In the order the stages first started.
    stages: [...by.entries()].map(([stage, list]) => ({ stage, ms: covered(list), spans: list.length, first_start_ms: Math.min(...list.map(s => s.start)) - start, last_end_ms: Math.max(...list.map(s => s.end)) - start })).sort((a, b) => a.first_start_ms - b.first_start_ms),
  }
}

/** The section the work order gets for what the ledger still holds open under the review acceptance (DESIGN §12i). */
export const CARRIED_HEADER_REVIEW = "## Still open from earlier rounds\n\nThese were found on the program as it stands and are not fixed yet. Fix them along with this round's work; the requirements are the authority."

/** The error a stopped management step stands for: a spent quota, or an invalid login. */
function stopping(issues: { code: string; message: string }[], where: string): Error {
  const auth = issues.find(i => i.code === "auth"), gone = issues.find(i => i.code === "unavailable")
  return auth ? new AuthInvalid(`${where}: ${auth.message}`) : gone ? new RoleUnavailable(where, gone.message) : new QuotaExhausted(where)
}

function sumUsage(a: StageCost["tokens"], b: StageCost["tokens"]): StageCost["tokens"] {
  return { input_tokens: a.input_tokens + b.input_tokens, cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens, cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens, output_tokens: a.output_tokens + b.output_tokens, reasoning_tokens: a.reasoning_tokens + b.reasoning_tokens }
}

export type { ModelReply }

/** What became of the round's check writing (batch C, effects 1–2), from the state and the round's runs. */
export function checkWritingCounts(state: Pick<Exp2State, "checks" | "check_rounds">, round: number, execution: ExecutionRecord, registry?: Registry): Pick<RoundReport["checks"], "coarse" | "admitted" | "unknown" | "unknown_not_fed_back" | "dropped" | "normalized" | "refused_calls" | "uncovered"> {
  const mine = state.checks.filter(k => k.round === round)
  const tally = (list: string[]) => list.reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {} as Record<string, number>)
  const record = state.check_rounds.find(r => r.round === round && r.status === "accepted")
  return {
    admitted: mine.filter(k => k.admission === "admitted").length, unknown: mine.filter(k => k.admission === "unknown").length,
    unknown_not_fed_back: mine.filter(k => k.unknown.length && !k.fed_back).length,
    dropped: tally((record?.dropped ?? []).flatMap(d => [...new Set(d.issues.map(i => i.code))])),
    normalized: tally(mine.flatMap(k => (k.normalized ?? []).map(n => n.startsWith("args") ? "leading program name" : n.includes("expect_json") ? "unquoted expected string" : n.includes("Python dict") ? "Python dict output" : n.includes("several lines") ? "JSON on several lines" : n.includes("backslash") ? "doubled escapes" : "other"))),
    refused_calls: execution.cycles.reduce((n, c) => n + c.runs.filter(r => r.failure === "not_landed/refused_call").length, 0),
    uncovered: (record?.coverage?.gaps ?? []).reduce((n, g) => n + g.units.length, 0),
    // Batch 1 (decision B): blocks coarser than a sentence, in the checks that entered; admitted, they cover no sentence.
    ...(registry ? { coarse: (() => { const c = mine.map(k => k.blocks.filter(b => coarseUnit(registry, b.split("#")[0])).length); return { checks: c.filter(n => n > 0).length, blocks: c.reduce((a, b) => a + b, 0) } })() } : {}),
  }
}

/** A guard's output now, for the package's guard list (§6c): its exit code and what its assertions read, never what they expect. */
function guardOutput(k: CheckRecord, run: CheckRun): string {
  const clip = (t: string, n: number) => t.length > n ? `${t.slice(0, n)}…` : t
  const read = run.assertions.filter(x => k.assertions.find(y => y.id === x.id)?.target.kind !== "exit_code").map(x => { const t = k.assertions.find(y => y.id === x.id)!.target; return `${[t.kind, t.path, t.line, t.pointer, t.column].filter(v => v !== null && v !== undefined).join(" ")} = ${clip(JSON.stringify(x.actual) ?? "null", 200)}` })
  return clip([`exit ${run.exit_code ?? "?"}`, ...read].join("; "), 400)
}
