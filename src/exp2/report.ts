import type { TokenUsage } from "./attribution.js"
import type { ExecutionRecord } from "./execution.js"
import type { Registry } from "./registry.js"
import type { ObjectStatus } from "./verdict.js"
import type { WorkOrder } from "./workorder.js"
import type { ProbeRoundRecord } from "./probes.js"
import { pairKey, type Finding } from "./judge.js"

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
  /** Calls into the management stages (attribution, checks) this round, by stage, for the per-round budget. */
  management_calls: number
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
      }
    })() : null,
    objects: i.statuses.map(s => ({ object: s.object, name: name(s.object), status: s.status, reasons: s.reasons, passing_strong: s.passing_strong, not_landed: s.not_landed, unknown: s.unknown })),
    loss,
    management_calls: i.understand.length + i.acceptance.length,
  }
}

const tok = (u: TokenUsage) => `in ${u.input_tokens}, cache read ${u.cache_read_tokens}, out ${u.output_tokens}`

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
      `Cases: ${r.probes.cases ? `${r.probes.cases.covered}/${r.probes.cases.total} reached, ${r.probes.cases.excused} uncheckable, ${r.probes.cases.open.length} open` : "n/a"}. Discrimination: ${r.probes.discrimination ? `${r.probes.discrimination.killed} of ${r.probes.discrimination.killed + r.probes.discrimination.survived} mutants told apart (${r.probes.discrimination.build_failed} did not build); weak units ${r.probes.discrimination.weak_units.length}, probes added ${r.probes.discrimination.strengthened.length}, still not told apart ${r.probes.discrimination.still_weak}` : "not run"}.`,
      `Probe writer (${r.probes.models.writer.join(", ") || "?"}): ${r.probes.writer.calls} calls, ${tok(r.probes.writer.tokens)}. Judge (${r.probes.models.judge.join(", ") || "?"}): ${r.probes.judge.calls} calls, ${tok(r.probes.judge.tokens)}. Share of coding tokens: ${r.probes.share.all ?? "n/a"} (uncached ${r.probes.share.uncached ?? "n/a"}).`,
    ] : []),
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
