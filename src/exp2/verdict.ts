import { activeChecks, DEFAULT_TOLERANCE, sameValue, type Assertion, type CheckEvent, type CheckRecord, type CodeFacts, type Strength, type Target } from "./checks.js"
import type { Registry } from "./registry.js"
import type { CheckRunner, ProgramRef, RunOutput } from "./runner.js"

/**
 * Exp2 check library, run and verdict (DESIGN §8). A check is run on a program in a fresh directory, every
 * assertion compared on its own (JSON parsed first, numbers within a tolerance). A failure gets a cause before it
 * counts: a wrong value or a missing command/option means not landed; a rejected call or another error rule's output
 * means the input is suspect, which is unknown. Object status is recomputed from the runs every round.
 */

export interface AssertionResult { id: string; ok: boolean; actual: unknown; role: Assertion["role"] }

export type FailureClass = "not_landed" | "unknown"
export type FailureReason = "value_mismatch" | "missing_name" | "still_present" | "rejected" | "other_error_rule" | "timeout"

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
  failure: Failure | null
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

/** Why a check failed, in this order: timeout; a name not in the program at all; a rejected call; a wrong value. */
export function classify(check: CheckRecord, results: AssertionResult[], out: RunOutput, literals: Set<string>, registry: Registry, facts: CodeFacts): Failure {
  const failed = results.filter(r => !r.ok)
  const roles = [...new Set(failed.map(r => r.role))]
  if (out.timed_out) return { class: "unknown", reason: "timeout", detail: "the program did not finish in time", roles }
  if (check.direction === "withdrawn") return { class: "not_landed", reason: "still_present", detail: "the removed behaviour still happens", roles: [...new Set(results.map(r => r.role))] }
  const missing = invokedNames(check, registry).filter(n => !hasLiteral(literals, n))
  if (missing.length) return { class: "not_landed", reason: "missing_name", detail: `no string literal in the program names ${missing.join(", ")}`, roles: ["business"] }
  // Output matching an error rule the check did not expect: the program refused this input.
  const expected = check.assertions.flatMap(a => typeof a.expect === "string" ? [a.expect] : [])
  const outputLines = [...lines(out.stderr), ...lines(out.stdout)].map(l => l.trim()).filter(Boolean)
  const other = outputLines.flatMap(l => facts.templates.filter(t => t.regex.test(l) && !expected.some(e => t.regex.test(e))).map(t => ({ line: l, rule: t.text })))
  if (other.length) return { class: "unknown", reason: "other_error_rule", detail: `the output ${JSON.stringify(other[0].line)} matches another rule, \`${other[0].rule}\`; the input is suspect`, roles }
  const exitExpected = check.assertions.find(a => a.target.kind === "exit_code")?.expect
  if ((exitExpected === 0 || exitExpected === undefined) && out.exit_code !== 0) {
    return { class: "unknown", reason: "rejected", detail: `the call exited ${out.exit_code} (${out.stderr.trim().slice(0, 160) || "no stderr"}) where success was expected; the input is suspect`, roles }
  }
  return { class: "not_landed", reason: "value_mismatch", detail: failed.map(r => `${r.id}: got ${JSON.stringify(r.actual)}`).join("; "), roles }
}

export async function runCheck(check: CheckRecord, program: ProgramRef, runner: CheckRunner, round: number, registry: Registry, facts: CodeFacts, timeoutMs: number): Promise<CheckRun> {
  const out = await runner.run(program, check.input, timeoutMs)
  const assertions = compare(check.assertions, out)
  const satisfied = assertions.every(a => a.ok)
  const pass = check.direction === "holds" ? satisfied : !satisfied
  return {
    check: check.id, round, program: program.id, outcome: pass ? "pass" : "fail", assertions, exit_code: out.exit_code, stderr_head: out.stderr.slice(0, 300),
    failure: pass ? null : classify(check, assertions, out, runner.literals(program), registry, facts),
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
  const reason = strong ? "fails on the baseline and asserts data" : !baselineOk
    ? (check.direction === "holds" ? "passes on the baseline, so it does not tell the requirement apart" : "the baseline does not show the removed behaviour")
    : "no assertion about data (only exit code, existence or help)"
  return { strong, baseline: baseline.id, baseline_ok: baselineOk, data_assertions: data, reason }
}

// ---------------------------------------------------------------- status

export type Status = "landed" | "not_landed" | "unknown"
export type UnknownReason = "no_checks" | "only_weak" | "suspect_input" | "timeout" | "derived_disagreement" | "not_run"

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
 * Recomputed from the round's runs alone (never inherited). An object is landed when a strong check of its own (or,
 * for a convention, a strong check that uses it) passed and none failed; not landed when a failure was judged not
 * landed (business assertions count against the check's object, convention assertions against `uses`); otherwise
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
      else { t!.unk.push(check.id); t!.reasons.add(f.reason === "timeout" ? "timeout" : "suspect_input") }
    }
  }
  for (const c of library) if (c.round <= round && c.admission === "unknown") at(c.object)?.reasons.add("derived_disagreement")
  return [...byObject.entries()].map(([object, s]): ObjectStatus => {
    const base = { object, passing_strong: s.strong, not_landed: s.not, unknown: s.unk }
    if (s.not.length) return { ...base, status: "not_landed", reasons: [] }
    if (s.strong.length && !s.unk.length) return { ...base, status: "landed", reasons: [] }
    const reasons = new Set(s.reasons)
    if (!s.seen) reasons.add([...checks.values()].some(c => c.object === object) ? "not_run" : "no_checks")
    else if (!s.strong.length && !s.unk.length) reasons.add("only_weak")
    return { ...base, status: "unknown", reasons: [...reasons].sort() }
  })
}
