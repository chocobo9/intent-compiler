import { CANDIDATE_JSON_SCHEMA } from "./candidate-schema.js"
import { CANDIDATE_EXAMPLE } from "./candidate-example.js"

/**
 * Strict-mode JSON Schema for providers whose structured outputs require
 * every object to list all properties in `required` and to reject additional
 * properties (Groq strict:true, OpenAI strict mode).  This schema is used only
 * for generation; validation still runs against the canonical schema.
 *
 * Optional fields become nullable unions, and the caller strips null values
 * before canonical validation.  The one semantically open field in the
 * canonical schema (`ir_change.value`) is expanded into concrete per-target
 * shapes here, which are all subsets of the canonical `type: "object"`.
 */

type SchemaNode = Record<string, any>

export type StrictSchemaProfile = "openai" | "groq" | "gemini"

const nullable = (value: unknown, profile: StrictSchemaProfile): SchemaNode => ({
  anyOf: [
    { type: "null" },
    profile === "groq" && (value as SchemaNode)?.$ref !== undefined
      ? { $ref: (value as SchemaNode).$ref, additionalProperties: false }
      : (value as SchemaNode),
  ],
})

const text = { type: "string", minLength: 1 } as const
const refOrSource = { $ref: "#/definitions/ref_or_source" } as const
const ref = { $ref: "#/definitions/ref" } as const
const sourceWithQuote = { $ref: "#/definitions/source_ref_with_quote" } as const

const sourceRefWithQuote = { oneOf: [{
  type: "object",
  additionalProperties: false,
  required: ["source_id", "digest", "quote"],
  properties: {
    source_id: text,
    digest: text,
    quote: text,
  },
}, {
  type: "object", additionalProperties: false,
  required: ["source_id", "digest", "segment_id"],
  properties: { source_id: text, digest: text, segment_id: text },
}] } as const

const goalValue = {
  type: "object",
  description: "The whole intended user result, not just the currently executable step.",
  additionalProperties: false,
  required: ["text"],
  properties: { text },
} as const

const scopeValue = {
  type: "object",
  description: "What the current delegation permits, pauses or leaves conditional. Do not lower the requested result because of host limitations.",
  additionalProperties: false,
  required: ["text", "disposition"],
  properties: {
    text,
    disposition: { enum: ["proceed", "paused", "withdrawn", "conditional"] },
  },
} as const

const scopeItem = {
  type: "object",
  additionalProperties: false,
  required: ["target_id", "path"],
  properties: {
    target_id: text,
    path: nullable({ type: "string" }, "groq"),
  },
} as const

const supportItem = {
  type: "object",
  additionalProperties: false,
  required: ["refs", "explanation"],
  properties: {
    refs: { type: "array", items: ref },
    explanation: { type: "string", minLength: 1 },
  },
} as const

const nullish = (value: SchemaNode): SchemaNode => {
  const { type, ...rest } = value
  if (typeof type !== "string") throw new Error("nullish requires a single-type schema")
  return { type: [type, "null"], ...rest }
}

/**
 * One strict-safe value shape per create/revise target.  A single merged blob
 * covering every target was the reason models emitted task creates carrying
 * output fields (silently dropped downstream) and mixed up local ids; with a
 * branch per target the constrained decode can only produce the fields that
 * belong to the target it declared.  Genuinely optional fields stay nullable
 * and are stripped before canonical validation.
 */
type ValueTarget = "task" | "current_scope" | "binding" | "output" | "content"

function valueFor(profile: StrictSchemaProfile, target: ValueTarget): SchemaNode {
  const nullableOf = (value: SchemaNode): SchemaNode => profile === "gemini" ? nullish(value) : nullable(value, profile)
  const stringOrNull = (): SchemaNode => profile === "gemini" ? { type: ["string", "null"] } : nullable(text, profile)
  const enumOrNull = (values: readonly string[]): SchemaNode => profile === "gemini"
    ? nullish({ type: "string", enum: [...values] })
    : nullable({ enum: [...values] }, profile)
  const arrayOrNull = (items: SchemaNode): SchemaNode => profile === "gemini"
    ? { type: ["array", "null"], items }
    : nullable({ type: "array", items }, profile)
  if (target === "task") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["goal", "current_scope"],
      properties: {
        goal: goalValue,
        current_scope: scopeValue,
      },
    }
  }
  if (target === "current_scope") {
    return {
      type: "object",
      description: scopeValue.description,
      additionalProperties: false,
      required: ["text", "disposition"],
      properties: {
        text,
        disposition: { enum: ["proceed", "paused", "withdrawn", "conditional"] },
      },
    }
  }
  if (target === "binding") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["ref", "role", "purpose"],
      properties: {
        ref: nullableOf(refOrSource),
        role: enumOrNull(["task_data", "context", "example"]),
        purpose: stringOrNull(),
      },
    }
  }
  if (target === "output") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["description", "format"],
      properties: {
        description: stringOrNull(),
        format: enumOrNull(["text", "json", "artifact"]),
      },
    }
  }
  return {
    type: "object",
    description: "One coherent requirement within the task IR. Select its complete operative source passages and necessary context, interpret their role and scope, and retain unchanged subrules on revision.",
    additionalProperties: false,
    required: ["text", "about", "scope", "support"],
    properties: {
      text: { ...stringOrNull(), description: "A short interpretation label. Management separately stores the selected original text; this label does not replace that specification or the Atom's executable instructions." },
      about: arrayOrNull(ref),
      scope: arrayOrNull(scopeItem),
      support: arrayOrNull(supportItem),
    },
  }
}

function branch(action: string, target: string[], value: SchemaNode, extra: SchemaNode = {}, sourceItem: SchemaNode = { $ref: "#/definitions/source_ref" }): SchemaNode {
  return {
    type: "object",
    additionalProperties: false,
    required: ["action", "target", "value", "sources", ...(extra.required ?? [])],
    properties: {
      action: { enum: [action] },
      target: { enum: target },
      value,
      sources: { type: "array", items: sourceItem },
      ...extra.properties,
    },
  }
}

function strictIrChange(profile: StrictSchemaProfile): SchemaNode {
  const withId = {
    required: ["id", "expected_revision"],
    properties: {
      id: { type: "string", minLength: 1 },
      expected_revision: { type: "integer", minimum: 0 },
    },
  } as const
  const createBranches = (["task", "binding", "output", "content"] as const).map((target) =>
    branch("create", [target], valueFor(profile, target), {
      required: ["local_ref"],
      properties: { local_ref: { type: "string", minLength: 1 } },
    }, target === "content" ? sourceWithQuote : undefined),
  )
  const reviseBranches = (["task", "current_scope", "binding", "output", "content"] as const).map((target) =>
    branch("revise", [target], valueFor(profile, target), withId, target === "content" ? sourceWithQuote : undefined),
  )
  return {
    anyOf: [
      ...createBranches,
      ...reviseBranches,
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
  }
}

function transform(node: unknown, profile: StrictSchemaProfile): unknown {
  if (Array.isArray(node)) return node.map((item) => transform(item, profile))
  if (node === null || typeof node !== "object") return node
  const value = node as SchemaNode
  if (typeof value.$ref === "string") return value
  if (Array.isArray(value.oneOf)) {
    const { oneOf, ...annotations } = value
    const keyword = profile === "openai" ? "anyOf" : "oneOf"
    return { ...annotations, [keyword]: oneOf.map((branch: unknown) => transformUnionVariant(branch, profile)) }
  }
  if (Array.isArray(value.anyOf)) return { ...value, anyOf: value.anyOf.map((branch) => transformUnionVariant(branch, profile)) }
  if (profile === "openai" && Object.prototype.hasOwnProperty.call(value, "const")) {
    const { const: constant, ...rest } = value
    return { ...rest, enum: [constant] }
  }
  if (value.type === "array" && value.items !== undefined) {
    return { ...value, items: transform(value.items, profile) }
  }
  if (typeof value.properties === "object" && value.properties !== null) {
    const declaredRequired = new Set<string>(Array.isArray(value.required) ? value.required : [])
    const properties: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value.properties as Record<string, unknown>)) {
      const transformed = transform(child, profile)
      properties[key] = declaredRequired.has(key) ? transformed : nullable(transformed, profile)
    }
    return {
      ...value,
      additionalProperties: false,
      required: Object.keys(properties),
      properties,
    }
  }
  return value
}

function transformUnionVariant(variant: unknown, profile: StrictSchemaProfile): unknown {
  const transformed = transform(variant, profile)
  if (
    profile === "groq" &&
    variant !== null &&
    typeof variant === "object" &&
    typeof (variant as SchemaNode).$ref === "string"
  ) {
    return { $ref: (variant as SchemaNode).$ref, additionalProperties: false }
  }
  return transformed
}

export function buildStrictCandidateSchema(profile: StrictSchemaProfile = "groq"): Record<string, unknown> {
  const canonical = CANDIDATE_JSON_SCHEMA as unknown as SchemaNode
  // Legacy canonical callers may omit this field; generated candidates may not.
  const source: SchemaNode = { ...canonical, required: [...canonical.required, "source_coverage"] }
  const definitions: Record<string, unknown> = {}
  for (const [name, definition] of Object.entries(source.definitions as Record<string, unknown>)) {
    definitions[name] = transform(name === "ir_change" ? strictIrChange(profile) : definition, profile) as Record<string, unknown>
  }
  definitions.source_ref_with_quote = transform(sourceRefWithQuote, profile)
  const output: Record<string, unknown> = { ...(transform(source, profile) as Record<string, unknown>), definitions }
  if (profile === "openai") {
    delete output.$schema
    delete output.$id
  }
  return profile === "gemini" ? (geminiDialect(output) as Record<string, unknown>) : output
}

/**
 * Expand the canonical example to the strict generation schema. Strict-mode
 * schemas require optional properties to be present as null; CompilerModelV2
 * strips those nulls before canonical validation.
 */
export function buildStrictCandidateExample(profile: StrictSchemaProfile = "openai", example: unknown = CANDIDATE_EXAMPLE): Record<string, unknown> {
  const schema = buildStrictCandidateSchema(profile)
  const definitions = schema.definitions as Record<string, unknown>
  const result = completeStrictExample(example, schema, definitions)
  return result as Record<string, unknown>
}

function completeStrictExample(value: unknown, schemaValue: unknown, definitions: Record<string, unknown>): unknown {
  if (schemaValue === null || typeof schemaValue !== "object" || Array.isArray(schemaValue)) return value
  const schema = schemaValue as SchemaNode
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.split("/").at(-1)
    const referenced = name === undefined ? undefined : definitions[name]
    if (referenced === undefined) throw new Error(`strict Candidate example has unknown schema reference '${schema.$ref}'`)
    const siblings = { ...schema }
    delete siblings.$ref
    return completeStrictExample(value, { ...(referenced as SchemaNode), ...siblings }, definitions)
  }
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const variants = (schema.anyOf ?? schema.oneOf) as unknown[]
    const nonNullVariants = variants.filter((variant) => !isNullSchema(variant))
    if (value === null) return null
    const selected = [...nonNullVariants].sort((left, right) =>
      strictExampleScore(value, left, definitions) - strictExampleScore(value, right, definitions),
    )[0]
    if (selected === undefined || strictExampleScore(value, selected, definitions) >= Number.MAX_SAFE_INTEGER) {
      throw new Error("strict Candidate example does not match any generated schema branch")
    }
    return completeStrictExample(value, selected, definitions)
  }
  if (schema.type === "object" && isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const required = new Set<string>(Array.isArray(schema.required) ? schema.required : [])
    const output: Record<string, unknown> = {}
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        output[key] = completeStrictExample(value[key], childSchema, definitions)
      } else if (isNullableSchema(childSchema)) {
        output[key] = null
      } else if (required.has(key)) {
        throw new Error(`strict Candidate example is missing required field '${key}'`)
      }
    }
    for (const key of Object.keys(value)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key) && schema.additionalProperties === false) {
        throw new Error(`strict Candidate example has unexpected field '${key}'`)
      }
    }
    return output
  }
  if (schema.type === "array" && Array.isArray(value)) {
    return value.map((item) => completeStrictExample(item, schema.items, definitions))
  }
  return value
}

function strictExampleScore(value: unknown, schemaValue: unknown, definitions: Record<string, unknown>): number {
  if (schemaValue === null || typeof schemaValue !== "object" || Array.isArray(schemaValue)) return 0
  const schema = schemaValue as SchemaNode
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.split("/").at(-1)
    const referenced = name === undefined ? undefined : definitions[name]
    if (referenced === undefined) return Number.MAX_SAFE_INTEGER
    return strictExampleScore(value, { ...(referenced as SchemaNode), ...withoutRef(schema) }, definitions)
  }
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const variants = (schema.anyOf ?? schema.oneOf) as unknown[]
    if (value === null) return variants.some(isNullSchema) ? 0 : Number.MAX_SAFE_INTEGER
    return Math.min(...variants.filter((variant) => !isNullSchema(variant)).map((variant) => strictExampleScore(value, variant, definitions)))
  }
  if (Object.prototype.hasOwnProperty.call(schema, "const") && value !== schema.const) return Number.MAX_SAFE_INTEGER
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return Number.MAX_SAFE_INTEGER
  if (schema.type === "object") {
    if (!isRecord(value)) return Number.MAX_SAFE_INTEGER
    const properties = isRecord(schema.properties) ? schema.properties : {}
    let score = 0
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) score += 100
    }
    for (const key of Object.keys(value)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        if (schema.additionalProperties === false) score += 10_000
      } else {
        score += strictExampleScore(value[key], properties[key], definitions)
      }
    }
    return score
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return Number.MAX_SAFE_INTEGER
    return value.reduce((score, item) => score + strictExampleScore(item, schema.items, definitions), 0)
  }
  if (schema.type === "string" && typeof value !== "string") return Number.MAX_SAFE_INTEGER
  if (schema.type === "integer" && !Number.isInteger(value)) return Number.MAX_SAFE_INTEGER
  return 0
}

function withoutRef(schema: SchemaNode): SchemaNode {
  const output = { ...schema }
  delete output.$ref
  return output
}

function isNullSchema(value: unknown): boolean {
  return isRecord(value) && value.type === "null"
}

function isNullableSchema(value: unknown): boolean {
  if (!isRecord(value) || (!Array.isArray(value.anyOf) && !Array.isArray(value.oneOf))) return false
  return ((value.anyOf ?? value.oneOf) as unknown[]).some(isNullSchema)
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function geminiDialect(node: unknown): unknown {
  if (Array.isArray(node)) return node.map((item) => geminiDialect(item))
  if (node === null || typeof node !== "object") return node
  const value = node as SchemaNode
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === "$schema" || key === "$id" || key === "minLength") continue
    if (key === "const") {
      output.enum = [child]
      continue
    }
    if (key === "oneOf") {
      output.anyOf = geminiDialect(child)
      continue
    }
    if (key === "definitions") {
      output.$defs = geminiDialect(child)
      continue
    }
    if (key === "$ref" && typeof child === "string") {
      output.$ref = child.replace("#/definitions/", "#/$defs/")
      continue
    }
    if (key === "additionalProperties" && child === false && typeof value.$ref === "string") continue
    output[key] = geminiDialect(child)
  }
  return output
}
