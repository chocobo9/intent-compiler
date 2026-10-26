// Batch 1 of DESIGN-OPUS-2026-10-26, commit 8 (no model, read only; programs of the runs run again locally): on the
// reviewer sessions of recorded runs (OpenCode's local store, opened read-only), the runs of the program code can take
// out of a session (reviewerRuns: numbered, their input files from the session's writes), and how many give the
// session's output again when run twice on the program reviewed (the cycle's build). Old sessions have no COVERED lines,
// so which sentences a run would bind cannot be measured here.
// Usage (opus1 worktree, after `npm run build`): node exp2/evidence/opus-b1-2026-10-26/session-runs.mjs <out.md> <runs dir> <run name>...
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { sessionMaterials } = await import(D + "materials.js")
const { reviewerRuns, sameOutput } = await import(D + "covered.js")
const { programArgs } = await import(D + "materials.js")
const { DockerRunner } = await import(D + "docker.js")
const [OUT, RUNS, ...NAMES] = process.argv.slice(2)
const db = new DatabaseSync(join(homedir(), ".local/share/opencode/opencode-local.db"), { readOnly: true })
const msgQ = db.prepare("select id, data from message where session_id = ? order by time_created"), partQ = db.prepare("select data from part where message_id = ? order by id")
const session = id => msgQ.all(id).map(m => ({ info: JSON.parse(m.data), parts: partQ.all(m.id).map(p => JSON.parse(p.data)) }))
// The runs' programs are Linux builds made for the target environment: run in the run's own image, as the run did.
const runner = new DockerRunner({ docker: ["docker"], image: "sdd-unattended-preflight:latest", python: "/opt/sdd-python/bin/python3" })
const md = ["# Batch 1, commit 8: the reviewer's runs in recorded sessions, and whether they run again the same", "",
  "Per run: reviews with a session in the store; runs of the program code takes out of them; of those, the ones whose program build is at hand; run again twice on it: both the same as the session's output (stable), the first the same and the second not (unstable), the first not the same (not reproduced), the host refusing the program (blocked). The programs run in the run's docker image.", "",
  "| run | reviews | with session | runs taken | run again | stable | unstable | not reproduced | blocked | compound command | empty session output | two reruns alike |", "|---|---|---|---|---|---|---|---|---|---|---|---|"]
for (const name of NAMES) {
  const dir = join(RUNS, `exp2-icacc-r6-luna56-low-${name}`)
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const n = { reviews: 0, sessions: 0, runs: 0, rerun: 0, stable: 0, unstable: 0, not: 0, blocked: 0, compound: 0, empty: 0, twice: 0 }
  for (const c of s.review_calls.filter(x => x.valid && x.session)) {
    n.reviews++
    const msgs = session(c.session)
    if (!msgs.length) continue
    n.sessions++
    const runs = reviewerRuns(sessionMaterials(msgs), "dpipe")
    n.runs += runs.length
    const exe = [join(dir, "builds", c.cycle, "dpipe")].find(existsSync)
    if (!exe) continue
    // As dockerGoBuilder gives it: the build directory mounted at /prog.
    const program = { kind: "built", id: c.cycle, label: c.cycle, command: ["/prog/dpipe"], source_dir: dir, mount: { host: join(dir, "builds", c.cycle), container: "/prog" } }
    const mat = sessionMaterials(msgs)
    for (const r of runs) {
      n.rerun++
      // How the session ran it: the program's call alone, or a command with more in it (a shell's echo of the exit code, a pipe, a second command).
      const raw = mat.commands.filter(x => programArgs(x.command, "dpipe")).at(r.n - 1)?.command ?? ""
      if (/;|&&|||||/u.test(raw.replace(/^&s+/u, ""))) n.compound++
      if (!r.output.trim()) n.empty++
      try {
        const a = await runner.run(program, r.input, 10_000)
        if (!sameOutput(r.output, a)) { n.not++; continue }
        const b = await runner.run(program, r.input, 10_000)
        if (sameOutput(r.output, b)) n.stable++; else n.unstable++
        continue
      } catch (e) { if (/blocked|spawn UNKNOWN/u.test(String(e))) { n.blocked++; continue } else throw e }
    }
    // Run again twice, the two compared with each other only (not with the session).
    for (const r of runs) {
      try {
        const a = await runner.run(program, r.input, 10_000), b = await runner.run(program, r.input, 10_000)
        if (a.exit_code === b.exit_code && a.stdout === b.stdout && a.stderr === b.stderr && JSON.stringify(a.files) === JSON.stringify(b.files)) n.twice++
      } catch (e) { if (/blocked|spawn UNKNOWN/u.test(String(e))) n.blocked++; else throw e }
    }
  }
  md.push(`| ${name.split("-")[0]} | ${n.reviews} | ${n.sessions} | ${n.runs} | ${n.rerun} | ${n.stable} (${n.rerun ? Math.round(100 * n.stable / n.rerun) : 0}%) | ${n.unstable} | ${n.not} | ${n.blocked} | ${n.compound} | ${n.empty} | ${n.twice} |`)
  console.log(md.at(-1))
}
writeFileSync(OUT, md.join("\n") + "\n", "utf8")
