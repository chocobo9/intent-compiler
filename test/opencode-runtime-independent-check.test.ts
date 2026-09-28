import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createIntentCompilerRuntime } from "../src/harness/runtime-factory.js"
import { digestText, type CompilerEvent } from "../src/core/intent-contract.js"
import { CANDIDATE_EXAMPLE, CANDIDATE_EXAMPLE_INPUT } from "../src/model/candidate-example.js"
import { CHECK_SYSTEM_PROMPT, type OpenCodeModelClient } from "../src/model/opencode-transport.js"
import { buildStrictCandidateExample, buildStrictCandidateSchema } from "../src/model/candidate-schema-strict.js"
import { buildStrictCandidateCheckSchema } from "../src/model/candidate-check-schema-strict.js"

test("OpenCode runtime independently proposes and checks with GPT-6 Luna contracts", async () => {
  const root = mkdtempSync(join(tmpdir(), "opencode-independent-check-"))
  const inputText = CANDIDATE_EXAMPLE_INPUT
  const event: CompilerEvent = {
    schema_version: 2,
    run_id: "opencode-independent-check",
    event_id: "event-1",
    kind: "user_input",
    source: { producer_id: "test-host", channel: "user" },
    payload: { text: inputText },
  }
  const candidate = JSON.parse(JSON.stringify(CANDIDATE_EXAMPLE)
    .replaceAll("<triggered-event-id>", event.event_id)
    .replaceAll("input-event-id", event.event_id)
    .replaceAll("sha256:0000000000000000000000000000000000000000000000000000000000000001", digestText(inputText))) as unknown
  const calls: Array<{ kind: "session.create" | "session.prompt"; id?: string; body?: any }> = []
  let sessionSequence = 0
  const client: OpenCodeModelClient = {
    session: {
      create: async () => {
        const id = `management-session-${++sessionSequence}`
        calls.push({ kind: "session.create", id })
        return { data: { id } }
      },
      prompt: async request => {
        calls.push({ kind: "session.prompt", id: request.path.id, body: request.body })
        const schema = request.body.format?.schema
        const proposal = JSON.stringify(schema) === JSON.stringify(buildStrictCandidateSchema("openai"))
        const check = JSON.stringify(schema) === JSON.stringify(buildStrictCandidateCheckSchema("openai"))
        assert.equal(proposal || check, true, "runtime must send one of the two complete OpenAI strict schemas")
        const responseText = proposal
          ? JSON.stringify(buildStrictCandidateExample("openai", candidate))
          : JSON.stringify({ schema_version: 2, verdict: "consistent", findings: [] })
        const structured = JSON.parse(responseText) as unknown
        return {
          data: {
            parts: [{ type: "tool", tool: "StructuredOutput", callID: `structured-${sessionSequence}`, state: { status: "completed", input: structured } }],
            info: { structured, providerID: "openai", modelID: "gpt-6-luna-fast", tokens: { input: 1, output: 1, reasoning: 0 } },
          },
        }
      },
    },
  }
  const compiler = createIntentCompilerRuntime({
    client,
    config: {
      transport: "opencode",
      model: { providerId: "openai", modelId: "gpt-6-luna-fast", variant: "high", agent: "build" },
      paths: {
        compilerStoreDir: resolve(root, "compiler-store"),
        compilerModelDir: resolve(root, "compiler-model"),
        observerStoreDir: resolve(root, "observer-store"),
        executorWorkspaceDir: resolve(root, "executor-workspace"),
      },
      capabilities: { operations: ["read", "edit", "bash"], workspaceRoot: resolve(root, "executor-workspace") },
    },
  })

  assert.equal((await compiler.acceptEvent(event)).ok, true)
  const advanced = await compiler.advance({ runId: event.run_id })

  assert.equal(advanced.ok, true)
  assert.deepEqual(calls.map(call => call.kind), ["session.create", "session.prompt", "session.create", "session.prompt"])
  const prompts = calls.filter((call): call is typeof call & { body: NonNullable<typeof call.body> } => call.kind === "session.prompt")
  assert.equal(prompts.length, 2)
  assert.notEqual(prompts[0]!.id, prompts[1]!.id)
  for (const prompt of prompts) {
    assert.deepEqual(prompt.body.model, { providerID: "openai", modelID: "gpt-6-luna-fast" })
    assert.equal(prompt.body.variant, "high")
    assert.equal(prompt.body.format?.retryCount, 0)
  }
  assert.deepEqual(prompts[0]!.body.format?.schema, buildStrictCandidateSchema("openai"))
  assert.deepEqual(prompts[1]!.body.format?.schema, buildStrictCandidateCheckSchema("openai"))
  assert.notEqual(prompts[0]!.body.system, prompts[1]!.body.system)
  assert.equal(prompts[1]!.body.system, CHECK_SYSTEM_PROMPT)
  assert.match(prompts[0]!.body.system, /management model/i)
  assert.equal(JSON.parse(prompts[0]!.body.parts[0]!.text).contract.schema_version, 2)
  assert.equal(JSON.parse(prompts[1]!.body.parts[0]!.text).contract.check_contract.length > 0, true)
  assert.equal(advanced.deliveries?.length, 1)
})
