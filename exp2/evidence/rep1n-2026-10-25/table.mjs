// rep1n beside its baselines, round by round (the design session's table, 2026-10-25): official score and first
// delivery; flips, superseded guards, reverts; reviews and survivors; the untouched messages, answers and what stayed
// untouched (line 26%); items sent to the reviewer and its word; review request characters, formalizer and reviewer
// uncached tokens; the package; conservation and no_input. Then the failures of chosen rounds by requirement_ref
// (case names only, from the verifier log of the scored commit).
// Usage: node exp2/evidence/rep1n-2026-10-25/table.mjs <out.md> --fail 2,5,6 <run dir> [<run dir> …]  (first run = the run, the rest baselines)
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"

const args = process.argv.slice(2)
const OUT = args.shift()
const fi = args.indexOf("--fail"), failRounds = fi >= 0 ? args.splice(fi, 2)[1].split(",").map(Number) : []
const lines = f => existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : []
const short = d => basename(d).replace(/^exp2-icacc-r\d-luna56-low-/u, "").replace(/-\d{8}$/u, "")
const out = []
const runs = args.map(dir => {
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  return { dir, name: short(dir), s, scores: lines(join(dir, "checkpoints", "scores.jsonl")), measures: lines(join(dir, "checkpoints", "measures.jsonl")) }
})
const rows = []
for (const r of runs) for (const e of [...r.s.executions].sort((a, b) => a.round - b.round)) {
  const n = e.round, a = e.accept ?? {}, m = r.measures.find(x => x.round === n) ?? {}
  const rep = existsSync(join(r.dir, "checkpoints", `round-0${n}`, "report.json")) ? JSON.parse(readFileSync(join(r.dir, "checkpoints", `round-0${n}`, "report.json"), "utf8")) : null
  const final = r.scores.find(x => x.round === n && !x.kind), first = r.scores.find(x => x.round === n && x.kind === "first_delivery")
  const flips = a.guards?.flips ?? [], p = a.repairs
  const words = {}; for (const q of p?.rulings ?? []) words[q.word] = (words[q.word] ?? 0) + 1
  const pkg = rep?.zones?.package
  rows.push({
    run: r.name, round: n, official: final?.passed ?? null, total: final?.total ?? null, first: first?.passed ?? null,
    flips: `${flips.filter(f => f.how === "changed_text").length}/${flips.filter(f => f.how === "regression").length}`, superseded: a.guards?.retired?.length ?? 0, reverted: a.reverted ?? 0,
    reviews: `${a.reviews?.length ?? 0}: ${(a.reviews ?? []).map(v => v.sent ?? v.entered ?? 0).join(",")}`,
    untouched: p ? `${p.untouched_messages} (${p.untouched_items})` : "—",
    answers: p ? `${p.answers.done}/${p.answers.not_done}/${p.answers.disagree}/${p.answers.none}` : "—",
    still: p ? `${p.after_untouched.untouched}/${p.after_untouched.judged}${p.after_untouched.judged ? ` (${Math.round(100 * p.after_untouched.untouched / p.after_untouched.judged)}%)` : ""}` : "—",
    rulings: p ? `${p.rulings.length}${p.rulings.length ? ` (${Object.entries(words).map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}` : "—",
    review_chars: r.s.review_calls.filter(c => c.round === n).reduce((x, c) => x + (c.request_chars ?? 0), 0),
    formalizer: m.tokens?.formalizer?.uncached_input ?? null, reviewer: m.tokens?.reviewer?.uncached_input ?? null,
    package: rep ? `${rep.zones?.source_chars ?? "—"}${pkg?.segments ? ` / ${pkg.segments.length} / ${new Set(pkg.segments.map(x => x.object)).size}` : ""}` : "—",
    conservation: m.items?.conservation_errors ?? null, no_input: m.items?.no_input ?? null,
  })
}
out.push("| run | round | official (first delivery) | flips changed text / regression | guards superseded | reverted | reviews: survivors | untouched messages (items) | answers done / not done / disagree / none | still untouched after (line 26%) | to the reviewer (word) | review request chars | formalizer uncached | reviewer uncached | package chars / paragraphs / objects | conservation / no_input |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for (const n of [...new Set(rows.map(x => x.round))].sort((a, b) => a - b)) for (const x of rows.filter(y => y.round === n)) out.push(`| ${x.run} | R${x.round} | ${x.official ?? "—"}${x.total ? `/${x.total}` : ""} (${x.first ?? "—"}) | ${x.flips} | ${x.superseded} | ${x.reverted} | ${x.reviews} | ${x.untouched} | ${x.answers} | ${x.still} | ${x.rulings} | ${x.review_chars} | ${x.formalizer ?? "—"} | ${x.reviewer ?? "—"} | ${x.package} | ${x.conservation ?? "—"} / ${x.no_input ?? "—"} |`)
// Failures by requirement_ref, from the verifier log of the commit the round was scored on.
for (const n of failRounds) {
  out.push("", `## R${n} failures by requirement_ref`, "")
  for (const r of runs) {
    const final = r.scores.find(x => x.round === n && !x.kind)
    const log = final && join(r.dir, "official", `round-0${n}`, final.commit.slice(0, 12), "verifier.log")
    if (!log || !existsSync(log)) { out.push(`- ${r.name}: not scored`); continue }
    const by = {}
    for (const m of readFileSync(log, "utf8").matchAll(/CASE_RESULT case_id=\S+ origin_step=(\S+) requirement_ref=(\S+)[^\n]*? status=fail\b/gu)) { const k = `${m[1].replace("round-", "R")} ${m[2]}`; by[k] = (by[k] ?? 0) + 1 }
    const total = Object.values(by).reduce((a, b) => a + b, 0)
    out.push(`- ${r.name} (${total}): ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`)
  }
}
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
console.log(out.join("\n"))
