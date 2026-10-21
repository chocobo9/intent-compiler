import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { EMPTY_DRAFT, ReplayMiss, applyPatch, buildRequest, byCause, checkAnswer, type AnswerPatch } from "../../src/exp2/attribution.js"
import { goBuilder } from "../../src/exp2/build.js"
import { checkIssuesByCause, staleChecks, type CheckRecord } from "../../src/exp2/checks.js"
import { DEFAULT_LIMITS } from "../../src/exp2/execution.js"
import { materialize } from "../../src/exp2/registry.js"
import { emptyCassette, loadCassette, recordingTransports, replayByRound, replayTransports } from "../../src/exp2/recording.js"
import { LocalProcessRunner, LocalScriptSandbox } from "../../src/exp2/runner.js"
import { Serial } from "../../src/exp2/serial.js"
import { splitRound } from "../../src/exp2/source.js"
import { buildWorkOrder, renderWorkOrder } from "../../src/exp2/workorder.js"
import { serialExecutor } from "./serial-executor.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { checkStubTransport } from "./check-stubs.js"
import { roundText } from "./inputs.js"
import { stubTransport } from "./stubs.js"

const HAIKU = resolve(process.cwd(), "exp2/recordings/haiku-reference")
const BATCH2 = join(HAIKU, "batch2")

describe("exp2 recordings: Haiku batch 2 (requests built at e7c2929) re-keyed by answer order", () => {
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b2-")), "b2")
  const replay = replayByRound(loadCassette(join(BATCH2, "cassette.json")))
  /** Registries after each accepted round, for the unit cases on real text. */
  const before = (round: number) => {
    const s = store.inspect()
    return materialize(s.sources.filter(x => x.round < round), s.rounds.filter(r => r.round < round).map(r => r.acceptance!))
  }
  const answer = (name: string) => JSON.parse(readFileSync(join(BATCH2, "answers", name), "utf8")) as AnswerPatch
  const sourced = (registry: ReturnType<typeof materialize>, round: number) => { registry.addSource(splitRound(round, roundText(round))); return registry }

  it("all 15 attribution rounds stay accepted; the repair answers the new rules make unnecessary are reported", async () => {
    for (let round = 1; round <= 15; round++) assert.equal((await store.ingestRound(round, roundText(round), replay.attribution, { maxRepairs: 2 })).status, "accepted", `R${round}`)
    const calls = store.inspect().calls
    // Only R1 still needs its repair (R1.S1 marked none over sections with other owners); R6, R9, R10, R11, R12, R15
    // now pass on the first answer, so their recorded repairs go unused.
    assert.deepEqual([...new Set(calls.filter(c => c.kind === "repair").map(c => c.round))], [1])
    assert.deepEqual(replay.unused().filter(u => u.step === "attribution").map(u => `R${u.round}#${u.answer}`), ["R6#2", "R9#2", "R10#2", "R11#2", "R12#2", "R15#2"])
    assert.ok(calls.every(c => c.usage_unknown === true && c.stub === false && /haiku/u.test(c.model ?? "")), "no usage recorded: unknown, not zero")
  })

  it("R6 (§12d item 1): refers_to an object is accepted, and a later revision of that object's text stales checks resting on the citing block", () => {
    const r6 = sourced(before(6), 6)
    const checked = checkAnswer(r6, 6, applyPatch(EMPTY_DRAFT, answer("R6-ans1.json")))
    assert.deepEqual(checked.issues, [])
    assert.ok(checked.acceptance!.answer.references.some(e => e.kind === "refers_to" && e.from === "R6.S2.P3" && e.to === "O17"))
    // An id that does not exist is named as such, with the ids there are.
    const wrong = applyPatch(EMPTY_DRAFT, { ...answer("R6-ans1.json"), edges_add: [{ from: "R6.S2.P3", to: "O999", kind: "refers_to" }] })
    assert.match(checkAnswer(r6, 6, wrong).issues[0].message, /there is no object O999 yet \(objects so far: O1–O\d+\)/u)
    // R7 partly revises lineage (O40), which R6.S2.P3 refers to: a check resting on R6.S2.P3 goes stale through the edge.
    const all = store.registry()
    const check = { id: "K1", round: 6, key: "k", object: all.coverOf("R6.S2.P3")!.owner, blocks: ["R6.S2.P3"], uses: [], direction: "holds", input: { args: [], files: [] }, assertions: [], unknown: [], reference_script: null, admission: "admitted", admission_reason: null, strength: null, status: "active", calls: [] } as unknown as CheckRecord
    assert.deepEqual(staleChecks(all, [check], [], 6), [])
    const stale = staleChecks(all, [check], [], 7)
    assert.deepEqual(stale.map(e => e.cause), [{ kind: "refers_to", source: "O40" }])
    assert.match(stale[0].reason, /R6\.S2\.P3 refers to O40, partly revised in round 7/u)
  })

  it("R9 (§12d item 2): a section and its subsections given to the same object is one assignment", () => {
    const r9 = sourced(before(9), 9)
    const checked = checkAnswer(r9, 9, applyPatch(EMPTY_DRAFT, answer("R9-ans1.json")))
    assert.deepEqual(checked.issues, [])
    const blocks = checked.acceptance!.answer.assignments.map(a => a.block)
    assert.ok(blocks.includes("R9.S1") && !blocks.includes("R9.S2") && !blocks.includes("R9.S3"), "the nested ones are dropped")
    assert.ok(blocks.includes("R9.S4") && !blocks.includes("R9.S5"))
  })

  it("R15 (§12d item 6): the R13 code block and table it revises are amended, not replaced; the work order shows both", () => {
    const r = store.registry()
    const snapshot = r.objectByName("snapshot")!
    const m = snapshot.blocks.flatMap(b => b.modifications).find(x => x.round === 15)!
    assert.deepEqual(m.amended, ["R13.S4.P1", "R13.S5.P1"])
    assert.deepEqual([r.block("R13.S4.P1")!.kind, r.block("R13.S5.P1")!.kind], ["code", "table"])
    // In the object's brief the amended blocks are in force; the replaced list items are not.
    const brief = buildRequest(r, 15).objects.find(o => o.id === snapshot.id)!
    assert.deepEqual(brief.amended, ["R13.S4.P1", "R13.S5.P1"])
    assert.ok(brief.modified!.includes("R13.S7.P1.s8") && !brief.modified!.includes("R13.S4.P1"))
    const wo = buildWorkOrder({ registry: r, round: 15, library: [], events: [], statuses: [], runs: [], anchors: [], links: [], steps: [], previous_task: [] })
    const text = renderWorkOrder(wo)
    assert.match(text, /R13\.S4\.P1, R13\.S5\.P1 amended by R15\.S2\.P1\.s2, R15\.S2\.P2\.s1; where they differ, the newer text wins/u)
    assert.ok(/\[R15\.S2[\].· ]/u.test(text), "the amending text is in the source zone too")
  })

  it("the checks serial R1–R3 (stand-in executor, local runs) stays accepted with the recorded answers", async () => {
    process.env.GIT_AUTHOR_DATE = process.env.GIT_COMMITTER_DATE = "2026-10-20T00:00:00Z"
    const dir = mkdtempSync(join(tmpdir(), "exp2-b2-checks-"))
    const r = replayByRound(loadCassette(join(BATCH2, "cassette.json")))
    const serialStore = new Exp2Store(join(dir, "store"), "b2-checks")
    const serial = new Serial({
      store: serialStore, workdir: join(dir, "work"), checkpoints: join(dir, "checkpoints"), text: roundText, attribution: r.attribution, checks: r.checks,
      executor: serialExecutor([], new Set()), executorIsStub: true, anchors: new GoAnchorExtractor(), runner: new LocalProcessRunner(), sandbox: new LocalScriptSandbox(),
      build: goBuilder(join(dir, "builds"), {}, "dpipe"),
      limits: { attributionRepairs: 2, checkRepairs: 2, managementTimeoutMs: 60_000, checkTimeoutMs: 20_000, execution: DEFAULT_LIMITS },
    })
    assert.equal((await serial.run({ to: 3 })).status, "done")
    const s = serialStore.inspect()
    assert.deepEqual(s.check_rounds.map(c => `${c.round}:${c.status}`), ["1:accepted", "2:accepted", "3:accepted"])
    CHECK_SUMMARY.calls = s.check_calls.map(c => `R${c.round}#${c.attempt}:${c.issues.map(i => i.code).join(",") || "ok"}`)
    CHECK_SUMMARY.entered = s.check_rounds.map(c => c.entered.length)
    CHECK_SUMMARY.admitted = s.checks.filter(k => k.admission === "admitted").length
    CHECK_SUMMARY.strong = s.checks.filter(k => k.strength?.strong).length
    CHECK_SUMMARY.first_r1 = s.check_calls.find(c => c.round === 1)!.issues.map(i => i.message)
    assert.ok((CHECK_SUMMARY.first_r1 as string[]).some(m => /make the source derived and have the reference script compute it/u.test(m)), "the verbatim mismatch points to the derived route")
    assert.ok((CHECK_SUMMARY.first_r1 as string[]).some(m => /shared convention the check lists in uses/u.test(m)), "the basis issue names the uses route")
    CHECK_SUMMARY.unused = r.unused().filter(u => u.step === "checks").map(u => `R${u.round}#${u.answer}`)
    process.stdout.write(`# batch2 checks: ${JSON.stringify({ ...CHECK_SUMMARY, first_r1: undefined })}\n`)
  })

  it("the recorded requests are not today's: hash replay of batch 2 misses at R1, with no stand-in answer", async () => {
    const hash = replayTransports(loadCassette(join(BATCH2, "cassette.json")))
    await assert.rejects(new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b2-")), "b2").ingestRound(1, roundText(1), hash.attribution), ReplayMiss)
  })
})

const CHECK_SUMMARY: Record<string, unknown> = {}

describe("exp2 recordings: record, then replay the same run", () => {
  it("records request, answer and usage verbatim, and the replay gives the same rounds", async () => {
    const cassette = emptyCassette("stand-in (test)")
    const rec = recordingTransports({ attribution: stubTransport(), checks: checkStubTransport() }, cassette)
    const a = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-rec-")), "rec")
    for (const round of [1, 2]) await a.ingestRound(round, roundText(round), rec.attribution)
    assert.ok(cassette.entries.length >= 2 && cassette.entries.every(e => e.step === "attribution" && e.prompt.includes("# REQUEST\n")))
    const replay = replayTransports(JSON.parse(JSON.stringify(cassette)))
    const b = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-rec-")), "rec")
    for (const round of [1, 2]) await b.ingestRound(round, roundText(round), replay.attribution)
    const strip = (s: Exp2Store) => s.inspect().rounds.map(r => ({ status: r.status, acceptance: r.acceptance }))
    assert.deepEqual(strip(b), strip(a))
    assert.deepEqual(replay.unused(), [])
  })
})

describe("exp2 issues by root cause (§12d items 3, 4)", () => {
  it("attribution: the same cause at several places is one issue naming every place", () => {
    const merged = byCause([
      { code: "reference_invalid", message: "edge 2 (refers_to R6.S2.P3 -> O999): there is no object O999 yet" },
      { code: "reference_invalid", message: "edge 5 (refers_to R6.S4.P1 -> O999): there is no object O999 yet" },
      { code: "reference_invalid", message: "edge 6 (applies_to R6.S5 -> R1.S9): R1.S9 belongs to no object" },
    ])
    assert.equal(merged.length, 2)
    assert.equal(merged[0].message, "edge 2 (refers_to R6.S2.P3 -> O999); edge 5 (refers_to R6.S4.P1 -> O999): there is no object O999 yet")
  })

  it("checks: one issue per check and kind, listing the assertions; a value not in the quote points to the derived route", () => {
    const merged = checkIssuesByCause([
      { code: "verbatim_mismatch", check: "fill", message: "check fill assertion a1: the expected value \"\" does not occur literally" },
      { code: "verbatim_mismatch", check: "fill", message: "check fill assertion a2: the expected value true does not occur literally" },
      { code: "exit_missing", check: "fill", message: "check fill: state the expected exit code" },
      { code: "verbatim_mismatch", check: "sort", message: "check sort assertion a1: …" },
    ])
    assert.deepEqual(merged.map(i => `${i.code}:${i.check}`), ["verbatim_mismatch:fill", "exit_missing:fill", "verbatim_mismatch:sort"])
    assert.match(merged[0].message, /^check fill, 2 problems of one kind \(verbatim_mismatch\): assertion a1: .*; assertion a2: /u)
    const recorded = CHECK_SUMMARY.first_r1 as string[] | undefined
    if (recorded) assert.ok(recorded.some(m => /make the source derived and have the reference script compute it/u.test(m)))
  })
})
