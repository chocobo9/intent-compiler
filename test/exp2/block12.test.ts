import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { goBuilder } from "../../src/exp2/build.js"
import { codeFacts } from "../../src/exp2/checks.js"
import { changeScope, coveredFunctions, ranOnly } from "../../src/exp2/coverage.js"
import { batchScript } from "../../src/exp2/docker.js"
import { executeRound, DEFAULT_LIMITS, NO_PROGRESS, type ExecutionDeps } from "../../src/exp2/execution.js"
import { initRepo } from "../../src/exp2/git.js"
import { computedAgrees, correctionItems, judgeRuns, pairKey, type JudgeRequest } from "../../src/exp2/judge.js"
import { ledgerOf, ledgerSummary } from "../../src/exp2/ledger.js"
import { activeProbes, deriveProbes, runProbes, type ProbeRecord } from "../../src/exp2/probes.js"
import { acceptanceFromLedger } from "../../src/exp2/report.js"
import { LocalProcessRunner, LocalScriptSandbox, type ProgramRef } from "../../src/exp2/runner.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { runAndJudge } from "../../src/exp2/probe-run.js"
import { buildWorkOrder, renderWorkOrder } from "../../src/exp2/workorder.js"
import { DROP, FILTER, GO_MOD, MAIN, RENAME, SORT, TRANSFORM, VERIFY } from "./go-fixtures.js"
import { roundText } from "./inputs.js"
import { filterVerdict, stubJudge, stubProbeWriter } from "./probe-stubs.js"
import { StubExecutor, write } from "./stub-executor.js"
import { stubTransport } from "./stubs.js"

/**
 * Block 12 (DESIGN §12h): computed values are compared by code at the place that holds them; one ledger; no repair
 * cycle spent on an item that does not change; targeted runs with a full run before delivery; a shared cache prefix;
 * acceptance replayed on frozen programs. Every model is a stand-in.
 */

const usage = { input_tokens: 500, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 50, reasoning_tokens: 0 }
const node = (script: string): ProgramRef => ({ id: "n", label: "n", source_dir: null, command: [process.execPath, "-e", script] })
const python = (code: string) => execFileSync("python3", ["-c", code], { encoding: "utf8" }).trim()

describe("exp2 block 12 E1: a computed value is compared with the program's value at the place the answer names", () => {
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b12a-")), "b12a")
  before(async () => { for (const r of [1, 2, 3, 4, 5]) await store.ingestRound(r, roundText(r), stubTransport()) })

  it("expected row 3, a 3 elsewhere in the output, the row field 2: not the same", async () => {
    const unit = "R4.S4.P1.s1"
    const data = "id,age\n1,30\n2,41\n3,abc\n"
    const report = { valid: false, violations: [{ column: "age", row: 2, rule: "type", value: "abc", message: "expected int, got \"abc\" (3 rows read)" }] }
    const where = { kind: "json" as const, path: "-", line: null, pointer: "/violations/0/row", column: null }
    const out = { exit_code: 1, stdout: JSON.stringify(report), stderr: "", files: {} }
    assert.ok(out.stdout.includes("3"), "the expected value is in the output, elsewhere")
    assert.deepEqual(computedAgrees("3", where, out), { agrees: false, program_value: "2" })
    assert.deepEqual(computedAgrees("2", where, out), { agrees: true, program_value: "2" })
    const probe: ProbeRecord = { id: "P1", round: 4, key: "g1_row", args: ["validate", "--input", "data.csv"], files: [{ path: "data.csv", content: data }], invalid_on_purpose: false, covers: [{ unit, case: null, trigger_values: ["abc"], wrong_would: "" }], call: "W1" }
    const runs = await runProbes([probe], node(`process.stdout.write(${JSON.stringify(JSON.stringify(report))}); process.exit(1)`), new LocalProcessRunner(), 10_000)
    const rulings: JudgeRequest[] = []
    const judge = async (r: JudgeRequest) => ({ stub: true, usage, text: JSON.stringify({ verdicts: r.items.flatMap(it => it.units.map(u => ({ item: it.item, unit: u.id, verdict: "compute", rests_on: "computation", reason: "a position", compute: "import csv\nrows = list(csv.DictReader(open('data.csv')))\nprint([i + 1 for i, r in enumerate(rows) if not r['age'].isdigit()][0])", where }))) }) })
    const ruling = async (r: JudgeRequest) => { rulings.push(r); return { stub: true, usage, text: JSON.stringify({ verdicts: r.items.flatMap(it => it.units.map(u => ({ item: it.item, unit: u.id, verdict: "wrong", rests_on: "computation", reason: `the third data line is row 3; the program says ${it.computed!.program_value}`, compute: null, where: null }))) }) } }
    const r = await judgeRuns(store.registry(), 4, [probe], runs, [], judge, { callId: n => `J${n}`, sandbox: new LocalScriptSandbox(), ruling })
    assert.deepEqual(r.findings.map(f => [f.verdict, f.kind]), [["wrong", "B"]])
    assert.equal(rulings.length, 1)
    assert.deepEqual([rulings[0].items[0].computed!.stdout.trim(), rulings[0].items[0].computed!.program_value], ["3", "2"])
    assert.ok(!JSON.stringify(rulings[0]).includes("DictReader"), "the ruling sees the computed value, not the script")
  })

  it("P132: the judge works the quartiles out wrong; the computation gives 0, the program wrote 0: nothing goes to the correction list", async () => {
    const unit = "R2.S16.P7.s1"
    assert.match(store.registry().block(unit)!.text, /iqr/u)
    const data = "value\n0\n0\n0\n1\n1\n1\n1\n4\n"
    const probe: ProbeRecord = { id: "P132", round: 2, key: "g7_iqr", args: ["transform", "--input", "data.csv", "--recipe", "r.json", "--output", "out.csv"], invalid_on_purpose: false, files: [{ path: "data.csv", content: data }, { path: "r.json", content: "[{\"op\":\"detect\",\"column\":\"value\",\"method\":\"iqr\",\"as\":\"is_outlier\",\"factor\":4}]" }], covers: [{ unit, case: null, trigger_values: ["iqr", "4"], wrong_would: "" }], call: "W1" }
    const out = "value,is_outlier\n0,0\n0,0\n0,0\n1,0\n1,0\n1,0\n1,0\n4,0\n"
    const runs = await runProbes([probe], node(`require("fs").writeFileSync("out.csv", ${JSON.stringify(out)})`), new LocalProcessRunner(), 10_000)
    // The R2 percentile method: idx = p/100*(n-1), interpolated. Q1 = 0, Q3 = 1, upper fence 1 + 4*1 = 5: 4 is no outlier.
    const script = "vals = sorted(float(l) for l in open('data.csv').read().split()[1:])\ndef pct(p):\n    i = p / 100 * (len(vals) - 1)\n    lo, hi = int(i // 1), int(-(-i // 1))\n    return vals[lo] + (i - lo) * (vals[hi] - vals[lo])\nq1, q3 = pct(25), pct(75)\nprint(1 if vals[-1] > q3 + 4 * (q3 - q1) or vals[-1] < q1 - 4 * (q3 - q1) else 0)"
    assert.equal(python(script.replace("open('data.csv').read()", JSON.stringify(data))), "0")
    const requests: JudgeRequest[] = []
    // As in rep1 R5: read, the judge takes Q1 as 0.75 and calls the last row an outlier. Told that a computed value is
    // not judged by reading, it gives the computation.
    const judge = async (r: JudgeRequest) => {
      requests.push(r)
      const verdicts = r.items.flatMap(it => it.units.map(u => r.problems
        ? { item: it.item, unit: u.id, verdict: "compute", rests_on: "computation", reason: "quartiles", compute: script, where: { kind: "csv_cell", path: "out.csv", line: 8, pointer: null, column: "is_outlier" } }
        : { item: it.item, unit: u.id, verdict: "wrong", rests_on: "computation", reason: "Q1=0.75, Q3=1, upper bound 2: 4 is an outlier and must be flagged 1", compute: null, where: null }))
      return { stub: true, usage, text: JSON.stringify({ verdicts }) }
    }
    const r = await judgeRuns(store.registry(), 5, [probe], runs, [], judge, { callId: n => `J${n}`, sandbox: new LocalScriptSandbox() })
    assert.match(requests[0].items[0].units[0].text, /iqr/u)
    assert.equal(requests.length, 2, "the wrong resting on a computation was sent back once")
    assert.ok(r.calls[0].problems.some(p => /rests on a computation is not accepted/u.test(p)), JSON.stringify(r.calls[0].problems))
    assert.deepEqual(r.findings.map(f => [f.verdict, f.kind]), [["ok", "B"]])
    assert.match(r.findings[0].reason, /the value computed independently \(0\) is the program's value at csv_cell out\.csv 8 is_outlier/u)
    assert.deepEqual(correctionItems(store.registry(), [probe], runs, r.findings), [])
  })

  it("P87: the digest is right and only the field keeps its old name; \"the digest is SHA-256\" does not reach the correction list", async () => {
    const unit = "R5.S1.P2.s2"
    assert.match(store.registry().block(unit)!.text, /BLAKE2b-256/u)
    const csv = "a\n1\n"
    const b2 = python(`import hashlib;print(hashlib.blake2b(${JSON.stringify(csv)}.encode(), digest_size=32).hexdigest())`)
    const manifest = JSON.stringify({ files: [{ path: "a.csv", sha256: b2, rows: 1, size_bytes: 4 }] })
    const probe: ProbeRecord = { id: "P87", round: 5, key: "g1_manifest", args: ["manifest", "--dir", ".", "--output", "manifest.json"], invalid_on_purpose: false, files: [{ path: "a.csv", content: csv }], covers: [{ unit, case: null, trigger_values: ["a.csv"], wrong_would: "" }], call: "W1" }
    const runs = await runProbes([probe], node(`require("fs").writeFileSync("manifest.json", ${JSON.stringify(manifest)})`), new LocalProcessRunner(), 10_000)
    const judge = async (r: JudgeRequest) => ({ stub: true, usage, text: JSON.stringify({ verdicts: r.items.flatMap(it => it.units.map(u => r.problems
      ? { item: it.item, unit: u.id, verdict: "compute", rests_on: "computation", reason: "a digest", compute: "import hashlib\nprint(hashlib.blake2b(open('a.csv','rb').read(), digest_size=32).hexdigest())", where: { kind: "json", path: "manifest.json", line: null, pointer: "/files/0/sha256", column: null } }
      : { item: it.item, unit: u.id, verdict: "wrong", rests_on: "computation", reason: "the digest is SHA-256, not BLAKE2b-256", compute: null, where: null })) }) })
    const r = await judgeRuns(store.registry(), 5, [probe], runs, [], judge, { callId: n => `J${n}`, sandbox: new LocalScriptSandbox() })
    assert.deepEqual(r.findings.map(f => [f.verdict, f.kind]), [["ok", "B"]])
    assert.deepEqual(correctionItems(store.registry(), [probe], runs, r.findings), [])
  })
})

const SORT_NUM = SORT.replace('import "sort"', 'import (\n\t"sort"\n\t"strconv"\n)').replace("return t.rows[a][i] < t.rows[b][i]", "x, _ := strconv.ParseFloat(t.rows[a][i], 64)\n\t\ty, _ := strconv.ParseFloat(t.rows[b][i], 64)\n\t\treturn x < y")
const ALL = ["filter", "sort", "rename", "drop"]
/**
 * The fixture slice. flip: a package-level value in filter.go that the sort reads, so a change there is no change
 * of any function the sort runs (a change coverage cannot follow). reverseInTransform: a change in transform's own
 * code that breaks the sort (one coverage can follow).
 */
const files = (o: { filterWrong?: boolean; flip?: boolean; reverseInTransform?: boolean } = {}) => {
  let transform = TRANSFORM(ALL)
  if (o.reverseInTransform) transform = transform.replace("\t\tif t, err = f(t, op); err != nil {\n\t\t\treturn fail(err.Error())\n\t\t}", "\t\tif t, err = f(t, op); err != nil {\n\t\t\treturn fail(err.Error())\n\t\t}\n\t\tif name == \"sort\" {\n\t\t\tfor i, j := 0, len(t.rows)-1; i < j; i, j = i+1, j-1 {\n\t\t\t\tt.rows[i], t.rows[j] = t.rows[j], t.rows[i]\n\t\t\t}\n\t\t}")
  const sort = SORT_NUM.replace("\treturn t, nil\n}", "\tif sortFlip {\n\t\tfor i, j := 0, len(t.rows)-1; i < j; i, j = i+1, j-1 {\n\t\t\tt.rows[i], t.rows[j] = t.rows[j], t.rows[i]\n\t\t}\n\t}\n\treturn t, nil\n}")
  const filter = FILTER(o.filterWrong ?? false) + `\nvar sortFlip = ${o.flip ? "true" : "false"}\n`
  return { "go.mod": GO_MOD, "main.go": MAIN, "verify.go": VERIFY(), "transform.go": transform, "filter.go": filter, "sort.go": sort, "rename.go": RENAME, "drop.go": DROP }
}

/** The serial's detection on a store's active probes, as the serial wires it (scope, ruling, full run). */
function detector(store: Exp2Store, round: number, judge: ReturnType<typeof stubJudge>, ruling?: Parameters<typeof runAndJudge>[0]["ruling"]): NonNullable<ExecutionDeps["detect"]> {
  return {
    passed: new Set(), program: "dpipe",
    run: async (program, beforeOk, contests, scope) => {
      const s = store.inspect()
      const all = activeProbes(s.probes, s.probe_events).filter(p => !scope?.probes || scope.probes.has(p.id))
      const r = await runAndJudge({ store, runner: new LocalProcessRunner(), timeoutMs: 10_000, judge, ...(ruling ? { ruling } : {}), sandbox: new LocalScriptSandbox() }, round, all, program, beforeOk, contests, { full: scope?.full === true })
      return { ...r, counts: { probes: all.length, judged: r.findings.filter(f => !f.cached && f.kind !== "B").length, cached: r.findings.filter(f => f.cached).length, by_code: r.findings.filter(f => !f.cached && f.kind === "B").length } }
    },
  }
}

describe("exp2 block 12 E3: an item a repair does not change goes to the independent session, not back to the executor", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-b12e3-"))

  for (const said of ["says so", "contests"] as const) it(`the judge calls a right filter wrong, the executor ${said === "says so" ? "says the program is right and changes nothing" : "contests it"}: one repair cycle, then a ruling; ruled right, no more cycles`, async () => {
    const store = new Exp2Store(join(dir, `store-${said}`), "b12e3")
    await store.ingestRound(1, roundText(1), stubTransport())
    await store.deriveRoundProbes(1, stubProbeWriter())
    const workdir = join(dir, `work-${said}`)
    mkdirSync(workdir, { recursive: true })
    initRepo(workdir)
    const registry = store.registry(), anchors = new GoAnchorExtractor()
    const filterPair = () => { const s = store.inspect(); const p = s.probes.find(x => x.key.endsWith("filter-gt"))!; return pairKey(p.id, p.covers[0].unit) }
    // A false positive read from the output: the stand-in judge calls the filter wrong although it keeps 20 and 12.
    const judge = stubJudge(item => item.input_files.some(f => f.content.includes("\"filter\"")) && !item.contest ? { verdict: "wrong", reason: "rows equal to the threshold must be kept" } : null)
    const rulings: JudgeRequest[] = []
    const ruling = async (r: JudgeRequest) => { rulings.push(r); return { stub: true, usage, text: JSON.stringify({ verdicts: r.items.flatMap(it => it.units.map(u => ({ item: it.item, unit: u.id, ...filterVerdict(it), rests_on: "reading", compute: null, where: null }))) }) } }
    const executor = new StubExecutor({ messages: [wd => write(wd, files()), () => said === "says so" ? "The filter already follows R1.S3.P2.s4: it keeps rows above the threshold." : `CONTEST ${filterPair()}: R1.S3.P2.s4 says greater than`] })
    const w = buildWorkOrder({ registry, round: 1, library: [], events: [], statuses: [], runs: [], anchors: anchors.extract(workdir), links: [], steps: [], previous_task: [] })
    const record = await executeRound(workdir, w, renderWorkOrder(w), executor, {
      registry, library: [], events: [], links: [], anchors, build: goBuilder(join(dir, `b-${said}`), {}, "dpipe", true), runner: new LocalProcessRunner(), facts: codeFacts(registry, 1),
      detect: detector(store, 1, judge, ruling),
      target: { units: new Set(), open: new Set(), seen: new Map(), probes: async () => activeProbes(store.inspect().probes, store.inspect().probe_events) },
    }, { ...DEFAULT_LIMITS, repairCycles: 3 })
    const key = filterPair()
    assert.equal(record.status, "done")
    assert.equal(record.cycles.length, 2, "one repair cycle")
    assert.equal(executor.log.messages.length, 2)
    assert.ok(record.cycles[0].corrections.includes(key))
    assert.deepEqual(record.cycles[1].ruled?.map(r => [r.id, r.verdict]), [[key, "ok"]])
    assert.deepEqual(record.cycles[1].corrections, [])
    assert.equal(rulings.length, 1, "one ruling, by the independent session")
    assert.match(rulings[0].items[0].contest!, said === "says so" ? new RegExp(NO_PROGRESS.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u") : /R1\.S3\.P2\.s4 says greater than/u)
    // Ruled right: on the same output the verdict is kept, so the item takes no cycle again.
    const s = store.inspect(), p = s.probes.find(x => x.key.endsWith("filter-gt"))!
    const again = await runAndJudge({ store, runner: new LocalProcessRunner(), timeoutMs: 10_000, judge, ruling }, 1, [p], goBuilder(join(dir, `b2-${said}`), {}, "dpipe", true)(workdir, "again").program!, new Set(), new Map())
    assert.deepEqual(again.findings.filter(f => f.unit === p.covers[0].unit).map(f => [f.verdict, f.cached, f.ruled]), [["ok", true, true]])
    assert.deepEqual(again.items, [])
    // The ledger alone tells the item's story: opened in R1 on the first cycle, sent once, ended by the ruling.
    const e = ledgerOf({ ...s, executions: [record] }, store.registry(s)).find(x => x.id === key)!
    assert.deepEqual([e.opened.round, e.opened.cycle, e.sent.length, e.end?.how], [1, "C1.1", 1, "ruled_program_right"])
    assert.equal(e.confirmed, null, "ruled program right: nothing confirmed, no cycle more")
    assert.ok(e.replies.length === 1 && e.replies[0].contest === (said === "contests"))
  })
})

describe("exp2 block 12 E4: each cycle runs what the round's text, the ledger and the cycle's change select; a full run before delivery catches the rest", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-b12e4-"))
  const store = new Exp2Store(join(dir, "store"), "b12e4")
  before(async () => {
    await store.ingestRound(1, roundText(1), stubTransport())
    await store.deriveRoundProbes(1, stubProbeWriter())
    await store.ingestRound(2, roundText(2), stubTransport())
  })

  async function round(name: string, messages: ((wd: string) => void)[]) {
    const workdir = join(dir, name)
    mkdirSync(workdir, { recursive: true })
    initRepo(workdir)
    const registry = store.registry(), anchors = new GoAnchorExtractor()
    // A later round's repair of R1's probes: their units are not this round's changed text.
    const w = buildWorkOrder({ registry, round: 2, library: [], events: [], statuses: [], runs: [], anchors: anchors.extract(workdir), links: [], steps: [], previous_task: [] })
    const record = await executeRound(workdir, w, renderWorkOrder(w), new StubExecutor({ messages }), {
      registry, library: [], events: [], links: [], anchors, build: goBuilder(join(dir, `b-${name}`), {}, "dpipe", true), runner: new LocalProcessRunner(), facts: codeFacts(registry, 2),
      detect: detector(store, 2, stubJudge()),
      target: { units: new Set(), open: new Set(), seen: new Map(), probes: async () => activeProbes(store.inspect().probes, store.inspect().probe_events) },
    }, { ...DEFAULT_LIMITS, repairCycles: 3 })
    const s = store.inspect(), id = (k: string) => s.probes.find(p => p.key.endsWith(k))!.id
    return { record, sort: id("sort-asc"), filter: id("filter-gt"), all: activeProbes(s.probes, s.probe_events).length }
  }

  it("the repair of filter also flips a value the sort reads: not selected by coverage, found by the full run and recorded as a selection omission", async () => {
    const { record, sort, filter, all } = await round("flip", [wd => write(wd, files({ filterWrong: true })), wd => write(wd, files({ flip: true })), wd => write(wd, files())])
    const [c1, c2, c3] = record.cycles
    assert.equal(record.status, "done")
    assert.deepEqual(c1.corrections.map(k => k.split("/")[0]), [filter])
    // The first cycle writes the program (package-level dispatch included) and nothing has coverage: everything runs.
    assert.equal(c1.probe_runs!.probes, all)
    assert.ok(c1.probe_runs!.selected!.all, JSON.stringify(c1.probe_runs!.selected))
    // The second cycle changed opFilter only: the filter probes (and the open item) run, the sort probe does not.
    assert.ok(c2.probe_runs!.probes < all / 2, JSON.stringify(c2.probe_runs))
    assert.ok(c2.probe_runs!.selected!.probes["open item"]! >= 1 && c2.probe_runs!.selected!.changed_functions === 1 && !c2.probe_runs!.selected!.all, JSON.stringify(c2.probe_runs!.selected))
    assert.ok(c2.sweep, "nothing left to send: the full run")
    assert.deepEqual(c2.sweep!.omissions.map(o => o.id), [sort])
    assert.deepEqual(c2.sweep!.found.map(k => k.split("/")[0]), [sort])
    assert.deepEqual(c2.corrections.map(k => k.split("/")[0]), [sort], "sent while cycles are left")
    assert.deepEqual(c3.corrections, [])
    assert.equal(record.sweep, c3.sweep, "the round's full run is on the kept cycle")
    assert.deepEqual(record.sweep!.omissions, [])
    assert.ok(Object.keys(record.coverage!.ids).length >= all && record.coverage!.functions.some(f => f.includes(":func:opSort")))
  })

  it("a change in transform's own code that breaks the sort is caught by the targeted run of the same cycle: no omission", async () => {
    const { record, sort } = await round("transform", [wd => write(wd, files({ filterWrong: true })), wd => write(wd, files({ reverseInTransform: true })), wd => write(wd, files())])
    const [, c2] = record.cycles
    assert.ok(c2.corrections.some(k => k.startsWith(`${sort}/`)), JSON.stringify(c2.corrections))
    assert.ok(!c2.sweep && !record.cycles.some(c => c.sweep?.omissions.length))
    assert.equal(record.status, "done")
  })

  it("what coverage follows: functions a run executed, and changes inside or outside any function", () => {
    const a = (id: string, kind: "func" | "file" | "type" | "dispatch", start: number, end: number, hash: string) => ({ id, kind, name: id, file: "f.go", start_line: start, end_line: end, hash })
    const before = [a("F", "file", 1, 30, "1"), a("g", "func", 3, 10, "a"), a("h", "func", 12, 20, "b"), a("d", "dispatch", 5, 5, "x")]
    assert.deepEqual(changeScope(before, [a("F", "file", 1, 30, "2"), a("g", "func", 3, 10, "c"), a("h", "func", 12, 20, "b"), a("d", "dispatch", 5, 5, "y")]), { all: null, changed_functions: ["g"], outside: [] })
    assert.match(changeScope(before, [a("F", "file", 1, 30, "2"), ...before.slice(1)]).all!, /outside any function: F/u)
    assert.deepEqual(coveredFunctions("mode: set\ndpipe/f.go:4.2,6.3 2 1\ndpipe/f.go:13.2,14.3 1 0\n", before), ["g"])
  })
})

describe("exp2 block 12 E5: calls that share an opening wait for the first one's reply", () => {
  it("judge batches and probe groups: the first call ends before any other starts", async () => {
    const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b12c-")), "b12c")
    await store.ingestRound(1, roundText(1), stubTransport())
    const spans: { start: number; end: number }[] = []
    const slow = <R, A>(t: (r: R) => Promise<A>) => async (r: R) => { const start = Date.now(); await new Promise(res => setTimeout(res, 40)); const a = await t(r); spans.push({ start, end: Date.now() }); return a }
    const units = [...store.registry().blocks.values()].filter(b => b.level === "sentence" && b.id.startsWith("R1.")).map(b => b.id).slice(0, 70)
    await deriveProbes(store.registry(), 1, units, slow(stubProbeWriter()), { maxRepairs: 0, callId: n => `W${n}` })
    assert.ok(spans.length >= 3)
    const first = spans.reduce((a, b) => a.start <= b.start ? a : b)
    assert.ok(spans.filter(s => s !== first).every(s => s.start >= first.end), "the groups after the first wait for its reply")
    spans.length = 0
    const p = await store.deriveRoundProbes(1, stubProbeWriter())
    const probes = store.inspect().probes.filter(x => p.entered.includes(x.id)).slice(0, 12)
    const runs = probes.map(x => ({ probe: x.id, output: { exit_code: 0, timed_out: false, stdout: x.id, stderr: "", files: {} } }))
    await judgeRuns(store.registry(), 1, probes, runs, [], slow(stubJudge()), { callId: n => `J${n}`, batchSize: 3 })
    const j = spans.reduce((a, b) => a.start <= b.start ? a : b)
    assert.ok(spans.length >= 4 && spans.filter(s => s !== j).every(s => s.start >= j.end))
  })
})

describe("exp2 block 12 E4: coverage in a docker batch", () => {
  it("the batch script records each run's counters outside its directory and turns them into the profile with the image's covdata", () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-b12d-"))
    const src = join(dir, "src")
    mkdirSync(src, { recursive: true })
    write(src, files())
    const program = goBuilder(join(dir, "b"), {}, "dpipe", true)(src, "cov").program!
    assert.equal(program.cover, true)
    const work = join(dir, "work")
    const recipe = (op: string) => [{ path: "data.csv", content: "id,value\n1,5\n2,20\n" }, { path: "r.json", content: `[{"op":"${op}","column":"value","condition":"gt","threshold":10,"order":"asc"}]` }]
    const inputs = ["filter", "sort"].map(op => ({ args: ["transform", "--input", "data.csv", "--recipe", "r.json", "--output", "out.csv"], files: recipe(op) }))
    inputs.forEach((x, i) => { mkdirSync(join(work, `r${i}`), { recursive: true }); for (const f of x.files) write(join(work, `r${i}`), { [f.path]: f.content }) })
    write(work, { "batch.sh": batchScript(program.command, inputs, 10_000, 1 << 20, work, true) })
    execFileSync("sh", [join(work, "batch.sh")], { stdio: "ignore", timeout: 60_000 })
    const anchors = new GoAnchorExtractor().extract(src)
    const ran = (i: number) => coveredFunctions(ranOnly(readFileSync(join(work, "__out", `r${i}.cov`), "utf8")), anchors)
    assert.ok(ran(0).some(f => f.endsWith(":func:opFilter")) && !ran(0).some(f => f.endsWith(":func:opSort")), JSON.stringify(ran(0)))
    assert.ok(ran(1).some(f => f.endsWith(":func:opSort")) && !ran(1).some(f => f.endsWith(":func:opFilter")))
    assert.equal(readFileSync(join(work, "__out", "r0.err"), "utf8"), "", "no coverage warning on stderr")
    assert.ok(!existsSync(join(work, "r0", "covmeta")) && readFileSync(join(work, "r0", "out.csv"), "utf8").includes("20"), "the counters are not in the run directory")
  })
})

describe("exp2 block 12 E2: the report's open items are the ledger's", () => {
  it("a pair judged ambiguous on the delivered program is listed, never sent; a failing one that stops failing is fixed", async () => {
    const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b12l-")), "b12l")
    await store.ingestRound(1, roundText(1), stubTransport())
    const zero = { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 }
    const cycle = (id: string, o: { items?: { id: string; verdict: string; action: "send" | "hold" | "none" }[]; ambiguous?: string[] }) => ({ id, round: 1, session: "s", message: "work" as const, commit: "", build: { ok: true, output: "" }, runs: [], failing: [], contests: [], corrections: [], ambiguous: o.ambiguous ?? [], broke: [], items: (o.items ?? []).map(i => ({ ...i, digest: "d" })), anchors: [], note: "", usage: zero })
    const execution = { round: 1, base: "", head: "", status: "done" as const, task: [], sessions: [], cycles: [cycle("C1.1", { items: [{ id: "P2/R1.S3.P2.s4", verdict: "wrong", action: "send" }] }), cycle("C1.2", { items: [{ id: "P2/R1.S3.P2.s4", verdict: "ok", action: "none" }], ambiguous: ["P1/R1.S3.P9.s2"] })], kept: "C1.2", carried: [], open: [], links: [], usage: zero, final: [] }
    const s = store.inspect()
    const ledger = ledgerOf({ ...s, executions: [execution] }, store.registry(s))
    const amb = ledger.find(e => e.id === "P1/R1.S3.P9.s2")!, fixed = ledger.find(e => e.id === "P2/R1.S3.P2.s4")!
    assert.deepEqual([amb.reason, amb.state, amb.sent.length], ["ambiguous", "report_only", 0])
    assert.deepEqual([fixed.state, fixed.end?.how, fixed.sent], ["closed", "fixed", ["C1.1"]])
    const summary = acceptanceFromLedger({ A: 0, B: 0, C: 2 }, ledger)
    assert.deepEqual([summary.open.ambiguous, summary.open.program_wrong], [["P1/R1.S3.P9.s2"], []])
  })

  it("no ruling confirmed it: a changed output at two round ends in a row, sent in between, still failing (touched, not fixed; batch 3a), and it is listed only; a confirmed one stays open, and a ruling of program right ends it", async () => {
    const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b12x-")), "b12x")
    await store.ingestRound(1, roundText(1), stubTransport())
    const zero = { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 }
    const [A, B, C] = ["P1/R1.S3.P2.s4", "P2/R1.S3.P9.s2", "P3/R1.S3.P9.s3"]
    const round = (r: number) => {
      // C is ruled program right in R1: its kept verdict keeps it from failing again.
      // A's output changes every round (touched); B's stays the same.
      const d = (id: string, at: number) => id === A ? `d${at}` : "d"
      const items = (r === 1 ? [A, B, C] : [A, B]).map(id => ({ id, digest: d(id, r), verdict: "wrong", action: (r === 1 ? "send" : "hold") as "send" | "hold" }))
      const ruled = r === 1 ? [{ id: C, verdict: "ok", reason: "the program follows the text" }] : []
      const c = { id: `C${r}.1`, round: r, session: "s", message: "work" as const, commit: "", build: { ok: true, output: "" }, runs: [], failing: [], contests: [], corrections: [A, B], ambiguous: [], broke: [], items, ...(ruled.length ? { ruled } : {}), anchors: [], note: "", usage: zero }
      return { round: r, base: "", head: "", status: "done" as const, task: [], sessions: [], cycles: [c], kept: c.id, carried: [], open: [], links: [], usage: zero, ...(r > 1 ? { carried_in: [{ id: A, digest: d(A, r - 1) }, { id: B, digest: "d" }] } : {}), final: [A, B].map(id => ({ id, digest: d(id, r), verdict: "wrong", action: "none" as const })) }
    }
    const s = store.inspect()
    const ledger = ledgerOf({ ...s, executions: [1, 2, 3].map(round), judgments: [{ probe: "P2", unit: "R1.S3.P9.s2", verdict: "wrong", round: 1, ruled: true }] }, store.registry(s))
    const get = (id: string) => ledger.find(e => e.id === id)!
    assert.deepEqual([get(A).state, get(A).end?.how, get(A).end?.round, get(A).confirmed], ["report_only", "expired", 2, null], "unconfirmed: listed only after R2")
    assert.deepEqual([get(B).state, get(B).end, get(B).confirmed, get(B).rounds], ["open", null, { round: 1 }, [1, 2, 3]], "confirmed: still open after three rounds")
    assert.deepEqual([get(C).state, get(C).end?.how], ["closed", "ruled_program_right"], "a false positive ruled right ends")
    const sum = ledgerSummary(ledger, 3)
    assert.deepEqual([sum.confirmed, sum.report_only.map(x => [x.id, x.how])], [[B], [[A, "expired"]]])
  })
})
