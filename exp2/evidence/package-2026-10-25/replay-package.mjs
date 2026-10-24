// Acceptance A of the round-package batch (DESIGN §6c, the package's revision of 2026-10-25): rep1j's six rounds,
// the new package built from the run's own state, against the package the run had (reports[].zones.package).
// Usage (from the dev worktree, after `npm run build`): node exp2/evidence/package-2026-10-25/replay-package.mjs <rep1j exp2-state.json>
// Utilization, both grains, by one rule (the design session's Q3): the numerator is the review items of the round
// (all its reviews) with disposition "sent"; their units give the objects (registry.coverOf → owner) and the
// paragraphs (the package paragraphs a unit is in or holds). The denominator is the package's objects / paragraphs.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const V = await import(D + "view.js")
const { liveGuards } = await import(D + "guards.js")
const { packageUse } = await import(D + "report.js")

const s = JSON.parse(readFileSync(process.argv[2], "utf8"))
const dir = mkdtempSync(join(tmpdir(), "pkg-replay-"))
mkdirSync(join(dir, "state"))
writeFileSync(join(dir, "state", "exp2-state.json"), JSON.stringify(s))
const reg = new Exp2Store(join(dir, "state"), s.run_id).registry()
const items = s.executions.flatMap(x => x.review_items ?? [])
const owner = u => { const o = reg.coverOf(u)?.owner; return o && o !== "none" ? o : null }
const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : "—"

const rows = []
for (const e of s.executions.sort((a, b) => a.round - b.round)) {
  const r = e.round
  const open = (e.carried_in ?? []).map(c => ({ id: c.id, units: c.id.startsWith("G") ? s.guards.find(g => g.id === c.id).units : (items.find(x => x.id === c.id)?.units ?? []) }))
  const built = V.roundPackage(reg, r, open)
  // The guards on the package's objects (the work order's protection zone); with batch P2, the comparisons instead.
  const guards = liveGuards(s.guards.filter(g => g.round < r), s.guard_events.filter(x => x.round < r))
  if (V.packageComparisons) built.comparisons = V.packageComparisons(reg, r, guards, s.checks, new Map())
  const { pkg, overflow } = V.fitPackage(built)
  const objects = new Set(pkg.segments.map(x => x.object))
  const listed = guards.filter(g => g.units.some(u => objects.has(owner(u) ?? ""))).length
  // The report's own measure (report.ts packageUse), on the new package and on rep1j's (objects only).
  const round = items.filter(x => x.round === r)
  const use = packageUse(reg, pkg.segments, round)
  const before = s.reports.find(x => x.round === r)?.zones.package?.objects?.map(o => o.object) ?? []
  const was = packageUse(reg, before.map(o => ({ object: o, paragraph: "" })), round)
  const sizes = V.packageSizes(pkg), text = reg.sources.get(r).text.length
  rows.push({
    round: r, text, bar: 2 * text + 10_000, chars: sizes.total, sizes, paragraphs: pkg.segments.length, objects: objects.size, heads: pkg.heads.length,
    edges: pkg.edges, guards_listed: listed, comparisons: pkg.comparisons.length, overflow,
    cited_objects: use.objects.cited, cited_in_package: use.objects.in_package, missing: use.objects.missing,
    utilization_objects: pct(use.objects.in_package, use.objects.total), utilization_paragraphs: pct(use.paragraphs.cited, use.paragraphs.total),
    baseline: { chars: s.reports.find(x => x.round === r)?.zones.source_chars, objects: before.length, utilization_objects: pct(was.objects.in_package, was.objects.total) },
  })
}
console.log("| round | this round's text | bar (2× + 10k) | package chars (rep1j) | this round / revised / edge / open item / comparisons | paragraphs | objects (rep1j) | heads | edges to block / object | guards: listed on package objects / comparisons | utilization objects (rep1j, same rule) | utilization paragraphs | cited objects in package |")
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for (const x of rows) console.log(`| R${x.round} | ${x.text} | ${x.bar} | ${x.chars} (${x.baseline.chars}) | ${x.sizes["this round"]} / ${x.sizes.revised} / ${x.sizes.edge} / ${x.sizes["open item"]} / ${x.sizes.comparisons} | ${x.paragraphs} | ${x.objects} (${x.baseline.objects}) | ${x.heads} | ${x.edges.to_block} / ${x.edges.to_object} | ${x.guards_listed} / ${x.comparisons} | ${x.utilization_objects} (${x.baseline.utilization_objects}) | ${x.utilization_paragraphs} | ${x.cited_in_package}/${x.cited_objects.length} |`)
console.log(JSON.stringify(rows.map(x => ({ round: x.round, cited: x.cited_objects, missing: x.missing, overflow: x.overflow }))))
