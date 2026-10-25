// Step 0 of DESIGN-OPUS-2026-10-26 (no model), G12: wall-clock time per round and over six rounds, by role, IC (rep1j,
// rep1j3) beside the control group L (rep1, rep2). IC: measures.jsonl's wall_ms and stages_ms — executor = coding +
// repair + trial fix; reviewer = review; formalizer = formalize; checks = check writing + checks + guard rerun +
// premise checks; the rest (attribution, build, trial, waiting, …) apart. Check writing runs beside the coding, so the
// stages can overlap: their sum is not the wall. The control: review.jsonl — the round from its start event to the
// next round's start (the last round: to its last event); executor = answered + fixed, reviewer = review, build =
// target_check / target_fix.
// Usage: node exp2/evidence/opus-step0-2026-10-26/g12.mjs <out.md> <runs dir>
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [OUT, RUNS] = process.argv.slice(2)
const lines = f => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l))
const min = ms => Math.round(ms / 60000)
const rows = [], totals = {}
for (const [name, d] of [["rep1j", "exp2-icacc-r6-luna56-low-rep1j-20261025"], ["rep1j3", "exp2-icacc-r6-luna56-low-rep1j3-20261026"]]) {
  for (const m of lines(join(RUNS, d, "checkpoints", "measures.jsonl")).sort((a, b) => a.round - b.round)) {
    const st = m.stages_ms ?? {}, g = (...k) => k.reduce((a, x) => a + (st[x] ?? 0), 0)
    const r = { wall: m.wall_ms, executor: g("coding", "repair", "trial fix"), reviewer: g("review"), formalizer: g("formalize"), checks: g("check writing", "checks", "guard rerun", "premise checks"), other: Object.entries(st).filter(([k]) => !["coding", "repair", "trial fix", "review", "formalize", "check writing", "checks", "guard rerun", "premise checks"].includes(k)).reduce((a, [, v]) => a + v, 0) }
    rows.push({ name, round: m.round, ...r })
  }
}
for (const k of [1, 2]) {
  const ev = lines(join(RUNS, `exp2-review15-luna56-low-revmed-rep${k}-dpipe-20261022`, "logs", "review.jsonl")).filter(e => e.round)
  for (let r = 1; r <= 6; r++) {
    const of = ev.filter(e => e.round === r), start = of.find(e => e.event === "start"), next = ev.find(e => e.round === r + 1 && e.event === "start")
    if (!start) continue
    const end = next ? Date.parse(next.at) : Date.parse(of.at(-1).at), sec = t => of.filter(e => t.includes(e.event)).reduce((a, e) => a + (e.seconds ?? 0), 0) * 1000
    rows.push({ name: `control L rep${k}`, round: r, wall: end - Date.parse(start.at), executor: sec(["answered", "fixed"]), reviewer: sec(["review"]), formalizer: 0, checks: 0, other: sec(["target_check", "target_fix"]) })
  }
}
for (const x of rows) { const t = totals[x.name] ??= { wall: 0, executor: 0, reviewer: 0, formalizer: 0, checks: 0, other: 0 }; for (const k in t) t[k] += x[k] }
const names = ["rep1j", "rep1j3", "control L rep1", "control L rep2"]
const out = ["# Step 0, G12: wall-clock minutes by round and role, IC beside the control group L", "",
  "IC: measures.jsonl (executor = coding + repair + trial fix; reviewer = review; formalizer = formalize; checks = check writing + checks + guard rerun + premise checks; other = attribution, build, trial, waiting, …; stages can overlap, so their sum is not the wall). Control: review.jsonl (executor = answered + fixed; reviewer = review; other = target checks).", "",
  "| run | round | wall | executor | reviewer | formalizer | checks | other |", "|---|---|---|---|---|---|---|---|",
  ...rows.map(x => `| ${x.name} | R${x.round} | ${min(x.wall)} | ${min(x.executor)} | ${min(x.reviewer)} | ${min(x.formalizer)} | ${min(x.checks)} | ${min(x.other)} |`), "",
  "## Six rounds", "", "| run | wall | executor | reviewer | formalizer | checks | other |", "|---|---|---|---|---|---|---|",
  ...names.map(n => { const t = totals[n]; return `| ${n} | ${min(t.wall)} | ${min(t.executor)} | ${min(t.reviewer)} | ${min(t.formalizer)} | ${min(t.checks)} | ${min(t.other)} |` }), "",
  `The line (the user's 10-23 rough bound): IC ≤ 2 × the control. Control six-round walls: ${min(totals["control L rep1"].wall)} and ${min(totals["control L rep2"].wall)} minutes; 2 × the faster: ${2 * min(Math.min(totals["control L rep1"].wall, totals["control L rep2"].wall))}. IC: rep1j ${min(totals.rep1j.wall)}, rep1j3 ${min(totals.rep1j3.wall)}.`, ""]
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
console.log(out.join("\n"))
