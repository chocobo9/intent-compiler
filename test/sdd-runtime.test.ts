import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connectSddManagement, requireSeparateDirectories } from "../src/runtime/sdd-runtime.js"
import { createSddModel } from "../src/model/sdd-model.js"

test("SDD management refuses recursive IC plugin activation", async () => {
  const server = createServer((_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ plugin: ["ic-plugin"] })) })
  server.listen(0, "127.0.0.1"); await once(server, "listening")
  try {
    const address = server.address() as { port: number }
    const directory = mkdtempSync(join(tmpdir(), "sdd-model-"))
    await assert.rejects(() => connectSddManagement(directory, "test", { server_url: `http://127.0.0.1:${address.port}`, directory,
      provider_id: "openai", model_id: "test", variant: "high", request_timeout_ms: 1000 }), /inherits plugins/)
    assert.throws(() => requireSeparateDirectories(directory, join(directory, "executor")), /isolated siblings/)
  } finally { server.close(); await once(server, "close") }
})
test("CI generation uses its new strict schema, fresh session, no business tools or extra conversion", async () => {
  let sessions = 0, calls = 0
  const model = createSddModel({ directory: mkdtempSync(join(tmpdir(), "sdd-model-")), providerId: "openai", modelId: "test", variant: "high", client: { session: {
    create: async () => ({ id: `session-${++sessions}` }),
    prompt: async r => {
      calls++
      assert.equal(r.body.tools["*"], false)
      assert.equal(r.body.format!.retryCount, 0)
      assert.ok(!JSON.stringify(r.body.format!.schema).includes('"atoms"'))
      return { info: { structured: { decision: "hold", reason: "No approved work", tasks: [] } }, parts: [] }
    },
  } } })
  const call = await model.deliver({ request_view: "", ir: {}, ir_change: { previous_ir_digest: "", tasks: [], previous_versions: {} }, sources: { inputs: [], unplaced: [], unprocessed_inputs: [] }, history: { coverage: [], runs: [] }, feedback: { runs: [] }, referenced_objects: [], issues: [], to_write: [], carried: { fields: [], acceptance: [], effective: [] } })
  assert.equal(JSON.parse(call.text).decision, "hold")
  assert.equal(sessions, 1); assert.equal(calls, 1)
})
