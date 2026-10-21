import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BuildResult } from "./execution.js"
import { guardedSync, isEnvironmentBlock, scriptCommand, scriptFile } from "./platform.js"
import { collect, execute, nullRun, sourceLiterals, writeInputs, type CheckInput, type CheckRunner, type InputFile, type ProgramRef, type RunOutput, type ScriptResult, type ScriptSandbox } from "./runner.js"

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
  const args = dockerRunArgs(o, name, runDir, command, mounts)
  const [cmd, ...pre] = docker(o)
  // The docker client keeps the host environment it needs; the container gets none of it.
  const result = await execute([cmd, ...pre, ...args], runDir, timeoutMs + (o.graceMs ?? 0), process.env)
  if (result.timed_out) removeContainer(o, name)
  return result
}

export class DockerRunner implements CheckRunner {
  constructor(private readonly o: DockerOptions) {}
  async run(program: ProgramRef, input: CheckInput, timeoutMs: number): Promise<RunOutput> {
    if (program.kind === "null") return nullRun(input)
    const dir = mkdtempSync(join(tmpdir(), "exp2-check-"))
    try {
      writeInputs(dir, input.files)
      const result = await runInContainer(this.o, dir, [...program.command, ...input.args], timeoutMs, program.mount ? [program.mount] : [])
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
      return await runInContainer(this.o, dir, command, timeoutMs)
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
    const args = dockerRunArgs({ ...o, workdir: "/out" }, name, out, ["sh", "-c", `cd /src && GOFLAGS=-mod=readonly GOCACHE=${o.buildCache ? "/gocache" : "/tmp/gocache"} go build -o /out/${binary} ./...`], [{ host: workdir, container: "/src" }, ...(o.buildCache ? [{ host: o.buildCache, container: "/gocache", readonly: false }] : [])])
    const [cmd, ...pre] = docker(o)
    const r = guardedSync("docker", () => spawnSync(cmd, [...pre, ...args], { encoding: "utf8", timeout: timeoutMs }), r => isEnvironmentBlock(r.error) ? String(r.error) : null)
    if (r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT") removeContainer(o, name)
    const output = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error) : ""}`
    if (r.status !== 0) return { ok: false, output, program: null }
    return { ok: true, output, program: { id: label, label: `build of ${label} (docker)`, command: [`/prog/${binary}`], source_dir: workdir, mount: { host: out, container: "/prog" } } }
  }
}
