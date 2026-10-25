import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { ExecutionRecord } from "../../src/exp2/execution.js"
import { answersIn, Repairs, untouchedMessage } from "../../src/exp2/repairs.js"
import { untouchedSince } from "../../src/exp2/serial.js"

/**
 * Batch 3a (DESIGN-DEEP §4.1, §4.2): the repair loop's decisions on an item, cycle by cycle, from its check's output
 * digest alone. A cycle is: the item seen (plan), then what was done recorded (mark).
 */
describe("batch 3a: outcomes by the check's output, and what the round does with each", () => {
  const cycle = (r: Repairs, id: string, digest: string, reverted = false) => { const p = reverted ? r.reverted(id) : r.plan(id, digest); r.mark(id, digest, p, reverted); return p }

  it("untouched is not stopped: it goes in the untouched message once more, then is carried", () => {
    const r = new Repairs()
    assert.deepEqual(cycle(r, "V1", "a"), { action: "send", channel: "repair" }, "new: the repair list")
    assert.equal(r.outcome("V1", "a", false), "untouched")
    assert.deepEqual(cycle(r, "V1", "a"), { action: "send", channel: "untouched" })
    const held = cycle(r, "V1", "a")
    assert.equal(held.action, "hold")
    assert.match(held.why!, /untouched after its resend in the untouched message: carried/u)
    assert.equal(held.ruling, undefined, "untouched never goes to the reviewer by itself")
  })

  it("touched in two cycles in a row, not fixed: stopped and to the reviewer; untouched in between resets the count", () => {
    const r = new Repairs()
    cycle(r, "V1", "a")
    assert.deepEqual(cycle(r, "V1", "b"), { action: "send", channel: "repair" }, "touched once: sent again")
    const second = cycle(r, "V1", "c")
    assert.deepEqual([second.action, second.ruling], ["hold", "touched_twice"])
    assert.deepEqual(r.questions(), [{ id: "V1", why: "touched_twice" }])
    assert.equal(cycle(r, "V1", "c").action, "hold", "held while with the reviewer")
    const s = new Repairs()
    cycle(s, "V2", "a"); cycle(s, "V2", "b")
    assert.equal(cycle(s, "V2", "b").channel, "untouched", "touched, then untouched: the untouched message")
    assert.deepEqual(cycle(s, "V2", "c"), { action: "send", channel: "repair" }, "touched again after an untouched cycle: one in a row")
  })

  it("a reverted cycle counts for nothing; the second revert sends the item to the reviewer with the guard", () => {
    const r = new Repairs()
    cycle(r, "V1", "a")
    assert.equal(cycle(r, "V1", "a", true).action, "send", "first revert: sent again")
    assert.deepEqual(cycle(r, "V1", "a"), { action: "send", channel: "untouched" }, "the resend after the revert was not one of the round's sends")
    const p = cycle(r, "V1", "a", true)
    assert.deepEqual([p.action, p.ruling], ["hold", "reverted_twice"])
  })

  it("the executor's answer routes the next sighting: disagree, or done while failing, to the reviewer; not done as before", () => {
    for (const [a, ruling] of [["disagree", "disagree"], ["done", "done_failing"]] as const) {
      const r = new Repairs()
      cycle(r, "V1", "a"); cycle(r, "V1", "a")
      r.answer("V1", a)
      const p = cycle(r, "V1", "a")
      assert.deepEqual([p.action, p.ruling], ["hold", ruling], a)
    }
    const r = new Repairs()
    cycle(r, "V1", "a")
    r.answer("V1", "not done")
    assert.equal(cycle(r, "V1", "a").channel, "untouched")
  })

  it("the reviewer's word: upheld holds it for the round; not upheld (its guard superseded) sends it again", () => {
    const r = new Repairs()
    cycle(r, "V1", "a"); cycle(r, "V1", "b"); cycle(r, "V1", "c")
    r.ruled("V1", true)
    assert.match(r.plan("V1", "c").why!, /upheld/u)
    assert.deepEqual(r.questions(), [])
    const s = new Repairs()
    cycle(s, "V1", "a"); cycle(s, "V1", "a", true); cycle(s, "V1", "a", true)
    s.ruled("V1", false)
    assert.equal(s.plan("V1", "a").action, "send")
  })

  it("an item carried in: the work message was its first send; listed-only items (quiet) are held", () => {
    const r = new Repairs(new Map([["G3", "a"]]), new Set(["V9"]))
    assert.equal(r.outcome("G3", "a", false), "untouched")
    assert.deepEqual(cycle(r, "G3", "a"), { action: "send", channel: "untouched" })
    assert.equal(cycle(r, "G3", "a").action, "hold")
    assert.equal(r.outcome("G3", "z", true), "fixed")
    assert.match(r.plan("V9", "x").why!, /listed only/u)
  })

  it("answers are read by item number; the untouched message asks for them", () => {
    assert.deepEqual([...answersIn("Fixed the sort.\n1. done\n2. Not done: needs the schema\n**3.** disagree: the text says ascending\n3. done")], [[1, "done"], [2, "not done"], [3, "disagree"]])
    const m = untouchedMessage([{ text: "(V1) x" }, { text: "(G2) y" }])
    assert.match(m, /^These items were sent to you before/u)
    assert.match(m, /1\. \(V1\) x\n\n2\. \(G2\) y/u)
    assert.match(m, /`<n>\. disagree: <why>`/u)
  })
})

describe("batch 5 A: a regression is an item: one repair with its material, then the reviewer", () => {
  const cycle = (r: Repairs, id: string, digest: string) => { const p = r.plan(id, digest); r.mark(id, digest, p); return p }

  it("first sighting: the repair list (never the untouched message), whatever the guard went through before", () => {
    const r = new Repairs(new Map([["G4", "old"]]))
    r.regressed("G4", "a")
    assert.equal(r.regressionSent("G4"), false, "not sent yet")
    assert.deepEqual(cycle(r, "G4", "a"), { action: "send", channel: "repair" })
    assert.equal(r.regressionSent("G4"), true)
  })

  it("still failing on the cycle after its send, touched or not: held, to the reviewer; upheld, held for the round", () => {
    for (const next of ["a", "b"]) {
      const r = new Repairs()
      r.regressed("G4", "a")
      cycle(r, "G4", "a")
      const p = cycle(r, "G4", next)
      assert.deepEqual([p.action, p.ruling], ["hold", "regression_persisted"], next)
      assert.deepEqual(r.questions(), [{ id: "G4", why: "regression_persisted" }])
      r.ruled("G4", true)
      assert.match(r.plan("G4", next).why!, /upheld/u)
    }
  })

  it("fixed, then broken again: a new regression, sent again first", () => {
    const r = new Repairs()
    r.regressed("G4", "a")
    cycle(r, "G4", "a")
    assert.equal(r.outcome("G4", "p", true), "fixed")
    r.regressed("G4", "c")
    assert.deepEqual(cycle(r, "G4", "c"), { action: "send", channel: "repair" })
  })
})

describe("batch 3a: an item carried in untouched opens the next work message marked with the round it has been untouched since", () => {
  const exec = (round: number, sent: string | null, end: string) => ({ round, cycles: [{ id: `C${round}.1`, items: sent === null ? [] : [{ id: "V1", digest: sent, verdict: "wrong", action: "send" }] }], final: [{ id: "V1", digest: end, verdict: "wrong", action: "none" }] }) as unknown as ExecutionRecord
  it("the same output, sent at it, at the end of rounds 2 and 3: since R2; changed since its last send: no mark", () => {
    assert.equal(untouchedSince([exec(1, "a", "a"), exec(2, "b", "b"), exec(3, "b", "b")], "V1", "b"), 2)
    assert.equal(untouchedSince([exec(1, "a", "a"), exec(2, "a", "b")], "V1", "b"), null, "touched in round 2: not untouched")
    assert.equal(untouchedSince([exec(1, "a", "a"), exec(2, null, "a")], "V1", "a"), null, "not sent in the last round")
  })
})
