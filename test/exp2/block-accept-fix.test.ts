import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { acceptRound, trialMessage, type AcceptDeps, type AcceptLimits } from "../../src/exp2/accept.js"
import { replayReview } from "../../src/exp2/acceptance.js"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { RoleUnavailable, type ModelReply } from "../../src/exp2/attribution.js"
import { goBuilder } from "../../src/exp2/build.js"
import { codeFacts, type CheckRecord } from "../../src/exp2/checks.js"
import { DEFAULT_LIMITS } from "../../src/exp2/execution.js"
import { assessPremises, canonicalUnit, FORMALIZE_SCHEMA, FORMALIZE_SYSTEM_PROMPT, formalizeProblems, UNIT_ID_PATTERN, type FormalItem, type FormalizeTransport } from "../../src/exp2/formalize.js"
import { initRepo } from "../../src/exp2/git.js"
import { ledgerOf } from "../../src/exp2/ledger.js"
import { programRunsIn, REPAIR_INTRO, replyAsList, REVIEW_INTRO, REVIEW_REPLY, reviewBaseText, reviewEntries, type ProgramRun } from "../../src/exp2/review.js"
import { LocalProcessRunner, LocalScriptSandbox } from "../../src/exp2/runner.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { buildWorkOrder, renderWorkOrder } from "../../src/exp2/workorder.js"
import { checkStubTransport } from "./check-stubs.js"
import { DROP, FILTER, GO_MOD, MAIN, RENAME, SORT, TRANSFORM, VERIFY } from "./go-fixtures.js"
import { roundText } from "./inputs.js"
import { FILTER_ITEM_TEXT, filterItem, scriptedReviewer, stubFormalizer, workingReviewer } from "./review-stubs.js"
import { StubExecutor, write } from "./stub-executor.js"
import { stubTransport } from "./stubs.js"

/**
 * The fix block (fail open, interfaces calibrated on real replies): the interfaces between model output and code are
 * tested on the replies the real reviewer and formalizer gave in the local R1 runs of 2026-10-23
 * (exp2/evidence/real-replies-2026-10-23); the stand-ins stay for the flows the real replies do not cover.
 */

const FIX = resolve(process.cwd(), "exp2/evidence/real-replies-2026-10-23")
const jsonl = <T>(f: string): T[] => readFileSync(join(FIX, f), "utf8").trim().split("\n").map(l => JSON.parse(l) as T)
interface RealReview { id: string; run: string; response_text: string; program_runs: number; valid: boolean }
interface RealFormalize { id: string; run: string; attempt: number; response_text: string; problems: string[] }
const REVIEWS = jsonl<RealReview>("review_calls.jsonl")
const FORMALIZE = jsonl<RealFormalize>("formalize_calls.jsonl")
const sessionMessages = (name: string): unknown => JSON.parse(readFileSync(join(FIX, "session_messages", name), "utf8"))
/** rep1b: 8 deviations, every formalizer item without an input; rep1c: two reviews voided as "never ran". */
const REP1B = REVIEWS.find(r => r.run.includes("rep1b"))!
const REP1C = REVIEWS.filter(r => r.run.includes("rep1c"))

const FILTER_UNIT = "R1.S3.P2.s4"
const ALL = ["filter", "sort", "rename", "drop"]
const SORT_NUM = SORT.replace('import "sort"', 'import (\n\t"sort"\n\t"strconv"\n)').replace("return t.rows[a][i] < t.rows[b][i]", "x, _ := strconv.ParseFloat(t.rows[a][i], 64)\n\t\ty, _ := strconv.ParseFloat(t.rows[b][i], 64)\n\t\treturn x < y")
const files = (o: { filterWrong?: boolean } = {}) => ({ "go.mod": GO_MOD, "main.go": MAIN, "verify.go": VERIFY(), "transform.go": TRANSFORM(ALL, true), "filter.go": FILTER(o.filterWrong ?? false), "sort.go": SORT_NUM, "rename.go": RENAME, "drop.go": DROP })
const noop = { review: async () => {}, formalize: async () => {}, guards: async () => {} }

/** The real formalizer's replies, in the order they were given (the last repeats). */
function replayedFormalizer(texts: string[]): FormalizeTransport & { calls: { n: number } } {
  const calls = { n: 0 }
  const f = async (): Promise<ModelReply> => ({ text: texts[Math.min(calls.n++, texts.length - 1)], stub: true, usage: { input_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 100, reasoning_tokens: 0 }, model: "replay:formalizer" })
  return Object.assign(f, { calls })
}

/** A formalizer stand-in shaped as the real one answered rep1b: every entry of the review, its units, no input. */
function noInputFormalizer(unit: string): FormalizeTransport {
  return async request => {
    const items = reviewEntries(request.review).map((text, k) => ({ item: k + 1, text, units: [unit], input: null, why_no_input: "the file contents are not given", claims: [], assertions: [], reference_script: null }))
    return { text: JSON.stringify({ items }), stub: true, usage: { input_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 100, reasoning_tokens: 0 }, model: "stub:formalizer" }
  }
}

async function round(dir: string, store: Exp2Store, messages: ((wd: string) => void)[], o: { reviewer: AcceptDeps["reviewer"]; formalize: AcceptDeps["formalize"]; limits?: Partial<AcceptLimits>; trial?: AcceptDeps["trial"]; record?: AcceptDeps["record"] }) {
  const workdir = join(dir, `work-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(workdir, { recursive: true })
  initRepo(workdir)
  const registry = store.registry(), anchors = new GoAnchorExtractor()
  const w = buildWorkOrder({ registry, round: 1, library: [], events: [], statuses: [], runs: [], anchors: anchors.extract(workdir), links: [], steps: [], previous_task: [] })
  const executor = new StubExecutor({ messages })
  const record = await acceptRound(workdir, w, renderWorkOrder(w), executor, {
    registry, library: [] as CheckRecord[], events: [], facts: codeFacts(registry, 1), guards: [], guardEvents: [],
    runner: new LocalProcessRunner(), sandbox: new LocalScriptSandbox(), anchors, build: goBuilder(join(dir, "builds"), {}, "dpipe"), ...(o.trial ? { trial: o.trial } : {}),
    reviewer: o.reviewer, formalize: o.formalize, binary: "dpipe", sources: store.inspect().sources.map(s => ({ round: s.round, text: s.text })),
    copyDir: label => join(dir, "copies", `${label}-${Math.random().toString(36).slice(2, 6)}`), record: o.record ?? noop, checkTimeoutMs: 10_000,
  }, { ...DEFAULT_LIMITS, repairCycles: 3, ...o.limits })
  return { record, executor, registry }
}

describe("fix block A5: the review request's requirements and the trial message are the control group's, word for word", () => {
  it("each round under '# Round N requirements' and a blank line, rounds apart by a blank line", () => {
    assert.equal(reviewBaseText([{ round: 2, text: "R2 text\n" }, { round: 1, text: "R1 text" }]), `${REVIEW_INTRO}\n${REVIEW_REPLY}\n\n# Round 1 requirements\n\nR1 text\n\n# Round 2 requirements\n\nR2 text\n`)
  })
  it("the trial message, with the trial's output", () => {
    const build = { ok: true, output: "", program: null }
    assert.equal(trialMessage(build, { ok: false, output: "--- FAIL: TestX (0.00s)\nFAIL\n" }, "dpipe"),
      "The program was built and its tests run in the target environment with `go build -o dpipe ./... && go test ./...` in /app (a Linux container without network). It failed:\n```\n--- FAIL: TestX (0.00s)\nFAIL\n```\nFix the code so that this passes there.")
  })
  it("in a round: a failing trial sends that message, and a host build that fails is tried in the target environment too", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-fix-trial-"))
    const store = new Exp2Store(join(dir, "store"), "fixt")
    await store.ingestRound(1, roundText(1), stubTransport())
    let calls = 0
    const trial = async () => (++calls === 1 ? { ok: false, output: "# dpipe\n./main.go:1:1: expected 'package', found broken\n" } : { ok: true, output: "" })
    const { executor, record } = await round(dir, store, [wd => write(wd, { ...files(), "main.go": "broken" }), wd => write(wd, files())], { reviewer: scriptedReviewer([{ text: "NO ISSUES" }]), formalize: stubFormalizer({ filter: FILTER_UNIT, sort: FILTER_UNIT }), trial })
    assert.equal(calls, 2, "the trial ran on the tree whose host build failed")
    assert.equal(executor.log.messages[1].text, "The program was built and its tests run in the target environment with `go build -o dpipe ./... && go test ./...` in /app (a Linux container without network). It failed:\n```\n# dpipe\n./main.go:1:1: expected 'package', found broken\n```\nFix the code so that this passes there.")
    assert.deepEqual(record.accept!.trial, { runs: 2, failures: 1 })
  })
})

describe("fix block A4, A6: the interfaces on the real replies", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-fix-real-"))
  const store = new Exp2Store(join(dir, "store"), "fixr")
  before(async () => { await store.ingestRound(1, roundText(1), stubTransport()) })

  it("canonicalUnit: every unit id the real formalizer wrote names a unit of R1 (the ids are cut from the text, as in the real run)", () => {
    const ids = new Set<string>()
    for (const f of FORMALIZE) for (const it of (JSON.parse(f.response_text) as { items: { units: string[]; assertions: { source: { block: string | null } }[] }[] }).items) { it.units.forEach(u => ids.add(u)); it.assertions.forEach(a => a.source.block && ids.add(a.source.block)) }
    assert.equal(ids.size, 28)
    const reg = store.registry(), pattern = new RegExp(UNIT_ID_PATTERN, "u")
    for (const u of ids) { const c = canonicalUnit(u); assert.ok(pattern.test(c), `${u} → ${c}`); assert.ok(reg.block(c), `${u} → ${c} is in the registry`) }
  })

  it("the schema and the prompt state the id syntax; a bad id is called a format problem, a well-formed unknown one missing", () => {
    const item = (FORMALIZE_SCHEMA.properties.items as { items: { properties: Record<string, any> } }).items.properties
    assert.equal(item.units.items.pattern, UNIT_ID_PATTERN)
    assert.equal(item.assertions.items.properties.source.properties.block.pattern, UNIT_ID_PATTERN)
    assert.match(FORMALIZE_SYSTEM_PROMPT, /R1\.S3\.P12\.s10\.c1/u)
    assert.match(FORMALIZE_SYSTEM_PROMPT, /not part of the id/u)
    const one = (units: string[]) => formalizeProblems(store.registry(), 1, { items: [{ item: 1, text: "x", units, input: null, why_no_input: "none", claims: [], assertions: [], reference_script: null }] }).problems.map(p => p.message)
    assert.match(one(["R1.S3.P12:x9"])[0], /is not in the unit id format; write unit ids as R<round>/u)
    assert.match(one(["R1.S99.P1"])[0], /R1\.S99\.P1 does not exist in the requirements so far/u)
    assert.deepEqual(one(["R1.S99.P1", "R1.S3.P12#f683eb75:s10.c1"]), [], "an unknown id beside a known one is dropped, not a problem")
  })

  it("formalizeProblems: the real replies (rep1b, both attempts) have no problem left; their 8 items have no input", () => {
    for (const f of FORMALIZE) {
      const r = formalizeProblems(store.registry(), 1, JSON.parse(f.response_text))
      assert.deepEqual(r.problems, [], `${f.id} attempt ${f.attempt}`)
      assert.equal(r.items.length, 8)
      assert.ok(r.items.every(i => i.input === null && i.why_no_input && i.units.every(u => store.registry().block(u))))
    }
    // The slips the real reply made, read the one way they can mean: an unquoted string, a verbatim value whose unit is unknown.
    const raw = JSON.parse(FORMALIZE[0].response_text) as { items: { assertions: { expect_json: string }[] }[] }
    assert.equal(raw.items[0].assertions[1].expect_json, "ERROR: invalid recipe: join key id not found in right dataset")
    const withInput = { items: [{ item: 1, text: "x", units: ["R1.S8.P1.s1"], input: { args: ["verify"], files: [] }, why_no_input: null, claims: [], reference_script: null, assertions: [{ id: "a", target: { kind: "stderr", path: null, line: null, pointer: null, column: null }, expect_json: "ERROR: file not found: x", tolerance: null, source: { kind: "verbatim", block: null } }] }] }
    const r = formalizeProblems(store.registry(), 1, withInput)
    assert.deepEqual(r.problems, [])
    assert.deepEqual([r.items[0].assertions[0].expect_json, r.items[0].assertions[0].source.block], [JSON.stringify("ERROR: file not found: x"), null])
  })

  it("programRunsIn: the real sessions' tool parts show the reviewer's runs (./dpipe, & .\\dpipe-review.exe, .\\dpipe.exe under PowerShell)", () => {
    const counts = readdirSync(join(FIX, "session_messages")).sort().map(f => [f.replace(/^exp2-icacc-r1-luna56-low-/u, ""), programRunsIn(sessionMessages(f), "dpipe").length] as const)
    assert.deepEqual(counts.map(c => c[0]), ["rep1b-20261023-V1.1.1.json", "rep1c-20261023-V1.1.1.json", "rep1c-20261023-V1.1.2.json"])
    for (const [f, n] of counts) assert.ok(n >= 1, `${f}: ${n}`)
    assert.ok(programRunsIn(sessionMessages("exp2-icacc-r1-luna56-low-rep1c-20261023-V1.1.1.json"), "dpipe").every(r => /dpipe-review\.exe/u.test(r.command)))
  })

  it("no_input: every real item reaches the premises with no_input, none of them stopped by the blocking tier", async () => {
    const r = formalizeProblems(store.registry(), 1, JSON.parse(FORMALIZE[1].response_text))
    for (const it of r.items) {
      const a = await assessPremises(store.registry(), 1, it, new LocalScriptSandbox(), 10_000)
      assert.ok(a.failures.some(f => f.premise === "no_input") && !a.check, `${it.item}: ${JSON.stringify(a.failures)}`)
      assert.ok(!a.failures.some(f => f.premise === "unit_not_in_force"), `${it.item}: ${JSON.stringify(a.failures)}`)
    }
  })

  it("the reply's entries in the reviewer's words: 8 in rep1b, the preamble left out in rep1c", () => {
    assert.equal(reviewEntries(REP1B.response_text).length, 8)
    assert.ok(reviewEntries(REP1B.response_text)[0].startsWith("- **Join key validation fails"))
    assert.ok(!reviewEntries(REP1C[0].response_text).some(e => e.startsWith("Build succeeded")))
    assert.equal(replyAsList("1. a\nSUPERSEDED G2: gone\n2. b"), "1. a\n2. b")
  })
})

describe("fix block A1: what code cannot verify for its own reasons goes out in the reviewer's words", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-fix-fallback-"))
  const store = new Exp2Store(join(dir, "store"), "fixf")
  before(async () => { await store.ingestRound(1, roundText(1), stubTransport()) })
  const runs = programRunsIn(sessionMessages("exp2-icacc-r1-luna56-low-rep1b-20261023-V1.1.1.json"), "dpipe")

  it("rep1b replayed (its real review and both real formalizer replies): the 8 items have no input; the whole reply goes to the executor as the control group sends it", async () => {
    const formalize = replayedFormalizer(FORMALIZE.map(f => f.response_text))
    const reviewer = scriptedReviewer([{ text: REP1B.response_text, runs }, { text: "NO ISSUES", runs }])
    const { record, executor } = await round(dir, store, [wd => write(wd, files({ filterWrong: true })), wd => write(wd, files())], { reviewer, formalize })
    assert.equal(formalize.calls.n, 1, "no problem left in the first reply: no second formalizer call")
    assert.equal(executor.log.messages[1].text, `${REPAIR_INTRO}\n\n${REP1B.response_text.trim()}`)
    const r1 = record.accept!.reviews[0]
    assert.deepEqual([r1.reported, r1.sent, r1.blocked, r1.fallback, r1.fallback_whole, r1.fallback_reasons], [8, 1, 0, 8, true, { no_input: 8 }])
    assert.deepEqual(record.accept!.fallback, { reviews: 1, whole: 1, items: 8, reasons: { no_input: 8 } })
    assert.deepEqual(record.accept!.premise_blocked, {})
    const recs = record.review_items!.filter(x => x.review === "R1.1")
    assert.deepEqual(recs.filter(x => x.item > 0).map(x => [x.disposition, x.logged?.at(-1)?.premise]), Array(8).fill(["fallback", "no_input"]))
    // The ledger lists the reply as sent and unverified: no check can tell whether it was fixed.
    const ledger = ledgerOf({ ...store.inspect(), executions: [record] }, store.registry())
    const e = ledger.find(x => x.id === "V1.1.0")!
    assert.deepEqual([e.source, e.reason, e.sent, e.end?.how, e.disposition], ["review", "unverified", ["C1.1"], "unverified", "fallback"])
  })

  it("a reply the formalizer answered with the real malformed reply (the ids before canonicalUnit) still goes out", async () => {
    // F1 as the real formalizer wrote it, with its ids made unreadable (the 29158c1 failure): every item malformed.
    const broken = FORMALIZE[0].response_text.replace(/R1\.S(\d+)\.P(\d+)#[0-9a-f]+/gu, "unit-$1-$2")
    const { record, executor } = await round(dir, store, [wd => write(wd, files({ filterWrong: true })), wd => write(wd, files())], { reviewer: scriptedReviewer([{ text: REP1B.response_text, runs }, { text: "NO ISSUES", runs }]), formalize: replayedFormalizer([broken]) })
    assert.equal(executor.log.messages[1].text, `${REPAIR_INTRO}\n\n${REP1B.response_text.trim()}`)
    assert.deepEqual(record.accept!.fallback?.reasons, { malformed: 8 })
    assert.equal(record.accept!.reviews[0].malformed, 8, "malformed counts items, not problems")
  })

  it("the formalizer call fails: the whole reply goes out (fallback items); with the fallback off the round stops as before", async () => {
    const down: FormalizeTransport = async () => { throw new Error("connection reset") }
    const { record, executor } = await round(dir, store, [wd => write(wd, files({ filterWrong: true })), wd => write(wd, files())], { reviewer: scriptedReviewer([{ text: REP1B.response_text, runs }, { text: "NO ISSUES", runs }]), formalize: down })
    assert.equal(executor.log.messages[1].text, `${REPAIR_INTRO}\n\n${REP1B.response_text.trim()}`)
    assert.deepEqual(record.accept!.fallback?.reasons, { formalize_failed: 8 })
    await assert.rejects(round(dir, store, [wd => write(wd, files({ filterWrong: true }))], { reviewer: scriptedReviewer([{ text: REP1B.response_text, runs }]), formalize: down, limits: { fallback: "off" } }), RoleUnavailable)
  })

  it("the 4th local R1 (1 item verified, the rest no input): the verified item and the unverifiable ones all go out, each in the reviewer's words", async () => {
    const OTHER = "**`pivot` is unsupported.** Requirement: execute pivot transformations. Command: `dpipe transform --input data.csv --recipe recipe-pivot.json --output pivot-out.csv --seed 1`. Program exited 1 with `ERROR: invalid recipe: pivot not implemented`."
    const reviewer = scriptedReviewer([{ text: `1. ${FILTER_ITEM_TEXT}\n\n2. ${OTHER}` }, { text: "NO ISSUES" }])
    const formalize = stubFormalizer({ filter: FILTER_UNIT, sort: FILTER_UNIT })
    const { record, executor } = await round(dir, store, [wd => write(wd, files({ filterWrong: true })), wd => write(wd, files())], { reviewer, formalize })
    assert.equal(executor.log.messages[1].text, `${REPAIR_INTRO}\n\n1. ${FILTER_ITEM_TEXT}\n\n2. ${OTHER}`)
    const r1 = record.accept!.reviews[0]
    assert.deepEqual([r1.sent, r1.fallback, r1.fallback_whole], [2, 1, false])
    // Fallback off: the unverifiable item is blocked as before; the verified one alone goes out.
    const off = await round(dir, store, [wd => write(wd, files({ filterWrong: true })), wd => write(wd, files())], { reviewer: scriptedReviewer([{ text: `1. ${FILTER_ITEM_TEXT}\n\n2. ${OTHER}` }, { text: "NO ISSUES" }]), formalize: stubFormalizer({ filter: FILTER_UNIT, sort: FILTER_UNIT }), limits: { fallback: "off" } })
    assert.equal(off.executor.log.messages[1].text, `${REPAIR_INTRO}\n\n1. ${FILTER_ITEM_TEXT}`)
    assert.deepEqual(off.record.accept!.premise_blocked, { no_input: 1 })
    // "review" (A1 as first written): something was verified and sent, so no fallback either.
    const rv = await round(dir, store, [wd => write(wd, files({ filterWrong: true })), wd => write(wd, files())], { reviewer: scriptedReviewer([{ text: `1. ${FILTER_ITEM_TEXT}\n\n2. ${OTHER}` }, { text: "NO ISSUES" }]), formalize: stubFormalizer({ filter: FILTER_UNIT, sort: FILTER_UNIT }), limits: { fallback: "review" } })
    assert.deepEqual(rv.record.accept!.premise_blocked, { no_input: 1 })
  })

  it("every item not reproduced: a true check of the item, no fallback, nothing sent", async () => {
    const reviewer = scriptedReviewer([{ text: `1. ${FILTER_ITEM_TEXT}` }])
    const { record, executor } = await round(dir, store, [wd => write(wd, files())], { reviewer, formalize: stubFormalizer({ filter: FILTER_UNIT, sort: FILTER_UNIT }) })
    assert.equal(executor.log.messages.length, 1)
    assert.deepEqual(record.accept!.premise_blocked, { not_reproduced: 1 })
    assert.deepEqual(record.accept!.fallback, { reviews: 0, whole: 0, items: 0, reasons: {} })
  })
})

describe("fix block A2: a review whose session shows no run of the program is valid; the count is reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-fix-runs-"))
  const store = new Exp2Store(join(dir, "store"), "fixn")
  before(async () => { await store.ingestRound(1, roundText(1), stubTransport()) })

  it("rep1c's two reviews (real texts), with runs not recognised: both valid, their findings sent; program_runs 0 counted", async () => {
    const reviewer = scriptedReviewer([{ text: REP1C[0].response_text, runs: [] }, { text: REP1C[1].response_text, runs: [] }, { text: "NO ISSUES", runs: [] }])
    const calls: { valid: boolean; program_runs: number }[] = []
    const { record, executor } = await round(dir, store, [wd => write(wd, files({ filterWrong: true })), wd => write(wd, files()), wd => write(wd, files())], { reviewer, formalize: noInputFormalizer(FILTER_UNIT), record: { ...noop, review: async r => { calls.push({ valid: r.valid, program_runs: r.program_runs }) } } })
    assert.deepEqual(calls.slice(0, 2), [{ valid: true, program_runs: 0 }, { valid: true, program_runs: 0 }])
    assert.equal(record.accept!.voided, 0)
    assert.ok(record.accept!.program_runs_zero! >= 2)
    assert.equal(executor.log.messages[1].text, `${REPAIR_INTRO}\n\n${replyAsList(REP1C[0].response_text)}`)
    assert.equal(executor.log.messages[2].text, `${REPAIR_INTRO}\n\n${replyAsList(REP1C[1].response_text)}`)
    assert.ok(record.accept!.reviews.slice(0, 2).every(r => r.valid && r.program_runs === 0 && r.sent === 1 && r.fallback_whole))
  })

  it("the real tool parts of rep1c give the runs; voiding is still there behind acceptance.void_without_runs", async () => {
    const real: ProgramRun[] = programRunsIn(sessionMessages("exp2-icacc-r1-luna56-low-rep1c-20261023-V1.1.1.json"), "dpipe")
    assert.equal(real.length, 16)
    const { record } = await round(dir, store, [wd => write(wd, files())], { reviewer: scriptedReviewer([{ text: "NO ISSUES", runs: [] }, { text: "NO ISSUES", runs: real }]), formalize: noInputFormalizer(FILTER_UNIT), limits: { voidWithoutRuns: true } })
    assert.deepEqual([record.accept!.voided, record.accept!.reviews[0].attempts, record.accept!.program_runs_zero], [1, 2, 0])
  })
})

describe("fix block A3: two tiers of premises", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-fix-tiers-"))
  const store = new Exp2Store(join(dir, "store"), "fixp")
  before(async () => { await store.ingestRound(1, roundText(1), stubTransport()) })
  const spoken = (): FormalItem => ({ ...filterItem(1, FILTER_ITEM_TEXT, FILTER_UNIT), assertions: [...filterItem(1, FILTER_ITEM_TEXT, FILTER_UNIT).assertions, { id: "n", role: "business", target: { kind: "file_line", path: "out.csv", line: 2, pointer: null, column: null }, expect_json: "\"2,20\"", tolerance: null, source: { kind: "verbatim", block: FILTER_UNIT } }] })

  it("assessPremises reports every premise that fails, and still builds the check from what resolved", async () => {
    const a = await assessPremises(store.registry(), 1, spoken(), new LocalScriptSandbox(), 10_000)
    assert.deepEqual(a.failures.map(f => f.premise), ["value_not_stated"])
    assert.ok(a.check && a.check.assertions.length === 5)
  })

  it("a stated value the text does not state: logged, the item sent and its check kept; in the blocking tier it stops the item", async () => {
    const formalize = stubFormalizer({ filter: FILTER_UNIT, sort: FILTER_UNIT }, () => null)
    const withSpoken: FormalizeTransport = async req => { const r = await formalize(req); const a = JSON.parse(r.text) as { items: FormalItem[] }; a.items = a.items.map(() => spoken()); return { ...r, text: JSON.stringify(a) } }
    const reviewer = () => scriptedReviewer([{ text: `1. ${FILTER_ITEM_TEXT}` }, { text: "NO ISSUES" }])
    const { record, executor } = await round(dir, store, [wd => write(wd, files({ filterWrong: true })), wd => write(wd, files())], { reviewer: reviewer(), formalize: withSpoken })
    assert.equal(executor.log.messages.length, 2)
    const rec = record.review_items!.find(x => x.id === "V1.1.1")!
    assert.deepEqual([rec.disposition, rec.logged?.map(l => l.premise), rec.premise, !!rec.check, rec.guard], ["logged", ["value_not_stated"], null, true, "G1"])
    assert.deepEqual(record.accept!.premise_logged, { value_not_stated: 1 })
    const ledger = ledgerOf({ ...store.inspect(), executions: [record] }, store.registry())
    assert.deepEqual(ledger.find(x => x.id === "V1.1.1")!.logged?.map(l => l.premise), ["value_not_stated"])
    const strict = await round(dir, store, [wd => write(wd, files({ filterWrong: true }))], { reviewer: reviewer(), formalize: withSpoken, limits: { premiseBlock: ["unit_not_in_force", "not_reproduced", "input_claim_false", "value_not_stated"] } })
    assert.equal(strict.executor.log.messages.length, 1)
    assert.deepEqual(strict.record.accept!.premise_blocked, { value_not_stated: 1 })
  })

  it("the replay shows both: strict (every premise blocks) and the tiers, item by item", async () => {
    const root = mkdtempSync(join(tmpdir(), "exp2-fix-replay-"))
    const product = (name: string, o: { filterWrong?: boolean }) => { const p = join(root, "src", name); mkdirSync(p, { recursive: true }); write(p, files(o)); return { name, round: 1, path: p } }
    const OTHER = "- pivot is unsupported: `dpipe transform --input data.csv --recipe recipe-pivot.json --output pivot-out.csv --seed 1` exited 1."
    const result = await replayReview({
      store: new Exp2Store(join(root, "store"), "fixrep"), text: roundText, attribution: stubTransport(), checks: checkStubTransport(), sandbox: new LocalScriptSandbox(), runner: new LocalProcessRunner(), build: goBuilder(join(root, "builds"), {}, "dpipe"), timeoutMs: 10_000, root,
      reviewer: workingReviewer(join(root, "rb"), { also: () => [OTHER] }), formalize: stubFormalizer({ filter: FILTER_UNIT, sort: FILTER_UNIT }), binary: "dpipe",
    }, [product("filter_wrong", { filterWrong: true }), product("clean", {})])
    const [wrong, clean] = result
    assert.deepEqual(wrong.items.filter(i => i.item === 1).map(i => [i.strict, i.premise, i.disposition]), [[null, null, "sent"]])
    assert.ok(wrong.items.some(i => i.disposition === "fallback" && i.premise === null && (i.strict === "no_input" || i.strict === "not_formalized")), JSON.stringify(wrong.items.map(i => [i.item, i.strict, i.disposition])))
    assert.ok(clean.items.length > 0 && clean.items.every(i => i.disposition === "fallback"), JSON.stringify(clean.items.map(i => [i.item, i.strict, i.disposition])))
  })
})
