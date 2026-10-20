import { createOpenCodeStructuredTransport, type OpenCodeModelTransportV2Options } from "../model/opencode-transport.js"
import { ATTRIBUTION_SCHEMA, ATTRIBUTION_SYSTEM_PROMPT, REPAIR_SCHEMA, REPAIR_SYSTEM_PROMPT, type AttributionTransport, type ModelRequest } from "./attribution.js"

/**
 * The attribution step over OpenCode structured output. The first answer and a repair have different schemas and
 * prompts, so each gets its own transport (and its own session per call, as the shared transport does).
 * Not exercised in this block: offline tests use fixed answers.
 */
export function createOpenCodeAttributionTransport(options: OpenCodeModelTransportV2Options): AttributionTransport {
  const attribute = createOpenCodeStructuredTransport<ModelRequest>(options, ATTRIBUTION_SYSTEM_PROMPT, ATTRIBUTION_SCHEMA)
  const repair = createOpenCodeStructuredTransport<ModelRequest>(options, REPAIR_SYSTEM_PROMPT, REPAIR_SCHEMA)
  return async request => {
    const call = await (request.task === "repair" ? repair : attribute)(request)
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
