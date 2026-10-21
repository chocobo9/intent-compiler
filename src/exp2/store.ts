import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { attributeRound, RoleUnavailable, type AttributionTransport, type Issue, type ModelCallRecord } from "./attribution.js"
import { writing } from "./platform.js"
import { materialize, type Registry, type RoundAcceptance, type Signal } from "./registry.js"
import { contentHash } from "./source.js"
import { activeChecks, basisOf, codeFacts, deriveChecks, methodB, replacedBasis, staleChecks, type CheckCallRecord, type CheckEvent, type CheckIssue, type CheckRecord, type ChecksTransport, type Coverage } from "./checks.js"
import type { CheckRunner, ProgramRef, ScriptSandbox } from "./runner.js"
import type { ExecutionRecord } from "./execution.js"
import type { RoundReport } from "./report.js"
import { objectStatuses, runCheck, strength, type CheckRun, type DisputeKind, type ObjectStatus } from "./verdict.js"
import { adjudicate, type AdjudicationCallRecord, type AdjudicationTransport, type Ruling } from "./adjudication.js"
import type { Discrimination } from "./discrimination.js"
import { activeProbes, deriveProbes, probeUnits, staleProbes, strengthenProbes, type ProbeCallRecord, type ProbeEvent, type ProbeRecord, type ProbeRoundRecord, type ProbeRun, type ProbeTransport } from "./probes.js"
import { judgeRuns, type Finding, type JudgeCallRecord, type Judgment, type JudgeTransport } from "./judge.js"

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
  /** The ablation switches the run was started with (DESIGN §12b item 14, §12c); absent when none is off. */
  ablation?: Ablation
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
  /** Rulings on disputed checks and their calls (BLOCK9 §2.3). */
  rulings: Ruling[]
  adjudication_calls: AdjudicationCallRecord[]
  /** Probes (P1, P2, … never reused), their stale events, the writer's calls and each round's outcome (BLOCK10 §1.2–1.3). */
  probes: ProbeRecord[]
  probe_events: ProbeEvent[]
  probe_calls: ProbeCallRecord[]
  probe_rounds: ProbeRoundRecord[]
  /** Verdicts kept by (probe, unit, unit text, output), and the judge's calls (BLOCK10 §1.4). */
  judgments: Judgment[]
  judge_calls: JudgeCallRecord[]
  /** Each round's measure of whether the probes tell right from wrong, and the strengthening it led to (BLOCK10 §7.3). */
  probe_measures: MeasureRecord[]
}

export interface MeasureRecord {
  round: number
  label: string
  sites: Discrimination["sites"]
  counts: Discrimination["counts"]
  score: number | null
  weak: { object: string; units: string[]; sites: string[] }[]
  strengthen: null | { status: "accepted" | "interrupted"; calls: string[]; entered: string[]; dropped: { key: string; problems: string[] }[] }
  /** The surviving mutants run again with the strengthened probes. */
  after: null | { still: string[]; killed: string[] }
}

/** A dispute to settle: a failed run of a check, the kind, and what code saw or the executor claimed. */
export interface Dispute { check: string; run: CheckRun; kind: DisputeKind; detail: string }

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
  /** Checks dropped one by one when the repairs ran out, with their issues (BLOCK9 §2.1). */
  dropped?: { key: string; issues: CheckIssue[] }[]
  /** What of this round's changed text the checks cover (BLOCK9 §2.2). */
  coverage?: Coverage
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

/**
 * Ablation switches, all default true: zoning false puts every live object in the task zone; checks false derives
 * no checks; clauses false splits no clauses. They are part of the state: a state opens only with the same settings.
 */
export interface Ablation { zoning?: boolean; checks?: boolean; clauses?: boolean }

/** Only the switches that are off, in a fixed order, so equal settings compare equal. */
export function ablationOff(a: Ablation = {}): Ablation {
  return Object.fromEntries((["zoning", "checks", "clauses"] as const).filter(k => a[k] === false).map(k => [k, false]))
}

export class Exp2Store {
  readonly directory: string
  private readonly file: string
  readonly ablation: Ablation
  constructor(directory: string, readonly runId: string, ablation: Ablation = {}) {
    this.ablation = ablationOff(ablation)
    this.directory = resolve(directory)
    writing("the state directory", this.directory, () => mkdirSync(this.directory, { recursive: true }))
    this.file = resolve(this.directory, "exp2-state.json")
  }

  inspect(): Exp2State {
    const off = Object.keys(this.ablation).length ? { ablation: this.ablation } : {}
    if (!existsSync(this.file)) return { profile: EXP2_PROFILE, run_id: this.runId, ...off, sources: [], calls: [], rounds: [], signals: [], ...emptyChecks() }
    const s = JSON.parse(readFileSync(this.file, "utf8")) as Exp2State
    if (s.profile !== EXP2_PROFILE || s.run_id !== this.runId) throw new Error("Store profile/run mismatch")
    if (JSON.stringify(ablationOff(s.ablation)) !== JSON.stringify(this.ablation)) throw new Error(`Store ablation mismatch: the state was written with ${JSON.stringify(ablationOff(s.ablation))}, opened with ${JSON.stringify(this.ablation)}`)
    return { ...emptyChecks(), ...s }
  }

  registry(state: Exp2State = this.inspect()): Registry {
    return materialize(state.sources, state.rounds.filter(r => r.status === "accepted").map(r => r.acceptance!), { clauses: state.ablation?.clauses })
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
          input: b.input ?? draft.input, assertions: b.assertions, unknown: b.unknown, reference_script: draft.reference_script,
          ...(b.computed_inputs.length ? { computed_inputs: b.computed_inputs } : {}),
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
      const record: CheckRoundRecord = { round, status: "accepted", calls, entered, retired, rejected_retire: rejected, dropped: outcome.dropped ?? [], ...(outcome.coverage ? { coverage: outcome.coverage } : {}) }
      s.check_rounds.push(record)
      return record
    })
  }

  /** Reruns the whole active library on `program` (the regression), records the runs, and returns the statuses. */
  async runRoundChecks(round: number, program: ProgramRef, runner: CheckRunner, options: { verdict?: boolean; timeoutMs?: number; adjudicate?: AdjudicationTransport } = {}): Promise<{ runs: CheckRun[]; statuses: ObjectStatus[] }> {
    const verdict = options.verdict ?? true, timeoutMs = options.timeoutMs ?? 10_000
    return this.transaction(async s => {
      const registry = this.registry(s)
      s.check_events.push(...staleChecks(registry, s.checks.filter(c => c.round <= round), s.check_events, round))
      const facts = codeFacts(registry, round)
      let runs: CheckRun[] = []
      const library = activeChecks(s.checks.filter(c => c.round <= round), s.check_events.filter(e => e.round <= round))
      for (const check of library) runs.push({ ...await runCheck(check, program, runner, round, registry, facts, timeoutMs, upheldKinds(s, check.id)), verdict })
      // Disputed failures are ruled on against the text (BLOCK9 §2.3): a wrong check leaves, a right one is run again.
      if (options.adjudicate) {
        const disputes = runs.filter(r => r.failure?.class === "disputed").map(r => ({ check: r.check, run: r, kind: r.failure!.reason as DisputeKind, detail: r.failure!.detail }))
        const settled = await this.settleIn(s, registry, round, disputes, options.adjudicate)
        runs = await Promise.all(runs.map(async r => {
          if (settled.wrong.has(r.check)) return null
          if (!settled.right.has(r.check)) return r
          return { ...await runCheck(library.find(c => c.id === r.check)!, program, runner, round, registry, facts, timeoutMs, upheldKinds(s, r.check)), verdict }
        })).then(x => x.filter((r): r is CheckRun => !!r))
      }
      s.check_runs.push(...runs)
      return { runs, statuses: objectStatuses(registry, s.checks, s.check_events, runs, round) }
    })
  }

  /** Rules on disputes (a contest from the executor, or evidence code saw), each check and kind once. */
  /**
   * Marks probes whose text changed stale, then writes probes for this round's changed units and for the live units
   * of the probes that just went stale. Each admitted probe gets the next P id.
   */
  async deriveRoundProbes(round: number, transport: ProbeTransport, options: { maxRepairs?: number } = {}): Promise<ProbeRoundRecord> {
    return this.transaction(async s => {
      const registry = this.registry(s)
      if (s.probe_rounds.some(r => r.round === round && r.status === "accepted")) throw new Error(`Probes of round ${round} are already written`)
      const stale = staleProbes(registry, s.probes, s.probe_events, round)
      s.probe_events.push(...stale)
      const units = probeUnits(registry, round, s.probes.filter(p => stale.some(e => e.probe === p.id)))
      const out = await deriveProbes(registry, round, units, transport, { maxRepairs: options.maxRepairs ?? 2, callId: n => `W${s.probe_calls.length + n}` })
      s.probe_calls.push(...out.calls)
      const entered: string[] = []
      if (out.status === "accepted") for (const p of out.probes) { const id = `P${s.probes.length + 1}`; s.probes.push({ id, ...p }); entered.push(id) }
      const record: ProbeRoundRecord = {
        round, status: out.status, calls: out.calls.map(c => c.id), entered, stale: stale.map(e => e.probe), units,
        covered: out.covered, uncheckable: out.uncheckable, uncovered: out.uncovered, dropped: out.dropped, cases: out.cases, ...(out.issues ? { issues: out.issues } : {}),
      }
      s.probe_rounds.push(record)
      return record
    })
  }

  /** Adds probes where the measure found the probes weak; the additions pass the same checks and repairs (BLOCK10 §7.3). */
  async strengthen(round: number, weak: readonly { units: string[]; message: string }[], transport: ProbeTransport, options: { maxRepairs?: number } = {}): Promise<NonNullable<MeasureRecord["strengthen"]> & { issues?: { code: string; message: string }[] }> {
    return this.transaction(async s => {
      const out = await strengthenProbes(this.registry(s), round, weak, activeProbes(s.probes, s.probe_events), transport, { maxRepairs: options.maxRepairs ?? 2, callId: n => `W${s.probe_calls.length + n}` })
      s.probe_calls.push(...out.calls)
      const entered: string[] = []
      if (out.status === "accepted") for (const p of out.probes) { const id = `P${s.probes.length + 1}`; s.probes.push({ id, ...p }); entered.push(id) }
      return { status: out.status, calls: out.calls.map(c => c.id), entered, dropped: out.dropped, ...(out.issues ? { issues: out.issues } : {}) }
    })
  }

  async recordMeasure(record: MeasureRecord): Promise<void> {
    await this.transaction(s => { s.probe_measures.push(record) })
  }

  /** Judges one program's runs of active probes; verdicts already kept for the same output are reused. */
  async judge(round: number, runs: readonly ProbeRun[], transport: JudgeTransport, options: { contests?: ReadonlyMap<string, string>; batchSize?: number } = {}): Promise<Finding[]> {
    const out = await this.transaction(async s => {
      const registry = this.registry(s)
      let r: Awaited<ReturnType<typeof judgeRuns>>
      try { r = await judgeRuns(registry, round, activeProbes(s.probes, s.probe_events), runs, s.judgments, transport, { callId: n => `J${s.judge_calls.length + n}`, ...options }) } catch (e) {
        // The failed calls are kept; the judge's being unavailable goes up once they are saved.
        if (!(e instanceof RoleUnavailable)) throw e
        s.judge_calls.push(...(e.calls as JudgeCallRecord[]))
        return e
      }
      s.judge_calls.push(...r.calls)
      s.judgments.push(...r.judgments)
      return r.findings
    })
    if (out instanceof RoleUnavailable) throw out
    return out
  }

  async settle(round: number, disputes: readonly Dispute[], transport: AdjudicationTransport): Promise<{ wrong: Set<string>; right: Set<string> }> {
    return this.transaction(async s => this.settleIn(s, this.registry(s), round, disputes, transport))
  }

  private async settleIn(s: Exp2State, registry: Registry, round: number, disputes: readonly Dispute[], transport: AdjudicationTransport): Promise<{ wrong: Set<string>; right: Set<string> }> {
    const wrong = new Set<string>(), right = new Set<string>()
    for (const d of disputes) {
      const prior = s.rulings.find(r => r.check === d.check && r.kind === d.kind)
      if (prior) { (prior.verdict === "check_wrong" ? wrong : right).add(d.check); continue }
      const check = s.checks.find(c => c.id === d.check)!
      const nextCall = () => s.calls.length + s.check_calls.length + s.adjudication_calls.length
      const out = await adjudicate(registry, round, check, d.run, d.kind, d.detail, transport, n => `M${nextCall() + n}`)
      s.adjudication_calls.push(...out.calls)
      if (!out.ruling) continue
      s.rulings.push({ ...out.ruling, call: out.calls.at(-1)!.id })
      if (out.ruling.verdict === "check_wrong") {
        wrong.add(d.check)
        s.check_events.push({ check: d.check, round, status: "retired", by: "model", cause: { kind: "adjudicated", source: d.kind }, reason: `ruled wrong (${d.kind}): ${out.ruling.reason} [${out.ruling.basis.join(", ")}]` })
      } else right.add(d.check)
    }
    return { wrong, right }
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
    writing("the state", this.file, () => { writeFileSync(temp, JSON.stringify(after, null, 2) + "\n", "utf8"); renameSync(temp, this.file) })
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

/** The kinds of dispute a ruling has upheld the check against: its failures of that kind count against the program. */
export function upheldKinds(s: Pick<Exp2State, "rulings">, check: string): Set<DisputeKind> {
  return new Set((s.rulings ?? []).filter(r => r.check === check && r.verdict === "check_right").map(r => r.kind))
}

function emptyChecks() {
  return { checks: [] as CheckRecord[], check_events: [] as CheckEvent[], check_runs: [] as CheckRun[], check_calls: [] as CheckCallRecord[], check_rounds: [] as CheckRoundRecord[], executions: [] as ExecutionRecord[], reports: [] as RoundReport[], rulings: [] as Ruling[], adjudication_calls: [] as AdjudicationCallRecord[],
    probes: [] as ProbeRecord[], probe_events: [] as ProbeEvent[], probe_calls: [] as ProbeCallRecord[], probe_rounds: [] as ProbeRoundRecord[], judgments: [] as Judgment[], judge_calls: [] as JudgeCallRecord[], probe_measures: [] as MeasureRecord[] }
}

/** Every list in the state may only grow; existing entries must stay byte-identical. */
export function appendOnly(before: Exp2State, after: Exp2State): void {
  for (const key of ["sources", "calls", "rounds", "signals", "checks", "check_events", "check_runs", "check_calls", "check_rounds", "executions", "reports", "rulings", "adjudication_calls", "probes", "probe_events", "probe_calls", "probe_rounds", "judgments", "judge_calls", "probe_measures"] as const) {
    const a = (before[key] ?? []) as unknown[], b = (after[key] ?? []) as unknown[]
    if (b.length < a.length || a.some((x, i) => JSON.stringify(x) !== JSON.stringify(b[i]))) throw new Error(`Exp2 state ${key} is append-only`)
  }
  if (before.profile !== after.profile || before.run_id !== after.run_id) throw new Error("Exp2 state identity changed")
}
