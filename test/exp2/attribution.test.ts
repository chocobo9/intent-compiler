import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { ATTRIBUTION_SCHEMA, ATTRIBUTION_SYSTEM_PROMPT, QuotaExhausted, attributeRound, buildRequest, checkAnswer, type AttributionTransport, type ModelRequest } from "../../src/exp2/attribution.js"
import { createOpenCodeAttributionTransport } from "../../src/exp2/transport.js"
import { materialize, type AttributionAnswer, type Registry } from "../../src/exp2/registry.js"
import { contentHash } from "../../src/exp2/source.js"
import { Exp2Store, appendOnly, type Exp2State } from "../../src/exp2/store.js"
import { requestJson, strictSchemaProblems } from "../../src/model/opencode-transport.js"
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
    // The most specific assignment wins (BLOCK9 §2.7): an inner block to another object splits the outer one.
    const other = (a: AttributionAnswer) => a.assignments[4].object_id === "O1" ? "O2" : "O1"
    assert.deepEqual(variant(a => { a.assignments.push({ ...a.assignments[4], block: "R3.S8.P1", object_id: other(a), new_object: null }) }), [], "a block inside one already given, to another object")
    const split = structuredClone(good); split.assignments.push({ ...split.assignments[4], block: "R3.S8.P1", object_id: other(split), new_object: null })
    const blocks = checkAnswer(r3, 3, split).acceptance!.answer.assignments.map(x => x.block)
    assert.ok(!blocks.includes(good.assignments[4].block) && blocks.includes("R3.S8.P1"), "the outer block is replaced by its parts outside the inner one")
    // An outer block that overrides earlier text cannot be split around another owner's block: an overlap naming its own parts.
    const inside = (a: AttributionAnswer) => `${a.assignments[1].block}.P1`
    assert.deepEqual(variant(a => { a.assignments.push({ ...a.assignments[4], block: inside(a), object_id: other(a), new_object: null, change: "add", replaces: [], overrides: [] }) }), ["overlap"], "inside an overriding block, to another object")
    assert.deepEqual(variant(a => { a.assignments.push({ ...a.assignments[4], block: "R3.S8.P1" }) }), [], "the same owner nested is one assignment (§12d item 2)")
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
    assert.deepEqual(variant(a => { a.references.push({ from: "R2.S1", to: "R1.S2", kind: "refers_to" }) }), ["reference_invalid"], "a reference from an older block")

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
    assert.match(issues[0].message, /already replaced in round 3 by R3\.S2\.P2, R3\.S2\.P3; the text in force is R3\.S2\.P2, R3\.S2\.P3 \(round 3\)/u)
  })

  it("an answer that does not converge stops at the repair limit, keeps every call, and the round can be ingested again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-attr-"))
    const store = new Exp2Store(dir, "t")
    await store.ingestRound(1, roundText(1), stubTransport())
    // The model keeps answering R2 without the profile section, and its patches change nothing.
    const stuck = { 2: [(req: ModelRequest) => { const a = SCRIPTS[2][0](req) as AttributionAnswer; a.assignments.splice(1, 1); return a }, () => ({ upsert: [], remove: [], edges_add: [], edges_remove: [], interpretations_add: [] })] }
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
    const seen: ModelRequest[] = []
    const inner = stubTransport()
    const garbled: AttributionTransport = async request => {
      seen.push(request)
      return seen.length === 1 ? { text: "{not json", stub: true } : inner(request)
    }
    const record = await store.ingestRound(1, roundText(1), garbled)
    assert.equal(record.status, "accepted")
    // The unreadable reply changed nothing: the second call patches the same empty draft, told why.
    assert.deepEqual(seen.map(r => r.previous_draft.assignments.length > 0), [false, false, true])
    assert.deepEqual(seen[1].issues.map(i => i.code), ["unparseable"])
    assert.equal(store.inspect().calls[0].issues[0].code, "unparseable")

    const broken = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-attr-")), "t")
    const down = await broken.ingestRound(1, roundText(1), async () => { throw new Error("connection reset") })
    // A failed call is retried without using up an attempt; past the retries the step is unavailable (BLOCK10 §7.2),
    // an interruption that names the cause, not a failed attribution. Every call is recorded.
    assert.equal(down.status, "interrupted")
    assert.deepEqual(down.issues!.map(i => i.code), ["unavailable"])
    assert.match(down.issues![0].message, /3 attribution calls failed; last: connection reset/u)
    const calls = broken.inspect().calls
    assert.equal(calls.length, 3)
    assert.ok(calls.every(c => c.error === "connection reset" && c.stub === false))
    // A spent quota stops at once: the round is interrupted (to be resumed), not failed.
    const quota = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-attr-")), "t")
    const stopped = await quota.ingestRound(1, roundText(1), async () => { throw new QuotaExhausted("quota") })
    assert.equal(stopped.status, "interrupted")
    assert.equal(quota.inspect().calls.length, 1)
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

  it("the output schema satisfies strict structured output", () => {
    assert.deepEqual(strictSchemaProblems(ATTRIBUTION_SCHEMA), [])
  })

  it("a repair repeats the first call byte for byte up to the draft and issues, with the same system prompt and schema", async () => {
    const r1 = await registryBefore(1)
    const requests: ModelRequest[] = []
    const stub = stubTransport()
    const outcome = await attributeRound(r1, 1, async req => { requests.push(req); return stub(req) }, { maxRepairs: 2, callId: n => `M${n}` })
    assert.equal(outcome.status, "accepted")
    assert.equal(requests.length, 2)
    const [first, repair] = requests.map(r => requestJson(r))
    const cut = (text: string) => text.slice(0, text.indexOf(`,"issues":`))
    assert.ok(cut(first).length > 20_000)
    assert.equal(cut(repair), cut(first))
    assert.ok(first.indexOf(`"sources":`) < first.indexOf(`"objects":`) && first.indexOf(`"issues":`) < first.indexOf(`"previous_draft":`))
    assert.ok(first.endsWith(`"issues":[],"previous_draft":{"assignments":[],"interpretations":[],"references":[]}}`))

    // What OpenCode receives: one system prompt and one schema for both calls, and the same opening text.
    const prompts: { system: string; schema: unknown; text: string }[] = []
    const client = {
      session: {
        create: async () => ({ id: `s${prompts.length}` }),
        prompt: async (req: { body: { system: string; format?: { schema: unknown }; parts: readonly [{ text: string }] } }) => {
          prompts.push({ system: req.body.system, schema: req.body.format?.schema, text: req.body.parts[0].text })
          throw new Error("offline")
        },
      },
    }
    const transport = createOpenCodeAttributionTransport({ client, directory: tmpdir(), providerId: "p", modelId: "m" })
    for (const r of requests) await assert.rejects(transport(r))
    assert.equal(prompts.length, 2)
    assert.equal(prompts[0].system, prompts[1].system)
    assert.equal(prompts[0].system, ATTRIBUTION_SYSTEM_PROMPT)
    assert.deepEqual(prompts[0].schema, prompts[1].schema)
    assert.equal(prompts[0].text, first)
    assert.equal(cut(prompts[1].text), cut(prompts[0].text))
  })

  it("applies_to must come from an owned block and land on another object", async () => {
    const r5 = await registryBefore(5)
    const good = scripted(5, r5, 1 - 1)
    const fix = good.assignments.find(a => a.block === "R5.S1.P2.s7")!
    fix.block = "R5.S1.P2.s6"
    assert.deepEqual(checkAnswer(r5, 5, good).issues, [])
    const ingest = r5.objectByName("ingest")!.id
    const variant = (edge: { from: string; to: string }) => codes({ ...good, references: [...good.references, { ...edge, kind: "applies_to" }] }, r5, 5)
    assert.deepEqual(variant({ from: "R5.S0", to: r5.objectByName("transform")!.id }), ["reference_invalid"], "from text that belongs to no object")
    // An edge from an object's own text to that object says nothing more: it is left out, not an error.
    assert.deepEqual(variant({ from: "R5.S1.P2.s5", to: ingest }), [], "to the block's own object")
    assert.ok(!checkAnswer(r5, 5, { ...good, references: [...good.references, { from: "R5.S1.P2.s5", to: ingest, kind: "applies_to" }] }).acceptance!.answer.references.some(e => e.to === ingest && e.from === "R5.S1.P2.s5"))
    assert.deepEqual(variant({ from: "R5.S1.P2.s5", to: "R1.S2.P1" }), [], "to a block of the same object")
    assert.deepEqual(variant({ from: "R5.S1.P2.s5", to: "O999" }), ["unknown_object"])
    assert.deepEqual(variant({ from: "R5.S1.P2.s5", to: "R1.S6.P2" }), [], "to a block of another object")
    assert.deepEqual(variant({ from: "R5.S1.P2.s5", to: "R5.S2.P1" }), [], "to a block of an object new this round")
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
    const base: Exp2State = { profile: "exp2-ic/block1", run_id: "t", sources: [{ round: 1, text: "a", hash: "x" }], calls: [], rounds: [], signals: [], checks: [], check_events: [], check_runs: [], check_calls: [], check_rounds: [], executions: [], reports: [], rulings: [], adjudication_calls: [], probes: [], probe_events: [], probe_calls: [], probe_rounds: [], judgments: [], judge_calls: [] }
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
