// Batch 4 E3 acceptance (BATCH-4 §3 items 1 and 5): each round's package rebuilt by the new code from the run's
// records (the items it carried in as the open items), within its budget, with no model:
// - characters against the line "R3 and later: at most this round's text × 2 + 10k";
// - units across commands: the commands each involves, and those the package's text reaches;
// - every unit the round's review items cite (the reviewer's sentences, as the formalizer resolved them) in a
//   paragraph of the package.
// Usage (dev worktree, after `npm run build`): node exp2/evidence/batch4-2026-10-25/replay-package.mjs <out.md> <run dir> [<run dir> …]
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const V = await import(D + "view.js")
const L = await import(D + "lists.js")
const { untouchedSince } = await import(D + "serial.js")
const [OUT, ...runs] = process.argv.slice(2)
const out = ["# Packages by round under change units (batch 4 E3)", "", "| run | round | package chars (line: R3+ ≤ text × 2 + 10k) | by reason: this round / revised / unit / open item | dropped by the budget | units touched | across commands: delivered / involved | cited units in the package | … in the package or the lists (E4) |", "|---|---|---|---|---|---|---|---|---|"]
const misses = [], missesBoth = []
for (const dir of runs) {
  const run = basename(dir).replace(/^exp2-icacc-r\d-luna56-low-/u, "").replace(/-\d{8}$/u, "")
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const tmp = mkdtempSync(join(tmpdir(), "pkg-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
  const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry()
  const items = new Map(s.executions.flatMap(e => e.review_items ?? []).map(i => [i.id, i]))
  const before = []
  for (const e of [...s.executions].sort((a, b) => a.round - b.round)) {
    const r = e.round
    const facts = [
      ...(e.carried_in ?? []).map(c => { const it = items.get(c.id), g = s.guards.find(x => x.id === c.id); const n = untouchedSince(before, c.id, c.digest); return { id: c.id, kind: "carried", round: it?.round ?? g?.round ?? 0, object: it?.check?.object ?? g?.object ?? null, units: it?.units ?? g?.units ?? [], why: n ? `untouched since R${n}` : "still open" } }),
      ...s.check_runs.filter(x => x.round === r && x.program === `R${r - 1}-final` && x.outcome === "fail").flatMap(x => { const k = s.checks.find(c => c.id === x.check); return k && k.round < r ? [L.checkFact(k)] : [] }),
    ]
    const lists = L.reviewLists(reg, r, facts, before)
    const listed = [...lists.open, ...lists.patrol].flatMap(c => c.texts.map(t => t.paragraph))
    const listedObjects = new Set(lists.patrol.filter(c => c.texts.length).map(c => c.object))
    before.push(e)
    const open = (e.carried_in ?? []).map(c => ({ id: c.id, units: items.get(c.id)?.units ?? s.guards.find(g => g.id === c.id)?.units ?? [] }))
    const fit = V.fitPackage(V.roundPackage(reg, r, open))
    const pkg = fit.pkg, chars = V.renderPackage(pkg).length, text = s.sources.find(x => x.round === r).text.length
    const line = r >= 3 ? `${chars <= text * 2 + 10_000 ? "≤" : "**>**"} ${text * 2 + 10_000}` : "—"
    const sizes = V.packageSizes(pkg)
    const within = (u, p) => reg.lineage(u).some(b => b.id === p) || reg.lineage(p).some(b => b.id === u)
    const cited = (e.review_items ?? []).flatMap(i => i.units.map(u => ({ id: i.id, u })))
    const inPkg = cited.filter(c => pkg.segments.some(sg => within(c.u, sg.paragraph)))
    for (const c of cited.filter(x => !inPkg.includes(x))) misses.push(`${run} R${r} ${c.id}: ${c.u}`)
    // The lists give carried items' paragraphs, and a patrolled command's text in force (whole, within its cap).
    const inBoth = cited.filter(c => inPkg.includes(c) || listed.some(p => within(c.u, p)) || listedObjects.has(reg.coverOf(c.u)?.owner))
    for (const c of cited.filter(x => !inBoth.includes(x))) missesBoth.push(`${run} R${r} ${c.id}: ${c.u}`)
    const cross = pkg.units.cross
    out.push(`| ${run} | ${r} | ${chars} (${line}) | ${sizes["this round"]} / ${sizes.revised} / ${sizes.unit} / ${sizes["open item"]} | ${fit.overflow ? `${fit.overflow.dropped.length}${fit.overflow.still_over ? ", still over" : ""}` : "0"} | ${pkg.units.touched} | ${cross.map(u => `${u.id} ${u.delivered.length}/${u.objects.length}`).join("; ") || "—"} | ${inPkg.length}/${cited.length} | ${inBoth.length}/${cited.length} |`)
  }
}
out.push("", `Cited units not in the package: ${misses.length}`, "", ...misses.map(m => `- ${m}`), "", `Not in the package nor in the lists: ${missesBoth.length}`, "", ...missesBoth.map(m => `- ${m}`))
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
console.log(out.join("\n"))
