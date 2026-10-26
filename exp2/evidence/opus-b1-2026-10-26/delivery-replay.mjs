// Batch 1 of DESIGN-OPUS-2026-10-26, acceptance (iv) (no model, read only): the original text each recipient would get
// per round under the delivery ledger, by class, on recorded runs, beside the run's own package characters.
// A: this round's paragraphs; B: the earlier text of the units this round revises; C (executor): the text the items
// carried into the round rest on (their guards' or review items' units), each unit once, cut to ids from the oldest
// item up past the line; D (reviewer): the debt slice replayed from R2 (slice-replay.mjs's choice). Line: the round's
// text × 2 + 10k. The executor's repair messages within a round (regressions' text) are not in the records and not counted.
// Usage (opus1 worktree, after `npm run build`): node exp2/evidence/opus-b1-2026-10-26/delivery-replay.mjs <out.md> <runs dir> <dev dist/exp2 dir>
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const V = await import(D + "verification.js")
const S = await import(D + "slice.js")
const W = await import(D + "view.js")
const L = await import(D + "delivery.js")
const [OUT, RUNS, DEV] = process.argv.slice(2)
const DevStore = (await import(pathToFileURL(join(DEV, "store.js")).href)).Exp2Store
const DevView = await import(pathToFileURL(join(DEV, "view.js")).href)
const load = name => {
  const dir = join(RUNS, `exp2-icacc-r6-luna56-low-${name}`)
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const tmp = mkdtempSync(join(tmpdir(), "b1d-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
  let reg, via = "this branch"
  try { reg = new Exp2Store(join(tmp, "state"), s.run_id).registry() } catch { reg = new DevStore(join(tmp, "state"), s.run_id).registry(); via = "the dev line" }
  return { name, s, reg, via }
}
const upTo = (s, r) => ({ guards: s.guards.filter(g => g.round <= r), guardEvents: s.guard_events.filter(e => e.round <= r), library: s.checks.filter(k => k.round <= r), checkEvents: s.check_events.filter(e => e.round <= r) })
const finalUnits = (s, r) => {
  const e = s.executions.find(x => x.round === r)
  const items = new Map(s.executions.flatMap(x => x.review_items ?? []).map(i => [i.id, i]))
  return (e?.final ?? []).map(f => ({ id: f.id, round: s.guards.find(g => g.id === f.id)?.round ?? items.get(f.id)?.round ?? r, units: s.guards.find(g => g.id === f.id)?.units ?? items.get(f.id)?.units ?? [] }))
}
const parts = (run, r) => {
  if (run.via === "this branch") {
    const p = W.roundPackage(run.reg, r, [], { delivery: true })
    return { a: p.segments.filter(x => x.why === "this round").map(x => [x.paragraph, x.text.length]), b: p.segments.filter(x => x.why === "revised").flatMap(x => (x.parts ?? []).map(id => [id, run.reg.block(id).text.trim().length])) }
  }
  const p = DevView.roundPackage(run.reg, r, [])
  const ids = [...new Set(p.segments.filter(x => x.why === "revised").flatMap(x => [...x.text.matchAll(/^earlier text of (\S+?):/gmu)].map(m => m[1])))]
  return { a: p.segments.filter(x => x.why === "this round").map(x => [x.paragraph, x.text.length]), b: ids.map(id => [id, run.reg.block(id)?.text.trim().length ?? 0]) }
}
const k = n => `${(n / 1000).toFixed(1)}k`
const md = ["# Batch 1, acceptance (iv): original text per recipient and class, replayed", "",
  "Line: round text × 2 + 10k. Recorded package: the run's own work-order source zone (report.json zones.source_chars). The executor's in-round repair messages are not counted (not in the records).", "",
  "| run | round | line | recorded package | executor A / B / C | executor total | reviewer A / B / D | reviewer total | over the line | C cut to ids |", "|---|---|---|---|---|---|---|---|---|---|"]
for (const name of ["rep1j-20261025", "rep1k-20261025", "rep1n-20261025", "rep1o-20261025", "rep1p-20261026"]) {
  const run = load(name)
  const rounds = [...new Set(run.s.executions.map(e => e.round))].sort((a, b) => a - b)
  let last
  for (const r of rounds) {
    const line = L.deliveryLine(run.s.sources.find(x => x.round === r).text.length)
    const d = new L.DeliveryLedger(run.reg, r, line)
    const { a, b } = parts(run, r)
    for (const [id, n] of a) { d.give("executor", "A", id, n); d.give("reviewer", "A", id, n) }
    for (const [id, n] of b) { d.give("executor", "B", id, n); d.give("reviewer", "B", id, n) }
    if (r > 1) {
      const states = V.verificationStates(run.reg, r - 1, { ...upTo(run.s, r - 1), open: finalUnits(run.s, r - 1) })
      const slice = S.chooseSlice(run.reg, r, states, last ? { last } : {}, { chars: d.room("reviewer") })
      last = slice
      for (const x of slice.sent) d.give("reviewer", "D", x.paragraph, x.chars)
    }
    // C: the items carried in (last round's final list), oldest first cut past the line.
    const carried = r > 1 ? finalUnits(run.s, r - 1).sort((x, y) => x.round - y.round) : []
    const owed = c => [...new Set(c.units)].filter(u => run.reg.block(u) && !d.has("executor", u)).reduce((n, u) => n + run.reg.block(u).text.trim().length, 0)
    let over = d.chars("executor") + carried.reduce((n, c) => n + owed(c), 0) - line
    const cut = new Set()
    for (const c of carried) { if (over <= 0) break; cut.add(c.id); over -= owed(c) }
    for (const c of carried) d.quote("executor", c.units.filter(u => run.reg.block(u)), "C", cut.has(c.id))
    const sm = d.summary(), ex = sm.recipients.executor, rv = sm.recipients.reviewer
    const rec = run.s.reports.find(x => x.round === r)?.zones?.source_chars
    md.push(`| ${name.split("-")[0]}${run.via === "the dev line" ? "*" : ""} | R${r} | ${k(line)} | ${rec !== undefined ? k(rec) : "—"} | ${k(ex.chars.A)} / ${k(ex.chars.B)} / ${k(ex.chars.C)} | ${k(ex.total)} | ${k(rv.chars.A)} / ${k(rv.chars.B)} / ${k(rv.chars.D)} | ${k(rv.total)} | ${[ex.over_line ? `executor ${ex.over_line}` : "", rv.over_line ? `reviewer ${rv.over_line}` : ""].filter(Boolean).join("; ") || "no"} | ${sm.trimmed.length ? `${sm.trimmed.length} (${k(sm.trimmed.reduce((n, t) => n + t.chars, 0))}): ${sm.trimmed.map(t => t.id).join(", ")}` : "none"} |`)
  }
}
md.push("", "\\* registry built by the dev line's code; A from its package's this-round paragraphs, B from the earlier text of the units its revised paragraphs name.")
writeFileSync(OUT, md.join("\n") + "\n", "utf8")
console.log(md.join("\n"))
