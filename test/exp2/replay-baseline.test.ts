import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { FIX, failing, items, load, noInputFormalizer, replayChecks, replayedFormalizer, round, scripted, session, storeOf } from "./replay-fixtures.js"

/**
 * The interface counts of the seven real R1 runs replayed, against the counts the code of fe6562d gave
 * (exp2/evidence/replay-2026-10-23/baseline-fe6562d.json). A later change keeps each count or moves it the good way.
 * `IC_WRITE_REPLAY_BASELINE=1` rewrites the file from the code under test (done once, on fe6562d's src).
 */

const RUNS = ["rep1", "rep1b", "rep1c", "rep1d", "rep1e", "rep1f", "rep1g"] as const
const BASELINE = join(FIX, "baseline-fe6562d.json")

/** +1: more is better; -1: fewer is better. A count not listed here is reported and not judged. */
const DIRECTION: Record<string, 1 | -1> = {
  admitted: 1, unknown_not_fed_back: -1,
  entered: 1, inputs_from_materials: 1, no_input: -1, blocked: -1, conservation_errors: -1,
}

type Counts = Record<string, number>

async function countsOf(name: string): Promise<{ checks: Counts; review: Counts | null }> {
  const run = load(name)
  const { store, record } = await replayChecks(run)
  const lib = store.inspect().checks
  const checks = {
    entered: lib.length,
    admitted: lib.filter(k => k.admission === "admitted").length,
    unknown: lib.filter(k => k.admission === "unknown").length,
    unknown_not_fed_back: lib.filter(k => k.unknown.length && !k.fed_back).length,
    dropped: (record.dropped ?? []).length,
    normalized: lib.filter(k => k.normalized?.length).length,
  }
  if (!run.review_calls.length) return { checks, review: null }
  const exported = existsSync(join(FIX, "sessions", `review-session-${run.review_calls[0].session}.json`))
  const script = run.review_calls.map(r => ({ text: r.response_text, ...(exported ? { materials: session(r.session) } : {}) }))
  const formalize = run.formalize_calls.length ? replayedFormalizer(run.formalize_calls.map(x => x.response_text)) : noInputFormalizer
  const r = await round(await storeOf(run), failing, { reviewer: scripted([...script, { text: "NO ISSUES" }]), formalize, library: run.checks, reviews: run.review_calls.length })
  const a = r.record.accept!
  const recs = items(r.record.review_items!)
  const review = {
    reported: a.reviews.reduce((n, x) => n + x.reported, 0),
    entered: a.reviews.reduce((n, x) => n + x.sent, 0),
    verified: recs.filter(x => x.disposition === "sent").length,
    fallback: recs.filter(x => x.disposition === "fallback").length,
    blocked: a.reviews.reduce((n, x) => n + (x.conservation?.blocked ?? 0), 0),
    inputs_from_materials: recs.filter(x => x.input_from).length,
    no_input: recs.filter(x => x.premise === "no_input" || x.logged?.some(l => l.premise === "no_input")).length,
    conservation_errors: a.conservation_errors?.length ?? 0,
  }
  return { checks, review }
}

describe("replay baseline: the seven real R1 runs keep or improve their interface counts", () => {
  it("each count of each run is the baseline's or better", { timeout: 600_000 }, async () => {
    const now: Record<string, { checks: Counts; review: Counts | null }> = {}
    for (const name of RUNS) now[name] = await countsOf(name)
    if (process.env.IC_WRITE_REPLAY_BASELINE === "1") writeFileSync(BASELINE, `${JSON.stringify(now, null, 1)}\n`)
    const base = JSON.parse(readFileSync(BASELINE, "utf8")) as typeof now
    const worse: string[] = []
    for (const name of RUNS) for (const part of ["checks", "review"] as const) {
      const b = base[name][part], n = now[name][part]
      if (!b) continue
      assert.ok(n, `${name}: ${part} replayed in the baseline and not now`)
      for (const [k, d] of Object.entries(DIRECTION)) if (k in b && (n[k] - b[k]) * d < 0) worse.push(`${name} ${part}.${k}: ${b[k]} → ${n[k]}`)
    }
    console.log(JSON.stringify(now))
    assert.deepEqual(worse, [])
  })
})
