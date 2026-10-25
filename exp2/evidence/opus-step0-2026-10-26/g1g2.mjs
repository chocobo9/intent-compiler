// Step 0 of DESIGN-OPUS-2026-10-26 (no model, read only), G1 and G2.
// A sentence (a leaf: a sentence, or a paragraph without sentences) is held at a round's end when a guard alive at that
// end (its last event up to the round is "passing") rests on it. A guard rests on a unit: the units it was born with
// (a library guard: its check's blocks; a review guard: its units). Two readings of "rests on":
//   strict: the unit is the sentence or one of its clauses;
//   loose:  also a paragraph or section the sentence is in (a check citing a whole paragraph covers its sentences).
// G1: for chosen objects and rounds, the object's sentences held / all, both readings.
// G2: at R6, the debt: sentences no guard holds (loose and strict) and no open item rests on (the round's final items:
//     their checks' blocks, or the guard's units), by count and characters; and 20 debt sentences drawn at even steps
//     for a by-hand reading.
// Usage (dev worktree, after `npm run build`): node exp2/evidence/opus-step0-2026-10-26/g1g2.mjs <out.md> <runs dir>
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const U = await import(D + "units.js")
const [OUT, RUNS] = process.argv.slice(2)
const load = name => {
  const dir = join(RUNS, `exp2-icacc-r6-luna56-low-${name}`)
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const tmp = mkdtempSync(join(tmpdir(), "g1-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
  return { name, s, reg: new Exp2Store(join(tmp, "state"), s.run_id).registry() }
}
const unitsOf = (s, g) => g.source === "library" ? s.checks.find(k => k.id === g.check)?.blocks ?? [] : g.units ?? []
const alive = (s, r) => s.guards.filter(g => g.round <= r && ([...s.guard_events].filter(e => e.guard === g.id && e.round <= r).at(-1)?.status === "passing"))
const leavesUpTo = (reg, r) => { const out = []; for (let k = 1; k <= r; k++) out.push(...U.leaves(reg, k)); return out }
const heldBy = (reg, units) => {
  const set = new Set(units)
  return {
    strict: id => set.has(id) || [...set].some(u => u.startsWith(`${id}.`)),
    loose: id => set.has(id) || [...set].some(u => u.startsWith(`${id}.`)) || reg.lineage(id).some(b => set.has(b.id)),
  }
}
const objectNamed = (reg, re) => [...reg.objects.values()].find(o => re.test(o.name))
const md = ["# Step 0: G1 (sentences held by passing checks) and G2 (verification debt at R6)", "",
  "A sentence is held at a round's end when a guard alive then (last event up to the round: passing) rests on it. strict: the guard's units name the sentence or a clause of it. loose: also its paragraph or section.", ""]
// G1.
md.push("## G1: the object's sentences held / all, by round", "", "| run | object | round | sentences | held (strict) | held (loose) | not held (strict) |", "|---|---|---|---|---|---|---|")
const g1 = [["rep1n-20261025", /^window/iu, [2, 3, 4, 5, 6]], ["rep1p-20261026", /^validate/iu, [4, 5, 6]], ["rep1q-20261026", /^validate/iu, [4, 5]], ["rep1p-20261026", /^ingest/iu, [1, 2, 3, 4, 5, 6]], ["rep1q-20261026", /^ingest/iu, [1, 2, 3, 4, 5]]]
const cache = {}
for (const [name, re, rounds] of g1) {
  const run = cache[name] ??= load(name), o = objectNamed(run.reg, re)
  for (const r of rounds) {
    const sentences = leavesUpTo(run.reg, r).map(b => b.id).filter(id => run.reg.coverOf(id)?.owner === o.id)
    const h = heldBy(run.reg, alive(run.s, r).flatMap(g => unitsOf(run.s, g)))
    md.push(`| ${name.split("-")[0]} | ${o.id} ${o.name} | R${r} | ${sentences.length} | ${sentences.filter(h.strict).length} | ${sentences.filter(h.loose).length} | ${sentences.filter(id => !h.strict(id)).length} |`)
  }
}
md.push("")
// G2.
md.push("## G2: the debt at R6 (no guard holds it, no open item rests on it)", "", "| run | round | sentences | characters | debt (strict): sentences / characters | debt (loose): sentences / characters | open items' sentences |", "|---|---|---|---|---|---|---|")
const samples = []
for (const name of ["rep1n-20261025", "rep1p-20261026", "rep1q-20261026"]) {
  const run = cache[name] ??= load(name)
  const r = Math.max(...run.s.executions.map(e => e.round)), e = run.s.executions.find(x => x.round === r)
  const items = new Map(run.s.executions.flatMap(x => x.review_items ?? []).map(i => [i.id, i]))
  const openUnits = (e.final ?? []).flatMap(f => { const g = run.s.guards.find(x => x.id === f.id); return g ? unitsOf(run.s, g) : items.get(f.id)?.check?.blocks ?? items.get(f.id)?.units ?? [] })
  const open = heldBy(run.reg, openUnits).loose
  const leaves = leavesUpTo(run.reg, r), h = heldBy(run.reg, alive(run.s, r).flatMap(g => unitsOf(run.s, g)))
  const len = id => run.reg.block(id)?.text.length ?? 0, sum = ids => ids.reduce((a, id) => a + len(id), 0)
  const debtS = leaves.map(b => b.id).filter(id => !h.strict(id) && !open(id)), debtL = leaves.map(b => b.id).filter(id => !h.loose(id) && !open(id))
  md.push(`| ${name.split("-")[0]} | R${r} | ${leaves.length} | ${sum(leaves.map(b => b.id)).toLocaleString("en-US")} | ${debtS.length} / ${sum(debtS).toLocaleString("en-US")} | ${debtL.length} / ${sum(debtL).toLocaleString("en-US")} | ${leaves.filter(b => open(b.id)).length} |`)
  if (name.startsWith("rep1p")) { const step = Math.floor(debtS.length / 20); for (let i = 0; i < 20; i++) { const id = debtS[i * step]; samples.push({ id, text: run.reg.block(id).text.trim().replace(/\s+/gu, " ").slice(0, 240) }) } }
}
md.push("", "## G2: 20 debt sentences of rep1p R6 (strict), drawn at even steps, for the by-hand reading", "", "| # | sentence | text |", "|---|---|---|", ...samples.map((x, i) => `| ${i + 1} | ${x.id} | ${x.text.replace(/\|/gu, "\\|")} |`), "")
writeFileSync(OUT, md.join("\n") + "\n", "utf8")
console.log(md.join("\n"))
