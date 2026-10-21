import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { goBuilder } from "../../src/exp2/build.js"
import { codeFacts, replacedBasis } from "../../src/exp2/checks.js"
import { executeRound, DEFAULT_LIMITS } from "../../src/exp2/execution.js"
import { initRepo } from "../../src/exp2/git.js"
import { correctionItems, judgeRuns, pairKey, probeStatuses } from "../../src/exp2/judge.js"
import { activeProbes, MAX_UNITS, normalizeOutput, probeProblems, probeUnits, runProbes, type ProbeRun } from "../../src/exp2/probes.js"
import { LocalProcessRunner } from "../../src/exp2/runner.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { buildWorkOrder, renderWorkOrder } from "../../src/exp2/workorder.js"
import { GO_MOD, MAIN, VERIFY, TRANSFORM, FILTER, SORT, RENAME, DROP } from "./go-fixtures.js"
import { roundText } from "./inputs.js"
import { filterProbe, stubJudge, stubProbeWriter } from "./probe-stubs.js"
import { StubExecutor, write, remove, type Action } from "./stub-executor.js"
import { stubTransport } from "./stubs.js"
import { checkStubTransport } from "./check-stubs.js"
import { serialExecutor } from "./serial-executor.js"
import { Serial } from "../../src/exp2/serial.js"
import { LocalScriptSandbox } from "../../src/exp2/runner.js"

const out = (o: Partial<ProbeRun["output"]> = {}): ProbeRun["output"] => ({ exit_code: 0, timed_out: false, stdout: "", stderr: "", files: {}, ...o })

describe("exp2 block 10: probes are written for every rule unit, checked by code, and go stale with the text", () => {
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b10-")), "b10")
  before(async () => { for (const r of [1, 2, 3]) assert.equal((await store.ingestRound(r, roundText(r), stubTransport())).status, "accepted") })

  it("code checks: trigger values must occur in the input, at most four units a probe, inputs well formed, every unit exercised", () => {
    const group = [{ id: "R1.S3.P2.s4" }, { id: "R1.S3.P9.s2" }, { id: "R1.S3.P9.s3" }]
    const ok = filterProbe("R1.S3.P2.s4")
    const base = { probes: [ok, { ...ok, id: "b", covers: [{ unit: "R1.S3.P9.s2", trigger_values: ["20"], wrong_would: "" }] }], uncheckable: [{ unit: "R1.S3.P9.s3", reason: "no output names it" }] }
    assert.deepEqual(probeProblems(base, group).problems, [])
    const msgs = (a: unknown) => probeProblems(a, group).problems.map(p => p.message)
    assert.match(msgs({ ...base, probes: [{ ...ok, covers: [{ unit: "R1.S3.P2.s4", trigger_values: ["999"], wrong_would: "" }] }, base.probes[1]] }).join(), /trigger value\(s\) "999" do not occur.*units not exercised.*R1\.S3\.P2\.s4/su)
    const five = Array.from({ length: MAX_UNITS + 1 }, () => ({ unit: "R1.S3.P2.s4", trigger_values: ["20"], wrong_would: "" }))
    assert.match(msgs({ ...base, probes: [{ ...ok, covers: five }, base.probes[1]] }).join(), /serves 5 units; at most 4/u)
    assert.match(msgs({ ...base, probes: [{ ...ok, files: [{ path: "recipe.json", content: "[{" }, ok.files[0]] }, base.probes[1]] }).join(), /recipe\.json is not valid JSON/u)
    assert.match(msgs({ ...base, probes: [{ ...ok, files: [ok.files[1]] }, base.probes[1]] }).join(), /argument data\.csv names a file the probe does not give/u)
    assert.match(msgs({ ...base, probes: [{ ...ok, files: [{ path: "data.csv", content: "id,value\n1,2,3\n" }, ok.files[1]] }, base.probes[1]] }).join(), /data\.csv row 1 has 3 fields, the header has 2/u)
    assert.match(msgs({ ...base, probes: [{ ...ok, covers: [{ unit: "R9.S1", trigger_values: ["20"], wrong_would: "" }] }, base.probes[1]] }).join(), /unit "R9\.S1" is not in this group/u)
    // A deliberately missing input is not a problem; the output file named after --output is not an input.
    assert.deepEqual(msgs({ ...base, probes: [{ ...ok, files: [], invalid_on_purpose: true, covers: [{ unit: "R1.S3.P2.s4", trigger_values: ["data.csv"], wrong_would: "" }] }, base.probes[1]] }), [])
  })

  it("R1: every unit is exercised after the repairs; a probe that stays faulty is dropped alone", async () => {
    const writer = stubProbeWriter({ mistakes: true })
    const record = await store.deriveRoundProbes(1, writer)
    const units = probeUnits(store.registry(), 1, [])
    assert.deepEqual(record.units, units)
    assert.equal(units.length, 131)
    assert.deepEqual([record.status, record.uncovered, record.dropped], ["accepted", [], []])
    // 131 units in groups of 22: six groups, each first answer sent back once.
    assert.equal(record.calls.length, 12)
    assert.match(writer.requests[1].problems!.join("\n"), /trigger value\(s\) "not-in-the-probe" do not occur[\s\S]*serves 5 units; at most 4/u)
    const s = store.inspect()
    assert.deepEqual(s.probes.map(p => p.id), record.entered)
    assert.equal(s.probes[0].id, "P1")
    // The writer saw the rule text and the sources, never an expected value.
    assert.ok(writer.requests[0].sources.includes("===== R1 =====") && writer.requests[0].units.every(u => u.text.length > 0))
    // With no repairs left, the two faulty probes are dropped and the units they alone served are recorded.
    const other = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b10-")), "b10b")
    await other.ingestRound(1, roundText(1), stubTransport())
    const r = await other.deriveRoundProbes(1, stubProbeWriter({ mistakes: true }), { maxRepairs: 0 })
    assert.equal(r.dropped.length, 12)
    assert.ok(r.uncovered.length > 0 && r.entered.length === 131 - 6 * 2)
    assert.ok(r.dropped[0].problems[0].startsWith("probe u1: unit"))
  })

  it("probes whose units later text replaced go stale; their live units are written again", async () => {
    const registry = store.registry()
    const s = store.inspect()
    const r1 = s.probes.filter(p => p.round === 1)
    const expected = r1.filter(p => replacedBasis(registry, p.covers.map(c => c.unit), 1, 2).length).map(p => p.id)
    assert.ok(expected.length > 0, "the stand-in R2 revises some R1 rule")
    const r2 = await store.deriveRoundProbes(2, stubProbeWriter())
    assert.deepEqual(r2.stale, expected)
    assert.ok(store.inspect().probe_events.every(e => e.status === "stale" && e.round === 2))
    assert.deepEqual(activeProbes(store.inspect().probes, store.inspect().probe_events).filter(p => expected.includes(p.id)), [])
    // Probes of round 2 do not go stale again in round 3 for the same change.
    const r3 = await store.deriveRoundProbes(3, stubProbeWriter())
    assert.ok(!r3.stale.some(id => expected.includes(id)))
  })
})

describe("exp2 block 10: the judge (four verdicts, kept verdicts, correction items)", () => {
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b10j-")), "b10j")
  before(async () => {
    await store.ingestRound(1, roundText(1), stubTransport())
    await store.deriveRoundProbes(1, stubProbeWriter())
  })

  it("an unchanged output is not judged again, a timestamp alone does not count as a change; ambiguous never becomes an item", async () => {
    const s = store.inspect(), registry = store.registry()
    const probes = activeProbes(s.probes, s.probe_events)
    const filter = probes.find(p => p.key.endsWith("filter-gt"))!, other = probes.find(p => !p.key.endsWith("filter-gt"))!
    const judge = stubJudge((item, unit) => unit === other.covers[0].unit ? { verdict: "ambiguous", reason: "a prefix or not: two readings" } : null)
    const runs: ProbeRun[] = [{ probe: filter.id, output: out({ files: { "out.csv": "id,value\n1,5\n2,20\n" }, stdout: "done at 2026-10-21T10:00:00Z" }) }, { probe: other.id, output: out({ stderr: "ERROR: unknown command describe" }) }]
    const first = await judgeRuns(registry, 1, probes, runs, [], judge, { callId: n => `J${n}` })
    assert.equal(judge.requests.length, 1)
    // The judge sees the unit text, the call, the inputs and the output, and nothing the writer said a wrong program would do.
    const item = judge.requests[0].items[0]
    assert.ok(item.units[0].text.includes("`filter`") && item.call.includes("--recipe") && item.input_files.length === 2 && !JSON.stringify(judge.requests[0]).includes("wrong_would") && !JSON.stringify(judge.requests[0]).includes("keeps 5 and 3"))
    assert.deepEqual(first.findings.map(f => f.verdict), ["wrong", "ambiguous"])
    const items = correctionItems(registry, probes, runs, first.findings)
    assert.deepEqual(items.map(i => i.key), [pairKey(filter.id, filter.covers[0].unit)])
    assert.ok(items[0].rule.text.includes("Keep rows") && items[0].actual.files["out.csv"].includes("1,5") && /value > 10/u.test(items[0].finding))
    // Same outputs, a different time: nothing asked.
    const again = await judgeRuns(registry, 1, probes, [{ ...runs[0], output: { ...runs[0].output, stdout: "done at 2026-10-22T11:30:00Z" } }, runs[1]], first.judgments, judge, { callId: n => `J${n}` })
    assert.equal(judge.requests.length, 1)
    assert.ok(again.findings.every(f => f.cached))
    // A changed output is judged again; a contest is judged again with the objection.
    const fixed = await judgeRuns(registry, 1, probes, [{ probe: filter.id, output: out({ files: { "out.csv": "id,value\n2,20\n4,12\n" } }) }], first.judgments, judge, { callId: n => `J${n}`, contests: new Map([[pairKey(other.id, other.covers[0].unit), "x"]]) })
    assert.deepEqual(fixed.findings.map(f => f.verdict), ["ok"])
    const contested = await judgeRuns(registry, 1, probes, [runs[1]], first.judgments, judge, { callId: n => `J${n}`, contests: new Map([[pairKey(other.id, other.covers[0].unit), "R1.S0 the text names no prefix"]]) })
    assert.equal(judge.requests.at(-1)!.items[0].contest, `${other.covers[0].unit}: R1.S0 the text names no prefix`)
    assert.equal(contested.judgments[0].contested, true)
  })

  it("missing verdicts are asked for once more; still missing, cannot_tell and not kept", async () => {
    const s = store.inspect(), registry = store.registry()
    const probes = activeProbes(s.probes, s.probe_events).slice(0, 3)
    let n = 0
    const lazy = async (request: Parameters<ReturnType<typeof stubJudge>>[0]) => {
      n++
      const verdicts = n === 1 ? [{ item: request.items[0].item, unit: request.items[0].units[0].id, verdict: "ok", reason: "" }] : []
      return { text: JSON.stringify({ verdicts }), stub: true }
    }
    const r = await judgeRuns(registry, 1, probes, probes.map(p => ({ probe: p.id, output: out({ stdout: p.id }) })), [], lazy, { callId: k => `J${k}` })
    assert.equal(n, 2)
    assert.match(r.calls[0].problems.join(), /no verdict for: I2/u)
    assert.deepEqual(r.findings.map(f => f.verdict), ["ok", "cannot_tell", "cannot_tell"])
    assert.equal(r.judgments.length, 1)
    // Object statuses from findings: wrong is not landed, all-ok is landed, otherwise unknown.
    const st = probeStatuses(registry, [{ probe: "P1", unit: "R1.S3.P2.s4", verdict: "wrong", reason: "", cached: false }, { probe: "P2", unit: "R1.S3.P9.s3", verdict: "ok", reason: "", cached: false }])
    const of = (name: string) => st.find(x => x.object === registry.objectByName(name)!.id)!.status
    assert.deepEqual([of("filter"), of("rename"), of("join")], ["not_landed", "landed", "unknown"])
  })
})

describe("exp2 block 10: repairs from correction lists in the execution session", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-b10x-"))
  const store = new Exp2Store(join(dir, "store"), "b10x")
  const anchors = new GoAnchorExtractor(), runner = new LocalProcessRunner()
  const ALL = ["filter", "sort", "rename", "drop"]
  const base = (wd: string) => write(wd, { "go.mod": GO_MOD, "main.go": MAIN, "verify.go": VERIFY() })
  // The fixture's sort compares as text ("20" before "5"); the numeric one is the fix.
  const SORT_NUM = SORT.replace('import "sort"', 'import (\n\t"sort"\n\t"strconv"\n)').replace("return t.rows[a][i] < t.rows[b][i]", "x, _ := strconv.ParseFloat(t.rows[a][i], 64)\n\t\ty, _ := strconv.ParseFloat(t.rows[b][i], 64)\n\t\treturn x < y")
  const everything = (wd: string, filterWrong = false, textSort = false) => { base(wd); write(wd, { "transform.go": TRANSFORM(ALL), "filter.go": FILTER(filterWrong), "sort.go": textSort ? SORT : SORT_NUM, "rename.go": RENAME, "drop.go": DROP }) }
  const noSort = (wd: string) => { remove(wd, "sort.go"); write(wd, { "transform.go": TRANSFORM(ALL.filter(o => o !== "sort")) }) }
  before(async () => {
    await store.ingestRound(1, roundText(1), stubTransport())
    await store.deriveRoundProbes(1, stubProbeWriter())
  })

  async function round(name: string, messages: Action[], ambiguousUnit?: string) {
    const workdir = join(dir, name)
    mkdirSync(workdir, { recursive: true })
    initRepo(workdir)
    const registry = store.registry(), s = store.inspect()
    const w = buildWorkOrder({ registry, round: 1, library: [], events: [], statuses: [], runs: [], anchors: anchors.extract(workdir), links: [], steps: [], previous_task: [] })
    const judge = stubJudge((item, unit) => unit === ambiguousUnit ? { verdict: "ambiguous", reason: "two readings" } : null)
    const executor = new StubExecutor({ messages })
    const probes = activeProbes(s.probes, s.probe_events).filter(p => /filter-gt|sort-asc/u.test(p.key) || p === s.probes[0])
    const record = await executeRound(workdir, w, renderWorkOrder(w), executor, {
      registry, library: [], events: [], links: [], anchors, build: goBuilder(join(dir, `${name}-b`), {}, "dpipe"), runner, facts: codeFacts(registry, 1),
      detect: {
        passed: new Set(), program: "dpipe",
        run: async (program, before, contests) => {
          const runs = await runProbes(probes, program, runner, 10_000)
          const findings = await store.judge(1, runs, judge, { contests })
          return { findings, items: correctionItems(store.registry(), probes, runs, findings, before) }
        },
      },
    }, { ...DEFAULT_LIMITS, repairCycles: 3 })
    return { record, executor }
  }

  it("a wrong filter and a text sort go back as located, reproducible items; the fixes land; ambiguous items are never sent", async () => {
    const amb = store.inspect().probes[0].covers[0].unit
    const { record, executor } = await round("fix", [wd => everything(wd, true, true), wd => everything(wd, false)], amb)
    assert.equal(record.status, "done")
    assert.deepEqual(record.cycles.map(c => c.corrections.length), [2, 0])
    assert.match(executor.log.messages[1].text, /not ascending: 12, 20, 3, 5/u)
    const repair = executor.log.messages[1].text
    assert.match(repair, /correction list/u)
    assert.match(repair, /"id": "R1\.S3\.P2\.s4"[\s\S]*Keep rows/u)
    assert.match(repair, /"call": \[\n\s*"dpipe",\n\s*"transform"/u)
    assert.match(repair, /"out\.csv": "id,value\\n1,5\\n3,3/u)
    assert.match(repair, /Do not change behaviour the items do not concern/u)
    assert.ok(record.cycles[0].ambiguous.length === 1 && !repair.includes(amb), "the ambiguous pair is recorded and not sent")
    assert.deepEqual(record.open, [])
  })

  it("a repair that breaks what was right sends it back marked; the round keeps the cycle with the fewest items", async () => {
    const { record, executor } = await round("broke", [wd => everything(wd, true), wd => { everything(wd, false); noSort(wd) }, wd => everything(wd, false)])
    assert.equal(record.status, "done")
    const sortKey = record.cycles[1].corrections[0]
    assert.ok(record.cycles[1].broke.includes(sortKey))
    assert.match(executor.log.messages[2].text, /this followed the requirements before; a change in this round broke it/u)
    const spent = await round("spent", [wd => everything(wd, false), wd => { everything(wd, false); noSort(wd) }], undefined)
    assert.equal(spent.record.status, "done", "nothing to repair after the first cycle")
    const worse = await round("worse", [wd => everything(wd, true), wd => { everything(wd, true); noSort(wd) }, wd => { everything(wd, true); noSort(wd) }, wd => { everything(wd, true); noSort(wd) }])
    assert.equal(worse.record.status, "cycles_spent")
    assert.equal(worse.record.kept, worse.record.cycles[0].id)
    assert.equal(worse.record.open.length, 1)
    assert.deepEqual(worse.record.carried, [store.registry().objectByName("filter")!.id])
  })

  it("normalized output: line ends unified, unchanged input files left out", () => {
    const n = normalizeOutput({ exit_code: 0, stdout: "a\r\nb", stderr: "", files: { "data.csv": "x", "out.csv": "y\r\n", "__probe": "z" }, timed_out: false }, [{ path: "data.csv", content: "x" }])
    assert.deepEqual(n, { exit_code: 0, timed_out: false, stdout: "a\nb", stderr: "", files: { "out.csv": "y\n" } })
  })
})

describe("exp2 block 10: the serial with probes and judge (stand-ins), checks off", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-b10s-"))
  const store = new Exp2Store(join(dir, "store"), "b10s", { checks: false })
  const first: Record<number, string> = {}
  // The judge finds every profile unit wrong (the stand-in executor only stubs profile), and reads filter and sort for real.
  let profile = new Set<string>()
  const judge = stubJudge((_item, unit) => profile.has(unit) ? { verdict: "wrong", reason: "profile prints nothing the text requires" } : null)
  const inner = serialExecutor()
  const serial = new Serial({
    store, workdir: join(dir, "work"), checkpoints: join(dir, "checkpoints"), text: roundText, attribution: stubTransport(), checks: checkStubTransport(),
    executor: round => { const e = inner(round); return { open: async ctx => { first[round] ??= ctx.text; return e.open(ctx) } } }, executorIsStub: true,
    anchors: new GoAnchorExtractor(), runner: new LocalProcessRunner(), sandbox: new LocalScriptSandbox(), build: goBuilder(join(dir, "builds"), {}, "dpipe"), binary: "dpipe",
    probes: stubProbeWriter(), judge: async r => { const reg = store.registry(); profile = new Set([...reg.assigned.entries()].filter(([, o]) => o === reg.objectByName("profile")?.id).flatMap(([b]) => [b, ...[...reg.blocks.values()].filter(x => reg.lineage(x.id).some(y => y.id === b)).map(x => x.id)])); return judge(r) },
    limits: { attributionRepairs: 2, checkRepairs: 2, managementTimeoutMs: 5000, checkTimeoutMs: 10_000, execution: { ...DEFAULT_LIMITS, repairCycles: 1 } },
  })
  let outcome: Awaited<ReturnType<Serial["run"]>>
  before(async () => { outcome = await serial.run({ to: 3 }) })

  it("probes are written each round; what stays wrong is carried into the next round's first message and task zone", () => {
    assert.deepEqual(outcome, { status: "done", last_checkpoint: 3, resumes: 0 })
    const s = store.inspect()
    assert.deepEqual(s.checks, [], "no precomputed checks")
    assert.deepEqual(s.probe_rounds.map(r => [r.round, r.status]), [[1, "accepted"], [2, "accepted"], [3, "accepted"]])
    const r2 = s.executions.find(e => e.round === 2)!
    // Left open in R2: profile, and the text sort from R1 (the stand-in never repairs).
    assert.ok(r2.open.some(k => profile.has(k.split("/")[1])))
    const sortUnit = s.probes.find(p => p.key.endsWith("sort-asc"))!.covers[0].unit
    assert.ok(r2.open.some(k => k.endsWith(`/${sortUnit}`)))
    assert.match(first[2], /## Corrections left open by earlier rounds[\s\S]*not ascending/u)
    assert.match(first[3], /## Corrections left open by earlier rounds[\s\S]*profile prints nothing the text requires/u)
    const r3 = s.reports.find(r => r.round === 3)!
    const pid = store.registry().objectByName("profile")!.id
    assert.ok(r3.objects.find(o => o.object === pid)!.status === "not_landed")
    assert.ok(r3.probes!.carried_in > 0)
    // Filter and sort, judged on what the stand-in wrote: filter is right; the stand-in's sort compares as text.
    const r1 = s.reports.find(r => r.round === 1)!
    assert.equal(r1.objects.find(o => o.name === "filter")!.status, "landed")
    assert.equal(r1.objects.find(o => o.name === "sort")!.status, "not_landed")
  })

  it("the report gives the writer's and the judge's calls and tokens, and their share of the coding tokens", () => {
    const r1 = store.inspect().reports.find(r => r.round === 1)!
    assert.equal(r1.probes!.writer.calls, 6)
    assert.ok(r1.probes!.judge.calls > 0)
    assert.equal(r1.probes!.written, 131)
    // Rerunning unchanged probes costs nothing: the judge is asked only about outputs it has not seen.
    const s = store.inspect()
    const asked = s.judge_calls.filter(c => c.round === 3).reduce((n, c) => n + c.items, 0)
    assert.ok(asked < activeProbes(s.probes, s.probe_events).length, `${asked} items judged in R3`)
  })
})
