// Experiment 1, run and judge (prototype, not IC code).
//   node run-judge.mjs run <probes.json> <label>        -> runs every probe on the 16 R1 products in docker
//   node run-judge.mjs prompts <label> <judge> [size]    -> writes judge requests over the distinct (probe, output) items
//   node run-judge.mjs merge <label> <judge>             -> merges judge answers into a correction list per product
// A judge sees a unit's text, the probe's input and the program's actual output, and says whether the output follows
// the unit. It never sees an expected value, another product, or official results.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const PRODUCTS = process.env.PRODUCTS ? process.env.PRODUCTS.split(",") : ["bare_219", "bare_rep2_218", "bare_rep3_218", "bare_rep4_218", "shell_191", "cf_218", "cf_rep2_217", "cf_rep3_203", "cf_rep4_215", "IC_215", "luna56m_201", "luna56m_208", "luna56m_219", "luna6m_91", "luna6m_84", "luna6m_122"]
const BUILDS = join(process.cwd(), "hk2", "detect9", "builds")
const units = Object.fromEntries(JSON.parse(readFileSync("hk2/judge/r1-units.json", "utf8")).map(u => [u.id, u.text]))
const cut = (s, n = 1500) => (s.length > n ? s.slice(0, n) + `…(${s.length - n} more chars)` : s)
const norm = r => ({ exit_code: r.exit_code, stdout: cut(r.stdout.replace(/\r/gu, "")), stderr: cut(r.stderr.replace(/\r/gu, "")), timed_out: r.timed_out,
  files: Object.fromEntries(Object.entries(r.files).filter(([p]) => !p.startsWith("__")).map(([p, c]) => [p, cut(c.replace(/\r/gu, ""))])) })

export const JUDGE_SYSTEM = [
  "You judge whether a command-line program follows its requirements. Each item is one run: the requirement units it exercises (exact text), the call and its input files, and what the program actually did (exit code, stdout, stderr, files left in the directory, including the inputs).",
  "For each item decide: ok (the output follows every listed unit as far as this run shows), wrong (it contradicts a unit: say which unit and what the text requires versus what happened), or cannot_tell (this run does not show it, or the text leaves it open).",
  "Judge only against the units' text and the full requirements given for context. Do not assume behaviour the text does not state.",
].join("\n")
export const JUDGE_SCHEMA = { type: "object", additionalProperties: false, required: ["verdicts"], properties: { verdicts: { type: "array", items: { type: "object", additionalProperties: false, required: ["item", "verdict", "unit", "reason"], properties: {
  item: { type: "string" }, verdict: { type: "string", enum: ["ok", "wrong", "cannot_tell"] }, unit: { type: "string" }, reason: { type: "string" } } } } } }

const [mode, a, b, c] = process.argv.slice(2)
if (mode === "run") {
  const { DockerRunner } = await import("../../.test-dist/src/exp2/docker.js")
  const runner = new DockerRunner({ image: "sdd-unattended-preflight:latest" })
  const probes = JSON.parse(readFileSync(a, "utf8")).probes
  const runs = {}
  for (const p of PRODUCTS) {
    runs[p] = {}
    const program = { id: p, label: p, command: ["/prog/dpipe"], source_dir: null, mount: { host: join(BUILDS, `detect-${p}`), container: "/prog" } }
    for (const pr of probes) runs[p][pr.id] = norm(await runner.run(program, { args: pr.args, files: pr.files.map(f => ({ path: f.path, content: f.content })) }, 20_000))
    console.log(p, "done")
  }
  writeFileSync(`hk2/judge/runs-${b}.json`, JSON.stringify(runs))
} else if (mode === "prompts") {
  const label = a, judge = b, size = Number(c ?? 50)
  const probes = Object.fromEntries(JSON.parse(readFileSync(`hk2/judge/probes-${label}.json`, "utf8")).probes.map(p => [p.id, p]))
  const runs = JSON.parse(readFileSync(`hk2/judge/runs-${label}.json`, "utf8"))
  const items = new Map()
  for (const p of PRODUCTS) for (const [pid, out] of Object.entries(runs[p])) {
    const key = pid + "\u0000" + JSON.stringify(out)
    if (!items.has(key)) items.set(key, { item: `I${items.size + 1}`, probe: pid, out, products: [] })
    items.get(key).products.push(p)
  }
  const list = [...items.values()]
  writeFileSync(`hk2/judge/items-${label}.json`, JSON.stringify(list.map(i => ({ item: i.item, probe: i.probe, products: i.products }))))
  const text = readFileSync("exp2/inputs/dpipe/round-01.md", "utf8")
  // A batch holds at most one output of each probe, so a judge never sees two products' answers to the same call
  // (that would be a differential test, which the real flow does not have: it judges one product).
  const byProbe = new Map()
  for (const it of list) byProbe.set(it.probe, [...(byProbe.get(it.probe) ?? []), it])
  const layers = Math.max(...[...byProbe.values()].map(v => v.length))
  const batches = []
  for (let k = 0; k < layers; k++) {
    const layer = [...byProbe.values()].map(v => v[k]).filter(Boolean)
    for (let i = 0; i < layer.length; i += size) batches.push(layer.slice(i, i + size))
  }
  let n = 0
  for (const chunk of batches) {
    const batch = chunk.map(it => ({ item: it.item, units: probes[it.probe].units.map(u => ({ id: u, text: units[u] ?? "(unknown unit)" })), call: ["dpipe", ...probes[it.probe].args], input_files: probes[it.probe].files.map(f => ({ path: f.path, content: cut(f.content, 800) })), result: it.out }))
    const prompt = `# SYSTEM\n${JUDGE_SYSTEM}\n\n# OUTPUT JSON SCHEMA (answer with one JSON object matching it, nothing else)\n${JSON.stringify(JUDGE_SCHEMA)}\n\n# REQUEST\n${JSON.stringify({ requirements: text, items: batch })}\n`
    writeFileSync(`hk2/judge/judge-${label}-${judge}-${++n}.md`, prompt)
  }
  console.log("distinct items", list.length, "batches", n)
} else if (mode === "merge") {
  const label = a, judge = b
  const items = JSON.parse(readFileSync(`hk2/judge/items-${label}.json`, "utf8"))
  const verdicts = {}
  for (let n = 1; existsSync(`hk2/judge/judge-${label}-${judge}-${n}.json`); n++) for (const v of JSON.parse(readFileSync(`hk2/judge/judge-${label}-${judge}-${n}.json`, "utf8")).verdicts) verdicts[v.item] = v
  const lists = Object.fromEntries(PRODUCTS.map(p => [p, []]))
  let missing = 0
  for (const it of items) {
    const v = verdicts[it.item]
    if (!v) { missing++; continue }
    if (v.verdict === "wrong") for (const p of it.products) lists[p].push({ probe: it.probe, unit: v.unit, reason: v.reason })
  }
  writeFileSync(`hk2/judge/corrections-${label}-${judge}.json`, JSON.stringify(lists, null, 1))
  console.log("items without a verdict:", missing)
  for (const p of PRODUCTS) console.log(p.padEnd(15), lists[p].length, [...new Set(lists[p].map(x => x.unit))].join(" "))
}
