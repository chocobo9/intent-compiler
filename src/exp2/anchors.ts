import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

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

/** Finds the helper's source by walking up from this module to the package root. */
function helperSource(): string {
  let at = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    const candidate = join(at, "src", "exp2", "go", "anchors")
    if (existsSync(join(candidate, "main.go"))) return candidate
    at = dirname(at)
  }
  throw new Error("anchors helper source (src/exp2/go/anchors) not found")
}

/** Builds the Go helper once per source version (cached by hash) and runs it on a directory. */
export class GoAnchorExtractor implements AnchorExtractor {
  private binary: string | null = null
  constructor(private readonly source = helperSource(), private readonly go = "go") {}
  private build(): string {
    if (this.binary) return this.binary
    const main = readFileSync(join(this.source, "main.go"))
    const out = join(tmpdir(), "exp2-anchors", createHash("sha256").update(main).digest("hex").slice(0, 16))
    mkdirSync(out, { recursive: true })
    const bin = join(out, process.platform === "win32" ? "anchors.exe" : "anchors")
    if (!existsSync(bin)) execFileSync(this.go, ["build", "-o", bin, "."], { cwd: this.source, stdio: ["ignore", "pipe", "pipe"] })
    this.binary = bin
    return bin
  }
  extract(dir: string): Anchor[] {
    return JSON.parse(execFileSync(this.build(), [resolve(dir)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })) as Anchor[]
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
