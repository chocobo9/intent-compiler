import { diffAnchors, touched, type Anchor, type AnchorExtractor } from "./anchors.js"
import type { TokenUsage } from "./attribution.js"
import { activeChecks, type CheckEvent, type CheckRecord, type CodeFacts } from "./checks.js"
import { commitStep, head, readTrailers, resetTo } from "./git.js"
import type { Registry } from "./registry.js"
import type { CheckRunner, ProgramRef } from "./runner.js"
import { runCheck, type CheckRun } from "./verdict.js"
import { objectAnchors, type AnchorLink, type WorkOrder } from "./workorder.js"

/**
 * The execution layer (DESIGN §7). The executor proposes steps within the task zone; the code checks their shape,
 * then lets the executor work one step at a time. After each step the code builds, works out which anchors changed,
 * checks the declared coverage against them, and runs the relevant checks. A good step is committed with IC trailers
 * (the only part of a commit the code reads). A bad step is sent back to the same session; when the session breaks,
 * the work tree goes back to the last good checkpoint and a new session gets only the remaining steps. Budgets and
 * timeouts are per step; what is left undone goes to the next round's task zone.
 */

export interface StepProposal {
  /** The executor's label; the code assigns the step id. */
  label: string
  objects: { object: string; coverage: "full" | "partial" }[]
  summary: string
}

export interface ApprovedStep extends StepProposal { id: string; round: number }

export interface ExecutorContext {
  round: number
  workdir: string
  workorder: WorkOrder
  /** The rendered work order (the executor's reading). */
  text: string
  /** A new session after a broken one: the steps already done and those left. */
  resume: { done: string[]; remaining: ApprovedStep[] } | null
}

export interface ExecutorSession {
  readonly id: string
  propose(feedback: string[]): Promise<{ steps: StepProposal[]; usage: TokenUsage }>
  /** Edits the work tree for one step (no commit). `feedback` lists what failed on the previous attempt. */
  work(step: ApprovedStep, feedback: string[]): Promise<{ usage: TokenUsage; note: string }>
  close(): Promise<void>
}

export interface Executor { open(context: ExecutorContext): Promise<ExecutorSession> }

/** Thrown by an executor whose session can no longer go on (crashed, hung, lost its context). */
export class SessionBroken extends Error {}

export interface ExecutionLimits {
  maxSteps: number
  maxObjectsPerStep: number
  maxProposals: number
  maxAttemptsPerStep: number
  maxSessions: number
  stepTimeoutMs: number
  /** Step attempts over the whole round; when spent, the rest is carried. */
  roundAttempts: number
}

export const DEFAULT_LIMITS: ExecutionLimits = { maxSteps: 12, maxObjectsPerStep: 6, maxProposals: 3, maxAttemptsPerStep: 3, maxSessions: 3, stepTimeoutMs: 20 * 60_000, roundAttempts: 30 }

export interface BuildResult { ok: boolean; output: string; program: ProgramRef | null }

export interface ExecutionDeps {
  registry: Registry
  library: readonly CheckRecord[]
  events: readonly CheckEvent[]
  links: readonly AnchorLink[]
  anchors: AnchorExtractor
  build: (workdir: string, label: string) => BuildResult
  runner: CheckRunner
  facts: CodeFacts
  /** Checks that passed on the program at the start of the round (its verdict run). */
  passing?: readonly string[]
  checkTimeoutMs?: number
}

export interface StepRecord {
  id: string
  round: number
  label: string
  objects: { object: string; coverage: "full" | "partial" }[]
  status: "committed" | "failed" | "carried"
  attempts: number
  sessions: string[]
  checkpoint: string
  commit: string | null
  anchors: string[]
  checks: { check: string; outcome: CheckRun["outcome"]; failure: string | null }[]
  problems: string[]
  notes: string[]
  usage: TokenUsage
}

export interface ExecutionRecord {
  round: number
  base: string
  head: string
  status: "done" | "plan_rejected" | "budget_spent" | "sessions_spent"
  proposals: { session: string; steps: StepProposal[]; problems: string[] }[]
  sessions: { id: string; opened_for: string; closed: "normally" | "broken" }[]
  steps: StepRecord[]
  /** Task objects no committed step fully covered: the next round's task zone carries them. */
  carried: string[]
  links: AnchorLink[]
  usage: TokenUsage
}

const zero = (): TokenUsage => ({ input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 })
const plus = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  input_tokens: a.input_tokens + b.input_tokens, cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens, cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens,
  output_tokens: a.output_tokens + b.output_tokens, reasoning_tokens: a.reasoning_tokens + b.reasoning_tokens,
})

/** Shape only: limits, objects inside the task zone, and every partly covered object later covered in full. */
export function planProblems(steps: readonly StepProposal[], task: readonly string[], limits: ExecutionLimits): string[] {
  const problems: string[] = []
  const inTask = new Set(task)
  if (!steps.length) problems.push("the plan has no steps")
  if (steps.length > limits.maxSteps) problems.push(`the plan has ${steps.length} steps; at most ${limits.maxSteps}`)
  steps.forEach((s, i) => {
    const w = `step ${i + 1} (${s.label})`
    if (!s.objects.length) problems.push(`${w}: names no object`)
    if (s.objects.length > limits.maxObjectsPerStep) problems.push(`${w}: covers ${s.objects.length} objects; at most ${limits.maxObjectsPerStep}`)
    const ids = s.objects.map(o => o.object)
    if (new Set(ids).size !== ids.length) problems.push(`${w}: names an object twice`)
    for (const o of s.objects) {
      if (!inTask.has(o.object)) problems.push(`${w}: ${o.object} is not in the task zone`)
      if (o.coverage !== "full" && o.coverage !== "partial") problems.push(`${w}: coverage of ${o.object} must be full or partial`)
      if (o.coverage === "partial" && !steps.slice(i + 1).some(t => t.objects.some(x => x.object === o.object && x.coverage === "full"))) {
        problems.push(`${w}: ${o.object} is covered in part, and no later step covers it in full`)
      }
    }
  })
  return problems
}

class StepTimeout extends Error {}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([p, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new StepTimeout(`no answer in ${ms} ms`)), ms) })])
  } finally { clearTimeout(timer) }
}

export async function executeRound(workdir: string, workorder: WorkOrder, text: string, executor: Executor, deps: ExecutionDeps, limits: ExecutionLimits = DEFAULT_LIMITS): Promise<ExecutionRecord> {
  const round = workorder.round
  const task = workorder.task.map(t => t.object)
  const record: ExecutionRecord = { round, base: head(workdir), head: "", status: "done", proposals: [], sessions: [], steps: [], carried: [], links: [], usage: zero() }
  const links = [...deps.links]
  // What protection guards: checks passing at the last good checkpoint (start of round, then after each kept step).
  const passing = new Set(deps.passing ?? [])
  let session = await executor.open({ round, workdir, workorder, text, resume: null })
  record.sessions.push({ id: session.id, opened_for: "plan", closed: "normally" })

  // 1. The plan, re-proposed with the problems until its shape holds.
  let approved: ApprovedStep[] | null = null
  let feedback: string[] = []
  for (let n = 0; n < limits.maxProposals && !approved; n++) {
    const p = await session.propose(feedback)
    record.usage = plus(record.usage, p.usage)
    const problems = planProblems(p.steps, task, limits)
    record.proposals.push({ session: session.id, steps: p.steps, problems })
    if (!problems.length) approved = p.steps.map((s, i) => ({ ...s, id: `P${round}.${i + 1}`, round }))
    feedback = problems
  }
  if (!approved) {
    await session.close()
    record.status = "plan_rejected"
    record.carried = task
    record.head = head(workdir)
    return record
  }

  // 2. The steps, one by one.
  let attemptsLeft = limits.roundAttempts
  let sessionsLeft = limits.maxSessions - 1
  for (const [index, step] of approved.entries()) {
    const checkpoint = head(workdir)
    const rec: StepRecord = { id: step.id, round, label: step.label, objects: step.objects, status: "carried", attempts: 0, sessions: [], checkpoint, commit: null, anchors: [], checks: [], problems: [], notes: [], usage: zero() }
    record.steps.push(rec)
    if (record.status !== "done") continue
    const before = deps.anchors.extract(workdir)
    let stepFeedback: string[] = []
    while (rec.attempts < limits.maxAttemptsPerStep) {
      if (attemptsLeft <= 0) { record.status = "budget_spent"; break }
      attemptsLeft--
      rec.attempts++
      if (!rec.sessions.includes(session.id)) rec.sessions.push(session.id)
      try {
        const r = await withTimeout(session.work(step, stepFeedback), limits.stepTimeoutMs)
        rec.usage = plus(rec.usage, r.usage)
        rec.notes.push(r.note)
      } catch (e) {
        if (!(e instanceof SessionBroken) && !(e instanceof StepTimeout)) throw e
        // The session is gone: back to the last good checkpoint, and a new session for the steps left.
        rec.problems.push(`attempt ${rec.attempts}: session ${session.id} broke (${(e as Error).message})`)
        record.sessions.find(s => s.id === session.id)!.closed = "broken"
        resetTo(workdir, checkpoint)
        if (sessionsLeft <= 0) { record.status = "sessions_spent"; break }
        sessionsLeft--
        session = await executor.open({ round, workdir, workorder, text, resume: { done: record.steps.filter(s => s.status === "committed").map(s => s.id), remaining: approved.slice(index) } })
        record.sessions.push({ id: session.id, opened_for: step.id, closed: "normally" })
        stepFeedback = []
        continue
      }
      const verdict = await verifyStep(workdir, step, before, deps, links, passing)
      rec.checks = verdict.checks
      rec.anchors = verdict.touched
      if (!verdict.problems.length) {
        const trailers: [string, string][] = [
          ["IC-Round", String(round)], ["IC-Step", step.id], ["IC-Session", session.id],
          ...step.objects.map(o => ["IC-Object", `${o.object}@v${deps.registry.objects.get(o.object)!.version} ${o.coverage}`] as [string, string]),
          ...(verdict.touched.length ? [["IC-Anchors", verdict.touched.join(", ")] as [string, string]] : []),
          ...verdict.checks.map(c => ["IC-Checks", `${c.check} ${c.outcome}`] as [string, string]),
        ]
        rec.commit = commitStep(workdir, step.summary, trailers)
        rec.status = "committed"
        for (const c of verdict.checks) { if (c.outcome === "pass") passing.add(c.check); else passing.delete(c.check) }
        for (const o of step.objects) for (const a of verdict.touched) if (!a.includes(":file:")) links.push({ object: o.object, anchor: a, round, via: "step", step: step.id })
        break
      }
      rec.problems.push(...verdict.problems.map(p => `attempt ${rec.attempts}: ${p}`))
      stepFeedback = verdict.problems
    }
    if (rec.status !== "committed") {
      // Keep nothing of a failed step: the tree goes back to the last good checkpoint.
      resetTo(workdir, checkpoint)
      if (rec.attempts > 0 && record.status === "done") rec.status = "failed"
    }
  }
  await session.close()
  const fullyDone = new Set(record.steps.filter(s => s.status === "committed").flatMap(s => s.objects.filter(o => o.coverage === "full").map(o => o.object)))
  record.carried = task.filter(o => !fullyDone.has(o))
  record.links = links.slice(deps.links.length)
  record.head = head(workdir)
  return record
}

/**
 * Build, anchor coverage, and the relevant checks: those of the objects the step covers in full must hold; checks of
 * objects whose anchors the step touched without declaring them are protection, and must keep holding if they held.
 */
export async function verifyStep(workdir: string, step: ApprovedStep, before: readonly Anchor[], deps: ExecutionDeps, links: readonly AnchorLink[], passing: ReadonlySet<string> = new Set()): Promise<{ problems: string[]; touched: string[]; checks: StepRecord["checks"] }> {
  const problems: string[] = []
  const build = deps.build(workdir, step.id)
  if (!build.ok) return { problems: [`build failed: ${build.output.trim().slice(0, 600)}`], touched: [], checks: [] }
  const after = deps.anchors.extract(workdir)
  const changed = touched(diffAnchors(before, after))
  const declared = new Set(step.objects.map(o => o.object))
  for (const o of step.objects) {
    const known = [...objectAnchors(deps.registry, before, links, o.object), ...objectAnchors(deps.registry, after, links, o.object)].map(a => a.id)
    // An object with anchors must have one of them touched; an object without any yet, some anchor at all.
    const hit = known.length ? changed.some(a => known.includes(a)) : changed.length > 0
    if (!hit) problems.push(`${o.object} (${deps.registry.objects.get(o.object)!.name}) is declared ${o.coverage}, but none of its anchors changed${known.length ? ` (${known.join(", ")})` : ""}`)
  }
  // Anchors of objects this step did not declare: run those objects' checks as protection.
  const others = new Set<string>()
  for (const id of deps.registry.objects.keys()) {
    if (declared.has(id)) continue
    const own = objectAnchors(deps.registry, before, links, id).map(a => a.id)
    if (own.some(a => changed.includes(a))) others.add(id)
  }
  const active = activeChecks(deps.library, deps.events)
  // A partly covered object is not finished yet: its own checks wait for the step that covers it in full.
  const full = new Set(step.objects.filter(o => o.coverage === "full").map(o => o.object))
  const relevant = active.filter(c => full.has(c.object) || others.has(c.object) || c.uses.some(u => others.has(u)))
  const checks: StepRecord["checks"] = []
  for (const c of relevant) {
    const run = await runCheck(c, build.program!, deps.runner, step.round, deps.registry, deps.facts, deps.checkTimeoutMs ?? 10_000)
    checks.push({ check: c.id, outcome: run.outcome, failure: run.failure ? `${run.failure.class}/${run.failure.reason}` : null })
    // Only a failure judged not landed is evidence against the step; unknown-class failures are recorded only.
    // Protection guards what passed before: a check of an unfinished object that never passed is no regression.
    const guarded = full.has(c.object) || passing.has(c.id)
    if (guarded && run.outcome === "fail" && run.failure?.class === "not_landed") problems.push(`${c.id} (${others.has(c.object) ? "protection of " : ""}${deps.registry.objects.get(c.object)!.name}) fails: ${run.failure.reason}, ${run.failure.detail}`)
  }
  return { problems, touched: changed, checks }
}

/** Reads back what the code committed, from the trailers alone. */
export function stepsFromHistory(workdir: string, commits: readonly string[]): { commit: string; round: number; step: string; objects: string[]; anchors: string[]; checks: string[] }[] {
  return commits.map(commit => {
    const t = readTrailers(workdir, commit)
    return { commit, round: Number(t["IC-Round"]?.[0]), step: t["IC-Step"]?.[0] ?? "", objects: t["IC-Object"] ?? [], anchors: (t["IC-Anchors"]?.[0] ?? "").split(", ").filter(Boolean), checks: t["IC-Checks"] ?? [] }
  })
}
