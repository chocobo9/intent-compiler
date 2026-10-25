// What "one guard regression reverts the whole cycle" cost (design session, 2026-10-25; no model): for every reverted
// repair cycle of each run, the items sent in it are run again (their checks, by the new code's runner) on the
// cycle's own saved build and on the build it was reverted to. An item fixed by output = its check passes on the
// reverted build and fails on the kept one: a repair the revert threw away.
// Usage (dev worktree, after `npm run build`; docker as in the run's config):
//   node exp2/evidence/rep1o-2026-10-25/revert-cost.mjs <out.md> <out.json> <run dir> [<run dir> …]
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const { DockerRunner } = await import(D + "docker.js")
const { runChecks } = await import(D + "verdict.js")
const { codeFacts } = await import(D + "checks.js")
const { guardCheck } = await import(D + "guards.js")
const [OUT, JSON_OUT, ...runs] = process.argv.slice(2)
const short = d => basename(d).replace(/^exp2-icacc-r\d-luna56-low-/u, "").replace(/-\d{8}$/u, "")
const out = ["# Whole-cycle reverts: the repairs thrown away", "", "| run | cycle | guards that broke | items sent in it | with a check | fixed on the reverted build, failing on the kept one | failing on both | passing on both | not run |", "|---|---|---|---|---|---|---|---|---|"]
const rows = [], total = { cycles: 0, rounds: new Set(), sent: 0, checked: 0, lost: 0 }
for (const dir of runs) {
  const run = short(dir)
  const cfg = JSON.parse(readFileSync(join(dir, "local-config.json"), "utf8"))
  const runner = new DockerRunner({ docker: cfg.runner.docker, image: cfg.runner.image, python: cfg.runner.python, graceMs: cfg.runner.graceMs })
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const tmp = mkdtempSync(join(tmpdir(), "revert-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
  const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry()
  const items = new Map(s.executions.flatMap(e => e.review_items ?? []).map(i => [i.id, i]))
  const checkOf = id => {
    if (/^G\d/u.test(id)) { const g = s.guards.find(x => x.id === id); return g ? { ...guardCheck(g, s.checks), id } : null }
    const it = items.get(id); return it?.check ? { id, round: it.round, key: id, object: it.check.object ?? null, blocks: it.units ?? [], uses: [], unknown: [], ...it.check } : null
  }
  const program = cycle => {
    const bin = join(dir, "builds", cycle, "dpipe")
    return existsSync(bin) ? { id: `${cycle} (replayed)`, label: `saved build of ${cycle}`, command: ["/prog/dpipe"], source_dir: null, mount: { host: join(dir, "builds", cycle), container: "/prog" }, cover: cfg.coverage !== false } : null
  }
  for (const e of [...s.executions].sort((a, b) => a.round - b.round)) for (const c of e.cycles.filter(x => x.reverted)) {
    const kept = e.cycles.find(x => x.commit === c.reverted.to)
    const sent = c.reverted.resent ?? []
    const checks = sent.map(checkOf).filter(Boolean)
    const pr = program(c.id), pk = kept && program(kept.id)
    const row = { run, round: e.round, cycle: c.id, kept: kept?.id ?? null, guards: c.reverted.guards, sent: sent.length, checked: checks.length, lost: [], both_fail: [], both_pass: [], not_run: [] }
    if (pr && pk && checks.length) {
      const facts = codeFacts(reg, e.round)
      const a = await runChecks(checks, pr, runner, e.round, reg, facts, cfg.limits.check_timeout_ms)
      const b = await runChecks(checks, pk, runner, e.round, reg, facts, cfg.limits.check_timeout_ms)
      checks.forEach((k, i) => {
        const x = a[i].outcome, y = b[i].outcome
        if (x === "pass" && y === "fail") row.lost.push(k.id); else if (x === "fail" && y === "fail") row.both_fail.push(k.id); else if (x === "pass" && y === "pass") row.both_pass.push(k.id); else row.not_run.push(`${k.id} ${x}/${y}`)
      })
    } else row.not_run.push(!pr ? `no build of ${c.id}` : !pk ? "no kept build" : "no checks")
    rows.push(row)
    total.cycles++; total.rounds.add(`${run} R${e.round}`); total.sent += row.sent; total.checked += row.checked; total.lost += row.lost.length
    out.push(`| ${run} | R${e.round} ${c.id} (kept ${row.kept}) | ${row.guards.join(", ")} | ${row.sent} | ${row.checked} | ${row.lost.length}${row.lost.length ? ` (${row.lost.join(", ")})` : ""} | ${row.both_fail.length} | ${row.both_pass.length} | ${row.not_run.join("; ") || 0} |`)
    console.log(out.at(-1))
  }
}
out.push("", `Reverted repair cycles: ${total.cycles}, in ${total.rounds.size} rounds. Items sent in them: ${total.sent} (${total.checked} with a check). Fixed by output on the reverted build and failing on the kept one: ${total.lost}.`)
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1) + "\n", "utf8")
console.log(out.at(-1))
