// The design session's question (2026-10-25): of each run's R2 review findings, how many fall on R1 commands
// (window, aggregate, join, pivot), and in what role the units they cite came in the R2 package the reviewer read —
// this round's text, revised, an edge, an open item, or not in the package. From the runs' state and the package each
// round recorded in its report (rep1j: whole objects with a reason; later runs: paragraphs with a reason). No model.
// Also: the R1 cases still failing at the end of R2 (verifier log of the scored commit, case names only).
// Usage (dev worktree, after `npm run build`): node exp2/evidence/rep1n-2026-10-25/r2-findings-on-r1.mjs <out.md> <run dir> [<run dir> …]
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"

const { Exp2Store } = await import(pathToFileURL(join(process.cwd(), "dist/exp2/store.js")).href)
const [OUT, ...runs] = process.argv.slice(2)
const COMMANDS = /^(window|aggregate|join|pivot)\b/iu, OPS = new Set(["window", "aggregate", "join", "pivot"])
const lines = ["# R2 findings on R1 commands, and how their text came in the R2 package", ""]
const summary = ["| run | R2 findings | on R1 window/aggregate/join/pivot | cited units by role in the package | R1 cases failing at R2 end |", "|---|---|---|---|---|"]
for (const dir of runs) {
  const name = basename(dir).replace(/^exp2-icacc-r\d-luna56-low-/u, "").replace(/-\d{8}$/u, "")
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const tmp = mkdtempSync(join(tmpdir(), "r2f-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
  const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry()
  const pkg = JSON.parse(readFileSync(join(dir, "checkpoints", "round-02", "report.json"), "utf8")).zones.package
  const ownerOf = u => reg.coverOf(u)?.owner
  const nameOf = o => reg.objects.get(o)?.name ?? o
  const roundOfObject = o => Math.min(...(reg.objects.get(o)?.blocks ?? []).map(b => Number(/^R(\d+)/u.exec(b.block)?.[1] ?? 99)))
  // The role a unit came in: the package's paragraph holding it (later runs), or its object's entry (rep1j).
  const role = u => {
    if (pkg?.segments) { const sg = pkg.segments.find(x => u === x.paragraph || u.startsWith(`${x.paragraph}.`)); return sg ? sg.why : "not in package" }
    if (pkg?.objects) { const o = ownerOf(u); const e = pkg.objects.find(x => x.object === o); return e ? `object view (${e.why})` : "not in package" }
    return "no package"
  }
  // The R1 text the R2 package carried, by role: paragraphs of R1 (later runs), or objects holding R1 text (rep1j).
  const r1Roles = p => {
    const by = {}
    if (p?.segments) for (const x of p.segments.filter(x => /^R1\./u.test(x.paragraph))) by[x.why] = (by[x.why] ?? 0) + 1
    else for (const x of p?.objects ?? []) if ((reg.objects.get(x.object)?.blocks ?? []).some(b => /^R1\./u.test(b.block))) by[`object view (${x.why})`] = (by[`object view (${x.why})`] ?? 0) + 1
    return Object.entries(by).map(([k, v]) => `${k} ${v}`).join(", ") || "none"
  }
  const items = s.executions.find(e => e.round === 2)?.review_items ?? []
  // The item's command: the ops of the recipe its check runs (transform), else the operation its text names. Object
  // names are not used for this: rep1j's attribution made one Transformation object for every operation.
  const opsOf = i => {
    const ops = (i.check?.input.files ?? []).filter(f => /\.json$/iu.test(f.path)).flatMap(f => { try { const j = JSON.parse(f.content); return (Array.isArray(j) ? j : j.steps ?? j.operations ?? []).map(x => String(x?.op ?? "")) } catch { return [] } })
    const hit = ops.filter(o => OPS.has(o))
    if (hit.length) return [...new Set(hit)]
    if (ops.length) return []
    return [...new Set([...i.text.matchAll(/\b(window|aggregate|join|pivot)\b/giu)].map(m => m[1].toLowerCase()))]
  }
  const onR1 = items.filter(i => opsOf(i).length)
  const roles = {}
  lines.push(`## ${name}: ${items.length} R2 findings, ${onR1.length} on R1 window/aggregate/join/pivot`, "", "| item | disposition | command | cited units: role in the R2 package | text |", "|---|---|---|---|---|")
  for (const i of onR1) {
    const cited = i.units.map(u => { const r = role(u); roles[r] = (roles[r] ?? 0) + 1; return `${u}: ${r}` })
    const cmds = opsOf(i)
    lines.push(`| ${i.id} | ${i.disposition ?? "—"} | ${cmds.join(", ")} | ${cited.join("; ")} | ${i.text.replace(/\s+/gu, " ").replace(/\|/gu, "\\|").slice(0, 140)} |`)
  }
  // R1 cases failing at R2's end.
  const score = readFileSync(join(dir, "checkpoints", "scores.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l)).find(x => x.round === 2 && !x.kind)
  const log = readFileSync(join(dir, "official", "round-02", score.commit.slice(0, 12), "verifier.log"), "utf8")
  const r1 = {}
  for (const m of log.matchAll(/CASE_RESULT case_id=\S+ origin_step=round-0?1 requirement_ref=(\S+)[^\n]*? status=fail\b/gu)) r1[m[1]] = (r1[m[1]] ?? 0) + 1
  const r1n = Object.values(r1).reduce((a, b) => a + b, 0)
  lines.push("", `R1 cases failing at R2's end: ${r1n} (${Object.entries(r1).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}).`, `R1 text in the R2 package, by role: ${r1Roles(pkg)}.`, "")
  summary.push(`| ${name} | ${items.length} | ${onR1.length} | ${Object.entries(roles).map(([k, v]) => `${k} ${v}`).join(", ") || "—"} | ${r1n} |`)
}
const text = [...lines.slice(0, 2), ...summary, "", ...lines.slice(2)].join("\n") + "\n"
writeFileSync(OUT, text, "utf8")
console.log(text)
