/**
 * Everything that differs between Windows and Linux in how exp2 starts a program, in one place (DESIGN §12a,
 * second addition): executable names, interpreters, the command line of a script, and the environment a child gets.
 * Nothing here relies on a shebang or on the shell: an interpreter is always named and called directly.
 */

/**
 * The host refused to start a program (DESIGN §12b item 6): Windows Application Control / Smart App Control blocks a
 * freshly built unsigned executable, and spawn fails with UNKNOWN. An environment error: no step failed and no
 * attempt is used; the serial stops and reports.
 */
export class EnvironmentBlocked extends Error {}

/**
 * The environment is down for now (DESIGN §12j.5, batch 4): the docker daemon cannot be reached, a review copy cannot
 * be made, a script interpreter is missing. No model and no program did anything wrong, so nothing is sent to anyone:
 * the serial keeps what the attempt spent, goes back to the checkpoint, waits and runs the round again.
 */
export class EnvironmentUnavailable extends EnvironmentBlocked {}

/**
 * The docker client's own words when it cannot reach the daemon. The first is rep1f's, verbatim on Windows with Docker
 * Desktop stopped ("failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine; check if the
 * path is correct and if the daemon is running: open //./pipe/dockerDesktopLinuxEngine: The system cannot find the
 * file specified."); the others are the same condition in older clients and on Linux.
 */
const DOCKER_DOWN = /failed to connect to the docker API|Cannot connect to the Docker daemon|error during connect|docker daemon is not running/iu

/**
 * Whether a docker client call failed because docker itself is not there: the daemon unreachable, or the client not
 * installed (spawn ENOENT). Returns what to report, or null for any other outcome (the program's or the build's own).
 */
export function dockerDown(exitCode: number | null, output: string, error?: unknown): string | null {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === "ENOENT" || /spawn \S*docker\S* ENOENT/iu.test(output)) return `the docker client cannot be started: ${String(error ?? output).trim().slice(0, 300)}`
  if (exitCode !== 0 && DOCKER_DOWN.test(output)) return `the docker daemon cannot be reached: ${output.trim().slice(0, 300)}`
  return null
}

/**
 * Whether a script's interpreter is missing: not found on the host (spawn ENOENT, or the Windows Store placeholder that
 * answers `python`), or not in the image (the container cannot exec it). Returns what to report, or null.
 */
export function interpreterMissing(interpreter: string, exitCode: number | null, output: string): string | null {
  const missing = (exitCode === null && output.includes(`spawn ${interpreter} ENOENT`))
    || /Python was not found; run without arguments to install from the Microsoft Store/iu.test(output)
    || ((exitCode === 126 || exitCode === 127) && output.includes(interpreter) && /no such file or directory|executable file not found/iu.test(output))
  return missing ? `the script interpreter ${interpreter} is missing: ${output.trim().slice(0, 300)}` : null
}

/** A local file or directory the run needs (state, recording, output) cannot be written: an environment error too. */
export class LocalWriteFailed extends EnvironmentBlocked {}

/** Runs a local write; a failure becomes LocalWriteFailed naming what was written where. */
export function writing<T>(what: string, path: string, f: () => T): T {
  try { return f() } catch (e) { throw new LocalWriteFailed(`cannot write ${what} at ${path}: ${(e as Error).message}`) }
}

/** Whether a spawn failure (or its output) is the host blocking the program. */
export function isEnvironmentBlock(e: unknown, output = ""): boolean {
  const code = (e as NodeJS.ErrnoException | undefined)?.code
  return code === "UNKNOWN" || /Application Control policy|spawn UNKNOWN/iu.test(`${output} ${e ? String(e) : ""}`)
}

/** Spawning again when the host blocked it: Smart App Control blocks at random, so a few tries may get through. */
export const ENVIRONMENT_TRIES = 3

/**
 * A synchronous start (execFileSync, spawnSync) under the same rule: a host block, thrown or returned, is tried
 * again, then raised as EnvironmentBlocked; any other error passes through unchanged.
 */
export function guardedSync<T>(what: string, start: () => T, blockedResult: (r: T) => string | null = () => null): T {
  for (let n = 1; ; n++) {
    let blocked: string | null
    try {
      const r = start()
      blocked = blockedResult(r)
      if (blocked === null) return r
    } catch (e) {
      const output = String((e as { stderr?: unknown }).stderr ?? "")
      if (!isEnvironmentBlock(e, output)) throw e
      blocked = String(e)
    }
    if (n >= ENVIRONMENT_TRIES) throw new EnvironmentBlocked(`the host blocked ${what} ${n} times: ${blocked.slice(0, 300)}`)
  }
}

export interface PlatformOptions {
  platform?: NodeJS.Platform
  /** The Python interpreter: a command on PATH or a full path. */
  python?: string
  /** The Go toolchain: a command on PATH or a full path. */
  go?: string
  /** The Node runtime; defaults to the one running this process. */
  node?: string
  env?: NodeJS.ProcessEnv
}

const platformOf = (o: PlatformOptions) => o.platform ?? process.platform

/** A built program's file name: `dpipe.exe` on Windows, `dpipe` elsewhere. */
export function exeName(base: string, o: PlatformOptions = {}): string {
  return platformOf(o) === "win32" && !base.toLowerCase().endsWith(".exe") ? `${base}.exe` : base
}

/**
 * The Python interpreter. Explicit option, then EXP2_PYTHON, then the platform default: `python` on Windows (where
 * `python3` is the Microsoft Store placeholder that runs nothing), `python3` elsewhere.
 */
export function pythonCommand(o: PlatformOptions = {}): string {
  const env = o.env ?? process.env
  return o.python ?? env.EXP2_PYTHON ?? (platformOf(o) === "win32" ? "python" : "python3")
}

export function goCommand(o: PlatformOptions = {}): string {
  return o.go ?? (o.env ?? process.env).EXP2_GO ?? "go"
}

export function nodeCommand(o: PlatformOptions = {}): string {
  return o.node ?? process.execPath
}

/** The command line that runs a script file with its interpreter (never the script itself). */
export function scriptCommand(language: "python" | "node", script: string, o: PlatformOptions = {}): string[] {
  return language === "python" ? [pythonCommand(o), "-I", script] : [nodeCommand(o), script]
}

/** The reference script's file name for a language. */
export function scriptFile(language: "python" | "node"): string {
  return language === "python" ? "__reference__.py" : "__reference__.mjs"
}

/**
 * The environment a run gets: only what programs need to start. On Windows that includes the system variables
 * without which many programs (Go builds among them) fail: SystemRoot, TEMP, LOCALAPPDATA and the like.
 */
export function minimalEnv(home: string, o: PlatformOptions = {}): NodeJS.ProcessEnv {
  const env = o.env ?? process.env
  const pick = (names: string[]) => Object.fromEntries(names.flatMap(n => {
    const key = Object.keys(env).find(k => k.toLowerCase() === n.toLowerCase())
    return key && env[key] !== undefined ? [[n, env[key] as string]] : []
  }))
  if (platformOf(o) === "win32") {
    return { ...pick(["PATH", "PATHEXT", "SystemRoot", "SystemDrive", "ComSpec", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "ProgramData", "ProgramFiles"]), HOME: home }
  }
  return { ...pick(["PATH", "TMPDIR"]), LANG: "C.UTF-8", HOME: home }
}
