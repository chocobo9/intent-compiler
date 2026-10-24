import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { LEADS_MAX, pickLeads } from "../../src/exp2/accept.js"
import { attributeOnly } from "../../src/exp2/attribute.js"
import type { CheckRecord } from "../../src/exp2/checks.js"
import { GOLD_DIR, loadGold, locate, relationRecall, revisionRecall } from "../../src/exp2/gold.js"
import type { GuardRecord } from "../../src/exp2/guards.js"
import type { Registry } from "../../src/exp2/registry.js"
import { packageUse, renderReport, type RoundReport } from "../../src/exp2/report.js"
import { reviewRequestOn } from "../../src/exp2/review.js"
import { Exp2Store } from "../../src/exp2/store.js"
import type { CheckRun } from "../../src/exp2/verdict.js"
import { currentView, fitPackage, PACKAGE_BUDGET, packageComparisons, paragraphInForce, renderPackage, roundPackage, type PackageSegment } from "../../src/exp2/view.js"
import { roundText } from "./inputs.js"
import { stubTransport } from "./stubs.js"

/**
 * The chain block (DESIGN §6c, §6a steps 2, 3, 8): the current view as a pure function, the round's package by
 * object with its limit, the review request on the package, and attribution measured against the gold sets. Real
 * dpipe round texts, the stand-in attribution.
 */

const MARKERS = /replaced by|amended|withdrawn|where they differ|newer text wins|#[0-9a-f]{8}⟧/u
const unitText = (reg: Registry, id: string) => reg.block(id)!.text.trim()
/** A view without its unit markers, to look for a unit's words. */
const plain = (v: string) => v.replace(/‹[^›]*›/gu, "")

describe("the chain block, the current view (§6c, view)", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-chain-view-"))
  const store = new Exp2Store(join(dir, "store"), "chv")
  before(async () => { for (const r of [1, 2, 3, 4, 5]) await store.ingestRound(r, roundText(r), stubTransport()) })

  it("a list item revised (fill, R3 over R2.S13.P4.s4): the new items stand in its place, one to a line, each under its id; not again at their own place", () => {
    const reg = store.registry()
    const fill = reg.coverOf("R2.S13.P4.s4")!.owner
    const v = currentView(reg, fill, 3)
    assert.ok(!plain(v).includes(unitText(reg, "R2.S13.P4.s4")), "the old item is gone")
    const at = v.indexOf("‹R3.S2.P2›")
    assert.ok(at > v.indexOf("⟦R2.S13.P4⟧") && at < v.indexOf("⟦R2.S13.P5⟧"), "in place, inside R2.S13.P4")
    assert.ok(v.indexOf("‹R3.S2.P2›") < v.indexOf("\n‹R3.S2.P3›"), "the two revising paragraphs in order, each on a line of its own")
    assert.equal(v.split("‹R3.S2.P2›").length, 2, "given once")
    assert.doesNotMatch(v, MARKERS)
    // Round 2's view of the same object: the item as written.
    assert.ok(plain(currentView(reg, fill, 2)).includes(unitText(reg, "R2.S13.P4.s4")))
  })

  it("a clause withdrawn (the R1 sidecar, R5): the clause is gone; the text that withdrew it is there at its own place, in R5", () => {
    const reg = store.registry()
    const transform = reg.coverOf("R1.S3.P24.s1")!.owner
    const v = currentView(reg, transform, 5)
    assert.ok(!plain(v).includes(unitText(reg, "R1.S3.P24.s1.c3")), "the withdrawn clause is gone")
    assert.ok(plain(currentView(reg, transform, 4)).includes(unitText(reg, "R1.S3.P24.s1.c3")), "in R4 it stood")
    for (const by of ["R5.S1.P2.s4", "R5.S1.P3.s5"]) assert.ok(v.includes(`⟦${by}⟧`), by)
    assert.ok(v.indexOf("## R5") < v.indexOf("⟦R5.S1.P2.s4⟧"), "under R5's heading path")
    assert.doesNotMatch(v, MARKERS)
  })

  it("heading paths: one line where the path changes, without markdown marks; paragraph ids without hashes; a pure function", () => {
    const reg = store.registry()
    const fill = reg.coverOf("R2.S13.P4.s4")!.owner
    const v = currentView(reg, fill, 3)
    const paths = v.split("\n").filter(l => l.startsWith("## "))
    assert.ok(paths.length >= 2 && paths.every(p => /^## R\d+( › [^#].*)?$/u.test(p)), paths.join("\n"))
    assert.equal(new Set(paths).size, paths.length, "no repeated path line")
    assert.equal(currentView(reg, fill, 3), v)
  })

  it("a code block revised (an amended record): the old block is not there; the revising block stands at its own place", () => {
    const reg = store.registry()
    const fill = reg.objects.get(reg.coverOf("R2.S13.P4.s4")!.owner)!
    const code = reg.sources.get(2)!.blocks.find(b => b.kind === "code" && reg.coverOf(b.id)?.owner === fill.id)!
    assert.ok(code, "fill's R2 JSON example")
    const own = fill.blocks.find(b => b.block === reg.coverOf(code.id)!.block)!
    // A made-up revision of the example by R3.S2.P1 (no stand-in round revises a code block).
    const saved = own.modifications
    own.modifications = [...saved, { round: 3, change: "R3 change", kind: "revise", parts: [code.id], by: ["R3.S2.P1"], by_object: fill.id, amended: [code.id] }]
    try {
      ;(reg.changes as unknown[]).push({})
      const v = currentView(reg, fill.id, 3)
      assert.ok(!v.includes(code.text.trim()), "the old example is gone")
      assert.ok(v.includes("R3.S2.P1"), "the revising text is there")
      assert.doesNotMatch(v, MARKERS)
    } finally { own.modifications = saved; (reg.changes as unknown[]).pop() }
  })
})

describe("an earlier applies_to edge (the design session's decision on O2): its target comes when its source is revised this round, not otherwise", () => {
  // R1 records an edge from the transform list R1.S3.P24 to the verify object; R5 withdraws a clause of R1.S3.P24.
  const dir = mkdtempSync(join(tmpdir(), "exp2-chain-applies-"))
  const store = new Exp2Store(join(dir, "store"), "cha")
  const edged = () => {
    const inner = stubTransport()
    return async (request: Parameters<ReturnType<typeof stubTransport>>[0]) => {
      const reply = await inner(request)
      if (request.round !== 1 || request.previous_draft.assignments.length) return reply
      const patch = JSON.parse(reply.text) as { edges_add: unknown[] }
      patch.edges_add.push({ from: "R1.S3.P24", to: request.objects.find(o => o.name === "verify")?.id ?? "verify", kind: "applies_to" })
      return { ...reply, text: JSON.stringify(patch) }
    }
  }
  before(async () => { for (const r of [1, 2, 3, 4, 5]) await store.ingestRound(r, roundText(r), edged()) })

  it("R5 revises R1.S3.P24: the verify object's text comes in, by that edge; in R4 (no revision of it) it does not", () => {
    const reg = store.registry()
    const edge = reg.references.find(e => e.round === 1 && e.kind === "applies_to" && e.from === "R1.S3.P24")!
    assert.ok(edge, JSON.stringify(reg.references.filter(e => e.round === 1)))
    const target = /^O\d+$/u.test(edge.to) ? edge.to : reg.coverOf(edge.to)!.owner
    const r5 = roundPackage(reg, 5).segments.filter(s => s.object === target && s.why === "edge")
    assert.ok(r5.length > 0 && r5.every(s => s.via.some(v => v.startsWith("R1.S3.P24 applies_to") && v.endsWith("(its source revised this round)"))), JSON.stringify(r5.map(s => [s.paragraph, s.via])))
    assert.ok(!roundPackage(reg, 4).segments.some(s => s.object === target && s.why === "edge"), "R4 does not revise the source")
  })
})

describe("the package's comparisons (§6c revision item 4): only guards on units this round revises, what they get now, the earlier and present text", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-chain-cmp-"))
  const store = new Exp2Store(join(dir, "store"), "chc")
  before(async () => { for (const r of [1, 2, 3, 4, 5]) await store.ingestRound(r, roundText(r), stubTransport()) })

  it("R5 withdraws the R1 sidecar clause: the guard on it is delivered (command, input files, output now, earlier text, withdrawn); the sort guard is not; R4 has none", () => {
    const reg = store.registry()
    const input = { args: ["transform", "--input", "data.csv"], files: [{ path: "data.csv" }] }
    const guards = [{ id: "G1", units: ["R1.S3.P24.s1"], input }, { id: "G2", units: ["R1.S3.P9.s2"], input }]
    const cs = packageComparisons(reg, 5, guards, [], new Map([["G1", "exit 0; file_exists out.csv.sha256 = true"]]))
    assert.deepEqual(cs.map(c => c.guard), ["G1"])
    assert.deepEqual([cs[0].args, cs[0].files, cs[0].output], [input.args, ["data.csv"], "exit 0; file_exists out.csv.sha256 = true"])
    assert.ok(cs[0].units.some(u => u.id === "R1.S3.P24.s1.c3" && u.earlier === reg.block("R1.S3.P24.s1.c3")!.text.trim()))
    assert.deepEqual(packageComparisons(reg, 4, guards, [], new Map()), [])
    const pkg = roundPackage(reg, 5)
    const text = renderPackage({ ...pkg, comparisons: cs })
    assert.match(text, /## Behaviour bound to earlier text this round revises[^]*- G1: command \["transform","--input","data\.csv"\]; input files data\.csv; now: exit 0/u)
    assert.ok(!/- G2:/u.test(text), "no other guard")
    assert.doesNotMatch(renderPackage(pkg), /G1|G2/u, "nothing about guards without comparisons")
  })
})

describe("the chain block, the round's package and its limit (§6c, round package)", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-chain-pkg-"))
  const store = new Exp2Store(join(dir, "store"), "chp")
  before(async () => { for (const r of [1, 2, 3]) await store.ingestRound(r, roundText(r), stubTransport()) })
  const seg = (paragraph: string, why: PackageSegment["why"], size: number): PackageSegment => ({ object: "O1", name: "o", paragraph, round: 1, path: "R1", why, via: [], text: "x".repeat(size) })

  for (const kind of ["revise", "withdraw"] as const) {
    it(`a paragraph wholly ${kind === "revise" ? "replaced" : "withdrawn"} this round (a made-up record): its old text is only the earlier-text line, never text in force; as an open item it brings nothing`, () => {
      const reg = store.registry()
      // An R2 paragraph of an object, ${kind === "revise" ? "replaced" : "withdrawn"} by R3.S3.P1 (no stand-in round does it to a whole paragraph).
      const own = [...reg.objects.values()].flatMap(o => o.blocks.map(b => ({ o, b }))).find(x => x.b.round === 2 && x.b.modifications.length === 0 && reg.block(x.b.block)!.children.some(c => reg.block(c)!.level === "paragraph" && reg.block(c)!.kind !== "heading"))!
      const para = reg.block(own.b.block)!.children.find(c => reg.block(c)!.level === "paragraph" && reg.block(c)!.kind !== "heading")!, old = reg.block(para)!.text.trim()
      const saved = own.b.modifications
      own.b.modifications = [...saved, { round: 3, change: "R3 change", kind, parts: [para], by: ["R3.S3.P1"], by_object: own.o.id }]
      try {
        assert.equal(paragraphInForce(reg, para, 3), "")
        assert.ok(paragraphInForce(reg, para, 2).length > 0, "in R2 it stood")
        const pkg = roundPackage(reg, 3, [{ id: "V2.1.1", units: [para] }])
        const seg = pkg.segments.find(x => x.paragraph === para)!
        assert.equal(seg.why, "revised")
        assert.equal(seg.text, `earlier text of ${para}: ${old}`, "only the earlier text, once")
        assert.equal(renderPackage(pkg).split(old).length - 1, 1, "the old text appears once in the whole package")
        // As an open item alone (no revision this round), a paragraph out of force brings nothing.
        const later = roundPackage(reg, 3, [])
        own.b.modifications = [...saved, { round: 2, change: "R2 change", kind, parts: [para], by: ["R2.S1"], by_object: own.o.id }]
        assert.ok(!roundPackage(reg, 3, [{ id: "V2.1.1", units: [para] }]).segments.some(x => x.paragraph === para), "out of force since R2: not brought by an open item")
        assert.ok(later.segments.some(x => x.paragraph === para && x.why === "revised"))
      } finally { own.b.modifications = saved }
    })
  }

  it("over the budget (40k): the paragraphs edges brought go first, the last first; then those of open items; this round's and the revised ones stay", () => {
    const pkg = (segments: PackageSegment[]) => ({ segments, heads: [], comparisons: [], edges: { to_block: 0, to_object: 0 } })
    assert.equal(PACKAGE_BUDGET, 40_000)
    const segs = [seg("P1", "this round", 12_000), seg("P2", "revised", 5_000), seg("P3", "edge", 8_000), seg("P4", "edge", 8_000), seg("P5", "open item", 6_000), seg("P6", "open item", 6_000)]
    const f = fitPackage(pkg(segs))
    assert.deepEqual(f.pkg.segments.map(s => s.paragraph), ["P1", "P2", "P3", "P5", "P6"])
    assert.deepEqual(f.overflow!.dropped, ["P4"])
    const g = fitPackage(pkg([...segs, seg("P7", "this round", 25_000)]))
    assert.deepEqual(g.pkg.segments.map(s => s.paragraph), ["P1", "P2", "P7"], "edges, then open items")
    assert.equal(g.overflow!.still_over, true, "this round's paragraphs are never cut")
    assert.equal(fitPackage(pkg([seg("P1", "this round", 10)])).overflow, null)
  })

  it("the package's use (§6c revision item 6): the items sent to a repair list, by the objects and the package's paragraphs their units are in", () => {
    const reg = store.registry()
    const pkg = roundPackage(reg, 3)
    const p = pkg.segments[0], other = pkg.segments.find(x => x.object !== p.object)!
    const unit = reg.block(p.paragraph)!.children[0] ?? p.paragraph
    const use = packageUse(reg, pkg.segments, [{ disposition: "sent", units: [unit] }, { disposition: "blocked", units: [other.paragraph] }, { disposition: "sent", units: ["R1.S3.P9.s2"] }])
    const sortOwner = reg.coverOf("R1.S3.P9.s2")!.owner
    assert.deepEqual(use.objects.cited.sort(), [p.object, sortOwner].sort())
    assert.equal(use.paragraphs.cited, 1, "only the sent item in a package paragraph counts")
    assert.equal(use.objects.total, new Set(pkg.segments.map(x => x.object)).size)
    assert.deepEqual(use.objects.missing, pkg.segments.some(x => x.object === sortOwner) ? [] : [sortOwner])
  })

  it("the review request (§6c, review request): the package's views as the requirements, this round's unit ids, no quoted old text, no guard list", () => {
    const reg = store.registry()
    const body = renderPackage(roundPackage(reg, 3))
    const r = reviewRequestOn(body, { round: 3, units: [], unit_ids: ["R3.S2.P1", "R3.S3.P1"], guardFailures: [], leads: [] })
    assert.ok(r.includes(body.trimEnd()))
    assert.match(r, /Units round 3 added or revised, to check with particular care: R3\.S2\.P1, R3\.S3\.P1\./u)
    assert.doesNotMatch(r, /Earlier text this round revised or withdrew|# Round \d+ requirements|Protection zone/u)
  })

  it("leads: at most 20, those on units no guard covers first, then by id", () => {
    const reg = store.registry()
    const units = [...reg.sources.get(1)!.blocks.filter(b => b.level === "paragraph")].map(b => b.id)
    const library = units.slice(0, 25).map((u, i) => ({ id: `K${i + 1}`, blocks: [u] }) as unknown as CheckRecord)
    const guards = [{ id: "G1", units: [units[0], units[1], units[2]] } as GuardRecord]
    const runs = library.map(k => ({ check: k.id }) as CheckRun)
    const { given, dropped } = pickLeads(reg, library, guards, runs)
    assert.equal(LEADS_MAX, 20)
    assert.equal(dropped, 5)
    assert.deepEqual(given.slice(0, 3).map(r => r.check), ["K4", "K5", "K6"], "uncovered first")
    assert.ok(!given.some(r => ["K1", "K2", "K3"].includes(r.check)), "the covered ones are the ones past the cap")
  })
})

describe("the chain block, attribution against the gold sets (effects 4, 5)", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-chain-gold-"))
  const store = new Exp2Store(join(dir, "store"), "chg")
  const gold = loadGold(resolve(process.cwd(), GOLD_DIR), "deterministic-data-pipeline-go")!
  before(async () => { for (const r of [1, 2, 3]) await store.ingestRound(r, roundText(r), stubTransport()) })

  it("gold sentences are found in the text by their words; R3's four revisions are recorded by the stand-in attribution's partial overrides", () => {
    const reg = store.registry()
    assert.ok(gold.revisions.length > 0 && gold.xrefs.length > 0)
    assert.match(locate(reg, 3, "If only a **lower anchor** exists")!, /^R3.S2.P2.s1/u)
    const r3 = revisionRecall(reg, 3, gold)
    assert.deepEqual([r3.gold, r3.unlocated], [4, 0])
    assert.ok(r3.hit >= 3, JSON.stringify(r3))
    assert.ok(r3.precision!.recorded >= r3.precision!.on_gold)
    const x2 = relationRecall(reg, 2, gold)
    assert.equal(x2.gold, 5)
    assert.equal(x2.by_edge! + x2.by_object!, x2.hit)
    assert.equal(Object.values(x2.by_kind!).reduce((n, k) => n + k.gold, 0), 5)
  })

  it("the report's lines: revision recall, relation recall (or no gold set), the flip classification", () => {
    const reg = store.registry()
    const line = (gold: RoundReport["gold"]) => renderReport({ round: 3, zones: { task: 0, protect: 0, status: 0, source_blocks: 0, anchors: 0 }, checks: { entered: 0 }, ...(gold ? { gold } : {}) } as unknown as RoundReport)
    const with_ = line({ task: gold.task, revision: revisionRecall(reg, 3, gold), relation: relationRecall(reg, 3, gold) })
    assert.match(with_, /- Revision recall \(gold set deterministic-data-pipeline-go\): \d+\/4 of the gold set's located entries recorded/u)
    assert.match(with_, /- Relation recall \(gold set deterministic-data-pipeline-go\): \d+\/\d+ of the gold set's located entries recorded \(by an edge \d+, by the same object \d+\)/u)
    assert.match(line(undefined), /- Revision recall: no gold set for this task\.\n- Relation recall: no gold set for this task\./u)
  })

  it("intent-exp2-attribute's work: attribution alone over R1–R3, its records and the two recalls per round, resumable", async () => {
    const out = mkdtempSync(join(tmpdir(), "exp2-chain-attr-"))
    const inputs = resolve(process.cwd(), "exp2/inputs/dpipe")
    let calls = 0
    const transport = stubTransport()
    const rounds = await attributeOnly({ inputs, to: 3, out, transport: async r => { calls++; return transport(r) }, gold })
    assert.deepEqual(rounds.map(r => r.status), ["accepted", "accepted", "accepted"])
    assert.ok(rounds[2].modifications.some(m => m.by.includes("R3.S3.P1")))
    assert.ok(rounds[1].revision && rounds[1].relation)
    const json = JSON.parse(readFileSync(join(out, "attribute.json"), "utf8")) as { task: string; rounds: unknown[] }
    assert.deepEqual([json.task, json.rounds.length], ["deterministic-data-pipeline-go", 3])
    assert.match(readFileSync(join(out, "attribute.md"), "utf8"), /^All rounds: revision recall \d+\/\d+/mu)
    const before = calls
    await attributeOnly({ inputs, to: 3, out, transport: async r => { calls++; return transport(r) }, gold })
    assert.equal(calls, before, "accepted rounds are not asked again")
  })
})
