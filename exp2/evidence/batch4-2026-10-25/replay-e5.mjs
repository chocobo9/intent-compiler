// Batch 4 E5: the report's new numbers on the runs' records, by the new code, no model — this round's change units
// by source and revisions by provenance; the lists (open, patrol, across commands, global) and the review items of the
// round on listed commands (what the lists could have brought: the runs' reviewers did not have the lists); scope
// declarations; the package's characters by reason; units across commands delivered / involved.
// Usage (dev worktree, after `npm run build`): node exp2/evidence/batch4-2026-10-25/replay-e5.mjs <out.md> <run dir> [<run dir> …]
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const L = await import(D + "lists.js")
const V = await import(D + "view.js")
const R = await import(D + "report.js")
const U = await import(D + "units.js")
const { untouchedSince } = await import(D + "serial.js")
const [OUT, ...runs] = process.argv.slice(2)
const out = ["# Batch 4 E5: the report's new numbers, replayed on the runs' records", "", "| run | round | units: cue / model / revision / guard (global) | revisions: cue / inferred | lists: open / patrol / across / global | items on listed commands | scope declarations | package: this round / revised / unit / open item | across commands delivered / involved |", "|---|---|---|---|---|---|---|---|---|"]
const sum = { items: 0, onListed: 0 }
for (const dir of runs) {
  const run = basename(dir).replace(/^exp2-icacc-r\d-luna56-low-/u, "").replace(/-\d{8}$/u, "")
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const tmp = mkdtempSync(join(tmpdir(), "e5-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
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
    const listed = new Set([...lists.open, ...lists.patrol].map(c => c.object))
    const roundItems = (e.review_items ?? []).filter(i => i.round === r)
    const on = roundItems.filter(i => L.objectsOfItem(reg, { units: i.units }).some(o => listed.has(o)))
    sum.items += roundItems.length; sum.onListed += on.length
    const c = R.changeUnitsOf(reg, r, s.checks.filter(k => k.round === r).length)
    const open = (e.carried_in ?? []).map(x => ({ id: x.id, units: items.get(x.id)?.units ?? s.guards.find(g => g.id === x.id)?.units ?? [] }))
    const pkg = V.fitPackage(V.roundPackage(reg, r, open)).pkg, z = V.packageSizes(pkg)
    out.push(`| ${run} | ${r} | ${c.by_source.cue} / ${c.by_source.model} / ${c.by_source.revision} / ${c.by_source.guard} (${c.global}) | ${c.provenance.cue} / ${c.provenance.inferred} | ${lists.open.length} / ${lists.patrol.length} / ${lists.cross.length} / ${lists.global.length} | ${on.length}/${roundItems.length} | ${U.scopeDeclarations(reg, r).length} | ${z["this round"]} / ${z.revised} / ${z.unit} / ${z["open item"]} | ${pkg.units.cross.map(u => `${u.delivered.length}/${u.objects.length}`).join(", ") || "—"} |`)
    before.push(e)
  }
}
out.push("", `Review items on a command the lists would have named that round: ${sum.onListed}/${sum.items}. The runs' reviewers had no lists; this counts where the lists would have pointed, not what they found.`)
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
console.log(out.join("\n"))
