import { createHash } from "node:crypto"
import { requestJson } from "../model/opencode-transport.js"
import { AuthInvalid, QuotaExhausted, ReplayMiss, RoleUnavailable, TRANSPORT_RETRIES, type ModelReply, type TokenUsage } from "./attribution.js"
import { EnvironmentBlocked } from "./platform.js"
import { mapPool } from "./pool.js"
import type { ProbeOutput, ProbeRecord, ProbeRun } from "./probes.js"
import { sourcesUpTo } from "./probes.js"
import type { Registry } from "./registry.js"
import type { ScriptSandbox } from "./runner.js"
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
  /** The section(s) of the listed units: other units the run exercises are named from there (DESIGN §12g). */
  section?: string
  /**
   * What an independent computation printed on this run's files, where it did not match the program's output. The
   * computation's code is not shown: the one ruling on the disagreement did not write it (DESIGN §12g).
   */
  computed?: { exit_code: number | null; stdout: string; stderr: string }
}

export interface JudgeRequest { round: number; sources: string; items: JudgeItem[]; problems?: string[] }

export type JudgeTransport = (request: JudgeRequest) => Promise<ModelReply>

export interface JudgeAnswer { verdicts: { item: string; unit: string; verdict: Verdict | "compute"; reason: string; compute?: string | null }[] }

/**
 * digest: the output it was judged on (timestamps blanked). also: a unit the judge found the run exercises besides
 * the ones listed (BLOCK11 §3). computed: the verdict rests on a computation the judge asked for (BLOCK11 §4).
 */
export interface Judgment { key: string; probe: string; unit: string; verdict: Verdict; reason: string; round: number; call: string; contested?: boolean; digest?: string; also?: true; computed?: true }

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
/**
 * kind, how the verdict was reached (DESIGN §12g): A a value stated in the text, compared by code; B by code against
 * a reference or a property (a crash, a limit, the verifier's computation; a disagreement adjudicated); C a judgment.
 */
export interface Finding { probe: string; unit: string; verdict: Verdict; reason: string; cached: boolean; kind?: "A" | "B" | "C" }

export const JUDGE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      description: "One entry for every unit of every item, and one for each other unit of `sources` the run exercises.",
      items: {
        type: "object", additionalProperties: false, required: ["item", "unit", "verdict", "reason", "compute"],
        properties: {
          item: { type: "string", description: "the item id, for example I3" },
          unit: { type: "string", description: "a unit id: one of the item's, or another id from `sources` whose rule this run exercises, for example R1.S3.P5.s8" },
          verdict: { type: "string", enum: ["ok", "wrong", "cannot_tell", "ambiguous", "compute"] },
          reason: { type: "string", description: "wrong: what the text requires and what the program did. ambiguous: the two readings. Otherwise one short sentence." },
          compute: { type: ["string", "null"], description: "verdict compute only: a Python 3 script that prints the value the text requires, computed from the files in its working directory; null otherwise" },
        },
      },
    },
  },
}

export const JUDGE_SYSTEM_PROMPT = [
  "You judge whether a command-line program follows its requirements. Each item is one run: the requirement units it exercises (exact text, with ids), the call and its input files, and what the program actually did (exit code, stdout, stderr, the files it created or changed, and `stopped` when the controller stopped it at a memory, time or output limit on this input). `sources` holds the whole requirements for context, annotated with block ids; newer text overrides older text.",
  "For every unit of every item decide:",
  "- ok: the output follows the unit as far as this run shows;",
  "- wrong: the output contradicts what the unit's text requires; say what the text requires and what happened;",
  "- cannot_tell: this run does not show whether the unit is followed;",
  "- ambiguous: the text can be read in more than one way, and under one of those readings this output follows it. Name the readings. Do not answer wrong when the text leaves the point open.",
  "- compute: whether the output follows the unit depends on a value computed from the data (for example a cryptographic digest, an arithmetic result, or the order of records). Do not judge such a value by reading it: give in `compute` a Python 3 script that prints the value the text requires. It runs in a directory holding the input files and the files the program wrote. You then get what it printed, as `computed`, and judge again.",
  "The listed units are those the probe was written for. If the run also exercises other rules of the same section (`section`; their ids are in `sources`), add an entry for each such unit too.",
  "Judge only against the text. Do not assume behaviour the text does not state. An item may carry `contest`: the coding agent's objection to an earlier verdict on this run; weigh it against the text.",
  "An item that carries `computed` is a disagreement: an independent computation printed `computed.stdout`, and that value is not in what the program produced. Rule from the text: wrong if the program is wrong, ok if the computation is wrong and the program follows the text, ambiguous if the text allows both. Not compute.",
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

type Answered = { verdict: Verdict | "compute"; reason: string; compute: string | null; also: boolean }

/** Code checks of an answer: every listed unit has a verdict; another unit may be added when `known` holds it. */
export function judgeProblems(answer: unknown, items: readonly JudgeItem[], known: (item: JudgeItem, unit: string) => boolean = () => false): { problems: string[]; verdicts: Map<string, Answered> } {
  const verdicts = new Map<string, Answered>()
  const a = answer as Partial<JudgeAnswer> | null
  if (!a || !Array.isArray(a.verdicts)) return { problems: ["the answer must have a verdicts list"], verdicts }
  const problems: string[] = []
  const byItem = new Map(items.map(i => [i.item, i]))
  for (const v of a.verdicts) {
    const item = v ? byItem.get(v.item) : undefined
    if (!item) { problems.push(`item ${JSON.stringify(v?.item)} is not in the request`); continue }
    const listed = item.units.some(u => u.id === v.unit)
    if (!listed && !(typeof v.unit === "string" && known(item, v.unit))) { problems.push(`item ${v.item}: unit ${JSON.stringify(v.unit)} is neither one of its units nor a unit of its section (${item.section ?? "none"})`); continue }
    const kinds = item.computed ? ["ok", "wrong", "cannot_tell", "ambiguous"] : ["ok", "wrong", "cannot_tell", "ambiguous", "compute"]
    if (!kinds.includes(v.verdict)) { problems.push(`item ${v.item}, unit ${v.unit}: verdict must be ${kinds.join(", ")}`); continue }
    if (v.verdict === "compute" && (typeof v.compute !== "string" || !v.compute.trim())) { problems.push(`item ${v.item}, unit ${v.unit}: verdict compute needs the script in \`compute\``); continue }
    const k = `${v.item}\u0000${v.unit}`
    if (!verdicts.has(k)) verdicts.set(k, { verdict: v.verdict, reason: typeof v.reason === "string" ? v.reason : "", compute: v.verdict === "compute" ? v.compute! : null, also: !listed })
  }
  const missing = items.flatMap(i => i.units.filter(u => !verdicts.has(`${i.item}\u0000${u.id}`)).map(u => `${i.item} ${u.id}`))
  if (missing.length) problems.push(`no verdict for: ${missing.join(", ")}`)
  return { problems, verdicts }
}

/** Judge batches asked side by side. */
export const JUDGE_CONCURRENCY = 3

export interface JudgeOptions {
  callId: (n: number) => string
  batchSize?: number
  concurrency?: number
  /** Where a computation the judge asks for runs (BLOCK11 §4); without it such a verdict is cannot_tell. */
  sandbox?: ScriptSandbox
  /** Objections to earlier "wrong" verdicts, by probe/unit: those pairs are judged again with the objection. */
  contests?: ReadonlyMap<string, string>
  /** Who rules where the computation and the program disagree: the adjudicator, in a session of its own; else the judge. */
  ruling?: JudgeTransport
}

/**
 * Judges the runs of one program. Pairs with a kept verdict for the same output are not asked again (unless
 * contested). Returns every pair's finding, the new judgments to keep, and the calls.
 */
export async function judgeRuns(registry: Registry, round: number, probes: readonly ProbeRecord[], runs: readonly ProbeRun[], kept: readonly Judgment[], transport: JudgeTransport, options: JudgeOptions): Promise<{ findings: Finding[]; judgments: Judgment[]; calls: JudgeCallRecord[] }> {
  const byKey = new Map(kept.map(j => [j.key, j]))
  const byId = new Map(probes.map(p => [p.id, p]))
  const findings: Finding[] = [], judgments: Judgment[] = [], calls: JudgeCallRecord[] = []
  type Pending = { item: JudgeItem; probe: string; digest: string; keys: Map<string, string>; run: ProbeRun }
  const pending: Pending[] = []
  // A unit a run also exercises is taken from the section of the units the probe was written for (DESIGN §12g).
  const sectionOf = (unit: string) => registry.lineage(unit).filter(b => b.level === "section").at(-1)?.id ?? null
  const sections = new Map<string, Set<string>>()
  const known = (item: JudgeItem, unit: string) => { const b = registry.block(unit); return !!b && b.level !== "section" && !!sectionOf(unit) && (sections.get(item.item)?.has(sectionOf(unit)!) ?? false) }
  for (const run of runs) {
    const p = byId.get(run.probe)
    if (!p) continue
    const digest = outputDigest(run.output)
    // What code can determine is not left to a model: a crash or a memory or output limit is wrong, a time limit
    // shows nothing (kind B, a property every run must have).
    const property = codeProperty(run.output)
    if (property) { for (const unit of [...new Set(p.covers.map(c => c.unit))]) findings.push({ probe: p.id, unit, verdict: property.verdict, reason: property.reason, cached: false, kind: "B" }); continue }
    const ask: { id: string; text: string }[] = [], keys = new Map<string, string>()
    let contest: string | undefined
    for (const unit of [...new Set(p.covers.map(c => c.unit))]) {
      const text = registry.block(unit)?.text ?? ""
      const key = judgmentKey(p.id, unit, text, run.output)
      const claim = options.contests?.get(pairKey(p.id, unit))
      const hit = byKey.get(key)
      if (hit && !(claim && !hit.contested)) { findings.push({ probe: p.id, unit, verdict: hit.verdict, reason: hit.reason, cached: true, kind: hit.computed ? "B" : "C" }); continue }
      if (claim) contest = [contest, `${unit}: ${claim}`].filter(Boolean).join("\n")
      ask.push({ id: unit, text })
      keys.set(unit, key)
    }
    // Nothing to ask: the verdicts on other units the judge found this same output exercises are kept too.
    if (!ask.length) {
      for (const j of kept.filter(x => x.also && x.probe === p.id && x.digest === digest)) findings.push({ probe: p.id, unit: j.unit, verdict: j.verdict, reason: j.reason, cached: true, kind: j.computed ? "B" : "C" })
      continue
    }
    const item = `I${pending.length + 1}`
    sections.set(item, new Set(p.covers.map(c => sectionOf(c.unit)).filter((x): x is string => !!x)))
    pending.push({ probe: p.id, digest, keys, run, item: { item, units: ask, section: [...sections.get(item)!].join(", "), call: p.args, input_files: p.files.map(f => ({ path: f.path, content: clip(f.content, 800) })), result: run.output, ...(contest ? { contest } : {}) } })
  }
  if (!pending.length) return { findings, judgments, calls }
  const sources = sourcesUpTo(registry, round)
  const failures = { n: 0 }
  const first = await askBatches(pending.map(x => x.item), { round, sources, transport, known, batchSize: options.batchSize ?? 25, concurrency: options.concurrency ?? JUDGE_CONCURRENCY, failures, tag: "b" })
  calls.push(...first.calls)
  // Kind B from the verifier's computation (DESIGN §12g): code runs the script on the run's files and looks for the
  // value it printed in what the program produced. Found: ok, by code. Not found: a separate session, given the text,
  // the program's output and the computed value but not the script, rules: program wrong, reference wrong, or ambiguous.
  const waiting = pending.flatMap(x => [...first.answered.entries()].filter(([k, v]) => k.startsWith(`${x.item.item}\u0000`) && v.verdict === "compute").map(([k, v]) => ({ x, unit: k.split("\u0000")[1], v })))
  const agreed = new Map<string, string>()
  const computedItems: (JudgeItem & { of: Pending; unit: string })[] = []
  for (const [i, w] of waiting.entries()) {
    if (!options.sandbox) continue
    const p = byId.get(w.x.probe)!
    const produced = { ...(w.x.run.files ?? {}), "__stdout": w.x.run.output.stdout, "__stderr": w.x.run.output.stderr }
    const files = [...p.files, ...Object.entries(produced).filter(([path]) => !p.files.some(f => f.path === path)).map(([path, content]) => ({ path, content }))]
    const ran = await options.sandbox.run("python", w.v.compute!, files, 20_000)
    const value = ran.exit_code === 0 ? ran.stdout.trim() : ""
    const outputs = [w.x.run.output.stdout, w.x.run.output.stderr, ...Object.entries(w.x.run.files ?? {}).filter(([path]) => !p.files.some(f => f.path === path && f.content === w.x.run.files![path])).map(([, c]) => c)]
    if (value && outputs.some(o => o.includes(value))) { agreed.set(`${w.x.item.item}\u0000${w.unit}`, `the value computed independently (${clip(value, 120)}) is what the program produced`); continue }
    const text = registry.block(w.unit)?.text ?? ""
    computedItems.push({ ...w.x.item, item: `C${i + 1}`, units: [{ id: w.unit, text }], computed: { exit_code: ran.exit_code, stdout: clip(ran.stdout, 2000), stderr: clip(ran.stderr, 1000) }, of: w.x, unit: w.unit })
  }
  const second = computedItems.length ? await askBatches(computedItems.map(({ of: _o, unit: _u, ...it }) => it), { round, sources, transport: options.ruling ?? transport, known: () => false, batchSize: options.batchSize ?? 25, concurrency: options.concurrency ?? JUDGE_CONCURRENCY, failures, tag: "c" }) : null
  if (second) calls.push(...second.calls)
  // Call ids follow the order the calls were asked in.
  const ids = new Map(calls.map((c, i) => [c.id, options.callId(i + 1)]))
  for (const c of calls) c.id = ids.get(c.id)!
  const down = first.unavailable ?? second?.unavailable
  if (down) throw new RoleUnavailable("judge", down.replace(/^judge: /u, ""), calls)
  for (const x of pending) {
    const mine = [...first.answered.entries()].filter(([k]) => k.startsWith(`${x.item.item}\u0000`)).map(([k, v]) => ({ unit: k.split("\u0000")[1], v }))
    for (const u of x.item.units) if (!mine.some(m => m.unit === u.id)) findings.push({ probe: x.probe, unit: u.id, verdict: "cannot_tell", reason: "no verdict came back", cached: false })
    for (const { unit, v } of mine) {
      let verdict = v.verdict, reason = v.reason, call = v.call, computed = false
      if (verdict === "compute") {
        const c = computedItems.find(ci => ci.of === x && ci.unit === unit)
        const again = c && second?.answered.get(`${c.item}\u0000${unit}`)
        const same = agreed.get(`${x.item.item}\u0000${unit}`)
        if (same) { verdict = "ok"; reason = same; computed = true }
        else if (again) { verdict = again.verdict; reason = again.verdict === "ok" ? `the reference was wrong: ${again.reason}` : again.reason; call = again.call; computed = true }
        else { verdict = "cannot_tell"; reason = options.sandbox ? "the computation gave no verdict" : "a value to compute, and no sandbox to compute it"; findings.push({ probe: x.probe, unit, verdict, reason, cached: false, kind: "B" }); continue }
      }
      const final = verdict as Verdict
      findings.push({ probe: x.probe, unit, verdict: final, reason, cached: false, kind: computed ? "B" : "C" })
      const key = x.keys.get(unit) ?? judgmentKey(x.probe, unit, registry.block(unit)?.text ?? "", x.run.output)
      judgments.push({ key, probe: x.probe, unit, verdict: final, reason, round, call: ids.get(call)!, digest: x.digest, ...(v.also ? { also: true as const } : {}), ...(computed ? { computed: true as const } : {}), ...(x.item.contest ? { contested: true } : {}) })
    }
  }
  return { findings, judgments, calls }
}

/** The property every run must have (kind B): no crash, no memory or output limit; a time limit shows nothing. */
export function codeProperty(o: ProbeOutput): { verdict: Verdict; reason: string } | null {
  if (o.stopped?.startsWith("time")) return { verdict: "cannot_tell", reason: `the program was stopped: ${o.stopped}` }
  if (o.stopped) return { verdict: "wrong", reason: `the program was stopped: ${o.stopped}` }
  const text = `${o.stderr}\n${o.stdout}`, m = /^(panic: .*|fatal error: .*)$/mu.exec(text)
  if (m && /goroutine \d+ \[/u.test(text)) return { verdict: "wrong", reason: `the program crashed: ${m[1].slice(0, 200)}` }
  return null
}

/** The output a verdict was given on, timestamps blanked. */
export function outputDigest(output: ProbeOutput): string {
  return createHash("sha256").update(JSON.stringify(output).replace(TIME, "<time>")).digest("hex")
}

/**
 * Asks the judge about `items` in batches side by side, each batch in its own session; a missing or invalid answer
 * is asked again once, transport failures are retried outside that and past TRANSPORT_RETRIES the judge is unavailable.
 */
async function askBatches(items: readonly JudgeItem[], o: { round: number; sources: string; transport: JudgeTransport; known: (item: JudgeItem, unit: string) => boolean; batchSize: number; concurrency: number; failures: { n: number }; tag: string }): Promise<{ calls: JudgeCallRecord[]; answered: Map<string, Answered & { call: string }>; unavailable: string | null }> {
  const batches: JudgeItem[][] = []
  for (let i = 0; i < items.length; i += o.batchSize) batches.push(items.slice(i, i + o.batchSize))
  const results: { calls: JudgeCallRecord[]; answered: Map<string, Answered & { call: string }> }[] = new Array(batches.length)
  let unavailable: string | null = null
  await mapPool(batches, o.concurrency, async (batch, bi) => {
    const mine: JudgeCallRecord[] = []
    const answered = new Map<string, Answered & { call: string }>()
    results[bi] = { calls: mine, answered }
    let ask = [...batch]
    for (let attempt = 1; attempt <= 2 && ask.length && !unavailable; attempt++) {
      const request: JudgeRequest = { round: o.round, sources: o.sources, items: ask, ...(attempt > 1 ? { problems: [`Answer only these items; earlier verdicts were missing or invalid.`] } : {}) }
      const text = requestJson(request)
      const base = { id: `~${o.tag}${bi}.${mine.length + 1}`, round: o.round, stage: "acceptance" as const, step: "judge" as const, items: ask.length, request_sha256: createHash("sha256").update(text).digest("hex"), request_chars: text.length }
      let reply: ModelReply
      try { reply = await o.transport(request) } catch (e) {
        if (e instanceof ReplayMiss || e instanceof QuotaExhausted || e instanceof AuthInvalid || e instanceof EnvironmentBlocked) throw e
        mine.push({ ...base, response_text: "", problems: [], usage: zero(), stub: false, error: (e as Error).message })
        // No verdict is no "cannot tell": retried without using up an attempt, then the judge is unavailable.
        if (++o.failures.n > TRANSPORT_RETRIES) { unavailable ??= `${o.failures.n} judge calls failed; last: ${(e as Error).message}`; return }
        attempt--
        continue
      }
      let parsed: unknown = null
      try { parsed = JSON.parse(reply.text) } catch { parsed = null }
      const checked = parsed === null ? { problems: ["the reply is not JSON"], verdicts: new Map<string, Answered>() } : judgeProblems(parsed, ask, o.known)
      mine.push({ ...base, response_text: reply.text, problems: checked.problems, usage: { ...zero(), ...reply.usage }, stub: reply.stub === true, ...(reply.usage === undefined && reply.stub !== true ? { usage_unknown: true } : {}), ...(reply.model ? { model: reply.model } : {}) })
      for (const [k, v] of checked.verdicts) if (!answered.has(k)) answered.set(k, { ...v, call: base.id })
      // Ask again for what is still missing, each item with only its unanswered units.
      ask = ask.map(it => ({ ...it, units: it.units.filter(u => !answered.has(`${it.item}\u0000${u.id}`)) })).filter(it => it.units.length)
    }
  })
  const answered = new Map<string, Answered & { call: string }>()
  for (const r of results) if (r) for (const [k, v] of r.answered) answered.set(k, v)
  return { calls: results.flatMap(r => r?.calls ?? []), answered, unavailable }
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
    // Landed: nothing wrong, and each judged unit has an ok (a cannot_tell from another case's probe contradicts nothing).
    const wrong = mine.filter(f => f.verdict === "wrong"), ok = mine.filter(f => f.verdict === "ok")
    const units = new Set(mine.map(f => f.unit))
    const status = wrong.length ? "not_landed" : units.size && [...units].every(u => ok.some(f => f.unit === u)) ? "landed" : "unknown"
    return { object, status, reasons: status === "unknown" ? [mine.length ? "only_weak" : "no_checks"] : [], passing_strong: ok.map(f => pairKey(f.probe, f.unit)), not_landed: wrong.map(f => pairKey(f.probe, f.unit)), unknown: mine.filter(f => f.verdict !== "ok" && f.verdict !== "wrong").map(f => pairKey(f.probe, f.unit)) } as ObjectStatus
  })
}
