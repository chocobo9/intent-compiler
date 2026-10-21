import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { goBuilder } from "../../src/exp2/build.js"
import { DEFAULT_LIMITS } from "../../src/exp2/execution.js"
import { LocalProcessRunner, LocalScriptSandbox } from "../../src/exp2/runner.js"
import { Serial } from "../../src/exp2/serial.js"
import { splitRound, tilingProblems } from "../../src/exp2/source.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { buildWorkOrder } from "../../src/exp2/workorder.js"
import { roundText } from "./inputs.js"
import { serialExecutor } from "./serial-executor.js"
import { stubTransport } from "./stubs.js"

describe("exp2 ablation switches (inputs and paths only)", () => {
  it("clauses off: sentences and items are the finest units, the tiling still exact; a store keeps its setting", async () => {
    const off = splitRound(3, roundText(3), { clauses: false })
    const on = splitRound(3, roundText(3))
    assert.ok(on.blocks.some(b => b.level === "clause"))
    assert.ok(!off.blocks.some(b => b.level === "clause"))
    assert.deepEqual(tilingProblems(off), [])
    assert.deepEqual(off.blocks.filter(b => b.level !== "clause").map(b => b.id), on.blocks.filter(b => b.level !== "clause").map(b => b.id), "the other ids do not move")
    const dir = mkdtempSync(join(tmpdir(), "exp2-abl-"))
    const store = new Exp2Store(dir, "abl", { clauses: false })
    assert.equal((await store.ingestRound(1, roundText(1), stubTransport())).status, "accepted")
    assert.ok(![...store.registry().blocks.keys()].some(id => /\.c\d+$/u.test(id)))
    assert.throws(() => new Exp2Store(dir, "abl").inspect(), /ablation mismatch/u)
    assert.throws(() => new Exp2Store(dir, "abl", { clauses: false, zoning: false }).inspect(), /ablation mismatch/u)
    assert.deepEqual(new Exp2Store(dir, "abl", { clauses: false, zoning: true }).inspect().ablation, { clauses: false }, "a switch left on is the same as not given")
  })

  it("zoning off: every live object is in the task zone; nothing is protection or status", async () => {
    const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-abl-")), "abl")
    for (const round of [1, 2]) await store.ingestRound(round, roundText(round), stubTransport())
    const registry = store.registry()
    const input = { registry, round: 2, library: [], events: [], statuses: [...registry.objects.keys()].map(object => ({ object, status: "landed" as const, reasons: [], passing_strong: [], not_landed: [], unknown: [] })), runs: [], anchors: [], links: [], steps: [], previous_task: [] }
    const zoned = buildWorkOrder(input)
    const flat = buildWorkOrder({ ...input, zoning: false })
    assert.ok(zoned.task.length < registry.objects.size)
    assert.deepEqual(flat.task.map(t => t.object).sort(), [...registry.objects.keys()].sort())
    assert.deepEqual([flat.protect, flat.status], [[], []])
    assert.deepEqual(flat.source, zoned.source, "the source zone is the same")
  })

  it("check library off: no checks derived, no check calls, every status unknown", async () => {
    process.env.GIT_AUTHOR_DATE = process.env.GIT_COMMITTER_DATE = "2026-10-20T00:00:00Z"
    const dir = mkdtempSync(join(tmpdir(), "exp2-abl-"))
    const store = new Exp2Store(join(dir, "store"), "abl", { checks: false })
    const serial = new Serial({
      store, workdir: join(dir, "work"), checkpoints: join(dir, "checkpoints"), text: roundText, attribution: stubTransport(), checks: async () => assert.fail("no check derivation with the library off"),
      executor: serialExecutor(), executorIsStub: true, anchors: new GoAnchorExtractor(), runner: new LocalProcessRunner(), sandbox: new LocalScriptSandbox(), build: goBuilder(join(dir, "builds")),
      limits: { attributionRepairs: 2, checkRepairs: 2, managementTimeoutMs: 5000, checkTimeoutMs: 10_000, execution: { ...DEFAULT_LIMITS, maxAttemptsPerStep: 2 } },
    })
    assert.equal((await serial.run({ to: 1 })).status, "done")
    const s = store.inspect()
    assert.deepEqual([s.checks.length, s.check_calls.length], [0, 0])
    assert.ok(s.reports[0].objects.every(o => o.status === "unknown"))
    assert.deepEqual(s.ablation, { checks: false }, "the switch is in the state")
    assert.throws(() => new Exp2Store(join(dir, "store"), "abl").inspect(), /ablation mismatch/u)
  })
})
