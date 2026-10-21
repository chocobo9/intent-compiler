import { createHash } from "node:crypto"
import type { RoundReport } from "./report.js"

/**
 * Pre-registration (DESIGN §12b item 10): before a round is scored, the system's call on each object (landed, not
 * landed, unknown) is frozen with a hash. After scoring, the local side maps the official results back to objects
 * and reconciles them here. Reconciliation is local only; nothing of it goes back into the system.
 */

export type Predicted = "landed" | "not_landed" | "unknown"

export interface Prediction {
  format: "exp2-prediction-1"
  round: number
  /** The commit the round's checks judged and the official verifier will score. */
  commit: string
  objects: { object: string; name: string; status: Predicted }[]
  /** sha256 of the canonical body: {format, round, commit, objects} as JSON, objects sorted by id. */
  sha256: string
}

const body = (p: Omit<Prediction, "sha256">) => JSON.stringify({ format: p.format, round: p.round, commit: p.commit, objects: [...p.objects].sort((a, b) => a.object.localeCompare(b.object)).map(o => ({ object: o.object, name: o.name, status: o.status })) })

export function freezePrediction(round: number, commit: string, objects: RoundReport["objects"]): Prediction {
  const p = { format: "exp2-prediction-1" as const, round, commit, objects: objects.map(o => ({ object: o.object, name: o.name, status: o.status as Predicted })).sort((a, b) => a.object.localeCompare(b.object)) }
  return { ...p, sha256: createHash("sha256").update(body(p)).digest("hex") }
}

/** Whether a prediction is as it was frozen. */
export function predictionIntact(p: Prediction): boolean {
  const { sha256, ...rest } = p
  return createHash("sha256").update(body(rest)).digest("hex") === sha256
}

/**
 * One official test case, mapped to the objects it exercises by the local side. A case may map to several objects,
 * or to none (it then shows in `unmapped`).
 */
export interface OfficialCase { id: string; passed: boolean; objects: string[] }

export type RowVerdict =
  /** Landed, and the official cases for it pass. */
  | "agree_landed"
  /** Not landed, and an official case for it fails. */
  | "agree_not_landed"
  /** Landed, but an official case for it fails: IC judged wrong. */
  | "ic_wrong"
  /** Not landed, but every official case for it passes: the checks were too strict or expected the wrong thing. */
  | "too_strict"
  /** IC said unknown: reported, not scored either way. */
  | "unknown"
  /** No official case maps to the object. */
  | "no_cases"

export interface Reconciliation {
  format: "exp2-reconciliation-1"
  round: number
  commit: string
  prediction_sha256: string
  rows: { object: string; name: string; predicted: Predicted; passed: string[]; failed: string[]; verdict: RowVerdict }[]
  unmapped: string[]
  counts: Record<RowVerdict, number>
}

export function reconcile(prediction: Prediction, cases: readonly OfficialCase[]): Reconciliation {
  if (!predictionIntact(prediction)) throw new Error(`prediction for round ${prediction.round} does not match its hash`)
  const rows = prediction.objects.map(o => {
    const mine = cases.filter(c => c.objects.includes(o.object))
    const passed = mine.filter(c => c.passed).map(c => c.id), failed = mine.filter(c => !c.passed).map(c => c.id)
    const verdict: RowVerdict = !mine.length ? "no_cases" : o.status === "unknown" ? "unknown"
      : o.status === "landed" ? (failed.length ? "ic_wrong" : "agree_landed")
      : (failed.length ? "agree_not_landed" : "too_strict")
    return { object: o.object, name: o.name, predicted: o.status, passed, failed, verdict }
  })
  const known = new Set(prediction.objects.map(o => o.object))
  const counts = Object.fromEntries((["agree_landed", "agree_not_landed", "ic_wrong", "too_strict", "unknown", "no_cases"] as RowVerdict[]).map(v => [v, rows.filter(r => r.verdict === v).length])) as Record<RowVerdict, number>
  return {
    format: "exp2-reconciliation-1", round: prediction.round, commit: prediction.commit, prediction_sha256: prediction.sha256, rows,
    unmapped: cases.filter(c => !c.objects.some(o => known.has(o))).map(c => c.id), counts,
  }
}
