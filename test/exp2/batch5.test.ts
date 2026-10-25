import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { renderGuardItem } from "../../src/exp2/accept.js"
import { renderRepairs } from "../../src/exp2/report.js"
import type { CheckRecord } from "../../src/exp2/checks.js"
import type { GuardRecord } from "../../src/exp2/guards.js"
import type { CheckRun } from "../../src/exp2/verdict.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { roundText } from "./inputs.js"
import { stubTransport } from "./stubs.js"

/**
 * Batch 5 B (the design session's decision, 2026-10-26): a regression reaches the executor as a repair item with its
 * material — the guard's id, the requirement's text it rests on, the command with its input files, and what the program
 * output against what is expected (the expected value is what the program output when the guard passed).
 */
describe("batch 5 B: a regression's repair item carries its material", () => {
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b5b-")), "b5b")
  before(async () => { await store.ingestRound(1, roundText(1), stubTransport()) })

  it("the four parts, from the guard's check and the failing run", () => {
    const reg = store.registry()
    const unit = "R1.S3.P2.s4"
    const check = { id: "K3", round: 1, key: "k", object: reg.coverOf(unit)!.owner, blocks: [unit], uses: [], unknown: [], reference_script: null, admission: "admitted",
      input: { args: ["transform", "--input", "in.csv", "--recipe", "r.json", "--output", "out.csv"], files: [{ path: "in.csv", content: "id,v\n1,2\n" }, { path: "r.json", content: "[{\"op\":\"filter\"}]" }] },
      assertions: [{ id: "rows", role: "business", source: { kind: "derived", block: unit }, target: { kind: "file", path: "out.csv", line: null, pointer: null, column: null }, tolerance: null, expect: "id,v\n1,2\n" }] } as unknown as CheckRecord
    const guard = { id: "G7", round: 1, source: "library", check: "K3", units: [unit], object: check.object, born: { cycle: "C1.1", program: "C1.1" } } as GuardRecord
    const run = { check: "K3", round: 1, program: "C1.3", outcome: "fail", assertions: [{ id: "rows", ok: false, actual: "id,v\n", role: "business" }], exit_code: 0, stderr_head: "", failure: null } as unknown as CheckRun
    const t = renderGuardItem(guard, check, run, reg)
    assert.match(t, /fails now \(G7\)/u, "the guard's id")
    assert.ok(t.includes(JSON.stringify(reg.block(unit)!.text.trim()).slice(0, 60)), "the requirement's own text")
    assert.match(t, /^Command: \["transform","--input","in\.csv".*\]; input files: in\.csv = "id,v\\n1,2\\n", r\.json = /mu, "the command and every input file")
    assert.match(t, /^What the program did: exit 0; file out\.csv: expected "id,v\\n1,2\\n", got "id,v\\n"/mu, "now against expected")
  })
})

describe("batch 5 A: the report's repairs line counts the regressions", () => {
  it("raised, fixed on the next cycle, still failing then, and the reviewer's word", () => {
    const line = renderRepairs({ untouched_messages: 0, untouched_items: 0, answers: { done: 0, not_done: 0, disagree: 0, none: 0 }, after_untouched: { judged: 0, fixed: 0, touched: 0, untouched: 0 }, rulings: [{ id: "G41", why: "regression_persisted", cycle: "C3.3", word: "superseded" }], regressions: { raised: 3, fixed_next: 2, persisted: 1, adjudicated: { superseded: 1, upheld: 0, unasked: 0 } } })
    assert.match(line, /; regressions 3 \(no repair reverted\): fixed on the next cycle 2, still failing then 1, the reviewer's word superseded 1, upheld 0, unasked 0\.$/u)
  })
})
