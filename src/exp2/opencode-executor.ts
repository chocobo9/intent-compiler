import type { TokenUsage } from "./attribution.js"
import type { Executor, ExecutorContext, ExecutorSession } from "./execution.js"
import { SessionBroken } from "./execution.js"
import { classifyProviderError, asProviderError, withRateLimitRetry, type RateLimitPolicy } from "./provider-errors.js"
import { QuotaExhausted } from "./attribution.js"

/** A quota or login failure is no broken session: it goes up as itself, so the serial waits or stops. */
function broken(what: string, e: unknown): Error {
  if (e instanceof QuotaExhausted) return e
  const kind = classifyProviderError(e)
  return kind === "auth" || kind === "quota" ? asProviderError(e) as Error : new SessionBroken(`${what} failed: ${(e as Error).message}`)
}

/**
 * The coding executor over OpenCode sessions (BLOCK9 §2.4–2.5), for the local run. One OpenCode session per
 * executor session, each message a plain prompt with the editing tools on (no structured output: a session that
 * used json_schema cannot list its messages, and the token count needs that list). Tokens are the sum over all
 * assistant messages of the session, taken after each prompt; a reply alone carries only its last message.
 */

export interface OpenCodeCodingClient {
  session: {
    create(request: { query: { directory: string }; body: { title: string } }): Promise<unknown>
    prompt(request: {
      path: { id: string }
      query: { directory: string }
      body: {
        model: { providerID: string; modelID: string }
        variant?: string
        agent: string
        system?: string
        parts: { type: "text"; text: string }[]
      }
    }): Promise<unknown>
    /** The session's messages ({info, parts}[]), for the token count. */
    messages?(request: { path: { id: string }; query: { directory: string } }): Promise<unknown>
    abort?(request: { path: { id: string }; query: { directory: string } }): Promise<unknown>
  }
}

export interface OpenCodeExecutorOptions {
  client: OpenCodeCodingClient
  providerId: string
  modelId: string
  variant?: string
  agent?: string
  /** Waits before re-sending a rate-limited prompt (default DEFAULT_RATE_LIMIT). */
  rateLimit?: RateLimitPolicy
}

export const EXECUTOR_SYSTEM_PROMPT = [
  "You implement a Go command-line program in the working directory from a work order. The source zone is the only authority on what the program must do.",
  "Do the whole task zone in this session; do not break what the protection zone lists; the status zone is information, not work.",
  "In the source zone, ⟦<id> → revised by <ids>⟧ marks text that later text revised: the text named after it is in force, not the marked text. ⟦<id> → amended by <ids>⟧ marks a code block or table that newer text corrects: both stand, and where they differ the newer wins. ⟦<id> → withdrawn by <ids>⟧ marks text that no longer holds.",
  "Do not commit; the controller builds, runs the acceptance checks and commits. When a message lists failing checks, make the program meet what they test; if you are sure a check contradicts the requirements, write a line `CONTEST <check id>: <block ids> <why>` instead of changing code for it.",
  "Stay inside the working directory, and do not run commands that wait for input (use git --no-pager).",
].join("\n")

const unwrap = (v: unknown): Record<string, any> => {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, any>
  return (r.data && typeof r.data === "object" ? r.data : r) as Record<string, any>
}

function tokensOf(info: Record<string, any> | undefined): TokenUsage {
  const t = info?.tokens ?? {}
  const n = (x: unknown) => typeof x === "number" && Number.isFinite(x) ? x : 0
  return { input_tokens: n(t.input), output_tokens: n(t.output), reasoning_tokens: n(t.reasoning), cache_read_tokens: n(t.cache?.read), cache_write_tokens: n(t.cache?.write) }
}

const add = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  input_tokens: a.input_tokens + b.input_tokens, cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens, cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens,
  output_tokens: a.output_tokens + b.output_tokens, reasoning_tokens: a.reasoning_tokens + b.reasoning_tokens,
})
const minus = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  input_tokens: a.input_tokens - b.input_tokens, cache_read_tokens: a.cache_read_tokens - b.cache_read_tokens, cache_write_tokens: a.cache_write_tokens - b.cache_write_tokens,
  output_tokens: a.output_tokens - b.output_tokens, reasoning_tokens: a.reasoning_tokens - b.reasoning_tokens,
})
const ZERO: TokenUsage = { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 }

/** The session's tokens: every assistant message, summed. */
export function sessionTokens(messages: unknown): TokenUsage | null {
  const list = Array.isArray(messages) ? messages : Array.isArray(unwrap(messages).messages) ? unwrap(messages).messages : null
  if (!list) return null
  return (list as unknown[]).map(unwrap).filter((m: Record<string, any>) => m.info?.role === "assistant").reduce((t: TokenUsage, m: Record<string, any>) => add(t, tokensOf(m.info)), ZERO)
}

export class OpenCodeExecutor implements Executor {
  constructor(private readonly options: OpenCodeExecutorOptions) {}
  async open(context: ExecutorContext): Promise<ExecutorSession> {
    const { client } = this.options
    let created: Record<string, any>
    try { created = unwrap(await client.session.create({ query: { directory: context.workdir }, body: { title: `exp2 R${context.round} coding` } })) } catch (e) { throw broken("session.create", e) }
    const id = String(created.id ?? "")
    if (!id) throw new SessionBroken("session.create returned no id")
    const options = this.options
    let counted = ZERO
    return {
      id,
      async send(text: string) {
        let r: Record<string, any>
        // A rate limit is waited out and the same prompt sent again; a provider failure can come back inside a normal reply.
        try {
          r = await withRateLimitRetry(async () => {
            const reply = unwrap(await client.session.prompt({
              path: { id }, query: { directory: context.workdir },
              body: { model: { providerID: options.providerId, modelID: options.modelId }, ...(options.variant ? { variant: options.variant } : {}), agent: options.agent ?? "build", system: EXECUTOR_SYSTEM_PROMPT, parts: [{ type: "text", text }] },
            }))
            if (reply.info?.error) throw new Error(JSON.stringify(reply.info.error))
            return reply
          }, options.rateLimit)
        } catch (e) { throw broken("session.prompt", e) }
        const note = (Array.isArray(r.parts) ? r.parts : []).filter((p: any) => p?.type === "text").map((p: any) => String(p.text)).join("\n")
        // Tokens of everything since the last count, from the whole message list; the reply's own count if that fails.
        let total: TokenUsage | null = null
        try { if (client.session.messages) total = sessionTokens(await client.session.messages({ path: { id }, query: { directory: context.workdir } })) } catch { total = null }
        const usage = total ? minus(total, counted) : tokensOf(r.info)
        if (total) counted = total
        return { usage, note }
      },
      async close() { try { await client.session.abort?.({ path: { id }, query: { directory: context.workdir } }) } catch { /* closing a finished session may fail; nothing depends on it */ } },
    }
  }
}
