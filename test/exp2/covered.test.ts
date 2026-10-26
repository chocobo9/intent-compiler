import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { bindCovered, coveredIn, renderCovered, reviewerRuns, sameOutput, snapshotAssertions, summarizeCovered, uncoveredScope } from "../../src/exp2/covered.js"
import { guardCheck } from "../../src/exp2/guards.js"
import type { CheckRunner, ProgramRef, RunOutput } from "../../src/exp2/runner.js"
import { isNoIssues, reviewEntries } from "../../src/exp2/review.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { roundText } from "./inputs.js"
import { stubTransport } from "./stubs.js"

/**
 * Batch 1 (DESIGN-OPUS-2026-10-26 §11 item 1): code takes the reviewer's runs from its session and numbers them; the
 * reviewer writes `COVERED <sentence ids> BY RUN <n>`; code runs that run again and, the output the same, keeps it as a
 * guard on those sentences (exit code, stdout, files written). Paragraph ids and ids outside the scope are counted only.
 */
describe("[behav] batch 1: COVERED lines become snapshot guards", () => {
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b1-cov-")), "b1c")
  before(async () => { await store.ingestRound(1, roundText(1), stubTransport()) })
  const program = { kind: "built", id: "C1.2", path: "x" } as unknown as ProgramRef
  const out = (o: Partial<RunOutput>): RunOutput => ({ exit_code: 0, stdout: "", stderr: "", files: {}, timed_out: false, ...o })
  const runner = (r: RunOutput): CheckRunner & { calls: number } => { const x = { calls: 0, run: async () => { x.calls++; return r }, literals: () => [] } as unknown as CheckRunner & { calls: number }; return x }
  const materials = {
    files: [{ path: "in.csv", content: "id,v\n1,2\n" }],
    commands: [
      { command: "go build -o dpipe .", output: "" },
      { command: "./dpipe ingest --input missing.csv", output: "ERROR: file not found: missing.csv\n" },
      { command: "cat in.csv", output: "id,v\n1,2\n" },
      { command: "./dpipe transform --input in.csv --recipe r.json --output out.csv", output: "" },
    ],
  }

  it("the runs are the session's runs of the program, numbered from 1 in order, with the files they name", () => {
    const runs = reviewerRuns(materials, "dpipe")
    assert.deepEqual(runs.map(r => [r.n, r.args[0]]), [[1, "ingest"], [2, "transform"]])
    assert.deepEqual(runs[1].input.files.map(f => f.path), ["in.csv"])
  })

  it("COVERED lines: ids by commas or spaces, the run's number; they are control lines, not deviations", () => {
    const text = "COVERED R1.S8.P1.s1, R1.S8.P1.s2 BY RUN 1\n- `COVERED R1.S2.P1.s1#abcd1234 R1.S2.P1.s2 BY RUN #2`\nNO ISSUES"
    assert.deepEqual(coveredIn(text).map(c => [c.ids, c.run]), [[["R1.S8.P1.s1", "R1.S8.P1.s2"], 1], [["R1.S2.P1.s1", "R1.S2.P1.s2"], 2]])
    assert.ok(isNoIssues(text))
    assert.deepEqual(reviewEntries(text), [])
  })

  it("the same output: stdout and stderr together or alone, line ends aside", () => {
    assert.ok(sameOutput("ERROR: file not found: missing.csv\n", out({ exit_code: 1, stderr: "ERROR: file not found: missing.csv\r\n" })))
    assert.ok(sameOutput("", out({})))
    assert.ok(!sameOutput("", out({ stdout: "x" })))
    assert.ok(!sameOutput("something else", out({ stderr: "ERROR: file not found: missing.csv" })))
  })

  it("a bound run run again with the same output is a guard on the scope sentences, asserting exit code, stdout and the files it wrote", async () => {
    const reg = store.registry()
    const runs = reviewerRuns(materials, "dpipe")
    const r = runner(out({ exit_code: 1, stderr: "ERROR: file not found: missing.csv\n" }))
    let next = 7
    const { records, guards } = await bindCovered("COVERED R1.S8.P1.s1, R1.S8.P1 BY RUN 1\nCOVERED R1.S8.P1.s9 BY RUN 1\nCOVERED R1.S8.P1.s2 BY RUN 5", runs, {
      registry: reg, round: 1, review: "R1.1", cycle: "C1.2", program, runner: r, timeoutMs: 1000, open: new Set(["R1.S8.P1.s1", "R1.S8.P1.s2"]), nextGuard: () => `G${next++}`,
    })
    assert.deepEqual(records.map(x => [x.outcome, x.bound, x.ignored.map(i => `${i.id}:${i.why}`)]), [
      ["guard", ["R1.S8.P1.s1"], ["R1.S8.P1:coarser than a sentence"]],
      ["no_scope_sentence", [], [`R1.S8.P1.s9:${reg.block("R1.S8.P1.s9") ? "not in scope" : "unknown"}`]],
      ["no_such_run", ["R1.S8.P1.s2"], []],
    ])
    assert.equal(guards.length, 1)
    const g = guards[0]
    assert.deepEqual([g.id, g.source, g.units, g.snapshot, g.born], ["G7", "review", ["R1.S8.P1.s1"], { review: "R1.1", run: 1 }, { cycle: "C1.2", program: "C1.2" }])
    assert.deepEqual(guardCheck(g, []).assertions.map(a => [a.target.kind, a.expect]), [["exit_code", 1], ["stdout", ""]])
    const s = summarizeCovered(records)
    assert.deepEqual([s.lines, s.guards, s.bound, s.no_such_run, s.no_scope_sentence, s.per_line], [3, 1, 1, 1, 1, 1])
    assert.match(renderCovered(s, 0, 4), /^- COVERED lines: 3; snapshot guards born 1, binding 1 sentences \(1 a line\); not reproduced 0, no such run 1, no scope sentence 1; ids set aside: coarser than a sentence 1, (?:not in scope|unknown) 1\. Snapshot guard flips 0; scope sentences left uncovered at the end 4\.$/u)
  })

  it("output that differs on the run again: not reproduced, no guard; the files a run writes are asserted, its inputs not", async () => {
    const reg = store.registry()
    const runs = reviewerRuns(materials, "dpipe")
    const { records, guards } = await bindCovered("COVERED R1.S8.P1.s1 BY RUN 1", runs, { registry: reg, round: 1, review: "R1.1", cycle: "C1.2", program, runner: runner(out({ exit_code: 0, stdout: "ok" })), timeoutMs: 1000, open: new Set(["R1.S8.P1.s1"]), nextGuard: () => "G1" })
    assert.deepEqual([records[0].outcome, guards.length], ["not_reproduced", 0])
    const a = snapshotAssertions(out({ files: { "in.csv": "id,v\n", "out.csv": "id\n1\n" } }), { args: [], files: [{ path: "in.csv", content: "id,v\n" }] })
    assert.deepEqual(a.map(x => [x.target.kind, x.target.path]), [["exit_code", null], ["stdout", null], ["file", "out.csv"]])
  })

  it("what reviews still owe: scope sentences no passing guard holds and no open item covers", () => {
    const reg = store.registry()
    const g = { id: "G1", round: 1, source: "review" as const, units: ["R1.S8.P1.s1"], object: "O20", born: { cycle: "C1.1", program: "C1.1" } }
    const scope = ["R1.S8.P1.s1", "R1.S8.P1.s2", "R1.S8.P1.s3"]
    assert.deepEqual(uncoveredScope(reg, scope, [g], new Map([["G1", "passing"]]), ["R1.S8.P1.s3"]), ["R1.S8.P1.s2"])
    assert.deepEqual(uncoveredScope(reg, scope, [g], new Map([["G1", "failing"]]), []), scope)
  })
})
