import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import { createOpenCodeHttpClient, startRetryEventMonitor } from "./opencode-http-client.mjs"

async function withLocalOpenCodeServer(t, handler) {
  const server = createServer(handler)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => new Promise((resolve) => server.close(() => resolve())))
  const address = server.address()
  return `http://127.0.0.1:${address.port}`
}

test("local OpenCode client uses the session API paths, directory, and JSON body", async (t) => {
  const seen = []
  const baseUrl = await withLocalOpenCodeServer(t, async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined
    seen.push({ method: request.method, url: request.url, body })
    if (request.method === "POST" && request.url.startsWith("/session?")) {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "session-1" }))
      return
    }
    if (request.method === "POST" && request.url.startsWith("/session/session-1/message?")) {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        info: { providerID: "openai", modelID: "gpt-6-luna-fast", tokens: { input: 20, output: 5, reasoning: 2 } },
        parts: [{ type: "text", text: "{}" }],
      }))
      return
    }
    if (request.method === "POST" && request.url.startsWith("/session/session-1/abort?")) {
      response.writeHead(204).end()
      return
    }
    if (request.method === "DELETE" && request.url.startsWith("/session/session-1?")) {
      response.writeHead(204).end()
      return
    }
    response.writeHead(404).end()
  })
  const client = createOpenCodeHttpClient({ baseUrl })
  const directory = "D:\\isolated model dir"
  const created = await client.session.create({ query: { directory }, body: { title: "Intent Compiler" } })
  const prompted = await client.session.prompt({
    path: { id: "session-1" },
    query: { directory },
    body: { model: { providerID: "openai", modelID: "gpt-6-luna-fast" }, variant: "max", agent: "build", system: "test", tools: { "*": false }, format: { type: "json_schema", schema: { $id: "candidate" }, retryCount: 0 }, parts: [{ type: "text", text: "{}" }] },
  })
  const aborted = await client.session.abort("session-1", directory)
  const deleted = await client.session.delete("session-1", directory)
  assert.equal(created.data.id, "session-1")
  assert.equal(prompted.data.info.tokens.reasoning, 2)
  assert.equal(aborted, true)
  assert.equal(deleted, true)
  assert.equal(seen.length, 4)
  assert.equal(new URL(`http://localhost${seen[0].url}`).searchParams.get("directory"), directory)
  assert.equal(seen[1].body.model.modelID, "gpt-6-luna-fast")
  assert.deepEqual(seen[1].body.tools, { "*": false })
  assert.equal(seen[1].body.format.retryCount, 0)
  assert.match(seen[2].url, /\/abort\?/u)
  assert.equal(seen[3].method, "DELETE")
})

test("retry event monitor counts an OpenCode session retry separately", async (t) => {
  let responseStream
  const baseUrl = await withLocalOpenCodeServer(t, (request, response) => {
    if (request.url === "/global/event") {
      response.writeHead(200, { "content-type": "text/event-stream", connection: "keep-alive" })
      response.flushHeaders()
      responseStream = response
      return
    }
    response.writeHead(404).end()
  })
  const client = createOpenCodeHttpClient({ baseUrl })
  const observed = []
  const monitor = startRetryEventMonitor({ client, onRetry: (event) => observed.push(event) })
  await monitor.ready
  responseStream.write(`data: ${JSON.stringify({ directory: "isolated", payload: { type: "session.status", properties: { sessionID: "session-1", status: { type: "retry", attempt: 1 } } } })}\r\n\r\n`)
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(observed, [{ sessionId: "session-1", attempt: 1 }])
  assert.equal(monitor.state.healthy, true)
  await monitor.stop()
  assert.equal(monitor.state.closed, true)
})
