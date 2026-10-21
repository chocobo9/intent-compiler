import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join, posix, relative, resolve, win32 } from "node:path"
import type { OpenCodeModelClient } from "../model/opencode-transport.js"
import { GoAnchorExtractor } from "./anchors.js"
import { goBuilder } from "./build.js"
import { dockerGoBuilder, DockerRunner, DockerScriptSandbox, type DockerOptions } from "./docker.js"
import { DEFAULT_LIMITS, type ExecutionLimits } from "./execution.js"
import { OpenCodeExecutor, type OpenCodeCodingClient } from "./opencode-executor.js"
import type { PlatformOptions } from "./platform.js"
import { LocalProcessRunner, LocalScriptSandbox } from "./runner.js"
import { Serial, type SerialConfig } from "./serial.js"
import { Exp2Store } from "./store.js"
import { createOpenCodeAttributionTransport, createOpenCodeChecksTransport } from "./transport.js"

/**
 * The local run's configuration file and its assembly into a Serial (READY-FOR-LOCAL §0). Paths are resolved
 * against the configuration file's directory. Running again with the same file resumes from the latest checkpoint.
 */

export interface ServerConfig {
  server_url: string
  /** The server's working directory (absolute). */
  directory: string
  provider: string
  model: string
  variant?: string
  request_timeout_ms?: number
}

export interface LocalConfig {
  run_id: string
  inputs_dir: string
  state_dir: string
  checkpoints_dir: string
  repo_dir: string
  builds_dir: string
  rounds: number
  /** The tools-off server for attribution and check derivation. */
  management: ServerConfig
  /** The coding server (tools on); defaults to the management server's model settings. */
  coding: ServerConfig & { agent?: string }
  limits?: {
    attribution_repairs?: number
    check_repairs?: number
    management_timeout_ms?: number
    check_timeout_ms?: number
    execution?: Partial<ExecutionLimits>
  }
  runner: { kind: "local" } | ({ kind: "docker"; docker?: string[] } & Omit<DockerOptions, "docker">)
  tools?: { python?: string; go?: string }
  resume?: { wait_ms?: number; max_resumes?: number }
  /**
   * Post-round scoring: a command (with {round}, {commit}, {repo} filled in) that prints {"passed": n, "total": m}.
   * Its result goes into the checkpoint report only; the system never reads it.
   */
  scoring?: { command: string[] } | null
}

/** Absolute on either platform: the file is written for the Windows machine and checked anywhere. */
const absolute = (p: string) => win32.isAbsolute(p) || posix.isAbsolute(p)

const isLocalHost = (url: string) => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)

export function loadLocalConfig(file: string): LocalConfig & { base: string } {
  const raw = JSON.parse(readFileSync(file, "utf8")) as LocalConfig
  const base = resolve(file, "..")
  const problems = localConfigProblems(raw)
  if (problems.length) throw new Error(`Invalid exp2 config ${file}:\n- ${problems.join("\n- ")}`)
  return { ...raw, base }
}

export function localConfigProblems(c: LocalConfig): string[] {
  const p: string[] = []
  for (const k of ["run_id", "inputs_dir", "state_dir", "checkpoints_dir", "repo_dir", "builds_dir"] as const) if (typeof c[k] !== "string" || !c[k]) p.push(`${k} must be a non-empty string`)
  if (!Number.isSafeInteger(c.rounds) || c.rounds < 1) p.push("rounds must be a positive integer")
  for (const [name, s] of [["management", c.management], ["coding", c.coding]] as const) {
    if (!s || typeof s !== "object") { p.push(`${name} is required`); continue }
    try { if (!isLocalHost(s.server_url)) p.push(`${name}.server_url must be a local server`) } catch { p.push(`${name}.server_url is not a URL`) }
    if (!s.directory || !absolute(s.directory)) p.push(`${name}.directory must be an absolute path`)
    if (!s.provider || !s.model) p.push(`${name}.provider and ${name}.model are required`)
  }
  if (c.runner?.kind !== "local" && c.runner?.kind !== "docker") p.push("runner.kind must be local or docker")
  if (c.runner?.kind === "docker" && !c.runner.image) p.push("runner.image is required for docker")
  if (c.scoring && (!Array.isArray(c.scoring.command) || !c.scoring.command.length)) p.push("scoring.command must be a non-empty array")
  // Checkpoints and builds outside the work tree: restoring a checkpoint cleans the work tree.
  const inside = (parent: string, child: string) => { const r = relative(resolve(parent), resolve(child)); return r === "" || (!r.startsWith("..") && !isAbsolute(r)) }
  if (c.repo_dir && c.checkpoints_dir && inside(c.repo_dir, c.checkpoints_dir)) p.push("checkpoints_dir must be outside repo_dir")
  if (c.repo_dir && c.builds_dir && inside(c.repo_dir, c.builds_dir)) p.push("builds_dir must be outside repo_dir")
  if (c.management?.directory && c.repo_dir && (inside(c.management.directory, c.repo_dir) || inside(c.repo_dir, c.management.directory))) p.push("management.directory and repo_dir must not be nested")
  return p
}

/** A minimal OpenCode HTTP client. Errors carry the status and the body, so quota and login failures can be told. */
export function openCodeHttpClient(server: ServerConfig): OpenCodeModelClient & OpenCodeCodingClient {
  const base = new URL(server.server_url)
  const request = async (path: string, method: string, body: unknown, directory: string, signal?: AbortSignal) => {
    const url = new URL(path, base)
    url.searchParams.set("directory", directory)
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ?? AbortSignal.timeout(server.request_timeout_ms ?? 30 * 60_000) })
    const text = await response.text()
    if (!response.ok) throw new Error(`OpenCode HTTP ${response.status}: ${text.slice(0, 2000)}`)
    return text ? JSON.parse(text) : {}
  }
  return {
    session: {
      create: async (r: { query: { directory: string }; body: { title: string } }) => request("/session", "POST", r.body, r.query.directory),
      prompt: async (r: { path: { id: string }; query: { directory: string }; body: unknown; signal?: AbortSignal }) => request(`/session/${encodeURIComponent(r.path.id)}/message`, "POST", r.body, r.query.directory, r.signal),
      abort: async (r: { path: { id: string }; query: { directory: string }; signal?: AbortSignal }) => request(`/session/${encodeURIComponent(r.path.id)}/abort`, "POST", {}, r.query.directory, r.signal),
    },
  } as OpenCodeModelClient & OpenCodeCodingClient
}

/**
 * Before a run: the management server must be an isolated, tools-off configuration (no plugins, no instructions
 * inherited), as the SDD management runtime requires; and both servers must answer.
 */
export async function preflight(c: LocalConfig, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const problems: string[] = []
  for (const [name, s] of [["management", c.management], ["coding", c.coding]] as const) {
    try {
      const url = new URL("/config", s.server_url)
      url.searchParams.set("directory", s.directory)
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) })
      if (!response.ok) { problems.push(`${name} server: HTTP ${response.status}`); continue }
      const config = await response.json() as { plugin?: unknown[]; instructions?: unknown[] }
      if (name === "management" && (config.plugin?.length || config.instructions?.length)) problems.push("management server inherits plugins or instructions; use an isolated empty configuration")
    } catch (e) { problems.push(`${name} server unreachable: ${(e as Error).message}`) }
  }
  return problems
}

const pad = (n: number) => String(n).padStart(2, "0")

/** Builds the Serial a configuration describes, without running anything. */
export function assembleSerial(c: LocalConfig & { base: string }): { serial: Serial; config: SerialConfig } {
  const at = (p: string) => (absolute(p) ? p : join(c.base, p))
  const platform: PlatformOptions = { python: c.tools?.python, go: c.tools?.go }
  const docker = c.runner.kind === "docker" ? { ...c.runner } as DockerOptions : null
  const management = { client: openCodeHttpClient(c.management), directory: c.management.directory, providerId: c.management.provider, modelId: c.management.model, variant: c.management.variant, timeoutMs: c.management.request_timeout_ms }
  const coding = openCodeHttpClient(c.coding)
  const config: SerialConfig = {
    store: new Exp2Store(at(c.state_dir), c.run_id),
    workdir: at(c.repo_dir),
    checkpoints: at(c.checkpoints_dir),
    text: round => {
      const file = join(at(c.inputs_dir), `round-${pad(round)}.md`)
      if (!existsSync(file)) throw new Error(`No requirement text for round ${round}: ${file}`)
      return readFileSync(file, "utf8")
    },
    attribution: createOpenCodeAttributionTransport(management),
    checks: createOpenCodeChecksTransport(management),
    executor: () => new OpenCodeExecutor({ client: coding, providerId: c.coding.provider, modelId: c.coding.model, variant: c.coding.variant, agent: c.coding.agent }),
    executorIsStub: false,
    anchors: new GoAnchorExtractor(undefined, platform),
    runner: docker ? new DockerRunner(docker) : new LocalProcessRunner(platform),
    sandbox: docker ? new DockerScriptSandbox(docker) : new LocalScriptSandbox(platform),
    build: docker ? dockerGoBuilder(at(c.builds_dir), docker) : goBuilder(at(c.builds_dir), platform),
    limits: {
      attributionRepairs: c.limits?.attribution_repairs ?? 2,
      checkRepairs: c.limits?.check_repairs ?? 2,
      managementTimeoutMs: c.limits?.management_timeout_ms ?? 30 * 60_000,
      checkTimeoutMs: c.limits?.check_timeout_ms ?? 60_000,
      execution: { ...DEFAULT_LIMITS, ...c.limits?.execution },
    },
    ...(c.scoring ? { score: scoringHook(c.scoring.command, at(c.repo_dir)) } : {}),
  }
  return { serial: new Serial(config), config }
}

/** Runs the scoring command for a round; its stdout must be {"passed": n, "total": m}. */
export function scoringHook(command: string[], repo: string): (round: number, commit: string) => Promise<{ passed: number; total: number } | null> {
  return async (round, commit) => {
    const fill = (s: string) => s.replaceAll("{round}", String(round)).replaceAll("{commit}", commit).replaceAll("{repo}", repo)
    const [cmd, ...args] = command.map(fill)
    const out = execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    const parsed = JSON.parse(out) as { passed?: unknown; total?: unknown }
    if (!Number.isSafeInteger(parsed.passed) || !Number.isSafeInteger(parsed.total)) throw new Error(`scoring output is not {passed, total}: ${out.slice(0, 200)}`)
    return { passed: parsed.passed as number, total: parsed.total as number }
  }
}
