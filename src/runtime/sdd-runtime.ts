import { resolve, relative, isAbsolute } from "node:path"
import { createSddModel } from "../model/sdd-model.js"
import { SddCompiler } from "../core/sdd-compiler.js"
import type { OpenCodeModelClient } from "../model/opencode-transport.js"

export interface SddManagementConfig {
  server_url: string
  directory: string
  provider_id: string
  model_id: string
  variant: string
  request_timeout_ms: number
}
/** Connect to a separately configured tools-disabled management server. Does not launch one. */
export async function connectSddManagement(store: string, runId: string, config: SddManagementConfig): Promise<SddCompiler> {
  const base = new URL(config.server_url)
  if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) throw Error("Management server must be local")
  if (!isAbsolute(config.directory)) throw Error("Use an absolute isolated management directory")
  const directory = resolve(config.directory)
  const request = async (path: string, method = "GET", body?: unknown, signal?: AbortSignal) => {
    const url = new URL(path, base)
    url.searchParams.set("directory", directory)
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ?? AbortSignal.timeout(config.request_timeout_ms) })
    if (!response.ok) throw Error(`Management server HTTP ${response.status}`)
    return response.json()
  }
  const effective = await request("/config") as { plugin?: unknown[]; instructions?: unknown[] }
  if (effective.plugin?.length || effective.instructions?.length) throw Error("Management server inherits plugins/instructions; use an isolated empty configuration")
  const client: OpenCodeModelClient = { session: {
    create: async r => request("/session", "POST", r.body),
    prompt: async r => request(`/session/${encodeURIComponent(r.path.id)}/message`, "POST", r.body, r.signal),
    abort: async r => request(`/session/${encodeURIComponent(r.path.id)}/abort`, "POST", {}, r.signal),
  } }
  return new SddCompiler(store, runId, createSddModel({ client, directory, providerId: config.provider_id, modelId: config.model_id, variant: config.variant, timeoutMs: config.request_timeout_ms }))
}

export function requireSeparateDirectories(management: string, executor: string): void {
  const a = resolve(management), b = resolve(executor)
  const inside = (parent: string, child: string) => { const p = relative(parent, child); return p === "" || (!p.startsWith("..") && !isAbsolute(p)) }
  if (inside(a, b) || inside(b, a)) throw Error("Management and executor directories must be isolated siblings, not nested")
}
