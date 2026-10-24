import type { TokenUsage } from "./attribution.js"
import type { ExecutionRecord } from "./execution.js"
import type { Registry } from "./registry.js"
import type { CheckEvent, CheckRecord } from "./checks.js"
import type { CheckRun, ObjectStatus } from "./verdict.js"
import type { WorkOrder } from "./workorder.js"
import { pairKey, type Finding } from "./judge.js"
import type { SweepRecord } from "./execution.js"
import type { LedgerEntry, LedgerSummary } from "./ledger.js"
import type { AcceptRoundRecord } from "./execution.js"
import { relationRecall, renderRecall, revisionRecall as goldRevisionRecall, type GoldSets, type RecallLine } from "./gold.js"
import type { PackageOverflow } from "./view.js"

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
  /** source_scope, source_chars, source_chars_all: the source zone's kind and size, and the size every round's text would have (§12j.7 item 9). */
  zones: { task: number; protect: number; status: number; source_blocks: number; anchors: number; source_scope?: "delta" | "all"; source_chars?: number; source_chars_all?: number; source_blocks_all?: number; package?: { segments: { object: string; paragraph: string; why: string; via: string[] }[]; heads: string[]; edges: { to_block: number; to_object: number }; sizes: Record<string, number>; guards: number; overflow: PackageOverflow | null } }
  /** Attribution against the gold sets (the chain block, effect 4), when the run names its task. */
  gold?: { task: string; revision: RecallLine; relation: RecallLine }
  /**
   * How well attribution records revisions (§12j.7 item 12): paragraphs of this round's text that read like a revision
   * (instead of, now, previously, no longer, …), those of them that are the new text of a recorded modification, and the
   * modifications recorded this round. The ids of cue paragraphs with no modification are listed.
   */
  revisions?: { cue_paragraphs: number; recorded: number; modifications: number; unrecorded: string[] }
  execution: { status: ExecutionRecord["status"]; cycles: number; repairs: number; kept: string | null; failing_at_end: number; contests: number; carried_objects: string[]; sessions: number; broken_sessions: number }
  checks: {
    entered: number; stale: number; retired: number; run: number; passed: number; failed: number
    /** Batch C, effect 1: admitted of those entered, entered unknown (their reasons went back to the model), dropped after the repairs by issue code, shapes code read the one way they could mean. */
    admitted?: number; unknown?: number; unknown_not_fed_back?: number; dropped?: Record<string, number>; normalized?: Record<string, number>
    /** Batch C, effect 2: runs the program refused as it refuses an unknown subcommand, kept from passing. */
    refused_calls?: number
    /** §12j.7 item 3: units of this round's text with a value or rule no check rests on (reported, not sent back). */
    uncovered?: number
  }
  /**
   * Probes and judge (BLOCK10), null when off. share: their tokens over the round's coding tokens, all tokens
   * (input, cache, output) and without cache reads. Models as the calls report them.
   */
  /** Probes and judge are out of the round's path (§12j.4); older reports have them. */
  probes?: null | {
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
  /** The round under the review acceptance (DESIGN §12i): reviews, premises, guards, reverts, coverage, the roles' cost. */
  review?: ReviewReport
  /** The first delivery's official score, scored locally like the round's (DESIGN §12i); never read by the system. */
  first_delivery_score?: null | { passed: number; total: number }
  /** What §12i asks to report beside the decision, in one place (fix block B4); review mode only. */
  measures?: RoundMeasures
}

/** Tokens of one role: uncached input, cache reads, output (cache writes, when a provider reports them, apart). */
export interface RoleTokens { calls: number; uncached_input: number; cache_read: number; output: number; cache_write: number }

/**
 * The §12i measures of a round (fix block B4). cost is the preregistered unit: uncached input + 0.1 × cache read +
 * output, summed over the roles other than the executor (attempts interrupted and rerun included).
 */
export interface RoundMeasures {
  round: number
  wall_ms: number
  stages_ms: Record<string, number>
  first_delivery: { cycle: string; commit: string } | null
  guards: { at_start: number; at_end: number; born: number }
  /** Guards that passed and fail now (§12i "退化次数"), on changed text and on unchanged text. */
  regressions: { changed_text: number; unchanged: number }
  reverted: number
  premise: { blocked: Record<string, number>; logged: Record<string, number> }
  fallback: { reviews: number; whole: number; items: number; reasons: Record<string, number> }
  reviews: number
  program_runs_zero: number
  /** Batch C: the round's check writing (admitted of entered, unknown never told) and the reviewer's entries (reported, entered, conservation errors). */
  checks?: { entered: number; admitted: number; unknown_not_fed_back: number; dropped: number; refused_calls: number }
  items?: { reported: number; entered: number; verified: number; logged: number; fallback: number; blocked: number; no_input: number; conservation_errors: number }
  tokens: Record<"executor" | "attribution" | "checks" | "reviewer" | "formalizer" | "interrupted_management", RoleTokens>
  /** §12j.7 items 6, 9: the source zone's characters (and every round's text's), and the review requests' characters. */
  sources?: { workorder_scope: "delta" | "all"; workorder_chars: number; workorder_chars_all: number; review_chars: number }
  non_executor_cost: number
}

export interface ReviewReport {
  first_delivery: { cycle: string; commit: string } | null
  reviews: AcceptRoundRecord["reviews"]
  voided: number
  reviewer: StageCost
  formalizer: StageCost
  models: { reviewer: string[]; formalizer: string[] }
  /** Reviewer's items over the round, and how many entered a repair list. */
  items: { reported: number; sent: number; malformed: number; verified: number; logged: number; fallback: number; blocked: number }
  /** Batch C, effect 4: reviews whose entries did not each end once. */
  conservation_errors: string[]
  premise_blocked: Record<string, number>
  /** Fix block A1–A3: items sent although a premise outside the blocking tier failed; the fallback; reviews with no run seen. */
  premise_logged: Record<string, number>
  fallback: { reviews: number; whole: number; items: number; reasons: Record<string, number> }
  program_runs_zero: number
  guards: AcceptRoundRecord["guards"]
  reverted: number
  trial: { runs: number; failures: number }
  leads: { library: number; judgment: number; dropped?: number }
  /** Live rule units, those a guard that ran rests on, and those none does (DESIGN §12i item 7). */
  coverage: { units: number; covered: number; uncovered: string[] } | null
  /** Cache reads over all input read, per role. */
  cache: { reviewer: number | null; formalizer: number | null }
  /** Characters of the round's review requests (§12j.7 item 6). */
  request_chars?: number
}

export interface AcceptanceSummary {
  by_kind: { A: number; B: number; C: number }
  open: {
    program_wrong: string[]; uncovered: string[]; reference_pending: string[]; ambiguous: string[]
    /** Closed by code: left unexercised by two writings in a row. Reported, no longer written for. */
    uncheckable: { unit: string; reason: string }[]
    /** Listed only: open at the end of rounds in a row with no progress, no ruling confirming them (DESIGN §12h E3). */
    expired?: string[]
    /** Program wrong, confirmed by a ruling: sent once a round until fixed, superseded or ruled otherwise. */
    confirmed?: string[]
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
      confirmed: entries.filter(e => e.state === "open" && e.reason === "program_wrong" && e.confirmed).map(e => e.id),
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
  gold?: GoldSets
  review?: {
    accept: AcceptRoundRecord
    first_delivery: { cycle: string; commit: string } | null
    review_calls: readonly { usage: TokenUsage; stub: boolean; model?: string; request_chars?: number }[]
    formalize_calls: readonly { usage: TokenUsage; stub: boolean; usage_unknown?: boolean; model?: string }[]
    coverage: { units: number; covered: number; uncovered: string[] } | null
  }
}

const ratio = (a: number, b: number) => b > 0 ? Math.round(a / b * 1000) / 1000 : null

export function buildReport(i: ReportInput): RoundReport {
  const r = reportOf(i)
  const m = roundMeasures(r)
  return m ? { ...r, measures: m } : r
}

function reportOf(i: ReportInput): RoundReport {
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
    zones: { task: i.workorder.task.length, protect: i.workorder.protect.length, status: i.workorder.status.length, source_blocks: i.workorder.package ? i.workorder.scope?.blocks ?? 0 : i.workorder.source.reduce((n, g) => n + g.blocks.length, 0), anchors: i.workorder.anchors.reduce((n, a) => n + a.anchors.length, 0), ...(i.workorder.scope ? { source_scope: i.workorder.scope.kind, source_chars: i.workorder.scope.source_chars, source_chars_all: i.workorder.scope.source_chars_all, source_blocks_all: i.workorder.scope.blocks_all, ...(i.workorder.scope.segments ? { package: { segments: i.workorder.scope.segments, heads: i.workorder.scope.heads ?? [], edges: i.workorder.scope.edges ?? { to_block: 0, to_object: 0 }, sizes: i.workorder.scope.sizes ?? {}, guards: i.workorder.scope.guards ?? 0, overflow: i.workorder.scope.overflow ?? null } } : {}) } : {}) },
    revisions: revisionRecall(i.registry, i.round),
    ...(i.gold ? { gold: { task: i.gold.task, revision: goldRevisionRecall(i.registry, i.round, i.gold), relation: relationRecall(i.registry, i.round, i.gold) } } : {}),
    execution: {
      status: e.status, cycles: e.cycles.length, repairs: e.cycles.filter(c => c.message === "repair").length, kept: e.kept,
      failing_at_end: e.cycles.find(c => c.id === e.kept)?.failing.length ?? 0, contests: e.cycles.reduce((n, c) => n + c.contests.length, 0),
      carried_objects: e.carried, sessions: e.sessions.length, broken_sessions: e.sessions.filter(s => s.closed === "broken").length,
    },
    checks: i.checks,
    objects: i.statuses.map(s => ({ object: s.object, name: name(s.object), status: s.status, reasons: s.reasons, passing_strong: s.passing_strong, not_landed: s.not_landed, unknown: s.unknown })),
    loss,
    management_calls: i.understand.length + i.acceptance.length,
    ...(i.wall ? { wall: i.wall } : {}),
    ...(i.summary ? { acceptance: i.summary } : {}),
    ...(i.ledger ? { ledger: i.ledger } : {}),
    ...(i.review ? { review: reviewReport(i.review) } : {}),
    ...(e.sweep || e.cycles.some(c => c.sweep) ? { selection: { sweep: e.sweep ?? null, omissions: dedupe([...e.cycles.flatMap(c => c.sweep?.omissions ?? []), ...(e.sweep && !e.cycles.some(c => c.sweep === e.sweep) ? e.sweep.omissions : [])]) } } : {}),
  }
}

const roleTokens = (c: StageCost): RoleTokens => ({ calls: c.calls, uncached_input: c.tokens.input_tokens, cache_read: c.tokens.cache_read_tokens, output: c.tokens.output_tokens, cache_write: c.tokens.cache_write_tokens })
export const costOf = (t: RoleTokens) => t.uncached_input + 0.1 * t.cache_read + t.output

/** The §12i measures from a round's report (fix block B4). */
export function roundMeasures(r: RoundReport): RoundMeasures | null {
  const v = r.review
  if (!v) return null
  const plus = (a: StageCost, b: StageCost): StageCost => ({ calls: a.calls + b.calls, tokens: addUsage(a.tokens, b.tokens), stub_calls: a.stub_calls + b.stub_calls })
  const tokens: RoundMeasures["tokens"] = {
    executor: roleTokens(plus(r.stages.coding, r.interrupted.stages.coding)),
    attribution: roleTokens(r.stages.understand), checks: roleTokens(r.stages.acceptance),
    reviewer: roleTokens(v.reviewer), formalizer: roleTokens(v.formalizer),
    interrupted_management: roleTokens(plus(r.interrupted.stages.understand, r.interrupted.stages.acceptance)),
  }
  return {
    round: r.round, wall_ms: r.wall?.round_ms ?? 0, stages_ms: Object.fromEntries((r.wall?.stages ?? []).map(x => [x.stage, x.ms])),
    first_delivery: v.first_delivery,
    guards: { at_start: v.guards.at_start, at_end: v.guards.at_end, born: v.guards.born.length },
    regressions: { changed_text: v.guards.flipped_changed_text.length, unchanged: v.guards.flipped_unchanged.length },
    reverted: v.reverted, premise: { blocked: v.premise_blocked, logged: v.premise_logged }, fallback: v.fallback, reviews: v.reviews.length, program_runs_zero: v.program_runs_zero,
    checks: { entered: r.checks.entered, admitted: r.checks.admitted ?? 0, unknown_not_fed_back: r.checks.unknown_not_fed_back ?? 0, dropped: Object.values(r.checks.dropped ?? {}).reduce((a, b) => a + b, 0), refused_calls: r.checks.refused_calls ?? 0 },
    items: { reported: v.items.reported, entered: v.items.sent, verified: v.items.verified, logged: v.items.logged, fallback: v.items.fallback, blocked: v.items.blocked, no_input: (v.premise_blocked.no_input ?? 0) + (v.fallback.reasons.no_input ?? 0), conservation_errors: v.conservation_errors.length },
    ...(r.zones.source_scope ? { sources: { workorder_scope: r.zones.source_scope, workorder_chars: r.zones.source_chars ?? 0, workorder_chars_all: r.zones.source_chars_all ?? 0, review_chars: v.request_chars ?? 0 } } : {}),
    tokens, non_executor_cost: Math.round(Object.entries(tokens).filter(([k]) => k !== "executor").reduce((n, [, t]) => n + costOf(t), 0)),
  }
}

function reviewReport(r: NonNullable<ReportInput["review"]>): ReviewReport {
  const reviewer = stageCost(r.review_calls), formalizer = stageCost(r.formalize_calls)
  const a = r.accept
  return {
    first_delivery: r.first_delivery, reviews: a.reviews, voided: a.voided, reviewer, formalizer,
    models: { reviewer: [...new Set(r.review_calls.flatMap(c => c.model ? [c.model] : []))], formalizer: [...new Set(r.formalize_calls.flatMap(c => c.model ? [c.model] : []))] },
    items: {
      reported: a.reviews.reduce((n, x) => n + x.reported, 0), sent: a.reviews.reduce((n, x) => n + x.sent, 0), malformed: a.reviews.reduce((n, x) => n + x.malformed, 0),
      verified: a.reviews.reduce((n, x) => n + (x.conservation?.sent ?? 0), 0), logged: a.reviews.reduce((n, x) => n + (x.conservation?.logged ?? 0), 0), fallback: a.reviews.reduce((n, x) => n + (x.conservation?.fallback ?? 0), 0), blocked: a.reviews.reduce((n, x) => n + x.blocked, 0),
    },
    conservation_errors: a.conservation_errors ?? [],
    premise_blocked: a.premise_blocked, premise_logged: a.premise_logged ?? {}, fallback: a.fallback ?? { reviews: 0, whole: 0, items: 0, reasons: {} }, program_runs_zero: a.program_runs_zero ?? 0, guards: a.guards, reverted: a.reverted, trial: a.trial, leads: a.leads, coverage: r.coverage,
    cache: { reviewer: cacheShare(reviewer.tokens), formalizer: cacheShare(formalizer.tokens) },
    request_chars: r.review_calls.reduce((n, c) => n + (c.request_chars ?? 0), 0),
  }
}

/** Words that mark a paragraph as revising earlier text (§12j.7 item 12); a cue, not a decision. */
const REVISION_CUE = /\b(?:instead of|previously|no longer|now|formerly|rather than|replac(?:e|es|ed|ing)|changed?)\b/iu

/** The revision-recall measure of a round (§12j.7 item 12), from the registry. */
export function revisionRecall(registry: Registry, round: number): NonNullable<RoundReport["revisions"]> {
  const source = registry.sources.get(round)
  if (!source) return { cue_paragraphs: 0, recorded: 0, modifications: 0, unrecorded: [] }
  const mods = [...registry.objects.values()].flatMap(o => o.blocks.flatMap(b => b.modifications.filter(m => m.round === round)))
  const newUnits = mods.flatMap(m => m.by)
  const within = (inner: string, outer: string) => registry.lineage(inner).some(b => b.id === outer)
  const cues = source.blocks.filter(b => b.level === "paragraph" && REVISION_CUE.test(b.text))
  const recorded = cues.filter(p => newUnits.some(u => within(u, p.id) || within(p.id, u)))
  return { cue_paragraphs: cues.length, recorded: recorded.length, modifications: mods.length, unrecorded: cues.filter(p => !recorded.includes(p)).map(p => p.id) }
}

const dedupe = (list: { id: string; since: string }[]) => [...new Map(list.map(x => [x.id, x])).values()]
/** Cache reads over everything read as input (DESIGN §12h E5); null with nothing read. */
const cacheShare = (u: TokenUsage) => ratio(u.cache_read_tokens, u.input_tokens + u.cache_read_tokens)


function renderMeasures(m: RoundMeasures): string {
  const t = (k: keyof RoundMeasures["tokens"]) => `${k} ${m.tokens[k].uncached_input}/${m.tokens[k].cache_read}/${m.tokens[k].output}`
  return `§12i measures: wall ${(m.wall_ms / 1000).toFixed(0)} s; guards ${m.guards.at_start}→${m.guards.at_end}; regressions ${m.regressions.changed_text + m.regressions.unchanged} (changed text ${m.regressions.changed_text}, unchanged ${m.regressions.unchanged}); reverted ${m.reverted}; fallback reviews ${m.fallback.reviews} (items ${m.fallback.items}); no program run seen ${m.program_runs_zero}; tokens uncached/cache read/out: ${(["executor", "attribution", "checks", "reviewer", "formalizer", "interrupted_management"] as const).map(t).join(", ")}; non-executor cost ${m.non_executor_cost} (uncached + 0.1 × cache read + out).`
}

/**
 * The report's line on guard flips (§6b): each flip, how it was classified and by which records (a flip several records
 * name counts under each), and where its expected values come from.
 */
export function renderFlips(flips: NonNullable<AcceptRoundRecord["guards"]["flips"]>): string {
  const n = (k: string) => flips.filter(f => k === "none" ? !f.sources.length : f.sources.includes(k)).length
  return `- Flip classification (source: revision record / object change / relation edge / none): revision ${n("revision")}, object ${n("object")}, edge ${n("edge")}, none ${n("none")}; ${flips.map(f => `${f.id} ${f.cycle} ${f.how === "changed_text" ? "changed text" : "regression"} (${f.sources.length ? f.sources.join(", ") : "none"}; expected ${f.expected.join("/") || "none"})`).join(", ")}.`
}

/**
 * The round report as text (§12j.4): the line §12i registered in advance, and the interface counts. Everything else
 * (stages, zones, objects, ledger, wall times by stage, …) is in report.json.
 */
export function renderReport(r: RoundReport): string {
  const v = r.review
  const by = (m: Record<string, number>) => Object.entries(m).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ") || "none"
  const sum = (m: Record<string, number> | undefined) => Object.values(m ?? {}).reduce((a, b) => a + b, 0)
  const ids = (list: readonly string[]) => list.length ? ` (${list.join(", ")})` : ""
  const lines = [
    `# Round ${r.round} report`,
    "",
    `Official score: ${r.official_score ? `${r.official_score.passed}/${r.official_score.total}` : "(scored locally; empty offline)"}${r.first_delivery_score ? `; first delivery ${r.first_delivery_score.passed}/${r.first_delivery_score.total}` : ""}`,
    "",
    ...(r.measures ? [renderMeasures(r.measures), ""] : []),
    "Interface counts:",
    "",
    ...(v ? [
      `- Reviewer items: reported ${v.items.reported}, entered a repair list ${v.items.sent} (verified ${v.items.verified}, logged ${v.items.logged}, fallback ${v.items.fallback}), blocked ${v.items.blocked}; every entry ended once: ${v.conservation_errors.length ? "no" : "yes"}; no_input ${r.measures?.items?.no_input ?? 0}; reviews ${v.reviews.length} (void sessions ${v.voided}); blocked by ${by(v.premise_blocked)}.`,
      ...(v.conservation_errors.length ? [`- Conservation broken: ${v.conservation_errors.join("; ")}.`] : []),
    ] : []),
    `- Check writing: admitted ${r.checks.admitted ?? r.checks.entered}/${r.checks.entered}, unknown never told the model ${r.checks.unknown_not_fed_back ?? 0}; dropped after the repairs ${sum(r.checks.dropped)} (${by(r.checks.dropped ?? {})}); runs refused as an unknown subcommand ${r.checks.refused_calls ?? 0}; units no check rests on ${r.checks.uncovered ?? 0} (reported only).`,
    ...(v ? [`- Guards: ${v.guards.at_start} at the start, ${v.guards.at_end} at the end, new ${v.guards.born.length}; flips on changed text ${v.guards.flipped_changed_text.length}${ids(v.guards.flipped_changed_text)}, on unchanged text ${v.guards.flipped_unchanged.length}${ids(v.guards.flipped_unchanged)}; retired as superseded ${v.guards.retired.length}${ids(v.guards.retired.map(x => x.id))}; repairs reverted ${v.reverted}.`] : []),
    ...(v?.guards.flips?.length ? [renderFlips(v.guards.flips)] : []),
    ...(r.zones.source_scope ? [`- Requirements given: work order source zone ${r.zones.source_scope}, ${r.zones.source_chars} characters${r.zones.package ? ` in ${r.zones.package.segments.length} paragraphs of ${new Set(r.zones.package.segments.map(x => x.object)).size} objects (${segmentCounts(r.zones.package)}), ${r.zones.package.heads.length} object heads; this round's edges to a block ${r.zones.package.edges.to_block}, to an object ${r.zones.package.edges.to_object}; ${r.zones.package.guards} comparisons (guards on revised units)${r.zones.package.overflow ? `; over the budget of ${r.zones.package.overflow.limit} (${r.zones.package.overflow.chars}): dropped ${r.zones.package.overflow.dropped.length} paragraphs${r.zones.package.overflow.still_over ? ", still over" : ""}` : ""}` : ` in ${r.zones.source_blocks} blocks`} (every round's text: ${r.zones.source_chars_all} in ${r.zones.source_blocks_all} blocks)${v ? `; review requests ${v.request_chars ?? 0} characters in ${v.reviewer.calls} sessions${v.leads.dropped ? `, ${v.leads.dropped} leads past the cap of 20` : ""}` : ""}.`] : []),
    r.gold ? renderRecall(`Revision recall (gold set ${r.gold.task})`, r.gold.revision) : "- Revision recall: no gold set for this task.",
    r.gold ? renderRecall(`Relation recall (gold set ${r.gold.task})`, r.gold.relation) : "- Relation recall: no gold set for this task.",
    "",
    "Everything else is in report.json.",
    "",
  ]
  return lines.join("\n")
}

const segmentCounts = (p: { segments: readonly { why: string }[]; sizes: Record<string, number> }) => ["this round", "revised", "edge", "open item"].map(w => `${w} ${p.segments.filter(x => x.why === w).length} (${p.sizes[w] ?? 0} characters)`).join(", ")
