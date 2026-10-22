import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { AnchorExtractor } from "./anchors.js"
import { AuthInvalid, QuotaExhausted, RoleUnavailable, type AttributionTransport, type ModelReply } from "./attribution.js"
import { codeFacts, coverage, EMPTY_CHECKS, libraryCovers, type ChecksTransport } from "./checks.js"
import { executeRound, type BuildResult, type CycleRecord, type DetectScope, type DetectedRun, type ExecutionLimits, type ExecutionRecord, type Executor } from "./execution.js"
import { head, initRepo, resetTo } from "./git.js"
import { acceptanceFromLedger, acceptanceSummary, buildReport, codingCost, renderReport, type RoundReport, type StageCost } from "./report.js"
import { runDigest, type ObjectStatus } from "./verdict.js"
import { EnvironmentBlocked } from "./platform.js"
import { freezePrediction } from "./prediction.js"
import { nullBaseline, type CheckRunner, type ProgramRef, type ScriptSandbox } from "./runner.js"
import type { Exp2State, Exp2Store } from "./store.js"
import { buildWorkOrder, nameLinks, renderWorkOrder, type PreviousStep, type WorkOrder } from "./workorder.js"
import type { AdjudicationTransport } from "./adjudication.js"
import { upheldKinds } from "./store.js"
import { activeProbes, gapState, runProbes, type ProbeRecord, type ProbeRoundRecord, type ProbeTransport } from "./probes.js"
import { correctionItems, outputDigest, pairKey, probeStatuses, renderCorrections, type CorrectionItem, type Finding, type JudgeTransport } from "./judge.js"
import { ledgerOf, ledgerSummary, renderLedger } from "./ledger.js"
import { discriminate, remeasure } from "./discrimination.js"
import type { MeasureRecord } from "./store.js"
import type { PlatformOptions } from "./platform.js"
import type { AnchorLink } from "./workorder.js"
import type { Registry } from "./registry.js"

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
  /** Repairs of one group's probes (default 2). */
  probeRepairs?: number
  /** Mutants the discrimination measure runs a round at most (default 0: off, DESIGN §12g; on to measure check strength). */
  mutants?: number
  /** Probe runs side by side (default PROBE_CONCURRENCY). */
  probeConcurrency?: number
  execution: ExecutionLimits
}

export interface SerialConfig {
  store: Exp2Store
  workdir: string
  checkpoints: string
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
  /** Rulings on disputed checks (BLOCK9 §2.3), the same model as the rest; absent, disputed checks just do not count. */
  adjudicate?: AdjudicationTransport
  /** The program's name as the requirements call it (for the calls in correction lists). */
  binary?: string
  /** Where the local Go tool is, for the mutation helper. */
  platform?: PlatformOptions
  /** A non-blocking build, so mutants are built side by side (BLOCK10 §9.1). */
  buildAsync?: (workdir: string, label: string) => Promise<BuildResult>
  /** Probe writer and judge (BLOCK10): with both, probes are written every round and drive the repairs. */
  probes?: ProbeTransport
  judge?: JudgeTransport
  /** Rules where the judge's computation and the program disagree (DESIGN §12g); without it the judge does. */
  ruling?: JudgeTransport
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
    if (!calls.length && !checkCalls.length && !probeCalls.length && !judgeCalls.length && !this.progress) return
    const n = readdirSync(join(this.c.checkpoints, "interrupted")).filter(f => f.startsWith(`round-${pad(round)}-`)).length + 1
    const attempt: InterruptedAttempt = { round, reason, calls, check_calls: checkCalls, probe_calls: probeCalls, judge_calls: judgeCalls, execution: this.progress }
    writeFileSync(join(this.c.checkpoints, "interrupted", `round-${pad(round)}-${n}.json`), JSON.stringify(attempt, null, 2) + "\n", "utf8")
    this.progress = null
  }

  interruptedAttempts(round: number): InterruptedAttempt[] {
    const dir = join(this.c.checkpoints, "interrupted")
    return readdirSync(dir).filter(f => f.startsWith(`round-${pad(round)}-`)).sort().map(f => JSON.parse(readFileSync(join(dir, f), "utf8")) as InterruptedAttempt)
  }

  async run(options: { to: number; wait?: (ms: number) => Promise<void>; resumeWaitMs?: number; maxResumes?: number }): Promise<SerialOutcome> {
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
    const { store, workdir, limits } = this.c
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
    if (store.ablation.checks !== false) {
      const derived = await this.timed("checks", () => store.deriveRoundChecks(round, withWatchdog(this.c.checks, limits.managementTimeoutMs), { sandbox: this.c.sandbox, runner: this.c.runner, baseline, maxRepairs: limits.checkRepairs, timeoutMs: limits.checkTimeoutMs }))
      if (derived.status === "interrupted") throw stopping(derived.issues ?? [], `checks, round ${round}`)
    }
    const start = await this.timed("checks", () => store.runRoundChecks(round, baseline, this.c.runner, { verdict: false, timeoutMs: limits.checkTimeoutMs, adjudicate: this.c.adjudicate }))

    // 2b. Probes for this round's text; earlier probes run on the baseline, so what is still wrong is carried.
    const probing = this.c.probes && this.c.judge
    let carried: { findings: Finding[]; text: string; items: Map<string, string> } = { findings: [], text: "", items: new Map() }
    // The ledger at the round's start (DESIGN §12h E2): its open items are run every cycle; those listed only are not sent.
    const atStart = store.inspect()
    const ledger = ledgerOf(atStart, store.registry(atStart))
    const quiet = new Map(ledger.filter(e => e.state === "report_only" && e.end?.how === "expired" && e.digest).map(e => [e.id, e.digest!]))
    let units: string[] = coverage(store.registry(atStart), round, EMPTY_CHECKS, [], []).units
    // The round's probes are written in the background (BLOCK10 §9.1): they need the text, not the program, so coding
    // does not wait for them. Stale probes are marked first, so the carry-over below never runs one.
    let writing: Promise<ProbeRoundRecord> | null = null
    if (probing) {
      const begun = await store.beginRoundProbes(round)
      units = [...new Set([...units, ...begun.units])]
      writing = this.timed("probe writing", () => store.writeRoundProbes(round, begun, withWatchdog(this.c.probes!, limits.managementTimeoutMs), { maxRepairs: limits.probeRepairs ?? 2 }))
      writing.catch(() => {})
      const old = this.activeProbes().filter(p => p.round < round)
      if (old.length && baseline.kind !== "null") {
        const r = await this.timed("carry-over", () => this.probe(round, old, baseline, new Set(), new Map()))
        const digest = new Map(r.runs.map(x => [x.probe, x.digest]))
        // Items the ledger lists only, at the same output, are not carried (DESIGN §12h E3).
        const items = r.items.filter(it => quiet.get(it.key) !== digest.get(it.probe))
        carried = { findings: r.findings, text: items.length ? `\n${CARRIED_HEADER}\n${renderCorrections(items, programName(baseline))}\n` : "", items: new Map(items.map(it => [it.key, digest.get(it.probe) ?? ""])) }
      }
    }
    // What needs the round's probes waits for them here, and a writer that failed stops the round.
    const ready = async () => {
      if (!writing) return
      const w = await this.timed("waiting for probes", () => writing!)
      if (w.status === "interrupted") throw stopping(w.issues ?? [], `probes, round ${round}`)
    }

    // 3. The work order.
    let state = store.inspect()
    const registry = store.registry(state)
    const anchorsNow = this.c.anchors.extract(workdir)
    const links = [...state.executions.flatMap(e => e.links), ...nameLinks(registry, anchorsNow, round)]
    // The kept cycle of each earlier round, as the work order reads it: what it finished, and the anchors it changed.
    const steps: PreviousStep[] = state.executions.flatMap(e => e.cycles.filter(c => c.id === e.kept).map(c => ({ id: c.id, round: c.round, status: "committed", objects: e.task.filter(o => !e.carried.includes(o)).map(object => ({ object, coverage: "full" as const })), anchors: c.anchors })))
    const previous = state.reports.find(r => r.round === round - 1)
    const workorder: WorkOrder = buildWorkOrder({
      registry, round, library: state.checks, events: state.check_events, statuses: probing ? mergeStatuses(start.statuses, probeStatuses(registry, carried.findings)) : start.statuses, runs: start.runs, anchors: anchorsNow, links, steps,
      previous_task: previous ? state.executions.find(x => x.round === round - 1)?.task ?? [] : [],
      zoning: store.ablation.zoning,
    })
    // 4. Execution.
    const passing = start.runs.filter(r => r.outcome === "pass").map(r => r.check)
    const passed = new Set(carried.findings.filter(f => f.verdict === "ok").map(f => pairKey(f.probe, f.unit)))
    const execution = await executeRound(workdir, workorder, renderWorkOrder(workorder) + carried.text, this.c.executor(round), {
      registry, library: state.checks, events: state.check_events, links, anchors: this.c.anchors, build: this.c.build, runner: this.c.runner,
      facts: codeFacts(registry, round), passing, checkTimeoutMs: limits.checkTimeoutMs, onProgress: r => { this.progress = r },
      upheld: check => upheldKinds(store.inspect(), check),
      // Targeted runs (DESIGN §12h E4): the round's changed text, the ledger's open items, and what the previous round's
      // full run recorded each check and probe executing.
      target: {
        units: new Set(units), open: new Set(ledger.filter(e => e.state === "open" && e.source !== "coverage").map(e => e.id)), quiet,
        seen: seenFrom(state.executions.filter(x => x.round < round).sort((a, b) => a.round - b.round).at(-1)?.coverage),
        probes: async () => { await ready(); return this.activeProbes() },
      },
      carried: carried.items,
      ...(probing ? { detect: { passed, program: programName(baseline.kind === "null" ? { command: [this.c.binary ?? "program"] } as ProgramRef : baseline), run: async (program: ProgramRef, before: ReadonlySet<string>, contests: ReadonlyMap<string, string>, scope?: DetectScope) => {
        await ready()
        const all = this.activeProbes().filter(p => !scope?.probes || scope.probes.has(p.id))
        const r = await this.probe(round, all, program, before, contests, { full: scope?.full === true })
        return { items: r.items, findings: r.findings, runs: r.runs, counts: { probes: all.length, ...verdictCounts(r.findings) } }
      },

        ...((limits.mutants ?? 0) > 0 ? { measure: async (wd: string, program: ProgramRef, known: readonly AnchorLink[]) => { await ready(); return this.timed("measurement", () => this.measure(round, wd, program, known, new Set(workorder.task.map(t => t.object)))) } } : {}) } } : {}),
      time: (stage: string, a: number, b: number) => { this.spans.push({ stage, start: a, end: b }) },
      ...(this.c.adjudicate ? { settle: (disputes: Parameters<Exp2Store["settle"]>[1]) => store.settle(round, disputes, this.c.adjudicate!) } : {}),
    }, limits.execution)

    // The probes of the round are in before the verdict, even when no cycle built a program.
    await ready()
    // 5. Verdict on the final program, report, checkpoint.
    const final = this.program(`R${round}-final`)
    const verdict = await store.runRoundChecks(round, final, this.c.runner, { verdict: true, timeoutMs: limits.checkTimeoutMs, adjudicate: this.c.adjudicate })
    // The full run on the kept program before delivery is the final one (DESIGN §12h E4); run here only without it.
    const swept = execution.sweep && this.lastFull?.program === execution.sweep.cycle ? this.lastFull : null
    const finalProbes = probing && final.kind !== "null" ? swept ?? await this.timed("final probes", () => this.probe(round, this.activeProbes(), final, passed, new Map(), { full: true })) : null
    this.lastFull = null
    state = store.inspect()
    const interrupted = this.interruptedAttempts(round)
    const events = state.check_events.filter(e => e.round === round)
    // The round's end in the ledger: what fails on the program it delivers (from the full run, or the final run here).
    if (!execution.final) {
      const digests = new Map((finalProbes?.runs ?? []).map(x => [x.probe, x.digest]))
      execution.final = [
        ...verdict.runs.filter(r => r.outcome === "fail" && r.failure?.class === "not_landed").map(r => ({ id: r.check, digest: runDigest(r), verdict: "not_landed", action: "none" as const })),
        ...(finalProbes?.items ?? []).map(it => ({ id: it.key, digest: digests.get(it.probe) ?? "", verdict: "wrong", action: "none" as const })),
      ]
    }
    const ledgerNow = ledgerOf({ ...state, executions: [...state.executions, execution] }, registry)
    const summary = acceptanceFromLedger(acceptanceSummary({
      library: state.checks, runs: verdict.runs, events: state.check_events, findings: finalProbes?.findings ?? [],
      gaps: gapState(registry, state.probe_rounds, libraryCovers(registry, state.checks, state.check_events)),
    }).by_kind, ledgerNow)
    const report = buildReport({
      round, registry, workorder, execution, summary, ledger: ledgerSummary(ledgerNow, round), executorIsStub: this.c.executorIsStub, wall: wallTimes(this.spans, roundStart, Date.now()), statuses: finalProbes ? mergeStatuses(verdict.statuses, probeStatuses(registry, finalProbes.findings)) : verdict.statuses,
      probes: probing ? {
        calls: state.probe_calls.filter(c => c.round === round), judge_calls: state.judge_calls.filter(c => c.round === round), record: state.probe_rounds.find(r => r.round === round && r.status === "accepted") ?? null,
        active: this.activeProbes().length, findings: finalProbes?.findings ?? [], carried_in: carried.findings.filter(f => f.verdict === "wrong").length,
      } : null,
      understand: state.calls.filter(c => c.round === round), acceptance: state.check_calls.filter(c => c.round === round),
      interrupted: {
        attempts: interrupted.length, understand: interrupted.flatMap(a => a.calls), acceptance: interrupted.flatMap(a => [...a.check_calls, ...(a.probe_calls ?? []), ...(a.judge_calls ?? [])]),
        coding: interrupted.reduce((t: StageCost, a) => { const c = codingCost(a.execution, this.c.executorIsStub); return { calls: t.calls + c.calls, tokens: sumUsage(t.tokens, c.tokens), stub_calls: t.stub_calls + c.stub_calls } }, codingCost(null, false)),
      },
      checks: {
        entered: state.checks.filter(k => k.round === round).length, stale: events.filter(e => e.status === "stale").length, retired: events.filter(e => e.status === "retired").length,
        run: verdict.runs.length, passed: verdict.runs.filter(r => r.outcome === "pass").length, failed: verdict.runs.filter(r => r.outcome === "fail").length,
      },
    })
    await store.recordRound(execution, report)
    const commit = head(workdir)
    mkdirSync(this.dir(round), { recursive: true })
    writeFileSync(join(this.dir(round), "ledger.json"), JSON.stringify(ledgerNow, null, 1) + "\n", "utf8")
    writeFileSync(join(this.dir(round), "ledger.md"), `# Ledger after round ${round}\n\n${renderLedger(ledgerNow)}\n`, "utf8")
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
    const scored: RoundReport = { ...report, official_score: score }
    writeFileSync(join(this.dir(round), "report.json"), JSON.stringify(scored, null, 2) + "\n", "utf8")
    writeFileSync(join(this.dir(round), "report.md"), renderReport(scored), "utf8")
    const frozen = JSON.parse(readFileSync(join(this.dir(round), "prediction.json"), "utf8")) as { sha256: string }
    writeFileSync(join(this.c.checkpoints, "scores.jsonl"), JSON.stringify({ round, commit, ...score, prediction_sha256: frozen.sha256 }) + "\n", { encoding: "utf8", flag: "a" })
  }

  /**
   * The discrimination measure on the round's program (BLOCK10 §7.3): mutants in the task objects' code; where no
   * probe tells one apart, the writer strengthens those units' probes, and the survivors are run again.
   */
  private async measure(round: number, workdir: string, program: ProgramRef, links: readonly AnchorLink[], objects: ReadonlySet<string>): Promise<NonNullable<CycleRecord["measure"]>> {
    const { store, limits } = this.c
    const deps = { build: this.c.build, ...(this.c.buildAsync ? { buildAsync: this.c.buildAsync } : {}), runner: this.c.runner, registry: store.registry(), anchors: this.c.anchors.extract(workdir), links, timeoutMs: limits.checkTimeoutMs, max: limits.mutants ?? 0, objects, platform: this.c.platform }
    const d = await discriminate(workdir, program, this.activeProbes(), deps)
    let strengthen: MeasureRecord["strengthen"] = null, after: MeasureRecord["after"] = null
    if (d.weak.length) {
      const s = await this.timed("strengthening", () => store.strengthen(round, d.weak, withWatchdog(this.c.probes!, limits.managementTimeoutMs), { maxRepairs: limits.probeRepairs ?? 2 }))
      if (s.status === "interrupted") throw stopping(s.issues ?? [], `probes (strengthening), round ${round}`)
      strengthen = { status: s.status, calls: s.calls, entered: s.entered, dropped: s.dropped }
      if (s.entered.length) after = await remeasure(workdir, program, this.activeProbes(), d, { ...deps, registry: store.registry() })
    }
    await store.recordMeasure({ round, label: "round program", sites: d.sites, counts: d.counts, score: d.score, weak: d.weak.map(w => ({ object: w.object, units: w.units, sites: w.sites })), strengthen, after })
    return { mutants: d.mutants.length, ...d.counts, score: d.score, weak_units: [...new Set(d.weak.flatMap(w => w.units))], strengthened: strengthen?.entered ?? [], still_weak: after ? after.still.length : d.counts.survived }
  }

  private activeProbes(): ProbeRecord[] {
    const s = this.c.store.inspect()
    return activeProbes(s.probes, s.probe_events)
  }

  /** The last full run's findings, by the program it ran on: the round's final findings when that is the kept one. */
  private lastFull: { program: string; findings: Finding[]; items: CorrectionItem[]; runs: DetectedRun[] } | null = null

  /**
   * Runs probes on a program and judges the runs (kept verdicts reused): the findings, the correction items, and each
   * run's digest and coverage. A full run judges a changed output only where a regression is suspected: the pair's
   * last verdict was ok or wrong, or it has none (DESIGN §12h E4).
   */
  private async probe(round: number, probes: readonly ProbeRecord[], program: ProgramRef, before: ReadonlySet<string>, contests: ReadonlyMap<string, string>, options: { full?: boolean } = {}) {
    const ms = this.c.limits.managementTimeoutMs
    const out = await runAndJudge({ store: this.c.store, runner: this.c.runner, timeoutMs: this.c.limits.checkTimeoutMs, concurrency: this.c.limits.probeConcurrency, judge: withWatchdog(this.c.judge!, ms), sandbox: this.c.sandbox, ...(this.c.ruling ? { ruling: withWatchdog(this.c.ruling, ms) } : {}), timed: (stage, f) => this.timed(stage, f) }, round, probes, program, before, contests, options)
    if (options.full) this.lastFull = { program: program.id, ...out }
    return out
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

/**
 * Runs probes on a program and judges the runs (kept verdicts reused): the findings, the correction items, and each
 * run's digest and coverage. Objections are ruled on by `ruling` (DESIGN §12h E3). A full run judges a changed output
 * only where a regression is suspected: the pair's last verdict was ok or wrong, or it has none (E4).
 */
export async function runAndJudge(d: { store: Exp2Store; runner: CheckRunner; timeoutMs: number; concurrency?: number; judge: JudgeTransport; ruling?: JudgeTransport; sandbox?: ScriptSandbox; timed?: <T>(stage: string, f: () => Promise<T>) => Promise<T> }, round: number, probes: readonly ProbeRecord[], program: ProgramRef, before: ReadonlySet<string>, contests: ReadonlyMap<string, string>, options: { full?: boolean } = {}): Promise<{ findings: Finding[]; items: CorrectionItem[]; runs: DetectedRun[] }> {
  const timed = d.timed ?? (<T>(_: string, f: () => Promise<T>) => f())
  const runs = await timed("probe runs", () => runProbes(probes, program, d.runner, d.timeoutMs, d.concurrency))
  const last = new Map<string, string>()
  if (options.full) for (const j of d.store.inspect().judgments) last.set(pairKey(j.probe, j.unit), j.verdict)
  const judgeIf = options.full ? (probe: string, unit: string) => { const v = last.get(pairKey(probe, unit)); return v === undefined || v === "ok" || v === "wrong" } : undefined
  const findings = (await timed("judging", () => d.store.judge(round, runs, d.judge, { contests, ...(d.sandbox ? { sandbox: d.sandbox } : {}), ...(judgeIf ? { judgeIf } : {}), ...(d.ruling ? { ruling: d.ruling } : {}) }))).filter(f => probes.some(p => p.id === f.probe))
  return { findings, items: correctionItems(d.store.registry(), probes, runs, findings, before), runs: runs.map(r => ({ probe: r.probe, digest: outputDigest(r.output), ...(r.coverage !== undefined ? { coverage: r.coverage } : {}) })) }
}

/** What the previous round's full run recorded per check and probe: the functions it executed and its output's digest. */
export function seenFrom(c: ExecutionRecord["coverage"]): Map<string, { functions?: string[]; digest: string }> {
  if (!c) return new Map()
  return new Map(Object.entries(c.ids).map(([id, v]) => [id, { ...(v.f ? { functions: v.f.map(i => c.functions[i]) } : {}), digest: v.d }]))
}

/** How a cycle's probe verdicts were reached: judged now (an output changed), from the cache, or by code. */
export function verdictCounts(findings: readonly Finding[]): { judged: number; cached: number; by_code: number } {
  return { judged: findings.filter(f => !f.cached && f.kind !== "A" && f.kind !== "B").length, cached: findings.filter(f => f.cached).length, by_code: findings.filter(f => !f.cached && (f.kind === "A" || f.kind === "B")).length }
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

/** The section the work order gets for what earlier rounds' probes still find wrong (BLOCK10 §1.6). */
export const CARRIED_HEADER = "## Corrections still open from earlier rounds\n\nProbes of earlier rounds, run on the program as it stands now, still show these deviations from the requirements. Fix them along with this round's work; the requirements are the authority."

/** The name a correction list calls the program by: the built file, without a Windows extension. */
export function programName(program: ProgramRef): string {
  return (program.command.at(-1) ?? "program").split(/[\\/]/u).pop()!.replace(/\.exe$/iu, "")
}

/** Check statuses and probe statuses together: not landed by either is not landed; otherwise a known one wins. */
export function mergeStatuses(checks: readonly ObjectStatus[], probes: readonly ObjectStatus[]): ObjectStatus[] {
  const byProbe = new Map(probes.map(p => [p.object, p]))
  const out = checks.map(c => {
    const p = byProbe.get(c.object)
    if (!p || p.status === "unknown" || c.status === "not_landed") return c
    if (p.status === "not_landed" || c.status === "unknown") return { ...p, passing_strong: [...c.passing_strong, ...p.passing_strong], not_landed: [...c.not_landed, ...p.not_landed], unknown: [...c.unknown, ...p.unknown] }
    return c
  })
  for (const p of probes) if (!checks.some(c => c.object === p.object)) out.push(p)
  return out
}

/** The error a stopped management step stands for: a spent quota, or an invalid login. */
function stopping(issues: { code: string; message: string }[], where: string): Error {
  const auth = issues.find(i => i.code === "auth"), gone = issues.find(i => i.code === "unavailable")
  return auth ? new AuthInvalid(`${where}: ${auth.message}`) : gone ? new RoleUnavailable(where, gone.message) : new QuotaExhausted(where)
}

function sumUsage(a: StageCost["tokens"], b: StageCost["tokens"]): StageCost["tokens"] {
  return { input_tokens: a.input_tokens + b.input_tokens, cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens, cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens, output_tokens: a.output_tokens + b.output_tokens, reasoning_tokens: a.reasoning_tokens + b.reasoning_tokens }
}

export type { ModelReply }
