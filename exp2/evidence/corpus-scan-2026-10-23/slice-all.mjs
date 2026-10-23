import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { splitRound, tilingProblems } from "file:///C:/Users/HuaWeiClient/AppData/Local/Temp/claude/D--huawei-intent-compiler/cd3435e0-a941-43f3-a613-ebbc62edcffa/scratchpad/bfix/dist/exp2/source.js"
const dir = "D:/huawei/EvoCodeBench/docs/data/tasks"
const rows = []
for (const f of readdirSync(dir).filter(x => x.endsWith(".json")).sort()) {
  const d = JSON.parse(readFileSync(join(dir, f), "utf8"))
  const row = { task: d.meta.name, rounds: d.n_rounds, levels: { section: 0, paragraph: 0, sentence: 0, clause: 0 }, kinds: {}, problems: 0, errors: [] , problem_samples: [] }
  for (const r of d.rounds) {
    try {
      const s = splitRound(r.n, r.md ?? "", { clauses: true })
      for (const b of s.blocks) { row.levels[b.level] = (row.levels[b.level] ?? 0) + 1; row.kinds[b.kind] = (row.kinds[b.kind] ?? 0) + 1 }
      const p = tilingProblems(s); row.problems += p.length; if (p.length && row.problem_samples.length < 3) row.problem_samples.push(`R${r.n}: ${p[0].slice(0, 160)}`)
    } catch (e) { row.errors.push(`R${r.n}: ${String(e.message ?? e).slice(0, 160)}`) }
  }
  rows.push(row)
}
writeFileSync("C:/Users/HuaWeiClient/AppData/Local/Temp/claude/D--huawei-intent-compiler/cd3435e0-a941-43f3-a613-ebbc62edcffa/scratchpad/corpus/slice.json", JSON.stringify(rows, null, 1))
console.log("task".padEnd(38), "R", "sect", "para", "sent", "clause", "code", "table", "probs", "errs")
for (const r of rows) console.log(r.task.slice(0, 38).padEnd(38), String(r.rounds).padStart(2), String(r.levels.section).padStart(4), String(r.levels.paragraph).padStart(4), String(r.levels.sentence).padStart(5), String(r.levels.clause).padStart(6), String(r.kinds.code ?? 0).padStart(4), String(r.kinds.table ?? 0).padStart(5), String(r.problems).padStart(5), String(r.errors.length).padStart(4), r.errors[0] ?? r.problem_samples[0] ?? "")
