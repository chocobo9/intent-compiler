import { test } from "node:test"
import assert from "node:assert/strict"
import { narrowEnums, requestIds, STRICT_ENUM_LIMIT } from "../src/model/opencode-transport.js"

test("ids an answer may name are the ones its request lists; a shared string node is never mutated", () => {
  const text = { type: "string" }
  const schema = { type: "object", properties: { reason: text, item_id: text, items: { type: "array", items: text }, ref: { type: "object", properties: { source_id: text, segment_id: { anyOf: [{ type: "null" }, text] } } } } }
  const ids = requestIds({ ir: { t1: { task_id: "t1", content: [{ item_id: "r-a" }, { item_id: "r-b" }] } }, sources: { inputs: [{ event_id: "r1-user-input", segments: [{ segment_id: "s1" }, { from: "s2", to: "s4" }] }] } })
  assert.deepEqual(ids, { source_id: ["r1-user-input"], segment_id: ["s1", "s2", "s3", "s4"], item_id: ["r-a", "r-b"], task_id: ["t1"] })
  const out = narrowEnums(schema, ids) as any
  assert.deepEqual(out.properties.item_id.enum, ["r-a", "r-b"])
  assert.deepEqual(out.properties.items.items.enum, ["r-a", "r-b"])
  assert.deepEqual(out.properties.ref.properties.source_id.enum, ["r1-user-input"])
  assert.deepEqual(out.properties.ref.properties.segment_id.anyOf[1].enum, ["s1", "s2", "s3", "s4"])
  assert.equal(out.properties.reason.enum, undefined, "another field sharing the node keeps a free string")
  assert.equal((text as any).enum, undefined)
  const many = { segment_id: Array.from({ length: STRICT_ENUM_LIMIT + 1 }, (_, i) => `s${i}`) }
  assert.equal((narrowEnums(schema, many) as any).properties.ref.properties.segment_id.anyOf[1].enum, undefined, "past the ceiling nothing is narrowed")
})
