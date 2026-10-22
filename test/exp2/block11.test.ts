import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { goBuilder } from "../../src/exp2/build.js"
import { codeFacts } from "../../src/exp2/checks.js"
import { batchResult, batchScript } from "../../src/exp2/docker.js"
import { executeRound, DEFAULT_LIMITS } from "../../src/exp2/execution.js"
import { initRepo } from "../../src/exp2/git.js"
import { correctionItems, judgeRuns, pairKey, type JudgeRequest } from "../../src/exp2/judge.js"
import { activeProbes, openGaps, runProbes, type ProbeRecord, type ProbeRequest } from "../../src/exp2/probes.js"
import { LocalProcessRunner, LocalScriptSandbox, type ProgramRef } from "../../src/exp2/runner.js"
import { pickProbes } from "../../src/exp2/serial.js"
import { Exp2Store } from "../../src/exp2/store.js"
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

describe("exp2 block 11 §1: after a repair only what the change can affect is verified again; an end-of-round check still catches what it broke elsewhere", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-b11a-"))
  const store = new Exp2Store(join(dir, "store"), "b11a")
  before(async () => {
    await store.ingestRound(1, roundText(1), stubTransport())
    await store.deriveRoundProbes(1, stubProbeWriter())
  })

  it("the repair of filter reruns filter's and the changed command's probes and the open item; the sort it broke is caught by the end check, before the round ends", async () => {
    const workdir = join(dir, "work")
    mkdirSync(workdir, { recursive: true })
    initRepo(workdir)
    const registry = store.registry(), anchors = new GoAnchorExtractor(), runner = new LocalProcessRunner()
    const all = activeProbes(store.inspect().probes, store.inspect().probe_events)
    const ran = new Set<string>()
    const judge = stubJudge()
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
        run: async (program, beforeOk, contests, scope) => {
          const { pick, counts } = pickProbes(all, scope ?? { kind: "first" }, registry, ran)
          const runs = await runProbes(pick, program, runner, 10_000)
          const findings = await store.judge(1, runs, judge, { contests })
          return { findings, items: correctionItems(store.registry(), pick, runs, findings, beforeOk), counts }
        },
      },
    }, { ...DEFAULT_LIMITS, repairCycles: 3 })
    const key = (name: string) => all.find(p => p.key.endsWith(name))!.id
    const [c1, c2, c3] = record.cycles
    assert.equal(record.status, "done")
    assert.equal(c1.probe_runs!.first, all.length, "the first run covers every probe")
    assert.deepEqual(c1.corrections.map(k => k.split("/")[0]), [key("filter-gt")])
    // The repair: the open item, and the probes of the objects whose code changed (filter, transform); not the rest.
    assert.equal(c2.probe_runs!.open, 1)
    assert.ok(c2.probe_runs!.affected > 0 && c2.probe_runs!.open + c2.probe_runs!.affected + c2.probe_runs!.new < all.length / 4, JSON.stringify(c2.probe_runs))
    // That came back clean; the end-of-round check ran everything and found the sort it broke, marked as broken.
    assert.equal(c2.probe_runs!.check, all.length)
    assert.deepEqual(c2.corrections.map(k => k.split("/")[0]), [key("sort-asc")])
    assert.deepEqual(c2.broke, c2.corrections)
    // Fixed in the next cycle: its own scoped run and the end check both clean.
    assert.equal(c3.probe_runs!.open, 1)
    assert.equal(c3.probe_runs!.check, all.length)
    assert.deepEqual(c3.corrections, [])
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
    : { item: it.item, unit: u.id, verdict: "compute", reason: "a digest", compute: "import hashlib\nprint(hashlib.sha256(open('out.csv','rb').read()).hexdigest())" })) }) })
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
    const none = await judgeRuns(registry, 1, [probe], wrongRuns, [], judge, { callId: n => `J${n}` })
    assert.deepEqual(none.findings.map(f => [f.verdict, f.reason]), [["cannot_tell", "a value to compute, and no sandbox to compute it"]])
  })
})
