import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { acceptRound, type AcceptDeps } from "../../src/exp2/accept.js"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import type { AttributionTransport } from "../../src/exp2/attribution.js"
import { goBuilder } from "../../src/exp2/build.js"
import { codeFacts, refusedChecks, type CheckRecord } from "../../src/exp2/checks.js"
import { DEFAULT_LIMITS } from "../../src/exp2/execution.js"
import { initRepo } from "../../src/exp2/git.js"
import type { GuardEvent, GuardRecord } from "../../src/exp2/guards.js"
import { ledgerOf } from "../../src/exp2/ledger.js"
import { renderReport, revisionRecall } from "../../src/exp2/report.js"
import { LocalProcessRunner, LocalScriptSandbox } from "../../src/exp2/runner.js"
import { Serial } from "../../src/exp2/serial.js"
import { Exp2Store, refusedIn } from "../../src/exp2/store.js"
import { buildFormalizeRequest } from "../../src/exp2/formalize.js"
import { annotate } from "../../src/exp2/source.js"
import { contextOf, currentView, fitPackage, renderPackage, roundPackage } from "../../src/exp2/view.js"
import { buildWorkOrder, renderWorkOrder } from "../../src/exp2/workorder.js"
import { checkStubTransport } from "./check-stubs.js"
import { DROP, FILTER, GO_MOD, MAIN, NORMALIZE, RENAME, SORT, TRANSFORM, VERIFY } from "./go-fixtures.js"
import { roundText } from "./inputs.js"
import { FILTER_INPUT, standInReview, stubFormalizer, workingReviewer } from "./review-stubs.js"
import { serialExecutor } from "./serial-executor.js"
import { StubExecutor, write } from "./stub-executor.js"
import { stubTransport } from "./stubs.js"

/**
 * Batch 1 (DESIGN §12j.4, §12j.7 items 1–12, §6a): the round's package instead of every round's text, flips
 * classified before a revert, a revert that keeps the findings, refused calls told to their writer, the report's two
 * groups. Real round texts (exp2/inputs/dpipe), stand-in models and programs.
 */

process.env.GIT_AUTHOR_DATE = process.env.GIT_COMMITTER_DATE = "2026-10-20T00:00:00Z"

const FILTER_UNIT = "R1.S3.P2.s4", SORT_UNIT = "R1.S3.P9.s2"
/** R2's zscore sentence: population stddev. R3 revises it to the sample stddev (R3.S3.P1–P2). */
const ZSCORE_UNIT = "R2.S11.P5.s3"
const SORT_NUM = SORT.replace('import "sort"', 'import (\n\t"sort"\n\t"strconv"\n)').replace("return t.rows[a][i] < t.rows[b][i]", "x, _ := strconv.ParseFloat(t.rows[a][i], 64)\n\t\ty, _ := strconv.ParseFloat(t.rows[b][i], 64)\n\t\treturn x < y")
const program = (o: { stddev: "population" | "sample"; filterWrong?: boolean; sortText?: boolean }) => ({
  "go.mod": GO_MOD, "main.go": MAIN, "verify.go": VERIFY(), "transform.go": TRANSFORM(["drop", "filter", "normalize", "rename", "sort"], true),
  "filter.go": FILTER(o.filterWrong ?? false), "sort.go": o.sortText ? SORT : SORT_NUM, "rename.go": RENAME, "drop.go": DROP, "op_normalize.go": NORMALIZE(o.stddev),
})
const target = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, path: null, line: null, pointer: null, column: null, ...extra }) as CheckRecord["assertions"][number]["target"]
const ZSCORE_INPUT = { args: FILTER_INPUT.args, files: [{ path: "data.csv", content: "id,value\n1,1\n2,2\n3,3\n" }, { path: "recipe.json", content: `[{"op":"normalize","column":"value","method":"zscore","as":"value_norm"}]` }] }
/** G77 as the 15-round R2 fixed it: the zscore by the population formula, a value the formalizer worked out (derived). */
const zscoreGuard = (object: string): GuardRecord => ({
  id: "G1", round: 2, source: "review", units: [ZSCORE_UNIT], object, input: ZSCORE_INPUT,
  assertions: [
    { id: "z1", role: "business", target: target("csv_cell", { path: "out.csv", line: 1, column: "value_norm" }), expect: (1 - 2) / Math.sqrt(2 / 3), tolerance: 1e-9, source: { kind: "derived", block: null } },
    { id: "exit", role: "business", target: target("exit_code"), expect: 0, tolerance: null, source: { kind: "verbatim", block: null } },
  ],
  reference_script: null, origin: { item: "V2.1.3", review: "R2.1", text: "normalize zscore uses the population stddev" }, born: { cycle: "C2.2", program: "p" },
})
/** A sort guard on a value the text states (verbatim): its failure is the program's. */
const sortGuard = (object: string): GuardRecord => ({
  id: "G1", round: 1, source: "review", units: [SORT_UNIT], object, input: { args: FILTER_INPUT.args, files: [{ path: "data.csv", content: "id,value\n1,5\n2,20\n3,3\n4,12\n" }, { path: "recipe.json", content: `[{"op":"sort","column":"value","order":"asc"}]` }] },
  assertions: [{ id: "l2", role: "business", target: target("file_line", { path: "out.csv", line: 2 }), expect: "3,3", tolerance: null, source: { kind: "verbatim", block: null } }, { id: "exit", role: "business", target: target("exit_code"), expect: 0, tolerance: null, source: { kind: "verbatim", block: null } }],
  reference_script: null, origin: { item: "V1.1.2", review: "R1.1", text: "sort compares as text" }, born: { cycle: "C1.2", program: "p" },
})
const passing = (g: string, round: number): GuardEvent => ({ guard: g, round, cycle: `C${round}.1`, status: "passing" })
const noop = { review: async () => {}, formalize: async () => {}, guards: async () => {} }

async function round3(dir: string, store: Exp2Store, messages: ((wd: string) => void)[], o: { guards: GuardRecord[]; reviewer: AcceptDeps["reviewer"]; record?: AcceptDeps["record"]; library?: CheckRecord[] }) {
  const workdir = join(dir, `work-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(workdir, { recursive: true })
  initRepo(workdir)
  const registry = store.registry(), anchors = new GoAnchorExtractor()
  const w = buildWorkOrder({ registry, round: 3, library: [], events: [], statuses: [], runs: [], anchors: anchors.extract(workdir), links: [], steps: [], previous_task: [] })
  const executor = new StubExecutor({ messages })
  const record = await acceptRound(workdir, w, renderWorkOrder(w), executor, {
    registry, library: o.library ?? [], events: [], facts: codeFacts(registry, 3), guards: o.guards, guardEvents: o.guards.map(g => passing(g.id, g.round)),
    runner: new LocalProcessRunner(), sandbox: new LocalScriptSandbox(), anchors, build: goBuilder(join(dir, "builds"), {}, "dpipe"),
    reviewer: o.reviewer, formalize: stubFormalizer({ filter: FILTER_UNIT, sort: SORT_UNIT }), binary: "dpipe", sources: store.inspect().sources.map(s => ({ round: s.round, text: s.text })),
    copyDir: label => join(dir, "copies", label), record: o.record ?? noop, checkTimeoutMs: 10_000,
  }, { ...DEFAULT_LIMITS, repairCycles: 3 })
  return { record, executor }
}

/** The stub attribution, with R3's normalize paragraphs given to normalize as plain additions: no modification recorded (as the 15-round R3 did). */
function noRevisionRecorded(): AttributionTransport {
  const inner = stubTransport()
  return async request => {
    const reply = await inner(request)
    if (request.round !== 3) return reply
    const patch = JSON.parse(reply.text) as { upsert: { block: string; change: string; overrides: unknown[] }[] }
    for (const a of patch.upsert) if (a.block === "R3.S3") { a.change = "add"; a.overrides = [] }
    return { ...reply, text: JSON.stringify(patch) }
  }
}

describe("batch 1, item 11: a flip is classified first; a regression on unchanged text is an item with its material, never a revert (batch 1 of DESIGN-OPUS, 5A)", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-b1-flip-"))
  const recorded = new Exp2Store(join(dir, "recorded"), "b1r")
  const unrecorded = new Exp2Store(join(dir, "unrecorded"), "b1u")
  before(async () => {
    for (const r of [1, 2, 3]) await recorded.ingestRound(r, roundText(r), stubTransport())
    for (const r of [1, 2, 3]) await unrecorded.ingestRound(r, roundText(r), noRevisionRecorded())
  })

  for (const [name, store] of [["R3 records the revision", () => recorded], ["R3 records no modification (the 15-round run's attribution)", () => unrecorded]] as const) {
    it(`the G77 case, ${name}: the repair that brings in the sample stddev flips G1; it goes to the reviewer, SUPERSEDED retires it, nothing is reverted`, async () => {
      const s = store(), normalize = s.registry().coverOf(ZSCORE_UNIT)!.owner
      const reviewer = workingReviewer(join(dir, `rb-${name.length}`), { also: req => req.includes("# Checks that passed on an earlier version") ? ["SUPERSEDED G1: round 3 uses the sample standard deviation for zscore"] : [] })
      const events: GuardEvent[] = []
      const { record, executor } = await round3(dir, s, [wd => write(wd, program({ stddev: "population", filterWrong: true })), wd => write(wd, program({ stddev: "sample" }))], { guards: [zscoreGuard(normalize)], reviewer, record: { ...noop, guards: async (_b, e) => { events.push(...e) } } })
      const a = record.accept!
      assert.equal(a.reverted, 0, "no revert")
      assert.deepEqual(a.guards.flipped_changed_text, ["G1"])
      assert.deepEqual(a.guards.flipped_unchanged, [])
      assert.deepEqual(a.guards.retired.map(x => x.id), ["G1"])
      const flip = events.find(e => e.guard === "G1" && e.status === "failing")!
      assert.ok(flip.changed_text?.length, JSON.stringify(flip))
      // The repair's fix of the filter is kept: its item became a guard on the kept program.
      assert.equal(record.kept, record.cycles.at(-1)!.id)
      assert.ok(record.cycles.every(c => !c.reverted))
      assert.ok(!executor.log.messages.some(m => /reverted by the controller/u.test(m.text)))
      assert.ok(reviewer.requests.some(r => /G1: command \["transform"/u.test(r.request)), "the reviewer was asked")
    })
  }

  it("a repair that breaks the sort (unchanged text, a stated value): not reverted; the filter's fix stays; the sort goes out as an item with its material and the next program fixes it", async () => {
    const sort = recorded.registry().coverOf(SORT_UNIT)!.owner
    const reviewer = workingReviewer(join(dir, "rb-revert"))
    const { record, executor } = await round3(dir, recorded, [
      wd => write(wd, program({ stddev: "sample", filterWrong: true })),
      wd => write(wd, program({ stddev: "sample", sortText: true })),
      wd => write(wd, program({ stddev: "sample" })),
    ], { guards: [sortGuard(sort)], reviewer })
    const a = record.accept!
    assert.equal(a.reverted, 0)
    assert.ok(record.cycles.every(c => !c.reverted))
    assert.deepEqual(a.guards.flipped_unchanged, ["G1"])
    // The message after the regression carries it with its material; the filter item, fixed there, is not in it.
    const after = executor.log.messages[2].text
    assert.match(after, /fails now \(G1\)\.\nRequirement: [^]*\nCommand: \["transform"[^]*\nWhat the program did: /u)
    assert.ok(!/reverted by the controller/u.test(after))
    assert.ok(!/Keep rows where the column satisfies the condition/u.test(after), "the filter's fix was kept: not sent again")
    assert.deepEqual(a.regressions, { raised: 1, fixed_next: 1, persisted: 0 })
    assert.ok(!record.cycles.flatMap(c => c.items ?? []).some(i => i.action === "discarded"), "nothing is discarded")
    const ledger = ledgerOf({ ...recorded.inspect(), executions: [record] }, recorded.registry())
    assert.ok(!ledger.some(e => e.end?.how === "discarded"))
  })

  it("batch 1b (§6b rule 1): a guard whose value is worked out (derived) flips on unchanged text: a regression (its sources none), an item, nothing reverted", async () => {
    const sort = recorded.registry().coverOf(SORT_UNIT)!.owner
    assert.ok(!recorded.registry().roundScope(3).some(c => c.object === sort), "R3 does not touch the sort")
    // The sort guard with its value worked out (derived), as the formalizer writes most values.
    const g = { ...sortGuard(sort), assertions: sortGuard(sort).assertions!.map(x => x.id === "l2" ? { ...x, source: { kind: "derived" as const, block: null } } : x) }
    const reviewer = workingReviewer(join(dir, "rb-derived"))
    const { record, executor } = await round3(dir, recorded, [
      wd => write(wd, program({ stddev: "sample", filterWrong: true })),
      wd => write(wd, program({ stddev: "sample", sortText: true })),
      wd => write(wd, program({ stddev: "sample" })),
    ], { guards: [g], reviewer })
    const a = record.accept!
    assert.equal(a.reverted, 0)
    assert.deepEqual(a.guards.flips!.map(f => [f.id, f.cycle, f.how, f.sources, f.expected]), [["G1", "C3.2", "regression", [], ["derived", "verbatim"]]])
    assert.equal(record.kept, "C3.3", "the third program fixes the sort; the filter's fix of the second is kept")
    assert.match(executor.log.messages[2].text, /fails now \(G1\)/u)
    assert.ok(!reviewer.requests.some(r => /# Leads to verify[^]*- G1: /u.test(r.request)), "no lead: it is the executor's")
  })
})

describe("guard ids stay in sequence when a repair breaks a guard (rep1h R4: 'guard G100 is out of sequence (next is G90)'; since batch 1 of DESIGN-OPUS nothing is reverted)", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-b1-revert-ids-"))
  const store = new Exp2Store(join(dir, "store"), "b1ri")
  before(async () => { for (const r of [1, 2, 3]) await store.ingestRound(r, roundText(r), stubTransport()) })

  it("a library check passes first on a repair that breaks the sort guard: it is born there, the next id; the repair is kept", async () => {
    const reg = store.registry()
    const sort = reg.coverOf(SORT_UNIT)!.owner, filter = reg.coverOf(FILTER_UNIT)!.owner
    const filterCheck: CheckRecord = {
      id: "K1", round: 3, key: "filter-gt", object: filter, blocks: [FILTER_UNIT], uses: [], input: FILTER_INPUT,
      assertions: [{ id: "l2", role: "business", target: target("file_line", { path: "out.csv", line: 2 }), expect: "2,20", tolerance: null, source: { kind: "verbatim", block: null } }, { id: "l3", role: "business", target: target("file_line", { path: "out.csv", line: 3 }), expect: "4,12", tolerance: null, source: { kind: "verbatim", block: null } }],
      unknown: [], reference_script: null, admission: "admitted", admission_reason: null, strength: null, status: "active", calls: [],
    }
    // The store's own check: every guard born is the next id after those before it (G1 is the sort guard).
    const born: string[] = []
    const record = { ...noop, guards: async (b: GuardRecord[]) => { for (const g of b) { assert.equal(g.id, `G${2 + born.length}`, `born in sequence: ${[...born, g.id].join(", ")}`); born.push(g.id) } } }
    const { record: r } = await round3(dir, store, [
      wd => write(wd, program({ stddev: "sample", filterWrong: true })),
      wd => write(wd, program({ stddev: "sample", sortText: true })),
      wd => write(wd, program({ stddev: "sample" })),
    ], { guards: [sortGuard(sort)], reviewer: workingReviewer(join(dir, "rb")), library: [filterCheck], record })
    assert.ok(r.cycles.every(c => !c.reverted))
    const breaking = r.cycles.find(c => c.guards?.flipped.includes("G1"))!
    assert.ok(breaking.runs.some(x => x.check === "K1" && x.outcome === "pass"), "K1 passed on the program that broke the sort")
    assert.equal(breaking.guards!.born[0], "G2", "born there, the next id")
    assert.deepEqual(r.accept!.guards.born, born)
  })
})

describe("batch 1, items 6, 9 (§6a step 3): the round's package, not every round's text", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-b1-delta-"))
  const store = new Exp2Store(join(dir, "store"), "b1d")
  before(async () => { for (const r of [1, 2, 3]) await store.ingestRound(r, roundText(r), stubTransport()) })

  it("the chain block (§6c view): the zscore paragraph after R3 has the sample sentence in place of the population one, under its id; no marker; R2 as written", () => {
    const reg = store.registry()
    const normalize = reg.coverOf(ZSCORE_UNIT)!.owner
    const now = currentView(reg, normalize, 3), then = currentView(reg, normalize, 2)
    const plain = (v: string) => v.replace(/‹[^›]*›/gu, "")
    assert.ok(!plain(now).includes(reg.block(ZSCORE_UNIT)!.text.trim()), "the population sentence is gone")
    for (const by of ["R3.S3.P1", "R3.S3.P2"]) assert.ok(now.includes(`‹${by}›${reg.block(by)!.text.trim()}`), by)
    assert.doesNotMatch(now, /replaced by|amended|where they differ|newer text wins|#[0-9a-f]{8}⟧/u)
    assert.ok(plain(then).includes(reg.block(ZSCORE_UNIT)!.text.trim()), "in round 2 it stood as written")
    assert.ok(now.indexOf("R3.S3.P1") < now.indexOf("## R3") || !now.includes("## R3"), "the revising text sits in place, not again at its own place")
    assert.equal(currentView(reg, normalize, 3), now, "a pure function")
    // R1's package: R1's paragraphs, all of them this round's.
    assert.ok(roundPackage(reg, 1).segments.every(s => s.why === "this round" && s.round === 1))
  })

  it("R2 and R3 (§6c revision): this round's paragraphs, the earlier paragraphs this round revises, the paragraphs this round's edges point at, the open items' paragraphs; nothing else", () => {
    const reg = store.registry()
    const para = (id: string) => contextOf(reg, id).id
    for (const r of [2, 3]) {
      const own = new Set(reg.roundScope(r).flatMap(c => c.entries.map(e => para(e.block))))
      const revised = new Set([...reg.objects.values()].flatMap(o => o.blocks.flatMap(b => b.modifications.filter(m => m.round === r).flatMap(m => m.parts.map(para)))))
      const pkg = roundPackage(reg, r, [{ id: "V1.1.1", units: [FILTER_UNIT] }])
      for (const s of pkg.segments) {
        if (s.why === "this round") assert.ok(own.has(s.paragraph), s.paragraph)
        else if (s.why === "revised") assert.ok(revised.has(s.paragraph) && /earlier text of /u.test(s.text), s.paragraph)
        else if (s.why === "edge") assert.ok(reg.references.some(e => e.round === r && !/^O\d+$/u.test(e.to) && para(e.to) === s.paragraph), s.paragraph)
        else assert.deepEqual([s.paragraph, s.via], [para(FILTER_UNIT), ["V1.1.1"]])
      }
      for (const p of own) assert.ok(pkg.segments.some(s => s.paragraph === p), `${p} of this round is there`)
      assert.equal(new Set(pkg.segments.map(s => s.paragraph)).size, pkg.segments.length, "each paragraph once")
      assert.equal(pkg.edges.to_block + pkg.edges.to_object, reg.references.filter(e => e.round === r).length)
      const delta = buildWorkOrder({ registry: reg, round: r, library: [], events: [], statuses: [], runs: [], anchors: [], links: [], steps: [], previous_task: [], scope: "delta", confirmed: [{ id: "V1.1.1", object: null, units: [FILTER_UNIT], args: [], files: [] }] })
      assert.ok(delta.scope!.source_chars < delta.scope!.source_chars_all, `R${r}: delta ${delta.scope!.source_chars} vs all ${delta.scope!.source_chars_all}`)
      assert.deepEqual(delta.status, [], "no status zone")
      assert.deepEqual(delta.scope!.segments!.map(s => s.paragraph), fitPackage(pkg).pkg.segments.map(s => s.paragraph), "the package within its budget")
      assert.doesNotMatch(renderWorkOrder(delta), /replaced by|amended by|newer text wins/u)
    }
  })

  it("batch 1c, the chain block: the formalizer reads what the reviewer reads, the package's views; without them (review scope full) every round, annotated", () => {
    const reg = store.registry()
    const body = renderPackage(roundPackage(reg, 3, [{ id: "V1.1.1", units: [FILTER_UNIT] }]))
    const full = buildFormalizeRequest(reg, 3, "1. x", "dpipe"), delta = buildFormalizeRequest(reg, 3, "1. x", "dpipe", undefined, body)
    assert.equal(delta.sources, body)
    assert.ok(full.sources.startsWith(`===== R1 =====
${annotate(reg.sources.get(1)!)}`))
    assert.ok(delta.sources.length < full.sources.length)
  })

  it("the stand-in serial R1–R3 under delta and under all: the work orders' source zones and the review requests, by size", { timeout: 900_000 }, async () => {
    const run = async (scope: "delta" | "all") => {
      const d = mkdtempSync(join(tmpdir(), `exp2-b1-serial-${scope}-`))
      const s = new Exp2Store(join(d, "store"), `b1s${scope}`)
      const serial = new Serial({
        ...standInReview(d), store: s, workdir: join(d, "work"), checkpoints: join(d, "checkpoints"), text: roundText, attribution: stubTransport(), checks: checkStubTransport(),
        executor: serialExecutor(), executorIsStub: true, anchors: new GoAnchorExtractor(), runner: new LocalProcessRunner(), sandbox: new LocalScriptSandbox(), build: goBuilder(join(d, "builds"), {}, "dpipe"), binary: "dpipe",
        acceptance: { workorderScope: scope, reviewScope: scope === "delta" ? "delta" : "full" },
        limits: { attributionRepairs: 2, checkRepairs: 2, managementTimeoutMs: 60_000, checkTimeoutMs: 10_000, execution: { ...DEFAULT_LIMITS, repairCycles: 2 } },
      })
      assert.equal((await serial.run({ to: 3 })).status, "done")
      return s.inspect()
    }
    const delta = await run("delta"), all = await run("all")
    // Per review request: under delta, batch 1 of DESIGN-OPUS reviews again while scope sentences are owed (effect 8), so the rounds' totals differ by the reviews' number.
    const sizes = (st: typeof delta) => st.reports.map(r => ({ round: r.round, chars: r.zones.source_chars!, all: r.zones.source_chars_all!, review: Math.round(r.review!.request_chars! / Math.max(1, r.review!.reviews.length)), reviews: r.review!.reviews.length }))
    const d = sizes(delta), a = sizes(all)
    console.log(JSON.stringify({ delta: d, all: a }))
    for (const k of [1, 2]) {
      assert.ok(d[k].chars < a[k].chars, `R${k + 1} work order: delta ${d[k].chars}, all ${a[k].chars}`)
      assert.equal(a[k].chars, a[k].all)
      assert.ok(d[k].review < a[k].review, `R${k + 1} characters a review request: delta ${d[k].review} (${d[k].reviews} reviews), full ${a[k].review} (${a[k].reviews})`)
    }
    // The report says so, in its interface counts.
    assert.match(renderReport(delta.reports[2]), /- Requirements given: work order source zone delta, \d+ characters in \d+ paragraphs of \d+ objects \(this round \d+ \(\d+ characters\), revised \d+ \(\d+ characters\), edge \d+ \(\d+ characters\), open item \d+ \(\d+ characters\)\), \d+ object heads; this round's edges to a block \d+, to an object \d+; \d+ comparisons \(guards on revised units\).* \(every round's text: \d+ in \d+ blocks\); review requests \d+ characters/u)
  })
})

describe("batch 1, item 7: a call the program refused goes back to the check's writer", () => {
  it("refused last round: stale this round, with what the program answered; the writer's request lists it", async () => {
    const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b1-ref-")), "b1ref")
    for (const r of [1, 2]) await store.ingestRound(r, roundText(r), stubTransport())
    const s = store.inspect()
    const k: CheckRecord = { id: "K1", round: 1, key: "k", object: store.registry().coverOf(FILTER_UNIT)!.owner, blocks: [FILTER_UNIT], uses: [], input: { args: ["dpipe", "transform"], files: [] }, assertions: [], unknown: [], reference_script: null, admission: "admitted", admission_reason: null, strength: null, status: "active", calls: [] }
    const refused = refusedIn({ executions: [], check_runs: [{ check: "K1", round: 1, program: "p", outcome: "fail", assertions: [], exit_code: 1, stderr_head: "", stdout_head: "", failure: { class: "not_landed", reason: "refused_call", detail: "the program answered \"dpipe\" as it answers an unknown subcommand", roles: ["business"] } }] } as unknown as Parameters<typeof refusedIn>[0], 1)
    const ev = refusedChecks([k], s.check_events, 2, refused)
    assert.deepEqual(ev.map(e => [e.check, e.status, e.cause?.kind]), [["K1", "stale", "refused"]])
    assert.match(ev[0].reason, /the program refused the call: the program answered "dpipe" as it answers an unknown subcommand/u)
  })
})

describe("batch 1, item 12: revisions recorded, measured", () => {
  it("R3: the zscore paragraphs read like a revision and are recorded; with no modification recorded, they are listed", async () => {
    const a = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b1-rev-")), "b1rev")
    const b = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b1-rev2-")), "b1rev2")
    for (const r of [1, 2, 3]) { await a.ingestRound(r, roundText(r), stubTransport()); await b.ingestRound(r, roundText(r), noRevisionRecorded()) }
    const ra = revisionRecall(a.registry(), 3), rb = revisionRecall(b.registry(), 3)
    assert.ok(ra.cue_paragraphs > 0 && ra.recorded > 0 && ra.modifications > 0, JSON.stringify(ra))
    assert.ok(!ra.unrecorded.includes("R3.S3.P1"))
    assert.ok(rb.recorded < ra.recorded && rb.unrecorded.includes("R3.S3.P1"), JSON.stringify(rb))
  })
})
