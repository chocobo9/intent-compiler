import { createOpenCodeStructuredTransport, type OpenCodeModelTransportV2Options } from "../model/opencode-transport.js"
import { ATTRIBUTION_SCHEMA, ATTRIBUTION_SYSTEM_PROMPT, type AttributionTransport, type ModelRequest } from "./attribution.js"
import { CHECKS_SCHEMA, CHECKS_SYSTEM_PROMPT, type CheckRequest, type ChecksTransport } from "./checks.js"
import { withProviderErrors, type RateLimitPolicy } from "./provider-errors.js"

/**
 * The attribution step over OpenCode structured output. The first answer and every repair use the same system
 * prompt and schema (DESIGN §4.6), and the request repeats the same opening, so a repair can reuse the first call's
 * cached prefix. Not exercised against a real model in this block: offline tests use fixed answers.
 */
export function createOpenCodeAttributionTransport(options: OpenCodeModelTransportV2Options, rateLimit?: RateLimitPolicy): AttributionTransport {
  // Quota and login failures surface as QuotaExhausted and AuthInvalid; the serial waits on the one and stops on the other.
  const transport = withProviderErrors(createOpenCodeStructuredTransport<ModelRequest>(options, ATTRIBUTION_SYSTEM_PROMPT, ATTRIBUTION_SCHEMA), rateLimit)
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

/** The check-derivation step over OpenCode structured output: one schema and prompt for the first answer and repairs. */
export function createOpenCodeChecksTransport(options: OpenCodeModelTransportV2Options, rateLimit?: RateLimitPolicy): ChecksTransport {
  const transport = withProviderErrors(createOpenCodeStructuredTransport<CheckRequest>(options, CHECKS_SYSTEM_PROMPT, CHECKS_SCHEMA), rateLimit)
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
