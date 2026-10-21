import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { exeName, goCommand, guardedSync, type PlatformOptions } from "./platform.js"

/**
 * Code anchors (DESIGN §3, §7): where objects live in the program, taken from the Go AST by a small helper
 * (src/exp2/go/anchors). Code reads anchors and their hashes only; which object an anchor belongs to comes from
 * dispatch names equal to object names and from verified execution steps.
 */

export interface Anchor {
  id: string
  kind: "file" | "func" | "type" | "dispatch"
  name: string
  file: string
  start_line: number
  end_line: number
  hash: string
}

export interface AnchorExtractor { extract(dir: string): Anchor[] }

/** Finds a Go helper's source (src/exp2/go/<name>) by walking up from this module to the package root. */
export function helperSource(name = "anchors"): string {
  let at = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    const candidate = join(at, "src", "exp2", "go", name)
    if (existsSync(join(candidate, "main.go"))) return candidate
    at = dirname(at)
  }
  throw new Error(`${name} helper source (src/exp2/go/${name}) not found`)
}

/** Builds a Go helper once per source version (cached by hash under the temporary directory) and returns its path. */
export function buildGoHelper(source: string, name: string, platform: PlatformOptions = {}): string {
  const main = readFileSync(join(source, "main.go"))
  const out = join(tmpdir(), `exp2-${name}`, createHash("sha256").update(main).digest("hex").slice(0, 16))
  mkdirSync(out, { recursive: true })
  const bin = join(out, exeName(name, platform))
  if (!existsSync(bin)) guardedSync(`the ${name} helper build`, () => execFileSync(goCommand(platform), ["build", "-o", bin, "."], { cwd: source, stdio: ["ignore", "pipe", "pipe"] }))
  return bin
}

/** Builds the Go helper once per source version (cached by hash) and runs it on a directory. */
export class GoAnchorExtractor implements AnchorExtractor {
  private binary: string | null = null
  constructor(private readonly source = helperSource(), private readonly platform: PlatformOptions = {}) {}
  private build(): string {
    return this.binary ??= buildGoHelper(this.source, "anchors", this.platform)
  }
  extract(dir: string): Anchor[] {
    const bin = this.build()
    return JSON.parse(guardedSync("the anchors helper", () => execFileSync(bin, [resolve(dir)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }))) as Anchor[]
  }
}

export interface AnchorDiff { added: string[]; removed: string[]; changed: string[] }

/** Anchors added, removed, or whose source text changed (by hash). File anchors are left out: any edit touches them. */
export function diffAnchors(before: readonly Anchor[], after: readonly Anchor[]): AnchorDiff {
  const b = new Map(before.filter(a => a.kind !== "file").map(a => [a.id, a.hash]))
  const a = new Map(after.filter(x => x.kind !== "file").map(x => [x.id, x.hash]))
  return {
    added: [...a.keys()].filter(id => !b.has(id)).sort(),
    removed: [...b.keys()].filter(id => !a.has(id)).sort(),
    changed: [...a.keys()].filter(id => b.has(id) && b.get(id) !== a.get(id)).sort(),
  }
}

export const touched = (d: AnchorDiff): string[] => [...d.added, ...d.removed, ...d.changed]
