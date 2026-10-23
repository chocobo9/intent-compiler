import type { AnchorExtractor } from "./anchors.js"
import { diffAnchors, touched } from "./anchors.js"
import { RoleUnavailable, type TokenUsage } from "./attribution.js"
import { activeChecks, coverage, EMPTY_CHECKS, type CheckEvent, type CheckRecord, type CodeFacts } from "./checks.js"
import { renderEvidence, SessionBroken, Sends, type AcceptRoundRecord, type BuildResult, type CycleRecord, type ExecutionLimits, type ExecutionRecord, type Executor, type ExecutorReply, type ItemSighting, type ReviewItemRecord } from "./execution.js"
import { checkPremises, formalizeReview, itemCheckRecord, reproduces, type FormalizeCallRecord, type FormalizeTransport, type Premise } from "./formalize.js"
import { commitStep, head, resetTo } from "./git.js"
import { changedTextBehind, changeQuotes, guardCheck, guardStatuses, runGuards, type GuardEvent, type GuardRecord } from "./guards.js"
import type { Registry } from "./registry.js"
import { copyProgram, discardCopy, isNoIssues, listEntries, repairFromReview, reviewRanProgram, reviewRequest, supersededIn, type ReviewCallRecord, type Reviewer, type ReviewFocus } from "./review.js"
import type { CheckRunner, ProgramRef, ScriptSandbox } from "./runner.js"
import { runChecks, runDigest, type CheckRun } from "./verdict.js"
import type { WorkOrder } from "./workorder.js"

/**
 * The round's execution and acceptance under DESIGN §12i. One executor session gets the work order; after each
 * reply the code builds and tries the program in the target environment (build and test, as the control group),
 * runs every guard in one batch, and holds a review: a fresh tool-using session reads all the requirements and lists
 * deviations. A model call writes the list as checks; the code checks their premises and that they fail on the
 * program; what survives goes back to the executor word for word, with the control group's repair message. After a
 * repair, every guard that passed must still pass, or the repair is reverted and its leads are dropped. A deviation
 * the executor fixed becomes a guard. A review that finds nothing ends the round's reviews. Judgments and library
 * failures never confirmed are leads for the reviewer, never repairs. The adjudication session is not on this path.
 */

export interface Lead { id: string; text: string; digest: string }

/** An item carried in from an earlier round: a guard still failing, or a review item not yet fixed, with the check that shows it. */
export interface CarriedItem { id: string; text: string; check: CheckRecord | null; /** Its output's digest on the baseline: the work order's send is this round's one send while it stays. */ digest?: string }

export interface AcceptLimits extends ExecutionLimits {
  /** Reviews a round at most (default 3, the control group's). */
  reviews?: number
  /** Repairs of a failing build or test in the target environment, before the first review (default 2). */
  trialFixes?: number
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
  /** A fresh directory for a copy of the program, by label. */
  copyDir: (label: string) => string
  /** Judgments on this program (probes and judge, when on): wrong verdicts as leads for the reviewer, never repairs. */
  leads?: (program: ProgramRef, cycle: string) => Promise<Lead[]>
  /** The store's writers: calls and guards are kept as they happen, so an interrupted round loses nothing it spent. */
  record: { review: (r: ReviewCallRecord) => Promise<void>; formalize: (calls: FormalizeCallRecord[]) => Promise<void>; guards: (born: GuardRecord[], events: GuardEvent[]) => Promise<void> }
  /** Items the work order carried in (their checks run every cycle); `quiet`: items listed only, at the output they were stuck at. */
  carried?: readonly CarriedItem[]
  quiet?: ReadonlyMap<string, string>
  time?: (stage: string, startedAt: number, endedAt: number) => void
  onProgress?: (record: ExecutionRecord) => void
  checkTimeoutMs?: number
}

const zero = (): TokenUsage => ({ input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 })
const plus = (a: TokenUsage, b: TokenUsage): TokenUsage => ({ input_tokens: a.input_tokens + b.input_tokens, cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens, cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens, output_tokens: a.output_tokens + b.output_tokens, reasoning_tokens: a.reasoning_tokens + b.reasoning_tokens })
const clip = (s: string, n: number) => s.length > n ? `${s.slice(0, n)}…` : s

class CallTimeout extends Error {}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try { return await Promise.race([p, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new CallTimeout(`no answer in ${ms} ms`)), ms) })]) } finally { clearTimeout(timer) }
}

/** The message after a failed trial in the target environment. */
export function trialMessage(build: BuildResult, trial: { ok: boolean; output: string } | null): string {
  if (!build.ok) return `The program does not build:\n${clip(build.output.trim(), 3000)}\nFix it.`
  return `In the target environment, \`go build ./...\` and \`go test ./...\` gave:\n${clip((trial?.output ?? "").trim(), 3000)}\nFix it.`
}

/** A guard's failure as an item of the list the executor gets: the requirement, the command and input, what the program did. */
export function renderGuardItem(g: GuardRecord, check: CheckRecord, run: CheckRun, registry: Registry, carried = false): string {
  const units = g.units.map(u => registry.block(u)?.text.trim()).filter((t): t is string => !!t)
  const failed = run.assertions.filter(a => !a.ok).map(a => { const x = check.assertions.find(y => y.id === a.id)!; return `${placeName(x.target)}: expected ${JSON.stringify(x.expect)}, got ${JSON.stringify(a.actual)}` })
  return [
    `A check that passed on ${carried ? "an earlier" : "the previous"} version of the program fails now (${g.id}).`,
    `Requirement: ${units.map(t => JSON.stringify(clip(t, 400))).join(" ")}`,
    `Command: ${JSON.stringify(check.input.args)}; input files: ${check.input.files.map(f => `${f.path} = ${JSON.stringify(clip(f.content, 600))}`).join(", ") || "none"}.`,
    `What the program did: exit ${run.exit_code}; ${failed.join("; ")}${run.stderr_head.trim() ? `; stderr: ${JSON.stringify(clip(run.stderr_head.trim(), 300))}` : ""}.`,
  ].join("\n")
}

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
  const library = deps.library
  const guarded = new Set(guards.filter(g => g.source === "library").map(g => g.check!))
  const note = async (born: GuardRecord[], evs: GuardEvent[]) => { guards.push(...born); events.push(...evs); for (const e of evs) status.set(e.guard, e.status); for (const g of born) if (g.check) guarded.add(g.check); await deps.record.guards(born, evs) }
  // Items of the ledger this round: carried in, guard regressions, review items.
  const carried = new Map((deps.carried ?? []).map(c => [c.id, c]))
  if (carried.size) record.carried_in = [...carried.values()].map(c => ({ id: c.id, digest: c.digest ?? "" }))
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
  let sentInRepair: string[] = []
  let voidedNote = ""
  const timed = async <T>(stage: string, f: () => Promise<T>): Promise<T> => { const a = Date.now(); try { return await f() } finally { deps.time?.(stage, a, Date.now()) } }

  /** One review on `at`: a fresh copy and session; void when the program never ran, then done again once. */
  const review = async (at: { cycle: string; commit: string; program: ProgramRef }, focus: ReviewFocus, n: number) => {
    let attempts = 0
    for (;;) {
      if (reviewSessions >= reviewsMax * 2) return null
      attempts++
      reviewSessions++
      const label = `R${round}-review${n}-${attempts}`
      const dir = copyProgram(workdir, at.commit, deps.copyDir(label))
      const request = reviewRequest(deps.sources.filter(s => s.round <= round), focus)
      let out: Awaited<ReturnType<Reviewer["review"]>> | null = null, error: string | undefined
      try { out = await timed("review", () => withTimeout(deps.reviewer.review(dir, request, label), limits.callTimeoutMs)) } catch (e) {
        if (!(e instanceof SessionBroken) && !(e instanceof CallTimeout)) { discardCopy(dir); throw e }
        error = (e as Error).message
      }
      discardCopy(dir)
      const valid = !!out && reviewRanProgram(out.runs)
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
    if (build.ok && deps.trial) { accept.trial.runs++; trial = await timed("trial", () => deps.trial!(workdir, id)); if (!trial.ok) accept.trial.failures++ }
    const ok = build.ok && (trial?.ok ?? true)
    const commit = commitStep(workdir, `${id} ${kind}`, [["IC-Round", String(round)], ["IC-Cycle", id], ["IC-Session", session.id], ...task.map(o => ["IC-Object", `${o}@v${registry.objects.get(o)!.version}`] as [string, string]), ...(changed.length ? [["IC-Anchors", changed.join(", ")] as [string, string]] : []), ["IC-Build", build.ok ? "ok" : "failed"], ["IC-Trial", trial ? (trial.ok ? "ok" : "failed") : "none"]])
    lastCommit = commit
    const cycle: CycleRecord = { id, round, session: session.id, message: kind, commit, build: { ok: build.ok, output: build.ok ? "" : clip(build.output, 4000) }, runs: [], failing: [], contests: [], corrections: [], ambiguous: [], broke: [], anchors: changed, note: clip(reply.note, 4000), usage: reply.usage, items: [], ...(trial ? { trial: { ok: trial.ok, output: trial.ok ? "" : clip(trial.output, 4000) } } : {}) }
    const items: ItemSighting[] = cycle.items!
    if (!ok) {
      record.cycles.push(cycle)
      deps.onProgress?.(record)
      if (trialFixes >= trialMax) { record.status = "trial_spent"; break }
      trialFixes++
      message = trialMessage(build, trial)
      kind = "trial"
      continue
    }
    current = { cycle: id, commit, program: build.program! }
    record.first_delivery ??= { cycle: id, commit }
    // 1. Every guard, in one batch; library checks not yet guards in another: the ones that pass are born as guards.
    const statusBefore = new Map(status)
    const guardRuns = await timed("guard rerun", () => runGuards(live(), library, current!.program, deps.runner, round, registry, deps.facts, timeout))
    const unguarded = activeChecks(library, deps.events).filter(c => !guarded.has(c.id))
    const libRuns = unguarded.length ? await timed("guard rerun", () => runChecks(unguarded, current!.program, deps.runner, round, registry, deps.facts, timeout)) : []
    cycle.runs = [...guardRuns.map(r => ({ check: r.guard, outcome: r.run.outcome, failure: r.run.failure ? `${r.run.failure.class}/${r.run.failure.reason}` : null })), ...libRuns.map(r => ({ check: r.check, outcome: r.outcome, failure: r.failure ? `${r.failure.class}/${r.failure.reason}` : null }))]
    const flipped = guardRuns.filter(r => r.outcome === "fail" && statusBefore.get(r.guard) === "passing").map(r => r.guard)
    const born: GuardRecord[] = [], evs: GuardEvent[] = []
    for (const r of libRuns.filter(x => x.outcome === "pass")) {
      const k = unguarded.find(c => c.id === r.check)!
      const g: GuardRecord = { id: `G${nextGuard++}`, round, source: "library", check: k.id, units: [...k.blocks], object: k.object, born: { cycle: id, program: current.program.id } }
      born.push(g)
      evs.push({ guard: g.id, round, cycle: id, status: "passing", program: current.program.id })
    }
    // 2. A repair that made a passing guard fail is reverted, and the leads it answered are dropped (§12i item 4).
    if (kind === "repair" && flipped.length && good) {
      const revertedAt = Date.now()
      resetTo(workdir, good.commit)
      deps.time?.("revert", revertedAt, Date.now())
      lastCommit = good.commit
      cycle.reverted = { to: good.commit, guards: flipped, discarded: sentInRepair }
      accept.reverted++
      for (const sid of sentInRepair) { items.push({ id: sid, digest: "", verdict: "discarded", action: "discarded", why: `the repair made ${flipped.join(", ")} fail; reverted` }); itemChecks.delete(sid) }
      voidedNote = `Your previous change was reverted by the controller: it made ${flipped.join(", ")} fail, which passed before. The work tree is back at the state before that change.`
      cycle.guards = { run: guardRuns.length, passed: guardRuns.filter(r => r.outcome === "pass").length, failed: guardRuns.filter(r => r.outcome === "fail").length, unknown: guardRuns.filter(r => r.outcome === "unknown").length, flipped, born: [] }
      sentInRepair = []
      current = good
    } else {
      // 3. Flips: this round's text changed behind the guard, or not (§12i item 6); fixed guards pass again.
      const regressions: { g: GuardRecord; run: CheckRun }[] = []
      for (const r of guardRuns) {
        const g = guards.find(x => x.id === r.guard)!
        if (r.outcome === "pass" && statusBefore.get(g.id) !== "passing") { evs.push({ guard: g.id, round, cycle: id, status: "passing", program: current.program.id }); items.push({ id: g.id, digest: runDigest(r.run), verdict: "pass", action: "none" }); itemChecks.delete(g.id) }
        if (r.outcome !== "fail") continue
        if (flipped.includes(g.id)) {
          const behind = changedTextBehind(registry, g, library, round, g.check)
          evs.push({ guard: g.id, round, cycle: id, status: "failing", program: current.program.id, ...(behind.length ? { changed_text: behind } : {}) })
          if (behind.length) { accept.guards.flipped_changed_text.push(g.id); asked.delete(g.id) } else { accept.guards.flipped_unchanged.push(g.id); regressions.push({ g, run: r.run }) }
          continue
        }
        // Failing already: awaiting the reviewer's word when this round's text stands behind it, a regression otherwise.
        const last = [...events].reverse().find(e => e.guard === g.id && e.status === "failing")
        if (last?.changed_text?.length) continue
        regressions.push({ g, run: r.run })
      }
      await note(born, evs)
      accept.guards.born.push(...born.map(g => g.id))
      cycle.guards = { run: guardRuns.length, passed: guardRuns.filter(r => r.outcome === "pass").length, failed: guardRuns.filter(r => r.outcome === "fail").length, unknown: guardRuns.filter(r => r.outcome === "unknown").length, flipped, born: born.map(g => g.id) }
      for (const { g, run } of regressions) {
        const d = runDigest(run)
        const plan = sends.plan(g.id, d)
        items.push({ id: g.id, digest: d, verdict: "not_landed", ...plan })
        itemChecks.set(g.id, { text: renderGuardItem(g, guardCheck(g, library), run, registry, carried.has(g.id)), record: guardCheck(g, library) })
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
    }
    // 5. The review, when one may still lead to a repair and the last one found something (§12i item 1).
    const canReview = reviews < reviewsMax && lastReviewFound && repairs < limits.repairCycles
    if (canReview) {
      const n2 = reviews + 1
      const program = current.program
      // Leads: library checks failing that never passed, and judgments (when on), each once per round at an output.
      const leads: ReviewFocus["leads"] = []
      // After a revert the library ran on the reverted program: its failures are no leads for a review of the kept one.
      for (const r of (cycle.reverted ? [] : libRuns).filter(x => x.outcome === "fail" && x.failure?.reason !== "timeout")) {
        const d = runDigest(r)
        if (leadsGiven.get(r.check) === d) continue
        leadsGiven.set(r.check, d)
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
          guardFailures.push({ id: g.id, args: check.input.args, files: check.input.files, expected: failed.map(a => { const x = check.assertions.find(y => y.id === a.id)!; return `${placeName(x.target)} = ${JSON.stringify(x.expect)}` }).join(", ") || "(all assertions)", got: failed.map(a => JSON.stringify(a.actual)).join(", ") || `exit ${run.exit_code}`, changed: [...events].reverse().find(e => e.guard === g.id)!.changed_text ?? [], was: q.old, now: q.now })
        })
      }
      const revised = registry.objects.size ? [...registry.objects.values()].flatMap(o => o.blocks.flatMap(b => b.modifications.filter(m => m.round === round).flatMap(m => m.parts.map(p => ({ id: p, text: `${registry.block(p)?.text.trim() ?? ""} (${m.kind === "withdraw" ? "withdrawn" : m.kind === "partial" ? "partly revised" : "replaced"} by ${m.by.join(", ")} in round ${round})` }))))) : []
      const focus: ReviewFocus = { round, units: round === 1 ? [] : dedupe(revised), guardFailures, leads }
      const r = await review(current, focus, n2)
      reviews++
      const summary = { n: n2, cycle: current.cycle, attempts: r?.attempts ?? 0, valid: !!r?.out, no_issues: !!r?.out && isNoIssues(r.out.text), reported: 0, malformed: 0, blocked: 0, sent: 0, superseded: [] as string[], leads: leads.length }
      for (const g of questions) asked.add(g.id)
      const survivors: { id: string; text: string }[] = []
      if (r?.out) {
        // SUPERSEDED lines retire guards; a questioned guard not superseded is a regression from here on.
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
          itemChecks.set(g.id, { text: renderGuardItem(g, guardCheck(g, library), run, registry), record: guardCheck(g, library) })
        }
        if (!isNoIssues(r.out.text)) {
          // The list as checks (one model call), then the premises and the reproduction, by code.
          const f = await timed("formalize", () => formalizeReview(registry, round, r.out!.text, deps.binary, deps.formalize, { reviewId: `R${round}.${n2}`, callId: k => `F${round}.${n2}.${k}` }))
          await deps.record.formalize(f.calls)
          if (f.unavailable) throw new RoleUnavailable("formalize", f.unavailable, f.calls)
          summary.reported = f.items.length + f.malformed.filter(m => m.item !== null).length
          summary.malformed = f.malformed.length
          if (!f.items.length && f.malformed.length === 0 && listEntries(r.out.text) > 0) summary.reported = listEntries(r.out.text)
          for (const m of f.malformed) { accept.premise_blocked.malformed = (accept.premise_blocked.malformed ?? 0) + 1; items.push({ id: `V${round}.${n2}.${m.item ?? 0}`, digest: "", verdict: "malformed", action: "blocked", why: m.message }) }
          await timed("premise checks", async () => {
            for (const it of f.items) {
              let vid = `V${round}.${n2}.${it.item}`
              const rec: ReviewItemRecord = { id: vid, round, review: `R${round}.${n2}`, item: it.item, text: it.text, units: it.units, premise: null }
              record.review_items!.push(rec)
              const p = await checkPremises(registry, round, it, deps.sandbox, timeout)
              let failure: { premise: Premise; detail: string } | null = p.ok ? null : p.failure
              let checkRecord: CheckRecord | null = null
              if (p.ok) {
                checkRecord = itemCheckRecord(vid, round, it, p.check)
                // The same deviation reported again (same units, same call) is the item it was: the ledger goes on with it.
                const key = keyOf(checkRecord)
                const prior = [...itemChecks.entries()].find(([k, x]) => !k.startsWith("G") && x.key === key)
                if (prior) { rec.same_as = prior[0]; vid = prior[0]; checkRecord = { ...checkRecord, id: vid } }
                const rep = await reproduces(checkRecord, program, deps.runner, round, registry, deps.facts, timeout)
                if (!rep.reproduced) failure = { premise: "not_reproduced", detail: `the check passes on the program as it stands (exit ${rep.run.exit_code})` }
                else if (items.some(i => i.id === vid)) { /* seen in this cycle already (a carried item reported again): one sighting */ }
                else {
                  const d = runDigest(rep.run)
                  rec.check = p.check
                  itemChecks.set(vid, { text: it.text, record: checkRecord, item: prior?.[1].item ?? rec, key })
                  const plan = sends.plan(vid, d)
                  items.push({ id: vid, digest: d, verdict: "wrong", ...plan })
                  if (plan.action === "send") survivors.push({ id: vid, text: it.text })
                }
              }
              if (failure) {
                rec.premise = failure.premise
                rec.detail = failure.detail
                accept.premise_blocked[failure.premise] = (accept.premise_blocked[failure.premise] ?? 0) + 1
                items.push({ id: rec.id, digest: "", verdict: "blocked", action: "blocked", why: `${failure.premise}: ${failure.detail}` })
              }
            }
          })
          summary.blocked = f.items.filter(it => record.review_items!.find(x => x.id === `V${round}.${n2}.${it.item}`)?.premise).length
        }
      }
      summary.sent = survivors.length
      lastReviewFound = survivors.length > 0
      accept.reviews.push(summary)
      cycle.review = { n: summary.n, attempts: summary.attempts, valid: summary.valid, no_issues: summary.no_issues, reported: summary.reported, malformed: summary.malformed, blocked: summary.blocked, sent: summary.sent, superseded: summary.superseded, leads: summary.leads }
    }
    // 6. What goes back to the executor: items the plan sends (regressions, review items, carried items not yet fixed).
    for (const i of items) if (i.action === "send" || i.action === "hold") sends.mark(i.id, i.digest, { action: i.action, ...(i.why ? { why: i.why } : {}) })
    const toSend = items.filter(i => i.action === "send").map(i => ({ id: i.id, text: itemChecks.get(i.id)?.text ?? i.id }))
    cycle.failing = items.filter(i => i.verdict === "not_landed").map(i => i.id)
    cycle.corrections = items.filter(i => i.verdict === "wrong").map(i => i.id)
    const held = items.filter(i => i.action === "hold").map(i => i.id)
    if (held.length) cycle.held = held
    record.cycles.push(cycle)
    if (!cycle.reverted) good = current
    deps.onProgress?.(record)
    if (!toSend.length) break
    if (repairs >= limits.repairCycles) { record.status = "cycles_spent"; break }
    repairs++
    sentInRepair = toSend.map(t => t.id)
    const list = renderReviewList(toSend)
    evidence = list
    message = repairFromReview(list, voidedNote ? [voidedNote] : [])
    voidedNote = ""
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
  record.head = head(workdir)
  return record
}

function dedupe<T extends { id: string }>(list: T[]): T[] { return [...new Map(list.map(x => [x.id, x])).values()] }

/** Rule-bearing units of this round's text (for the report's focus count). */
export function roundUnits(registry: Registry, round: number): string[] { return coverage(registry, round, EMPTY_CHECKS, [], []).units }
