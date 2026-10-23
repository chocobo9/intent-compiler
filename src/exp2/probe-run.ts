import type { DetectedRun } from "./execution.js"
import { correctionItems, outputDigest, pairKey, type CorrectionItem, type Finding, type JudgeTransport } from "./judge.js"
import { runProbes, type ProbeRecord } from "./probes.js"
import type { CheckRunner, ProgramRef, ScriptSandbox } from "./runner.js"
import type { Exp2Store } from "./store.js"

/**
 * Probes run and judged, as the block 10–12 flow did it (moved here from the serial when the probes path left the
 * round, DESIGN §12j.4; the code stays for the offline tools and tests that call `executeRound` with probes).
 */

/**
 * Runs probes on a program and judges the runs (kept verdicts reused): the findings, the correction items, and each
 * run's digest and coverage. Objections are ruled on by `ruling` (DESIGN §12h E3). A full run judges a changed output
 * only where a regression is suspected: the pair's last verdict was ok or wrong, or it has none (E4).
 */
export async function runAndJudge(d: { store: Exp2Store; runner: CheckRunner; timeoutMs: number; concurrency?: number; judge: JudgeTransport; ruling?: JudgeTransport; sandbox?: ScriptSandbox; timed?: <T>(stage: string, f: () => Promise<T>) => Promise<T> }, round: number, probes: readonly ProbeRecord[], program: ProgramRef, before: ReadonlySet<string>, contests: ReadonlyMap<string, string>, options: { full?: boolean } = {}): Promise<{ findings: Finding[]; items: CorrectionItem[]; runs: DetectedRun[] }> {
  const timed = d.timed ?? (<T>(_: string, f: () => Promise<T>) => f())
  const runs = await timed("probe runs", () => runProbes(probes, program, d.runner, d.timeoutMs, d.concurrency))
  const last = new Map<string, string>()
  if (options.full) for (const j of d.store.inspect().judgments) last.set(pairKey(j.probe, j.unit), j.verdict)
  const judgeIf = options.full ? (probe: string, unit: string) => { const v = last.get(pairKey(probe, unit)); return v === undefined || v === "ok" || v === "wrong" } : undefined
  const findings = (await timed("judging", () => d.store.judge(round, runs, d.judge, { contests, ...(d.sandbox ? { sandbox: d.sandbox } : {}), ...(judgeIf ? { judgeIf } : {}), ...(d.ruling ? { ruling: d.ruling } : {}) }))).filter(f => probes.some(p => p.id === f.probe))
  return { findings, items: correctionItems(d.store.registry(), probes, runs, findings, before), runs: runs.map(r => ({ probe: r.probe, digest: outputDigest(r.output), ...(r.coverage !== undefined ? { coverage: r.coverage } : {}) })) }
}

/** How a cycle's probe verdicts were reached: judged now (an output changed), from the cache, or by code. */
export function verdictCounts(findings: readonly Finding[]): { judged: number; cached: number; by_code: number } {
  return { judged: findings.filter(f => !f.cached && f.kind !== "A" && f.kind !== "B").length, cached: findings.filter(f => f.cached).length, by_code: findings.filter(f => !f.cached && (f.kind === "A" || f.kind === "B")).length }
}
