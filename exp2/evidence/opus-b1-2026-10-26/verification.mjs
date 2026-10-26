// Batch 1 of DESIGN-OPUS-2026-10-26, commit 3 (no model, read only): the verification state per sentence on recorded
// runs, round by round. For each round r: the guards, guard events, checks and check events of rounds up to r; the
// open items those of R(r)'s final list. Reports nominal against passing coverage (acceptance item v), the debt, and
// what entered and left it against R(r-1).
// Runs recorded on the dev line (rep1o, rep1p, rep1q: attribution by change units) need that line's registry: give
// its built dist as a third argument; the verification functions are this branch's either way.
// Usage (opus1 worktree, after `npm run build`): node exp2/evidence/opus-b1-2026-10-26/verification.mjs <out.md> <runs dir> [<dev dist/exp2 dir>]
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const V = await import(D + "verification.js")
const [OUT, RUNS, DEV] = process.argv.slice(2)
const DevStore = DEV ? (await import(pathToFileURL(join(DEV, "store.js")).href)).Exp2Store : null
const RUN_NAMES = ["rep1j-20261025", "rep1k-20261025", "rep1n-20261025", "rep1o-20261025", "rep1p-20261026", "rep1q-20261026", "rep1j3-20261026"]
const load = name => {
  const dir = join(RUNS, `exp2-icacc-r6-luna56-low-${name}`)
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const tmp = mkdtempSync(join(tmpdir(), "b1v-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
  let reg, via = "this branch"
  try { reg = new Exp2Store(join(tmp, "state"), s.run_id).registry() } catch (e) { if (!DevStore) throw e; reg = new DevStore(join(tmp, "state"), s.run_id).registry(); via = "the dev line" }
  return { name, s, reg, via }
}
const upTo = (s, r) => ({ guards: s.guards.filter(g => g.round <= r), guardEvents: s.guard_events.filter(e => e.round <= r), library: s.checks.filter(k => k.round <= r), checkEvents: s.check_events.filter(e => e.round <= r) })
const openAt = (s, r) => {
  const e = s.executions.find(x => x.round === r)
  const items = new Map(s.executions.flatMap(x => x.review_items ?? []).map(i => [i.id, i]))
  return (e?.final ?? []).map(f => ({ id: f.id, units: s.guards.find(g => g.id === f.id)?.units ?? items.get(f.id)?.check?.blocks ?? items.get(f.id)?.units ?? [] }))
}
const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : "—"
const md = ["# Batch 1, commit 3: the verification state per sentence on recorded runs", "",
  "Per round's end: sentences in force; held (a passing guard names the sentence or a clause of it); nominal (any live guard or active check cites it, its paragraph or its section); debt (not held, no open item covers it, not behaviour by rule). Entered/cleared: against the previous round's end.", "",
  "| run | round | sentences | behaviour | nominal | passing | gap nominal−passing | never passed | open | debt sentences | debt paragraphs | debt characters | entered | cleared | not behaviour by rule |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
const data = {}
for (const name of RUN_NAMES) {
  let run
  try { run = load(name) } catch (e) { md.push(`| ${name} | — | not readable: ${String(e.message).slice(0, 80)} |`); continue }
  const rounds = [...new Set(run.s.executions.map(e => e.round))].sort((a, b) => a - b)
  let before
  data[name] = []
  for (const r of rounds) {
    const states = V.verificationStates(run.reg, r, { ...upTo(run.s, r), open: openAt(run.s, r) })
    const v = V.summarizeVerification(run.reg, r, states, before)
    before = states
    data[name].push(v)
    const c = v.coverage, rules = Object.entries(v.not_behaviour.by_rule).map(([k, n]) => `${k} ${n}`).join(", ")
    md.push(`| ${name.split("-")[0]}${run.via === "the dev line" ? "*" : ""} | R${r} | ${v.sentences} | ${c.behaviour} | ${c.nominal} (${pct(c.nominal, c.behaviour)}) | ${c.passing} (${pct(c.passing, c.behaviour)}) | ${c.nominal - c.passing} | ${v.never_passed} | ${v.open} | ${v.debt.sentences} | ${v.debt.paragraphs} | ${v.debt.chars.toLocaleString("en-US")} | ${v.delta?.entered ?? "—"} | ${v.delta?.cleared ?? "—"} | ${rules} |`)
  }
}
md.push("", "* registry built by the dev line's code (its attribution format); verification by this branch's.", "", "<!-- data: " + JSON.stringify(data) + " -->")
writeFileSync(OUT, md.join("\n") + "\n", "utf8")
console.log(md.slice(0, -1).join("\n"))
