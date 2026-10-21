import { activeChecks, DEFAULT_TOLERANCE, sameValue, type Assertion, type CheckEvent, type CheckRecord, type CodeFacts, type Strength, type Target } from "./checks.js"
import type { Registry } from "./registry.js"
import type { CheckRunner, ProgramRef, RunOutput } from "./runner.js"

/**
 * Exp2 check library, run and verdict (DESIGN §8, BLOCK9 §2.3). A check is run on a program in a fresh directory,
 * every assertion compared on its own (JSON parsed first, numbers within a tolerance). A failure gets a cause before
 * it counts. Not landed: a crash, a missing command or option, a wrong value, a refused input the check holds valid.
 * Disputed: code sees evidence against the check itself (the expected value appears elsewhere in the output; the
 * program names a missing input the check did not give), or the executor contests it; a model call settles it
 * against the text. Unknown: a timeout, an unstated reading. Object status is recomputed from the runs every round.
 */

export interface AssertionResult { id: string; ok: boolean; actual: unknown; role: Assertion["role"] }

export type FailureClass = "not_landed" | "unknown" | "disputed"
export type FailureReason =
  | "value_mismatch" | "missing_name" | "still_present" | "crash" | "refused" | "timeout" | "reading"
  | "position" | "input_incomplete" | "contested"
  /** Kept for runs recorded before block 9. */
  | "rejected" | "other_error_rule"

/** The kinds of dispute: evidence code sees against a check, or the executor's contest. */
export type DisputeKind = "position" | "input_incomplete" | "contested"

export interface Failure {
  class: FailureClass
  reason: FailureReason
  detail: string
  /** The roles of the assertions that failed: business counts against the check's object, convention against `uses`. */
  roles: Assertion["role"][]
}

export interface CheckRun {
  check: string
  round: number
  program: string
  /** pass: holds-checks satisfied, withdrawn-checks not satisfied. */
  outcome: "pass" | "fail"
  assertions: AssertionResult[]
  exit_code: number | null
  stderr_head: string
  stdout_head?: string
  failure: Failure | null
  /** The round's verdict run (on the round's final program), as against a probe on another program. */
  verdict?: boolean
}

const MISSING = Symbol("missing")

function lines(text: string): string[] { return text.split(/\r?\n/u) }

/** A small RFC 4180 reader: quoted fields, doubled quotes, \n or \r\n rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = "", quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === "\"" && text[i + 1] === "\"") { field += "\""; i++ }
      else if (ch === "\"") quoted = false
      else field += ch
    } else if (ch === "\"") quoted = true
    else if (ch === ",") { row.push(field); field = "" }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(field); rows.push(row); row = []; field = ""
    } else field += ch
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row) }
  return rows
}

function pointer(doc: unknown, ptr: string): unknown {
  if (ptr === "") return doc
  let at: unknown = doc
  for (const raw of ptr.split("/").slice(1)) {
    const key = raw.replace(/~1/gu, "/").replace(/~0/gu, "~")
    if (Array.isArray(at) && /^\d+$/u.test(key)) at = at[Number(key)]
    else if (at && typeof at === "object" && Object.prototype.hasOwnProperty.call(at, key)) at = (at as Record<string, unknown>)[key]
    else return MISSING
    if (at === undefined) return MISSING
  }
  return at
}

export function actualOf(target: Target, out: RunOutput): unknown {
  const file = (p: string | null) => (p !== null && p in out.files ? out.files[p] : MISSING) as string | typeof MISSING
  switch (target.kind) {
    case "exit_code": return out.exit_code
    case "stdout": return out.stdout
    case "stderr": return out.stderr
    case "stdout_line": return lines(out.stdout)[target.line! - 1] ?? MISSING
    case "stderr_line": return lines(out.stderr)[target.line! - 1] ?? MISSING
    case "file": return file(target.path)
    case "file_line": { const f = file(target.path); return f === MISSING ? MISSING : lines(f)[target.line! - 1] ?? MISSING }
    case "file_exists": return target.path! in out.files
    case "json": {
      const text = target.path === "-" ? out.stdout : file(target.path)
      if (text === MISSING) return MISSING
      try { return pointer(JSON.parse(text), target.pointer ?? "") } catch { return MISSING }
    }
    case "csv_cell": {
      const f = file(target.path)
      if (f === MISSING) return MISSING
      const rows = parseCsv(f)
      const col = rows[0]?.indexOf(target.column!) ?? -1
      const row = rows[target.line!]
      return col < 0 || !row || row[col] === undefined ? MISSING : row[col]
    }
  }
}

export function compare(assertions: readonly Assertion[], out: RunOutput): AssertionResult[] {
  return assertions.map(a => {
    const actual = actualOf(a.target, out)
    const ok = actual !== MISSING && sameValue(a.expect, actual, a.tolerance ?? DEFAULT_TOLERANCE)
    return { id: a.id, ok, actual: actual === MISSING ? "(missing)" : actual, role: a.role }
  })
}

/** Names the code-fact test looks for: the command, the options, and object names given as input values. */
function invokedNames(check: CheckRecord, registry: Registry): string[] {
  const [first, ...rest] = check.input.args
  const names = [...(first && !first.startsWith("-") ? [first] : []), ...rest.filter(a => /^--?[A-Za-z]/u.test(a)).map(a => a.split("=")[0])]
  const objectNames = new Set([...registry.objects.values()].map(o => o.name))
  const values = (v: unknown): string[] => typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(values) : v && typeof v === "object" ? Object.values(v).flatMap(values) : []
  for (const f of check.input.files) if (f.path.endsWith(".json")) { try { names.push(...values(JSON.parse(f.content)).filter(v => objectNames.has(v))) } catch { /* malformed on purpose */ } }
  return [...new Set(names)]
}

function hasLiteral(literals: Set<string>, name: string): boolean {
  const bare = name.replace(/^-+/u, "")
  return literals.has(name) || literals.has(bare) || [...literals].some(l => l.split(/[^A-Za-z0-9_-]+/u).includes(name) || l.split(/[^A-Za-z0-9_-]+/u).includes(bare))
}

/** A Go panic or runtime error with its goroutine trace, or a run ended by a signal: the program broke. */
export function crashed(out: RunOutput): string | null {
  const text = `${out.stderr}\n${out.stdout}`
  const m = /^(panic: .*|fatal error: .*)$/mu.exec(text)
  if (m && /goroutine \d+ \[/u.test(text)) return m[1].slice(0, 200)
  if (out.exit_code === null && !out.timed_out) return "the program was ended by a signal"
  return null
}

/**
 * Why a check failed (BLOCK9 §2.3), in this order: timeout; a crash; a removed behaviour still there; a name not in
 * the program; an unstated reading; evidence against the check (disputed, unless a ruling upheld the check against
 * that kind of dispute); a refused input; a wrong value.
 */
export function classify(check: CheckRecord, results: AssertionResult[], out: RunOutput, literals: Set<string>, registry: Registry, facts: CodeFacts, upheld: ReadonlySet<DisputeKind> = new Set()): Failure {
  const failed = results.filter(r => !r.ok)
  const roles = [...new Set(failed.map(r => r.role))]
  if (out.timed_out) return { class: "unknown", reason: "timeout", detail: "the program did not finish in time", roles }
  const crash = crashed(out)
  if (crash) return { class: "not_landed", reason: "crash", detail: `the program crashed: ${crash}`, roles: ["business"] }
  if (check.direction === "withdrawn") return { class: "not_landed", reason: "still_present", detail: "the removed behaviour still happens", roles: [...new Set(results.map(r => r.role))] }
  const missing = invokedNames(check, registry).filter(n => !hasLiteral(literals, n))
  if (missing.length) return { class: "not_landed", reason: "missing_name", detail: `no string literal in the program names ${missing.join(", ")}`, roles: ["business"] }
  // Only assertions resting on an unstated reading failed (DESIGN §12d item 10): the reading may be wrong, not the program.
  const readingOf = (id: string) => check.assertions.find(a => a.id === id)?.reading
  if (failed.length && failed.every(r => readingOf(r.id))) {
    return { class: "unknown", reason: "reading", detail: failed.map(r => `${r.id}: got ${JSON.stringify(r.actual)}; rests on the reading "${readingOf(r.id)}"`).join("; "), roles }
  }
  const expected = check.assertions.flatMap(a => typeof a.expect === "string" ? [a.expect] : [])
  const outputLines = [...lines(out.stderr), ...lines(out.stdout)].map(l => l.trim()).filter(Boolean)
  // Inputs the code computed are right by construction (DESIGN §12b item 2): the program reporting one of its own
  // object's rules on them (say, a digest mismatch) got the value wrong.
  if (check.computed_inputs?.length) {
    const own = outputLines.flatMap(l => facts.templates.filter(t => t.regex.test(l) && t.owners.includes(check.object) && !expected.some(e => t.regex.test(e))).map(t => ({ line: l, rule: t.text })))
    if (own.length) return { class: "not_landed", reason: "value_mismatch", detail: `on inputs the code computed, the program reported its own rule \`${own[0].rule}\`: ${JSON.stringify(own[0].line)}`, roles: ["business"] }
  }
  // Evidence against the check: every failed line or stream assertion's expected text is in the output, elsewhere.
  if (!upheld.has("position")) {
    const where = (id: string) => check.assertions.find(a => a.id === id)!
    const streamed = failed.filter(r => ["stdout", "stdout_line", "stderr", "stderr_line"].includes(where(r.id).target.kind))
    const elsewhere = (r: AssertionResult) => {
      const e = where(r.id).expect
      if (typeof e !== "string" || !e.trim()) return false
      const want = e.trim()
      return [...lines(out.stdout), ...lines(out.stderr)].some(l => l.trim() === want) || (e.includes("\n") && (out.stdout.includes(e) || out.stderr.includes(e)))
    }
    if (failed.length && streamed.length === failed.length && streamed.every(elsewhere)) {
      return { class: "disputed", reason: "position", detail: `the expected text is in the output but not where the check reads it: ${streamed.map(r => `${r.id} (${where(r.id).target.kind}${where(r.id).target.line ? ` line ${where(r.id).target.line}` : ""})`).join(", ")}`, roles }
    }
  }
  // Evidence against the check: the program names an input file the check did not give.
  if (!upheld.has("input_incomplete")) {
    const given = new Set(check.input.files.map(f => f.path))
    const named = check.input.args.filter(a => !a.startsWith("-") && /[./]/u.test(a) && !given.has(a))
    const missing = named.filter(a => outputLines.some(l => l.includes(a) && facts.templates.some(t => t.regex.test(l) && !expected.some(e => t.regex.test(e)))))
    if (missing.length) return { class: "disputed", reason: "input_incomplete", detail: `the program reports ${missing.join(", ")}, which the check names but does not give`, roles }
  }
  // The program refused the input. The check expects success, which is its derivation's reading of the text; the
  // executor may contest that reading, and a ruling settles it.
  const other = outputLines.flatMap(l => facts.templates.filter(t => t.regex.test(l) && !expected.some(e => t.regex.test(e))).map(t => ({ line: l, rule: t.text })))
  if (other.length) return { class: "not_landed", reason: "refused", detail: `the program refused the input: ${JSON.stringify(other[0].line)} (rule \`${other[0].rule}\`); ${failed.map(r => `${r.id}: got ${JSON.stringify(r.actual)}`).join("; ")}`, roles }
  const exitExpected = check.assertions.find(a => a.target.kind === "exit_code")?.expect
  if (exitExpected === 0 && out.exit_code !== 0) {
    return { class: "not_landed", reason: "refused", detail: `the call exited ${out.exit_code} (${out.stderr.trim().slice(0, 160) || "no stderr"}) where a successful exit was expected; ${failed.map(r => `${r.id}: got ${JSON.stringify(r.actual)}`).join("; ")}`, roles }
  }
  return { class: "not_landed", reason: "value_mismatch", detail: failed.map(r => `${r.id}: got ${JSON.stringify(r.actual)}`).join("; "), roles }
}

export async function runCheck(check: CheckRecord, program: ProgramRef, runner: CheckRunner, round: number, registry: Registry, facts: CodeFacts, timeoutMs: number, upheld: ReadonlySet<DisputeKind> = new Set()): Promise<CheckRun> {
  const out = await runner.run(program, check.input, timeoutMs)
  const assertions = compare(check.assertions, out)
  const satisfied = assertions.every(a => a.ok)
  const pass = check.direction === "holds" ? satisfied : !satisfied
  return {
    check: check.id, round, program: program.id, outcome: pass ? "pass" : "fail", assertions, exit_code: out.exit_code, stderr_head: out.stderr.slice(0, 300),
    ...(pass ? {} : { stdout_head: out.stdout.slice(0, 600) }),
    failure: pass ? null : classify(check, assertions, out, runner.literals(program), registry, facts, upheld),
  }
}

// ---------------------------------------------------------------- strength

/**
 * An assertion is about data when it reads produced content (stdout, a file, a JSON field, a CSV cell) of a call that
 * was given input files, or when its expected text carries something from the input (a file line, an argument value);
 * not an exit code, a file's existence, or help text.
 */
export function dataAssertions(check: Pick<CheckRecord, "assertions" | "input">): string[] {
  const help = check.input.args.some(a => a === "--help" || a === "-h" || a === "help")
  if (help) return []
  const fromInput = [
    ...check.input.args.filter(a => !a.startsWith("-") && a.length >= 3),
    ...check.input.files.flatMap(f => f.content.split(/\r?\n/u)).map(l => l.trim()).filter(l => l.length >= 3),
  ]
  const empty = (v: unknown) => v === "" || v === null || (Array.isArray(v) && !v.length) || (typeof v === "object" && v !== null && !Object.keys(v).length)
  return check.assertions.filter(a => {
    if (empty(a.expect) || a.target.kind === "exit_code" || a.target.kind === "file_exists") return false
    const content = ["stdout", "stdout_line", "file", "file_line", "json", "csv_cell"].includes(a.target.kind)
    if (content && check.input.files.length) return true
    return typeof a.expect === "string" && fromInput.some(x => (a.expect as string).includes(x))
  }).map(a => a.id)
}

/** Strong = fails on the baseline (holds) or passes on it (withdrawn), and has an assertion about data. */
export function strength(check: CheckRecord, baselineRun: CheckRun, baseline: ProgramRef): Strength {
  const data = dataAssertions(check)
  const satisfied = baselineRun.assertions.every(a => a.ok)
  const baselineOk = check.direction === "holds" ? !satisfied : satisfied
  const strong = baselineOk && data.length > 0
  const reason = strong ? "fails on the previous program and asserts data" : !baselineOk
    ? (check.direction === "holds" ? "passes on the previous program, so it does not tell the requirement apart" : "the previous program does not show the removed behaviour")
    : "no assertion about data (only exit code, existence or help)"
  return { strong, baseline: baseline.id, baseline_ok: baselineOk, data_assertions: data, reason }
}

// ---------------------------------------------------------------- status

export type Status = "landed" | "not_landed" | "unknown"
export type UnknownReason = "no_checks" | "only_weak" | "suspect_input" | "timeout" | "derived_disagreement" | "not_run" | "reading" | "disputed_check"

export interface ObjectStatus {
  object: string
  status: Status
  /** Why unknown; empty otherwise. */
  reasons: UnknownReason[]
  /** The checks behind the status: strong passes, not-landed failures, unknown failures. */
  passing_strong: string[]
  not_landed: string[]
  unknown: string[]
}

/**
 * Recomputed from the round's runs alone (never inherited). An object is not landed when a failure was judged not
 * landed (business assertions count against the check's object, convention assertions against `uses`); landed when a
 * strong check speaking for it passed and nothing was judged not landed (unknown-class failures do not count); otherwise
 * unknown, with the reasons.
 */
export function objectStatuses(registry: Registry, library: readonly CheckRecord[], events: readonly CheckEvent[], runs: readonly CheckRun[], round: number): ObjectStatus[] {
  // The library and the objects as they stood in that round: later checks, retirements and objects are not there yet.
  const asOf = events.filter(e => e.round <= round)
  const checks = new Map(activeChecks(library.filter(c => c.round <= round), asOf).map(c => [c.id, c]))
  const objects = [...registry.objects.values()].filter(o => o.created_round <= round).map(o => o.id)
  const byObject = new Map(objects.map(id => [id, { strong: [] as string[], weak: [] as string[], not: [] as string[], unk: [] as string[], reasons: new Set<UnknownReason>(), seen: false }]))
  const at = (id: string) => byObject.get(id)
  for (const run of runs) {
    const check = checks.get(run.check)
    if (!check) continue
    const own = at(check.object), conventions = check.uses.map(at).filter(Boolean)
    // A check speaks for its own object through business assertions, and for its conventions through convention ones.
    const business = check.assertions.some(a => a.role === "business")
    const convAssertions = check.assertions.some(a => a.role === "convention")
    const speaksFor = [...(business ? [own] : []), ...(convAssertions ? conventions : [])]
    for (const s of speaksFor) s!.seen = true
    if (run.outcome === "pass") {
      const bucket = check.strength?.strong ? "strong" : "weak"
      for (const s of speaksFor) s![bucket].push(check.id)
      continue
    }
    const f = run.failure!
    const targets = f.class === "not_landed"
      ? [...(f.roles.includes("business") ? [own] : []), ...(f.roles.includes("convention") ? conventions : [])]
      : speaksFor
    for (const t of targets) {
      if (f.class === "not_landed") t!.not.push(check.id)
      else { t!.unk.push(check.id); t!.reasons.add(f.class === "disputed" ? "disputed_check" : f.reason === "timeout" ? "timeout" : f.reason === "reading" ? "reading" : "suspect_input") }
    }
  }
  for (const c of library) if (c.round <= round && c.admission === "unknown") at(c.object)?.reasons.add("derived_disagreement")
  return [...byObject.entries()].map(([object, s]): ObjectStatus => {
    const base = { object, passing_strong: s.strong, not_landed: s.not, unknown: s.unk }
    if (s.not.length) return { ...base, status: "not_landed", reasons: [] }
    // Unknown-class failures are recorded and shown, but do not take part in the verdict (block 2 review item 2).
    if (s.strong.length) return { ...base, status: "landed", reasons: [] }
    const reasons = new Set(s.reasons)
    if (!s.seen) reasons.add([...checks.values()].some(c => c.object === object) ? "not_run" : "no_checks")
    else if (s.weak.length) reasons.add("only_weak")
    return { ...base, status: "unknown", reasons: [...reasons].sort() }
  })
}
