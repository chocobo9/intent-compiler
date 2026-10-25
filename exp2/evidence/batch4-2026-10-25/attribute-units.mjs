// Batch 4 E1b acceptance: the attribution step alone, with the new request (unit candidates) and answer (units in
// place of object edges), on real text, through the run's management model. No executor, reviewer or check writer.
// - run:<run dir>:<round>  — the run's accepted rounds before <round> as they were, then <round> attributed anew;
// - task:<name>:<task dir>:<last round>  — a task from round 1, each round's steps/round-N/instruction.md (no tests).
// Each call's tokens are recorded. Usage (dev worktree, after `npm run build`, the management server of <config> up):
//   node exp2/evidence/batch4-2026-10-25/attribute-units.mjs <config> <out dir> <job> [<job> …]
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const { loadLocalConfig, attributionTransportOf } = await import(D + "local-config.js")
const [CONFIG, OUT, ...jobs] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const transport = attributionTransportOf(loadLocalConfig(CONFIG))
const results = []
const describe = (reg, round) => reg.units(round).filter(u => u.round === round && u.source !== "revision").map(u => ({ id: u.id, source: u.source, name: u.name, members: u.members, objects: u.objects.map(o => reg.objects.get(o)?.name ?? o), cue: u.cue?.kind ?? null }))
async function attribute(store, round, text, label) {
  const t0 = Date.now()
  const rec = await store.ingestRound(round, text, transport, { maxRepairs: 2 })
  const s = store.inspect(), calls = s.calls.filter(c => rec.calls.includes(c.id))
  const reg = store.registry()
  const answerUnits = rec.acceptance?.answer.units ?? []
  const r = {
    job: label, round, status: rec.status, seconds: Math.round((Date.now() - t0) / 1000), calls: calls.length,
    tokens: calls.map(c => ({ id: c.id, kind: c.kind, input: c.usage.input_tokens, cache_read: c.usage.cache_read_tokens, output: c.usage.output_tokens, reasoning: c.usage.reasoning_tokens, issues: c.issues.map(i => i.code) })),
    candidates: calls[0]?.request.unit_candidates?.length ?? null,
    answer_units: answerUnits,
    units: rec.status === "accepted" ? describe(reg, round) : [],
    unit_scope: rec.status === "accepted" ? reg.roundScope(round).filter(c => c.types.includes("unit")).map(c => reg.objects.get(c.object)?.name ?? c.object) : [],
  }
  results.push(r)
  console.log(`${label} R${round}: ${r.status}, ${r.calls} calls (${r.tokens.map(t => `${t.kind} in ${t.input} cache ${t.cache_read} out ${t.output}`).join("; ")}); candidates ${r.candidates}; answer units ${answerUnits.length}; units ${r.units.map(u => `${u.id} ${u.source} [${u.objects.join(", ")}]`).join("; ") || "none"}; in scope by a unit: ${r.unit_scope.join(", ") || "none"}`)
  return rec
}
for (const job of jobs) {
  const [kind, ...rest] = job.split("|")
  if (kind === "run") {
    const [dir, roundArg] = rest, round = Number(roundArg)
    const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
    const keep = x => x.round < round
    const seeded = { profile: s.profile, run_id: s.run_id, ...(s.ablation ? { ablation: s.ablation } : {}), sources: s.sources.filter(keep), calls: s.calls.filter(keep), rounds: s.rounds.filter(keep), signals: [] }
    const tmp = mkdtempSync(join(tmpdir(), "attr-")); writeFileSync(join(tmp, "exp2-state.json"), JSON.stringify(seeded))
    await attribute(new Exp2Store(tmp, s.run_id), round, s.sources.find(x => x.round === round).text, `${s.run_id.replace(/^exp2-icacc-r\d-luna56-low-/u, "").replace(/-\d{8}$/u, "")}`)
  } else if (kind === "task") {
    const [name, dir, lastArg] = rest
    const store = new Exp2Store(mkdtempSync(join(tmpdir(), "attr-task-")), `batch4-${name}`)
    for (let r = 1; r <= Number(lastArg); r++) {
      const rec = await attribute(store, r, readFileSync(join(dir, "steps", `round-${r}`, "instruction.md"), "utf8"), name)
      if (rec.status !== "accepted") break
    }
  }
  writeFileSync(join(OUT, "attribute-units.json"), JSON.stringify(results, null, 1) + "\n", "utf8")
}
const total = results.flatMap(r => r.tokens).reduce((a, t) => ({ input: a.input + t.input, cache_read: a.cache_read + t.cache_read, output: a.output + t.output, calls: a.calls + 1 }), { input: 0, cache_read: 0, output: 0, calls: 0 })
console.log(`total: ${total.calls} calls, input ${total.input}, cache read ${total.cache_read}, output ${total.output}`)
writeFileSync(join(OUT, "attribute-units.json"), JSON.stringify({ results, total }, null, 1) + "\n", "utf8")
