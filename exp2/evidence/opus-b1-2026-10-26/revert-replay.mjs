// Commit 2 of batch 1 (3129f3d, no revert), supplement 1 (no model, read only; guards run again in each run's docker
// image): every cycle the old rule reverted (revert-cost.json, 24 cycles), under the new rule.
//   raised: the guards that flipped on unchanged text there (the revert's guards), each now a regression item;
//   material: for each, the four parts renderGuardItem gives — its id; the text of the units it rests on (in the
//     registry); its command and input files (the guard's own check or its library check); what the program did against
//     what is expected (the check's expected values, and the output of the guard run again on that cycle's build);
//   sent again: the items the cycle had fixed (revert-cost's lost list: passing on that build) that the next repair
//     message would carry: none, since the build is kept and they pass on it;
//   ids: whether the run's guard ids run G1..Gn with no gap.
// Usage (opus1 worktree, after `npm run build`): node exp2/evidence/opus-b1-2026-10-26/revert-replay.mjs <out.md> <runs dir> <dev dist/exp2 dir> <revert-cost.json>
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const { DockerRunner } = await import(D + "docker.js")
const [OUT, RUNS, DEV, COST] = process.argv.slice(2)
const DevStore = (await import(pathToFileURL(join(DEV, "store.js")).href)).Exp2Store
const rows = (j => Array.isArray(j) ? j : j.rows)(JSON.parse(readFileSync(COST, "utf8")))
const runner = new DockerRunner({ docker: ["docker"], image: "sdd-unattended-preflight:latest", python: "/opt/sdd-python/bin/python3" })
const cache = new Map()
const load = run => {
  if (cache.has(run)) return cache.get(run)
  const name = { rep1j: "rep1j-20261025", rep1n: "rep1n-20261025", rep1o: "rep1o-20261025", rep1j3: "rep1j3-20261026" }[run]
  const dir = join(RUNS, `exp2-icacc-r6-luna56-low-${name}`)
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const tmp = mkdtempSync(join(tmpdir(), "b1r-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
  let reg
  try { reg = new Exp2Store(join(tmp, "state"), s.run_id).registry() } catch { reg = new DevStore(join(tmp, "state"), s.run_id).registry() }
  const ids = s.guards.map(g => Number(g.id.slice(1)))
  const x = { dir, s, reg, contiguous: ids.every((n, i) => n === i + 1) }
  cache.set(run, x)
  return x
}
const md = ["# Commit 2 supplement 1: the cycles the old rule reverted, under the new rule (no revert)", "",
  "raised: guards that flipped on unchanged text (now regression items). Material: the four parts (id; text of the units; command and input files; expected values and the output of the guard run again on that cycle's build, in the run's docker image). Sent again: items the cycle had fixed that the next repair message would carry under the new rule. Ids: the run's guard ids G1..Gn with no gap.", "",
  "| run | round | cycle (old: reverted to) | raised | material complete | missing | fixed on this build (lost before) | sent again now | ids continuous |", "|---|---|---|---|---|---|---|---|---|"]
let total = { raised: 0, complete: 0, lost: 0 }
for (const r of rows) {
  const run = load(r.run)
  const missing = []
  let complete = 0
  for (const gid of r.guards) {
    const g = run.s.guards.find(x => x.id === gid)
    const k = g?.source === "library" ? run.s.checks.find(c => c.id === g.check) : null
    const input = g?.input ?? k?.input, assertions = g?.assertions ?? k?.assertions ?? []
    const parts = []
    if (!g) parts.push("guard not in the state")
    else {
      if (!g.units.length || !g.units.every(u => run.reg.block(u.split("#")[0])?.text?.trim())) parts.push("unit text")
      if (!input?.args?.length) parts.push("command")
      if (!assertions.length || assertions.some(a => a.expect === undefined)) parts.push("expected values")
      const build = join(run.dir, "builds", r.cycle, "dpipe")
      if (!existsSync(build)) parts.push("build of the cycle")
      else if (input) {
        const out = await runner.run({ kind: "built", id: r.cycle, label: r.cycle, command: ["/prog/dpipe"], source_dir: run.dir, mount: { host: join(run.dir, "builds", r.cycle), container: "/prog" } }, input, 30_000)
        if (out.timed_out || out.exit_code === null) parts.push("output (the run again did not finish)")
      }
    }
    if (parts.length) missing.push(`${gid}: ${parts.join(", ")}`); else complete++
  }
  total.raised += r.guards.length; total.complete += complete; total.lost += r.lost.length
  md.push(`| ${r.run} | R${r.round} | ${r.cycle} (${r.kept}) | ${r.guards.length} | ${complete}/${r.guards.length} | ${missing.join("; ") || "none"} | ${r.lost.length} | 0 | ${run.contiguous ? "yes" : "no"} |`)
  console.log(md.at(-1))
}
md.push("", `Total: ${rows.length} cycles; raised ${total.raised}, material complete ${total.complete}/${total.raised}; items fixed on those builds ${total.lost}, sent again under the new rule 0 (the build is kept, and they pass on it, as revert-cost.json ran them).`)
writeFileSync(OUT, md.join("\n") + "\n", "utf8")
console.log(md.at(-1))
