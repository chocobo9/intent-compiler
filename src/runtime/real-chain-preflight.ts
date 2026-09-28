import { readFileSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

export const REQUIRED_OPENCODE_VERSION = "1.18.31" as const

export interface RealChainProvider {
  readonly id: string
  readonly modelIds: readonly string[]
}

export interface RealChainProbeSnapshot {
  readonly openCodeVersion: string
  readonly providers: readonly RealChainProvider[]
}

/** A diagnostic probe only. It must not create a session or invoke a provider. */
export interface RealChainPreflightProbe {
  inspect(): RealChainProbeSnapshot | Promise<RealChainProbeSnapshot>
}

export interface RealChainPreflightInput {
  readonly probe: RealChainPreflightProbe
  readonly providerId: string
  readonly modelId: string
  readonly runDirectory: string
  readonly compilerStoreDirectory: string
  readonly observerStoreDirectory: string
  readonly compilerModelDirectory: string
  readonly pluginEntryFileUrl: string
  readonly userInputFile: string
  readonly harnessSystemFile: string
  readonly rawRequirementFile: string
  readonly concurrency: number
}

export type RealChainPreflightCheckId =
  | "opencode_version"
  | "provider"
  | "model"
  | "directory_isolation"
  | "run_plugin_config"
  | "user_input_file"
  | "harness_system_file"
  | "raw_requirement_isolation"
  | "concurrency"

export interface RealChainPreflightCheck {
  readonly id: RealChainPreflightCheckId
  readonly passed: boolean
  readonly message: string
}

export interface RealChainPreflightResult {
  readonly ok: boolean
  readonly checks: readonly RealChainPreflightCheck[]
}

/**
 * Inspect the complete real-chain configuration without creating an OpenCode
 * session or invoking a provider/model. Every check runs so callers receive a
 * complete preflight report instead of a fail-fast exception.
 */
export async function runRealChainPreflight(input: RealChainPreflightInput): Promise<RealChainPreflightResult> {
  let snapshot: RealChainProbeSnapshot | undefined
  let probeFailure: string | undefined
  try {
    snapshot = await input.probe.inspect()
    if (!validSnapshot(snapshot)) {
      snapshot = undefined
      probeFailure = "diagnostic probe returned an invalid snapshot"
    }
  } catch (error: unknown) {
    probeFailure = errorMessage(error)
  }

  const checks: RealChainPreflightCheck[] = [
    checkOpenCodeVersion(snapshot, probeFailure),
    checkProvider(input.providerId, snapshot, probeFailure),
    checkModel(input.providerId, input.modelId, snapshot, probeFailure),
    capture("directory_isolation", () => checkDirectories(input)),
    capture("run_plugin_config", () => checkRunPluginConfig(input.runDirectory, input.pluginEntryFileUrl)),
    capture("user_input_file", () => checkExternalUtf8File(input.userInputFile, input.runDirectory, "user input file")),
    capture("harness_system_file", () =>
      checkExternalUtf8File(input.harnessSystemFile, input.runDirectory, "harness system file"),
    ),
    capture("raw_requirement_isolation", () =>
      checkRawRequirementIsolation(input.rawRequirementFile, input.runDirectory),
    ),
    input.concurrency === 1
      ? pass("concurrency", "concurrency is exactly 1")
      : fail("concurrency", "concurrency must be exactly 1"),
  ]

  return Object.freeze({ ok: checks.every((check) => check.passed), checks: Object.freeze(checks) })
}

function checkOpenCodeVersion(
  snapshot: RealChainProbeSnapshot | undefined,
  probeFailure: string | undefined,
): RealChainPreflightCheck {
  if (probeFailure !== undefined) return fail("opencode_version", `diagnostic probe failed: ${probeFailure}`)
  if (!snapshot || snapshot.openCodeVersion !== REQUIRED_OPENCODE_VERSION) {
    return fail(
      "opencode_version",
      `OpenCode version must be exactly ${REQUIRED_OPENCODE_VERSION}; observed ${JSON.stringify(snapshot?.openCodeVersion)}`,
    )
  }
  return pass("opencode_version", `OpenCode version is exactly ${REQUIRED_OPENCODE_VERSION}`)
}

function checkProvider(
  providerId: string,
  snapshot: RealChainProbeSnapshot | undefined,
  probeFailure: string | undefined,
): RealChainPreflightCheck {
  if (!nonEmpty(providerId)) return fail("provider", "providerId must be explicit non-empty text")
  if (probeFailure !== undefined) return fail("provider", `diagnostic probe failed: ${probeFailure}`)
  const found = snapshot?.providers.some((provider) => provider.id === providerId) ?? false
  return found
    ? pass("provider", `provider ${providerId} exists`)
    : fail("provider", `provider ${providerId} does not exist in the diagnostic catalogue`)
}

function checkModel(
  providerId: string,
  modelId: string,
  snapshot: RealChainProbeSnapshot | undefined,
  probeFailure: string | undefined,
): RealChainPreflightCheck {
  if (!nonEmpty(modelId)) return fail("model", "modelId must be explicit non-empty text")
  if (!nonEmpty(providerId)) return fail("model", "model cannot be resolved without an explicit providerId")
  if (probeFailure !== undefined) return fail("model", `diagnostic probe failed: ${probeFailure}`)
  const provider = snapshot?.providers.find((candidate) => candidate.id === providerId)
  const found = provider?.modelIds.includes(modelId) ?? false
  return found
    ? pass("model", `model ${providerId}/${modelId} exists`)
    : fail("model", `model ${providerId}/${modelId} does not exist in the diagnostic catalogue`)
}

function checkDirectories(input: RealChainPreflightInput): string {
  const entries = [
    ["RUN_DIR", input.runDirectory],
    ["Compiler store", input.compilerStoreDirectory],
    ["Observer store", input.observerStoreDirectory],
    ["Compiler model directory", input.compilerModelDirectory],
  ] as const
  for (const [label, value] of entries) requireAbsolute(value, label)

  const normalized = entries.map(([label, value]) => [label, canonicalPath(value)] as const)
  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      if (pathsOverlap(normalized[left][1], normalized[right][1])) {
        throw new Error(`${normalized[left][0]} and ${normalized[right][0]} must not overlap`)
      }
    }
  }
  return "RUN_DIR, Compiler store, Observer store, and Compiler model directory are absolute and mutually external"
}

function checkRunPluginConfig(runDirectory: string, pluginEntryFileUrl: string): string {
  const run = requireAbsolute(runDirectory, "RUN_DIR")
  if (!nonEmpty(pluginEntryFileUrl)) throw new Error("plugin entry file URL must be non-empty")

  let pluginPath: string
  try {
    const url = new URL(pluginEntryFileUrl)
    if (url.protocol !== "file:") throw new Error("URL protocol is not file:")
    pluginPath = fileURLToPath(url)
    if (!isAbsolute(pluginPath)) throw new Error("file URL does not resolve to an absolute path")
  } catch (error: unknown) {
    throw new Error(`plugin entry must be an absolute file URL: ${errorMessage(error)}`)
  }
  requireRegularFile(pluginPath, "plugin entry")

  const configPath = join(run, ".opencode", "opencode.json")
  const config = readUtf8Json(configPath, "RUN_DIR local OpenCode config")
  if (!isRecord(config) || !Array.isArray(config.plugin)) {
    throw new Error("RUN_DIR local OpenCode config must contain a plugin array")
  }
  if (config.plugin.length !== 1 || config.plugin[0] !== pluginEntryFileUrl) {
    throw new Error("RUN_DIR local OpenCode config must reference exactly the supplied plugin entry file URL")
  }
  return "RUN_DIR local OpenCode config references exactly the supplied plugin entry file URL"
}

function checkExternalUtf8File(path: string, runDirectory: string, label: string): string {
  const run = existingDirectory(requireAbsolute(runDirectory, "RUN_DIR"), "RUN_DIR")
  const lexical = requireAbsolute(path, label)
  if (isWithin(lexical, run)) throw new Error(`${label} must be outside RUN_DIR`)

  const realRun = realpathSync(run)
  const realFile = realpath(lexical, label)
  if (isWithin(realFile, realRun)) throw new Error(`${label} must be outside RUN_DIR`)
  requireRegularFile(realFile, label)
  readUtf8(realFile, label)
  return `${label} is an external regular UTF-8 file`
}

function checkRawRequirementIsolation(path: string, runDirectory: string): string {
  const run = existingDirectory(requireAbsolute(runDirectory, "RUN_DIR"), "RUN_DIR")
  const requirement = requireAbsolute(path, "raw requirement file")
  if (isWithin(requirement, run)) throw new Error("raw requirement file must be outside RUN_DIR")

  const realRun = realpathSync(run)
  if (isWithin(canonicalPath(requirement), realRun)) throw new Error("raw requirement file must be outside RUN_DIR")
  return "raw requirement file is outside RUN_DIR"
}

function capture(id: RealChainPreflightCheckId, check: () => string): RealChainPreflightCheck {
  try {
    return pass(id, check())
  } catch (error: unknown) {
    return fail(id, errorMessage(error))
  }
}

function pass(id: RealChainPreflightCheckId, message: string): RealChainPreflightCheck {
  return Object.freeze({ id, passed: true, message })
}

function fail(id: RealChainPreflightCheckId, message: string): RealChainPreflightCheck {
  return Object.freeze({ id, passed: false, message })
}

function readUtf8Json(path: string, label: string): unknown {
  requireRegularFile(path, label)
  const text = readUtf8(path, label)
  try {
    return JSON.parse(text) as unknown
  } catch (error: unknown) {
    throw new Error(`${label} must contain valid JSON: ${errorMessage(error)}`)
  }
}

function readUtf8(path: string, label: string): string {
  let bytes: Buffer
  try {
    bytes = readFileSync(path)
  } catch (error: unknown) {
    throw new Error(`${label} could not be read: ${errorMessage(error)}`)
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw new Error(`${label} must contain valid UTF-8 text`)
  }
}

function requireRegularFile(path: string, label: string): void {
  let stats
  try {
    stats = statSync(path)
  } catch (error: unknown) {
    throw new Error(`${label} must exist and be readable: ${errorMessage(error)}`)
  }
  if (!stats.isFile()) throw new Error(`${label} must be a regular file`)
}

function existingDirectory(path: string, label: string): string {
  let stats
  try {
    stats = statSync(path)
  } catch (error: unknown) {
    throw new Error(`${label} must exist and be readable: ${errorMessage(error)}`)
  }
  if (!stats.isDirectory()) throw new Error(`${label} must be a directory`)
  return path
}

function realpath(path: string, label: string): string {
  try {
    return realpathSync(path)
  } catch (error: unknown) {
    throw new Error(`${label} must exist and be resolvable: ${errorMessage(error)}`)
  }
}

function requireAbsolute(value: string, label: string): string {
  if (typeof value !== "string" || !isAbsolute(value)) throw new Error(`${label} must be an absolute path`)
  return resolve(value)
}

function canonicalPath(path: string): string {
  const absolute = resolve(path)
  let current = absolute
  const missing: string[] = []
  while (true) {
    try {
      return resolve(realpathSync(current), ...missing)
    } catch {
      const parent = dirname(current)
      if (parent === current) return absolute
      missing.unshift(basename(current))
      current = parent
    }
  }
}

function pathsOverlap(left: string, right: string): boolean {
  return isWithin(left, right) || isWithin(right, left)
}

function isWithin(candidate: string, parent: string): boolean {
  const normalize = (value: string): string => (process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value))
  const path = relative(normalize(parent), normalize(candidate))
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function validSnapshot(value: unknown): value is RealChainProbeSnapshot {
  if (!isRecord(value) || typeof value.openCodeVersion !== "string" || !Array.isArray(value.providers)) return false
  return value.providers.every(
    (provider) =>
      isRecord(provider) &&
      typeof provider.id === "string" &&
      Array.isArray(provider.modelIds) &&
      provider.modelIds.every((modelId) => typeof modelId === "string"),
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
