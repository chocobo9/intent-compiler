import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BuildResult } from "./execution.js"
import { dockerDown, EnvironmentUnavailable, guardedSync, interpreterMissing, isEnvironmentBlock, scriptCommand, scriptFile } from "./platform.js"
import { ranOnly } from "./coverage.js"
import { collect, DEFAULT_RESOURCE_LIMITS, execute, nullRun, sourceLiterals, writeInputs, type ResourceLimits, type CheckInput, type CheckRunner, type InputFile, type ProgramRef, type RunOutput, type ScriptResult, type ScriptSandbox } from "./runner.js"

/**
 * Docker-backed runners for the real run (DESIGN §8, §12a): checks, reference scripts and builds each run in a fresh
 * container with no network, which sees only this run's temporary directory (and, read-only, the program built
 * for it). A run that outlasts its time limit is stopped and its container removed.
 */

export interface DockerOptions {
  /** The docker command line prefix, e.g. ["docker"] or a full path. */
  docker?: string[]
  image: string
  /** Where the run directory appears in the container. */
  workdir?: string
  /**
   * Interpreters inside the image (Linux paths). Python defaults to the SDD image's `/opt/sdd-python/bin/python3`;
   * the image has no node, so node reference scripts fail unless `node` is given.
   */
  python?: string
  node?: string
  /**
   * A Go build cache for builds only: a docker volume name or a host directory, mounted at /gocache in build
   * containers. Check and reference-script containers never mount it.
   */
  buildCache?: string
  /** `--user` for the container, so files it writes can be removed afterwards (e.g. "1000:1000"). */
  user?: string
  /** Extra `docker run` flags (memory, cpus, …). */
  extra?: string[]
  /** Seconds docker gets beyond the time limit before the run is stopped. */
  graceMs?: number
  /** Limits on the program under test (and reference scripts); builds get `buildMemoryMb`. Defaults: DEFAULT_RESOURCE_LIMITS. */
  limits?: Partial<ResourceLimits>
  /** Memory for a build container, MiB (default 2048). */
  buildMemoryMb?: number
  /** Builds record coverage (`go build -cover`), read back after each batched run with the image's covdata (DESIGN §12h E4). */
  cover?: boolean
}

/** `docker run` flags for a memory limit (no swap beyond it) and a process limit. */
export function limitFlags(memoryMb: number, pids: number): string[] {
  return ["--memory", `${memoryMb}m`, "--memory-swap", `${memoryMb}m`, "--pids-limit", String(pids)]
}

let counter = 0
export function containerName(prefix = "exp2"): string {
  return `${prefix}-${process.pid}-${Date.now().toString(36)}-${(counter++).toString(36)}`
}

/** The `docker run` arguments: no network, only the run directory mounted (plus the program, read-only). */
export const DOCKER_PYTHON = "/opt/sdd-python/bin/python3"

export function dockerRunArgs(o: DockerOptions, name: string, runDir: string, command: string[], mounts: { host: string; container: string; readonly?: boolean }[] = []): string[] {
  const work = o.workdir ?? "/work"
  return [
    "run", "--rm", "--name", name, "--network", "none",
    "-v", `${runDir}:${work}`, "-w", work,
    ...mounts.flatMap(m => ["-v", `${m.host}:${m.container}${m.readonly === false ? "" : ":ro"}`]),
    ...(o.user ? ["--user", o.user] : []),
    ...(o.extra ?? []),
    o.image, ...command,
  ]
}

function docker(o: DockerOptions): string[] { return o.docker ?? ["docker"] }

/** Stops and removes a container that outlived its run (no error if it is already gone). */
export function removeContainer(o: DockerOptions, name: string): void {
  const [cmd, ...pre] = docker(o)
  spawnSync(cmd, [...pre, "rm", "-f", name], { stdio: "ignore" })
}

async function runInContainer(o: DockerOptions, runDir: string, command: string[], timeoutMs: number, mounts: { host: string; container: string }[] = []) {
  const name = containerName()
  const limits = { ...DEFAULT_RESOURCE_LIMITS, ...o.limits }
  const args = dockerRunArgs({ ...o, extra: [...limitFlags(limits.memoryMb, limits.pids), ...(o.extra ?? [])] }, name, runDir, command, mounts)
  const [cmd, ...pre] = docker(o)
  // The docker client keeps the host environment it needs; the container gets none of it. Output is capped here.
  const result = await execute([cmd, ...pre, ...args], runDir, timeoutMs + (o.graceMs ?? 0), process.env, undefined, { outputBytes: limits.outputBytes })
  if (result.timed_out || result.limit) removeContainer(o, name)
  throwIfDockerDown(result.exit_code, `${result.stderr}${result.stdout}`)
  return withContainerLimit(result, limits.memoryMb)
}

/**
 * Docker itself not there (batch 4) is no outcome of the build, the trial, the check or the script: it is raised, so the
 * round stops and waits instead of a check failing, a guard flipping or the executor being asked to fix it.
 */
function throwIfDockerDown(exitCode: number | null, output: string, error?: unknown): void {
  const down = dockerDown(exitCode, output, error)
  if (down) throw new EnvironmentUnavailable(down)
}

/** A container killed by its memory limit exits 137 (SIGKILL) without having timed out: recorded as the memory limit. */
export function withContainerLimit<T extends ScriptResult>(r: T, memoryMb: number): T {
  if (r.limit || r.timed_out || r.exit_code !== 137) return r
  return { ...r, exit_code: null, limit: { kind: "memory", detail: `killed at the ${memoryMb} MiB memory limit` } }
}

/** Runs per container in a batch (BLOCK11 §1). */
export const BATCH_SIZE = 1000

const quote = (s: string) => `'${s.replace(/'/gu, `'\\''`)}'`

/**
 * The shell script of a batch: each run in its own directory, one after another, with its own time limit (timeout),
 * output limit (ulimit -f, 512-byte blocks) and the container's memory limit; exit code, stdout, stderr and elapsed
 * milliseconds kept per run. Exits 99 at once when the image has no `timeout`, so the caller falls back to one
 * container per run.
 */
export function batchScript(command: readonly string[], inputs: readonly CheckInput[], timeoutMs: number, outputBytes: number, work = "/work", coverage = false): string {
  const secs = Math.max(1, Math.ceil(timeoutMs / 1000)), blocks = Math.max(1, Math.ceil(outputBytes / 512))
  return [
    "command -v timeout >/dev/null 2>&1 || exit 99",
    `mkdir -p ${work}/__out`,
    // A program built to record coverage writes its counters per run outside the run directory; the image's covdata
    // turns them into the text profile after the run (none without Go in the image: the selection then runs everything).
    ...(coverage ? ["T=$(HOME=/tmp go env GOTOOLDIR 2>/dev/null)"] : []),
    ...inputs.map((input, i) => {
      const o = `${work}/__out/r${i}`
      const cov = coverage ? `mkdir -p ${o}.c && export GOCOVERDIR=${o}.c && ` : ""
      const read = coverage ? `; [ -n "$T" ] && "$T/covdata" textfmt -i=${o}.c -o=${o}.cov >/dev/null 2>&1` : ""
      return `cd ${work}/r${i} && ${cov}s=$(date +%s%N) && ( ulimit -f ${blocks}; exec timeout -k 1 ${secs} ${[...command, ...input.args].map(quote).join(" ")} ) >${o}.out 2>${o}.err; echo $? >${o}.code; e=$(date +%s%N); echo $(( (e - s) / 1000000 )) >${o}.ms 2>/dev/null${read}`
    }),
  ].join("\n") + "\n"
}

/** One run of a batch, read back: exit 124 (or 137 past the time) is the time limit, 153 the output limit, 137 within time memory. */
export function batchResult(code: number | null, stdout: string, stderr: string, ms: number, timeoutMs: number, files: Record<string, string>, memoryMb: number): RunOutput {
  const overTime = code === 124 || (code === 137 && Number.isFinite(ms) && ms >= timeoutMs)
  if (overTime) return { exit_code: null, stdout, stderr, files, timed_out: true, limit: { kind: "time", detail: `no exit within ${timeoutMs} ms` } }
  if (code === 153) return { exit_code: null, stdout, stderr, files, timed_out: false, limit: { kind: "output", detail: "output passed the size limit" } }
  if (code === 137) return { exit_code: null, stdout, stderr, files, timed_out: false, limit: { kind: "memory", detail: `killed at the ${memoryMb} MiB memory limit` } }
  return { exit_code: code, stdout, stderr, files, timed_out: false }
}

export class DockerRunner implements CheckRunner {
  constructor(private readonly o: DockerOptions) {}
  /** Up to BATCH_SIZE runs in one container (no network, the program read-only, the container's limits). */
  async runBatch(program: ProgramRef, inputs: readonly CheckInput[], timeoutMs: number): Promise<RunOutput[]> {
    if (program.kind === "null") return inputs.map(nullRun)
    const limits = { ...DEFAULT_RESOURCE_LIMITS, ...this.o.limits }
    const out: RunOutput[] = []
    for (let at = 0; at < inputs.length; at += BATCH_SIZE) {
      const chunk = inputs.slice(at, at + BATCH_SIZE)
      const dir = mkdtempSync(join(tmpdir(), "exp2-batch-"))
      try {
        chunk.forEach((input, i) => { mkdirSync(join(dir, `r${i}`)); writeInputs(join(dir, `r${i}`), input.files) })
        writeFileSync(join(dir, "__batch.sh"), batchScript(program.command, chunk, timeoutMs, limits.outputBytes, this.o.workdir ?? "/work", program.cover === true), "utf8")
        const r = await runInContainer(this.o, dir, ["sh", `${this.o.workdir ?? "/work"}/__batch.sh`], chunk.length * (timeoutMs + 1000), program.mount ? [program.mount] : [])
        if (r.exit_code === 99) { for (const input of chunk) out.push(await this.run(program, input, timeoutMs)); continue }
        const read = (f: string) => { try { return readFileSync(join(dir, "__out", f), "utf8") } catch { return "" } }
        chunk.forEach((_, i) => {
          const code = read(`r${i}.code`).trim()
          const run = batchResult(code === "" ? null : Number(code), read(`r${i}.out`), read(`r${i}.err`), Number(read(`r${i}.ms`).trim()), timeoutMs, collect(join(dir, `r${i}`)), limits.memoryMb)
          const cov = program.cover ? read(`r${i}.cov`) : ""
          out.push(cov ? { ...run, coverage: ranOnly(cov) } : run)
        })
      } finally { rmSync(dir, { recursive: true, force: true }) }
    }
    return out
  }
  async run(program: ProgramRef, input: CheckInput, timeoutMs: number): Promise<RunOutput> {
    if (program.kind === "null") return nullRun(input)
    const dir = mkdtempSync(join(tmpdir(), "exp2-check-"))
    try {
      writeInputs(dir, input.files)
      // One run alone records no coverage, but a program built to record it needs somewhere to write (or it warns on stderr).
      const command = program.cover ? ["env", "GOCOVERDIR=/tmp", ...program.command, ...input.args] : [...program.command, ...input.args]
      const result = await runInContainer(this.o, dir, command, timeoutMs, program.mount ? [program.mount] : [])
      return { ...result, files: collect(dir) }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  literals(program: ProgramRef): Set<string> {
    return program.source_dir ? sourceLiterals(program.source_dir) : new Set()
  }
}

export class DockerScriptSandbox implements ScriptSandbox {
  constructor(private readonly o: DockerOptions) {}
  async run(language: "python" | "node", code: string, files: InputFile[], timeoutMs: number): Promise<ScriptResult> {
    const dir = mkdtempSync(join(tmpdir(), "exp2-ref-"))
    try {
      if (language === "node" && !this.o.node) return { exit_code: 127, stdout: "", stderr: "the image has no node; set runner.node or use python", timed_out: false }
      writeInputs(dir, files)
      const script = scriptFile(language)
      writeFileSync(join(dir, script), code, "utf8")
      // Inside the container it is Linux, whatever the host: the image's interpreters, named directly.
      const command = scriptCommand(language, script, { platform: "linux", python: this.o.python ?? DOCKER_PYTHON, node: this.o.node ?? "node" })
      const r = await runInContainer(this.o, dir, command, timeoutMs)
      const missing = interpreterMissing(command[0], r.exit_code, `${r.stderr}${r.stdout}`)
      if (missing) throw new EnvironmentUnavailable(missing)
      return r
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
}

/**
 * Builds the work tree inside the image (`go build -o /out/<binary> ./...`, no network, the tree mounted read-only)
 * into a host directory outside the work tree; the program then runs in a container with that directory mounted.
 */
export function dockerGoBuilder(outRoot: string, o: DockerOptions, timeoutMs = 10 * 60_000, binary = "app"): (workdir: string, label: string) => BuildResult {
  return (workdir, label) => {
    const out = join(outRoot, label.replace(/[^A-Za-z0-9._-]/gu, "_"))
    mkdirSync(out, { recursive: true })
    const name = containerName()
    // The output directory is the writable mount; the work tree is mounted read-only, so the build cannot change it.
    const args = dockerRunArgs({ ...o, workdir: "/out", extra: [...limitFlags(o.buildMemoryMb ?? 2048, (o.limits?.pids ?? DEFAULT_RESOURCE_LIMITS.pids) * 4), ...(o.extra ?? [])] }, name, out, ["sh", "-c", `cd /src && GOFLAGS=-mod=readonly GOCACHE=${o.buildCache ? "/gocache" : "/tmp/gocache"} go build${o.cover ? " -cover" : ""} -o /out/${binary} ./...`], [{ host: workdir, container: "/src" }, ...(o.buildCache ? [{ host: o.buildCache, container: "/gocache", readonly: false }] : [])])
    const [cmd, ...pre] = docker(o)
    const r = guardedSync("docker", () => spawnSync(cmd, [...pre, ...args], { encoding: "utf8", timeout: timeoutMs }), r => isEnvironmentBlock(r.error) ? String(r.error) : null)
    if (r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT") removeContainer(o, name)
    const output = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error) : ""}`
    throwIfDockerDown(r.status, output, r.error)
    if (r.status !== 0) return { ok: false, output, program: null }
    return { ok: true, output, program: { id: label, label: `build of ${label} (docker)`, command: [`/prog/${binary}`], source_dir: workdir, mount: { host: out, container: "/prog" }, ...(o.cover ? { cover: true } : {}) } }
  }
}

/** The docker build without blocking (BLOCK10 §9.1), for mutants built side by side: the same container and command. */
export function dockerGoBuilderAsync(outRoot: string, o: DockerOptions, timeoutMs = 10 * 60_000, binary = "app"): (workdir: string, label: string) => Promise<BuildResult> {
  return async (workdir, label) => {
    const out = join(outRoot, label.replace(/[^A-Za-z0-9._-]/gu, "_"))
    mkdirSync(out, { recursive: true })
    const name = containerName()
    const args = dockerRunArgs({ ...o, workdir: "/out", extra: [...limitFlags(o.buildMemoryMb ?? 2048, (o.limits?.pids ?? DEFAULT_RESOURCE_LIMITS.pids) * 4), ...(o.extra ?? [])] }, name, out, ["sh", "-c", `cd /src && GOFLAGS=-mod=readonly GOCACHE=${o.buildCache ? "/gocache" : "/tmp/gocache"} go build -o /out/${binary} ./...`], [{ host: workdir, container: "/src" }, ...(o.buildCache ? [{ host: o.buildCache, container: "/gocache", readonly: false }] : [])])
    const [cmd, ...pre] = docker(o)
    const r = await execute([cmd, ...pre, ...args], out, timeoutMs, process.env)
    if (r.timed_out) removeContainer(o, name)
    const output = `${r.stdout}${r.stderr}`
    throwIfDockerDown(r.exit_code, output)
    if (r.exit_code !== 0) return { ok: false, output, program: null }
    return { ok: true, output, program: { id: label, label: `build of ${label} (docker)`, command: [`/prog/${binary}`], source_dir: workdir, mount: { host: out, container: "/prog" } } }
  }
}

/**
 * The trial in the image, no network, as the control group runs it: the work tree (mounted read-only) copied to /app,
 * then `go build -o <binary> ./... && go test ./...` there. Its output, as the commands print it, is what the executor
 * gets back when it fails.
 */
export function dockerTrial(o: DockerOptions, binary = "app", timeoutMs = 10 * 60_000): (workdir: string, label: string) => Promise<{ ok: boolean; output: string }> {
  return async workdir => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-trial-"))
    try {
      const name = containerName()
      const args = dockerRunArgs({ ...o, workdir: "/app", extra: [...limitFlags(o.buildMemoryMb ?? 2048, (o.limits?.pids ?? DEFAULT_RESOURCE_LIMITS.pids) * 4), ...(o.extra ?? [])] }, name, dir, ["sh", "-c", `cp -a /src/. /app/ && cd /app && export GOFLAGS=-mod=readonly GOCACHE=${o.buildCache ? "/gocache" : "/tmp/gocache"} GOTMPDIR=/tmp && go build -o ${binary} ./... && go test ./...`], [{ host: workdir, container: "/src" }, ...(o.buildCache ? [{ host: o.buildCache, container: "/gocache", readonly: false }] : [])])
      const [cmd, ...pre] = docker(o)
      const r = await execute([cmd, ...pre, ...args], dir, timeoutMs, process.env)
      if (r.timed_out) removeContainer(o, name)
      throwIfDockerDown(r.exit_code, `${r.stdout}${r.stderr}`)
      return { ok: r.exit_code === 0, output: `${r.stdout}${r.stderr}` }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
}
