// rep1p (no model): the ingest command's coverage by checks and guards, round by round — every check on the ingest object
// (its round, admission, the sentences it rests on, whether it became a guard, the guard's last status), the guards on
// ingest R6's cycles ran, and the R1 ingest sentences no check ever rested on. For the 8 R1 ingest cases R6 broke
// (case names and requirement_ref only): their cases are listed by name from the verifier logs, never their content.
// Usage (dev worktree, after `npm run build`): node exp2/evidence/rep1p-2026-10-26/ingest-cover.mjs <out.md> <run dir>
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const [OUT, dir] = process.argv.slice(2)
const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
const tmp = mkdtempSync(join(tmpdir(), "ic-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry()
const ingest = [...reg.objects.values()].find(o => ["ingest", "ingest command"].includes(o.name.toLowerCase()))
const out = ["# rep1p: the ingest command's checks and guards", "", `Object: ${ingest.id} ${ingest.name}.`, ""]
const checks = s.checks.filter(k => k.object === ingest.id)
const lastStatus = id => [...s.guard_events].reverse().find(e => e.guard === id)
out.push(`## Checks on ${ingest.id}: ${checks.length}`, "", "| check | round | admission | args | rests on | guard | its last status |", "|---|---|---|---|---|---|---|")
for (const k of checks) {
  const g = s.guards.find(x => x.check === k.id), st = g && lastStatus(g.id)
  out.push(`| ${k.id} | R${k.round} | ${k.admission}${k.admission_reason ? ` (${k.admission_reason})` : ""} | ${k.input.args.slice(0, 3).join(" ")} | ${k.blocks.join(", ")} | ${g?.id ?? "—"} | ${st ? `${st.status} (R${st.round} ${st.cycle ?? ""})` : "—"} |`)
}
const fromReview = s.guards.filter(g => g.source === "review" && g.object === ingest.id)
out.push("", `Guards born from review items on ${ingest.id}: ${fromReview.length}${fromReview.length ? ` (${fromReview.map(g => `${g.id} R${g.round}, last ${lastStatus(g.id)?.status ?? "—"}`).join("; ")})` : ""}.`, "")
// Why a check is no guard: its runs (the library runs once a round on the previous round's final, and on each cycle).
for (const k of checks.filter(k => !s.guards.some(g => g.check === k.id))) {
  const runs = s.check_runs.filter(r => r.check === k.id), ev = s.check_events.filter(e => e.check === k.id)
  const inCycles = s.executions.flatMap(e => e.cycles.flatMap(c => (c.runs ?? []).filter(r => r.check === k.id).map(r => `${c.id} ${r.outcome}${r.failure ? ` (${r.failure})` : ""}`)))
  out.push(`${k.id} is no guard. Library runs: ${runs.map(r => `R${r.round} ${r.program} ${r.outcome}${r.failure ? ` (${r.failure.class}/${r.failure.reason})` : ""}`).join("; ") || "none"}. On cycles: ${inCycles.join("; ") || "none"}. Events: ${ev.map(e => `R${e.round} ${e.status ?? e.kind ?? JSON.stringify(e).slice(0, 60)}`).join("; ") || "none"}.`, "")
}
// R6's cycles: which ingest guards ran there and how.
const e6 = s.executions.find(e => e.round === 6)
const ids = new Set([...checks.map(k => s.guards.find(x => x.check === k.id)?.id), ...fromReview.map(g => g.id)].filter(Boolean))
out.push("## R6's cycles: the ingest guards' runs", "", ...e6.cycles.map(c => `- ${c.id}: ${(c.runs ?? []).filter(r => ids.has(r.check)).map(r => `${r.check} ${r.outcome}`).join(", ") || "none ran"}`), "")
// R1 ingest sentences no check rests on.
const U = await import(D + "units.js")
const leaves = U.leaves(reg, 1).map(b => b.id).filter(id => reg.coverOf(id)?.owner === ingest.id)
const covered = new Set([...s.checks, ...s.guards.filter(g => g.source === "review").map(g => ({ blocks: g.units }))].flatMap(k => k.blocks ?? []))
const isCovered = id => covered.has(id) || reg.lineage(id).some(b => covered.has(b.id)) || [...covered].some(c => c.startsWith(`${id}.`))
const bare = leaves.filter(id => !isCovered(id))
out.push(`## R1 ingest sentences: ${leaves.length}; resting on no check or review guard: ${bare.length}`, "", ...bare.map(id => `- ${id}: ${JSON.stringify(reg.block(id).text.trim().slice(0, 220))}`), "")
// The 8 cases (names only).
const scores = readFileSync(join(dir, "checkpoints", "scores.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l))
const commit = kind => scores.find(x => x.round === 6 && (kind ? x.kind === kind : !x.kind)).commit.slice(0, 12)
const fails = c => new Set([...readFileSync(join(dir, "official", "round-06", c, "verifier.log"), "utf8").matchAll(/CASE_RESULT case_id=(\S+) origin_step=round-0?1 requirement_ref=ingest[^\n]*? status=fail\b/gu)].map(m => m[1]))
const a = fails(commit("first_delivery")), b = fails(commit())
out.push(`## R6: R1 ingest cases failing at the end and not at first delivery: ${[...b].filter(x => !a.has(x)).join(", ")}`, "")
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
console.log(out.join("\n"))
