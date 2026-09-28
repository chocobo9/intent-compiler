import type { StrictSchemaProfile } from "./candidate-schema-strict.js"

/**
 * Strict-mode schema for the independent check.  It is written out directly
 * rather than derived from the candidate schema: the check answer is small,
 * and every object must list all of its properties in `required` with
 * `additionalProperties: false` for constrained decoding.
 */
export function buildStrictCandidateCheckSchema(profile: StrictSchemaProfile = "groq"): Record<string, unknown> {
  const nullable = (value: Record<string, unknown>): Record<string, unknown> => profile === "gemini"
    ? geminiNullable(value)
    : { anyOf: [{ type: "null" }, value] }

  const ref = {
    type: "object",
    additionalProperties: false,
    required: ["id", "revision", "digest"],
    properties: {
      id: { type: "string", minLength: 1 },
      revision: { type: "integer", minimum: 0 },
      digest: { type: "string", minLength: 1 },
    },
  }
  const span = {
    type: "object",
    additionalProperties: false,
    required: ["unit", "start", "end"],
    properties: {
      unit: profile === "gemini" ? { enum: ["utf16"] } : { const: "utf16" },
      start: { type: "integer", minimum: 0 },
      end: { type: "integer", minimum: 1 },
    },
  }
  const sourceRef = {
    type: "object",
    additionalProperties: false,
    required: ["source_id", "digest", "span"],
    properties: {
      source_id: { type: "string", minLength: 1 },
      digest: { type: "string", minLength: 1 },
      span: nullable(span),
    },
  }
  const finding = {
    type: "object",
    additionalProperties: false,
    required: ["dimension", "claim", "expected", "observed", "refs"],
    properties: {
        dimension: { enum: ["D1", "D2", "D3", "D4", "D5", "D6", "D7"] },
      claim: { type: "string", minLength: 1 },
      expected: { type: "string", minLength: 1 },
      observed: { type: "string", minLength: 1 },
      refs: { type: "array", items: { anyOf: [ref, sourceRef] } },
    },
  }
  const schema: Record<string, unknown> = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://intent-compiler.local/schema/candidate-check-v2.json",
    type: "object",
    additionalProperties: false,
    required: ["schema_version", "verdict", "findings"],
    properties: {
      schema_version: profile === "gemini" ? { enum: [2] } : { const: 2 },
      verdict: { enum: ["consistent", "inconsistent"] },
      findings: { type: "array", items: finding },
    },
  }
  if (profile === "openai") {
    const openAiSchema = { ...schema }
    delete openAiSchema.$schema
    delete openAiSchema.$id
    return openAiDialect(openAiSchema) as Record<string, unknown>
  }
  return profile === "gemini" ? (geminiDialect(schema) as Record<string, unknown>) : schema
}

function openAiDialect(node: unknown): unknown {
  if (Array.isArray(node)) return node.map((item) => openAiDialect(item))
  if (node === null || typeof node !== "object") return node
  const value = node as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === "const") {
      output.enum = [child]
      continue
    }
    output[key] = openAiDialect(child)
  }
  return output
}

function geminiNullable(value: Record<string, unknown>): Record<string, unknown> {
  const { type, ...rest } = value
  return { type: [typeof type === "string" ? type : "object", "null"], ...rest }
}

function geminiDialect(node: unknown): unknown {
  if (Array.isArray(node)) return node.map((item) => geminiDialect(item))
  if (node === null || typeof node !== "object") return node
  const value = node as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === "$schema" || key === "minLength") continue
    if (key === "const") {
      output.enum = [child]
      continue
    }
    if (key === "oneOf") {
      output.anyOf = geminiDialect(child)
      continue
    }
    output[key] = geminiDialect(child)
  }
  return output
}
