import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import { goBuilder } from "../../src/exp2/build.js"
import { codeFacts } from "../../src/exp2/checks.js"
import { anchorNames, contestsIn, cyclesFromHistory, executeRound, linkStepAnchors, DEFAULT_LIMITS, type ExecutionDeps, type ExecutionRecord } from "../../src/exp2/execution.js"
import { commitsSince, head, initRepo, readTrailers } from "../../src/exp2/git.js"
import { LocalProcessRunner, LocalScriptSandbox, nullBaseline } from "../../src/exp2/runner.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { buildWorkOrder, objectAnchors, renderWorkOrder, type WorkOrder } from "../../src/exp2/workorder.js"
import { checkStubTransport } from "./check-stubs.js"
import { DROP, FILTER, GO_MOD, MAIN, RENAME, SORT, TRANSFORM, VERIFY } from "./go-fixtures.js"
import { roundText } from "./inputs.js"
import { StubExecutor, write, type Action } from "./stub-executor.js"
import { stubTransport } from "./stubs.js"

/**
 * Block 9 execution (BLOCK9 §2.4): one session per round; the code builds, runs the checks and commits a cycle each
 * time the session replies; failures go back to the same session as evidence until the task lands or the cycles run
 * out. The stand-in plays the behaviours observed on real models: stopping early, claiming to be done, a wrong
 * detail, a contested check, a hung or broken session.
 */
describe("exp2 block 9: one session per round, checks drive the repairs", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-exec-"))
  const store = new Exp2Store(join(dir, "store"), "offline-9")
  const anchors = new GoAnchorExtractor()
  const runner = new LocalProcessRunner()
  let w1: WorkOrder
  const id = (name: string) => store.registry().objectByName(name)!.id
  const ALL = ["filter", "sort", "rename", "drop"]
  const foundation = (wd: string) => write(wd, { "go.mod": GO_MOD, "main.go": MAIN, "verify.go": VERIFY(), "transform.go": TRANSFORM([]) })
  const everything = (wd: string, filterWrong = false) => write(wd, { "transform.go": TRANSFORM(ALL), "filter.go": FILTER(filterWrong), "sort.go": SORT, "rename.go": RENAME, "drop.go": DROP })

  /** One round in a fresh work tree with the given script. */
  async function round(name: string, messages: Action[], limits: Partial<typeof DEFAULT_LIMITS> = {}, extra: Partial<ExecutionDeps> = {}) {
    const workdir = join(dir, name)
    mkdirSync(workdir, { recursive: true })
    const base = initRepo(workdir)
    const registry = store.registry(), state = store.inspect()
    const executor = new StubExecutor({ messages })
    const record = await executeRound(workdir, w1, renderWorkOrder(w1), executor, {
      registry, library: state.checks, events: state.check_events, links: [], anchors, build: goBuilder(join(dir, `${name}-builds`)), runner, facts: codeFacts(registry, 1), ...extra,
    }, { ...DEFAULT_LIMITS, ...limits })
    return { workdir, base, executor, record }
  }

  before(async () => {
    assert.equal((await store.ingestRound(1, roundText(1), stubTransport())).status, "accepted")
    assert.equal((await store.deriveRoundChecks(1, checkStubTransport(), { sandbox: new LocalScriptSandbox(), runner, baseline: nullBaseline(join(dir, "null")) })).status, "accepted")
    const empty = join(dir, "empty")
    mkdirSync(empty, { recursive: true })
    initRepo(empty)
    w1 = buildWorkOrder({ registry: store.registry(), round: 1, library: store.inspect().checks, events: store.inspect().check_events, statuses: [], runs: [], anchors: anchors.extract(empty), links: [], steps: [], previous_task: [] })
  })

  it("R1 work order: everything new is a task; source text appears once, in the source zone only", () => {
    assert.equal(w1.task.length, store.registry().objects.size)
    assert.ok(w1.task.every(t => t.why.join() === "changed" && t.change))
    assert.deepEqual([w1.protect.length, w1.status.length], [0, 0])
    const text = renderWorkOrder(w1)
    const [headPart, source] = text.split("## Source zone")
    const registry = store.registry()
    const assigned = [...registry.assigned.keys()].map(b => registry.block(b)!)
    assert.equal(w1.source.flatMap(g => g.blocks).length, assigned.length, "every assigned block once")
    for (const b of assigned) {
      const body = b.text.trim()
      if (body.length < 30) continue
      assert.equal(source.split(body).length - 1, 1, `${b.id} appears once in the source zone`)
      assert.ok(!headPart.includes(body.slice(0, 30)), `${b.id} does not appear outside the source zone`)
    }
  })

  it("a session that stops early and says it is done is held to the checks: the failures go back to it until the task lands", async () => {
    const { executor, record, workdir } = await round("early", [
      // Stops after the foundation, as gpt-6-luna-fast medium did, and claims it is done (as 5.6 medium did).
      wd => { foundation(wd); return "All done: the work order is complete." },
      // Does the rest, with one detail wrong (filter keeps the rows it should drop).
      wd => everything(wd, true),
      wd => everything(wd, false),
    ])
    assert.equal(record.status, "done")
    assert.deepEqual(record.cycles.map(c => c.message), ["work", "repair", "repair"])
    assert.equal(new Set(executor.log.messages.map(m => m.session)).size, 1, "all in the same session")
    const filterGt = store.inspect().checks.find(c => c.key === "filter-gt")!.id
    assert.ok(record.cycles[0].failing.includes(filterGt), "the claim of completion did not count")
    const repair = executor.log.messages[1].text
    assert.match(repair, new RegExp(`- ${filterGt} \\(filter\\): missing_name`, "u"))
    assert.match(repair, /args: \["transform"/u)
    assert.match(executor.log.messages[2].text, /value_mismatch[\s\S]*expected .*, got /u)
    assert.deepEqual(record.cycles.at(-1)!.failing, [])
    assert.deepEqual(record.carried, [])
    assert.equal(record.kept, record.cycles.at(-1)!.id)
    // One commit per cycle, with the IC trailers, read back from the trailers alone.
    const back = cyclesFromHistory(workdir, commitsSince(workdir, record.base))
    assert.deepEqual(back.map(c => [c.cycle, c.build]), record.cycles.map(c => [c.id, "ok"]))
    assert.ok(back[0].failing.includes(filterGt) && back.at(-1)!.failing.length === 0)
    assert.equal(readTrailers(workdir, head(workdir))["IC-Round"]![0], "1")
  })

  it("what a ruling finds wrong leaves; a contested check that is right keeps counting", async () => {
    const settled: string[] = []
    const filterGt = () => store.inspect().checks.find(c => c.key === "filter-gt")!.id
    const settle: ExecutionDeps["settle"] = async disputes => {
      for (const d of disputes) settled.push(`${d.check}:${d.kind}`)
      // The stand-in ruling upholds filter-gt against the contest, and finds the badly built verify check wrong.
      return { wrong: new Set(disputes.filter(d => d.kind === "input_incomplete").map(d => d.check)), right: new Set(disputes.filter(d => d.kind === "contested").map(d => d.check)) }
    }
    const { record } = await round("contest", [
      wd => { foundation(wd); everything(wd, true); return `I believe the filter is right.\nCONTEST ${filterGt()}: R1.S3.P2 the text keeps rows equal to the threshold` },
      wd => everything(wd, false),
    ], {}, { settle })
    const verify2 = store.inspect().checks.find(c => c.key === "verify-match-2")!.id
    assert.ok(settled.includes(`${filterGt()}:contested`) && settled.includes(`${verify2}:input_incomplete`))
    assert.deepEqual(record.cycles[0].contests, [{ check: filterGt(), claim: "R1.S3.P2 the text keeps rows equal to the threshold", verdict: "check_right" }])
    assert.ok(record.cycles[0].failing.includes(filterGt()), "upheld, it still counts")
    assert.ok(!record.cycles[1].runs.some(r => r.check === verify2), "ruled wrong, it is no longer run")
    assert.equal(record.status, "done")
    assert.deepEqual(contestsIn("no objection here\n  CONTEST K12: R2.S1 why"), [{ check: "K12", claim: "R2.S1 why" }])
  })

  it("a hung or broken session: back to the last checkpoint, a new session gets the work order and the evidence", async () => {
    const { executor, record } = await round("broken", [
      wd => { foundation(wd); return "partial" },
      "hang",
      wd => everything(wd, false),
    ], { callTimeoutMs: 1500 })
    assert.deepEqual(record.sessions.map(s => s.closed), ["broken", "normally"])
    assert.equal(executor.log.sessions[1].resume!.evidence.includes("missing_name"), true)
    assert.match(executor.log.messages[2].text, /A previous session stopped\. The work tree is at the last checkpoint/u)
    assert.deepEqual(record.cycles.map(c => c.message), ["work", "resume"])
    assert.equal(record.status, "done")
  })

  it("when the cycles run out, the round ends on the cycle with the fewest failures and carries what is not landed", async () => {
    const { record, workdir } = await round("spent", [
      wd => { foundation(wd); everything(wd, true) },
      // The repair makes it worse: verify now prints the wrong word.
      wd => write(wd, { "verify.go": VERIFY("OK") }),
    ], { repairCycles: 1 })
    assert.equal(record.status, "cycles_spent")
    assert.ok(record.cycles[1].failing.length > record.cycles[0].failing.length)
    assert.equal(record.kept, record.cycles[0].id)
    assert.equal(head(workdir), record.cycles[0].commit, "the tree is back at the better cycle")
    assert.deepEqual(record.carried, [id("filter")])
  })

  it("anchors are linked per object: filter owns its own code, not another operation's", async () => {
    const { record, workdir } = await round("anchors", [wd => { foundation(wd); everything(wd, false) }])
    const own = (name: string) => objectAnchors(store.registry(), anchors.extract(workdir), record.links, id(name)).map(a => a.id)
    assert.ok(own("filter").includes("A:filter.go:func:opFilter") && own("filter").includes("A:transform.go:dispatch:filter"))
    for (const other of ["opSort", "opDrop", "opRename", "runTransform"]) assert.ok(!own("filter").some(a => a.endsWith(`:${other}`)), `filter does not own ${other}`)
    assert.ok(record.links.some(l => l.via === "shared" && l.anchor === "A:main.go:func:main"), "code no object is named for is shared by the round's task")
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
