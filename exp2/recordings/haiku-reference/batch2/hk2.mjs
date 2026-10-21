// Haiku reference recordings, round two (attribution R4–R15, checks R1–R3). Not luna; labelled as such.
//   node hk2.mjs attr            -> attribution R1..R15 through the store, replaying the cassette; on the first request
//                                   it does not hold, writes that prompt to hk2/pending.md and stops
//   node hk2.mjs checks          -> the serial R1..R3 (Haiku attribution and checks replayed, stand-in executor);
//                                   same stop on a miss
//   node hk2.mjs add <step> <answer-file>  -> appends the answer to the pending prompt to the cassette
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { ReplayMiss } from "./.test-dist/src/exp2/attribution.js"
import { loadCassette, promptHash, promptText, replayTransports, saveCassette } from "./.test-dist/src/exp2/recording.js"
import { Exp2Store } from "./.test-dist/src/exp2/store.js"

const [mode, a1, a2] = process.argv.slice(2)
const DIR = resolve("hk2"), CASSETTE = join(DIR, "cassette.json"), PENDING = join(DIR, "pending.json")
mkdirSync(DIR, { recursive: true })
if (!existsSync(CASSETTE)) copyFileSync("exp2/recordings/haiku-reference/cassette.json", CASSETTE)
const text = r => readFileSync(`exp2/inputs/dpipe/round-${String(r).padStart(2, "0")}.md`, "utf8")

function catching(step, transport) {
  return async request => {
    try { return await transport(request) } catch (e) {
      if (e instanceof ReplayMiss) {
        const prompt = promptText(step, request)
        writeFileSync(join(DIR, `pending-${step}.md`), prompt)
        writeFileSync(join(DIR, `pending-${step}.json`), JSON.stringify({ step, round: request.round, sha: promptHash(prompt), chars: prompt.length }))
        console.log(`MISS ${step} R${request.round}: hk2/pending-${step}.md (${prompt.length} chars)`)
      }
      throw e
    }
  }
}

function issuesOf(state, round) {
  return state.calls.filter(c => c.round === round).map(c => ({ attempt: c.attempt, accepted: c.accepted, issues: (c.issues ?? []).map(i => `${i.code} ${i.block ?? ""} ${i.message}`.slice(0, 300)) }))
}

if (mode === "add") {
  const c = loadCassette(CASSETTE), p = JSON.parse(readFileSync(join(DIR, `pending-${a1}.json`), "utf8"))
  if (p.step !== a1) throw new Error(`pending is ${p.step}`)
  const prompt = readFileSync(join(DIR, `pending-${a1}.md`), "utf8")
  let answer = readFileSync(a2, "utf8").trim().replace(/^```(?:json)?\s*/u, "").replace(/```$/u, "").trim()
  c.entries.push({ step: a1, request_sha256: promptHash(prompt), prompt, answer, usage: null, model: c.model_label, recorded_at: new Date().toISOString() })
  saveCassette(CASSETTE, c)
  rmSync(join(DIR, `pending-${a1}.json`))
  console.log("added", a1, "R" + p.round, c.entries.length, "entries")
} else if (mode === "attr") {
  const state = join(DIR, "attr-state")
  rmSync(state, { recursive: true, force: true })
  const store = new Exp2Store(state, "haiku-attr")
  const replay = replayTransports(loadCassette(CASSETTE))
  const transport = catching("attribution", replay.attribution)
  const to = Number(a1 ?? 15)
  for (let r = 1; r <= to; r++) {
    let rec
    try { rec = await store.ingestRound(r, text(r), transport, { maxRepairs: 2 }) } catch (e) { if (e instanceof ReplayMiss) break; throw e }
    const s = store.inspect()
    console.log(`R${r} ${rec.status}`, JSON.stringify(issuesOf(s, r)).slice(0, 1500))
    if (rec.status !== "accepted") break
  }
} else if (mode === "checks") {
  const { Serial } = await import("./.test-dist/src/exp2/serial.js")
  const { GoAnchorExtractor } = await import("./.test-dist/src/exp2/anchors.js")
  const { goBuilder } = await import("./.test-dist/src/exp2/build.js")
  const { DEFAULT_LIMITS } = await import("./.test-dist/src/exp2/execution.js")
  const { LocalProcessRunner, LocalScriptSandbox } = await import("./.test-dist/src/exp2/runner.js")
  const { serialExecutor } = await import("./.test-dist/test/exp2/serial-executor.js")
  const { DockerRunner, DockerScriptSandbox, dockerGoBuilder } = await import("./.test-dist/src/exp2/docker.js")
  const dk = { image: "sdd-unattended-preflight:latest", buildCache: "exp2-hk-gocache" }
  const root = join(DIR, "checks-run")
  rmSync(root, { recursive: true, force: true })
  const platform = { python: "C:/Users/HuaWeiClient/AppData/Local/Programs/Python/Python312/python.exe" }
  const store = new Exp2Store(join(root, "store"), "haiku-checks")
  const replay = replayTransports(loadCassette(CASSETTE))
  const serial = new Serial({
    store, workdir: join(root, "work"), checkpoints: join(root, "checkpoints"), text,
    attribution: catching("attribution", replay.attribution), checks: catching("checks", replay.checks),
    executor: round => { const inner = serialExecutor([], new Set())(round); return { async open(ctx) { if (!ctx.resume) writeFileSync(join(DIR, `workorder-R${round}.md`), ctx.text); return inner.open(ctx) } } }, executorIsStub: true,
    anchors: new GoAnchorExtractor(), runner: new DockerRunner(dk), sandbox: new DockerScriptSandbox(dk), build: dockerGoBuilder(join(root, "builds"), dk, 10 * 60_000, "dpipe"),
    limits: { attributionRepairs: 2, checkRepairs: 2, managementTimeoutMs: 600_000, checkTimeoutMs: 20_000, execution: DEFAULT_LIMITS },
  })
  let out
  try { out = await serial.run({ to: Number(a1 ?? 3) }) } catch (e) { if (!(e instanceof ReplayMiss)) throw e; out = "miss" }
  const s = store.inspect()
  for (const cr of s.check_rounds ?? []) console.log(`R${cr.round} checks ${cr.status} entered=${cr.entered.length}`, JSON.stringify(cr.issues ?? []).slice(0, 800))
  console.log(JSON.stringify(s.check_calls.map(c => ({ round: c.round, attempt: c.attempt, accepted: c.accepted, issues: (c.issues ?? []).length }))))
  console.log("outcome", JSON.stringify(out))
} else {
  console.log("unknown mode")
}
