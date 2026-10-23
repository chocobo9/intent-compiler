import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import ts from "typescript"
import * as adjudication from "../../src/exp2/adjudication.js"
import * as attribution from "../../src/exp2/attribution.js"
import * as checks from "../../src/exp2/checks.js"
import * as executor from "../../src/exp2/opencode-executor.js"
import * as judge from "../../src/exp2/judge.js"
import * as probes from "../../src/exp2/probes.js"
import { CARRIED_HEADER_REVIEW } from "../../src/exp2/serial.js"
import { REPAIR_INTRO } from "../../src/exp2/acceptance.js"
import { repairMessage, RESUME_NOTE } from "../../src/exp2/execution.js"

/**
 * BLOCK10 §7.1: nothing a model reads may come from the task's inputs, the official tests, or what earlier
 * experiments on this task found. Checked on two kinds of text: every prose string literal of src/exp2 (prompts,
 * schema descriptions, issue and repair templates: anything with a space and at least 20 characters) and the
 * fixed texts as rendered. Forbidden: the names the dpipe inputs define (single-token code spans and function names),
 * their multi-word code spans, their numeric values; the defect table's names and patterns; experiment 1's
 * ambiguities and the probe studies' findings. General vocabulary that any command-line requirement shares is
 * allowed, listed below with the reason; nothing else is.
 */

const root = resolve(process.cwd())
const inputs = readdirSync(join(root, "exp2/inputs/dpipe")).filter(f => f.endsWith(".md")).map(f => readFileSync(join(root, "exp2/inputs/dpipe", f), "utf8")).join("\n")
const spans = [...inputs.matchAll(/`([^`\n]+)`/gu)].map(m => m[1].trim())

/** Words every command-line requirement uses, or IC's own vocabulary; allowed although dpipe also names them. */
export const GENERAL: Record<string, string> = {
  as: "English", on: "English", if: "English", from: "English", to: "English", keep: "English", changes: "English", removed: "English", required: "English", valid: "English",
  id: "IC block and object ids", round: "IC rounds", detail: "IC request field (dispute.detail)", key: "IC check key; JSON key",
  name: "general", names: "general", value: "general", values: "general", input: "program input", inputs: "program input", output: "program output",
  file: "general", files: "general", path: "general", command: "command-line program", args: "argument vector", error: "general", message: "general",
  rule: "requirement rule", string: "JSON type", true: "JSON literal", false: "JSON literal", null: "JSON literal", type: "JSON / HTTP type", schema: "JSON schema",
  target: "IC assertion target", column: "IC assertion field csv_cell.column (checks only, off by default)",
}

const names = [...new Set([...spans.filter(s => /^[-A-Za-z_.0-9]+$/u.test(s) && s.length >= 2), ...spans.flatMap(s => [...s.matchAll(/\b([a-z_]+)\(/gu)].map(m => m[1]))])]
  .filter(n => !(n.toLowerCase() in GENERAL))
const phrases = spans.filter(s => s.length >= 12 && /\s/u.test(s))
const table = JSON.parse(readFileSync(join(root, "exp2/acceptance/r1-defects.json"), "utf8")) as { defects: { name: string; pattern: string }[] }
/** Experiment 1's ambiguities (JUDGE-STUDY §3) and the probe studies' findings (REPAIR-STUDY §2.3, PROBE-MODELS §2–3). */
const FINDINGS = ["prefix", "ERROR:", "-0", "empty file", "empty CSV", "multi-digit", "ties", "non-positive", "does not exist", "no value is numeric", "boundary", "banker"]

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
const word = (w: string) => new RegExp(`(^|[^A-Za-z0-9_])${esc(w)}($|[^A-Za-z0-9_])`, "iu")

/**
 * The modules whose prose reaches a model: prompts and schemas, issue messages sent back with a repair, check
 * failure details and work orders the executor reads, correction lists. The rest (state, config, checkpoints, local
 * tools) only talks to the person running it.
 */
const MODEL_FACING = ["adjudication.ts", "attribution.ts", "checks.ts", "execution.ts", "judge.ts", "opencode-executor.ts", "probes.ts", "verdict.ts", "view.ts", "workorder.ts", "discrimination.ts"].filter(f => existsSync(join(root, "src/exp2", f)))

/** A defect pattern's literal alternatives (words and phrases), and the patterns that combine terms, as regexes. */
const defectTerms = table.defects.filter(d => !d.pattern.includes("[\\s\\S]*")).flatMap(d => d.pattern.split("|").map(a => a.replace(/\\b/gu, "").replace(/\\(.)/gu, "$1"))
  .filter(a => !/[[\]*+?{}^$]/u.test(a) && a.length >= 3 && !(a.toLowerCase() in GENERAL)))
const defectCombos = table.defects.filter(d => d.pattern.includes("[\\s\\S]*")).map(d => new RegExp(d.pattern, "iu"))

function proseLiterals(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = []
  for (const f of MODEL_FACING) {
    const sf = ts.createSourceFile(f, readFileSync(join(root, "src/exp2", f), "utf8"), ts.ScriptTarget.Latest, true)
    const add = (t: string) => { if (t.length >= 20 && /\s/u.test(t)) out.push({ where: f, text: t }) }
    const visit = (n: ts.Node) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n.text)
      else if (ts.isTemplateExpression(n)) { add(n.head.text); for (const s of n.templateSpans) add(s.literal.text) }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return out
}

function rendered(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = []
  for (const [m, mod] of Object.entries({ adjudication, attribution, checks, executor, judge, probes }) as [string, Record<string, unknown>][]) for (const [k, v] of Object.entries(mod)) {
    if (k.endsWith("SYSTEM_PROMPT")) out.push({ where: `${m}.${k}`, text: v as string })
    if (k.endsWith("_SCHEMA")) JSON.stringify(v, (key, x) => { if (key === "description") out.push({ where: `${m}.${k}`, text: x as string }); return x })
  }
  out.push({ where: "repairMessage", text: repairMessage("", { ok: true, output: "" }, "") }, { where: "repairMessage(build)", text: repairMessage("", { ok: false, output: "" }) })
  out.push({ where: "correction note", text: judge.renderCorrections([{ key: "P1/U1", probe: "P1", rule: { id: "U1", text: "" }, call: [], input_files: [], actual: { exit_code: 0, timed_out: false, stdout: "", stderr: "", files: {} }, finding: "", passed_before: true }], "prog") })
  out.push({ where: "CARRIED_HEADER_REVIEW", text: CARRIED_HEADER_REVIEW }, { where: "REPAIR_INTRO", text: REPAIR_INTRO }, { where: "RESUME_NOTE", text: RESUME_NOTE })
  return out
}

describe("exp2 block 10b: model-facing text carries nothing from the task, its tests, or earlier findings", () => {
  const texts = [...proseLiterals(), ...rendered()]

  it("the forbidden lists are not empty (the extraction works)", () => {
    assert.ok(names.length > 150 && ["filter", "log", "window", "NaN", "pivot", "--input"].every(n => names.includes(n)))
    assert.ok(phrases.some(p => p.startsWith("ERROR:")))
    assert.ok(["-Inf", "ntile", "unary", "pivot", "header", "crash"].every(a => defectTerms.includes(a)) && defectCombos.length >= 3)
    assert.ok(texts.length > 100 && texts.some(t => t.where === "probes.PROBES_SYSTEM_PROMPT"))
  })

  it("no dpipe name, message or value", () => {
    const hits = texts.flatMap(t => [...names.filter(n => word(n).test(t.text)), ...phrases.filter(p => t.text.includes(p))].map(n => `${t.where}: ${JSON.stringify(n)} in ${JSON.stringify(t.text.slice(0, 80))}`))
    assert.deepEqual(hits, [])
  })

  it("nothing from the defect table, experiment 1's ambiguities or the probe studies' findings", () => {
    const hits = texts.flatMap(t => [
      ...table.defects.filter(d => t.text.toLowerCase().includes(d.name.toLowerCase())).map(d => `defect ${d.name}`),
      ...defectTerms.filter(a => (/^\w/u.test(a) && /\w$/u.test(a) ? word(a).test(t.text) : t.text.includes(a))).map(a => `defect term ${JSON.stringify(a)}`),
      ...defectCombos.filter(re => re.test(t.text)).map(re => `defect pattern ${re.source}`),
      ...FINDINGS.filter(f => (f.includes(":") || f.startsWith("-") ? t.text.includes(f) : word(f).test(t.text))).map(f => `finding ${JSON.stringify(f)}`),
    ].map(x => `${t.where}: ${x} in ${JSON.stringify(t.text.slice(0, 80))}`))
    assert.deepEqual(hits, [])
  })
})
