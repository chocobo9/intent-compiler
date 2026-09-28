import type { Candidate } from "../core/intent-contract.js"

const SOURCE = {
  source_id: "input-event-id",
  digest: "sha256:0000000000000000000000000000000000000000000000000000000000000001",
}

export const CANDIDATE_EXAMPLE: Candidate = {
  schema_version: 2,
  basis: { event_ids: ["<triggered-event-id>"], refs: [] },
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
          task: "Deliver the example user goal as o1.",
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
          completion: [{ text: "The example goal is delivered as o1.", evidence_required: "o1" }],
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
    }],
    checks: [],
    questions: [],
  }],
}
