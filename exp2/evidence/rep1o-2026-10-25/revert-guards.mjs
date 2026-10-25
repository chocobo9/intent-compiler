// What the reverted cycles of a run did to the guards that broke (no model): each such guard's check run again on
// the reverted cycle's saved build, with the sentences it rests on and, per failing assertion, the output against the
// expected value. The executor's revert note named only the guard ids.
// Usage (dev worktree, after `npm run build`): node exp2/evidence/rep1o-2026-10-25/revert-guards.mjs <out.md> <run dir>
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
const [OUT, dir] = process.argv.slice(2)
const cfg = JSON.parse(readFileSync(join(dir, "local-config.json"), "utf8"))
const runner = new DockerRunner({ docker: cfg.runner.docker, image: cfg.runner.image, python: cfg.runner.python, graceMs: cfg.runner.graceMs })
const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
const tmp = mkdtempSync(join(tmpdir(), "revg-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry()
const clip = (v, n = 160) => { const t = typeof v === "string" ? v : JSON.stringify(v); return t === undefined ? "—" : t.length > n ? t.slice(0, n) + "…" : t }
const out = ["# Reverted cycles: the guards that broke, run again on the reverted builds", ""]
for (const e of [...s.executions].sort((a, b) => a.round - b.round)) for (const c of e.cycles.filter(x => x.reverted)) {
  const bin = join(dir, "builds", c.id, "dpipe")
  if (!existsSync(bin)) { out.push(`## R${e.round} ${c.id}: no saved build`, ""); continue }
  const program = { id: `${c.id} (replayed)`, label: `saved build of ${c.id}`, command: ["/prog/dpipe"], source_dir: null, mount: { host: join(dir, "builds", c.id), container: "/prog" }, cover: cfg.coverage !== false }
  const gs = c.reverted.guards.map(id => s.guards.find(g => g.id === id))
  const checks = gs.map(g => guardCheck(g, s.checks))
  const runs = await runChecks(checks, program, runner, e.round, reg, codeFacts(reg, e.round), cfg.limits.check_timeout_ms)
  out.push(`## R${e.round} ${c.id} (reverted to ${e.cycles.find(x => x.commit === c.reverted.to)?.id})`, "")
  gs.forEach((g, i) => {
    const k = checks[i], r = runs[i]
    out.push(`- ${g.id} (${k.id}, ${k.object}, born ${g.born.cycle}): \`${k.input.args.join(" ")}\`; rests on ${g.units.join(", ")}. Replayed: ${r.outcome}${r.failure ? ` (${r.failure.class}/${r.failure.reason})` : ""}.`)
    for (const a of r.assertions.filter(x => !x.ok)) { const as = k.assertions.find(x => x.id === a.id); out.push(`  - ${a.id} (${as?.source?.block ?? "—"}, ${as?.source?.kind}): expected ${clip(as?.expect)}, got ${clip(a.actual)}`) }
  })
  out.push("")
}
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
console.log(out.join("\n"))
