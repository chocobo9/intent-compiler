// Batch 2a acceptance: one real review replayed (its reply, the recorded formalizer replies, the reviewer's session
// read from the coding server, the program it reviewed), each item judged under the old blocking tier (with
// input_claim_false) and the new one (DESIGN §12j.3: unit in force, reproduces), and the repair list it would send.
// Usage (dev worktree, after `npm run build`; the run's coding server up, no model call):
//   node exp2/evidence/batch2-2026-10-25/replay-premises.mjs <run dir> <round> <review n> <coding server url> <out dir>
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const P = pathToFileURL(join(process.cwd(), "dist/")).href
const { Exp2Store } = await import(P + "exp2/store.js")
const F = await import(P + "exp2/formalize.js")
const { codeFacts } = await import(P + "exp2/checks.js")
const { DockerRunner, DockerScriptSandbox, dockerGoBuilder } = await import(P + "exp2/docker.js")
const { sessionInput, sessionMaterials } = await import(P + "exp2/materials.js")
const { reviewEntries } = await import(P + "exp2/review.js")
const { renderReviewList } = await import(P + "exp2/accept.js")

const [H, roundArg, nArg, server, OUT] = process.argv.slice(2)
const round = Number(roundArg), n = Number(nArg)
mkdirSync(OUT, { recursive: true })
const cfg = JSON.parse(readFileSync(join(H, "local-config.json"), "utf8"))
const s = JSON.parse(readFileSync(join(H, "state", "exp2-state.json"), "utf8"))
const tmp = mkdtempSync(join(tmpdir(), "b2a-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry(), facts = codeFacts(reg, round)
const rc = s.review_calls.find(c => c.round === round && c.review === n)
const e = s.executions.find(x => x.round === round), cycle = e.cycles.find(c => c.id === rc.cycle)
const get = async p => (await fetch(server + p)).json()
const info = await get(`/session/${rc.session}`)
const m = sessionMaterials(await get(`/session/${rc.session}/message?directory=${encodeURIComponent(info.directory)}`), info.directory)
const leadIds = (cycle.runs ?? []).filter(r => /^K/u.test(r.check) && r.outcome === "fail" && !/timeout/u.test(r.failure ?? "")).map(r => r.check)
const materials = { leads: leadIds.map(id => ({ id, check: s.checks.find(k => k.id === id) })).filter(l => l.check), files: m.files, commands: m.commands }
const recorded = s.formalize_calls.filter(f => f.review === `R${round}.${n}`)
let k = 0
const transport = async () => ({ text: recorded[Math.min(k++, recorded.length - 1)].response_text, usage: { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 }, stub: true, model: "replay" })
const f = await F.formalizeReview(reg, round, rc.response_text, "dpipe", transport, { reviewId: `R${round}.${n}`, callId: x => `X${x}`, materials })
// The program the review saw, built and run in docker as the run did.
const docker = { ...cfg.runner, cover: true }
const runner = new DockerRunner(docker), sandbox = new DockerScriptSandbox(docker)
const wd = join(OUT, "tree"); rmSync(wd, { recursive: true, force: true })
execFileSync("git", ["-C", join(H, "app"), "worktree", "add", "--detach", wd, cycle.commit], { stdio: "ignore" })
const built = dockerGoBuilder(join(OUT, "builds"), docker, undefined, "dpipe")(wd, cycle.id)
if (!built.ok) throw new Error(built.output)
const tiers = { old: new Set(["unit_not_in_force", "not_reproduced", "input_claim_false"]), new: new Set(F.DEFAULT_PREMISE_BLOCK) }
const entries = reviewEntries(rc.response_text), rows = [], sent = { old: [], new: [] }
const quoted = it => entries[it.item - 1]?.replace(/^(?:\d+[.)]|[-*•])\s+/u, "") ?? it.text
for (const it of f.items) {
  if (it.input && it.produced?.length) for (const pr of it.produced) { const o = await runner.run(built.program, sessionInput(pr.by, materials), 60000); if (o.files[pr.path] !== undefined) it.input.files.push({ path: pr.path, content: o.files[pr.path] }) }
  const a = await F.assessPremises(reg, round, it, sandbox, 60000)
  const rep = a.check ? await F.reproduces(F.itemCheckRecord(`V${round}.${n}.${it.item}`, round, it, a.check), built.program, runner, round, reg, facts, 60000) : null
  const row = { id: `V${round}.${n}.${it.item}`, units: it.units.slice(0, 3), premises: a.failures.map(x => x.premise), reproduced: rep ? rep.reproduced : null, recorded: e.review_items.find(x => x.id === `V${round}.${n}.${it.item}`)?.disposition ?? null }
  for (const t of ["old", "new"]) {
    const stop = a.failures.find(x => tiers[t].has(x.premise)), own = a.failures.find(x => !tiers[t].has(x.premise) && F.OWN_FAILURES.has(x.premise))
    row[t] = stop ? `blocked ${stop.premise}` : a.check ? (rep.reproduced ? "sent (verified)" : (tiers[t].has("not_reproduced") ? "blocked not_reproduced" : "logged")) : own ? "fallback" : "sent (words)"
    if (row[t].startsWith("sent") || row[t] === "fallback") sent[t].push({ id: row.id, text: quoted(it) })
  }
  rows.push(row)
}
execFileSync("git", ["-C", join(H, "app"), "worktree", "remove", "--force", wd], { stdio: "ignore" })
const result = { run: s.run_id, round, review: n, cycle: cycle.id, commit: cycle.commit.slice(0, 8), entries: entries.length, items: rows, malformed: f.malformed.length, sent: { old: sent.old.length, new: sent.new.length }, repair_list_new: renderReviewList(sent.new) }
writeFileSync(join(OUT, `R${round}.${n}.json`), JSON.stringify(result, null, 1))
console.log(`${s.run_id} R${round}.${n} on ${cycle.id} (${result.commit}): entries ${entries.length}, items ${rows.length}, malformed ${f.malformed.length}`)
console.log("| item | units | premises failing | reproduced | recorded in the run | old tier | new tier |\n|---|---|---|---|---|---|---|")
for (const r of rows) console.log(`| ${r.id} | ${r.units.join(", ")} | ${r.premises.join(", ") || "—"} | ${r.reproduced} | ${r.recorded} | ${r.old} | ${r.new} |`)
console.log(`sent: old ${sent.old.length}, new ${sent.new.length}`)
