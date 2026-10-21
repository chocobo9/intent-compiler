import { createHash } from "node:crypto"
import { requestJson } from "../model/opencode-transport.js"
import { AuthInvalid, QuotaExhausted, ReplayMiss, RoleUnavailable, TRANSPORT_RETRIES, type ModelReply, type TokenUsage } from "./attribution.js"
import { EnvironmentBlocked } from "./platform.js"
import type { CheckRecord } from "./checks.js"
import type { Registry } from "./registry.js"
import { annotate } from "./source.js"
import type { CheckRun, DisputeKind } from "./verdict.js"

/**
 * Rulings on disputed checks (BLOCK9 §2.3). A check is disputed when code sees evidence against it in a failed run,
 * or when the executor contests it with a basis in the text. One model call, against the original text, says
 * whether the check is wrong (it is then retired and its object derived again) or right (its failures count against
 * the program from then on). Each check is ruled on once per kind of dispute. The code checks only that the answer
 * has the shape and that the ids it rests on exist.
 */

export interface AdjudicationRequest {
  round: number
  sources: string
  check: { id: string; object: string; object_name: string; blocks: string[]; input: CheckRecord["input"]; assertions: { id: string; target: unknown; expect: unknown; source: unknown; reading?: string | null }[] }
  dispute: {
    kind: DisputeKind
    /** What code saw, or the executor's claim. */
    detail: string
    run: { exit_code: number | null; stdout_head: string; stderr_head: string; failed: { id: string; actual: unknown }[] }
  }
}

export interface AdjudicationAnswer { verdict: "check_wrong" | "check_right"; basis: string[]; reason: string }

export type AdjudicationTransport = (request: AdjudicationRequest) => Promise<ModelReply>

export interface Ruling {
  check: string
  round: number
  kind: DisputeKind
  verdict: AdjudicationAnswer["verdict"]
  basis: string[]
  reason: string
  call: string
}

export interface AdjudicationCallRecord {
  id: string
  round: number
  stage: "acceptance"
  step: "adjudication"
  check: string
  kind: DisputeKind
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

export const ADJUDICATION_SCHEMA = {
  type: "object", additionalProperties: false, required: ["verdict", "basis", "reason"],
  properties: {
    verdict: { type: "string", enum: ["check_wrong", "check_right"], description: "check_wrong: the check expects what the text does not require of this input, or gives an input the text does not allow. check_right: the text requires what the check expects." },
    basis: { type: "array", items: { type: "string" }, description: "Ids of the blocks, sentences or clauses the ruling rests on." },
    reason: { type: "string", description: "One or two sentences." },
  },
}

export const ADJUDICATION_SYSTEM_PROMPT = [
  "You rule on one acceptance check of a command-line program. `sources` holds the requirements, annotated with block ids; the original text is the only authority and newer text overrides older text.",
  "The check ran the program and failed, and the check itself is in question. `dispute.kind` says why: position (the text the check expects appears in the output, but not on the line or stream the check reads), input_incomplete (the program reports an input file the check names but does not give), contested (the coding agent says the check contradicts the requirements; its claim is in `dispute.detail`).",
  "Decide from the text alone, not from what the program does: check_wrong when the check expects something the text does not require of this input (a line or stream the text does not fix, a value the text does not give) or gives an input the text does not allow; check_right when the text requires what the check expects. Give the ids your ruling rests on.",
].join("\n")

const zero = (): TokenUsage => ({ input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 })

export function buildAdjudicationRequest(registry: Registry, round: number, check: CheckRecord, run: CheckRun, kind: DisputeKind, detail: string): AdjudicationRequest {
  const rounds = [...registry.sources.values()].filter(s => s.round <= round).sort((a, b) => a.round - b.round)
  return {
    round, sources: rounds.map(s => `===== R${s.round} =====\n${annotate(s)}`).join("\n"),
    check: {
      id: check.id, object: check.object, object_name: registry.objects.get(check.object)?.name ?? check.object, blocks: check.blocks, input: check.input,
      assertions: check.assertions.map(a => ({ id: a.id, target: a.target, expect: a.expect, source: a.source, ...(a.reading ? { reading: a.reading } : {}) })),
    },
    dispute: { kind, detail, run: { exit_code: run.exit_code, stdout_head: run.stdout_head ?? "", stderr_head: run.stderr_head, failed: run.assertions.filter(a => !a.ok).map(a => ({ id: a.id, actual: a.actual })) } },
  }
}

export function adjudicationProblems(registry: Registry, value: unknown): string[] {
  const v = value as Partial<AdjudicationAnswer> | null
  if (!v || typeof v !== "object") return ["the answer is not an object"]
  const p: string[] = []
  if (v.verdict !== "check_wrong" && v.verdict !== "check_right") p.push("verdict must be check_wrong or check_right")
  if (!Array.isArray(v.basis) || !v.basis.length || !v.basis.every(b => typeof b === "string")) p.push("basis must name at least one id")
  else for (const b of v.basis) if (!registry.block(b.split("#")[0])) p.push(`basis ${b} does not exist`)
  if (typeof v.reason !== "string") p.push("reason must be a string")
  return p
}

/** One ruling, with one repair when the answer has definite errors. Null when no valid answer came back. */
export async function adjudicate(registry: Registry, round: number, check: CheckRecord, run: CheckRun, kind: DisputeKind, detail: string, transport: AdjudicationTransport, callId: (n: number) => string): Promise<{ ruling: Omit<Ruling, "call"> | null; calls: AdjudicationCallRecord[] }> {
  const calls: AdjudicationCallRecord[] = []
  let request = buildAdjudicationRequest(registry, round, check, run, kind, detail), transportFailures = 0
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = requestJson(request)
    const base = { id: callId(calls.length + 1), round, stage: "acceptance" as const, step: "adjudication" as const, check: check.id, kind, request_sha256: createHash("sha256").update(text).digest("hex"), request_chars: text.length }
    let reply: ModelReply
    try { reply = await transport(request) } catch (e) {
      if (e instanceof ReplayMiss || e instanceof QuotaExhausted || e instanceof AuthInvalid || e instanceof EnvironmentBlocked) throw e
      calls.push({ ...base, response_text: "", problems: [], usage: zero(), stub: false, error: (e as Error).message })
      if (++transportFailures > TRANSPORT_RETRIES) throw new RoleUnavailable("adjudication", `${transportFailures} ruling calls failed; last: ${(e as Error).message}`, calls)
      attempt--
      continue
    }
    let parsed: unknown = null, problems: string[]
    try { parsed = JSON.parse(reply.text); problems = adjudicationProblems(registry, parsed) } catch (e) { problems = [`the reply is not JSON: ${(e as Error).message}`] }
    calls.push({ ...base, response_text: reply.text, problems, usage: { ...zero(), ...reply.usage }, stub: reply.stub === true, ...(reply.usage === undefined && reply.stub !== true ? { usage_unknown: true } : {}), ...(reply.model ? { model: reply.model } : {}) })
    if (!problems.length) {
      const a = parsed as AdjudicationAnswer
      return { ruling: { check: check.id, round, kind, verdict: a.verdict, basis: a.basis, reason: a.reason }, calls }
    }
    request = { ...request, dispute: { ...request.dispute, detail: `${detail}\n(Your previous answer had problems: ${problems.join("; ")}.)` } }
  }
  return { ruling: null, calls }
}
