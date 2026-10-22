import type { TokenUsage } from "./attribution.js"
import type { ExecutionRecord } from "./execution.js"
import type { Registry } from "./registry.js"
import type { CheckEvent, CheckRecord } from "./checks.js"
import type { CheckRun, ObjectStatus } from "./verdict.js"
import type { WorkOrder } from "./workorder.js"
import type { ProbeRoundRecord } from "./probes.js"
import { pairKey, type Finding } from "./judge.js"
import type { SweepRecord } from "./execution.js"
import type { LedgerEntry, LedgerSummary } from "./ledger.js"

/**
 * The round report (DESIGN §14), built by code from the round's records: official score (filled in locally only,
 * never fed back), calls and tokens by stage, scope and zone sizes, each object's status with its basis, and loss
 * attribution in three kinds.
 */

export interface StageCost { calls: number; tokens: TokenUsage; stub_calls: number; /** Real calls with no reported usage: the tokens shown leave them out. */ unknown_usage_calls?: number }

export interface RoundReport {
  round: number
  /** Official verifier score: scored locally only, never read by the system. Null offline. */
  official_score: null | { passed: number; total: number }
  status: "done" | "stopped"
  stages: { understand: StageCost; acceptance: StageCost; coding: StageCost }
  /** Calls of attempts that were interrupted and rerun from the checkpoint (their tokens are spent too). */
  interrupted: { attempts: number; stages: { understand: StageCost; acceptance: StageCost; coding: StageCost } }
  scope: string[]
  zones: { task: number; protect: number; status: number; source_blocks: number; anchors: number }
  execution: { status: ExecutionRecord["status"]; cycles: number; repairs: number; kept: string | null; failing_at_end: number; contests: number; carried_objects: string[]; sessions: number; broken_sessions: number }
  checks: { entered: number; stale: number; retired: number; run: number; passed: number; failed: number }
  /**
   * Probes and judge (BLOCK10), null when off. share: their tokens over the round's coding tokens, all tokens
   * (input, cache, output) and without cache reads. Models as the calls report them.
   */
  probes: null | {
    writer: StageCost; judge: StageCost; models: { writer: string[]; judge: string[] }
    share: { all: number | null; uncached: number | null }
    active: number; written: number; stale: number; units: number; uncovered: string[]; dropped: number
    carried_in: number; open_at_end: string[]; ambiguous_at_end: string[]; broke: string[]
    /** Case-level coverage of this round's units (BLOCK10 §7.3). */
    cases: { total: number; covered: number; excused: number; open: string[] } | null
    /** Probes run per cycle and why (BLOCK11 §1; DESIGN §12h E4: how many were selected for which reason, and the full run). */
    runs_by_cycle: { cycle: string; checks: number; probes: number; judged: number; cached: number; by_code: number; selected?: NonNullable<import("./execution.js").CheckRunCounts["selected"]>; sweep?: SweepRecord }[]
    /** Cache reads over all input read, per role (DESIGN §12h E5): input plus cache reads in the denominator. */
    cache?: { writer: number | null; judge: number | null }
    /** Units (or cases) no probe exercises yet, carried into this round's writing, and those still open at its end (BLOCK11 §2). */
    gaps: { carried_in: string[]; open: string[] }
    /** Whether the probes tell the round's program from mutants of it, measured by code; null when not run. */
    discrimination: null | { mutants: number; killed: number; survived: number; build_failed: number; score: number | null; weak_units: string[]; strengthened: string[]; still_weak: number }
  }
  objects: { object: string; name: string; status: ObjectStatus["status"]; reasons: string[]; passing_strong: string[]; not_landed: string[]; unknown: string[] }[]
  /**
   * Where a not-landed or unknown object falls. boundary: the text gives no checkable expectation (no checks, only
   * weak ones, derivations that disagreed). ic: IC's own doing (a suspect check, a not-landed object left out of the
   * task zone). executor: the work order was right, the executor did not get it done.
   */
  loss: { boundary: string[]; ic: string[]; executor: string[] }
  /**
   * Wall time (BLOCK10 §9.1): the round's, and per stage the time its spans cover, with when it first started and
   * last ended (ms from the round's start). Stages overlap (probe writing beside coding).
   */
  wall?: { round_ms: number; stages: { stage: string; ms: number; spans: number; first_start_ms: number; last_end_ms: number }[] }
  /** Calls into the management stages (attribution, checks) this round, by stage, for the per-round budget. */
  management_calls: number
  /**
   * The round's acceptance in one model (DESIGN §12g): determinations on the final program by kind (A a stated value
   * compared by code, B a reference's value or property compared by code, C a model judgment), and open items by reason.
   */
  acceptance?: AcceptanceSummary
  /** The ledger's projection for the round (DESIGN §12h E2). */
  ledger?: LedgerSummary
  /** The full run before delivery and what the cycles' selection missed (DESIGN §12h E4). */
  selection?: { sweep: SweepRecord | null; omissions: { id: string; since: string }[] }
}

export interface AcceptanceSummary {
  by_kind: { A: number; B: number; C: number }
  open: {
    program_wrong: string[]; uncovered: string[]; reference_pending: string[]; ambiguous: string[]
    /** Closed by code: left unexercised by two writings in a row. Reported, no longer written for. */
    uncheckable: { unit: string; reason: string }[]
    /** Listed only: open at the end of rounds in a row with no progress (DESIGN §12h E3). */
    expired?: string[]
  }
}

/** The open items of the acceptance as the ledger has them (DESIGN §12h E2): the report is a projection of it. */
export function acceptanceFromLedger(by_kind: AcceptanceSummary["by_kind"], entries: readonly LedgerEntry[]): AcceptanceSummary {
  const open = (reason: LedgerEntry["reason"]) => entries.filter(e => e.state === "open" && e.reason === reason).map(e => e.id)
  const listed = (how: string) => entries.filter(e => e.state === "report_only" && e.end?.how === how)
  return {
    by_kind,
    open: {
      program_wrong: open("program_wrong"), uncovered: open("uncovered"), reference_pending: open("reference_pending"),
      ambiguous: listed("ruled_ambiguous").map(e => e.id), uncheckable: listed("uncheckable").map(e => ({ unit: e.id, reason: e.end!.detail })), expired: listed("expired").map(e => e.id),
    },
  }
}

/** Kind of a library check: B when any expected value rests on a reference (derived, computed), else A. */
export const libraryKind = (k: CheckRecord): "A" | "B" => k.assertions.some(a => a.source.kind === "derived" || a.source.kind === "computed") ? "B" : "A"

export function acceptanceSummary(i: { library: readonly CheckRecord[]; runs: readonly CheckRun[]; events: readonly CheckEvent[]; findings: readonly Finding[]; gaps: { open: string[]; closed: { unit: string; reason: string }[] } }): AcceptanceSummary {
  const by_kind = { A: 0, B: 0, C: 0 }
  for (const r of i.runs) { const k = i.library.find(c => c.id === r.check); if (k) by_kind[libraryKind(k)]++ }
  for (const f of i.findings) by_kind[f.kind ?? "C"]++
  return {
    by_kind,
    open: {
      program_wrong: [...i.runs.filter(r => r.failure?.class === "not_landed").map(r => r.check), ...i.findings.filter(f => f.verdict === "wrong").map(f => pairKey(f.probe, f.unit))],
      uncovered: i.gaps.open,
      reference_pending: i.runs.filter(r => r.failure?.class === "disputed").map(r => r.check),
      ambiguous: [...i.events.filter(e => e.status === "retired" && e.reason.startsWith("ruled ambiguous")).map(e => e.check), ...i.findings.filter(f => f.verdict === "ambiguous").map(f => pairKey(f.probe, f.unit))],
      uncheckable: i.gaps.closed.map(c => ({ unit: c.unit, reason: c.reason })),
    },
  }
}

export const zeroUsage = (): TokenUsage => ({ input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 })
export const addUsage = (a: TokenUsage, b: Partial<TokenUsage>): TokenUsage => ({
  input_tokens: a.input_tokens + (b.input_tokens ?? 0), cache_read_tokens: a.cache_read_tokens + (b.cache_read_tokens ?? 0), cache_write_tokens: a.cache_write_tokens + (b.cache_write_tokens ?? 0),
  output_tokens: a.output_tokens + (b.output_tokens ?? 0), reasoning_tokens: a.reasoning_tokens + (b.reasoning_tokens ?? 0),
})

export function stageCost(calls: readonly { usage: TokenUsage; stub: boolean; usage_unknown?: boolean }[]): StageCost {
  const unknown = calls.filter(c => c.usage_unknown).length
  return { calls: calls.length, tokens: calls.reduce((t, c) => addUsage(t, c.usage), zeroUsage()), stub_calls: calls.filter(c => c.stub).length, ...(unknown ? { unknown_usage_calls: unknown } : {}) }
}

export function codingCost(exec: ExecutionRecord | null, stub: boolean): StageCost {
  if (!exec) return { calls: 0, tokens: zeroUsage(), stub_calls: 0 }
  const calls = exec.cycles.length
  const tokens = exec.usage
  return { calls, tokens, stub_calls: stub ? calls : 0 }
}

export interface ReportInput {
  round: number
  registry: Registry
  understand: readonly { usage: TokenUsage; stub: boolean }[]
  acceptance: readonly { usage: TokenUsage; stub: boolean }[]
  execution: ExecutionRecord
  executorIsStub: boolean
  interrupted: { attempts: number; understand: readonly { usage: TokenUsage; stub: boolean }[]; acceptance: readonly { usage: TokenUsage; stub: boolean }[]; coding: StageCost }
  workorder: WorkOrder
  statuses: readonly ObjectStatus[]
  checks: RoundReport["checks"]
  wall?: RoundReport["wall"]
  summary?: AcceptanceSummary
  ledger?: LedgerSummary
  probes?: null | {
    calls: readonly { usage: TokenUsage; stub: boolean; usage_unknown?: boolean; model?: string }[]
    judge_calls: readonly { usage: TokenUsage; stub: boolean; usage_unknown?: boolean; model?: string }[]
    record: ProbeRoundRecord | null
    active: number
    findings: readonly Finding[]
    carried_in: number
  }
}

const allTokens = (u: TokenUsage) => u.input_tokens + u.cache_read_tokens + u.cache_write_tokens + u.output_tokens
const uncached = (u: TokenUsage) => u.input_tokens + u.cache_write_tokens + u.output_tokens
const ratio = (a: number, b: number) => b > 0 ? Math.round(a / b * 1000) / 1000 : null

export function buildReport(i: ReportInput): RoundReport {
  const name = (id: string) => i.registry.objects.get(id)?.name ?? id
  const inTask = new Set(i.workorder.task.map(t => t.object))
  const loss: RoundReport["loss"] = { boundary: [], ic: [], executor: [] }
  for (const s of i.statuses) {
    if (s.status === "landed") continue
    if (s.status === "not_landed") (inTask.has(s.object) ? loss.executor : loss.ic).push(s.object)
    else if (s.reasons.some(r => r === "suspect_input" || r === "timeout")) loss.ic.push(s.object)
    else loss.boundary.push(s.object)
  }
  const e = i.execution
  return {
    round: i.round,
    official_score: null,
    status: "done",
    stages: { understand: stageCost(i.understand), acceptance: stageCost(i.acceptance), coding: codingCost(e, i.executorIsStub) },
    interrupted: { attempts: i.interrupted.attempts, stages: { understand: stageCost(i.interrupted.understand), acceptance: stageCost(i.interrupted.acceptance), coding: i.interrupted.coding } },
    scope: i.registry.roundScope(i.round).map(c => c.object),
    zones: { task: i.workorder.task.length, protect: i.workorder.protect.length, status: i.workorder.status.length, source_blocks: i.workorder.source.reduce((n, g) => n + g.blocks.length, 0), anchors: i.workorder.anchors.reduce((n, a) => n + a.anchors.length, 0) },
    execution: {
      status: e.status, cycles: e.cycles.length, repairs: e.cycles.filter(c => c.message === "repair").length, kept: e.kept,
      failing_at_end: e.cycles.find(c => c.id === e.kept)?.failing.length ?? 0, contests: e.cycles.reduce((n, c) => n + c.contests.length, 0),
      carried_objects: e.carried, sessions: e.sessions.length, broken_sessions: e.sessions.filter(s => s.closed === "broken").length,
    },
    checks: i.checks,
    probes: i.probes ? (() => {
      const p = i.probes!, writer = stageCost(p.calls), judge = stageCost(p.judge_calls), coding = codingCost(e, i.executorIsStub).tokens
      const kept = e.cycles.find(c => c.id === e.kept)
      return {
        writer, judge, models: { writer: [...new Set(p.calls.flatMap(c => c.model ? [c.model] : []))], judge: [...new Set(p.judge_calls.flatMap(c => c.model ? [c.model] : []))] },
        share: { all: ratio(allTokens(writer.tokens) + allTokens(judge.tokens), allTokens(coding)), uncached: ratio(uncached(writer.tokens) + uncached(judge.tokens), uncached(coding)) },
        active: p.active, written: p.record?.entered.length ?? 0, stale: p.record?.stale.length ?? 0, units: p.record?.units.length ?? 0, uncovered: p.record?.uncovered ?? [], dropped: p.record?.dropped.length ?? 0,
        carried_in: p.carried_in, open_at_end: p.findings.filter(f => f.verdict === "wrong").map(f => pairKey(f.probe, f.unit)),
        ambiguous_at_end: p.findings.filter(f => f.verdict === "ambiguous").map(f => pairKey(f.probe, f.unit)), broke: kept?.broke ?? [],
        cases: p.record?.cases ?? null, discrimination: e.cycles.find(c => c.measure)?.measure ?? null,
        runs_by_cycle: e.cycles.filter(c => c.probe_runs).map(c => ({ cycle: c.id, ...c.probe_runs!, ...(c.sweep ? { sweep: c.sweep } : {}) })),
        cache: { writer: cacheShare(writer.tokens), judge: cacheShare(judge.tokens) },
        gaps: { carried_in: p.record?.gaps_in ?? [], open: [...(p.record?.uncovered ?? []), ...(p.record?.cases?.open ?? [])] },
      }
    })() : null,
    objects: i.statuses.map(s => ({ object: s.object, name: name(s.object), status: s.status, reasons: s.reasons, passing_strong: s.passing_strong, not_landed: s.not_landed, unknown: s.unknown })),
    loss,
    management_calls: i.understand.length + i.acceptance.length,
    ...(i.wall ? { wall: i.wall } : {}),
    ...(i.summary ? { acceptance: i.summary } : {}),
    ...(i.ledger ? { ledger: i.ledger } : {}),
    ...(e.sweep || e.cycles.some(c => c.sweep) ? { selection: { sweep: e.sweep ?? null, omissions: dedupe([...e.cycles.flatMap(c => c.sweep?.omissions ?? []), ...(e.sweep && !e.cycles.some(c => c.sweep === e.sweep) ? e.sweep.omissions : [])]) } } : {}),
  }
}

const dedupe = (list: { id: string; since: string }[]) => [...new Map(list.map(x => [x.id, x])).values()]
/** Cache reads over everything read as input (DESIGN §12h E5); null with nothing read. */
const cacheShare = (u: TokenUsage) => ratio(u.cache_read_tokens, u.input_tokens + u.cache_read_tokens)

const tok = (u: TokenUsage) => `in ${u.input_tokens}, cache read ${u.cache_read_tokens}, out ${u.output_tokens}`
const reasons = (m: Partial<Record<string, number>>) => { const e = Object.entries(m).filter(([, n]) => n); return e.length ? `${e.reduce((t, [, n]) => t + n!, 0)} (${e.map(([k, n]) => `${k} ${n}`).join(", ")})` : "0" }
const tallyBy = (list: string[]) => [...list.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].map(([k, n]) => `${k} ${n}`).join(", ")

export function renderReport(r: RoundReport): string {
  const line = (label: string, c: StageCost) => `| ${label} | ${c.calls} | ${tok(c.tokens)}${c.unknown_usage_calls ? ` (+ ${c.unknown_usage_calls} calls unknown)` : ""} | ${c.stub_calls} |`
  const count = (s: RoundReport["objects"][number]["status"]) => r.objects.filter(o => o.status === s).length
  return [
    `# Round ${r.round} report`,
    "",
    `Official score: ${r.official_score ? `${r.official_score.passed}/${r.official_score.total}` : "(scored locally; empty offline)"}`,
    "",
    "| Stage | Calls | Tokens | Stand-in calls |",
    "|---|---|---|---|",
    line("understanding (attribution)", r.stages.understand),
    line("acceptance (checks)", r.stages.acceptance),
    line("coding", r.stages.coding),
    line("interrupted attempts: understanding", r.interrupted.stages.understand),
    line("interrupted attempts: acceptance", r.interrupted.stages.acceptance),
    line("interrupted attempts: coding", r.interrupted.stages.coding),
    "",
    `Scope: ${r.scope.length} objects. Zones: task ${r.zones.task}, protection ${r.zones.protect}, status ${r.zones.status}, source blocks ${r.zones.source_blocks}, anchors ${r.zones.anchors}.`,
    `Execution: ${r.execution.status}; ${r.execution.cycles} cycles (${r.execution.repairs} repairs), kept ${r.execution.kept ?? "none"} with ${r.execution.failing_at_end} failing; ${r.execution.contests} contests; carried ${r.execution.carried_objects.length}; sessions ${r.execution.sessions} (${r.execution.broken_sessions} broken).`,
    ...(r.probes ? [
      `Probes: ${r.probes.written} written for ${r.probes.units} units (${r.probes.uncovered.length} not exercised, ${r.probes.dropped} dropped), ${r.probes.stale} stale, ${r.probes.active} active. Carried in ${r.probes.carried_in}; open at the end ${r.probes.open_at_end.length}; ambiguous ${r.probes.ambiguous_at_end.length}; broke ${r.probes.broke.length}.`,
      `Runs per cycle (in batches): ${r.probes.runs_by_cycle.map(c => `${c.cycle} checks ${c.checks}, probes ${c.probes}: judged ${c.judged} (output changed), cached ${c.cached}, by code ${c.by_code}${c.selected ? `; selected checks ${reasons(c.selected.checks)}, probes ${reasons(c.selected.probes)}${c.selected.all ? ` (everything: ${c.selected.all})` : `, ${c.selected.changed_functions} changed functions`}` : ""}${c.sweep ? `; full run: checks ${c.sweep.checks}, probes ${c.sweep.probes}, judged ${c.sweep.judged}, cached ${c.sweep.cached}, by code ${c.sweep.by_code}, found ${c.sweep.found.length}, omissions ${c.sweep.omissions.length}` : ""}`).join("; ") || "none"}.`,
      ...(r.probes.cache ? [`Cache reads of input: writer ${r.probes.cache.writer ?? "n/a"}, judge ${r.probes.cache.judge ?? "n/a"}.`] : []),
      `Cases: ${r.probes.cases ? `${r.probes.cases.covered}/${r.probes.cases.total} reached, ${r.probes.cases.excused} uncheckable, ${r.probes.cases.open.length} open` : "n/a"}. Discrimination: ${r.probes.discrimination ? `${r.probes.discrimination.killed} of ${r.probes.discrimination.killed + r.probes.discrimination.survived} mutants told apart (${r.probes.discrimination.build_failed} did not build); weak units ${r.probes.discrimination.weak_units.length}, probes added ${r.probes.discrimination.strengthened.length}, still not told apart ${r.probes.discrimination.still_weak}` : "not run"}.`,
      `Probe writer (${r.probes.models.writer.join(", ") || "?"}): ${r.probes.writer.calls} calls, ${tok(r.probes.writer.tokens)}. Judge (${r.probes.models.judge.join(", ") || "?"}): ${r.probes.judge.calls} calls, ${tok(r.probes.judge.tokens)}. Share of coding tokens: ${r.probes.share.all ?? "n/a"} (uncached ${r.probes.share.uncached ?? "n/a"}).`,
    ] : []),
    ...(r.wall ? [`Wall time ${(r.wall.round_ms / 1000).toFixed(0)} s. ${r.wall.stages.map(x => `${x.stage} ${(x.ms / 1000).toFixed(1)} s (${x.spans}×, ${(x.first_start_ms / 1000).toFixed(0)}–${(x.last_end_ms / 1000).toFixed(0)} s)`).join("; ")}.`] : []),
    ...(r.acceptance ? [
      `Determinations on the final program: ${r.acceptance.by_kind.A} stated values (A), ${r.acceptance.by_kind.B} by a reference (B), ${r.acceptance.by_kind.C} by judgment (C), all A and B compared by code.`,
      `Open: program wrong ${r.acceptance.open.program_wrong.length}, uncovered ${r.acceptance.open.uncovered.length}, reference disagreement pending ${r.acceptance.open.reference_pending.length}, ambiguous ${r.acceptance.open.ambiguous.length}; closed as uncheckable ${r.acceptance.open.uncheckable.length}${r.acceptance.open.uncheckable.length ? ` (${r.acceptance.open.uncheckable.map(u => u.unit).join(", ")})` : ""}.`,
    ] : []),
    ...(r.selection ? [`Selection: full run before delivery on ${r.selection.sweep?.cycle ?? "none"}${r.selection.sweep ? ` (checks ${r.selection.sweep.checks}, probes ${r.selection.sweep.probes}, found ${r.selection.sweep.found.length})` : ""}; selection omissions ${r.selection.omissions.length}${r.selection.omissions.length ? ` (${r.selection.omissions.map(o => `${o.id} since ${o.since}`).join(", ")})` : ""}.`] : []),
    ...(r.ledger ? [`Ledger: open program wrong ${r.ledger.open.program_wrong.length}, uncovered ${r.ledger.open.uncovered.length}, reference pending ${r.ledger.open.reference_pending.length}; listed only ${r.ledger.report_only.length}${r.ledger.report_only.length ? ` (${tallyBy(r.ledger.report_only.map(x => x.how))})` : ""}; ended this round ${r.ledger.ended.length}${r.ledger.ended.length ? ` (${tallyBy(r.ledger.ended.map(x => x.how))})` : ""}; sent ${r.ledger.sends} times; held ${r.ledger.held.length}.`] : []),
    `Checks: ${r.checks.entered} entered, ${r.checks.stale} stale, ${r.checks.retired} retired; ${r.checks.run} run, ${r.checks.passed} passed, ${r.checks.failed} failed.`,
    `Objects: ${count("landed")} landed, ${count("not_landed")} not landed, ${count("unknown")} unknown.`,
    "",
    "| Object | Status | Basis |",
    "|---|---|---|",
    ...r.objects.map(o => `| ${o.object} ${o.name} | ${o.status} | ${o.status === "landed" ? `strong pass ${o.passing_strong.join(", ")}` : o.status === "not_landed" ? `not landed ${o.not_landed.join(", ")}` : o.reasons.join(", ")}${o.unknown.length ? `; suspect ${o.unknown.join(", ")}` : ""} |`),
    "",
    `Loss attribution: no checkable expectation ${r.loss.boundary.length}; IC's own ${r.loss.ic.length} (${r.loss.ic.join(", ")}); executor ${r.loss.executor.length} (${r.loss.executor.join(", ")}).`,
    "",
  ].join("\n")
}
