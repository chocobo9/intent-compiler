import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { ATTRIBUTION_SCHEMA, REPAIR_SCHEMA, buildRequest, checkAnswer, type AttributionTransport, type ModelRequest } from "../../src/exp2/attribution.js"
import { materialize, type AttributionAnswer, type Registry } from "../../src/exp2/registry.js"
import { contentHash } from "../../src/exp2/source.js"
import { Exp2Store, appendOnly, type Exp2State } from "../../src/exp2/store.js"
import { strictSchemaProblems } from "../../src/model/opencode-transport.js"
import { roundText } from "./inputs.js"
import { SCRIPTS, stubTransport } from "./stubs.js"

/** The registry after rounds 1..n with the scripted answers, plus round n+1's source registered for checking. */
async function registryBefore(round: number): Promise<Registry> {
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-attr-")), "t")
  const transport = stubTransport()
  for (let r = 1; r < round; r++) await store.ingestRound(r, roundText(r), transport)
  const state = store.inspect()
  const text = roundText(round)
  return materialize([...state.sources, { round, text, hash: contentHash(text) }], state.rounds.filter(r => r.status === "accepted").map(r => r.acceptance!))
}

function scripted(round: number, registry: Registry, which = 0): AttributionAnswer {
  return SCRIPTS[round][which](buildRequest(registry, round)) as AttributionAnswer
}

const codes = (answer: AttributionAnswer, registry: Registry, round: number) => checkAnswer(registry, round, answer).issues.map(i => i.code).sort()

describe("exp2 attribution: the code blocks only certain errors and names them", () => {
  it("each kind of certain error is reported with the block and what is wrong", async () => {
    const r3 = await registryBefore(3)
    const good = scripted(3, r3)
    // Remove the typo of the scripted first answer to start from a clean answer.
    good.assignments[1].overrides[0].old = ["R2.S13.P4.s4"]
    assert.deepEqual(checkAnswer(r3, 3, good).issues, [])

    const variant = (edit: (a: AttributionAnswer) => void) => { const a = structuredClone(good); edit(a); return codes(a, r3, 3) }
    assert.deepEqual(variant(a => { a.assignments.splice(5, 1) }), ["uncovered"], "a missing block")
    assert.deepEqual(variant(a => { a.assignments[2].block = "R3.S33" }), ["uncovered", "unknown_block"], "a wrong id")
    assert.deepEqual(variant(a => { a.assignments.push({ ...a.assignments[4], block: "R3.S8.P1" }) }), ["overlap"], "a block inside one already given")
    assert.deepEqual(variant(a => { a.assignments.push(a.assignments[4]) }), ["duplicate"], "the same block twice")
    assert.deepEqual(variant(a => { a.assignments[1].overrides[0].old = ["R2.S13.P4.s4..s9"] }), ["range_invalid"], "a range past the end")
    assert.deepEqual(variant(a => { a.assignments[1].overrides[0].old = ["R2.S13.P4.s3..s2"] }), ["range_invalid"], "a reversed range")
    assert.deepEqual(variant(a => { a.assignments[1].overrides[0].by = ["R3.S3.P1"] }), ["by_outside_block"], "new units outside the block")
    assert.deepEqual(variant(a => { a.assignments[1].overrides[0].old = ["R3.S3.P1"] }), ["target_not_earlier"], "replacing text of the same round")
    assert.deepEqual(variant(a => { a.assignments[1].overrides[0].old = ["R2.S0"] }), ["target_unowned"], "replacing text no object holds")
    assert.deepEqual(variant(a => { a.assignments[4] = { ...a.assignments[4], object_id: null, new_object: "Fill" } }), ["name_taken"], "a new name that exists")
    assert.deepEqual(variant(a => { a.assignments[4] = { ...a.assignments[4], object_id: "O999" } }), ["object_choice"], "both an object and a new name")
    assert.deepEqual(variant(a => { a.assignments[4] = { ...a.assignments[4], new_object: null, object_id: "O999" } }), ["unknown_object"])
    assert.deepEqual(variant(a => { a.assignments[3].replaces = ["R2.S3.P5"] }), ["change_shape"], "add that replaces something")
    assert.deepEqual(variant(a => { a.assignments[1].change = "revise"; a.assignments[1].overrides = [] }), ["change_shape"], "revise without targets")
    assert.deepEqual(variant(a => { a.assignments[1].block = `R3.S2#${"0".repeat(8)}` }), ["hash_mismatch", "uncovered"], "a stale hash")
    assert.deepEqual(variant(a => { a.references.push({ from: "R2.S1", to: "R1.S2" }) }), ["reference_invalid"], "a reference from an older block")

    const name = checkAnswer(r3, 3, (() => { const a = structuredClone(good); a.assignments[4] = { ...a.assignments[4], object_id: null, new_object: "Fill" }; return a })()).issues[0]
    assert.match(name.message, /use object_id O\d+/u)
  })

  it("judgments that need understanding pass: an odd object choice or change type is the model's call", async () => {
    const r3 = await registryBefore(3)
    const odd = scripted(3, r3)
    odd.assignments[1].overrides[0].old = ["R2.S13.P4.s4"]
    // normalize's correction given to fill, and the pipeline extension called a partial revision of profile's text.
    odd.assignments[2] = { ...odd.assignments[2], object_id: odd.assignments[1].object_id }
    odd.assignments[7] = { ...odd.assignments[7], change: "partial", overrides: [{ old: ["R2.S3.P2"], by: ["R3.S16.P1"] }] }
    assert.deepEqual(checkAnswer(r3, 3, odd).issues, [])
  })

  it("text already replaced cannot be replaced again; the current text must be cited", async () => {
    const r4 = await registryBefore(4)
    const answer: AttributionAnswer = { assignments: [], references: [], interpretations: [] }
    const fill = r4.objectByName("fill")!.id
    for (const s of r4.sources.get(4)!.blocks.filter(b => b.level === "section" && b.parent === null)) {
      answer.assignments.push({ block: s.id, object_id: fill, new_object: null, change: "add", replaces: [], overrides: [], note: null })
    }
    answer.assignments[1] = { ...answer.assignments[1], change: "partial", overrides: [{ old: ["R2.S13.P4.s4"], by: [answer.assignments[1].block] }] }
    const issues = checkAnswer(r4, 4, answer).issues
    assert.deepEqual(issues.map(i => i.code), ["target_replaced"])
    assert.match(issues[0].message, /already replaced in round 3 by R3\.S2\.P2, R3\.S2\.P3/u)
  })

  it("an answer that does not converge stops at the repair limit, keeps every call, and the round can be ingested again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-attr-"))
    const store = new Exp2Store(dir, "t")
    await store.ingestRound(1, roundText(1), stubTransport())
    // The model keeps answering R2 without the profile section, and its patches change nothing.
    const stuck = { 2: [(req: ModelRequest) => { const a = SCRIPTS[2][0](req) as AttributionAnswer; a.assignments.splice(1, 1); return a }, () => ({ upsert: [], remove: [], references_add: [], references_remove: [] })] }
    const failed = await store.ingestRound(2, roundText(2), stubTransport(stuck), { maxRepairs: 2 })
    assert.equal(failed.status, "failed")
    assert.deepEqual(failed.issues!.map(i => [i.code, i.block]), [["uncovered", "R2.S1"]])
    let state = store.inspect()
    assert.deepEqual(state.calls.filter(c => c.round === 2).map(c => c.kind), ["attribute", "repair", "repair"])
    assert.ok(state.calls.filter(c => c.round === 2).every(c => c.issues.length === 1))
    assert.equal(store.registry().objectByName("profile"), undefined, "nothing of a failed round is registered")
    const again = await store.ingestRound(2, roundText(2), stubTransport())
    assert.equal(again.status, "accepted")
    state = store.inspect()
    assert.deepEqual(state.rounds.map(r => `${r.round}:${r.status}`), ["1:accepted", "2:failed", "2:accepted"])
    assert.deepEqual(state.calls.map(c => c.id), state.calls.map((_, i) => `M${i + 1}`))
    assert.ok(store.registry().objectByName("profile"))
  })

  it("an unreadable reply leads to a fresh request, not a repair of nothing; a failed transport is recorded", async () => {
    const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-attr-")), "t")
    const seen: string[] = []
    const inner = stubTransport()
    const garbled: AttributionTransport = async request => {
      seen.push(request.task)
      return seen.length === 1 ? { text: "{not json", stub: true } : inner(request)
    }
    const record = await store.ingestRound(1, roundText(1), garbled)
    assert.equal(record.status, "accepted")
    assert.deepEqual(seen, ["attribute", "attribute", "repair"])
    assert.equal(store.inspect().calls[0].issues[0].code, "unparseable")

    const broken = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-attr-")), "t")
    const down = await broken.ingestRound(1, roundText(1), async () => { throw new Error("connection reset") })
    assert.equal(down.status, "failed")
    const call = broken.inspect().calls[0]
    assert.equal(call.error, "connection reset")
    assert.equal(call.stub, false)
  })

  it("the request is lean: objects carry ids, names and block ids only; the repair keeps the same opening", async () => {
    const r3 = await registryBefore(3)
    const request = buildRequest(r3, 3)
    for (const o of request.objects) assert.deepEqual(Object.keys(o).filter(k => k !== "modified"), ["id", "name", "version", "blocks"])
    assert.ok(request.sources.startsWith("===== R1 =====\n") && request.sources.includes("===== R3 =====\n⟦R3.S0#"))
    const fill = request.candidates.find(c => c.name === "fill")!
    assert.ok(fill.mentioned_in.includes("R3.S2.P1"))
    assert.ok(request.outline.some(l => l.startsWith("R3.S2 ### Fill linear: boundary extrapolation: P1(1) P2(4) P3(2)")))
  })

  it("the output schemas satisfy strict structured output", () => {
    assert.deepEqual(strictSchemaProblems(ATTRIBUTION_SCHEMA), [])
    assert.deepEqual(strictSchemaProblems(REPAIR_SCHEMA), [])
  })
})

describe("exp2 store: append-only, ordered, one writer", () => {
  it("rejects rounds out of order and a different text for a logged round", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-store-"))
    const store = new Exp2Store(dir, "t")
    await assert.rejects(store.ingestRound(2, roundText(2), stubTransport()), /next round is 1/u)
    const stuck = { 1: [() => ({ assignments: [], references: [], interpretations: [] })] }
    await store.ingestRound(1, roundText(1), stubTransport(stuck), { maxRepairs: 0 })
    await assert.rejects(store.ingestRound(1, roundText(1) + "\nextra", stubTransport()), /append-only/u)
  })

  it("refuses any edit of an existing entry", () => {
    const base: Exp2State = { profile: "exp2-ic/block1", run_id: "t", sources: [{ round: 1, text: "a", hash: "x" }], calls: [], rounds: [], signals: [] }
    assert.doesNotThrow(() => appendOnly(base, { ...base, sources: [...base.sources, { round: 2, text: "b", hash: "y" }] }))
    assert.throws(() => appendOnly(base, { ...base, sources: [{ round: 1, text: "changed", hash: "x" }] }), /append-only/u)
    assert.throws(() => appendOnly(base, { ...base, sources: [] }), /append-only/u)
  })

  it("a live lock blocks a second writer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-store-"))
    const store = new Exp2Store(dir, "t")
    writeFileSync(join(dir, "exp2-state.json.lock"), String(process.pid))
    await assert.rejects(store.ingestRound(1, roundText(1), stubTransport()), /busy/u)
    assert.equal(readFileSync(join(dir, "exp2-state.json.lock"), "utf8"), String(process.pid))
  })
})
