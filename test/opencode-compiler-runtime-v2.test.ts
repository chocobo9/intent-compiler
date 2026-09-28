import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOpenCodeCompilerRuntimeV2 } from "../src/runtime/opencode-compiler-v2.js"
import type { OpenCodeModelClient } from "../src/model/opencode-transport.js"
import type { CompilerEvent } from "../src/core/intent-contract.js"
import { buildStrictCandidateSchema } from "../src/model/candidate-schema-strict.js"
import { buildStrictCandidateCheckSchema } from "../src/model/candidate-check-schema-strict.js"

test("v2 runtime routes each run through its own compiler", async () => {
  const root = mkdtempSync(join(tmpdir(), "intent-v2-runtime-"))
  const env = {
    INTENT_COMPILER_STORE: join(root, "store"),
    INTENT_COMPILER_MODEL_DIRECTORY: join(root, "model"),
    INTENT_COMPILER_PROVIDER_ID: "provider",
    INTENT_COMPILER_MODEL_ID: "model",
  }
  let sessionSequence = 0
  const promptRequests: Array<{ sessionId: string; schemaKind: "candidate" | "check" }> = []
  const client: OpenCodeModelClient = {
    session: {
      create: async () => ({ data: { id: `session-v2-${++sessionSequence}` } }),
      prompt: async request => {
        const schema = request.body.format?.schema
        const isCandidate = JSON.stringify(schema) === JSON.stringify(buildStrictCandidateSchema("openai"))
        const isCheck = JSON.stringify(schema) === JSON.stringify(buildStrictCandidateCheckSchema("openai"))
        assert.equal(isCandidate || isCheck, true, "runtime must send one of the two complete OpenAI strict schemas")
        const schemaKind = isCandidate ? "candidate" : "check"
        promptRequests.push({ sessionId: request.path.id, schemaKind })
        const text = schemaKind === "check"
          ? JSON.stringify({ schema_version: 2, verdict: "consistent", findings: [] })
          : JSON.stringify({
              schema_version: 2,
              basis: { event_ids: ["e1"], refs: [] },
              groups: [{
                local_ref: "g",
                task_refs: ["t"],
                depends_on: [],
                ir_changes: [{
                  action: "create",
                  target: "task",
                  local_ref: "t",
                  value: { goal: { text: "hello" }, current_scope: { text: "proceed", disposition: "proceed" } },
                  sources: [{ source_id: "s", digest: "sha256:0000000000000000000000000000000000000000000000000000000000000001" }],
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
        const structured = JSON.parse(text) as unknown
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
  assert.equal(advanced.ok, true)
  assert.equal(advanced.ir_revisions["t"], 0)
  assert.equal(promptRequests.length, 2)
  assert.notEqual(promptRequests[0]!.sessionId, promptRequests[1]!.sessionId)
  assert.equal(promptRequests[0]!.schemaKind, "candidate")
  assert.equal(promptRequests[1]!.schemaKind, "check")
})
