import type { Candidate } from "../core/intent-contract.js"

const SOURCE = {
  source_id: "input-event-id",
  digest: "sha256:0000000000000000000000000000000000000000000000000000000000000001",
}
const REQUIREMENT_SOURCE = { ...SOURCE, quote: "When the input is missing, exit 1 and print MISSING_INPUT to stderr." }
const EMPTY_SOURCE = { ...SOURCE, quote: "With an empty file, write an empty output file." }
export const CANDIDATE_EXAMPLE_INPUT = `Example user goal. ${REQUIREMENT_SOURCE.quote} ${EMPTY_SOURCE.quote}`

export const CANDIDATE_EXAMPLE: Candidate = {
  schema_version: 2,
  basis: { event_ids: ["<triggered-event-id>"], refs: [] },
  source_coverage: [
    { source: { ...SOURCE, quote: "Example user goal." }, disposition: "management", requirements: [], reason: "Task introduction; concrete behavior follows.", basis: [] },
  ],
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
          goal: { text: "Example user goal." },
          current_scope: { text: "Example current scope.", disposition: "proceed" },
        },
        sources: [SOURCE],
      },
      {
        action: "create",
        target: "content",
        local_ref: "r1",
        value: { text: "When the input is missing, exit 1 and print MISSING_INPUT to stderr.", about: [], scope: [{ target_id: "t1" }], support: [] },
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
          task: "Build o1 so a missing input exits with code 1 and prints the exact text MISSING_INPUT to stderr. For an empty input file, write an empty output file. Keep these two cases distinct; do not treat an empty existing file as missing.",
          inputs: [],
          outputs: [{ output_id: "o1", description: "Example deliverable.", format: "artifact" }],
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
                allowed_use: "Change the files this goal names.",
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
            { text: "Missing input exits 1 and writes MISSING_INPUT to stderr.", evidence_required: "A focused missing-input test result" },
            { text: "An empty input writes an empty output file.", evidence_required: "The empty-file test and resulting output artifact" },
          ],
          return_when: ["atom complete"],
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
