import { createHash } from "node:crypto"
import { requestJson } from "../model/opencode-transport.js"
import { AuthInvalid, QuotaExhausted, ReplayMiss, type ModelReply, type TokenUsage } from "./attribution.js"
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

export interface ProbeCover { unit: string; trigger_values: string[]; wrong_would: string }

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
  units: { id: string; text: string }[]
  previous_answer?: ProbesAnswer
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
              type: "object", additionalProperties: false, required: ["unit", "trigger_values", "wrong_would"],
              properties: {
                unit: { type: "string", description: "the unit id from the request, for example R1.S3.P5.s8 (not its text)" },
                trigger_values: { type: "array", items: { type: "string" }, description: "exact strings of this probe's args or file contents that make the unit apply" },
                wrong_would: { type: "string", description: "what a plausible wrong program would output for this input instead" },
              },
            },
          },
        },
      },
    },
    uncheckable: { type: "array", items: { type: "object", additionalProperties: false, required: ["unit", "reason"], properties: { unit: { type: "string", description: "a unit id from the request" }, reason: { type: "string" } } } },
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

export function probeProblems(answer: unknown, group: readonly { id: string }[]): { problems: ProbeProblem[]; covered: Set<string>; excused: Set<string> } {
  const problems: ProbeProblem[] = []
  const covered = new Set<string>(), excused = new Set<string>()
  const a = answer as Partial<ProbesAnswer> | null
  if (!a || typeof a !== "object" || !Array.isArray(a.probes) || !Array.isArray(a.uncheckable)) return { problems: [{ message: SHAPE }], covered, excused }
  const ids = new Set(group.map(u => u.id))
  for (const u of a.uncheckable) {
    if (!u || typeof u.unit !== "string" || !ids.has(u.unit)) problems.push({ message: `uncheckable unit ${JSON.stringify(u?.unit)} is not in this group` })
    else if (typeof u.reason !== "string" || !u.reason.trim()) problems.push({ message: `uncheckable unit ${u.unit} has no reason` })
    else excused.add(u.unit)
  }
  const seen = new Set<string>()
  for (const p of a.probes) {
    const name = typeof p?.id === "string" && p.id ? p.id : "(no id)"
    const add = (message: string) => problems.push({ probe: name, message: `probe ${name}: ${message}` })
    if (!p || !Array.isArray(p.args) || !p.args.every(x => typeof x === "string") || !Array.isArray(p.files) || !Array.isArray(p.covers)) { add("args, files and covers must be lists"); continue }
    if (seen.has(name)) { add("the id is used twice"); continue }
    seen.add(name)
    if (!p.files.every(f => f && typeof f.path === "string" && typeof f.content === "string")) { add("every file needs a path and a content"); continue }
    const hay = [...p.args, ...p.files.flatMap(f => [f.path, f.content])].join("\n")
    if (p.covers.length > MAX_UNITS) add(`serves ${p.covers.length} units; at most ${MAX_UNITS}: split it`)
    for (const c of p.covers) {
      if (!c || !ids.has(c.unit)) { add(`unit ${JSON.stringify(c?.unit)} is not in this group`); continue }
      const values = Array.isArray(c.trigger_values) ? c.trigger_values : []
      const missing = values.filter(v => typeof v !== "string" || !v || !hay.includes(v))
      if (!values.length) add(`unit ${c.unit}: no trigger_values`)
      else if (missing.length) add(`unit ${c.unit}: trigger value(s) ${missing.map(v => JSON.stringify(v)).join(", ")} do not occur in the probe's args or files`)
      else if (p.covers.length <= MAX_UNITS) covered.add(c.unit)
    }
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
  // A unit counts as exercised only by a probe that has no problem of its own.
  const faulty = new Set(problems.filter(p => p.probe).map(p => p.probe!))
  covered.clear()
  for (const p of a.probes.filter(x => x && typeof x.id === "string" && !faulty.has(x.id) && Array.isArray(x.covers))) for (const c of p.covers) covered.add(c.unit)
  const gaps = group.filter(u => !covered.has(u.id) && !excused.has(u.id))
  if (gaps.length) problems.push({ message: `units not exercised by any probe with valid trigger values: ${gaps.map(u => u.id).join(", ")}` })
  return { problems, covered, excused }
}

const within = (registry: Registry, inner: string, outer: string) => registry.lineage(inner).some(b => b.id === outer)

/** Probes whose units later text replaced or modified, or whose referred text did (the same rules as checks). */
export function staleProbes(registry: Registry, probes: readonly ProbeRecord[], events: readonly ProbeEvent[], round: number): ProbeEvent[] {
  const gone = new Set(events.map(e => e.probe))
  return probes.filter(p => !gone.has(p.id)).flatMap((p): ProbeEvent[] => {
    const units = p.covers.map(c => c.unit)
    const own = replacedBasis(registry, units, p.round, round)
    if (own.length) return [{ probe: p.id, round, status: "stale", reason: `${own[0].unit}: ${own[0].parts.join(", ")} changed (${own[0].kind}) in round ${own[0].round} by ${own[0].by.join(", ")}` }]
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

/** Writes the probes for `units`, a group of GROUP_SIZE at a time, each with up to `maxRepairs` repairs. */
export async function deriveProbes(registry: Registry, round: number, units: readonly string[], transport: ProbeTransport, options: { maxRepairs: number; callId: (n: number) => string }): Promise<{
  status: "accepted" | "interrupted"; probes: Omit<ProbeRecord, "id">[]; calls: ProbeCallRecord[]; covered: string[]; uncheckable: { unit: string; reason: string }[]; uncovered: string[]; dropped: { key: string; problems: string[] }[]; issues?: { code: string; message: string }[]
}> {
  const sources = sourcesUpTo(registry, round)
  const calls: ProbeCallRecord[] = []
  const out = { probes: [] as Omit<ProbeRecord, "id">[], covered: [] as string[], uncheckable: [] as { unit: string; reason: string }[], uncovered: [] as string[], dropped: [] as { key: string; problems: string[] }[] }
  const groups: { id: string; text: string }[][] = []
  for (let i = 0; i < units.length; i += GROUP_SIZE) groups.push(units.slice(i, i + GROUP_SIZE).map(id => ({ id, text: registry.block(id)!.text })))
  for (const [gi, group] of groups.entries()) {
    let answer: ProbesAnswer | null = null, checked: ReturnType<typeof probeProblems> | null = null, call = "", lastBad = ""
    for (let attempt = 1; attempt <= options.maxRepairs + 1; attempt++) {
      const request: ProbeRequest = { round, sources, units: group, ...(answer && checked ? { previous_answer: answer, problems: checked.problems.map(p => p.message), task: "Fix exactly these problems and return the whole answer for this group." } : lastBad ? { problems: [lastBad], task: "Return one JSON object matching the schema." } : {}) }
      const text = requestJson(request)
      const base = { id: options.callId(calls.length + 1), round, stage: "acceptance" as const, step: "probes" as const, group: gi + 1, attempt, request_sha256: createHash("sha256").update(text).digest("hex"), request_chars: text.length }
      let reply: ModelReply
      try { reply = await transport(request) } catch (e) {
        if (e instanceof ReplayMiss) throw e
        if (e instanceof QuotaExhausted || e instanceof AuthInvalid) {
          calls.push({ ...base, response_text: "", problems: [], usage: zero(), stub: false, error: (e as Error).message })
          return { status: "interrupted", ...out, calls, issues: [{ code: e instanceof AuthInvalid ? "auth" : "quota", message: (e as Error).message }] }
        }
        calls.push({ ...base, response_text: "", problems: [], usage: zero(), stub: false, error: (e as Error).message })
        continue
      }
      let parsed: unknown = null
      try { parsed = JSON.parse(reply.text) } catch { parsed = null }
      const now = parsed === null ? { problems: [{ message: "the reply is not JSON" }], covered: new Set<string>(), excused: new Set<string>() } : probeProblems(parsed, group)
      const usable = parsed !== null && now.problems[0]?.message !== SHAPE
      calls.push({ ...base, response_text: reply.text, problems: now.problems.map(p => p.message), usage: { ...zero(), ...reply.usage }, stub: reply.stub === true, ...(reply.usage === undefined && reply.stub !== true ? { usage_unknown: true } : {}), ...(reply.model ? { model: reply.model } : {}) })
      // Keep the last answer that parsed: a broken repair does not undo a usable earlier answer.
      if (usable) { answer = parsed as ProbesAnswer; checked = now; call = base.id }
      else lastBad = now.problems[0].message
      if (checked && !checked.problems.length) break
    }
    if (!answer || !checked) { out.uncovered.push(...group.map(u => u.id)); continue }
    const faulty = new Map<string, string[]>()
    for (const p of checked.problems.filter(x => x.probe)) faulty.set(p.probe!, [...(faulty.get(p.probe!) ?? []), p.message])
    for (const p of answer.probes) {
      const key = `g${gi + 1}_${p.id}`
      if (faulty.has(p.id)) { out.dropped.push({ key, problems: faulty.get(p.id)! }); continue }
      out.probes.push({ round, key, args: p.args, files: p.files, invalid_on_purpose: p.invalid_on_purpose === true, covers: p.covers.map(c => ({ unit: c.unit, trigger_values: c.trigger_values, wrong_would: c.wrong_would })), call })
    }
    out.covered.push(...group.filter(u => checked!.covered.has(u.id)).map(u => u.id))
    out.uncheckable.push(...answer.uncheckable.filter(u => checked!.excused.has(u.unit)))
    out.uncovered.push(...group.filter(u => !checked!.covered.has(u.id) && !checked!.excused.has(u.id)).map(u => u.id))
  }
  return { status: "accepted", ...out, calls }
}

// ---------------------------------------------------------------- running

export interface ProbeOutput { exit_code: number | null; timed_out: boolean; stdout: string; stderr: string; files: Record<string, string> }

export interface ProbeRun { probe: string; output: ProbeOutput }

const clip = (s: string, n: number) => s.length > n ? `${s.slice(0, n)}…(${s.length - n} more chars)` : s

/** What the judge sees of a run: line ends unified, long text cut, and only the files the program made or changed. */
export function normalizeOutput(out: RunOutput, inputs: readonly { path: string; content: string }[]): ProbeOutput {
  const given = new Map(inputs.map(f => [f.path, f.content]))
  const files = Object.fromEntries(Object.entries(out.files).filter(([p, c]) => !p.startsWith("__") && given.get(p) !== c).sort(([a], [b]) => a < b ? -1 : 1).map(([p, c]) => [p, clip(c.replace(/\r/gu, ""), 1500)]))
  return { exit_code: out.exit_code, timed_out: out.timed_out, stdout: clip(out.stdout.replace(/\r/gu, ""), 1500), stderr: clip(out.stderr.replace(/\r/gu, ""), 1500), files }
}

export async function runProbes(probes: readonly ProbeRecord[], program: ProgramRef, runner: CheckRunner, timeoutMs: number): Promise<ProbeRun[]> {
  const runs: ProbeRun[] = []
  for (const p of probes) runs.push({ probe: p.id, output: normalizeOutput(await runner.run(program, { args: p.args, files: p.files }, timeoutMs), p.files) })
  return runs
}
