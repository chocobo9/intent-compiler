import { createHash } from "node:crypto"
import { requestJson } from "../model/opencode-transport.js"
import { AuthInvalid, QuotaExhausted, ReplayMiss, TRANSPORT_RETRIES, type ModelReply, type TokenUsage } from "./attribution.js"
import { EnvironmentBlocked } from "./platform.js"
import { methodB, replacedBasis, statedIn, targetProblems, type Assertion, type AssertionDraft, type CheckDraft, type CheckRecord, type CodeFacts, type Target } from "./checks.js"
import { LIVE_STATES, type Registry } from "./registry.js"
import { safePath, type CheckInput, type CheckRunner, type ProgramRef, type ScriptSandbox } from "./runner.js"
import { annotate } from "./source.js"
import { runCheck, type CheckRun } from "./verdict.js"

/**
 * From the reviewer's list to deterministic checks (DESIGN §12i items 2–3). One model call writes each reported
 * deviation as a check: the input the reviewer used, the units it rests on, and assertions that hold for a program
 * that follows the requirement. The code then checks the premises before anything is sent for repair, without a
 * token: the units are in force; the input files, parsed by the standard parser of their format, show what the item
 * says they show; a stated value occurs in the cited text and a worked-out value comes from a script the code ran;
 * and the check fails on the program as it stands. An item that fails a premise is not sent; the ledger says which.
 */

export interface FormalItem {
  /** The item's position in the reviewer's list, and its text as reported. */
  item: number
  text: string
  units: string[]
  /** The call: the program's arguments and the files it needs, as the reviewer used them. Null when the text does not say. */
  input: CheckInput | null
  why_no_input: string | null
  /** What each CSV or JSON input file holds, in the parser's terms (§12i item 2). */
  claims: InputClaim[]
  assertions: AssertionDraft[]
  reference_script: CheckDraft["reference_script"]
}

/** records: data records after the header; empty_cells: empty fields among them; columns: the header. */
export interface InputClaim { path: string; parses: boolean; records: number | null; empty_cells: number | null; columns: string[] | null }

export interface FormalizeAnswer { items: FormalItem[] }

export interface FormalizeRequest {
  round: number
  sources: string
  /** The reviewer's reply, verbatim. */
  review: string
  program: string
  previous_answer?: FormalizeAnswer
  problems?: string[]
}

export type FormalizeTransport = (request: FormalizeRequest) => Promise<ModelReply>

export interface FormalizeCallRecord {
  id: string
  round: number
  stage: "acceptance"
  step: "formalize"
  review: string
  attempt: number
  request_sha256: string
  request_chars: number
  response_text: string
  problems: string[]
  usage: TokenUsage
  stub: boolean
  usage_unknown?: boolean
  model?: string
  error?: string
}

/**
 * A unit id as code knows it: round, sections (they nest), then a paragraph (or a section's heading unit H), sentence
 * and clause (source.ts). The annotated sources show a paragraph as ⟦R1.S3.P12#<hash>⟧ and its parts as ‹s10.c1›;
 * the hash is not part of the id.
 */
export const UNIT_ID_PATTERN = "^R[0-9]+(\\.S[0-9]+)+(\\.H|\\.P[0-9]+(\\.s[0-9]+(\\.c[0-9]+)?)?)?$"
const UNIT_ID = new RegExp(UNIT_ID_PATTERN, "u")
const UNIT_SYNTAX = "write unit ids as R<round>.S<section>[.S<subsection>…][.P<paragraph>[.s<sentence>[.c<clause>]]], e.g. R1.S3.P12, R1.S3.P12.s10, R1.S3.P12.s10.c1: a paragraph marker ⟦R1.S3.P12#f683eb75⟧ names R1.S3.P12 (the part after # is a content hash, not part of the id) and a marker ‹s10.c1› inside it names R1.S3.P12.s10.c1"

const target = {
  type: "object", additionalProperties: false, required: ["kind", "path", "line", "pointer", "column"],
  properties: {
    kind: { type: "string", enum: ["exit_code", "stdout", "stdout_line", "stderr", "stderr_line", "file", "file_line", "file_exists", "json", "csv_cell"] },
    path: { type: ["string", "null"], description: "file, file_line, file_exists, csv_cell, json: the output file; json: \"-\" for stdout" },
    line: { type: ["integer", "null"], description: "stdout_line, stderr_line, file_line: 1-based line; csv_cell: 1-based data record after the header" },
    pointer: { type: ["string", "null"], description: "json: a JSON pointer, \"\" for the whole document" },
    column: { type: ["string", "null"], description: "csv_cell: the column name in the header" },
  },
}

export const FORMALIZE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: {
    items: {
      type: "array",
      description: "One entry per deviation in the review, in the review's order; none when the review lists none.",
      items: {
        type: "object", additionalProperties: false, required: ["item", "text", "units", "input", "why_no_input", "claims", "assertions", "reference_script"],
        properties: {
          item: { type: "integer", description: "1-based position in the review's list" },
          text: { type: "string", description: "the item's text as the review states it, verbatim" },
          units: { type: "array", items: { type: "string", pattern: UNIT_ID_PATTERN }, description: "ids of the units of `sources` the item says are broken, e.g. R2.S3.P4, R2.S3.P4.s2, R2.S3.P4.s2.c1 (no hash, no colon)" },
          input: {
            type: ["object", "null"], additionalProperties: false, required: ["args", "files"],
            description: "the call the review made: arguments after the program name, and every input file with its full content; null when the review does not give them completely",
            properties: { args: { type: "array", items: { type: "string" } }, files: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } } } },
          },
          why_no_input: { type: ["string", "null"], description: "when input is null: what the review leaves out" },
          claims: {
            type: "array",
            description: "for every input file ending in .csv or .json: what the item relies on it holding, in the standard parser's terms",
            items: {
              type: "object", additionalProperties: false, required: ["path", "parses", "records", "empty_cells", "columns"],
              properties: {
                path: { type: "string" },
                parses: { type: "boolean", description: "whether the standard parser of the format (RFC 4180 CSV as Go reads it, JSON) accepts the file" },
                records: { type: ["integer", "null"], description: "CSV: data records after the header line (blank lines are not records); null for JSON or when it does not parse" },
                empty_cells: { type: ["integer", "null"], description: "CSV: empty fields among the data records; null for JSON or when it does not parse" },
                columns: { type: ["array", "null"], items: { type: "string" }, description: "CSV: the header's column names; null for JSON" },
              },
            },
          },
          assertions: {
            type: "array",
            description: "what a program that follows the requirement produces for this call; each one fact, each failing on the reviewed program",
            items: {
              type: "object", additionalProperties: false, required: ["id", "target", "expect_json", "tolerance", "source"],
              properties: {
                id: { type: "string" },
                target,
                expect_json: { type: "string", description: "the expected value, JSON-encoded" },
                tolerance: { type: ["number", "null"] },
                source: {
                  type: "object", additionalProperties: false, required: ["kind", "block"],
                  properties: {
                    kind: { type: "string", enum: ["verbatim", "derived", "computed"], description: "verbatim: the requirement states the value (block names the unit that states it); derived: worked out from the input, and reference_script must work it out too; computed: a digest or the like, given by reference_script alone (expect_json \"null\")" },
                    block: { type: ["string", "null"], pattern: UNIT_ID_PATTERN, description: "verbatim: the id of the unit that states the value, written as in units" },
                  },
                },
              },
            },
          },
          reference_script: {
            type: ["object", "null"], additionalProperties: false, required: ["language", "code"],
            description: "for derived and computed values: a Python 3 (or node) script that runs in a directory holding the input files and prints one JSON object {assertion id: value}; it must not run the program",
            properties: { language: { type: "string", enum: ["python", "node"] }, code: { type: "string" } },
          },
        },
      },
    },
  },
}

export const FORMALIZE_SYSTEM_PROMPT = [
  "You turn a review of a command-line program into checks that code can run. `review` is the reviewer's reply: a list of deviations from the requirements, each with the requirement it breaks, the command and input the reviewer used, and what the program did. `sources` holds the requirements, annotated with block ids; newer text overrides older text. `program` is the program's name.",
  "For each deviation in the list, in order, write one item:",
  `- units: the ids of the units of \`sources\` the deviation breaks (the finest units that state the rule: a sentence, a list item, a clause); ${UNIT_SYNTAX}.`,
  "- input: the call the reviewer made, rebuilt exactly: the arguments after the program name, and every input file with its complete content. When the review does not give enough to rebuild the call (a file's content is missing or abbreviated, the arguments are not stated), set input to null and say in why_no_input what is missing. Do not invent content.",
  "- claims: for every input file ending in .csv or .json, what the item relies on the file holding, as the standard parser sees it: whether it parses (CSV as RFC 4180 the way Go's encoding/csv reads it: a blank line is skipped, every record has the header's field count; JSON as JSON.parse), the number of data records after the header, the number of empty fields among them, the header's columns. Count them yourself from the content you wrote; code checks these against the parser.",
  "- assertions: what a program that follows the requirement produces for this call, one fact each (an exit code, a line, a cell, a JSON field), stated so that they fail on the reviewed program and would pass once it is fixed. Every expected value has a source: verbatim when the requirement states the value (block is the id of the unit that states it; code checks that the value occurs there); derived when you worked it out from the input (then reference_script must print it too, under the assertion's id); computed for a digest or hash (expect_json \"null\"; reference_script alone gives it). A number that the text does not state is never verbatim: work it out in reference_script.",
  "- reference_script: needed when any assertion is derived or computed. It runs in a directory holding only the input files and prints one JSON object mapping each such assertion's id to its value. It must not run the program.",
  "If the review reports no deviation, answer with an empty list. When `problems` is given, fix exactly those in `previous_answer` and return the whole answer.",
].join("\n")

const zero = (): TokenUsage => ({ input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 })

export function buildFormalizeRequest(registry: Registry, round: number, review: string, program: string): FormalizeRequest {
  const rounds = [...registry.sources.values()].filter(s => s.round <= round).sort((a, b) => a.round - b.round)
  return { round, sources: rounds.map(s => `===== R${s.round} =====\n${annotate(s)}`).join("\n"), review, program }
}

/**
 * A unit id as the annotated sources show it, made canonical: the paragraph marker's content hash dropped
 * (`R1.S3.P12#f683eb75` → `R1.S3.P12`) and a relative unit marker joined with a dot (`…#f683eb75:s10.c1` →
 * `R1.S3.P12.s10.c1`). Ids that are already canonical are unchanged.
 */
export function canonicalUnit(u: string): string {
  const m = /^([^#:]+)(?:#[0-9a-f]+)?(?::(.+))?$/u.exec(u.trim())
  return m ? (m[2] ? `${m[1]}.${m[2]}` : m[1]) : u
}

/** Definite errors of an answer, per item (an item with problems is asked again once, then dropped as malformed). */
export function formalizeProblems(registry: Registry, round: number, answer: unknown): { problems: { item: number | null; message: string }[]; items: FormalItem[] } {
  const a = answer as Partial<FormalizeAnswer> | null
  if (!a || typeof a !== "object" || !Array.isArray(a.items)) return { problems: [{ item: null, message: "the answer must have an items list" }], items: [] }
  // Mechanical slips of the interface, read the one way they can mean (fix block A6): an id written as the annotation
  // shows it, an expected string not JSON-encoded, a verbatim value's unit missing or unknown (the item's own units are
  // searched for it instead, by the premise check).
  for (const raw of a.items as Partial<FormalItem>[]) {
    if (!raw || typeof raw !== "object") continue
    if (Array.isArray(raw.units)) raw.units = raw.units.map(u => typeof u === "string" ? canonicalUnit(u) : u)
    for (const x of (Array.isArray(raw.assertions) ? raw.assertions : []) as Partial<AssertionDraft>[]) {
      if (!x || typeof x !== "object") continue
      if (x.source && typeof x.source.block === "string") x.source.block = canonicalUnit(x.source.block)
      if (x.source && x.source.kind === "verbatim" && (typeof x.source.block !== "string" || !registry.block(x.source.block))) x.source.block = null
      if (typeof x.expect_json === "string") { try { JSON.parse(x.expect_json) } catch { x.expect_json = JSON.stringify(x.expect_json) } }
    }
  }
  const problems: { item: number | null; message: string }[] = []
  const items: FormalItem[] = []
  for (const [k, raw] of a.items.entries()) {
    const it = raw as Partial<FormalItem> | null
    const n = typeof it?.item === "number" ? it.item : k + 1
    const add = (message: string) => problems.push({ item: n, message: `item ${n}: ${message}` })
    if (!it || typeof it !== "object") { add("not an object"); continue }
    if (typeof it.text !== "string" || !it.text.trim()) add("text must quote the item")
    // Units: the ones that name a unit of the text so far are kept; the item needs one at least.
    const known = (u: unknown): u is string => typeof u === "string" && !!registry.block(u) && registry.block(u)!.round <= round
    if (!Array.isArray(it.units) || !it.units.length || !it.units.every(u => typeof u === "string")) add(`units must name at least one unit id; ${UNIT_SYNTAX}`)
    else if (!it.units.some(known)) for (const u of it.units) add(UNIT_ID.test(u) ? `unit ${u} does not exist in the requirements so far` : `unit ${u} is not in the unit id format; ${UNIT_SYNTAX}`)
    else it.units = it.units.filter(known)
    // No input: nothing can be checked or run; the item stands on its text (its assertions are not looked at).
    if (it.input === null || it.input === undefined) {
      if (problems.some(p => p.item === n)) continue
      items.push({ item: n, text: it.text!, units: [...new Set(it.units!)], input: null, why_no_input: typeof it.why_no_input === "string" && it.why_no_input.trim() ? it.why_no_input : "the formalizer gave no input and no reason", claims: [], assertions: [], reference_script: null })
      continue
    }
    {
      const i = it.input as Partial<CheckInput>
      if (!Array.isArray(i.args) || !i.args.every(x => typeof x === "string") || !Array.isArray(i.files) || !i.files.every(f => f && typeof f.path === "string" && typeof f.content === "string")) add("input must be {args: string[], files: {path, content}[]}")
      else {
        for (const f of i.files) if (!safePath(f.path)) add(`input path ${f.path} must be relative and inside the run directory`)
        const claims = Array.isArray(it.claims) ? it.claims as Partial<InputClaim>[] : []
        for (const f of i.files.filter(x => /\.(csv|json)$/iu.test(x.path))) {
          const c = claims.find(x => x?.path === f.path)
          if (!c || typeof c.parses !== "boolean") { add(`claims must say whether ${f.path} parses`); continue }
          if (/\.csv$/iu.test(f.path) && c.parses && (!Number.isInteger(c.records) || !Number.isInteger(c.empty_cells))) add(`claims for ${f.path} must give records and empty_cells as integers`)
        }
      }
    }
    if (!Array.isArray(it.assertions)) { add("assertions must be a list"); continue }
    if (it.input && !it.assertions.length) add("an item with an input needs at least one assertion")
    let derived = false
    const ids = new Set<string>()
    for (const x of it.assertions as Partial<AssertionDraft>[]) {
      if (!x || typeof x.id !== "string" || !x.target || typeof x.expect_json !== "string" || !x.source || typeof x.source !== "object") { add("every assertion needs id, target, expect_json and source"); continue }
      if (ids.has(x.id)) add(`assertion id ${x.id} is used twice`)
      ids.add(x.id)
      const tp = targetProblems(x.target as Target)
      if (tp) add(`assertion ${x.id}: ${tp}`)
      const kind = x.source.kind
      if (kind !== "verbatim" && kind !== "derived" && kind !== "computed") add(`assertion ${x.id}: source.kind must be verbatim, derived or computed`)
      if (kind !== "verbatim") derived = true
    }
    if (derived && !(it.reference_script && typeof it.reference_script === "object" && (it.reference_script.language === "python" || it.reference_script.language === "node") && typeof it.reference_script.code === "string")) add("derived and computed values need reference_script")
    if (problems.some(p => p.item === n)) continue
    items.push({
      item: n, text: it.text!, units: [...new Set(it.units!)], input: it.input ? { args: [...it.input.args], files: it.input.files.map(f => ({ path: f.path, content: f.content })) } : null,
      why_no_input: it.input ? null : it.why_no_input!, claims: (Array.isArray(it.claims) ? it.claims : []).map(c => ({ path: c.path, parses: c.parses === true, records: Number.isInteger(c.records) ? c.records! : null, empty_cells: Number.isInteger(c.empty_cells) ? c.empty_cells! : null, columns: Array.isArray(c.columns) ? c.columns.map(String) : null })),
      assertions: (it.assertions as AssertionDraft[]).map(x => ({ id: x.id, role: "business", target: { kind: x.target.kind, path: x.target.path ?? null, line: x.target.line ?? null, pointer: x.target.pointer ?? null, column: x.target.column ?? null }, expect_json: x.expect_json, tolerance: typeof x.tolerance === "number" ? x.tolerance : null, source: { kind: x.source.kind, block: x.source.block ?? null } })),
      reference_script: derived ? it.reference_script! : null,
    })
  }
  return { problems, items }
}

/**
 * Asks for the items of one review: the first answer and one repair with the problems code found. Items that still
 * have problems are reported as malformed (not sent, not counted as findings). Transport failures are retried.
 */
export async function formalizeReview(registry: Registry, round: number, review: string, program: string, transport: FormalizeTransport, o: { reviewId: string; callId: (n: number) => string }): Promise<{ items: FormalItem[]; malformed: { item: number | null; message: string }[]; calls: FormalizeCallRecord[]; unavailable?: string; texts: { item: number; text: string }[] }> {
  const calls: FormalizeCallRecord[] = []
  let request = buildFormalizeRequest(registry, round, review, program)
  let items: FormalItem[] = [], malformed: { item: number | null; message: string }[] = [], failures = 0
  // The items' texts as the last parsed answer quotes them (a malformed item is still sent in the reviewer's words).
  let texts: { item: number; text: string }[] = []
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = requestJson(request)
    const base = { id: o.callId(calls.length + 1), round, stage: "acceptance" as const, step: "formalize" as const, review: o.reviewId, attempt, request_sha256: createHash("sha256").update(text).digest("hex"), request_chars: text.length }
    let reply: ModelReply
    try { reply = await transport(request) } catch (e) {
      if (e instanceof ReplayMiss || e instanceof QuotaExhausted || e instanceof AuthInvalid || e instanceof EnvironmentBlocked) throw e
      calls.push({ ...base, response_text: "", problems: [], usage: zero(), stub: false, error: (e as Error).message })
      if (++failures > TRANSPORT_RETRIES) return { items, malformed, calls, texts, unavailable: `${failures} formalize calls failed; last: ${(e as Error).message}` }
      attempt--
      continue
    }
    let parsed: unknown = null
    try { parsed = JSON.parse(reply.text) } catch { parsed = null }
    const checked = parsed === null ? { problems: [{ item: null, message: "the reply is not JSON" }], items: [] as FormalItem[] } : formalizeProblems(registry, round, parsed)
    calls.push({ ...base, response_text: reply.text, problems: checked.problems.map(p => p.message), usage: { ...zero(), ...reply.usage }, stub: reply.stub === true, ...(reply.usage === undefined && reply.stub !== true ? { usage_unknown: true } : {}), ...(reply.model ? { model: reply.model } : {}) })
    items = checked.items
    malformed = checked.problems
    const listed = parsed && typeof parsed === "object" && Array.isArray((parsed as FormalizeAnswer).items) ? (parsed as FormalizeAnswer).items : []
    texts = listed.flatMap((x, k) => x && typeof x === "object" && typeof x.text === "string" ? [{ item: typeof x.item === "number" ? x.item : k + 1, text: x.text }] : [])
    if (!malformed.length) break
    if (parsed !== null && typeof parsed === "object") request = { ...request, previous_answer: parsed as FormalizeAnswer, problems: malformed.map(p => p.message) }
    else request = { ...request, problems: malformed.map(p => p.message) }
  }
  return { items, malformed, calls, texts }
}

// ---------------------------------------------------------------- standard parsers

/**
 * CSV as Go's encoding/csv reads it with its defaults: RFC 4180 quoting, CRLF or LF, an empty line is skipped, the
 * first record fixes the field count and a record with another count is an error, a quote inside an unquoted field
 * is an error.
 */
export function parseCsvGo(text: string): { ok: true; records: string[][] } | { ok: false; error: string } {
  const records: string[][] = []
  let i = 0
  const n = text.length
  let lineNo = 0
  while (i < n) {
    lineNo++
    // An empty line (only a line break) is skipped.
    if (text[i] === "\n") { i++; continue }
    if (text[i] === "\r" && text[i + 1] === "\n") { i += 2; continue }
    const row: string[] = []
    for (;;) {
      let field = ""
      if (text[i] === "\"") {
        i++
        for (;;) {
          if (i >= n) return { ok: false, error: `line ${lineNo}: extraneous or missing " in quoted-field` }
          if (text[i] === "\"") {
            if (text[i + 1] === "\"") { field += "\""; i += 2; continue }
            i++
            break
          }
          field += text[i++]
        }
        if (i < n && text[i] !== "," && text[i] !== "\n" && !(text[i] === "\r" && text[i + 1] === "\n")) return { ok: false, error: `line ${lineNo}: extraneous or missing " in quoted-field` }
      } else {
        while (i < n && text[i] !== "," && text[i] !== "\n" && !(text[i] === "\r" && text[i + 1] === "\n")) {
          if (text[i] === "\"") return { ok: false, error: `line ${lineNo}: bare " in non-quoted-field` }
          field += text[i++]
        }
      }
      row.push(field)
      if (i < n && text[i] === ",") { i++; continue }
      break
    }
    if (i < n && text[i] === "\r") i++
    if (i < n && text[i] === "\n") i++
    if (records.length && row.length !== records[0].length) return { ok: false, error: `record on line ${lineNo}: wrong number of fields` }
    records.push(row)
  }
  return { ok: true, records }
}

/** What the standard parser says a file holds, in the claim's terms. */
export function parsedFacts(path: string, content: string): InputClaim | null {
  if (/\.csv$/iu.test(path)) {
    const p = parseCsvGo(content)
    if (!p.ok) return { path, parses: false, records: null, empty_cells: null, columns: null }
    const data = p.records.slice(1)
    return { path, parses: true, records: data.length, empty_cells: data.reduce((n, r) => n + r.filter(c => c === "").length, 0), columns: p.records[0] ?? [] }
  }
  if (/\.json$/iu.test(path)) {
    try { JSON.parse(content); return { path, parses: true, records: null, empty_cells: null, columns: null } } catch { return { path, parses: false, records: null, empty_cells: null, columns: null } }
  }
  return null
}

/** The claims the standard parser contradicts (premise 2): each as the claim, what the parser found. */
export function claimProblems(input: CheckInput, claims: readonly InputClaim[]): string[] {
  const out: string[] = []
  for (const c of claims) {
    const f = input.files.find(x => x.path === c.path)
    if (!f) { out.push(`${c.path}: the item claims a file the input does not give`); continue }
    const facts = parsedFacts(f.path, f.content)
    if (!facts) continue
    if (c.parses !== facts.parses) { out.push(`${c.path}: claimed ${c.parses ? "parses" : "does not parse"}, the standard parser ${facts.parses ? "accepts it" : "rejects it"}`); continue }
    if (!facts.parses) continue
    if (c.records !== null && c.records !== facts.records) out.push(`${c.path}: claimed ${c.records} data records, parsed ${facts.records}`)
    if (c.empty_cells !== null && c.empty_cells !== facts.empty_cells) out.push(`${c.path}: claimed ${c.empty_cells} empty cells, parsed ${facts.empty_cells}`)
    if (c.columns !== null && facts.columns && JSON.stringify(c.columns) !== JSON.stringify(facts.columns)) out.push(`${c.path}: claimed columns ${JSON.stringify(c.columns)}, parsed ${JSON.stringify(facts.columns)}`)
  }
  return out
}

// ---------------------------------------------------------------- premises

/**
 * Which premise an item did not pass (§12i item 2), as the ledger and the report name it. no_input, malformed,
 * not_formalized (the formalizer left a listed deviation out) and formalize_failed (the call failed) are code's own
 * failures to verify, not findings about the item (fix block A1).
 */
export type Premise = "unit_not_in_force" | "input_claim_false" | "value_not_stated" | "value_not_computed" | "reference_failed" | "no_input" | "not_reproduced" | "malformed" | "not_formalized" | "formalize_failed"

export interface PremiseFailure { premise: Premise; detail: string }

/** The premises that stop an item by default (fix block A3): code's conclusions about the item itself. The rest are logged. */
export const DEFAULT_PREMISE_BLOCK: readonly Premise[] = ["unit_not_in_force", "not_reproduced", "input_claim_false"]
/** Failures that are code's own, not the item's: under the fallback the item goes out in the reviewer's words (A1). */
export const OWN_FAILURES: ReadonlySet<Premise> = new Set(["no_input", "malformed", "not_formalized", "formalize_failed"])

/** A check built from an item whose premises held: the input filled and the expected values resolved. */
export interface ItemCheck { input: CheckInput; assertions: Assertion[]; reference_script: CheckDraft["reference_script"]; object: string | null }

const within = (registry: Registry, inner: string, outer: string) => registry.lineage(inner).some(b => b.id === outer)

/**
 * Why a unit is not a requirement in force in `round` (premise 1), or null when it is: it exists, is owned and live,
 * and no round after its own wholly replaced or withdrew it.
 */
export function notInForce(registry: Registry, round: number, u: string): string | null {
  const b = registry.block(u)
  if (!b) return `${u} does not exist`
  const own = registry.ownership(u)
  if (!own) return `${u} is not a requirement (text assigned to no object)`
  if (!LIVE_STATES.has(own.state)) return `${u} is ${own.state} (${own.modifications.map(m => `${m.kind} in round ${m.round} by ${m.by.join(", ")}`).join("; ")})`
  const gone = replacedBasis(registry, [u], b.round, round).filter(m => m.parts.some(p => within(registry, u, p)))
  return gone.length ? `${u}: ${gone[0].parts.join(", ")} ${gone[0].kind === "withdraw" ? "withdrawn" : "replaced"} in round ${gone[0].round} by ${gone[0].by.join(", ")}` : null
}

/**
 * Every premise the code checks before an item is sent (no model), each one, not only the first that fails: every
 * cited unit is a requirement in force (owned, live, not wholly replaced by a later round); the input's files show
 * what the item claims under their standard parser; each stated value occurs in the unit cited for it, or else in one
 * of the item's units (a number the text does not state has to be computed); each worked-out value comes from the
 * reference script and agrees with it. The check is built from what could be resolved (null without an input, or when
 * nothing resolved); the caller decides by tier what a failure means.
 */
export async function assessPremises(registry: Registry, round: number, item: FormalItem, sandbox: ScriptSandbox, timeoutMs: number): Promise<{ failures: PremiseFailure[]; check: ItemCheck | null }> {
  const failures: PremiseFailure[] = []
  const fail = (premise: Premise, detail: string) => { if (!failures.some(f => f.premise === premise)) failures.push({ premise, detail }) }
  for (const u of item.units) { const why = notInForce(registry, round, u); if (why) fail("unit_not_in_force", why) }
  if (!item.input) { fail("no_input", item.why_no_input ?? "the review does not give the input"); return { failures, check: null } }
  const claims = claimProblems(item.input, item.claims)
  if (claims.length) fail("input_claim_false", claims.join("; "))
  const assertions: AssertionDraft[] = []
  for (const a of item.assertions) {
    if (a.source.kind !== "verbatim") { assertions.push(a); continue }
    const expect = JSON.parse(a.expect_json) as unknown
    const cited = a.source.block ? registry.block(a.source.block) : null
    const stater = cited && statedIn(cited.text, expect) ? cited : item.units.map(u => registry.block(u)).find(b => b && statedIn(b.text, expect)) ?? null
    if (!stater) fail(typeof expect === "number" ? "value_not_computed" : "value_not_stated", `assertion ${a.id}: ${a.expect_json} is not stated in ${a.source.block ?? item.units.join(", ")}${cited ? `, which reads ${JSON.stringify(cited.text.trim().slice(0, 160))}` : ""}`)
    assertions.push(stater && stater.id !== a.source.block ? { ...a, source: { ...a.source, block: stater.id } } : a)
  }
  const draft: CheckDraft = { key: `item ${item.item}`, object: "", blocks: item.units, uses: [], direction: "holds", input: item.input, assertions, reference_script: item.reference_script, note: null }
  const b = await methodB(draft, sandbox, timeoutMs)
  if (b.unknown.length) fail("reference_failed", b.unknown.map(u => `assertion ${u.assertion.id}: ${u.reason}`).join("; "))
  if (!b.input) { fail("reference_failed", b.input_failure ?? "the input could not be filled"); return { failures, check: null } }
  const owner = item.units.map(u => registry.coverOf(u)?.owner).find(o => o && o !== "none") ?? null
  return { failures, check: b.assertions.length ? { input: b.input, assertions: b.assertions, reference_script: item.reference_script, object: owner } : null }
}

/**
 * The premises as one verdict, in their order (unit, input, claims, stated values, references): the check, or the
 * first premise that failed. Used where every premise blocks (the replay's strict column, tests).
 */
export async function checkPremises(registry: Registry, round: number, item: FormalItem, sandbox: ScriptSandbox, timeoutMs: number): Promise<{ ok: true; check: ItemCheck } | { ok: false; failure: PremiseFailure }> {
  const a = await assessPremises(registry, round, item, sandbox, timeoutMs)
  const order: Premise[] = ["unit_not_in_force", "no_input", "input_claim_false", "value_not_computed", "value_not_stated", "reference_failed"]
  const first = order.map(p => a.failures.find(f => f.premise === p)).find(f => !!f)
  if (first) return { ok: false, failure: first }
  if (!a.check) return { ok: false, failure: { premise: "reference_failed", detail: "no assertion could be resolved" } }
  return { ok: true, check: a.check }
}

/** The item's check as a library record, so the runner and the comparison run it as any check. */
export function itemCheckRecord(id: string, round: number, item: FormalItem, check: ItemCheck): CheckRecord {
  return {
    id, round, key: `item ${item.item}`, object: check.object ?? "none", blocks: item.units, uses: [], direction: "holds", input: check.input, assertions: check.assertions, unknown: [],
    reference_script: check.reference_script, admission: "admitted", admission_reason: null, strength: null, status: "active", calls: [],
  }
}

/** Runs an item's check on the program: the deviation reproduces when the check fails (premise 4, `not_reproduced` otherwise). */
export async function reproduces(record: CheckRecord, program: ProgramRef, runner: CheckRunner, round: number, registry: Registry, facts: CodeFacts, timeoutMs: number): Promise<{ run: CheckRun; reproduced: boolean }> {
  const run = await runCheck(record, program, runner, round, registry, facts, timeoutMs)
  return { run, reproduced: run.outcome === "fail" && run.failure?.reason !== "timeout" }
}
