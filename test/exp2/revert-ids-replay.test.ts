import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { acceptRound } from "../../src/exp2/accept.js"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { goBuilder } from "../../src/exp2/build.js"
import { codeFacts, type CheckEvent, type CheckRecord } from "../../src/exp2/checks.js"
import { DEFAULT_LIMITS } from "../../src/exp2/execution.js"
import { initRepo } from "../../src/exp2/git.js"
import type { GuardEvent, GuardRecord } from "../../src/exp2/guards.js"
import { LocalProcessRunner, LocalScriptSandbox } from "../../src/exp2/runner.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { buildWorkOrder, renderWorkOrder } from "../../src/exp2/workorder.js"
import { replayedFormalizer, scripted } from "./replay-fixtures.js"
import { StubExecutor, write } from "./stub-executor.js"

/**
 * rep1h R4 (code 1c), which stopped with "guard G100 is out of sequence (next is G90)": C4.1 gave G86–G89; C4.2 and
 * C4.3 were reverted, and the guards born on them took ids the store never got. Here the same state (R1–R4
 * attribution, the checks, the guards of R1–R3), the real reviews and formalizer replies of R4 and the four real
 * programs go through the current acceptance, the guards recorded by the store as in the run. Since batch 1 of
 * DESIGN-OPUS no repair is reverted: the repairs that broke guards are kept, their regressions sent as items.
 */

const FIX = resolve(process.cwd(), "exp2/evidence/replay-2026-10-23/revert-ids-rep1h-r4")
interface Fixture {
  run_id: string; profile: string; sources: unknown[]; rounds: unknown[]; checks: CheckRecord[]; check_events: CheckEvent[]; guards: GuardRecord[]; guard_events: GuardEvent[]
  crashed: { guards_r4: string[] }
  review_calls: { response_text: string; program_runs: number }[]
  formalize_calls: { response_text: string }[]
  cycles: { id: string; commit: string }[]
}
const fx = JSON.parse(readFileSync(join(FIX, "state.json"), "utf8")) as Fixture
const tree = (cycle: string) => ({ "go.mod": readFileSync(join(FIX, "programs", `${cycle}.go.mod`), "utf8"), "main.go": readFileSync(join(FIX, "programs", `${cycle}.main.go`), "utf8") })

describe("rep1h R4 replayed (the crashed state): guard ids stay in sequence", () => {
  it("the round runs to its end; no cycle is reverted; every guard the store records is the next id", { timeout: 900_000 }, async () => {
    assert.deepEqual(fx.crashed.guards_r4, ["G86", "G87", "G88", "G89"], "the crashed run recorded G86–G89 at C4.1")
    assert.equal(fx.guards.at(-1)!.id, "G85")
    const dir = mkdtempSync(join(tmpdir(), "exp2-r4-ids-"))
    const store = new Exp2Store(join(dir, "state"), fx.run_id)
    writeFileSync(join(dir, "state", "exp2-state.json"), JSON.stringify({ profile: fx.profile, run_id: fx.run_id, sources: fx.sources, rounds: fx.rounds, calls: [], signals: [], checks: fx.checks, check_events: fx.check_events, guards: fx.guards, guard_events: fx.guard_events }))
    const registry = store.registry()
    const workdir = join(dir, "work")
    mkdirSync(workdir, { recursive: true })
    initRepo(workdir)
    const anchors = new GoAnchorExtractor()
    const w = buildWorkOrder({ registry, round: 4, library: fx.checks, events: fx.check_events, statuses: [], runs: [], anchors: anchors.extract(workdir), links: [], steps: [], previous_task: [] })
    const executor = new StubExecutor({ messages: fx.cycles.map(c => (wd: string) => write(wd, tree(c.id))) })
    const reviewer = scripted(fx.review_calls.map(r => ({ text: r.response_text, runs: Array.from({ length: Math.max(1, r.program_runs) }, () => ({ command: "./dpipe transform", exit_code: 0 })) })))
    const record = await acceptRound(workdir, w, renderWorkOrder(w), executor, {
      registry, library: fx.checks, events: fx.check_events, facts: codeFacts(registry, 4), guards: fx.guards, guardEvents: fx.guard_events,
      runner: new LocalProcessRunner(), sandbox: new LocalScriptSandbox(), anchors, build: goBuilder(join(dir, "builds"), {}, "dpipe"),
      reviewer, formalize: replayedFormalizer(fx.formalize_calls.map(f => f.response_text)), binary: "dpipe",
      sources: store.inspect().sources.map(s => ({ round: s.round, text: s.text })), copyDir: label => join(dir, "copies", label),
      // The store's writers, as in the run: recordGuards is where the run stopped.
      record: { review: async () => {}, formalize: async () => {}, guards: (b, e) => store.recordGuards(b, e) }, checkTimeoutMs: 30_000,
    }, { ...DEFAULT_LIMITS, repairCycles: 3 })
    const cycles = record.cycles.map(c => ({ id: c.id, reverted: !!c.reverted, born: c.guards?.born ?? [] }))
    console.log(JSON.stringify({ cycles, born: record.accept!.guards.born, reverted: record.accept!.reverted }))
    const ids = store.inspect().guards.map(g => Number(g.id.slice(1)))
    assert.deepEqual(ids, ids.map((_, i) => i + 1), "the store's guards are G1, G2, … with no gap")
    assert.ok(cycles.every(c => !c.reverted), "no repair is reverted")
    assert.equal(record.accept!.reverted, 0)
    assert.deepEqual(record.accept!.guards.born, cycles.flatMap(c => c.born), "every guard born is recorded once, in order")
    assert.equal(record.accept!.guards.born[0], "G86", "the first born follows G85")
  })
})
