// Scores correction lists against the R1 defect corpus by area. A judge flag counts for the area of the object that
// owns its unit (Haiku attribution); an official failure counts for the area of its requirement_ref.
import { readFileSync } from "node:fs"
import { Exp2Store } from "../../.test-dist/src/exp2/store.js"
const [label, judge] = process.argv.slice(2)
const store = new Exp2Store("hk2/checks-run/store", "haiku-checks"); const reg = store.registry(store.inspect())
const area = id => { const o = reg.coverOf(id)?.owner; const n = (reg.objects.get(o)?.name ?? "?").toLowerCase(); const a = n.replace(/^dpipe /u, "").split(/\s+/u)[0]; return a === "expression" ? "derive" : a }
const corpus = JSON.parse(readFileSync("../corpus/r1-corpus.json", "utf8"))
const map = { "high_bare_1": "bare_219", "high_bare_2": "bare_rep2_218", "high_bare_3": "bare_rep3_218", "high_bare_4": "bare_rep4_218", "high_shell": "shell_191", "high_cf_1": "cf_218", "high_cf_2": "cf_rep2_217", "high_cf_3": "cf_rep3_203", "high_cf_4": "cf_rep4_215", "high_IC": "IC_215", "l56m_1": "luna56m_201", "l56m_2": "luna56m_208", "l56m_3": "luna56m_219", "l6m_1": "luna6m_91", "l6m_2": "luna6m_84", "l6m_3": "luna6m_122" }
const reqArea = r => r.replace(/^transform\./u, "").split(/[.-]/u)[0]
const official = {}
for (const d of corpus) for (const n of Object.keys(d.failing)) (official[map[n]] ??= new Set()).add(reqArea(d.requirement))
const lists = JSON.parse(readFileSync(`hk2/judge/corrections-${label}-${judge}.json`, "utf8"))
let tp = 0, fn = 0, fp = 0
const rows = []
for (const [p, items] of Object.entries(lists)) {
  const flagged = new Set(items.flatMap(x => x.unit.split(/[ ,;]+/u).filter(u => /^R1\./u.test(u)).map(u => area(u.replace(/-s\d+$/u, "")))))
  const off = official[p] ?? new Set()
  const hit = [...off].filter(a => flagged.has(a)), miss = [...off].filter(a => !flagged.has(a)), extra = [...flagged].filter(a => !off.has(a))
  tp += hit.length; fn += miss.length; fp += extra.length
  rows.push(`${p.padEnd(15)} official ${[...off].join(",") || "-"} | found ${hit.join(",") || "-"} | missed ${miss.join(",") || "-"} | flagged but officially passing ${extra.join(",") || "-"}`)
}
console.log(rows.join("\n")); console.log(`\nareas found ${tp}, missed ${fn}, flagged-but-officially-passing ${fp}`)
