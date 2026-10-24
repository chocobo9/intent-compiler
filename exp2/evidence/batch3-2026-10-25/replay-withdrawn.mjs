// Batch 3b acceptance: checks written as "withdrawn" are read as every check is (their assertions state what the text
// in force requires). From the runs' state and git history, no model:
// - every run: the library checks written as withdrawn, and the guards born from them (the guards the change touches);
// - the run named by --replay (rep1j): each cycle of the given rounds rebuilt in docker as the run built it, those
//   checks run on it as they are now read, beside what the run recorded (born as a guard, the reverts it caused).
// Usage (dev worktree, after `npm run build`):
//   node exp2/evidence/batch3-2026-10-25/replay-withdrawn.mjs <out dir> --replay <run dir> --rounds 5,6 <run dir> [<run dir> …]
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const { codeFacts } = await import(D + "checks.js")
const { runChecks } = await import(D + "verdict.js")
const { DockerRunner, dockerGoBuilder } = await import(D + "docker.js")

const args = process.argv.slice(2)
const OUT = args.shift()
const opt = name => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v }
const replay = opt("--replay"), rounds = (opt("--rounds") ?? "").split(",").filter(Boolean).map(Number)
mkdirSync(OUT, { recursive: true })
const short = dir => basename(dir).replace(/^exp2-icacc-/u, "").replace(/luna56-low-/u, "").replace(/-\d{8}$/u, "")
const state = dir => JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
const lines = ["# Checks written as withdrawn, read as stating the requirement (batch 3b)", "", "| run | library checks | written as withdrawn | guards born from them |", "|---|---|---|---|"]
const scan = []
for (const dir of [...new Set([...args, ...(replay ? [replay] : [])])]) {
  const s = state(dir), w = s.checks.filter(k => k.direction === "withdrawn"), gs = s.guards.filter(g => g.source === "library" && w.some(k => k.id === g.check))
  scan.push({ run: short(dir), checks: s.checks.length, withdrawn: w.map(k => k.id), guards: gs.map(g => `${g.id} (from ${g.check}, born ${g.born.cycle})`) })
  lines.push(`| ${short(dir)} | ${s.checks.length} | ${w.map(k => k.id).join(", ") || "none"} | ${gs.map(g => `${g.id} from ${g.check}, born ${g.born.cycle}`).join("; ") || "none"} |`)
}
const cycles = []
if (replay) {
  const s = state(replay), cfg = JSON.parse(readFileSync(join(replay, "local-config.json"), "utf8"))
  const tmp = mkdtempSync(join(tmpdir(), "b3b-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
  const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry()
  const docker = { ...cfg.runner, cover: false }, runner = new DockerRunner(docker)
  const withdrawn = s.checks.filter(k => k.direction === "withdrawn")
  const born = new Map(s.guards.filter(g => withdrawn.some(k => k.id === g.check)).map(g => [g.born.cycle, g.id]))
  lines.push("", `## ${short(replay)}: each cycle's program, the withdrawn checks as now read`, "", "| cycle | message | built | " + withdrawn.map(k => `${k.id} now`).join(" | ") + " | recorded: guard born here | recorded: reverted, breaking guards |", "|---|---|---|" + withdrawn.map(() => "---").join("|") + "|---|---|")
  for (const e of s.executions.filter(x => rounds.includes(x.round))) {
    const facts = codeFacts(reg, e.round)
    for (const c of e.cycles) {
      const row = { cycle: c.id, message: c.message, built: c.build?.ok !== false, now: {}, born: born.get(c.id) ?? null, reverted: c.reverted ? c.reverted.guards : null }
      if (row.built) {
        const wd = join(tmp, "tree"); rmSync(wd, { recursive: true, force: true })
        execFileSync("git", ["-C", join(replay, "app"), "worktree", "add", "--detach", wd, c.commit], { stdio: "ignore" })
        const b = dockerGoBuilder(join(tmp, "builds"), docker, undefined, cfg.binary ?? "dpipe")(wd, c.id)
        if (!b.ok) row.built = false
        else {
          // The runner reads the program's source (its string literals): the tree stays until the checks ran.
          const runs = await runChecks(withdrawn, b.program, runner, e.round, reg, facts, 60_000)
          for (const r of runs) row.now[r.check] = { outcome: r.outcome, assertions: r.assertions.map(a => `${a.id}=${JSON.stringify(a.actual)}${a.ok ? "" : " (no)"}`).join(", ") }
        }
        execFileSync("git", ["-C", join(replay, "app"), "worktree", "remove", "--force", wd], { stdio: "ignore" })
      }
      cycles.push(row)
      lines.push(`| ${c.id} | ${c.message} | ${row.built ? "yes" : "no"} | ${withdrawn.map(k => row.now[k.id] ? `${row.now[k.id].outcome}: ${row.now[k.id].assertions}` : "—").join(" | ")} | ${row.born ?? ""} | ${row.reverted ? row.reverted.join(", ") : ""} |`)
    }
  }
  rmSync(tmp, { recursive: true, force: true })
}
writeFileSync(join(OUT, "withdrawn.md"), lines.join("\n") + "\n", "utf8")
writeFileSync(join(OUT, "withdrawn.json"), JSON.stringify({ scan, cycles }, null, 1) + "\n", "utf8")
console.log(lines.join("\n"))
