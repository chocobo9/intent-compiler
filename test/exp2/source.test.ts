import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { annotate, splitRound, tilingProblems, type Level, type RoundSource, type SourceBlock } from "../../src/exp2/source.js"
import { ROUNDS, roundText } from "./inputs.js"

const LEVELS: Level[] = ["section", "paragraph", "sentence", "clause"]

/** One layer joined back: each block of that level (or a coarser leaf), with section headings in between. */
function layer(source: RoundSource, level: Level): string {
  const byId = new Map(source.blocks.map(b => [b.id, b]))
  const emit = (b: SourceBlock): string => {
    if (b.level === level || !b.children.length) return b.text
    const first = byId.get(b.children[0])!
    return source.text.slice(b.start, first.start) + b.children.map(c => emit(byId.get(c)!)).join("")
  }
  return source.blocks.filter(b => b.parent === null).map(emit).join("")
}

const fences = (text: string) => text.split("\n").filter(l => /^\s*(```|~~~)/u.test(l)).length

describe("exp2 source: three layers over the real dpipe rounds", () => {
  for (const round of ROUNDS) {
    const source = splitRound(round, roundText(round))

    it(`R${round}: every layer joins back to the original byte for byte, with no empty block`, () => {
      assert.deepEqual(tilingProblems(source), [])
      for (const level of LEVELS) assert.equal(layer(source, level), source.text, `R${round} ${level} layer`)
      for (const b of source.blocks) assert.notEqual(b.text.trim(), "", `${b.id} is empty`)
    })

    it(`R${round}: code blocks, JSON samples, tables and list items are never cut`, () => {
      for (const b of source.blocks) assert.equal(fences(b.text) % 2, 0, `${b.id} cuts a code block`)
      for (const b of source.blocks.filter(x => x.level === "sentence" && x.kind !== "sentence")) {
        assert.deepEqual(b.children, [], `${b.id} (${b.kind}) is cut further`)
      }
      for (const item of source.blocks.filter(b => b.kind === "item")) assert.match(item.text, /^\s*(?:[-*+]|\d+[.)]|[a-z][.)])\s/u)
      // Paragraphs end only at blank lines outside code: the paragraph's own content has no blank line in it.
      for (const p of source.blocks.filter(b => b.level === "paragraph")) {
        const lines = p.text.trimEnd().split("\n")
        let inCode = false
        for (const line of lines) {
          if (/^\s*(```|~~~)/u.test(line)) inCode = !inCode
          else if (!inCode) assert.notEqual(line.trim(), "", `${p.id} holds a blank line outside code`)
        }
      }
    })
  }

  it("ids are positional, readable, unique and identical on every split of the same text", () => {
    for (const round of ROUNDS) {
      const a = splitRound(round, roundText(round)), b = splitRound(round, roundText(round))
      assert.deepEqual(a, b)
      assert.equal(new Set(a.blocks.map(x => x.id)).size, a.blocks.length)
      for (const x of a.blocks) assert.match(x.id, new RegExp(`^R${round}\\.S\\d+(\\.P\\d+(\\.s\\d+(\\.c\\d+)?)?)?$`, "u"))
      for (const x of a.blocks) assert.match(x.hash, /^[0-9a-f]{8}$/u)
    }
  })

  it("R1 transform: the operation list is reachable paragraph by paragraph and item by item", () => {
    const r1 = splitRound(1, roundText(1))
    const text = (id: string) => r1.blocks.find(b => b.id === id)!.text
    assert.match(r1.blocks.find(b => b.id === "R1.S3")!.heading!, /^### Transformation/u)
    assert.match(text("R1.S3.P2.s4"), /^\s*- `filter`/u)
    assert.match(text("R1.S3.P9.s3"), /^\s*- `rename`/u)
    assert.match(text("R1.S3.P12"), /^\s*- `join`/u)
    assert.match(text("R1.S3.P22"), /^\s*- `fill`/u)
    // The recipe example stays one unit with the item that introduces it.
    assert.match(text("R1.S3.P2.s2"), /Applies transformations[\s\S]*"op": "fill"[\s\S]*```/u)
    assert.ok(r1.blocks.filter(b => b.parent === "R1.S3" && b.level === "paragraph").length >= 20)
  })

  it("a prose sentence is cut into clauses at commas, semicolons and parentheses, not inside inline code", () => {
    const r1 = splitRound(1, roundText(1))
    const clauses = r1.blocks.filter(b => b.parent === "R1.S2.P4.s2").map(b => b.text)
    assert.ok(clauses.length >= 2)
    assert.equal(clauses.join(""), r1.blocks.find(b => b.id === "R1.S2.P4.s2")!.text)
    for (const c of r1.blocks.filter(b => b.level === "clause")) assert.equal((c.text.match(/`/gu) ?? []).length % 2, 0, `${c.id} cuts inline code`)
  })

  it("the annotated text for the model is the original plus id markers only", () => {
    for (const round of ROUNDS) {
      const source = splitRound(round, roundText(round))
      const annotated = annotate(source)
      const stripped = annotated
        .replace(/⟦R\d+\.S\d+#[0-9a-f]{8}⟧ /gu, "")
        .replace(/⟦R\d+\.S\d+\.P\d+#[0-9a-f]{8}⟧\n/gu, "")
        .replace(/‹s\d+(?:\.c\d+)?›/gu, "")
      assert.equal(stripped, source.text)
      for (const b of source.blocks.filter(x => x.level === "paragraph")) assert.ok(annotated.includes(`⟦${b.id}#${b.hash}⟧`))
    }
  })
})
