import { test } from "node:test"
import assert from "node:assert/strict"
import { requestJson } from "../src/model/opencode-transport.js"

test("a request is written with the original inputs first, its stable fields sorted, and the per-attempt fields last", () => {
  const text = requestJson({ validation_errors: ["e"], source_segments: [{ b: 1, a: 2 }], budget: { requests_used: 2 }, events: [], ir: {} })
  assert.equal(text, '{"source_segments":[{"a":2,"b":1}],"events":[],"ir":{},"budget":{"requests_used":2},"validation_errors":["e"]}')
  const first = requestJson({ sources: "same", issues: [], budget: { requests_used: 1 } })
  const retry = requestJson({ sources: "same", issues: ["rejected"], budget: { requests_used: 2 } })
  assert.equal(first.slice(0, first.indexOf('"budget"')), retry.slice(0, retry.indexOf('"budget"')))
  assert.equal(JSON.stringify(JSON.parse(retry)), retry)
})

test("v8: the check's delivery under check comes after everything a repaired CI leaves unchanged", () => {
  const check = (delivery: string) => requestJson({ delivery: { text: delivery }, ir_update: { groups: [delivery] }, sources: { inputs: ["original"] }, ir: { t: 1 }, rulings: [], issues: [] })
  const a = check("first"), b = check("repaired")
  assert.ok(a.startsWith('{"sources":{"inputs":["original"]}'))
  assert.equal(a.slice(0, a.indexOf('"delivery"')), b.slice(0, b.indexOf('"delivery"')))
  assert.ok(a.indexOf('"delivery"') > a.indexOf('"rulings"'))
})
