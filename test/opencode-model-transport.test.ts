import assert from "node:assert/strict"
import { resolve } from "node:path"
import test from "node:test"
import type { CompilerModelRequest } from "../src/model/compiler-model.js"
import {
  createOpenCodeModelTransport,
  OpenCodeModelTransportError,
  type OpenCodeModelClient,
} from "../src/model/opencode-transport.js"

const DIRECTORY = resolve("intent-compiler-executor-copy")

function modelRequest(currentState: unknown = { b: 2, a: 1 }): CompilerModelRequest {
  return {
    schema_version: "0.1",
    base_state_version: 3,
    current_state: currentState,
    input_identity: "input-1",
    input_digest: "input-digest",
    input_text: "Revise the parser.",
    input_source: { kind: "user_input", start: 0, end: 18 },
    admitted_evidence: [{ z: 1, a: "evidence" }],
    allowed_operations: ["no_change"],
    operation_contract: { operation_field: "operation" },
    response_contract: { format: "one JSON proposal envelope" },
    tools: [],
    tool_choice: "none",
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

type ResponseWrapper = "top" | "data" | "nested-data"

function wrapResponse(value: Record<string, unknown>, wrapper: ResponseWrapper): unknown {
  if (wrapper === "top") return value
  if (wrapper === "data") return { data: value }
  return { data: { data: value } }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item))
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortValue((value as Record<string, unknown>)[key])]),
  )
}

function clientFor(
  createResponse: unknown = { id: "session-1" },
  promptResponse: unknown = { parts: [{ type: "text", text: "raw proposal" }] },
): { client: OpenCodeModelClient; creates: unknown[]; prompts: unknown[] } {
  const creates: unknown[] = []
  const prompts: unknown[] = []
  return {
    client: {
      session: {
        create: async (request) => {
          creates.push(request)
          return createResponse
        },
        prompt: async (request) => {
          prompts.push(request)
          return promptResponse
        },
      },
    },
    creates,
    prompts,
  }
}

async function expectTransportError(action: Promise<unknown> | unknown, code: OpenCodeModelTransportErrorCode): Promise<void> {
  await assert.rejects(Promise.resolve(action), (error: unknown) => error instanceof OpenCodeModelTransportError && error.code === code)
}

type OpenCodeModelTransportErrorCode = ConstructorParameters<typeof OpenCodeModelTransportError>[0]

test("creates an independent session and sends the fixed isolated prompt", async () => {
  const creates: unknown[] = []
  const prompts: unknown[] = []
  let nextSession = 0
  const client: OpenCodeModelClient = {
    session: {
      create: async (request) => {
        creates.push(request)
        nextSession += 1
        return { id: `session-${nextSession}` }
      },
      prompt: async (request) => {
        prompts.push(request)
        return { parts: [{ type: "text", text: `raw-${prompts.length}` }] }
      },
    },
  }
  const transport = createOpenCodeModelTransport({
    client,
    directory: DIRECTORY,
    providerId: "provider-test",
    modelId: "model-test",
    agent: "compiler-agent",
  })

  const firstRequest = modelRequest({ b: 2, a: 1 })
  const secondRequest = modelRequest({ a: 1, b: 2 })
  assert.equal(await transport(firstRequest), "raw-1")
  assert.equal(await transport(secondRequest), "raw-2")

  assert.deepEqual(creates, [
    { query: { directory: DIRECTORY }, body: { title: "Intent Compiler" } },
    { query: { directory: DIRECTORY }, body: { title: "Intent Compiler" } },
  ])
  assert.equal(prompts.length, 2)
  const firstPrompt = prompts[0] as {
    path: { id: string }
    query: { directory: string }
    body: {
      model: { providerID: string; modelID: string }
      agent: string
      system: string
      tools: { "*": boolean }
      parts: Array<{ type: string; text: string }>
    }
  }
  const secondPrompt = prompts[1] as typeof firstPrompt
  assert.equal(firstPrompt.path.id, "session-1")
  assert.equal(secondPrompt.path.id, "session-2")
  assert.deepEqual(firstPrompt.query, { directory: DIRECTORY })
  assert.deepEqual(firstPrompt.body.model, { providerID: "provider-test", modelID: "model-test" })
  assert.equal(firstPrompt.body.agent, "compiler-agent")
  assert.match(firstPrompt.body.system, /read-only model adapter/u)
  assert.equal(firstPrompt.body.system, secondPrompt.body.system)
  assert.deepEqual(firstPrompt.body.tools, { "*": false })
  assert.deepEqual(firstPrompt.body.parts, [{ type: "text", text: stableJson(firstRequest) }])
  assert.deepEqual(secondPrompt.body.parts, [{ type: "text", text: stableJson(secondRequest) }])
  assert.equal(firstPrompt.body.parts[0]?.text, secondPrompt.body.parts[0]?.text)
})

test("reports the created Compiler model session before prompting it", async () => {
  const order: string[] = []
  const client: OpenCodeModelClient = {
    session: {
      create: async () => ({ id: "compiler-model-session" }),
      prompt: async () => {
        order.push("prompt")
        return { parts: [{ type: "text", text: "proposal" }] }
      },
    },
  }
  const transport = createOpenCodeModelTransport({
    client,
    directory: DIRECTORY,
    providerId: "p",
    modelId: "m",
    onSessionCreated: (sessionId) => order.push(`created:${sessionId}`),
  })

  await transport(modelRequest())

  assert.deepEqual(order, ["created:compiler-model-session", "prompt"])
})

test("returns only the raw text assembled from non-tool text parts", async () => {
  const harness = clientFor(undefined, {
    parts: [
      { type: "text", text: "  raw first" },
      { type: "reasoning", text: "ignored by the transport" },
      { type: "text", text: "raw second  " },
    ],
  })
  const transport = createOpenCodeModelTransport({ client: harness.client, directory: DIRECTORY, providerId: "p", modelId: "m" })
  assert.equal(await transport(modelRequest()), "  raw first\nraw second  ")
})

test("unwraps the supported top-level, data, and data.data SDK response shapes", async () => {
  for (const wrapper of ["top", "data", "nested-data"] as const) {
    const harness = clientFor(
      wrapResponse({ id: `session-${wrapper}` }, wrapper),
      wrapResponse({ parts: [{ type: "text", text: `proposal-${wrapper}` }] }, wrapper),
    )
    const transport = createOpenCodeModelTransport({ client: harness.client, directory: DIRECTORY, providerId: "p", modelId: "m" })
    assert.equal(await transport(modelRequest()), `proposal-${wrapper}`)
    const prompt = harness.prompts[0] as { path: { id: string } }
    assert.equal(prompt.path.id, `session-${wrapper}`)
  }
})

test("rejects invalid directory and missing SDK methods at construction", () => {
  assert.throws(
    () => createOpenCodeModelTransport({ client: {}, directory: ".\\relative", providerId: "p", modelId: "m" }),
    (error: unknown) => error instanceof OpenCodeModelTransportError && error.code === "INVALID_CLIENT",
  )
  assert.throws(
    () => createOpenCodeModelTransport({ client: { session: {} }, directory: DIRECTORY, providerId: "p", modelId: "m" }),
    (error: unknown) => error instanceof OpenCodeModelTransportError && error.code === "INVALID_CLIENT",
  )
  assert.throws(
    () => createOpenCodeModelTransport({ client: clientFor().client, directory: ".\\relative", providerId: "p", modelId: "m" }),
    (error: unknown) => error instanceof OpenCodeModelTransportError && error.code === "DIRECTORY_NOT_ABSOLUTE",
  )
})

test("rejects tool parts, empty text, and malformed SDK responses", async () => {
  const toolHarness = clientFor(undefined, { parts: [{ type: "tool", callID: "call-1" }, { type: "text", text: "proposal" }] })
  const toolTransport = createOpenCodeModelTransport({ client: toolHarness.client, directory: DIRECTORY, providerId: "p", modelId: "m" })
  await expectTransportError(toolTransport(modelRequest()), "TOOL_PART_RETURNED")

  const emptyHarness = clientFor(undefined, { parts: [{ type: "text", text: "   " }] })
  const emptyTransport = createOpenCodeModelTransport({ client: emptyHarness.client, directory: DIRECTORY, providerId: "p", modelId: "m" })
  await expectTransportError(emptyTransport(modelRequest()), "EMPTY_TEXT_RESPONSE")

  const missingSessionHarness = clientFor({ data: {} })
  const missingSessionTransport = createOpenCodeModelTransport({ client: missingSessionHarness.client, directory: DIRECTORY, providerId: "p", modelId: "m" })
  await expectTransportError(missingSessionTransport(modelRequest()), "SESSION_CREATE_SHAPE")

  const malformedPromptHarness = clientFor(undefined, { data: [] })
  const malformedPromptTransport = createOpenCodeModelTransport({ client: malformedPromptHarness.client, directory: DIRECTORY, providerId: "p", modelId: "m" })
  await expectTransportError(malformedPromptTransport(modelRequest()), "SESSION_PROMPT_SHAPE")

  const tooDeepHarness = clientFor({ data: { data: { data: { id: "session-1" } } } })
  const tooDeepTransport = createOpenCodeModelTransport({ client: tooDeepHarness.client, directory: DIRECTORY, providerId: "p", modelId: "m" })
  await expectTransportError(tooDeepTransport(modelRequest()), "SESSION_CREATE_SHAPE")
})

test("rejects explicit SDK error responses at every supported wrapper level", async () => {
  for (const wrapper of ["top", "data", "nested-data"] as const) {
    const createHarness = clientFor(wrapResponse({ error: { message: `create-${wrapper}` } }, wrapper))
    const createTransport = createOpenCodeModelTransport({ client: createHarness.client, directory: DIRECTORY, providerId: "p", modelId: "m" })
    await expectTransportError(createTransport(modelRequest()), "SDK_ERROR_RESPONSE")

    const promptHarness = clientFor(
      wrapResponse({ id: `session-${wrapper}` }, wrapper),
      wrapResponse({ error: { message: `prompt-${wrapper}` } }, wrapper),
    )
    const promptTransport = createOpenCodeModelTransport({ client: promptHarness.client, directory: DIRECTORY, providerId: "p", modelId: "m" })
    await expectTransportError(promptTransport(modelRequest()), "SDK_ERROR_RESPONSE")
  }
})
