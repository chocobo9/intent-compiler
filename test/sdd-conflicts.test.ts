import { test } from "node:test"
import assert from "node:assert/strict"
import { carryConflicts, conflictSection, fieldSection, settleConflicts, settleRequired } from "../src/core/sdd-compiler.js"
import { writtenIn } from "../src/core/sdd-quotes.js"
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

test("a required yes or no stands only on the requirements' own words; written or carried, otherwise it is not stated", () => {
  const delivered = 'Reads a pipeline config (JSON): {"seed": 12345, "steps": [...]}\n- `--config` is **required**.'
  const fields = [{ object: "pipeline configuration", items: ["c-pipeline"], revisions: { "c-pipeline": 2 }, carried: true, fields: [
    { field: "seed", type: "uint64", required: "yes", meaning: "carried from an earlier round, no words" },
    { field: "--config", type: "path", required: "yes", required_wording: "`--config` is required.", meaning: "config path" },
    { field: "steps", type: "array", required: "no", required_wording: "steps may be omitted", meaning: "words not written" },
    { field: "name", type: "string", required: "not stated", meaning: "m" }] }]
  const out = settleRequired(fields, delivered)
  assert.deepEqual(out.fields[0]!.fields.map(f => f.required), ["not stated", "yes", "not stated", "not stated"])
  assert.deepEqual(out.unsupported, [{ object: "pipeline configuration", field: "seed", was: "yes" }, { object: "pipeline configuration", field: "steps", was: "no" }])
  assert.equal(out.fields[0]!.carried, true)
  const text = fieldSection(out.fields)
  assert.ok(text.includes('| `--config` | path | yes ("`--config` is required.") |'))
  assert.ok(text.includes("| `seed` | uint64 | not stated in the original (a sample value is not a constraint) |"))
})

test("copied words match with markdown emphasis and code marks dropped, never when absent", () => {
  assert.ok(writtenIn("now uses **sample standard deviation** (Bessel's correction)", "now uses sample standard deviation"))
  assert.ok(writtenIn('The `fill` transform with `"strategy": "linear"` now handles', 'The fill transform with "strategy": "linear" now handles'))
  assert.ok(!writtenIn("two additional percentile fields", "replaced"))
  assert.ok(!writtenIn("anything", "  "))
})

test("a ruling is carried while its items are unchanged and its passages stand; revised, cut or ruled again it is dropped", () => {
  const ruling = { ...settleConflicts([entry], index, () => false, now, ["c-lineage"], [])[0]!, revisions: { "c-lineage": 1 }, carried: false }
  const dropped: DeliveryContract["dropped"] = []
  const none = () => false
  assert.deepEqual(carryConflicts([ruling], [], now, new Set(), none, dropped).map(c => [c.subject, c.carried]), [["ingest step input field", true]])
  assert.deepEqual(carryConflicts([ruling], [], new Map([["c-lineage", 2]]), new Set(), none, dropped), [])
  assert.deepEqual(carryConflicts([ruling], [], now, new Set(["c-lineage"]), none, dropped), [])
  assert.deepEqual(carryConflicts([ruling], [], now, new Set(), q => q.source_id === "r1", dropped), [])
  assert.deepEqual(carryConflicts([ruling], [{ ...ruling, subject: "again" }], now, new Set(), none, dropped), [])
  assert.deepEqual(dropped.map(d => d.reason), ["an item it rules on was revised, withdrawn or is not delivered now", "an item it rules on was revised, withdrawn or is not delivered now",
    "a passage it quotes is cut from this delivery", "replaced by a ruling written this round on the same items"])
})
