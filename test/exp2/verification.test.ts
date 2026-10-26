import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import type { CheckEvent, CheckRecord } from "../../src/exp2/checks.js"
import type { GuardEvent, GuardRecord } from "../../src/exp2/guards.js"
import { renderRoleTime } from "../../src/exp2/report.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { renderVerification, ruleNotBehaviour, sentencesInForce, summarizeVerification, verificationStates } from "../../src/exp2/verification.js"
import { roundText } from "./inputs.js"
import { stubTransport } from "./stubs.js"

/**
 * Batch 1 (DESIGN-OPUS-2026-10-26 §2, §10.2 G1–G3, §11 item 2): the verification state per sentence, from guards and
 * checks alone. A paragraph cited covers none of its sentences (decision B); an open item takes its sentences out of
 * the debt; code blocks, examples, JSON values and lead-ins are not behaviour by rule.
 */
describe("[mech] batch 1: the verification state, per sentence", () => {
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b1-verif-")), "b1v")
  before(async () => { for (const r of [1, 2, 3]) await store.ingestRound(r, roundText(r), stubTransport()) })
  const guard = (id: string, units: string[], source: GuardRecord["source"] = "review", check?: string): GuardRecord => ({ id, round: 1, source, ...(check ? { check } : {}), units, object: "O20", born: { cycle: "C1.1", program: "C1.1" } } as GuardRecord)
  const ev = (g: string, status: GuardEvent["status"]): GuardEvent => ({ guard: g, round: 1, cycle: "C1.1", status, program: "C1.1" } as GuardEvent)
  const check = (id: string, blocks: string[]): CheckRecord => ({ id, round: 1, key: id, object: "O20", blocks, uses: [], unknown: [], reference_script: null, admission: "admitted", admission_reason: null, strength: null, status: "active", calls: [], input: { args: ["ingest"], files: [] }, assertions: [] } as unknown as CheckRecord)
  const events: CheckEvent[] = []

  it("not behaviour by rule: a code block, what follows Example:, a lead-in ending in a colon; a rule list item is behaviour", () => {
    const reg = store.registry()
    assert.equal(ruleNotBehaviour(reg, reg.block("R1.S3.P11.s3")!), "code block")
    assert.equal(ruleNotBehaviour(reg, reg.block("R1.S3.P11.s2")!), "lead-in", "\"Example:\" is a lead-in itself")
    assert.equal(ruleNotBehaviour(reg, reg.block("R1.S2.P3.s1")!), "lead-in")
    assert.equal(ruleNotBehaviour(reg, reg.block("R1.S8.P1.s1")!), null)
  })

  it("in force: a sentence a later round revises is in force before it, not after", () => {
    const reg = store.registry()
    assert.ok(sentencesInForce(reg, 2).some(s => s.id === "R2.S11.P5.s3"))
    assert.ok(!sentencesInForce(reg, 3).some(s => s.id === "R2.S11.P5.s3"))
  })

  it("held by a passing guard on the sentence; a guard on the paragraph holds none (nominal only); a never-passed check makes it failing; an open item takes it out of the debt", () => {
    const reg = store.registry()
    const guards = [guard("G1", ["R1.S8.P1.s1"]), guard("G2", ["R1.S8.P2"]), guard("G3", ["R1.S8.P1.s5"])]
    const states = verificationStates(reg, 1, {
      guards, guardEvents: [ev("G1", "passing"), ev("G2", "passing"), ev("G3", "failing")],
      library: [check("K1", ["R1.S8.P1.s2"])], checkEvents: events,
      open: [{ id: "V1.1.1", units: ["R1.S8.P1.s3"] }],
    })
    const at = (id: string) => states.find(s => s.id === id)!
    assert.deepEqual([at("R1.S8.P1.s1").state, at("R1.S8.P1.s1").debt], ["held", false])
    assert.deepEqual([at("R1.S8.P1.s2").state, at("R1.S8.P1.s2").never_passed, at("R1.S8.P1.s2").debt], ["failing", true, true])
    assert.deepEqual([at("R1.S8.P1.s3").open, at("R1.S8.P1.s3").debt], [true, false])
    assert.deepEqual([at("R1.S8.P1.s4").state, at("R1.S8.P1.s4").nominal, at("R1.S8.P1.s4").debt], ["unverified", false, true])
    assert.deepEqual([at("R1.S8.P1.s5").state, at("R1.S8.P1.s5").debt], ["failing", true], "a failing guard holds nothing")
    const p2 = states.filter(s => s.paragraph === "R1.S8.P2")
    assert.ok(p2.length > 0 && p2.every(s => s.state === "unverified" && s.nominal), "the paragraph guard is nominal coverage only")
    // A library guard (a check that passed) on a clause of the sentence holds it.
    const clause = reg.block("R1.S8.P1.s4")!.children[0]
    const viaClause = verificationStates(reg, 1, { guards: [guard("G9", [clause], "library", "K9")], guardEvents: [ev("G9", "passing")], library: [check("K9", [clause])], checkEvents: events })
    assert.equal(viaClause.find(s => s.id === "R1.S8.P1.s4")!.state, "held")
  })

  it("the summary: counts, nominal against passing coverage, debt by paragraph, and what entered and left it since the start", () => {
    const reg = store.registry()
    const start = verificationStates(reg, 1, { guards: [], guardEvents: [], library: [], checkEvents: events })
    const end = verificationStates(reg, 1, { guards: [guard("G1", ["R1.S8.P1.s1"]), guard("G2", ["R1.S8.P2"])], guardEvents: [ev("G1", "passing"), ev("G2", "passing")], library: [], checkEvents: events })
    const v = summarizeVerification(reg, 1, end, start)
    assert.equal(v.sentences, sentencesInForce(reg, 1).length)
    assert.equal(v.held, 1)
    assert.equal(v.coverage.passing, 1)
    assert.ok(v.coverage.nominal > v.coverage.passing, JSON.stringify(v.coverage))
    assert.deepEqual(v.delta, { entered: 0, cleared: 1 })
    assert.equal(v.debt.sentences, v.coverage.behaviour - 1)
    assert.ok(v.not_behaviour.by_rule["code block"]! > 0 && v.not_behaviour.by_rule["lead-in"]! > 0)
    assert.match(renderVerification(v), /^- Verification state: \d+ sentences in force; held 1, .*passing 1 \(\d+%\)\. Debt \d+ sentences in \d+ paragraphs, \d+ characters; this round entered 0, cleared 1\.$/u)
  })

  it("the roles' wall time (G12): stages grouped by role, check writing beside the coding", () => {
    const st = (stage: string, ms: number) => ({ stage, ms, spans: 1, first_start_ms: 0, last_end_ms: ms })
    const line = renderRoleTime({ round_ms: 600_000, stages: [st("coding", 240_000), st("repair", 60_000), st("review", 180_000), st("formalize", 30_000), st("checks", 120_000), st("guard rerun", 12_000), st("waiting for checks", 5_000)] })
    assert.equal(line, "- Wall time: round 10.0 min; executor 5.0 min, reviewer 3.0 min, formalizer 0.5 min, attribution 0.0 min, check writing 2.0 min, code 0.2 min (check writing runs beside the coding).")
  })
})
