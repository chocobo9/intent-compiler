// Batch 4 acceptance 4: each run's recorded revisions of a round relabelled by provenance (units.ts: a revision cue
// in the new text → cue, else inferred), each checked against the gold set: a revision is on gold when its new text is in,
// or holds, the paragraph of a gold revision sentence of that round (a section-level revision holds the paragraph). No model.
// Usage (dev worktree, after `npm run build`): node exp2/evidence/batch4-2026-10-25/provenance.mjs <out.md> <round> <run dir> [<run dir> …]
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const U = await import(D + "units.js")
const G = await import(D + "gold.js")
const [OUT, roundArg, ...runs] = process.argv.slice(2)
const round = Number(roundArg)
const out = [`# Revision provenance, round ${round} (batch 4, acceptance 4)`, "", "| run | revisions | cue | cue on gold | inferred | inferred on gold |", "|---|---|---|---|---|---|"]
const detail = []
for (const dir of runs) {
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const tmp = mkdtempSync(join(tmpdir(), "prov-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
  const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry()
  const gold = G.loadGold(G.GOLD_DIR, "deterministic-data-pipeline-go")
  const para = id => reg.lineage(id).find(b => b.level === "paragraph" || b.level === "section")?.id
  const goldParas = gold.revisions.filter(e => e.round === round).map(e => G.locate(reg, round, e.sentence)).filter(Boolean).map(para)
  const mods = [...reg.objects.values()].flatMap(o => o.blocks.flatMap(b => b.modifications.filter(m => m.round === round)))
  const rows = mods.map(m => ({ m, p: U.provenance(reg, m), onGold: m.by.some(u => goldParas.some(g => reg.lineage(u).some(x => x.id === g) || reg.lineage(g).some(x => x.id === u))) }))
  const n = (f) => rows.filter(f).length
  const name = basename(dir).replace(/^exp2-icacc-r\d-luna56-low-/u, "").replace(/-\d{8}$/u, "")
  out.push(`| ${name} | ${rows.length} | ${n(r => r.p.kind === "cue")} | ${n(r => r.p.kind === "cue" && r.onGold)} | ${n(r => r.p.kind === "inferred")} | ${n(r => r.p.kind === "inferred" && r.onGold)} |`)
  for (const r of rows) detail.push(`| ${name} | ${r.m.kind} | ${r.m.parts.join(", ")} → ${r.m.by.join(", ")} | ${r.p.kind}${r.p.kind === "cue" ? ` (${JSON.stringify(r.p.text)})` : ""} | ${r.onGold ? "yes" : "no"} |`)
}
out.push("", `Gold revisions of round ${round} in this task: ${JSON.parse(readFileSync(join("exp2", "evidence", "corpus-scan-2026-10-23", "revision-gold.json"), "utf8")).filter(e => e.task === "deterministic-data-pipeline-go" && e.round === round).length}.`, "", "| run | kind | parts → by | provenance | on gold |", "|---|---|---|---|---|", ...detail)
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
console.log(out.join("\n"))
