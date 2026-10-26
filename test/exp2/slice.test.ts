import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { isNoIssues, notBehaviourIn, replyAsList, reviewEntries } from "../../src/exp2/review.js"
import { chooseSlice, renderSlice } from "../../src/exp2/slice.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { declarations, verificationStates, type SentenceState } from "../../src/exp2/verification.js"
import { paragraphInForce } from "../../src/exp2/view.js"
import { roundText } from "./inputs.js"
import { stubTransport } from "./stubs.js"

/**
 * Batch 1 (DESIGN-OPUS-2026-10-26 §3, §10.2 G2, G3, G11, §11 items 2–3): the reviewer's debt slice, chosen by code;
 * the reviewer's NOT BEHAVIOUR lines, kept out of the list of deviations and out of the debt until a finding cites them.
 */
describe("[behav] batch 1: the debt slice and NOT BEHAVIOUR declarations", () => {
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b1-slice-")), "b1s")
  before(async () => { for (const r of [1, 2, 3]) await store.ingestRound(r, roundText(r), stubTransport()) })
  const states = (round: number, o: Partial<Parameters<typeof verificationStates>[2]> = {}) => verificationStates(store.registry(), round, { guards: [], guardEvents: [], library: [], checkEvents: [], ...o })
  const paras = (s: { sent: { paragraph: string }[] }) => s.sent.map(x => x.paragraph)

  it("earlier rounds only; by round from the earliest, one paragraph per command in turn; at most 8", () => {
    const reg = store.registry()
    const st = states(2)
    const s = chooseSlice(reg, 3, st, {}, { chars: 1_000_000 })
    assert.equal(s.sent.length, 8)
    assert.ok(s.sent.every(x => reg.block(x.paragraph)!.round === 1), "R1 first")
    assert.equal(new Set(s.sent.map(x => x.object)).size, 8, "eight commands, one paragraph each")
    assert.ok(s.sent.every(x => x.why === "rotation"))
    assert.equal(s.debt.paragraphs, new Set(st.filter(x => x.debt).map(x => x.paragraph)).size)
    assert.match(renderSlice(s), /^- Debt slice: 8 paragraphs \(rotation 8\), \d+ characters, of \d+ paragraphs in debt \(\d+ sentences\); budget 8 paragraphs, 1000000 characters; cut 0; rotation 8\/\d+\.$/u)
  })

  it("the rotation: a paragraph sent waits until every paragraph in debt had its turn; the pointer moves only for paragraphs sent", () => {
    const reg = store.registry()
    const st = states(2)
    const first = chooseSlice(reg, 3, st, {}, { chars: 1_000_000 })
    const second = chooseSlice(reg, 3, st, { last: first }, { chars: 1_000_000 })
    assert.deepEqual(paras(second).filter(p => paras(first).includes(p)), [], "no paragraph twice before the rotation ends")
    // Every paragraph sent once: the rotation starts over.
    const all = [...new Set(st.filter(x => x.debt).map(x => x.paragraph))]
    const over = chooseSlice(reg, 3, st, { last: { rotation: all, cut: [] } }, { chars: 1_000_000 })
    assert.deepEqual(paras(over), paras(first))
  })

  it("a paragraph that does not fit is cut, stays out of the rotation, and heads the next round's queue; last round's gaps come first of all", () => {
    const reg = store.registry()
    const st = states(2)
    const free = chooseSlice(reg, 3, st, {}, { chars: 1_000_000 })
    const big = free.sent.map(x => x.paragraph).sort((a, b) => paragraphInForce(reg, b, 3).length - paragraphInForce(reg, a, 3).length)[0]
    const tight = chooseSlice(reg, 3, st, {}, { chars: paragraphInForce(reg, big, 3).length - 1 })
    assert.ok(tight.cut.some(c => c.paragraph === big))
    assert.ok(!tight.rotation.includes(big))
    const next = chooseSlice(reg, 3, st, { last: tight }, { chars: 1_000_000 })
    assert.ok(next.sent.some(x => x.why === "cut before" && x.paragraph === big), JSON.stringify(next.sent.map(x => [x.paragraph, x.why])))
    const gap = st.find(x => x.debt && reg.block(x.paragraph)!.round === 2)!
    const withGap = chooseSlice(reg, 3, st, { last: free, gaps: [gap.id] }, { chars: 1_000_000 })
    assert.deepEqual([withGap.sent[0].paragraph, withGap.sent[0].why], [gap.paragraph, "gap"])
  })

  it("never-passed checks' paragraphs before the rotation; a sentence with an open item is not in the slice (G3)", () => {
    const reg = store.registry()
    const k = { id: "K1", round: 2, key: "k", object: "O20", blocks: ["R2.S11.P5.s3"], uses: [], unknown: [], reference_script: null, admission: "admitted", status: "active", calls: [], input: { args: [], files: [] }, assertions: [] }
    const st: SentenceState[] = states(2, { library: [k as never], open: [{ id: "V1.1.1", units: ["R1.S8.P1.s1"] }] })
    const s = chooseSlice(reg, 3, st, {}, { chars: 1_000_000 })
    assert.deepEqual([s.sent[0].paragraph, s.sent[0].why], ["R2.S11.P5", "never passed"])
    assert.ok(!s.sent.some(x => x.sentences.includes("R1.S8.P1.s1")), "the open item's sentence is the repair loop's")
  })

  it("NOT BEHAVIOUR lines: read with their ids, never entries of the list, and a reply of them and NO ISSUES is no issues", () => {
    const reply = "NOT BEHAVIOUR R1.S1.P1.s1: background\n- `NOT BEHAVIOUR R1.S2.P1.s2#abcd1234`: a definition\nNO ISSUES"
    assert.deepEqual(notBehaviourIn(reply), [{ id: "R1.S1.P1.s1", reason: "background" }, { id: "R1.S2.P1.s2", reason: "a definition" }])
    assert.ok(isNoIssues(reply))
    assert.deepEqual(reviewEntries(reply), [])
    const mixed = "1. filter keeps the wrong rows\nNOT BEHAVIOUR R1.S1.P1.s1: background"
    assert.deepEqual(reviewEntries(mixed), ["1. filter keeps the wrong rows"])
    assert.equal(replyAsList(mixed), "1. filter keeps the wrong rows")
  })

  it("a declaration takes the sentence out of the debt until an item of that round or later rests on it", () => {
    const reg = store.registry()
    const sentence = "R1.S8.P1.s4"
    const declared = declarations(reg, [{ round: 1, accept: { declared: [{ id: sentence, reason: "a note" }] }, review_items: [] }])
    assert.deepEqual([...declared], [[sentence, "a note"]])
    const st = states(1, { declared })
    assert.deepEqual([st.find(s => s.id === sentence)!.not_behaviour, st.find(s => s.id === sentence)!.debt], ["declared: a note", false])
    const cited = declarations(reg, [{ round: 1, accept: { declared: [{ id: sentence, reason: "a note" }] }, review_items: [] }, { round: 2, review_items: [{ round: 2, units: [sentence] }] }])
    assert.equal(cited.size, 0)
  })
})
