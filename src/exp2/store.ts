import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { attributeRound, type AttributionTransport, type Issue, type ModelCallRecord } from "./attribution.js"
import { materialize, type Registry, type RoundAcceptance, type Signal } from "./registry.js"
import { contentHash } from "./source.js"
import { activeChecks, basisOf, codeFacts, deriveChecks, methodB, replacedBasis, staleChecks, type CheckCallRecord, type CheckEvent, type CheckIssue, type CheckRecord, type ChecksTransport } from "./checks.js"
import type { CheckRunner, ProgramRef, ScriptSandbox } from "./runner.js"
import type { ExecutionRecord } from "./execution.js"
import type { RoundReport } from "./report.js"
import { objectStatuses, runCheck, strength, type CheckRun, type ObjectStatus } from "./verdict.js"

/**
 * Exp2 external state (DESIGN §5): one JSON file kept by code, append-only, changed only inside a locked
 * transaction that writes a temp file and renames it over the old one. It holds the source log, every model call
 * with its token usage, and each round's outcome; objects, versions and change records are replayed from these.
 */

export const EXP2_PROFILE = "exp2-ic/block1"

export interface RoundRecord {
  round: number
  status: "accepted" | "failed" | "interrupted"
  calls: string[]
  acceptance?: RoundAcceptance
  issues?: Issue[]
}

export interface Exp2State {
  profile: typeof EXP2_PROFILE
  run_id: string
  sources: { round: number; text: string; hash: string }[]
  calls: ModelCallRecord[]
  rounds: RoundRecord[]
  /** Reserved for split/merge suspicion signals (DESIGN §4.2); nothing writes them in this block. */
  signals: Signal[]
  /** Check library (DESIGN §8): checks by id (K1, K2, … never reused), status changes, runs, derivation calls. */
  checks: CheckRecord[]
  check_events: CheckEvent[]
  check_runs: CheckRun[]
  check_calls: CheckCallRecord[]
  check_rounds: CheckRoundRecord[]
  /** Each round's execution record and report (DESIGN §7, §14). */
  executions: ExecutionRecord[]
  reports: RoundReport[]
}

export interface CheckRoundRecord {
  round: number
  status: "accepted" | "failed" | "interrupted"
  calls: string[]
  /** Checks entered this round (admitted or recorded as unknown), and checks retired. */
  entered: string[]
  retired: string[]
  /** Retire proposals the code did not accept: the check's basis had not changed. */
  rejected_retire: { check: string; reason: string }[]
  issues?: CheckIssue[]
}

export interface DeriveDeps {
  sandbox: ScriptSandbox
  runner: CheckRunner
  /** The program strength is judged against: the null baseline in round 1, then the last accepted version. */
  baseline: ProgramRef
  maxRepairs?: number
  timeoutMs?: number
}

export interface IngestOptions { maxRepairs?: number }

export class Exp2Store {
  readonly directory: string
  private readonly file: string
  constructor(directory: string, readonly runId: string) {
    this.directory = resolve(directory)
    mkdirSync(this.directory, { recursive: true })
    this.file = resolve(this.directory, "exp2-state.json")
  }

  inspect(): Exp2State {
    if (!existsSync(this.file)) return { profile: EXP2_PROFILE, run_id: this.runId, sources: [], calls: [], rounds: [], signals: [], ...emptyChecks() }
    const s = JSON.parse(readFileSync(this.file, "utf8")) as Exp2State
    if (s.profile !== EXP2_PROFILE || s.run_id !== this.runId) throw new Error("Store profile/run mismatch")
    return { ...emptyChecks(), ...s }
  }

  registry(state: Exp2State = this.inspect()): Registry {
    return materialize(state.sources, state.rounds.filter(r => r.status === "accepted").map(r => r.acceptance!))
  }

  /** Logs round `round`'s text, runs attribution, and records the outcome; a failed round can be ingested again. */
  async ingestRound(round: number, text: string, transport: AttributionTransport, options: IngestOptions = {}): Promise<RoundRecord> {
    return this.transaction(async s => {
      const accepted = s.rounds.filter(r => r.status === "accepted").map(r => r.round)
      const expected = accepted.length ? Math.max(...accepted) + 1 : 1
      if (round !== expected) throw new Error(`Round ${round} cannot be ingested; the next round is ${expected}`)
      const hash = contentHash(text)
      const logged = s.sources.find(x => x.round === round)
      if (logged && (logged.text !== text || logged.hash !== hash)) throw new Error(`Round ${round} text differs from the logged source; the log is append-only`)
      if (!logged) s.sources.push({ round, text, hash })
      const registry = this.registry(s)
      const outcome = await attributeRound(registry, round, transport, { maxRepairs: options.maxRepairs ?? 2, callId: n => `M${s.calls.length + n}` })
      s.calls.push(...outcome.calls)
      const record: RoundRecord = outcome.status === "accepted"
        ? { round, status: "accepted", calls: outcome.calls.map(c => c.id), acceptance: outcome.acceptance }
        : { round, status: outcome.status, calls: outcome.calls.map(c => c.id), issues: outcome.issues }
      if (record.acceptance) {
        // Replaying the accepted answer must reproduce a full, single cover of the round.
        registry.apply(record.acceptance)
        const problems = registry.coverageProblems(round)
        if (problems.length) throw new Error(`Accepted answer does not cover round ${round}: ${problems.slice(0, 5).join("; ")}`)
      }
      s.rounds.push(record)
      return record
    })
  }

  /** Derives checks for the objects round `round` changed, admits what verifies, and judges strength on the baseline. */
  async deriveRoundChecks(round: number, transport: ChecksTransport, deps: DeriveDeps): Promise<CheckRoundRecord> {
    return this.transaction(async s => {
      if (!s.rounds.some(r => r.round === round && r.status === "accepted")) throw new Error(`Round ${round} has no accepted attribution`)
      if (s.check_rounds.some(r => r.round === round && r.status === "accepted")) throw new Error(`Round ${round} already has its checks`)
      const registry = this.registry(s)
      s.check_events.push(...staleChecks(registry, s.checks, s.check_events, round))
      const nextCall = () => s.calls.length + s.check_calls.length
      const outcome = await deriveChecks(registry, round, s.checks, s.check_events, transport, { maxRepairs: deps.maxRepairs ?? 2, callId: n => `M${nextCall() + n}` })
      s.check_calls.push(...outcome.calls)
      const calls = outcome.calls.map(c => c.id)
      if (outcome.status !== "accepted") {
        const record: CheckRoundRecord = { round, status: outcome.status, calls, entered: [], retired: [], rejected_retire: [], issues: outcome.issues }
        s.check_rounds.push(record)
        return record
      }
      const timeout = deps.timeoutMs ?? 10_000
      const facts = codeFacts(registry, round)
      const entered: string[] = []
      for (const draft of outcome.draft!.checks) {
        const b = await methodB(draft, deps.sandbox, timeout)
        const record: CheckRecord = {
          id: `K${s.checks.length + 1}`, round, key: draft.key, object: draft.object, blocks: draft.blocks, uses: draft.uses, direction: draft.direction,
          input: draft.input, assertions: b.assertions, unknown: b.unknown, reference_script: draft.reference_script,
          admission: b.assertions.length ? "admitted" : "unknown", admission_reason: b.assertions.length ? null : b.unknown.map(u => `${u.assertion.id}: ${u.reason}`).join("; "),
          strength: null, status: "active", calls,
        }
        if (record.admission === "admitted") record.strength = strength(record, await runCheck(record, deps.baseline, deps.runner, round, registry, facts, timeout), deps.baseline)
        s.checks.push(record)
        entered.push(record.id)
      }
      // A retire proposal is accepted only when the check's basis was in fact revised after it entered.
      const retired: string[] = [], rejected: { check: string; reason: string }[] = []
      for (const r of outcome.draft!.retire) {
        const k = s.checks.find(c => c.id === r.check)!
        if (replacedBasis(registry, basisOf(registry, k), k.round, round).length) { s.check_events.push({ check: r.check, round, status: "retired", reason: r.reason, by: "model", cause: { kind: "proposal", source: r.check } }); retired.push(r.check) }
        else rejected.push(r)
      }
      const record: CheckRoundRecord = { round, status: "accepted", calls, entered, retired, rejected_retire: rejected }
      s.check_rounds.push(record)
      return record
    })
  }

  /** Reruns the whole active library on `program` (the regression), records the runs, and returns the statuses. */
  async runRoundChecks(round: number, program: ProgramRef, runner: CheckRunner, options: { verdict?: boolean; timeoutMs?: number } = {}): Promise<{ runs: CheckRun[]; statuses: ObjectStatus[] }> {
    const verdict = options.verdict ?? true, timeoutMs = options.timeoutMs ?? 10_000
    return this.transaction(async s => {
      const registry = this.registry(s)
      s.check_events.push(...staleChecks(registry, s.checks.filter(c => c.round <= round), s.check_events, round))
      const facts = codeFacts(registry, round)
      const runs: CheckRun[] = []
      const library = activeChecks(s.checks.filter(c => c.round <= round), s.check_events.filter(e => e.round <= round))
      for (const check of library) runs.push({ ...await runCheck(check, program, runner, round, registry, facts, timeoutMs), verdict })
      s.check_runs.push(...runs)
      // A check judged input-suspect in two consecutive rounds' verdict runs is retired (block 2 review item 2).
      if (verdict) for (const run of runs) {
        if (run.failure?.class !== "unknown" || run.failure.reason === "timeout") continue
        const before = s.check_runs.filter(r => r.check === run.check && r.verdict && r.round === round - 1).at(-1)
        if (before?.failure?.class === "unknown" && before.failure.reason !== "timeout") {
          s.check_events.push({ check: run.check, round, status: "retired", by: "code", cause: { kind: "suspect", source: run.check }, reason: `input suspect in rounds ${round - 1} and ${round} (${run.failure.reason})` })
        }
      }
      return { runs, statuses: objectStatuses(registry, s.checks, s.check_events, runs, round) }
    })
  }

  /** Statuses from the recorded runs of one round on one program; nothing is carried over from earlier rounds. */
  statuses(round: number, program: string, state: Exp2State = this.inspect()): ObjectStatus[] {
    return objectStatuses(this.registry(state), state.checks, state.check_events, state.check_runs.filter(r => r.round === round && r.program === program), round)
  }

  /** Appends a round's execution record and report. */
  async recordRound(execution: ExecutionRecord, report: RoundReport): Promise<void> {
    await this.transaction(s => {
      if (s.reports.some(r => r.round === report.round)) throw new Error(`Round ${report.round} already has a report`)
      s.executions.push(execution)
      s.reports.push(report)
    })
  }

  /** The state file's exact text, for a checkpoint. */
  exportState(): string {
    return existsSync(this.file) ? readFileSync(this.file, "utf8") : JSON.stringify(this.inspect(), null, 2) + "\n"
  }

  /**
   * Puts the state back to a checkpoint's text (DESIGN §14: round N starts only from round N−1's checkpoint). This is
   * the one way the state may go back; whatever the interrupted attempt wrote must be saved elsewhere first.
   */
  async restoreState(text: string): Promise<void> {
    const s = JSON.parse(text) as Exp2State
    if (s.profile !== EXP2_PROFILE || s.run_id !== this.runId) throw new Error("Checkpoint profile/run mismatch")
    const lock = `${this.file}.lock`
    const fd = openSync(lock, "wx")
    try {
      const temp = `${this.file}.${process.pid}.tmp`
      writeFileSync(temp, text, "utf8")
      renameSync(temp, this.file)
    } finally { closeSync(fd); unlinkSync(lock) }
  }

  private save(before: Exp2State, after: Exp2State): void {
    appendOnly(before, after)
    const temp = `${this.file}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(after, null, 2) + "\n", "utf8")
    renameSync(temp, this.file)
  }

  private async transaction<T>(action: (s: Exp2State) => Promise<T> | T): Promise<T> {
    const lock = `${this.file}.lock`
    // A live owner blocks concurrent mutation; a lock left by a dead process is cleared.
    if (existsSync(lock)) {
      const pid = Number(readFileSync(lock, "utf8"))
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid store lock; inspect before recovery")
      let alive = true
      try { process.kill(pid, 0) } catch (e) { if ((e as NodeJS.ErrnoException).code === "ESRCH") alive = false; else throw e }
      if (alive) throw new Error("Exp2 store is busy")
      unlinkSync(lock)
    }
    const fd = openSync(lock, "wx")
    try {
      writeFileSync(fd, String(process.pid))
      const before = this.inspect()
      const working = structuredClone(before)
      const result = await action(working)
      this.save(before, working)
      return result
    } finally { closeSync(fd); unlinkSync(lock) }
  }
}

function emptyChecks() {
  return { checks: [] as CheckRecord[], check_events: [] as CheckEvent[], check_runs: [] as CheckRun[], check_calls: [] as CheckCallRecord[], check_rounds: [] as CheckRoundRecord[], executions: [] as ExecutionRecord[], reports: [] as RoundReport[] }
}

/** Every list in the state may only grow; existing entries must stay byte-identical. */
export function appendOnly(before: Exp2State, after: Exp2State): void {
  for (const key of ["sources", "calls", "rounds", "signals", "checks", "check_events", "check_runs", "check_calls", "check_rounds", "executions", "reports"] as const) {
    const a = before[key] as unknown[], b = after[key] as unknown[]
    if (b.length < a.length || a.some((x, i) => JSON.stringify(x) !== JSON.stringify(b[i]))) throw new Error(`Exp2 state ${key} is append-only`)
  }
  if (before.profile !== after.profile || before.run_id !== after.run_id) throw new Error("Exp2 state identity changed")
}
