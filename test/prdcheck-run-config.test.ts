import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"
import {
  ensurePrdcheckRunConfig,
  PrdcheckRunConfigError,
  type PrdcheckRunConfigResult,
} from "../src/adapters/prdcheck-run-config.js"

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "prdcheck-run-config-"))
  temporaryDirectories.push(directory)
  return directory
}

test.after(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function pluginOutside(runDir: string): string {
  const pluginDirectory = temporaryDirectory()
  const pluginPath = join(pluginDirectory, "experiment-runtime.js")
  writeFileSync(pluginPath, "export default {}\n", "utf8")
  assert.equal(pluginPath.startsWith(runDir), false)
  return pluginPath
}

function expectCode(action: () => unknown, code: PrdcheckRunConfigError["code"]): void {
  assert.throws(action, (error: unknown) => error instanceof PrdcheckRunConfigError && error.code === code)
}

test("creates a project-local config with one absolute plugin file URL", () => {
  const runDir = temporaryDirectory()
  const pluginPath = pluginOutside(runDir)

  const result = ensurePrdcheckRunConfig({ runDir, pluginEntryPath: pluginPath })
  const expectedConfigPath = join(runDir, ".opencode", "opencode.json")
  const expectedPluginUrl = pathToFileURL(pluginPath).href
  const config = JSON.parse(readFileSync(expectedConfigPath, "utf8")) as Record<string, unknown>

  assert.deepEqual(result, {
    configPath: expectedConfigPath,
    pluginUrl: expectedPluginUrl,
    created: true,
  } satisfies PrdcheckRunConfigResult)
  assert.deepEqual(config, {
    $schema: "https://opencode.ai/config.json",
    plugin: [expectedPluginUrl],
  })
  assert.deepEqual(readdirSync(join(runDir, ".opencode")), ["opencode.json"])
})

test("treats equivalent JSON as idempotent and does not rewrite it", () => {
  const runDir = temporaryDirectory()
  const pluginPath = pluginOutside(runDir)
  const first = ensurePrdcheckRunConfig({ runDir, pluginEntryPath: pluginPath })
  const configPath = first.configPath
  const equivalent = `\n{\n  "plugin": [${JSON.stringify(first.pluginUrl)}],\n  "$schema": "https://opencode.ai/config.json"\n}\n`
  writeFileSync(configPath, equivalent, "utf8")

  const second = ensurePrdcheckRunConfig({ runDir, pluginEntryPath: pluginPath })

  assert.equal(second.created, false)
  assert.equal(readFileSync(configPath, "utf8"), equivalent)
})

test("rejects a different existing config without overwriting it", () => {
  const runDir = temporaryDirectory()
  const pluginPath = pluginOutside(runDir)
  const configPath = join(runDir, ".opencode", "opencode.json")
  const configDirectory = join(runDir, ".opencode")
  const original = '{"plugin":["file:///different/plugin.js"]}\n'
  mkdirSync(configDirectory, { recursive: true })
  writeFileSync(configPath, original, "utf8")

  expectCode(() => ensurePrdcheckRunConfig({ runDir, pluginEntryPath: pluginPath }), "CONFIG_CONFLICT")
  assert.equal(readFileSync(configPath, "utf8"), original)
})

test("rejects a missing run directory, invalid plugin entry, and overlapping paths", () => {
  const missingRunDir = join(temporaryDirectory(), "missing")
  const outsidePlugin = pluginOutside(missingRunDir)
  expectCode(() => ensurePrdcheckRunConfig({ runDir: missingRunDir, pluginEntryPath: outsidePlugin }), "RUN_DIR_NOT_FOUND")

  const runDir = temporaryDirectory()
  expectCode(
    () => ensurePrdcheckRunConfig({ runDir, pluginEntryPath: join(runDir, "missing-plugin.js") }),
    "PLUGIN_ENTRY_NOT_FOUND",
  )
  const directoryPlugin = join(temporaryDirectory(), "plugin-directory")
  mkdirSync(directoryPlugin, { recursive: true })
  expectCode(() => ensurePrdcheckRunConfig({ runDir, pluginEntryPath: directoryPlugin }), "PLUGIN_ENTRY_NOT_FILE")

  const overlappingPlugin = join(runDir, "plugin.js")
  writeFileSync(overlappingPlugin, "export default {}\n", "utf8")
  expectCode(() => ensurePrdcheckRunConfig({ runDir, pluginEntryPath: overlappingPlugin }), "RUN_DIR_PLUGIN_OVERLAP")
})

test("does not leave a temporary file after atomic creation", () => {
  const runDir = temporaryDirectory()
  const pluginPath = pluginOutside(runDir)
  ensurePrdcheckRunConfig({ runDir, pluginEntryPath: pluginPath })

  assert.deepEqual(readdirSync(join(runDir, ".opencode")), ["opencode.json"])
})
