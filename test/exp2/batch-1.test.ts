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
import { effectiveText, packageSources, roundPackage } from "../../src/exp2/view.js"
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

async function round3(dir: string, store: Exp2Store, messages: ((wd: string) => void)[], o: { guards: GuardRecord[]; reviewer: AcceptDeps["reviewer"]; record?: AcceptDeps["record"] }) {
  const workdir = join(dir, `work-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(workdir, { recursive: true })
  initRepo(workdir)
  const registry = store.registry(), anchors = new GoAnchorExtractor()
  const w = buildWorkOrder({ registry, round: 3, library: [], events: [], statuses: [], runs: [], anchors: anchors.extract(workdir), links: [], steps: [], previous_task: [] })
  const executor = new StubExecutor({ messages })
  const record = await acceptRound(workdir, w, renderWorkOrder(w), executor, {
    registry, library: [], events: [], facts: codeFacts(registry, 3), guards: o.guards, guardEvents: o.guards.map(g => passing(g.id, g.round)),
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

describe("batch 1, item 11: a flip is classified before any revert; only a regression on unchanged text reverts", () => {
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

  it("a repair that breaks the sort (unchanged text, a stated value): reverted; the filter item it was sent for goes out once more, with word of the revert", async () => {
    const sort = recorded.registry().coverOf(SORT_UNIT)!.owner
    const reviewer = workingReviewer(join(dir, "rb-revert"))
    const { record, executor } = await round3(dir, recorded, [
      wd => write(wd, program({ stddev: "sample", filterWrong: true })),
      wd => write(wd, program({ stddev: "sample", sortText: true })),
      wd => write(wd, program({ stddev: "sample" })),
    ], { guards: [sortGuard(sort)], reviewer })
    const a = record.accept!
    assert.equal(a.reverted, 1)
    const reverted = record.cycles.find(c => c.reverted)!
    assert.deepEqual(reverted.reverted!.guards, ["G1"])
    assert.ok(reverted.reverted!.resent!.some(id => id.startsWith("V3.")), JSON.stringify(reverted.reverted))
    // The message after the revert carries the note and the same item again; the third program fixes it.
    const after = executor.log.messages[2].text
    assert.match(after, /reverted by the controller: it made G1 fail/u)
    assert.match(after, /What it was meant to fix is listed above again\./u)
    assert.match(after, /Keep rows where the column satisfies the condition/u)
    assert.ok(!record.cycles.flatMap(c => c.items ?? []).some(i => i.action === "discarded"), "nothing is discarded")
    const ledger = ledgerOf({ ...recorded.inspect(), executions: [record] }, recorded.registry())
    assert.ok(!ledger.some(e => e.end?.how === "discarded"))
  })

  it("batch 1b (§6b rule 1): a guard whose value is worked out (derived) flips on unchanged text: a regression; the repair is reverted; the flip's sources are none", async () => {
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
    assert.equal(a.reverted, 1)
    assert.deepEqual(record.cycles.find(c => c.reverted)!.reverted!.guards, ["G1"])
    assert.deepEqual(a.guards.flips!.map(f => [f.id, f.cycle, f.how, f.sources, f.expected]), [["G1", "C3.2", "regression", [], ["derived", "verbatim"]]])
    assert.equal(record.kept, "C3.3", "the third program fixes the filter and keeps the sort")
    assert.match(executor.log.messages[2].text, /reverted by the controller: it made G1 fail/u)
    assert.ok(!reviewer.requests.some(r => /# Leads to verify[^]*- G1: /u.test(r.request)), "no lead: it is the executor's")
  })
})

describe("batch 1, items 6, 9 (§6a step 3): the round's package, not every round's text", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-b1-delta-"))
  const store = new Exp2Store(join(dir, "store"), "b1d")
  before(async () => { for (const r of [1, 2, 3]) await store.ingestRound(r, roundText(r), stubTransport()) })

  it("a block's text in force: the replaced sentence leaves, its replacement is named; R1's package is R1", () => {
    const reg = store.registry()
    const p5 = reg.coverOf(ZSCORE_UNIT)!.block
    const now = effectiveText(reg, p5, 3)!
    assert.ok(!now.includes(reg.block(ZSCORE_UNIT)!.text.trim()), "the population sentence is gone")
    assert.match(now, /⟦R2\.S11\.P5\.s3 replaced by R3\.S3\.P1, R3\.S3\.P2⟧/u)
    assert.equal(effectiveText(reg, p5, 2), reg.block(p5)!.text, "in round 2 it stood as written")
    const r1 = roundPackage(reg, 1)
    assert.ok(r1.every(b => b.round === 1 && b.why === "this round"))
    assert.deepEqual(packageSources(reg, 1, r1), [{ round: 1, text: reg.sources.get(1)!.text }])
  })

  it("R2 and R3: this round's text, the changed objects' earlier text in force, related objects, open items' blocks; nothing else", () => {
    const reg = store.registry()
    for (const r of [2, 3]) {
      const changed = new Set(reg.roundScope(r).map(c => c.object))
      const pkg = roundPackage(reg, r, [FILTER_UNIT])
      for (const b of pkg.filter(x => x.round < r)) {
        if (b.why === "object changed") assert.ok(changed.has(b.object!), `${b.id}`)
        else if (b.why === "related") assert.ok(reg.references.some(e => e.round <= r && [e.from, e.to].some(x => (/^O\d+$/u.test(x) ? x : reg.coverOf(x)?.owner) === b.object)), `${b.id} related`)
        else assert.equal(b.why, "open item")
      }
      assert.ok(pkg.some(b => b.id === reg.coverOf(FILTER_UNIT)!.block && (b.why === "open item" || b.why === "object changed")), "the open item's block")
      // Every block of this round is in it.
      assert.deepEqual(pkg.filter(b => b.round === r).map(b => b.id), reg.sources.get(r)!.blocks.filter(b => reg.assigned.has(b.id)).map(b => b.id))
      const delta = buildWorkOrder({ registry: reg, round: r, library: [], events: [], statuses: [], runs: [], anchors: [], links: [], steps: [], previous_task: [], scope: "delta", confirmed: [{ id: "V1.1.1", object: null, units: [FILTER_UNIT], args: [], files: [] }] })
      assert.ok(delta.scope!.source_chars < delta.scope!.source_chars_all * 0.75, `R${r}: delta ${delta.scope!.source_chars} vs all ${delta.scope!.source_chars_all}`)
      assert.deepEqual(delta.status, [], "no status zone")
    }
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
    const sizes = (st: typeof delta) => st.reports.map(r => ({ round: r.round, chars: r.zones.source_chars!, all: r.zones.source_chars_all!, review: r.review!.request_chars! }))
    const d = sizes(delta), a = sizes(all)
    console.log(JSON.stringify({ delta: d, all: a }))
    assert.equal(d[0].chars, a[0].chars, "R1: the package is R1")
    for (const k of [1, 2]) {
      assert.ok(d[k].chars < a[k].chars * 0.75, `R${k + 1} work order: delta ${d[k].chars}, all ${a[k].chars}`)
      assert.equal(a[k].chars, a[k].all)
      assert.ok(d[k].review < a[k].review, `R${k + 1} review requests: delta ${d[k].review}, full ${a[k].review}`)
    }
    // The report says so, in its interface counts.
    assert.match(renderReport(delta.reports[2]), /- Requirements given: work order source zone delta, \d+ characters in \d+ blocks \(every round's text: \d+ in \d+\); review requests \d+ characters/u)
  })
})

describe("batch 1, item 7: a call the program refused goes back to the check's writer", () => {
  it("refused last round: stale this round, with what the program answered; the writer's request lists it", async () => {
    const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b1-ref-")), "b1ref")
    for (const r of [1, 2]) await store.ingestRound(r, roundText(r), stubTransport())
    const s = store.inspect()
    const k: CheckRecord = { id: "K1", round: 1, key: "k", object: store.registry().coverOf(FILTER_UNIT)!.owner, blocks: [FILTER_UNIT], uses: [], direction: "holds", input: { args: ["dpipe", "transform"], files: [] }, assertions: [], unknown: [], reference_script: null, admission: "admitted", admission_reason: null, strength: null, status: "active", calls: [] }
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
