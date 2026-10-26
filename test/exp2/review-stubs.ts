import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ModelReply } from "../../src/exp2/attribution.js"
import { goBuilder } from "../../src/exp2/build.js"
import type { FormalItem, FormalizeAnswer, FormalizeRequest, FormalizeTransport } from "../../src/exp2/formalize.js"
import type { ProgramRun, Reviewer, ReviewOutcome } from "../../src/exp2/review.js"
import type { CheckInput } from "../../src/exp2/runner.js"

/**
 * Stand-ins for the reviewer and the formalizer (DEV-GUIDELINES §3), written to be close to the real ones. The
 * reviewer stand-in builds the copy of the program it is given and runs it on the filter and sort inputs it knows,
 * then lists what it saw as a reviewer would (requirement, command and input, what the program did), or answers
 * NO ISSUES; a scripted variant answers from a table. The formalizer stand-in writes the items the way a model
 * would from such a list: units from the text, the input rebuilt, assertions with their sources.
 */

export const FILTER_INPUT: CheckInput = {
  args: ["transform", "--input", "data.csv", "--recipe", "recipe.json", "--output", "out.csv", "--seed", "1"],
  files: [{ path: "data.csv", content: "id,value\n1,5\n2,20\n3,3\n4,12\n" }, { path: "recipe.json", content: `[{"op":"filter","column":"value","condition":"gt","threshold":10}]` }],
}
export const SORT_INPUT: CheckInput = {
  args: ["transform", "--input", "data.csv", "--recipe", "recipe.json", "--output", "out.csv", "--seed", "1"],
  files: [{ path: "data.csv", content: "id,value\n1,5\n2,20\n3,3\n4,12\n" }, { path: "recipe.json", content: `[{"op":"sort","column":"value","order":"asc"}]` }],
}

/** The reviewer's wording for the filter deviation (the formalizer stand-in reads it back). */
export const FILTER_ITEM_TEXT = [
  "Requirement broken: `filter`: Keep rows where the column satisfies the condition (gt 10 keeps only rows with value > 10).",
  "Command: dpipe transform --input data.csv --recipe recipe.json --output out.csv --seed 1, with data.csv = \"id,value\\n1,5\\n2,20\\n3,3\\n4,12\\n\" and recipe.json = [{\"op\":\"filter\",\"column\":\"value\",\"condition\":\"gt\",\"threshold\":10}].",
  "What the program did: out.csv holds the rows 5 and 3 instead of 20 and 12; the rows that satisfy the condition were dropped and the others kept.",
].join(" ")

export const SORT_ITEM_TEXT = [
  "Requirement broken: `sort`: Sort rows by the column in the given order (asc is ascending numeric order).",
  "Command: dpipe transform --input data.csv --recipe recipe.json --output out.csv --seed 1, with data.csv = \"id,value\\n1,5\\n2,20\\n3,3\\n4,12\\n\" and recipe.json = [{\"op\":\"sort\",\"column\":\"value\",\"order\":\"asc\"}].",
  "What the program did: out.csv lists 12, 20, 3, 5 (compared as text), not 3, 5, 12, 20.",
].join(" ")

/** Runs a Go program copy on an input in a scratch directory; what it wrote to out.csv, and the exit code. */
function runOn(bin: string, input: CheckInput): { exit: number; out: string | null; command: string } {
  const dir = mkdtempSync(join(tmpdir(), "exp2-review-run-"))
  try {
    for (const f of input.files) writeFileSync(join(dir, f.path), f.content, "utf8")
    let exit = 0
    try { execFileSync(bin, input.args, { cwd: dir, stdio: "ignore" }) } catch (e) { exit = (e as { status?: number }).status ?? 1 }
    let out: string | null = null
    try { out = readFileSync(join(dir, "out.csv"), "utf8") } catch { out = null }
    return { exit, out, command: `./dpipe ${input.args.join(" ")}` }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

const values = (csv: string | null) => csv ? csv.trim().split("\n").slice(1).map(r => Number(r.split(",")[1])) : []

/**
 * The reviewer stand-in that works: builds the copy, runs filter and sort, and reports what is wrong. `also` lets a
 * test add lines (a SUPERSEDED line, an item) or replace the reply; `noRuns` makes a review that never ran the program.
 */
export function workingReviewer(builds: string, options: { also?: (request: string, n: number) => string[]; noRunsOn?: (n: number) => boolean; replace?: (request: string, n: number) => string | null } = {}): Reviewer & { requests: { dir: string; request: string; label: string }[] } {
  const requests: { dir: string; request: string; label: string }[] = []
  const usage = { input_tokens: 20_000, cache_read_tokens: 5_000, cache_write_tokens: 0, output_tokens: 400, reasoning_tokens: 0 }
  return {
    requests,
    async review(dir, request, label): Promise<ReviewOutcome> {
      requests.push({ dir, request, label })
      const n = requests.length
      const session = `stub-review-${n}`
      if (options.noRunsOn?.(n)) return { text: "NO ISSUES", usage, model: "stub:reviewer", session, runs: [] }
      const replaced = options.replace?.(request, n)
      const runs: ProgramRun[] = []
      const items: string[] = []
      const built = goBuilder(join(builds, `review-${n}`), {}, "dpipe")(dir, `rev${n}`)
      if (!built.ok) { items.push(`The program does not build: ${built.output.slice(0, 200)}`); runs.push({ command: "go build ./...", exit_code: 1 }) }
      else {
        const f = runOn(built.program!.command[0], FILTER_INPUT)
        runs.push({ command: f.command, exit_code: f.exit })
        if (values(f.out).some(v => !(v > 10)) || !f.out) items.push(FILTER_ITEM_TEXT)
        const s = runOn(built.program!.command[0], SORT_INPUT)
        runs.push({ command: s.command, exit_code: s.exit })
        const vs = values(s.out)
        if (!s.out || vs.some((v, i) => i > 0 && vs[i - 1] > v)) items.push(SORT_ITEM_TEXT)
      }
      const extra = options.also?.(request, n) ?? []
      const text = replaced ?? (items.length || extra.length ? [...items.map((t, i) => `${i + 1}. ${t}`), ...extra].join("\n\n") : "NO ISSUES")
      return { text, usage, model: "stub:reviewer", session, runs }
    },
  }
}

/** A reviewer stand-in answering from a table (text and runs per review, in order; the last repeats). */
export function scriptedReviewer(script: { text: string; runs?: ProgramRun[]; materials?: { files: { path: string; content: string }[]; commands: { command: string; output: string }[] } }[]): Reviewer & { requests: { dir: string; request: string; label: string }[] } {
  const requests: { dir: string; request: string; label: string }[] = []
  return {
    requests,
    async review(dir, request, label) {
      requests.push({ dir, request, label })
      const s = script[Math.min(requests.length - 1, script.length - 1)]
      return { text: s.text, usage: { input_tokens: 10_000, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 100, reasoning_tokens: 0 }, model: "stub:reviewer", session: `stub-review-${requests.length}`, runs: s.runs ?? [{ command: "./dpipe transform --input data.csv", exit_code: 0 }], ...(s.materials ? { materials: s.materials } : {}) }
    },
  }
}

const py = (code: string) => ({ language: "python" as const, code })
const t = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, path: null, line: null, pointer: null, column: null, ...extra }) as FormalItem["assertions"][number]["target"]
const derived = (id: string, target: FormalItem["assertions"][number]["target"], value: unknown): FormalItem["assertions"][number] => ({ id, role: "business", target, expect_json: JSON.stringify(value), tolerance: null, source: { kind: "derived", block: null } })


/** The filter item as the formalizer writes it: the expected lines worked out, and a script that works them out too. */
export function filterItem(n: number, text: string, unit: string): FormalItem {
  const script = [
    "import csv, json",
    "rows = list(csv.reader(open('data.csv')))",
    "op = json.load(open('recipe.json'))[0]",
    "i = rows[0].index(op['column'])",
    "keep = [r for r in rows[1:] if float(r[i]) > op['threshold']]",
    "lines = [','.join(rows[0])] + [','.join(r) for r in keep]",
    "out = {'l%d' % (k + 1): l for k, l in enumerate(lines)}",
    "out['exit'] = 0",
    "print(json.dumps(out))",
  ].join("\n")
  return {
    item: n, text, units: [unit], input: FILTER_INPUT, why_no_input: null,
    assertions: [derived("l1", t("file_line", { path: "out.csv", line: 1 }), "id,value"), derived("l2", t("file_line", { path: "out.csv", line: 2 }), "2,20"), derived("l3", t("file_line", { path: "out.csv", line: 3 }), "4,12"), derived("exit", t("exit_code"), 0)],
    reference_script: py(script),
  }
}

export function sortItem(n: number, text: string, unit: string): FormalItem {
  const script = [
    "import csv, json",
    "rows = list(csv.reader(open('data.csv')))",
    "i = rows[0].index('value')",
    "body = sorted(rows[1:], key=lambda r: float(r[i]))",
    "lines = [','.join(rows[0])] + [','.join(r) for r in body]",
    "out = {'l%d' % (k + 1): l for k, l in enumerate(lines)}",
    "out['exit'] = 0",
    "print(json.dumps(out))",
  ].join("\n")
  return {
    item: n, text, units: [unit], input: SORT_INPUT, why_no_input: null,
    assertions: [derived("l1", t("file_line", { path: "out.csv", line: 1 }), "id,value"), derived("l2", t("file_line", { path: "out.csv", line: 2 }), "3,3"), derived("l3", t("file_line", { path: "out.csv", line: 3 }), "1,5"), derived("l4", t("file_line", { path: "out.csv", line: 4 }), "4,12"), derived("l5", t("file_line", { path: "out.csv", line: 5 }), "2,20"), derived("exit", t("exit_code"), 0)],
    reference_script: py(script),
  }
}

/**
 * The formalizer stand-in: reads the review's numbered items and writes the ones it knows (the filter and the sort
 * deviations, by their wording); `extra` adds items a test wants for other wordings. An unknown item is written with
 * no input and a reason, as a model does when the review leaves the call out.
 */
export function stubFormalizer(units: { filter: string; sort: string }, extra: (text: string, n: number, request: FormalizeRequest) => FormalItem | null = () => null): FormalizeTransport & { requests: FormalizeRequest[] } {
  const requests: FormalizeRequest[] = []
  const f = async (request: FormalizeRequest): Promise<ModelReply> => {
    requests.push(request)
    const entries = request.review.split(/\n(?=\d+\. )/u).map(x => x.trim()).filter(x => /^\d+\. /u.test(x)).map(x => x.replace(/^\d+\. /u, ""))
    const items: FormalItem[] = entries.map((text, k) => {
      const n = k + 1
      if (text.startsWith(FILTER_ITEM_TEXT.slice(0, 40))) return filterItem(n, text, units.filter)
      if (text.startsWith(SORT_ITEM_TEXT.slice(0, 40))) return sortItem(n, text, units.sort)
      return extra(text, n, request) ?? { item: n, text, units: [units.filter], input: null, why_no_input: "the item does not give the command or the files it used", assertions: [], reference_script: null }
    })
    const answer: FormalizeAnswer = { items }
    return { text: JSON.stringify(answer), stub: true, usage: { input_tokens: 30_000, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 1200, reasoning_tokens: 0 }, model: "stub:formalizer" }
  }
  return Object.assign(f, { requests })
}

/** The review acceptance's stand-ins for a serial (the only flow left, §12j.4): the working reviewer and the formalizer. */
export function standInReview(dir: string): { reviewer: Reviewer; formalize: FormalizeTransport } {
  return { reviewer: workingReviewer(join(dir, "review-builds")), formalize: stubFormalizer({ filter: "R1.S3.P2.s4", sort: "R1.S3.P9.s2" }) }
}
