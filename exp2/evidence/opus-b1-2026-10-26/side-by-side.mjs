import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
const RUNS = "D:/huawei/EvoCodeBench/harbor_runs"
const { readCases } = await import(pathToFileURL(join(process.cwd(), "exp2/evidence/prereg/ledger.mjs")).href)
const lines = f => existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : []
const ic = name => { const d = join(RUNS, `exp2-icacc-r6-luna56-low-${name}`); const sc = lines(join(d, "checkpoints", "scores.jsonl")); const ms = lines(join(d, "checkpoints", "measures.jsonl")); return { name, final: r => sc.find(x => x.round === r && !x.kind)?.passed, first: r => sc.find(x => x.round === r && x.kind === "first_delivery")?.passed, total: r => sc.find(x => x.round === r && !x.kind)?.total, cost: ms.reduce((n, m) => n + (m.non_executor_cost ?? 0), 0), wall: ms.reduce((n, m) => n + m.wall_ms, 0) / 60000 } }
const ctrl = c => ({ name: c.replace(/^exp2-review15-luna56-low-revmed-/u, "").replace(/-dpipe-20261022$/u, ""), final: r => { const dir = join(RUNS, c, "official", `round-${String(r).padStart(2, "0")}`); const sub = existsSync(dir) ? readdirSync(dir) : []; if (sub.length !== 1) return undefined; const m = readCases(join(dir, sub[0], "verifier.log")); return [...m.values()].filter(x => x.ok).length } })
const runs = ["opusb3-20261026", "rep1j3-20261026", "rep1j-20261025"].map(ic)
const ctrls = ["exp2-review15-luna56-low-revmed-rep1-dpipe-20261022", "exp2-review15-luna56-low-revmed-rep2-dpipe-20261022"].map(ctrl)
const md = ["| round | total | opusb3 (first → end) | rep1j3 (first → end) | rep1j (first → end) | control rep1 | control rep2 |", "|---|---|---|---|---|---|---|"]
for (const r of [1, 2, 3, 4, 5, 6]) md.push(`| R${r} | ${runs[0].total(r)} | ${runs.map(x => `${x.first(r)} → ${x.final(r)}`).join(" | ")} | ${ctrls.map(c => c.final(r)).join(" | ")} |`)
md.push("", `| | opusb3 | rep1j3 | rep1j |`, "|---|---|---|---|", `| non-executor cost, six rounds | ${runs.map(x => (x.cost / 1e6).toFixed(2) + "M").join(" | ")} |`, `| wall, six rounds | ${runs.map(x => x.wall.toFixed(0) + " min").join(" | ")} |`)
console.log(md.join("\n"))
writeFileSync(process.argv[2], md.join("\n") + "\n")
