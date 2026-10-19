import { test } from "node:test"
import assert from "node:assert/strict"
import { requestJson } from "../src/model/opencode-transport.js"

test("a request is written with its stable fields first, sorted, and the per-attempt fields last", () => {
  const text = requestJson({ validation_errors: ["e"], source_segments: [{ b: 1, a: 2 }], budget: { requests_used: 2 }, events: [], ir: {} })
  assert.equal(text, '{"events":[],"ir":{},"source_segments":[{"a":2,"b":1}],"budget":{"requests_used":2},"validation_errors":["e"]}')
  const first = requestJson({ sources: "same", issues: [], budget: { requests_used: 1 } })
  const retry = requestJson({ sources: "same", issues: ["rejected"], budget: { requests_used: 2 } })
  assert.equal(first.slice(0, first.indexOf('"budget"')), retry.slice(0, retry.indexOf('"budget"')))
  assert.equal(JSON.stringify(JSON.parse(retry)), retry)
})
