import { execFileSync } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { QuotaExhausted, type TokenUsage } from "./attribution.js"
import { EnvironmentUnavailable } from "./platform.js"
import { SessionBroken } from "./execution.js"
import type { OpenCodeCodingClient } from "./opencode-executor.js"
import { sessionTokens } from "./opencode-executor.js"
import { asProviderError, classifyProviderError, withRateLimitRetry, type RateLimitPolicy } from "./provider-errors.js"
import { sessionMaterials, type ReviewMaterials } from "./materials.js"

/**
 * The reviewer (DESIGN §12i item 1): a session with tools, in a copy of the program, that builds it, runs it on
 * inputs of its own and lists the deviations from the requirements. The request's base text and the repair message's
 * base text are the control group's, word for word (REVIEW_INTRO, REVIEW_REPLY, REPAIR_INTRO); what §12i adds (the
 * units to check with care, guards that fail now, leads to verify) comes after, in paragraphs of its own. Each
 * review is a new session; a review in which the program never ran is void and done again (§12i item 7).
 */

export const REVIEW_INTRO = "The Go program in this directory was written from the requirements below. Review it against them: build it, run it on inputs you choose, and compare what it does with what the requirements say. Changes you make here are thrown away."
export const REVIEW_REPLY = "Reply with a list of the deviations you found. For each: the requirement it breaks, the command and input you used, and what the program did. If you found none, reply exactly NO ISSUES."
export const REPAIR_INTRO = "An independent review of the program against the requirements reported the following. Follow the requirements where an item seems to contradict them, and do not change behaviour the items do not concern."
export const NO_ISSUES = "NO ISSUES"

export const roundHeading = (round: number) => `# Round ${round} requirements`

/** The requirements as the reviewer gets them, as the control group joins them: each round under its heading and a blank line, rounds apart by a blank line. */
export function requirementsText(sources: readonly { round: number; text: string }[]): string {
  return [...sources].sort((a, b) => a.round - b.round).map(s => `${roundHeading(s.round)}\n\n${s.text}`).join("\n\n")
}

/** The base request, word for word: the two instructions, a blank line, the requirements. */
export function reviewBaseText(sources: readonly { round: number; text: string }[]): string {
  return `${REVIEW_INTRO}\n${REVIEW_REPLY}\n\n${requirementsText(sources)}`
}

/** What §12i adds to a review request, each part a paragraph of its own after the requirements. */
export interface ReviewFocus {
  round: number
  /** Review scope full: earlier units this round revised or withdrew, quoted (empty in round 1). */
  units: { id: string; text: string }[]
  /** The round's package (§6c, review request item 2): the ids of the units this round added or revised. */
  unit_ids?: string[]
  /** Guards that passed on an earlier program and fail on this one, where this round's text changed behind them. */
  guardFailures: { id: string; args: string[]; files: { path: string; content: string }[]; expected: string; got: string; changed: string[]; was: { id: string; text: string }[]; now: { id: string; text: string }[] }[]
  /** Findings of automatic checks and judgments that are not confirmed: the reviewer verifies them (§12i item 3). */
  leads: { id: string; text: string }[]
  /** Batch 1 (decision 3): items still open, as check material and the units they rest on, no original text. */
  items?: readonly { id: string; text: string }[]
  /** Batch 1 (DESIGN-OPUS §10.2 G2): the reviewer may say which sentences state no behaviour (NOT BEHAVIOUR lines). */
  declare?: boolean
  /** Batch 1 (§11 item 1): the scope sentences no passing check holds yet, which this review is to show by runs (COVERED lines). */
  coverage?: readonly string[]
  /** Batch 1 (§12): a later review of the round; the requirements above are only what is still owed and what the last repair touched. */
  partial?: boolean
}


const clip = (s: string, n: number) => s.length > n ? `${s.slice(0, n)}…` : s
const quote = (t: string) => t.trim().split(/\r?\n/u).map(l => `> ${l}`).join("\n")

const partialNote = (round: number) => `An earlier review of round ${round} read this round's requirements. The requirements above are only the sentences still to show by a run and those the last repair's items rest on, each under its id and heading; check them with particular care. A deviation found anywhere is still a deviation.`

export function reviewAppendix(f: ReviewFocus): string {
  const out: string[] = []
  out.push("# Focus of this review")
  // A later review of the round (batch 1, §12) reads only what is owed and what the last repair touched.
  if (f.partial) out.push(partialNote(f.round))
  else if (f.round === 1) out.push(`Round ${f.round} is the first round: all of the requirements are new.`)
  else {
    if (f.unit_ids) out.push(`The requirements above are each object's text as it stands after round ${f.round}. Units round ${f.round} added or revised, to check with particular care: ${f.unit_ids.join(", ") || "none"}. The rest was reviewed when it arrived and is context here; a deviation found anywhere is still a deviation.`)
    else out.push(`The text under \`${roundHeading(f.round)}\` is what this round added or revised; check it with particular care. The text of earlier rounds was reviewed when it arrived and is context here; a deviation found anywhere is still a deviation.`)
    if (f.units.length) { out.push("Earlier text this round revised or withdrew (no longer in force as written):"); for (const u of f.units) out.push(quote(clip(u.text, 600))) }
  }
  if (f.guardFailures.length) {
    out.push("", "# Checks that passed on an earlier version of the program and fail now")
    out.push(`Each check below passed before and fails on this version, and the requirements it rests on changed in round ${f.round}. Decide from the requirements as they stand now: if the behaviour the check expects is no longer required, write a line \`SUPERSEDED <check id>: <why>\` in your reply; if it is still required, list the failure as a deviation like any other.`)
    for (const g of f.guardFailures) {
      out.push("", `${g.id}: command ${JSON.stringify(g.args)}; input files ${g.files.map(x => `${x.path} = ${JSON.stringify(clip(x.content, 300))}`).join(", ") || "none"}; expected ${g.expected}; got ${g.got}.`)
      out.push(`Changed this round: ${g.changed.join("; ")}.`)
      // A text the request gives already is named by its id (batch 1, §0a): an empty text.
      const said = (x: { id: string; text: string }) => x.text ? JSON.stringify(clip(x.text, 300)) : `${x.id} (above)`
      if (g.was.length) out.push(`Text it rested on (before): ${g.was.map(said).join(" ")}`)
      if (g.now.length) out.push(`Text in force now: ${g.now.map(said).join(" ")}`)
    }
  }
  if (f.coverage?.length) {
    out.push("", "# Sentences to show by a run")
    out.push(`No check has passed yet on the sentences below (${f.coverage.length}; this round's text and some earlier text above). Check them as you review, by running the program. For each run of the program that shows some of them hold, write one line \`COVERED <sentence ids> BY RUN <n>\` in your reply, each id written in full as listed below, n counting your runs of the program in this session from 1 in the order you made them (only runs of the program count). A sentence the program breaks is a deviation, to list as usual.`)
    // Full ids, one a line (opusb2 R1: a list grouped by paragraph was echoed with the paragraph and the part apart).
    out.push(...f.coverage.map(id => `- ${id}`))
  }
  if (f.declare) {
    out.push("", "# Sentences that state no behaviour")
    out.push("Some sentences of the requirements above state nothing a run of the program could show (background, a definition, a note on the document). For each such sentence you notice, you may write a line `NOT BEHAVIOUR <sentence id>: <why>` in your reply, the id as the annotations show it. These lines are not deviations.")
  }
  if (f.items?.length) {
    out.push("", "# Items still open from earlier rounds")
    out.push("Each was found on an earlier version of the program and still fails on the version the round started from; the executor has it. A deviation you find among them is still a deviation; the requirements above are the authority.")
    for (const it of f.items) out.push("", it.text)
  }
  if (f.leads.length) {
    out.push("", "# Leads to verify")
    out.push("Automatic checks flagged the following; none is confirmed. Verify each one against the requirements by running the program yourself, and report only what is a deviation. A lead that turns out not to be one needs no mention.")
    for (const l of f.leads) out.push(`- ${l.id}: ${clip(l.text, 700).replace(/\n/gu, " ")}`)
  }
  return out.join("\n")
}

/** Under the round's package (§6c): the two instructions, the package's views as the requirements, the appendix. */
export function reviewRequestOn(body: string, focus: ReviewFocus): string {
  return `${REVIEW_INTRO}
${REVIEW_REPLY}

${body.trimEnd()}

${reviewAppendix(focus)}
`
}

/** The whole request: the base text word for word, then the appendix as separate paragraphs. */
export function reviewRequest(sources: readonly { round: number; text: string }[], focus: ReviewFocus): string {
  return `${reviewBaseText(sources)}\n\n${reviewAppendix(focus)}\n`
}

/** The repair message: the base text word for word, then the list, then (separately) what else the executor must know. */
export function repairFromReview(list: string, notes: string[] = []): string {
  return [REPAIR_INTRO, list, ...notes].join("\n\n")
}

/**
 * The lines of a reply that speak to code, not deviations: SUPERSEDED (a guard the text no longer requires) and, in
 * batch 1, NOT BEHAVIOUR (a sentence that states no behaviour a run could show) and COVERED (a run that shows
 * sentences hold). They are no entries of the list.
 */
export const CONTROL_LINE = /^\s*[-*]?\s*`?(?:SUPERSEDED\s+G\d+|NOT BEHAVIOU?R\s+R\d|COVERED\s+R\d)/u
const content = (text: string) => text.split(/\r?\n/u).filter(l => !CONTROL_LINE.test(l)).join("\n")

/** exactly NO ISSUES (markdown emphasis or a final period tolerated), the control lines aside. */
export function isNoIssues(text: string): boolean {
  return /^\s*[*_`]*NO ISSUES[*_`]*\.?\s*$/u.test(content(text))
}

/**
 * `NOT BEHAVIOUR <sentence id>: <why>` lines of a reply (batch 1, DESIGN-OPUS §10.2 G2): the reviewer's word that a
 * sentence states no behaviour a run could show. Ids as the annotations show them (hash dropped).
 */
export function notBehaviourIn(text: string): { id: string; reason: string }[] {
  return [...text.matchAll(/^\s*[-*]?\s*`?NOT BEHAVIOU?R\s+(R\d+(?:\.[A-Za-z]*\d+|\.H)+)(?:#[0-9a-f]+)?`?\s*:\s*(.*)$/gmu)].map(m => ({ id: m[1], reason: m[2].trim() }))
}

/** `SUPERSEDED <guard id>: <why>` lines of a reply (§12i item 6). */
export function supersededIn(text: string): { guard: string; reason: string }[] {
  return [...text.matchAll(/^\s*[-*]?\s*`?SUPERSEDED\s+(G\d+)`?\s*:\s*(.*)$/gmu)].map(m => ({ guard: m[1], reason: m[2].trim() }))
}

const ENTRY_START = /^(?:\d+[.)]|[-*•])\s+\S/u

/** A rough count of list entries in a reply (numbered or bulleted top-level lines); the formalizer's count is the one reported. */
export function listEntries(text: string): number {
  return reviewEntries(text).length
}

/**
 * The reply's top-level list entries in the reviewer's words: each from a line that opens an entry (unindented
 * number or bullet) to the next; text before the first entry and SUPERSEDED lines are left out. A reply with no list
 * is one entry.
 */
export function reviewEntries(text: string): string[] {
  const out: string[][] = []
  for (const line of text.split(/\r?\n/u)) {
    if (CONTROL_LINE.test(line)) continue
    if (ENTRY_START.test(line)) out.push([line])
    else if (out.length) out.at(-1)!.push(line)
  }
  if (!out.length) { const rest = replyAsList(text); return rest && !isNoIssues(rest) ? [rest] : [] }
  return out.map(l => l.join("\n").trim())
}

/** The reply as a repair list in the reviewer's words (the control group's list): SUPERSEDED lines left out. */
export function replyAsList(text: string): string {
  return content(text).trim()
}

export interface ProgramRun { command: string; exit_code: number | null }

export interface ReviewOutcome {
  text: string
  usage: TokenUsage
  model?: string
  session: string
  /** The reviewer's own runs of the program under review, as the session's tool calls show them. */
  runs: ProgramRun[]
  /** The files the reviewer wrote and the commands it ran, from the same tool calls (batch C, effect 3). */
  materials?: Pick<ReviewMaterials, "files" | "commands" | "unreadable">
}

export interface Reviewer {
  /** One review: a new session in `dir`, a copy of the program, given `request`. */
  review(dir: string, request: string, label: string): Promise<ReviewOutcome>
}

/**
 * Whether a review ran the program at all (§12i item 7): some run of it ended with an exit code of its own (not
 * 126 or 127, the shell's "cannot execute" and "not found"); an unknown exit code counts, as it cannot be told apart.
 */
export function reviewRanProgram(runs: readonly ProgramRun[]): boolean {
  return runs.some(r => r.exit_code === null || (r.exit_code >= 0 && r.exit_code <= 125))
}

/**
 * Whether a shell command runs the program: a segment of it (split at &&, ||, ; and |) names the binary as the command
 * (not as an argument of go build or the like), or is `go run`.
 */
export function invokesProgram(command: string, binary: string): boolean {
  const b = binary.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  // Either path separator, and a binary the reviewer built under a longer name (dpipe-review.exe) count too.
  const runs = new RegExp(`(^|[\\s(])(?:[^\\s]*[/\\\\])?\\.?[/\\\\]?${b}[-_A-Za-z0-9]*(\\.exe)?(\\s|$|[)])`, "u")
  return command.split(/&&|\|\||;|\|/u).map(seg => seg.trim()).some(seg => {
    if (/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*go\s+run\s/u.test(seg)) return true
    if (/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*go\s/u.test(seg)) return false
    // PowerShell's call operator and a quoted path (`& ".\dpipe.exe"`) are not part of the command name.
    const body = seg.replace(/^&\s+/u, "").replace(/^(["'])(\S+?)\1/u, "$2").replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/u, "").replace(/^(?:cd\s+\S+\s+)/u, "")
    const first = body.split(/\s+/u)[0] ?? ""
    return runs.test(first) || /^(?:timeout|time|env|nice)\s/u.test(body) && runs.test(body)
  })
}

const unwrap = (v: unknown): Record<string, any> => {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, any>
  return (r.data && typeof r.data === "object" ? r.data : r) as Record<string, any>
}

/** The session's shell tool calls that ran the program, with their exit codes where the tool reports them. */
export function programRunsIn(messages: unknown, binary: string): ProgramRun[] {
  const list = Array.isArray(messages) ? messages : Array.isArray(unwrap(messages).messages) ? unwrap(messages).messages : []
  const out: ProgramRun[] = []
  for (const m of (list as unknown[]).map(unwrap)) {
    for (const p of (Array.isArray(m.parts) ? m.parts : []) as Record<string, any>[]) {
      if (p?.type !== "tool") continue
      const tool = String(p.tool ?? p.name ?? "").toLowerCase()
      if (!/bash|shell|sh$|exec|command/u.test(tool)) continue
      const state = (p.state ?? {}) as Record<string, any>
      const command = String(state.input?.command ?? state.input?.cmd ?? p.input?.command ?? "")
      if (!command || !invokesProgram(command, binary)) continue
      if (state.status && state.status !== "completed") continue
      const meta = (state.metadata ?? {}) as Record<string, any>
      const exit = [meta.exit, meta.exit_code, meta.exitCode, meta.code].find(x => typeof x === "number")
      const output = String(state.output ?? "")
      // A shell that could not start the program says so; count it as 127 when the tool gives no exit code.
      const notFound = /command not found|No such file or directory|not found\b.*\b(dpipe|\.\/)|Permission denied/u.test(output) && exit === undefined
      out.push({ command, exit_code: typeof exit === "number" ? exit : notFound ? 127 : null })
    }
  }
  return out
}

function broken(what: string, e: unknown): Error {
  if (e instanceof QuotaExhausted) return e
  const kind = classifyProviderError(e)
  return kind === "auth" || kind === "quota" ? asProviderError(e) as Error : new SessionBroken(`${what} failed: ${(e as Error).message}`)
}

export interface OpenCodeReviewerOptions {
  client: OpenCodeCodingClient
  providerId: string
  modelId: string
  variant?: string
  /** The agent with tools (default build, as the control group). */
  agent?: string
  /** The program's binary name, to tell the reviewer's runs of it in the session's tool calls. */
  binary: string
  rateLimit?: RateLimitPolicy
}

/** The reviewer over OpenCode: a new session per review in the copy's directory, the request as a plain prompt, no system prompt of ours. */
export class OpenCodeReviewer implements Reviewer {
  constructor(private readonly o: OpenCodeReviewerOptions) {}
  async review(dir: string, request: string, label: string): Promise<ReviewOutcome> {
    const { client } = this.o
    let created: Record<string, any>
    try { created = unwrap(await client.session.create({ query: { directory: dir }, body: { title: `exp2 review ${label}` } })) } catch (e) { throw broken("session.create", e) }
    const id = String(created.id ?? "")
    if (!id) throw new SessionBroken("session.create returned no id")
    let r: Record<string, any>
    try {
      r = await withRateLimitRetry(async () => {
        const reply = unwrap(await client.session.prompt({
          path: { id }, query: { directory: dir },
          body: { model: { providerID: this.o.providerId, modelID: this.o.modelId }, ...(this.o.variant ? { variant: this.o.variant } : {}), agent: this.o.agent ?? "build", parts: [{ type: "text", text: request }] },
        }))
        if (reply.info?.error) throw new Error(JSON.stringify(reply.info.error))
        return reply
      }, this.o.rateLimit)
    } catch (e) { throw broken("session.prompt", e) }
    const text = (Array.isArray(r.parts) ? r.parts : []).filter((p: any) => p?.type === "text").map((p: any) => String(p.text)).join("\n")
    let usage: TokenUsage | null = null, runs: ProgramRun[] = [], materials: ReviewOutcome["materials"]
    try {
      if (client.session.messages) { const messages = await client.session.messages({ path: { id }, query: { directory: dir } }); usage = sessionTokens(messages); runs = programRunsIn(messages, this.o.binary); materials = sessionMaterials(messages, dir) }
    } catch { usage = null }
    try { await client.session.abort?.({ path: { id }, query: { directory: dir } }) } catch { /* a finished session may refuse; nothing depends on it */ }
    const t = (r.info?.tokens ?? {}) as Record<string, any>
    const n = (x: unknown) => typeof x === "number" && Number.isFinite(x) ? x : 0
    return { text, usage: usage ?? { input_tokens: n(t.input), output_tokens: n(t.output), reasoning_tokens: n(t.reasoning), cache_read_tokens: n(t.cache?.read), cache_write_tokens: n(t.cache?.write) }, model: typeof r.info?.modelID === "string" ? r.info.modelID : undefined, session: id, runs, ...(materials ? { materials } : {}) }
  }
}

/**
 * A copy of the program for one review: a clone of the work tree at `commit` in `dir` (made fresh; whatever the
 * reviewer changes there is thrown away with it).
 */
export function copyProgram(workdir: string, commit: string, dir: string): string {
  // A directory left locked by an earlier attempt (Windows, EPERM/EBUSY) is left as it is: the copy goes beside it.
  let at = dir
  for (let n = 2; ; n++) {
    try { rmSync(at, { recursive: true, force: true }); break } catch (e) {
      if (n > 5) throw new EnvironmentUnavailable(`the review copy at ${dir} cannot be made: ${(e as Error).message}`)
      at = `${dir}-${n}`
    }
  }
  try {
    mkdirSync(dirname(at), { recursive: true })
    execFileSync("git", ["clone", "-q", workdir, at], { stdio: ["ignore", "ignore", "pipe"] })
    execFileSync("git", ["-C", at, "checkout", "-q", commit], { stdio: ["ignore", "ignore", "pipe"] })
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? "").trim()
    throw new EnvironmentUnavailable(`the review copy of ${commit.slice(0, 12)} cannot be cloned to ${at}: ${stderr || (e as Error).message}`.slice(0, 600))
  }
  return at
}

// Windows can keep a review copy locked (EPERM/EBUSY); like the control arm's script, leave it in place then.
export function discardCopy(dir: string): void { try { rmSync(dir, { recursive: true, force: true }) } catch { /* left in place */ } }

export interface ReviewCallRecord {
  id: string
  round: number
  stage: "acceptance"
  step: "review"
  /** Which review of the round (1-based), and the attempt within it (a void review is done again). */
  review: number
  attempt: number
  cycle: string
  commit: string
  request_chars: number
  response_text: string
  usage: TokenUsage
  stub: boolean
  model?: string
  session: string
  program_runs: number
  /** False when the program never ran in the session: the review is void (§12i item 7). */
  valid: boolean
  no_issues: boolean
  error?: string
}
