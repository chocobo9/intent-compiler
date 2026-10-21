// Experiment 1, probes (prototype, not IC code). The probe writer gets the round's original text and its rule units
// and returns inputs that exercise each unit — never an expected output. Code then measures which units no probe
// covers and no reason excuses, and asks once more for those.
//   node probes.mjs prompt <label> [answer-file]   -> writes the request (with coverage issues of the answer, if given)
//   node probes.mjs check <answer-file>             -> prints coverage of an answer
import { readFileSync, writeFileSync } from "node:fs"

const units = JSON.parse(readFileSync("hk2/judge/r1-units.json", "utf8"))
const text = readFileSync("exp2/inputs/dpipe/round-01.md", "utf8")
export const SYSTEM = [
  "You write probes for a command-line program, from its requirements. A probe is one call of the program: arguments and the input files it needs. Probes run in an empty directory; the files you list are written there first; the program is called as `dpipe <args>`.",
  "Each unit below states a specific rule (a value, a format, a boundary, an error). Write probes so that every unit is exercised: running the probe makes the program show whether it follows that unit. A probe may exercise several units; list them all. Prefer inputs where a wrong program would visibly differ (for example boundary values, empty cells, a missing column).",
  "Do not write expected outputs. Someone else will judge the output against the unit's text.",
  "If a unit cannot be shown by running the program (for example a statement about source code or build), list it under uncheckable with a reason.",
].join("\n")
export const SCHEMA = { type: "object", additionalProperties: false, required: ["probes", "uncheckable"], properties: {
  probes: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "units", "args", "files"], properties: {
    id: { type: "string" }, units: { type: "array", items: { type: "string" } }, args: { type: "array", items: { type: "string" } },
    files: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } } } } } },
  uncheckable: { type: "array", items: { type: "object", additionalProperties: false, required: ["unit", "reason"], properties: { unit: { type: "string" }, reason: { type: "string" } } } } } }

export function gaps(answer) {
  const covered = new Set(answer.probes.flatMap(p => p.units))
  const excused = new Set(answer.uncheckable.map(u => u.unit))
  return units.filter(u => !covered.has(u.id) && !excused.has(u.id))
}

const [mode, a, b] = process.argv.slice(2)
if (mode === "prompt") {
  const prev = b ? JSON.parse(readFileSync(b, "utf8")) : null
  const missing = prev ? gaps(prev) : []
  const request = {
    requirements: text,
    units: units.map(u => ({ id: u.id, text: u.text })),
    ...(prev ? { previous_answer: prev, uncovered_units: missing.map(u => ({ id: u.id, text: u.text })), task: "Keep the previous probes and add probes (or uncheckable entries) for exactly the uncovered units; return the whole answer." } : {}),
  }
  const prompt = `# SYSTEM\n${SYSTEM}\n\n# OUTPUT JSON SCHEMA (answer with one JSON object matching it, nothing else)\n${JSON.stringify(SCHEMA)}\n\n# REQUEST\n${JSON.stringify(request)}\n`
  writeFileSync(`hk2/judge/probe-prompt-${a}.md`, prompt)
  console.log("prompt", prompt.length, "chars; uncovered in previous:", missing.length)
} else if (mode === "check") {
  const ans = JSON.parse(readFileSync(a, "utf8"))
  const g = gaps(ans)
  console.log("probes", ans.probes.length, "uncheckable", ans.uncheckable.length, "uncovered", g.length, g.map(u => u.id).join(" "))
}
