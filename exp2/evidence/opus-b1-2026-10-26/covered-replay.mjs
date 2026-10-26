// Before the rerun (Opus): opusb2 R1's COVERED lines bound again with the fixed parser (ea404cd), through the whole
// binding (bindCovered: scope check, conflict with the reply's deviations, two runs again alike). For each R1 review:
// its reply; its runs from the reviewer's session (OpenCode's local store, read only); the program reviewed (the
// cycle's build, run in the run's docker image); the scope owed then: R1's behaviour sentences not held by a guard
// passing before that review's cycle ended (recorded guard events), less the sentences guards bound by earlier
// reviews' replays here. The recorded run gave 5 guards and 11 sentences.
// Usage (opus1 worktree, after `npm run build`): node exp2/evidence/opus-b1-2026-10-26/covered-replay.mjs <out.md> <run dir>
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { pathToFileURL } from "node:url"

const P = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(P + "store.js")
const V = await import(P + "verification.js")
const C = await import(P + "covered.js")
const { sessionMaterials } = await import(P + "materials.js")
const { reviewEntries } = await import(P + "review.js")
const { DockerRunner } = await import(P + "docker.js")
const [OUT, D] = process.argv.slice(2)
const s = JSON.parse(readFileSync(join(D, "state", "exp2-state.json"), "utf8"))
const tmp = mkdtempSync(join(tmpdir(), "covr-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry()
const db = new DatabaseSync(join(homedir(), ".local/share/opencode/opencode-local.db"), { readOnly: true })
const msgQ = db.prepare("select id, data from message where session_id = ? order by time_created"), partQ = db.prepare("select data from part where message_id = ? order by id")
const session = id => msgQ.all(id).map(m => ({ info: JSON.parse(m.data), parts: partQ.all(m.id).map(p => JSON.parse(p.data)) }))
const runner = new DockerRunner({ docker: ["docker"], image: "sdd-unattended-preflight:latest", python: "/opt/sdd-python/bin/python3" })
const round = 1
const scope = V.sentencesInForce(reg, round).filter(b => b.round === round && !V.ruleNotBehaviour(reg, b)).map(b => b.id)
const cycles = s.executions.find(x => x.round === round).cycles.map(c => c.id)
const heldBy = cycle => {
  const upTo = new Set(cycles.slice(0, cycles.indexOf(cycle) + 1))
  const ev = s.guard_events.filter(e => e.round === round && upTo.has(e.cycle))
  const status = new Map(); for (const e of [...s.guard_events.filter(e => e.round < round), ...ev]) status.set(e.guard, e.status)
  const live = s.guards.filter(g => status.get(g.id) === "passing" && !g.snapshot)
  return new Set(scope.filter(id => live.some(g => g.units.some(u => V.coversSentence(reg, C.coveredIds(u)[0] ?? u, id)))))
}
let next = 1000
const bound = new Set(), rows = []
for (const call of s.review_calls.filter(c => c.round === round && c.valid).sort((a, b) => a.review - b.review)) {
  const held = heldBy(call.cycle)
  const open = new Set(scope.filter(id => !held.has(id) && !bound.has(id)))
  const runs = C.reviewerRuns(sessionMaterials(session(call.session)), "dpipe")
  const program = { kind: "built", id: call.cycle, label: call.cycle, command: ["/prog/dpipe"], source_dir: D, mount: { host: join(D, "builds", call.cycle), container: "/prog" } }
  const b = await C.bindCovered(call.response_text, runs, { registry: reg, round, review: `R1.${call.review}`, cycle: call.cycle, program, runner, timeoutMs: 30_000, open, nextGuard: () => `G${next++}`, findings: reviewEntries(call.response_text) })
  for (const g of b.guards) for (const u of g.units) bound.add(u)
  const sm = C.summarizeCovered(b.records)
  rows.push(`| R1.${call.review} | ${call.cycle} | ${runs.length} | ${open.size} | ${sm.lines} | ${sm.guards} | ${sm.bound} | ${sm.unstable} | ${sm.conflicts} | ${sm.no_scope_sentence} | ${Object.entries(sm.ignored).map(([k, n]) => `${k} ${n}`).join(", ") || "none"} |`)
}
const recorded = s.executions.find(x => x.round === round).accept.covered ?? []
const was = C.summarizeCovered(recorded)
const md = ["# opusb2 R1's COVERED lines, bound again with the fixed parser (ea404cd)", "",
  `Recorded (the run's parser): ${was.lines} lines, ${was.guards} guards, ${was.bound} sentences bound; set aside ${JSON.stringify(was.ignored)}.`, "",
  "| review | program | runs in the session | scope owed then | lines | guards | sentences bound | unstable | conflicts | no scope sentence | ids set aside |", "|---|---|---|---|---|---|---|---|---|---|---|", ...rows, "",
  `Replayed: ${[...bound].length} sentences bound in all, of ${scope.length} behaviour sentences in R1's scope.`]
writeFileSync(OUT, md.join("\n") + "\n", "utf8")
console.log(md.join("\n"))
