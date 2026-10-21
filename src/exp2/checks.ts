import { createHash } from "node:crypto"
import { requestJson } from "../model/opencode-transport.js"
import { AuthInvalid, QuotaExhausted, ReplayMiss, type ModelReply, type TokenUsage } from "./attribution.js"
import type { Registry } from "./registry.js"
import { safePath, type CheckInput, type ScriptSandbox } from "./runner.js"
import { annotate, LEVEL_RANK, parseRef, roundOf, type SourceBlock } from "./source.js"

/**
 * Exp2 check library, derivation step (DESIGN §8, §4.5). For the objects this round changed, the model writes
 * checks: an input (arguments and files), assertions that each state one fact, where each expected value comes
 * from (quoted from a source block, or derived twice: by the model directly and by a reference script the code
 * runs), and which shared conventions a check uses. The code admits only what it can verify and returns definite
 * errors for a patch, as in attribution: one schema, the first answer a patch on an empty draft.
 */

// ---------------------------------------------------------------- data

export type TargetKind = "exit_code" | "stdout" | "stdout_line" | "stderr" | "stderr_line" | "file" | "file_line" | "file_exists" | "json" | "csv_cell"

/** What an assertion reads. path: an output file, or "-" for stdout (json only); line: 1-based (csv_cell: data row). */
export interface Target {
  kind: TargetKind
  path: string | null
  line: number | null
  /** json: a JSON pointer ("" is the whole document). */
  pointer: string | null
  /** csv_cell: the header name. */
  column: string | null
}

/**
 * verbatim: quoted from the source. derived: worked out by the model (method A) and by the reference script
 * (method B), kept when they agree. computed: a value that takes computing (a digest, a hash): only the reference
 * script gives it, the model never works it out (DESIGN §12b item 2).
 */
export interface ExpectSource {
  kind: "verbatim" | "derived" | "computed"
  /** verbatim: the block and the exact text quoted from it. */
  block: string | null
  quote: string | null
}

export interface AssertionDraft {
  id: string
  /** convention: the fact belongs to a shared convention in `uses`; business: to the check's own object. */
  role: "convention" | "business"
  target: Target
  /** The expected value, JSON-encoded. For a derived value this is method A, the model's own derivation. */
  expect_json: string
  /** Allowed numeric difference (relative to max(1, |value|)); null for the default. */
  tolerance: number | null
  source: ExpectSource
}

export interface CheckDraft {
  key: string
  object: string
  blocks: string[]
  uses: string[]
  /** holds: the assertions state what must hold now. withdrawn: they state behaviour the text has removed. */
  direction: "holds" | "withdrawn"
  input: CheckInput
  assertions: AssertionDraft[]
  /**
   * Method B: prints one JSON object mapping each derived or computed assertion's id to its value, and each
   * `{{computed:NAME}}` placeholder in the input files to the text that replaces it.
   */
  reference_script: { language: "python" | "node"; code: string } | null
  note: string | null
}

export interface RetireDraft { check: string; reason: string }

export interface ChecksDraft { checks: CheckDraft[]; retire: RetireDraft[] }

export interface ChecksPatch {
  upsert: CheckDraft[]
  /** Draft keys removed. */
  remove: string[]
  retire_add: RetireDraft[]
  retire_remove: string[]
}

export const EMPTY_CHECKS: ChecksDraft = { checks: [], retire: [] }

export interface Assertion extends Omit<AssertionDraft, "expect_json"> {
  expect: unknown
  /** derived: method B's value, which agreed with method A; computed: the value itself. */
  method_b?: unknown
}

/** `{{computed:NAME}}` in an input file: filled by the code from the reference script's output before any run. */
export const COMPUTED_PLACEHOLDER = /\{\{computed:([A-Za-z0-9_.-]+)\}\}/gu

export const placeholdersOf = (input: CheckInput): string[] =>
  [...new Set(input.files.flatMap(f => [...f.content.matchAll(COMPUTED_PLACEHOLDER)].map(m => m[1])))]

/** A run of 32 or more hex digits: what a digest or hash looks like. */
const DIGEST = /(?<![0-9A-Fa-f])[0-9A-Fa-f]{32,}(?![0-9A-Fa-f])/gu

export interface Strength {
  strong: boolean
  baseline: string
  /** holds: did the baseline fail the check; withdrawn: did it satisfy it. */
  baseline_ok: boolean
  data_assertions: string[]
  reason: string
}

export interface CheckRecord {
  id: string
  round: number
  key: string
  object: string
  blocks: string[]
  uses: string[]
  direction: "holds" | "withdrawn"
  input: CheckInput
  assertions: Assertion[]
  /** Derived assertions whose two methods disagreed, or could not be compared: unknown, left out of the check. */
  unknown: { assertion: AssertionDraft; reason: string; method_b?: unknown }[]
  reference_script: CheckDraft["reference_script"]
  /** Input placeholders the code filled from the reference script (the input above is the filled one). */
  computed_inputs?: string[]
  /** admitted: in the library. unknown: no assertion survived, recorded with the reason only. */
  admission: "admitted" | "unknown"
  admission_reason: string | null
  strength: Strength | null
  /** Status at entry; later changes are events (retire now; stale is reserved for propagation). */
  status: "active"
  calls: string[]
}

export interface CheckEvent {
  check: string
  round: number
  status: "stale" | "retired"
  reason: string
  /**
   * Who decided. code: the check's basis was replaced (stale), or it was input-suspect two rounds running (retired).
   * model: a retire proposal the code verified against the source.
   */
  by: "model" | "code"
  /** What set it off (DESIGN §4.3–4.5): the check's own basis, a block it refers to, a convention it uses, … */
  cause?: { kind: "basis" | "refers_to" | "convention" | "suspect" | "proposal"; source: string }
}

// ---------------------------------------------------------------- staleness (DESIGN §8, block 2 review item 3)

/**
 * The source units a check rests on (DESIGN §4.4, to the clause): the blocks it cites, and for each verbatim
 * expectation the finest unit of the quoted block that holds the whole quote, so a revision of a neighbouring
 * clause leaves it standing.
 */
export function basisOf(registry: Registry, check: Pick<CheckRecord, "blocks" | "assertions">): string[] {
  const quoted = check.assertions.flatMap(a => a.source.kind === "verbatim" && a.source.block ? [quoteUnit(registry, parseRef(a.source.block).id, a.source.quote ?? "")] : [])
  return [...new Set([...check.blocks.map(b => parseRef(b).id), ...quoted])]
}

/** The finest block inside `block` whose text holds the whole quote (the block itself when the quote spans units). */
export function quoteUnit(registry: Registry, block: string, quote: string): string {
  const b = registry.block(block)
  if (!b || !quote) return block
  const at = b.text.indexOf(quote)
  if (at < 0) return block
  const start = b.start + at, end = start + quote.length
  let best = b
  const visit = (x: SourceBlock) => {
    for (const id of x.children) {
      const c = registry.block(id)!
      if (c.start <= start && end <= c.end) { best = c; visit(c) }
    }
  }
  visit(b)
  return best.id
}

const within = (registry: Registry, inner: string, outer: string) => registry.lineage(inner).some(b => b.id === outer)

/**
 * Text that later rounds (after `since`, up to `round`) replaced or modified inside the given units: the modification
 * parts that overlap a unit (either one inside the other). Empty when the basis still stands as written.
 */
export function replacedBasis(registry: Registry, units: readonly string[], since: number, round: number): { unit: string; round: number; kind: string; parts: string[]; by: string[] }[] {
  const out: { unit: string; round: number; kind: string; parts: string[]; by: string[] }[] = []
  const owns = [...registry.objects.values()].flatMap(o => o.blocks)
  for (const unit of units) {
    for (const own of owns) {
      if (!within(registry, unit, own.block) && !within(registry, own.block, unit)) continue
      for (const m of own.modifications) {
        if (m.round <= since || m.round > round) continue
        const hit = m.parts.filter(p => within(registry, p, unit) || within(registry, unit, p))
        if (hit.length) out.push({ unit, round: m.round, kind: m.kind, parts: hit, by: m.by })
      }
    }
  }
  return out
}

const verb = (kind: string) => kind === "partial" ? "partly revised" : kind === "withdraw" ? "withdrawn" : "replaced"

/**
 * Active checks that code marks stale in `round` (DESIGN §8 review item 3, §4.3, §4.5): their own basis was replaced
 * or modified after they entered; a block their basis refers to (refers_to) was; or a convention in their `uses`
 * changed. Each event names its cause.
 */
export function staleChecks(registry: Registry, library: readonly CheckRecord[], events: readonly CheckEvent[], round: number): CheckEvent[] {
  return activeChecks(library, events).flatMap((c): CheckEvent[] => {
    const basis = basisOf(registry, c)
    const own = replacedBasis(registry, basis, c.round, round)
    if (own.length) {
      const h = own[0]
      return [{ check: c.id, round, status: "stale", by: "code", cause: { kind: "basis", source: h.unit }, reason: `basis ${h.unit}: ${h.parts.join(", ")} ${verb(h.kind)} in round ${h.round} by ${h.by.join(", ")}` }]
    }
    const refs = registry.references.filter(e => e.kind === "refers_to" && basis.some(u => within(registry, e.from, u) || within(registry, u, e.from)))
    for (const e of refs) {
      const hit = replacedBasis(registry, [e.to], c.round, round)
      if (hit.length) return [{ check: c.id, round, status: "stale", by: "code", cause: { kind: "refers_to", source: e.to }, reason: `${e.from} refers to ${e.to}, ${verb(hit[0].kind)} in round ${hit[0].round} by ${hit[0].by.join(", ")}` }]
    }
    for (const u of c.uses) {
      const change = registry.changes.find(ch => ch.object === u && ch.round > c.round && ch.round <= round)
      if (change) return [{ check: c.id, round, status: "stale", by: "code", cause: { kind: "convention", source: u }, reason: `uses ${u} (${registry.objects.get(u)?.name ?? u}), changed in round ${change.round} (${change.id})` }]
    }
    return []
  })
}

// ---------------------------------------------------------------- source facts

export interface CodeFacts {
  /** Tokens (names, options, keys) appearing in any code fragment of the requirements so far. */
  tokens: Set<string>
  /** Inline code with a <placeholder>, e.g. `ERROR: file not found: <path>`, as templates with their owners. */
  templates: { text: string; regex: RegExp; owners: string[]; blocks: string[] }[]
}

/** Inline code spans and fenced blocks of rounds 1..round, with the finest block each starts in. */
function fragments(registry: Registry, round: number): { text: string; block: string; inline: boolean }[] {
  const out: { text: string; block: string; inline: boolean }[] = []
  for (const source of [...registry.sources.values()].filter(s => s.round <= round)) {
    const finest = (at: number): SourceBlock => source.blocks.filter(b => b.start <= at && at < b.end).sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level])[0]
    const fence = /^[ \t]*(```|~~~)[^\n]*\r?\n([\s\S]*?)^[ \t]*\1/gmu
    const fenced: [number, number][] = []
    for (const m of source.text.matchAll(fence)) {
      fenced.push([m.index!, m.index! + m[0].length])
      out.push({ text: m[2], block: finest(m.index!).id, inline: false })
    }
    for (const m of source.text.matchAll(/`([^`\r\n]+)`/gu)) {
      if (fenced.some(([a, b]) => m.index! >= a && m.index! < b)) continue
      out.push({ text: m[1], block: finest(m.index!).id, inline: true })
    }
  }
  return out
}

const TOKEN = /-{0,2}[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*/gu
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

export function templateRegex(text: string): RegExp {
  return new RegExp(`^${text.split(/<[^<>\s]+>/u).map(escape).join(".+?")}$`, "u")
}

export function codeFacts(registry: Registry, round: number): CodeFacts {
  const tokens = new Set<string>()
  const byText = new Map<string, { owners: Set<string>; blocks: Set<string> }>()
  for (const f of fragments(registry, round)) {
    for (const t of f.text.match(TOKEN) ?? []) tokens.add(t)
    if (!f.inline || !/<[^<>\s]+>/u.test(f.text)) continue
    // A template needs some fixed text to be a form at all (`<path>` alone is not one).
    if (f.text.replace(/<[^<>\s]+>/gu, "").replace(/\s+/gu, "").length < 4) continue
    const owner = registry.coverOf(f.block)?.owner
    const entry = byText.get(f.text) ?? { owners: new Set(), blocks: new Set() }
    if (owner && owner !== "none") entry.owners.add(owner)
    entry.blocks.add(f.block)
    byText.set(f.text, entry)
  }
  const templates = [...byText.entries()].map(([text, e]) => ({ text, regex: templateRegex(text), owners: [...e.owners].sort(), blocks: [...e.blocks] }))
  return { tokens, templates }
}

// ---------------------------------------------------------------- request

export interface CheckRequest {
  round: number
  sources: string
  /** Objects this round changed, with the blocks they hold and this round's blocks behind the change. */
  scope: { id: string; name: string; version: number; blocks: string[]; changed: string[] }[]
  /** Every object, for `uses`. */
  objects: { id: string; name: string }[]
  /** Active checks of the scope objects already in the library. */
  checks: { id: string; object: string; blocks: string[]; uses: string[]; assertions: number }[]
  /** Checks that code marked stale this round (their basis, a referenced block, or a convention changed): to derive again. */
  stale: { id: string; object: string; blocks: string[]; reason: string }[]
  issues: CheckIssue[]
  previous_draft: ChecksDraft
}

export type CheckIssueCode =
  | "unparseable" | "shape" | "duplicate_key" | "object_not_in_scope" | "unknown_object" | "unknown_block" | "basis_not_object"
  | "name_unknown" | "verbatim_not_found" | "verbatim_mismatch" | "expect_invalid" | "target_invalid" | "input_invalid"
  | "script_missing" | "uses_missing" | "retire_invalid" | "exit_missing" | "computed_by_hand" | "transport" | "quota" | "auth"

export interface CheckIssue { code: CheckIssueCode; check?: string; message: string }

export function buildCheckRequest(registry: Registry, round: number, library: readonly CheckRecord[], events: readonly CheckEvent[], previous: ChecksDraft = EMPTY_CHECKS, issues: CheckIssue[] = []): CheckRequest {
  const rounds = [...registry.sources.values()].filter(s => s.round <= round).sort((a, b) => a.round - b.round)
  const scope = registry.roundScope(round).map(c => {
    const o = registry.objects.get(c.object)!
    const changed = [...new Set([...c.entries.map(e => e.block), ...c.received.flatMap(m => m.by), ...c.applied.map(a => a.from)])]
    return { id: o.id, name: o.name, version: o.version, blocks: o.blocks.filter(b => b.state !== "superseded" && b.state !== "withdrawn").map(b => b.block), changed }
  })
  const inScope = new Set(scope.map(s => s.id))
  const checks = activeChecks(library, events).filter(k => inScope.has(k.object)).map(k => ({ id: k.id, object: k.object, blocks: k.blocks, uses: k.uses, assertions: k.assertions.length }))
  // Every check that went stale this round, whatever its object: those checks, and only those, are to be derived again.
  const stale = events.filter(e => e.status === "stale" && e.round === round).map(e => {
    const k = library.find(c => c.id === e.check)!
    return { id: k.id, object: k.object, blocks: k.blocks, reason: e.reason }
  })
  return {
    round, sources: rounds.map(s => `===== R${s.round} =====\n${annotate(s)}`).join("\n"), scope,
    objects: [...registry.objects.values()].map(o => ({ id: o.id, name: o.name })), checks, stale, issues, previous_draft: previous,
  }
}

export function activeChecks(library: readonly CheckRecord[], events: readonly CheckEvent[]): CheckRecord[] {
  const ended = new Set(events.map(e => e.check))
  return library.filter(k => k.admission === "admitted" && !ended.has(k.id))
}

// ---------------------------------------------------------------- admission check

/** Definite errors only: the model's choice of what to check, and how, is not judged here. */
export function checkChecks(registry: Registry, round: number, draft: ChecksDraft, library: readonly CheckRecord[], events: readonly CheckEvent[], facts: CodeFacts = codeFacts(registry, round)): CheckIssue[] {
  const issues: CheckIssue[] = []
  // Checks may be written for this round's objects, and again for the objects of checks that went stale this round.
  const scope = new Set([...registry.roundScope(round).map(c => c.object), ...events.filter(e => e.status === "stale" && e.round === round).map(e => library.find(c => c.id === e.check)?.object).filter((x): x is string => !!x)])
  const add = (code: CheckIssueCode, message: string, check?: string) => issues.push({ code, message, ...(check ? { check } : {}) })
  const name = (id: string) => registry.objects.get(id)?.name ?? id
  const keys = new Set<string>()
  for (const k of draft.checks) {
    const w = `check ${k.key}`
    if (keys.has(k.key)) { add("duplicate_key", `${w}: the key is used twice`, k.key); continue }
    keys.add(k.key)
    if (!registry.objects.has(k.object)) { add("unknown_object", `${w}: object ${k.object} does not exist`, k.key); continue }
    if (!scope.has(k.object)) { add("object_not_in_scope", `${w}: ${k.object} (${name(k.object)}) did not change in round ${round} and has no stale check; derive checks only for this round's objects and for stale checks`, k.key); continue }
    for (const u of k.uses) if (!registry.objects.has(u)) add("unknown_object", `${w}: uses ${u}, which does not exist`, k.key)
    // Basis: the cited blocks exist, and at least one is the object's own text or text that applies to it.
    const blocks = k.blocks.map(b => parseRef(b).id)
    const missing = blocks.filter(b => !registry.block(b) || roundOf(b) > round)
    for (const b of missing) add("unknown_block", `${w}: block ${b} does not exist`, k.key)
    const applied = new Set(registry.changes.filter(c => c.object === k.object).flatMap(c => c.applied.map(a => a.from)))
    const basis = (b: string) => registry.coverOf(b)?.owner === k.object || [...applied].some(a => registry.lineage(a).some(x => x.id === b) || registry.lineage(b).some(x => x.id === a))
    if (!missing.length && !blocks.some(basis)) add("basis_not_object", `${w}: none of ${blocks.join(", ") || "(no blocks)"} is text of ${k.object} (${name(k.object)})`, k.key)
    // Input: safe relative paths, each once.
    const paths = k.input.files.map(f => f.path)
    for (const p of paths) if (!safePath(p)) add("input_invalid", `${w}: input path ${p} must be relative and stay inside the run directory`, k.key)
    if (new Set(paths).size !== paths.length) add("input_invalid", `${w}: an input path is given twice`, k.key)
    // Names: command, options and JSON keys must appear in the requirements' code fragments.
    for (const n of namesOf(k)) if (!facts.tokens.has(n.name)) add("name_unknown", `${w}: ${n.what} ${n.name} does not appear in any code fragment of the requirements`, k.key)
    // Computed values come from the reference script only: a digest written into an input or an expectation by hand
    // is refused, unless the requirements state it.
    const stated = new Set([...registry.sources.values()].filter(s => s.round <= round).flatMap(s => [...s.text.matchAll(DIGEST)].map(m => m[0].toLowerCase())))
    const byHand = (text: string) => [...text.matchAll(DIGEST)].map(m => m[0]).filter(d => !stated.has(d.toLowerCase()))
    for (const f of k.input.files) for (const d of byHand(f.content)) add("computed_by_hand", `${w}: input ${f.path} holds ${d.slice(0, 16)}…, a computed value; write {{computed:NAME}} there and have the reference script print NAME's value`, k.key)
    for (const a of k.input.args) for (const d of byHand(a)) add("computed_by_hand", `${w}: argument ${d.slice(0, 16)}… is a computed value; computed values go into input files through {{computed:NAME}}`, k.key)
    const placeholders = placeholdersOf(k.input)
    // Assertions.
    const ids = new Set<string>()
    let derived = placeholders.length > 0
    for (const a of k.assertions) {
      const aw = `${w} assertion ${a.id}`
      if (ids.has(a.id)) add("shape", `${aw}: the id is used twice in this check`, k.key)
      ids.add(a.id)
      const targetProblem = targetProblems(a.target)
      if (targetProblem) add("target_invalid", `${aw}: ${targetProblem}`, k.key)
      let expect: unknown
      try { expect = JSON.parse(a.expect_json) } catch { add("expect_invalid", `${aw}: expect_json is not JSON`, k.key); continue }
      if (a.tolerance !== null && !(a.tolerance >= 0)) add("expect_invalid", `${aw}: tolerance must be a non-negative number or null`, k.key)
      if (placeholders.includes(a.id)) add("shape", `${aw}: the id is also an input placeholder name`, k.key)
      if (a.source.kind === "derived") {
        derived = true
        for (const text of strings(expect)) for (const d of byHand(text)) add("computed_by_hand", `${aw}: ${d.slice(0, 16)}… is a computed value; mark the source computed and let the reference script give it`, k.key)
      } else if (a.source.kind === "computed") derived = true
      else {
        const ref = parseRef(a.source.block ?? "")
        const block = registry.block(ref.id)
        if (!block || roundOf(ref.id) > round) add("verbatim_not_found", `${aw}: quoted block ${a.source.block} does not exist`, k.key)
        else if (!a.source.quote || !block.text.includes(a.source.quote)) add("verbatim_not_found", `${aw}: the quote ${JSON.stringify(a.source.quote)} is not in ${ref.id}; quote its text exactly, or derive the value`, k.key)
        else if (!quoteSays(a.source.quote, expect)) add("verbatim_mismatch", `${aw}: the expected value ${a.expect_json} is not what the quote ${JSON.stringify(a.source.quote)} says`, k.key)
      }
      // A key form of a shared convention in the expectation needs that convention in uses.
      for (const text of strings(expect)) {
        const matching = facts.templates.filter(t => t.regex.test(text) && t.owners.length)
        if (!matching.length) continue
        const owners = new Set(matching.flatMap(t => t.owners))
        if (owners.has(k.object) || k.uses.some(u => owners.has(u))) continue
        add("uses_missing", `${aw}: the expected ${JSON.stringify(text)} has the form ${matching.map(t => `\`${t.text}\``).join(", ")} of ${[...owners].map(o => `${o} (${name(o)})`).join(", ")}; add it to uses`, k.key)
      }
    }
    if (!k.assertions.length) add("shape", `${w}: a check needs at least one assertion`, k.key)
    if (!k.assertions.some(a => a.target.kind === "exit_code")) add("exit_missing", `${w}: state the expected exit code (an exit_code assertion)`, k.key)
    if (derived && !k.reference_script) add("script_missing", `${w}: derived and computed values, and {{computed:NAME}} inputs, need a reference_script (method B)`, k.key)
  }
  // A retire proposal must name a check that exists and is not retired yet; whether it is accepted is the code's call later.
  const retired = new Set(events.filter(e => e.status === "retired").map(e => e.check))
  for (const r of draft.retire) if (!library.some(c => c.id === r.check && c.admission === "admitted") || retired.has(r.check)) add("retire_invalid", `retire ${r.check}: no check in the library has that id, or it is already retired`)
  return issues
}

function namesOf(k: CheckDraft): { what: string; name: string }[] {
  const out: { what: string; name: string }[] = []
  const [first, ...rest] = k.input.args
  if (first !== undefined && !first.startsWith("-")) out.push({ what: "command", name: first })
  for (const a of rest) if (/^--?[A-Za-z]/u.test(a)) out.push({ what: "option", name: a.split("=")[0] })
  const keys = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(keys)
    else if (v && typeof v === "object") for (const [key, x] of Object.entries(v)) { out.push({ what: "JSON key", name: key }); keys(x) }
  }
  for (const f of k.input.files) if (f.path.endsWith(".json")) { try { keys(JSON.parse(f.content)) } catch { /* a malformed JSON input is a legitimate check */ } }
  for (const a of k.assertions) if (a.target.kind === "json" && a.target.pointer) {
    for (const seg of a.target.pointer.split("/").slice(1)) if (!/^\d+$/u.test(seg)) out.push({ what: "JSON key", name: seg.replace(/~1/gu, "/").replace(/~0/gu, "~") })
  }
  const seen = new Set<string>()
  return out.filter(n => !seen.has(`${n.what}:${n.name}`) && seen.add(`${n.what}:${n.name}`))
}

function targetProblems(t: Target): string | null {
  const needsPath = ["file", "file_line", "file_exists", "json", "csv_cell"].includes(t.kind)
  if (needsPath && !t.path) return `${t.kind} needs a path`
  if (t.path && t.path !== "-" && !safePath(t.path)) return `path ${t.path} must be relative and inside the run directory`
  if (t.path === "-" && t.kind !== "json") return `path "-" (stdout) is for json only`
  if (["stdout_line", "stderr_line", "file_line", "csv_cell"].includes(t.kind) && !(Number.isSafeInteger(t.line) && t.line! >= 1)) return `${t.kind} needs a line number from 1`
  if (t.kind === "json" && (t.pointer === null || (t.pointer !== "" && !t.pointer.startsWith("/")))) return `json needs a JSON pointer ("" or starting with /)`
  if (t.kind === "csv_cell" && !t.column) return "csv_cell needs a column"
  return null
}

/** Does the quoted text say this value: the same text, the text with its <placeholders> filled in, or the number in it. */
export function quoteSays(quote: string, expect: unknown): boolean {
  if (typeof expect === "string") {
    // The quote itself, or an inline-code form inside it, with its <placeholders> filled from the input.
    const forms = [quote, ...[...quote.matchAll(/`([^`]+)`/gu)].map(m => m[1])]
    return forms.some(f => expect === f || (/<[^<>\s]+>/u.test(f) && templateRegex(f).test(expect))) || (expect.length >= 3 && quote.includes(expect))
  }
  if (typeof expect === "number" || typeof expect === "boolean") return new RegExp(`(^|[^\\w.])${escape(String(expect))}($|[^\\w.])`, "u").test(quote)
  try { return JSON.stringify(JSON.parse(quote)) === JSON.stringify(expect) } catch { return false }
}

function strings(v: unknown): string[] {
  if (typeof v === "string") return [v]
  if (Array.isArray(v)) return v.flatMap(strings)
  if (v && typeof v === "object") return Object.values(v).flatMap(strings)
  return []
}

// ---------------------------------------------------------------- shape and patch

export function checksShapeProblems(value: unknown): string[] {
  const p: string[] = []
  const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
  const strs = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === "string")
  if (!obj(value)) return ["answer: not an object"]
  if (!Array.isArray(value.upsert)) p.push("upsert: not an array")
  else value.upsert.forEach((k, i) => {
    const at = `upsert[${i}]`
    if (!obj(k)) { p.push(`${at}: not an object`); return }
    for (const f of ["key", "object"]) if (typeof k[f] !== "string") p.push(`${at}.${f}: not a string`)
    if (!strs(k.blocks) || !strs(k.uses)) p.push(`${at}: blocks and uses must be string arrays`)
    if (k.direction !== "holds" && k.direction !== "withdrawn") p.push(`${at}.direction: holds or withdrawn`)
    if (!obj(k.input) || !strs(k.input.args) || !Array.isArray(k.input.files) || !k.input.files.every(f => obj(f) && typeof f.path === "string" && typeof f.content === "string")) p.push(`${at}.input: {args: string[], files: {path, content}[]}`)
    if (!Array.isArray(k.assertions) || !k.assertions.every(a => obj(a) && typeof a.id === "string" && (a.role === "convention" || a.role === "business") && obj(a.target) && typeof a.target.kind === "string" && typeof a.expect_json === "string" && obj(a.source) && (a.source.kind === "verbatim" || a.source.kind === "derived" || a.source.kind === "computed"))) p.push(`${at}.assertions: malformed`)
    if (k.reference_script !== null && !(obj(k.reference_script) && (k.reference_script.language === "python" || k.reference_script.language === "node") && typeof k.reference_script.code === "string")) p.push(`${at}.reference_script: {language, code} or null`)
  })
  if (!strs(value.remove) || !strs(value.retire_remove)) p.push("remove and retire_remove must be string arrays")
  if (!Array.isArray(value.retire_add) || !value.retire_add.every(r => obj(r) && typeof r.check === "string" && typeof r.reason === "string")) p.push("retire_add: not an array of {check, reason}")
  return p
}

export function applyChecksPatch(previous: ChecksDraft, patch: ChecksPatch): ChecksDraft {
  const removed = new Set(patch.remove)
  const upserts = new Map(patch.upsert.map(k => [k.key, k]))
  const checks = previous.checks.filter(k => !removed.has(k.key) || upserts.has(k.key)).map(k => upserts.get(k.key) ?? k)
  for (const [key, k] of upserts) if (!previous.checks.some(x => x.key === key)) checks.push(k)
  const retire = [...previous.retire.filter(r => !patch.retire_remove.includes(r.check) && !patch.retire_add.some(x => x.check === r.check)), ...patch.retire_add]
  return { checks, retire }
}

// ---------------------------------------------------------------- method B

/** Default numeric tolerance, relative to max(1, |value|). */
export const DEFAULT_TOLERANCE = 1e-9

export function sameValue(a: unknown, b: unknown, tolerance: number): boolean {
  const num = (v: unknown) => typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null
  if (typeof a === "number" || typeof b === "number") {
    const x = num(a), y = num(b)
    if (x === null || y === null) return false
    return Math.abs(x - y) <= tolerance * Math.max(1, Math.abs(x), Math.abs(y))
  }
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i], tolerance))
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort()
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], tolerance))
  }
  return a === b
}

export interface MethodBOutcome {
  assertions: Assertion[]
  unknown: CheckRecord["unknown"]
  /** The input with its placeholders filled; null when a placeholder got no value (the check cannot run). */
  input: CheckInput | null
  computed_inputs: string[]
  input_failure?: string
}

/**
 * Runs the reference script (on the input as written, placeholders unfilled), fills the input's placeholders from
 * its output, keeps the derived assertions on which methods A and B agree, and takes computed values from B alone.
 */
export async function methodB(draft: CheckDraft, sandbox: ScriptSandbox, timeoutMs: number): Promise<MethodBOutcome> {
  const assertions: Assertion[] = [], unknown: CheckRecord["unknown"] = []
  const derived = draft.assertions.filter(a => a.source.kind !== "verbatim")
  const placeholders = placeholdersOf(draft.input)
  let values: Record<string, unknown> | null = null, failure = ""
  if ((derived.length || placeholders.length) && draft.reference_script) {
    const r = await sandbox.run(draft.reference_script.language, draft.reference_script.code, draft.input.files, timeoutMs)
    if (r.timed_out) failure = `reference script timed out after ${timeoutMs} ms`
    else if (r.exit_code !== 0) failure = `reference script exited ${r.exit_code}: ${r.stderr.trim().slice(0, 300)}`
    else {
      try {
        const parsed = JSON.parse(r.stdout)
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) values = parsed as Record<string, unknown>
        else failure = "reference script did not print a JSON object"
      } catch { failure = "reference script did not print JSON" }
    }
  }
  let input: CheckInput | null = draft.input, input_failure: string | undefined
  if (placeholders.length) {
    const missing = placeholders.filter(n => !values || !(n in values) || values[n] === null || typeof values[n] === "object")
    if (missing.length) { input = null; input_failure = `no computed value for input ${missing.join(", ")}${failure ? ` (${failure})` : ""}` }
    else input = { args: draft.input.args, files: draft.input.files.map(f => ({ path: f.path, content: f.content.replace(COMPUTED_PLACEHOLDER, (_, n: string) => String(values![n])) })) }
  }
  for (const a of draft.assertions) {
    const { expect_json, ...rest } = a
    const expect = a.source.kind === "computed" ? null : JSON.parse(expect_json)
    if (!input) { unknown.push({ assertion: a, reason: input_failure! }); continue }
    if (a.source.kind === "verbatim") { assertions.push({ ...rest, expect }); continue }
    if (!values) { unknown.push({ assertion: a, reason: failure || "no reference script result" }); continue }
    if (!(a.id in values)) { unknown.push({ assertion: a, reason: `reference script gave no value for ${a.id}` }); continue }
    const b = values[a.id]
    if (a.source.kind === "computed") { assertions.push({ ...rest, expect: b, method_b: b }); continue }
    if (sameValue(expect, b, a.tolerance ?? DEFAULT_TOLERANCE)) assertions.push({ ...rest, expect, method_b: b })
    else unknown.push({ assertion: a, reason: `methods disagree: A ${expect_json}, B ${JSON.stringify(b)}`, method_b: b })
  }
  return { assertions, unknown, input, computed_inputs: placeholders, ...(input_failure ? { input_failure } : {}) }
}

// ---------------------------------------------------------------- loop

export type ChecksTransport = (request: CheckRequest) => Promise<ModelReply>

export interface CheckCallRecord {
  id: string
  round: number
  stage: "acceptance"
  step: "checks"
  kind: "attribute" | "repair"
  attempt: number
  request: CheckRequest
  request_chars: number
  request_sha256: string
  response_text: string
  issues: CheckIssue[]
  usage: TokenUsage
  stub: boolean
  usage_unknown?: boolean
  model?: string
  error?: string
}

export interface DeriveOutcome { status: "accepted" | "failed" | "interrupted"; draft?: ChecksDraft; calls: CheckCallRecord[]; issues: CheckIssue[] }

export async function deriveChecks(registry: Registry, round: number, library: readonly CheckRecord[], events: readonly CheckEvent[], transport: ChecksTransport, options: { maxRepairs: number; callId: (n: number) => string }): Promise<DeriveOutcome> {
  const calls: CheckCallRecord[] = []
  const facts = codeFacts(registry, round)
  let draft = EMPTY_CHECKS
  let issues: CheckIssue[] = []
  for (let attempt = 1; attempt <= options.maxRepairs + 1; attempt++) {
    const request = buildCheckRequest(registry, round, library, events, draft, issues)
    const text = requestJson(request)
    const base = { id: options.callId(calls.length + 1), round, stage: "acceptance" as const, step: "checks" as const, kind: attempt === 1 ? "attribute" as const : "repair" as const, attempt, request, request_chars: text.length, request_sha256: createHash("sha256").update(text).digest("hex") }
    let reply: ModelReply
    try { reply = await transport(request) } catch (e) {
      if (e instanceof ReplayMiss) throw e
      // As in attribution: a spent quota stops the step; any other failure uses up this attempt.
      const stop = e instanceof QuotaExhausted ? "quota" as const : e instanceof AuthInvalid ? "auth" as const : null
      const failed: CheckIssue[] = [{ code: stop ?? "transport", message: `The model call failed: ${(e as Error).message}` }]
      calls.push({ ...base, response_text: "", issues: failed, usage: zero(), stub: false, error: (e as Error).message })
      if (stop) return { status: "interrupted", calls, issues: failed }
      if (!issues.length) issues = failed
      continue
    }
    const record: CheckCallRecord = { ...base, response_text: reply.text, issues: [], usage: { ...zero(), ...reply.usage }, stub: reply.stub === true, ...(reply.usage === undefined && reply.stub !== true ? { usage_unknown: true } : {}), ...(reply.model ? { model: reply.model } : {}) }
    calls.push(record)
    let parsed: unknown
    try { parsed = JSON.parse(reply.text) } catch (e) { issues = [{ code: "unparseable", message: `The reply is not JSON: ${(e as Error).message}` }]; record.issues = issues; continue }
    const shape = checksShapeProblems(parsed)
    if (shape.length) { issues = shape.map(message => ({ code: "shape" as const, message })); record.issues = issues; continue }
    draft = applyChecksPatch(draft, parsed as ChecksPatch)
    issues = checkChecks(registry, round, draft, library, events, facts)
    record.issues = issues
    if (!issues.length) return { status: "accepted", draft, calls, issues }
  }
  return { status: "failed", calls, issues }
}

function zero(): TokenUsage { return { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 } }

// ---------------------------------------------------------------- schema and prompt

const nullableString = { type: ["string", "null"] }
const stringArray = { type: "array", items: { type: "string" } }
const checkSchema = {
  type: "object",
  additionalProperties: false,
  required: ["key", "object", "blocks", "uses", "direction", "input", "assertions", "reference_script", "note"],
  properties: {
    key: { type: "string", description: "Your name for this check within the draft." },
    object: { type: "string", description: "The object (id) whose requirement the check tests; one of this round's scope." },
    blocks: { ...stringArray, description: "Source blocks the check rests on." },
    uses: { ...stringArray, description: "Shared-convention objects (ids) whose rules the expected output follows, e.g. an error-message format." },
    direction: { type: "string", enum: ["holds", "withdrawn"], description: "holds: the assertions state what must hold now. withdrawn: they state behaviour the text has removed (it must no longer happen)." },
    input: {
      type: "object", additionalProperties: false, required: ["args", "files"],
      properties: {
        args: { ...stringArray, description: "Arguments after the program name, e.g. [\"<command>\", \"--<option>\", \"<input file>\", …]." },
        files: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } }, description: "Files written into an empty run directory before the call." },
      },
    },
    assertions: {
      type: "array",
      description: "Each assertion states one fact: an exit code, one line of stdout, one cell, one JSON field.",
      items: {
        type: "object", additionalProperties: false, required: ["id", "role", "target", "expect_json", "tolerance", "source"],
        properties: {
          id: { type: "string" },
          role: { type: "string", enum: ["convention", "business"], description: "convention: the fact comes from a convention in uses; business: from the object's own requirement. Keep them in separate assertions." },
          target: {
            type: "object", additionalProperties: false, required: ["kind", "path", "line", "pointer", "column"],
            properties: {
              kind: { type: "string", enum: ["exit_code", "stdout", "stdout_line", "stderr", "stderr_line", "file", "file_line", "file_exists", "json", "csv_cell"] },
              path: { ...nullableString, description: "Output file path; \"-\" means stdout (json only)." },
              line: { type: ["integer", "null"], description: "1-based line; for csv_cell the data row after the header." },
              pointer: { ...nullableString, description: "json: JSON pointer, \"\" for the whole document." },
              column: { ...nullableString, description: "csv_cell: header name." },
            },
          },
          expect_json: { type: "string", description: "The expected value, JSON-encoded (\"\\\"some text\\\"\", \"1\", \"0.5\", \"[\\\"a\\\"]\")." },
          tolerance: { type: ["number", "null"], description: "Allowed relative numeric difference; null for the default." },
          source: {
            type: "object", additionalProperties: false, required: ["kind", "block", "quote"],
            properties: {
              kind: { type: "string", enum: ["verbatim", "derived", "computed"], description: "verbatim: the value is stated in the source (quote it exactly; <placeholders> may be filled from the input). derived: you worked it out; the reference script must work it out too. computed: it takes computing (a digest, a hash, a checksum): do not write it (expect_json \"null\"); only the reference script gives it." },
              block: nullableString,
              quote: nullableString,
            },
          },
        },
      },
    },
    reference_script: {
      type: ["object", "null"], additionalProperties: false, required: ["language", "code"],
      description: "Method B: a script run in a directory holding only the input files (placeholders unfilled); it prints one JSON object mapping each derived or computed assertion's id, and each {{computed:NAME}} placeholder's NAME, to its value. It must not run the program under test.",
      properties: { language: { type: "string", enum: ["python", "node"] }, code: { type: "string" } },
    },
    note: nullableString,
  },
}

export const CHECKS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["upsert", "remove", "retire_add", "retire_remove"],
  properties: {
    upsert: { type: "array", items: checkSchema, description: "Checks to add, or to replace the draft's check with the same key." },
    remove: { ...stringArray, description: "Draft keys dropped." },
    retire_add: { type: "array", items: { type: "object", additionalProperties: false, required: ["check", "reason"], properties: { check: { type: "string" }, reason: { type: "string" } } }, description: "Proposals: library checks whose expectation rests on text that no longer holds. The code accepts one only when that check's source was in fact revised." },
    retire_remove: stringArray,
  },
}

export const CHECKS_SYSTEM_PROMPT = [
  "You write acceptance checks for a command-line program from its requirements. `sources` holds every round so far, annotated with block ids; the original text is the only authority and newer text overrides older text.",
  "Write checks for the objects in `scope` (they changed this round), and to replace the checks in `stale` (whose source, a block they refer to, or a convention they use changed); for no other object. A check runs the program once: `input.files` are written into an empty directory, the program is called with `input.args`, and each assertion reads one fact of the result. Command names, options and JSON keys must be those the requirements' code fragments show.",
  "Every expected value needs a source: verbatim when the requirement states it (quote the block's text exactly), derived when you computed it from the input; for derived values also write `reference_script`, an independent computation from the input files that prints {assertion id: value}. Only values on which both agree are kept. Never compute a digest, hash or checksum yourself: an expected one is source computed, and one an input file needs is written as {{computed:NAME}} in the file, with the reference script printing NAME's value; the code fills it in before the program runs.",
  "Keep convention facts (a shared error format, an output-formatting rule) in their own assertions with role convention, and list those conventions in `uses`; business facts are the object's own behaviour.",
  "Every check states its expected exit code. Prefer checks whose expected output depends on the input data; a check of the exit code alone shows little. `checks` lists the library's checks for these objects and `stale` those whose source text changed this round: derive their replacements where the text still says something checkable. You may propose retiring a check whose expectation rests on replaced text; the code verifies the proposal.",
  "Answer as a patch on `previous_draft` (empty on the first call). When `issues` is not empty, fix exactly those problems and leave the rest as it is.",
].join("\n")
