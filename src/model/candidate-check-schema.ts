import { Ajv } from "ajv"
import type { ErrorObject } from "ajv"

/**
 * Canonical JSON Schema for the independent check of one management
 * candidate.  The checker may only report inconsistencies: it has no field
 * for a business answer, authority, or replacement content, so a hostile or
 * confused checker cannot smuggle one through.
 */
export const CANDIDATE_CHECK_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://intent-compiler.local/schema/candidate-check-v2.json",
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "verdict", "findings"],
  properties: {
    schema_version: { const: 2 },
    verdict: { enum: ["consistent", "inconsistent"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["dimension", "claim", "expected", "observed", "refs"],
        properties: {
      dimension: { enum: ["D1", "D2", "D3", "D4", "D5", "D6", "D7"] },
          claim: { type: "string", minLength: 1 },
          expected: { type: "string", minLength: 1 },
          observed: { type: "string", minLength: 1 },
          refs: { type: "array", items: { $ref: "#/definitions/ref_or_source" } },
        },
      },
    },
  },
  definitions: {
    ref_or_source: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "revision", "digest"],
          properties: {
            id: { type: "string", minLength: 1 },
            revision: { type: "integer", minimum: 0 },
            digest: { type: "string", minLength: 1 },
          },
        },
        {
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
      ],
    },
  },
} as const

export interface CandidateCheckSchemaResult {
  ok: boolean
  errors: string[]
}

export function validateCandidateCheckSchema(value: unknown): CandidateCheckSchemaResult {
  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true })
  const validate = ajv.compile(CANDIDATE_CHECK_JSON_SCHEMA)
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
