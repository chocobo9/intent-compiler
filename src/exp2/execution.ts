import { diffAnchors, touched, type AnchorExtractor } from "./anchors.js"
import type { TokenUsage } from "./attribution.js"
import { activeChecks, type CheckEvent, type CheckRecord, type CodeFacts } from "./checks.js"
import { commitStep, head, readTrailers, resetTo } from "./git.js"
import type { Registry } from "./registry.js"
import type { CheckRunner, ProgramRef } from "./runner.js"
import { runCheck, type CheckRun, type DisputeKind } from "./verdict.js"
import type { AnchorLink, WorkOrder } from "./workorder.js"
import { pairKey, renderCorrections, type CorrectionItem, type Finding } from "./judge.js"

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
   * Probes and judge (BLOCK10 §1.5): runs every active probe on the cycle's program, judges what changed, and returns
   * the correction items (wrong only) and all findings. `before` holds the probe/unit pairs judged ok earlier, so an
   * item that broke is marked; `contests` the executor's objections.
   */
  detect?: {
    /**
     * Runs probes on the cycle's program and judges them (BLOCK11 §1). `scope`: all of them (the round's first run
     * on a built program, and the end-of-round check), or after a repair only the open items' probes, the probes of
     * the objects the change touched, and probes not run yet this round. Returns the counts by reason.
     */
    run(program: ProgramRef, before: ReadonlySet<string>, contests: ReadonlyMap<string, string>, scope?: ProbeScope): Promise<{ items: CorrectionItem[]; findings: Finding[]; counts?: ProbeRunCounts }>
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
  /** Called after every cycle with the record so far (for the record of an interrupted round). */
  onProgress?: (record: ExecutionRecord) => void
  /** Wall time of each stage (BLOCK10 §9.1): coding (the work message), repair (repair and resume messages), build. */
  time?: (stage: string, startedAt: number, endedAt: number) => void
  checkTimeoutMs?: number
}

export type ProbeScope = { kind: "first" | "check" } | { kind: "scoped"; objects: string[]; open: string[] }

/** Probes run in a cycle, by why: all on the first run, open items, objects the change touched, new this round, the end-of-round check. */
export interface ProbeRunCounts { first: number; open: number; affected: number; new: number; check: number }

export interface CycleRecord {
  id: string
  round: number
  session: string
  message: "work" | "repair" | "resume"
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
  /** Probes run in this cycle, by why (BLOCK11 §1). */
  probe_runs?: ProbeRunCounts
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
  status: "done" | "cycles_spent" | "sessions_spent"
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

export async function executeRound(workdir: string, workorder: WorkOrder, text: string, executor: Executor, deps: ExecutionDeps, limits: ExecutionLimits = DEFAULT_LIMITS): Promise<ExecutionRecord> {
  const round = workorder.round
  const task = workorder.task.map(t => t.object)
  const taskSet = new Set(task)
  const record: ExecutionRecord = { round, base: head(workdir), head: "", status: "done", task, sessions: [], cycles: [], kept: null, carried: [], open: [], links: [], usage: zero() }
  const okSoFar = new Set(deps.detect?.passed ?? [])
  let ranFull = false, openProbes = new Set<string>()
  let measuredOnce = false
  const itemsOf = new Map<string, CorrectionItem[]>()
  const links = [...deps.links]
  const passing = new Set(deps.passing ?? [])
  const retired = new Set<string>()
  const names = (id: string) => deps.registry.objects.get(id)?.name ?? id
  let session = await executor.open({ round, workdir, workorder, text, resume: null })
  record.sessions.push({ id: session.id, opened_for: "work", closed: "normally" })
  let message = text, kind: CycleRecord["message"] = "work", evidence = ""
  let sessionsLeft = limits.maxSessions - 1
  let lastCommit = record.base
  const runAll = async (program: ProgramRef) => {
    const runs: CheckRun[] = []
    for (const c of activeChecks(deps.library, deps.events).filter(c => !retired.has(c.id))) runs.push(await runCheck(c, program, deps.runner, round, deps.registry, deps.facts, deps.checkTimeoutMs ?? 10_000, deps.upheld?.(c.id)))
    return runs
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
    const changed = touched(diffAnchors(before, deps.anchors.extract(workdir)))
    let runs = build.ok ? await runAll(build.program!) : []
    // Disputes: evidence code saw against a check, and the session's contests. Settled once each, against the text.
    const claimed = contestsIn(reply.note)
    const contests = claimed.filter(c => runs.some(r => r.check === c.check && r.outcome === "fail"))
    const probeContests = new Map(claimed.filter(c => c.check.startsWith("P")).map(c => [c.check, c.claim]))
    const disputes = [
      ...runs.filter(r => r.failure?.class === "disputed").map(r => ({ check: r.check, run: r, kind: r.failure!.reason as DisputeKind, detail: r.failure!.detail })),
      ...contests.map(c => ({ check: c.check, run: runs.find(r => r.check === c.check)!, kind: "contested" as const, detail: c.claim })),
    ]
    const settled = disputes.length && deps.settle ? await deps.settle(disputes) : { wrong: new Set<string>(), right: new Set<string>() }
    for (const k of settled.wrong) retired.add(k)
    if (settled.wrong.size || settled.right.size) runs = build.ok ? await runAll(build.program!) : []
    const library = deps.library
    const objectOf = (check: string) => library.find(c => c.id === check)!
    const regressions = new Set(runs.filter(r => r.outcome === "fail" && passing.has(r.check)).map(r => r.check))
    // Against the round's work: not landed on a task object or its conventions, or a regression; contested checks
    // still unsettled do not count.
    const unsettled = new Set(contests.filter(c => !settled.wrong.has(c.check) && !settled.right.has(c.check)).map(c => c.check))
    const failing = runs.filter(r => r.outcome === "fail" && r.failure?.class === "not_landed" && !unsettled.has(r.check)
      && (regressions.has(r.check) || taskSet.has(objectOf(r.check).object) || objectOf(r.check).uses.some(u => taskSet.has(u)))).map(r => r.check)
    const linked = linkStepAnchors({ id, objects: task.map(object => ({ object })) }, changed, undefined, names, round)
    let measured: CycleRecord["measure"]
    if (build.ok && deps.detect?.measure && !measuredOnce) { measuredOnce = true; measured = await deps.detect.measure(workdir, build.program!, [...links, ...linked.links]) }
    // Probes on this cycle's program, judged; what is wrong goes to the correction list.
    // The first run on a built program covers every probe; after a repair, what the change can affect and the open
    // items. When that is clean, all probes once more on the same program: what the change broke elsewhere is caught
    // before the round ends. Verdicts of probes not rerun carry forward.
    const changedSet = new Set(changed)
    const touchedObjects = [...new Set([...links, ...linked.links].filter(l => changedSet.has(l.anchor)).map(l => l.object))]
    const scope: ProbeScope = !ranFull ? { kind: "first" } : { kind: "scoped", objects: touchedObjects, open: [...openProbes] }
    let detected = build.ok && deps.detect ? await deps.detect.run(build.program!, okSoFar, probeContests, scope) : { items: [] as CorrectionItem[], findings: [] as Finding[], counts: undefined }
    const counts: ProbeRunCounts = { first: 0, open: 0, affected: 0, new: 0, check: 0, ...detected.counts }
    if (build.ok && deps.detect) ranFull = true
    if (build.ok && deps.detect && scope.kind === "scoped" && !detected.items.length && !failing.length) {
      const check = await deps.detect.run(build.program!, okSoFar, new Map(), { kind: "check" })
      counts.check = check.counts?.check ?? 0
      detected = { items: check.items, findings: [...detected.findings, ...check.findings], counts }
    }
    for (const f of detected.findings) if (f.verdict === "ok") okSoFar.add(pairKey(f.probe, f.unit))
    const corrections = detected.items
    openProbes = new Set(corrections.map(c => c.probe))
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
    })
    itemsOf.set(id, corrections)
    deps.onProgress?.(record)
    if (build.ok && !failing.length && !corrections.length) break
    if (n === limits.repairCycles + 1) { record.status = "cycles_spent"; break }
    const checkEvidence = build.ok && failing.length ? renderEvidence(runs, failing, library, deps.registry, regressions) : ""
    const list = build.ok && corrections.length ? renderCorrections(corrections, deps.detect!.program) : ""
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
    const failingObjects = new Set(best.failing.flatMap(k => { const c = deps.library.find(x => x.id === k)!; return [c.object, ...c.uses] }))
    for (const it of itemsOf.get(best.id) ?? []) { const owner = deps.registry.coverOf(it.rule.id)?.owner; if (owner && owner !== "none") failingObjects.add(owner) }
    record.open = best.corrections
    record.carried = task.filter(o => failingObjects.has(o))
  } else record.carried = task
  record.links = links.slice(deps.links.length)
  record.head = head(workdir)
  return record
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
