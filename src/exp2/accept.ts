import type { AnchorExtractor } from "./anchors.js"
import { diffAnchors, touched } from "./anchors.js"
import { RoleUnavailable, type TokenUsage } from "./attribution.js"
import { activeChecks, coverage, EMPTY_CHECKS, type CheckEvent, type CheckRecord, type CodeFacts } from "./checks.js"
import { renderEvidence, SessionBroken, Sends, type AcceptRoundRecord, type BuildResult, type CycleRecord, type ExecutionLimits, type ExecutionRecord, type Executor, type ExecutorReply, type ItemSighting, type ReviewItemRecord, type ReviewSummary, type SupersededItem } from "./execution.js"
import { assessPremises, DEFAULT_PREMISE_BLOCK, formalizeReview, itemCheckRecord, notInForce, OWN_FAILURES, reproduces, type FormalizeCallRecord, type FormalizeTransport, type Premise } from "./formalize.js"
import { commitStep, head, resetTo } from "./git.js"
import { changedTextBehind, changeQuotes, guardCheck, guardStatuses, runGuards, type GuardEvent, type GuardRecord } from "./guards.js"
import { sessionInput, type ReviewMaterials } from "./materials.js"
import type { Registry } from "./registry.js"
import { notBehaviourIn } from "./review.js"
import { bindCovered, reviewerRuns, uncoveredScope, type CoveredRecord } from "./covered.js"
import { copyProgram, discardCopy, isNoIssues, repairFromReview, replyAsList, reviewEntries, reviewRanProgram, reviewRequest, reviewRequestOn, supersededIn, type ReviewCallRecord, type Reviewer, type ReviewFocus } from "./review.js"
import type { DeliveryLedger } from "./delivery.js"
import type { CheckRunner, ProgramRef, ScriptSandbox } from "./runner.js"
import { runChecks, runDigest, type CheckRun } from "./verdict.js"
import type { WorkOrder } from "./workorder.js"

/**
 * The round's execution and acceptance under DESIGN §12i. One executor session gets the work order; after each
 * reply the code builds and tries the program in the target environment (build and test, as the control group),
 * runs every guard in one batch, and holds a review: a fresh tool-using session reads all the requirements and lists
 * deviations. A model call writes the list as checks; the code checks their premises and that they fail on the
 * program; what survives goes back to the executor word for word, with the control group's repair message. After a
 * repair, a guard that passed and fails now on text the round left as it was is a regression: an item with its
 * material, sent with the next repair; no repair is reverted (batch 1 of DESIGN-OPUS, 5A). A deviation
 * the executor fixed becomes a guard. A review that finds nothing ends the round's reviews. Judgments and library
 * failures never confirmed are leads for the reviewer, never repairs. The adjudication session is not on this path.
 */

export interface Lead { id: string; text: string; digest: string }

/** An item carried in from an earlier round: a guard still failing, or a review item not yet fixed, with the check that shows it. */
export interface CarriedItem {
  id: string; text: string; check: CheckRecord | null; /** Its output's digest on the baseline: the work order's send is this round's one send while it stays. */ digest?: string
  /** Batch 1 (§0a class C): what the item's text is rendered from, once the round's delivery ledger stands. */
  material?: { round: number; units: string[]; run: CheckRun; guard?: GuardRecord; words?: string }
}

export interface AcceptLimits extends ExecutionLimits {
  /** Reviews a round at most (default 3, the control group's). */
  reviews?: number
  /** Repairs of a failing build or test in the target environment, before the first review (default 2). */
  trialFixes?: number
  /** Premises that stop an item (default DEFAULT_PREMISE_BLOCK); a failure of any other is logged and the item sent (fix block A3). */
  premiseBlock?: readonly Premise[]
  /**
   * Items code cannot verify for reasons of its own (fix block A1): items (default) sends each in the reviewer's words;
   * review does so only when nothing else from the review was sent or verified; off blocks them, as before.
   */
  fallback?: "items" | "review" | "off"
  /** Void and redo a review in whose session no run of the program was seen (§12i item 7; default off, fix block A2). */
  voidWithoutRuns?: boolean
}

export interface AcceptDeps {
  registry: Registry
  library: readonly CheckRecord[]
  events: readonly CheckEvent[]
  facts: CodeFacts
  guards: readonly GuardRecord[]
  guardEvents: readonly GuardEvent[]
  runner: CheckRunner
  sandbox: ScriptSandbox
  anchors: AnchorExtractor
  build: (workdir: string, label: string) => BuildResult
  /** The target environment's trial: build and test in the no-network container. Absent: the build alone. */
  trial?: (workdir: string, label: string) => Promise<{ ok: boolean; output: string }>
  reviewer: Reviewer
  formalize: FormalizeTransport
  /** The program's name, as the requirements call it. */
  binary: string
  /** The requirements of rounds 1..this, verbatim, for the reviewer. */
  sources: readonly { round: number; text: string }[]
  /**
   * Review scope delta (§6c): the round's package as current views, the body of the review request in place of
   * `sources`; the formalizer reads the same text.
   */
  body?: string
  /** A fresh directory for a copy of the program, by label. */
  copyDir: (label: string) => string
  /** Judgments on this program (probes and judge, when on): wrong verdicts as leads for the reviewer, never repairs. */
  leads?: (program: ProgramRef, cycle: string) => Promise<Lead[]>
  /**
   * The library once the round's checks are written (fix block B3): awaited before the first guard run, after the
   * coding; absent when the checks were written before the work order.
   */
  libraryNow?: () => Promise<{ library: readonly CheckRecord[]; events: readonly CheckEvent[] }>
  /** The store's writers: calls and guards are kept as they happen, so an interrupted round loses nothing it spent. */
  record: { review: (r: ReviewCallRecord) => Promise<void>; formalize: (calls: FormalizeCallRecord[]) => Promise<void>; guards: (born: GuardRecord[], events: GuardEvent[]) => Promise<void> }
  /** Items the work order carried in (their checks run every cycle); `quiet`: items listed only, at the output they were stuck at. */
  carried?: readonly CarriedItem[]
  quiet?: ReadonlyMap<string, string>
  /** Open items not carried because this round replaced their text: recorded for the ledger (fix block B1). */
  superseded?: readonly SupersededItem[]
  time?: (stage: string, startedAt: number, endedAt: number) => void
  /** Batch 1 (§0a): the round's delivery ledger; original text in the repair messages and review requests goes through it. */
  delivery?: DeliveryLedger
  /** Batch 1 (decision 3): the open items the reviewer is given, as check material without original text. */
  reviewItems?: readonly { id: string; text: string }[]
  /**
   * Batch 1 (§11 item 1, effect 8): the review's scope sentences, this round's behaviour sentences and the slice's debt.
   * Reviews go on while some no passing guard holds (at most `reviews`); COVERED lines bind them to the reviewer's runs.
   */
  scope?: readonly string[]
  onProgress?: (record: ExecutionRecord) => void
  checkTimeoutMs?: number
}

const zero = (): TokenUsage => ({ input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 })
const plus = (a: TokenUsage, b: TokenUsage): TokenUsage => ({ input_tokens: a.input_tokens + b.input_tokens, cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens, cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens, output_tokens: a.output_tokens + b.output_tokens, reasoning_tokens: a.reasoning_tokens + b.reasoning_tokens })
const clip = (s: string, n: number) => s.length > n ? `${s.slice(0, n)}…` : s
const squash = (s: string) => s.replace(/\s+/gu, " ").trim()

class CallTimeout extends Error {}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try { return await Promise.race([p, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new CallTimeout(`no answer in ${ms} ms`)), ms) })]) } finally { clearTimeout(timer) }
}

/**
 * The message after a failed trial in the target environment, the control group's word for word; the output is the
 * trial's (or, with no trial configured, the build's), cut only when very long.
 */
export function trialMessage(build: BuildResult, trial: { ok: boolean; output: string } | null, binary: string): string {
  const output = trial && !trial.ok ? trial.output : build.output
  return `The program was built and its tests run in the target environment with \`go build -o ${binary} ./... && go test ./...\` in /app (a Linux container without network). It failed:\n\`\`\`\n${clip(output.trimEnd(), 20_000)}\n\`\`\`\nFix the code so that this passes there.`
}

/**
 * The original text an item rests on, as one line's parts: each unit's text, or (with the delivery ledger, §0a) what
 * the ledger gives for it — the text once a round, an id after that or past the line.
 */
export type Quote = (units: readonly string[]) => string[]
const quoteAll = (registry: Registry): Quote => units => units.map(u => registry.block(u)?.text.trim()).filter((t): t is string => !!t).map(t => JSON.stringify(clip(t, 400)))

/** An item's check material (§0a class C): the command and its files, and what the program did against what is expected. */
export function renderMaterial(check: CheckRecord, run: CheckRun): string[] {
  const failed = run.assertions.filter(a => !a.ok).map(a => { const x = check.assertions.find(y => y.id === a.id)!; return `${placeName(x.target)}: expected ${JSON.stringify(x.expect)}, got ${JSON.stringify(a.actual)}` })
  return [
    `Command: ${JSON.stringify(check.input.args)}; input files: ${check.input.files.map(f => `${f.path} = ${JSON.stringify(clip(f.content, 600))}`).join(", ") || "none"}.`,
    `What the program did: exit ${run.exit_code}; ${failed.join("; ")}${run.stderr_head.trim() ? `; stderr: ${JSON.stringify(clip(run.stderr_head.trim(), 300))}` : ""}.`,
  ]
}

/** A guard's failure as an item of the list the executor gets: the requirement, the command and input, what the program did. */
export function renderGuardItem(g: GuardRecord, check: CheckRecord, run: CheckRun, registry: Registry, carried = false, quote: Quote = quoteAll(registry)): string {
  return [
    `A check that passed on ${carried ? "an earlier" : "the previous"} version of the program fails now (${g.id}).`,
    `Requirement: ${quote(g.units).join(" ")}`,
    ...renderMaterial(check, run),
  ].join("\n")
}

/** An open review item as the executor gets it (§0a class C, decision 3): the reviewer's words, the text it rests on, its check material. */
export function renderOpenItem(text: string, check: CheckRecord, run: CheckRun, units: readonly string[], quote: Quote): string {
  const q = quote(units)
  return [text.trim(), ...(q.length ? [`Requirement: ${q.join(" ")}`] : []), ...renderMaterial(check, run)].join("\n")
}

/** An open item as the reviewer gets it (decision 3): its check material and the units it rests on, no original text. */
export function renderItemForReview(id: string, check: CheckRecord, run: CheckRun, units: readonly string[]): string {
  return [`${id}, resting on ${units.join(", ") || "no unit"}:`, ...renderMaterial(check, run)].join("\n")
}

/** Where a check's expected values come from (verbatim / derived / computed), recorded with each flip (§6b). */
/** Leads given to one review at most (§6c, review request item 2). */
export const LEADS_MAX = 20

/** The leads one review gets (§6c): at most LEADS_MAX, those resting on units no guard covers first, then by id. */
export function pickLeads(registry: Registry, library: readonly CheckRecord[], guards: readonly GuardRecord[], runs: readonly CheckRun[]): { given: CheckRun[]; dropped: number } {
  const units = guards.flatMap(g => g.units)
  const covered = (k: string) => (library.find(c => c.id === k)?.blocks ?? []).some(b => units.some(u => registry.lineage(u).some(x => x.id === b) || registry.lineage(b).some(x => x.id === u)))
  const sorted = [...runs].sort((a, b) => Number(covered(a.check)) - Number(covered(b.check)) || Number(a.check.slice(1)) - Number(b.check.slice(1)))
  return { given: sorted.slice(0, LEADS_MAX), dropped: Math.max(0, sorted.length - LEADS_MAX) }
}
const expectedKinds = (k: CheckRecord) => [...new Set(k.assertions.map(a => a.source.kind))].sort()
const placeName = (t: CheckRecord["assertions"][number]["target"]) => [t.kind, t.path, t.line !== null ? `line ${t.line}` : null, t.pointer, t.column].filter(x => x !== null && x !== undefined && x !== "").join(" ")

/** The list the executor gets: numbered, each item the reviewer's words (or a guard's evidence). */
export function renderReviewList(items: readonly { id: string; text: string }[]): string {
  return items.map((it, n) => `${n + 1}. ${it.text.trim()}`).join("\n\n")
}

const emptyAccept = (atStart: number): AcceptRoundRecord => ({ reviews: [], voided: 0, premise_blocked: {}, guards: { at_start: atStart, at_end: atStart, born: [], flipped_changed_text: [], flipped_unchanged: [], retired: [] }, reverted: 0, trial: { runs: 0, failures: 0 }, leads: { library: 0, judgment: 0 } })

export async function acceptRound(workdir: string, workorder: WorkOrder, text: string, executor: Executor, deps: AcceptDeps, limits: AcceptLimits): Promise<ExecutionRecord> {
  const round = workorder.round
  const task = workorder.task.map(t => t.object)
  const timeout = deps.checkTimeoutMs ?? 10_000
  const reviewsMax = limits.reviews ?? 3, trialMax = limits.trialFixes ?? 2
  const record: ExecutionRecord = { round, base: head(workdir), head: "", status: "done", task, sessions: [], cycles: [], kept: null, carried: [], open: [], links: [], usage: zero(), review_items: [], accept: emptyAccept(deps.guards.length) }
  const accept = record.accept!
  const registry = deps.registry
  // Guards as they stand, changed here as the round goes (the store gets the same events through `record.guards`).
  const guards: GuardRecord[] = [...deps.guards]
  const events: GuardEvent[] = [...deps.guardEvents]
  const status = guardStatuses(events)
  const live = () => guards.filter(g => status.get(g.id) !== "retired")
  let nextGuard = guards.length + 1
  // The library as the round starts; the round's own checks join when their writing (beside the coding) is done (fix block B3).
  let library = deps.library, libraryEvents = deps.events, libraryJoined = !deps.libraryNow
  const guarded = new Set(guards.filter(g => g.source === "library").map(g => g.check!))
  const note = async (born: GuardRecord[], evs: GuardEvent[]) => { guards.push(...born); events.push(...evs); for (const e of evs) status.set(e.guard, e.status); for (const g of born) if (g.check) guarded.add(g.check); await deps.record.guards(born, evs) }
  // Items of the ledger this round: carried in, guard regressions, review items.
  const carried = new Map((deps.carried ?? []).map(c => [c.id, c]))
  if (carried.size) record.carried_in = [...carried.values()].map(c => ({ id: c.id, digest: c.digest ?? "" }))
  if (deps.superseded?.length) record.superseded_in = [...deps.superseded]
  const sends = new Sends(new Map([...carried.values()].map(c => [c.id, c.digest ?? ""])), deps.quiet)
  const itemChecks = new Map<string, { text: string; record: CheckRecord; item?: ReviewItemRecord; key?: string }>()
  const keyOf = (r: CheckRecord) => JSON.stringify([[...r.blocks].sort(), r.input])
  for (const c of carried.values()) if (c.check) itemChecks.set(c.id, { text: c.text, record: c.check, key: keyOf(c.check) })
  const leadsGiven = new Map<string, string>()
  const asked = new Set<string>()
  let session = await executor.open({ round, workdir, workorder, text, resume: null })
  record.sessions.push({ id: session.id, opened_for: "work", closed: "normally" })
  let message = text, kind: CycleRecord["message"] = "work", evidence = ""
  let sessionsLeft = limits.maxSessions - 1
  let lastCommit = record.base
  let trialFixes = 0, repairs = 0, reviews = 0, reviewSessions = 0, lastReviewFound = true
  let current: { cycle: string; commit: string; program: ProgramRef } | null = null
  let good: { cycle: string; commit: string; program: ProgramRef } | null = null
  // The guards that regressed on the cycle before (batch 1, 5A): counted fixed or still failing on this one.
  let raisedBefore: string[] = []
  accept.regressions = { raised: 0, fixed_next: 0, persisted: 0 }
  // The executor's quotes of the text an item rests on (§0a): through the ledger when there is one.
  const quote: Quote | undefined = deps.delivery ? units => deps.delivery!.quote("executor", units) : undefined
  // A question's quotes for the reviewer: a text given already is named by its id (an empty text), any other is counted.
  const forReviewer = (list: { id: string; text: string }[], cls: "A" | "B") => list.map(x => { if (!deps.delivery) return x; if (deps.delivery.has("reviewer", x.id)) return { id: x.id, text: "" }; deps.delivery.give("reviewer", cls, x.id, x.text.length); return x })
  // The scope sentences owed (batch 1, effect 8): no live passing guard holds them, no open item rests on them, not declared.
  const owed = () => deps.scope ? uncoveredScope(registry, deps.scope, live(), status, [...itemChecks.values()].flatMap(p => p.record.blocks)).filter(s => !accept.declared?.some(d => d.id === s)) : []
  const timed = async <T>(stage: string, f: () => Promise<T>): Promise<T> => { const a = Date.now(); try { return await f() } finally { deps.time?.(stage, a, Date.now()) } }
  const block = new Set<Premise>(limits.premiseBlock ?? DEFAULT_PREMISE_BLOCK)
  const fallbackMode = limits.fallback ?? "items"
  accept.premise_logged = {}
  accept.fallback = { reviews: 0, whole: 0, items: 0, reasons: {} }
  accept.program_runs_zero = 0
  // Items sent with no check behind them (fallback, or logged without a check): their text, in the reviewer's words.
  const freeText = new Map<string, { text: string; whole: boolean }>()
  // Reviews whose whole reply went out as the control group sends it: the items it covers (batch C, effect 4).
  const wholeReplies: { review: string; ids: Set<string>; text: string }[] = []
  let survivors: { id: string; text: string }[] = []
  const sendFree = (rec: ReviewItemRecord, text: string, why: string, whole = false) => {
    rec.disposition ??= "logged"
    if (rec.disposition === "logged") for (const l of rec.logged ?? []) accept.premise_logged![l.premise] = (accept.premise_logged![l.premise] ?? 0) + 1
    freeText.set(rec.id, { text, whole })
    const plan = sends.plan(rec.id, "")
    items.push({ id: rec.id, digest: "", verdict: "unverified", ...plan, why })
    if (plan.action === "send") survivors.push({ id: rec.id, text })
  }
  let items: ItemSighting[] = []

  /** One review on `at`: a fresh copy and session; void when the program never ran, then done again once. */
  const review = async (at: { cycle: string; commit: string; program: ProgramRef }, focus: ReviewFocus, n: number) => {
    let attempts = 0
    for (;;) {
      if (reviewSessions >= reviewsMax * 2) return null
      attempts++
      reviewSessions++
      const label = `R${round}-review${n}-${attempts}`
      const dir = copyProgram(workdir, at.commit, deps.copyDir(label))
      const request = deps.body ? reviewRequestOn(deps.body, focus) : reviewRequest(deps.sources.filter(s => s.round <= round), focus)
      let out: Awaited<ReturnType<Reviewer["review"]>> | null = null, error: string | undefined
      try { out = await timed("review", () => withTimeout(deps.reviewer.review(dir, request, label), limits.callTimeoutMs)) } catch (e) {
        if (!(e instanceof SessionBroken) && !(e instanceof CallTimeout)) { discardCopy(dir); throw e }
        error = (e as Error).message
      }
      discardCopy(dir)
      // Whether the program ran is a soft signal (fix block A2): reported, and voids the review only when configured.
      const ran = !!out && reviewRanProgram(out.runs)
      const valid = !!out && (ran || !limits.voidWithoutRuns)
      if (valid && !ran) accept.program_runs_zero!++
      const callRecord: ReviewCallRecord = {
        id: `V${round}.${n}.${attempts}`, round, stage: "acceptance", step: "review", review: n, attempt: attempts, cycle: at.cycle, commit: at.commit, request_chars: request.length,
        response_text: out?.text ?? "", usage: out?.usage ?? zero(), stub: out?.model?.startsWith("stub") === true, ...(out?.model ? { model: out.model } : {}), session: out?.session ?? "", program_runs: out?.runs.length ?? 0, valid, no_issues: !!out && valid && isNoIssues(out.text), ...(error ? { error } : {}),
      }
      await deps.record.review(callRecord)
      if (valid) return { out: out!, attempts, call: callRecord }
      accept.voided++
      if (attempts >= 2) return { out: null, attempts, call: callRecord }
    }
  }

  for (let n = 1; ; n++) {
    const before = deps.anchors.extract(workdir)
    let reply: ExecutorReply
    const sentAt = Date.now()
    try { reply = await withTimeout(session.send(message), limits.callTimeoutMs) } catch (e) {
      deps.time?.(kind === "work" ? "coding" : kind === "trial" ? "trial fix" : "repair", sentAt, Date.now())
      if (!(e instanceof SessionBroken) && !(e instanceof CallTimeout)) throw e
      record.sessions.find(s => s.id === session.id)!.closed = "broken"
      void session.close().catch(() => {})
      resetTo(workdir, lastCommit)
      if (sessionsLeft-- <= 0) { record.status = "sessions_spent"; break }
      session = await executor.open({ round, workdir, workorder, text, resume: evidence ? { evidence } : null })
      record.sessions.push({ id: session.id, opened_for: `C${round}.${record.cycles.length + 1}`, closed: "normally" })
      message = evidence ? `${text}\n\nA previous session stopped. The work tree is at the last commit the controller made, where the review said:\n${evidence}` : text
      kind = "resume"
      n--
      continue
    }
    record.usage = plus(record.usage, reply.usage)
    const id = `C${round}.${record.cycles.length + 1}`
    deps.time?.(kind === "work" ? "coding" : kind === "trial" ? "trial fix" : "repair", sentAt, Date.now())
    const builtAt = Date.now()
    const build = deps.build(workdir, id)
    deps.time?.("build", builtAt, Date.now())
    const after = deps.anchors.extract(workdir)
    const changed = touched(diffAnchors(before, after))
    let trial: { ok: boolean; output: string } | null = null
    // A host build that failed is tried in the target environment too: the executor gets that output, as the control group's does.
    if (deps.trial) { accept.trial.runs++; trial = await timed("trial", () => deps.trial!(workdir, id)); if (!trial.ok) accept.trial.failures++ }
    const ok = build.ok && (trial?.ok ?? true)
    const commit = commitStep(workdir, `${id} ${kind}`, [["IC-Round", String(round)], ["IC-Cycle", id], ["IC-Session", session.id], ...task.map(o => ["IC-Object", `${o}@v${registry.objects.get(o)!.version}`] as [string, string]), ...(changed.length ? [["IC-Anchors", changed.join(", ")] as [string, string]] : []), ["IC-Build", build.ok ? "ok" : "failed"], ["IC-Trial", trial ? (trial.ok ? "ok" : "failed") : "none"]])
    lastCommit = commit
    const cycle: CycleRecord = { id, round, session: session.id, message: kind, commit, build: { ok: build.ok, output: build.ok ? "" : clip(build.output, 4000) }, runs: [], failing: [], contests: [], corrections: [], ambiguous: [], broke: [], anchors: changed, note: clip(reply.note, 4000), usage: reply.usage, items: [], ...(trial ? { trial: { ok: trial.ok, output: trial.ok ? "" : clip(trial.output, 4000) } } : {}) }
    items = cycle.items!
    if (!ok) {
      record.cycles.push(cycle)
      deps.onProgress?.(record)
      if (trialFixes >= trialMax) { record.status = "trial_spent"; break }
      trialFixes++
      message = trialMessage(build, trial, deps.binary)
      kind = "trial"
      continue
    }
    current = { cycle: id, commit, program: build.program! }
    record.first_delivery ??= { cycle: id, commit }
    if (!libraryJoined) { const l = await timed("waiting for checks", () => deps.libraryNow!()); library = l.library; libraryEvents = l.events; libraryJoined = true }
    // 1. Every guard, in one batch; library checks not yet guards in another: the ones that pass are born as guards.
    const statusBefore = new Map(status)
    const guardRuns = await timed("guard rerun", () => runGuards(live(), library, current!.program, deps.runner, round, registry, deps.facts, timeout))
    const unguarded = activeChecks(library, libraryEvents).filter(c => !guarded.has(c.id))
    const libRuns = unguarded.length ? await timed("guard rerun", () => runChecks(unguarded, current!.program, deps.runner, round, registry, deps.facts, timeout)) : []
    cycle.runs = [...guardRuns.map(r => ({ check: r.guard, outcome: r.run.outcome, failure: r.run.failure ? `${r.run.failure.class}/${r.run.failure.reason}` : null })), ...libRuns.map(r => ({ check: r.check, outcome: r.outcome, failure: r.failure ? `${r.failure.class}/${r.failure.reason}` : null }))]
    const flipped = guardRuns.filter(r => r.outcome === "fail" && statusBefore.get(r.guard) === "passing").map(r => r.guard)
    const born: GuardRecord[] = [], evs: GuardEvent[] = []
    // Library checks that pass are born as guards.
    for (const r of libRuns.filter(x => x.outcome === "pass")) {
      const k = unguarded.find(c => c.id === r.check)!
      const g: GuardRecord = { id: `G${nextGuard++}`, round, source: "library", check: k.id, units: [...k.blocks], object: k.object, born: { cycle: id, program: current.program.id } }
      born.push(g)
      evs.push({ guard: g.id, round, cycle: id, status: "passing", program: current.program.id })
    }
    // 2. Flips are classified first (§12j.7 item 11, §6b): this round's text changed behind the guard by the attribution's
    // records, the reviewer's question; otherwise a regression, whatever the kind of its expected values.
    const flips = flipped.map(gid => {
      const g = guards.find(x => x.id === gid)!, run = guardRuns.find(x => x.guard === gid)!.run
      const behind = changedTextBehind(registry, g, round)
      return { g, run, behind, how: behind.length ? "changed_text" as const : "regression" as const }
    })
    for (const f of flips) accept.guards.flips = [...(accept.guards.flips ?? []), { id: f.g.id, cycle: id, how: f.how, sources: [...new Set(f.behind.map(b => b.source))], expected: expectedKinds(guardCheck(f.g, library)) }]
    // A repair that made a passing guard fail on text the round left as it was is not reverted (batch 1, 5A): the
    // regression is an item with its material (renderGuardItem), sent with the cycle's other items; it is counted.
    // 3. Flips: this round's text changed behind the guard, or not (§12i item 6); fixed guards pass again.
    const regressions: { g: GuardRecord; run: CheckRun }[] = []
    // The regressions of the cycle before, seen again here: fixed (the guard passes) or still failing.
    const raisedNow: string[] = []
    for (const gid of raisedBefore) { const r = guardRuns.find(x => x.guard === gid); if (r?.outcome === "pass") accept.regressions!.fixed_next++; else if (r?.outcome === "fail") accept.regressions!.persisted++ }
    for (const r of guardRuns) {
      const g = guards.find(x => x.id === r.guard)!
      if (r.outcome === "pass" && statusBefore.get(g.id) !== "passing") { evs.push({ guard: g.id, round, cycle: id, status: "passing", program: current.program.id }); items.push({ id: g.id, digest: runDigest(r.run), verdict: "pass", action: "none" }); itemChecks.delete(g.id) }
      if (r.outcome !== "fail") continue
      if (flipped.includes(g.id)) {
        const f = flips.find(x => x.g.id === g.id)!
        evs.push({ guard: g.id, round, cycle: id, status: "failing", program: current.program.id, ...(f.behind.length ? { changed_text: f.behind.map(b => b.text), behind_sources: [...new Set(f.behind.map(b => b.source))] } : {}) })
        if (f.how === "changed_text") { accept.guards.flipped_changed_text.push(g.id); asked.delete(g.id) }
        else { accept.guards.flipped_unchanged.push(g.id); regressions.push({ g, run: r.run }); raisedNow.push(g.id); accept.regressions!.raised++ }
        continue
      }
      // Failing already: awaiting the reviewer's word when this round's text stands behind it, a regression otherwise.
      const last = [...events].reverse().find(e => e.guard === g.id && e.status === "failing")
      if (last?.changed_text?.length) continue
      regressions.push({ g, run: r.run })
    }
    raisedBefore = raisedNow
    await note(born, evs)
    accept.guards.born.push(...born.map(g => g.id))
    cycle.guards = { run: guardRuns.length, passed: guardRuns.filter(r => r.outcome === "pass").length, failed: guardRuns.filter(r => r.outcome === "fail").length, unknown: guardRuns.filter(r => r.outcome === "unknown").length, flipped, born: born.map(g => g.id) }
    for (const { g, run } of regressions) {
      const d = runDigest(run)
      const plan = sends.plan(g.id, d)
      items.push({ id: g.id, digest: d, verdict: "not_landed", ...plan })
      itemChecks.set(g.id, { text: renderGuardItem(g, guardCheck(g, library), run, registry, carried.has(g.id), quote), record: guardCheck(g, library) })
    }
    // 4. Items sent before (this round's review items, items carried in): fixed ones become guards; the rest are seen again.
    const pending = [...itemChecks.entries()].filter(([k]) => !k.startsWith("G"))
    if (pending.length) {
      const runs = await timed("guard rerun", () => runChecks(pending.map(([, p]) => p.record), current!.program, deps.runner, round, registry, deps.facts, timeout))
      const bornNow: GuardRecord[] = [], evNow: GuardEvent[] = []
      pending.forEach(([k, p], i) => {
        const run = runs[i]
        if (run.outcome === "pass") {
          items.push({ id: k, digest: runDigest(run), verdict: "pass", action: "none" })
          const g: GuardRecord = { id: `G${nextGuard++}`, round, source: "review", units: [...p.record.blocks], object: p.record.object === "none" ? null : p.record.object, input: p.record.input, assertions: p.record.assertions, reference_script: p.record.reference_script, origin: { item: k, review: p.item?.review ?? "", text: p.text }, born: { cycle: id, program: current!.program.id } }
          bornNow.push(g)
          evNow.push({ guard: g.id, round, cycle: id, status: "passing", program: current!.program.id })
          if (p.item) p.item.guard = g.id
          itemChecks.delete(k)
        } else if (run.failure?.reason !== "timeout") {
          const d = runDigest(run)
          items.push({ id: k, digest: d, verdict: "wrong", ...sends.plan(k, d) })
        }
      })
      if (bornNow.length) { await note(bornNow, evNow); accept.guards.born.push(...bornNow.map(g => g.id)); cycle.guards.born.push(...bornNow.map(g => g.id)) }
    }
    // 5. The review, when one may still lead to a repair and the last one found something (§12i item 1).
    // Batch 1 (effect 8): with a scope, a review also follows while scope sentences are owed, and another follows on the
    // same program when one found nothing to send and some are still owed.
    const canReview = reviews < reviewsMax && (lastReviewFound || owed().length > 0) && repairs < limits.repairCycles
    for (let again = canReview; again;) {
      const n2 = reviews + 1
      const program = current.program
      // Leads: library checks failing that never passed, and judgments (when on), each once per round at an output.
      const leads: ReviewFocus["leads"] = []
      // After a revert the library ran on the reverted program: its failures are no leads for a review of the kept one.
      // At most LEADS_MAX (§6c, review request item 2): those resting on units no guard covers first, then by id.
      const { given, dropped } = pickLeads(registry, library, live(), libRuns.filter(x => x.outcome === "fail" && x.failure?.reason !== "timeout" && leadsGiven.get(x.check) !== runDigest(x)))
      if (dropped) accept.leads.dropped = (accept.leads.dropped ?? 0) + dropped
      for (const r of given) {
        leadsGiven.set(r.check, runDigest(r))
        leads.push({ id: r.check, text: renderEvidence([r], [r.check], library, registry, new Set()) })
        accept.leads.library++
      }
      for (const l of deps.leads ? await deps.leads(program, id) : []) {
        if (leadsGiven.get(l.id) === l.digest) continue
        leadsGiven.set(l.id, l.digest)
        leads.push({ id: l.id, text: l.text })
        accept.leads.judgment++
      }
      // Guards failing with this round's text behind them: the reviewer says superseded or deviation (§12i item 6).
      const questions = live().filter(g => { const last = [...events].reverse().find(e => e.guard === g.id); return last?.status === "failing" && last.changed_text?.length && !asked.has(g.id) })
      const guardFailures: ReviewFocus["guardFailures"] = []
      if (questions.length) {
        const runs = await runGuards(questions, library, program, deps.runner, round, registry, deps.facts, timeout)
        questions.forEach((g, i) => {
          const check = guardCheck(g, library), run = runs[i].run
          const failed = run.assertions.filter(a => !a.ok)
          const q = changeQuotes(registry, g, round)
          guardFailures.push({ id: g.id, args: check.input.args, files: check.input.files, expected: failed.map(a => { const x = check.assertions.find(y => y.id === a.id)!; return `${placeName(x.target)} = ${JSON.stringify(x.expect)}` }).join(", ") || "(all assertions)", got: failed.map(a => JSON.stringify(a.actual)).join(", ") || `exit ${run.exit_code}`, changed: [...events].reverse().find(e => e.guard === g.id)!.changed_text ?? [], was: forReviewer(q.old, "B"), now: forReviewer(q.now, "A") })
        })
      }
      const revised = registry.objects.size ? [...registry.objects.values()].flatMap(o => o.blocks.flatMap(b => b.modifications.filter(m => m.round === round).flatMap(m => m.parts.map(p => ({ id: p, text: `${registry.block(p)?.text.trim() ?? ""} (${m.kind === "withdraw" ? "withdrawn" : m.kind === "partial" ? "partly revised" : "replaced"} by ${m.by.join(", ")} in round ${round})` }))))) : []
      // Under the round's package the reviewer reads the text in force; the appendix names this round's units (§6c).
      const thisRound = round === 1 ? [] : [...new Set(registry.roundScope(round).flatMap(c => c.entries.map(e => e.block)))].sort((a, b) => registry.block(a)!.start - registry.block(b)!.start)
      const focus: ReviewFocus = deps.body ? { round, units: [], unit_ids: thisRound, guardFailures, leads, ...(deps.reviewItems?.length ? { items: deps.reviewItems } : {}), ...(deps.delivery ? { declare: true } : {}), ...(deps.scope ? { coverage: owed() } : {}) } : { round, units: round === 1 ? [] : dedupe(revised), guardFailures, leads, ...(deps.scope ? { coverage: owed() } : {}) }
      const r = await review(current, focus, n2)
      reviews++
      const summary: ReviewSummary = { n: n2, cycle: current.cycle, attempts: r?.attempts ?? 0, valid: !!r?.out, no_issues: !!r?.out && isNoIssues(r.out.text), reported: 0, malformed: 0, blocked: 0, sent: 0, superseded: [] as string[], leads: leads.length, program_runs: r?.out?.runs.length ?? 0, fallback: 0, logged: 0 }
      for (const g of questions) asked.add(g.id)
      survivors = []
      if (r?.out) {
        // COVERED lines (batch 1, §11 item 1): the reviewer's runs, numbered by code, run again on the program reviewed;
        // the same output is a guard on the scope sentences named.
        if (deps.scope) {
          const runs = reviewerRuns({ files: r.out.materials?.files ?? [], commands: r.out.materials?.commands ?? [] }, deps.binary)
          const b = await timed("guard rerun", () => bindCovered(r.out!.text, runs, { registry, round, review: `R${round}.${n2}`, cycle: id, program, runner: deps.runner, timeoutMs: timeout, open: new Set(owed()), nextGuard: () => `G${nextGuard++}` }))
          accept.covered = [...(accept.covered ?? []), ...b.records]
          if (b.guards.length) {
            await note(b.guards, b.guards.map(g => ({ guard: g.id, round, cycle: id, status: "passing" as const, program: program.id })))
            accept.guards.born.push(...b.guards.map(g => g.id))
            cycle.guards!.born.push(...b.guards.map(g => g.id))
          }
        }
        // SUPERSEDED lines retire guards; a questioned guard not superseded is a regression from here on.
        // NOT BEHAVIOUR lines (batch 1, G2): a sentence (a clause stands for its sentence) in force is recorded once.
        if (deps.delivery) for (const d of notBehaviourIn(r.out.text)) {
          const b = registry.block(d.id)
          const id = b?.level === "clause" ? b.parent! : d.id
          if (registry.block(id)?.level !== "sentence" || notInForce(registry, round, id) || accept.declared?.some(x => x.id === id)) continue
          accept.declared = [...(accept.declared ?? []), { id, reason: d.reason, review: `R${round}.${n2}` }]
        }
        const superseded = supersededIn(r.out.text)
        const retire: GuardEvent[] = []
        for (const s of superseded) {
          const g = questions.find(x => x.id === s.guard) ?? live().find(x => x.id === s.guard && [...events].reverse().find(e => e.guard === x.id)?.status === "failing")
          if (!g) continue
          retire.push({ guard: g.id, round, cycle: id, status: "retired", reason: `superseded, by the reviewer: ${s.reason}` })
          accept.guards.retired.push({ id: g.id, reason: s.reason })
          summary.superseded.push(g.id)
        }
        await note([], retire)
        for (const g of questions.filter(x => !summary.superseded.includes(x.id))) {
          const run = (await runGuards([g], library, program, deps.runner, round, registry, deps.facts, timeout))[0].run
          const d = runDigest(run)
          await note([], [{ guard: g.id, round, cycle: id, status: "failing", program: program.id, reason: "the reviewer did not call it superseded: a regression" }])
          const plan = sends.plan(g.id, d)
          items.push({ id: g.id, digest: d, verdict: "not_landed", ...plan })
          itemChecks.set(g.id, { text: renderGuardItem(g, guardCheck(g, library), run, registry, false, quote), record: guardCheck(g, library) })
        }
        if (!isNoIssues(r.out.text)) {
          // The list as checks (one model call), then the premises and the reproduction, by code. What code cannot
          // verify for reasons of its own goes out in the reviewer's words (fix block A1); premises outside the
          // blocking tier are logged, the item sent (A3).
          const reply = r.out.text
          const entries = reviewEntries(reply)
          // What IC holds of this review (batch C, effect 3): the library leads it gave, and the reviewer's session.
          const materials: ReviewMaterials = {
            leads: leads.flatMap(l => { const k = library.find(c => c.id === l.id); return k ? [{ id: k.id, check: k }] : [] }),
            files: r.out.materials?.files ?? [], commands: r.out.materials?.commands ?? [], ...(r.out.materials?.unreadable ? { unreadable: r.out.materials.unreadable } : {}),
          }
          const f = await timed("formalize", () => formalizeReview(registry, round, reply, deps.binary, deps.formalize, { reviewId: `R${round}.${n2}`, callId: k => `F${round}.${n2}.${k}`, materials, ...(deps.body ? { body: deps.body } : {}) }))
          await deps.record.formalize(f.calls)
          if (f.unavailable && fallbackMode === "off") throw new RoleUnavailable("formalize", f.unavailable, f.calls)
          const own: { n: number; text: string; units: string[]; failure: { premise: Premise; detail: string }; rec?: ReviewItemRecord }[] = []
          // An item's text as the reviewer wrote it: its entry of the reply when the formalizer's quote is that entry (or
          // holds it), else the quote when it is the reply's own words, else the entry.
          const quoted = (n: number, q?: string) => {
            const e = entries[n - 1]?.replace(/^(?:\d+[.)]|[-*•])\s+/u, "")
            if (e && q && (squash(q).includes(squash(e)) || squash(e).includes(squash(q)))) return e
            return q && squash(reply).includes(squash(q)) ? q : e ?? q ?? reply
          }
          const handled = new Set<number>()
          let verified = 0
          if (f.unavailable) {
            entries.forEach((_t, k) => own.push({ n: k + 1, text: quoted(k + 1), units: [], failure: { premise: "formalize_failed", detail: f.unavailable! } }))
            summary.reported = entries.length
          } else {
            const bad = new Map<number, string[]>()
            for (const m of f.malformed) if (m.item !== null) bad.set(m.item, [...(bad.get(m.item) ?? []), m.message])
            for (const [n, msgs] of bad) { handled.add(n); own.push({ n, text: quoted(n, f.texts.find(t => t.item === n)?.text), units: [], failure: { premise: "malformed", detail: msgs.join("; ") } }) }
            for (const it of f.items) handled.add(it.item)
            // A reply code could not read at all, or entries the formalizer left out: each entry as the reviewer wrote it.
            const answerless = f.malformed.find(m => m.item === null)
            entries.forEach((_t, k) => { if (!handled.has(k + 1)) own.push({ n: k + 1, text: quoted(k + 1), units: [], failure: answerless && !f.items.length && !bad.size ? { premise: "malformed", detail: answerless.message } : { premise: "not_formalized", detail: "the formalizer wrote no item for this entry of the review" } }) })
            summary.reported = Math.max(entries.length, handled.size)
            summary.malformed = bad.size + (answerless && !f.items.length && !bad.size ? entries.length : 0)
          }
          await timed("premise checks", async () => {
            const seen = new Set<number>()
            for (const it of f.items) {
              // One record a position: an item the formalizer numbered twice keeps its first writing.
              if (seen.has(it.item)) { summary.formalizer_duplicates = (summary.formalizer_duplicates ?? 0) + 1; continue }
              seen.add(it.item)
              let vid = `V${round}.${n2}.${it.item}`
              const rec: ReviewItemRecord = { id: vid, round, review: `R${round}.${n2}`, item: it.item, text: it.text, units: it.units, premise: null, ...(it.input_from ? { input_from: it.input_from } : {}) }
              record.review_items!.push(rec)
              // A file an earlier command of the session wrote: that command run again on this program (batch C, effect 3).
              if (it.input && it.produced?.length) for (const pr of it.produced) {
                const out = await deps.runner.run(program, sessionInput(pr.by, materials), timeout)
                const made = out.files[pr.path]
                if (made !== undefined) it.input.files.push({ path: pr.path, content: made })
                rec.produced = [...(rec.produced ?? []), { path: pr.path, by: pr.by, made: made !== undefined }]
              }
              const a = await assessPremises(registry, round, it, deps.sandbox, timeout)
              const logged = a.failures.filter(x => !block.has(x.premise) && !OWN_FAILURES.has(x.premise))
              const ownFailure = a.failures.find(x => !block.has(x.premise) && OWN_FAILURES.has(x.premise))
              let stop = a.failures.find(x => block.has(x.premise)) ?? null
              if (logged.length) rec.logged = logged
              if (!stop && a.check) {
                let checkRecord = itemCheckRecord(vid, round, it, a.check)
                // The same deviation reported again (same units, same call) is the item it was: the ledger goes on with it.
                const key = keyOf(checkRecord)
                const prior = [...itemChecks.entries()].find(([k, x]) => !k.startsWith("G") && x.key === key)
                if (prior) { rec.same_as = prior[0]; vid = prior[0]; checkRecord = { ...checkRecord, id: vid } }
                const rep = await reproduces(checkRecord, program, deps.runner, round, registry, deps.facts, timeout)
                if (!rep.reproduced) {
                  const nr = { premise: "not_reproduced" as const, detail: `the check passes on the program as it stands (exit ${rep.run.exit_code})` }
                  if (block.has("not_reproduced")) stop = nr
                  else { rec.logged = [...(rec.logged ?? []), nr]; sendFree(rec, quoted(it.item, it.text), `logged: ${nr.premise}`) }
                } else {
                  rec.disposition = rec.logged?.length ? "logged" : "sent"
                  for (const l of rec.logged ?? []) accept.premise_logged![l.premise] = (accept.premise_logged![l.premise] ?? 0) + 1
                  if (items.some(i => i.id === vid)) { /* seen in this cycle already (a carried item reported again): one sighting */ }
                  else {
                    const d = runDigest(rep.run)
                    rec.check = a.check
                    itemChecks.set(vid, { text: quoted(it.item, it.text), record: checkRecord, item: prior?.[1].item ?? rec, key })
                    const plan = sends.plan(vid, d)
                    items.push({ id: vid, digest: d, verdict: "wrong", ...plan })
                    if (plan.action === "send") survivors.push({ id: vid, text: quoted(it.item, it.text) })
                  }
                }
              } else if (!stop && ownFailure) own.push({ n: it.item, text: quoted(it.item, it.text), units: it.units, failure: ownFailure, rec })
              else if (!stop) sendFree(rec, quoted(it.item, it.text), `logged: ${logged.map(l => l.premise).join(", ") || "no assertion could be resolved"}`)
              if (stop) {
                verified++
                rec.premise = stop.premise
                rec.detail = stop.detail
                rec.disposition = "blocked"
                accept.premise_blocked[stop.premise] = (accept.premise_blocked[stop.premise] ?? 0) + 1
                items.push({ id: rec.id, digest: "", verdict: "blocked", action: "blocked", why: `${stop.premise}: ${stop.detail}` })
              }
            }
          })
          // Code's own failures: the items go out in the reviewer's words, or (fallback off, or "review" when something
          // else was sent or verified) are blocked as before.
          if (own.length) {
            const open = fallbackMode === "items" || (fallbackMode === "review" && !survivors.length && !verified)
            const reasons: Record<string, number> = {}
            for (const o of own) reasons[o.failure.premise] = (reasons[o.failure.premise] ?? 0) + 1
            if (!open) for (const o of own) {
              const rec = o.rec ?? (record.review_items!.push({ id: `V${round}.${n2}.${o.n}`, round, review: `R${round}.${n2}`, item: o.n, text: o.text, units: o.units, premise: null }), record.review_items!.at(-1)!)
              rec.premise = o.failure.premise; rec.detail = o.failure.detail; rec.disposition = "blocked"
              accept.premise_blocked[o.failure.premise] = (accept.premise_blocked[o.failure.premise] ?? 0) + 1
              items.push({ id: rec.id, digest: "", verdict: o.failure.premise === "malformed" ? "malformed" : "blocked", action: "blocked", why: `${o.failure.premise}: ${o.failure.detail}` })
            }
            else {
              // Nothing else from this review went out or was verified, and every entry is code's failure: the reply as the control group sends it.
              const whole = !survivors.length && !verified && own.length >= entries.length
              for (const o of own) {
                const rec = o.rec ?? (record.review_items!.push({ id: `V${round}.${n2}.${o.n}`, round, review: `R${round}.${n2}`, item: o.n, text: o.text, units: o.units, premise: null }), record.review_items!.at(-1)!)
                rec.disposition = "fallback"
                rec.logged = [...(rec.logged ?? []), o.failure]
              }
              // Each item is sent and listed on its own (batch C, effect 4); when the whole reply went, the message is
              // the reply as the reviewer wrote it, as the control group sends it.
              const group = whole ? { review: `R${round}.${n2}`, ids: new Set(own.map(o => o.rec?.id ?? `V${round}.${n2}.${o.n}`)), text: replyAsList(reply) } : null
              if (group) wholeReplies.push(group)
              for (const o of own) sendFree(record.review_items!.find(x => x.id === (o.rec?.id ?? `V${round}.${n2}.${o.n}`))!, o.text, whole ? `fallback (the whole reply went): ${o.failure.premise}: ${o.failure.detail}` : `fallback: ${o.failure.premise}: ${o.failure.detail}`)
              summary.fallback = own.length
              summary.fallback_whole = whole
              summary.fallback_reasons = reasons
              accept.fallback!.reviews++
              if (whole) accept.fallback!.whole++
              accept.fallback!.items += own.length
              for (const [k, v] of Object.entries(reasons)) accept.fallback!.reasons[k] = (accept.fallback!.reasons[k] ?? 0) + v
            }
          }
          // Conservation (batch C, effect 4): every entry of the reviewer's list ends in exactly one way.
          // The list's entries are the reviewer's; positions past them are items the formalizer split off, counted too.
          const mine = record.review_items!.filter(x => x.review === `R${round}.${n2}` && x.item > 0)
          const by = (d: string) => mine.filter(x => x.disposition === d).length
          const count = new Map<number, number>()
          for (const x of mine) count.set(x.item, (count.get(x.item) ?? 0) + 1)
          const missing = Array.from({ length: entries.length }, (_, k) => k + 1).filter(k => !count.has(k))
          const twice = [...count].filter(([, c]) => c > 1).map(([k]) => k)
          const open = mine.filter(x => !x.disposition).map(x => x.item)
          summary.reported = count.size + missing.length
          summary.blocked = by("blocked")
          summary.logged = by("logged")
          summary.entered = by("sent") + by("logged") + by("fallback")
          summary.conservation = { reported: summary.reported, sent: by("sent"), logged: by("logged"), fallback: by("fallback"), blocked: by("blocked"), ok: !missing.length && !twice.length && !open.length && summary.reported === summary.entered + summary.blocked }
          if (!summary.conservation.ok) accept.conservation_errors = [...(accept.conservation_errors ?? []), `R${round}.${n2}: entries ${summary.reported}; sent ${by("sent")}, logged ${by("logged")}, fallback ${by("fallback")}, blocked ${by("blocked")}; no record for ${missing.join(", ") || "none"}; recorded twice ${twice.join(", ") || "none"}; no disposition ${open.join(", ") || "none"}`]
        }
      }
      summary.sent = summary.entered ?? survivors.length
      lastReviewFound = survivors.length > 0
      accept.reviews.push(summary)
      const { cycle: _c, ...ofCycle } = summary
      cycle.review = ofCycle
      // Again on the same program only when this review reported no deviation: one it found and could not send (held,
      // blocked) is not found again by looking again at the same program.
      again = !!deps.scope && reviews < reviewsMax && summary.reported === 0 && !items.some(i => i.action === "send") && owed().length > 0
    }
    // 6. What goes back to the executor: items the plan sends (regressions, review items, carried items not yet fixed).
    for (const i of items) if (i.action === "send" || i.action === "hold") sends.mark(i.id, i.digest, { action: i.action, ...(i.why ? { why: i.why } : {}) })
    const toSend = items.filter(i => i.action === "send").map(i => ({ id: i.id, text: itemChecks.get(i.id)?.text ?? freeText.get(i.id)?.text ?? i.id }))
    cycle.failing = items.filter(i => i.verdict === "not_landed").map(i => i.id)
    cycle.corrections = items.filter(i => i.verdict === "wrong").map(i => i.id)
    const held = items.filter(i => i.action === "hold").map(i => i.id)
    if (held.length) cycle.held = held
    record.cycles.push(cycle)
    good = current
    deps.onProgress?.(record)
    if (!toSend.length) break
    if (repairs >= limits.repairCycles) { record.status = "cycles_spent"; break }
    repairs++
    // The whole reply alone goes as the control group sends it: the reviewer's list as written.
    const whole = wholeReplies.find(w => toSend.length > 0 && toSend.length === w.ids.size && toSend.every(t => w.ids.has(t.id)))
    const list = whole ? whole.text : renderReviewList(toSend)
    evidence = list
    message = repairFromReview(list)
    kind = "repair"
  }
  await session.close()
  // The round ends on the last program that built and passed its trial, with the tree there (a reverted repair already is).
  const kept = good
  if (kept) {
    record.kept = kept.cycle
    if (kept.commit !== head(workdir)) resetTo(workdir, kept.commit)
    const last = record.cycles.find(c => c.id === kept.cycle)!
    const sightings = record.cycles.flatMap(c => c.items ?? [])
    const lastSeen = new Map<string, ItemSighting>()
    for (const s of sightings) if (s.action !== "blocked") lastSeen.set(s.id, s)
    // Still failing at the end: guards failing (regressions) and review or carried items not fixed, at their last output.
    const failingGuards = live().filter(g => status.get(g.id) === "failing").map(g => g.id)
    record.final = [
      ...failingGuards.map(id => ({ id, digest: lastSeen.get(id)?.digest ?? "", verdict: "not_landed", action: "none" as const })),
      ...[...itemChecks.keys()].filter(k => !k.startsWith("G")).map(k => ({ id: k, digest: lastSeen.get(k)?.digest ?? "", verdict: "wrong", action: "none" as const })),
    ]
    record.open = record.final.map(f => f.id)
    const failingObjects = new Set<string>()
    for (const id of record.open) { const u = itemChecks.get(id)?.record.blocks ?? guards.find(g => g.id === id)?.units ?? []; for (const x of u) { const o = registry.coverOf(x)?.owner; if (o && o !== "none") failingObjects.add(o) } }
    record.carried = task.filter(o => failingObjects.has(o))
    last.failing = failingGuards
  } else record.carried = task
  accept.guards.at_end = live().length
  // What the reviews left owed: next round's slice starts from their paragraphs (batch 1, effect 8).
  if (deps.scope) { accept.gaps = owed(); const snap = new Set(guards.filter(g => g.snapshot).map(g => g.id)); accept.snapshot_flips = (accept.guards.flips ?? []).filter(f => snap.has(f.id)).length }
  record.head = head(workdir)
  return record
}

function dedupe<T extends { id: string }>(list: T[]): T[] { return [...new Map(list.map(x => [x.id, x])).values()] }

/** Rule-bearing units of this round's text (for the report's focus count). */
export function roundUnits(registry: Registry, round: number): string[] { return coverage(registry, round, EMPTY_CHECKS, [], []).units }
