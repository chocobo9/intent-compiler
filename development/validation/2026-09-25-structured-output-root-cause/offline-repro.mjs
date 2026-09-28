import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = fileURLToPath(new URL(".", import.meta.url))
const projectRoot = resolve(here, "../../..")
const evidenceRoot = resolve(
  projectRoot,
  "development/validation/2026-09-25-gpt6-luna-opencode-prepared-001/raw/structured-output-smoke-high-002",
)
const report = JSON.parse(readFileSync(join(evidenceRoot, "report.json"), "utf8"))
const evidence = JSON.parse(readFileSync(join(evidenceRoot, "session-structured-evidence.json"), "utf8"))
const frozen = JSON.parse(readFileSync(join(evidenceRoot, "input.json"), "utf8"))

const { createCompilerModelV2, V2_COMPILER_CONTRACT } = await import(
  pathToFileURL(join(projectRoot, "dist/model/compiler-model-v2.js")).href
)
const { createOpenCodeModelTransportV2 } = await import(
  pathToFileURL(join(projectRoot, "dist/model/opencode-transport.js")).href
)
const { buildStrictCandidateExample, buildStrictCandidateSchema } = await import(
  pathToFileURL(join(projectRoot, "dist/model/candidate-schema-strict.js")).href
)

let promptCount = 0
let submittedRequest
const transport = createOpenCodeModelTransportV2({
  client: {
    session: {
      create: async () => ({ data: { id: "offline-saved-sample" } }),
      prompt: async (request) => {
        promptCount += 1
        submittedRequest = request
        return {
          data: {
            parts: [{
              type: "tool",
              tool: "StructuredOutput",
              callID: "saved-sample-call",
              state: { status: "completed", input: evidence.structured_result },
            }],
            info: {
              structured: evidence.structured_result,
              providerID: "openai",
              modelID: "gpt-6-luna-fast",
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              cost: 0,
            },
          },
        }
      },
    },
  },
  directory: resolve(projectRoot, "offline-model-only"),
  providerId: "openai",
  modelId: "gpt-6-luna-fast",
  variant: "high",
})

const model = createCompilerModelV2(transport)
const result = await model.propose({
  run_id: frozen.run_id,
  events: [frozen.event],
  event_source_refs: frozen.event_source_refs,
  ir: {},
  compiled: {},
  atom_refs: {},
  executions: [],
  budget: { requests_used: 0, max_requests: 2 },
  contract: V2_COMPILER_CONTRACT,
})

assert.equal(promptCount, 1)
assert.deepEqual(submittedRequest.body.format.schema, buildStrictCandidateSchema("openai"))
assert.equal(
  JSON.parse(submittedRequest.body.parts[0].text).contract.example_candidate,
  JSON.stringify(buildStrictCandidateExample("openai"), null, 2),
)
assert.deepEqual(submittedRequest.body.tools, { "*": false, StructuredOutput: true })
assert.equal(result.ok, false)
assert.equal(result.error?.code, "schema")
assert.equal(result.candidate, undefined)
assert.equal(result.schema_errors?.length, report.proposal.schema_error_count)
assert.equal(result.schema_errors?.length, 54)
assert.equal(result.call?.text_source, "structured")
assert.deepEqual(JSON.parse(result.call.text), evidence.structured_result)

console.log(JSON.stringify({
  offline_only: true,
  fixture_stage: "saved OpenCode info.structured, not raw provider output",
  logical_prompts: promptCount,
  sent_schema_matches_strict_generation_schema: true,
  business_tools_enabled: false,
  schema_errors_reproduced: result.schema_errors.length,
  candidate_returned: result.candidate !== undefined,
  check_or_dispatch_performed: false,
}, null, 2))
