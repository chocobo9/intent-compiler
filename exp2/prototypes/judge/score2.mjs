// Scores correction lists on named official defects (reason text + probe id matched by pattern), and counts items on
// the two products that score 219/219 officially. Patterns were written from the official failures, before reading
// any correction list of these four sets.
import { readFileSync, existsSync } from "node:fs"
const D = [
  ["log(0) -> NaN", ["bare_rep3_218", "shell_191", "cf_rep2_217", "cf_rep4_215", "luna56m_208"], /log\(0\)|log\(x\)|-Inf|non-positive/i],
  ["window column name", ["bare_rep2_218", "IC_215"], /header|column name|empty name|blank|unnamed|`as`|as name/i],
  ["window crash", ["shell_191"], /panic|index out of range|crash/i],
  ["ntile", ["IC_215", "luna56m_201"], /ntile|tile/i],
  ["aggregate min/max", ["IC_215"], /\bmax\b|\bmin\b/i],
  ["expression parser", ["cf_rep3_203"], /missing \)|parse|function/i],
  ["expression operators", ["luna56m_201"], /NaN|precedence|comparison|logical|operator/i],
  ["unary minus", ["luna56m_208"], /unary|negat/i],
  ["avg no numeric -> NaN", ["luna56m_208"], /\bavg\b/i],
  ["window missing column error", ["luna56m_208"], /(window|partition|order_by)[^]*(not found|invalid reference)|(not found|invalid reference)[^]*(window|partition)/i],
  ["sort missing column error", ["luna56m_208"], /sort[^]*(nonexist|missing|nope|not found|exit)/i],
  ["pivot composite order", ["luna56m_208"], /pivot/i],
  ["sort numeric desc", ["cf_rep4_215"], /sort[^]*(desc|order|numeric|string)/i],
]
const labels = process.argv.slice(2)
const lists = Object.fromEntries(labels.map(l => [l, JSON.parse(readFileSync(`hk2/judge/corrections-${l}-luna.json`, "utf8"))]))
const hit = (l, p, re) => (lists[l][p] ?? []).some(x => re.test(`${x.probe} ${x.unit} ${x.reason}`))
console.log(["defect", ...labels].join(" | "))
const tot = Object.fromEntries(labels.map(l => [l, [0, 0]]))
for (const [name, prods, re] of D) {
  const cells = labels.map(l => { const n = prods.filter(p => hit(l, p, re)).length; tot[l][0] += n; tot[l][1] += prods.length; return `${n}/${prods.length}` })
  console.log([name, ...cells].join(" | "))
}
console.log(["TOTAL", ...labels.map(l => `${tot[l][0]}/${tot[l][1]}`)].join(" | "))
console.log(["items on 219 products (bare_219 + luna56m_219)", ...labels.map(l => (lists[l].bare_219?.length ?? 0) + (lists[l].luna56m_219?.length ?? 0))].join(" | "))
for (const l of labels) console.log(l, "on 219:", [...(lists[l].bare_219 ?? []), ...(lists[l].luna56m_219 ?? [])].map(x => x.reason.slice(0, 70)).join(" || "))
