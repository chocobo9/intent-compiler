import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { EMPTY_DRAFT, ReplayMiss, applyPatch, buildRequest, byCause, checkAnswer, type AnswerPatch } from "../../src/exp2/attribution.js"
import { goBuilder } from "../../src/exp2/build.js"
import { checkIssuesByCause, codeFacts, staleChecks, type AssertionDraft, type CheckRecord, type ChecksPatch } from "../../src/exp2/checks.js"
import { DEFAULT_LIMITS } from "../../src/exp2/execution.js"
import { materialize } from "../../src/exp2/registry.js"
import { emptyCassette, entryRound, loadCassette, recordingTransports, replayByRound, replayTransports } from "../../src/exp2/recording.js"
import { LocalProcessRunner, LocalScriptSandbox, type CheckRunner } from "../../src/exp2/runner.js"
import { objectStatuses, runCheck } from "../../src/exp2/verdict.js"
import { Serial } from "../../src/exp2/serial.js"
import { splitRound } from "../../src/exp2/source.js"
import { buildWorkOrder, renderWorkOrder } from "../../src/exp2/workorder.js"
import { serialExecutor } from "./serial-executor.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { checkStubTransport } from "./check-stubs.js"
import { roundText } from "./inputs.js"
import { stubTransport } from "./stubs.js"
import { standInReview } from "./review-stubs.js"

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
    // Every round now passes on the first answer: R1.S1 marked none over sections with other owners keeps its own
    // heading (the most specific assignment wins, BLOCK9 §2.7); refers_to objects and same-owner nesting are fine.
    assert.deepEqual(calls.filter(c => c.kind === "repair").map(c => c.round), [])
    assert.deepEqual(replay.unused().filter(u => u.step === "attribution").map(u => `R${u.round}#${u.answer}`), ["R1#2", "R6#2", "R9#2", "R10#2", "R11#2", "R12#2", "R15#2"])
    assert.ok(calls.every(c => c.usage_unknown === true && c.stub === false && /haiku/u.test(c.model ?? "")), "no usage recorded: unknown, not zero")
  })

  it("R6 (§12d item 1): refers_to an object is accepted; a later revision of that object's text no longer stales checks on the citing block (§12j.5)", () => {
    const r6 = sourced(before(6), 6)
    const checked = checkAnswer(r6, 6, applyPatch(EMPTY_DRAFT, answer("R6-ans1.json")))
    assert.deepEqual(checked.issues, [])
    assert.ok(checked.acceptance!.answer.references.some(e => e.kind === "refers_to" && e.from === "R6.S2.P3" && e.to === "O17"))
    // An id that does not exist is named as such, with the ids there are.
    const wrong = applyPatch(EMPTY_DRAFT, { ...answer("R6-ans1.json"), edges_add: [{ from: "R6.S2.P3", to: "O999", kind: "refers_to" }] })
    assert.match(checkAnswer(r6, 6, wrong).issues[0].message, /There is no object O999 yet \(objects so far: O1–O\d+\)/u)
    // R7 partly revises lineage (O40), which R6.S2.P3 refers to: staleness through the edge is deleted (§12j.5).
    const all = store.registry()
    const check = { id: "K1", round: 6, key: "k", object: all.coverOf("R6.S2.P3")!.owner, blocks: ["R6.S2.P3"], uses: [], input: { args: [], files: [] }, assertions: [], unknown: [], reference_script: null, admission: "admitted", admission_reason: null, strength: null, status: "active", calls: [] } as unknown as CheckRecord
    assert.deepEqual(staleChecks(all, [check], [], 7), [])
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

  it("R3 and R15 (§12d item 8): the source zone marks each revised clause and amended block where it stands, naming the revising text", () => {
    const r = store.registry()
    const wo3 = renderWorkOrder(buildWorkOrder({ registry: materialize(store.inspect().sources.filter(x => x.round <= 3), store.inspect().rounds.filter(x => x.round <= 3).map(x => x.acceptance!)), round: 3, library: [], events: [], statuses: [], runs: [], anchors: [], links: [], steps: [], previous_task: [] }))
    // fill: only the "cell remains empty" clause, right before it; normalize: the population-stddev clauses.
    assert.ok(wo3.includes("(no non-empty numeric value exists above or below), ⟦R2.S13.P4.s4.c3 → revised by R3.S2.P2.s1, R3.S2.P2.s2⟧ the cell remains empty."))
    assert.ok(wo3.includes("⟦R2.S11.P5.s3.c1 → revised by R3.S3.P1.s1, R3.S3.P2⟧ - For `zscore`: compute `mean` and population `stddev` ⟦R2.S11.P5.s3.c2 → revised by R3.S3.P1.s1, R3.S3.P2⟧ (`sqrt(sum((xi - mean)^2) / n)`)."))
    assert.equal((wo3.match(/⟦R2\./gu) ?? []).length, 3, "no other R2 text is marked")
    // The text is not rewritten: without the markers it is the source text byte for byte.
    const fill = r.block("R2.S13")!
    assert.ok(wo3.replace(/⟦[^⟧]*⟧ /gu, "").includes(fill.text.trimEnd()))
    const wo15 = renderWorkOrder(buildWorkOrder({ registry: r, round: 15, library: [], events: [], statuses: [], runs: [], anchors: [], links: [], steps: [], previous_task: [] }))
    assert.ok(wo15.includes("⟦R13.S4.P1 → amended by R15.S2.P1.s2, R15.S2.P2.s1⟧"))
    assert.ok(wo15.includes("⟦R13.S7.P1.s8 → revised by R15.S2.P1.s2, R15.S2.P2.s1⟧"))
  })

  it("the checks serial R1–R3 (stand-in executor, local runs) stays accepted with the recorded answers", async () => {
    process.env.GIT_AUTHOR_DATE = process.env.GIT_COMMITTER_DATE = "2026-10-20T00:00:00Z"
    const dir = mkdtempSync(join(tmpdir(), "exp2-b2-checks-"))
    const r = replayByRound(loadCassette(join(BATCH2, "cassette.json")))
    const serialStore = new Exp2Store(join(dir, "store"), "b2-checks")
    const serial = new Serial({
      ...standInReview(dir), store: serialStore, workdir: join(dir, "work"), checkpoints: join(dir, "checkpoints"), text: roundText, attribution: r.attribution, checks: r.checks,
      executor: serialExecutor([], new Set()), executorIsStub: true, anchors: new GoAnchorExtractor(), runner: new LocalProcessRunner(), sandbox: new LocalScriptSandbox(),
      build: goBuilder(join(dir, "builds"), {}, "dpipe"),
      limits: { attributionRepairs: 2, checkRepairs: 1, managementTimeoutMs: 60_000, checkTimeoutMs: 20_000, execution: DEFAULT_LIMITS },
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
    // Haiku answered twice per round: the replay allows one repair, and what is left after it is per-check admission and coverage.
    CHECK_SUMMARY.coverage = s.check_rounds.map(c => c.coverage ? `${c.coverage.covered.length}/${c.coverage.units.length}` : "-")
    CHECK_SUMMARY.dropped = s.check_rounds.map(c => (c.dropped ?? []).map(d => d.key))
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

describe("exp2 readings the text does not state (§12d item 10), on the real R4 validate check", () => {
  const cassette = loadCassette(join(BATCH2, "cassette.json"))
  const r4 = cassette.entries.filter(e => e.step === "checks" && entryRound(e) === 4)[0]
  const draft = (JSON.parse(r4.answer) as ChecksPatch).upsert.find(k => k.key === "validate_violation_report")!
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-reading-")), "reading")
  const record = (assertions: AssertionDraft[]): CheckRecord => ({
    id: "K99", round: 4, key: draft.key, object: draft.object, blocks: draft.blocks, uses: draft.uses, input: draft.input,
    assertions: assertions.map(({ expect_json, ...a }) => ({ ...a, expect: JSON.parse(expect_json) })), unknown: [], reference_script: null,
    admission: "admitted", admission_reason: null, strength: null, status: "active", calls: [],
  })
  // The report as the check expects it, and as a program numbering violation rows from 0 would write it.
  const report = (shift: number, message?: string) => {
    const at = (id: string) => JSON.parse(draft.assertions.find(a => a.id === id)!.expect_json)
    const violations = draft.assertions.filter(a => /^v\d+$/u.test(a.id)).map(a => { const v = JSON.parse(a.expect_json); return { ...v, row: typeof v.row === "number" ? v.row + shift : v.row, ...(message ? { message } : {}) } })
    return JSON.stringify({ valid: at("valid"), summary: { total_violations: at("total"), columns_checked: at("cols"), rows_checked: at("rows") }, violations })
  }
  const runner = (content: string): CheckRunner => ({ run: async (_program, input) => ({ exit_code: 0, stdout: "", stderr: "", timed_out: false, files: { ...Object.fromEntries(input.files.map(f => [f.path, f.content])), "report.json": content } }), literals: () => new Set(["validate", "--input", "--schema", "--output"]) })
  const program = { id: "p", label: "", command: ["validate-stub"], source_dir: null }
  const rowReading = "Violation rows count data rows from 1, the header not counted."

  it("the bundled v0..v5 (row, rule, value, message in one object) fail on a 0-based program: not landed without a reading, unknown with one", async () => {
    const r = replayByRound(cassette)
    for (let round = 1; round <= 4; round++) assert.equal((await store.ingestRound(round, roundText(round), r.attribution)).status, "accepted")
    assert.ok(draft.assertions.filter(a => /^v\d+$/u.test(a.id)).length >= 6, "the recorded check bundles each violation into one JSON assertion")
    const registry = store.registry(), facts = codeFacts(registry, 4)
    assert.equal((await runCheck(record(draft.assertions), program, runner(report(0)), 4, registry, facts, 1000)).outcome, "pass", "the check's own reading passes")
    // The derived values stand as upheld by a ruling (DESIGN §12g): without one, their failure is a disagreement to rule on.
    const plain = await runCheck(record(draft.assertions), program, runner(report(-1)), 4, registry, facts, 1000, new Set(["reference"]))
    assert.deepEqual([plain.failure!.class, plain.failure!.reason], ["not_landed", "value_mismatch"])
    const read = await runCheck(record(draft.assertions.map(a => /^v\d+$/u.test(a.id) ? { ...a, reading: rowReading } : a)), program, runner(report(-1)), 4, registry, facts, 1000)
    assert.deepEqual([read.failure!.class, read.failure!.reason], ["unknown", "reading"])
    assert.match(read.failure!.detail, /rests on the reading "Violation rows count data rows from 1/u)
  })

  it("split one fact per assertion: the row with its reading apart; a wrong message is still not landed, a 0-based row only unknown", async () => {
    const registry = store.registry(), facts = codeFacts(registry, 4)
    const split = draft.assertions.flatMap((a): AssertionDraft[] => {
      if (!/^v\d+$/u.test(a.id)) return [a]
      const v = JSON.parse(a.expect_json) as Record<string, unknown>
      return Object.entries(v).map(([field, value]) => ({ ...a, id: `${a.id}.${field}`, target: { ...a.target, pointer: `${a.target.pointer}/${field}` }, expect_json: JSON.stringify(value), reading: field === "row" && typeof value === "number" ? rowReading : null }))
    })
    const k = record(split)
    const shifted = await runCheck(k, program, runner(report(-1)), 4, registry, facts, 1000)
    assert.deepEqual([shifted.failure!.class, shifted.failure!.reason], ["unknown", "reading"])
    assert.ok(shifted.assertions.filter(a => !a.ok).every(a => a.id.endsWith(".row")), "only the row facts fail")
    const wrong = await runCheck(k, program, runner(report(0, "bad")), 4, registry, facts, 1000, new Set(["reference"]))
    assert.deepEqual([wrong.failure!.class, wrong.failure!.reason], ["not_landed", "value_mismatch"])
    // The work order shows the reading next to the failure, in the status zone (unknown never becomes a task).
    const status = objectStatuses(registry, [{ ...k, strength: { strong: true, baseline: "b", baseline_ok: true, data_assertions: ["total"], reason: "" } }], [], [{ ...shifted, verdict: true }], 4).find(s => s.object === k.object)!
    assert.equal(status.status, "unknown")
    const wo = renderWorkOrder(buildWorkOrder({ registry, round: 4, library: [k], events: [], statuses: [status], runs: [shifted], anchors: [], links: [], steps: [], previous_task: [] }))
    // validate is a task this round (it changed): the reading stands next to the evidence, marked as not counted.
    assert.match(wo, /failing, not counted against the program K99 \(reading\): .*v0\.row expected 2, got 1 \(this expectation rests on a reading the text does not state: Violation rows count data rows from 1/u)
    // An object that is no task shows it in the status zone, and the reading still makes it no task.
    const quiet = buildWorkOrder({ registry, round: 5, library: [k], events: [], statuses: [status], runs: [shifted], anchors: [], links: [], steps: [], previous_task: [] })
    assert.ok(!quiet.task.some(t => t.object === k.object))
    assert.match(renderWorkOrder(quiet), /K99 v0\.row expected 2, got 1; the expectation rests on a reading the text does not state: Violation rows count/u)
    // Later text that names the check's basis may state the reading: the check goes stale.
    const later = materialize(store.inspect().sources, store.inspect().rounds.map(x => x.acceptance!))
    later.references.push({ from: "R5.S1.P1", to: "R4.S3.P1", kind: "refers_to", round: 5 })
    // A later mention no longer stales it (§12j.5): a flip of a guard is what says a check is out of date.
    assert.deepEqual(staleChecks(later, [k], [], 5), [])
    assert.deepEqual(staleChecks(later, [record(draft.assertions)], [], 5), [], "a check without a reading is not staled by a mere mention")
  })
})

describe("exp2 recordings: gpt-5.6-luna-fast medium attribution R1–R8 (BLOCK9 §2.7), replayed by answer order", () => {
  const LUNA = join(HAIKU, "..", "luna56-medium-attr")
  const recorded = readFileSync(join(LUNA, "rounds.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l) as { round: number; status: string; calls: number })

  it("every round passes, with no more calls than when recorded; R8 no longer goes back and forth", async () => {
    const replay = replayByRound(loadCassette(join(LUNA, "cassette.json")))
    const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-l56-")), "l56")
    const calls: number[] = [], codes: string[][][] = []
    for (let round = 1; round <= 8; round++) {
      assert.equal((await store.ingestRound(round, roundText(round), replay.attribution, { maxRepairs: 2 })).status, "accepted", `R${round}`)
      const mine = store.inspect().calls.filter(c => c.round === round)
      calls.push(mine.length)
      codes.push(mine.map(c => c.issues.map(i => i.code)))
    }
    assert.deepEqual(recorded.map(r => r.status), ["accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "failed"])
    for (const [i, n] of calls.entries()) assert.ok(n <= recorded[i].calls, `R${i + 1}: ${n} calls, recorded ${recorded[i].calls}`)
    assert.deepEqual(calls, [1, 2, 3, 2, 2, 1, 2, 1])
    // One root, one issue: the guessed ids of new objects are a single issue in each round where they occur.
    for (const round of codes) for (const answer of round) assert.ok(answer.filter(c => c === "unknown_object").length <= 1)
    // No round sees an issue code come back after it was gone.
    for (const round of codes) round.forEach((answer, k) => { for (const c of answer) assert.ok(!(k >= 2 && !round[k - 1].includes(c) && round.slice(0, k - 1).some(a => a.includes(c))), `${c} came back`) })
  })

  it("the R8 first answer: the section given to the new object keeps its own parts, the subsections their owners", async () => {
    const replay = replayByRound(loadCassette(join(LUNA, "cassette.json")))
    const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-l56-")), "l56")
    for (let round = 1; round <= 8; round++) await store.ingestRound(round, roundText(round), replay.attribution, { maxRepairs: 2 })
    const r = store.registry(), quality = r.objectByName("quality command")!
    assert.deepEqual(quality.blocks.map(b => b.block), ["R8.S1.H", "R8.S1.P1", "R8.S1.P2"])
    assert.equal(r.coverOf("R8.S2")!.owner, "O9")
  })
})
