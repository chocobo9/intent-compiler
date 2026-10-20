import { spawnSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import type { BuildResult } from "./execution.js"

/**
 * Builds the Go program of a work tree into a directory outside it (so nothing built is ever committed) and
 * returns the program to run checks against. The source directory stays the work tree, for the code-fact test.
 */
export function goBuilder(outRoot: string, go = "go"): (workdir: string, label: string) => BuildResult {
  return (workdir, label) => {
    const out = join(outRoot, label.replace(/[^A-Za-z0-9._-]/gu, "_"))
    mkdirSync(out, { recursive: true })
    const bin = join(out, process.platform === "win32" ? "dpipe.exe" : "dpipe")
    const r = spawnSync(go, ["build", "-o", bin, "./..."], { cwd: workdir, encoding: "utf8", env: { ...process.env, GOFLAGS: "-mod=mod" } })
    const output = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error) : ""}`
    if (r.status !== 0) return { ok: false, output, program: null }
    return { ok: true, output, program: { id: label, label: `build of ${label}`, command: [bin], source_dir: workdir } }
  }
}
