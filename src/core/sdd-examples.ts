import type { AcceptanceExample, AcceptanceSubject } from "./sdd-contract.js"

const norm = (text: string) => text.replace(/\r\n/gu, "\n")

/** Exit codes the text states: "exit code 1", "exits with 2", "exit status 0", "exit 1". */
export function statedExitCodes(text: string): Set<number> {
  return new Set([...text.matchAll(/\bexit(?:s|ing)?\s*(?:with\s+)?(?:code|status)?\s*[`"]?(\d{1,3})\b/giu)].map(m => Number(m[1])))
}

/**
 * One assertion code runs: where to look (stdout, stderr, either, or an output
 * file), how (the exact whole, a verbatim part, or a requirement template whose
 * placeholders match anything), and the value.
 */
export interface ExampleAssertion { where: string; mode: "exact" | "contains" | "pattern" | "lines" | "exists" | "absent"; value: string; source: string }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
const NUMBERED = /(?<![A-Za-z0-9_])N(?![A-Za-z0-9_])/u

/**
 * Fixed texts the requirements write with <placeholders> (or a standalone N for a
 * number), each with a pattern that keeps every fixed part and lets every
 * placeholder match anything, and the line it stands on.
 */
export function placeholderTemplates(text: string): Array<{ template: string; pattern: RegExp; line: string; fixed: number }> {
  const out = new Map<string, string>()
  const lines = text.split("\n")
  for (const line of lines) {
    for (const m of line.matchAll(/`([^`]+)`/gu)) if (/<[^<>]+>/u.test(m[1]!) || NUMBERED.test(m[1]!)) out.set(m[1]!, line)
    if (/<[^<>\s][^<>]*>/u.test(line) && line.length <= 300 && !out.has(line.trim())) out.set(line.trim(), line)
  }
  // A template must keep enough fixed text to say something: `<path>` alone would match anything.
  const fixed = (t: string) => t.split(/<[^<>]+>/u).join("").replace(new RegExp(NUMBERED.source, "gu"), "").replace(/\s/gu, "").length
  return [...out].filter(([template]) => fixed(template) >= 8).map(([template, line]) => ({ template, line, fixed: fixed(template),
    pattern: new RegExp(template.split(/<[^<>]+>/u).map(part => escape(part).replace(new RegExp(NUMBERED.source, "gu"), "\\d+")).join(".+?"), "u") }))
    // The most specific template first.
    .sort((a, b) => b.fixed - a.fixed)
}

/** The stream the requirement's own line states for a text: stderr, stdout, or either when it states none. */
function statedStream(line: string): "stderr" | "stdout" | "either" {
  if (/\bstderr\b|standard error/iu.test(line)) return "stderr"
  if (/\bstdout\b|standard output/iu.test(line)) return "stdout"
  return "either"
}

/**
 * How code checks an example, built only from what the delivered requirements
 * write: a value written verbatim is checked verbatim; a value matching one of
 * their templates is checked by that template, placeholders matching anything
 * (so a value the example filled in is never itself checked); the stream is the
 * one the requirement's line states (either when it states none). A value the
 * requirements do not write, or an unstated exit code, makes the example not
 * checkable; reasons name each one.
 */
export function checkability(example: AcceptanceExample, delivered: string): { checkable: boolean; reasons: string[]; exit_code: number | null; asserts: ExampleAssertion[] } {
  const reasons: string[] = []
  const asserts: ExampleAssertion[] = []
  if (!example.run || !example.check) return { checkable: false, reasons: ["no run or check"], exit_code: null, asserts }
  const text = norm(delivered)
  const lines = text.split("\n")
  const templates = placeholderTemplates(text)
  const c = example.check
  let exit: number | null = null
  const place = (raw: string, where: string | "stream", mode: "exact" | "contains", label: string) => {
    const value = norm(raw).replace(/\n+$/u, "")
    if (!value) { reasons.push(`${label} is empty`); return }
    if (text.includes(value)) {
      const line = lines.find(l => l.includes(value.split("\n")[0]!)) ?? ""
      asserts.push({ where: where === "stream" ? statedStream(line) : where, mode, value, source: "verbatim" })
      return
    }
    const t = templates.find(x => x.pattern.test(value))
    if (t) { asserts.push({ where: where === "stream" ? statedStream(t.line) : where, mode: "pattern", value: t.pattern.source, source: t.template }); return }
    reasons.push(`${label} ${JSON.stringify(value.slice(0, 60))} is not written`)
  }
  if (c.exit_code !== null) { if (statedExitCodes(text).has(c.exit_code)) exit = c.exit_code; else reasons.push(`exit code ${c.exit_code} is not stated`) }
  if (c.stdout_exact !== null) place(c.stdout_exact, "stream", "exact", "stdout")
  for (const v of c.stdout_contains) place(v, "stream", "contains", "stdout part")
  for (const v of c.stderr_contains) place(v, "stream", "contains", "stderr part")
  for (const f of c.files) {
    if (f.exact !== null) place(f.exact, `file:${f.path}`, "exact", `content of ${f.path}`)
    for (const v of f.contains) place(v, `file:${f.path}`, "contains", `${f.path} part`)
  }
  if (exit === null && !asserts.length && !reasons.length) reasons.push("no expectation")
  return { checkable: reasons.length === 0, reasons, exit_code: exit, asserts }
}

/** The subjects with every example marked checkable or not against the delivered text (recomputed each round). */
export function markCheckable<T extends AcceptanceSubject>(subjects: T[], delivered: string): T[] {
  return subjects.map(s => ({ ...s, examples: s.examples.map(e => {
    const { checkable, reasons, exit_code, asserts } = checkability(e, delivered)
    const { checkable: _c, not_checkable: _n, asserts: _a, exit_code: _x, ...rest } = e
    return { ...rest, checkable, ...(checkable ? { exit_code, asserts } : {}), ...(reasons.length ? { not_checkable: reasons } : {}) }
  }) }))
}
