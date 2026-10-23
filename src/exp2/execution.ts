import { diffAnchors, touched, type Anchor, type AnchorExtractor } from "./anchors.js"
import type { TokenUsage } from "./attribution.js"
import { activeChecks, type CheckEvent, type CheckRecord, type CodeFacts } from "./checks.js"
import { commitStep, head, readTrailers, resetTo } from "./git.js"
import type { Registry } from "./registry.js"
import type { CheckRunner, ProgramRef } from "./runner.js"
import { runChecks, runDigest, type CheckRun, type DisputeKind } from "./verdict.js"
import type { AnchorLink, WorkOrder } from "./workorder.js"
import { pairKey, renderCorrections, type CorrectionItem, type Finding } from "./judge.js"
import { changeScope, coveredFunctions, selectRuns, type Candidate, type SelectReason } from "./coverage.js"

/**
 * The execution layer (DESIGN §7 as changed by BLOCK9 §2.4). One session gets the round's work order and does it.
 * When it replies, the code builds the program, runs the whole check library, and commits a checkpoint (one commit
 * per cycle, with IC trailers, the only part of a commit the code reads). While a task object is not landed by the
 * checks, or a check that passed at the start of the round fails, the failures go back to the same session as
 * evidence. Completion is decided by the checks, never by what the session says. The session may contest a check
 * with a basis in the text; a ruling settles it. When the cycles run out, the tree goes back to the cycle with the
 * fewest failures, and what is still not landed is carried into the next round.
 */

export interface ExecutorContext {
  round: number
  workdir: string
  workorder: WorkOrder
  /** The rendered work order (the executor's reading). */
  text: string
  /** A new session after a broken one: what the checks said at the last checkpoint. */
  resume: { evidence: string } | null
}

export interface ExecutorReply { usage: TokenUsage; note: string }

export interface ExecutorSession {
  readonly id: string
  /** One message to the session; it edits the work tree (no commit) and replies. */
  send(message: string): Promise<ExecutorReply>
  close(): Promise<void>
}

export interface Executor { open(context: ExecutorContext): Promise<ExecutorSession> }

/** Thrown by an executor whose session can no longer go on (crashed, hung, lost its context). */
export class SessionBroken extends Error {}

export interface ExecutionLimits {
  /** Messages with failure evidence after the first, within one round. */
  repairCycles: number
  maxSessions: number
  /** The watchdog on one message to the session. */
  callTimeoutMs: number
}

export const DEFAULT_LIMITS: ExecutionLimits = { repairCycles: 3, maxSessions: 3, callTimeoutMs: 40 * 60_000 }

export interface BuildResult { ok: boolean; output: string; program: ProgramRef | null }

/** What a detection run covers (DESIGN §12h E4). */
export interface DetectScope {
  /** The probes to run, by id; null: every active probe. */
  probes: ReadonlySet<string> | null
  /** The round's full run before delivery: a changed output is judged only where a regression is suspected. */
  full?: boolean
}

/** A probe's run as the selection keeps it: the output's digest, and the coverage profile where the program records it. */
export interface DetectedRun { probe: string; digest: string; coverage?: string }

export interface ExecutionDeps {
  registry: Registry
  library: readonly CheckRecord[]
  events: readonly CheckEvent[]
  links: readonly AnchorLink[]
  anchors: AnchorExtractor
  build: (workdir: string, label: string) => BuildResult
  runner: CheckRunner
  facts: CodeFacts
  /** Checks that passed on the program at the start of the round (its verdict run): a failure of one is a regression. */
  passing?: readonly string[]
  /** The kinds of dispute a ruling upheld a check against. */
  upheld?: (check: string) => ReadonlySet<DisputeKind>
  /** Rules on disputes (evidence code saw, or a contest); absent offline, disputed checks then just do not count. */
  settle?: (disputes: { check: string; run: CheckRun; kind: DisputeKind; detail: string }[]) => Promise<{ wrong: Set<string>; right: Set<string> }>
  /**
   * Probes and judge (BLOCK10 §1.5): runs active probes on the cycle's program, judges what changed, and returns
   * the correction items (wrong only) and all findings. `before` holds the probe/unit pairs judged ok earlier, so an
   * item that broke is marked; `contests` the objections (the executor's, and the code's own on an item a repair did
   * not change), which the independent session rules on.
   */
  detect?: {
    /**
     * Runs the probes `scope` names (all when it is absent or null) on the cycle's program in a batch and judges what
     * needs judging: a judgment is redone only where the output changed. Returns the counts and, per probe run, the
     * output's digest and coverage.
     */
    run(program: ProgramRef, before: ReadonlySet<string>, contests: ReadonlyMap<string, string>, scope?: DetectScope): Promise<{ items: CorrectionItem[]; findings: Finding[]; counts?: Partial<CheckRunCounts>; runs?: DetectedRun[] }>
    /** Pairs judged ok on the program at the start of the round. */
    passed: ReadonlySet<string>
    /** The program's name, for the calls in the correction list. */
    program: string
    /**
     * Measures, once a round on the first cycle that builds, whether the probes tell this program from mutants of
     * it, and strengthens them where they do not (BLOCK10 §7.3). Gets the anchor links known so far.
     */
    measure?: (workdir: string, program: ProgramRef, links: readonly AnchorLink[]) => Promise<CycleRecord["measure"]>
  }
  /**
   * Targeted runs (DESIGN §12h E4). With it, a cycle runs only the checks and probes on the round's changed text, the
   * ledger's open items, and those whose last run executed a function the cycle changed; before the round ends,
   * everything runs once on the program it delivers. Without it, every cycle runs everything (DESIGN §12g).
   */
  target?: {
    /** Units of the round's changed text (and the units written for again). */
    units: ReadonlySet<string>
    /** Ledger items open at the start of the round: probe/unit pairs and check ids. */
    open: ReadonlySet<string>
    /** Items the ledger lists only (no progress over rounds), with the output they were stuck at: never sent while it stays. */
    quiet?: ReadonlyMap<string, string>
    /** Items an independent ruling confirmed as the program's: sent once a round, never ruled on again, never listed only. */
    confirmed?: ReadonlySet<string>
    /** Per check or probe id: the functions its last run executed and its output's digest (the previous round's full run). */
    seen: ReadonlyMap<string, { functions?: readonly string[]; digest: string }>
    /** The active probes, once the round's are written. */
    probes: () => Promise<readonly { id: string; round: number; covers: readonly { unit: string }[] }[]>
  }
  /** Items the work order carried in from earlier rounds, with their output's digest then: they count as sent (E3). */
  carried?: ReadonlyMap<string, string>
  /** Called after every cycle with the record so far (for the record of an interrupted round). */
  onProgress?: (record: ExecutionRecord) => void
  /** Wall time of each stage (BLOCK10 §9.1): coding (the work message), repair (repair and resume messages), build. */
  time?: (stage: string, startedAt: number, endedAt: number) => void
  checkTimeoutMs?: number
}

/**
 * What a cycle ran (DESIGN §12g, §12h E4): the library checks and probes it selected, each set in one batch; and how
 * many verdicts were new because an output changed (the rest came from the cache or from code). selected: how many
 * of each were chosen for which reason.
 */
export interface CheckRunCounts { checks: number; probes: number; judged: number; cached: number; by_code: number; selected?: { checks: Partial<Record<SelectReason, number>>; probes: Partial<Record<SelectReason, number>>; all: string | null; changed_functions: number } }

/**
 * The full run before delivery (DESIGN §12h E4): every check and probe on one cycle's program. omissions: runs whose
 * output changed since they were last run although no cycle selected them (with where they were last run); found:
 * items failing in it that the cycle's targeted run had not shown.
 */
export interface SweepRecord { cycle: string; checks: number; probes: number; judged: number; cached: number; by_code: number; omissions: { id: string; since: string }[]; found: string[] }

/** An item of the ledger as a cycle saw it (DESIGN §12h E2, E3): its output's digest, the verdict, and what the cycle did. */
/** blocked: a premise did not hold (DESIGN §12i item 2); discarded: the repair it was sent in broke a guard and was reverted (item 4). */
export interface ItemSighting { id: string; digest: string; verdict: string; action: "send" | "hold" | "none" | "blocked" | "discarded"; why?: string }

export interface CycleRecord {
  id: string
  round: number
  session: string
  message: "work" | "repair" | "resume" | "trial"
  commit: string
  build: { ok: boolean; output: string }
  runs: { check: string; outcome: CheckRun["outcome"]; failure: string | null }[]
  /** Checks against the round's work: not landed on a task object, or a regression of one that passed at the start. */
  failing: string[]
  contests: { check: string; claim: string; verdict: "check_wrong" | "check_right" | "unsettled" }[]
  /** Correction items (probe/unit) the judge found wrong on this cycle's program, and pairs it found ambiguous. */
  corrections: string[]
  ambiguous: string[]
  /** Items wrong now that were judged ok earlier: a change broke them. */
  broke: string[]
  /** Failing checks and wrong items not sent again: no progress after a ruling, or none possible (DESIGN §12h E3). */
  held?: string[]
  /** The ledger's items as this cycle saw them (DESIGN §12h E2). */
  items?: ItemSighting[]
  /** Rulings this cycle asked for on items that did not change after a repair, or that the executor contested. */
  ruled?: { id: string; verdict: string; reason: string }[]
  /** What this cycle ran and how its verdicts were reached (DESIGN §12g, §12h E4). */
  probe_runs?: CheckRunCounts
  /** The guards run on this cycle's program (DESIGN §12i items 3–4): counts, flips (passing before, failing now), guards born. */
  guards?: { run: number; passed: number; failed: number; unknown: number; flipped: string[]; born: string[] }
  /** This cycle's repair was reverted: it made passing guards fail; the leads it answered were discarded (§12i item 4). */
  reverted?: { to: string; guards: string[]; discarded: string[] }
  /** The review held on this cycle's program (§12i item 1). */
  review?: Omit<ReviewSummary, "cycle">
  /** The target environment's trial (go build and go test) on this cycle's tree. */
  trial?: { ok: boolean; output: string }
  /** The full run on this cycle's program, when the cycle had nothing left to send (DESIGN §12h E4). */
  sweep?: SweepRecord
  /** The discrimination measure, on the cycle it ran on. */
  measure?: { mutants: number; killed: number; survived: number; build_failed: number; score: number | null; weak_units: string[]; strengthened: string[]; still_weak: number }
  anchors: string[]
  note: string
  usage: TokenUsage
}

export interface ExecutionRecord {
  round: number
  base: string
  head: string
  status: "done" | "cycles_spent" | "sessions_spent" | "trial_spent"
  /** The work order's task zone, so the next round can carry what was left undone. */
  task: string[]
  sessions: { id: string; opened_for: string; closed: "normally" | "broken" }[]
  cycles: CycleRecord[]
  /** The cycle whose tree the round ends on. */
  kept: string | null
  /** Task objects still not landed (or never built): the next round's task zone carries them. */
  carried: string[]
  /** Correction items still open on the kept cycle; the next round re-runs their probes and carries what stays wrong. */
  open: string[]
  links: AnchorLink[]
  usage: TokenUsage
  /** Items the work order carried in, as sent with the work message (DESIGN §12h E3). */
  carried_in?: { id: string; digest: string }[]
  /** The full run on the kept cycle's program (DESIGN §12h E4). */
  sweep?: SweepRecord
  /** Items failing on the kept cycle's program after the full run: the round's end in the ledger (DESIGN §12h E2). */
  final?: ItemSighting[]
  /** What each check and probe executed on the kept program, for the next round's selection: function ids, then by id indexes into them and the output digest. */
  coverage?: { functions: string[]; ids: Record<string, { f?: number[]; d: string }> }
  /** The first delivery: the commit before the first review (§12i), scored locally. */
  first_delivery?: { cycle: string; commit: string }
  /** The reviewer's items of this round, as the code formalized and checked them (DESIGN §12i). */
  review_items?: ReviewItemRecord[]
  /** The round's acceptance under DESIGN §12i, summarized for the report. */
  accept?: AcceptRoundRecord
}

/** One item of a review (DESIGN §12i): the reviewer's words, the units, and what the code made of it. */
export interface ReviewItemRecord {
  /** V<round>.<review>.<item>. */
  id: string
  round: number
  review: string
  item: number
  text: string
  units: string[]
  /** The premise that stopped it (a premise of the blocking tier), or null when it was sent. */
  premise: string | null
  detail?: string
  /**
   * How it went (fix block, A1/A3): sent (its premises held and its check fails on the program), logged (premises
   * outside the blocking tier failed; sent anyway, the failures kept in `logged`), fallback (code could not verify it
   * for reasons of its own: the formalizer did not write it, gave no input; sent in the reviewer's words), blocked.
   * Absent on records written before the fix block.
   */
  disposition?: "sent" | "logged" | "fallback" | "blocked"
  logged?: { premise: string; detail: string }[]
  /** The check the code built (sent items), for later runs. */
  check?: { input: import("./runner.js").CheckInput; assertions: import("./checks.js").Assertion[]; reference_script: import("./checks.js").CheckDraft["reference_script"]; object: string | null }
  /** The guard it became once the executor fixed it. */
  guard?: string
  /** The same deviation reported again (same units, same call): the earlier item's id, which the ledger keeps using. */
  same_as?: string
}

/**
 * One review's outcome. program_runs: the reviewer's runs of the program the session's tool calls show (a soft signal,
 * fix block A2); fallback: items sent in the reviewer's words because code could not verify them, and whether the whole
 * reply went (A1); logged: items sent although a premise outside the blocking tier failed (A3).
 */
export interface ReviewSummary { n: number; cycle: string; attempts: number; valid: boolean; no_issues: boolean; reported: number; malformed: number; blocked: number; sent: number; superseded: string[]; leads: number; program_runs?: number; fallback?: number; fallback_whole?: boolean; fallback_reasons?: Record<string, number>; logged?: number }

export interface AcceptRoundRecord {
  reviews: ReviewSummary[]
  /** Review sessions voided because the program never ran in them (only with acceptance.void_without_runs). */
  voided: number
  /** Items the premises stopped, by premise (the blocking tier). */
  premise_blocked: Record<string, number>
  /** Items sent although a premise outside the blocking tier failed, by premise (fix block A3). */
  premise_logged?: Record<string, number>
  /** Reviews with items sent in the reviewer's words, those items, and why code could not verify them (fix block A1). */
  fallback?: { reviews: number; whole: number; items: number; reasons: Record<string, number> }
  /** Valid reviews in whose session no run of the program was seen (fix block A2). */
  program_runs_zero?: number
  guards: { at_start: number; at_end: number; born: string[]; flipped_changed_text: string[]; flipped_unchanged: string[]; retired: { id: string; reason: string }[] }
  reverted: number
  trial: { runs: number; failures: number }
  /** Leads handed to the reviewer (library failures never confirmed, judgments), by kind. */
  leads: { library: number; judgment: number }
}

const zero = (): TokenUsage => ({ input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 })
const plus = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  input_tokens: a.input_tokens + b.input_tokens, cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens, cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens,
  output_tokens: a.output_tokens + b.output_tokens, reasoning_tokens: a.reasoning_tokens + b.reasoning_tokens,
})

/** Lower-case words of a name: camelCase, snake_case, dots and other separators split. */
export function nameWords(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean)
}

/**
 * The anchor (A:<file>:<kind>:<name>[#n]) is named for the object: its name, or its file's name without the
 * extension, holds the object's name as whole words, in order (opFilter, dispatch:filter, anything in op_filter.go).
 */
export function anchorNames(anchorId: string, objectName: string): boolean {
  const [, file = "", , ...rest] = anchorId.split(":")
  const o = nameWords(objectName)
  const holds = (w: string[]) => o.length > 0 && w.some((_, i) => o.every((x, k) => w[i + k] === x))
  return holds(nameWords(rest.join(":").replace(/#\d+$/u, ""))) || holds(nameWords(file.split("/").pop()!.replace(/\.[^.]*$/u, "")))
}

/**
 * Links what a cycle changed to the objects it worked on (DESIGN §12d item 9): an anchor named for an object goes
 * to that object; one reported for an object goes to it when it did change; the rest are shared by the objects.
 * File anchors are never linked. Returns the links and the reported anchors that did not change.
 */
export function linkStepAnchors(unit: { id: string; objects: readonly { object: string }[] }, changedIds: readonly string[], report: { object: string; anchors: string[] }[] | undefined, names: (object: string) => string, round: number): { links: AnchorLink[]; unverified: string[] } {
  const changed = changedIds.filter(a => !a.includes(":file:"))
  const bare = (a: string) => a.split(":").slice(3).join(":").replace(/#\d+$/u, "")
  const matches = (a: string, r: string) => a === r || bare(a) === r || bare(a).split(".").pop() === r
  const links: AnchorLink[] = [], owned = new Set<string>(), unverified: string[] = []
  for (const o of unit.objects) {
    const reported = (report ?? []).filter(r => r.object === o.object).flatMap(r => r.anchors)
    for (const r of reported) if (!changed.some(a => matches(a, r))) unverified.push(`${o.object}: ${r}`)
    for (const a of changed) {
      const named = anchorNames(a, names(o.object))
      if (!named && !reported.some(r => matches(a, r))) continue
      links.push({ object: o.object, anchor: a, round, via: named ? "name" : "step", step: unit.id })
      owned.add(a)
    }
  }
  for (const a of changed) if (!owned.has(a)) for (const o of unit.objects) links.push({ object: o.object, anchor: a, round, via: "shared", step: unit.id })
  return { links, unverified }
}

class CallTimeout extends Error {}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([p, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new CallTimeout(`no answer in ${ms} ms`)), ms) })])
  } finally { clearTimeout(timer) }
}

/** `CONTEST <check id>: <ids and why>` lines of a reply: the executor's objection to a check (BLOCK9 §2.4). */
export function contestsIn(note: string): { check: string; claim: string }[] {
  return [...note.matchAll(/^\s*CONTEST\s+(K\d+|P\d+\/[A-Za-z0-9.]+)\s*:\s*(.+)$/gmu)].map(m => ({ check: m[1], claim: m[2].trim() }))
}

const clip = (s: string, n: number) => s.length > n ? `${s.slice(0, n)}…` : s

/** The evidence of the failures, as facts: input, expected, actual. Nothing about how to fix them. */
export function renderEvidence(runs: readonly CheckRun[], failing: readonly string[], library: readonly CheckRecord[], registry: Registry, regressions: ReadonlySet<string>): string {
  const out: string[] = []
  for (const id of failing) {
    const run = runs.find(r => r.check === id)!, k = library.find(c => c.id === id)!
    const name = registry.objects.get(k.object)?.name ?? k.object
    out.push(`- ${id} (${name}${regressions.has(id) ? ", passed at the start of the round" : ""}): ${run.failure!.reason}`)
    out.push(`  args: ${JSON.stringify(k.input.args)}`)
    for (const f of k.input.files) out.push(`  file ${f.path}: ${JSON.stringify(clip(f.content, 400))}`)
    for (const a of run.assertions.filter(x => !x.ok)) {
      const x = k.assertions.find(y => y.id === a.id)!
      out.push(`  ${a.id} (${x.target.kind}${x.target.path ? ` ${x.target.path}` : ""}${x.target.line ? ` line ${x.target.line}` : ""}${x.target.pointer ? ` ${x.target.pointer}` : ""}${x.target.column ? ` column ${x.target.column}` : ""}): expected ${JSON.stringify(x.expect)}, got ${JSON.stringify(a.actual)}${x.reading ? ` (rests on a reading the text does not state: ${x.reading})` : ""}`)
    }
    if (run.failure!.reason === "crash" || run.failure!.reason === "refused") out.push(`  ${clip(run.failure!.detail, 300)}`)
  }
  return out.join("\n")
}

/** What a new session is told after a broken one, before the evidence of the last commit. */
export const RESUME_NOTE = "A previous session stopped. The work tree is at the last commit the controller made, where the checks and probes said:"

export function repairMessage(evidence: string, build: { ok: boolean; output: string }, corrections = ""): string {
  if (!build.ok) return `The program does not build:\n${clip(build.output.trim(), 3000)}\nFix it, and finish what the work order still needs.`
  return [
    ...(evidence ? ["The program was built and the acceptance checks were run against the requirements. These checks fail:", evidence] : []),
    ...(corrections ? [
      "The program was built and run on probes, and an independent check compared what it did with the requirements. This is the correction list: each item gives the rule (quoted, with its id), the call, its input files, what the program actually did, and what the checker concluded.",
      corrections,
    ] : []),
    "Fix the code so that the program follows the requirements. The requirements are the authority: if an item seems to contradict them, follow the requirements. Do not change behaviour the items do not concern.",
    "If you are sure an item contradicts the requirements, do not change the code for it: write a line `CONTEST <id>: <block ids> <why>` in your reply (the id is the check id, or the item's id such as P12/R1.S3.P5.s8).",
  ].join("\n")
}

/**
 * The objection the code makes for an item a repair did not change (DESIGN §12h E3): the item goes to the independent
 * session with the earlier finding, instead of to the executor again.
 */
export const NO_PROGRESS = "This item was sent for repair, and the program's output on this call did not change. Rule on it again from the text."

/**
 * What the round does with an item it found failing (DESIGN §12h E3): sent while it is new or its output changed;
 * once sent, an unchanged output is ruled on (`ruled` is set to the digest it was ruled at), then held: listed, no
 * more cycles spent on it this round. An item a ruling already confirmed (`confirmed`) is not ruled on again: it is
 * sent once a round (the work order carries it, or its first failing cycle sends it) and held while it does not change.
 */
export class Sends {
  private readonly sent = new Map<string, string>()
  private readonly ruledAt = new Map<string, string>()
  /** quiet: items the ledger lists only (no progress over rounds), with the output they were stuck at. */
  private readonly confirmed: Set<string>
  constructor(carried: ReadonlyMap<string, string> = new Map(), private readonly quiet: ReadonlyMap<string, string> = new Map(), confirmed: ReadonlySet<string> = new Set()) { for (const [id, d] of carried) this.sent.set(id, d); this.confirmed = new Set(confirmed) }
  /** A ruling in this round confirmed the item as the program's. */
  confirm(id: string): void { this.confirmed.add(id) }
  /** Sent before and unchanged since, not yet ruled on at this output: to be ruled on. */
  stuck(id: string, digest: string): boolean { return this.sent.get(id) === digest && this.ruledAt.get(id) !== digest && !this.confirmed.has(id) }
  ruled(id: string, digest: string): void { this.ruledAt.set(id, digest) }
  /** What would be done with the item now; nothing is recorded until `mark`. */
  plan(id: string, digest: string): { action: "send" | "hold"; why?: string } {
    if (this.quiet.get(id) === digest) return { action: "hold", why: "listed only: no progress over rounds" }
    if (this.sent.get(id) !== digest) return { action: "send" }
    if (this.confirmed.has(id)) return { action: "hold", why: "confirmed by a ruling; sent once this round, no progress" }
    return { action: "hold", why: this.ruledAt.get(id) === digest ? "no progress after a ruling" : "no progress, and no ruling possible" }
  }
  mark(id: string, digest: string, plan: { action: "send" | "hold"; why?: string }): void {
    if (plan.action === "send") this.sent.set(id, digest)
  }
}

export async function executeRound(workdir: string, workorder: WorkOrder, text: string, executor: Executor, deps: ExecutionDeps, limits: ExecutionLimits = DEFAULT_LIMITS): Promise<ExecutionRecord> {
  const round = workorder.round
  const task = workorder.task.map(t => t.object)
  const taskSet = new Set(task)
  const record: ExecutionRecord = { round, base: head(workdir), head: "", status: "done", task, sessions: [], cycles: [], kept: null, carried: [], open: [], links: [], usage: zero() }
  if (deps.carried?.size) record.carried_in = [...deps.carried].map(([id, digest]) => ({ id, digest }))
  const okSoFar = new Set(deps.detect?.passed ?? [])
  let measuredOnce = false
  const itemsOf = new Map<string, CorrectionItem[]>()
  const links = [...deps.links]
  const passing = new Set(deps.passing ?? [])
  const retired = new Set<string>()
  const names = (id: string) => deps.registry.objects.get(id)?.name ?? id
  const target = deps.target
  // What each check and probe showed when it last ran (and what it executed): the selection and the omissions read it.
  const seen = new Map<string, { functions?: readonly string[]; digest: string; at: string }>([...(target?.seen ?? [])].map(([id, v]) => [id, { ...v, at: "start" }]))
  const snapshots = new Map<string, Map<string, { digest: string; at: string }>>()
  const programs = new Map<string, ProgramRef>()
  const sends = new Sends(deps.carried, target?.quiet, target?.confirmed)
  // Items of the ledger this round: open at its start, carried in, or found failing in it.
  const tracked = new Set<string>([...(target?.open ?? []), ...(deps.carried?.keys() ?? [])])
  const trackedProbe = (probe: string) => [...tracked].some(t => t.startsWith(`${probe}/`))
  let session = await executor.open({ round, workdir, workorder, text, resume: null })
  record.sessions.push({ id: session.id, opened_for: "work", closed: "normally" })
  let message = text, kind: CycleRecord["message"] = "work", evidence = ""
  let sessionsLeft = limits.maxSessions - 1
  let lastCommit = record.base
  const live = () => activeChecks(deps.library, deps.events).filter(c => !retired.has(c.id))
  // Library checks on a program, `ids` of them or all; what each run executed is kept for the selection.
  const runLibrary = async (program: ProgramRef, ids: ReadonlySet<string> | null, anchors: readonly Anchor[], at: string) => {
    const covered = new Map<string, string[] | undefined>()
    const runs = await runChecks(live().filter(c => !ids || ids.has(c.id)), program, deps.runner, round, deps.registry, deps.facts, deps.checkTimeoutMs ?? 10_000, id => deps.upheld?.(id) ?? new Set(), (id, out) => covered.set(id, out.coverage !== undefined ? coveredFunctions(out.coverage, anchors) : undefined))
    for (const r of runs) seen.set(r.check, { functions: covered.get(r.check) ?? seen.get(r.check)?.functions, digest: runDigest(r), at })
    return runs
  }
  const noteProbes = (runs: readonly DetectedRun[] | undefined, anchors: readonly Anchor[], at: string) => {
    for (const r of runs ?? []) seen.set(r.probe, { functions: r.coverage !== undefined ? coveredFunctions(r.coverage, anchors) : seen.get(r.probe)?.functions, digest: r.digest, at })
  }
  const digestOf = (id: string) => seen.get(id.split("/")[0])?.digest ?? ""
  /** The full run on one cycle's program: everything, the omissions against what was last seen (`known`), the failures. */
  const sweep = async (cycle: string, program: ProgramRef, anchors: readonly Anchor[], ranHere: ReadonlySet<string>, known: ReadonlyMap<string, { digest: string; at: string }>) => {
    const runs = await runLibrary(program, null, anchors, `${cycle} full run`)
    const detected = deps.detect ? await deps.detect.run(program, okSoFar, new Map(), { probes: null, full: true }) : { items: [] as CorrectionItem[], findings: [] as Finding[], counts: undefined, runs: [] as DetectedRun[] }
    noteProbes(detected.runs, anchors, `${cycle} full run`)
    const now = [...runs.map(r => ({ id: r.check, digest: runDigest(r) })), ...(detected.runs ?? []).map(r => ({ id: r.probe, digest: r.digest }))]
    const omissions = now.filter(x => !ranHere.has(x.id) && known.has(x.id) && known.get(x.id)!.digest !== x.digest).map(x => ({ id: x.id, since: known.get(x.id)!.at }))
    const counts = { judged: 0, cached: 0, by_code: 0, ...detected.counts }
    return { runs, detected, record: { cycle, checks: runs.length, probes: detected.runs?.length ?? detected.counts?.probes ?? 0, judged: counts.judged, cached: counts.cached, by_code: counts.by_code, omissions, found: [] as string[] } as SweepRecord }
  }
  for (let n = 1; n <= limits.repairCycles + 1; n++) {
    const before = deps.anchors.extract(workdir)
    let reply: ExecutorReply
    const sentAt = Date.now()
    try { reply = await withTimeout(session.send(message), limits.callTimeoutMs) } catch (e) {
      deps.time?.(kind === "work" ? "coding" : "repair", sentAt, Date.now())
      if (!(e instanceof SessionBroken) && !(e instanceof CallTimeout)) throw e
      // The session is gone: back to the last checkpoint, and a new session with the work order and the evidence.
      record.sessions.find(s => s.id === session.id)!.closed = "broken"
      void session.close().catch(() => {})
      resetTo(workdir, lastCommit)
      if (sessionsLeft-- <= 0) { record.status = "sessions_spent"; break }
      session = await executor.open({ round, workdir, workorder, text, resume: evidence ? { evidence } : null })
      record.sessions.push({ id: session.id, opened_for: `C${round}.${n}`, closed: "normally" })
      message = evidence ? `${text}\n${RESUME_NOTE}\n${evidence}` : text
      kind = "resume"
      n--
      continue
    }
    record.usage = plus(record.usage, reply.usage)
    const id = `C${round}.${record.cycles.length + 1}`
    deps.time?.(kind === "work" ? "coding" : "repair", sentAt, Date.now())
    const builtAt = Date.now()
    const build = deps.build(workdir, id)
    deps.time?.("build", builtAt, Date.now())
    const after = deps.anchors.extract(workdir)
    const changed = touched(diffAnchors(before, after))
    if (build.ok) programs.set(id, build.program!)
    // What this cycle runs (DESIGN §12h E4): chosen by code; everything when there is no target.
    const known = new Map([...seen].map(([k, v]) => [k, { digest: v.digest, at: v.at }]))
    let checkSel: Map<string, SelectReason> | null = null, probeSel: Map<string, SelectReason> | null = null, scope: ReturnType<typeof changeScope> | null = null
    if (build.ok && target) {
      scope = changeScope(before, after)
      const functions = (k: string) => seen.get(k)?.functions
      checkSel = selectRuns(live().map(c => ({ id: c.id, units: c.round === round ? [...c.blocks, FRESH] : c.blocks })), { units: new Set([...target.units, FRESH]), open: k => tracked.has(k), functions, scope })
      probeSel = selectRuns((await target.probes()).map((p): Candidate => ({ id: p.id, units: p.round === round ? [...p.covers.map(c => c.unit), FRESH] : p.covers.map(c => c.unit) })), { units: new Set([...target.units, FRESH]), open: trackedProbe, functions, scope })
    }
    let runs = build.ok ? await runLibrary(build.program!, checkSel ? new Set(checkSel.keys()) : null, after, id) : []
    // Disputes: evidence code saw against a check, the session's contests, and failures a repair did not change.
    // Settled once each, against the text.
    const claimed = contestsIn(reply.note)
    const contests = claimed.filter(c => runs.some(r => r.check === c.check && r.outcome === "fail"))
    const probeContests = new Map(claimed.filter(c => c.check.startsWith("P")).map(c => [c.check, c.claim]))
    const stuckChecks = runs.filter(r => r.outcome === "fail" && r.failure?.class === "not_landed" && sends.stuck(r.check, runDigest(r)) && !contests.some(c => c.check === r.check))
    const disputes = [
      ...runs.filter(r => r.failure?.class === "disputed").map(r => ({ check: r.check, run: r, kind: r.failure!.reason as DisputeKind, detail: r.failure!.detail })),
      ...contests.map(c => ({ check: c.check, run: runs.find(r => r.check === c.check)!, kind: "contested" as const, detail: c.claim })),
      ...(deps.settle ? stuckChecks.map(r => ({ check: r.check, run: r, kind: "contested" as const, detail: NO_PROGRESS })) : []),
    ]
    const settled = disputes.length && deps.settle ? await deps.settle(disputes) : { wrong: new Set<string>(), right: new Set<string>() }
    if (deps.settle) for (const r of [...stuckChecks, ...runs.filter(x => contests.some(c => c.check === x.check))]) sends.ruled(r.check, runDigest(r))
    for (const k of settled.wrong) retired.add(k)
    for (const k of settled.right) sends.confirm(k)
    if (settled.wrong.size || settled.right.size) runs = build.ok ? await runLibrary(build.program!, new Set(runs.map(r => r.check).filter(c => !retired.has(c))), after, id) : []
    const ruled: NonNullable<CycleRecord["ruled"]> = [...settled.wrong, ...settled.right].filter(k => stuckChecks.some(r => r.check === k)).map(k => ({ id: k, verdict: settled.wrong.has(k) ? "check_wrong" : "check_right", reason: NO_PROGRESS }))
    const library = deps.library
    const objectOf = (check: string) => library.find(c => c.id === check)!
    const ranHere = new Set<string>(runs.map(r => r.check))
    const linked = linkStepAnchors({ id, objects: task.map(object => ({ object })) }, changed, undefined, names, round)
    let measured: CycleRecord["measure"]
    if (build.ok && deps.detect?.measure && !measuredOnce) { measuredOnce = true; measured = await deps.detect.measure(workdir, build.program!, [...links, ...linked.links]) }
    // Probes on this cycle's program, judged; what is wrong goes to the correction list. Only outputs that changed
    // go to the judge; the rest come from the cache.
    let detected = build.ok && deps.detect ? await deps.detect.run(build.program!, okSoFar, probeContests, { probes: probeSel ? new Set(probeSel.keys()) : null }) : { items: [] as CorrectionItem[], findings: [] as Finding[], counts: undefined, runs: undefined as DetectedRun[] | undefined }
    if (build.ok) noteProbes(detected.runs, after, id)
    for (const r of detected.runs ?? []) ranHere.add(r.probe)
    // Items a repair did not change go to the independent session with the earlier finding (DESIGN §12h E3).
    if (build.ok && deps.detect) {
      for (const it of detected.items.filter(x => probeContests.has(x.key))) sends.ruled(it.key, digestOf(it.key))
      for (const f of detected.findings.filter(x => probeContests.has(pairKey(x.probe, x.unit)))) ruled.push({ id: pairKey(f.probe, f.unit), verdict: f.verdict, reason: f.reason })
      const stuck = detected.items.filter(it => !probeContests.has(it.key) && sends.stuck(it.key, digestOf(it.key)))
      if (stuck.length) {
        const again = await deps.detect.run(build.program!, okSoFar, new Map(stuck.map(it => [it.key, `${NO_PROGRESS} The earlier finding: ${it.finding}`])), { probes: new Set(stuck.map(it => it.probe)) })
        for (const it of stuck) sends.ruled(it.key, digestOf(it.key))
        const redone = new Set(stuck.map(it => it.key))
        const byKey = new Map(again.findings.map(f => [pairKey(f.probe, f.unit), f]))
        ruled.push(...stuck.map(it => ({ id: it.key, verdict: byKey.get(it.key)?.verdict ?? "cannot_tell", reason: byKey.get(it.key)?.reason ?? "no verdict came back" })))
        detected = {
          ...detected,
          items: [...detected.items.filter(it => !redone.has(it.key)), ...again.items.filter(it => redone.has(it.key))],
          findings: [...detected.findings.filter(f => !redone.has(pairKey(f.probe, f.unit))), ...again.findings.filter(f => redone.has(pairKey(f.probe, f.unit)))],
        }
      }
    }
    for (const f of detected.findings) if (f.ruled && f.verdict === "wrong") sends.confirm(pairKey(f.probe, f.unit))
    let regressions = new Set(runs.filter(r => r.outcome === "fail" && passing.has(r.check)).map(r => r.check))
    // Against the round's work: not landed on a task object or its conventions, or a regression; contested checks
    // still unsettled do not count.
    const unsettled = new Set(contests.filter(c => !settled.wrong.has(c.check) && !settled.right.has(c.check)).map(c => c.check))
    const failingOf = (rs: readonly CheckRun[]) => rs.filter(r => r.outcome === "fail" && r.failure?.class === "not_landed" && !unsettled.has(r.check)
      && (regressions.has(r.check) || taskSet.has(objectOf(r.check).object) || objectOf(r.check).uses.some(u => taskSet.has(u)))).map(r => r.check)
    let failing = failingOf(runs)
    let corrections = detected.items
    let swept: SweepRecord | undefined
    const decide = () => {
      const items: ItemSighting[] = []
      const runOf = new Map(runs.map(r => [r.check, r]))
      for (const k of failing) { const d = runDigest(runOf.get(k)!); items.push({ id: k, digest: d, verdict: "not_landed", ...sends.plan(k, d) }) }
      for (const it of corrections) { const d = digestOf(it.key); items.push({ id: it.key, digest: d, verdict: "wrong", ...sends.plan(it.key, d) }) }
      // Tracked items this cycle ran that are no longer failing: the ledger sees them pass.
      for (const r of runs) if (tracked.has(r.check) && !failing.includes(r.check)) items.push({ id: r.check, digest: runDigest(r), verdict: r.outcome === "pass" ? "pass" : `${r.failure?.class}`, action: "none" })
      for (const f of detected.findings) { const k = pairKey(f.probe, f.unit); if (tracked.has(k) && !corrections.some(it => it.key === k)) items.push({ id: k, digest: digestOf(k), verdict: f.verdict, action: "none" }) }
      return items
    }
    let items = decide()
    const toSend = () => items.filter(i => i.action === "send").map(i => i.id)
    const counts: CheckRunCounts = { checks: runs.length, probes: 0, judged: 0, cached: 0, by_code: 0, ...detected.counts }
    if (checkSel && probeSel && scope) counts.selected = { checks: tally(checkSel), probes: tally(probeSel), all: scope.all, changed_functions: scope.changed_functions.length }
    // Nothing left to send: before the round ends, everything runs once on this program (DESIGN §12h E4). What it
    // finds failing that this cycle's selection did not show is sent like any item, while cycles are left.
    if (build.ok && target && !toSend().length) {
      const s = await sweep(id, build.program!, after, ranHere, known)
      swept = s.record
      runs = s.runs
      regressions = new Set(runs.filter(r => r.outcome === "fail" && passing.has(r.check)).map(r => r.check))
      const shown = new Set([...failing, ...corrections.map(c => c.key)])
      detected = { ...detected, items: s.detected.items, findings: s.detected.findings }
      failing = failingOf(runs)
      corrections = s.detected.items
      swept.found = [...failing, ...corrections.map(c => c.key)].filter(k => !shown.has(k))
      items = decide()
    }
    for (const f of detected.findings) if (f.verdict === "ok") okSoFar.add(pairKey(f.probe, f.unit))
    // Only a program that built has items to send.
    if (!build.ok) items = items.map(i => ({ ...i, action: "none" as const, why: undefined }))
    for (const i of items) { if (i.verdict === "not_landed" || i.verdict === "wrong") tracked.add(i.id); if (i.action === "send" || i.action === "hold") sends.mark(i.id, i.digest, { action: i.action, ...(i.why ? { why: i.why } : {}) }) }
    const send = new Set(toSend())
    const held = items.filter(i => i.action === "hold").map(i => i.id)
    const trailers: [string, string][] = [
      ["IC-Round", String(round)], ["IC-Cycle", id], ["IC-Session", session.id],
      ...task.map(o => ["IC-Object", `${o}@v${deps.registry.objects.get(o)!.version}`] as [string, string]),
      ...(changed.length ? [["IC-Anchors", changed.join(", ")] as [string, string]] : []),
      ["IC-Build", build.ok ? "ok" : "failed"],
      ...(failing.length ? [["IC-Failing", failing.join(", ")] as [string, string]] : []),
      ...(corrections.length ? [["IC-Corrections", corrections.map(c => c.key).join(", ")] as [string, string]] : []),
    ]
    const commit = commitStep(workdir, `${id} ${kind}`, trailers)
    lastCommit = commit
    links.push(...linked.links)
    record.cycles.push({
      id, round, session: session.id, message: kind, commit, build: { ok: build.ok, output: build.ok ? "" : clip(build.output, 4000) },
      runs: runs.map(r => ({ check: r.check, outcome: r.outcome, failure: r.failure ? `${r.failure.class}/${r.failure.reason}` : null })),
      failing, contests: contests.map(c => ({ check: c.check, claim: c.claim, verdict: settled.wrong.has(c.check) ? "check_wrong" : settled.right.has(c.check) ? "check_right" : "unsettled" })),
      anchors: changed, note: clip(reply.note, 4000), usage: reply.usage,
      ...(measured ? { measure: measured } : {}), ...(build.ok && deps.detect ? { probe_runs: counts } : {}),
      corrections: corrections.map(c => c.key), ambiguous: detected.findings.filter(f => f.verdict === "ambiguous").map(f => pairKey(f.probe, f.unit)), broke: corrections.filter(c => c.passed_before).map(c => c.key),
      items, ...(held.length ? { held } : {}), ...(ruled.length ? { ruled } : {}), ...(swept ? { sweep: swept } : {}),
    })
    snapshots.set(id, new Map([...seen].map(([k, v]) => [k, { digest: v.digest, at: v.at }])))
    itemsOf.set(id, corrections)
    deps.onProgress?.(record)
    if (build.ok && !send.size) break
    if (n === limits.repairCycles + 1) { record.status = "cycles_spent"; break }
    const sendFailing = failing.filter(k => send.has(k)), sendItems = corrections.filter(c => send.has(c.key))
    const checkEvidence = build.ok && sendFailing.length ? renderEvidence(runs, sendFailing, library, deps.registry, regressions) : ""
    const list = build.ok && sendItems.length ? renderCorrections(sendItems.map(c => target?.confirmed?.has(c.key) ? { ...c, upheld: true } : c), deps.detect!.program) : ""
    evidence = [checkEvidence, list].filter(Boolean).join("\n")
    message = repairMessage(checkEvidence, build, list)
    kind = "repair"
  }
  await session.close()
  // The round ends on the cycle with the fewest failures among those that built (the latest on a tie).
  const built = record.cycles.filter(c => c.build.ok)
  const errors = (c: CycleRecord) => c.failing.length + c.corrections.length
  const best = built.reduce<CycleRecord | null>((b, c) => !b || errors(c) <= errors(b) ? c : b, null)
  if (best) {
    record.kept = best.id
    if (best.commit !== head(workdir)) resetTo(workdir, best.commit)
    // The full run on the program the round delivers, if that cycle had none (DESIGN §12h E4).
    if (target && !best.sweep && programs.has(best.id)) {
      const anchorsNow = deps.anchors.extract(workdir)
      const ranThere = new Set(best.runs.map(r => r.check))
      const known = snapshots.get(best.id) ?? new Map()
      for (const [k, v] of known) if (v.at === best.id) ranThere.add(k)
      const s = await sweep(best.id, programs.get(best.id)!, anchorsNow, ranThere, known)
      const failingNow = s.runs.filter(r => r.outcome === "fail" && r.failure?.class === "not_landed" && (passing.has(r.check) || taskSet.has(deps.library.find(c => c.id === r.check)!.object) || deps.library.find(c => c.id === r.check)!.uses.some(u => taskSet.has(u)))).map(r => r.check)
      s.record.found = [...failingNow, ...s.detected.items.map(c => c.key)].filter(k => !best.failing.includes(k) && !best.corrections.includes(k))
      record.sweep = s.record
      best.failing = failingNow
      best.runs = s.runs.map(r => ({ check: r.check, outcome: r.outcome, failure: r.failure ? `${r.failure.class}/${r.failure.reason}` : null }))
      best.ambiguous = s.detected.findings.filter(f => f.verdict === "ambiguous").map(f => pairKey(f.probe, f.unit))
      itemsOf.set(best.id, s.detected.items)
      best.corrections = s.detected.items.map(c => c.key)
      const runOf = new Map(s.runs.map(r => [r.check, r]))
      record.final = [...failingNow.map(k => ({ id: k, digest: runDigest(runOf.get(k)!), verdict: "not_landed", action: "none" as const })), ...s.detected.items.map(c => ({ id: c.key, digest: digestOf(c.key), verdict: "wrong", action: "none" as const }))]
    } else if (target) {
      record.sweep = best.sweep
      record.final = (best.items ?? []).filter(i => i.verdict === "not_landed" || i.verdict === "wrong").map(i => ({ ...i, action: "none" as const }))
    }
    const failingObjects = new Set(best.failing.flatMap(k => { const c = deps.library.find(x => x.id === k)!; return [c.object, ...c.uses] }))
    for (const it of itemsOf.get(best.id) ?? []) { const owner = deps.registry.coverOf(it.rule.id)?.owner; if (owner && owner !== "none") failingObjects.add(owner) }
    record.open = best.corrections
    record.carried = task.filter(o => failingObjects.has(o))
  } else record.carried = task
  if (target) {
    // What each check and probe executed, for the next round's selection: from the full run where there was one.
    const functions = [...new Set([...seen.values()].flatMap(v => v.functions ?? []))].sort()
    const index = new Map(functions.map((f, i) => [f, i]))
    record.coverage = { functions, ids: Object.fromEntries([...seen].map(([k, v]) => [k, { ...(v.functions ? { f: v.functions.map(f => index.get(f)!) } : {}), d: v.digest }])) }
  }
  record.links = links.slice(deps.links.length)
  record.head = head(workdir)
  return record
}

/** A marker unit: a check or probe that entered this round is on its changed text. */
const FRESH = "\u0000fresh"

function tally(sel: ReadonlyMap<string, SelectReason>): Partial<Record<SelectReason, number>> {
  const out: Partial<Record<SelectReason, number>> = {}
  for (const r of sel.values()) out[r] = (out[r] ?? 0) + 1
  return out
}

/** Reads back what the code committed, from the trailers alone. */
export function cyclesFromHistory(workdir: string, commits: readonly string[]): { commit: string; round: number; cycle: string; objects: string[]; anchors: string[]; failing: string[]; build: string }[] {
  return commits.map(commit => {
    const t = readTrailers(workdir, commit)
    return {
      commit, round: Number(t["IC-Round"]?.[0]), cycle: t["IC-Cycle"]?.[0] ?? "", objects: t["IC-Object"] ?? [],
      anchors: (t["IC-Anchors"]?.[0] ?? "").split(", ").filter(Boolean), failing: (t["IC-Failing"]?.[0] ?? "").split(", ").filter(Boolean), build: t["IC-Build"]?.[0] ?? "",
    }
  })
}
