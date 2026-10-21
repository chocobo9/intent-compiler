// Haiku reference recordings for the attribution step (not luna; labelled as such).
//   node hk.mjs step <round>   -> replays the answers recorded so far for this round, prints the issues, and writes the
//                                 next prompt (system + schema + request, exactly as the transport would send them)
//   node hk.mjs commit <round> -> ingests the round through the store, replaying the recorded answers in order
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Exp2Store } from "./dist-local/exp2/store.js"
import { materialize } from "./dist-local/exp2/registry.js"
import { contentHash } from "./dist-local/exp2/source.js"
import { ATTRIBUTION_SCHEMA, ATTRIBUTION_SYSTEM_PROMPT, EMPTY_DRAFT, applyPatch, buildRequest, checkAnswer, shapeProblems } from "./dist-local/exp2/attribution.js"
import { requestJson } from "./dist-local/model/opencode-transport.js"

const [mode, roundArg] = process.argv.slice(2)
const round = Number(roundArg)
const DIR = "hk-rec", STATE = join(DIR, "state")
mkdirSync(DIR, { recursive: true })
const text = readFileSync(`exp2/inputs/dpipe/round-${String(round).padStart(2, "0")}.md`, "utf8")
const store = new Exp2Store(STATE, "haiku-reference")
const answers = readdirSync(DIR).filter(f => f.startsWith(`R${round}-ans`)).sort().map(f => readFileSync(join(DIR, f), "utf8"))

if (mode === "step") {
  const s = store.inspect()
  const sources = s.sources.some(x => x.round === round) ? s.sources : [...s.sources, { round, text, hash: contentHash(text) }]
  const registry = materialize(sources, s.rounds.filter(r => r.status === "accepted").map(r => r.acceptance))
  let draft = EMPTY_DRAFT, issues = []
  for (const a of answers) {
    let parsed
    try { parsed = JSON.parse(a) } catch (e) { issues = [{ code: "unparseable", message: `The reply is not JSON: ${e.message}` }]; continue }
    const shape = shapeProblems(parsed)
    if (shape.length) { issues = shape.map(message => ({ code: "shape", message })); continue }
    draft = applyPatch(draft, parsed)
    issues = checkAnswer(registry, round, draft).issues
  }
  console.log(JSON.stringify({ round, answers: answers.length, accepted: answers.length > 0 && issues.length === 0, issues: issues.map(i => `${i.code} ${i.block ?? ""}: ${i.message}`) }, null, 1))
  if (answers.length === 0 || issues.length) {
    const request = buildRequest(registry, round, draft, issues)
    const prompt = `# SYSTEM\n${ATTRIBUTION_SYSTEM_PROMPT}\n\n# OUTPUT JSON SCHEMA (answer with one JSON object matching it, nothing else)\n${JSON.stringify(ATTRIBUTION_SCHEMA)}\n\n# REQUEST\n${requestJson(request)}\n`
    const file = join(DIR, `R${round}-prompt${answers.length + 1}.md`)
    writeFileSync(file, prompt)
    console.log("next prompt:", file, prompt.length, "chars")
  }
} else if (mode === "commit") {
  let i = 0
  const cassette = async () => ({ text: answers[i++], usage: undefined, stub: false, model: "claude-haiku-5-5 (reference recording, not luna)" })
  const record = await store.ingestRound(round, text, cassette, { maxRepairs: answers.length - 1 })
  console.log(record.status, (record.issues ?? []).length)
}
