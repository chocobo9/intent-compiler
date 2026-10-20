import type { TokenUsage } from "./attribution.js"
import type { ApprovedStep, Executor, ExecutorContext, ExecutorSession, StepProposal } from "./execution.js"
import { SessionBroken } from "./execution.js"

/**
 * The coding executor over OpenCode sessions (DESIGN §7), for the local run. One OpenCode session per executor
 * session: the plan is asked for with structured output, each step as a prompt with the editing tools on. A failed or
 * hung call raises SessionBroken, so the execution layer resets to the last checkpoint and opens a new session with
 * the steps left. Written against the OpenCode SDK's session API; not run in the cloud session.
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
        format?: { type: "json_schema"; schema: unknown; retryCount?: number }
        parts: { type: "text"; text: string }[]
      }
    }): Promise<unknown>
    abort?(request: { path: { id: string }; query: { directory: string } }): Promise<unknown>
  }
}

export interface OpenCodeExecutorOptions {
  client: OpenCodeCodingClient
  providerId: string
  modelId: string
  variant?: string
  agent?: string
}

export const PLAN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["steps"],
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["label", "objects", "summary"],
        properties: {
          label: { type: "string" },
          summary: { type: "string" },
          objects: { type: "array", items: { type: "object", additionalProperties: false, required: ["object", "coverage"], properties: { object: { type: "string" }, coverage: { type: "string", enum: ["full", "partial"] } } } },
        },
      },
    },
  },
}

export const EXECUTOR_SYSTEM_PROMPT = [
  "You implement a Go command-line program in the working directory from a work order. The source zone is the only authority on what the program must do.",
  "Do the task zone; do not break the protection zone (its checks are rerun after every step); the status zone is information, not work.",
  "First propose steps: each names the task-zone objects it covers, fully or partly; a shared foundation step may cover several objects partly, but every partly covered object needs a later step that covers it fully.",
  "Then do one step per request: edit the code for that step only. Do not commit; the controller builds, checks and commits. When a request lists problems from the previous attempt, fix those.",
].join("\n")

const unwrap = (v: unknown): Record<string, any> => {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, any>
  return (r.data && typeof r.data === "object" ? r.data : r) as Record<string, any>
}

function usageOf(response: Record<string, any>): TokenUsage {
  const t = response.info?.tokens ?? {}
  const n = (x: unknown) => typeof x === "number" && Number.isFinite(x) ? x : 0
  return { input_tokens: n(t.input), output_tokens: n(t.output), reasoning_tokens: n(t.reasoning), cache_read_tokens: n(t.cache?.read), cache_write_tokens: n(t.cache?.write) }
}

export class OpenCodeExecutor implements Executor {
  constructor(private readonly options: OpenCodeExecutorOptions) {}
  async open(context: ExecutorContext): Promise<ExecutorSession> {
    const { client } = this.options
    let created: Record<string, any>
    try { created = unwrap(await client.session.create({ query: { directory: context.workdir }, body: { title: `exp2 R${context.round} coding` } })) } catch (e) { throw new SessionBroken(`session.create failed: ${(e as Error).message}`) }
    const id = String(created.id ?? "")
    if (!id) throw new SessionBroken("session.create returned no id")
    const options = this.options
    const prompt = async (text: string, format?: { type: "json_schema"; schema: unknown; retryCount?: number }) => {
      try {
        return unwrap(await client.session.prompt({
          path: { id }, query: { directory: context.workdir },
          body: { model: { providerID: options.providerId, modelID: options.modelId }, ...(options.variant ? { variant: options.variant } : {}), agent: options.agent ?? "build", system: EXECUTOR_SYSTEM_PROMPT, ...(format ? { format } : {}), parts: [{ type: "text", text }] },
        }))
      } catch (e) { throw new SessionBroken(`session.prompt failed: ${(e as Error).message}`) }
    }
    const opening = context.resume
      ? `${context.text}\nA previous session stopped. Steps already committed: ${context.resume.done.join(", ") || "none"}. Do only the steps left: ${context.resume.remaining.map(s => `${s.id} ${s.label}`).join("; ")}.`
      : context.text
    let first = true
    return {
      id,
      async propose(feedback: string[]) {
        const text = `${first ? opening + "\n" : ""}Propose the steps.${feedback.length ? `\nThe previous plan was refused:\n- ${feedback.join("\n- ")}` : ""}`
        first = false
        const r = await prompt(text, { type: "json_schema", schema: PLAN_SCHEMA, retryCount: 0 })
        const steps = (r.info?.structured?.steps ?? []) as StepProposal[]
        return { steps, usage: usageOf(r) }
      },
      async work(step: ApprovedStep, feedback: string[]) {
        const text = `${first ? opening + "\n" : ""}Do step ${step.id} (${step.label}): ${step.summary}\nObjects: ${step.objects.map(o => `${o.object} ${o.coverage}`).join(", ")}${feedback.length ? `\nThe previous attempt failed:\n- ${feedback.join("\n- ")}` : ""}`
        first = false
        const r = await prompt(text)
        const note = (Array.isArray(r.parts) ? r.parts : []).filter((p: any) => p?.type === "text").map((p: any) => String(p.text)).join("\n").slice(0, 4000)
        return { usage: usageOf(r), note }
      },
      async close() { try { await client.session.abort?.({ path: { id }, query: { directory: context.workdir } }) } catch { /* closing a finished session may fail; nothing depends on it */ } },
    }
  }
}
