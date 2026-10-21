import { createHash } from "node:crypto"
import { blake2b256Hex } from "./blake2b.js"
import type { AssertionDraft, CheckDraft, CheckRequest, ChecksPatch, ChecksTransport, Target } from "../../src/exp2/checks.js"

/**
 * Fixed offline answers for the check-derivation step, written from the request the way a model would: object ids
 * from the request, inputs and expectations from the source text. Method A values are worked by hand; method B is a
 * Python script. The first answers carry usual mistakes (an option the text never shows, a quote that is not in the
 * block, a convention left out of uses, a paraphrase passed off as a quote), and one input the model got wrong
 * (a checksum file with a miscomputed digest), which only the run can reveal.
 */

const t = (kind: Target["kind"], extra: Partial<Target> = {}): Target => ({ kind, path: null, line: null, pointer: null, column: null, ...extra })
const derived = (id: string, target: Target, value: unknown, role: AssertionDraft["role"] = "business"): AssertionDraft =>
  ({ id, role, target, expect_json: JSON.stringify(value), tolerance: null, source: { kind: "derived", block: null, quote: null } })
const verbatim = (id: string, target: Target, value: unknown, block: string, quote: string, role: AssertionDraft["role"] = "business"): AssertionDraft =>
  ({ id, role, target, expect_json: JSON.stringify(value), tolerance: null, source: { kind: "verbatim", block, quote } })
const py = (code: string) => ({ language: "python" as const, code })
const patch = (p: Partial<ChecksPatch>): ChecksPatch => ({ upsert: [], remove: [], retire_add: [], retire_remove: [], ...p })

function ids(request: CheckRequest) {
  return (name: string) => {
    const o = request.objects.find(x => x.name === name)
    if (!o) throw new Error(`check stub: no object ${name} in round ${request.round}`)
    return o.id
  }
}

const check = (c: Omit<CheckDraft, "direction" | "note"> & Partial<Pick<CheckDraft, "direction" | "note">>): CheckDraft => ({ direction: "holds", note: null, ...c })

/**
 * The expected exit code of a successful call: derived (the text states no success code), so method B prints it too.
 * The reference script is wrapped to add {"exit": 0} to what it prints.
 */
function succeeds(c: CheckDraft): CheckDraft {
  const inner = c.reference_script?.code ?? "print('{}')"
  const code = [
    "import io, json, contextlib",
    `_src = ${JSON.stringify(inner)}`,
    "_buf = io.StringIO()",
    "with contextlib.redirect_stdout(_buf):",
    "    exec(compile(_src, 'reference', 'exec'), {'__name__': '__main__'})",
    "_out = json.loads(_buf.getvalue() or '{}')",
    "_out['exit'] = 0",
    "print(json.dumps(_out))",
  ].join("\n")
  return { ...c, assertions: [...c.assertions, derived("exit", t("exit_code"), 0)], reference_script: { language: "python", code } }
}

// ------------------------------------------------------------------ R1

const DATA = "id,value\n1,5\n2,15\n3,25\n"
const sha = (s: string) => createHash("sha256").update(s).digest("hex")

function r1(request: CheckRequest, first: boolean): CheckDraft[] {
  const id = ids(request)
  const transformArgs = ["transform", "--input", "data.csv", "--recipe", "recipe.json", "--output", "out.csv", "--seed", "1"]
  const filterRecipe = JSON.stringify([{ op: "filter", column: "value", condition: "gt", threshold: 10 }])
  return [
    succeeds({
      direction: "holds", note: null,
      key: "filter-gt", object: id("filter"), blocks: ["R1.S3.P2.s4"], uses: [],
      // First answer: an option the requirements never show.
      input: { args: first ? [...transformArgs, "--precision", "2"] : transformArgs, files: [{ path: "data.csv", content: DATA }, { path: "recipe.json", content: filterRecipe }] },
      assertions: [
        derived("l1", t("file_line", { path: "out.csv", line: 1 }), "id,value"),
        derived("l2", t("file_line", { path: "out.csv", line: 2 }), "2,15"),
        derived("l3", t("file_line", { path: "out.csv", line: 3 }), "3,25"),
      ],
      reference_script: py([
        "import csv, json",
        "rows = list(csv.reader(open('data.csv')))",
        "op = json.load(open('recipe.json'))[0]",
        "i = rows[0].index(op['column'])",
        "keep = [r for r in rows[1:] if float(r[i]) > op['threshold']]",
        "lines = [','.join(rows[0])] + [','.join(r) for r in keep]",
        "print(json.dumps({'l%d' % (k + 1): l for k, l in enumerate(lines)}))",
      ].join("\n")),
    }),
    check({
      key: "transform-runs", object: id("transform"), blocks: ["R1.S3.P1"], uses: [],
      input: { args: transformArgs, files: [{ path: "data.csv", content: DATA }, { path: "recipe.json", content: filterRecipe }] },
      assertions: [derived("a1", t("exit_code"), 0)],
      reference_script: py("print('{\"a1\": 0}')"),
    }),
    check({
      key: "transform-missing-input", object: id("transform"), blocks: ["R1.S3.P1", "R1.S8.P1"],
      // First answer: the error format belongs to the shared error-handling convention, left out of uses.
      uses: first ? [] : [id("error handling")],
      input: { args: ["transform", "--input", "nope.csv", "--recipe", "recipe.json", "--output", "out.csv", "--seed", "1"], files: [{ path: "recipe.json", content: filterRecipe }] },
      assertions: [
        verbatim("exit", t("exit_code"), 1, "R1.S8.P1.s1", "exit code 1", "convention"),
        verbatim("msg", t("stderr_line", { line: 1 }), "ERROR: file not found: nope.csv", "R1.S8.P1.s1", "ERROR: file not found: <path>", "convention"),
      ],
      reference_script: null,
    }),
    check({
      key: "verify-match", object: id("verify"), blocks: ["R1.S4"], uses: [],
      input: { args: ["verify", "--file", "data.csv", "--checksum", "data.csv.sha256"], files: [{ path: "data.csv", content: DATA }, { path: "data.csv.sha256", content: sha(DATA) + "\n" }] },
      assertions: [
        // First answer: a quote that is not in the block.
        verbatim("out", t("stdout_line", { line: 1 }), "VERIFIED", "R1.S4.P2.s2", first ? "prints VERIFIED OK" : "VERIFIED"),
        verbatim("exit", t("exit_code"), 0, "R1.S4.P2.s2", "Exit code 0"),
      ],
      reference_script: null,
    }),
    check({
      // The model wrote the digest by hand and got it wrong: a badly built input, which the run will reveal.
      key: "verify-match-2", object: id("verify"), blocks: ["R1.S4"], uses: [],
      input: { args: ["verify", "--file", "other.csv", "--checksum", "other.csv.sha256"], files: [{ path: "other.csv", content: "a\n1\n" }, { path: "other.csv.sha256", content: "3f".repeat(32) + "\n" }] },
      assertions: [verbatim("out", t("stdout_line", { line: 1 }), "VERIFIED", "R1.S4.P2.s2", "VERIFIED"), verbatim("exit", t("exit_code"), 0, "R1.S4.P2.s2", "Exit code 0")],
      reference_script: null,
    }),
  ]
}

// ------------------------------------------------------------------ R2, R3

const VALUES = "id,value\n1,2\n2,4\n3,6\n"
const normalizeArgs = ["transform", "--input", "data.csv", "--recipe", "recipe.json", "--output", "out.csv", "--seed", "1"]
const normalizeInput = (method: string, content = VALUES) => ({ args: normalizeArgs, files: [{ path: "data.csv", content }, { path: "recipe.json", content: JSON.stringify([{ op: "normalize", column: "value", method, as: "v_norm" }]) }] })
const cells = (values: number[]) => values.map((v, k) => derived(`n${k + 1}`, t("csv_cell", { path: "out.csv", line: k + 1, column: "v_norm" }), v))
const normalizeScript = (stat: "pstdev" | "stdev" | "minmax") => py([
  "import csv, json, statistics",
  "rows = list(csv.reader(open('data.csv')))",
  "xs = [float(r[1]) for r in rows[1:]]",
  stat === "minmax"
    ? "out = [(x - min(xs)) / (max(xs) - min(xs)) for x in xs]"
    : `m = statistics.mean(xs); sd = statistics.${stat}(xs); out = [(x - m) / sd for x in xs]`,
  "print(json.dumps({'n%d' % (k + 1): v for k, v in enumerate(out)}))",
].join("\n"))

function r2(request: CheckRequest, first: boolean): CheckDraft[] {
  const id = ids(request)
  const profile = check({
      key: "profile-numeric", object: id("profile"), blocks: ["R2.S3"], uses: [],
      input: { args: ["profile", "--input", "data.csv", "--output", "profile.json"], files: [{ path: "data.csv", content: VALUES }] },
      assertions: [
        derived("rows", t("json", { path: "profile.json", pointer: "/row_count" }), 3),
        derived("mean", t("json", { path: "profile.json", pointer: "/columns/1/mean" }), 4),
        derived("sd", t("json", { path: "profile.json", pointer: "/columns/1/stddev" }), 1.632993161855452),
        // Worked by hand with the wrong interpolation: method B disagrees, so this one stays out as unknown.
        derived("p25", t("json", { path: "profile.json", pointer: "/columns/1/p25" }), 2.5),
      ],
      reference_script: py([
        "import csv, json, statistics",
        "rows = list(csv.reader(open('data.csv')))",
        "xs = sorted(float(r[1]) for r in rows[1:])",
        "idx = 0.25 * (len(xs) - 1); lo = int(idx); p25 = xs[lo] + (xs[min(lo + 1, len(xs) - 1)] - xs[lo]) * (idx - lo)",
        "print(json.dumps({'rows': len(rows) - 1, 'mean': statistics.mean(xs), 'sd': statistics.pstdev(xs), 'p25': p25}))",
      ].join("\n")),
    })
  return [
    succeeds(check({ key: "normalize-minmax", object: id("normalize"), blocks: ["R2.S11.P6"], uses: [], input: normalizeInput("minmax"), assertions: cells([0, 0.5, 1]), reference_script: normalizeScript("minmax") })),
    succeeds(check({ key: "normalize-zscore", object: id("normalize"), blocks: ["R2.S11.P5"], uses: [], input: normalizeInput("zscore"), assertions: cells([-1.224744871391589, 0, 1.224744871391589]), reference_script: normalizeScript("pstdev") })),
    // First answer: the expected exit code is left out.
    first ? profile : succeeds(profile),
  ]
}

function r3(request: CheckRequest, first: boolean): { checks: CheckDraft[]; retire: string[] } {
  const id = ids(request)
  const normalize = id("normalize")
  // Proposals: the R2 z-score check (its population formula was replaced), and, wrongly, the profile check, whose
  // text R3 only added to; the code accepts the first and turns down the second.
  const old = request.stale.filter(c => c.object === normalize && c.blocks.includes("R2.S11.P5")).map(c => c.id)
  const profile = request.checks.filter(c => c.object === id("profile")).map(c => c.id)
  return {
    retire: [...old, ...profile],
    checks: [
      succeeds(check({ key: "zscore-sample", object: normalize, blocks: ["R3.S3"], uses: [], input: normalizeInput("zscore"), assertions: cells([-1, 0, 1]), reference_script: normalizeScript("stdev") })),
      // The R2 min-max check went stale with its paragraph; min-max itself is unchanged, so it is derived again on its item.
      succeeds(check({ key: "minmax-again", object: normalize, blocks: ["R2.S11.P6.s5"], uses: [], input: normalizeInput("minmax"), assertions: cells([0, 0.5, 1]), reference_script: normalizeScript("minmax") })),
      succeeds(check({
        key: "zscore-single", object: normalize, blocks: ["R3.S3.P3"], uses: [], input: normalizeInput("zscore", "id,value\n1,5\n"),
        // First answer: a paraphrase given as a quote.
        assertions: [verbatim("n1", t("csv_cell", { path: "out.csv", line: 1, column: "v_norm" }), 0, "R3.S3.P3", first ? "If n < 2, all outputs are 0" : "If `n < 2`, all output values are `\"0\"`.")],
        reference_script: null,
      })),
    ],
  }
}

// ------------------------------------------------------------------ R5: a withdrawn behaviour

function r5(request: CheckRequest): CheckDraft[] {
  const id = ids(request)
  // R1's verify checks went stale with R5's checksum change: verify is derived again in the same round (DESIGN §12a).
  const verify = request.stale.some(s => s.object === id("verify")) ? [check({
    key: "verify-blake2b", object: id("verify"), blocks: ["R5.S1.P1", "R5.S1.P2.s1"], uses: [],
    input: { args: ["verify", "--file", "data.csv", "--checksum", "data.csv.b2"], files: [{ path: "data.csv", content: DATA }, { path: "data.csv.b2", content: blake2b256Hex(DATA) + "\n" }] },
    assertions: [
      verbatim("out", t("stdout_line", { line: 1 }), "VERIFIED", "R1.S4.P2.s2", "VERIFIED"),
      verbatim("exit", t("exit_code"), 0, "R1.S4.P2.s2", "Exit code 0"),
    ],
    reference_script: null,
  })] : []
  const recipe = JSON.stringify([{ op: "filter", column: "value", condition: "gt", threshold: 10 }])
  return [...verify, check({
    // The old behaviour, stated as it was: transform wrote <output>.sha256 with the output's digest. It must no longer happen.
    key: "transform-no-sidecar", object: id("transform"), blocks: ["R5.S1.P3.s5"], uses: [], direction: "withdrawn",
    input: { args: ["transform", "--input", "data.csv", "--recipe", "recipe.json", "--output", "out.csv", "--seed", "1"], files: [{ path: "data.csv", content: DATA }, { path: "recipe.json", content: recipe }] },
    assertions: [
      derived("exit", t("exit_code"), 0),
      derived("sidecar", t("file_line", { path: "out.csv.sha256", line: 1 }), sha("id,value\n2,15\n3,25\n")),
    ],
    reference_script: py([
      "import csv, json, hashlib",
      "rows = list(csv.reader(open('data.csv')))",
      "op = json.load(open('recipe.json'))[0]",
      "i = rows[0].index(op['column'])",
      "body = '\\n'.join([','.join(rows[0])] + [','.join(r) for r in rows[1:] if float(r[i]) > op['threshold']]) + '\\n'",
      "print(json.dumps({'exit': 0, 'sidecar': hashlib.sha256(body.encode()).hexdigest()}))",
    ].join("\n")),
  })]
}

// ------------------------------------------------------------------ R10: JSON output and the command's own error rule

function r10(request: CheckRequest): CheckDraft[] {
  const id = ids(request)
  const manifest = (files: [string, string][]) => JSON.stringify({ files: files.map(([path, checksum]) => ({ path, checksum, algorithm: "blake2b-256" })) })
  const args = ["reconcile", "--left", "left.json", "--right", "right.json", "--output", "report.json"]
  const json = (pointer: string) => t("json", { path: "report.json", pointer })
  return [
    succeeds({
      direction: "holds", note: null,
      key: "reconcile-diff", object: id("reconcile"), blocks: ["R10.S4", "R10.S5"], uses: [],
      input: { args, files: [{ path: "left.json", content: manifest([["a.csv", "11"], ["b.csv", "22"]]) }, { path: "right.json", content: manifest([["b.csv", "33"], ["c.csv", "44"]]) }] },
      assertions: [
        derived("added", json("/added"), ["c.csv"]),
        derived("removed", json("/removed"), ["a.csv"]),
        derived("modified", json("/modified"), ["b.csv"]),
        derived("left", json("/summary/total_left"), 2),
      ],
      reference_script: py([
        "import json",
        "l = {f['path']: f['checksum'] for f in json.load(open('left.json'))['files']}",
        "r = {f['path']: f['checksum'] for f in json.load(open('right.json'))['files']}",
        "print(json.dumps({'added': sorted(set(r) - set(l)), 'removed': sorted(set(l) - set(r)), 'modified': sorted(p for p in l if p in r and l[p] != r[p]), 'left': len(l)}))",
      ].join("\n")),
    }),
    check({
      key: "reconcile-invalid", object: id("reconcile"), blocks: ["R10.S6"], uses: [],
      input: { args, files: [{ path: "left.json", content: "not json" }, { path: "right.json", content: manifest([]) }] },
      assertions: [
        verbatim("exit", t("exit_code"), 1, "R10.S6.P1.s2", "exit 1"),
        verbatim("msg", t("stderr_line", { line: 1 }), "ERROR: invalid manifest: left.json", "R10.S6.P1.s2", "ERROR: invalid manifest: <path>"),
      ],
      reference_script: null,
    }),
  ]
}

/** Per round: the first answer, then the repair patches. */
export const CHECK_SCRIPTS: Record<number, ((request: CheckRequest) => ChecksPatch)[]> = {
  1: [
    req => patch({ upsert: r1(req, true) }),
    req => patch({ upsert: r1(req, false).filter(c => ["filter-gt", "transform-missing-input", "verify-match"].includes(c.key)) }),
  ],
  2: [req => patch({ upsert: r2(req, true) }), req => patch({ upsert: r2(req, false).filter(c => c.key === "profile-numeric") })],
  5: [req => patch({ upsert: r5(req) })],
  10: [req => patch({ upsert: r10(req) })],
  3: [
    req => { const a = r3(req, true); return patch({ upsert: a.checks, retire_add: a.retire.map(check => ({ check, reason: "rests on R2's population stddev, replaced by R3.S3" })) }) },
    req => patch({ upsert: r3(req, false).checks.filter(c => c.key === "zscore-single") }),
  ],
}

export function checkStubTransport(scripts = CHECK_SCRIPTS, log: CheckRequest[] = []): ChecksTransport {
  // Answers from the request alone (an empty draft gets the first answer, otherwise the repair), as stubTransport.
  return async request => {
    log.push(request)
    const n = request.previous_draft.checks.length === 0 && request.previous_draft.retire.length === 0 ? 0 : 1
    const script = scripts[request.round]
    const reply = script ? script[Math.min(n, script.length - 1)](request) : patch({})
    return { text: JSON.stringify(reply), usage: { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 }, stub: true, model: script ? "stub:scripted" : "stub:none" }
  }
}
