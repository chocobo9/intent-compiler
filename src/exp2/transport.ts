import { createOpenCodeStructuredTransport, type OpenCodeModelTransportV2Options } from "../model/opencode-transport.js"
import { ATTRIBUTION_SCHEMA, ATTRIBUTION_SYSTEM_PROMPT, type AttributionTransport, type ModelRequest } from "./attribution.js"

/**
 * The attribution step over OpenCode structured output. The first answer and every repair use the same system
 * prompt and schema (DESIGN §4.6), and the request repeats the same opening, so a repair can reuse the first call's
 * cached prefix. Not exercised against a real model in this block: offline tests use fixed answers.
 */
export function createOpenCodeAttributionTransport(options: OpenCodeModelTransportV2Options): AttributionTransport {
  const transport = createOpenCodeStructuredTransport<ModelRequest>(options, ATTRIBUTION_SYSTEM_PROMPT, ATTRIBUTION_SCHEMA)
  return async request => {
    const call = await transport(request)
    return {
      text: call.text,
      usage: call.usage,
      stub: false,
      ...(call.model ? { model: call.model } : {}),
      ...(call.provider ? { provider: call.provider } : {}),
      ...(call.started_at ? { started_at: call.started_at } : {}),
      ...(call.completed_at ? { completed_at: call.completed_at } : {}),
      ...(call.structured_schema_errors?.length ? { schema_errors: call.structured_schema_errors } : {}),
    }
  }
}
