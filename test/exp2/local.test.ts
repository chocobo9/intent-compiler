import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { AuthInvalid, QuotaExhausted, type AttributionTransport } from "../../src/exp2/attribution.js"
import { goBuilder } from "../../src/exp2/build.js"
import { dockerGoBuilder, dockerRunArgs, DockerRunner, DockerScriptSandbox } from "../../src/exp2/docker.js"
import { DEFAULT_LIMITS, SessionBroken } from "../../src/exp2/execution.js"
import { assembleSerial, localConfigProblems, loadLocalConfig, preflight, scoringHook, type LocalConfig } from "../../src/exp2/local-config.js"
import { OpenCodeExecutor } from "../../src/exp2/opencode-executor.js"
import { classifyProviderError } from "../../src/exp2/provider-errors.js"
import { LocalProcessRunner, LocalScriptSandbox } from "../../src/exp2/runner.js"
import { Serial } from "../../src/exp2/serial.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { createOpenCodeAttributionTransport } from "../../src/exp2/transport.js"
import { checkStubTransport } from "./check-stubs.js"
import { roundText } from "./inputs.js"
import { serialExecutor } from "./serial-executor.js"
import { stubTransport } from "./stubs.js"

/** Error texts as providers and OpenCode report them (the first is the one seen locally). */
const AUTH_TEXTS = [
  "OpenCode HTTP 401: {\"error\":{\"message\":\"invalidated oauth token\",\"type\":\"invalid_request_error\"}}",
  "Provider error: Your OAuth token has expired. Please run login again.",
  "Incorrect API key provided: sk-…",
]
const QUOTA_TEXTS = [
  "OpenCode HTTP 429: {\"error\":{\"code\":\"insufficient_quota\",\"message\":\"You exceeded your current quota\"}}",
  "usage_limit_reached: The usage limit has been reached for this period",
  "Rate limit reached for requests",
]
const ORDINARY = ["socket hang up", "OpenCode HTTP 500: internal error", "fetch failed: ECONNREFUSED", "model returned no structured output"]

describe("exp2 local: provider errors", () => {
  it("tells an invalid login and a spent quota from an ordinary failure", () => {
    for (const t of AUTH_TEXTS) assert.equal(classifyProviderError(new Error(t)), "auth", t)
    for (const t of QUOTA_TEXTS) assert.equal(classifyProviderError(new Error(t)), "quota", t)
    for (const t of ORDINARY) assert.equal(classifyProviderError(new Error(t)), null, t)
    // The text may sit in a diagnostic the transport attached, not in the message.
    const e = Object.assign(new Error("OpenCode session.prompt failed"), { diagnostic: { error: "invalidated oauth token" } })
    assert.equal(classifyProviderError(e), "auth")
  })

  it("the management transports raise AuthInvalid and QuotaExhausted; the coding executor too, inside a normal reply", async () => {
    const failing = (text: string) => ({ session: { create: async () => ({ id: "s" }), prompt: async () => { throw new Error(text) } } })
    const transport = (text: string) => createOpenCodeAttributionTransport({ client: failing(text), directory: tmpdir(), providerId: "p", modelId: "m" })
    const request = { round: 1, sources: "", outline: [], objects: [], candidates: [], issues: [], previous_draft: { assignments: [], references: [], interpretations: [] } }
    await assert.rejects(transport(AUTH_TEXTS[0])(request), AuthInvalid)
    await assert.rejects(transport(QUOTA_TEXTS[0])(request), QuotaExhausted)
    await assert.rejects(transport(ORDINARY[0])(request), e => !(e instanceof AuthInvalid) && !(e instanceof QuotaExhausted))
    const coding = (prompt: () => Promise<unknown>) => new OpenCodeExecutor({ client: { session: { create: async () => ({ id: "c" }), prompt } }, providerId: "p", modelId: "m" })
    const context = { round: 1, workdir: tmpdir(), workorder: { round: 1, task: [], protect: [], status: [], source: [], anchors: [], edges: [] }, text: "", resume: null }
    const step = { id: "P1.1", round: 1, label: "s", summary: "", objects: [] }
    const s1 = await coding(async () => ({ info: { error: { name: "APIError", data: { message: "insufficient_quota" } } }, parts: [] })).open(context)
    await assert.rejects(s1.work(step, []), QuotaExhausted)
    const s2 = await coding(async () => { throw new Error("socket hang up") }).open(context)
    await assert.rejects(s2.work(step, []), SessionBroken)
    const s3 = await coding(async () => { throw new Error(AUTH_TEXTS[0]) }).open(context)
    await assert.rejects(s3.work(step, []), AuthInvalid)
  })

  it("an invalid login stops the serial at once: the attempt is kept, the checkpoint restored, the stop reported", async () => {
    process.env.GIT_AUTHOR_DATE = process.env.GIT_COMMITTER_DATE = "2026-10-20T00:00:00Z"
    const dir = mkdtempSync(join(tmpdir(), "exp2-auth-"))
    const inner = stubTransport()
    const attribution: AttributionTransport = async r => { if (r.round === 2) throw new AuthInvalid("invalidated oauth token"); return inner(r) }
    const scored: number[] = []
    const store = new Exp2Store(join(dir, "store"), "auth")
    const serial = new Serial({
      store, workdir: join(dir, "work"), checkpoints: join(dir, "checkpoints"), text: roundText, attribution, checks: checkStubTransport(),
      executor: serialExecutor(), executorIsStub: true, anchors: new GoAnchorExtractor(), runner: new LocalProcessRunner(), sandbox: new LocalScriptSandbox(), build: goBuilder(join(dir, "builds")),
      limits: { attributionRepairs: 2, checkRepairs: 2, managementTimeoutMs: 5000, checkTimeoutMs: 10_000, execution: { ...DEFAULT_LIMITS, maxAttemptsPerStep: 2 } },
      score: async round => { scored.push(round); return { passed: 200 + round, total: 219 } },
    })
    const outcome = await serial.run({ to: 3, wait: async () => assert.fail("a dead login is not waited out") })
    assert.deepEqual([outcome.status, outcome.last_checkpoint, outcome.stopped!.round], ["stopped", 1, 2])
    assert.match(outcome.stopped!.reason, /login invalid: .*invalidated oauth token/u)
    assert.ok(existsSync(join(dir, "checkpoints", "stopped-round-02.json")))
    assert.equal(serial.interruptedAttempts(2).length, 1)
    assert.equal(store.inspect().calls.filter(c => c.round === 2).length, 0, "the state is back at the R1 checkpoint")
    // The score goes into the checkpoint's report and the score log, never into the state.
    assert.deepEqual(scored, [1])
    const report = JSON.parse(readFileSync(join(dir, "checkpoints", "round-01", "report.json"), "utf8"))
    assert.deepEqual(report.official_score, { passed: 201, total: 219 })
    assert.equal(store.inspect().reports[0].official_score, null)
    assert.match(readFileSync(join(dir, "checkpoints", "round-01", "report.md"), "utf8"), /Official score: 201\/219/u)
    assert.match(readFileSync(join(dir, "checkpoints", "scores.jsonl"), "utf8"), /"round":1/u)
  })
})

/** A fake docker client: records its arguments, writes into the mounted run directory, can sleep or fail. */
function fakeDocker(dir: string): { command: string[]; log: string; calls: () => string[][] } {
  const script = join(dir, "fake-docker.mjs")
  const log = join(dir, "docker.log")
  writeFileSync(script, `
import { appendFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n")
if (args[0] === "run") {
  const mount = args[args.indexOf("-v") + 1]
  const host = mount.slice(0, mount.lastIndexOf(":"))
  if (process.env.FAKE_DOCKER_SLEEP) await new Promise(r => setTimeout(r, Number(process.env.FAKE_DOCKER_SLEEP)))
  writeFileSync(join(host, "written-in-container.txt"), "ok\\n")
  process.stdout.write("container out\\n")
  process.exit(Number(process.env.FAKE_DOCKER_EXIT ?? 0))
}
process.exit(0)
`, "utf8")
  return { command: [process.execPath, script], log, calls: () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(l => JSON.parse(l) as string[]) : [] }
}

describe("exp2 local: docker runners (command line only; containers run locally)", () => {
  it("builds the docker run command: no network, only the run directory, the program read-only", () => {
    const args = dockerRunArgs({ image: "sdd-unattended-preflight:latest" }, "exp2-x", "C:\\Temp\\exp2-check-1", ["/prog/dpipe", "verify"], [{ host: "C:\\b\\R1", container: "/prog" }])
    assert.deepEqual(args, ["run", "--rm", "--name", "exp2-x", "--network", "none", "-v", "C:\\Temp\\exp2-check-1:/work", "-w", "/work", "-v", "C:\\b\\R1:/prog:ro", "sdd-unattended-preflight:latest", "/prog/dpipe", "verify"])
  })

  it("runs a check in a container and collects what it wrote; a run past its limit is stopped and its container removed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-docker-"))
    const fake = fakeDocker(dir)
    const runner = new DockerRunner({ docker: fake.command, image: "img:1" })
    const program = { id: "R1-final", label: "", command: ["/prog/dpipe"], source_dir: null, mount: { host: join(dir, "prog"), container: "/prog" } }
    const out = await runner.run(program, { args: ["verify", "--file", "a.csv"], files: [{ path: "a.csv", content: "x\n" }] }, 5000)
    assert.deepEqual([out.exit_code, out.stdout, out.files["a.csv"], out.files["written-in-container.txt"]], [0, "container out\n", "x\n", "ok\n"])
    const run = fake.calls()[0]
    assert.deepEqual(run.slice(0, 2), ["run", "--rm"])
    assert.deepEqual(run.slice(4, 6), ["--network", "none"])
    assert.ok(run.includes(`${join(dir, "prog")}:/prog:ro`))
    assert.deepEqual(run.slice(run.indexOf("img:1")), ["img:1", "/prog/dpipe", "verify", "--file", "a.csv"])
    process.env.FAKE_DOCKER_SLEEP = "3000"
    try {
      const slow = await runner.run(program, { args: [], files: [] }, 200)
      assert.equal(slow.timed_out, true)
    } finally { delete process.env.FAKE_DOCKER_SLEEP }
    const name = fake.calls().at(-2)![3]
    assert.deepEqual(fake.calls().at(-1), ["rm", "-f", name], "the container left behind is removed")
    // The null baseline needs no container.
    const before = fake.calls().length
    assert.equal((await runner.run({ id: "baseline:null", label: "", command: [], source_dir: null, kind: "null" }, { args: [], files: [] }, 1000)).exit_code, 1)
    assert.equal(fake.calls().length, before)
  })

  it("runs reference scripts with the image's interpreter, and builds with the work tree mounted read-only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-docker-"))
    const fake = fakeDocker(dir)
    const sandbox = new DockerScriptSandbox({ docker: fake.command, image: "img:1" })
    const r = await sandbox.run("python", "print(1)", [{ path: "in.csv", content: "a\n" }], 5000)
    assert.equal(r.exit_code, 0)
    assert.deepEqual(fake.calls()[0].slice(-4), ["img:1", "python3", "-I", "__reference__.py"])
    const work = join(dir, "work")
    mkdirSync(work)
    const build = dockerGoBuilder(join(dir, "builds"), { docker: fake.command, image: "img:1" })(work, "R3-final")
    assert.equal(build.ok, true)
    const b = fake.calls()[1]
    assert.ok(b.includes(`${work}:/src:ro`), "the work tree is read-only to the build")
    assert.ok(b.includes(`${join(dir, "builds", "R3-final")}:/out`), "only the output directory is writable")
    assert.deepEqual(build.program!.command, ["/prog/dpipe"])
    assert.deepEqual(build.program!.mount, { host: join(dir, "builds", "R3-final"), container: "/prog" })
    assert.equal(build.program!.source_dir, work, "the code-fact test still reads the source")
  })
})

describe("exp2 local: the configuration file and the entry point", () => {
  it("the example configuration is valid and assembles a docker-backed serial without running it", () => {
    const file = resolve(process.cwd(), "exp2/local-config.example.json")
    const c = loadLocalConfig(file)
    assert.equal(c.runner.kind, "docker")
    // Assembled with this machine's temporary directories in place of the example's Windows paths.
    const tmp = mkdtempSync(join(tmpdir(), "exp2-cfg-"))
    const { config } = assembleSerial({
      ...c, state_dir: join(tmp, "state"), checkpoints_dir: join(tmp, "cp"), repo_dir: join(tmp, "app"), builds_dir: join(tmp, "b"),
      management: { ...c.management, directory: join(tmp, "mgmt") }, coding: { ...c.coding, directory: join(tmp, "app") },
    })
    assert.ok(config.runner instanceof DockerRunner && config.sandbox instanceof DockerScriptSandbox)
    assert.equal(config.executorIsStub, false)
    assert.equal(config.limits.execution.maxAttemptsPerStep, 3)
  })

  it("names what is wrong with a configuration", () => {
    const good = JSON.parse(readFileSync(resolve(process.cwd(), "exp2/local-config.example.json"), "utf8")) as LocalConfig
    const bad: LocalConfig = { ...good, rounds: 0, checkpoints_dir: `${good.repo_dir}/cp`, management: { ...good.management, server_url: "https://example.com", directory: "relative" }, runner: { kind: "docker", image: "" } }
    const problems = localConfigProblems(bad).join(" | ")
    for (const p of ["rounds must be a positive integer", "management.server_url must be a local server", "management.directory must be an absolute path", "runner.image is required", "checkpoints_dir must be outside repo_dir"]) assert.ok(problems.includes(p), p)
    assert.deepEqual(localConfigProblems(good), [])
  })

  it("preflight refuses a management server that inherits plugins or instructions", async () => {
    const good = JSON.parse(readFileSync(resolve(process.cwd(), "exp2/local-config.example.json"), "utf8")) as LocalConfig
    const fake = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch
    assert.deepEqual(await preflight(good, fake({ plugin: [], instructions: [] })), [])
    assert.match((await preflight(good, fake({ plugin: ["x"] }))).join(), /inherits plugins or instructions/u)
  })

  it("the scoring hook runs a command and reads {passed, total}", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-score-"))
    const script = join(dir, "score.mjs")
    writeFileSync(script, "const [r, c] = process.argv.slice(2); process.stdout.write(JSON.stringify({ passed: Number(r) * 10, total: 960, commit: c }))", "utf8")
    const hook = scoringHook([process.execPath, script, "{round}", "{commit}"], dir)
    assert.deepEqual(await hook(7, "abc123"), { passed: 70, total: 960 })
  })
})
