import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { goBuilder } from "../../src/exp2/build.js"
import { codeFacts } from "../../src/exp2/checks.js"
import { anchorNames, executeRound, linkStepAnchors, planProblems, stepsFromHistory, DEFAULT_LIMITS, type ExecutionRecord } from "../../src/exp2/execution.js"
import { commitsSince, initRepo, readTrailers } from "../../src/exp2/git.js"
import { LocalProcessRunner, LocalScriptSandbox, nullBaseline } from "../../src/exp2/runner.js"
import { Exp2Store } from "../../src/exp2/store.js"
import type { ObjectStatus } from "../../src/exp2/verdict.js"
import { buildWorkOrder, nameLinks, objectAnchors, renderWorkOrder, type WorkOrder } from "../../src/exp2/workorder.js"
import { checkStubTransport } from "./check-stubs.js"
import { DROP, FILTER, GO_MOD, MAIN, RENAME, SORT, TRANSFORM, TRANSFORM_STUB, VERIFY, VERIFY_STUB } from "./go-fixtures.js"
import { roundText } from "./inputs.js"
import { StubExecutor, write, type ExecutorScript } from "./stub-executor.js"
import { stubTransport } from "./stubs.js"

describe("exp2 block 3: work order and execution, with a stand-in executor writing Go", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-exec-"))
  const workdir = join(dir, "work")
  const store = new Exp2Store(join(dir, "store"), "offline-3")
  const anchors = new GoAnchorExtractor()
  const runner = new LocalProcessRunner()
  const build = goBuilder(join(dir, "builds"))
  let w1: WorkOrder
  let record: ExecutionRecord
  let executor: StubExecutor
  let base = ""
  const id = (name: string) => store.registry().objectByName(name)!.id

  const script: ExecutorScript = {
    plans: [
      // First plan: an object outside the task zone, and a part-covered object never finished.
      n => [{ label: "all", objects: [{ object: n("verify"), coverage: "partial" }, { object: "O999", coverage: "full" }], summary: "everything at once" }],
      n => [
        { label: "foundation", objects: [{ object: n("transform"), coverage: "partial" }, { object: n("verify"), coverage: "partial" }], summary: "command dispatch and stubs" },
        // The free text carries a look-alike trailer; the code must not read it.
        { label: "verify", objects: [{ object: n("verify"), coverage: "full" }], summary: "verify. IC-Step: P9.9 (free text, not a trailer)" },
        { label: "filter", objects: [{ object: n("filter"), coverage: "full" }, { object: n("transform"), coverage: "full" }], summary: "transform pipeline and filter" },
        { label: "sort", objects: [{ object: n("sort"), coverage: "full" }], summary: "sort op" },
        { label: "rename", objects: [{ object: n("rename"), coverage: "full" }], summary: "rename op" },
        { label: "drop", objects: [{ object: n("drop"), coverage: "full" }], summary: "drop op" },
      ],
    ],
    steps: {
      foundation: [wd => write(wd, { "go.mod": GO_MOD, "main.go": MAIN, "verify.go": VERIFY_STUB, "transform.go": TRANSFORM_STUB })],
      verify: [wd => write(wd, { "verify.go": VERIFY() })],
      // Wrong first (keeps the rejected rows), right after the failing check is reported.
      // The second attempt reports per object what it changed: transform the shared table helpers, plus one function the step never touched.
      filter: [wd => write(wd, { "transform.go": TRANSFORM(["filter"]), "filter.go": FILTER(true) }), wd => { write(wd, { "filter.go": FILTER(false) }); return [{ object: id("transform"), anchors: ["col", "opNowhere"] }] }],
      // The session hangs; a new one does the step.
      sort: ["hang", wd => write(wd, { "transform.go": TRANSFORM(["filter", "sort"]), "sort.go": SORT })],
      // Every attempt also breaks verify's output: protection checks catch it, and the step is dropped.
      rename: [wd => write(wd, { "transform.go": TRANSFORM(["filter", "sort", "rename"]), "rename.go": RENAME, "verify.go": VERIFY("OK") })],
      // The session breaks; the next one first declares drop without touching it, then does it.
      drop: ["break", () => {}, wd => write(wd, { "transform.go": TRANSFORM(["filter", "sort", "drop"]), "drop.go": DROP })],
    },
  }

  before(async () => {
    assert.equal((await store.ingestRound(1, roundText(1), stubTransport())).status, "accepted")
    assert.equal((await store.deriveRoundChecks(1, checkStubTransport(), { sandbox: new LocalScriptSandbox(), runner, baseline: nullBaseline(join(dir, "null")) })).status, "accepted")
    const { mkdirSync } = await import("node:fs")
    mkdirSync(workdir, { recursive: true })
    base = initRepo(workdir)
    const registry = store.registry()
    const state = store.inspect()
    w1 = buildWorkOrder({ registry, round: 1, library: state.checks, events: state.check_events, statuses: [], runs: [], anchors: anchors.extract(workdir), links: [], steps: [], previous_task: [] })
    executor = new StubExecutor(script, id)
    record = await executeRound(workdir, w1, renderWorkOrder(w1), executor, {
      registry, library: state.checks, events: state.check_events, links: [], anchors, build, runner, facts: codeFacts(registry, 1),
    }, { ...DEFAULT_LIMITS, stepTimeoutMs: 1500 })
  })

  it("R1 work order: everything new is a task; source text appears once, in the source zone only", () => {
    assert.equal(w1.task.length, store.registry().objects.size)
    assert.ok(w1.task.every(t => t.why.join() === "changed" && t.change))
    assert.deepEqual([w1.protect.length, w1.status.length], [0, 0])
    const text = renderWorkOrder(w1)
    const [head, source] = text.split("## Source zone")
    const registry = store.registry()
    const assigned = [...registry.assigned.keys()].map(b => registry.block(b)!)
    assert.equal(w1.source.flatMap(g => g.blocks).length, assigned.length, "every assigned block once")
    for (const b of assigned) {
      const body = b.text.trim()
      if (body.length < 30) continue
      assert.equal(source.split(body).length - 1, 1, `${b.id} appears once in the source zone`)
      assert.ok(!head.includes(body.slice(0, 30)), `${b.id} does not appear outside the source zone`)
    }
  })

  it("the plan's shape is checked by code: outside the task zone, or part-covered and never finished, is sent back", () => {
    assert.equal(record.proposals.length, 2)
    const problems = record.proposals[0].problems.join(" | ")
    assert.match(problems, /O999 is not in the task zone/u)
    assert.match(problems, /covered in part, and no later step covers it in full/u)
    assert.deepEqual(executor.log.proposals[1], record.proposals[0].problems, "the problems went back to the same session")
    assert.deepEqual(record.proposals[1].problems, [])
    assert.deepEqual(planProblems(Array.from({ length: 13 }, (_, i) => ({ label: `s${i}`, objects: [{ object: id("sort"), coverage: "full" as const }], summary: "" })), [id("sort")], DEFAULT_LIMITS), ["the plan has 13 steps; at most 12"])
  })

  it("good steps are kept, a wrong step is corrected in the same session, a failing one is dropped without losing the rest", () => {
    const by = (label: string) => record.steps.find(s => s.label === label)!
    assert.deepEqual(record.steps.map(s => [s.label, s.status]), [["foundation", "committed"], ["verify", "committed"], ["filter", "committed"], ["sort", "committed"], ["rename", "failed"], ["drop", "committed"]])
    const filter = by("filter")
    assert.equal(filter.attempts, 2)
    assert.match(filter.problems[0], /fails: value_mismatch/u)
    assert.deepEqual(new Set(executor.log.work.filter(w => w.step === filter.id).map(w => w.session)).size, 1, "corrected within the same session")
    assert.match(executor.log.work.filter(w => w.step === filter.id)[1].feedback[0], /fails: value_mismatch/u)
    // rename broke verify's output each time: protection caught it, and the tree went back to the checkpoint.
    const rename = by("rename")
    assert.equal(rename.attempts, 3)
    assert.ok(rename.problems.every(p => /protection of verify/u.test(p)))
    assert.match(readFileSync(join(workdir, "verify.go"), "utf8"), /"VERIFIED"/u)
    assert.ok(!existsSync(join(workdir, "rename.go")))
    // drop was first declared without touching any of its code.
    assert.match(by("drop").problems.join(" "), /declared full, but none of its anchors changed/u)
  })

  it("a hung or broken session restarts from the last good checkpoint with only the remaining steps", () => {
    assert.deepEqual(record.sessions.map(s => s.closed), ["broken", "broken", "normally"])
    const [, second, third] = executor.log.sessions
    assert.deepEqual(second.resume!.remaining.map(s => s.label), ["sort", "rename", "drop"])
    assert.deepEqual(second.resume!.done, record.steps.slice(0, 3).map(s => s.id))
    assert.deepEqual(third.resume!.remaining.map(s => s.label), ["drop"])
    assert.match(record.steps.find(s => s.label === "sort")!.problems[0], /broke \(no answer in 1500 ms\)/u)
  })

  it("each kept step is one commit with IC trailers, and the code reads the trailers only", () => {
    const commits = commitsSince(workdir, base)
    assert.equal(commits.length, 5)
    const history = stepsFromHistory(workdir, commits)
    assert.deepEqual(history.map(h => h.step), record.steps.filter(s => s.status === "committed").map(s => s.id))
    const verify = history.find(h => h.step === record.steps[1].id)!
    assert.deepEqual(verify.objects, [`${id("verify")}@v1 full`])
    assert.ok(verify.anchors.includes("A:verify.go:func:runVerify"))
    assert.ok(verify.checks.some(c => /pass$/u.test(c)))
    assert.ok(!JSON.stringify(readTrailers(workdir, verify.commit)).includes("P9.9"), "the subject's look-alike is not a trailer")
  })

  it("when the round's step budget is spent, the steps done stay and the rest is carried", async () => {
    const wd = join(dir, "work-budget")
    const { mkdirSync } = await import("node:fs")
    mkdirSync(wd, { recursive: true })
    initRepo(wd)
    const registry = store.registry()
    const state = store.inspect()
    const short = await executeRound(wd, w1, renderWorkOrder(w1), new StubExecutor(script, id), {
      registry, library: state.checks.filter(c => c.round === 1), events: [], links: [], anchors, build, runner, facts: codeFacts(registry, 1),
    }, { ...DEFAULT_LIMITS, stepTimeoutMs: 1500, roundAttempts: 3 })
    assert.equal(short.status, "budget_spent")
    assert.deepEqual(short.steps.map(s => [s.label, s.status]), [["foundation", "committed"], ["verify", "committed"], ["filter", "carried"], ["sort", "carried"], ["rename", "carried"], ["drop", "carried"]])
    assert.ok(short.carried.includes(id("filter")) && short.carried.includes(id("sort")) && !short.carried.includes(id("verify")))
    assert.equal(commitsSince(wd, short.base).length, 2)
    assert.equal(short.steps.find(s => s.label === "filter")!.attempts, 1, "cut off by the budget, not judged a failure")
  })

  it("anchors come from the Go AST: functions, types, dispatch points, files", () => {
    const all = anchors.extract(workdir)
    const ids = all.map(a => a.id)
    for (const a of ["A:main.go:func:main", "A:main.go:dispatch:verify", "A:transform.go:dispatch:filter", "A:transform.go:dispatch:sort", "A:transform.go:type:table", "A:filter.go:func:opFilter", "A:main.go:file:main.go"]) assert.ok(ids.includes(a), a)
    assert.ok(!ids.some(a => a.includes("rename")))
  })

  it("the next work order: undone work is carried, unknown is status only, landed objects that share anchors are protected", async () => {
    assert.equal((await store.ingestRound(2, roundText(2), stubTransport())).status, "accepted")
    const program = build(workdir, "r1-head").program!
    const { runs, statuses } = await store.runRoundChecks(1, program, runner)
    const registry = store.registry()
    const state = store.inspect()
    const now = anchors.extract(workdir)
    const links = [...record.links, ...nameLinks(registry, now, 1)]
    const input = { registry, round: 2, library: state.checks, events: state.check_events, statuses, runs, anchors: now, links, steps: record.steps, previous_task: w1.task.map(t => t.object) }
    const w2 = buildWorkOrder(input)
    const task = new Map(w2.task.map(t => [t.name, t]))
    const status = (n: string) => statuses.find(s => s.object === id(n))!
    assert.deepEqual(task.get("rename")!.why, ["carried"])
    assert.equal(task.get("rename")!.carried_from, record.steps.find(s => s.label === "rename")!.id)
    for (const done of ["verify", "filter", "sort", "drop", "transform"]) assert.ok(!task.has(done), `${done} was finished`)
    // error handling was never a step's object, but its checks pass: landed, so not carried.
    assert.equal(status("error handling").status, "landed")
    assert.ok(!task.has("error handling"))
    // transform is unknown (its own check is weak): status zone, never a task.
    assert.equal(status("transform").status, "unknown")
    assert.ok(w2.status.some(s => s.name === "transform"))
    for (const s of w2.status) assert.ok(!task.has(s.name))
    assert.ok(task.get("fill")!.why.includes("changed"))
    // Make transform not landed (as a failing run would): it becomes a task with its evidence, and filter, landed and
    // sharing transform's anchors, goes to the protection zone with its passing checks.
    const failing = runs.find(r => r.check === state.checks.find(c => c.key === "transform-runs")!.id)!
    const broken: ObjectStatus[] = statuses.map(s => s.object === id("transform") ? { ...s, status: "not_landed", not_landed: [failing.check] } : s)
    const brokenRuns = runs.map(r => r === failing ? { ...r, outcome: "fail" as const, assertions: r.assertions.map(a => ({ ...a, ok: false, actual: 1 })), failure: { class: "not_landed" as const, reason: "value_mismatch" as const, detail: "exit 1", roles: ["business" as const] } } : r)
    const w2b = buildWorkOrder({ ...input, statuses: broken, runs: brokenRuns })
    const t = w2b.task.find(x => x.name === "transform")!
    assert.deepEqual(t.why, ["not_landed"])
    assert.deepEqual(t.evidence.map(e => [e.check, e.reason, e.mismatches[0].expected, e.mismatches[0].actual]), [[failing.check, "value_mismatch", 0, 1]])
    const filter = w2b.protect.find(p => p.name === "filter")!
    // §12d item 9: filter's own anchors are its own, not every function its step or other steps touched.
    const own = (name: string) => objectAnchors(registry, now, links, id(name)).map(a => a.id)
    assert.ok(own("filter").includes("A:filter.go:func:opFilter") && own("filter").includes("A:transform.go:dispatch:filter"))
    for (const other of ["opSort", "opDrop", "opRename", "runTransform", "col"]) assert.ok(!own("filter").some(a => a.endsWith(`:${other}`)), `filter does not own ${other}`)
    assert.ok(own("transform").includes("A:transform.go:func:col"), "reported for transform and changed by the step")
    const filterStep = record.steps.find(s => s.label === "filter")!
    assert.ok(filterStep.notes.some(n => /reported but not changed by the step: O\d+: opNowhere/u.test(n)), "a reported anchor the step did not change is not linked")
    assert.ok(!links.some(l => l.anchor.endsWith(":opNowhere")))
    // filter is protected through the dispatch point it shares with transform: named for filter, in transform's file.
    assert.deepEqual(filter.shared_anchors, ["A:transform.go:dispatch:filter"])
    assert.ok(!filter.shared_anchors.includes("A:transform.go:func:runTransform"), "runTransform is transform's by name, not filter's")
    assert.ok(filter.checks.includes(state.checks.find(c => c.key === "filter-gt")!.id))
    assert.ok(w2b.anchors.some(a => a.object === id("filter") && a.last_steps.length))
  })
})

describe("exp2 anchors linked per object (§12d item 9)", () => {
  it("named anchors go to their object, reported ones to theirs if changed, the rest are shared by the step", () => {
    const step = { id: "P1.3", round: 1, label: "filter", summary: "", objects: [{ object: "O4", coverage: "full" as const }, { object: "O3", coverage: "full" as const }] }
    const touched = ["A:main.go:func:parseFlags", "A:op_filter.go:func:apply", "A:util.go:func:readTable", "A:transform.go:func:runTransform", "A:util.go:func:sortKeys", "A:main.go:file:main.go"]
    const names = (id: string) => ({ O4: "filter", O3: "transform" } as Record<string, string>)[id]
    const { links, unverified } = linkStepAnchors(step, touched, [{ object: "O3", anchors: ["readTable", "opMissing"] }], names, 1)
    const of = (object: string, via?: string) => links.filter(l => l.object === object && (!via || l.via === via)).map(l => l.anchor).sort()
    assert.deepEqual(of("O4", "name"), ["A:op_filter.go:func:apply"], "a file named for filter")
    assert.deepEqual(of("O3", "name"), ["A:transform.go:func:runTransform"])
    assert.deepEqual(of("O3", "step"), ["A:util.go:func:readTable"])
    assert.deepEqual(of("O4", "shared"), ["A:main.go:func:parseFlags", "A:util.go:func:sortKeys"])
    assert.deepEqual(of("O3", "shared"), of("O4", "shared"))
    assert.ok(!links.some(l => l.anchor.includes(":file:")))
    assert.deepEqual(unverified, ["O3: opMissing"])
    assert.ok(anchorNames("A:x.go:func:opFilter", "filter") && !anchorNames("A:x.go:func:opFilterRows", "rows filter") && !anchorNames("A:sorter.go:func:x", "sort"))
  })
})
