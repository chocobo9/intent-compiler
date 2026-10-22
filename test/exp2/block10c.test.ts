import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { goBuilder } from "../../src/exp2/build.js"
import { codeFacts } from "../../src/exp2/checks.js"
import { limitFlags, withContainerLimit } from "../../src/exp2/docker.js"
import { executeRound, DEFAULT_LIMITS } from "../../src/exp2/execution.js"
import { initRepo } from "../../src/exp2/git.js"
import { correctionItems } from "../../src/exp2/judge.js"
import { activeProbes, runProbes } from "../../src/exp2/probes.js"
import { renderReport } from "../../src/exp2/report.js"
import { LocalProcessRunner, LocalScriptSandbox, type ScriptResult } from "../../src/exp2/runner.js"
import { Serial } from "../../src/exp2/serial.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { buildWorkOrder, renderWorkOrder } from "../../src/exp2/workorder.js"
import { checkStubTransport } from "./check-stubs.js"
import { DROP, FILTER, GO_MOD, MAIN, RENAME, SORT, TRANSFORM, VERIFY } from "./go-fixtures.js"
import { roundText } from "./inputs.js"
import { stubJudge, stubProbeWriter } from "./probe-stubs.js"
import { serialExecutor } from "./serial-executor.js"
import { StubExecutor, write } from "./stub-executor.js"
import { stubTransport } from "./stubs.js"

/** BLOCK10 §9: probe work off coding's critical path, stage wall times, and limits on the program under test. */
describe("exp2 block 10c: coding does not wait for probe writing", () => {
  async function run(dir: string, delayMs: number) {
    const store = new Exp2Store(join(dir, "store"), "b10c", { checks: false })
    const writer = stubProbeWriter()
    const sent: number[] = []
    const inner = serialExecutor()
    const serial = new Serial({
      store, workdir: join(dir, "work"), checkpoints: join(dir, "checkpoints"), text: roundText, attribution: stubTransport(), checks: checkStubTransport(),
      executor: round => { const e = inner(round); return { open: async ctx => { const s = await e.open(ctx); return { ...s, id: s.id, send: async (m: string) => { sent.push(Date.now()); return s.send(m) }, close: () => s.close() } } } },
      executorIsStub: true, anchors: new GoAnchorExtractor(), runner: new LocalProcessRunner(), sandbox: new LocalScriptSandbox(), build: goBuilder(join(dir, "builds"), {}, "dpipe"), binary: "dpipe",
      probes: async r => { await new Promise(res => setTimeout(res, delayMs)); return writer(r) }, judge: stubJudge(),
      limits: { attributionRepairs: 2, checkRepairs: 2, managementTimeoutMs: 60_000, checkTimeoutMs: 10_000, mutants: 0, execution: { ...DEFAULT_LIMITS, repairCycles: 1 } },
    })
    assert.equal((await serial.run({ to: 1 })).status, "done")
    return { store, sent }
  }
  let slow: Awaited<ReturnType<typeof run>>, fast: Awaited<ReturnType<typeof run>>
  before(async () => {
    slow = await run(mkdtempSync(join(tmpdir(), "exp2-b10c-")), 1500)
    fast = await run(mkdtempSync(join(tmpdir(), "exp2-b10c-")), 0)
  })

  it("the first coding message goes out before probe writing ends; the report says when each stage ran", () => {
    const r1 = slow.store.inspect().reports[0]
    const stage = (name: string) => r1.wall!.stages.find(s => s.stage === name)!
    const writing = stage("probe writing"), coding = stage("coding")
    assert.ok(coding.first_start_ms < writing.last_end_ms, `coding started at ${coding.first_start_ms} ms, probe writing ended at ${writing.last_end_ms} ms`)
    // Three groups at a time over six groups, 1.5 s a call: writing takes at least 3 s; the first message went out before.
    assert.ok(writing.ms >= 3000)
    for (const s of ["attribution", "probe writing", "coding", "build", "probe runs", "judging", "waiting for probes"]) assert.ok(r1.wall!.stages.some(x => x.stage === s), `stage ${s}`)
    // The full run before delivery is the round's final run (DESIGN §12h E4): no second "final probes" run.
    assert.ok(r1.selection?.sweep && !r1.wall!.stages.some(x => x.stage === "final probes"))
    assert.match(renderReport(r1), /Wall time \d+ s\. attribution .*probe writing \d+\.\d s \(1×, \d+–\d+ s\).*coding \d+\.\d s/u)
  })

  it("the same probes, verdicts and outcome as when the writer is fast", () => {
    const pick = (s: Exp2Store) => { const x = s.inspect(); return { probes: x.probes, rounds: x.probe_rounds.map(r => ({ ...r, calls: r.calls.length })), judgments: x.judgments.map(j => ({ ...j, call: null })), objects: x.reports[0].objects, open: x.executions[0].open } }
    assert.deepEqual(pick(slow.store), pick(fast.store))
  })
})

describe("exp2 block 10c: a program under test cannot exhaust the host", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-b10m-"))
  const store = new Exp2Store(join(dir, "store"), "b10mem", { checks: false })
  const SORT_NUM = SORT.replace('import "sort"', 'import (\n\t"sort"\n\t"strconv"\n)').replace("return t.rows[a][i] < t.rows[b][i]", "x, _ := strconv.ParseFloat(t.rows[a][i], 64)\n\t\ty, _ := strconv.ParseFloat(t.rows[b][i], 64)\n\t\treturn x < y")
  // A filter that allocates without bound on any input.
  const HOG = `package main

func opFilter(t table, op map[string]any) (table, error) {
	var hog [][]byte
	for {
		b := make([]byte, 1<<24)
		for i := range b {
			b[i] = 1
		}
		hog = append(hog, b)
	}
}
`
  before(async () => {
    await store.ingestRound(1, roundText(1), stubTransport())
    await store.deriveRoundProbes(1, stubProbeWriter())
  })

  it("the run is stopped at the memory limit, ruled wrong by code (DESIGN §12g) as what the program did, and the round goes on", async () => {
    const workdir = join(dir, "work")
    mkdirSync(workdir, { recursive: true })
    initRepo(workdir)
    const registry = store.registry(), s = store.inspect(), anchors = new GoAnchorExtractor()
    const runner = new LocalProcessRunner({}, { memoryMb: 200, outputBytes: 1 << 20, pids: 64 })
    const probes = activeProbes(s.probes, s.probe_events).filter(p => /filter-gt|sort-asc/u.test(p.key))
    const judge = stubJudge(item => item.result.stopped ? { verdict: "wrong", reason: `the program did not finish: ${item.result.stopped}` } : null)
    const files = (filter: string) => ({ "go.mod": GO_MOD, "main.go": MAIN, "verify.go": VERIFY(), "transform.go": TRANSFORM(["filter", "sort", "rename", "drop"]), "filter.go": filter, "sort.go": SORT_NUM, "rename.go": RENAME, "drop.go": DROP })
    const executor = new StubExecutor({ messages: [wd => write(wd, files(HOG)), wd => write(wd, files(FILTER(false)))] })
    const w = buildWorkOrder({ registry, round: 1, library: [], events: [], statuses: [], runs: [], anchors: anchors.extract(workdir), links: [], steps: [], previous_task: [] })
    const seen: string[] = []
    const record = await executeRound(workdir, w, renderWorkOrder(w), executor, {
      registry, library: [], events: [], links: [], anchors, build: goBuilder(join(dir, "b"), {}, "dpipe"), runner, facts: codeFacts(registry, 1),
      detect: {
        passed: new Set(), program: "dpipe",
        run: async (program, before, contests) => {
          const runs = await runProbes(probes, program, runner, 20_000)
          for (const r of runs) if (r.output.stopped) seen.push(r.output.stopped)
          const findings = await store.judge(1, runs, judge, { contests })
          return { findings, items: correctionItems(store.registry(), probes, runs, findings, before) }
        },
      },
    }, { ...DEFAULT_LIMITS, repairCycles: 2 })
    assert.deepEqual(seen, ["memory limit: resident memory passed the 200 MiB limit"], "only the filter probe ran into the limit")
    assert.equal(record.status, "done")
    assert.equal(record.cycles[0].corrections.length, 1)
    assert.match(executor.log.messages[1].text, /"stopped": "memory limit: resident memory passed the 200 MiB limit"[\s\S]*the program was stopped: memory limit/u)
    assert.deepEqual(record.cycles[1].corrections, [])
  })

  it("output past the cap is stopped there; a container killed at its memory limit is recorded as that limit", async () => {
    const runner = new LocalProcessRunner({}, { memoryMb: 4096, outputBytes: 64 * 1024, pids: 64 })
    const flood = { id: "f", label: "f", command: [process.execPath, "-e", "const s='x'.repeat(4096);for(let i=0;i<10000;i++)process.stdout.write(s)"], source_dir: null }
    const out = await runner.run(flood, { args: [], files: [] }, 20_000)
    assert.equal(out.limit?.kind, "output")
    assert.ok(out.stdout.length <= 64 * 1024)
    assert.deepEqual(limitFlags(1024, 256), ["--memory", "1024m", "--memory-swap", "1024m", "--pids-limit", "256"])
    assert.deepEqual(withContainerLimit<ScriptResult>({ exit_code: 137, stdout: "", stderr: "", timed_out: false }, 1024).limit, { kind: "memory", detail: "killed at the 1024 MiB memory limit" })
    assert.equal(withContainerLimit<ScriptResult>({ exit_code: 1, stdout: "", stderr: "", timed_out: false }, 1024).limit, undefined)
  })
})
