import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { acceptRound, renderReviewList, type AcceptDeps } from "../../src/exp2/accept.js"
import { replayReview } from "../../src/exp2/acceptance.js"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { goBuilder, goTrial } from "../../src/exp2/build.js"
import { codeFacts, type CheckRecord } from "../../src/exp2/checks.js"
import { DEFAULT_LIMITS } from "../../src/exp2/execution.js"
import { assessPremises, itemCheckRecord, reproduces, type FormalItem } from "../../src/exp2/formalize.js"
import { git, head, initRepo } from "../../src/exp2/git.js"
import { changedTextBehind, guardCoverage, type GuardEvent, type GuardRecord } from "../../src/exp2/guards.js"
import { ledgerOf } from "../../src/exp2/ledger.js"
import { renderFlips, renderReport } from "../../src/exp2/report.js"
import { invokesProgram, isNoIssues, programRunsIn, REPAIR_INTRO, REVIEW_INTRO, REVIEW_REPLY, reviewBaseText, reviewRanProgram, supersededIn } from "../../src/exp2/review.js"
import { LocalProcessRunner, LocalScriptSandbox } from "../../src/exp2/runner.js"
import { Serial } from "../../src/exp2/serial.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { buildWorkOrder, renderWorkOrder } from "../../src/exp2/workorder.js"
import { checkStubTransport } from "./check-stubs.js"
import { DROP, FILTER, GO_MOD, MAIN, RENAME, SORT, TRANSFORM, VERIFY } from "./go-fixtures.js"
import { roundText } from "./inputs.js"
import { stubProbeWriter } from "./probe-stubs.js"
import { FILTER_INPUT, FILTER_ITEM_TEXT, filterItem, scriptedReviewer, SORT_INPUT, stubFormalizer, workingReviewer } from "./review-stubs.js"
import { serialExecutor } from "./serial-executor.js"
import { StubExecutor, write } from "./stub-executor.js"
import type { AttributionTransport } from "../../src/exp2/attribution.js"
import { stubTransport } from "./stubs.js"

/**
 * The acceptance block (DESIGN §12i): the reviewer finds, code checks the premises, guards hold what was fixed, a
 * repair that breaks a guard is reverted, flips route by whether the text behind them changed, probes are written once
 * per unit, a review that never ran the program is void, and the report carries the round's measures. Every model
 * is a stand-in; the reviewer stand-in builds and runs the program copy it is given.
 */

const FILTER_UNIT = "R1.S3.P2.s4", SORT_UNIT = "R1.S3.P9.s2", SIDECAR_UNIT = "R1.S3.P24.s1"
const SORT_NUM = SORT.replace('import "sort"', 'import (\n\t"sort"\n\t"strconv"\n)').replace("return t.rows[a][i] < t.rows[b][i]", "x, _ := strconv.ParseFloat(t.rows[a][i], 64)\n\t\ty, _ := strconv.ParseFloat(t.rows[b][i], 64)\n\t\treturn x < y")
const ALL = ["filter", "sort", "rename", "drop"]
const files = (o: { filterWrong?: boolean; sortText?: boolean; reverseInTransform?: boolean; sidecar?: boolean } = {}) => {
  let transform = TRANSFORM(ALL, o.sidecar ?? true)
  if (o.reverseInTransform) transform = transform.replace("\t\tif t, err = f(t, op); err != nil {\n\t\t\treturn fail(err.Error())\n\t\t}", "\t\tif t, err = f(t, op); err != nil {\n\t\t\treturn fail(err.Error())\n\t\t}\n\t\tif name == \"sort\" {\n\t\t\tfor i, j := 0, len(t.rows)-1; i < j; i, j = i+1, j-1 {\n\t\t\t\tt.rows[i], t.rows[j] = t.rows[j], t.rows[i]\n\t\t\t}\n\t\t}")
  return { "go.mod": GO_MOD, "main.go": MAIN, "verify.go": VERIFY(), "transform.go": transform, "filter.go": FILTER(o.filterWrong ?? false), "sort.go": o.sortText ? SORT : SORT_NUM, "rename.go": RENAME, "drop.go": DROP }
}

const target = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, path: null, line: null, pointer: null, column: null, ...extra }) as CheckRecord["assertions"][number]["target"]
const resolved = (id: string, t: CheckRecord["assertions"][number]["target"], expect: unknown, kind: "verbatim" | "derived" = "derived", block: string | null = null): CheckRecord["assertions"][number] => ({ id, role: "business", target: t, expect, tolerance: null, source: { kind, block } })
/** A library check for the sort (its values worked out already, as an admitted check holds them). */
const sortCheck = (id: string, object: string): CheckRecord => ({
  id, round: 1, key: "sort-asc", object, blocks: [SORT_UNIT], uses: [], input: SORT_INPUT,
  // Stated values: a failure is the program's.
  assertions: [resolved("l2", target("file_line", { path: "out.csv", line: 2 }), "3,3", "verbatim", SORT_UNIT), resolved("l5", target("file_line", { path: "out.csv", line: 5 }), "2,20", "verbatim", SORT_UNIT), resolved("exit", target("exit_code"), 0, "verbatim", SORT_UNIT)],
  unknown: [], reference_script: null, admission: "admitted", admission_reason: null, strength: null, status: "active", calls: [],
})
/** A library check for the R1 sidecar: transform writes <output>.sha256. */
const sidecarCheck = (id: string, object: string): CheckRecord => ({
  id, round: 1, key: "transform-sidecar", object, blocks: [SIDECAR_UNIT], uses: [], input: FILTER_INPUT,
  assertions: [resolved("side", target("file_exists", { path: "out.csv.sha256" }), true, "verbatim", SIDECAR_UNIT), resolved("exit", target("exit_code"), 0)],
  unknown: [], reference_script: null, admission: "admitted", admission_reason: null, strength: null, status: "active", calls: [],
})

const noop = { review: async () => {}, formalize: async () => {}, guards: async () => {} }

/** Runs one round with the review acceptance on a fresh work tree; the stand-ins and guards as given. */
async function round(dir: string, store: Exp2Store, r: number, messages: ((wd: string) => void)[], o: { library?: CheckRecord[]; guards?: GuardRecord[]; guardEvents?: GuardEvent[]; reviewer: AcceptDeps["reviewer"]; formalize: AcceptDeps["formalize"]; leads?: AcceptDeps["leads"]; reviews?: number; record?: AcceptDeps["record"]; carried?: AcceptDeps["carried"]; voidWithoutRuns?: boolean }) {
  const workdir = join(dir, `work-${r}-${Math.random().toString(36).slice(2, 6)}`)
  mkdirSync(workdir, { recursive: true })
  initRepo(workdir)
  const registry = store.registry(), anchors = new GoAnchorExtractor()
  const w = buildWorkOrder({ registry, round: r, library: o.library ?? [], events: [], statuses: [], runs: [], anchors: anchors.extract(workdir), links: [], steps: [], previous_task: [] })
  const executor = new StubExecutor({ messages: messages.map(m => (wd: string) => { m(wd) }) })
  const record = await acceptRound(workdir, w, renderWorkOrder(w), executor, {
    registry, library: o.library ?? [], events: [], facts: codeFacts(registry, r), guards: o.guards ?? [], guardEvents: o.guardEvents ?? [],
    runner: new LocalProcessRunner(), sandbox: new LocalScriptSandbox(), anchors, build: goBuilder(join(dir, "builds"), {}, "dpipe"),
    reviewer: o.reviewer, formalize: o.formalize, binary: "dpipe", sources: store.inspect().sources.map(s => ({ round: s.round, text: s.text })),
    copyDir: label => join(dir, "copies", label), ...(o.leads ? { leads: o.leads } : {}), record: o.record ?? noop, ...(o.carried ? { carried: o.carried } : {}), checkTimeoutMs: 10_000,
  }, { ...DEFAULT_LIMITS, repairCycles: 3, ...(o.reviews !== undefined ? { reviews: o.reviews } : {}), ...(o.voidWithoutRuns ? { voidWithoutRuns: true } : {}) })
  return { record, executor, workdir, registry }
}

describe("exp2 acceptance block: the review request and the repair message are the control group's, word for word", () => {
  it("base texts, headings, NO ISSUES and SUPERSEDED lines, the program's runs in a session", () => {
    const text = reviewBaseText([{ round: 2, text: "R2 text\n" }, { round: 1, text: "R1 text" }])
    assert.equal(text, `${REVIEW_INTRO}\n${REVIEW_REPLY}\n\n# Round 1 requirements\n\nR1 text\n\n# Round 2 requirements\n\nR2 text\n`)
    assert.equal(REPAIR_INTRO, "An independent review of the program against the requirements reported the following. Follow the requirements where an item seems to contradict them, and do not change behaviour the items do not concern.")
    assert.ok(isNoIssues("NO ISSUES") && isNoIssues(" **NO ISSUES**\n") && !isNoIssues("NO ISSUES except one") && !isNoIssues("1. something"))
    assert.deepEqual(supersededIn("1. x\nSUPERSEDED G3: round 5 removed the sidecar\n- SUPERSEDED G7: gone"), [{ guard: "G3", reason: "round 5 removed the sidecar" }, { guard: "G7", reason: "gone" }])
    assert.ok(invokesProgram("./dpipe transform --input a.csv", "dpipe") && invokesProgram("cd /tmp && /x/y/dpipe verify", "dpipe") && invokesProgram("go run . transform", "dpipe"))
    assert.ok(!invokesProgram("go build -o dpipe ./...", "dpipe") && !invokesProgram("cat dpipe.go", "dpipe"))
    const messages = [{ info: { role: "assistant" }, parts: [
      { type: "tool", tool: "bash", state: { status: "completed", input: { command: "go build -o dpipe ./..." }, output: "", metadata: { exit: 0 } } },
      { type: "tool", tool: "bash", state: { status: "completed", input: { command: "./dpipe transform --input d.csv --recipe r.json --output o.csv" }, output: "", metadata: { exit: 1 } } },
      { type: "tool", tool: "bash", state: { status: "completed", input: { command: "./dpipe verify --file a --checksum b" }, output: "sh: ./dpipe: No such file or directory", metadata: {} } },
    ] }]
    assert.deepEqual(programRunsIn(messages, "dpipe"), [{ command: "./dpipe transform --input d.csv --recipe r.json --output o.csv", exit_code: 1 }, { command: "./dpipe verify --file a --checksum b", exit_code: 127 }])
    assert.ok(reviewRanProgram([{ command: "x", exit_code: 1 }]) && !reviewRanProgram([{ command: "x", exit_code: 127 }]) && !reviewRanProgram([]))
  })
})

describe("exp2 acceptance block §2: the premises code checks before an item is sent", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-acc-premise-"))
  const store = new Exp2Store(join(dir, "store"), "accp")
  const sandbox = new LocalScriptSandbox(), runner = new LocalProcessRunner()
  before(async () => { for (const r of [1, 2, 3, 4, 5]) await store.ingestRound(r, roundText(r), stubTransport()) })

  it("premises hold: the item is sent (its check fails on the program and is kept for the repair)", async () => {
    const it = filterItem(1, FILTER_ITEM_TEXT, FILTER_UNIT)
    const p = await assessPremises(store.registry(), 1, it, sandbox, 10_000)
    assert.ok(!p.failures.length && p.check, JSON.stringify(p))
    assert.deepEqual(p.check.assertions.map(a => [a.id, a.expect]), [["l1", "id,value"], ["l2", "2,20"], ["l3", "4,12"], ["exit", 0]])
    const src = join(dir, "wrong"); mkdirSync(src, { recursive: true }); write(src, files({ filterWrong: true }))
    const program = goBuilder(join(dir, "b"), {}, "dpipe")(src, "wrong").program!
    const rep = await reproduces(itemCheckRecord("V1", 1, it, p.check), program, runner, 1, store.registry(), codeFacts(store.registry(), 1), 10_000)
    assert.equal(rep.reproduced, true)
    const ok = join(dir, "right"); mkdirSync(ok, { recursive: true }); write(ok, files())
    const rep2 = await reproduces(itemCheckRecord("V1", 1, it, p.check), goBuilder(join(dir, "b"), {}, "dpipe")(ok, "right").program!, runner, 1, store.registry(), codeFacts(store.registry(), 1), 10_000)
    assert.equal(rep2.reproduced, false, "a right program: not reproduced, so not sent")
  })

  it("the unit it rests on was replaced (R5 withdrew the sidecar clause): blocked, unit not in force", async () => {
    const it: FormalItem = { ...filterItem(1, "transform must write <output>.sha256", "R1.S3.P24.s1.c3"), units: ["R1.S3.P24.s1.c3"] }
    const p = await assessPremises(store.registry(), 5, it, sandbox, 10_000)
    assert.deepEqual(p.failures.map(f => f.premise), ["unit_not_in_force"], JSON.stringify(p))
    assert.match(p.failures[0].detail, /R1\.S3\.P24\.s1\.c3.*withdrawn in round 5 by R5\.S1\.P2\.s4/u)
    // The same clause is still in force in round 4.
    assert.deepEqual((await assessPremises(store.registry(), 4, it, sandbox, 10_000)).failures, [])
  })

  it("a file that must not exist, cited to the unit that withdrew it (R5 names .sha256): stated; cited to a unit that names no such file: value_not_stated", async () => {
    const absent = (block: string): FormalItem => ({ ...filterItem(1, "transform still writes the sidecar", "R5.S1.P3.s5"), assertions: [{ id: "side", role: "business", target: target("file_exists", { path: "out.csv.sha256" }), expect_json: "false", tolerance: null, source: { kind: "verbatim", block } }], reference_script: null })
    assert.match(store.registry().block("R5.S1.P3.s5")!.text, /\.sha256/u)
    assert.deepEqual((await assessPremises(store.registry(), 5, absent("R5.S1.P3.s5"), sandbox, 10_000)).failures, [])
    const p = await assessPremises(store.registry(), 5, { ...absent(FILTER_UNIT), units: [FILTER_UNIT] }, sandbox, 10_000)
    assert.deepEqual(p.failures.map(f => f.premise), ["value_not_stated"])
  })

  it("a numeric expectation stated in words, not computed: fails its premise; stated by the text: passes", async () => {
    const base = filterItem(1, "the threshold must be 42", FILTER_UNIT)
    const spoken: FormalItem = { ...base, assertions: [{ id: "n", role: "business", target: target("csv_cell", { path: "out.csv", line: 1, column: "value" }), expect_json: "42", tolerance: null, source: { kind: "verbatim", block: FILTER_UNIT } }], reference_script: null }
    const p = await assessPremises(store.registry(), 1, spoken, sandbox, 10_000)
    assert.deepEqual(p.failures.map(f => f.premise), ["value_not_computed"], JSON.stringify(p))
    // R1 states exit code 1 for the error convention: a stated number the code finds in the unit.
    const stated: FormalItem = { ...base, units: ["R1.S8.P1.s1"], assertions: [{ id: "e", role: "business", target: target("exit_code"), expect_json: "1", tolerance: null, source: { kind: "verbatim", block: "R1.S8.P1.s1" } }], reference_script: null }
    assert.match(store.registry().block("R1.S8.P1.s1")!.text, /exit code 1/u)
    const q = await assessPremises(store.registry(), 1, stated, sandbox, 10_000)
    assert.ok(!q.failures.length && q.check, JSON.stringify(q))
    // A worked-out value whose script disagrees: its premise fails as well.
    const disagree: FormalItem = { ...base, reference_script: { language: "python", code: "print('{\"l1\": \"id,value\", \"l2\": \"nope\", \"l3\": \"4,12\", \"exit\": 0}')" } }
    const d = await assessPremises(store.registry(), 1, disagree, sandbox, 10_000)
    assert.deepEqual(d.failures.map(f => f.premise), ["reference_failed"])
  })
})

describe("exp2 acceptance block §1, §3, §4: the reviewer finds, the fixed item becomes a guard, a repair that breaks a guard is reverted", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-acc-round-"))
  const store = new Exp2Store(join(dir, "store"), "accr")
  before(async () => { await store.ingestRound(1, roundText(1), stubTransport()) })
  const objects = () => { const reg = store.registry(); return { sort: reg.coverOf(SORT_UNIT)!.owner, filter: reg.coverOf(FILTER_UNIT)!.owner } }

  it("the reviewer reports the filter; the premises hold; the executor fixes it; the item becomes a guard and the library check that passed is one too", async () => {
    const reviewer = workingReviewer(join(dir, "rb1"))
    const formalize = stubFormalizer({ filter: FILTER_UNIT, sort: SORT_UNIT })
    const recorded: { born: GuardRecord[]; events: GuardEvent[] } = { born: [], events: [] }
    const { record, executor } = await round(dir, store, 1, [wd => write(wd, files({ filterWrong: true })), wd => write(wd, files())], {
      library: [sortCheck("K1", objects().sort)], reviewer, formalize, record: { ...noop, guards: async (b, e) => { recorded.born.push(...b); recorded.events.push(...e) } },
    })
    assert.equal(record.status, "done")
    assert.equal(record.cycles.length, 2, "one repair")
    assert.equal(record.first_delivery?.cycle, "C1.1")
    // The library check passed on the first program: a guard at once. The reviewer's item, fixed, is a guard from the second.
    assert.deepEqual(record.cycles[0].guards!.born, ["G1"])
    assert.deepEqual(record.cycles[1].guards!.born, ["G2"])
    assert.deepEqual(recorded.born.map(g => [g.id, g.source, g.units]), [["G1", "library", [SORT_UNIT]], ["G2", "review", [FILTER_UNIT]]])
    assert.equal(recorded.born[1].origin?.text, FILTER_ITEM_TEXT)
    // The repair message: the control group's base text, then the reviewer's own words.
    assert.equal(executor.log.messages.length, 2)
    assert.ok(executor.log.messages[1].text.startsWith(`${REPAIR_INTRO}\n\n1. ${FILTER_ITEM_TEXT}`), executor.log.messages[1].text.slice(0, 400))
    // The review request: base text word for word, the requirements, then the appendix.
    const req = reviewer.requests[0].request
    assert.ok(req.startsWith(`${REVIEW_INTRO}\n${REVIEW_REPLY}\n\n# Round 1 requirements\n\n${roundText(1)}`), req.slice(0, 300))
    assert.match(req, /# Focus of this review\nRound 1 is the first round: all of the requirements are new\./u)
    assert.ok(invokesProgram("GOFLAGS=-mod=mod go run . transform --input a.csv", "dpipe") && invokesProgram("cd /tmp/x && ./dpipe transform", "dpipe") && invokesProgram("timeout 5 ./dpipe verify", "dpipe"))
    assert.ok(!req.includes("# Leads to verify"), "nothing to verify: no leads paragraph")
    // The second review found nothing new: no third review (2 reviews, the second on the fixed program).
    assert.deepEqual(record.accept!.reviews.map(r => [r.n, r.cycle, r.reported, r.sent, r.no_issues]), [[1, "C1.1", 1, 1, false], [2, "C1.2", 0, 0, true]])
    assert.equal(reviewer.requests.length, 2)
    // The ledger: the item opened in C1.1, sent once, fixed in round 1; the review item record names its guard.
    const item = record.review_items!.find(x => x.id === "V1.1.1")!
    assert.deepEqual([item.premise, item.guard], [null, "G2"])
    const ledger = ledgerOf({ ...store.inspect(), executions: [record], guards: recorded.born, guard_events: recorded.events }, store.registry())
    const e = ledger.find(x => x.id === "V1.1.1")!
    assert.deepEqual([e.source, e.units, e.sent, e.end?.how], ["review", [FILTER_UNIT], ["C1.1"], "fixed"])
  })

  it("the repair of the filter breaks the sort guard: not reverted (batch 1 of DESIGN-OPUS, 5A); the filter's fix stays, the sort guard goes back as an item with its material and is fixed on the next cycle", async () => {
    const reviewer = scriptedReviewer([{ text: `1. ${FILTER_ITEM_TEXT}` }, { text: "NO ISSUES" }])
    const formalize = stubFormalizer({ filter: FILTER_UNIT, sort: SORT_UNIT })
    // The second program fixes the filter and breaks the sort; the third, sent the regression, fixes the sort.
    const { record, executor, workdir } = await round(dir, store, 1, [wd => write(wd, files({ filterWrong: true })), wd => write(wd, files({ reverseInTransform: true })), wd => write(wd, files())], { library: [sortCheck("K1", objects().sort)], reviewer, formalize })
    const [, c2, c3] = record.cycles
    assert.equal(c2.message, "repair")
    assert.equal(c2.reverted, undefined, "no repair is reverted")
    assert.equal(record.accept!.reverted, 0)
    assert.deepEqual(record.accept!.guards.flipped_unchanged, ["G1"])
    assert.deepEqual(c2.items!.filter(i => i.id === "G1").map(i => i.action), ["send"])
    // The regression in the repair list, with its material; no word of a revert.
    const m = executor.log.messages[2].text
    assert.match(m, /A check that passed on the previous version of the program fails now \(G1\)\.\nRequirement: [^]*\nCommand: \["transform"[^]*\nWhat the program did: /u)
    assert.ok(!m.includes("reverted"), m.slice(0, 300))
    assert.ok(!m.includes("Keep rows where the column satisfies the condition"), "the filter's fix is kept: not sent again")
    assert.equal(record.kept, c3.id)
    assert.deepEqual(record.accept!.regressions, { raised: 1, fixed_next: 1, persisted: 0 })
    assert.ok(!git(workdir, ["show", "HEAD:filter.go"]).includes("keep != true"), "the filter is fixed on the kept program")
    const ledger = ledgerOf({ ...store.inspect(), executions: [record] }, store.registry())
    assert.deepEqual(ledger.find(x => x.id === "V1.1.1")!.end?.how, "fixed")
    assert.ok(!ledger.some(x => x.end?.how === "discarded"))
    assert.ok(executor.log.messages[1].text.startsWith(REPAIR_INTRO))
  })

  it("a judgment turned from ok to wrong on the same output is a lead for the reviewer: never a guard, never a repair", async () => {
    const reviewer = scriptedReviewer([{ text: "NO ISSUES" }])
    const lead = { id: `P9/${FILTER_UNIT}`, text: "the judge now says the filter is wrong (the output did not change)", digest: "same" }
    const { record, executor } = await round(dir, store, 1, [wd => write(wd, files())], { reviewer, formalize: stubFormalizer({ filter: FILTER_UNIT, sort: SORT_UNIT }), leads: async () => [lead] })
    assert.equal(executor.log.messages.length, 1, "no repair message")
    assert.match(reviewer.requests[0].request, /# Leads to verify\n[^\n]*\n- P9\/R1\.S3\.P2\.s4: the judge now says the filter is wrong/u)
    assert.deepEqual(record.accept!.leads, { library: 0, judgment: 1 })
    assert.deepEqual(record.accept!.guards.born, [], "no guard from a judgment")
    assert.deepEqual(record.cycles[0].items, [])
  })

  it("with acceptance.void_without_runs (off by default since the fix block): a review in which the program never ran is void and done again; its NO ISSUES does not count", async () => {
    const reviewer = scriptedReviewer([{ text: "NO ISSUES", runs: [] }, { text: "NO ISSUES", runs: [{ command: "./dpipe transform --input d.csv", exit_code: 0 }] }])
    const calls: { valid: boolean; no_issues: boolean }[] = []
    const { record } = await round(dir, store, 1, [wd => write(wd, files())], { reviewer, formalize: stubFormalizer({ filter: FILTER_UNIT, sort: SORT_UNIT }), voidWithoutRuns: true, record: { ...noop, review: async r => { calls.push({ valid: r.valid, no_issues: r.no_issues }) } } })
    assert.equal(reviewer.requests.length, 2)
    assert.deepEqual(calls, [{ valid: false, no_issues: false }, { valid: true, no_issues: true }])
    assert.deepEqual([record.accept!.voided, record.accept!.reviews[0].attempts, record.accept!.reviews[0].valid], [1, 2, true])
  })
})

describe("exp2 acceptance block §6: a guard that flips is a question for the reviewer when this round's text changed behind it, a regression otherwise", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-acc-flip-"))
  const store = new Exp2Store(join(dir, "store"), "accf")
  before(async () => { for (const r of [1, 2, 3, 4, 5]) await store.ingestRound(r, roundText(r), stubTransport()) })

  it("R5 withdrew the sidecar: the sidecar guard fails on the new program; the request quotes the change; SUPERSEDED retires it", async () => {
    const reg = store.registry()
    const k = sidecarCheck("K7", reg.coverOf(SIDECAR_UNIT)!.owner)
    const guard: GuardRecord = { id: "G1", round: 1, source: "library", check: "K7", units: [SIDECAR_UNIT], object: k.object, born: { cycle: "C1.1", program: "p" } }
    const behind = changedTextBehind(reg, guard, 5)
    assert.ok(behind.some(b => b.source === "revision" && /R1\.S3\.P24\.s1: R1\.S3\.P24\.s1\.c3 withdrawn by R5\.S1\.P2\.s4/u.test(b.text)), JSON.stringify(behind))
    assert.ok(behind.some(b => b.source === "object" && /owns a unit the guard rests on and changed this round/u.test(b.text)))
    assert.deepEqual(changedTextBehind(reg, guard, 4), [], "nothing changed behind it in round 4")
    const reviewer = scriptedReviewer([{ text: "SUPERSEDED G1: round 5 removed the .sha256 sidecar files of transform and ingest." }])
    const events: GuardEvent[] = []
    const { record } = await round(dir, store, 5, [wd => write(wd, files({ sidecar: false }))], {
      library: [k], guards: [guard], guardEvents: [{ guard: "G1", round: 1, cycle: "C1.1", status: "passing" }], reviewer, formalize: stubFormalizer({ filter: FILTER_UNIT, sort: SORT_UNIT }),
      record: { ...noop, guards: async (_b, e) => { events.push(...e) } },
    })
    const req = reviewer.requests[0].request
    assert.match(req, /# Checks that passed on an earlier version of the program and fail now/u)
    assert.match(req, /G1: command \["transform"/u)
    assert.match(req, /Text it rested on \(before\): "its SHA-256 to `<output>\.sha256`\."/u)
    assert.match(req, /Text in force now: .*sidecar files produced during `ingest` and `transform` are \*\*removed\*\*/u)
    assert.match(req, /# Focus of this review\nThe text under `# Round 5 requirements` is what this round added or revised/u)
    assert.match(req, /Earlier text this round revised or withdrew \(no longer in force as written\):\n> /u)
    assert.match(req, /\n> its SHA-256 to `<output>\.sha256`\. \(withdrawn by R5\.S1\.P3\.s5 in round 5\)/u)
    assert.deepEqual(events.map(e => [e.guard, e.status, !!e.changed_text?.length]), [["G1", "failing", true], ["G1", "retired", false]])
    assert.deepEqual(record.accept!.guards.flipped_changed_text, ["G1"])
    assert.deepEqual(record.accept!.guards.retired.map(x => x.id), ["G1"])
    assert.deepEqual(record.cycles[0].items, [], "nothing sent for it")
    assert.equal(record.status, "done")
  })

  it("R2 did not touch the sort: a sort guard that fails is a regression, sent to the executor at once with the control group's message", async () => {
    const reg = store.registry()
    const k = sortCheck("K1", reg.coverOf(SORT_UNIT)!.owner)
    const guard: GuardRecord = { id: "G1", round: 1, source: "library", check: "K1", units: [SORT_UNIT], object: k.object, born: { cycle: "C1.1", program: "p" } }
    assert.deepEqual(changedTextBehind(reg, guard, 2), [])
    const reviewer = scriptedReviewer([{ text: "NO ISSUES" }])
    const { record, executor } = await round(dir, store, 2, [wd => write(wd, files({ sortText: true })), wd => write(wd, files())], {
      library: [k], guards: [guard], guardEvents: [{ guard: "G1", round: 1, cycle: "C1.1", status: "passing" }], reviewer, formalize: stubFormalizer({ filter: FILTER_UNIT, sort: SORT_UNIT }),
    })
    assert.deepEqual(record.accept!.guards.flipped_unchanged, ["G1"])
    assert.deepEqual(record.cycles[0].items!.map(i => [i.id, i.verdict, i.action]), [["G1", "not_landed", "send"]])
    assert.equal(executor.log.messages.length, 2)
    assert.match(executor.log.messages[1].text, new RegExp(`^${REPAIR_INTRO.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\n\n1\\. A check that passed on the previous version of the program fails now \\(G1\\)\\.\nRequirement: "- \`sort\`: Sort rows`, "u"))
    assert.ok(!reviewer.requests[0].request.includes("# Checks that passed"), "a regression is not a question for the reviewer")
    // Fixed by the repair: the guard passes again, the round ends with nothing open.
    assert.deepEqual(record.cycles[1].items!.map(i => [i.id, i.verdict]), [["G1", "pass"]])
    assert.deepEqual(record.final, [])
  })

  it("guard coverage is taken from guards that ran: units no guard rests on are reported", () => {
    const reg = store.registry()
    const g: GuardRecord = { id: "G1", round: 1, source: "review", units: [FILTER_UNIT], object: null, born: { cycle: "C1.1", program: "p" } }
    const c = guardCoverage(reg, 1, [g], new Set(["G1"]))
    assert.ok(c.units.includes(FILTER_UNIT) && c.covered.includes(FILTER_UNIT) && c.uncovered.includes(SORT_UNIT) && !c.uncovered.includes(FILTER_UNIT))
    assert.deepEqual(guardCoverage(reg, 1, [g], new Set()).covered, [], "a guard that did not run covers nothing")
  })
})

describe("exp2 acceptance block §5: probes are written once per unit, when it enters or is revised", () => {
  // A writer that leaves one round-1 unit (rename) unexercised, as writers do.
  const RENAME_UNIT = "R1.S3.P9.s3"
  const leaving = () => { const inner = stubProbeWriter(); return async (r: Parameters<typeof inner>[0]) => { const reply = await inner(r); const a = JSON.parse(reply.text) as { probes: { covers: { unit: string }[] }[] }; a.probes = a.probes.filter(p => !p.covers.some(c => c.unit === RENAME_UNIT)); return { ...reply, text: JSON.stringify(a) } } }

  it("round 2 writes nothing for an unchanged round-1 unit, and again for the units of a probe whose text was revised; no gap carry-over", async () => {
    const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-acc-probes-")), "accw")
    for (const r of [1, 2, 3]) await store.ingestRound(r, roundText(r), stubTransport())
    const r1 = await store.deriveRoundProbes(1, leaving(), { byReference: false, gaps: false })
    assert.ok(r1.entered.length > 0 && r1.uncovered.includes(RENAME_UNIT), "round 1 leaves the rename unit unexercised")
    const b2 = await store.beginRoundProbes(2, { byReference: false, gaps: false })
    assert.ok(!b2.units.includes(FILTER_UNIT) && !b2.units.includes(SORT_UNIT) && !b2.units.includes(RENAME_UNIT), "unchanged units are not written for again, exercised or not")
    assert.deepEqual(b2.gaps, [], "no gap carried in")
    // R2 partly revised fill's strategy list (R1.S3.P22.s3): the probe on it goes stale and its live units are written again.
    const stale = store.inspect().probes.filter(p => b2.stale.includes(p.id))
    assert.ok(stale.some(p => p.covers.some(c => c.unit === "R1.S3.P22.s3")), JSON.stringify(stale.map(p => p.covers.map(c => c.unit))))
    assert.ok(b2.units.some(u => u.startsWith("R1.S3.P22")) && b2.units.some(u => u.startsWith("R2.")))
    assert.ok(b2.units.every(u => u.startsWith("R2.") || stale.some(p => p.covers.some(c => c.unit === u))), "every round-1 unit written again belongs to a probe whose text was revised")
    // With the gap carry-over on (the block 11 rule), round 1's unexercised unit would come back.
    const store2 = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-acc-probes2-")), "accw2")
    for (const r of [1, 2]) await store2.ingestRound(r, roundText(r), stubTransport())
    await store2.deriveRoundProbes(1, leaving(), { byReference: false, gaps: false })
    assert.ok((await store2.beginRoundProbes(2, { byReference: false, gaps: true })).gaps.includes(RENAME_UNIT))
  })
})

describe("exp2 acceptance block: the serial R1–R3 with the review acceptance, and the replay on frozen programs", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-acc-serial-"))
  const store = new Exp2Store(join(dir, "store"), "accs")
  const reviewer = workingReviewer(join(dir, "rb"))
  const formalize = stubFormalizer({ filter: FILTER_UNIT, sort: SORT_UNIT })
  before(async () => {
    const serial = new Serial({
      store, workdir: join(dir, "work"), checkpoints: join(dir, "checkpoints"), text: roundText, attribution: stubTransport(), checks: checkStubTransport(),
      executor: serialExecutor(), executorIsStub: true, anchors: new GoAnchorExtractor(), runner: new LocalProcessRunner(), sandbox: new LocalScriptSandbox(), build: goBuilder(join(dir, "builds"), {}, "dpipe"), binary: "dpipe",
      reviewer, formalize, trial: goTrial(),
      limits: { attributionRepairs: 2, checkRepairs: 2, managementTimeoutMs: 60_000, checkTimeoutMs: 10_000, execution: { ...DEFAULT_LIMITS, repairCycles: 2 } },
    })
    assert.equal((await serial.run({ to: 3 })).status, "done")
  })

  it("every round's report has the review block: first delivery, stage wall times, each role's tokens, guards, flips, reverts, premises, items, coverage, void reviews", () => {
    const s = store.inspect()
    assert.deepEqual(s.reports.map(r => r.round), [1, 2, 3])
    for (const r of s.reports) {
      const v = r.review!
      assert.ok(v, `R${r.round} review block`)
      assert.ok(v.first_delivery && /^C\d+\.1$/u.test(v.first_delivery.cycle) && v.first_delivery.commit.length === 40)
      assert.ok(v.reviews.length >= 1 && v.reviews.every(x => typeof x.reported === "number" && typeof x.sent === "number"))
      assert.ok(v.reviewer.calls === v.reviews.reduce((n, x) => n + x.attempts, 0) && v.reviewer.tokens.input_tokens > 0 && v.reviewer.tokens.cache_read_tokens > 0)
      assert.ok(typeof v.formalizer.calls === "number" && typeof v.premise_blocked === "object" && typeof v.reverted === "number" && typeof v.voided === "number")
      assert.ok(typeof v.guards.at_start === "number" && Array.isArray(v.guards.born) && Array.isArray(v.guards.flipped_changed_text) && Array.isArray(v.guards.flipped_unchanged))
      assert.ok(v.coverage && v.coverage.units > 0 && v.coverage.covered >= 0 && Array.isArray(v.coverage.uncovered))
      assert.ok(v.trial.runs >= 1)
      const stages = r.wall!.stages.map(x => x.stage)
      for (const st of ["coding", "build", "trial", "guard rerun", "review"]) assert.ok(stages.includes(st), `R${r.round} wall time has ${st}: ${stages.join(", ")}`)
      const text = renderReport(r)
      // Two groups only (§12j.4): the §12i line and the interface counts; the rest is in report.json.
      assert.match(text, /^# Round \d+ report\n\nOfficial score: [^\n]*\n\n§12i measures: wall \d+ s; guards \d+→\d+;[^\n]*\n\nInterface counts:\n\n/u)
      assert.match(text, /- Reviewer items: reported \d+, entered a repair list \d+ \(verified \d+, logged \d+, fallback \d+\), blocked \d+; every entry ended once: yes; no_input \d+; reviews \d+ \(void sessions \d+\)/u)
      assert.match(text, /- Check writing: admitted \d+\/\d+, unknown never told the model 0; dropped after the repairs \d+ .*; runs refused as an unknown subcommand \d+; units coarser than a sentence \d+ in \d+ checks \(admitted, they cover no sentence\); units no check rests on \d+ \(reported only\)\./u)
      assert.match(text, /- Guards: \d+ at the start, \d+ at the end, new \d+; flips on changed text \d+.*, on unchanged text \d+.*; retired as superseded \d+.*; repairs reverted \d+; regressions raised \d+, fixed on the next cycle \d+, still failing then \d+ \(no repair is reverted\)\./u)
      assert.match(text, /- Requirements given: work order source zone delta, \d+ characters/u)
      // Batch 1 (DESIGN-OPUS §0a, §2, G12): the delivery by recipient against the line, the verification state, the roles' time.
      assert.ok(r.delivery && r.delivery.line === 2 * roundText(r.round).length + 10_000 && r.delivery.recipients.executor.chars.A > 0 && r.delivery.recipients.reviewer.chars.A > 0, JSON.stringify(r.delivery?.recipients))
      assert.ok(r.delivery.outside["check writing"]!.chars > 0, "the check writing's reading is recorded")
      assert.match(text, /- Original text delivered: line [\d.]+k?; executor [^\n]*; reviewer [^\n]*; formalizer [^\n]*\(outside the line\)[^\n]*\.\n(?:- Debt slice: \d+ paragraphs [^\n]*\n)?- Verification state:\d+ sentences in force; [^\n]*\n- Wall time: round [\d.]+ min; executor [\d.]+ min, reviewer [\d.]+ min/u)
      assert.match(text, /- Revision recall: no gold set for this task\.\n- Relation recall: no gold set for this task\./u)
      assert.ok(!/Probes|Ledger:|Guard coverage|Zones:/u.test(text), "nothing else is rendered")
    }
    // R1: the stand-in's sort compares as text; the reviewer reports it; the stand-in cannot fix it; guards were born from the library's passes.
    const r1 = s.reports[0].review!
    assert.ok(r1.items.reported >= 1 && r1.items.sent >= 1, JSON.stringify(r1.items))
    assert.ok(r1.guards.born.length > 0)
    assert.ok(s.guards.length === s.reports[2].review!.guards.at_end + s.guard_events.filter(e => e.status === "retired").length || s.guards.length >= s.reports[2].review!.guards.at_end)
    assert.ok(s.review_calls.length === s.reports.reduce((n, r) => n + r.review!.reviewer.calls, 0))
    assert.ok(s.formalize_calls.length > 0 && s.formalize_calls.every(c => /^F\d+$/u.test(c.id)))
    // The first delivery is on record for the local scoring.
    const fd = readFileSync(join(dir, "checkpoints", "first-deliveries.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l) as { round: number; commit: string })
    assert.deepEqual(fd.map(x => x.round), [1, 2, 3])
    assert.ok(existsSync(join(dir, "checkpoints", "round-02", "ledger.md")))
    // The sort item stays open across rounds (the ledger carries it, the work order lists it once a round).
    const ledger = JSON.parse(readFileSync(join(dir, "checkpoints", "round-03", "ledger.json"), "utf8")) as { id: string; source: string; state: string }[]
    assert.ok(ledger.some(e => e.source === "review" && e.id.startsWith("V1.1.")), JSON.stringify(ledger.map(e => [e.id, e.source, e.state])))
    assert.ok(ledger.some(e => e.source === "guard" || e.source === "check" || e.source === "review"))
  })

  it("the replay runs the new acceptance on frozen programs: the reviewer's raw list, the premises' verdicts and what would be sent, per product", async () => {
    const root = mkdtempSync(join(tmpdir(), "exp2-acc-replay-"))
    const product = (name: string, o: Parameters<typeof files>[0]) => { const p = join(root, "src", name); mkdirSync(p, { recursive: true }); write(p, files(o)); return { name, round: 1, path: p } }
    const rstore = new Exp2Store(join(root, "store"), "accrep")
    const result = await replayReview({
      store: rstore, text: roundText, attribution: stubTransport(), checks: checkStubTransport(), sandbox: new LocalScriptSandbox(), runner: new LocalProcessRunner(), build: goBuilder(join(root, "builds"), {}, "dpipe"), timeoutMs: 10_000, root,
      reviewer: workingReviewer(join(root, "rb")), formalize: stubFormalizer({ filter: FILTER_UNIT, sort: SORT_UNIT }), binary: "dpipe",
    }, [product("filter_wrong", { filterWrong: true }), product("clean", {})])
    const [wrong, clean] = result
    assert.deepEqual(wrong.items.map(i => [i.id, i.premise, i.units]), [["V1.1.1", null, [FILTER_UNIT]]])
    assert.ok(wrong.reviews[0].valid && !wrong.reviews[0].no_issues && wrong.reviews[0].program_runs >= 2)
    assert.ok(clean.reviews[0].no_issues && clean.items.length === 0)
    assert.ok(wrong.usage.reviewer.input_tokens > 0 && wrong.usage.formalizer.input_tokens > 0 && clean.usage.formalizer.input_tokens === 0)
    assert.ok(wrong.library.passing.length + wrong.library.failing.length > 0, "the library ran on the product")
    assert.equal(renderReviewList([{ id: "a", text: "x" }, { id: "b", text: "y\n" }]), "1. x\n\n2. y")
  })
})

describe("batch 1b (§6b): a flip's text changed when the attribution's records say so; a relation edge counts, the guard's input does not", () => {
  // The K8 shape: a guard on the sort whose text is related (an edge recorded in R1) to the sidecar clause R5 withdraws.
  // The sort's own text and object are untouched in R5; only the edge connects the guard to the withdrawal.
  const dir = mkdtempSync(join(tmpdir(), "exp2-acc-edge-"))
  const withEdge = new Exp2Store(join(dir, "edge"), "acce"), without = new Exp2Store(join(dir, "plain"), "accp")
  const edged = (): AttributionTransport => {
    const inner = stubTransport()
    return async request => {
      const reply = await inner(request)
      if (request.round !== 1 || request.previous_draft.assignments.length) return reply
      const patch = JSON.parse(reply.text) as { edges_add: unknown[] }
      patch.edges_add.push({ from: SORT_UNIT, to: SIDECAR_UNIT, kind: "refers_to" })
      return { ...reply, text: JSON.stringify(patch) }
    }
  }
  before(async () => {
    for (const r of [1, 2, 3, 4, 5]) await withEdge.ingestRound(r, roundText(r), edged())
    for (const r of [1, 2, 3, 4, 5]) await without.ingestRound(r, roundText(r), stubTransport())
  })
  const sortGuard = (reg: ReturnType<Exp2Store["registry"]>) => {
    const k = sortCheck("K1", reg.coverOf(SORT_UNIT)!.owner)
    return { k, guard: { id: "G1", round: 1, source: "library", check: "K1", units: [SORT_UNIT], object: k.object, born: { cycle: "C1.1", program: "p" } } as GuardRecord }
  }

  it("the records: with the edge, R5's withdrawal of the sidecar stands behind the sort guard (source edge); without it, nothing does", () => {
    const reg = withEdge.registry(), { guard } = sortGuard(reg)
    assert.ok(!reg.roundScope(5).some(c => c.object === guard.object), "R5 does not change the sort")
    const behind = changedTextBehind(reg, guard, 5)
    assert.ok(behind.length && behind.every(b => b.source === "edge"), JSON.stringify(behind))
    assert.match(behind.map(b => b.text).join("\n"),/^R1\.S3\.P9\.s2 refers_to R1\.S3\.P24\.s1 \(round 1\); R1\.S3\.P24\.s1\.c3 withdrawn by R5\.S1\.P2\.s4/u)
    assert.deepEqual(changedTextBehind(without.registry(), sortGuard(without.registry()).guard, 5), [])
  })

  for (const [name, store, how] of [["with the edge", () => withEdge, "changed_text"], ["without the edge", () => without, "regression"]] as const) {
    it(`R5, the sort breaks, ${name}: ${how === "changed_text" ? "a question for the reviewer, nothing sent" : "a regression, sent to the executor"}; the report names the source`, async () => {
      const s = store(), { k, guard } = sortGuard(s.registry())
      // Asked, the reviewer says the sort guard is superseded (the stand-in answers so whenever it is asked).
      const reviewer = scriptedReviewer([{ text: "SUPERSEDED G1: round 5 changed what the sort guard rests on." }])
      const { record } = await round(dir, s, 5, [wd => write(wd, files({ sortText: true, sidecar: false })), wd => write(wd, files({ sidecar: false }))], {
        library: [k], guards: [guard], guardEvents: [{ guard: "G1", round: 1, cycle: "C1.1", status: "passing" }], reviewer, formalize: stubFormalizer({ filter: FILTER_UNIT, sort: SORT_UNIT }),
      })
      assert.equal(/G1: command \["transform"/u.test(reviewer.requests[0].request), how === "changed_text", "the reviewer is asked about G1 only when a record stands behind it")
      const flips = record.accept!.guards.flips!
      assert.deepEqual(flips.map(f => [f.id, f.how, f.sources]), [["G1", how, how === "changed_text" ? ["edge"] : []]])
      const sent = record.cycles[0].items!.filter(i => i.id === "G1" && i.action === "send")
      assert.equal(sent.length, how === "changed_text" ? 0 : 1)
      assert.match(renderFlips(flips), how === "changed_text" ? /edge 1, none 0; G1 C5\.1 changed text \(edge; expected verbatim\)/u : /edge 0, none 1; G1 C5\.1 regression \(none; expected verbatim\)/u)
    })
  }
})
