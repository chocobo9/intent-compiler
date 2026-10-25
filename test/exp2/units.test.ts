import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { Registry } from "../../src/exp2/registry.js"
import { splitRound } from "../../src/exp2/source.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { codeUnits, cuesIn, cueUnits, guardUnits, objectsNamed, provenance, revisionUnits, scopeDeclarations } from "../../src/exp2/units.js"
import { contextOf, roundPackage } from "../../src/exp2/view.js"
import { roundText } from "./inputs.js"
import { stubTransport } from "./stubs.js"

/**
 * Batch 4 E1a (DESIGN-DEEP §1): change units from code — the author's cues, recorded revisions, checks — and the
 * provenance of each revision. The dpipe text is the real one; the attribution is the stand-in's.
 */
describe("batch 4 E1a: change units and revision provenance, by code", () => {
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-units-")), "units")
  before(async () => { for (const r of [1, 2, 3, 4, 5]) await store.ingestRound(r, roundText(r), stubTransport()) })

  it("R5's behaviour change names four commands in one section: one cue unit across manifest, verify, ingest and transform", () => {
    const reg = store.registry()
    const units = cueUnits(reg, 5)
    const u = units.find(x => x.cue?.kind === "cmd_in_revision")!
    assert.ok(u, JSON.stringify(units.map(x => x.name)))
    assert.match(u.name, /Behavior Change: verify command checksum algorithm/u)
    const named = (n: string) => objectsNamed(reg, n)
    for (const c of ["manifest", "verify", "ingest", "transform"]) assert.ok(named(c).some(o => u.objects.includes(o)), `${c}: ${u.objects.map(o => reg.objects.get(o)?.name).join(", ")}`)
    assert.ok(u.members.every(m => reg.block(m)!.round === 5 && reg.lineage(m).some(b => b.id === "R5.S1")))
    assert.ok(u.members.some(m => /no longer writes `\.sha256`/u.test(reg.block(m)!.text)))
  })

  it("a revision whose new text says no longer / instead of is cue, with the words; one that says nothing of it is inferred", () => {
    const reg = store.registry()
    assert.deepEqual(provenance(reg, { by: ["R5.S1.P3.s5"] }), { kind: "cue", text: "no longer" })
    assert.deepEqual(provenance(reg, { by: ["R5.S1.P3.s2"] }), { kind: "cue", text: "instead of" })
    assert.deepEqual(provenance(reg, { by: ["R1.S3.P2"] }), { kind: "inferred" })
  })

  it("revision units join the new text and what it replaced; guard units are one a check, never merged", () => {
    const reg = store.registry()
    const rev = revisionUnits(reg)
    const mods = [...reg.objects.values()].flatMap(o => o.blocks.flatMap(b => b.modifications))
    assert.equal(rev.length, mods.length)
    for (const u of rev) assert.ok(u.source === "revision" && u.members.length >= 2)
    const g = guardUnits(reg, [{ id: "K1", round: 1, blocks: ["R1.S3.P2.s4", "R1.S8.P1.s1"] }, { id: "K2", round: 1, blocks: ["R1.S8.P1.s1"] }])
    assert.deepEqual(g.map(x => [x.id, x.members]), [["U1.gK1", ["R1.S3.P2.s4", "R1.S8.P1.s1"]], ["U1.gK2", ["R1.S8.P1.s1"]]], "sharing a sentence does not merge them")
    const all = codeUnits(reg, 5, [{ id: "K1", round: 1, blocks: ["R1.S3.P2.s4"] }])
    assert.deepEqual([...new Set(all.map(u => u.source))].sort(), ["cue", "guard", "revision"])
  })

  it("a backticked name means the object named so; an object whose name only starts with it counts only when none does", () => {
    const reg = new Registry()
    reg.addSource(splitRound(1, "x"))
    for (const [id, name] of [["O1", "ingest command"], ["O2", "ingest output"], ["O3", "pivot operation"]]) reg.objects.set(id, { id, name, created_round: 1, version: 1, blocks: [], history: [] })
    assert.deepEqual(objectsNamed(reg, "ingest"), ["O1"])
    assert.deepEqual(objectsNamed(reg, "pivot"), ["O3"])
    reg.objects.delete("O1")
    assert.deepEqual(objectsNamed(reg, "ingest"), ["O2"])
  })

  it("R6's \"Any `dpipe` command can accept --audit\": a global unit naming the program's object, never every command", () => {
    const reg = new Registry()
    reg.addSource(splitRound(6, roundText(6)))
    for (const [id, name] of [["O1", "dpipe CLI"], ["O2", "ingest command"], ["O3", "transform command"]]) reg.objects.set(id, { id, name, created_round: 1, version: 1, blocks: [], history: [] })
    const g = cueUnits(reg, 6).filter(u => u.all)
    assert.equal(g.length, 1, JSON.stringify(cueUnits(reg, 6).map(u => u.name)))
    assert.deepEqual(g[0].objects, ["O1"])
    assert.match(reg.block(g[0].members[0])!.text, /Any `dpipe` command/u)
  })

  it("batch 5 C: \"the same … as the `profile` command\" is a cue unit across the drift sentence's command and profile; a name that is no other command makes none", () => {
    const reg = store.registry()
    const hits = cuesIn(reg, 3).filter(h => h.kind === "same_as")
    const drift = hits.find(h => reg.block(h.block)!.text.includes("same type inference rules and numeric statistics as the `profile` command"))!
    assert.ok(drift, JSON.stringify(hits))
    assert.deepEqual(drift.names, ["profile"])
    const p25 = hits.find(h => h.names.includes("p25"))!
    assert.ok(p25, "a field name is a hit")
    const units = cueUnits(reg, 3).filter(u => u.cue?.kind === "same_as")
    const profile = objectsNamed(reg, "profile"), owner = reg.coverOf(drift.block)!.owner
    assert.equal(profile.length, 1)
    assert.notEqual(owner, profile[0])
    const u = units.find(x => x.members.includes(drift.block))!
    assert.deepEqual([u.members, [...u.objects].sort(), u.all], [[drift.block], [owner, profile[0]].sort(), undefined])
    assert.ok(!units.some(x => x.members.includes(p25.block)), "no unit for a field name")
  })

  it("E2: dpipe R12 declares earlier behaviour unchanged once; R5 does not", () => {
    const reg = new Registry()
    for (const r of [5, 12]) reg.addSource(splitRound(r, roundText(r)))
    const d = scopeDeclarations(reg, 12)
    assert.equal(d.length, 1)
    assert.match(d[0].text, /remain unchanged/u)
    assert.deepEqual(scopeDeclarations(reg, 5), [])
  })

  it("scope declarations and a Changes to section are found in text, before any attribution", () => {
    const reg = new Registry()
    reg.addSource(splitRound(1, "## Base\n\nThe tool reads input.\n"))
    reg.addSource(splitRound(2, "## Changes to `build`\n\nBuild now uses fail-fast instead of continuing.\n\nIt also prints a summary.\n\n## Unchanged Behavior\n\nAll existing endpoints and behaviors not mentioned above continue to work as before.\n"))
    assert.deepEqual(scopeDeclarations(reg, 2).map(x => x.text), ["All existing endpoints and behaviors not mentioned above continue to work as before"])
    const u = cueUnits(reg, 2).find(x => x.cue?.kind === "changes_to")!
    assert.equal(u.name, "Changes to build")
    assert.equal(u.members.length, 2, "both sentences under the heading")
    assert.ok(cuesIn(reg, 2).some(h => h.kind === "prev_new"))
  })
})

describe("batch 4 E3: a change unit brings its earlier sentences' paragraphs into the package", () => {
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-units-pkg-")), "unitspkg")
  // The stand-in's R2 answer gives a unit of its own: an R2 sentence and the R1 filter sentence change together.
  const transport = (): ReturnType<typeof stubTransport> => {
    const inner = stubTransport()
    return async request => {
      const reply = await inner(request)
      if (request.round !== 2 || request.previous_draft.assignments.length) return reply
      const patch = JSON.parse(reply.text) as { units_add: unknown[] }
      patch.units_add.push({ candidate: null, name: "filter and R2", members: ["R2.S1.P1", "R1.S3.P2.s4"] })
      return { ...reply, text: JSON.stringify(patch) }
    }
  }
  before(async () => { const t = transport(); for (const r of [1, 2]) await store.ingestRound(r, roundText(r), t) })

  it("the R1 paragraph comes as a unit paragraph, model-sourced (the first to go over the budget)", () => {
    const reg = store.registry()
    assert.ok(reg.units(2).some(u => u.source === "model" && u.members.includes("R1.S3.P2.s4")), JSON.stringify(reg.answerUnits))
    const pkg = roundPackage(reg, 2)
    const s = pkg.segments.find(x => x.paragraph === contextOf(reg, "R1.S3.P2.s4").id)!
    assert.ok(s, JSON.stringify(pkg.segments.map(x => [x.paragraph, x.why])))
    assert.deepEqual([s.why, s.unit_source], ["unit", "model"])
    assert.match(s.via.join(" "), /U2\.m1 \(model: filter and R2\)/u)
    assert.ok(pkg.units.touched >= 1)
  })
})
