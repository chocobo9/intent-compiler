import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { acceptRound } from "../../src/exp2/accept.js"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { goBuilder } from "../../src/exp2/build.js"
import { codeFacts, type CheckEvent, type CheckRecord } from "../../src/exp2/checks.js"
import { DEFAULT_LIMITS } from "../../src/exp2/execution.js"
import { initRepo } from "../../src/exp2/git.js"
import { changedTextBehind, runGuards, type GuardEvent, type GuardRecord } from "../../src/exp2/guards.js"
import type { Registry } from "../../src/exp2/registry.js"
import { LocalProcessRunner, LocalScriptSandbox } from "../../src/exp2/runner.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { buildWorkOrder, renderWorkOrder } from "../../src/exp2/workorder.js"
import { replayedFormalizer, scripted } from "./replay-fixtures.js"
import { StubExecutor, write } from "./stub-executor.js"

/**
 * DESIGN §12j.7 item 11 on the real case (BLOCK-ACCEPT-NOTES §22.8 step 3): the 15-round run on fe6562d (all scope),
 * R3. G77 was born in R2 from a reviewer item (normalize zscore by the population stddev); R3's text revises it to the
 * sample stddev (attribution: R3.S3 partial over R2.S11.P5, P6). On fe6562d the three repairs of R3 flipped G77 and
 * each was reverted. Here the same registry, guards, checks, real reviewer and formalizer replies and the four real
 * programs (C3.1 work, C3.2–C3.4 repairs) go through the current acceptance.
 */

const FIX = resolve(process.cwd(), "exp2/evidence/replay-2026-10-23/g77-ic15-r3")
interface Fixture {
  run_id: string; profile: string; sources: unknown[]; rounds: unknown[]; checks: CheckRecord[]; check_events: CheckEvent[]; guards: GuardRecord[]; guard_events: GuardEvent[]
  review_calls: { id: string; review: number; response_text: string; program_runs: number }[]
  formalize_calls: { id: string; review: string; attempt: number; response_text: string }[]
  real_r3: { cycles: { id: string; commit: string; reverted: { guards: string[]; discarded: string[] } | null }[] }
}
const fx = JSON.parse(readFileSync(join(FIX, "state.json"), "utf8")) as Fixture
const CYCLES = ["C3.1", "C3.2", "C3.3", "C3.4"]
const tree = (cycle: string) => ({ "go.mod": readFileSync(join(FIX, "programs", `${cycle}.go.mod`), "utf8"), "main.go": readFileSync(join(FIX, "programs", `${cycle}.main.go`), "utf8") })
const g77 = fx.guards.find(g => g.id === "G77")!
/** The last status each guard had at the end of R2. */
const lastEvents = () => [...new Map(fx.guard_events.map(e => [e.guard, e])).values()]

describe("G77 replayed (ic15 R3, real state and programs): the flip is classified before any revert", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-g77-"))
  let store: Exp2Store, registry: Registry
  before(() => {
    store = new Exp2Store(join(dir, "state"), fx.run_id)
    writeFileSync(join(dir, "state", "exp2-state.json"), JSON.stringify({ profile: fx.profile, run_id: fx.run_id, sources: fx.sources, rounds: fx.rounds, calls: [], signals: [], checks: fx.checks, check_events: fx.check_events, guards: fx.guards, guard_events: fx.guard_events }))
    registry = store.registry()
  })

  it("the fixture is the real case: G77 passed at the end of R2; on fe6562d each R3 repair flipped it and was reverted", () => {
    assert.deepEqual(g77.units, ["R2.S11.P1", "R2.S11.P3.s3", "R2.S11.P5.s1", "R2.S11.P6.s4", "R2.S11.P7.s1"])
    assert.equal(lastEvents().find(e => e.guard === "G77")!.status, "passing")
    assert.deepEqual(fx.real_r3.cycles.map(c => c.reverted?.guards ?? null), [null, ["G77"], ["G77"], ["G77"]])
  })

  it("R3's text stands behind G77: the attribution's revision of R2.S11.P5, P6 and the change of its object", () => {
    const behind = changedTextBehind(registry, g77, fx.checks, 3, g77.check)
    assert.ok(behind.some(b => /^R2\.S11\.P5\.s1: .* partly revised by R3\.S3/u.test(b)), behind.join("\n"))
    assert.ok(behind.some(b => b.startsWith(`${g77.object} `)), behind.join("\n"))
  })

  it("on each of the three real repair programs G77 fails; the work program passes it", async () => {
    const runner = new LocalProcessRunner(), build = goBuilder(join(dir, "builds"), {}, "dpipe")
    const outcomes: string[] = []
    for (const cycle of CYCLES) {
      const wd = join(dir, "trees", cycle)
      mkdirSync(wd, { recursive: true })
      write(wd, tree(cycle))
      const b = build(wd, cycle)
      assert.ok(b.ok, b.output)
      const [r] = await runGuards([g77], fx.checks, b.program!, runner, 3, registry, codeFacts(registry, 3), 30_000)
      outcomes.push(r.outcome)
    }
    assert.deepEqual(outcomes, ["pass", "fail", "fail", "fail"])
  })

  it("the round replayed (real reviews and formalizer replies; the executor writes the real programs in order): no revert, G77 goes to the reviewer", { timeout: 900_000 }, async () => {
    const workdir = join(dir, "work")
    mkdirSync(workdir, { recursive: true })
    initRepo(workdir)
    const anchors = new GoAnchorExtractor()
    const w = buildWorkOrder({ registry, round: 3, library: fx.checks, events: fx.check_events, statuses: [], runs: [], anchors: anchors.extract(workdir), links: [], steps: [], previous_task: [] })
    const executor = new StubExecutor({ messages: CYCLES.map(c => (wd: string) => write(wd, tree(c))) })
    const requests: string[] = []
    const replies = scripted(fx.review_calls.map(r => ({ text: r.response_text, runs: Array.from({ length: Math.max(1, r.program_runs) }, () => ({ command: "./dpipe transform", exit_code: 0 })) })))
    const events: GuardEvent[] = []
    const record = await acceptRound(workdir, w, renderWorkOrder(w), executor, {
      registry, library: fx.checks, events: fx.check_events, facts: codeFacts(registry, 3), guards: fx.guards, guardEvents: lastEvents(),
      runner: new LocalProcessRunner(), sandbox: new LocalScriptSandbox(), anchors, build: goBuilder(join(dir, "round-builds"), {}, "dpipe"),
      reviewer: { review: async (d, request, label) => { requests.push(request); return replies.review(d, request, label) } },
      formalize: replayedFormalizer(fx.formalize_calls.map(f => f.response_text)), binary: "dpipe",
      sources: store.inspect().sources.map(s => ({ round: s.round, text: s.text })), copyDir: label => join(dir, "copies", label),
      record: { review: async () => {}, formalize: async () => {}, guards: async (_b, e) => { events.push(...e) } }, checkTimeoutMs: 30_000,
    }, { ...DEFAULT_LIMITS, repairCycles: 3 })
    const a = record.accept!
    const g77Flip = events.find(e => e.guard === "G77" && e.status === "failing")
    console.log(JSON.stringify({ cycles: record.cycles.map(c => ({ id: c.id, message: c.message, reverted: c.reverted ?? null, flipped: c.guards?.flipped })), reverted: a.reverted, flipped_changed_text: a.guards.flipped_changed_text, flipped_unchanged: a.guards.flipped_unchanged, flipped_disputed: a.guards.flipped_disputed ?? [], retired: a.guards.retired, kept: record.kept, g77: g77Flip ?? null }, null, 1))
    assert.equal(a.reverted, 0, "no repair is reverted")
    assert.ok(record.cycles.every(c => !c.reverted))
    assert.ok(a.guards.flipped_changed_text.includes("G77"), JSON.stringify(a.guards))
    assert.ok(!a.guards.flipped_unchanged.includes("G77"))
    assert.ok(g77Flip?.changed_text?.length, JSON.stringify(g77Flip))
    assert.ok(!executor.log.messages.some(m => /reverted by the controller/u.test(m.text)))
    assert.ok(requests.slice(1).some(r => /G77: command \["transform"/u.test(r)), "the reviewer is asked about G77")
    // The round keeps the last repair, not the work program.
    assert.equal(record.kept, record.cycles.at(-1)!.id)
  })
})
