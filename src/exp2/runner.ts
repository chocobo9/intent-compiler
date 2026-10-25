import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, extname, join, relative, resolve, sep } from "node:path"
import { spawn as nodeSpawn } from "node:child_process"
import { mapPool } from "./pool.js"
import { readCoverage } from "./coverage.js"
import { ENVIRONMENT_TRIES, EnvironmentBlocked, EnvironmentUnavailable, interpreterMissing, isEnvironmentBlock, minimalEnv, scriptCommand, scriptFile, type PlatformOptions } from "./platform.js"

/**
 * Exp2 check runner (DESIGN §8): runs the program under test, or a reference script, in a fresh directory that
 * holds only the check's input files, with a time limit. Two interfaces so the real run can swap the local process
 * for docker: CheckRunner for the program, ScriptSandbox for method B's reference scripts.
 */

export interface InputFile { path: string; content: string }
export interface CheckInput { args: string[]; files: InputFile[] }

/** A program to run checks against: argv prefix, and the directory whose source the code-fact test reads. */
export interface ProgramRef {
  id: string
  label: string
  command: string[]
  source_dir: string | null
  /** "null": the code-generated round-1 baseline; every runner answers it directly (exit 1, no output). */
  kind?: "program" | "null"
  /** Docker: a host directory holding the program, mounted read-only at this container path. */
  mount?: { host: string; container: string }
  /** Built with `go build -cover`: each run records the functions it executed (DESIGN §12h E4). */
  cover?: boolean
}

export interface RunOutput {
  exit_code: number | null
  stdout: string
  stderr: string
  /** Every file in the run directory afterwards, by relative path ("/"-separated). */
  files: Record<string, string>
  timed_out: boolean
  /** The run was stopped at a resource limit (BLOCK10 §9.2): what the program did on this input, not a failure of the run. */
  limit?: StoppedAt
  /** A program built to record coverage: the text profile of the blocks the run executed (DESIGN §12h E4). */
  coverage?: string
}

/** Which limit stopped a run, and how it read. */
export interface StoppedAt { kind: "memory" | "time" | "output"; detail: string }

/**
 * Limits on a run of the program under test (BLOCK10 §9.2), so one program cannot exhaust the host: memory (resident,
 * MiB), output (bytes kept of stdout and stderr each), processes. Time is the run's own timeout.
 */
export interface ResourceLimits { memoryMb: number; outputBytes: number; pids: number }

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = { memoryMb: 1024, outputBytes: 8 * 1024 * 1024, pids: 256 }

export interface CheckRunner {
  run(program: ProgramRef, input: CheckInput, timeoutMs: number): Promise<RunOutput>
  /** Many runs of one program at once (BLOCK11 §1): one container for a batch instead of one per run. */
  runBatch?(program: ProgramRef, inputs: readonly CheckInput[], timeoutMs: number): Promise<RunOutput[]>
  /** The string literals in the program's source: the code fact behind "this command or option is not there". */
  literals(program: ProgramRef): Set<string>
}

export interface ScriptResult { exit_code: number | null; stdout: string; stderr: string; timed_out: boolean; limit?: StoppedAt }

export interface ScriptSandbox {
  run(language: "python" | "node", code: string, files: InputFile[], timeoutMs: number): Promise<ScriptResult>
}

/**
 * Relative, inside the run directory, and writable by every runner's file system: no absolute path, no `..` or empty
 * part, no control character or character Windows refuses in a name (rep1q R6: a check's file named with its content,
 * "age\n1\n", crashed the round when its reference script's input was written). Anything else is refused before a file
 * is written.
 */
export function safePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/u.test(path)) return false
  if (/[\u0000-\u001f<>:"|?*]/u.test(path)) return false
  return !path.split(/[\\/]/u).some(part => part === ".." || part === "")
}

export function writeInputs(dir: string, files: InputFile[]): void {
  for (const f of files) {
    if (!safePath(f.path)) throw new Error(`Unsafe input path ${f.path}`)
    const target = resolve(dir, f.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, f.content, "utf8")
  }
}

export function collect(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name)
      if (statSync(full).isDirectory()) walk(full)
      else out[relative(dir, full).split(sep).join("/")] = readFileSync(full, "utf8")
    }
  }
  walk(dir)
  return out
}

/** Runs a command; a start the host blocks is tried again, then raised as EnvironmentBlocked (never a result). */
export async function execute(command: string[], cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv, spawnImpl: typeof nodeSpawn = nodeSpawn, limits?: Partial<ResourceLimits> & { watchMemory?: boolean }): Promise<ScriptResult> {
  for (let n = 1; ; n++) {
    const r = await executeOnce(command, cwd, timeoutMs, env, spawnImpl, limits)
    if (!r.blocked) return r.result
    if (n >= ENVIRONMENT_TRIES) throw new EnvironmentBlocked(`the host blocked ${command[0]} ${n} times: ${r.blocked}`)
  }
}

/** Resident memory of a process in MiB, from /proc (Linux); null where that is not available. */
export function residentMb(pid: number): number | null {
  try {
    const m = /^VmRSS:\s+(\d+)\s+kB/mu.exec(readFileSync(`/proc/${pid}/status`, "utf8"))
    return m ? Number(m[1]) / 1024 : null
  } catch { return null }
}

function executeOnce(command: string[], cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv, spawnImpl: typeof nodeSpawn, limits?: Partial<ResourceLimits> & { watchMemory?: boolean }): Promise<{ result: ScriptResult; blocked?: string }> {
  return new Promise((done, fail) => {
    // On Windows a blocked start throws "spawn UNKNOWN" here instead of emitting 'error': the same path either way.
    let child: ReturnType<typeof nodeSpawn>
    try { child = spawnImpl(command[0], command.slice(1), { cwd, env, stdio: ["ignore", "pipe", "pipe"] }) } catch (e) {
      if (isEnvironmentBlock(e)) done({ result: { exit_code: null, stdout: "", stderr: String(e), timed_out: false }, blocked: String(e) })
      else fail(e)
      return
    }
    let stdout = "", stderr = "", timedOut = false
    let stopped: StoppedAt | undefined
    const stop = (at: StoppedAt) => { if (!stopped) { stopped = at; child.kill("SIGKILL") } }
    // Output past the cap is not kept: the run is stopped there, as a program that floods its output.
    const cap = limits?.outputBytes
    const take = (kept: string, d: Buffer | string, stream: string) => {
      const more = kept + d
      if (cap && Buffer.byteLength(more) > cap) { stop({ kind: "output", detail: `${stream} passed ${cap} bytes` }); return more.slice(0, cap) }
      return more
    }
    child.stdout!.on("data", d => { stdout = take(stdout, d, "stdout") })
    child.stderr!.on("data", d => { stderr = take(stderr, d, "stderr") })
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL") }, timeoutMs)
    // A local run is watched for resident memory where the system shows it (Linux); a container has its own limit.
    const mb = limits?.memoryMb
    const watch = mb && limits?.watchMemory && child.pid ? setInterval(() => {
      const now = residentMb(child.pid!)
      if (now !== null && now > mb) stop({ kind: "memory", detail: `resident memory passed the ${mb} MiB limit` })
    }, 50) : undefined
    const end = () => { clearTimeout(timer); if (watch) clearInterval(watch) }
    child.on("error", e => {
      end()
      done({ result: { exit_code: null, stdout, stderr: stderr + String(e), timed_out: false }, ...(isEnvironmentBlock(e) ? { blocked: String(e) } : {}) })
    })
    child.on("close", code => {
      end()
      const limit = stopped ?? (timedOut ? { kind: "time" as const, detail: `no exit within ${timeoutMs} ms` } : undefined)
      done({ result: { exit_code: timedOut || stopped ? null : code, stdout, stderr, timed_out: timedOut, ...(limit ? { limit } : {}) } })
    })
  })
}

/** What the null baseline does for any call: exit 1, no output, the input files left as they were. */
export function nullRun(input: CheckInput): RunOutput {
  return { exit_code: 1, stdout: "", stderr: "", files: Object.fromEntries(input.files.map(f => [f.path.split(/[\\/]/u).join("/"), f.content])), timed_out: false }
}

/** Runs the program as a local process in a fresh temporary directory, removed afterwards. */
export class LocalProcessRunner implements CheckRunner {
  constructor(private readonly platform: PlatformOptions = {}, private readonly limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS) {}
  async run(program: ProgramRef, input: CheckInput, timeoutMs: number): Promise<RunOutput> {
    if (program.kind === "null") return nullRun(input)
    const dir = mkdtempSync(join(tmpdir(), "exp2-check-"))
    // Coverage counters go to a directory of their own, outside the run directory, so they are never an output.
    const cov = program.cover ? mkdtempSync(join(tmpdir(), "exp2-cov-")) : null
    try {
      writeInputs(dir, input.files)
      const result = await execute([...program.command, ...input.args], dir, timeoutMs, { ...minimalEnv(tmpdir(), this.platform), ...(cov ? { GOCOVERDIR: cov } : {}) }, nodeSpawn, { ...this.limits, watchMemory: true })
      const coverage = cov ? readCoverage(cov, this.platform) : undefined
      return { ...result, files: collect(dir), ...(coverage !== undefined ? { coverage } : {}) }
    } finally { rmSync(dir, { recursive: true, force: true }); if (cov) rmSync(cov, { recursive: true, force: true }) }
  }
  literals(program: ProgramRef): Set<string> {
    return program.source_dir ? sourceLiterals(program.source_dir) : new Set()
  }
  /** Local processes cost no container start: the runs go side by side. */
  async runBatch(program: ProgramRef, inputs: readonly CheckInput[], timeoutMs: number): Promise<RunOutput[]> {
    return mapPool(inputs, 4, input => this.run(program, input, timeoutMs))
  }
}

const SOURCE_EXTENSIONS = new Set([".go", ".js", ".mjs", ".cjs", ".ts", ".py", ".rs", ".java", ".c", ".h"])

/** String literals ("…", '…', `…`) in the source files under `dir`, skipping vendored and VCS directories. */
export function sourceLiterals(dir: string): Set<string> {
  const out = new Set<string>()
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      if (name === ".git" || name === "node_modules" || name === "vendor") continue
      const full = join(at, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (SOURCE_EXTENSIONS.has(extname(name))) {
        const text = readFileSync(full, "utf8")
        for (const m of text.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`([^`]*)`/gu)) out.add(m[1] ?? m[2] ?? m[3])
      }
    }
  }
  walk(dir)
  return out
}

/**
 * The round-1 baseline (DESIGN §8): a program the code writes itself, which exits 1 with no output for any call.
 * Its source holds no string literal, so no command or option of the requirements exists in it.
 */
export function nullBaseline(dir: string): ProgramRef {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, "baseline.mjs")
  writeFileSync(file, "process.exit(1)\n", "utf8")
  // Runners answer it directly; the file is there for anyone who wants to run it by hand.
  return { id: "baseline:null", label: "code-generated program: exit 1, no output", command: [process.execPath, file], source_dir: dir, kind: "null" }
}

/** Runs a reference script with the check's input files in a fresh directory, time-limited, minimal environment. */
export class LocalScriptSandbox implements ScriptSandbox {
  constructor(private readonly platform: PlatformOptions = {}) {}
  async run(language: "python" | "node", code: string, files: InputFile[], timeoutMs: number): Promise<ScriptResult> {
    const dir = mkdtempSync(join(tmpdir(), "exp2-ref-"))
    try {
      writeInputs(dir, files)
      const script = scriptFile(language)
      writeFileSync(join(dir, script), code, "utf8")
      // python -I: isolated mode, no user site or script-directory imports beyond the run directory itself.
      const command = scriptCommand(language, script, this.platform)
      const r = await execute(command, dir, timeoutMs, minimalEnv(tmpdir(), this.platform))
      // A missing interpreter is the host's, not the script's: raised, never told to the model as its script failing.
      const missing = interpreterMissing(command[0], r.exit_code, `${r.stderr}${r.stdout}`)
      if (missing) throw new EnvironmentUnavailable(missing)
      return r
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
}
