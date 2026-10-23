import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { goBuilder, goTrial } from "../../src/exp2/build.js"
import { DockerRunner, DockerScriptSandbox, dockerGoBuilder, dockerGoBuilderAsync, dockerTrial } from "../../src/exp2/docker.js"
import { DEFAULT_LIMITS, type Executor } from "../../src/exp2/execution.js"
import { dockerDown, EnvironmentUnavailable, interpreterMissing } from "../../src/exp2/platform.js"
import { copyProgram } from "../../src/exp2/review.js"
import { LocalProcessRunner, LocalScriptSandbox, type CheckRunner, type ProgramRef } from "../../src/exp2/runner.js"
import { Serial } from "../../src/exp2/serial.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { checkStubTransport } from "./check-stubs.js"
import { roundText } from "./inputs.js"
import { stubFormalizer, workingReviewer } from "./review-stubs.js"
import { serialExecutor } from "./serial-executor.js"
import { stubTransport } from "./stubs.js"

/**
 * Batch 4 (DESIGN §12j.5, CONSOLIDATION-MAP §5): an environment error stops the round and waits; it is never a trial
 * failure sent to the executor, a reference-script failure sent to the check writer, or a guard flipping.
 * Calibrated on rep1f, whose docker client printed this for every build, trial and reference script.
 */
const REP1F = "failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine; check if the path is correct and if the daemon is running: open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.\n"

/** A docker client that answers every call as rep1f's did (or with the given output and exit code). */
function fakeDocker(stderr = REP1F, code = 1): string[] {
  const dir = mkdtempSync(join(tmpdir(), "exp2-fake-docker-"))
  const script = join(dir, "docker.mjs")
  writeFileSync(script, `process.stderr.write(${JSON.stringify(stderr)}); process.exit(${code})\n`)
  return [process.execPath, script]
}

const FILTER_UNIT = "R1.S3.P2.s4", SORT_UNIT = "R1.S3.P9.s2"
const program: ProgramRef = { id: "p", label: "p", command: ["/prog/dpipe"], source_dir: null, mount: { host: tmpdir(), container: "/prog" } }
const input = { args: ["transform"], files: [] }

describe("batch 4: docker unreachable is raised, never an outcome", () => {
  const docker = fakeDocker()
  const o = { docker, image: "sdd-unattended-preflight:latest" }
  const raised = (e: unknown) => e instanceof EnvironmentUnavailable && /the docker daemon cannot be reached: failed to connect to the docker API/u.test((e as Error).message)

  it("rep1f's message, from the build, the trial, the check runs and the reference scripts", async () => {
    const work = mkdtempSync(join(tmpdir(), "exp2-b4-"))
    assert.throws(() => dockerGoBuilder(join(work, "out"), o, 10_000, "dpipe")(work, "C1.1"), raised)
    await assert.rejects(dockerGoBuilderAsync(join(work, "out2"), o, 10_000, "dpipe")(work, "C1.1"), raised)
    await assert.rejects(dockerTrial(o, "dpipe", 10_000)(work, "C1.1"), raised)
    await assert.rejects(new DockerRunner(o).runBatch(program, [input, input], 5_000), raised)
    await assert.rejects(new DockerRunner(o).run(program, input, 5_000), raised)
    await assert.rejects(new DockerScriptSandbox(o).run("python", "print(1)", [], 5_000), raised)
  })

  it("the same condition in other clients' words, and the client not installed", async () => {
    for (const text of ["Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n", "error during connect: This error may indicate that the docker daemon is not running.: Get \"http://%2F%2F.%2Fpipe%2Fdocker_engine/v1.24/containers/json\"\n"]) {
      await assert.rejects(new DockerRunner({ docker: fakeDocker(text), image: "i" }).runBatch(program, [input], 5_000), (e: Error) => e instanceof EnvironmentUnavailable && e.message.includes(text.slice(0, 40)))
    }
    await assert.rejects(new DockerRunner({ docker: ["/nonexistent/bin/docker"], image: "i" }).runBatch(program, [input], 5_000), (e: Error) => e instanceof EnvironmentUnavailable && /docker client cannot be started/u.test(e.message))
  })

  it("a build that fails on its own, a container error from the daemon, a passing run: outcomes as before", async () => {
    const work = mkdtempSync(join(tmpdir(), "exp2-b4-own-"))
    const own = dockerGoBuilder(join(work, "out"), { docker: fakeDocker("./main.go:3:1: syntax error: non-declaration statement outside function body\n"), image: "i" }, 10_000, "dpipe")(work, "C1.1")
    assert.deepEqual([own.ok, /syntax error/u.test(own.output)], [false, true])
    assert.equal(dockerDown(125, "docker: Error response from daemon: No such image: sdd:latest.\n"), null, "the daemon answered: not down")
    assert.equal(dockerDown(0, REP1F), null, "a run that exited 0 is the program's")
    assert.equal(dockerDown(1, "ERROR: unknown command transform\n"), null)
  })
})

describe("batch 4: a missing interpreter is the host's, not the script's", () => {
  it("not on the host (ENOENT), the Windows Store placeholder, not in the image", async () => {
    await assert.rejects(new LocalScriptSandbox({ python: "python-not-installed-ic" }).run("python", "print(1)", [], 5_000), (e: Error) => e instanceof EnvironmentUnavailable && /python-not-installed-ic is missing/u.test(e.message))
    assert.ok(interpreterMissing("python", 9009, "Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut from Settings > Manage App Execution Aliases.\r\n"))
    assert.ok(interpreterMissing("/opt/sdd-python/bin/python3", 127, "docker: Error response from daemon: failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: exec: \"/opt/sdd-python/bin/python3\": stat /opt/sdd-python/bin/python3: no such file or directory: unknown.\n"))
    await assert.rejects(new DockerScriptSandbox({ docker: fakeDocker("exec: \"/opt/sdd-python/bin/python3\": stat /opt/sdd-python/bin/python3: no such file or directory: unknown.\n", 127), image: "i" }).run("python", "print(1)", [], 5_000), EnvironmentUnavailable)
    // The script's own failure stays the script's (it goes back to the check writer as before).
    const own = await new LocalScriptSandbox().run("python", "import sys\nsys.exit('no such file or directory: data.csv')", [], 5_000)
    assert.equal(own.exit_code, 1)
  })
})

describe("batch 4: a review copy that cannot be made", () => {
  it("a clone that fails, a directory that cannot be cleared: raised, naming what", () => {
    const at = mkdtempSync(join(tmpdir(), "exp2-b4-copy-"))
    assert.throws(() => copyProgram(join(at, "not-a-repo"), "abc123", join(at, "copy")), (e: Error) => e instanceof EnvironmentUnavailable && /cannot be cloned/u.test(e.message))
    writeFileSync(join(at, "file"), "x")
    assert.throws(() => copyProgram(at, "abc123", join(at, "file", "copy")), (e: Error) => e instanceof EnvironmentUnavailable && /cannot be made/u.test(e.message))
  })
})

describe("batch 4: the serial stops the round, waits and runs it again; nothing reaches the executor or the guards", () => {
  function serialWith(dir: string, o: { trial?: Parameters<typeof wrapTrial>[0]; runner?: CheckRunner; messages?: string[] }) {
    const store = new Exp2Store(join(dir, "store"), "b4")
    const exec = serialExecutor()
    const executor = (round: number): Executor => {
      const e = exec(round)
      return { async open(ctx) { const s = await e.open(ctx); return { ...s, id: s.id, send: async (m: string) => { o.messages?.push(m); return s.send(m) }, close: () => s.close() } } }
    }
    const serial = new Serial({
      store, workdir: join(dir, "work"), checkpoints: join(dir, "checkpoints"), text: roundText, attribution: stubTransport(), checks: checkStubTransport(),
      executor, executorIsStub: true, anchors: new GoAnchorExtractor(), runner: o.runner ?? new LocalProcessRunner(), sandbox: new LocalScriptSandbox(), build: goBuilder(join(dir, "builds"), {}, "dpipe"), binary: "dpipe",
      reviewer: workingReviewer(join(dir, "rb")), formalize: stubFormalizer({ filter: FILTER_UNIT, sort: SORT_UNIT }), trial: wrapTrial(o.trial ?? (() => false)),
      limits: { attributionRepairs: 2, checkRepairs: 2, managementTimeoutMs: 60_000, checkTimeoutMs: 10_000, execution: { ...DEFAULT_LIMITS, repairCycles: 2 } },
    })
    return { store, serial }
  }
  /** The real local trial, except where `down(n)` says docker is down for the n-th trial: rep1f's error is raised then. */
  function wrapTrial(down: (n: number) => boolean) {
    const real = goTrial({}, "dpipe")
    let n = 0
    return async (workdir: string, label: string) => {
      if (down(++n)) {
        // As dockerTrial raises it when the client prints rep1f's message.
        const d = dockerDown(1, REP1F)!
        throw new EnvironmentUnavailable(d)
      }
      return real(workdir, label)
    }
  }
  const view = (s: Exp2Store) => s.inspect().reports.map(r => ({ round: r.round, guards: r.review!.guards, reverted: r.review!.reverted, items: r.review!.items, trial: r.review!.trial }))

  it("docker down at R1's first trial: the round waits once and runs again; the executor never hears of docker; the result is the uninterrupted one", { timeout: 600_000 }, async () => {
    const clean = serialWith(mkdtempSync(join(tmpdir(), "exp2-b4-clean-")), {})
    assert.equal((await clean.serial.run({ to: 2 })).status, "done")
    const dir = mkdtempSync(join(tmpdir(), "exp2-b4-trial-"))
    const messages: string[] = [], waits: number[] = []
    const { store, serial } = serialWith(dir, { trial: n => n === 1, messages })
    const outcome = await serial.run({ to: 2, wait: async ms => { waits.push(ms) }, environmentWaitMs: 1234 })
    assert.deepEqual(outcome, { status: "done", last_checkpoint: 2, resumes: 1 })
    assert.deepEqual(waits, [1234])
    assert.ok(!messages.some(m => /docker/iu.test(m)), "no message to the executor names docker")
    const interrupted = readdirSync(join(dir, "checkpoints", "interrupted"))
    assert.deepEqual(interrupted, ["round-01-1.json"])
    const attempt = JSON.parse(readFileSync(join(dir, "checkpoints", "interrupted", interrupted[0]), "utf8")) as { reason: string }
    assert.match(attempt.reason, /^environment unavailable: the docker daemon cannot be reached: failed to connect to the docker API/u)
    assert.deepEqual(view(store), view(clean.store))
  })

  it("docker down while the guards are run again after a repair: no flip, no revert; the round runs again", { timeout: 600_000 }, async () => {
    const clean = serialWith(mkdtempSync(join(tmpdir(), "exp2-b4-clean2-")), {})
    assert.equal((await clean.serial.run({ to: 2 })).status, "done")
    // The serial's third check batch on a built program is R1's second cycle (after C1.1 was checked): docker goes down there.
    const local = new LocalProcessRunner()
    let batches = 0
    const runner: CheckRunner = {
      run: (p, i, t) => local.run(p, i, t),
      literals: p => local.literals(p),
      async runBatch(p, inputs, t) {
        if (p.kind !== "null" && ++batches === 3) throw new EnvironmentUnavailable(dockerDown(1, REP1F)!)
        return local.runBatch(p, inputs, t)
      },
    }
    const dir = mkdtempSync(join(tmpdir(), "exp2-b4-guards-"))
    const { store, serial } = serialWith(dir, { runner })
    const outcome = await serial.run({ to: 2, wait: async () => {} })
    assert.equal(outcome.status, "done")
    assert.equal(outcome.resumes, 1)
    // Where it went down: R1, after the first delivery was built and run, while a later cycle's checks ran.
    const [file] = readdirSync(join(dir, "checkpoints", "interrupted"))
    const attempt = JSON.parse(readFileSync(join(dir, "checkpoints", "interrupted", file), "utf8")) as { round: number; reason: string; execution: { cycles: { id: string; runs: unknown[] }[] } | null }
    assert.deepEqual([attempt.round, attempt.execution?.cycles.map(c => c.id)], [1, ["C1.1"]])
    assert.ok(attempt.execution!.cycles[0].runs.length > 0, "C1.1 was checked; docker went down in C1.2, the repair cycle that runs the guards again")
    assert.deepEqual(view(store), view(clean.store), "the outage left nothing: guards, flips, reverts and items as without it")
  })
})
