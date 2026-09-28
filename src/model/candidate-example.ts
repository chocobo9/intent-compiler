import type { Candidate } from "../core/intent-contract.js"

const SOURCE = {
  source_id: "input-event-id",
  digest: "sha256:0000000000000000000000000000000000000000000000000000000000000001",
}
const REQUIREMENT_SOURCE = { ...SOURCE, quote: 'Build a file-copy command in the provided workspace. It takes a JSON config with string fields source and destination naming the input and output files, for example {"source":"sample.txt","destination":"copy.txt"}. Copy the input file bytes to the output file. When the input is missing, exit 1 and print MISSING_INPUT to stderr.' }
const EMPTY_SOURCE = { ...SOURCE, quote: "With an empty file, write an empty output file." }
export const CANDIDATE_EXAMPLE_INPUT = `${REQUIREMENT_SOURCE.quote} ${EMPTY_SOURCE.quote}`

export const CANDIDATE_EXAMPLE: Candidate = {
  schema_version: 2,
  basis: { event_ids: ["input-event-id"], refs: [] },
  source_coverage: [],
  groups: [{
    local_ref: "g1",
    task_refs: ["t1"],
    depends_on: [],
    ir_changes: [
      {
        action: "create",
        target: "task",
        local_ref: "t1",
        value: {
          goal: { text: "Deliver a file-copy command with the requested missing-input and empty-file behavior." },
          current_scope: { text: "Implement and validate the command in the provided workspace.", disposition: "proceed" },
        },
        sources: [SOURCE],
      },
      {
        action: "create",
        target: "content",
        local_ref: "r1",
        value: { text: "File copying and missing-input handling.", about: [], scope: [{ target_id: "t1" }], support: [] },
        sources: [REQUIREMENT_SOURCE],
      },
      {
        action: "create",
        target: "content",
        local_ref: "r2",
        value: { text: "With an empty file, write an empty output file.", about: [], scope: [{ target_id: "t1" }], support: [] },
        sources: [EMPTY_SOURCE],
      },
    ],
    compilation: {
      decision: "replace",
      drafts: [{
        local_ref: "ci-1",
        task_id: "t1",
        intent_basis: [],
        atoms: [{
          atom_id: "a1",
          revision: 0,
          goal_refs: [],
          task: "Implement a file-copy command in the provided workspace. Accept a JSON config with string fields source and destination: source names the input file and destination names the output file. The sample paths are examples, not fixed filenames. Copy the input bytes to the output file. When the input file is missing, exit with code 1 and print MISSING_INPUT to stderr. For an empty existing input file, write an empty output file; do not treat it as missing. Choose the internal implementation to fit the workspace. Return the implementation and evidence for the config interface, copying, missing input and empty input.",
          inputs: [],
          outputs: [{ output_id: "o1", description: "File-copy command implementation and verification evidence.", format: "artifact" }],
          constraints: [],
          optional_tools: ["read", "edit", "bash"],
          authority: {
            basis: [SOURCE],
            rules: [
              {
                operation_id: "read",
                resource_ref: SOURCE,
                input_refs: [],
                output_refs: [],
                conditions: [],
                allowed_use: "Read the workspace material this goal needs.",
              },
              {
                operation_id: "edit",
                resource_ref: SOURCE,
                input_refs: [],
                output_refs: [],
                conditions: [],
                allowed_use: "Implement the file-copy command in the provided workspace.",
              },
              {
                operation_id: "bash",
                resource_ref: SOURCE,
                input_refs: [],
                output_refs: [],
                conditions: [],
                allowed_use: "Build and run the checks this goal names.",
              },
            ],
            lifetime: "this_execution",
            delegation: "not_supported",
          },
          preconditions: [],
          completion: [
            { text: "The JSON config's source and destination string fields select the input and output files; an existing input is copied byte-for-byte.", evidence_required: "The config, command invocation and comparison of input and output bytes using paths different from the illustrative sample" },
            { text: "Missing input exits 1 and writes MISSING_INPUT to stderr.", evidence_required: "A focused missing-input test result" },
            { text: "An empty input writes an empty output file.", evidence_required: "The empty-file test and resulting output artifact" },
          ],
          return_when: ["Return the implementation and completion evidence on success. If blocked, return the blocking facts and identify the unmet completion conditions for management; the blocker report is not completion."],
          intent_judgments: [],
        }],
        relations: [],
        attachments: [],
      }],
    },
    execution_decisions: [],
    assessments: [],
    coverage: [{
      requirement: { local_ref: "t1" },
      disposition: "assigned",
      refs: [{ local_ref: "a1" }],
      explanation: "a1 is the deliverable for the example goal.",
    }, {
      requirement: { local_ref: "r1" },
      disposition: "assigned",
      refs: [{ local_ref: "a1" }],
      explanation: "The complete deliverable requirement is assigned to a1.",
    }, {
      requirement: { local_ref: "r2" },
      disposition: "assigned",
      refs: [{ local_ref: "a1" }],
      explanation: "A separate behavioral rule belongs to the same cohesive deliverable.",
    }],
    checks: [],
    questions: [],
  }],
}
