import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { basisOf, buildCheckRequest, checkChecks, staleChecks, type Assertion, type CheckDraft, type CheckRecord } from "../../src/exp2/checks.js"
import type { Registry } from "../../src/exp2/registry.js"
import type { AttributionAnswer } from "../../src/exp2/registry.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { buildWorkOrder, renderWorkOrder } from "../../src/exp2/workorder.js"
import { ROUNDS, roundText } from "./inputs.js"
import { SCRIPTS, stubTransport } from "./stubs.js"

/** A library check as admission would leave it; only the fields propagation reads matter here. */
function libraryCheck(id: string, round: number, object: string, blocks: string[], uses: string[] = [], quotes: [string, string][] = []): CheckRecord {
  const exit: Assertion = { id: "exit", role: "business", target: { kind: "exit_code", path: null, line: null, pointer: null, column: null }, expect: 0, tolerance: null, source: { kind: "derived", block: null, quote: null } }
  const verbatim = quotes.map(([block, quote], i): Assertion => ({ id: `q${i}`, role: "business", target: { kind: "stdout", path: null, line: null, pointer: null, column: null }, expect: quote, tolerance: null, source: { kind: "verbatim", block, quote } }))
  return {
    id, round, key: id, object, blocks, uses, direction: "holds", input: { args: [], files: [] }, assertions: [exit, ...verbatim], unknown: [], reference_script: null,
    admission: "admitted", admission_reason: null, strength: { strong: true, baseline: "b", baseline_ok: true, data_assertions: [], reason: "" }, status: "active", calls: [],
  }
}

describe("exp2 block 4: propagation over the real R1–R15 registry", () => {
  let registry: Registry
  const id = (name: string) => registry.objectByName(name)!.id

  before(async () => {
    const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-prop-")), "offline-4")
    const t = stubTransport()
    for (const round of ROUNDS) assert.equal((await store.ingestRound(round, roundText(round), t)).status, "accepted")
    registry = store.registry()
  })

  it("refers_to: when the referenced block is revised, a check resting on the citing block goes stale", () => {
    // R7's lineage correction says "The `manifest` command scans a directory" (refers_to R1.S5.P2); R10 revises R1.S5.P2.
    assert.ok(registry.references.some(e => e.kind === "refers_to" && e.from === "R7.S1.P2" && e.to === "R1.S5.P2"))
    const citing = libraryCheck("K1", 7, id("lineage"), ["R7.S1.P2"])
    const other = libraryCheck("K2", 7, id("lineage"), ["R7.S1.P3"])
    assert.deepEqual(staleChecks(registry, [citing, other], [], 9), [], "nothing revised yet")
    const r10 = staleChecks(registry, [citing, other], [], 10)
    assert.deepEqual(r10.map(e => [e.check, e.cause]), [["K1", { kind: "refers_to", source: "R1.S5.P2" }]])
    assert.match(r10[0].reason, /R7\.S1\.P2 refers to R1\.S5\.P2, partly revised in round 10/u)
  })

  it("a shared convention's revision stales exactly the checks that use it, and only those are derived again", () => {
    // R5 revises transform (the sidecar clause); filter's checks run through transform's command.
    const uses = libraryCheck("K1", 1, id("filter"), ["R1.S3.P2.s4"], [id("transform")])
    const plain = libraryCheck("K2", 1, id("filter"), ["R1.S3.P2.s4"])
    const sort = libraryCheck("K3", 1, id("sort"), ["R1.S3.P9.s2"])
    const events = staleChecks(registry, [uses, plain, sort], [], 5)
    assert.deepEqual(events.map(e => [e.check, e.cause?.kind, e.cause?.source]), [["K1", "convention", id("transform")]])
    const request = buildCheckRequest(registry, 5, [uses, plain, sort], events)
    assert.deepEqual(request.stale.map(s => s.id), ["K1"])
    assert.ok(!request.scope.some(s => s.id === id("filter")), "filter did not change in R5")
    // A replacement for the stale filter check is admitted; a check for sort (nothing stale, not in scope) is not.
    const draft = (key: string, object: string, blocks: string[]): CheckDraft => ({
      key, object, blocks, uses: [id("transform")], direction: "holds", note: null, reference_script: { language: "python", code: "print('{}')" },
      input: { args: ["transform", "--input", "data.csv", "--recipe", "recipe.json", "--output", "out.csv", "--seed", "1"], files: [] },
      assertions: [{ id: "x", role: "business", target: { kind: "exit_code", path: null, line: null, pointer: null, column: null }, expect_json: "0", tolerance: null, source: { kind: "derived", block: null, quote: null } }],
    })
    const issues = checkChecks(registry, 5, { checks: [draft("again", id("filter"), ["R1.S3.P2.s4"]), draft("other", id("sort"), ["R1.S3.P9.s2"])], retire: [] }, [uses, plain, sort], events)
    assert.deepEqual(issues.map(i => `${i.code}:${i.check}`), ["object_not_in_scope:other"])
    // The work order lists filter under "affected by a convention revision".
    const w = buildWorkOrder({ registry, round: 5, library: [uses, plain, sort], events, statuses: [], runs: [], anchors: [], links: [], steps: [], previous_task: [] })
    const filter = w.task.find(t => t.object === id("filter"))!
    assert.deepEqual(filter.why, ["convention"])
    assert.deepEqual(filter.conventions, [{ convention: id("transform"), checks: ["K1"] }])
    assert.match(renderWorkOrder(w), /affected by the revision of convention O\d+ \(checks K1 to be derived again\)/u)
  })

  it("a check made stale by its basis is derived again in the same round even outside the scope, without entering the task zone", () => {
    // A determinism-contract check citing manifest's text: R10 revises that text; determinism contract did not change.
    const det = id("determinism contract")
    const k = libraryCheck("K1", 1, det, ["R1.S5.P2"])
    const events = staleChecks(registry, [k], [], 10)
    assert.deepEqual(events.map(e => [e.check, e.cause?.kind]), [["K1", "basis"]])
    assert.ok(!registry.roundScope(10).some(c => c.object === det))
    const request = buildCheckRequest(registry, 10, [k], events)
    assert.deepEqual(request.stale.map(s => s.id), ["K1"])
    const again: CheckDraft = {
      key: "again", object: det, blocks: ["R1.S7"], uses: [], direction: "holds", note: null, reference_script: { language: "python", code: "print('{}')" },
      input: { args: ["manifest", "--dir", ".", "--output", "m.json"], files: [] },
      assertions: [{ id: "x", role: "business", target: { kind: "exit_code", path: null, line: null, pointer: null, column: null }, expect_json: "0", tolerance: null, source: { kind: "derived", block: null, quote: null } }],
    }
    assert.deepEqual(checkChecks(registry, 10, { checks: [again], retire: [] }, [k], events), [])
    const w = buildWorkOrder({ registry, round: 10, library: [k], events, statuses: [], runs: [], anchors: [], links: [], steps: [], previous_task: [] })
    assert.ok(!w.task.some(t => t.object === det), "re-derivation is no task")
  })

  it("applies_to alone puts the target object in the round's scope and the task zone", async () => {
    // A variant of the R5 answer where transform has no block of its own: only the applies_to edge reaches it.
    const fixPatch = SCRIPTS[5][1]
    const variant = {
      ...SCRIPTS,
      5: [
        (req: Parameters<typeof fixPatch>[0]) => {
          const first = SCRIPTS[5][0](req) as AttributionAnswer
          const transform = req.objects.find(o => o.name === "transform")!.id
          const ingest = req.objects.find(o => o.name === "ingest")!.id
          const assignments = first.assignments.map(a => {
            if (a.block === "R5.S1.P2.s7") return { ...a, block: "R5.S1.P2.s6" }
            if (a.block === "R5.S1.P3.s5") return { ...a, object_id: ingest, change: "add" as const, replaces: [] }
            if (a.block === "R5.S1.P2.s4") return { ...a, replaces: ["R1.S2.P6.s3"] }
            return a
          })
          assert.ok(first.references.some(e => e.kind === "applies_to" && e.to === transform))
          return { ...first, assignments }
        },
      ],
    }
    const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-prop-")), "offline-4b")
    const t = stubTransport(variant)
    for (const round of [1, 2, 3, 4, 5]) assert.equal((await store.ingestRound(round, roundText(round), t)).status, "accepted")
    const r = store.registry()
    const transform = r.objectByName("transform")!.id
    const change = r.roundScope(5).find(c => c.object === transform)!
    assert.deepEqual([change.entries.length, change.received.length, change.types], [0, 0, ["applies_to"]])
    assert.deepEqual(change.applied, [{ from: "R5.S1.P2.s5", by_object: r.objectByName("ingest")!.id }])
    const w = buildWorkOrder({ registry: r, round: 5, library: [], events: [], statuses: [], runs: [], anchors: [], links: [], steps: [], previous_task: [] })
    assert.deepEqual(w.task.find(x => x.object === transform)!.why, ["changed"])
  })

  it("a partial revision stales only the checks resting on the revised clause or unit", () => {
    // R5 withdraws only "its SHA-256 to `<output>.sha256`" (R1.S3.P24.s1.c3) of transform's closing item.
    const csv = libraryCheck("K1", 1, id("transform"), ["R1.S3.P1"], [], [["R1.S3.P24", "write the result CSV to `<output>`"]])
    const sidecar = libraryCheck("K2", 1, id("transform"), ["R1.S3.P1"], [], [["R1.S3.P24", "its SHA-256 to `<output>.sha256`"]])
    assert.deepEqual(basisOf(registry, csv), ["R1.S3.P1", "R1.S3.P24.s1.c2"])
    assert.deepEqual(basisOf(registry, sidecar), ["R1.S3.P1", "R1.S3.P24.s1.c3"])
    assert.deepEqual(staleChecks(registry, [csv, sidecar], [], 5).map(e => e.check), ["K2"])
    // R15 overrides R13's step 4 and the 32-character item; steps 1–3 still stand.
    const snapshot = id("snapshot")
    const checks = [
      libraryCheck("K3", 13, snapshot, ["R13.S7.P1.s5"]),
      libraryCheck("K4", 13, snapshot, ["R13.S7.P1.s8"]),
      libraryCheck("K5", 13, snapshot, ["R13.S2.P1"], [], [["R13.S7", "Sort these row strings lexicographically."]]),
      libraryCheck("K6", 13, snapshot, ["R13.S2.P1"], [], [["R13.S7", "Compute the MD5 hex digest"]]),
    ]
    assert.deepEqual(staleChecks(registry, checks, [], 15).map(e => e.check), ["K4", "K6"])
  })
})
