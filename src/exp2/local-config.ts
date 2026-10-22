import { execFileSync } from "node:child_process"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join, posix, relative, resolve, win32 } from "node:path"
import type { OpenCodeModelClient } from "../model/opencode-transport.js"
import { GoAnchorExtractor } from "./anchors.js"
import { binaryFromSource, goBuilder, goBuilderAsync } from "./build.js"
import { dockerGoBuilder, dockerGoBuilderAsync, DockerRunner, DockerScriptSandbox, type DockerOptions } from "./docker.js"
import { DEFAULT_LIMITS, type ExecutionLimits } from "./execution.js"
import { OpenCodeExecutor, type OpenCodeCodingClient } from "./opencode-executor.js"
import type { PlatformOptions } from "./platform.js"
import { DEFAULT_RESOURCE_LIMITS, LocalProcessRunner, LocalScriptSandbox, type ResourceLimits } from "./runner.js"
import { Serial, type SerialConfig } from "./serial.js"
import { Exp2Store } from "./store.js"
import type { AttributionTransport } from "./attribution.js"
import type { ChecksTransport } from "./checks.js"
import type { AdjudicationTransport } from "./adjudication.js"
import { emptyCassette, loadCassette, recordingTransports, saveCassette } from "./recording.js"
import { PROBE_CONCURRENCY, type ProbeTransport } from "./probes.js"
import type { JudgeTransport } from "./judge.js"
import { createOpenCodeJudgeTransport, createOpenCodeProbesTransport, createOpenCodeAdjudicationTransport, createOpenCodeAttributionTransport, createOpenCodeChecksTransport } from "./transport.js"

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
    probe_repairs?: number
    /** Mutants the discrimination measure runs a round at most (default 0: off; set it to measure check strength). */
    mutants?: number
    /** Probe runs side by side (default 4); each run is within the runner's resource limits. */
    probe_concurrency?: number
    execution?: Partial<ExecutionLimits>
  }
  /** `limits`: resource limits on the program under test (BLOCK10 §9.2; defaults DEFAULT_RESOURCE_LIMITS). */
  runner: { kind: "local"; limits?: Partial<ResourceLimits> } | ({ kind: "docker"; docker?: string[] } & Omit<DockerOptions, "docker">)
  tools?: { python?: string; go?: string }
  resume?: { wait_ms?: number; max_resumes?: number }
  /** Waits before retrying a rate-limited call; when they run out the call counts as a spent quota. */
  rate_limit?: { delays_ms: number[] }
  /**
   * Record every management call (attribution, checks, rulings) into this cassette, saved after each call; a run
   * resumed with the same file appends to it. Labelled with the model.
   */
  recording?: { cassette: string; label: string }
  /**
   * Probe writer and judge (BLOCK10 §1.2, §1.4) on the management server, each call a new session. Defaults:
   * gpt-6-sol-fast low and gpt-5.6-luna-fast medium, with the management server's provider. null switches them off.
   */
  roles?: null | { probes?: RoleConfig; judge?: RoleConfig; checks?: RoleConfig; adjudicate?: RoleConfig }
  /** Ablation switches (DESIGN §12b item 14); all default true. Kept in the state: an ablation run needs its own state. */
  ablation?: { zoning?: boolean; checks?: boolean; clauses?: boolean }
  /**
   * Post-round scoring: a command (with {round}, {commit}, {repo} filled in) that prints {"passed": n, "total": m}.
   * Its result goes into the checkpoint report only; the system never reads it.
   */
  scoring?: { command: string[] } | null
}

export interface RoleConfig { provider?: string; model?: string; variant?: string }

/**
 * The verifier (probes, judgments, library checks) comes from another source than the executor and never sees its
 * process; the adjudicator of disagreements is a session of its own, shown no reference code (DESIGN §12g). null
 * roles: probes and judge off.
 */
const VERIFIER = { model: "gpt-6-sol-fast", variant: "low" } as const
export const DEFAULT_ROLES = { probes: VERIFIER, judge: VERIFIER, checks: VERIFIER, adjudicate: { model: "gpt-5.6-luna-fast", variant: "medium" } } as const

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
  if (c.rate_limit && (!Array.isArray(c.rate_limit.delays_ms) || !c.rate_limit.delays_ms.every(d => Number.isFinite(d) && d >= 0))) p.push("rate_limit.delays_ms must be an array of non-negative numbers")
  if (c.scoring && (!Array.isArray(c.scoring.command) || !c.scoring.command.length)) p.push("scoring.command must be a non-empty array")
  // Checkpoints and builds outside the work tree: restoring a checkpoint cleans the work tree.
  const inside = (parent: string, child: string) => { const r = relative(resolve(parent), resolve(child)); return r === "" || (!r.startsWith("..") && !isAbsolute(r)) }
  if (c.repo_dir && c.checkpoints_dir && inside(c.repo_dir, c.checkpoints_dir)) p.push("checkpoints_dir must be outside repo_dir")
  if (c.repo_dir && c.builds_dir && inside(c.repo_dir, c.builds_dir)) p.push("builds_dir must be outside repo_dir")
  if (c.management?.directory && c.repo_dir && (inside(c.management.directory, c.repo_dir) || inside(c.repo_dir, c.management.directory))) p.push("management.directory and repo_dir must not be nested")
  return p
}

/**
 * One HTTP exchange over node:http, with no limit on how long the response headers take (fetch gives up after five
 * minutes, which a long coding prompt exceeds: O7). The caller's signal, or the configured request timeout, is the
 * watchdog.
 */
export function httpJson(url: URL, method: string, body: unknown, signal: AbortSignal): Promise<{ status: number; text: string }> {
  const send = url.protocol === "https:" ? httpsRequest : httpRequest
  return new Promise((done, fail) => {
    const data = body === undefined ? undefined : JSON.stringify(body)
    const req = send(url, { method, headers: { "Content-Type": "application/json", ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) }, signal }, res => {
      const chunks: Buffer[] = []
      res.on("data", c => chunks.push(c as Buffer))
      res.on("end", () => done({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }))
      res.on("error", fail)
    })
    req.on("error", fail)
    if (data) req.write(data)
    req.end()
  })
}

/** A minimal OpenCode HTTP client. Errors carry the status and the body, so quota and login failures can be told. */
export function openCodeHttpClient(server: ServerConfig): OpenCodeModelClient & OpenCodeCodingClient {
  const base = new URL(server.server_url)
  const request = async (path: string, method: string, body: unknown, directory: string, signal?: AbortSignal) => {
    const url = new URL(path, base)
    url.searchParams.set("directory", directory)
    const response = await httpJson(url, method, body, signal ?? AbortSignal.timeout(server.request_timeout_ms ?? 60 * 60_000))
    if (response.status < 200 || response.status >= 300) throw new Error(`OpenCode HTTP ${response.status}: ${response.text.slice(0, 2000)}`)
    return response.text ? JSON.parse(response.text) : {}
  }
  return {
    session: {
      create: async (r: { query: { directory: string }; body: { title: string } }) => request("/session", "POST", r.body, r.query.directory),
      prompt: async (r: { path: { id: string }; query: { directory: string }; body: unknown; signal?: AbortSignal }) => request(`/session/${encodeURIComponent(r.path.id)}/message`, "POST", r.body, r.query.directory, r.signal),
      abort: async (r: { path: { id: string }; query: { directory: string }; signal?: AbortSignal }) => request(`/session/${encodeURIComponent(r.path.id)}/abort`, "POST", {}, r.query.directory, r.signal),
      messages: async (r: { path: { id: string }; query: { directory: string } }) => request(`/session/${encodeURIComponent(r.path.id)}/message`, "GET", undefined, r.query.directory),
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
      const config = await response.json() as { plugin?: unknown[]; instructions?: unknown[]; permission?: Record<string, unknown> }
      if (name === "management" && (config.plugin?.length || config.instructions?.length)) problems.push("management server inherits plugins or instructions; use an isolated empty configuration")
      // A request to write outside the work tree must be refused at once, not wait for a person (O7, A3: 27 minutes).
      if (name === "coding" && config.permission?.external_directory !== "deny") problems.push("coding server: set permission.external_directory to \"deny\" so requests outside the work tree are refused instead of waiting")
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
  const rateLimit = c.rate_limit ? { delaysMs: c.rate_limit.delays_ms } : undefined
  // The program's name comes from the build command the requirements state.
  const texts = Array.from({ length: c.rounds }, (_, i) => join(at(c.inputs_dir), `round-${pad(i + 1)}.md`)).filter(existsSync).map(f => readFileSync(f, "utf8"))
  const binary = binaryFromSource(texts) ?? "app"
  const config: SerialConfig = {
    store: new Exp2Store(at(c.state_dir), c.run_id, c.ablation),
    workdir: at(c.repo_dir),
    checkpoints: at(c.checkpoints_dir),
    text: round => {
      const file = join(at(c.inputs_dir), `round-${pad(round)}.md`)
      if (!existsSync(file)) throw new Error(`No requirement text for round ${round}: ${file}`)
      return readFileSync(file, "utf8")
    },
    ...recorded(c, at, {
      attribution: createOpenCodeAttributionTransport(management, rateLimit), checks: createOpenCodeChecksTransport(roleOptions(management, c, "checks"), rateLimit), adjudicate: createOpenCodeAdjudicationTransport(roleOptions(management, c, "adjudicate"), rateLimit),
      ...(c.roles === null ? {} : { probes: createOpenCodeProbesTransport(roleOptions(management, c, "probes"), rateLimit), judge: createOpenCodeJudgeTransport(roleOptions(management, c, "judge"), rateLimit), ruling: createOpenCodeJudgeTransport(roleOptions(management, c, "adjudicate"), rateLimit) }),
    }),
    binary,
    platform,
    executor: () => new OpenCodeExecutor({ client: coding, providerId: c.coding.provider, modelId: c.coding.model, variant: c.coding.variant, agent: c.coding.agent, rateLimit }),
    executorIsStub: false,
    anchors: new GoAnchorExtractor(undefined, platform),
    runner: docker ? new DockerRunner(docker) : new LocalProcessRunner(platform, { ...DEFAULT_RESOURCE_LIMITS, ...c.runner.limits }),
    sandbox: docker ? new DockerScriptSandbox(docker) : new LocalScriptSandbox(platform),
    build: docker ? dockerGoBuilder(at(c.builds_dir), docker, undefined, binary) : goBuilder(at(c.builds_dir), platform, binary),
    buildAsync: docker ? dockerGoBuilderAsync(at(c.builds_dir), docker, undefined, binary) : goBuilderAsync(at(c.builds_dir), platform, binary),
    limits: {
      attributionRepairs: c.limits?.attribution_repairs ?? 2,
      checkRepairs: c.limits?.check_repairs ?? 2,
      managementTimeoutMs: c.limits?.management_timeout_ms ?? 30 * 60_000,
      checkTimeoutMs: c.limits?.check_timeout_ms ?? 60_000,
      probeRepairs: c.limits?.probe_repairs ?? 2,
      mutants: c.limits?.mutants ?? 0,
      probeConcurrency: c.limits?.probe_concurrency ?? PROBE_CONCURRENCY,
      execution: { ...DEFAULT_LIMITS, ...c.limits?.execution },
    },
    ...(c.scoring ? { score: scoringHook(c.scoring.command, at(c.repo_dir)) } : {}),
  }
  return { serial: new Serial(config), config }
}

function recorded(c: LocalConfig, at: (p: string) => string, t: { attribution: AttributionTransport; checks: ChecksTransport; adjudicate: AdjudicationTransport; probes?: ProbeTransport; judge?: JudgeTransport; ruling?: JudgeTransport }) {
  if (!c.recording) return t
  const file = at(c.recording.cassette)
  const cassette = existsSync(file) ? loadCassette(file) : emptyCassette(c.recording.label)
  // Written now, so a path that cannot be written stops the run before any call is made.
  saveCassette(file, cassette)
  const r = recordingTransports(t, cassette, file)
  return { attribution: r.attribution, checks: r.checks, adjudicate: r.adjudicate!, ...(r.probes ? { probes: r.probes, judge: r.judge!, ruling: r.ruling! } : {}) }
}

/** The management transport options with a role's model. */
export function roleOptions<T extends { providerId: string; modelId: string; variant?: string }>(management: T, c: LocalConfig, role: keyof typeof DEFAULT_ROLES): T {
  const r = { ...DEFAULT_ROLES[role], ...(c.roles?.[role] ?? {}) } as RoleConfig
  return { ...management, providerId: r.provider ?? management.providerId, modelId: r.model!, variant: r.variant }
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
