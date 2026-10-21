// Structured probe writing (prototype). Code splits the round's rule units into groups; for each group the model fills,
// per unit, the probe that exercises it, the literal trigger values in that probe's input, and how a wrong program would
// differ. Code then checks each answer and sends back exact problems, at most twice:
//   - every unit of the group covered;
//   - a probe covers at most MAX_UNITS units;
//   - each trigger value occurs literally in that probe's args or files;
//   - files the args name exist; .json files parse; .csv rows have the header's column count.
//   node probes2.mjs <label> <model> <variant>     -> writes hk2/judge/probes-<label>.json and usage
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

export const MAX_UNITS = 4, GROUP = 22
const units = JSON.parse(readFileSync("hk2/judge/r1-units.json", "utf8"))
const text = readFileSync("exp2/inputs/dpipe/round-01.md", "utf8")
export const SYSTEM = [
  "You write probes for a command-line program from its requirements. A probe is one call: `dpipe <args>` in an empty directory holding the files you list.",
  "You get a group of rule units (exact text). For every unit, give the probe that exercises it and fill three fields:",
  "- trigger_values: the exact strings in that probe's args or file contents that make the rule apply (for example a value 0 for a rule about non-positive input, a column name that does not exist for an error rule). Each must appear literally in the probe.",
  "- wrong_would: what a plausible wrong program would output for this input instead (so that the input tells right from wrong; choose data where they differ).",
  `A probe may serve at most ${MAX_UNITS} units. Do not write expected outputs. If a unit cannot be shown by running the program, mark it uncheckable with a reason.`,
  "Example (another program): unit 'round(x) rounds halves away from zero' -> probe args [\"calc\",\"--expr\",\"round(-2.5)\"], trigger_values [\"-2.5\"], wrong_would \"-2 (banker's rounding) or -3 is right\".",
].join("\n")
export const SCHEMA = { type: "object", additionalProperties: false, required: ["probes", "uncheckable"], properties: {
  probes: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "args", "files", "covers", "invalid_on_purpose"], properties: {
    id: { type: "string" }, args: { type: "array", items: { type: "string" } }, invalid_on_purpose: { type: "boolean", description: "true when the probe deliberately gives a missing or malformed input to exercise an error rule" },
    files: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } } },
    covers: { type: "array", items: { type: "object", additionalProperties: false, required: ["unit", "trigger_values", "wrong_would"], properties: {
      unit: { type: "string", description: "the unit id from the request, for example R1.S3.P5.s8 (not its text)" }, trigger_values: { type: "array", items: { type: "string" } }, wrong_would: { type: "string" } } } } } } },
  uncheckable: { type: "array", items: { type: "object", additionalProperties: false, required: ["unit", "reason"], properties: { unit: { type: "string" }, reason: { type: "string" } } } } } }

export function problems(answer, group) {
  const p = []
  const ids = new Set(group.map(u => u.id))
  const covered = new Set(), excused = new Set(answer.uncheckable.map(u => u.unit))
  for (const pr of answer.probes) {
    const hay = [...pr.args, ...pr.files.flatMap(f => [f.path, f.content])].join("\n")
    if (pr.covers.length > MAX_UNITS) p.push(`probe ${pr.id} serves ${pr.covers.length} units; at most ${MAX_UNITS}: split it`)
    for (const c of pr.covers) {
      if (!ids.has(c.unit)) { p.push(`probe ${pr.id}: unit ${c.unit} is not in this group`); continue }
      const missing = c.trigger_values.filter(v => !v || !hay.includes(v))
      if (!c.trigger_values.length) p.push(`probe ${pr.id}, unit ${c.unit}: no trigger_values`)
      else if (missing.length) p.push(`probe ${pr.id}, unit ${c.unit}: trigger value(s) ${missing.map(v => JSON.stringify(v)).join(", ")} do not occur in the probe's args or files`)
      else covered.add(c.unit)
    }
    if (pr.invalid_on_purpose) continue
    const names = new Set(pr.files.map(f => f.path))
    for (const a of pr.args) if (/\.(csv|json)$/u.test(a) && !names.has(a) && !/^out|output|result/u.test(a) && pr.args[pr.args.indexOf(a) - 1] !== "--output") p.push(`probe ${pr.id}: argument ${a} names a file the probe does not give`)
    for (const f of pr.files) {
      if (f.path.endsWith(".json")) { try { JSON.parse(f.content) } catch { p.push(`probe ${pr.id}: ${f.path} is not valid JSON`) } }
      if (f.path.endsWith(".csv")) { const rows = f.content.replace(/\n$/u, "").split("\n"); const n = rows[0].split(",").length; const bad = rows.findIndex(r => r.split(",").length !== n); if (bad > 0 && !rows[bad].includes("\"")) p.push(`probe ${pr.id}: ${f.path} row ${bad} has ${rows[bad].split(",").length} fields, the header has ${n}`) }
    }
  }
  const gaps = group.filter(u => !covered.has(u.id) && !excused.has(u.id))
  if (gaps.length) p.push(`units not exercised by any probe with valid trigger values: ${gaps.map(u => u.id).join(", ")}`)
  return p
}

const [label, model, variant] = process.argv.slice(2)
if (import.meta.url === pathToFileURL(process.argv[1]).href && label) {
  const groups = []
  for (let i = 0; i < units.length; i += GROUP) groups.push(units.slice(i, i + GROUP))
  const all = { probes: [], uncheckable: [] }, usage = []
  for (const [gi, group] of groups.entries()) {
    let answer = null, issues = []
    for (let attempt = 1; attempt <= 3; attempt++) {
      const request = { requirements: text, units: group.map(u => ({ id: u.id, text: u.text })), ...(answer ? { previous_answer: answer, problems: issues, task: "Fix exactly these problems and return the whole answer for this group." } : {}) }
      const file = `hk2/judge/p2-${label}-g${gi + 1}-a${attempt}`
      writeFileSync(file + ".md", `# SYSTEM\n${SYSTEM}\n\n# OUTPUT JSON SCHEMA (answer with one JSON object matching it, nothing else)\n${JSON.stringify(SCHEMA)}\n\n# REQUEST\n${JSON.stringify(request)}\n`)
      execFileSync(process.execPath, ["hk2/judge/luna-call.mjs", file + ".md", "hk2/judge/probes2.mjs#SCHEMA", file + ".json", model, variant], { stdio: "inherit" })
      answer = JSON.parse(readFileSync(file + ".json", "utf8"))
      usage.push({ group: gi + 1, attempt, ...JSON.parse(readFileSync(file + ".json.usage.json", "utf8")) })
      issues = problems(answer, group)
      console.log(`group ${gi + 1} attempt ${attempt}: ${answer.probes.length} probes, ${issues.length} problems`)
      if (!issues.length) break
    }
    for (const pr of answer.probes) all.probes.push({ ...pr, id: `g${gi + 1}_${pr.id}`, units: pr.covers.map(c => c.unit) })
    all.uncheckable.push(...answer.uncheckable)
    if (issues.length) all.unresolved = [...(all.unresolved ?? []), ...issues.map(i => `group ${gi + 1}: ${i}`)]
  }
  writeFileSync(`hk2/judge/probes-${label}.json`, JSON.stringify(all, null, 1))
  writeFileSync(`hk2/judge/probes-${label}.usage.json`, JSON.stringify(usage, null, 1))
  const t = usage.reduce((s, u) => ({ input: s.input + (u.tokens.input ?? 0), output: s.output + (u.tokens.output ?? 0), reasoning: s.reasoning + (u.tokens.reasoning ?? 0), cache: s.cache + (u.tokens.cache?.read ?? 0) }), { input: 0, output: 0, reasoning: 0, cache: 0 })
  console.log(label, "probes", all.probes.length, "calls", usage.length, "unresolved", (all.unresolved ?? []).length, "tokens", JSON.stringify(t))
}
