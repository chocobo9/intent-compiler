import type { ModelReply } from "../../src/exp2/attribution.js"
import type { JudgeItem, JudgeRequest, JudgeTransport, Verdict } from "../../src/exp2/judge.js"
import type { ProbeDraft, ProbeRequest, ProbesAnswer, ProbeTransport } from "../../src/exp2/probes.js"

/**
 * Stand-ins for the probe writer and the judge (DEV-GUIDELINES §3). The writer knows one real probe (filter on
 * multi-digit values) and writes a generic one for every other unit, its trigger value taken from the unit's own
 * code or number; its first answer can carry the usual mistakes (a trigger value not in the input, too many units in
 * one probe). The judge reads the filter probe's output file for real and answers per a table otherwise.
 */

export const FILTER_DATA = "id,value\n1,5\n2,20\n3,3\n4,12\n"
export const filterProbe = (unit: string): ProbeDraft => ({
  id: "filter-gt", args: ["transform", "--input", "data.csv", "--recipe", "recipe.json", "--output", "out.csv", "--seed", "1"], invalid_on_purpose: false,
  files: [{ path: "data.csv", content: FILTER_DATA }, { path: "recipe.json", content: `[{"op":"filter","column":"value","condition":"gt","threshold":10}]` }],
  covers: [{ unit, trigger_values: ["\"gt\"", "10", "20", "12"], wrong_would: "keeps 5 and 3, or compares as text" }],
})

export const sortProbe = (unit: string): ProbeDraft => ({
  id: "sort-asc", args: ["transform", "--input", "data.csv", "--recipe", "recipe.json", "--output", "out.csv", "--seed", "1"], invalid_on_purpose: false,
  files: [{ path: "data.csv", content: FILTER_DATA }, { path: "recipe.json", content: `[{"op":"sort","column":"value","order":"asc"}]` }],
  covers: [{ unit, trigger_values: ["\"asc\"", "20", "5"], wrong_would: "sorts 20 before 5 (as text)" }],
})

const token = (text: string) => /`([^`]+)`/u.exec(text)?.[1] ?? /\d+/u.exec(text)?.[0] ?? text.trim().split(/\s+/u)[0]

export function stubProbeWriter(options: { mistakes?: boolean } = {}): ProbeTransport & { requests: ProbeRequest[] } {
  const requests: ProbeRequest[] = []
  const t = async (request: ProbeRequest): Promise<ModelReply> => {
    requests.push(request)
    const probes: ProbeDraft[] = request.units.map((u, i) => /`filter`: Keep rows/u.test(u.text)
      ? filterProbe(u.id)
      : /`sort`: Sort rows/u.test(u.text) ? sortProbe(u.id)
      : { id: `u${i + 1}`, args: ["describe", token(u.text)], files: [], invalid_on_purpose: false, covers: [{ unit: u.id, trigger_values: [token(u.text)], wrong_would: "ignores it" }] })
    const first = !request.previous_answer
    if (options.mistakes && first && probes.length > 5) {
      // A trigger value the probe does not contain, and five units in one probe.
      probes[0] = { ...probes[0], covers: [{ ...probes[0].covers[0], trigger_values: ["not-in-the-probe"] }] }
      probes[1] = { ...probes[1], covers: [...probes[1].covers, ...probes.slice(2, 6).map(p => p.covers[0])] }
    }
    const answer: ProbesAnswer = { probes, uncheckable: [] }
    return { text: JSON.stringify(answer), stub: true, usage: { input_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 200, reasoning_tokens: 0 } }
  }
  return Object.assign(t, { requests })
}

/** The sort rule judged for real: the output's values in ascending numeric order. */
export function sortVerdict(item: JudgeItem): { verdict: Verdict; reason: string } {
  const out = item.result.files["out.csv"]
  if (out === undefined) return { verdict: "wrong", reason: `no output file; exit ${item.result.exit_code}: ${item.result.stderr.slice(0, 80)}` }
  const vs = out.trim().split("\n").slice(1).map(r => Number(r.split(",")[1]))
  return vs.every((v, i) => i === 0 || vs[i - 1] <= v) ? { verdict: "ok", reason: "ascending" } : { verdict: "wrong", reason: `not ascending: ${vs.join(", ")}` }
}

/** The filter rule judged for real: rows with value ≤ 10 in the output are wrong. */
export function filterVerdict(item: JudgeItem): { verdict: Verdict; reason: string } {
  const out = item.result.files["out.csv"]
  if (out === undefined) return { verdict: "wrong", reason: `no output file; exit ${item.result.exit_code}: ${item.result.stderr.slice(0, 80)}` }
  const kept = out.trim().split("\n").slice(1).map(r => Number(r.split(",")[1]))
  return kept.some(v => !(v > 10)) ? { verdict: "wrong", reason: `the text keeps rows where value > 10; the output keeps ${kept.join(", ")}` } : { verdict: "ok", reason: "only rows above the threshold" }
}

export function stubJudge(table: (item: JudgeItem, unit: string) => { verdict: Verdict; reason: string } | null = () => null): JudgeTransport & { requests: JudgeRequest[] } {
  const requests: JudgeRequest[] = []
  const t = async (request: JudgeRequest): Promise<ModelReply> => {
    requests.push(request)
    const verdicts = request.items.flatMap(item => item.units.map(u => {
      const recipe = item.input_files.find(f => f.path === "recipe.json")?.content ?? ""
      const v = table(item, u.id) ?? (recipe.includes("\"filter\"") ? filterVerdict(item) : recipe.includes("\"sort\"") ? sortVerdict(item) : { verdict: "cannot_tell" as Verdict, reason: "this run does not show it" })
      return { item: item.item, unit: u.id, ...v }
    }))
    return { text: JSON.stringify({ verdicts }), stub: true, usage: { input_tokens: 500, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 50, reasoning_tokens: 0 } }
  }
  return Object.assign(t, { requests })
}
