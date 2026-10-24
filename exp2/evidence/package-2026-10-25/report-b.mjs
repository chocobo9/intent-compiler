// Acceptance B of the round-package batch: a run's six rounds against rep1j's, line by line (DESIGN §6c, B row).
// Usage (dev worktree, after `npm run build`): node exp2/evidence/package-2026-10-25/report-b.mjs <run dir> [<baseline run dir>]
// A run dir holds state/exp2-state.json and checkpoints/{scores.jsonl,measures.jsonl}.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const V = await import(D + "view.js")

function load(dir) {
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const lines = f => existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : []
  const scores = lines(join(dir, "checkpoints", "scores.jsonl")).filter(x => !x.kind)
  const measures = lines(join(dir, "checkpoints", "measures.jsonl"))
  const tmp = mkdtempSync(join(tmpdir(), "b-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
  return { s, scores, measures, reg: new Exp2Store(join(tmp, "state"), s.run_id).registry() }
}

function rounds({ s, scores, measures, reg }) {
  const items = s.executions.flatMap(x => x.review_items ?? [])
  return s.executions.sort((a, b) => a.round - b.round).map(e => {
    const r = e.round, m = measures.find(x => x.round === r), rep = s.reports.find(x => x.round === r)
    const flips = (e.accept?.guards.flips ?? []).filter(f => f.how === "regression")
    const reviews = (e.accept?.reviews ?? []).map(v => v.sent ?? v.entered ?? 0)
    // The package as the run built it, again from its state, to see what the budget dropped (kind and characters).
    const open = (e.carried_in ?? []).map(c => ({ id: c.id, units: c.id.startsWith("G") ? s.guards.find(g => g.id === c.id).units : (items.find(x => x.id === c.id)?.units ?? []) }))
    const built = V.roundPackage(reg, r, open), fit = V.fitPackage(built)
    const dropped = built.segments.filter(sg => !fit.pkg.segments.some(k => k.paragraph === sg.paragraph))
    const byWhy = {}
    for (const d of dropped) { byWhy[d.why] ??= { n: 0, chars: 0 }; byWhy[d.why].n++; byWhy[d.why].chars += d.text.length }
    const ingest = items.filter(x => x.round === r && x.units.some(u => (reg.coverOf(u)?.owner ?? "") === (reg.objectByName?.("ingest")?.id ?? reg.coverOf("R1.S2.P4")?.owner)))
    return {
      round: r, official: scores.find(x => x.round === r)?.passed ?? null,
      unchanged_flips: flips.length, unchanged_guards: [...new Set(flips.map(f => f.id))],
      reviews: reviews.length, survivors: reviews,
      review_chars: s.review_calls.filter(c => c.round === r).reduce((n, c) => n + (c.request_chars ?? 0), 0),
      formalizer_uncached: m?.tokens.formalizer.uncached_input ?? null, reviewer_uncached: m?.tokens.reviewer.uncached_input ?? null,
      conservation_errors: m?.items?.conservation_errors ?? null, no_input: m?.items?.no_input ?? null,
      package_chars: rep?.zones.source_chars ?? null, dropped: byWhy,
      ingest_items: ingest.map(x => `${x.id} ${x.disposition}: ${x.text.slice(0, 120).replace(/\s+/gu, " ")}`),
    }
  })
}

const run = rounds(load(process.argv[2]))
const base = process.argv[3] ? rounds(load(process.argv[3])) : []
const b = r => base.find(x => x.round === r) ?? {}
const pct = (a, c) => (a != null && c) ? `${Math.round(100 * (a - c) / c)}%` : "—"
console.log("| round | official (base) | unchanged-text flips (base) | reviews: survivors per review (base) | review request chars (base, change) | formalizer uncached (base, change) | reviewer uncached (base) | conservation errors / no_input | package chars (base) | dropped by the budget |")
console.log("|---|---|---|---|---|---|---|---|---|---|")
for (const x of run) {
  const y = b(x.round)
  console.log(`| R${x.round} | ${x.official} (${y.official ?? "—"}) | ${x.unchanged_flips} ${x.unchanged_guards.join(",")} (${y.unchanged_flips ?? "—"} ${(y.unchanged_guards ?? []).join(",")}) | ${x.reviews}: ${x.survivors.join(",")} (${y.reviews ?? "—"}: ${(y.survivors ?? []).join(",")}) | ${x.review_chars} (${y.review_chars ?? "—"}, ${pct(x.review_chars, y.review_chars)}) | ${x.formalizer_uncached} (${y.formalizer_uncached ?? "—"}, ${pct(x.formalizer_uncached, y.formalizer_uncached)}) | ${x.reviewer_uncached} (${y.reviewer_uncached ?? "—"}) | ${x.conservation_errors} / ${x.no_input} | ${x.package_chars} (${y.package_chars ?? "—"}) | ${Object.entries(x.dropped).map(([k, v]) => `${k} ${v.n} (${v.chars})`).join(", ") || "none"} |`)
}
console.log(JSON.stringify({ ingest: run.map(x => ({ round: x.round, items: x.ingest_items })), base_ingest_r2: b(2).ingest_items ?? [] }, null, 1))
