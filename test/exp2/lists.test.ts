import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import type { ExecutionRecord } from "../../src/exp2/execution.js"
import { checkFact, coverageGaps, exercised, globalCoverage, globalFlag, openList, patrolList, PATROL_TEXT_MAX, patrolText, reviewLists, type OpenFact } from "../../src/exp2/lists.js"
import { reviewAppendix } from "../../src/exp2/review.js"
import { currentView } from "../../src/exp2/view.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { roundText } from "./inputs.js"
import { stubTransport } from "./stubs.js"

/**
 * Batch 4 E4 (DESIGN-DEEP §2.2, the design session's choices of 2026-10-25): the review's lists from facts code
 * holds — the open list (a failing check gives a line; a carried item, the paragraphs its units are in), the patrol of
 * quiet earlier commands, units across commands and global units — within the soft cap, and their coverage.
 */
describe("batch 4 E4: the review's lists", () => {
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-lists-")), "lists")
  before(async () => { for (const r of [1, 2, 3, 4, 5, 6]) await store.ingestRound(r, roundText(r), stubTransport()) })
  const reg = () => store.registry()
  const id = (n: string) => reg().objectByName(n)!.id

  it("open list: a failing earlier check is one line; a carried item brings the paragraph its unit is in", () => {
    const r = reg(), filter = id("filter"), sort = id("sort")
    const facts: OpenFact[] = [
      { id: "V1.1.1", kind: "carried", round: 1, object: null, units: ["R1.S3.P2.s4"], why: "untouched since R1" },
      checkFact({ id: "K7", round: 1, object: sort, blocks: ["R1.S3.P9.s2"] }, "fails (not_landed/value_mismatch)"),
    ]
    const open = openList(r, 2, facts)
    assert.deepEqual(open.map(c => [c.object, c.reasons]), [[filter, ["V1.1.1: untouched since R1"]], [sort, ["K7: fails (not_landed/value_mismatch)"]]].sort((a, b) => Number(String(a[0]).slice(1)) - Number(String(b[0]).slice(1))))
    assert.equal(open.find(c => c.object === filter)!.texts.length, 1)
    assert.match(open.find(c => c.object === filter)!.texts[0].text, /filter/u)
    assert.deepEqual(open.find(c => c.object === sort)!.texts, [], "the check goes as a lead; no text here")
  })

  it("patrol: earlier commands with items and none for two rounds, two a round, the longest unvisited first; patrolled counts as visited", () => {
    const r = reg()
    const exec = (round: number, units: string[], patrol: string[] = []) => ({ round, review_items: units.map((u, k) => ({ id: `V${round}.1.${k + 1}`, round, review: `R${round}.1`, item: k + 1, text: "x", units: [u], premise: null })), accept: { lists: { patrol } } }) as unknown as ExecutionRecord
    const history = [exec(1, ["R1.S3.P2.s4", "R1.S3.P9.s2"]), exec(2, ["R1.S3.P9.s2"])]
    assert.deepEqual(patrolList(r, 3, history, []).map(c => c.object), [], "R3: R1's items are one round quiet")
    assert.deepEqual(patrolList(r, 4, history, []).map(c => c.object), [id("filter")], "R4: filter quiet since R1; sort had an item in R2")
    assert.deepEqual(patrolList(r, 4, history, [id("filter")]).map(c => c.object), [], "on the open list: not patrolled")
    const after = [...history, exec(3, [], [id("filter")])]
    assert.deepEqual(patrolList(r, 5, after, []).map(c => c.object), [id("sort")], "filter was patrolled in R3: sort's turn")
  })

  it("a patrolled command's text is capped: past the cap, its heading paths and first paragraph", () => {
    const r = reg()
    const big = [...r.objects.keys()].find(o => currentView(r, o, 6).length > PATROL_TEXT_MAX)!
    assert.ok(big, "some command's text is over the cap")
    const t = patrolText(r, big, 6)
    assert.ok(t.startsWith("- ") && t.length < currentView(r, big, 6).length, t.slice(0, 200))
    const small = [...r.objects.keys()].find(o => { const v = currentView(r, o, 6); return v.trim() && v.length <= PATROL_TEXT_MAX })!
    assert.equal(patrolText(r, small, 6), currentView(r, small, 6), "within the cap: the text in force as it is")
  })

  it("past the soft cap the patrol text goes, then the carried items' paragraphs from the earliest; names and reasons stay", () => {
    const r = reg()
    const facts: OpenFact[] = [
      { id: "V1.1.1", kind: "carried", round: 1, object: null, units: ["R1.S3.P2.s4"], why: "untouched since R1" },
      { id: "V2.1.1", kind: "carried", round: 2, object: null, units: ["R1.S3.P9.s2"], why: "still open" },
    ]
    const full = reviewLists(r, 2, facts, [])
    const tight = reviewLists(r, 2, facts, [], full.chars - 1)
    assert.ok(tight.chars < full.chars)
    assert.deepEqual(tight.open.map(c => c.reasons), full.open.map(c => c.reasons), "reasons always stay")
    assert.match(tight.dropped_text[0], /R1\.S3\.P2/u, "the earliest item's paragraph first")
  })

  it("R6's --audit is a global unit by its flag; coverage counts the subcommands run with it; a unit with no flag is undecided", () => {
    const r = reg()
    const lists = reviewLists(r, 6, [], [])
    const g = lists.global.find(x => x.flag === "--audit")!
    assert.ok(g, JSON.stringify(lists.global))
    assert.equal(globalFlag("All commands print errors to stderr."), null)
    const runs = [{ command: "./dpipe ingest --input a.csv --output b.csv --audit log.json", exit_code: 0 }, { command: "./dpipe profile --input a.csv --output p.json", exit_code: 0 }]
    const one = globalCoverage(r, lists, runs, [], "dpipe")
    assert.deepEqual(one.find(x => x.id === g.id)!.commands, ["ingest"])
    const ran = exercised(r, runs, [], "dpipe")
    assert.ok(ran.has(id("ingest")) && ran.has(id("profile")))
    assert.ok(coverageGaps(lists, ran, one).some(x => x.startsWith(`${g.id}: --audit used on 1 command`)))
    const two = globalCoverage(r, lists, [...runs, { command: "./dpipe transform --input a.csv --recipe r.json --output o.csv --audit log.json", exit_code: 0 }], [], "dpipe")
    assert.ok(!coverageGaps(lists, ran, two).some(x => x.startsWith(g.id)))
    assert.deepEqual(coverageGaps(lists, ran, [{ id: "U6.c9", flag: null, commands: [] }]).filter(x => x.startsWith("U6.c9")), [], "no flag: undecided, no gap")
  })

  it("a transform run exercises the ops of the recipe it read; the appendix holds the lists' sections", () => {
    const r = reg()
    const files = [{ path: "work/recipe.json", content: JSON.stringify([{ op: "filter", column: "v", condition: "gt", threshold: 1 }, { op: "sort", column: "v" }]) }]
    const ran = exercised(r, [{ command: "./dpipe transform --input d.csv --recipe recipe.json --output o.csv", exit_code: 0 }], files, "dpipe")
    for (const n of ["transform", "filter", "sort"]) assert.ok(ran.has(id(n)), n)
    const lists = reviewLists(r, 6, [{ id: "V1.1.1", kind: "carried", round: 1, object: null, units: ["R1.S3.P2.s4"], why: "untouched since R1" }], [])
    const text = reviewAppendix({ round: 6, units: [], guardFailures: [], leads: [], lists })
    assert.match(text, /# Commands with open problems/u)
    assert.match(text, /V1\.1\.1: untouched since R1/u)
    assert.match(text, /# Global changes[\s\S]*\(use --audit\)/u)
  })
})
