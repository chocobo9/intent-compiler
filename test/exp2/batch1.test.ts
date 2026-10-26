import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { checkChecks, coarseHints, coarseUnit, type CheckDraft } from "../../src/exp2/checks.js"
import { formalizeProblems } from "../../src/exp2/formalize.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { roundText } from "./inputs.js"
import { stubTransport } from "./stubs.js"

/**
 * Batch 1 (DESIGN-OPUS-2026-10-26, decision (1) as settled by B): a check rests on sentences. A section, or a paragraph
 * that has sentences, covers none of them. The check or item is still admitted; the writer and the formalizer hear of it
 * as a note that does not block, and it is counted.
 */
describe("[mech] batch 1: units coarser than a sentence are admitted, counted, and cover no sentence", () => {
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b1-units-")), "b1u")
  before(async () => { await store.ingestRound(1, roundText(1), stubTransport()) })

  it("coarse: a section, a paragraph with sentences; fine: a sentence", () => {
    const reg = store.registry()
    assert.equal(coarseUnit(reg, "R1.S4"), true)
    assert.equal(coarseUnit(reg, "R1.S8.P1"), true)
    assert.equal(coarseUnit(reg, "R1.S8.P1.s1"), false)
  })

  it("a library check citing a paragraph that has sentences: no issue (admitted); one note naming the block; citing its sentences: no note", () => {
    const reg = store.registry(), object = reg.coverOf("R1.S8.P1.s1")!.owner
    const draft = (blocks: string[]): CheckDraft => ({ key: "k", object, blocks, uses: [], note: null, reference_script: null, input: { args: ["ingest", "--input", "missing.csv"], files: [] }, assertions: [{ id: "x", role: "business", target: { kind: "exit_code", path: null, line: null, pointer: null, column: null }, expect_json: "1", tolerance: null, source: { kind: "verbatim", block: "R1.S8.P1.s1" } }] })
    const coarse = { checks: [draft(["R1.S8.P1"])], retire: [] }, fine = { checks: [draft(["R1.S8.P1.s1", "R1.S8.P1.s2"])], retire: [] }
    assert.deepEqual(checkChecks(reg, 1, coarse, [], []).map(i => i.code), checkChecks(reg, 1, fine, [], []).map(i => i.code), "the paragraph adds no issue")
    const hints = coarseHints(reg, coarse)
    assert.deepEqual(hints.map(h => [h.code, h.check]), [["unit_too_coarse", "k"]])
    assert.match(hints[0].message, /block R1\.S8\.P1 is a paragraph; it is admitted, but covers none of its sentences[^]*does not block/u)
    assert.deepEqual(coarseHints(reg, fine), [])
  })

  it("a review item formalized on a section: kept, no problem; a note that does not block", () => {
    const reg = store.registry()
    const item = (units: string[]) => ({ items: [{ item: 1, text: "verify fails", units, input: { args: ["verify", "--file", "a.txt", "--checksum", "a.sha"], files: [{ path: "a.txt", content: "x" }, { path: "a.sha", content: "y" }] }, why_no_input: null, assertions: [{ id: "e", role: "business", target: { kind: "exit_code", path: null, line: null, pointer: null, column: null }, expect_json: "1", tolerance: null, source: { kind: "verbatim", block: "R1.S4.P2.s2" } }], reference_script: null }] })
    const coarse = formalizeProblems(reg, 1, item(["R1.S4"])), fine = formalizeProblems(reg, 1, item(["R1.S4.P2.s2"]))
    assert.deepEqual(coarse.problems, fine.problems, "the section adds no problem")
    assert.deepEqual(coarse.items.map(i => i.units), [["R1.S4"]], "the item keeps its unit")
    assert.equal(coarse.hints!.length, 1)
    assert.match(coarse.hints![0], /item 1: unit R1\.S4 is a section; it is kept, but covers none of its sentences/u)
    assert.deepEqual(fine.hints, [])
  })
})
