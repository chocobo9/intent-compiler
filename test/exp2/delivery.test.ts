import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { renderGuardItem, renderItemForReview, renderOpenItem } from "../../src/exp2/accept.js"
import type { CheckRecord } from "../../src/exp2/checks.js"
import { DeliveryLedger, deliveryLine, renderDelivery } from "../../src/exp2/delivery.js"
import type { GuardRecord } from "../../src/exp2/guards.js"
import { Exp2Store } from "../../src/exp2/store.js"
import type { CheckRun } from "../../src/exp2/verdict.js"
import { renderComparisons, roundPackage } from "../../src/exp2/view.js"
import { roundText } from "./inputs.js"
import { stubTransport } from "./stubs.js"

/**
 * Batch 1 (DESIGN-OPUS-2026-10-26 §0a, decision 3): one delivery ledger a round; the package per recipient without the
 * paragraphs edges bring, a revised unit as its earlier text alone, open items as check material and the text they rest
 * on (the executor) or as material only (the reviewer).
 */
describe("[behav] batch 1: the delivery ledger and the package by recipient", () => {
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b1-deliv-")), "b1d")
  before(async () => { for (const r of [1, 2, 3]) await store.ingestRound(r, roundText(r), stubTransport()) })
  const check = { id: "V2.1.1", round: 2, key: "k", object: "O20", blocks: ["R1.S8.P1.s1"], uses: [], unknown: [], reference_script: null, admission: "admitted", input: { args: ["ingest", "--input", "missing.csv"], files: [] }, assertions: [{ id: "e", role: "business", source: { kind: "verbatim", block: "R1.S8.P1.s1" }, target: { kind: "exit_code", path: null, line: null, pointer: null, column: null }, tolerance: null, expect: 1 }] } as unknown as CheckRecord
  const run = { check: "V2.1.1", round: 3, program: "C2.3", outcome: "fail", assertions: [{ id: "e", ok: false, actual: 0, role: "business" }], exit_code: 0, stderr_head: "", failure: null } as unknown as CheckRun

  it("the line is the round's text twice plus 10k; a block is counted once a recipient; a unit inside a given block is named by its id", () => {
    const reg = store.registry()
    assert.equal(deliveryLine(1234), 12_468)
    const d = new DeliveryLedger(reg, 3, deliveryLine(1000))
    d.give("executor", "A", "R1.S8.P1", 653)
    d.give("executor", "A", "R1.S8.P1", 653)
    assert.equal(d.chars("executor"), 653)
    assert.deepEqual(d.quote("executor", ["R1.S8.P1.s1"]), ["R1.S8.P1.s1 (given above)"])
    const q = d.quote("reviewer", ["R1.S8.P1.s1"])
    assert.equal(q[0], JSON.stringify(reg.block("R1.S8.P1.s1")!.text.trim()))
    assert.deepEqual(d.quote("reviewer", ["R1.S8.P1.s1"]), ["R1.S8.P1.s1 (given above)"], "once a round")
  })

  it("past the line a quote is the unit's id, recorded as cut; A+B over the line is named so; roles outside the line are flagged above it", () => {
    const reg = store.registry()
    const d = new DeliveryLedger(reg, 3, 100)
    d.give("executor", "A", "R3.S6", 90)
    assert.deepEqual(d.quote("executor", ["R1.S8.P1.s1"]), ["R1.S8.P1.s1"])
    assert.deepEqual(d.quote("executor", ["R1.S8.P1.s2"], "C", true), ["R1.S8.P1.s2"])
    assert.deepEqual(d.trimmed.map(t => [t.id, t.class, t.why.startsWith("cut") ? "cut" : "line"]), [["R1.S8.P1.s1", "C", "line"], ["R1.S8.P1.s2", "C", "cut"]])
    d.give("reviewer", "A", "R3.S6", 90); d.give("reviewer", "B", "R2.S11.P5.s3", 30)
    d.read("check writing", 250); d.read("attribution", 40)
    const s = d.summary()
    assert.deepEqual([s.recipients.executor.over_line, s.recipients.reviewer.over_line], [null, "A+B"])
    assert.deepEqual(s.outside, { "check writing": { chars: 250, above_line: true }, attribution: { chars: 40, above_line: false } })
    assert.match(renderDelivery(s), /^- Original text delivered: line 100; executor 90 \(A 90\); reviewer 120 \(A 90, B 30\) over the line \(A\+B\); formalizer 0 \(none\) \(outside the line\); cut to ids 2 \(\d+\); read outside the line: check writing 250 \(above the line\), attribution 40\.$/u)
  })

  it("the package for delivery: no paragraph an edge brings, no open item paragraph, each revised unit as its earlier text alone", () => {
    const reg = store.registry()
    const old = roundPackage(reg, 3, [{ id: "V2.1.1", units: ["R1.S8.P1.s1"] }])
    assert.ok(old.segments.some(s => s.why === "edge") && old.segments.some(s => s.why === "open item"), "the old package has both")
    const p = roundPackage(reg, 3, [], { delivery: true })
    assert.deepEqual(p.segments.filter(s => s.why === "edge" || s.why === "open item"), [])
    assert.deepEqual(p.segments.filter(s => s.why === "this round").map(s => s.paragraph), old.segments.filter(s => s.why === "this round").map(s => s.paragraph), "this round's paragraphs as before")
    const revised = p.segments.filter(s => s.why === "revised")
    assert.deepEqual(revised.map(s => s.parts), [["R2.S13.P4.s4"], ["R2.S11.P5.s3"], ["R2.S11.P6.s4"]])
    for (const s of revised) assert.equal(s.text, `earlier text of ${s.parts![0]}: ${reg.block(s.parts![0])!.text.trim()}`)
    assert.equal(p.edges.to_block, old.edges.to_block, "the edges are still counted")
  })

  it("a comparison names the units it rests on, no text (§0a class E)", () => {
    const out = renderComparisons([{ guard: "G4", args: ["transform"], files: ["in.csv"], output: "exit 0", units: [{ id: "R2.S11.P5.s3", earlier: "old text", now: ["new text"], now_ids: ["R3.S3.P1", "R3.S3.P2"] }] }])
    assert.match(out, /rests on R2\.S11\.P5\.s3 \(its earlier text is above\); now R3\.S3\.P1, R3\.S3\.P2/u)
    assert.ok(!out.includes("old text") && !out.includes("new text"))
  })

  it("an open item: to the executor the reviewer's words, the text it rests on and its material; to the reviewer the material and the unit ids only", () => {
    const reg = store.registry()
    const d = new DeliveryLedger(reg, 3, deliveryLine(5000))
    const ex = renderOpenItem("ingest exits 0 on a missing file", check, run, ["R1.S8.P1.s1"], u => d.quote("executor", u))
    assert.match(ex, /^ingest exits 0 on a missing file\nRequirement: "- Missing input files: exit code 1[^\n]*\nCommand: \["ingest","--input","missing\.csv"\]; input files: none\.\nWhat the program did: exit 0; exit_code: expected 1, got 0\.$/u)
    assert.equal(d.chars("executor", "C"), reg.block("R1.S8.P1.s1")!.text.trim().length)
    const rv = renderItemForReview("V2.1.1", check, run, ["R1.S8.P1.s1"])
    assert.match(rv, /^V2\.1\.1, resting on R1\.S8\.P1\.s1:\nCommand: /u)
    assert.ok(!rv.includes("Missing input files"), "no original text")
    const g = { id: "G3", round: 1, source: "review", units: ["R1.S8.P1.s1"], object: "O20", born: { cycle: "C1.1", program: "C1.1" } } as GuardRecord
    assert.match(renderGuardItem(g, check, run, reg, true, u => d.quote("executor", u)), /fails now \(G3\)\.\nRequirement: R1\.S8\.P1\.s1 \(given above\)\n/u, "the same sentence again in the round: its id")
  })
})
