import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { EMPTY_DRAFT, ReplayMiss, applyPatch, checkAnswer, type AnswerPatch } from "../../src/exp2/attribution.js"
import { materialize } from "../../src/exp2/registry.js"
import { emptyCassette, loadCassette, recordingTransports, replayTransports } from "../../src/exp2/recording.js"
import { contentHash } from "../../src/exp2/source.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { checkStubTransport } from "./check-stubs.js"
import { roundText } from "./inputs.js"
import { stubTransport } from "./stubs.js"

const HAIKU = resolve(process.cwd(), "exp2/recordings/haiku-reference")

describe("exp2 recordings: the Haiku reference attribution of R1–R3 replays as a regression sample", () => {
  it("replays by request hash: all three rounds accepted with the recorded answers, each used once", async () => {
    const cassette = loadCassette(join(HAIKU, "cassette.json"))
    assert.equal(cassette.rekeyed_from, "dfeb22e")
    assert.match(cassette.model_label, /haiku.*not luna/u)
    const replay = replayTransports(cassette)
    const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-replay-")), "replay")
    for (const round of [1, 2, 3]) assert.equal((await store.ingestRound(round, roundText(round), replay.attribution)).status, "accepted", `R${round}`)
    assert.deepEqual(replay.unused(), [])
    const calls = store.inspect().calls
    assert.deepEqual(calls.map(c => c.round), [1, 1, 2, 3])
    assert.ok(calls.every(c => c.usage_unknown === true && c.stub === false && /haiku/u.test(c.model ?? "")), "the recordings carry no usage: unknown, not zero")
  })

  it("the R1 first answer (the heading-only R1.S1 marked none) is now one overlap with a heading-unit hint", () => {
    const registry = materialize([{ round: 1, text: roundText(1), hash: contentHash(roundText(1)) }], [])
    const first = JSON.parse(readFileSync(join(HAIKU, "R1-ans1.json"), "utf8")) as AnswerPatch
    const issues = checkAnswer(registry, 1, applyPatch(EMPTY_DRAFT, first)).issues
    assert.equal(issues.length, 1)
    assert.equal(issues[0].code, "overlap")
    assert.equal(issues[0].blocks?.length, 45)
    assert.match(issues[0].message, /assign R1\.S1\.H/u)
  })

  it("a request the recording does not hold stops the run (ReplayMiss), with no stand-in answer", async () => {
    const replay = replayTransports(loadCassette(join(HAIKU, "cassette.json")))
    const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-replay-")), "replay")
    await assert.rejects(store.ingestRound(1, roundText(1).replace("dpipe", "dpipe2"), replay.attribution), ReplayMiss)
  })
})

describe("exp2 recordings: record, then replay the same run", () => {
  it("records request, answer and usage verbatim, and the replay gives the same rounds", async () => {
    const cassette = emptyCassette("stand-in (test)")
    const rec = recordingTransports({ attribution: stubTransport(), checks: checkStubTransport() }, cassette)
    const a = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-rec-")), "rec")
    for (const round of [1, 2]) await a.ingestRound(round, roundText(round), rec.attribution)
    assert.ok(cassette.entries.length >= 2 && cassette.entries.every(e => e.step === "attribution" && e.prompt.includes("# REQUEST\n")))
    const replay = replayTransports(JSON.parse(JSON.stringify(cassette)))
    const b = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-rec-")), "rec")
    for (const round of [1, 2]) await b.ingestRound(round, roundText(round), replay.attribution)
    const strip = (s: Exp2Store) => s.inspect().rounds.map(r => ({ status: r.status, acceptance: r.acceptance }))
    assert.deepEqual(strip(b), strip(a))
    assert.deepEqual(replay.unused(), [])
  })
})
