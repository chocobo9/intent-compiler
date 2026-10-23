import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { writing } from "./platform.js"
import { requestJson } from "../model/opencode-transport.js"
import { ATTRIBUTION_SCHEMA, ATTRIBUTION_SYSTEM_PROMPT, ReplayMiss, type AttributionTransport, type ModelReply, type ModelRequest, type TokenUsage } from "./attribution.js"
import { CHECKS_SCHEMA, CHECKS_SYSTEM_PROMPT, type CheckRequest, type ChecksTransport } from "./checks.js"
import { Exp2Store } from "./store.js"
import { ADJUDICATION_SCHEMA, ADJUDICATION_SYSTEM_PROMPT, type AdjudicationRequest, type AdjudicationTransport } from "./adjudication.js"
import { PROBES_SCHEMA, PROBES_SYSTEM_PROMPT, type ProbeRequest, type ProbeTransport } from "./probes.js"
import { JUDGE_SCHEMA, JUDGE_SYSTEM_PROMPT, type JudgeRequest, type JudgeTransport } from "./judge.js"
import { FORMALIZE_SCHEMA, FORMALIZE_SYSTEM_PROMPT, type FormalizeRequest, type FormalizeTransport } from "./formalize.js"

/**
 * Recording and replay of management calls (DESIGN §12b item 7). A recording keeps each call's request, answer and
 * usage verbatim, with the label of the model that answered. Replay looks an answer up by the hash of the request it
 * is asked; a request the recording does not hold is an error (ReplayMiss), never a stand-in answer.
 */

export type RecordedStep = "attribution" | "checks" | "adjudication" | "probes" | "judge" | "formalize"

export interface CassetteEntry {
  step: RecordedStep
  /** sha256 of `prompt`. */
  request_sha256: string
  /** The call as sent: system prompt, schema and request, in the transport's order. */
  prompt: string
  answer: string
  /** Null when the call reported none (unknown, not zero). */
  usage: Partial<TokenUsage> | null
  model: string
  /** A stand-in's answer stays marked as one on replay. */
  stub?: true
  recorded_at?: string
}

export interface Cassette {
  format: "exp2-cassette-1"
  /** Which model answered, as a person would name it ("claude-haiku-5-5 (reference, not luna)"). */
  model_label: string
  /** How the entries were made, e.g. re-keyed from earlier requests (see `rekeyed_from`). */
  note?: string
  /** When the requests were rebuilt by the current code from answers recorded against older requests. */
  rekeyed_from?: string
  entries: CassetteEntry[]
}

const STEPS = {
  attribution: { system: ATTRIBUTION_SYSTEM_PROMPT, schema: ATTRIBUTION_SCHEMA },
  checks: { system: CHECKS_SYSTEM_PROMPT, schema: CHECKS_SCHEMA },
  adjudication: { system: ADJUDICATION_SYSTEM_PROMPT, schema: ADJUDICATION_SCHEMA },
  probes: { system: PROBES_SYSTEM_PROMPT, schema: PROBES_SCHEMA },
  judge: { system: JUDGE_SYSTEM_PROMPT, schema: JUDGE_SCHEMA },
  formalize: { system: FORMALIZE_SYSTEM_PROMPT, schema: FORMALIZE_SCHEMA },
} as const

/** The call's full text, in the format of the reference recordings' prompt files. */
export function promptText(step: RecordedStep, request: unknown): string {
  const { system, schema } = STEPS[step]
  return `# SYSTEM\n${system}\n\n# OUTPUT JSON SCHEMA (answer with one JSON object matching it, nothing else)\n${JSON.stringify(schema)}\n\n# REQUEST\n${requestJson(request)}\n`
}

export const promptHash = (prompt: string) => createHash("sha256").update(prompt).digest("hex")

export function emptyCassette(model_label: string): Cassette {
  return { format: "exp2-cassette-1", model_label, entries: [] }
}

export function loadCassette(file: string): Cassette {
  const c = JSON.parse(readFileSync(file, "utf8")) as Cassette
  if (c.format !== "exp2-cassette-1" || !Array.isArray(c.entries)) throw new Error(`${file} is not an exp2 cassette`)
  return c
}

/** Saves the cassette, making its directory first; a failure is a LocalWriteFailed (the run stops, nothing is lost silently). */
export function saveCassette(file: string, c: Cassette): void {
  writing("the recording", file, () => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(c, null, 1) + "\n", "utf8") })
}

function recorder<R>(step: RecordedStep, inner: (r: R) => Promise<ModelReply>, cassette: Cassette, onEntry?: () => void): (r: R) => Promise<ModelReply> {
  return async request => {
    const reply = await inner(request)
    const prompt = promptText(step, request)
    cassette.entries.push({
      step, request_sha256: promptHash(prompt), prompt, answer: reply.text, usage: reply.usage ?? null,
      model: reply.model ?? cassette.model_label, ...(reply.stub ? { stub: true as const } : {}), recorded_at: new Date().toISOString(),
    })
    onEntry?.()
    return reply
  }
}

/** Wraps real transports; every answered call is appended to the cassette (and saved, when a file is given). */
export function recordingTransports(t: { attribution: AttributionTransport; checks: ChecksTransport; adjudicate?: AdjudicationTransport; probes?: ProbeTransport; judge?: JudgeTransport; ruling?: JudgeTransport; formalize?: FormalizeTransport }, cassette: Cassette, file?: string): { attribution: AttributionTransport; checks: ChecksTransport; adjudicate?: AdjudicationTransport; probes?: ProbeTransport; judge?: JudgeTransport; ruling?: JudgeTransport; formalize?: FormalizeTransport } {
  const save = file ? () => saveCassette(file, cassette) : undefined
  return {
    attribution: recorder<ModelRequest>("attribution", t.attribution, cassette, save), checks: recorder<CheckRequest>("checks", t.checks, cassette, save),
    // The reviewer's sessions (tools, free text) are not cassette calls; their text is in the state. The formalizer's are.
    ...(t.formalize ? { formalize: recorder<FormalizeRequest>("formalize", t.formalize, cassette, save) } : {}),
    ...(t.adjudicate ? { adjudicate: recorder<AdjudicationRequest>("adjudication", t.adjudicate, cassette, save) } : {}),
    ...(t.probes ? { probes: recorder<ProbeRequest>("probes", t.probes, cassette, save) } : {}),
    ...(t.judge ? { judge: recorder<JudgeRequest>("judge", t.judge, cassette, save) } : {}),
    // The adjudicator's rulings on computed disagreements have the judge's request shape; replayed by request hash.
    ...(t.ruling ? { ruling: recorder<JudgeRequest>("judge", t.ruling, cassette, save) } : {}),
  }
}

export interface Replay {
  attribution: AttributionTransport
  checks: ChecksTransport
  adjudicate: AdjudicationTransport
  probes: ProbeTransport
  judge: JudgeTransport
  /** Entries never asked for, in recording order. */
  unused(): CassetteEntry[]
}

/**
 * Replays a cassette by request hash. The same request recorded more than once is answered in recording order.
 * The replayed reply is marked as not a stand-in, carries the recorded usage (absent when unknown) and the model.
 */
export function replayTransports(cassette: Cassette): Replay {
  const queues = new Map<string, CassetteEntry[]>()
  for (const e of cassette.entries) {
    const key = `${e.step}:${e.request_sha256}`
    queues.set(key, [...(queues.get(key) ?? []), e])
  }
  const used = new Set<CassetteEntry>()
  const replay = (step: RecordedStep) => async (request: unknown): Promise<ModelReply> => {
    const prompt = promptText(step, request)
    const sha = promptHash(prompt)
    const entry = queues.get(`${step}:${sha}`)?.find(e => !used.has(e))
    if (!entry) throw new ReplayMiss(`no recorded ${step} answer for request ${sha.slice(0, 12)} (${prompt.length} chars)`)
    used.add(entry)
    return { text: entry.answer, stub: entry.stub === true, model: entry.model, ...(entry.usage ? { usage: entry.usage } : {}) }
  }
  return { attribution: replay("attribution"), checks: replay("checks"), adjudicate: replay("adjudication"), probes: replay("probes"), judge: replay("judge"), unused: () => cassette.entries.filter(e => !used.has(e)) }
}

/**
 * Re-keys answers recorded against older requests (DESIGN §12b item 7): the current code builds each request, and
 * the step's recorded answers are given in their recorded order. The returned transports record the new requests.
 * An answer list that runs out is a miss.
 */
export function orderedAnswers(answers: Record<RecordedStep, string[]>): { attribution: AttributionTransport; checks: ChecksTransport } {
  const next = { attribution: 0, checks: 0, adjudication: 0, probes: 0, judge: 0, formalize: 0 }
  const give = (step: RecordedStep) => async (): Promise<ModelReply> => {
    const text = answers[step][next[step]++]
    if (text === undefined) throw new ReplayMiss(`recorded ${step} answers ran out after ${answers[step].length}`)
    return { text, stub: false }
  }
  return { attribution: give("attribution"), checks: give("checks") }
}

/** The round a recorded request was for (its request JSON names it). */
export function entryRound(e: CassetteEntry): number {
  const at = e.prompt.indexOf("# REQUEST\n")
  return (JSON.parse(e.prompt.slice(at + "# REQUEST\n".length)) as { round: number }).round
}

export interface RoundReplay {
  attribution: AttributionTransport
  checks: ChecksTransport
  adjudicate: AdjudicationTransport
  probes: ProbeTransport
  judge: JudgeTransport
  /** Recorded answers not asked for, by step and round, with their position in that round's list (1-based). */
  unused(): { step: RecordedStep; round: number; answer: number }[]
}

/**
 * Re-keying by answer order, per step and round (DESIGN §12d): the current code builds each request, and each
 * call of a round gets that round's next recorded answer for the step. When the current code accepts a round
 * sooner, the answers left over are reported, never passed on to the next round. Running out is a miss.
 */
export function replayByRound(cassette: Cassette): RoundReplay {
  const lists = new Map<string, CassetteEntry[]>()
  for (const e of cassette.entries) {
    const key = `${e.step}:${entryRound(e)}`
    lists.set(key, [...(lists.get(key) ?? []), e])
  }
  const used = new Map<string, number>()
  const give = (step: RecordedStep) => async (request: { round: number }): Promise<ModelReply> => {
    const key = `${step}:${request.round}`
    const n = used.get(key) ?? 0
    const entry = lists.get(key)?.[n]
    if (!entry) throw new ReplayMiss(`no recorded ${step} answer ${n + 1} for round ${request.round}`)
    used.set(key, n + 1)
    return { text: entry.answer, stub: entry.stub === true, model: entry.model, ...(entry.usage ? { usage: entry.usage } : {}) }
  }
  return {
    attribution: give("attribution") as AttributionTransport, checks: give("checks") as ChecksTransport, adjudicate: give("adjudication") as AdjudicationTransport,
    probes: give("probes") as ProbeTransport, judge: give("judge") as JudgeTransport,
    unused: () => [...lists.entries()].flatMap(([key, list]) => {
      const [step, round] = key.split(":")
      return list.slice(used.get(key) ?? 0).map((_, k) => ({ step: step as RecordedStep, round: Number(round), answer: (used.get(key) ?? 0) + k + 1 }))
    }),
  }
}

/**
 * Re-keys recorded attribution rounds: ingests rounds 1..n into a fresh store, giving each round its recorded
 * answers in order, and records the requests the current code builds. Returns the cassette and, per round, the
 * status and how many answers were used.
 */
export async function rekeyAttribution(stateDir: string, texts: readonly string[], answers: readonly string[][], cassette: Cassette): Promise<{ round: number; status: string; used: number; recorded: number }[]> {
  const store = new Exp2Store(stateDir, "rekey")
  const out: { round: number; status: string; used: number; recorded: number }[] = []
  for (let i = 0; i < texts.length; i++) {
    const before = cassette.entries.length
    const t = recordingTransports({ ...orderedAnswers({ attribution: answers[i], checks: [], adjudication: [], probes: [], judge: [], formalize: [] }) }, cassette)
    const record = await store.ingestRound(i + 1, texts[i], t.attribution, { maxRepairs: Math.max(answers[i].length - 1, 0) })
    out.push({ round: i + 1, status: record.status, used: cassette.entries.length - before, recorded: answers[i].length })
    if (record.status !== "accepted") break
  }
  return out
}
