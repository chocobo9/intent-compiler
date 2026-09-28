#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { isAbsolute } from "node:path"
import { pathToFileURL } from "node:url"
import { runRealChainPreflight, type RealChainProbeSnapshot } from "../runtime/real-chain-preflight.js"

const options = parseArgs(process.argv.slice(2))
const openCodeCommand = options.opencode ?? "opencode"

const result = await runRealChainPreflight({
  probe: {
    inspect: () => inspectOpenCode(openCodeCommand),
  },
  providerId: required(options, "provider"),
  modelId: required(options, "model"),
  runDirectory: required(options, "run-dir"),
  compilerStoreDirectory: required(options, "compiler-store"),
  observerStoreDirectory: required(options, "observer-store"),
  compilerModelDirectory: required(options, "model-dir"),
  pluginEntryFileUrl: pathToFileURL(requiredAbsolutePath(options, "plugin-entry")).href,
  userInputFile: required(options, "user-input-file"),
  harnessSystemFile: required(options, "harness-system-file"),
  rawRequirementFile: required(options, "raw-requirement-file"),
  concurrency: requiredInteger(options, "concurrency"),
})

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (!result.ok) process.exitCode = 1

function inspectOpenCode(command: string): RealChainProbeSnapshot {
  const version = execute(command, ["--version"]).trim()
  const providers = new Map<string, string[]>()
  for (const line of execute(command, ["models"]).split(/\r?\n/u)) {
    const value = line.trim()
    if (value.length === 0) continue
    const separator = value.indexOf("/")
    if (separator <= 0 || separator === value.length - 1) {
      throw new Error(`unexpected opencode models line: ${JSON.stringify(value)}`)
    }
    const providerId = value.slice(0, separator)
    const modelId = value.slice(separator + 1)
    const modelIds = providers.get(providerId) ?? []
    if (!modelIds.includes(modelId)) modelIds.push(modelId)
    providers.set(providerId, modelIds)
  }
  return {
    openCodeVersion: version,
    providers: [...providers].map(([id, modelIds]) => ({ id, modelIds })),
  }
}

function execute(command: string, args: readonly string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      // npm exposes OpenCode as a .cmd/.ps1 wrapper on Windows. Node cannot
      // execute those wrappers directly; an explicit .exe remains direct.
      shell: process.platform === "win32" && !command.toLowerCase().endsWith(".exe"),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${command} ${args.join(" ")} failed: ${message}`)
  }
}

function parseArgs(args: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument: ${key ?? "<missing>"}`)
    const name = key.slice(2)
    if (result[name] !== undefined) throw new Error(`duplicate argument: --${name}`)
    result[name] = value
  }
  return result
}

function required(options: Record<string, string>, name: string): string {
  const value = options[name]
  if (value === undefined || value.length === 0) throw new Error(`--${name} is required`)
  return value
}

function requiredInteger(options: Record<string, string>, name: string): number {
  const raw = required(options, name)
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) throw new Error(`--${name} must be an integer`)
  return value
}

function requiredAbsolutePath(options: Record<string, string>, name: string): string {
  const value = required(options, name)
  if (!isAbsolute(value)) throw new Error(`--${name} must be an absolute path`)
  return value
}
