import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOpenCodeCompilerRuntimeV2 } from "../src/runtime/opencode-compiler-v2.js"
import type { OpenCodeModelClient } from "../src/model/opencode-transport.js"
import { stageCandidate } from "./fixtures/stage-candidate.js"
import { buildGenerationSchema } from "../src/model/generation-schema.js"
import type { Candidate, CompilerEvent } from "../src/core/intent-contract.js"
import { buildStrictCandidateExample } from "../src/model/candidate-schema-strict.js"
import { buildStrictCandidateCheckSchema } from "../src/model/candidate-check-schema-strict.js"

test("v2 runtime routes each run through its own compiler", async () => {
  const root = mkdtempSync(join(tmpdir(), "intent-v2-runtime-"))
  const env = {
    INTENT_COMPILER_STORE: join(root, "store"),
    INTENT_COMPILER_MODEL_DIRECTORY: join(root, "model"),
    INTENT_COMPILER_PROVIDER_ID: "provider",
    INTENT_COMPILER_MODEL_ID: "gpt-5.6-sol",
  }
  let sessionSequence = 0
  const promptRequests: Array<{ sessionId: string; schemaKind: "ir" | "ci" | "check" }> = []
  const client: OpenCodeModelClient = {
    session: {
      create: async () => ({ data: { id: `session-v2-${++sessionSequence}` } }),
      prompt: async request => {
        const schema = request.body.format?.schema
        const input = JSON.parse(request.body.parts[0].text)
        if (input.generation_stage === "ir") {
          assert.ok(input.capabilities.operations.includes("apply_patch"))
          assert.ok(input.capabilities.operations.includes("todowrite"))
          assert.equal(input.capabilities.operations.includes("write"), false)
          assert.equal(input.capabilities.operations.includes("edit"), false)
        }
        const stage = input.generation_stage as "ir" | "ci" | undefined
        const isCandidate = stage !== undefined && JSON.stringify(schema) === JSON.stringify(buildGenerationSchema(stage, "openai", { checkRequired: true }))
        const isCheck = JSON.stringify(schema) === JSON.stringify(buildStrictCandidateCheckSchema("openai"))
        assert.equal(isCandidate || isCheck, true, "runtime must send the IR, CI or check OpenAI strict schema")
        const schemaKind = isCandidate ? stage! : "check"
        promptRequests.push({ sessionId: request.path.id, schemaKind })
        const text = schemaKind === "check"
          ? JSON.stringify({ schema_version: 2, verdict: "consistent", findings: [], repair_target: null })
          : JSON.stringify({
              schema_version: 2,
              basis: { event_ids: ["e1"], refs: [] },
              source_coverage: [{ source: { source_id: "e1", digest: "computed-by-management", quote: "hello" }, disposition: "unresolved", requirements: [], reason: "Greeting gives no concrete task", basis: [] }],
              groups: [{
                local_ref: "g",
                task_refs: ["t"],
                depends_on: [],
                ir_changes: [{
                  action: "create",
                  target: "task",
                  local_ref: "t",
                  value: { goal: { text: "hello" }, current_scope: { text: "proceed", disposition: "proceed" } },
                  sources: [{ source_id: "e1", digest: "sha256:0000000000000000000000000000000000000000000000000000000000000001" }],
                }],
                compilation: { decision: "reuse", current: [], reason: "no atom" },
                execution_decisions: [],
                assessments: [],
                coverage: [{
                  requirement: { local_ref: "t" },
                  disposition: "unresolved",
                  refs: [],
                  explanation: "no executable work yet; the delegation is recorded and stays open",
                }],
                checks: [],
                questions: [],
              }],
            })
        const structured = isCandidate ? stageCandidate(input, buildStrictCandidateExample("openai", JSON.parse(text)) as unknown as Candidate) : JSON.parse(text)
        return {
          data: {
            parts: [{ type: "tool", tool: "StructuredOutput", callID: `structured-${sessionSequence}`, state: { status: "completed", input: structured } }],
            info: { structured },
          },
        }
      },
    },
  }
  const runtime = createOpenCodeCompilerRuntimeV2({
    client,
    executorDirectory: join(root, "executor"),
    observerStoreDirectory: join(root, "observer"),
    env,
  })
  const event: CompilerEvent = {
    schema_version: 2,
    run_id: "run-1",
    event_id: "e1",
    kind: "user_input",
    source: { producer_id: "host", channel: "user" },
    task_ids: ["t"],
    payload: { text: "hello" },
  }
  const receipt = await runtime.acceptEvent(event)
  assert.equal(receipt.ok, true)
  const advanced = await runtime.advance({ runId: "run-1" })
  assert.equal(advanced.ok, true, advanced.message)
  assert.equal(advanced.ir_revisions["t"], 0)
  assert.equal(promptRequests.length, 3)
  assert.equal(new Set(promptRequests.map(request => request.sessionId)).size, 3)
  assert.notEqual(promptRequests[0]!.sessionId, promptRequests[1]!.sessionId)
  assert.equal(promptRequests[0]!.schemaKind, "ir")
  assert.equal(promptRequests[1]!.schemaKind, "ci")
  assert.equal(promptRequests[2]!.schemaKind, "check")
})

test("v2 runtime rejects editing tools hidden by the executor model before a management request", () => {
  const root = mkdtempSync(join(tmpdir(), "intent-v2-tool-profile-"))
  assert.throws(() => createOpenCodeCompilerRuntimeV2({
    client: {}, executorDirectory: join(root, "executor"), observerStoreDirectory: join(root, "observer"),
    env: {
      INTENT_COMPILER_STORE: join(root, "store"),
      INTENT_COMPILER_MODEL_DIRECTORY: join(root, "model"),
      INTENT_COMPILER_PROVIDER_ID: "openai", INTENT_COMPILER_MODEL_ID: "gpt-5.6-sol",
      INTENT_COMPILER_OPERATIONS: "read,write,edit,bash",
    },
  }), /OpenCode hides write, edit/)
})
