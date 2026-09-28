import {
  closeSync,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { randomBytes } from "node:crypto"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"

const OPENCODE_CONFIG_SCHEMA = "https://opencode.ai/config.json"

export interface PrdcheckRunConfigInput {
  runDir: string
  pluginEntryPath: string
}

export interface PrdcheckRunConfigResult {
  configPath: string
  pluginUrl: string
  created: boolean
}

export type PrdcheckRunConfigErrorCode =
  | "RUN_DIR_REQUIRED"
  | "RUN_DIR_NOT_ABSOLUTE"
  | "RUN_DIR_NOT_FOUND"
  | "RUN_DIR_NOT_DIRECTORY"
  | "PLUGIN_ENTRY_REQUIRED"
  | "PLUGIN_ENTRY_NOT_ABSOLUTE"
  | "PLUGIN_ENTRY_NOT_FOUND"
  | "PLUGIN_ENTRY_NOT_FILE"
  | "RUN_DIR_PLUGIN_OVERLAP"
  | "CONFIG_DIRECTORY_INVALID"
  | "CONFIG_CONFLICT"
  | "CONFIG_CREATE_FAILED"

export class PrdcheckRunConfigError extends Error {
  readonly code: PrdcheckRunConfigErrorCode

  constructor(code: PrdcheckRunConfigErrorCode, message: string) {
    super(message)
    this.name = "PrdcheckRunConfigError"
    this.code = code
  }
}

/**
 * Ensure the executor's project-local OpenCode config points at one existing
 * plugin entry. The target config is never overwritten.
 */
export function ensurePrdcheckRunConfig(input: PrdcheckRunConfigInput): PrdcheckRunConfigResult {
  const runDir = validateRunDirectory(input.runDir)
  const pluginEntry = validatePluginEntry(input.pluginEntryPath)

  if (isWithin(runDir, pluginEntry) || isWithin(pluginEntry, runDir)) {
    throw new PrdcheckRunConfigError(
      "RUN_DIR_PLUGIN_OVERLAP",
      `RUN_DIR and plugin entry must be disjoint: ${runDir} and ${pluginEntry}`,
    )
  }

  const pluginUrl = pathToFileURL(pluginEntry).href
  const configPath = join(runDir, ".opencode", "opencode.json")
  const expectedConfig = {
    $schema: OPENCODE_CONFIG_SCHEMA,
    plugin: [pluginUrl],
  } as const
  const contents = `${JSON.stringify(expectedConfig, null, 2)}\n`

  const existing = inspectExistingConfig(configPath, expectedConfig)
  if (existing === "equivalent") {
    return { configPath, pluginUrl, created: false }
  }

  ensureConfigDirectory(dirname(configPath))
  const created = atomicallyCreateConfig(configPath, contents)
  if (created) return { configPath, pluginUrl, created: true }

  if (inspectExistingConfig(configPath, expectedConfig) === "equivalent") {
    return { configPath, pluginUrl, created: false }
  }
  throw new PrdcheckRunConfigError(
    "CONFIG_CONFLICT",
    `OpenCode run config already exists with different content: ${configPath}`,
  )
}

function validateRunDirectory(input: string): string {
  const value = requiredPath(input, "RUN_DIR", "RUN_DIR_REQUIRED")
  if (!isAbsolute(value)) {
    throw new PrdcheckRunConfigError("RUN_DIR_NOT_ABSOLUTE", `RUN_DIR must be absolute: ${value}`)
  }
  const candidate = resolve(value)
  let stats: ReturnType<typeof statSync>
  try {
    stats = statSync(candidate)
  } catch (error) {
    if (isMissing(error)) {
      throw new PrdcheckRunConfigError("RUN_DIR_NOT_FOUND", `RUN_DIR does not exist: ${candidate}`)
    }
    throw new PrdcheckRunConfigError("RUN_DIR_NOT_FOUND", `RUN_DIR cannot be inspected: ${candidate}`)
  }
  if (!stats.isDirectory()) {
    throw new PrdcheckRunConfigError("RUN_DIR_NOT_DIRECTORY", `RUN_DIR is not a directory: ${candidate}`)
  }
  return realpathSync(candidate)
}

function validatePluginEntry(input: string): string {
  const value = requiredPath(input, "plugin entry", "PLUGIN_ENTRY_REQUIRED")
  if (!isAbsolute(value)) {
    throw new PrdcheckRunConfigError("PLUGIN_ENTRY_NOT_ABSOLUTE", `plugin entry must be absolute: ${value}`)
  }
  const candidate = resolve(value)
  let stats: ReturnType<typeof statSync>
  try {
    stats = statSync(candidate)
  } catch (error) {
    if (isMissing(error)) {
      throw new PrdcheckRunConfigError("PLUGIN_ENTRY_NOT_FOUND", `plugin entry does not exist: ${candidate}`)
    }
    throw new PrdcheckRunConfigError("PLUGIN_ENTRY_NOT_FOUND", `plugin entry cannot be inspected: ${candidate}`)
  }
  if (!stats.isFile()) {
    throw new PrdcheckRunConfigError("PLUGIN_ENTRY_NOT_FILE", `plugin entry is not a file: ${candidate}`)
  }
  return realpathSync(candidate)
}

function requiredPath(
  value: unknown,
  label: string,
  code: "RUN_DIR_REQUIRED" | "PLUGIN_ENTRY_REQUIRED",
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PrdcheckRunConfigError(code, `${label} must be a non-empty string`)
  }
  return value
}

function ensureConfigDirectory(configDirectory: string): void {
  try {
    mkdirSync(configDirectory, { recursive: true })
    if (!statSync(configDirectory).isDirectory()) {
      throw new PrdcheckRunConfigError(
        "CONFIG_DIRECTORY_INVALID",
        `OpenCode config path is not a directory: ${configDirectory}`,
      )
    }
  } catch (error) {
    if (error instanceof PrdcheckRunConfigError) throw error
    throw new PrdcheckRunConfigError(
      "CONFIG_DIRECTORY_INVALID",
      `OpenCode config directory cannot be created: ${configDirectory}`,
    )
  }
}

function inspectExistingConfig(
  configPath: string,
  expectedConfig: { readonly $schema: string; readonly plugin: readonly [string] },
): "absent" | "equivalent" | "different" {
  let stats: ReturnType<typeof lstatSync>
  try {
    stats = lstatSync(configPath)
  } catch (error) {
    if (isMissing(error)) return "absent"
    throw new PrdcheckRunConfigError("CONFIG_CONFLICT", `OpenCode run config cannot be inspected: ${configPath}`)
  }
  if (!stats.isFile()) {
    throw new PrdcheckRunConfigError(
      "CONFIG_CONFLICT",
      `OpenCode run config path is occupied by a non-file: ${configPath}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/u, "")) as unknown
  } catch {
    return "different"
  }
  return equivalentConfig(parsed, expectedConfig) ? "equivalent" : "different"
}

function equivalentConfig(
  value: unknown,
  expectedConfig: { readonly $schema: string; readonly plugin: readonly [string] },
): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.some((key) => key !== "$schema" && key !== "plugin")) return false
  if ("$schema" in record && record.$schema !== expectedConfig.$schema) return false
  return (
    Array.isArray(record.plugin) &&
    record.plugin.length === 1 &&
    record.plugin[0] === expectedConfig.plugin[0]
  )
}

function atomicallyCreateConfig(configPath: string, contents: string): boolean {
  const temporaryPath = join(
    dirname(configPath),
    `.opencode.json.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  )
  let fileDescriptor: number | undefined
  try {
    fileDescriptor = openSync(temporaryPath, "wx", 0o644)
    writeFileSync(fileDescriptor, contents, "utf8")
    fsyncSync(fileDescriptor)
    closeSync(fileDescriptor)
    fileDescriptor = undefined

    try {
      // A hard link publishes the complete temporary file without replacing a
      // config another process may have created in the meantime.
      linkSync(temporaryPath, configPath)
      return true
    } catch (error) {
      if (isAlreadyExists(error)) return false
      throw new PrdcheckRunConfigError(
        "CONFIG_CREATE_FAILED",
        `OpenCode run config cannot be created: ${configPath}`,
      )
    }
  } catch (error) {
    if (error instanceof PrdcheckRunConfigError) throw error
    throw new PrdcheckRunConfigError(
      "CONFIG_CREATE_FAILED",
      `OpenCode run config cannot be created: ${configPath}`,
    )
  } finally {
    if (fileDescriptor !== undefined) {
      try {
        closeSync(fileDescriptor)
      } catch {
        // Preserve the original creation error, if any.
      }
    }
    try {
      unlinkSync(temporaryPath)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
}

function isWithin(candidate: string, parent: string): boolean {
  const value = relative(parent, candidate)
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value))
}

function isMissing(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT"
}

function isAlreadyExists(error: unknown): boolean {
  return isNodeError(error) && error.code === "EEXIST"
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
