import { AuthInvalid, QuotaExhausted } from "./attribution.js"

/**
 * Provider failures that are not a bad answer (DESIGN §14, §12b item 3): a rate limit (back off briefly and retry
 * the same call), a spent quota (wait, then resume from the checkpoint) and an invalid login (stop and report).
 * Recognised from the error text, including any diagnostic the transport attached; anything else stays an
 * ordinary failed call. Only an explicit usage-limit text is a spent quota; a 429 or "rate limit" without one is a
 * rate limit, and a rate limit that outlasts its retries is then treated as a spent quota.
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
  /usage[_ ]limit|usage_limit_reached/iu,
  /credit balance is too low|billing (?:hard )?limit/iu,
]

const RATE_LIMIT = [
  /rate[_ -]?limit|too many requests|\bHTTP 429\b|status(?: code)?:? 429\b|limit has been reached/iu,
]

function textOf(e: unknown): string {
  if (!(e instanceof Error)) return String(e)
  const extra = e as Error & { diagnostic?: unknown; cause?: unknown; details?: unknown }
  const parts = [e.message]
  for (const x of [extra.diagnostic, extra.details, extra.cause]) if (x !== undefined) { try { parts.push(typeof x === "string" ? x : JSON.stringify(x)) } catch { parts.push(String(x)) } }
  return parts.join(" ")
}

export function classifyProviderError(e: unknown): "auth" | "quota" | "rate_limit" | null {
  const text = textOf(e)
  // An invalid login is checked first: a 401 page may also mention limits. A usage limit before a rate limit: a
  // spent quota often comes back as a 429 too.
  if (AUTH.some(r => r.test(text))) return "auth"
  if (QUOTA.some(r => r.test(text))) return "quota"
  if (RATE_LIMIT.some(r => r.test(text))) return "rate_limit"
  return null
}

export interface RateLimitPolicy {
  /** Waits before each retry; their number is the retries. */
  delaysMs: number[]
  sleep?: (ms: number) => Promise<void>
}

export const DEFAULT_RATE_LIMIT: RateLimitPolicy = { delaysMs: [15_000, 45_000, 120_000] }

/**
 * Calls again after a rate limit, with the policy's waits; these retries belong to this one call, not to the step's
 * attempts. When they run out, the rate limit is raised as a spent quota.
 */
export async function withRateLimitRetry<A>(call: () => Promise<A>, policy: RateLimitPolicy = DEFAULT_RATE_LIMIT): Promise<A> {
  const sleep = policy.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)))
  for (let n = 0; ; n++) {
    try { return await call() } catch (e) {
      if (classifyProviderError(e) !== "rate_limit") throw e
      if (n >= policy.delaysMs.length) throw new QuotaExhausted(`rate limited after ${n} retries: ${e instanceof Error ? e.message : String(e)}`)
      await sleep(policy.delaysMs[n])
    }
  }
}

/** The same error, as QuotaExhausted or AuthInvalid when it is one of those; otherwise unchanged (a rate limit too). */
export function asProviderError(e: unknown): unknown {
  const kind = classifyProviderError(e)
  const message = e instanceof Error ? e.message : String(e)
  if (kind === "auth") return new AuthInvalid(message)
  if (kind === "quota") return new QuotaExhausted(message)
  return e
}

/** Wraps a transport: rate limits are retried, and quota and login failures surface as their own errors. */
export function withProviderErrors<R, A>(transport: (request: R) => Promise<A>, policy: RateLimitPolicy = DEFAULT_RATE_LIMIT): (request: R) => Promise<A> {
  return async request => {
    try { return await withRateLimitRetry(() => transport(request), policy) } catch (e) { throw asProviderError(e) }
  }
}
