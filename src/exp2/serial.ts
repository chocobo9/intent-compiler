import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { AnchorExtractor } from "./anchors.js"
import { AuthInvalid, QuotaExhausted, type AttributionTransport, type ModelReply } from "./attribution.js"
import { codeFacts, type ChecksTransport } from "./checks.js"
import { executeRound, type BuildResult, type ExecutionLimits, type ExecutionRecord, type Executor } from "./execution.js"
import { head, initRepo, resetTo } from "./git.js"
import { buildReport, codingCost, renderReport, type RoundReport, type StageCost } from "./report.js"
import { nullBaseline, type CheckRunner, type ProgramRef, type ScriptSandbox } from "./runner.js"
import type { Exp2State, Exp2Store } from "./store.js"
import { buildWorkOrder, nameLinks, renderWorkOrder, type PreviousStep, type WorkOrder } from "./workorder.js"

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
    if (!calls.length && !checkCalls.length && !this.progress) return
    const n = readdirSync(join(this.c.checkpoints, "interrupted")).filter(f => f.startsWith(`round-${pad(round)}-`)).length + 1
    const attempt: InterruptedAttempt = { round, reason, calls, check_calls: checkCalls, execution: this.progress }
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
        if (e instanceof AuthInvalid) {
          // A dead login is not waited out: keep what the attempt spent, go back to the checkpoint, stop and report.
          this.salvage(round, `login invalid: ${e.message}`)
          await this.restore(last)
          const stop = { status: "stopped", reason: `login invalid: ${e.message}`, issues: [] }
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
    // 1. Attribution.
    const attribution = await store.ingestRound(round, this.c.text(round), withWatchdog(this.c.attribution, limits.managementTimeoutMs), { maxRepairs: limits.attributionRepairs })
    if (attribution.status === "interrupted") throw stopping(attribution.issues ?? [], `attribution, round ${round}`)
    if (attribution.status === "failed") return { status: "stopped", reason: "attribution did not pass within its repair limit", issues: attribution.issues ?? [] }

    // 2. Checks, against the baseline: the last accepted program (the checkpoint's head), or the null program.
    const baseline = this.program(round === 1 ? null : `R${round - 1}-final`)
    const derived = await store.deriveRoundChecks(round, withWatchdog(this.c.checks, limits.managementTimeoutMs), { sandbox: this.c.sandbox, runner: this.c.runner, baseline, maxRepairs: limits.checkRepairs, timeoutMs: limits.checkTimeoutMs })
    if (derived.status === "interrupted") throw stopping(derived.issues ?? [], `checks, round ${round}`)
    const start = await store.runRoundChecks(round, baseline, this.c.runner, { verdict: false, timeoutMs: limits.checkTimeoutMs })

    // 3. The work order.
    let state = store.inspect()
    const registry = store.registry(state)
    const anchorsNow = this.c.anchors.extract(workdir)
    const links = [...state.executions.flatMap(e => e.links), ...nameLinks(registry, anchorsNow, round)]
    const steps: PreviousStep[] = state.executions.flatMap(e => e.steps.map(s => ({ id: s.id, round: s.round, status: s.status, objects: s.objects, anchors: s.anchors })))
    const previous = state.reports.find(r => r.round === round - 1)
    const workorder: WorkOrder = buildWorkOrder({
      registry, round, library: state.checks, events: state.check_events, statuses: start.statuses, runs: start.runs, anchors: anchorsNow, links, steps,
      previous_task: previous ? state.executions.find(x => x.round === round - 1)?.task ?? [] : [],
    })
    // 4. Execution.
    const passing = start.runs.filter(r => r.outcome === "pass").map(r => r.check)
    const execution = await executeRound(workdir, workorder, renderWorkOrder(workorder), this.c.executor(round), {
      registry, library: state.checks, events: state.check_events, links, anchors: this.c.anchors, build: this.c.build, runner: this.c.runner,
      facts: codeFacts(registry, round), passing, checkTimeoutMs: limits.checkTimeoutMs, onProgress: r => { this.progress = r },
    }, limits.execution)

    // 5. Verdict on the final program, report, checkpoint.
    const final = this.program(`R${round}-final`)
    const verdict = await store.runRoundChecks(round, final, this.c.runner, { verdict: true, timeoutMs: limits.checkTimeoutMs })
    state = store.inspect()
    const interrupted = this.interruptedAttempts(round)
    const events = state.check_events.filter(e => e.round === round)
    const report = buildReport({
      round, registry, workorder, execution, executorIsStub: this.c.executorIsStub, statuses: verdict.statuses,
      understand: state.calls.filter(c => c.round === round), acceptance: state.check_calls.filter(c => c.round === round),
      interrupted: {
        attempts: interrupted.length, understand: interrupted.flatMap(a => a.calls), acceptance: interrupted.flatMap(a => a.check_calls),
        coding: interrupted.reduce((t: StageCost, a) => { const c = codingCost(a.execution, this.c.executorIsStub); return { calls: t.calls + c.calls, tokens: sumUsage(t.tokens, c.tokens), stub_calls: t.stub_calls + c.stub_calls } }, codingCost(null, false)),
      },
      checks: {
        entered: state.checks.filter(k => k.round === round).length, stale: events.filter(e => e.status === "stale").length, retired: events.filter(e => e.status === "retired").length,
        run: verdict.runs.length, passed: verdict.runs.filter(r => r.outcome === "pass").length, failed: verdict.runs.filter(r => r.outcome === "fail").length,
      },
    })
    await store.recordRound(execution, report)
    const commit = head(workdir)
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
    writeFileSync(join(this.c.checkpoints, "scores.jsonl"), JSON.stringify({ round, commit, ...score }) + "\n", { encoding: "utf8", flag: "a" })
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

/** The error a stopped management step stands for: a spent quota, or an invalid login. */
function stopping(issues: { code: string; message: string }[], where: string): Error {
  const auth = issues.find(i => i.code === "auth")
  return auth ? new AuthInvalid(`${where}: ${auth.message}`) : new QuotaExhausted(where)
}

function sumUsage(a: StageCost["tokens"], b: StageCost["tokens"]): StageCost["tokens"] {
  return { input_tokens: a.input_tokens + b.input_tokens, cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens, cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens, output_tokens: a.output_tokens + b.output_tokens, reasoning_tokens: a.reasoning_tokens + b.reasoning_tokens }
}

export type { ModelReply }
