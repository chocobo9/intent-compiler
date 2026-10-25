import type { AnswerPatch, AttributionTransport, ModelRequest } from "../../src/exp2/attribution.js"
import type { Assignment, AttributionAnswer, Override } from "../../src/exp2/registry.js"

/**
 * Fixed offline answers standing in for the attribution model (DEV-GUIDELINES §3). They are written the way a model
 * would answer from the request alone: object ids come from the request's object list, never from test knowledge.
 * Some first answers carry the usual mistakes (a block left out, a wrong id, a block given twice, an override range
 * past the end, a stale hash); the scripted repair patches fix them. Rounds without a script get `ruleStub`, a plain
 * rule (one object per top-level section, named after its heading) that is plainly not a model.
 */

type Reply = (request: ModelRequest) => AttributionAnswer | AnswerPatch | string

function helpers(request: ModelRequest) {
  const id = (name: string): string => {
    const o = request.objects.find(x => x.name.toLowerCase() === name.toLowerCase())
    if (!o) throw new Error(`stub: request round ${request.round} lists no object named ${name}`)
    return o.id
  }
  const base = (block: string, change: Assignment["change"], extra: Partial<Assignment>): Assignment =>
    ({ block, object_id: null, new_object: null, change, replaces: [], overrides: [], note: null, ...extra })
  return {
    id,
    /** Give `block` to the existing object named `name`. */
    to: (block: string, name: string, change: Assignment["change"] = "add", extra: Partial<Assignment> = {}) => base(block, change, { object_id: id(name), ...extra }),
    fresh: (block: string, name: string, extra: Partial<Assignment> = {}) => base(block, "add", { new_object: name, ...extra }),
    none: (block: string) => base(block, "none", {}),
    over: (old: string[], by: string[]): Override => ({ old, by }),
  }
}

// Batch 4: no object edges; cross-command changes come from the cue units code finds, which the stand-in leaves as found.
const answer = (assignments: Assignment[], interpretations: AttributionAnswer["interpretations"] = []): AttributionAnswer =>
  ({ assignments, units: [], interpretations })
const patch = (p: Partial<AnswerPatch>): AnswerPatch => ({ upsert: [], remove: [], units_add: [], units_remove: [], interpretations_add: [], ...p })

/** The model answers in patch form; a first answer is a patch on the empty draft. */
export function asPatch(a: AttributionAnswer): AnswerPatch {
  return patch({ upsert: a.assignments, units_add: a.units ?? [], interpretations_add: a.interpretations })
}

// ------------------------------------------------------------------ R1: long initial requirement, ops split by paragraph

function r1(request: ModelRequest, complete: boolean): AttributionAnswer {
  const { fresh, none } = helpers(request)
  const T = "R1.S3"
  const ops: [string, string[]][] = [
    ["filter", [`${T}.P2.s4`]],
    ["derive", [`${T}.P2.s5`, `${T}.P3`, `${T}.P4`, `${T}.P5`, `${T}.P6`, `${T}.P7`, `${T}.P8`]],
    ["sample", [`${T}.P9.s1`]],
    ["sort", [`${T}.P9.s2`]],
    ["rename", [`${T}.P9.s3`]],
    ["drop", [`${T}.P9.s4`]],
    ["aggregate", [`${T}.P9.s5`, `${T}.P9.s6`, `${T}.P9.s7`, `${T}.P9.s8`, `${T}.P9.s9`, `${T}.P9.s10`, `${T}.P10`, `${T}.P11`]],
    ["join", [`${T}.P12`]],
    // The first answer forgets the window formatting paragraph P16.
    ["window", [`${T}.P13`, `${T}.P14`, `${T}.P15`, ...(complete ? [`${T}.P16`] : []), `${T}.P17`]],
    ["pivot", [`${T}.P18`, `${T}.P19`]],
    ["unpivot", [`${T}.P20`, `${T}.P21`]],
    ["fill", [`${T}.P22`, `${T}.P23`]],
  ]
  return answer([
    fresh("R1.S0", "tool"),
    fresh("R1.S2", "ingest"),
    fresh(`${T}.P1`, "transform"), fresh(`${T}.P2.s1`, "transform"), fresh(`${T}.P2.s2`, "transform"), fresh(`${T}.P2.s3`, "transform"),
    ...ops.flatMap(([name, blocks]) => blocks.map(b => fresh(b, name))),
    fresh(`${T}.P24`, "transform"),
    fresh("R1.S4", "verify"),
    fresh("R1.S5", "manifest"),
    fresh("R1.S6", "pipeline"),
    fresh("R1.S7", "determinism contract"),
    fresh("R1.S8.P1", "error handling"),
    fresh("R1.S8.P2", "tool"),
  ])
}

// ------------------------------------------------------------------ R2

function r2(request: ModelRequest): AttributionAnswer {
  const { to, fresh, none, over } = helpers(request)
  return answer([
    none("R2.S0"),
    fresh("R2.S1", "profile"),
    fresh("R2.S8", "deduplicate"), fresh("R2.S9", "split"), fresh("R2.S10", "assert"), fresh("R2.S11", "normalize"),
    // "The existing `fill` transform now supports an additional strategy": R1's closed strategy list no longer holds as written.
    to("R2.S13", "fill", "partial", { overrides: [over(["R1.S3.P22.s3"], ["R2.S13.P1"])] }),
    fresh("R2.S14", "encode"), fresh("R2.S15", "rollup"), fresh("R2.S16", "detect"), fresh("R2.S17", "bin"),
    to("R2.S18", "pipeline"),
    fresh("R2.S19", "compare"),
    fresh("R2.S28", "hash"),
    to("R2.S29", "pipeline"),
  ])
}

// ------------------------------------------------------------------ R3: partial revisions of fill and normalize

function r3(request: ModelRequest, rangeTypo: boolean): AttributionAnswer {
  const { to, fresh, none, over } = helpers(request)
  return answer([
    none("R3.S0"),
    to("R3.S2", "fill", "partial", { overrides: [over([rangeTypo ? "R2.S13.P4.s4..s7" : "R2.S13.P4.s4"], ["R3.S2.P2", "R3.S2.P3"])] }),
    to("R3.S3", "normalize", "partial", { overrides: [over(["R2.S11.P5.s3"], ["R3.S3.P1", "R3.S3.P2"]), over(["R2.S11.P6.s4"], ["R3.S3.P3"])] }),
    to("R3.S4", "profile"),
    fresh("R3.S6", "drift"),
    fresh("R3.S14", "resample"), fresh("R3.S15", "watermark"),
    to("R3.S16", "pipeline"),
  ])
}

// ------------------------------------------------------------------ R5: one passage changes four commands

function r5(request: ModelRequest, typo: boolean): AttributionAnswer {
  const { id, to, fresh, none, over } = helpers(request)
  const P2 = "R5.S1.P2", P3 = "R5.S1.P3"
  return answer([
    none("R5.S0"),
    to("R5.S1.P1", "verify", "partial", { overrides: [over(["R1.S4.P2.s1"], ["R5.S1.P1"])] }),
    to(`${P2}.s1`, "verify"),
    to(`${P2}.s2`, "manifest"),
    to(`${P2}.s3`, "manifest", "partial", { overrides: [over(["R1.S5.P2.s2"], [`${P2}.s3`])] }),
    // The sidecar item: ingest's sentence is gone, and so is the sidecar clause of transform's closing item.
    to(`${P2}.s4`, "ingest", "withdraw", { replaces: ["R1.S2.P6.s3", "R1.S3.P24.s1.c3"] }),
    to(`${P2}.s5`, "ingest"),
    fresh(typo ? `${P2}.s7` : `${P2}.s6`, "blake2b-256 digest"),
    to(`${P3}.s1`, "verify"),
    to(`${P3}.s2`, "manifest"),
    to(`${P3}.s3`, "verify"),
    to(`${P3}.s4`, "ingest"),
    to(`${P3}.s5`, "transform", "withdraw", { replaces: ["R1.S3.P24.s1.c3"] }),
    fresh("R5.S2", "lineage"),
    to("R5.S8", "pipeline"),
  ])
}

// ------------------------------------------------------------------ R7

function r7(request: ModelRequest): AttributionAnswer {
  const { to, fresh, none, over } = helpers(request)
  return answer([
    none("R7.S0"),
    to("R7.S1", "lineage", "partial", { overrides: [over(["R5.S4.P3.s5"], ["R7.S1.P3"])] }),
    fresh("R7.S3", "temporal"),
  ])
}

// ------------------------------------------------------------------ R10: manifest field rename; reconcile reaches pipeline and lineage

function r10(request: ModelRequest, twice: boolean): AttributionAnswer {
  const { to, fresh, none, over } = helpers(request)
  return answer([
    none("R10.S0"),
    to("R10.S1", "manifest", "partial", { overrides: [over(["R1.S5.P2.s3"], ["R10.S1.P2", "R10.S1.P4"])] }),
    fresh("R10.S2", "reconcile"),
    to("R10.S7", "pipeline"),
    to("R10.S8", "lineage"),
    // The first answer refers to the new reconcile object by a guessed id (as gpt-5.6-luna-fast does).
    ...(twice ? [{ ...fresh("R10.S3", "reconcile"), new_object: null, object_id: `O${request.objects.length + 1}` }] : []),
  ])
}

// ------------------------------------------------------------------ R12, R13, R15

function r12(request: ModelRequest): AttributionAnswer {
  const { to, fresh, over } = helpers(request)
  return answer([
    // R2's method item lists only the two explicit methods; the default case is new text over it.
    to("R12.S2", "normalize", "partial", { overrides: [over(["R2.S11.P3.s2"], ["R12.S2.P1.s2", "R12.S2.P2", "R12.S2.P3"])] }),
    fresh("R12.S3", "round"),
  ])
}

function r13(request: ModelRequest, staleHash: boolean): AttributionAnswer {
  const { to, fresh, none } = helpers(request)
  const own = ["R13.S2.P1", "R13.S3", "R13.S4", "R13.S5", "R13.S6", "R13.S7", "R13.S8"]
  return answer([
    ...own.map(b => fresh(b, "snapshot")),
    // The pipeline-support section speaks of three objects; split at paragraphs.
    to("R13.S9.P1", "pipeline"), to("R13.S9.P2", "pipeline"),
    to(staleHash ? "R13.S9.P3#00000000" : "R13.S9.P3", "lineage"),
    none("R13.S9.P4"),
    fresh("R13.S10", "clip"),
  ])
}

function r15(request: ModelRequest): AttributionAnswer {
  const { to, fresh, none, over } = helpers(request)
  return answer([
    to("R15.S2.P1", "snapshot", "partial", { overrides: [over(["R13.S4.P1.s1", "R13.S5.P1.s1", "R13.S7.P1.s8"], ["R15.S2.P1.s2"])] }),
    to("R15.S2.P2", "snapshot", "partial", { overrides: [over(["R13.S7.P1.s9"], ["R15.S2.P2.s1"])] }),
    none("R15.S2.P3"),
    fresh("R15.S3", "tag"),
  ])
}

// ------------------------------------------------------------------ scripts

export const SCRIPTS: Record<number, Reply[]> = {
  1: [req => r1(req, false), req => patch({ upsert: [helpers(req).fresh("R1.S3.P16", "window")] })],
  2: [req => r2(req)],
  3: [req => r3(req, true), req => patch({ upsert: [r3(req, false).assignments[1]] })],
  5: [req => r5(req, true), req => patch({ remove: ["R5.S1.P2.s7"], upsert: [helpers(req).fresh("R5.S1.P2.s6", "blake2b-256 digest")] })],
  7: [req => r7(req)],
  10: [req => r10(req, true), () => patch({ remove: ["R10.S3"] })],
  12: [req => r12(req)],
  13: [req => r13(req, true), req => patch({ upsert: [helpers(req).to("R13.S9.P3", "lineage")] })],
  15: [req => r15(req)],
}

/** One object per top-level section (under a round title), named after the backticked name or the heading. */
export function ruleStub(request: ModelRequest): AttributionAnswer {
  const sections = request.outline.map(line => {
    const id = line.split(" ")[0]
    const own = /:\s+(P\d+\(\d+\)(?: P\d+\(\d+\))*)$/u.exec(line)
    const heading = own ? line.slice(id.length + 1, line.length - own[0].length) : line.slice(id.length + 1)
    return { id, heading, paragraphs: own ? own[1].split(" ").map(p => `${id}.${p.replace(/\(\d+\)$/u, "")}`) : [] }
  })
  const level = (h: string) => /^(#+)\s/u.exec(h)?.[1].length ?? 0
  const headed = sections.filter(s => !s.id.endsWith(".S0"))
  const top = Math.min(...headed.map(s => level(s.heading)))
  const unit = top === 1 ? 2 : top
  const blank = (block: string): Assignment => ({ block, object_id: null, new_object: null, change: "none", replaces: [], overrides: [], note: "rule stub" })
  const assignments: Assignment[] = []
  for (const s of sections) {
    // The preface and a round title's own paragraphs state no requirement under this rule.
    if (s.id.endsWith(".S0")) { assignments.push(blank(s.id)); continue }
    if (level(s.heading) === 1) { assignments.push(...s.paragraphs.map(blank)); continue }
    if (level(s.heading) !== unit) continue
    const named = /`([^`]+)`/u.exec(s.heading)?.[1]
    const words = s.heading.replace(/^#+\s*/u, "").toLowerCase().trim()
    const word = (name: string) => new RegExp(`(^|\\s)${name.toLowerCase().replace(/[^a-z0-9 -]/gu, "")}(\\s|$)`, "u").test(words)
    const existing = named !== undefined ? request.objects.find(o => o.name.toLowerCase() === named.toLowerCase()) : request.objects.find(o => word(o.name))
    if (existing) assignments.push({ block: s.id, object_id: existing.id, new_object: null, change: "add", replaces: [], overrides: [], note: "rule stub" })
    else assignments.push({ block: s.id, object_id: null, new_object: named ?? words, change: "add", replaces: [], overrides: [], note: "rule stub" })
  }
  return { assignments, references: [], interpretations: [] }
}

export interface StubLog { round: number; task: "attribute" | "repair"; request: ModelRequest }

/**
 * A transport that answers from the request alone, so a round run again from its checkpoint gets the same answers:
 * an empty draft gets the round's first answer, a draft with something in it the repair (the last reply repeats).
 * Rounds without a script get the rule stub.
 */
export function stubTransport(scripts: Record<number, Reply[]> = SCRIPTS, log: StubLog[] = []): AttributionTransport {
  return async request => {
    const script = scripts[request.round]
    const n = request.previous_draft.assignments.length === 0 ? 0 : 1
    log.push({ round: request.round, task: n === 0 ? "attribute" : "repair", request })
    const reply = script ? script[Math.min(n, script.length - 1)](request) : ruleStub(request)
    const shaped = typeof reply === "string" || !("assignments" in reply) ? reply : asPatch(reply)
    return {
      text: typeof shaped === "string" ? shaped : JSON.stringify(shaped),
      usage: { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 },
      stub: true,
      model: script ? "stub:scripted" : "stub:rule",
    }
  }
}
