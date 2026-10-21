import { AuthInvalid, QuotaExhausted } from "./attribution.js"

/**
 * Provider failures that are not a bad answer (DESIGN §14): a spent quota (wait, then resume from the checkpoint) and
 * an invalid login (stop and report). Recognised from the error text, including any diagnostic the transport
 * attached; anything else stays an ordinary failed call.
 */

const AUTH = [
  /invalidated oauth token/iu,
  /oauth token (?:has )?(?:expired|been revoked|is invalid)/iu,
  /invalid[_ ]api[_ ]key|incorrect api key/iu,
  /\bunauthori[sz]ed\b|\bHTTP 401\b|status(?: code)?:? 401\b/iu,
  /authentication (?:failed|required|error)/iu,
  /please (?:run )?(?:re-?)?(?:log ?in|authenticate)/iu,
]

const QUOTA = [
  /insufficient[_ ]quota|exceeded your current quota|quota (?:exceeded|exhausted|reached)/iu,
  /usage limit|usage_limit_reached|limit has been reached/iu,
  /rate[_ -]?limit|too many requests|\bHTTP 429\b|status(?: code)?:? 429\b/iu,
  /credit balance is too low|billing (?:hard )?limit/iu,
]

function textOf(e: unknown): string {
  if (!(e instanceof Error)) return String(e)
  const extra = e as Error & { diagnostic?: unknown; cause?: unknown; details?: unknown }
  const parts = [e.message]
  for (const x of [extra.diagnostic, extra.details, extra.cause]) if (x !== undefined) { try { parts.push(typeof x === "string" ? x : JSON.stringify(x)) } catch { parts.push(String(x)) } }
  return parts.join(" ")
}

export function classifyProviderError(e: unknown): "auth" | "quota" | null {
  const text = textOf(e)
  // An invalid login is checked first: a 401 page may also mention limits.
  if (AUTH.some(r => r.test(text))) return "auth"
  if (QUOTA.some(r => r.test(text))) return "quota"
  return null
}

/** The same error, as QuotaExhausted or AuthInvalid when it is one of those; otherwise unchanged. */
export function asProviderError(e: unknown): unknown {
  const kind = classifyProviderError(e)
  const message = e instanceof Error ? e.message : String(e)
  if (kind === "auth") return new AuthInvalid(message)
  if (kind === "quota") return new QuotaExhausted(message)
  return e
}

/** Wraps a transport so that quota and login failures surface as their own errors. */
export function withProviderErrors<R, A>(transport: (request: R) => Promise<A>): (request: R) => Promise<A> {
  return async request => {
    try { return await transport(request) } catch (e) { throw asProviderError(e) }
  }
}
