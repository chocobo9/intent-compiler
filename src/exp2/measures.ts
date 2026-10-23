import { costOf, type RoundMeasures } from "./report.js"

/**
 * The §12i comparison from a run's checkpoints (fix block B4): each round's measures beside its official and
 * first-delivery scores, the R5–R15 non-executor cost, and the preregistered verdict when the control arm's cost is
 * given. Code only reads what the serial wrote (measures.jsonl, scores.jsonl); the last line of a round wins (a round
 * run again after an interruption writes again).
 */

export interface ScoreLine { round: number; commit?: string; kind?: string; passed?: number; total?: number; error?: string }

export interface MeasuresSummary {
  rounds: { m: RoundMeasures; official: ScoreLine | null; first: ScoreLine | null }[]
  /** Non-executor cost summed over the window (default R5–R15), and the executor's tokens there. */
  window: { from: number; to: number; non_executor_cost: number; executor_cost: number; rounds: number }
  final: { round: number; passed: number; total: number } | null
  /** The preregistered verdict (§12i): ratio ≤ 0.5 and R15 ≥ 948/960 wins; ratio ≥ 0.8 or below the bar fails; else not shown. */
  verdict: null | { control_cost: number; ratio: number; bar: number; outcome: "IC wins" | "fails" | "not shown" }
}

const lastBy = <T>(list: T[], key: (x: T) => string): Map<string, T> => new Map(list.map(x => [key(x), x]))

export function summarizeMeasures(measures: readonly RoundMeasures[], scores: readonly ScoreLine[], o: { from?: number; to?: number; controlCost?: number; bar?: number } = {}): MeasuresSummary {
  const m = [...lastBy([...measures], x => String(x.round)).values()].sort((a, b) => a.round - b.round)
  const ok = scores.filter(s => typeof s.passed === "number")
  const official = lastBy(ok.filter(s => !s.kind), s => String(s.round)), first = lastBy(ok.filter(s => s.kind === "first_delivery"), s => String(s.round))
  const rounds = m.map(x => ({ m: x, official: official.get(String(x.round)) ?? null, first: first.get(String(x.round)) ?? null }))
  const from = o.from ?? 5, to = o.to ?? 15
  const inWindow = m.filter(x => x.round >= from && x.round <= to)
  const window = { from, to, rounds: inWindow.length, non_executor_cost: inWindow.reduce((n, x) => n + x.non_executor_cost, 0), executor_cost: Math.round(inWindow.reduce((n, x) => n + costOf(x.tokens.executor), 0)) }
  const last = rounds.at(-1)
  const final = last?.official ? { round: last.m.round, passed: last.official.passed!, total: last.official.total! } : null
  const bar = o.bar ?? 948
  let verdict: MeasuresSummary["verdict"] = null
  if (o.controlCost && o.controlCost > 0) {
    const ratio = Math.round(window.non_executor_cost / o.controlCost * 1000) / 1000
    const passes = !!final && final.round === to && final.passed >= bar
    verdict = { control_cost: o.controlCost, ratio, bar, outcome: ratio <= 0.5 && passes ? "IC wins" : ratio >= 0.8 || !passes ? "fails" : "not shown" }
  }
  return { rounds, window, final, verdict }
}

export function renderMeasures(s: MeasuresSummary): string {
  const sc = (x: ScoreLine | null) => x ? `${x.passed}/${x.total}` : ""
  const tok = (t: RoundMeasures["tokens"][keyof RoundMeasures["tokens"]]) => `${(t.uncached_input / 1e6).toFixed(2)}M/${(t.cache_read / 1e6).toFixed(2)}M/${(t.output / 1e6).toFixed(2)}M`
  const by = (r: Record<string, number>) => Object.entries(r).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ") || "0"
  const lines = [
    "| round | official | first delivery | wall (s) | guards | regressions | reverted | blocked | logged | fallback (items) | no run seen | executor tokens | reviewer tokens | formalizer tokens | checks tokens | non-executor cost |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...s.rounds.map(({ m, official, first }) => `| R${m.round} | ${sc(official)} | ${sc(first)} | ${(m.wall_ms / 1000).toFixed(0)} | ${m.guards.at_start}→${m.guards.at_end} | ${m.regressions.changed_text + m.regressions.unchanged} | ${m.reverted} | ${by(m.premise.blocked)} | ${by(m.premise.logged)} | ${m.fallback.reviews} (${m.fallback.items}) | ${m.program_runs_zero} | ${tok(m.tokens.executor)} | ${tok(m.tokens.reviewer)} | ${tok(m.tokens.formalizer)} | ${tok(m.tokens.checks)} | ${m.non_executor_cost} |`),
    "",
    `Window R${s.window.from}–R${s.window.to} (${s.window.rounds} rounds): non-executor cost ${s.window.non_executor_cost}; executor cost ${s.window.executor_cost} (uncached input + 0.1 × cache read + output).`,
    `Final: ${s.final ? `R${s.final.round} ${s.final.passed}/${s.final.total}` : "no official score yet"}.`,
    s.verdict ? `Preregistered verdict (§12i): IC/control = ${s.window.non_executor_cost}/${s.verdict.control_cost} = ${s.verdict.ratio}; bar ${s.verdict.bar}: **${s.verdict.outcome}**.` : "Preregistered verdict: give --control-cost (the control arm's R5–R15 non-executor cost in the same unit) to compute it.",
  ]
  const stages = [...new Set(s.rounds.flatMap(r => Object.keys(r.m.stages_ms)))]
  if (stages.length) lines.push("", "Wall time by stage (s):", "", `| round | ${stages.join(" | ")} |`, `|---|${stages.map(() => "---").join("|")}|`, ...s.rounds.map(r => `| R${r.m.round} | ${stages.map(k => ((r.m.stages_ms[k] ?? 0) / 1000).toFixed(0)).join(" | ")} |`))
  return lines.join("\n") + "\n"
}
