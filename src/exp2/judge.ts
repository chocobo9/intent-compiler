import { createHash } from "node:crypto"
import { requestJson } from "../model/opencode-transport.js"
import { AuthInvalid, QuotaExhausted, ReplayMiss, RoleUnavailable, TRANSPORT_RETRIES, type ModelReply, type TokenUsage } from "./attribution.js"
import { EnvironmentBlocked } from "./platform.js"
import type { ProbeOutput, ProbeRecord, ProbeRun } from "./probes.js"
import { sourcesUpTo } from "./probes.js"
import type { Registry } from "./registry.js"
import type { ObjectStatus } from "./verdict.js"

/**
 * The judge (BLOCK10 §1.4): an independent model reads, for each run of a probe, the rule text of the units it
 * serves, the call with its input files, and what the program did, and says per unit: ok, wrong, cannot_tell, or
 * ambiguous (the text allows a reading under which the output is right). It never sees expected values, the probe
 * writer's notes, other programs or official results. Only "wrong" makes a correction item; "ambiguous" is recorded
 * apart and never sent to the executor. Verdicts are kept by (probe, unit, unit text, output): an unchanged output is
 * not judged again.
 */

export type Verdict = "ok" | "wrong" | "cannot_tell" | "ambiguous"

export interface JudgeItem {
  item: string
  units: { id: string; text: string }[]
  call: string[]
  input_files: { path: string; content: string }[]
  result: ProbeOutput
  /** The coding agent's objection to an earlier "wrong" on this run, for a second look. */
  contest?: string
}

export interface JudgeRequest { round: number; sources: string; items: JudgeItem[]; problems?: string[] }

export type JudgeTransport = (request: JudgeRequest) => Promise<ModelReply>

export interface JudgeAnswer { verdicts: { item: string; unit: string; verdict: Verdict; reason: string }[] }

export interface Judgment { key: string; probe: string; unit: string; verdict: Verdict; reason: string; round: number; call: string; contested?: boolean }

export interface JudgeCallRecord {
  id: string
  round: number
  stage: "acceptance"
  step: "judge"
  items: number
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

/** One unit of one run, judged (or not: cannot_tell with no call when no verdict came back). */
export interface Finding { probe: string; unit: string; verdict: Verdict; reason: string; cached: boolean }

export const JUDGE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      description: "One entry for every unit of every item.",
      items: {
        type: "object", additionalProperties: false, required: ["item", "unit", "verdict", "reason"],
        properties: {
          item: { type: "string", description: "the item id, for example I3" },
          unit: { type: "string", description: "one unit id of that item, for example R1.S3.P5.s8" },
          verdict: { type: "string", enum: ["ok", "wrong", "cannot_tell", "ambiguous"] },
          reason: { type: "string", description: "wrong: what the text requires and what the program did. ambiguous: the two readings. Otherwise one short sentence." },
        },
      },
    },
  },
}

export const JUDGE_SYSTEM_PROMPT = [
  "You judge whether a command-line program follows its requirements. Each item is one run: the requirement units it exercises (exact text, with ids), the call and its input files, and what the program actually did (exit code, stdout, stderr, and the files it created or changed). `sources` holds the whole requirements for context, annotated with block ids; newer text overrides older text.",
  "For every unit of every item decide:",
  "- ok: the output follows the unit as far as this run shows;",
  "- wrong: the output contradicts what the unit's text requires; say what the text requires and what happened;",
  "- cannot_tell: this run does not show whether the unit is followed;",
  "- ambiguous: the text can be read in more than one way, and under one of those readings this output follows it. Name the readings. Do not answer wrong when the text leaves the point open.",
  "Judge only against the text. Do not assume behaviour the text does not state. An item may carry `contest`: the coding agent's objection to an earlier verdict on this run; weigh it against the text.",
].join("\n")

const zero = (): TokenUsage => ({ input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 })
const clip = (s: string, n: number) => s.length > n ? `${s.slice(0, n)}…(${s.length - n} more chars)` : s
const TIME = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/gu

/** The cache key of a verdict: the probe, the unit and its text, and the output with timestamps blanked. */
export function judgmentKey(probe: string, unit: string, unitText: string, output: ProbeOutput): string {
  const steady = JSON.stringify(output).replace(TIME, "<time>")
  return createHash("sha256").update(JSON.stringify([probe, unit, unitText, steady])).digest("hex")
}

export const pairKey = (probe: string, unit: string) => `${probe}/${unit}`

export function judgeProblems(answer: unknown, items: readonly JudgeItem[]): { problems: string[]; verdicts: Map<string, { verdict: Verdict; reason: string }> } {
  const verdicts = new Map<string, { verdict: Verdict; reason: string }>()
  const a = answer as Partial<JudgeAnswer> | null
  if (!a || !Array.isArray(a.verdicts)) return { problems: ["the answer must have a verdicts list"], verdicts }
  const problems: string[] = []
  const byItem = new Map(items.map(i => [i.item, new Set(i.units.map(u => u.id))]))
  for (const v of a.verdicts) {
    if (!v || !byItem.has(v.item)) { problems.push(`item ${JSON.stringify(v?.item)} is not in the request`); continue }
    if (!byItem.get(v.item)!.has(v.unit)) { problems.push(`item ${v.item}: unit ${JSON.stringify(v.unit)} is not one of its units`); continue }
    if (!["ok", "wrong", "cannot_tell", "ambiguous"].includes(v.verdict)) { problems.push(`item ${v.item}, unit ${v.unit}: verdict must be ok, wrong, cannot_tell or ambiguous`); continue }
    const k = `${v.item}\u0000${v.unit}`
    if (!verdicts.has(k)) verdicts.set(k, { verdict: v.verdict, reason: typeof v.reason === "string" ? v.reason : "" })
  }
  const missing = items.flatMap(i => i.units.filter(u => !verdicts.has(`${i.item}\u0000${u.id}`)).map(u => `${i.item} ${u.id}`))
  if (missing.length) problems.push(`no verdict for: ${missing.join(", ")}`)
  return { problems, verdicts }
}

export interface JudgeOptions {
  callId: (n: number) => string
  batchSize?: number
  /** Objections to earlier "wrong" verdicts, by probe/unit: those pairs are judged again with the objection. */
  contests?: ReadonlyMap<string, string>
}

/**
 * Judges the runs of one program. Pairs with a kept verdict for the same output are not asked again (unless
 * contested). Returns every pair's finding, the new judgments to keep, and the calls.
 */
export async function judgeRuns(registry: Registry, round: number, probes: readonly ProbeRecord[], runs: readonly ProbeRun[], kept: readonly Judgment[], transport: JudgeTransport, options: JudgeOptions): Promise<{ findings: Finding[]; judgments: Judgment[]; calls: JudgeCallRecord[] }> {
  const byKey = new Map(kept.map(j => [j.key, j]))
  const byId = new Map(probes.map(p => [p.id, p]))
  const findings: Finding[] = [], judgments: Judgment[] = [], calls: JudgeCallRecord[] = []
  const pending: { item: JudgeItem; probe: string; keys: Map<string, string> }[] = []
  for (const run of runs) {
    const p = byId.get(run.probe)
    if (!p) continue
    const ask: { id: string; text: string }[] = [], keys = new Map<string, string>()
    let contest: string | undefined
    for (const unit of [...new Set(p.covers.map(c => c.unit))]) {
      const text = registry.block(unit)?.text ?? ""
      const key = judgmentKey(p.id, unit, text, run.output)
      const claim = options.contests?.get(pairKey(p.id, unit))
      const hit = byKey.get(key)
      if (hit && !(claim && !hit.contested)) { findings.push({ probe: p.id, unit, verdict: hit.verdict, reason: hit.reason, cached: true }); continue }
      if (claim) contest = [contest, `${unit}: ${claim}`].filter(Boolean).join("\n")
      ask.push({ id: unit, text })
      keys.set(unit, key)
    }
    if (!ask.length) continue
    pending.push({ probe: p.id, keys, item: { item: `I${pending.length + 1}`, units: ask, call: p.args, input_files: p.files.map(f => ({ path: f.path, content: clip(f.content, 800) })), result: run.output, ...(contest ? { contest } : {}) } })
  }
  const sources = pending.length ? sourcesUpTo(registry, round) : ""
  const size = options.batchSize ?? 25
  let transportFailures = 0
  for (let i = 0; i < pending.length; i += size) {
    const batch = pending.slice(i, i + size)
    let ask = batch.map(b => b.item)
    const answered = new Map<string, { verdict: Verdict; reason: string; call: string }>()
    for (let attempt = 1; attempt <= 2 && ask.length; attempt++) {
      const request: JudgeRequest = { round, sources, items: ask, ...(attempt > 1 ? { problems: [`Answer only these items; earlier verdicts were missing or invalid.`] } : {}) }
      const text = requestJson(request)
      const base = { id: options.callId(calls.length + 1), round, stage: "acceptance" as const, step: "judge" as const, items: ask.length, request_sha256: createHash("sha256").update(text).digest("hex"), request_chars: text.length }
      let reply: ModelReply
      try { reply = await transport(request) } catch (e) {
        if (e instanceof ReplayMiss || e instanceof QuotaExhausted || e instanceof AuthInvalid || e instanceof EnvironmentBlocked) throw e
        calls.push({ ...base, response_text: "", problems: [], usage: zero(), stub: false, error: (e as Error).message })
        // No verdict is no "cannot tell": retried without using up an attempt, then the judge is unavailable.
        if (++transportFailures > TRANSPORT_RETRIES) throw new RoleUnavailable("judge", `${transportFailures} judge calls failed; last: ${(e as Error).message}`, calls)
        attempt--
        continue
      }
      let parsed: unknown = null
      try { parsed = JSON.parse(reply.text) } catch { parsed = null }
      const checked = parsed === null ? { problems: ["the reply is not JSON"], verdicts: new Map<string, { verdict: Verdict; reason: string }>() } : judgeProblems(parsed, ask)
      calls.push({ ...base, response_text: reply.text, problems: checked.problems, usage: { ...zero(), ...reply.usage }, stub: reply.stub === true, ...(reply.usage === undefined && reply.stub !== true ? { usage_unknown: true } : {}), ...(reply.model ? { model: reply.model } : {}) })
      for (const [k, v] of checked.verdicts) answered.set(k, { ...v, call: base.id })
      // Ask again for what is still missing, each item with only its unanswered units.
      ask = ask.map(it => ({ ...it, units: it.units.filter(u => !answered.has(`${it.item}\u0000${u.id}`)) })).filter(it => it.units.length)
    }
    for (const b of batch) for (const u of b.item.units) {
      const v = answered.get(`${b.item.item}\u0000${u.id}`)
      if (!v) { findings.push({ probe: b.probe, unit: u.id, verdict: "cannot_tell", reason: "no verdict came back", cached: false }); continue }
      findings.push({ probe: b.probe, unit: u.id, verdict: v.verdict, reason: v.reason, cached: false })
      judgments.push({ key: b.keys.get(u.id)!, probe: b.probe, unit: u.id, verdict: v.verdict, reason: v.reason, round, call: v.call, ...(b.item.contest ? { contested: true } : {}) })
    }
  }
  return { findings, judgments, calls }
}

// ---------------------------------------------------------------- correction lists

export interface CorrectionItem {
  key: string
  probe: string
  rule: { id: string; text: string }
  call: string[]
  input_files: { path: string; content: string }[]
  actual: ProbeOutput
  finding: string
  /** Judged ok at the start of this round or earlier in it: a repair broke it. */
  passed_before?: boolean
}

export function correctionItems(registry: Registry, probes: readonly ProbeRecord[], runs: readonly ProbeRun[], findings: readonly Finding[], before: ReadonlySet<string> = new Set()): CorrectionItem[] {
  const byId = new Map(probes.map(p => [p.id, p])), out = new Map(runs.map(r => [r.probe, r.output]))
  return findings.filter(f => f.verdict === "wrong" && byId.has(f.probe)).map(f => {
    const p = byId.get(f.probe)!, key = pairKey(f.probe, f.unit)
    return { key, probe: f.probe, rule: { id: f.unit, text: registry.block(f.unit)?.text.trim() ?? "" }, call: p.args, input_files: p.files.map(x => ({ path: x.path, content: clip(x.content, 1200) })), actual: out.get(f.probe)!, finding: f.reason, ...(before.has(key) ? { passed_before: true } : {}) }
  })
}

export function renderCorrections(items: readonly CorrectionItem[], program: string): string {
  return JSON.stringify(items.map((it, n) => ({ n: n + 1, id: it.key, rule: it.rule, call: [program, ...it.call], input_files: it.input_files, actual: it.actual, finding: it.finding, ...(it.passed_before ? { note: "this followed the requirements before; a change in this round broke it" } : {}) })), null, 1)
}

/** Object statuses from the findings: wrong makes an object not landed; all its judged units ok, landed. */
export function probeStatuses(registry: Registry, findings: readonly Finding[]): ObjectStatus[] {
  const by = new Map<string, Finding[]>()
  for (const f of findings) {
    const owner = registry.coverOf(f.unit)?.owner
    if (!owner || owner === "none") continue
    by.set(owner, [...(by.get(owner) ?? []), f])
  }
  return [...registry.objects.keys()].map(object => {
    const mine = by.get(object) ?? []
    const wrong = mine.filter(f => f.verdict === "wrong"), ok = mine.filter(f => f.verdict === "ok")
    const status = wrong.length ? "not_landed" : mine.length && ok.length === mine.length ? "landed" : "unknown"
    return { object, status, reasons: status === "unknown" ? [mine.length ? "only_weak" : "no_checks"] : [], passing_strong: ok.map(f => pairKey(f.probe, f.unit)), not_landed: wrong.map(f => pairKey(f.probe, f.unit)), unknown: mine.filter(f => f.verdict !== "ok" && f.verdict !== "wrong").map(f => pairKey(f.probe, f.unit)) } as ObjectStatus
  })
}
