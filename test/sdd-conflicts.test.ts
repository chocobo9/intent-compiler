import { test } from "node:test"
import assert from "node:assert/strict"
import { conflictSection, fieldSection, settleConflicts } from "../src/core/sdd-compiler.js"
import type { DeliveryContract } from "../src/core/sdd-contract.js"

const at = (source_id: string, segment_id: string, input: number, text: string, start: number) =>
  [`${source_id}|${segment_id}`, { source_id, segment_id, input, text, start, end: start + text.length }] as const
const index = new Map([
  at("r1", "s4", 1, '{"type": "ingest", "input": "raw.csv", "output": "clean.csv"}', 0),
  at("r5", "s9", 5, '- `"ingest"`: input = `file`, output = `output`', 0),
  at("r5", "s10", 5, "- `--config`: path to a pipeline JSON configuration file.", 100),
])
const now = new Map([["c-lineage", 1], ["c-pipeline", 2]])
const entry = { subject: "ingest step input field", items: ["c-lineage"], passages: [{ source_id: "r1", segment_id: "s4" }, { source_id: "r5", segment_id: "s9" }],
  ruling: "lineage reads an ingest step's input from `file`", basis: "update 5 is later and governs the lineage mapping it changes" }

test("a conflict is delivered with both passages verbatim, the ruling and its basis", () => {
  const dropped: DeliveryContract["dropped"] = []
  const settled = settleConflicts([entry], index, () => false, now, ["c-lineage"], dropped)
  assert.equal(settled.length, 1)
  assert.deepEqual(settled[0]!.quotes.map(q => q.input), [1, 5])
  const text = conflictSection(settled)
  assert.match(text, /^# Inconsistencies in the original requirements/u)
  assert.ok(text.includes('(user update 1)\n> {"type": "ingest", "input": "raw.csv", "output": "clean.csv"}'))
  assert.ok(text.includes("(user update 5)\n> - `\"ingest\"`: input = `file`, output = `output`"))
  assert.ok(text.includes("- Ruling: lineage reads") && text.includes("- Basis: update 5 is later"))
  assert.deepEqual(dropped, [])
})

test("a ruling without its basis is rejected", () => {
  assert.throws(() => settleConflicts([{ ...entry, basis: " " }], index, () => false, now, ["c-lineage"], []), /ruling and its basis/u)
})

test("a conflict left with one passage, or on requirements carried unchanged, is recorded and not delivered", () => {
  const dropped: DeliveryContract["dropped"] = []
  const cutR1 = (q: { source_id: string }) => q.source_id === "r1"
  assert.deepEqual(settleConflicts([entry], index, cutR1, now, ["c-lineage"], dropped), [])
  assert.deepEqual(settleConflicts([entry], index, () => false, now, ["c-pipeline"], dropped), [])
  assert.deepEqual(dropped.map(d => [d.kind, d.reason.split(" (")[0]]), [["conflict", "fewer than two passages to quote"], ["conflict", "names no requirement this round writes"]])
  assert.equal(conflictSection([]), "")
})

test("a field whose requirement is not stated says so, and that a sample value is not a constraint", () => {
  const text = fieldSection([{ object: "pipeline configuration", items: ["c-pipeline"], fields: [
    { field: "seed", type: "integer", required: "not stated", meaning: "seed for deterministic steps" },
    { field: "steps", type: "array", required: "yes", meaning: "the steps in order" }] }])
  assert.ok(text.includes("| `seed` | integer | not stated in the original (a sample value is not a constraint) |"))
  assert.ok(text.includes("| `steps` | array | yes |"))
})
