import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { Exp2Store, type Exp2State } from "../../src/exp2/store.js"
import type { Registry } from "../../src/exp2/registry.js"
import { objectView, renderObjectView } from "../../src/exp2/view.js"
import { ROUNDS, roundText } from "./inputs.js"
import { stubTransport, type StubLog } from "./stubs.js"

/** The registry state that must not drift between rounds, in a comparable form. */
function snapshot(registry: Registry) {
  return {
    objects: [...registry.objects.values()].map(o => ({ id: o.id, name: o.name, version: o.version, created: o.created_round, blocks: o.blocks.map(b => ({ block: b.block, state: b.state, mods: b.modifications.length })) })),
    changes: registry.changes.map(c => c.id),
    references: registry.references.map(r => `${r.from}->${r.to}`),
  }
}

const STATE_ORDER = ["active", "partially_modified", "superseded", "withdrawn"]

describe("exp2 block 1: R1–R15 fed round by round through the store, with stub answers", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-rounds-"))
  const store = new Exp2Store(dir, "offline-1")
  const log: StubLog[] = []
  const after = new Map<number, Registry>()
  const byName = (registry: Registry, name: string) => {
    const o = registry.objectByName(name)
    assert.ok(o, `no object named ${name}`)
    return o
  }
  const scopeNames = (registry: Registry, round: number) => registry.roundScope(round).map(c => registry.objects.get(c.object)!.name).sort()

  before(async () => {
    const transport = stubTransport(undefined, log)
    for (const round of ROUNDS) {
      const record = await store.ingestRound(round, roundText(round), transport)
      assert.equal(record.status, "accepted", `R${round}: ${JSON.stringify(record.issues)}`)
      after.set(round, store.registry())
    }
  })

  it("R1: the long first round becomes one object per command and per transform operation, the transform section split by paragraph", () => {
    const r = after.get(1)!
    const ops = ["filter", "derive", "sample", "sort", "rename", "drop", "aggregate", "join", "window", "pivot", "unpivot", "fill"]
    for (const op of ops) {
      const o = byName(r, op)
      assert.equal(o.version, 1)
      assert.ok(o.blocks.every(b => b.block.startsWith("R1.S3.") && b.level !== "section"), `${op} holds only parts of the transform section`)
    }
    for (const cmd of ["ingest", "transform", "verify", "manifest", "pipeline"]) assert.equal(byName(r, cmd).version, 1)
    assert.ok(!r.assigned.has("R1.S3"), "the transform section is not given whole")
    assert.deepEqual(byName(r, "ingest").blocks.map(b => b.block), ["R1.S2"], "a section about one object is given whole")
    // The first answer left out the window formatting paragraph; the repair added it without restating the rest.
    assert.ok(byName(r, "window").blocks.some(b => b.block === "R1.S3.P16"))
    assert.deepEqual(log.filter(l => l.round === 1).map(l => l.task), ["attribute", "repair"])
    const repair = log.find(l => l.round === 1 && l.task === "repair")!.request
    assert.ok(repair.issues.length === 1 && repair.issues[0].code === "uncovered" && repair.issues[0].block === "R1.S3.P16")
    // Same-round reference: having uses filter's condition operators.
    assert.ok(r.references.some(e => e.from === "R1.S3.P11.s4" && e.to === "R1.S3.P2.s4"))
    assert.deepEqual(r.coverageProblems(1), [])
    assert.equal(r.roundScope(1).length, r.objects.size, "every object is new in round 1")
  })

  it("R3: fill and normalize are revised in part; the old units are marked, both objects are in scope, and the view pairs old and new text", () => {
    const r2 = after.get(2)!, r3 = after.get(3)!
    const fill = byName(r3, "fill")
    assert.equal(fill.version, byName(r2, "fill").version + 1, "fill goes up one version in R3")
    assert.deepEqual(fill.history.map(h => h.round), [1, 2, 3])
    const linear = fill.blocks.find(b => b.block === "R2.S13")!
    assert.equal(linear.state, "partially_modified")
    const mod = linear.modifications.find(m => m.round === 3)!
    assert.deepEqual(mod.parts, ["R2.S13.P4.s4"])
    assert.equal(mod.kind, "partial")
    assert.ok(scopeNames(r3, 3).includes("fill") && scopeNames(r3, 3).includes("normalize"))
    const normalize = byName(r3, "normalize")
    assert.deepEqual(normalize.blocks.find(b => b.block === "R2.S11")!.modifications.map(m => m.parts), [["R2.S11.P5.s3"], ["R2.S11.P6.s4"]])

    const view = objectView(r3, fill.id)
    assert.deepEqual(view.entries.map(e => e.round), [1, 1, 2, 3], "blocks in round order")
    const old = view.entries.find(e => e.context === "R2.S13")!
    assert.match(old.text, /^### Fill `linear` strategy/u, "a section is shown whole, heading included")
    assert.match(old.text, /⟦4\. If either anchor is \*\*missing\*\*[^⟧]*⟧\(R3 partial\)/u)
    const pair = old.pairs.find(p => p.round === 3)!
    // The old side is the paragraph that holds the changed item, with its heading path, not the whole section.
    assert.deepEqual(pair.old.map(o => o.context), ["R2.S13.P4"])
    assert.deepEqual(pair.old[0].heading_path, ["## Extended transforms", "### Fill `linear` strategy"])
    assert.match(pair.old[0].text, /^1\. Search upward[\s\S]*⟦4\. If either anchor[^⟧]*⟧\n5\. Non-empty/u)
    assert.ok(pair.new.some(n => n.context === "R3.S2.P2" && n.heading_path.at(-1) === "### Fill linear: boundary extrapolation" && /only a \*\*lower anchor\*\*/u.test(n.text)))
    const rendered = renderObjectView(view)
    assert.match(rendered, /\| old \(R2, R2\.S13\.P4\) \| new \(R3, R3\.S2\.P2; R3, R3\.S2\.P3\) \|/u)
    // The first answer's override ran past the last item of the list; the issue named the real extent.
    const repair = log.find(l => l.round === 3 && l.task === "repair")!.request
    assert.ok(repair.issues.some(i => i.code === "range_invalid" && /s1\.\.s5/u.test(i.message)))
  })

  it("R5: one passage changes verify, manifest, ingest and transform; each gets a change record, including transform through ingest's text", () => {
    const r = after.get(5)!
    const scope = scopeNames(r, 5)
    for (const name of ["verify", "manifest", "ingest", "transform", "lineage", "pipeline", "blake2b-256 digest"]) assert.ok(scope.includes(name), `${name} in R5 scope`)
    const transform = byName(r, "transform")
    const change = r.roundScope(5).find(c => c.object === transform.id)!
    assert.deepEqual(change.entries.map(e => e.block), ["R5.S1.P3.s5"])
    const closing = transform.blocks.find(b => b.block === "R1.S3.P24")!
    assert.equal(closing.state, "partially_modified", "the closing item keeps its first half, so it is not superseded")
    assert.deepEqual(closing.modifications.map(m => [r.objects.get(m.by_object)!.name, m.kind, m.parts]).sort(),
      [["ingest", "withdraw", ["R1.S3.P24.s1.c3"]], ["transform", "withdraw", ["R1.S3.P24.s1.c3"]]], "only the sidecar clause is withdrawn")
    // "ingest and transform must remove it" is given to ingest and applies to transform: transform's record names it.
    assert.deepEqual(change.applied, [{ from: "R5.S1.P2.s5", by_object: byName(r, "ingest").id }])
    assert.ok(change.types.includes("applies_to"))
    assert.ok(r.references.some(e => e.kind === "applies_to" && e.from === "R5.S1.P2.s5"))
    const ingest = byName(r, "ingest")
    const sidecar = ingest.blocks.find(b => b.block === "R1.S2")!
    assert.deepEqual(sidecar.modifications.map(m => [m.kind, m.parts]), [["withdraw", ["R1.S2.P6.s3"]]])
    assert.equal(sidecar.state, "partially_modified")
    const view = objectView(r, transform.id)
    const pair = view.entries.find(e => e.context === "R1.S3.P24")!.pairs.find(p => p.by_object === ingest.id)!
    assert.equal(pair.by_object_name, "ingest")
    assert.ok(pair.new[0].context === "R5.S1.P2" && pair.new[0].marked.includes("R5.S1.P2.s4"), "the new text is the whole paragraph with the unit marked")
    assert.match(pair.old[0].text, /^- After all transformations, write the result CSV to `<output>`, ⟦its SHA-256 to `<output>\.sha256`\.⟧/u)
    // The first answer had a wrong unit id; it was named with the real extent and fixed.
    const repair = log.find(l => l.round === 5 && l.task === "repair")!.request
    assert.ok(repair.issues.some(i => i.code === "unknown_block" && /s1, s2, s3, s4, s5, s6/u.test(i.message)))
  })

  it("R7: the lineage manifest-step mapping item is overridden in part", () => {
    const r = after.get(7)!
    const lineage = byName(r, "lineage")
    assert.equal(lineage.version, 2)
    assert.deepEqual(lineage.blocks.find(b => b.block === "R5.S2")!.modifications.map(m => m.parts), [["R5.S4.P3.s5"]])
  })

  it("R10: the manifest field rename is a partial revision; reconcile is new and is cited by the pipeline and lineage extensions", () => {
    const r = after.get(10)!
    const manifest = byName(r, "manifest")
    assert.ok(manifest.blocks.find(b => b.block === "R1.S5")!.modifications.some(m => m.round === 10 && m.parts.includes("R1.S5.P2.s3")))
    const reconcile = byName(r, "reconcile")
    assert.equal(reconcile.created_round, 10)
    const scope = scopeNames(r, 10)
    for (const name of ["manifest", "reconcile", "pipeline", "lineage"]) assert.ok(scope.includes(name))
    const edges = r.references.filter(e => e.round === 10).map(e => `${e.from}->${e.to}`)
    assert.ok(edges.includes("R10.S7.P1->R10.S2") && edges.includes("R10.S8.P1->R10.S2") && edges.includes("R10.S2.P2->R1.S5.P2"))
    // The first answer referred to the new reconcile object by a guessed id; that one root was sent back as one issue.
    assert.deepEqual(byName(r, "lineage").blocks.filter(b => b.round === 10).map(b => b.block), ["R10.S8"])
    const repair = log.find(l => l.round === 10 && l.task === "repair")!.request
    assert.ok(repair.issues.length === 1 && repair.issues[0].code === "unknown_object")
    assert.match(repair.issues[0].message, /a new object has no id until this answer is accepted.*this answer creates "reconcile" \(R10\.S2\)/u)
  })

  it("R12 and R13: normalize's default is a partial revision over R2; R13's pipeline-support section is split between snapshot, pipeline and lineage", () => {
    const r12 = after.get(12)!
    const normalize = byName(r12, "normalize")
    assert.equal(normalize.version, byName(after.get(11)!, "normalize").version + 1)
    assert.deepEqual(normalize.blocks.find(b => b.block === "R2.S11")!.modifications.map(m => m.round), [3, 3, 12])
    const r13 = after.get(13)!
    assert.deepEqual(byName(r13, "pipeline").blocks.filter(b => b.round === 13).map(b => b.block), ["R13.S9.P1", "R13.S9.P2"])
    assert.deepEqual(byName(r13, "lineage").blocks.filter(b => b.round === 13).map(b => b.block), ["R13.S9.P3"])
    assert.equal(r13.assigned.get("R13.S9.P4"), "none")
    const view = objectView(r13, byName(r13, "lineage").id)
    const entry = view.entries.find(e => e.round === 13)!
    assert.deepEqual(entry.heading_path, ["# Snapshot command and clip transform", "## Extension: New `snapshot` command", "### Pipeline support"])
    const repair = log.find(l => l.round === 13 && l.task === "repair")!.request
    assert.ok(repair.issues.some(i => i.code === "hash_mismatch"))
  })

  it("R15: the snapshot row_hash change overrides four R13 places; snapshot is v2 and every old place is paired with the new text", () => {
    const r = after.get(15)!
    const snapshot = byName(r, "snapshot")
    assert.equal(snapshot.version, 2)
    const parts = snapshot.blocks.flatMap(b => b.modifications.flatMap(m => m.parts)).sort()
    assert.deepEqual(parts, ["R13.S4.P1.s1", "R13.S5.P1.s1", "R13.S7.P1.s8", "R13.S7.P1.s9"])
    const view = objectView(r, snapshot.id)
    const pairs = view.entries.flatMap(e => e.pairs)
    assert.equal(pairs.length, 4)
    for (const p of pairs) assert.ok(p.new.every(n => n.round === 15 && /SHA-256|64-character/u.test(n.text)))
    for (const p of pairs) assert.ok(p.old.every(o => o.heading_path.at(-1)!.startsWith("### ")), "each old side carries its heading path")
    // A code block or table owned whole is shown whole, marked as modified.
    assert.match(view.entries.find(e => e.context === "R13.S4")!.text, /^### Output format \(JSON\)/u)
    assert.deepEqual(scopeNames(r, 15), ["snapshot", "tag"])
  })

  it("across R1–R15 ids, versions, ownership and change records never drift or repeat, and no source block is lost", () => {
    const final = after.get(15)!
    for (const round of ROUNDS) assert.deepEqual(final.coverageProblems(round), [], `R${round} covered once`)
    const ids = [...final.objects.keys()]
    assert.deepEqual(ids, ids.map((_, i) => `O${i + 1}`), "object ids are sequential and never reused")
    assert.equal(new Set([...final.objects.values()].map(o => o.name.toLowerCase())).size, final.objects.size, "names are unique")
    assert.equal(new Set(final.changes.map(c => c.id)).size, final.changes.length)
    for (const o of final.objects.values()) {
      const changes = final.changes.filter(c => c.object === o.id)
      assert.equal(o.version, changes.length, `${o.name}: one version per change`)
      changes.forEach((c, i) => { assert.equal(c.from_version, i); assert.equal(c.to_version, i + 1) })
    }
    for (const round of ROUNDS.slice(1)) {
      const prev = snapshot(after.get(round - 1)!), next = snapshot(after.get(round)!)
      const scope = new Set(after.get(round)!.roundScope(round).map(c => c.object))
      for (const [i, o] of prev.objects.entries()) {
        const now = next.objects[i]
        assert.equal(now.id, o.id); assert.equal(now.name, o.name)
        assert.equal(now.version, o.version + (scope.has(o.id) ? 1 : 0), `R${round} ${o.name}: version moves only for scope objects`)
        assert.deepEqual(now.blocks.slice(0, o.blocks.length).map(b => b.block), o.blocks.map(b => b.block), `R${round} ${o.name}: earlier ownership kept`)
        o.blocks.forEach((b, k) => assert.ok(STATE_ORDER.indexOf(now.blocks[k].state) >= STATE_ORDER.indexOf(b.state) && now.blocks[k].mods >= b.mods))
        if (!scope.has(o.id)) assert.deepEqual(now, o, `R${round} ${o.name}: untouched objects stay identical`)
      }
      assert.deepEqual(next.changes.slice(0, prev.changes.length), prev.changes)
      assert.deepEqual(next.references.slice(0, prev.references.length), prev.references)
      assert.ok([...scope].every(id => after.get(round)!.objects.get(id)!.history.at(-1)!.round === round))
    }
  })

  it("the state file records every call with zero usage marked as stub, and replays to the same registry", () => {
    const state = JSON.parse(readFileSync(join(dir, "exp2-state.json"), "utf8")) as Exp2State
    assert.equal(state.sources.length, 15)
    assert.equal(state.calls.length, 15 + 5, "one call per round plus the five scripted repairs")
    for (const c of state.calls) {
      assert.equal(c.stub, true)
      assert.deepEqual(c.usage, { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 })
      assert.ok(c.model === "stub:scripted" || c.model === "stub:rule")
    }
    assert.deepEqual(state.rounds.map(r => r.calls.length), [2, 1, 2, 1, 2, 1, 1, 1, 1, 2, 1, 1, 2, 1, 1])
    assert.deepEqual(state.signals, [])
    const reopened = new Exp2Store(dir, "offline-1").registry()
    assert.deepEqual(snapshot(reopened), snapshot(after.get(15)!))
    assert.deepEqual(reopened.changes, after.get(15)!.changes)
  })

  it("the same inputs and answers give the same state, byte for byte", async () => {
    const other = mkdtempSync(join(tmpdir(), "exp2-rounds-"))
    const again = new Exp2Store(other, "offline-1")
    const transport = stubTransport()
    for (const round of ROUNDS) await again.ingestRound(round, roundText(round), transport)
    assert.equal(readFileSync(join(other, "exp2-state.json"), "utf8"), readFileSync(join(dir, "exp2-state.json"), "utf8"))
  })
})
