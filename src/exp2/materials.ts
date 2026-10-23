import type { CheckRecord } from "./checks.js"
import { invokesProgram } from "./review.js"
import type { CheckInput } from "./runner.js"

/**
 * What IC holds of a review besides the reply (batch C, effect 3): the leads it gave the reviewer (library checks with
 * their full input), the files the reviewer wrote in its session (from its patch and write tools, in order; deletions
 * are not followed, so a reviewer that cleans up before it ends loses nothing), and the commands it ran with their
 * output. From these, code rebuilds the input of an item the formalizer could not, deterministically: a lead the
 * item names, or the command the item quotes with the files it used, or a file an earlier command of the session
 * produced.
 */

export interface SessionFile { path: string; content: string }
export interface SessionCommand { command: string; output: string }
export interface ReviewMaterials {
  leads: { id: string; check: CheckRecord }[]
  files: SessionFile[]
  commands: SessionCommand[]
  /** Files a patch could not be applied to (their content is unknown), with why. */
  unreadable?: { path: string; why: string }[]
}

export const NO_MATERIALS: ReviewMaterials = { leads: [], files: [], commands: [] }

const unwrap = (v: unknown): Record<string, any> => {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, any>
  return (r.data && typeof r.data === "object" ? r.data : r) as Record<string, any>
}

/** A path as the session wrote it, relative to the review directory: separators made "/", the directory and "./" dropped. */
export function relativePath(path: string, dir?: string): string {
  let p = path.trim().replace(/\\/gu, "/")
  const d = dir?.replace(/\\/gu, "/").replace(/\/+$/u, "")
  if (d && p.toLowerCase().startsWith(`${d.toLowerCase()}/`)) p = p.slice(d.length + 1)
  // An absolute path under a review copy (…/review-copies/<label>/x) is the same file relative to that copy.
  const copy = /\/review-copies\/[^/]+\/(.+)$/u.exec(p)
  if (copy) p = copy[1]
  return p.replace(/^(?:\.\/)+/u, "")
}

/**
 * Applies a patch in the patch tool's format (`*** Begin Patch`, `*** Add File:`, `*** Update File:` with `@@`
 * hunks of context, `-` and `+` lines, `*** Delete File:`) to the files known so far. Deletions are ignored.
 */
export function applyPatchText(text: string, files: Map<string, string>, dir: string | undefined, unreadable: { path: string; why: string }[]): void {
  const lines = text.replace(/\r\n/gu, "\n").split("\n")
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const add = /^\*\*\* Add File: (.+)$/u.exec(line), upd = /^\*\*\* Update File: (.+)$/u.exec(line)
    if (add) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith("*** ")) { if (lines[i].startsWith("+")) body.push(lines[i].slice(1)); i++ }
      files.set(relativePath(add[1], dir), body.length ? `${body.join("\n")}\n` : "")
      continue
    }
    if (upd) {
      let path = relativePath(upd[1], dir)
      i++
      const move = i < lines.length ? /^\*\*\* Move to: (.+)$/u.exec(lines[i]) : null
      if (move) i++
      const hunks: string[][] = []
      while (i < lines.length && !lines[i].startsWith("*** ")) {
        if (lines[i].startsWith("@@")) hunks.push([])
        else if (hunks.length || /^[ +-]/u.test(lines[i])) { if (!hunks.length) hunks.push([]); hunks.at(-1)!.push(lines[i]) }
        i++
      }
      const now = files.get(path)
      if (now === undefined) { unreadable.push({ path, why: "updated by a patch before any content of it was seen" }); files.delete(path) }
      else {
        let cur = now.endsWith("\n") ? now.slice(0, -1).split("\n") : now.split("\n"), from = 0, ok = true
        for (const h of hunks) {
          const before = h.filter(l => !l.startsWith("+")).map(l => l.slice(1)), after = h.filter(l => !l.startsWith("-")).map(l => l.slice(1))
          let at = -1
          for (let k = from; k + before.length <= cur.length; k++) if (before.every((b, j) => cur[k + j] === b)) { at = k; break }
          if (at < 0 && before.length === 0) at = cur.length
          if (at < 0) { ok = false; break }
          cur = [...cur.slice(0, at), ...after, ...cur.slice(at + before.length)]
          from = at + after.length
        }
        if (ok) { if (move) { files.delete(path); path = relativePath(move[1], dir) }; files.set(path, `${cur.join("\n")}\n`) }
        else { unreadable.push({ path, why: "a hunk of a patch did not match the content seen" }); files.delete(path) }
      }
      continue
    }
    i++
  }
}

/** The files the reviewer wrote and the commands it ran, from the session's messages (either export shape). */
export function sessionMaterials(messages: unknown, dir?: string): Pick<ReviewMaterials, "files" | "commands" | "unreadable"> {
  const list = Array.isArray(messages) ? messages : Array.isArray(unwrap(messages).messages) ? unwrap(messages).messages : []
  const files = new Map<string, string>(), commands: SessionCommand[] = [], unreadable: { path: string; why: string }[] = []
  for (const m of (list as unknown[]).map(unwrap)) {
    for (const p of (Array.isArray(m.parts) ? m.parts : []) as Record<string, any>[]) {
      if (p?.type !== "tool") continue
      const tool = String(p.tool ?? p.name ?? "").toLowerCase()
      const state = (p.state ?? {}) as Record<string, any>
      const input = (state.input ?? p.input ?? {}) as Record<string, any>
      const status = state.status ?? p.status
      if (status && status !== "completed") continue
      if (/patch/u.test(tool)) { const text = input.patchText ?? input.patch ?? input.input; if (typeof text === "string") applyPatchText(text, files, dir, unreadable) }
      else if (tool === "write" && typeof (input.filePath ?? input.path) === "string" && typeof input.content === "string") files.set(relativePath(input.filePath ?? input.path, dir), input.content)
      else if (tool === "edit" && typeof (input.filePath ?? input.path) === "string") {
        const path = relativePath(input.filePath ?? input.path, dir), now = files.get(path)
        if (now === undefined || typeof input.oldString !== "string" || typeof input.newString !== "string" || !now.includes(input.oldString)) { if (now !== undefined) { unreadable.push({ path, why: "an edit did not match the content seen" }); files.delete(path) } }
        else files.set(path, input.replaceAll ? now.split(input.oldString).join(input.newString) : now.replace(input.oldString, input.newString))
      } else if (/bash|shell|sh$|exec|command/u.test(tool)) {
        const command = String(input.command ?? input.cmd ?? "")
        if (command) commands.push({ command, output: String(state.output ?? p.output ?? "") })
      }
    }
  }
  return { files: [...files].map(([path, content]) => ({ path, content })), commands, ...(unreadable.length ? { unreadable } : {}) }
}

/** Shell words of a command (quotes kept together, removed), up to the first separator (; && || | > <). */
function words(command: string): string[] {
  const out: string[] = []
  let cur = "", quote: string | null = null, any = false
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) { if (c === quote) quote = null; else cur += c; continue }
    if (c === "\"" || c === "'") { quote = c; any = true; continue }
    if (/\s/u.test(c)) { if (cur || any) out.push(cur); cur = ""; any = false; continue }
    if (c === ";" || c === "|" || c === ">" || c === "<" || (c === "&" && command[i + 1] === "&")) break
    cur += c
  }
  if (cur || any) out.push(cur)
  return out
}

/**
 * The arguments after the program in a command that runs it: PowerShell's `&`, environment assignments, `go run
 * <package>` and the program's own path (any name the reviewer built it under) are dropped. Null when the command
 * does not run the program.
 */
export function programArgs(command: string, binary: string): string[] | null {
  const seg = command.split(/;|&&|\|\|/u).map(x => x.trim()).find(x => invokesProgram(x, binary))
  if (!seg) return null
  let w = words(seg.replace(/^&\s+/u, ""))
  while (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(w[0])) w = w.slice(1)
  if (w[0] === "go" && w[1] === "run") return w.slice(3)
  return w.slice(1)
}

const looksLikeFile = (w: string) => /[\\/]/u.test(w) || /\.[A-Za-z0-9]{1,8}$/u.test(w)
const norm = (p: string) => relativePath(p)
const base = (p: string) => norm(p).split("/").pop()!

/** A session file a word names: the same relative path, else the one file with that name. */
function fileNamed(files: readonly SessionFile[], word: string): SessionFile | null {
  const exact = files.find(f => norm(f.path) === norm(word))
  if (exact) return exact
  const same = files.filter(f => base(f.path) === base(word))
  return same.length === 1 ? same[0] : null
}

/** How an item's input was rebuilt, or why it could not be (the detail of no_input says what was searched). */
export type InputSource =
  | { kind: "lead"; lead: string; check: CheckRecord }
  | { kind: "session"; input: CheckInput; produced: { path: string; by: string[] }[] }
  | { kind: "none"; why: string }

/** The role a path plays in a call: the option before it, else its position. */
const roleOf = (args: readonly string[], path: string) => { const i = args.findIndex(a => norm(a) === norm(path)); return i < 0 ? null : i > 0 && args[i - 1].startsWith("-") ? args[i - 1] : `#${i}` }

/**
 * An item's input from the materials (batch C, effect 3), in order:
 * 1. a lead the item's text names by id: the lead's check;
 * 2. the first command in the item's text (in backquotes) that runs the program, as the reviewer ran it. Its files
 *    are the session files its arguments name, and in turn the session files those name. When the reviewer's own run
 *    of that command is in the session, a file it named that the reviewer had not written either existed because an
 *    earlier command produced it (in another role than this call gives it: an earlier run writing this call's own
 *    output is not an input) and is produced again by the caller, or did not exist then either. When the command is
 *    not in the session, every file it names must be found, or nothing is rebuilt.
 */
export function inputFromMaterials(text: string, materials: ReviewMaterials, binary: string): InputSource {
  for (const l of materials.leads) if (new RegExp(`\\b${l.id}\\b`, "u").test(text)) return { kind: "lead", lead: l.id, check: l.check }
  const quoted = [...text.matchAll(/`([^`]+)`/gu)].map(m => m[1])
  const args = quoted.map(q => programArgs(q, binary)).find((a): a is string[] => !!a && a.length > 0)
  const searched = `leads given: ${materials.leads.map(l => l.id).join(", ") || "none"}; session files: ${materials.files.length}; session commands: ${materials.commands.length}`
  if (!args) return { kind: "none", why: `the item quotes no command that runs the program, and names no lead (${searched})` }
  const ran = materials.commands.map(c => programArgs(c.command, binary))
  const key = (a: readonly string[]) => JSON.stringify(a.map(norm))
  const own = ran.findIndex(a => !!a && key(a) === key(args))
  const files = new Map<string, string>(), produced: { path: string; by: string[] }[] = [], missing: string[] = []
  const take = (f: SessionFile, as: string) => { if (!files.has(as)) { files.set(as, f.content); for (const g of materials.files) if (g !== f && new RegExp(`(^|[^A-Za-z0-9_.-])${base(g.path).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}([^A-Za-z0-9_-]|$)`, "u").test(f.content)) take(g, norm(g.path)) } }
  for (const w of args.filter(looksLikeFile)) {
    const f = fileNamed(materials.files, w)
    if (f) { take(f, norm(w)); continue }
    if (own < 0) { missing.push(w); continue }
    const role = roleOf(args, w)
    const by = ran.slice(0, own).reverse().find((a): a is string[] => !!a && a.some(x => norm(x) === norm(w)) && roleOf(a, w) !== role)
    if (by) produced.push({ path: norm(w), by })
  }
  if (missing.length) return { kind: "none", why: `the command it quotes (${JSON.stringify(args)}) is not among the session's commands, and ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} in no material (${searched})` }
  return { kind: "session", input: { args, files: [...files].map(([path, content]) => ({ path, content })) }, produced }
}

/** The input of a command of the session, its files from the session files (for a producer run again). */
export function sessionInput(args: string[], materials: ReviewMaterials): CheckInput {
  const files: { path: string; content: string }[] = []
  for (const w of args.filter(looksLikeFile)) { const f = fileNamed(materials.files, w); if (f && !files.some(x => x.path === norm(w))) files.push({ path: norm(w), content: f.content }) }
  return { args, files }
}
