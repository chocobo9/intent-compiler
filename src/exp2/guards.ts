import { coverage, EMPTY_CHECKS, replacedBasis, restsOn, type Assertion, type CheckDraft, type CheckRecord, type CodeFacts } from "./checks.js"
import { LIVE_STATES, type Registry } from "./registry.js"
import type { CheckInput, CheckRunner, ProgramRef } from "./runner.js"
import { runChecks, type CheckRun } from "./verdict.js"

/**
 * Guards (DESIGN §12i item 3): deterministic checks, compared by code, that were observed passing on a program of
 * this run. Two sources: a library check (K) the moment it passes, and a deviation the reviewer reported and the
 * executor fixed, which the code keeps as a check from then on. A model's judgment is never a guard. All guards run
 * in one batch every cycle (no token spent); a guard that goes from passing to failing is a flip (§12i items 4, 6).
 */

export interface GuardRecord {
  /** G1, G2, … never reused. */
  id: string
  /** The round it was born in. */
  round: number
  source: "library" | "review"
  /** library: the check it is (the assertions live in the library record). */
  check?: string
  /** The units it rests on (a library guard: the check's blocks; a review guard: the units the item cites). */
  units: string[]
  object: string | null
  /** review: the check the code built from the reviewer's item (input filled, expected values resolved). */
  input?: CheckInput
  assertions?: Assertion[]
  reference_script?: CheckDraft["reference_script"]
  /** review: where it came from, with the reviewer's own words. */
  origin?: { item: string; review: string; text: string }
  born: { cycle: string; program: string }
}

/**
 * A change of a guard's standing, appended only when it changes: born passing; a flip to failing (with whether the
 * text it rests on changed this round, by the attribution's records); back to passing; retired (the reviewer
 * said the behaviour was superseded by this round's text).
 */
export interface GuardEvent {
  guard: string
  round: number
  cycle: string | null
  status: "passing" | "failing" | "retired"
  program?: string
  /** failing: the round's text changes behind the flip, when there are any (§12i item 6); none: a regression. */
  changed_text?: string[]
  /** failing: which records said so (§6b): revision, object, edge; empty: none, a regression. */
  behind_sources?: BehindSource[]
  reason?: string
}

/** The guard as a check record, so the library's runner and comparison run it unchanged. */
export function guardCheck(g: GuardRecord, library: readonly CheckRecord[]): CheckRecord {
  if (g.source === "library") {
    const k = library.find(c => c.id === g.check)
    if (!k) throw new Error(`guard ${g.id} names check ${g.check}, which is not in the library`)
    return k
  }
  return {
    id: g.id, round: g.round, key: g.id, object: g.object ?? "none", blocks: g.units, uses: [],
    input: g.input!, assertions: g.assertions!, unknown: [], reference_script: g.reference_script ?? null,
    admission: "admitted", admission_reason: null, strength: null, status: "active", calls: [],
  }
}

/** Each guard's last recorded standing. */
export function guardStatuses(events: readonly GuardEvent[]): Map<string, GuardEvent["status"]> {
  const out = new Map<string, GuardEvent["status"]>()
  for (const e of events) out.set(e.guard, e.status)
  return out
}

/** Guards still standing (not retired). */
export function liveGuards(guards: readonly GuardRecord[], events: readonly GuardEvent[]): GuardRecord[] {
  const status = guardStatuses(events)
  return guards.filter(g => status.get(g.id) !== "retired")
}

export type GuardOutcome = "pass" | "fail" | "unknown"

export interface GuardRun { guard: string; outcome: GuardOutcome; run: CheckRun }

/**
 * Runs guards on a program in one batch. A timeout shows nothing (unknown): it neither flips a guard nor reverts a
 * repair; everything else is the comparison's pass or fail.
 */
export async function runGuards(guards: readonly GuardRecord[], library: readonly CheckRecord[], program: ProgramRef, runner: CheckRunner, round: number, registry: Registry, facts: CodeFacts, timeoutMs: number): Promise<GuardRun[]> {
  if (!guards.length) return []
  const checks = guards.map(g => guardCheck(g, library))
  const runs = await runChecks(checks, program, runner, round, registry, facts, timeoutMs)
  return guards.map((g, i) => ({ guard: g.id, run: runs[i], outcome: runs[i].outcome === "pass" ? "pass" : runs[i].failure?.reason === "timeout" ? "unknown" : "fail" }))
}

const within = (registry: Registry, inner: string, outer: string) => registry.lineage(inner).some(b => b.id === outer)

/** Which authority says this round's text changed behind a guard (DESIGN §6b): the revision record, the change record of the object a unit belongs to, a relation edge. */
export type BehindSource = "revision" | "object" | "edge"
export interface Behind { source: BehindSource; text: string }

/**
 * What of this round's text changes stands behind a guard (DESIGN §12i item 6, §6b), read only from the attribution's
 * records: a modification this round that overlaps a unit it rests on, or a unit out of force since this round (the
 * revision record); an object changed this round that owns one of its units (the object's change record); a relation
 * edge between the guard's units or objects and text this round revised or withdrew (the edges). Nothing is inferred
 * from the guard's input. Empty: the text behind the guard did not change, and a flip is a regression.
 */
export function changedTextBehind(registry: Registry, guard: Pick<GuardRecord, "units"> & { round?: number }, round: number): Behind[] {
  // A guard born this round rests on this round's text: nothing changed behind it (with classification before the
  // revert, §12j.7 item 11, every flip of a round-1 guard would otherwise read as a change of text).
  if (guard.round !== undefined && guard.round >= round) return []
  const out = new Map<string, Behind>()
  const add = (source: BehindSource, text: string) => { if (!out.has(text)) out.set(text, { source, text }) }
  for (const m of replacedBasis(registry, guard.units, round - 1, round)) add("revision", `${m.unit}: ${m.parts.join(", ")} ${m.kind === "partial" ? "partly revised" : m.kind === "withdraw" ? "withdrawn" : "replaced"} by ${m.by.join(", ")}`)
  // The units themselves may be out of force by now (wholly replaced or withdrawn): that too is a change behind it.
  for (const u of guard.units) {
    const own = registry.ownership(u)
    if (own && !LIVE_STATES.has(own.state) && own.modifications.some(m => m.round === round)) add("revision", `${u} is ${own.state} since this round`)
  }
  const owners = new Set(guard.units.map(u => registry.coverOf(u)?.owner).filter((o): o is string => !!o && o !== "none"))
  for (const c of registry.roundScope(round)) {
    const o = registry.objects.get(c.object)
    if (o && owners.has(c.object)) add("object", `${c.object} (${o.name}) owns a unit the guard rests on and changed this round (${c.id})`)
  }
  // Edges: one end on the guard (a block overlapping one of its units, or the object owning one), the other end text
  // this round revised or withdrew.
  const onGuard = (end: string) => /^O\d+$/u.test(end) ? owners.has(end) : guard.units.some(u => within(registry, u, end) || within(registry, end, u))
  for (const e of registry.references.filter(x => x.round <= round)) {
    for (const [mine, other] of [[e.from, e.to], [e.to, e.from]] as const) {
      if (!onGuard(mine) || onGuard(other)) continue
      const blocks = /^O\d+$/u.test(other) ? registry.referredText({ ...e, to: other }) : [other]
      for (const m of replacedBasis(registry, blocks, round - 1, round)) add("edge", `${e.from} ${e.kind} ${e.to} (round ${e.round}); ${m.parts.join(", ")} ${m.kind === "partial" ? "partly revised" : m.kind === "withdraw" ? "withdrawn" : "replaced"} by ${m.by.join(", ")}`)
    }
  }
  return [...out.values()]
}

/** The text the round's changes put in place of a guard's units, quoted for the reviewer (§12i item 6). */
export function changeQuotes(registry: Registry, guard: Pick<GuardRecord, "units">, round: number): { old: { id: string; text: string }[]; now: { id: string; text: string }[] } {
  const old = new Map<string, string>(), now = new Map<string, string>()
  for (const m of replacedBasis(registry, guard.units, round - 1, round)) {
    for (const p of m.parts) { const b = registry.block(p); if (b) old.set(p, b.text.trim()) }
    for (const b of m.by.map(id => registry.block(id)).filter((x): x is NonNullable<typeof x> => !!x)) now.set(b.id, b.text.trim())
  }
  // Objects of the guard that changed this round: the blocks this round gave them.
  const owners = new Set(guard.units.map(u => registry.coverOf(u)?.owner).filter((o): o is string => !!o && o !== "none"))
  for (const c of registry.roundScope(round).filter(c => owners.has(c.object))) for (const e of c.entries) { const b = registry.block(e.block); if (b && !now.has(b.id)) now.set(b.id, b.text.trim()) }
  const list = (m: Map<string, string>) => [...m.entries()].map(([id, text]) => ({ id, text }))
  return { old: list(old), now: list(now) }
}

/**
 * Which live rule units a guard that ran exercises (DESIGN §12i item 7): a unit counts as covered when a guard that
 * ran on the program (`ran`) rests on it, at the unit or finer. Units are those of rounds 1..round that state
 * something specific, still in force. Taken from the recorded runs, never from what a model says it exercised.
 */
export function guardCoverage(registry: Registry, round: number, guards: readonly GuardRecord[], ran: ReadonlySet<string>): { units: string[]; covered: string[]; uncovered: string[] } {
  const units: string[] = []
  const seen = new Set<string>()
  for (let r = 1; r <= round; r++) for (const u of coverage(registry, r, EMPTY_CHECKS, [], []).units) if (!seen.has(u) && seen.add(u) && live(registry, u, round)) units.push(u)
  const basis = guards.filter(g => ran.has(g.id)).flatMap(g => g.units)
  const covered = units.filter(u => { const b = registry.block(u)!; return basis.some(x => restsOn(registry, x, b)) })
  const c = new Set(covered)
  return { units, covered, uncovered: units.filter(u => !c.has(u)) }
}

/** A unit still in force: owned, its block live, and not wholly replaced by a later round. */
function live(registry: Registry, unit: string, round: number): boolean {
  const own = registry.ownership(unit)
  if (!own || !LIVE_STATES.has(own.state)) return false
  const since = registry.block(unit)!.round
  return !replacedBasis(registry, [unit], since, round).some(m => m.parts.some(p => within(registry, unit, p)))
}
