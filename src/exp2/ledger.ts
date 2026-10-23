import { contestsIn, type ExecutionRecord, type ItemSighting } from "./execution.js"
import { libraryCovers, type CheckEvent, type CheckRecord } from "./checks.js"
import { gapState, type ProbeEvent, type ProbeRecord, type ProbeRoundRecord } from "./probes.js"
import type { Registry } from "./registry.js"
import { pairKey, type Judgment } from "./judge.js"
import type { Ruling } from "./adjudication.js"

/**
 * The ledger (DESIGN §12h E2): every open item of the acceptance in one place, with one id, on the text it rests on.
 * Code folds it from what the state already records (each cycle's sightings of the items, the rulings, the round's
 * end, stale and retire events, the coverage gaps); no model is asked anything. The report shows a projection of it.
 *
 * Ids: a probe item is probe/unit (P12/R1.S2.P6.s2), a library check item its check id (K5), an uncovered unit (or
 * case) its own id.
 */

/** premise_failed: a reviewer's item a premise stopped before it was sent (DESIGN §12i item 2). */
export type LedgerReason = "program_wrong" | "uncovered" | "reference_pending" | "ambiguous" | "premise_failed"
/** blocked: a premise did not hold; discarded: the repair it was sent in was reverted (DESIGN §12i items 2, 4). */
export type LedgerEnd = "fixed" | "superseded" | "ruled_program_right" | "ruled_ambiguous" | "expired" | "uncheckable" | "blocked" | "discarded"

export interface LedgerEntry {
  id: string
  /** guard: a guard failing (G<n>); review: a reviewer's item (V<round>.<review>.<n>) (DESIGN §12i). */
  source: "probe" | "check" | "coverage" | "guard" | "review"
  /** The unit it rests on, and the case where the probe's cover names one; a check lists all its blocks. */
  unit: string
  case: string | null
  units: string[]
  reason: LedgerReason
  /** open: still worked on; report_only: listed, no longer sent (expired, ambiguous, uncheckable); closed: ended. */
  state: "open" | "report_only" | "closed"
  opened: { round: number; cycle: string | null }
  /** Where it was sent for repair: cycles, and `R<n> work order` when a work order carried it in. */
  sent: string[]
  /** Cycles that held it back: no progress after a ruling (DESIGN §12h E3). */
  held: string[]
  /** The executor's replies after it was sent: a CONTEST line on it, else the start of the reply. */
  replies: { cycle: string; text: string; contest: boolean }[]
  /** How its verdict went: each change, by whom. */
  verdicts: { round: number; cycle: string | null; verdict: string; by: "run" | "ruling" | "round end" }[]
  /** Rounds it was still open at the end of. */
  rounds: number[]
  /** The digest of its output when last seen (an item listed only stays so while this does not change). */
  digest: string | null
  /**
   * An independent ruling confirmed the item as the program's (a probe pair's ruled verdict wrong, a library check
   * upheld), and no later ruling changed that: from that round on it does not expire (it ends fixed, superseded, or by
   * a later ruling).
   */
  confirmed: null | { round: number }
  end: null | { round: number; how: LedgerEnd; detail: string }
}

/**
 * An item open at the end of this many rounds in a row with the same output, sent in between, is listed only, unless
 * a ruling confirmed it.
 */
export const EXPIRE_ROUNDS = 2

export interface LedgerInput {
  registry: Registry
  executions: readonly ExecutionRecord[]
  probes: readonly ProbeRecord[]
  probe_events: readonly ProbeEvent[]
  probe_rounds: readonly ProbeRoundRecord[]
  checks: readonly CheckRecord[]
  check_events: readonly CheckEvent[]
  /** The independent session's verdicts on probe pairs (judgments marked ruled), and the rulings on library checks. */
  judgments?: readonly Pick<Judgment, "probe" | "unit" | "verdict" | "round" | "ruled">[]
  rulings?: readonly Pick<Ruling, "check" | "verdict" | "round">[]
  /** Guards, for the units a guard item rests on, and their retirements (DESIGN §12i). */
  guards?: readonly { id: string; units: readonly string[] }[]
  guard_events?: readonly { guard: string; round: number; status: string; reason?: string }[]
}

const failingVerdict = (v: string) => v === "wrong" || v === "not_landed"

export function buildLedger(i: LedgerInput): LedgerEntry[] {
  const entries = new Map<string, LedgerEntry & { lastDigest?: string; ends: { round: number; digest: string }[] }>()
  const probeOf = new Map(i.probes.map(p => [p.id, p]))
  const checkOf = new Map(i.checks.map(c => [c.id, c]))
  const guardOf = new Map((i.guards ?? []).map(g => [g.id, g]))
  const reviewOf = new Map(i.executions.flatMap(x => x.review_items ?? []).map(r => [r.id, r]))
  const make = (id: string, round: number, cycle: string | null, reason: LedgerReason = "program_wrong") => {
    let e = entries.get(id)
    if (e) return e
    const [probe, unit] = id.includes("/") ? [id.split("/")[0], id.slice(id.indexOf("/") + 1)] : [null, null]
    const check = checkOf.get(id)
    const guard = /^G\d+$/u.test(id) ? guardOf.get(id) : undefined
    const review = /^V\d+\.\d+\.\d+$/u.test(id) ? reviewOf.get(id) : undefined
    const kase = probe ? probeOf.get(probe)?.covers.find(c => c.unit === unit)?.case ?? null : null
    const units = unit ? [unit] : check ? [...check.blocks] : guard ? [...guard.units] : review ? [...review.units] : [id.split("#")[0]]
    e = {
      id, source: probe ? "probe" : check ? "check" : guard || /^G\d+$/u.test(id) ? "guard" : review || /^V\d+\./u.test(id) ? "review" : "coverage", unit: units[0] ?? id, case: kase ?? (!probe && !check && !guard && !review && id.includes("#") ? id : null), units,
      reason, state: "open", opened: { round, cycle }, sent: [], held: [], replies: [], verdicts: [], rounds: [], digest: null, confirmed: null, end: null, ends: [],
    }
    entries.set(id, e)
    return e
  }
  const close = (e: LedgerEntry, round: number, how: LedgerEnd, detail: string) => {
    if (e.end) return
    e.end = { round, how, detail }
    e.state = how === "expired" || how === "ruled_ambiguous" || how === "uncheckable" || how === "blocked" || how === "discarded" ? "report_only" : "closed"
    if (how === "ruled_ambiguous") e.reason = "ambiguous"
    if (how === "blocked") e.reason = "premise_failed"
  }
  // An item that ended comes back when it fails again, unless the text it rested on was replaced, or it was listed
  // only for no progress and its output is still the same.
  const reopen = (e: LedgerEntry & { ends: { digest: string }[] }, digest: string) => {
    if (!e.end || e.end.how === "superseded" || e.end.how === "blocked" || (e.end.how === "expired" && e.ends.at(-1)?.digest === digest)) return
    e.end = null; e.state = "open"; e.reason = "program_wrong"
  }
  const note = (e: LedgerEntry, round: number, cycle: string | null, verdict: string, by: LedgerEntry["verdicts"][number]["by"]) => {
    if (e.verdicts.at(-1)?.verdict !== verdict || by === "ruling") e.verdicts.push({ round, cycle, verdict, by })
  }
  // The independent session's last word on an item up to a round: confirmed (the program's) or not.
  const rulingsOf = new Map<string, { round: number; confirms: boolean }[]>()
  const ruling = (id: string, round: number, confirms: boolean) => rulingsOf.set(id, [...(rulingsOf.get(id) ?? []), { round, confirms }])
  for (const j of i.judgments ?? []) if (j.ruled) ruling(pairKey(j.probe, j.unit), j.round, j.verdict === "wrong")
  for (const k of i.rulings ?? []) ruling(k.check, k.round, k.verdict === "check_right")
  const confirmedBy = (id: string, round: number) => { const last = (rulingsOf.get(id) ?? []).filter(x => x.round <= round).at(-1); return last?.confirms ? last : null }
  const rounds = [...i.executions].sort((a, b) => a.round - b.round)
  for (const x of rounds) {
    const r = x.round
    // Text replaced at the round's start: the items resting on it are superseded.
    for (const ev of i.probe_events.filter(v => v.round === r)) for (const e of entries.values()) if (e.source === "probe" && e.id.startsWith(`${ev.probe}/`) && !e.end) close(e, r, "superseded", ev.reason)
    for (const ev of i.check_events.filter(v => v.round === r && v.status === "stale")) { const e = entries.get(ev.check); if (e && !e.end) close(e, r, "superseded", ev.reason) }
    for (const ev of (i.guard_events ?? []).filter(v => v.round === r && v.status === "retired")) { const e = entries.get(ev.guard); if (e && !e.end) close(e, r, "superseded", ev.reason ?? "retired") }
    for (const c of x.carried_in ?? []) { const e = make(c.id, r, null); reopen(e, c.digest); e.sent.push(`R${r} work order`); e.lastDigest = c.digest }
    let sentBefore = new Set((x.carried_in ?? []).map(c => c.id))
    for (const c of x.cycles) {
      // The reply to what the previous message sent.
      const contested = new Map(contestsIn(c.note).map(k => [k.check, k.claim]))
      for (const id of sentBefore) { const e = entries.get(id); if (e) e.replies.push({ cycle: c.id, text: contested.get(id) ?? c.note.slice(0, 300), contest: contested.has(id) }) }
      const sightings: ItemSighting[] = c.items ?? [...c.failing.map(id => ({ id, digest: "", verdict: "not_landed", action: "send" as const })), ...c.corrections.map(id => ({ id, digest: "", verdict: "wrong", action: "send" as const }))]
      const next = new Set<string>()
      for (const s of sightings) {
        // A reviewer's item a premise stopped: listed with the premise, never sent (DESIGN §12i item 2).
        if (s.action === "blocked") { const e = make(s.id, r, c.id, "premise_failed"); note(e, r, c.id, s.verdict, "run"); close(e, r, "blocked", s.why ?? "a premise did not hold"); continue }
        // The repair it was sent in was reverted: the lead is dropped; a guard failing comes back when seen failing again.
        if (s.action === "discarded") { const e = entries.get(s.id); if (e) { note(e, r, c.id, s.verdict, "run"); close(e, r, "discarded", s.why ?? "the repair was reverted") } continue }
        const failing = failingVerdict(s.verdict)
        const e = failing ? make(s.id, r, c.id) : entries.get(s.id)
        if (!e) continue
        if (failing) reopen(e, s.digest)
        note(e, r, c.id, s.verdict, "run")
        e.lastDigest = s.digest
        if (s.action === "send") { e.sent.push(c.id); next.add(s.id) }
        if (s.action === "hold") e.held.push(c.id)
      }
      for (const ru of c.ruled ?? []) {
        const e = entries.get(ru.id)
        if (!e) continue
        note(e, r, c.id, ru.verdict, "ruling")
        if (ru.verdict === "ok" || ru.verdict === "check_wrong") close(e, r, "ruled_program_right", ru.reason)
        else if (ru.verdict === "ambiguous") close(e, r, "ruled_ambiguous", ru.reason)
      }
      for (const id of c.ambiguous) { const e = entries.get(id); if (e && !e.end) close(e, r, "ruled_ambiguous", "judged ambiguous") }
      sentBefore = next
    }
    // The round's end: what still fails on the kept program stays open; what no longer does is fixed.
    const kept = x.cycles.find(c => c.id === x.kept)
    const finals: ItemSighting[] = x.final ?? (kept ? [...kept.failing.map(id => ({ id, digest: "", verdict: "not_landed", action: "none" as const })), ...kept.corrections.map(id => ({ id, digest: "", verdict: "wrong", action: "none" as const }))] : [])
    const failingAtEnd = new Map(finals.filter(s => failingVerdict(s.verdict)).map(s => [s.id, s]))
    for (const [id, s] of failingAtEnd) {
      const e = make(id, r, x.kept)
      if (e.end?.how === "ruled_program_right") continue
      e.rounds.push(r)
      e.ends.push({ round: r, digest: s.digest })
      if (s.digest) e.lastDigest = s.digest
      note(e, r, null, s.verdict, "round end")
      const c = confirmedBy(id, r)
      e.confirmed = c ? { round: e.confirmed?.round ?? c.round } : null
      // No progress over rounds: the same output at the end of EXPIRE_ROUNDS rounds in a row, sent in between; an item
      // a ruling confirmed stays, sent once a round, until it is fixed, superseded or ruled otherwise.
      const last = e.ends.slice(-EXPIRE_ROUNDS)
      if (!e.end && !e.confirmed && last.length === EXPIRE_ROUNDS && last.every((y, k) => y.digest && y.digest === last[0].digest && (k === 0 || y.round === last[k - 1].round + 1)) && e.sent.length) close(e, r, "expired", `the same output at the end of rounds ${last.map(y => y.round).join(", ")}`)
    }
    if (kept) {
      for (const e of entries.values()) if (!e.end && e.source !== "coverage" && e.reason === "program_wrong" && !failingAtEnd.has(e.id) && e.opened.round <= r) close(e, r, "fixed", `no longer failing on ${x.kept}`)
      // Pairs judged ambiguous on the program the round delivers are listed, never sent.
      for (const id of kept.ambiguous) { const e = make(id, r, kept.id, "ambiguous"); if (!e.end) close(e, r, "ruled_ambiguous", "judged ambiguous: the text allows the output") }
      for (const run of kept.runs.filter(y => y.failure === "disputed/reference")) { const e = make(run.check, r, kept.id, "reference_pending"); if (e.reason !== "reference_pending" && !e.end) e.reason = "reference_pending"; if (!e.rounds.includes(r)) e.rounds.push(r) }
    }
    for (const ev of i.check_events.filter(v => v.round === r && v.status === "retired")) {
      const e = entries.get(ev.check)
      if (!e) continue
      if (ev.reason.startsWith("ruled ambiguous")) close(e, r, "ruled_ambiguous", ev.reason)
      else if (ev.reason.startsWith("ruled wrong")) close(e, r, "ruled_program_right", ev.reason)
    }
  }
  // Ambiguous library checks are listed even when no run ever failed on them in a cycle.
  for (const ev of i.check_events.filter(v => v.status === "retired" && v.reason.startsWith("ruled ambiguous"))) { const e = make(ev.check, ev.round, null, "ambiguous"); close(e, ev.round, "ruled_ambiguous", ev.reason) }
  // Units no probe exercises yet, and those closed by code as uncheckable.
  const gaps = gapState(i.registry, i.probe_rounds, libraryCovers(i.registry, i.checks, i.check_events))
  const firstRound = (u: string) => i.probe_rounds.filter(p => p.status === "accepted" && [...p.uncovered, ...(p.cases?.open ?? [])].some(x => x === u || x.split("#")[0] === u)).map(p => p.round).sort((a, b) => a - b)[0] ?? 0
  for (const u of gaps.open) make(u, firstRound(u), null, "uncovered")
  for (const c of gaps.closed) { const e = make(c.unit, firstRound(c.unit), null, "uncovered"); close(e, c.round, "uncheckable", c.reason) }
  return [...entries.values()].map(({ lastDigest, ends: _e, ...e }) => ({ ...e, digest: lastDigest || null }))
}

/** The ledger from a state (DESIGN §12h E2). */
export function ledgerOf(state: { executions: readonly ExecutionRecord[]; probes: readonly ProbeRecord[]; probe_events: readonly ProbeEvent[]; probe_rounds: readonly ProbeRoundRecord[]; checks: readonly CheckRecord[]; check_events: readonly CheckEvent[]; judgments?: LedgerInput["judgments"]; rulings?: LedgerInput["rulings"]; guards?: LedgerInput["guards"]; guard_events?: LedgerInput["guard_events"] }, registry: Registry): LedgerEntry[] {
  return buildLedger({ registry, executions: state.executions, probes: state.probes, probe_events: state.probe_events, probe_rounds: state.probe_rounds, checks: state.checks, check_events: state.check_events, judgments: state.judgments ?? [], rulings: state.rulings ?? [], guards: state.guards ?? [], guard_events: state.guard_events ?? [] })
}

/** The report's projection of the ledger for one round (DESIGN §12h E2): open by reason, listed only, and how items ended. */
export interface LedgerSummary {
  open: Record<"program_wrong" | "uncovered" | "reference_pending", string[]>
  /** Open program-wrong items a ruling confirmed: still sent once a round, never listed only. */
  confirmed: string[]
  report_only: { id: string; how: LedgerEnd; detail: string }[]
  ended: { id: string; how: LedgerEnd; cycles: number }[]
  /** Cycles items were sent in this round, and items held back. */
  sends: number
  held: string[]
}

export function ledgerSummary(entries: readonly LedgerEntry[], round: number): LedgerSummary {
  const open = { program_wrong: [] as string[], uncovered: [] as string[], reference_pending: [] as string[] }
  for (const e of entries.filter(x => x.state === "open" && x.reason !== "ambiguous")) open[e.reason as keyof typeof open].push(e.id)
  return {
    open,
    confirmed: entries.filter(e => e.state === "open" && e.confirmed).map(e => e.id),
    report_only: entries.filter(e => e.state === "report_only").map(e => ({ id: e.id, how: e.end!.how, detail: e.end!.detail })),
    ended: entries.filter(e => e.end?.round === round).map(e => ({ id: e.id, how: e.end!.how, cycles: e.sent.filter(s => s.startsWith(`C${round}.`)).length })),
    sends: entries.reduce((n, e) => n + e.sent.filter(s => s.startsWith(`C${round}.`)).length, 0),
    held: entries.filter(e => e.held.some(h => h.startsWith(`C${round}.`))).map(e => e.id),
  }
}

/** Renders the ledger as a table, one line per item (DESIGN §12h E2). */
export function renderLedger(entries: readonly LedgerEntry[]): string {
  return [
    "| item | rests on | reason | state | confirmed | opened | cycles sent | replies | verdicts | end |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...entries.map(e => `| ${e.id} | ${e.case ?? e.unit} | ${e.reason} | ${e.state} | ${e.confirmed ? `R${e.confirmed.round}` : ""} | R${e.opened.round}${e.opened.cycle ? ` ${e.opened.cycle}` : ""} | ${e.sent.length}${e.sent.length ? ` (${e.sent.join(", ")})` : ""} | ${e.replies.filter(r => r.contest).length} contest(s) | ${e.verdicts.map(v => `${v.cycle ?? `R${v.round}`}:${v.verdict}${v.by === "ruling" ? " (ruling)" : ""}`).join(" → ")} | ${e.end ? `R${e.end.round} ${e.end.how}` : ""} |`),
  ].join("\n")
}
