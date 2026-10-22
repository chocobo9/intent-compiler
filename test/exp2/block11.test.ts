import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { goBuilder } from "../../src/exp2/build.js"
import { activeChecks, codeFacts } from "../../src/exp2/checks.js"
import type { AdjudicationRequest } from "../../src/exp2/adjudication.js"
import { acceptanceSummary, libraryKind, renderReport } from "../../src/exp2/report.js"
import { runChecks } from "../../src/exp2/verdict.js"
import { checkStubTransport } from "./check-stubs.js"
import { batchResult, batchScript } from "../../src/exp2/docker.js"
import { executeRound, DEFAULT_LIMITS } from "../../src/exp2/execution.js"
import { initRepo } from "../../src/exp2/git.js"
import { correctionItems, judgeRuns, pairKey, type JudgeRequest } from "../../src/exp2/judge.js"
import { activeProbes, gapState, openGaps, runProbes, type ProbeRecord, type ProbeRequest } from "../../src/exp2/probes.js"
import { LocalProcessRunner, LocalScriptSandbox, nullBaseline, type ProgramRef } from "../../src/exp2/runner.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { Serial, verdictCounts } from "../../src/exp2/serial.js"
import { serialExecutor } from "./serial-executor.js"
import { buildWorkOrder, renderWorkOrder } from "../../src/exp2/workorder.js"
import { DROP, FILTER, GO_MOD, MAIN, RENAME, SORT, TRANSFORM, VERIFY } from "./go-fixtures.js"
import { roundText } from "./inputs.js"
import { sortProbe, sortVerdict, stubJudge, stubProbeWriter } from "./probe-stubs.js"
import { StubExecutor, write } from "./stub-executor.js"
import { stubTransport } from "./stubs.js"

const SORT_NUM = SORT.replace('import "sort"', 'import (\n\t"sort"\n\t"strconv"\n)').replace("return t.rows[a][i] < t.rows[b][i]", "x, _ := strconv.ParseFloat(t.rows[a][i], 64)\n\t\ty, _ := strconv.ParseFloat(t.rows[b][i], 64)\n\t\treturn x < y")
const ALL = ["filter", "sort", "rename", "drop"]
const files = (o: { filterWrong?: boolean; reverseAfterSort?: boolean; sort?: string } = {}) => {
  let transform = TRANSFORM(ALL)
  // A change in the transform command's own code that breaks sort's output, in no function named for sort.
  if (o.reverseAfterSort) transform = transform.replace("\t\tif t, err = f(t, op); err != nil {\n\t\t\treturn fail(err.Error())\n\t\t}", "\t\tif t, err = f(t, op); err != nil {\n\t\t\treturn fail(err.Error())\n\t\t}\n\t\tif name == \"sort\" {\n\t\t\tfor i, j := 0, len(t.rows)-1; i < j; i, j = i+1, j-1 {\n\t\t\t\tt.rows[i], t.rows[j] = t.rows[j], t.rows[i]\n\t\t\t}\n\t\t}")
  return { "go.mod": GO_MOD, "main.go": MAIN, "verify.go": VERIFY(), "transform.go": transform, "filter.go": FILTER(o.filterWrong ?? false), "sort.go": o.sort ?? SORT_NUM, "rename.go": RENAME, "drop.go": DROP }
}

describe("exp2 block 11 §1: every cycle runs every check and probe in one batch; only judgments whose output changed are redone", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-b11a-"))
  const store = new Exp2Store(join(dir, "store"), "b11a")
  before(async () => {
    await store.ingestRound(1, roundText(1), stubTransport())
    await store.deriveRoundProbes(1, stubProbeWriter())
  })

  it("the repair of filter breaks sort in the transform command's own code; the same cycle's full run catches it, marked as broken", async () => {
    const workdir = join(dir, "work")
    mkdirSync(workdir, { recursive: true })
    initRepo(workdir)
    const registry = store.registry(), anchors = new GoAnchorExtractor(), runner = new LocalProcessRunner()
    const all = activeProbes(store.inspect().probes, store.inspect().probe_events)
    const judge = stubJudge()
    let batches = 0
    const batching = new class extends LocalProcessRunner { override runBatch(...a: Parameters<LocalProcessRunner["runBatch"]>) { batches++; return super.runBatch(...a) } }()
    const w = buildWorkOrder({ registry, round: 1, library: [], events: [], statuses: [], runs: [], anchors: anchors.extract(workdir), links: [], steps: [], previous_task: [] })
    const executor = new StubExecutor({ messages: [
      wd => write(wd, files({ filterWrong: true })),
      wd => write(wd, files({ reverseAfterSort: true })),
      wd => write(wd, files()),
    ] })
    const record = await executeRound(workdir, w, renderWorkOrder(w), executor, {
      registry, library: [], events: [], links: [], anchors, build: goBuilder(join(dir, "b"), {}, "dpipe"), runner, facts: codeFacts(registry, 1),
      detect: {
        passed: new Set(), program: "dpipe",
        run: async (program, beforeOk, contests) => {
          const runs = await runProbes(all, program, batching, 10_000)
          const findings = await store.judge(1, runs, judge, { contests })
          return { findings, items: correctionItems(store.registry(), all, runs, findings, beforeOk), counts: { probes: all.length, ...verdictCounts(findings) } }
        },
      },
    }, { ...DEFAULT_LIMITS, repairCycles: 3 })
    const key = (name: string) => all.find(p => p.key.endsWith(name))!.id
    const [c1, c2, c3] = record.cycles
    assert.equal(record.status, "done")
    assert.equal(batches, record.cycles.length, "one batch per cycle")
    for (const c of record.cycles) assert.equal(c.probe_runs!.probes, all.length, "every probe, every cycle")
    assert.deepEqual(c1.corrections.map(k => k.split("/")[0]), [key("filter-gt")])
    // The repair of filter broke sort: caught in that same cycle, no anchor selection needed.
    assert.deepEqual(c2.corrections.map(k => k.split("/")[0]), [key("sort-asc")])
    assert.deepEqual(c2.broke, c2.corrections)
    assert.deepEqual(c3.corrections, [])
    // Judgments are redone only where the output changed: most come from the cache after the first cycle.
    assert.ok(c1.probe_runs!.judged > 0 && c1.probe_runs!.cached === 0, JSON.stringify(c1.probe_runs))
    assert.ok(c2.probe_runs!.cached > c2.probe_runs!.judged, JSON.stringify(c2.probe_runs))
  })

  it("a batch is one shell script: each run in its own directory, with its own time and output limit", () => {
    const work = mkdtempSync(join(tmpdir(), "exp2-b11s-"))
    const inputs = [{ args: ["ok"], files: [{ path: "in.txt", content: "x" }] }, { args: ["sleep"], files: [] }, { args: ["flood"], files: [] }, { args: ["it's"], files: [] }]
    inputs.forEach((x, i) => { mkdirSync(join(work, `r${i}`)); for (const f of x.files) writeFileSync(join(work, `r${i}`, f.path), f.content) })
    const prog = join(work, "prog.sh")
    writeFileSync(prog, `case "$1" in ok) cat in.txt; echo made > made.txt;; sleep) sleep 5;; flood) yes x;; *) echo "arg=$1"; exit 3;; esac\n`)
    writeFileSync(join(work, "batch.sh"), batchScript(["sh", prog], inputs, 1000, 4096, work))
    try { execFileSync("sh", [join(work, "batch.sh")], { stdio: "ignore", timeout: 30_000 }) } catch { /* the script's own exit does not matter */ }
    const read = (f: string) => readFileSync(join(work, "__out", f), "utf8")
    const result = (i: number) => batchResult(Number(read(`r${i}.code`)), read(`r${i}.out`), read(`r${i}.err`), Number(read(`r${i}.ms`)), 1000, {}, 1024)
    assert.deepEqual([result(0).exit_code, result(0).stdout], [0, "x"])
    assert.equal(readFileSync(join(work, "r0", "made.txt"), "utf8"), "made\n")
    assert.equal(result(1).limit?.kind, "time")
    assert.equal(result(2).limit?.kind, "output")
    assert.ok(read("r2.out").length <= 4096)
    assert.deepEqual([result(3).exit_code, result(3).stdout], [3, "arg=it's\n"], "arguments are quoted")
  })
})

describe("exp2 block 11 §2: a unit no probe exercises is carried and written for again until exercised or declared uncheckable", () => {
  const X = "R1.S3.P9.s3"
  const without = (inner: ReturnType<typeof stubProbeWriter>) => async (r: ProbeRequest) => {
    const reply = await inner(r)
    const a = JSON.parse(reply.text)
    a.probes = a.probes.filter((p: { covers: { unit: string }[] }) => !p.covers.some(c => c.unit === X))
    return { ...reply, text: JSON.stringify(a) }
  }

  it("left out in R1 (and sent back within R1), written for in R2 and closed; or declared uncheckable in R2 and closed", async () => {
    for (const close of ["cover", "uncheckable"] as const) {
      const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b11g-")), "b11g")
      for (const r of [1, 2, 3]) await store.ingestRound(r, roundText(r), stubTransport())
      const w1 = stubProbeWriter()
      const r1 = await store.deriveRoundProbes(1, without(w1))
      assert.deepEqual(r1.uncovered, [X])
      assert.ok(w1.requests.some(q => q.problems?.some(p => p.includes(X))), "sent back within the round")
      assert.deepEqual(openGaps(store.registry(), store.inspect().probe_rounds), [X])
      const w2 = stubProbeWriter()
      const writer2 = close === "cover" ? w2 : async (r: ProbeRequest) => {
        const reply = await without(w2)(r)
        const a = JSON.parse(reply.text)
        if (r.units.some(u => u.id === X)) a.uncheckable.push({ unit: X, reason: "no run shows it" })
        return { ...reply, text: JSON.stringify(a) }
      }
      const r2 = await store.deriveRoundProbes(2, writer2)
      assert.deepEqual(r2.gaps_in, [X], "carried into R2's writing")
      assert.ok(w2.requests.some(q => q.units.some(u => u.id === X)))
      assert.ok(!r2.uncovered.includes(X))
      assert.deepEqual(openGaps(store.registry(), store.inspect().probe_rounds), [], `closed by ${close}`)
      const r3 = await store.deriveRoundProbes(3, stubProbeWriter())
      assert.equal(r3.gaps_in, undefined)
    }
  })
})

describe("exp2 block 11 §3: a probe is judged against the rule its input exercises, whatever unit it was written for", () => {
  it("a sort probe filed under the neighbouring unit: the judge adds the sort rule, its verdict is a correction item, and it is kept with the output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-b11w-"))
    const store = new Exp2Store(join(dir, "store"), "b11w")
    await store.ingestRound(1, roundText(1), stubTransport())
    const registry = store.registry()
    const sortUnit = "R1.S3.P9.s2", neighbour = "R1.S3.P9.s3"
    const probe: ProbeRecord = { ...sortProbe(neighbour, null), id: "P1", round: 1, key: "g1_sort-asc", call: "W1", covers: [{ unit: neighbour, case: null, trigger_values: ["20"], wrong_would: "" }] }
    const tree = join(dir, "tree")
    mkdirSync(tree, { recursive: true })
    write(tree, files({ sort: SORT }))
    const program = goBuilder(join(dir, "b"), {}, "dpipe")(tree, "text-sort").program!
    const runs = await runProbes([probe], program, new LocalProcessRunner(), 10_000)
    // The stand-in judge reads the call: a sort recipe exercises the sort rule, which it adds by id from the sources.
    let asked = 0
    const judge = async (r: JudgeRequest) => {
      asked++
      const verdicts = r.items.flatMap(it => [
        ...it.units.map(u => ({ item: it.item, unit: u.id, verdict: "ok", reason: "the call is accepted", compute: null })),
        ...(it.input_files.some(f => f.content.includes("\"sort\"")) ? [{ item: it.item, unit: sortUnit, ...sortVerdict(it), compute: null }] : []),
      ])
      return { text: JSON.stringify({ verdicts }), stub: true }
    }
    const first = await judgeRuns(registry, 1, [probe], runs, [], judge, { callId: n => `J${n}` })
    const sortFinding = first.findings.find(f => f.unit === sortUnit)!
    assert.equal(sortFinding.verdict, "wrong")
    assert.ok(first.judgments.find(j => j.unit === sortUnit)!.also)
    const items = correctionItems(registry, [probe], runs, first.findings)
    assert.deepEqual(items.map(i => i.key), [pairKey("P1", sortUnit)])
    assert.match(items[0].rule.text, /`sort`: Sort rows/u)
    // The same output again: no call, and the added unit's verdict comes back with the kept ones.
    const again = await judgeRuns(registry, 1, [probe], runs, first.judgments, judge, { callId: n => `J${n}` })
    assert.equal(asked, 1)
    assert.deepEqual(again.findings.map(f => [f.unit, f.verdict, f.cached]), [[neighbour, "ok", true], [sortUnit, "wrong", true]])
  })
})

describe("exp2 block 11 §4: a value that needs computing is ruled on an independent computation", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-b11c-"))
  const store = new Exp2Store(join(dir, "store"), "b11c")
  const unit = "R1.S3.P24.s1"
  const probe: ProbeRecord = { id: "P1", round: 1, key: "g1_digest", args: ["transform", "--output", "out.csv"], files: [], invalid_on_purpose: false, covers: [{ unit, case: null, trigger_values: ["out.csv"], wrong_would: "" }], call: "W1" }
  const program = (digest: string): ProgramRef => ({ id: "d", label: "d", source_dir: null, command: [process.execPath, "-e", `require("fs").writeFileSync("out.csv","a\\n1\\n");require("fs").writeFileSync("out.csv.sha256","${digest}\\n")`] })
  const RIGHT = "4ba8d03c8d4fd9e4f6e1b8d82a9c8f84f1cd6b1d4e7a0c48d5f4aba0b4b6c6c3"
  // The stand-in judge does not read digests: it asks for one, and compares what the script printed.
  const judge = async (r: JudgeRequest) => ({ stub: true, text: JSON.stringify({ verdicts: r.items.flatMap(it => it.units.map(u => it.computed
    ? { item: it.item, unit: u.id, verdict: it.computed.stdout.trim() === (it.result.files["out.csv.sha256"] ?? "").trim() ? "ok" : "wrong", reason: `computed ${it.computed.stdout.trim()}, the program wrote ${(it.result.files["out.csv.sha256"] ?? "").trim()}`, compute: null }
    : { item: it.item, unit: u.id, verdict: "compute", reason: "a digest", compute: "import hashlib\nprint(hashlib.sha256(open('out.csv','rb').read()).hexdigest())", where: { kind: "file", path: "out.csv.sha256", line: null, pointer: null, column: null } })) }) })
  before(async () => { await store.ingestRound(1, roundText(1), stubTransport()) })

  it("a wrong digest is ruled wrong, a right one ok, both resting on the computation; without a sandbox it is cannot_tell", async () => {
    const registry = store.registry(), runner = new LocalProcessRunner(), sandbox = new LocalScriptSandbox()
    const right = execFileSync("python3", ["-c", "import hashlib;print(hashlib.sha256(b'a\\n1\\n').hexdigest())"], { encoding: "utf8" }).trim()
    assert.notEqual(right, RIGHT)
    const wrongRuns = await runProbes([probe], program(RIGHT), runner, 10_000)
    const w = await judgeRuns(registry, 1, [probe], wrongRuns, [], judge, { callId: n => `J${n}`, sandbox })
    assert.deepEqual(w.findings.map(f => f.verdict), ["wrong"])
    assert.match(w.findings[0].reason, new RegExp(`computed ${right}`, "u"))
    assert.ok(w.judgments[0].computed)
    assert.equal(w.calls.length, 2, "the request for a computation and the verdict on it")
    const okRuns = await runProbes([probe], program(right), runner, 10_000)
    assert.deepEqual((await judgeRuns(registry, 1, [probe], okRuns, [], judge, { callId: n => `J${n}`, sandbox })).findings.map(f => f.verdict), ["ok"])
    // With an adjudicator, it rules the disagreement, shown the computed value and not the script.
    const ruled: JudgeRequest[] = []
    const ruling = async (r: JudgeRequest) => { ruled.push(r); return judge(r) }
    const viaRuling = await judgeRuns(registry, 1, [probe], wrongRuns, [], judge, { callId: n => `J${n}`, sandbox, ruling })
    assert.deepEqual(viaRuling.findings.map(f => [f.verdict, f.kind]), [["wrong", "B"]])
    assert.equal(ruled.length, 1)
    assert.ok(ruled[0].items[0].computed && !JSON.stringify(ruled[0]).includes("hashlib"), "no script in the ruling's request")
    const none = await judgeRuns(registry, 1, [probe], wrongRuns, [], judge, { callId: n => `J${n}` })
    assert.deepEqual(none.findings.map(f => [f.verdict, f.reason]), [["cannot_tell", "a value to compute, and no sandbox to compute it"]])
  })
})

describe("exp2 block 11 §5 (DESIGN §12g): one acceptance model; A and B are compared by code, a B disagreement is ruled without the reference code", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-b11u-"))
  const store = new Exp2Store(join(dir, "store"), "b11u")
  const base = { "go.mod": GO_MOD, "main.go": MAIN, "verify.go": VERIFY() }
  const built = (name: string, fs: Record<string, string>) => { const p = join(dir, name); mkdirSync(p, { recursive: true }); write(p, fs); return goBuilder(join(dir, `b-${name}`), {}, "dpipe")(p, name).program! }
  before(async () => {
    await store.ingestRound(1, roundText(1), stubTransport())
    await store.deriveRoundChecks(1, checkStubTransport(), { sandbox: new LocalScriptSandbox(), runner: new LocalProcessRunner(), baseline: nullBaseline(join(dir, "null")) })
  })

  it("a value the text states, and a crash, are ruled wrong by code: no judge or adjudicator call", async () => {
    const registry = store.registry(), lib = store.inspect().checks
    // A stated message (kind A) the program does not print: not landed by code.
    const missing = lib.find(k => k.key === "transform-missing-input")!
    assert.equal(libraryKind(missing), "A")
    const wrongMsg = built("msg", { ...base, "transform.go": TRANSFORM(["filter"]).replaceAll("file not found", "no such file"), "filter.go": FILTER(false) })
    const [run] = await runChecks([missing], wrongMsg, new LocalProcessRunner(), 1, registry, codeFacts(registry, 1), 10_000)
    assert.deepEqual([run.outcome, run.failure?.class, run.failure?.reason], ["fail", "not_landed", "value_mismatch"])
    // A probe whose run panics: wrong by code, before any judge sees it.
    const unit = "R1.S3.P9.s2"
    const probe: ProbeRecord = { ...sortProbe(unit, null), id: "P1", round: 1, key: "g1_panic", call: "W1" }
    const panics: ProgramRef = { id: "p", label: "p", source_dir: null, command: [process.execPath, "-e", `process.stderr.write("panic: runtime error: index out of range [3] with length 3\\n\\ngoroutine 1 [running]:\\nmain.opSort()\\n"); process.exit(2)`] }
    const runs = await runProbes([probe], panics, new LocalProcessRunner(), 10_000)
    const judged = await judgeRuns(registry, 1, [probe], runs, [], async () => { throw new Error("no model call expected") }, { callId: n => `J${n}` })
    assert.deepEqual(judged.findings.map(f => [f.verdict, f.kind]), [["wrong", "B"]])
    assert.equal(judged.calls.length, 0)
  })

  it("a reference value (kind B) the program disagrees with is ruled on from the text, the output and the reference's value, not its code; program wrong, reference wrong, or ambiguous", async () => {
    const registry = store.registry(), lib = store.inspect().checks
    const k = lib.find(c => c.key === "filter-gt")!
    assert.equal(libraryKind(k), "B")
    assert.ok(k.reference_script, "the check has a reference script")
    const wrong = built("filter-wrong", { ...base, "transform.go": TRANSFORM(["filter"]), "filter.go": FILTER(true) })
    const [run] = await runChecks([k], wrong, new LocalProcessRunner(), 1, registry, codeFacts(registry, 1), 10_000)
    assert.deepEqual([run.failure?.class, run.failure?.reason], ["disputed", "reference"])
    const seen: AdjudicationRequest[] = []
    const ruling = (verdict: string) => async (r: AdjudicationRequest) => { seen.push(r); return { stub: true, text: JSON.stringify({ verdict, basis: [k.blocks[0]], reason: "the text" }) } }
    // The program wrong: the check stands, and counts against the program from then on.
    const right = await store.settle(1, [{ check: k.id, run, kind: "reference", detail: run.failure!.detail }], ruling("check_right"))
    assert.deepEqual([...right.right], [k.id])
    const text = JSON.stringify(seen[0])
    assert.ok(!text.includes(k.reference_script!.code.trim().split("\n")[0]) && !("reference_script" in seen[0].check), "the reference's code is not shown")
    assert.deepEqual(seen[0].dispute.run.failed.map(f => f.id).sort(), run.assertions.filter(a => !a.ok).map(a => a.id).sort(), "the program's output")
    assert.ok(seen[0].check.assertions.every(a => a.expect !== undefined), "the reference's values")
    const [again] = await runChecks([k], wrong, new LocalProcessRunner(), 1, registry, codeFacts(registry, 1), 10_000, () => new Set(["reference"]))
    assert.deepEqual([again.failure?.class, again.failure?.reason], ["not_landed", "value_mismatch"])
  })

  it("ruled \"reference wrong\": the check leaves, and nothing about it goes to the executor", async () => {
    const s4 = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b11r-")), "b11r")
    await s4.ingestRound(1, roundText(1), stubTransport())
    await s4.deriveRoundChecks(1, checkStubTransport(), { sandbox: new LocalScriptSandbox(), runner: new LocalProcessRunner(), baseline: nullBaseline(join(dir, "null4")) })
    const registry = s4.registry(), anchors = new GoAnchorExtractor()
    const k = s4.inspect().checks.find(c => c.key === "filter-gt")!
    const workdir = join(dir, "work-r")
    mkdirSync(workdir, { recursive: true })
    initRepo(workdir)
    const w = buildWorkOrder({ registry, round: 1, library: [k], events: [], statuses: [], runs: [], anchors: anchors.extract(workdir), links: [], steps: [], previous_task: [] })
    const executor = new StubExecutor({ messages: [wd => write(wd, { ...base, "transform.go": TRANSFORM(["filter"]), "filter.go": FILTER(true) })] })
    const settle = (d: Parameters<Exp2Store["settle"]>[1]) => s4.settle(1, d, async () => ({ stub: true, text: JSON.stringify({ verdict: "check_wrong", basis: [k.blocks[0]], reason: "the reference reads the threshold as exclusive" }) }))
    const record = await executeRound(workdir, w, renderWorkOrder(w), executor, {
      registry, library: [k], events: [], links: [], anchors, build: goBuilder(join(dir, "b-r"), {}, "dpipe"), runner: new LocalProcessRunner(), facts: codeFacts(registry, 1), settle,
    }, { ...DEFAULT_LIMITS, repairCycles: 2 })
    assert.equal(s4.inspect().rulings[0].kind, "reference")
    assert.deepEqual(record.cycles[0].failing, [])
    assert.equal(executor.log.messages.length, 1, "no repair message")
    assert.ok(!activeChecks(s4.inspect().checks, s4.inspect().check_events).some(c => c.id === k.id))
  })

  it("a ruling of ambiguity retires the check from repair and leaves it on record as an open item of that reason", async () => {
    const s2 = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b11v-")), "b11v")
    await s2.ingestRound(1, roundText(1), stubTransport())
    await s2.deriveRoundChecks(1, checkStubTransport(), { sandbox: new LocalScriptSandbox(), runner: new LocalProcessRunner(), baseline: nullBaseline(join(dir, "null2")) })
    const registry = s2.registry(), k = s2.inspect().checks.find(c => c.key === "filter-gt")!
    const wrong = built("filter-wrong2", { ...base, "transform.go": TRANSFORM(["filter"]), "filter.go": FILTER(true) })
    const [run] = await runChecks([k], wrong, new LocalProcessRunner(), 1, registry, codeFacts(registry, 1), 10_000)
    const out = await s2.settle(1, [{ check: k.id, run, kind: "reference", detail: run.failure!.detail }], async () => ({ stub: true, text: JSON.stringify({ verdict: "text_ambiguous", basis: [k.blocks[0]], reason: "either reading" }) }))
    assert.deepEqual([...out.wrong], [k.id])
    const st = s2.inspect()
    const summary = acceptanceSummary({ library: st.checks, runs: [], events: st.check_events, findings: [], gaps: { open: [], closed: [] } })
    assert.deepEqual(summary.open.ambiguous, [k.id])
    assert.ok(!activeChecks(st.checks, st.check_events).some(c => c.id === k.id), "no longer sent for repair")
  })

  it("an uncovered unit written for twice without a probe is closed as uncheckable by code, and still reported", async () => {
    const X = "R1.S3.P9.s3"
    const s3 = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b11x-")), "b11x")
    for (const r of [1, 2]) await s3.ingestRound(r, roundText(r), stubTransport())
    const without = async (r: ProbeRequest) => {
      const reply = await stubProbeWriter()(r)
      const a = JSON.parse(reply.text)
      a.probes = a.probes.filter((p: { covers: { unit: string }[] }) => !p.covers.some(c => c.unit === X))
      return { ...reply, text: JSON.stringify(a) }
    }
    await s3.deriveRoundProbes(1, without)
    assert.deepEqual(gapState(s3.registry(), s3.inspect().probe_rounds).open, [X], "carried")
    const r2 = await s3.deriveRoundProbes(2, without)
    assert.deepEqual(r2.gaps_in, [X])
    const g = gapState(s3.registry(), s3.inspect().probe_rounds)
    assert.deepEqual(g.open, [])
    assert.deepEqual(g.closed.map(c => [c.unit, c.reason]), [[X, "uncheckable: no probe exercised it in 2 writings (rounds 1, 2)"]])
    const summary = acceptanceSummary({ library: [], runs: [], events: [], findings: [], gaps: g })
    assert.deepEqual(summary.open.uncheckable.map(u => u.unit), [X])
  })
})

describe("exp2 block 11 §6: the round report shows determinations by kind, open items by reason, and what each cycle ran", () => {
  it("a stand-in R1 with the check library on, probes, judge and adjudicator", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-b11p-"))
    const store = new Exp2Store(join(dir, "store"), "b11p")
    const serial = new Serial({
      store, workdir: join(dir, "work"), checkpoints: join(dir, "checkpoints"), text: roundText, attribution: stubTransport(), checks: checkStubTransport(),
      executor: serialExecutor(), executorIsStub: true, anchors: new GoAnchorExtractor(), runner: new LocalProcessRunner(), sandbox: new LocalScriptSandbox(), build: goBuilder(join(dir, "builds"), {}, "dpipe"), binary: "dpipe",
      probes: stubProbeWriter(), judge: stubJudge(), adjudicate: async () => ({ stub: true, text: JSON.stringify({ verdict: "check_right", basis: ["R1.S3"], reason: "the text" }) }),
      limits: { attributionRepairs: 2, checkRepairs: 2, managementTimeoutMs: 60_000, checkTimeoutMs: 10_000, execution: { ...DEFAULT_LIMITS, repairCycles: 1 } },
    })
    assert.equal((await serial.run({ to: 1 })).status, "done")
    const r1 = store.inspect().reports[0]
    const a = r1.acceptance!
    assert.ok(a.by_kind.A > 0 && a.by_kind.B > 0 && a.by_kind.C > 0, JSON.stringify(a.by_kind))
    assert.deepEqual(Object.keys(a.open).sort(), ["ambiguous", "confirmed", "expired", "program_wrong", "reference_pending", "uncheckable", "uncovered"])
    const cycles = r1.probes!.runs_by_cycle
    assert.ok(cycles.length > 0 && cycles.every(c => c.checks > 0 && c.probes > 0), JSON.stringify(cycles))
    const text = renderReport(r1)
    assert.match(text, /Determinations on the final program: \d+ stated values \(A\), \d+ by a reference \(B\), \d+ by judgment \(C\)/u)
    assert.match(text, /Open: program wrong \d+, uncovered \d+, reference disagreement pending \d+, ambiguous \d+; closed as uncheckable \d+/u)
    assert.match(text, /Runs per cycle \(in batches\): \S+ checks \d+, probes \d+: judged \d+ \(output changed\), cached \d+, by code \d+/u)
  })
})
