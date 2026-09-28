import { Ajv } from "ajv"
import type { ErrorObject, Schema } from "ajv"

/**
 * Canonical JSON Schema for the v2 management Candidate.  This object is the
 * single structural source: it is shown to the model, used by Ajv after
 * generation, and can be handed to a structured-output provider adapter.
 */
/**
 * Atom content, shared by the persisted atom shape and the draft shape.  The
 * draft adds only `previous_atom_ref`; lifecycle state is recorded in the
 * atom state ledger and never travels with the atom.
 */
const ATOM_REQUIRED = [
  "atom_id",
  "revision",
  "goal_refs",
  "task",
  "inputs",
  "outputs",
  "constraints",
  "optional_tools",
  "authority",
  "preconditions",
  "completion",
  "return_when",
  "intent_judgments",
] as const

const ATOM_PROPERTIES = {
  atom_id: { type: "string", minLength: 1 },
  revision: { type: "integer", minimum: 0 },
  goal_refs: { type: "array", items: { $ref: "#/definitions/ref" } },
  task: { type: "string", minLength: 1 },
  inputs: { type: "array", items: { $ref: "#/definitions/atom_input" } },
  outputs: { type: "array", items: { $ref: "#/definitions/atom_output" } },
  constraints: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["text", "basis", "scope"],
      properties: {
        text: { type: "string", minLength: 1 },
        basis: { type: "array", items: { $ref: "#/definitions/ref_or_source" } },
        scope: {
          type: "array",
          items: {
            type: "object",
            required: ["target_id"],
            properties: { target_id: { type: "string", minLength: 1 }, path: { type: "string" } },
          },
        },
      },
    },
  },
  optional_tools: { type: "array", items: { type: "string", minLength: 1 } },
  authority: {
    type: "object",
    additionalProperties: false,
    required: ["basis", "rules", "lifetime", "delegation"],
    properties: {
      basis: { type: "array", items: { $ref: "#/definitions/ref_or_source" } },
      rules: { type: "array", items: { $ref: "#/definitions/permission_rule" } },
      lifetime: { const: "this_execution" },
      delegation: { const: "not_supported" },
    },
  },
  preconditions: { type: "array", items: { $ref: "#/definitions/condition" } },
  completion: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["text", "evidence_required"],
      properties: {
        text: { type: "string", minLength: 1 },
        evidence_required: { type: "string", minLength: 1 },
      },
    },
  },
  return_when: { type: "array", items: { type: "string", minLength: 1 } },
  intent_judgments: { type: "array", items: { $ref: "#/definitions/judgment" } },
} as const

export const CANDIDATE_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://intent-compiler.local/schema/candidate-v2.json",
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "basis", "groups"],
  properties: {
    schema_version: { const: 2 },
    basis: {
      type: "object",
      additionalProperties: false,
      required: ["event_ids", "refs"],
      properties: {
        event_ids: { type: "array", items: { type: "string", minLength: 1 } },
        refs: { type: "array", items: { $ref: "#/definitions/ref" } },
      },
    },
    groups: {
      type: "array",
      items: { $ref: "#/definitions/group" },
    },
  },
  definitions: {
    ref: {
      type: "object",
      additionalProperties: false,
      required: ["id", "revision", "digest"],
      properties: {
        id: { type: "string", minLength: 1 },
        revision: { type: "integer", minimum: 0 },
        digest: { type: "string", minLength: 1 },
      },
    },
    source_ref: {
      type: "object",
      additionalProperties: false,
      required: ["source_id", "digest"],
      properties: {
        source_id: { type: "string", minLength: 1 },
        digest: { type: "string", minLength: 1 },
        span: {
          type: "object",
          additionalProperties: false,
          required: ["unit", "start", "end"],
          properties: {
            unit: { const: "utf16" },
            start: { type: "integer", minimum: 0 },
            end: { type: "integer", minimum: 1 },
          },
        },
      },
    },
    ref_or_source: { oneOf: [{ $ref: "#/definitions/ref" }, { $ref: "#/definitions/source_ref" }] },
    ref_or_local: {
      oneOf: [
        { $ref: "#/definitions/ref" },
        {
          type: "object",
          additionalProperties: false,
          required: ["local_ref"],
          properties: {
            local_ref: { type: "string", minLength: 1 },
          },
        },
      ],
    },
    ir_change: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["action", "target", "local_ref", "value", "sources"],
          properties: {
            action: { const: "create" },
            target: { enum: ["task", "binding", "output", "content"] },
            local_ref: { type: "string", minLength: 1 },
            value: { type: "object" },
            sources: { type: "array", items: { $ref: "#/definitions/source_ref" } },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["action", "target", "id", "expected_revision", "value", "sources"],
          properties: {
            action: { const: "revise" },
            target: { enum: ["task", "binding", "output", "content", "current_scope"] },
            id: { type: "string", minLength: 1 },
            expected_revision: { type: "integer", minimum: 0 },
            value: { type: "object" },
            sources: { type: "array", items: { $ref: "#/definitions/source_ref" } },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["action", "target", "id", "expected_revision", "reason", "sources"],
          properties: {
            action: { const: "retire" },
            target: { enum: ["binding", "output", "content"] },
            id: { type: "string", minLength: 1 },
            expected_revision: { type: "integer", minimum: 0 },
            reason: { type: "string", minLength: 1 },
            sources: { type: "array", items: { $ref: "#/definitions/source_ref" } },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["action", "reason", "sources"],
          properties: {
            action: { const: "preserve" },
            reason: { type: "string", minLength: 1 },
            sources: { type: "array", items: { $ref: "#/definitions/source_ref" } },
          },
        },
      ],
    },
    atom_input: {
      type: "object",
      additionalProperties: false,
      required: ["binding_id", "ref", "role", "use"],
      properties: {
        binding_id: { type: "string", minLength: 1 },
        ref: { $ref: "#/definitions/ref_or_source" },
        role: { enum: ["task_data", "context", "example"] },
        use: { type: "string", minLength: 1 },
      },
    },
    atom_output: {
      type: "object",
      additionalProperties: false,
      required: ["output_id", "description", "format"],
      properties: {
        output_id: { type: "string", minLength: 1 },
        description: { type: "string", minLength: 1 },
        format: { enum: ["text", "json", "artifact"] },
      },
    },
    judgment: {
      type: "object",
      additionalProperties: false,
      required: ["claim", "basis", "status", "consequence"],
      properties: {
        claim: { type: "string", minLength: 1 },
        basis: { type: "array", items: { $ref: "#/definitions/ref_or_source" } },
        status: { enum: ["supported", "inferred", "unresolved"] },
        consequence: { type: "string", minLength: 1 },
      },
    },
    permission_rule: {
      type: "object",
      additionalProperties: false,
      required: ["operation_id", "resource_ref", "input_refs", "output_refs", "conditions", "allowed_use"],
      properties: {
        operation_id: { type: "string", minLength: 1 },
        resource_ref: { $ref: "#/definitions/ref_or_source" },
        input_refs: { type: "array", items: { $ref: "#/definitions/ref_or_source" } },
        output_refs: { type: "array", items: { $ref: "#/definitions/ref_or_source" } },
        conditions: { type: "array", items: { $ref: "#/definitions/condition" } },
        allowed_use: { type: "string", minLength: 1 },
      },
    },
    condition: {
      type: "object",
      required: ["kind", "refs"],
      properties: {
        kind: {
          enum: [
            "scope_allows",
            "artifact_exists",
            "assessment_supports",
            "user_confirms",
            "object_version_matches",
            "capability_available",
            "all",
            "any",
          ],
        },
        refs: { type: "array", items: { $ref: "#/definitions/ref_or_source" } },
        conditions: { type: "array", items: { $ref: "#/definitions/condition" } },
        expectation: { type: "string" },
      },
    },
    atom: {
      type: "object",
      additionalProperties: false,
      required: [...ATOM_REQUIRED],
      properties: ATOM_PROPERTIES,
    },
    relation: {
      type: "object",
      additionalProperties: false,
      required: ["predecessor", "successor", "requires", "conditions", "basis"],
      properties: {
        predecessor: { $ref: "#/definitions/ref" },
        successor: { $ref: "#/definitions/ref" },
        requires: { type: "string", minLength: 1 },
        conditions: { type: "array", items: { $ref: "#/definitions/condition" } },
        basis: { type: "array", items: { $ref: "#/definitions/ref_or_source" } },
      },
    },
    draft: {
      type: "object",
      additionalProperties: false,
      required: ["local_ref", "task_id", "intent_basis", "atoms", "relations", "attachments"],
      properties: {
        local_ref: { type: "string", minLength: 1 },
        task_id: { type: "string", minLength: 1 },
        intent_basis: { type: "array", items: { $ref: "#/definitions/ref" } },
        atoms: { type: "array", items: { $ref: "#/definitions/atom_draft" } },
        relations: { type: "array", items: { $ref: "#/definitions/relation" } },
        attachments: { type: "array", items: { $ref: "#/definitions/ref_or_source" } },
      },
    },
    // What the model proposes for a new atom: the atom's content plus, when it
    // supersedes a failed atom, the link management records in the state
    // ledger.  Atoms themselves carry no lifecycle state, so the draft shape
    // adds exactly one field instead of a nested composition (which strict
    // providers cannot express).
    atom_draft: {
      type: "object",
      additionalProperties: false,
      required: [...ATOM_REQUIRED],
      properties: { ...ATOM_PROPERTIES, previous_atom_ref: { $ref: "#/definitions/ref" } },
    },
    coverage: {
      type: "object",
      additionalProperties: false,
      required: ["requirement", "disposition", "refs", "explanation"],
      properties: {
        requirement: { $ref: "#/definitions/ref_or_local" },
        disposition: { enum: ["assigned", "supported", "paused", "unresolved"] },
        refs: { type: "array", items: { $ref: "#/definitions/ref_or_local" } },
        explanation: { type: "string", minLength: 1 },
      },
    },
    check: {
      type: "object",
      additionalProperties: false,
      required: ["scenario", "expected", "observed_in_candidate", "sources", "unresolved"],
      properties: {
        scenario: { type: "string", minLength: 1 },
        expected: { type: "string", minLength: 1 },
        observed_in_candidate: { type: "string", minLength: 1 },
        sources: { type: "array", items: { $ref: "#/definitions/source_ref" } },
        unresolved: { type: "boolean" },
      },
    },
    question: {
      type: "object",
      additionalProperties: false,
      required: ["text", "affects"],
      properties: {
        text: { type: "string", minLength: 1 },
        affects: { type: "array", items: { type: "string", minLength: 1 } },
      },
    },
    group: {
      type: "object",
      additionalProperties: false,
      required: [
        "local_ref",
        "task_refs",
        "depends_on",
        "ir_changes",
        "compilation",
        "execution_decisions",
        "assessments",
        "coverage",
        "checks",
        "questions",
      ],
      properties: {
        local_ref: { type: "string", minLength: 1 },
        task_refs: { type: "array", items: { type: "string", minLength: 1 } },
        depends_on: { type: "array", items: { type: "string", minLength: 1 } },
        ir_changes: { type: "array", items: { $ref: "#/definitions/ir_change" } },
        compilation: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["decision", "current", "reason"],
              properties: {
                decision: { const: "reuse" },
                current: { type: "array", items: { $ref: "#/definitions/ref" } },
                reason: { type: "string", minLength: 1 },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["decision", "drafts"],
              properties: {
                decision: { const: "replace" },
                drafts: { type: "array", items: { $ref: "#/definitions/draft" } },
              },
            },
          ],
        },
        execution_decisions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["execution_id", "decision", "reason", "basis"],
            properties: {
              execution_id: { type: "string", minLength: 1 },
              decision: { enum: ["continue", "stop", "await_result"] },
              reason: { type: "string", minLength: 1 },
              basis: { type: "array", items: { $ref: "#/definitions/ref" } },
            },
          },
        },
        assessments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["target_ref", "criteria_refs", "evidence_refs", "result", "explanation", "method"],
            properties: {
              target_ref: { $ref: "#/definitions/ref" },
              criteria_refs: { type: "array", items: { $ref: "#/definitions/ref_or_source" } },
              evidence_refs: { type: "array", items: { $ref: "#/definitions/ref_or_source" } },
              result: { enum: ["satisfied", "not_satisfied", "unknown"] },
              explanation: { type: "string", minLength: 1 },
              method: { enum: ["deterministic", "model", "manual"] },
            },
          },
        },
        coverage: { type: "array", items: { $ref: "#/definitions/coverage" } },
        checks: { type: "array", items: { $ref: "#/definitions/check" } },
        questions: { type: "array", items: { $ref: "#/definitions/question" } },
      },
    },
  },
} as unknown as Schema

export interface CandidateSchemaResult {
  ok: boolean
  errors: string[]
}

export function validateCandidateSchema(value: unknown): CandidateSchemaResult {
  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true })
  const validate = ajv.compile(CANDIDATE_JSON_SCHEMA)
  const ok = validate(value)
  return {
    ok,
    errors: (validate.errors ?? []).map(formatAjvError),
  }
}

function formatAjvError(error: ErrorObject): string {
  const path = error.instancePath || "/"
  const message = error.message ?? "invalid"
  return `${path}: ${message}`
}
