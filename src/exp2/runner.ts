import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, extname, join, relative, resolve, sep } from "node:path"
import { ENVIRONMENT_TRIES, EnvironmentBlocked, isEnvironmentBlock, minimalEnv, scriptCommand, scriptFile, type PlatformOptions } from "./platform.js"

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
}

export interface RunOutput {
  exit_code: number | null
  stdout: string
  stderr: string
  /** Every file in the run directory afterwards, by relative path ("/"-separated). */
  files: Record<string, string>
  timed_out: boolean
}

export interface CheckRunner {
  run(program: ProgramRef, input: CheckInput, timeoutMs: number): Promise<RunOutput>
  /** The string literals in the program's source: the code fact behind "this command or option is not there". */
  literals(program: ProgramRef): Set<string>
}

export interface ScriptResult { exit_code: number | null; stdout: string; stderr: string; timed_out: boolean }

export interface ScriptSandbox {
  run(language: "python" | "node", code: string, files: InputFile[], timeoutMs: number): Promise<ScriptResult>
}

/** Relative, inside the run directory, no `..`: anything else is refused before a file is written. */
export function safePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/u.test(path)) return false
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
export async function execute(command: string[], cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv): Promise<ScriptResult> {
  for (let n = 1; ; n++) {
    const r = await executeOnce(command, cwd, timeoutMs, env)
    if (!r.blocked) return r.result
    if (n >= ENVIRONMENT_TRIES) throw new EnvironmentBlocked(`the host blocked ${command[0]} ${n} times: ${r.blocked}`)
  }
}

function executeOnce(command: string[], cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv): Promise<{ result: ScriptResult; blocked?: string }> {
  return new Promise(done => {
    const child = spawn(command[0], command.slice(1), { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = "", stderr = "", timedOut = false
    child.stdout.on("data", d => { stdout += d })
    child.stderr.on("data", d => { stderr += d })
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL") }, timeoutMs)
    child.on("error", e => {
      clearTimeout(timer)
      done({ result: { exit_code: null, stdout, stderr: stderr + String(e), timed_out: false }, ...(isEnvironmentBlock(e) ? { blocked: String(e) } : {}) })
    })
    child.on("close", code => { clearTimeout(timer); done({ result: { exit_code: timedOut ? null : code, stdout, stderr, timed_out: timedOut } }) })
  })
}

/** What the null baseline does for any call: exit 1, no output, the input files left as they were. */
export function nullRun(input: CheckInput): RunOutput {
  return { exit_code: 1, stdout: "", stderr: "", files: Object.fromEntries(input.files.map(f => [f.path.split(/[\\/]/u).join("/"), f.content])), timed_out: false }
}

/** Runs the program as a local process in a fresh temporary directory, removed afterwards. */
export class LocalProcessRunner implements CheckRunner {
  constructor(private readonly platform: PlatformOptions = {}) {}
  async run(program: ProgramRef, input: CheckInput, timeoutMs: number): Promise<RunOutput> {
    if (program.kind === "null") return nullRun(input)
    const dir = mkdtempSync(join(tmpdir(), "exp2-check-"))
    try {
      writeInputs(dir, input.files)
      const result = await execute([...program.command, ...input.args], dir, timeoutMs, minimalEnv(tmpdir(), this.platform))
      return { ...result, files: collect(dir) }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  literals(program: ProgramRef): Set<string> {
    return program.source_dir ? sourceLiterals(program.source_dir) : new Set()
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
      return await execute(scriptCommand(language, script, this.platform), dir, timeoutMs, minimalEnv(tmpdir(), this.platform))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
}
