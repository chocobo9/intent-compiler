import type { Assertion } from "./checks.js"
import type { GuardRecord } from "./guards.js"
import { programArgs, sessionInput, type ReviewMaterials } from "./materials.js"
import type { Registry } from "./registry.js"
import type { CheckInput, CheckRunner, ProgramRef, RunOutput } from "./runner.js"
import { coversSentence } from "./verification.js"

/**
 * What the reviewer verified (DESIGN-OPUS-2026-10-26 §11 item 1): the facts of what happened come from the session —
 * code numbers the reviewer's runs of the program in the order it made them, with their input files and output; the
 * reviewer makes one judgment, a line `COVERED <sentence ids> BY RUN <n>`: run n shows these sentences hold. Code runs
 * that run again twice on the program reviewed; the two alike make it a guard (asserting the exit code, stdout and the
 * files the run wrote) resting on those sentences, which leaves their debt. The formalizer is not involved.
 *
 * A line binds only scope sentences (this round's text and the slice's debt) that no passing guard holds; a paragraph
 * or section id is counted and ignored (decision B); a run that does not give the same output again is counted.
 */

export interface ReviewerRun { n: number; args: string[]; input: CheckInput; output: string }

/** The reviewer's runs of the program, numbered from 1 in session order, each with the session files it names. */
export function reviewerRuns(materials: Pick<ReviewMaterials, "commands" | "files">, binary: string): ReviewerRun[] {
  const out: ReviewerRun[] = []
  for (const c of materials.commands) {
    const args = programArgs(c.command, binary)
    if (!args) continue
    out.push({ n: out.length + 1, args, input: sessionInput(args, { leads: [], files: [...materials.files], commands: [] }), output: c.output })
  }
  return out
}

/** `COVERED <ids> BY RUN <n>` lines: ids separated by commas or spaces, as the annotations show them (hash dropped). */
export function coveredIn(text: string): { ids: string[]; run: number; line: string }[] {
  return [...text.matchAll(/^\s*[-*]?\s*`?COVERED\s+(.+?)\s+BY\s+RUN\s+#?(\d+)`?\.?\s*$/gimu)].map(m => ({
    ids: [...m[1].matchAll(/R\d+(?:\.[A-Za-z]*\d+|\.H)+/gu)].map(x => x[0]), run: Number(m[2]), line: m[0].trim(),
  }))
}

const norm = (s: string) => s.replace(/\r\n/gu, "\n").split("\n").map(l => l.trimEnd()).join("\n").trim()

/** The session's output of a run and a run again agree: stdout and stderr together (either order), or one of them alone. */
export function sameOutput(session: string, run: RunOutput): boolean {
  const s = norm(session)
  return [`${run.stdout}${run.stderr}`, `${run.stderr}${run.stdout}`, `${run.stdout}\n${run.stderr}`, `${run.stderr}\n${run.stdout}`, run.stdout, run.stderr].some(x => norm(x) === s && (s !== "" || (run.stdout === "" && run.stderr === "")))
}

/** Two runs again alike (rule A): exit code, stdout, stderr and every file of the run directory the same. */
export const alike = (a: RunOutput, b: RunOutput) => !b.timed_out && !b.limit && a.exit_code === b.exit_code && a.stdout === b.stdout && a.stderr === b.stderr && JSON.stringify(Object.entries(a.files).sort()) === JSON.stringify(Object.entries(b.files).sort())

/** The snapshot's assertions: the exit code, the whole stdout, each file the run wrote that was not an input. */
export function snapshotAssertions(run: RunOutput, input: CheckInput): Assertion[] {
  const src = { kind: "derived" as const, block: null }
  const target = (kind: Assertion["target"]["kind"], path: string | null = null) => ({ kind, path, line: null, pointer: null, column: null })
  const inputs = new Set(input.files.map(f => f.path))
  return [
    { id: "exit", role: "business", target: target("exit_code"), expect: run.exit_code, tolerance: null, source: src },
    { id: "stdout", role: "business", target: target("stdout"), expect: run.stdout, tolerance: null, source: src },
    ...Object.entries(run.files).filter(([p]) => !inputs.has(p)).sort(([a], [b]) => a.localeCompare(b)).map(([p, content], i) => ({ id: `file${i + 1}`, role: "business" as const, target: target("file", p), expect: content, tolerance: null, source: src })),
  ] as Assertion[]
}

export type CoveredOutcome = "guard" | "not_reproduced" | "unstable" | "conflict" | "no_such_run" | "no_scope_sentence"

export interface CoveredRecord {
  review: string
  line: string
  run: number
  /** Scope sentences the line bound (the guard rests on them), and the ids it named that were set aside, with why. */
  bound: string[]
  ignored: { id: string; why: "coarser than a sentence" | "not in scope" | "held already" | "unknown" }[]
  outcome: CoveredOutcome
  guard?: string
}

export interface CoveredDeps {
  registry: Registry
  round: number
  review: string
  cycle: string
  program: ProgramRef
  runner: CheckRunner
  timeoutMs: number
  /** Scope sentences not yet held when the review began. */
  open: ReadonlySet<string>
  nextGuard: () => string
  /** The reply's deviations, as the reviewer wrote them: a run one of them quotes is no proof that sentences hold. */
  findings?: readonly string[]
}

/** The program's arguments of the commands a text quotes (in backquotes). */
const quotedRuns = (text: string, binary: string) => [...text.matchAll(/`([^`]+)`/gu)].map(m => programArgs(m[1], binary)).filter((a): a is string[] => !!a && a.length > 0)
const sameArgs = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x.replace(/^\.\//u, "") === b[i].replace(/^\.\//u, ""))

/** The reply's COVERED lines bound, run again and made guards; one record a line. */
export async function bindCovered(text: string, runs: readonly ReviewerRun[], d: CoveredDeps, binary = "dpipe"): Promise<{ records: CoveredRecord[]; guards: GuardRecord[] }> {
  const quoted = (d.findings ?? []).flatMap(f => quotedRuns(f, binary))
  const records: CoveredRecord[] = [], guards: GuardRecord[] = []
  const taken = new Set<string>()
  for (const c of coveredIn(text)) {
    const bound: string[] = [], ignored: CoveredRecord["ignored"] = []
    for (const raw of c.ids) {
      const b = d.registry.block(raw)
      const id = b?.level === "clause" ? b.parent! : raw
      if (!b) ignored.push({ id: raw, why: "unknown" })
      else if (b.level === "section" || b.level === "paragraph") ignored.push({ id: raw, why: "coarser than a sentence" })
      else if (!d.open.has(id)) ignored.push({ id, why: "not in scope" })
      else if (taken.has(id)) ignored.push({ id, why: "held already" })
      else if (!bound.includes(id)) bound.push(id)
    }
    const base = { review: d.review, line: c.line, run: c.run, bound, ignored }
    const run = runs.find(r => r.n === c.run)
    if (!bound.length) { records.push({ ...base, outcome: "no_scope_sentence" }); continue }
    if (!run) { records.push({ ...base, outcome: "no_such_run" }); continue }
    // The same run both covered and reported as a deviation (Opus's rule 2): neither side counts it.
    if (quoted.some(a => sameArgs(a, run.args))) { records.push({ ...base, outcome: "conflict" }); continue }
    // Run again twice (Opus's rule 1, rule A): the two alike make the snapshot; a snapshot of an output that changes from
    // run to run guards nothing. The session's own output is not compared: it is the shell command's, wrappers and all
    // (three runs' sessions: 0–1% alike, against 94–98% for two runs again).
    const again = await d.runner.run(d.program, run.input, d.timeoutMs)
    if (again.timed_out || again.limit) { records.push({ ...base, outcome: "not_reproduced" }); continue }
    if (!alike(again, await d.runner.run(d.program, run.input, d.timeoutMs))) { records.push({ ...base, outcome: "unstable" }); continue }
    const owner = d.registry.coverOf(bound[0])?.owner
    const g: GuardRecord = {
      id: d.nextGuard(), round: d.round, source: "review", units: bound, object: owner && owner !== "none" ? owner : null,
      input: run.input, assertions: snapshotAssertions(again, run.input), reference_script: null,
      origin: { item: `${d.review}/run ${c.run}`, review: d.review, text: c.line }, snapshot: { review: d.review, run: c.run }, born: { cycle: d.cycle, program: d.program.id },
    }
    for (const s of bound) taken.add(s)
    guards.push(g)
    records.push({ ...base, outcome: "guard", guard: g.id })
  }
  return { records, guards }
}

/** The scope sentences no live passing guard holds (and no open item, no declaration): what reviews still owe. */
export function uncoveredScope(registry: Registry, scope: readonly string[], guards: readonly GuardRecord[], status: ReadonlyMap<string, string>, open: readonly string[]): string[] {
  const held = (s: string) => guards.some(g => status.get(g.id) === "passing" && g.units.some(u => coversSentence(registry, u.split("#")[0], s)))
  const inItem = (s: string) => open.some(u => coversSentence(registry, u.split("#")[0], s))
  return scope.filter(s => !held(s) && !inItem(s))
}

export interface CoveredSummary { lines: number; bound: number; guards: number; not_reproduced: number; unstable: number; conflicts: number; no_such_run: number; no_scope_sentence: number; ignored: Record<string, number>; per_line: number | null }

export function summarizeCovered(records: readonly CoveredRecord[]): CoveredSummary {
  const ignored: Record<string, number> = {}
  for (const r of records) for (const i of r.ignored) ignored[i.why] = (ignored[i.why] ?? 0) + 1
  const g = records.filter(r => r.outcome === "guard")
  return {
    lines: records.length, bound: g.reduce((n, r) => n + r.bound.length, 0), guards: g.length,
    not_reproduced: records.filter(r => r.outcome === "not_reproduced").length, unstable: records.filter(r => r.outcome === "unstable").length, conflicts: records.filter(r => r.outcome === "conflict").length, no_such_run: records.filter(r => r.outcome === "no_such_run").length, no_scope_sentence: records.filter(r => r.outcome === "no_scope_sentence").length,
    ignored, per_line: g.length ? Math.round(g.reduce((n, r) => n + r.bound.length, 0) / g.length * 10) / 10 : null,
  }
}

export function renderCovered(s: CoveredSummary, flips: number, gaps: number): string {
  const ign = Object.entries(s.ignored).map(([k, n]) => `${k} ${n}`).join(", ") || "none"
  return `- COVERED lines: ${s.lines}; snapshot guards born ${s.guards}, binding ${s.bound} sentences (${s.per_line ?? "—"} a line); not reproduced ${s.not_reproduced}, no such run ${s.no_such_run}, no scope sentence ${s.no_scope_sentence}; rerun unstable ${s.unstable}, conflicts with a deviation ${s.conflicts}; ids set aside: ${ign}. Snapshot guard flips ${flips}; scope sentences left uncovered at the end ${gaps}.`
}

