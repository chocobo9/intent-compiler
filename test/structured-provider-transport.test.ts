import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createStructuredProviderTransport,
  StructuredProviderTransportError,
} from "../src/model/structured-provider-transport.js"
import { V2_CHECK_CONTRACT, V2_COMPILER_CONTRACT } from "../src/model/compiler-model-v2.js"

test("structured transport sends the candidate schema and parses usage", async () => {
  let captured: RequestInit | undefined
  const transport = createStructuredProviderTransport({
    endpoint: "https://api.example.invalid/v1/chat/completions",
    providerId: "deepseek",
    modelId: "deepseek-flash",
    apiKey: "test-key",
    fetch: async (input, init) => {
      captured = init
      return new Response(JSON.stringify({
        choices: [{ message: { content: "{}" } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          completion_tokens_details: { reasoning_tokens: 5 },
          prompt_tokens_details: { cached_tokens: 10 },
        },
      }), { status: 200 })
    },
  })
  const result = await transport({
    run_id: "run-1",
    events: [],
    ir: {},
    compiled: {},
    atom_refs: {},
    executions: [],
    budget: { requests_used: 0, max_requests: 3 },
    contract: V2_COMPILER_CONTRACT,
  })
  assert.equal(result.text, "{}")
  assert.equal(result.usage?.input_tokens, 100)
  assert.equal(result.usage?.reasoning_tokens, 5)
  const body = JSON.parse(String(captured?.body))
  assert.equal(body.response_format.type, "json_schema")
  assert.equal(body.response_format.json_schema.name, "candidate_v2")
  assert.equal(body.response_format.json_schema.schema.$id, "https://intent-compiler.local/schema/candidate-v2.json")
})

test("provider requests carry path grounding rules for both generation and checking", async () => {
  const requests: Array<{ messages: Array<{ role: string; content: string }> }> = []
  const transport = createStructuredProviderTransport({
    endpoint: "https://api.example.invalid/v1/chat/completions",
    modelId: "test-model",
    apiKey: "test-key",
    fetch: async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 })
    },
  })
  const base = {
    run_id: "run-1",
    events: [],
    ir: {},
    compiled: {},
    atom_refs: {},
    executions: [],
    budget: { requests_used: 0, max_requests: 3 },
  }
  await transport({ ...base, contract: V2_COMPILER_CONTRACT })
  await transport({ ...base, contract: V2_CHECK_CONTRACT } as unknown as Parameters<typeof transport>[0])

  const proposal = JSON.parse(requests[0]!.messages[1]!.content)
  const check = JSON.parse(requests[1]!.messages[1]!.content)
  const system = requests[0]!.messages[0]!.content
  const groundingRule = /source reference proves where a claim came from, not that the cited user text supports the path/i
  assert.match(system, groundingRule)
  assert.match(JSON.stringify(proposal.contract), groundingRule)
  assert.match(JSON.stringify(check.contract), groundingRule)
  assert.match(JSON.stringify(proposal.contract), /within the already authorized workspace and operations/i)
  assert.match(JSON.stringify(proposal.contract), /preserve a path as a user restriction only when/i)
  assert.match(JSON.stringify(check.contract), /preserve still-applicable user path restrictions and host-provided access boundaries/i)
  assert.match(JSON.stringify(check.contract), /does not prove that only that file may be modified/i)
})

test("structured transport reports unsupported response_format distinctly", async () => {
  const transport = createStructuredProviderTransport({
    endpoint: "https://api.example.invalid/v1/chat/completions",
    modelId: "deepseek-flash",
    apiKey: "test-key",
    fetch: async () => new Response(JSON.stringify({
      error: { message: "This response_format type is unavailable now" },
    }), { status: 400 }),
  })
  await assert.rejects(
    () => transport({
      run_id: "run-1",
      events: [],
      ir: {},
      compiled: {},
    atom_refs: {},
      executions: [],
      budget: { requests_used: 0, max_requests: 3 },
      contract: V2_COMPILER_CONTRACT,
    }),
    (error: unknown) => error instanceof StructuredProviderTransportError && error.code === "STRUCTURED_UNSUPPORTED",
  )
})

test("streamed transport assembles deltas, reasoning, and usage", async () => {
  let captured: RequestInit | undefined
  const body = [
    'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}',
    "",
    'data: {"choices":[{"delta":{"content":"{\\"schema_version\\""}}]}',
    "",
    'data: {"choices":[{"delta":{"content":":2}"}}]}',
    "",
    'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":22,"completion_tokens_details":{"reasoning_tokens":7},"prompt_tokens_details":{"cached_tokens":3}}}',
    "",
    "data: [DONE]",
    "",
  ].join("\n")
  const transport = createStructuredProviderTransport({
    endpoint: "https://api.example.invalid/v1/chat/completions",
    providerId: "dashscope",
    modelId: "qwen3.8-flash",
    apiKey: "test-key",
    stream: true,
    fetch: async (_input, init) => {
      captured = init
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    },
  })
  const result = await transport({
    run_id: "run-1",
    events: [],
    ir: {},
    compiled: {},
    atom_refs: {},
    executions: [],
    budget: { requests_used: 0, max_requests: 3 },
    contract: V2_COMPILER_CONTRACT,
  })
  const request = JSON.parse(String(captured?.body))
  assert.equal(request.stream, true)
  assert.deepEqual(request.stream_options, { include_usage: true })
  assert.equal((captured?.headers as Record<string, string> | undefined)?.Accept, "text/event-stream")
  assert.equal(result.text, '{"schema_version":2}')
  assert.equal(result.text_source, "text")
  assert.equal(result.usage?.input_tokens, 11)
  assert.equal(result.usage?.output_tokens, 22)
  assert.equal(result.usage?.reasoning_tokens, 7)
  assert.equal(result.usage?.cache_read_tokens, 3)
})

test("streamed transport falls back to reasoning text and rejects an empty stream", async () => {
  const streaming = createStructuredProviderTransport({
    endpoint: "https://api.example.invalid/v1/chat/completions",
    modelId: "qwen3.8-flash",
    apiKey: "test-key",
    stream: true,
    fetch: async () => new Response('data: {"choices":[{"delta":{"reasoning_content":"{\\"a\\":1}"}}]}\n\ndata: [DONE]\n\n', { status: 200 }),
  })
  const request = {
    run_id: "run-1",
    events: [],
    ir: {},
    compiled: {},
    atom_refs: {},
    executions: [],
    budget: { requests_used: 0, max_requests: 3 },
    contract: V2_COMPILER_CONTRACT,
  }
  const result = await streaming(request)
  assert.equal(result.text, '{"a":1}')
  assert.equal(result.text_source, "reasoning")

  const empty = createStructuredProviderTransport({
    endpoint: "https://api.example.invalid/v1/chat/completions",
    modelId: "qwen3.8-flash",
    apiKey: "test-key",
    stream: true,
    fetch: async () => new Response("data: [DONE]\n\n", { status: 200 }),
  })
  await assert.rejects(
    () => empty(request),
    (error: unknown) => error instanceof StructuredProviderTransportError
      && error.code === "EMPTY_RESPONSE"
      && error.diagnostic.phase === "empty_response"
      && error.diagnostic.response_received === true
      && error.diagnostic.stream_completed === true,
  )
})

const diagnosticRequest = {
  run_id: "run-1",
  events: [],
  ir: {},
  compiled: {},
  atom_refs: {},
  executions: [],
  budget: { requests_used: 0, max_requests: 3 },
  contract: V2_COMPILER_CONTRACT,
}

test("structured transport records connection failure phase and nested exceptions", async () => {
  const transport = createStructuredProviderTransport({
    endpoint: "https://api.example.invalid/v1/chat/completions",
    modelId: "qwen3.8-flash",
    apiKey: "test-key",
    fetch: async () => { throw new TypeError("fetch failed", { cause: new Error("connect ECONNRESET") }) },
  })
  await assert.rejects(() => transport(diagnosticRequest), (error: unknown) => {
    assert.ok(error instanceof StructuredProviderTransportError)
    assert.equal(error.code, "FETCH_FAILED")
    assert.equal(error.diagnostic.phase, "request")
    assert.equal(error.diagnostic.response_received, false)
    assert.deepEqual(error.diagnostic.exception_chain?.map(item => item.message), ["fetch failed", "connect ECONNRESET"])
    return true
  })
})

test("structured transport distinguishes a response stream that breaks after headers", async () => {
  let emitted = false
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!emitted) {
        emitted = true
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
      } else controller.error(new Error("socket closed mid-stream"))
    },
  }, { highWaterMark: 0 })
  const transport = createStructuredProviderTransport({
    endpoint: "https://api.example.invalid/v1/chat/completions",
    modelId: "qwen3.8-flash",
    apiKey: "test-key",
    stream: true,
    fetch: async () => new Response(body, { status: 200 }),
  })
  await assert.rejects(() => transport(diagnosticRequest), (error: unknown) => {
    assert.ok(error instanceof StructuredProviderTransportError)
    assert.equal(error.code, "STREAM_FAILED")
    assert.equal(error.diagnostic.phase, "response_stream")
    assert.equal(error.diagnostic.response_received, true)
    assert.equal(error.diagnostic.stream_started, true)
    assert.equal(error.diagnostic.stream_completed, false)
    assert.deepEqual(error.diagnostic.exception_chain?.map(item => item.message), ["socket closed mid-stream"])
    return true
  })
})

test("structured transport records stream completion and malformed response payloads", async () => {
  const completionMarkerMissing = createStructuredProviderTransport({
    endpoint: "https://api.example.invalid/v1/chat/completions",
    modelId: "qwen3.8-flash",
    apiKey: "test-key",
    stream: true,
    fetch: async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', { status: 200 }),
  })
  const completedAtEof = await completionMarkerMissing(diagnosticRequest)
  assert.equal((completedAtEof.raw as { stream_completed: boolean }).stream_completed, true)
  assert.equal((completedAtEof.raw as { completion_marker_seen: boolean }).completion_marker_seen, false)

  const malformedStream = createStructuredProviderTransport({
    endpoint: "https://api.example.invalid/v1/chat/completions",
    modelId: "qwen3.8-flash",
    apiKey: "test-key",
    stream: true,
    fetch: async () => new Response("data: not-json\n\ndata: [DONE]\n\n", { status: 200 }),
  })
  await assert.rejects(() => malformedStream(diagnosticRequest), (error: unknown) => {
    assert.ok(error instanceof StructuredProviderTransportError)
    assert.equal(error.code, "STREAM_PARSE_FAILED")
    assert.equal(error.diagnostic.phase, "stream_json_parse")
    assert.equal(error.diagnostic.response_received, true)
    return true
  })

  const malformedBody = createStructuredProviderTransport({
    endpoint: "https://api.example.invalid/v1/chat/completions",
    modelId: "qwen3.8-flash",
    apiKey: "test-key",
    fetch: async () => new Response("not-json", { status: 200 }),
  })
  await assert.rejects(() => malformedBody(diagnosticRequest), (error: unknown) => {
    assert.ok(error instanceof StructuredProviderTransportError)
    assert.equal(error.code, "RESPONSE_PARSE_FAILED")
    assert.equal(error.diagnostic.phase, "response_json_parse")
    assert.equal(error.diagnostic.response_received, true)
    return true
  })
})

test("stream diagnostics distinguish no payload from received content", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("closed before first payload"))
    },
  })
  const transport = createStructuredProviderTransport({
    endpoint: "https://api.example.invalid/v1/chat/completions",
    modelId: "qwen3.8-flash",
    apiKey: "test-key",
    stream: true,
    fetch: async () => new Response(body, { status: 200 }),
  })
  await assert.rejects(() => transport(diagnosticRequest), (error: unknown) => {
    assert.ok(error instanceof StructuredProviderTransportError)
    const diagnostic = error.diagnostic as typeof error.diagnostic & Record<string, unknown>
    assert.equal(diagnostic.stream_started, false)
    assert.equal(diagnostic.stream_first_data_ms, undefined)
    assert.equal(diagnostic.stream_last_progress_ms, undefined)
    assert.equal(diagnostic.stream_content_chars, 0)
    assert.equal(diagnostic.stream_reasoning_chars, 0)
    assert.equal(diagnostic.completion_marker_seen, false)
    return true
  })
})

test("stream diagnostics count text without retaining stream bodies on failure", async () => {
  let step = 0
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (step === 0) {
        step += 1
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"visible-text"}}]}\n\n'))
      } else if (step === 1) {
        step += 1
        await new Promise(resolve => setTimeout(resolve, 10))
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"private-reasoning"}}]}\n\n'))
      } else controller.error(new Error("socket closed during output"))
    },
  }, { highWaterMark: 0 })
  const transport = createStructuredProviderTransport({
    endpoint: "https://api.example.invalid/v1/chat/completions",
    modelId: "qwen3.8-flash",
    apiKey: "test-key",
    stream: true,
    fetch: async () => new Response(body, { status: 200 }),
  })
  await assert.rejects(() => transport(diagnosticRequest), (error: unknown) => {
    assert.ok(error instanceof StructuredProviderTransportError)
    const diagnostic = error.diagnostic as typeof error.diagnostic & Record<string, unknown>
    assert.equal(diagnostic.stream_started, true)
    assert.equal(typeof diagnostic.stream_first_data_ms, "number")
    assert.equal(typeof diagnostic.stream_last_progress_ms, "number")
    assert.ok(Number(diagnostic.stream_last_progress_ms) > Number(diagnostic.stream_first_data_ms))
    assert.equal(diagnostic.stream_content_chars, "visible-text".length)
    assert.equal(diagnostic.stream_reasoning_chars, "private-reasoning".length)
    assert.equal(diagnostic.completion_marker_seen, false)
    assert.equal(JSON.stringify(diagnostic).includes("private-reasoning"), false)
    return true
  })
})

test("a completion marker ends the stream even while the connection stays open", async () => {
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined
  let readsAfterMarker = 0
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
    },
    pull(controller) {
      if (readsAfterMarker === 0) {
        readsAfterMarker += 1
        controller.enqueue(new TextEncoder().encode([
          'data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"}}]}',
          "",
          "data: [DONE]",
          "",
          "",
        ].join("\n")))
      } else {
        readsAfterMarker += 1
      }
    },
  }, { highWaterMark: 0 })
  const transport = createStructuredProviderTransport({
    endpoint: "https://api.example.invalid/v1/chat/completions",
    modelId: "qwen3.8-flash",
    apiKey: "test-key",
    stream: true,
    fetch: async () => new Response(body, { status: 200 }),
  })
  const resultPromise = transport(diagnosticRequest)
  const outcome = await Promise.race([
    resultPromise.then(value => ({ kind: "completed" as const, value })),
    new Promise<{ kind: "pending" }>(resolve => setTimeout(() => resolve({ kind: "pending" }), 50)),
  ])
  if (outcome.kind === "pending") {
    try { controllerRef?.close() } catch { /* release the still-pending test stream */ }
  }
  const result = outcome.kind === "completed" ? outcome.value : await resultPromise
  assert.equal(outcome.kind, "completed", "transport must honor [DONE] without waiting for EOF")
  assert.equal(result.text, '{"ok":true}')
  assert.equal((result.raw as Record<string, unknown>).completion_marker_seen, true)
  assert.equal((result.raw as Record<string, unknown>).stream_eof_observed, false)
  assert.equal(readsAfterMarker, 1)
})
