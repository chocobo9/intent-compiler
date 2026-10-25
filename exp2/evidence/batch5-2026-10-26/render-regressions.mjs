// Batch 5 B (no model): the regressions behind rep1o's reverted cycles, rendered as the repair item the executor gets
// (`renderGuardItem`), from each guard's check run again on the reverted cycle's saved build. Each item is checked for
// the four parts: the guard's id, the requirement's text it rests on, the command with its input files, and what the
// program output against what is expected.
// Usage (dev worktree, after `npm run build`): node exp2/evidence/batch5-2026-10-26/render-regressions.mjs <out.md> <run dir>
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
const { renderGuardItem } = await import(D + "accept.js")
const [OUT, dir] = process.argv.slice(2)
const cfg = JSON.parse(readFileSync(join(dir, "local-config.json"), "utf8"))
const runner = new DockerRunner({ docker: cfg.runner.docker, image: cfg.runner.image, python: cfg.runner.python, graceMs: cfg.runner.graceMs })
const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
const tmp = mkdtempSync(join(tmpdir(), "b5b-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry()
const parts = (t, g) => ({ id: t.includes(`(${g.id})`), requirement: /^Requirement: \S/mu.test(t), command: /^Command: \[.*\]; input files: \S/mu.test(t), output: /^What the program did: exit -?\d+;.*expected .*, got /mu.test(t) })
const out = ["# rep1o's regressions as repair items (batch 5 B)", "", "| cycle | guard | id | requirement | command and input | output vs expected |", "|---|---|---|---|---|---|"]
const shown = []
let all = 0, full = 0
for (const e of [...s.executions].sort((a, b) => a.round - b.round)) for (const c of e.cycles.filter(x => x.reverted)) {
  const host = join(dir, "builds", c.id)
  if (!existsSync(join(host, "dpipe"))) { out.push(`| ${c.id} | no saved build | | | | |`); continue }
  const program = { id: `${c.id} (replayed)`, label: `saved build of ${c.id}`, command: ["/prog/dpipe"], source_dir: null, mount: { host, container: "/prog" }, cover: cfg.coverage !== false }
  const gs = c.reverted.guards.map(id => s.guards.find(g => g.id === id))
  const runs = await runChecks(gs.map(g => guardCheck(g, s.checks)), program, runner, e.round, reg, codeFacts(reg, e.round), cfg.limits.check_timeout_ms)
  gs.forEach((g, i) => {
    const t = renderGuardItem(g, guardCheck(g, s.checks), runs[i], reg), p = parts(t, g)
    all++; if (Object.values(p).every(Boolean)) full++
    out.push(`| ${c.id} | ${g.id} | ${p.id ? "yes" : "no"} | ${p.requirement ? "yes" : "no"} | ${p.command ? "yes" : "no"} | ${p.output ? "yes" : "no"} |`)
    if (["C2.3", "C3.2", "C4.2"].includes(c.id) && i === 0) shown.push(`## ${c.id} ${g.id}`, "", "```", t, "```", "")
  })
}
out.push("", `Regressions rendered: ${all}; with all four parts: ${full}.`, "", "Three of them as the executor would read them:", "", ...shown)
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
console.log(out.slice(0, out.indexOf("Three of them as the executor would read them:") + 1).join("\n"))
