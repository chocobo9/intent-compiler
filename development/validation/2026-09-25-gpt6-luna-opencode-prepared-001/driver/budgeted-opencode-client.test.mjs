import test from "node:test"
import assert from "node:assert/strict"
import { runBudgetedBatch } from "./batch-controller.mjs"
import { createBudgetedOpenCodeClient } from "./budgeted-opencode-client.mjs"

const proposalRequest = {
  path: { id: "proposal-session" },
  query: { directory: "D:\\isolated-model" },
  body: {
    model: { providerID: "openai", modelID: "gpt-6-luna-fast" },
    variant: "max",
    agent: "build",
    system: "You are a read-only management model for an Intent Compiler v2.",
    tools: { "*": false },
    format: { type: "json_schema", schema: { $id: "candidate-schema" }, retryCount: 0 },
    parts: [{ type: "text", text: "proposal request" }],
  },
}

const checkRequest = {
  ...proposalRequest,
  path: { id: "check-session" },
  body: {
    ...proposalRequest.body,
    system: "You are the independent check of one Intent Compiler v2 management candidate.",
    format: { type: "json_schema", schema: { $id: "candidate-check-schema" }, retryCount: 0 },
    parts: [{ type: "text", text: "independent check request" }],
  },
}

test("proposal and independent check stay separate logical prompts and schemas", async () => {
  const result = await runBudgetedBatch({
    deadlineMs: 500,
    maxLogicalRequests: 3,
    run: async (batch) => {
      const prompts = []
      const client = createBudgetedOpenCodeClient({
        batch,
        client: {
          session: {
            create: async () => ({ data: { id: "not-used-by-this-test" } }),
            prompt: async (request) => {
              prompts.push(request)
              return { data: { info: { providerID: "openai", modelID: "gpt-6-luna-fast", tokens: { input: 1, output: 1 } }, parts: [{ type: "text", text: "{}" }] } }
            },
          },
        },
      })
      batch.sessionCreated("proposal-session")
      await client.session.prompt(proposalRequest)
      batch.sessionCreated("check-session")
      await client.session.prompt(checkRequest)
      assert.equal(prompts.length, 2)
    },
  })
  assert.equal(result.logical_request_count, 2)
  assert.deepEqual(result.requests.map((row) => row.kind), ["proposal", "check"])
  assert.deepEqual(result.requests.map((row) => row.model), ["openai/gpt-6-luna-fast", "openai/gpt-6-luna-fast"])
  assert.equal(result.provider_attempt_count, 2)
})

test("the wrapper refuses a request outside the frozen model or with tools enabled", async () => {
  const result = await runBudgetedBatch({
    deadlineMs: 500,
    maxLogicalRequests: 3,
    run: async (batch) => {
      const client = createBudgetedOpenCodeClient({ batch, client: { session: { create: async () => ({}), prompt: async () => { throw new Error("must not be called") } } } })
      const bad = { ...proposalRequest, body: { ...proposalRequest.body, tools: { bash: true } } }
      await assert.rejects(() => client.session.prompt(bad), /disable all tools/u)
    },
  })
  assert.equal(result.logical_request_count, 0)
  assert.equal(result.status, "completed")
})

test("loss of retry-event observation blocks the next logical provider prompt", async () => {
  let promptInvoked = false
  const result = await runBudgetedBatch({
    deadlineMs: 500,
    maxLogicalRequests: 3,
    run: async (batch) => {
      const client = createBudgetedOpenCodeClient({
        batch,
        retryEventsAvailable: () => false,
        client: { session: { create: async () => ({}), prompt: async () => { promptInvoked = true; return {} } } },
      })
      await assert.rejects(() => client.session.prompt(proposalRequest), /retry-event observer is unavailable/u)
    },
  })
  assert.equal(promptInvoked, false)
  assert.equal(result.logical_request_count, 0)
})
