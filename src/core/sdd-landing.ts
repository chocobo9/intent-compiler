import type { SettledChange, SddBatch, SddSnapshot } from "./sdd-contract.js"
import { normValue } from "./sdd-quotes.js"

/**
 * v8 zoning (item 3): what the code may show about an earlier change, by code from the SDD receipts and the
 * observations the host recorded with this batch. Only "not_landed" (with evidence) puts an earlier change back
 * into the change zone; everything else is information for the status zone.
 */
export type LandingState = "not_landed" | "unknown"

/** What the host read back from one returned run (never a requirement): its in-round acceptance and repair. */
export interface RunObservation {
  run_id: string
  /** Whether SDD's own coding stage ran (its receipt's coding stage is not "not_reached"). */
  entered_coding: boolean
  /** Units (command, operation, step type) of the checks IC's repair fixed in this run's code. */
  fixed_units: string[]
  /** Units of the checks that passed on this run's final code (P1/P2 records). */
  passed_units: string[]
  /** Output structure checks (P2) that passed on this run's final code, with the keys the output carried. */
  passed_structures?: Array<{ name: string; output_keys: string[] }>
}

export interface EarlierChange {
  change: SettledChange
  event_id: string
  input: number
  state: LandingState
  /** For not_landed: what the evidence is, in words code writes. */
  evidence?: string
}

/** The names a change concerns: its subjects, its parameters and the words of its subject. */
export function changeNames(c: Pick<SettledChange, "subject" | "subjects" | "parameters">): Set<string> {
  const words = [...c.subject.matchAll(/[A-Za-z_][A-Za-z0-9_-]*/gu)].map(m => m[0])
  return new Set([...c.subjects, ...c.parameters.map(p => p.replace(/^-+/u, "")), ...words].map(normValue).filter(v => v.length >= 3))
}

/** A check id's unit: unit:<kind>:<name>, p1:<name>, p2:<name>, probe:<command>:<case>. */
export function checkUnit(id: string): string | undefined {
  const parts = id.split(":")
  if (parts[0] === "unit" && parts.length >= 3) return normValue(parts.slice(2).join(":"))
  if ((parts[0] === "p1" || parts[0] === "p2" || parts[0] === "probe") && parts.length >= 2) return normValue(parts[1]!)
  return undefined
}

/**
 * Every change an earlier accepted delivery made, with its landing state. Evidence that it is not in the code
 * (v8, scope item 3): every counted run from its update up to this one stopped before coding, and no check the
 * host observed on those runs covers it (fixed by IC's repair or passing; for a revision, an output-structure check
 * carrying a value it set). Anything short of that is unknown.
 */
export function earlierChanges(s: SddSnapshot, b: SddBatch): EarlierChange[] {
  const order = new Map(s.events.filter(e => e.kind === "user_input").map((e, i) => [e.event_id, i + 1]))
  const current = order.get(b.event_id) ?? Infinity
  const observed = new Map((b.observations ?? []).map(o => [o.run_id, o]))
  const runs = s.runs.filter(r => r.result && !r.superseded && !r.voided && (order.get(r.event_id) ?? Infinity) < current)
  const out: EarlierChange[] = []
  for (const x of s.batches) {
    if (x === b || x.state !== "accepted" || !x.delivery?.changes?.length) continue
    const input = order.get(x.event_id)
    if (input === undefined || input >= current) continue
    const since = runs.filter(r => (order.get(r.event_id) ?? 0) >= input)
    for (const change of x.delivery.changes) {
      const names = changeNames(change)
      const stopped = since.length > 0 && since.every(r => r.result!.stages?.coding === "not_reached")
      const seen = since.map(r => observed.get(r.run_id))
      // What a check can observe: a check naming a unit shows it exists (an added command or operation); a revision
      // is observed only by a passing output-structure check whose output carries a value the revision set.
      const covered = seen.some(o => o && (change.kind === "added"
        ? [...o.fixed_units, ...o.passed_units].some(u => names.has(normValue(u)))
        : (o.passed_structures ?? []).some(p => names.has(normValue(p.name)) && change.new_values.some(v => p.output_keys.some(k => normValue(k) === normValue(v))))))
      const evidence = stopped && seen.every(Boolean) && !covered
      out.push({ change, event_id: x.event_id, input, state: evidence ? "not_landed" : "unknown",
        ...(evidence ? { evidence: `SDD stopped before coding in update ${since.map(r => order.get(r.event_id)).join(", ")}, so no SDD coding stage has written it; management's checks of that code, and their repairs, do not cover it` } : {}) })
    }
  }
  return out
}
