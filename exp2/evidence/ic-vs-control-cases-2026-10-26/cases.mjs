// IC against the control group case by case (no model; case names, origin_step and requirement_ref only): at each
// round's end, A = failing in the IC run and passing in both control runs (L rep1, rep2); B = failing in both control
// runs and passing in IC; C = failing in all three. A by requirement_ref and origin, and by the ledger's kinds
// (exp2/evidence/prereg/ledger.mjs, prereg.mjs's one definition) for the A cases that also failed at the round's first
// delivery; the A cases that passed at first delivery and failed at the end are counted apart.
// The control's round end: official/round-NN (one commit a round). IC's: the commit scores.jsonl names.
// Usage (dev worktree): node exp2/evidence/ic-vs-control-cases-2026-10-26/cases.mjs <out dir> <runs dir>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { kindOf, readCases } from "../prereg/ledger.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const [OUT, RUNS] = process.argv.slice(2)
const costRows = JSON.parse(readFileSync(join(HERE, "..", "rep1o-2026-10-25", "revert-cost.json"), "utf8"))
const ctrlDirs = readdirSync(RUNS).filter(d => /^exp2-review15-luna56-low-revmed-rep\d-dpipe-20261022$/u.test(d)).sort()
const ctrlEnd = (d, r) => { const dir = join(RUNS, d, "official", `round-${String(r).padStart(2, "0")}`); const sub = existsSync(dir) ? readdirSync(dir) : []; return sub.length === 1 ? readCases(join(dir, sub[0], "verifier.log")) : null }
const ics = readdirSync(RUNS).filter(d => /^exp2-icacc-r6-luna56-low-rep1(?:[jknopq]|j3)-2026102\d$/u.test(d)).sort()
const KINDS = ["i", "ii", "iii", "iv", "other"]
const summary = ["# IC against the control group, case by case at each round's end", "", `Control: ${ctrlDirs.join(", ")}. A: IC fails, both control runs pass. B: both control runs fail, IC passes. C: all three fail.`, "", "| run | round | A | B | C | A failing at first delivery: i / ii / iii / iv / other | A passing at first delivery |", "|---|---|---|---|---|---|---|"]
for (const d of ics) {
  const dir = join(RUNS, d), run = d.match(/rep1[a-z]\d?/u)[0]
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const scores = readFileSync(join(dir, "checkpoints", "scores.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l))
  const md = [`# ${run}: IC against the control group, case by case at each round's end`, "", `Control: ${ctrlDirs.join(", ")}.`, ""]
  for (const e of [...s.executions].sort((a, b) => a.round - b.round)) {
    const r = e.round, fin = scores.find(x => x.round === r && !x.kind), first = scores.find(x => x.round === r && x.kind === "first_delivery")
    if (!fin) continue
    const log = c => join(dir, "official", `round-0${r}`, c.commit.slice(0, 12), "verifier.log")
    const ic = readCases(log(fin)), icFirst = first ? readCases(log(first)) : new Map(), ctrl = ctrlDirs.map(c => ctrlEnd(c, r))
    if (ctrl.some(x => !x)) continue
    const fails = (m, id) => m.has(id) && !m.get(id).ok, passes = (m, id) => m.has(id) && m.get(id).ok
    const ids = [...ic.keys()]
    const A = ids.filter(id => fails(ic, id) && ctrl.every(m => passes(m, id))), B = ids.filter(id => passes(ic, id) && ctrl.every(m => fails(m, id))), C = ids.filter(id => fails(ic, id) && ctrl.every(m => fails(m, id)))
    const kind = kindOf(e, r, run, costRows)
    const aStuck = A.filter(id => fails(icFirst, id)), aBroke = A.filter(id => passes(icFirst, id))
    const k = Object.fromEntries(KINDS.map(x => [x, []])); for (const id of aStuck) k[kind(ic.get(id))].push(id)
    const byRef = {}; for (const id of A) { const c = ic.get(id), key = `R${c.origin || "base"} ${c.ref}`; (byRef[key] ??= []).push(id) }
    md.push(`## R${r}: A ${A.length}, B ${B.length}, C ${C.length}`, "",
      `- A by origin and requirement_ref: ${Object.entries(byRef).sort((a, b) => b[1].length - a[1].length).map(([key, v]) => `${key} ${v.length}`).join("; ") || "none"}.`,
      `- A failing at first delivery, by kind: ${KINDS.map(x => `${x} ${k[x].length}`).join(", ")}; A passing at first delivery (broken during the round): ${aBroke.length}.`,
      ...KINDS.filter(x => k[x].length).map(x => `  - ${x}: ${k[x].join(", ")}`),
      ...(aBroke.length ? [`  - passing at first delivery: ${aBroke.join(", ")}`] : []),
      `- A: ${A.join(", ") || "none"}`, `- B: ${B.join(", ") || "none"}`, `- C: ${C.join(", ") || "none"}`, "")
    summary.push(`| ${run} | R${r} | ${A.length} | ${B.length} | ${C.length} | ${KINDS.map(x => k[x].length).join(" / ")} | ${aBroke.length} |`)
  }
  writeFileSync(join(OUT, `${run}.md`), md.join("\n") + "\n", "utf8")
}
writeFileSync(join(OUT, "summary.md"), summary.join("\n") + "\n", "utf8")
console.log(summary.join("\n"))
