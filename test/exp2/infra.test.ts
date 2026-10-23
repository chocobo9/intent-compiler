import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { goBuilder } from "../../src/exp2/build.js"
import { DEFAULT_LIMITS } from "../../src/exp2/execution.js"
import { LocalWriteFailed } from "../../src/exp2/platform.js"
import { emptyCassette, recordingTransports, saveCassette } from "../../src/exp2/recording.js"
import { LocalProcessRunner, LocalScriptSandbox } from "../../src/exp2/runner.js"
import { Serial, type SerialConfig } from "../../src/exp2/serial.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { checkStubTransport } from "./check-stubs.js"
import { roundText } from "./inputs.js"
import { standInReview } from "./review-stubs.js"
import { serialExecutor } from "./serial-executor.js"
import { stubTransport } from "./stubs.js"

/**
 * BLOCK10 §7.2: a run whose role calls fail for a reason outside the model's answer, or that cannot write where it
 * must, stops with the cause named; it never reads as a normal result. (Since §12j.4 the roles are the check writer,
 * the reviewer and the formalizer; the probe writer and the judge are out of the round's path.)
 */
function serialIn(dir: string, over: Partial<SerialConfig>, ablation: { checks?: boolean } = {}) {
  const store = new Exp2Store(join(dir, "store"), "infra", ablation)
  const serial = new Serial({
    ...standInReview(dir), store, workdir: join(dir, "work"), checkpoints: join(dir, "checkpoints"), text: roundText, attribution: stubTransport(), checks: checkStubTransport(),
    executor: serialExecutor(), executorIsStub: true, anchors: new GoAnchorExtractor(), runner: new LocalProcessRunner(), sandbox: new LocalScriptSandbox(), build: goBuilder(join(dir, "builds"), {}, "dpipe"), binary: "dpipe",
    limits: { attributionRepairs: 2, checkRepairs: 2, managementTimeoutMs: 5000, checkTimeoutMs: 10_000, execution: { ...DEFAULT_LIMITS, repairCycles: 0 } },
    ...over,
  })
  return { serial, store }
}

const refused = async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:1") }

describe("exp2 block 10b: infrastructure failures stop the run with their cause", () => {
  it("every check-writer call errors: the round stops as unavailable, the calls are kept, no report is written", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-infra-"))
    const { serial, store } = serialIn(dir, { checks: refused })
    const out = await serial.run({ to: 1, wait: async () => assert.fail("not waited out") })
    assert.deepEqual([out.status, out.last_checkpoint, out.stopped?.round], ["stopped", 0, 1])
    assert.match(out.stopped!.reason, /^unavailable: checks, round 1: [3-9] check calls failed; last: connect ECONNREFUSED/u)
    const stop = JSON.parse(readFileSync(join(dir, "checkpoints", "stopped-round-01.json"), "utf8")) as { reason: string }
    assert.equal(stop.reason, out.stopped!.reason)
    assert.equal(store.inspect().reports.length, 0)
    // The failed calls are on record with the attempt (the checkpoint itself is restored without them).
    const attempt = serial.interruptedAttempts(1)[0]
    assert.ok(attempt.check_calls.length >= 3)
    assert.ok(attempt.check_calls.every(c => /ECONNREFUSED/u.test(c.error ?? "")))
  })

  it("every formalizer call errors with the fallback off: the round stops as unavailable, not with every item blocked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-infra-"))
    let n = 0
    const { serial, store } = serialIn(dir, { formalize: async () => { n++; throw new Error("socket hang up") }, acceptance: { fallback: "off" }, limits: { attributionRepairs: 2, checkRepairs: 2, managementTimeoutMs: 5000, checkTimeoutMs: 10_000, execution: { ...DEFAULT_LIMITS, repairCycles: 1 } } }, { checks: false })
    const out = await serial.run({ to: 1, wait: async () => assert.fail("not waited out") })
    assert.equal(out.status, "stopped")
    assert.match(out.stopped!.reason, /^unavailable: formalize: .*socket hang up/u)
    assert.ok(n >= 3, `${n} calls`)
    assert.equal(store.inspect().reports.length, 0)
  })

  it("a transport failure is retried without using up a repair attempt; a recovered call goes on normally", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-infra-"))
    const writer = checkStubTransport()
    let fails = 2
    const { serial, store } = serialIn(dir, { checks: async r => { if (fails-- > 0) throw new Error("network blip"); return writer(r) } })
    assert.equal((await serial.run({ to: 1 })).status, "done")
    const r1 = store.inspect().check_rounds[0]
    assert.equal(r1.status, "accepted")
    assert.equal(store.inspect().check_calls.filter(c => c.error).length, 2)
    assert.ok(store.inspect().check_calls.filter(c => !c.error).length <= 3, "the failed calls used no repair attempt")
  })

  it("a recording in a directory that does not exist is created; one that cannot be written stops the run as an environment error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-infra-"))
    const nested = join(dir, "no", "such", "dir", "cassette.json")
    saveCassette(nested, emptyCassette("t"))
    assert.ok(existsSync(nested))
    writeFileSync(join(dir, "a-file"), "x")
    assert.throws(() => saveCassette(join(dir, "a-file", "cassette.json"), emptyCassette("t")), (e: Error) => e instanceof LocalWriteFailed && /cannot write the recording at .*a-file/u.test(e.message))
    // In a round: the call is made, the save fails, and the serial stops on it instead of counting the call as failed.
    const rec = recordingTransports({ attribution: stubTransport(), checks: checkStubTransport() }, emptyCassette("t"), join(dir, "a-file", "cassette.json"))
    const { serial } = serialIn(join(dir, "run"), { checks: rec.checks })
    const out = await serial.run({ to: 1, wait: async () => assert.fail("not waited out") })
    assert.equal(out.status, "stopped")
    assert.match(out.stopped!.reason, /^environment: cannot write the recording at /u)
    // A state directory that cannot be made fails at once, naming the path.
    assert.throws(() => new Exp2Store(join(dir, "a-file", "state"), "x"), (e: Error) => e instanceof LocalWriteFailed && /state directory/u.test(e.message))
  })

  it("the replay against a server that refuses connections exits non-zero with the cause, and writes no result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-infra-cli-"))
    const store = new Exp2Store(join(dir, "src-store"), "cli")
    await store.ingestRound(1, roundText(1), stubTransport())
    const example = JSON.parse(readFileSync(resolve("exp2/local-config.example.json"), "utf8"))
    const config = {
      ...example, inputs_dir: resolve("exp2/inputs/dpipe"), state_dir: join(dir, "state"), checkpoints_dir: join(dir, "cp"), repo_dir: join(dir, "app"), builds_dir: join(dir, "builds"),
      management: { ...example.management, server_url: "http://127.0.0.1:1", directory: join(dir, "mgmt") }, coding: { ...example.coding, server_url: "http://127.0.0.1:1", directory: join(dir, "app") },
      runner: { kind: "local" }, rate_limit: { delays_ms: [] }, recording: { cassette: join(dir, "rec", "deep", "cassette.json"), label: "t" },
    }
    writeFileSync(join(dir, "config.json"), JSON.stringify(config))
    writeFileSync(join(dir, "products.tsv"), `p\t1\t${dir}\t\t\n`)
    const cli = resolve(".test-dist/src/cli/exp2-replay.js")
    const r = spawnSync(process.execPath, [cli, "--config", join(dir, "config.json"), "--state", join(dir, "src-store", "exp2-state.json"), "--products", join(dir, "products.tsv"), "--out", join(dir, "out")], { encoding: "utf8" })
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /check derivation: [3-9] check calls failed; last: .*(ECONNREFUSED|fetch failed|connect)/su)
    assert.ok(!existsSync(join(dir, "out", "replay.md")), "no result file")
    assert.ok(existsSync(join(dir, "rec", "deep", "cassette.json")), "the recording's directory was made")
    // An unwritable recording stops it before any call.
    writeFileSync(join(dir, "blocked"), "x")
    writeFileSync(join(dir, "config2.json"), JSON.stringify({ ...config, recording: { cassette: join(dir, "blocked", "c.json"), label: "t" } }))
    const r2 = spawnSync(process.execPath, [cli, "--config", join(dir, "config2.json"), "--state", join(dir, "src-store", "exp2-state.json"), "--products", join(dir, "products.tsv"), "--out", join(dir, "out2")], { encoding: "utf8" })
    assert.notEqual(r2.status, 0)
    assert.match(r2.stderr, /cannot write the recording at .*blocked/u)
  })
})
