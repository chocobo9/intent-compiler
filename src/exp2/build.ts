import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import type { BuildResult } from "./execution.js"
import { exeName, goCommand, guardedSync, isEnvironmentBlock, type PlatformOptions } from "./platform.js"
import { execute } from "./runner.js"

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
    const text = (r: SpawnSyncReturns<string>) => `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error) : ""}`
    const r = guardedSync("the build", () => spawnSync(goCommand(platform), ["build", "-o", bin, "./..."], { cwd: workdir, encoding: "utf8", env: { ...process.env, GOFLAGS: "-mod=mod" } }), r => isEnvironmentBlock(r.error, text(r)) ? text(r) : null)
    const output = text(r)
    if (r.status !== 0) return { ok: false, output, program: null }
    return { ok: true, output, program: { id: label, label: `build of ${label}`, command: [bin], source_dir: workdir } }
  }
}

/** The same build without blocking (BLOCK10 §9.1): mutants are built side by side. Same command, same result. */
export function goBuilderAsync(outRoot: string, platform: PlatformOptions = {}, binary = "app", timeoutMs = 10 * 60_000): (workdir: string, label: string) => Promise<BuildResult> {
  return async (workdir, label) => {
    const out = join(outRoot, label.replace(/[^A-Za-z0-9._-]/gu, "_"))
    mkdirSync(out, { recursive: true })
    const bin = join(out, exeName(binary, platform))
    const r = await execute([goCommand(platform), "build", "-o", bin, "./..."], workdir, timeoutMs, { ...process.env, GOFLAGS: "-mod=mod" })
    const output = `${r.stdout}${r.stderr}`
    if (r.exit_code !== 0) return { ok: false, output, program: null }
    return { ok: true, output, program: { id: label, label: `build of ${label}`, command: [bin], source_dir: workdir } }
  }
}
