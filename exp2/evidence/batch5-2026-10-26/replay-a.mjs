// Batch 5 A offline (no model): what the new rule does at each recorded reverted cycle. The first reverted cycle of a
// round is where the runs part: under the new rule it is kept, so the items fixed on its build (failing on the build it
// was reverted to) stay fixed, and the next repair message holds the regressions with their material and the items
// still failing. The later reverted cycles of the round started from the reverted tree: they do not exist under the new
// rule, and what would happen there depends on the executor (a real run). Built on revert-cost.json (rep1o evidence).
// The next message is rendered for the first reverted cycle of each rep1o round.
// Usage (dev worktree, after `npm run build`): node exp2/evidence/batch5-2026-10-26/replay-a.mjs <out.md> <revert-cost.json> <runs dir>
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const { DockerRunner } = await import(D + "docker.js")
const { runChecks } = await import(D + "verdict.js")
const { codeFacts } = await import(D + "checks.js")
const { guardCheck } = await import(D + "guards.js")
const { renderGuardItem, renderReviewList } = await import(D + "accept.js")
const { repairFromReview } = await import(D + "review.js")
const [OUT, COST, RUNS] = process.argv.slice(2)
const rows = JSON.parse(readFileSync(COST, "utf8"))
const dirOf = run => join(RUNS, `exp2-icacc-r6-luna56-low-${run}-20261025`)
const out = ["# Batch 5 A on the recorded reverted cycles", "", "| run | round | reverted cycle | under the new rule | items fixed on its build, kept | regressions sent with material (four parts) | items still failing, sent again |", "|---|---|---|---|---|---|---|"]
const firstOf = new Map()
for (const r of rows) { const k = `${r.run} R${r.round}`; if (!firstOf.has(k)) firstOf.set(k, r.cycle) }
const messages = []
let kept = 0, lost = new Set(rows.flatMap(r => r.lost.map(i => `${r.run} R${r.round} ${i}`))).size
for (const r of rows) {
  const first = firstOf.get(`${r.run} R${r.round}`) === r.cycle
  if (!first) { out.push(`| ${r.run} | R${r.round} | ${r.cycle} | does not exist (it started from the reverted tree) | — | — | — |`); continue }
  kept += r.lost.length
  let parts = "—"
  if (r.run === "rep1o") {
    const dir = dirOf(r.run), cfg = JSON.parse(readFileSync(join(dir, "local-config.json"), "utf8"))
    const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
    const tmp = mkdtempSync(join(tmpdir(), "b5a-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
    const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry()
    const runner = new DockerRunner({ docker: cfg.runner.docker, image: cfg.runner.image, python: cfg.runner.python, graceMs: cfg.runner.graceMs })
    const host = join(dir, "builds", r.cycle)
    const program = { id: `${r.cycle} (replayed)`, label: `saved build of ${r.cycle}`, command: ["/prog/dpipe"], source_dir: null, mount: { host, container: "/prog" }, cover: cfg.coverage !== false }
    const gs = r.guards.map(id => s.guards.find(g => g.id === id))
    const runs = existsSync(join(host, "dpipe")) ? await runChecks(gs.map(g => guardCheck(g, s.checks)), program, runner, r.round, reg, codeFacts(reg, r.round), cfg.limits.check_timeout_ms) : []
    const reg_items = gs.map((g, i) => ({ id: g.id, text: renderGuardItem(g, guardCheck(g, s.checks), runs[i], reg) }))
    const items = new Map(s.executions.flatMap(e => e.review_items ?? []).map(i => [i.id, i]))
    const again = r.both_fail.map(id => ({ id, text: items.get(id)?.text ?? s.guards.find(g => g.id === id)?.origin?.text ?? id }))
    const msg = repairFromReview(renderReviewList([...reg_items, ...again]), [])
    const four = reg_items.filter(x => /fails now \(G\d+\)\.\nRequirement: \S[^]*\nCommand: \[.*\]; input files: [^]*\nWhat the program did: exit -?\d+;.*expected .*, got /u.test(x.text)).length
    const fixedIn = r.lost.filter(id => msg.includes(`(${id})`) || again.some(a => a.id === id))
    parts = `${r.guards.length} (${four}/${reg_items.length})`
    messages.push(`## ${r.run} R${r.round}: the message after ${r.cycle} under the new rule`, "", `Regressions ${reg_items.map(x => x.id).join(", ")}; items still failing ${again.length}; items fixed on ${r.cycle} named in it: ${fixedIn.length}.`, "", "```", msg.length > 6000 ? msg.slice(0, 6000) + `\n… (${msg.length} characters)` : msg, "```", "")
  }
  out.push(`| ${r.run} | R${r.round} | ${r.cycle} | kept | ${r.lost.length} | ${r.run === "rep1o" ? parts : `${r.guards.length}`} | ${r.both_fail.length} |`)
}
out.push("", `Recorded reverted cycles: ${rows.length}; under the new rule none is reverted. The first of each round (${firstOf.size}) is kept: ${kept} items fixed on its build stay fixed. Of the ${lost} items the reverts threw away (distinct within a round), the other ${lost - kept} were fixed on later reverted cycles, which under the new rule do not exist: what happens there needs a real run.`, "", ...messages)
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
console.log(out.slice(0, out.indexOf(messages[0] ?? "") >= 0 ? out.indexOf(messages[0]) : out.length).join("\n"))
