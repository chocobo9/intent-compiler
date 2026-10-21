import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ProgramRef } from "../../src/exp2/runner.js"
import { blake2b256Hex } from "./blake2b.js"

/**
 * Small stand-ins for the program under test, written as Node scripts. Each variant is generated with only the code
 * it has, so a missing command is missing from the source too (the code-fact test reads string literals).
 * They implement a slice of dpipe: verify, transform with filter (and normalize from R2), profile (from R2).
 */

export interface Variant {
  normalize?: "population" | "sample"
  profile?: boolean
  /** "spec" prints `ERROR: file not found: <path>`; "wrong" prints another wording. */
  errors?: "spec" | "wrong"
  reconcile?: boolean
  /** Whether transform writes the <output>.sha256 sidecar (R1 yes; R5 withdrew it). Default true. */
  sidecar?: boolean
  /** The digest verify compares: SHA-256 (R1) or BLAKE2b-256 (R5 on). Default sha256. */
  checksum?: "sha256" | "blake2b"
  /** A dispatcher that knows every command and option but does nothing and exits 0. */
  shell?: boolean
}

const SHELL = `
const [cmd, ...rest] = process.argv.slice(2)
const known = ["verify", "transform", "profile", "--input", "--output", "--recipe", "--seed", "--file", "--checksum", "filter", "normalize"]
if (!known.includes(cmd)) { process.stderr.write("ERROR: unknown command\\n"); process.exit(1) }
process.exit(0)
`

function source(v: Variant): string {
  const notFound = v.errors === "wrong" ? `"error: cannot open " + p` : `"ERROR: file not found: " + p`
  const parts: string[] = [`
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
const fail = (msg) => { process.stderr.write(msg + "\\n"); process.exit(1) }
const read = (p) => { if (!existsSync(p)) fail(${notFound}); return readFileSync(p, "utf8") }
const opts = (args) => { const o = {}; for (let i = 0; i < args.length; i += 2) o[args[i]] = args[i + 1]; return o }
const csv = (text) => { const [h, ...rows] = text.trim().split("\\n").map(l => l.split(",")); return { header: h, rows } }
const writeCsv = (p, t) => { const body = [t.header, ...t.rows].map(r => r.join(",")).join("\\n") + "\\n"; writeFileSync(p, body)${v.sidecar === false ? "" : `; writeFileSync(p + ".sha256", createHash("sha256").update(body).digest("hex") + "\\n")`} }
const col = (t, name) => { const i = t.header.indexOf(name); if (i < 0) fail("ERROR: invalid recipe: column " + name + " not found"); return i }
const fmt = (x) => String(x)
const ops = {}
ops["filter"] = (t, op) => {
  const i = col(t, op.column)
  const test = { gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b, eq: (a, b) => a === b, neq: (a, b) => a !== b }[op.condition]
  return { header: t.header, rows: t.rows.filter(r => test(Number(r[i]), op.threshold)) }
}
`]
  if (v.normalize) parts.push(`
ops["normalize"] = (t, op) => {
  const i = col(t, op.column)
  const xs = t.rows.map(r => r[i]).filter(c => c !== "" && !Number.isNaN(Number(c))).map(Number)
  const n = xs.length, mean = xs.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (${v.normalize === "sample" ? "n - 1" : "n"}))
  const min = Math.min(...xs), max = Math.max(...xs)
  const f = (c) => {
    if (c === "" || Number.isNaN(Number(c))) return ""
    const x = Number(c)
    if (op.method === "zscore") return n < 2 || sd === 0 ? "0" : fmt((x - mean) / sd)
    return max === min ? "0" : fmt((x - min) / (max - min))
  }
  return { header: [...t.header, op.as], rows: t.rows.map(r => [...r, f(r[i])]) }
}
`)
  parts.push(`
const commands = {}
${v.checksum === "blake2b" ? `const blake2b256Hex = ${blake2b256Hex.toString()}\n` : ""}commands["verify"] = (o) => {
  const actual = ${v.checksum === "blake2b" ? `blake2b256Hex(read(o["--file"]))` : `createHash("sha256").update(read(o["--file"])).digest("hex")`}
  const expected = read(o["--checksum"]).trim()
  if (actual === expected) { process.stdout.write("VERIFIED\\n"); process.exit(0) }
  process.stdout.write("MISMATCH expected=" + expected + " actual=" + actual + "\\n"); process.exit(1)
}
commands["transform"] = (o) => {
  const seed = BigInt(o["--seed"] ?? "0")
  let t = csv(read(o["--input"]))
  let recipe
  try { recipe = JSON.parse(read(o["--recipe"])) } catch { fail("ERROR: malformed JSON: " + o["--recipe"]) }
  for (const op of recipe) { if (!ops[op.op]) fail("ERROR: invalid recipe: unknown op " + op.op); t = ops[op.op](t, op) }
  writeCsv(o["--output"], t)
}
`)
  if (v.profile) parts.push(`
commands["profile"] = (o) => {
  const t = csv(read(o["--input"]))
  const columns = t.header.map((name, i) => {
    const vals = t.rows.map(r => r[i]).filter(c => c !== "")
    const numeric = vals.length > 0 && vals.every(c => !Number.isNaN(Number(c)))
    const entry = { name, type: numeric ? (vals.every(c => /^-?\\d+$/.test(c)) ? "int" : "float") : "string", count: vals.length, null_count: t.rows.length - vals.length, unique: new Set(vals).size }
    if (numeric) {
      const xs = vals.map(Number), n = xs.length, mean = xs.reduce((a, b) => a + b, 0) / n
      Object.assign(entry, { min: Math.min(...xs), max: Math.max(...xs), mean, stddev: Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n) })
    }
    return entry
  })
  writeFileSync(o["--output"], JSON.stringify({ row_count: t.rows.length, columns }, null, 2) + "\\n")
}
`)
  if (v.reconcile) parts.push(`
commands["reconcile"] = (o) => {
  const load = (p) => { const text = read(p); try { return JSON.parse(text).files } catch { fail("ERROR: invalid manifest: " + p) } }
  const left = new Map(load(o["--left"]).map(f => [f.path, f.checksum])), right = new Map(load(o["--right"]).map(f => [f.path, f.checksum]))
  const out = { added: [], removed: [], modified: [], unchanged: [] }
  for (const [p, c] of right) if (!left.has(p)) out.added.push(p); else (left.get(p) === c ? out.unchanged : out.modified).push(p)
  for (const p of left.keys()) if (!right.has(p)) out.removed.push(p)
  for (const k of Object.keys(out)) out[k].sort()
  out.summary = { total_left: left.size, total_right: right.size, added: out.added.length, removed: out.removed.length, modified: out.modified.length, unchanged: out.unchanged.length }
  writeFileSync(o["--output"], JSON.stringify(out, null, 2) + "\\n")
}
`)
  parts.push(`
const [cmd, ...rest] = process.argv.slice(2)
if (!commands[cmd]) fail("ERROR: unknown command " + cmd)
commands[cmd](opts(rest))
`)
  return parts.join("")
}

export function writeProgram(dir: string, id: string, label: string, variant: Variant): ProgramRef {
  const home = join(dir, id)
  mkdirSync(home, { recursive: true })
  const file = join(home, "main.mjs")
  writeFileSync(file, variant.shell ? SHELL : source(variant), "utf8")
  return { id, label, command: [process.execPath, file], source_dir: home }
}
