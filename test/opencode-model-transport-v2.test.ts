import { test } from "node:test"
import assert from "node:assert/strict"
import { resolve } from "node:path"
import {
  createOpenCodeModelTransportV2,
  OpenCodeModelTransportError,
  type OpenCodeModelClient,
} from "../src/model/opencode-transport.js"
import { V2_COMPILER_CONTRACT, type CompilerModelV2Input } from "../src/model/compiler-model-v2.js"
import { CANDIDATE_EXAMPLE } from "../src/model/candidate-example.js"
import { buildStrictCandidateExample, buildStrictCandidateSchema } from "../src/model/candidate-schema-strict.js"

const candidate = { schema_version: 2, basis: { event_ids: ["e1"], refs: [] }, groups: [] }
function input(): CompilerModelV2Input {
  return {
    run_id: "run-1",
    events: [],
    ir: {},
    compiled: {},
    atom_refs: {},
    executions: [],
    budget: { requests_used: 0, max_requests: 3 },
    contract: V2_COMPILER_CONTRACT,
  }
}

function clientFor(prompt: NonNullable<NonNullable<OpenCodeModelClient["session"]>["prompt"]>): OpenCodeModelClient {
  return { session: { create: async () => ({ data: { id: "structured-session" } }), prompt } }
}

test("v2 OpenCode transport accepts StructuredOutput info.structured and preserves usage", async () => {
  let created = false
  const client: OpenCodeModelClient = {
    session: {
      create: async () => { created = true; return { data: { id: "structured-session" } } },
      prompt: async (request) => {
        assert.equal(request.body.format?.type, "json_schema")
        assert.deepEqual(request.body.format?.schema, buildStrictCandidateSchema("openai"))
        assert.deepEqual(request.body.tools, { "*": false, StructuredOutput: true })
        assert.deepEqual(Object.keys(request.body.tools), ["*", "StructuredOutput"])
        const sentInput = JSON.parse(request.body.parts[0].text) as CompilerModelV2Input
        assert.deepEqual(sentInput.contract, {
          ...V2_COMPILER_CONTRACT,
          example_candidate: JSON.stringify(buildStrictCandidateExample("openai"), null, 2),
        })
        assert.equal(sentInput.contract.example_candidate, JSON.stringify(buildStrictCandidateExample("openai"), null, 2))
        assert.equal(request.body.system.includes("normal text part"), false)
        return {
          data: {
            parts: [{
              type: "tool",
              tool: "StructuredOutput",
              callID: "call-1",
              state: { status: "completed", input: candidate, output: "Structured output accepted" },
            }],
            info: {
              structured: candidate,
              providerID: "openai",
              modelID: "gpt-6-luna-fast",
              tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 3, write: 0 } },
              cost: 0.01,
            },
          },
        }
      },
    },
  }
  const transport = createOpenCodeModelTransportV2({
    client,
    directory: resolve("intent-compiler-executor-copy"),
    providerId: "openai",
    modelId: "gpt-6-luna-fast",
    variant: "high",
  })
  const result = await transport(input())
  assert.deepEqual(JSON.parse(result.text), candidate)
  assert.equal(result.text_source, "structured")
  assert.equal(result.provider, "openai")
  assert.equal(result.model, "gpt-6-luna-fast")
  assert.deepEqual(result.usage, {
    input_tokens: 10,
    output_tokens: 2,
    reasoning_tokens: 1,
    cache_read_tokens: 3,
    cache_write_tokens: 0,
    cost: 0.01,
  })
  assert.equal(created, true)
})

test("reasoning-only output is not promoted to a candidate", async () => {
  const transport = createOpenCodeModelTransportV2({
    client: clientFor(async () => ({
      data: {
        parts: [{ type: "reasoning", text: JSON.stringify(candidate) }],
        info: { providerID: "openai", modelID: "gpt-6-luna-fast" },
      },
    })),
    directory: resolve("intent-compiler-executor-copy"),
    providerId: "openai",
    modelId: "gpt-6-luna-fast",
    variant: "high",
  })
  await assert.rejects(transport(input()), (error: unknown) => {
    assert.ok(error instanceof OpenCodeModelTransportError)
    assert.equal(error.code, "EMPTY_STRUCTURED_RESPONSE")
    assert.match(error.message, /no structured result/iu)
    return true
  })
})

test("StructuredOutput failures preserve the host error and do not become candidates", async () => {
  const hostError = { name: "StructuredOutputError", message: "Output failed schema validation" }
  for (const errorLocation of ["assistant-info", "structured-tool-part"] as const) {
    const transport = createOpenCodeModelTransportV2({
      client: clientFor(async () => ({
        data: {
          parts: [{ type: "tool", tool: "StructuredOutput", state: { status: "error", error: hostError } }],
          info: {
            ...(errorLocation === "assistant-info" ? { error: hostError } : {}),
            providerID: "openai",
            modelID: "gpt-6-luna-fast",
          },
        },
      })),
      directory: resolve("intent-compiler-executor-copy"),
      providerId: "openai",
      modelId: "gpt-6-luna-fast",
      variant: "high",
    })
    await assert.rejects(transport(input()), (error: unknown) => {
      assert.ok(error instanceof OpenCodeModelTransportError)
      assert.equal(error.code, "MODEL_ERROR_RESPONSE")
      assert.match(error.message, /StructuredOutputError/iu)
      assert.match(error.message, /Output failed schema validation/iu)
      return true
    })
  }
})

test("a business tool part remains rejected even when info.structured is present", async () => {
  const transport = createOpenCodeModelTransportV2({
    client: clientFor(async () => ({
      data: {
        parts: [{ type: "tool", tool: "read", state: { status: "completed", input: { filePath: "src/example.ts" } } }],
        info: { structured: candidate, providerID: "openai", modelID: "gpt-6-luna-fast" },
      },
    })),
    directory: resolve("intent-compiler-executor-copy"),
    providerId: "openai",
    modelId: "gpt-6-luna-fast",
    variant: "high",
  })
  await assert.rejects(transport(input()), (error: unknown) => {
    assert.ok(error instanceof OpenCodeModelTransportError)
    assert.equal(error.code, "TOOL_PART_RETURNED")
    return true
  })
})
