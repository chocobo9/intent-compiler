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
