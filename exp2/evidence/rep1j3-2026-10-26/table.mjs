// rep1j3 (rep1j's code a second time, + [mech] path fix) beside rep1j, the control group L (rep1, rep2) and the bare model (rep1, rep2),
// R1–R6, three things only (the design session, 2026-10-26): the official score at first delivery and at the round's
// end; the non-executor tokens (uncached input + 0.1 × cache read + output, IC's non_executor_cost; the control: every
// role but the executor in its session_tokens; the bare model has none); conservation errors and no_input (IC only).
// The bare model delivers once a round: its first delivery is its end.
// Usage: node exp2/evidence/rep1j3-2026-10-26/table.mjs <out.md> <runs dir>
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [OUT, RUNS] = process.argv.slice(2)
const lines = f => existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : []
const ROUNDS = [1, 2, 3, 4, 5, 6]
const cols = []
for (const [name, d] of [["rep1j3", "exp2-icacc-r6-luna56-low-rep1j3-20261026"], ["rep1j", "exp2-icacc-r6-luna56-low-rep1j-20261025"]]) {
  const sc = lines(join(RUNS, d, "checkpoints", "scores.jsonl")), ms = lines(join(RUNS, d, "checkpoints", "measures.jsonl"))
  cols.push({ name, rows: Object.fromEntries(ROUNDS.map(r => { const e = sc.find(x => x.round === r && !x.kind), f = sc.find(x => x.round === r && x.kind === "first_delivery"), m = ms.find(x => x.round === r); return [r, { first: f?.passed, end: e?.passed, total: e?.total, cost: m?.non_executor_cost, cons: m?.items?.conservation_errors, noi: m?.items?.no_input }] })) })
}
for (const k of [1, 2]) {
  const d = `exp2-review15-luna56-low-revmed-rep${k}-dpipe-20261022`
  const sc = lines(join(RUNS, d, "logs", "scores.jsonl")), fd = lines(join(RUNS, d, "logs", "scores-diag-first.jsonl")), ev = lines(join(RUNS, d, "logs", "review.jsonl")).filter(x => x.event === "session_tokens")
  cols.push({ name: `control L rep${k}`, rows: Object.fromEntries(ROUNDS.map(r => {
    const e = sc.filter(x => x.round === r).at(-1), f = fd.filter(x => x.round === r).at(-1), t = ev.filter(x => x.round === r).at(-1)
    const cost = t ? t.tokens.filter(x => x.role !== "executor").reduce((a, x) => a + x.input + 0.1 * x.cache_read + x.output, 0) : undefined
    return [r, { first: f?.diag?.passed ?? f?.passed, end: e?.passed, total: e?.total, cost: cost === undefined ? undefined : Math.round(cost) }]
  })) })
}
for (const k of [1, 2]) {
  // Where the official score and the diagnostic one (the host Go module cache mounted) differ, both are shown.
  const d = `exp2-bare15-luna56-low-rep${k}-dpipe-20261022`, sc = lines(join(RUNS, d, "logs", "scores.jsonl")), dg = lines(join(RUNS, d, "logs", "scores-diag.jsonl"))
  cols.push({ name: `bare rep${k}`, rows: Object.fromEntries(ROUNDS.map(r => { const e = sc.filter(x => x.round === r).at(-1), g = dg.filter(x => x.round === r).at(-1)?.diag?.passed; const end = e && g !== undefined && g !== e.passed ? `${e.passed} (diag ${g})` : e?.passed; return [r, { first: end, end, total: e?.total, cost: 0 }] })) })
}
const v = x => x === undefined || x === null ? "—" : typeof x === "number" ? x.toLocaleString("en-US") : String(x)
const out = ["# rep1j3 beside rep1j, the control group L and the bare model, R1–R6", "",
  "Official score: first delivery → round's end (the control's first delivery from its diag-first scorer, the same tests with the host Go module cache; its ends agree with official-diag in every round). Non-executor tokens: uncached input + 0.1 × cache read + output.", "",
  "## Official score (first → end / cases)", "", `| round | ${cols.map(c => c.name).join(" | ")} |`, `|---|${cols.map(() => "---").join("|")}|`,
  ...ROUNDS.map(r => `| R${r} | ${cols.map(c => { const x = c.rows[r]; return x.end === undefined ? "—" : `${v(x.first)} → ${v(x.end)} / ${v(x.total)}` }).join(" | ")} |`), "",
  "## Non-executor tokens", "", `| round | ${cols.map(c => c.name).join(" | ")} |`, `|---|${cols.map(() => "---").join("|")}|`,
  ...ROUNDS.map(r => `| R${r} | ${cols.map(c => v(c.rows[r].cost)).join(" | ")} |`),
  `| total | ${cols.map(c => v(ROUNDS.reduce((a, r) => a + (c.rows[r].cost ?? 0), 0))).join(" | ")} |`, "",
  "## Conservation errors / no_input (IC)", "", "| round | rep1j3 | rep1j |", "|---|---|---|",
  ...ROUNDS.map(r => `| R${r} | ${v(cols[0].rows[r].cons)} / ${v(cols[0].rows[r].noi)} | ${v(cols[1].rows[r].cons)} / ${v(cols[1].rows[r].noi)} |`), ""]
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
console.log(out.join("\n"))
