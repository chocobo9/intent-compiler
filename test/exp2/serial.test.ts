import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { QuotaExhausted, type AttributionTransport } from "../../src/exp2/attribution.js"
import { goBuilder } from "../../src/exp2/build.js"
import { DEFAULT_LIMITS } from "../../src/exp2/execution.js"
import { git } from "../../src/exp2/git.js"
import type { RoundReport } from "../../src/exp2/report.js"
import { LocalProcessRunner, LocalScriptSandbox } from "../../src/exp2/runner.js"
import { Serial, type SerialOutcome } from "../../src/exp2/serial.js"
import { Exp2Store, type Exp2State } from "../../src/exp2/store.js"
import { checkStubTransport } from "./check-stubs.js"
import { ROUNDS, roundText } from "./inputs.js"
import { ProcessCrash, serialExecutor, type Injection } from "./serial-executor.js"
import { SCRIPTS, stubTransport } from "./stubs.js"
import { standInReview } from "./review-stubs.js"

// Fixed commit dates: the same work gives the same commits, so two runs can be compared commit for commit.
process.env.GIT_AUTHOR_DATE = "2026-10-20T00:00:00Z"
process.env.GIT_COMMITTER_DATE = "2026-10-20T00:00:00Z"

interface Faults {
  attribution?: { round: number; kind: "quota" | "hang" }[]
  coding?: Injection[]
}

function serialIn(dir: string, faults: Faults = {}, fired = new Set<string>()) {
  const store = new Exp2Store(join(dir, "store"), "e2e")
  const attribution = stubTransport()
  const checks = checkStubTransport()
  const once = (key: string) => fired.has(key) ? false : (fired.add(key), true)
  const faultyAttribution: AttributionTransport = async request => {
    const f = faults.attribution?.find(x => x.round === request.round)
    if (f && once(`a${f.round}`)) {
      if (f.kind === "quota") throw new QuotaExhausted(`quota at R${f.round} attribution`)
      return new Promise<never>(() => {})
    }
    return attribution(request)
  }
  const serial = new Serial({
    ...standInReview(dir), store, workdir: join(dir, "work"), checkpoints: join(dir, "checkpoints"), text: roundText,
    attribution: faultyAttribution, checks, executor: serialExecutor(faults.coding ?? [], fired), executorIsStub: true,
    anchors: new GoAnchorExtractor(), runner: new LocalProcessRunner(), sandbox: new LocalScriptSandbox(), build: goBuilder(join(dir, "builds")),
    limits: { attributionRepairs: 2, checkRepairs: 2, managementTimeoutMs: 1500, checkTimeoutMs: 10_000, execution: { ...DEFAULT_LIMITS, repairCycles: 1, callTimeoutMs: 1500 } },
  })
  return { serial, store }
}

const reports = (dir: string, round: number): RoundReport => JSON.parse(readFileSync(join(dir, "checkpoints", `round-${String(round).padStart(2, "0")}`, "report.json"), "utf8")) as RoundReport
const meta = (dir: string, round: number) => JSON.parse(readFileSync(join(dir, "checkpoints", `round-${String(round).padStart(2, "0")}`, "meta.json"), "utf8")) as { head: string }
const tree = (dir: string, commit: string) => git(join(dir, "work"), ["rev-parse", `${commit}^{tree}`]).trim()
/** The state without what only an interrupted run has (its reports count the interrupted attempts), and wall times. */
// Time, and the measures' tokens and cost, count the interrupted attempts too (§12i): they differ by design. The
// stand-in reviewer numbers its sessions per process, so the resumed process starts again at 1.
const comparable = (state: Exp2State) => ({ ...state, review_calls: state.review_calls.map(r => ({ ...r, session: null })), reports: state.reports.map(r => ({ ...r, interrupted: null, wall: null, ...(r.measures ? { measures: { ...r.measures, wall_ms: null, stages_ms: null, tokens: null, non_executor_cost: null } } : {}) })) })

describe("exp2 block 5: the serial R1–R15 with stand-in model and executor", () => {
  const a = mkdtempSync(join(tmpdir(), "exp2-serial-a-"))
  const b = mkdtempSync(join(tmpdir(), "exp2-serial-b-"))
  const c = mkdtempSync(join(tmpdir(), "exp2-serial-c-"))
  let runA: SerialOutcome
  let stateA: Exp2State

  before(async () => {
    const { serial, store } = serialIn(a)
    runA = await serial.run({ to: 15 })
    stateA = store.inspect()
  })

  it("runs all fifteen rounds: each has a work order, an execution record, check results, statuses and a report", () => {
    assert.deepEqual(runA, { status: "done", last_checkpoint: 15, resumes: 0 })
    assert.deepEqual(stateA.reports.map(r => r.round), ROUNDS)
    assert.deepEqual(stateA.executions.map(e => e.round), ROUNDS)
    for (const round of ROUNDS) {
      const r = reports(a, round)
      assert.equal(r.official_score, null, "scored locally only")
      assert.ok(r.zones.task > 0 && r.zones.source_blocks > 0, `R${round} work order`)
      assert.ok(stateA.check_runs.some(x => x.round === round && x.verdict), `R${round} verdict run`)
      assert.equal(r.objects.length, [...new Set(stateA.rounds.filter(x => x.status === "accepted" && x.round <= round).flatMap(x => x.acceptance!.allocated.map(o => o.id)))].length)
      assert.ok(existsSync(join(a, "checkpoints", `round-${String(round).padStart(2, "0")}`, "report.md")))
    }
  })

  it("every call is recorded with its tokens, and every stand-in call is marked as one", () => {
    for (const c of [...stateA.calls, ...stateA.check_calls]) assert.ok(c.stub, `${c.id} marked as stand-in`)
    for (const r of stateA.reports) {
      for (const s of [r.stages.understand, r.stages.acceptance, r.stages.coding]) assert.equal(s.stub_calls, s.calls)
      assert.equal(r.stages.understand.calls, stateA.calls.filter(c => c.round === r.round).length)
      assert.equal(r.stages.acceptance.calls, stateA.check_calls.filter(c => c.round === r.round).length)
      assert.ok(r.stages.coding.calls > 0)
    }
  })

  it("objects land where the stand-in wrote real code, and the rest is attributed", () => {
    const status = (round: number, name: string) => reports(a, round).objects.find(o => o.name === name)!.status
    assert.equal(status(1, "filter"), "landed")
    assert.equal(status(1, "verify"), "landed")
    assert.equal(status(2, "normalize"), "landed")
    assert.equal(status(3, "normalize"), "landed", "the stand-in switches to the sample stddev in R3")
    assert.equal(status(5, "transform"), "landed", "the withdrawn sidecar is gone")
    // profile and reconcile are only stubbed: not landed, and the work order was right, so the executor's.
    assert.equal(status(2, "profile"), "not_landed")
    assert.ok(reports(a, 2).loss.executor.includes(stateA.reports[1].objects.find(o => o.name === "profile")!.object))
    assert.equal(status(10, "reconcile"), "not_landed")
    // Objects with no checks are the acknowledged boundary.
    assert.ok(reports(a, 1).loss.boundary.length > 0)
  })

  it("interrupted by spent quotas and a crash, the serial resumes from its checkpoints and ends where the uninterrupted one does", async () => {
    const fired = new Set<string>()
    // The coding quota hits a repair message: R1's (the reviewer reports the stand-in's text sort; later rounds carry
    // it in the work order and, with no progress, hold it, so they end after the work message).
    const faults: Faults = { attribution: [{ round: 6, kind: "quota" }], coding: [{ round: 1, message: 2, action: "quota" }, { round: 12, message: 1, action: "crash" }] }
    const waits: number[] = []
    const first = serialIn(b, faults, fired)
    await assert.rejects(first.serial.run({ to: 15, wait: async ms => { waits.push(ms) } }), ProcessCrash)
    assert.deepEqual(waits, [30 * 60_000, 30 * 60_000], "two quota stops, each waited out before resuming")
    // A new process: it finds the state ahead of the R11 checkpoint, keeps what the crashed attempt spent, and resumes.
    const second = serialIn(b, faults, fired)
    const outcome = await second.serial.run({ to: 15, wait: async () => {} })
    assert.deepEqual(outcome, { status: "done", last_checkpoint: 15, resumes: 0 })
    const stateB = second.store.inspect()
    assert.deepEqual(comparable(stateB), comparable(stateA))
    for (const round of ROUNDS) assert.equal(meta(b, round).head, meta(a, round).head, `R${round} checkpoint commit`)
    // What the interrupted attempts spent is kept and counted in their rounds' reports.
    const r6 = second.serial.interruptedAttempts(6), r1 = second.serial.interruptedAttempts(1), r12 = second.serial.interruptedAttempts(12)
    assert.match(r6[0].reason, /^quota/u)
    assert.equal(r6[0].calls.length, 1)
    assert.match(r1[0].reason, /^quota/u)
    assert.ok(r1[0].execution !== null, "the coding progress of the stopped attempt")
    assert.match(r12[0].reason, /unclean stop/u)
    assert.ok(r12[0].calls.length > 0)
    assert.equal(stateB.reports.find(r => r.round === 6)!.interrupted.attempts, 1)
    assert.equal(stateB.reports.find(r => r.round === 6)!.interrupted.stages.understand.calls, 1)
    assert.equal(stateB.reports.find(r => r.round === 12)!.interrupted.attempts, 1)
  })

  it("attribution that cannot pass within its repair limit stops the whole serial, with a report of why", async () => {
    const d = mkdtempSync(join(tmpdir(), "exp2-serial-stop-"))
    const { serial, store } = serialIn(d)
    // Swap in a model that never covers R2's profile section.
    const inner = stubTransport({ ...SCRIPTS, 2: [() => ({ upsert: [], remove: [], edges_add: [], edges_remove: [], interpretations_add: [] })] })
    ;(serial as unknown as { c: { attribution: AttributionTransport } }).c.attribution = inner
    const outcome = await serial.run({ to: 15 })
    assert.deepEqual([outcome.status, outcome.last_checkpoint, outcome.stopped!.round], ["stopped", 1, 2], outcome.stopped!.reason)
    const stop = JSON.parse(readFileSync(join(d, "checkpoints", "stopped-round-02.json"), "utf8")) as { reason: string; issues: { code: string }[] }
    assert.match(stop.reason, /attribution did not pass/u)
    assert.ok(stop.issues.some(i => i.code === "uncovered"))
    assert.equal(store.inspect().calls.filter(c => c.round === 2).length, 3, "the first answer and two repairs, all recorded")
  })

  it("hung calls and broken sessions recover inside the round, with the same result as without them", async () => {
    const faults: Faults = {
      attribution: [{ round: 2, kind: "hang" }],
      coding: [{ round: 1, message: 1, action: "hang" }, { round: 3, message: 1, action: "break" }],
    }
    const { serial, store } = serialIn(c, faults)
    assert.equal((await serial.run({ to: 3 })).status, "done")
    const stateC = store.inspect()
    for (const round of [1, 2, 3]) {
      assert.equal(tree(c, meta(c, round).head), tree(a, meta(a, round).head), `R${round} code`)
      assert.deepEqual(reports(c, round).objects, reports(a, round).objects, `R${round} statuses`)
    }
    // The same checks; only the ids of the calls behind them shift by the extra (stopped) call.
    const noCalls = (k: Exp2State["checks"][number]) => ({ ...k, calls: [] })
    assert.deepEqual(stateC.checks.map(noCalls), stateA.checks.filter(k => k.round <= 3).map(noCalls))
    // The watchdog stopped the hung management call; it used up one attempt and is on record.
    const r2 = stateC.calls.filter(x => x.round === 2)
    assert.match(r2[0].error!, /watchdog: no answer in 1500 ms/u)
    assert.equal(r2.length, stateA.calls.filter(x => x.round === 2).length + 1)
    assert.equal(reports(c, 1).execution.broken_sessions, 1)
    assert.equal(reports(c, 3).execution.broken_sessions, 1)
  })
})
