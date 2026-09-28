import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, test } from "node:test"
import {
  runRealChainPreflight,
  type RealChainPreflightCheckId,
  type RealChainPreflightInput,
  type RealChainPreflightProbe,
} from "../src/runtime/real-chain-preflight.js"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): RealChainPreflightInput & { probeCalls: () => number; root: string } {
  const root = mkdtempSync(join(tmpdir(), "intent-real-chain-preflight-"))
  roots.push(root)
  const runDirectory = join(root, "executor-run")
  const compilerStoreDirectory = join(root, "compiler-store")
  const observerStoreDirectory = join(root, "observer-store")
  const compilerModelDirectory = join(root, "compiler-model")
  const external = join(root, "external-inputs")
  const pluginEntry = join(root, "plugin", "experiment-runtime.js")
  const userInputFile = join(external, "user.txt")
  const harnessSystemFile = join(external, "harness.txt")
  mkdirSync(join(runDirectory, ".opencode"), { recursive: true })
  mkdirSync(compilerStoreDirectory)
  mkdirSync(observerStoreDirectory)
  mkdirSync(compilerModelDirectory)
  mkdirSync(external)
  mkdirSync(join(root, "plugin"))
  writeFileSync(pluginEntry, "export const plugin = true\n", "utf8")
  writeFileSync(userInputFile, "真实用户输入", "utf8")
  writeFileSync(harnessSystemFile, "generated stage harness", "utf8")
  const pluginEntryFileUrl = pathToFileURL(pluginEntry).href
  writeFileSync(
    join(runDirectory, ".opencode", "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [pluginEntryFileUrl] }),
    "utf8",
  )

  let calls = 0
  const probe: RealChainPreflightProbe = {
    inspect: () => {
      calls += 1
      return {
        openCodeVersion: "1.18.31",
        providers: [{ id: "provider-explicit", modelIds: ["model-explicit", "model-other"] }],
      }
    },
  }
  return {
    root,
    probeCalls: () => calls,
    probe,
    providerId: "provider-explicit",
    modelId: "model-explicit",
    runDirectory,
    compilerStoreDirectory,
    observerStoreDirectory,
    compilerModelDirectory,
    pluginEntryFileUrl,
    userInputFile,
    harnessSystemFile,
    rawRequirementFile: userInputFile,
    concurrency: 1,
  }
}

function check(input: Awaited<ReturnType<typeof runRealChainPreflight>>, id: RealChainPreflightCheckId) {
  const result = input.checks.find((item) => item.id === id)
  assert.ok(result, `missing check ${id}`)
  return result
}

test("passes a complete no-model real-chain configuration through one injected diagnostic probe", async () => {
  const input = fixture()
  const result = await runRealChainPreflight(input)

  assert.equal(result.ok, true)
  assert.equal(input.probeCalls(), 1)
  assert.deepEqual(
    result.checks.map((item) => [item.id, item.passed]),
    [
      ["opencode_version", true],
      ["provider", true],
      ["model", true],
      ["directory_isolation", true],
      ["run_plugin_config", true],
      ["user_input_file", true],
      ["harness_system_file", true],
      ["raw_requirement_isolation", true],
      ["concurrency", true],
    ],
  )
})

test("reports every failed item without failing fast", async () => {
  const input = fixture()
  const insideUser = join(input.runDirectory, "raw.txt")
  const harnessDirectory = join(input.root, "not-a-file")
  writeFileSync(insideUser, "inside executor", "utf8")
  mkdirSync(harnessDirectory)
  writeFileSync(
    join(input.runDirectory, ".opencode", "opencode.json"),
    JSON.stringify({ plugin: [input.pluginEntryFileUrl, "file:///unexpected.js"] }),
    "utf8",
  )

  const result = await runRealChainPreflight({
    ...input,
    probe: {
      inspect: () => ({ openCodeVersion: "1.18.30", providers: [{ id: "different", modelIds: ["different"] }] }),
    },
    providerId: "missing-provider",
    modelId: "missing-model",
    compilerStoreDirectory: join(input.runDirectory, "compiler-store"),
    userInputFile: insideUser,
    harnessSystemFile: harnessDirectory,
    rawRequirementFile: insideUser,
    concurrency: 2,
  })

  assert.equal(result.ok, false)
  assert.equal(result.checks.length, 9)
  for (const item of result.checks) assert.equal(item.passed, false, item.id)
})

test("requires both channel files to be existing regular UTF-8 files outside RUN_DIR", async () => {
  const input = fixture()
  writeFileSync(input.userInputFile, Buffer.from([0xc3, 0x28]))

  const invalidUtf8 = await runRealChainPreflight(input)
  assert.equal(check(invalidUtf8, "user_input_file").passed, false)
  assert.match(check(invalidUtf8, "user_input_file").message, /valid UTF-8/u)
  assert.equal(check(invalidUtf8, "harness_system_file").passed, true)

  const missing = await runRealChainPreflight({ ...input, userInputFile: join(input.root, "missing-user.txt") })
  assert.equal(check(missing, "user_input_file").passed, false)
  assert.match(check(missing, "user_input_file").message, /exist/u)
})

test("requires the RUN_DIR config to contain only the exact caller plugin file URL", async () => {
  const input = fixture()
  writeFileSync(
    join(input.runDirectory, ".opencode", "opencode.json"),
    JSON.stringify({ plugin: [input.pluginEntryFileUrl, input.pluginEntryFileUrl] }),
    "utf8",
  )
  const duplicate = await runRealChainPreflight(input)
  assert.equal(check(duplicate, "run_plugin_config").passed, false)

  const wrongUrl = await runRealChainPreflight({ ...input, pluginEntryFileUrl: "https://example.test/plugin.js" })
  assert.equal(check(wrongUrl, "run_plugin_config").passed, false)
  assert.match(check(wrongUrl, "run_plugin_config").message, /absolute file URL/u)
})

test("turns a diagnostic probe failure into version, provider, and model failures only", async () => {
  const input = fixture()
  const result = await runRealChainPreflight({
    ...input,
    probe: { inspect: () => Promise.reject(new Error("diagnostic unavailable")) },
  })

  assert.equal(result.ok, false)
  assert.equal(check(result, "opencode_version").passed, false)
  assert.equal(check(result, "provider").passed, false)
  assert.equal(check(result, "model").passed, false)
  for (const id of [
    "directory_isolation",
    "run_plugin_config",
    "user_input_file",
    "harness_system_file",
    "raw_requirement_isolation",
    "concurrency",
  ] as const) {
    assert.equal(check(result, id).passed, true, id)
  }
})

test("checks a not-yet-materialized raw requirement path lexically outside RUN_DIR", async () => {
  const input = fixture()
  const result = await runRealChainPreflight({ ...input, rawRequirementFile: join(input.root, "future", "requirement.md") })
  assert.equal(check(result, "raw_requirement_isolation").passed, true)
})
