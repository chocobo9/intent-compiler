import type { TaskIntent } from "./intent-contract.js"
import type { AcceptanceExample, DeliveryContract, ExampleTier, ExecutableExample, ItemRevisions } from "./sdd-contract.js"
import { checkability, type ExampleAssertion } from "./sdd-examples.js"
import { currentRevisions } from "./sdd-increment.js"

type Carried = NonNullable<DeliveryContract["executable"]>
type Check = NonNullable<AcceptanceExample["check"]>

/** Executable examples of the previous delivery carried while their items are unchanged and delivered; the items of the rest are written again. */
export function carryExecutable(previous: Carried | undefined, current: Record<string, TaskIntent>, excluded: ReadonlySet<string>, narrowed: ReadonlySet<string> = new Set()): { carried: Carried; dropped: DeliveryContract["dropped"]; rewrite: string[] } {
  const now = currentRevisions(current)
  const carried: Carried = [], dropped: DeliveryContract["dropped"] = [], rewrite = new Set<string>()
  for (const e of previous ?? []) {
    const ids = Object.keys(e.revisions)
    const stale = ids.filter(id => now.get(id) !== e.revisions[id] || excluded.has(id) || narrowed.has(id))
    if (!stale.length) { carried.push({ ...e, carried: true }); continue }
    dropped.push({ kind: "executable", name: e.id, reason: `item ${stale.join(", ")} withdrawn, revised, cut or not delivered` })
    ids.filter(id => now.has(id) && !excluded.has(id)).forEach(id => rewrite.add(id))
  }
  return { carried, dropped, rewrite: [...rewrite] }
}

/** The non-empty lines of a text, each tagged: "=" a whole line (from exact content), "~" a part of a line (from a contained part). */
export function claimLines(text: string, whole: boolean): string[] {
  return text.replace(/\r\n/gu, "\n").split("\n").map(l => l.trimEnd()).filter(l => l.trim().length).map(l => `${whole ? "=" : "~"}${l}`)
}

/**
 * What a check claims, per place: the exit code, and for stdout, stderr and each
 * output file the ordered lines it says appear there (exact content as whole
 * lines, contained parts as parts of lines). Places a check says nothing about are absent.
 */
export function claims(c: Check): Map<string, string> {
  const out = new Map<string, string>()
  if (c.exit_code !== null) out.set("exit", String(c.exit_code))
  const put = (where: string, exact: string | null, contains: string[]) => {
    // Whole lines keep their order; contained parts are a set.
    const l = [...(exact !== null ? claimLines(exact, true) : []), ...contains.flatMap(v => claimLines(v, false)).sort()]
    if (l.length) out.set(where, JSON.stringify(l))
  }
  put("stdout", c.stdout_exact, c.stdout_contains)
  put("stderr", null, c.stderr_contains)
  for (const f of c.files) put(`file:${f.path}`, f.exact, f.contains)
  return out
}

/** The claims two independent derivations share exactly, as assertions: ordered lines that must appear in that place. */
export function agreedAsserts(a: Check, b: Check): { exit_code: number | null; asserts: ExampleAssertion[] } {
  const x = claims(a), y = claims(b)
  let exit_code: number | null = null
  const asserts: ExampleAssertion[] = []
  for (const [where, value] of x) {
    if (y.get(where) !== value) continue
    if (where === "exit") exit_code = Number(value)
    else asserts.push({ where, mode: "lines", value, source: "derived" })
  }
  return { exit_code, asserts }
}

/** An item reference as the model wrote it, mapped to a current item id it names exactly or as a prefix ("r-x: label"). */
export function itemOf(written: string, now: ReadonlyMap<string, number>): string | undefined {
  if (now.has(written)) return written
  return [...now.keys()].filter(id => written.startsWith(`${id}:`) || written.startsWith(`${id} `)).sort((a, b) => b.length - a.length)[0]
}

/** The JSON objects a text writes as samples (fenced or backticked), and the objects inside them. */
function sampleObjects(text: string): unknown[] {
  const out: unknown[] = []
  const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gu)].map(m => m[1]!).concat([...text.matchAll(/`(\{[^`]*\}|\[[^`]*\])`/gu)].map(m => m[1]!))
  const walk = (v: unknown) => { if (v && typeof v === "object") { if (!Array.isArray(v)) out.push(v); Object.values(v as object).forEach(walk) } }
  for (const b of blocks) { try { walk(JSON.parse(b)) } catch { /* not JSON */ } }
  return out
}
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v)

/**
 * Whether a run uses the requirement's own sample: an input file holds a JSON
 * object the text writes (key order aside), or the arguments follow a command
 * synopsis the text writes (its subcommand and every option outside brackets).
 */
export function usesSample(run: NonNullable<AcceptanceExample["run"]>, text: string): boolean {
  const samples = new Set(sampleObjects(text).map(canonical))
  const found: string[] = []
  const walk = (v: unknown) => { if (v && typeof v === "object") { if (!Array.isArray(v)) found.push(canonical(v)); Object.values(v as object).forEach(walk) } }
  for (const f of run.files) { try { walk(JSON.parse(f.content)) } catch { /* not JSON */ } }
  if (found.some(c => samples.has(c))) return true
  // Where the text writes JSON samples, its sample is one of them; a command line counts only where it writes none.
  if (samples.size) return false
  for (const m of text.matchAll(/`(\S+ ([a-z][\w-]*)(?: [^`]*)?)`/gu)) {
    if (!m[1]!.includes(" --") || run.args[0] !== m[2]) continue
    const required = m[1]!.replace(/\[[^\]]*\]/gu, "").match(/--[\w-]+/gu) ?? []
    if (required.every(flag => run.args.includes(flag))) return true
  }
  return false
}

/**
 * Whether every input a run gives is the requirement's own: each file's
 * content written in the text (whitespace aside), or JSON that is one of the
 * text's samples or a list of them (key order aside); stdin likewise. A run
 * with an input the text never writes was made up for the example.
 */
export function originalInputs(run: AcceptanceExample["run"], text: string): boolean {
  if (!run) return false
  const flat = (t: string) => t.replace(/\s+/gu, " ").trim()
  const all = flat(text)
  const samples = new Set(sampleObjects(text).map(canonical))
  const written = (content: string) => {
    const c = flat(content)
    if (!c || all.includes(c)) return true
    try {
      const v: unknown = JSON.parse(content)
      return samples.has(canonical(v)) || (Array.isArray(v) && v.length > 0 && v.every(x => samples.has(canonical(x))))
    } catch { return false }
  }
  return run.files.every(f => written(f.content)) && (run.stdin === null || written(run.stdin))
}

/** A CSV input with a blank line inside its data: CSV readers skip blank lines, so whether it is an empty-value row is undecided. */
export function ambiguousCsv(run: NonNullable<AcceptanceExample["run"]>): boolean {
  return run.files.some(f => {
    if (!/\.csv$/iu.test(f.path)) return false
    const data = f.content.replace(/\r\n/gu, "\n").split("\n").slice(1)
    if (data.at(-1) === "") data.pop()
    return data.some(l => !l.trim())
  })
}

/** What a derivation states at a place (stdout, stderr, either, file:<path>), as one text. */
function derivedText(c: Check, where: string): string {
  const out = where === "stdout" ? [c.stdout_exact, ...c.stdout_contains] : where === "stderr" ? c.stderr_contains
    : where === "either" ? [c.stdout_exact, ...c.stdout_contains, ...c.stderr_contains]
    : c.files.filter(f => `file:${f.path}` === where).flatMap(f => [f.exact, ...f.contains])
  return out.filter((v): v is string => typeof v === "string").join("\n").replace(/\r\n/gu, "\n")
}
const sameJson = (a: string, b: string) => { try { return canonical(JSON.parse(a)) === canonical(JSON.parse(b)) } catch { return false } }

/**
 * The verbatim assertions an example's own input determines: those the
 * independent derivation, working from that input alone, also states (a value
 * it states, a template its text matches, the same exit code). A value the
 * requirement writes only as an illustration of another input is left out.
 * Without a derivation, nothing is confirmed.
 */
export function confirmedAsserts(exitCode: number | null, asserts: ExampleAssertion[], derivation: Derivation | undefined): { exit_code: number | null; asserts: ExampleAssertion[] } {
  if (!derivation) return { exit_code: null, asserts: [] }
  const kept = asserts.filter(a => {
    const text = derivedText(derivation.check, a.where)
    if (a.mode === "pattern") return new RegExp(a.value, "u").test(text)
    const value = a.value.replace(/\r\n/gu, "\n").trim()
    return text.includes(value) || (a.where.toLowerCase().endsWith(".json") && sameJson(value, text))
  })
  return { exit_code: exitCode !== null && derivation.check.exit_code === exitCode ? exitCode : null, asserts: kept }
}

export interface ProposedExample { subject: string; items: string[]; tier: ExampleTier; given: string; expect?: string; run: NonNullable<AcceptanceExample["run"]>; check: Check }
/** The independent derivation of one example: whether its invocation is valid under the requirements, and the result it works out. */
export interface Derivation { invocation_valid: boolean; invalid_reason: string | null; check: Check }

/** The expected result in words, written by code from check. */
export function expectText(c: Check): string {
  const parts: string[] = []
  if (c.exit_code !== null) parts.push(`exit code ${c.exit_code}`)
  if (c.stdout_exact !== null) parts.push(`stdout is exactly:\n${c.stdout_exact}`)
  for (const v of c.stdout_contains) parts.push(`stdout contains \`${v}\``)
  for (const v of c.stderr_contains) parts.push(`stderr contains \`${v}\``)
  for (const f of c.files) {
    if (f.exact !== null) parts.push(`${f.path} is exactly:\n${f.exact}`)
    for (const v of f.contains) parts.push(`${f.path} contains \`${v}\``)
  }
  return parts.join("\n")
}

/**
 * The examples kept. An example the independent derivation judges an invalid
 * invocation under the requirements is dropped, whatever its tier. Verbatim
 * ones are kept when the delivered text writes every expected value (code
 * assertions); a whole multi-line content among them, which a requirement may
 * show only as an illustration, is asserted only when the derivation works
 * out the same lines. Derived ones keep what both derivations claim alike.
 * Unknown items drop an example.
 */
export function keepExamples(proposed: ProposedExample[], derivations: Map<number, Derivation>, delivered: string, current: Record<string, TaskIntent>, idPrefix: string): { kept: Array<ExecutableExample & { revisions: ItemRevisions; carried: false }>; counts: { verbatim: number; derived_kept: number; derived_dropped: number; not_checkable: number; invalid_input: number; runs_kept: number; runs_dropped: number } } {
  const now = currentRevisions(current)
  const kept: Array<ExecutableExample & { revisions: ItemRevisions; carried: false }> = []
  const counts = { verbatim: 0, derived_kept: 0, derived_dropped: 0, not_checkable: 0, invalid_input: 0, runs_kept: 0, runs_dropped: 0 }
  proposed.forEach((p, index) => {
    const items = [...new Set(p.items.map(id => itemOf(id, now)).filter((id): id is string => id !== undefined))]
    if (!items.length) { counts.not_checkable++; return }
    const again = derivations.get(index)
    if (again?.invocation_valid === false || ambiguousCsv(p.run)) { counts.invalid_input++; return }
    const base = { id: `${idPrefix}:${index + 1}`, subject: p.subject, items, given: p.given, expect: expectText(p.check), run: p.run, check: p.check, revisions: Object.fromEntries(items.map(id => [id, now.get(id)!])), carried: false as const }
    if (p.tier === "runs") {
      // The requirement's own sample input must run: exit code 0, no ERROR anywhere, and the output files both the example and the independent derivation name written.
      const text = items.map(id => Object.values(current).flatMap(t => t.content).find(c => c.item_id === id)?.text ?? "").join("\n")
      const failsByDerivation = again !== undefined && again.check.exit_code !== null && again.check.exit_code !== 0
      if (!usesSample(p.run, text) || failsByDerivation) { counts.runs_dropped++; return }
      const derivedFiles = new Set((again?.check.files ?? []).map(f => f.path))
      const files = p.check.files.filter(f => derivedFiles.has(f.path))
      const asserts: ExampleAssertion[] = [{ where: "either", mode: "absent", value: "ERROR", source: "runs" }, ...files.map(f => ({ where: `file:${f.path}`, mode: "exists" as const, value: "", source: "runs" }))]
      kept.push({ ...base, check: { exit_code: 0, stdout_exact: null, stdout_contains: [], stderr_contains: [], files: files.map(f => ({ path: f.path, exact: null, contains: [] })) }, expect: `exit code 0, no ERROR${files.length ? `, writes ${files.map(f => f.path).join(", ")}` : ""}`, tier: "runs", checkable: true, exit_code: 0, asserts }); counts.runs_kept++
      return
    }
    if (p.tier === "verbatim") {
      const r = checkability({ ...p, expect: "" }, delivered)
      if (!r.checkable) { counts.not_checkable++; return }
      // Only what the example's own input determines: the independent derivation must state it too.
      const confirmed = confirmedAsserts(r.exit_code, r.asserts, again)
      if (confirmed.exit_code === null && !confirmed.asserts.length) { counts.not_checkable++; return }
      kept.push({ ...base, tier: "verbatim", checkable: true, exit_code: confirmed.exit_code, asserts: confirmed.asserts }); counts.verbatim++
      return
    }
    // Only what both derivations claim, in the same place and line order, is asserted.
    const agreed = again ? agreedAsserts(p.check, again.check) : { exit_code: null, asserts: [] }
    const contentClaims = claims(p.check).size - (p.check.exit_code !== null ? 1 : 0)
    if (!agreed.asserts.length || agreed.asserts.length < contentClaims) { counts.derived_dropped++; return }
    kept.push({ ...base, tier: "derived", checkable: true, exit_code: agreed.exit_code, asserts: agreed.asserts }); counts.derived_kept++
  })
  return { kept, counts }
}

/** The verbatim executable examples whose inputs are the requirement's own, for SDD: nothing in them is made up. All examples still run. */
export function executableSection(examples: Carried): string {
  const verbatim = examples.filter(e => e.tier === "verbatim" && e.original_inputs === true)
  if (!verbatim.length) return ""
  const body = verbatim.map((e, i) => `## ${i + 1}. ${e.subject}\nGiven:\n${e.given.trim()}\nExpect:\n${e.expect.trim()}`).join("\n\n")
  return `# Executable acceptance examples\n${EXECUTABLE_NOTE}\n\n${body}\n\n`
}
export const EXECUTABLE_NOTE = "Management wrote these examples so that they can be run against the program; every expected text, exit code and output in them is written by the original requirements that follow, and code checks the delivered program against them."
