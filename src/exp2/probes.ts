import { createHash } from "node:crypto"
import { requestJson } from "../model/opencode-transport.js"
import { AuthInvalid, QuotaExhausted, ReplayMiss, TRANSPORT_RETRIES, type ModelReply, type TokenUsage } from "./attribution.js"
import { EnvironmentBlocked } from "./platform.js"
import { mapPool } from "./pool.js"
import { coverage, EMPTY_CHECKS, replacedBasis } from "./checks.js"
import { LIVE_STATES, type Registry } from "./registry.js"
import type { CheckRunner, ProgramRef, RunOutput } from "./runner.js"
import { annotate } from "./source.js"

/**
 * Probes (BLOCK10 §1.2–1.3): calls of the program written by an independent model for every rule-bearing unit of
 * the round's changed text, with the literal values that make each rule apply. No expected output: a judge reads
 * what the program did (judge.ts). Code checks that every unit is exercised by a value present in the probe's input,
 * that a probe serves at most MAX_UNITS units, and that its inputs are well formed. Probes are fixed data once
 * admitted: replayed every round, and stale when the text they rest on is replaced.
 */

export const MAX_UNITS = 4
export const GROUP_SIZE = 22

/** case: the case id the cover reaches (null for a unit without cases). */
export interface ProbeCover { unit: string; case?: string | null; trigger_values: string[]; wrong_would: string }

export interface ProbeDraft {
  id: string
  args: string[]
  files: { path: string; content: string }[]
  invalid_on_purpose: boolean
  covers: ProbeCover[]
}

export interface ProbesAnswer { probes: ProbeDraft[]; uncheckable: { unit: string; reason: string }[] }

export interface ProbeRecord {
  /** P1, P2, … never reused. */
  id: string
  round: number
  /** The writer's own id for it, with the group: g2_window-rank. */
  key: string
  args: string[]
  files: { path: string; content: string }[]
  invalid_on_purpose: boolean
  covers: ProbeCover[]
  call: string
}

export interface ProbeEvent { probe: string; round: number; status: "stale"; reason: string }

export interface ProbeRequest {
  round: number
  sources: string
  units: { id: string; text: string; cases?: { id: string; text: string }[] }[]
  previous_answer?: ProbesAnswer
  /** Probes already admitted for these units (a strengthening request adds to them). */
  existing?: ProbeDraft[]
  problems?: string[]
  task?: string
}

export type ProbeTransport = (request: ProbeRequest) => Promise<ModelReply>

export interface ProbeCallRecord {
  id: string
  round: number
  stage: "acceptance"
  step: "probes"
  group: number
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

export interface ProbeRoundRecord {
  round: number
  status: "accepted" | "interrupted"
  calls: string[]
  entered: string[]
  stale: string[]
  /** Units of this round to exercise: changed text, and the live units of probes that went stale. */
  units: string[]
  covered: string[]
  uncheckable: { unit: string; reason: string }[]
  /** Units still not exercised when the repairs ran out. */
  uncovered: string[]
  /** Probes left out when the repairs ran out, with their problems. */
  dropped: { key: string; problems: string[] }[]
  /** Units or cases left unexercised by earlier rounds, written for again in this one (BLOCK11 §2). */
  gaps_in?: string[]
  /** Case-level coverage (BLOCK10 §7.3): cases code found in the units, reached, declared uncheckable, still open. */
  cases?: { total: number; covered: number; excused: number; open: string[] }
  issues?: { code: string; message: string }[]
}

export const PROBES_SCHEMA = {
  type: "object", additionalProperties: false, required: ["probes", "uncheckable"],
  properties: {
    probes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["id", "args", "files", "covers", "invalid_on_purpose"],
        properties: {
          id: { type: "string", description: "A short name for the probe, used once in this answer." },
          args: { type: "array", items: { type: "string" }, description: "The program's arguments (without the program name)." },
          invalid_on_purpose: { type: "boolean", description: "true when the probe deliberately gives an absent or malformed input to exercise an error rule" },
          files: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } } },
          covers: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["unit", "case", "trigger_values", "wrong_would"],
              properties: {
                unit: { type: "string", description: "the unit id from the request, for example R1.S3.P5.s8 (not its text)" },
                case: { type: ["string", "null"], description: "the case id from the unit's `cases` this cover reaches; null when the unit lists no cases" },
                trigger_values: { type: "array", items: { type: "string" }, description: "exact strings of this probe's args or file contents that make the unit apply" },
                wrong_would: { type: "string", description: "what a plausible wrong program would output for this input instead" },
              },
            },
          },
        },
      },
    },
    uncheckable: { type: "array", items: { type: "object", additionalProperties: false, required: ["unit", "reason"], properties: { unit: { type: "string", description: "a unit id or a case id from the request" }, reason: { type: "string" } } } },
  },
}

export const PROBES_SYSTEM_PROMPT = [
  "You write probes for a command-line program from its requirements. A probe is one call: the program with `args`, in an empty directory holding the files you list. `sources` holds the requirements, annotated with block ids; newer text overrides older text.",
  "You get a group of rule units (exact text, with ids). A unit may list `cases`: parts of its text that are separate cases (alternatives the text lists, and its clauses). Each case needs its own cover: a probe whose input reaches that case, with `case` set to the case id. A unit without cases needs one cover with `case` null.",
  "For every cover give:",
  "- trigger_values: the exact strings in that probe's args or file contents that make the rule (or the case) apply. Each must appear literally in the probe. A case that is one of listed alternatives has that alternative among them; a case that compares with a number has that number among them.",
  "- wrong_would: what a plausible wrong program would output for this input instead.",
  "Choose inputs for which a program that gets the rule wrong gives a different output from one that follows it. A rule that applies only in some cases is exercised only by input for which it applies.",
  `A probe may serve at most ${MAX_UNITS} units. Do not write expected outputs. If a unit or a case cannot be shown by running the program, mark it uncheckable with a reason.`,
  "Example (another program): unit U7 'prints the greeting in the language `--lang` names: `en` or `fr`', cases U7#1 `en` and U7#2 `fr` -> probe args [\"greet\",\"--lang\",\"fr\"] covers {unit U7, case U7#2, trigger_values [\"fr\"], wrong_would \"prints the English greeting\"}, and a second probe with `en` for U7#1.",
].join("\n")

const zero = (): TokenUsage => ({ input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 })

export function sourcesUpTo(registry: Registry, round: number): string {
  return [...registry.sources.values()].filter(s => s.round <= round).sort((a, b) => a.round - b.round).map(s => `===== R${s.round} =====\n${annotate(s)}`).join("\n")
}

/** A problem with the answer; `probe` when it belongs to one probe (that probe alone is dropped if it stays). */
export interface ProbeProblem { probe?: string; message: string }

const SHAPE = "the answer must have probes and uncheckable lists"
const OUTPUT_OPTION = /^--?(out|output|dest|report|target)\b/u

/** A unit as the writer gets it: its text, and the cases code found in it. */
export interface GroupUnit { id: string; text: string; cases: RuleCase[]; needs: string[] }

/**
 * A case a rule sentence distinguishes (BLOCK10 §7.3), found by code in the sentence's own text: each of a list of
 * alternatives (code spans next to each other, joined by commas, "or", "and" or "/"), and each clause that states a
 * rule (holds a code span or a number) when the sentence has more than one clause. `needs`: values a cover of the
 * case must name among its trigger values: the alternative itself, and every number the case compares with.
 */
export interface RuleCase { id: string; text: string; kind: "alternative" | "clause"; needs: string[] }

const SPAN = /`([^`\n]+)`/gu
const RUN = /`[^`\n]+`(?:\s*(?:,\s*(?:or\s+|and\s+)?|or\s+|and\s+|\/\s*)`[^`\n]+`)+/gu
const COMPARED = /(?:>=|<=|≥|≤|>|<)\s*(-?\d+(?:\.\d+)?)/gu
/** An alternative a probe can name: a short token, no placeholder, no spaces. */
const NAMEABLE = /^[^\s<>]{1,40}$/u

export function ruleCases(registry: Registry, unit: string): { cases: RuleCase[]; needs: string[] } {
  const b = registry.block(unit)
  if (!b) return { cases: [], needs: [] }
  const numbers = (t: string) => [...new Set([...t.replace(SPAN, (_m, x: string) => ` ${x} `).matchAll(COMPARED)].map(m => m[1]))]
  const cases: RuleCase[] = []
  let k = 0
  for (const run of b.text.matchAll(RUN)) {
    const alts = [...run[0].matchAll(SPAN)].map(m => m[1].trim()).filter(x => NAMEABLE.test(x))
    if (alts.length >= 2) for (const v of alts) cases.push({ id: `${unit}#${++k}`, text: v, kind: "alternative", needs: [v] })
  }
  const clauses = b.children.map(id => registry.block(id)!).filter(c => c.kind === "clause")
  // A clause whose only rule content is one of the listed alternatives is that alternative's case already.
  const listed = new Set(cases.map(c => c.text))
  const onlyListed = (t: string) => { const spans = [...t.matchAll(SPAN)].map(m => m[1].trim()); return spans.length > 0 && spans.every(x => listed.has(x)) && !/\d/u.test(t.replace(SPAN, "")) && t.replace(SPAN, "").replace(/[^A-Za-z]/gu, "").length < 3 }
  if (clauses.length >= 2) for (const c of clauses.filter(x => /`[^`]+`|\d/u.test(x.text) && !onlyListed(x.text))) cases.push({ id: c.id, text: c.text.trim(), kind: "clause", needs: numbers(c.text) })
  // One case is no distinction: the unit is covered as a whole.
  return cases.length >= 2 ? { cases, needs: [] } : { cases: [], needs: numbers(b.text) }
}

export function groupUnit(registry: Registry, id: string): GroupUnit {
  return { id, text: registry.block(id)!.text, ...ruleCases(registry, id) }
}

/**
 * Code checks of an answer. A unit is covered when each of its cases is (or, without cases, the unit itself): by a
 * cover of a probe that has no problem of its own, whose trigger values occur in the probe and include what the
 * case needs. `strengthen`: an answer that only adds probes, so units already covered need no new cover.
 */
export function probeProblems(answer: unknown, group: readonly GroupUnit[], options: { strengthen?: boolean } = {}): { problems: ProbeProblem[]; covered: Set<string>; excused: Set<string>; cases: { total: number; covered: string[]; excused: string[] } } {
  const problems: ProbeProblem[] = []
  const covered = new Set<string>(), excused = new Set<string>()
  const empty = { total: group.reduce((n, u) => n + u.cases.length, 0), covered: [], excused: [] }
  const a = answer as Partial<ProbesAnswer> | null
  if (!a || typeof a !== "object" || !Array.isArray(a.probes) || !Array.isArray(a.uncheckable)) return { problems: [{ message: SHAPE }], covered, excused, cases: empty }
  const units = new Map(group.map(u => [u.id, u]))
  const caseOf = new Map(group.flatMap(u => u.cases.map(c => [c.id, { unit: u, c }] as const)))
  for (const u of a.uncheckable) {
    if (!u || typeof u.unit !== "string" || (!units.has(u.unit) && !caseOf.has(u.unit))) problems.push({ message: `uncheckable ${JSON.stringify(u?.unit)} is not a unit or case of this group` })
    else if (typeof u.reason !== "string" || !u.reason.trim()) problems.push({ message: `uncheckable ${u.unit} has no reason` })
    else excused.add(u.unit)
  }
  const seen = new Set<string>()
  const reached = new Map<string, Set<string>>()
  for (const p of a.probes) {
    const name = typeof p?.id === "string" && p.id ? p.id : "(no id)"
    const add = (message: string) => problems.push({ probe: name, message: `probe ${name}: ${message}` })
    if (!p || !Array.isArray(p.args) || !p.args.every(x => typeof x === "string") || !Array.isArray(p.files) || !Array.isArray(p.covers)) { add("args, files and covers must be lists"); continue }
    if (seen.has(name)) { add("the id is used twice"); continue }
    seen.add(name)
    if (!p.files.every(f => f && typeof f.path === "string" && typeof f.content === "string")) { add("every file needs a path and a content"); continue }
    const hay = [...p.args, ...p.files.flatMap(f => [f.path, f.content])].join("\n")
    const served = new Set(p.covers.map(c => c?.unit))
    if (served.size > MAX_UNITS) add(`serves ${served.size} units; at most ${MAX_UNITS}: divide it`)
    const mine = new Set<string>()
    for (const c of p.covers) {
      const u = c ? units.get(c.unit) : undefined
      if (!u) { add(`unit ${JSON.stringify(c?.unit)} is not in this group`); continue }
      const which = c.case ?? null
      if (which !== null && !u.cases.some(x => x.id === which)) { add(`unit ${u.id}: ${JSON.stringify(which)} is not one of its cases (${u.cases.map(x => x.id).join(", ") || "it has none: use null"})`); continue }
      if (which === null && u.cases.length) { add(`unit ${u.id} has cases (${u.cases.map(x => x.id).join(", ")}): each cover names one`); continue }
      const values = Array.isArray(c.trigger_values) ? c.trigger_values : []
      const missing = values.filter(v => typeof v !== "string" || !v || !hay.includes(v))
      const needs = which === null ? u.needs : u.cases.find(x => x.id === which)!.needs
      const lacking = needs.filter(n => !values.some(v => typeof v === "string" && v.trim() === n))
      const label = which === null ? `unit ${u.id}` : `unit ${u.id}, case ${which}`
      if (!values.length) add(`${label}: no trigger_values`)
      else if (missing.length) add(`${label}: trigger value(s) ${missing.map(v => JSON.stringify(v)).join(", ")} do not occur in the probe's args or files`)
      else if (lacking.length) add(`${label}: the trigger values must include ${lacking.map(v => JSON.stringify(v)).join(", ")}, which the text names for this case`)
      else mine.add(which ?? u.id)
    }
    reached.set(name, mine)
    if (p.invalid_on_purpose) continue
    const names = new Set(p.files.map(f => f.path))
    p.args.forEach((arg, i) => {
      if (/\.(csv|json)$/u.test(arg) && !names.has(arg) && !OUTPUT_OPTION.test(p.args[i - 1] ?? "") && !/^(out|output|result)/u.test(arg)) add(`argument ${arg} names a file the probe does not give`)
    })
    for (const f of p.files) {
      if (f.path.endsWith(".json")) { try { JSON.parse(f.content) } catch { add(`${f.path} is not valid JSON`) } }
      if (f.path.endsWith(".csv") && !f.content.includes("\"")) {
        const rows = f.content.replace(/\r?\n$/u, "").split(/\r?\n/u), n = rows[0].split(",").length
        const bad = rows.findIndex(r => r.split(",").length !== n)
        if (bad > 0) add(`${f.path} line ${bad + 1} has ${rows[bad].split(",").length} fields, the first line has ${n}`)
      }
    }
  }
  // Only probes with no problem of their own count.
  const faulty = new Set(problems.filter(p => p.probe).map(p => p.probe!))
  const hit = new Set([...reached.entries()].filter(([n]) => !faulty.has(n)).flatMap(([, s]) => [...s]))
  const caseCovered: string[] = [], caseExcused: string[] = []
  const gaps: string[] = []
  for (const u of group) {
    if (excused.has(u.id)) continue
    if (!u.cases.length) { if (hit.has(u.id)) covered.add(u.id); else if (!options.strengthen) gaps.push(u.id); continue }
    const open = u.cases.filter(c => !hit.has(c.id) && !excused.has(c.id))
    caseCovered.push(...u.cases.filter(c => hit.has(c.id)).map(c => c.id))
    caseExcused.push(...u.cases.filter(c => !hit.has(c.id) && excused.has(c.id)).map(c => c.id))
    if (!open.length) covered.add(u.id)
    else if (!options.strengthen) gaps.push(open.length === u.cases.length ? u.id : `${u.id} (cases not reached: ${open.map(c => c.id).join(", ")})`)
  }
  if (gaps.length) problems.push({ message: `units not exercised by any probe with valid trigger values: ${gaps.join(", ")}` })
  return { problems, covered, excused, cases: { total: empty.total, covered: caseCovered, excused: caseExcused } }
}

const within = (registry: Registry, inner: string, outer: string) => registry.lineage(inner).some(b => b.id === outer)

/** Probes whose units later text replaced or modified, or whose referred text did (the same rules as checks). */
export function staleProbes(registry: Registry, probes: readonly ProbeRecord[], events: readonly ProbeEvent[], round: number, options: { byReference?: boolean } = {}): ProbeEvent[] {
  const gone = new Set(events.map(e => e.probe))
  return probes.filter(p => !gone.has(p.id)).flatMap((p): ProbeEvent[] => {
    const units = p.covers.map(c => c.unit)
    const own = replacedBasis(registry, units, p.round, round)
    if (own.length) return [{ probe: p.id, round, status: "stale", reason: `${own[0].unit}: ${own[0].parts.join(", ")} changed (${own[0].kind}) in round ${own[0].round} by ${own[0].by.join(", ")}` }]
    if (options.byReference === false) return []
    for (const e of registry.references.filter(x => x.kind === "refers_to" && units.some(u => within(registry, x.from, u) || within(registry, u, x.from)))) {
      const hit = replacedBasis(registry, registry.referredText(e), p.round, round)
      if (hit.length) return [{ probe: p.id, round, status: "stale", reason: `${e.from} refers to ${e.to}, changed in round ${hit[0].round}` }]
    }
    return []
  })
}

export function activeProbes(probes: readonly ProbeRecord[], events: readonly ProbeEvent[]): ProbeRecord[] {
  const gone = new Set(events.map(e => e.probe))
  return probes.filter(p => !gone.has(p.id))
}

/**
 * Units no probe exercises yet (BLOCK11 §2): unexercised units and units with open cases of earlier rounds, until
 * a later round covers them or declares them uncheckable; only text still in force.
 */
export function openGaps(registry: Registry, rounds: readonly ProbeRoundRecord[], coveredElsewhere: (unit: string) => boolean = () => false): string[] {
  return gapState(registry, rounds, coveredElsewhere).open
}

/** A unit the writing left unexercised twice is closed by code as uncheckable, with that reason, and still reported (DESIGN §12g). */
export const GAP_ATTEMPTS = 2

/**
 * Open and closed gaps: a unit stays open until a probe exercises it, the writer declares it uncheckable, a library
 * check rests on it, its text goes out of force, or GAP_ATTEMPTS writings in a row leave it unexercised.
 */
export function gapState(registry: Registry, rounds: readonly ProbeRoundRecord[], coveredElsewhere: (unit: string) => boolean = () => false): { open: string[]; closed: { unit: string; round: number; reason: string }[] } {
  const open = new Map<string, number[]>()
  const closed: { unit: string; round: number; reason: string }[] = []
  const unitOf = (id: string) => id.includes("#") ? id.split("#")[0] : registry.block(id)?.parent ?? id
  for (const r of [...rounds].filter(x => x.status === "accepted").sort((a, b) => a.round - b.round)) {
    for (const u of r.covered) open.delete(u)
    // A unit declared uncheckable is closed; a case declared so already lets its unit count as covered.
    for (const u of r.uncheckable) open.delete(u.unit)
    for (const u of new Set([...r.uncovered, ...(r.cases?.open ?? []).map(unitOf)])) {
      const tries = [...(open.get(u) ?? []), r.round]
      if (tries.length < GAP_ATTEMPTS) { open.set(u, tries); continue }
      open.delete(u)
      closed.push({ unit: u, round: r.round, reason: `uncheckable: no probe exercised it in ${tries.length} writings (rounds ${tries.join(", ")})` })
    }
  }
  return { open: [...open.keys()].filter(u => live(registry, u) && !coveredElsewhere(u)), closed: closed.filter(c => live(registry, c.unit)) }
}

const live = (registry: Registry, unit: string) => {
  const own = registry.ownership(unit)
  return !!registry.block(unit) && (!own || LIVE_STATES.has(own.state))
}

/** The units this round's probes must exercise: changed text, and the live units of probes that just went stale. */
export function probeUnits(registry: Registry, round: number, staleNow: readonly ProbeRecord[]): string[] {
  const units = coverage(registry, round, EMPTY_CHECKS, [], []).units
  const again = staleNow.flatMap(p => p.covers.map(c => c.unit)).filter(u => live(registry, u))
  return [...new Set([...units, ...again])]
}

export interface DerivedProbes {
  status: "accepted" | "interrupted"
  probes: Omit<ProbeRecord, "id">[]
  calls: ProbeCallRecord[]
  covered: string[]
  uncheckable: { unit: string; reason: string }[]
  uncovered: string[]
  dropped: { key: string; problems: string[] }[]
  cases: { total: number; covered: number; excused: number; open: string[] }
  issues?: { code: string; message: string }[]
}

type GroupAsk = { kind: "write" } | { kind: "strengthen"; weak: string[]; existing: ProbeDraft[] }

/**
 * Asks for one group's probes: the first answer and up to `maxRepairs` repairs, each sent back with the exact
 * problems code found. A transport failure is retried without using up a repair (TRANSPORT_RETRIES per call of
 * this function's caller); a strengthening request says what the measure found weak and gives the existing probes.
 */
async function askGroup(transport: ProbeTransport, round: number, sources: string, group: GroupUnit[], gi: number, ask: GroupAsk, options: { maxRepairs: number; callId: (n: number) => string }, calls: ProbeCallRecord[], failures: { n: number; last?: string }): Promise<{ answer: ProbesAnswer | null; checked: ReturnType<typeof probeProblems> | null; call: string } | { interrupted: { code: string; message: string } }> {
  const units = group.map(u => ({ id: u.id, text: u.text, ...(u.cases.length ? { cases: u.cases.map(c => ({ id: c.id, text: c.text })) } : {}) }))
  const strengthen = ask.kind === "strengthen"
  let answer: ProbesAnswer | null = null, checked: ReturnType<typeof probeProblems> | null = null, call = "", lastBad = ""
  for (let attempt = 1; attempt <= options.maxRepairs + 1; attempt++) {
    // Another group already found the writer unavailable: no new call is started.
    if (failures.n > TRANSPORT_RETRIES) return { interrupted: { code: "unavailable", message: `${failures.n} probe-writer calls failed; last: ${failures.last}` } }
    const opening = strengthen ? { existing: ask.existing, problems: ask.weak, task: "Add probes so that each listed weakness is removed; return only the new probes." } : {}
    const repair = answer && checked ? { previous_answer: answer, problems: [...(strengthen ? ask.weak : []), ...checked.problems.map(p => p.message)], task: strengthen ? "Fix exactly these problems and return the whole set of new probes." : "Fix exactly these problems and return the whole answer for this group." } : lastBad ? { problems: [lastBad], task: "Return one JSON object matching the schema." } : {}
    const request: ProbeRequest = { round, sources, units, ...opening, ...repair }
    const text = requestJson(request)
    const base = { id: options.callId(calls.length + 1), round, stage: "acceptance" as const, step: "probes" as const, group: gi + 1, attempt, request_sha256: createHash("sha256").update(text).digest("hex"), request_chars: text.length }
    let reply: ModelReply
    try { reply = await transport(request) } catch (e) {
      if (e instanceof ReplayMiss || e instanceof EnvironmentBlocked) throw e
      calls.push({ ...base, response_text: "", problems: [], usage: zero(), stub: false, error: (e as Error).message })
      if (e instanceof QuotaExhausted || e instanceof AuthInvalid) return { interrupted: { code: e instanceof AuthInvalid ? "auth" : "quota", message: (e as Error).message } }
      // A transport failure is no answer: retried without using up a repair, and past the limit the writer is unavailable.
      failures.last = (e as Error).message
      if (++failures.n > TRANSPORT_RETRIES) return { interrupted: { code: "unavailable", message: `${failures.n} probe-writer calls failed; last: ${failures.last}` } }
      attempt--
      continue
    }
    let parsed: unknown = null
    try { parsed = JSON.parse(reply.text) } catch { parsed = null }
    const now = parsed === null ? { problems: [{ message: "the reply is not JSON" }], covered: new Set<string>(), excused: new Set<string>(), cases: { total: 0, covered: [], excused: [] } } : probeProblems(parsed, group, { strengthen })
    const usable = parsed !== null && now.problems[0]?.message !== SHAPE
    calls.push({ ...base, response_text: reply.text, problems: now.problems.map(p => p.message), usage: { ...zero(), ...reply.usage }, stub: reply.stub === true, ...(reply.usage === undefined && reply.stub !== true ? { usage_unknown: true } : {}), ...(reply.model ? { model: reply.model } : {}) })
    // Keep the last answer that parsed: a broken repair does not undo a usable earlier answer.
    if (usable) { answer = parsed as ProbesAnswer; checked = now; call = base.id }
    else lastBad = now.problems[0].message
    if (checked && !checked.problems.length) break
  }
  return { answer, checked, call }
}

/** The admitted probes of one answer: those with no problem of their own; the others are dropped with their problems. */
function admit(answer: ProbesAnswer, checked: ReturnType<typeof probeProblems>, round: number, gi: number, call: string, prefix: string, out: Pick<DerivedProbes, "probes" | "dropped">): void {
  const faulty = new Map<string, string[]>()
  for (const p of checked.problems.filter(x => x.probe)) faulty.set(p.probe!, [...(faulty.get(p.probe!) ?? []), p.message])
  for (const p of answer.probes) {
    const key = `${prefix}${gi + 1}_${p.id}`
    if (faulty.has(p.id)) { out.dropped.push({ key, problems: faulty.get(p.id)! }); continue }
    out.probes.push({ round, key, args: p.args, files: p.files, invalid_on_purpose: p.invalid_on_purpose === true, covers: p.covers.map(c => ({ unit: c.unit, case: c.case ?? null, trigger_values: c.trigger_values, wrong_would: c.wrong_would })), call })
  }
}

/**
 * A transport whose first reply (or failure) settles `warm`: calls that share its opening wait for it, so a provider
 * that caches prompt prefixes has the prefix when they arrive (DESIGN §12h E5).
 */
export function warmFirst<R, A>(transport: (request: R) => Promise<A>): { transport: (request: R) => Promise<A>; warm: Promise<void> } {
  let opened!: () => void
  const warm = new Promise<void>(r => { opened = r })
  return { warm, transport: async request => { try { return await transport(request) } finally { opened() } } }
}

/** Groups asked side by side; each group's requests are what they would be one after another. */
export const GROUP_CONCURRENCY = 3

/** Writes the probes for `units`, a group of GROUP_SIZE at a time, each with up to `maxRepairs` repairs. */
export async function deriveProbes(registry: Registry, round: number, units: readonly string[], transport: ProbeTransport, options: { maxRepairs: number; callId: (n: number) => string; concurrency?: number }): Promise<DerivedProbes> {
  const sources = sourcesUpTo(registry, round)
  const out: Omit<DerivedProbes, "status" | "calls"> = { probes: [], covered: [], uncheckable: [], uncovered: [], dropped: [], cases: { total: 0, covered: 0, excused: 0, open: [] } }
  const groups: GroupUnit[][] = []
  for (let i = 0; i < units.length; i += GROUP_SIZE) groups.push(units.slice(i, i + GROUP_SIZE).map(id => groupUnit(registry, id)))
  const failures: { n: number; last?: string } = { n: 0 }
  // Each group keeps its own calls (provisional ids); ids in the record follow group order, as one after another.
  // The other groups wait for the first group's first reply: they open with the same system prompt and sources, so
  // they can read the prefix it wrote to the provider's cache (DESIGN §12h E5).
  const first = warmFirst(transport)
  const asked = await mapPool(groups, options.concurrency ?? GROUP_CONCURRENCY, async (group, gi) => {
    const calls: ProbeCallRecord[] = []
    if (gi > 0) await first.warm
    const r = await askGroup(gi === 0 ? first.transport : transport, round, sources, group, gi, { kind: "write" }, { ...options, callId: n => `~g${gi}.${n}` }, calls, failures)
    return { r, calls }
  })
  const calls = asked.flatMap(a => a.calls)
  const ids = new Map(calls.map((c, i) => [c.id, options.callId(i + 1)]))
  for (const c of calls) c.id = ids.get(c.id)!
  for (const [gi, group] of groups.entries()) {
    out.cases.total += group.reduce((n, u) => n + u.cases.length, 0)
    const r = asked[gi].r
    if ("interrupted" in r) return { status: "interrupted", ...out, calls, issues: [r.interrupted] }
    const { answer, checked } = r, call = ids.get(r.call) ?? r.call
    if (!answer || !checked) { out.uncovered.push(...group.map(u => u.id)); out.cases.open.push(...group.flatMap(u => u.cases.map(c => c.id))); continue }
    admit(answer, checked, round, gi, call, "g", out)
    out.covered.push(...group.filter(u => checked.covered.has(u.id)).map(u => u.id))
    out.uncheckable.push(...answer.uncheckable.filter(u => checked.excused.has(u.unit)))
    out.uncovered.push(...group.filter(u => !checked.covered.has(u.id) && !checked.excused.has(u.id)).map(u => u.id))
    out.cases.covered += checked.cases.covered.length
    out.cases.excused += checked.cases.excused.length
    out.cases.open.push(...group.flatMap(u => checked.excused.has(u.id) ? [] : u.cases.filter(c => !checked.cases.covered.includes(c.id) && !checked.cases.excused.includes(c.id)).map(c => c.id)))
  }
  return { status: "accepted", ...out, calls }
}

/**
 * Strengthens probes where the discrimination measure found them weak (BLOCK10 §7.3): per group of weak units, the
 * writer gets the units, their existing probes and what was found, and adds probes; the additions pass the same code
 * checks and repairs as any probe.
 */
export async function strengthenProbes(registry: Registry, round: number, weak: readonly { units: string[]; message: string }[], existing: readonly ProbeRecord[], transport: ProbeTransport, options: { maxRepairs: number; callId: (n: number) => string }): Promise<Omit<DerivedProbes, "covered" | "uncheckable" | "uncovered" | "cases">> {
  const sources = sourcesUpTo(registry, round)
  const calls: ProbeCallRecord[] = []
  const out = { probes: [] as Omit<ProbeRecord, "id">[], dropped: [] as { key: string; problems: string[] }[] }
  const failures: { n: number; last?: string } = { n: 0 }
  for (const [gi, w] of weak.entries()) {
    const group = w.units.map(id => groupUnit(registry, id))
    const mine = existing.filter(p => p.covers.some(c => w.units.includes(c.unit))).map(p => ({ id: p.key, args: p.args, files: p.files, invalid_on_purpose: p.invalid_on_purpose, covers: p.covers }))
    const r = await askGroup(transport, round, sources, group, gi, { kind: "strengthen", weak: [w.message], existing: mine }, options, calls, failures)
    if ("interrupted" in r) return { status: "interrupted", ...out, calls, issues: [r.interrupted] }
    if (r.answer && r.checked) admit(r.answer, r.checked, round, gi, r.call, `s${round}.`, out)
  }
  return { status: "accepted", ...out, calls }
}

// ---------------------------------------------------------------- running

/** stopped: the controller stopped the program at a limit on this input (memory, time, output), and how. */
export interface ProbeOutput { exit_code: number | null; timed_out: boolean; stdout: string; stderr: string; files: Record<string, string>; stopped?: string }

/**
 * files, stdout, stderr: what the run left, uncut (for a computation the judge asks for and the comparison of its value;
 * never judged as such). coverage: the functions of the program the run executed, where the program was built to
 * record it (DESIGN §12h E4).
 */
export interface ProbeRun { probe: string; output: ProbeOutput; files?: Record<string, string>; stdout?: string; stderr?: string; coverage?: string }

const clip = (s: string, n: number) => s.length > n ? `${s.slice(0, n)}…(${s.length - n} more chars)` : s

/** What the judge sees of a run: line ends unified, long text cut, and only the files the program made or changed. */
export function normalizeOutput(out: RunOutput, inputs: readonly { path: string; content: string }[]): ProbeOutput {
  const given = new Map(inputs.map(f => [f.path, f.content]))
  const files = Object.fromEntries(Object.entries(out.files).filter(([p, c]) => !p.startsWith("__") && given.get(p) !== c).sort(([a], [b]) => a < b ? -1 : 1).map(([p, c]) => [p, clip(c.replace(/\r/gu, ""), 1500)]))
  return { exit_code: out.exit_code, timed_out: out.timed_out, stdout: clip(out.stdout.replace(/\r/gu, ""), 1500), stderr: clip(out.stderr.replace(/\r/gu, ""), 1500), files, ...(out.limit ? { stopped: `${out.limit.kind} limit: ${out.limit.detail}` } : {}) }
}

/** Probes run side by side (each in its own directory or container, within its resource limits), results in probe order. */
export const PROBE_CONCURRENCY = 4

export async function runProbes(probes: readonly ProbeRecord[], program: ProgramRef, runner: CheckRunner, timeoutMs: number, concurrency = PROBE_CONCURRENCY): Promise<ProbeRun[]> {
  // A batch runner runs the set in few containers; otherwise the runs go side by side, one each.
  const outs = runner.runBatch
    ? await runner.runBatch(program, probes.map(p => ({ args: p.args, files: p.files })), timeoutMs)
    : await mapPool(probes, concurrency, p => runner.run(program, { args: p.args, files: p.files }, timeoutMs))
  return probes.map((p, i) => ({ probe: p.id, output: normalizeOutput(outs[i], p.files), files: outs[i].files, stdout: outs[i].stdout, stderr: outs[i].stderr, ...(outs[i].coverage !== undefined ? { coverage: outs[i].coverage } : {}) }))
}
