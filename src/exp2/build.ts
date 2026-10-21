import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import type { BuildResult } from "./execution.js"
import { ENVIRONMENT_TRIES, EnvironmentBlocked, exeName, goCommand, isEnvironmentBlock, type PlatformOptions } from "./platform.js"

/**
 * The program name the requirements' build command gives (`go build -o <name> …`), from the first round that states
 * one; null when none does. The name is read from the text, never assumed (DESIGN §12b item 9).
 */
export function binaryFromSource(texts: readonly string[]): string | null {
  for (const text of texts) {
    const m = /\bgo\s+build\b[^`\n]*?\s-o\s+([^\s`'"]+)/u.exec(text)
    if (m) return m[1].replace(/^\.?[\\/]/u, "").split(/[\\/]/u).pop()!.replace(/\.exe$/iu, "") || null
  }
  return null
}

/**
 * Builds the Go program of a work tree into a directory outside it (so nothing built is ever committed) and
 * returns the program to run checks against. The source directory stays the work tree, for the code-fact test.
 */
export function goBuilder(outRoot: string, platform: PlatformOptions = {}, binary = "app"): (workdir: string, label: string) => BuildResult {
  return (workdir, label) => {
    const out = join(outRoot, label.replace(/[^A-Za-z0-9._-]/gu, "_"))
    mkdirSync(out, { recursive: true })
    const bin = join(out, exeName(binary, platform))
    let r: SpawnSyncReturns<string>, output: string
    for (let n = 1; ; n++) {
      r = spawnSync(goCommand(platform), ["build", "-o", bin, "./..."], { cwd: workdir, encoding: "utf8", env: { ...process.env, GOFLAGS: "-mod=mod" } })
      output = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error) : ""}`
      if (!isEnvironmentBlock(r.error, output)) break
      if (n >= ENVIRONMENT_TRIES) throw new EnvironmentBlocked(`the host blocked the build ${n} times: ${output.trim().slice(0, 300)}`)
    }
    if (r.status !== 0) return { ok: false, output, program: null }
    return { ok: true, output, program: { id: label, label: `build of ${label}`, command: [bin], source_dir: workdir } }
  }
}
