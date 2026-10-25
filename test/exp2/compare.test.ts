import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { compareAttributions, registryOf, renderComparison, type IndependentAttribution } from "../../src/exp2/compare.js"
import { loadCassette, replayByRound } from "../../src/exp2/recording.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { roundText } from "./inputs.js"
import { stubTransport } from "./stubs.js"

async function attributed(transport: Parameters<Exp2Store["ingestRound"]>[2], label: string): Promise<IndependentAttribution> {
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-cmp-")), label)
  for (const round of [1, 2, 3]) assert.equal((await store.ingestRound(round, roundText(round), transport)).status, "accepted")
  return { label, rounds: store.inspect().rounds.map(r => ({ round: r.round, answer: r.acceptance!.answer })) }
}

describe("exp2 attribution comparison (block and clause level)", () => {
  it("an attribution compared with itself agrees everywhere", async () => {
    const stub = await attributed(stubTransport(), "stand-in")
    const texts = [1, 2, 3].map(roundText)
    const a = registryOf(texts, stub)
    assert.equal(a.failed, null)
    const c = compareAttributions(a.registry, registryOf(texts, stub).registry, [1, 2, 3])
    assert.equal(c.clauses.agree, c.clauses.total)
    assert.deepEqual([c.ownership, c.modifications], [[], []])
  })

  it("the stand-in against the Haiku reference: objects matched by shared clauses, disagreements listed by block", async () => {
    const texts = [1, 2, 3].map(roundText)
    const stub = registryOf(texts, await attributed(stubTransport(), "stand-in"))
    const haikuAnswers = await attributed(replayByRound(loadCassette(resolve(process.cwd(), "exp2/recordings/haiku-reference/batch2/cassette.json"))).attribution, "haiku")
    const haiku = registryOf(texts, haikuAnswers)
    assert.equal(haiku.failed, null)
    const c = compareAttributions(stub.registry, haiku.registry, [1, 2, 3])
    const filter = c.matching.find(m => m.a.name === "filter")!
    assert.ok(filter.b && filter.shared > 0, "filter has a counterpart")
    assert.ok(c.clauses.agree > 0 && c.clauses.agree <= c.clauses.total)
    // Each reported block's clauses all disagree; no clause is reported twice.
    const md = renderComparison(c, { a: "stand-in", b: "haiku" })
    assert.match(md, /Clauses agreeing: \d+\/\d+/u)
    assert.equal(new Set(c.ownership.map(o => o.block)).size, c.ownership.length)
  })

  it("an independent round that does not pass the check is reported, and the comparison stops before it", async () => {
    const stub = await attributed(stubTransport(), "stand-in")
    const broken: IndependentAttribution = { ...stub, rounds: stub.rounds.map(r => r.round === 2 ? { ...r, answer: { ...r.answer, assignments: r.answer.assignments.slice(1) } } : r) }
    const built = registryOf([1, 2, 3].map(roundText), broken)
    assert.deepEqual([built.rounds, built.failed?.round], [1, 2])
  })
})
