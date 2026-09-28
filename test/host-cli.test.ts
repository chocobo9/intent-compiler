import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import test from "node:test"

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "intent-host-cli-"))
  temporaryDirectories.push(directory)
  return directory
}

test.after(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

test("prdcheck run-config command creates only the requested local config", () => {
  const root = temporaryDirectory()
  const runDir = join(root, "run")
  const pluginDir = join(root, "plugin")
  const pluginEntry = join(pluginDir, "experiment-runtime.js")
  mkdirSync(runDir)
  mkdirSync(pluginDir)
  writeFileSync(pluginEntry, "export default {}\n", "utf8")

  const result = spawnSync(process.execPath, [
    compiledBin("prdcheck-run-config.js"),
    "--run-dir", runDir,
    "--plugin-entry", pluginEntry,
  ], { encoding: "utf8" })

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout) as { configPath: string; pluginUrl: string; created: boolean }
  assert.equal(output.created, true)
  assert.equal(output.configPath, join(runDir, ".opencode", "opencode.json"))
  assert.deepEqual(JSON.parse(readFileSync(output.configPath, "utf8")), {
    $schema: "https://opencode.ai/config.json",
    plugin: [output.pluginUrl],
  })
})

test("OpenCode JSONL command records stdin once and returns only extracted indexes", () => {
  const directory = temporaryDirectory()
  const first = JSON.stringify({ type: "step_start", sessionID: "session-1" })
  const second = JSON.stringify({
    type: "text",
    sessionID: "session-1",
    part: { id: "part-1", messageID: "message-1", sessionID: "session-1", text: "done" },
  })
  const args = [
    compiledBin("opencode-jsonl.js"),
    "record",
    "--directory", directory,
    "--run", "run-1",
    "--stage", "coding",
    "--path", "main",
    "--round", "0",
    "--turn", "turn-1",
  ]

  const result = spawnSync(process.execPath, args, { input: `${first}\n${second}\n`, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout) as {
    filePath: string
    firstSessionId: string
    lastText: string
    partIds: string[]
    messageIds: string[]
    sessionIds: string[]
    callIds: string[]
  }
  assert.equal(readFileSync(output.filePath, "utf8"), `${first}\n${second}\n`)
  assert.deepEqual(output, {
    filePath: output.filePath,
    firstSessionId: "session-1",
    lastText: "done",
    partIds: ["part-1"],
    messageIds: ["message-1"],
    sessionIds: ["session-1"],
    callIds: [],
  })

  const duplicate = spawnSync(process.execPath, args, { input: `${second}\n`, encoding: "utf8" })
  assert.notEqual(duplicate.status, 0)
  assert.equal(readFileSync(output.filePath, "utf8"), `${first}\n${second}\n`)
})

test("workspace snapshot command reads an explicit selection file", () => {
  const root = temporaryDirectory()
  const workspace = join(root, "workspace")
  const inputPath = join(root, "snapshot-input.json")
  mkdirSync(workspace)
  writeFileSync(join(workspace, "included.txt"), "included", "utf8")
  writeFileSync(join(workspace, "excluded.txt"), "excluded", "utf8")
  writeFileSync(inputPath, JSON.stringify({
    workspaceDir: workspace,
    include: ["."],
    exclude: ["excluded.txt"],
  }), "utf8")

  const result = spawnSync(process.execPath, [
    compiledBin("workspace-snapshot.js"),
    "--input", inputPath,
  ], { encoding: "utf8" })

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout) as {
    snapshotId: string
    manifest: { entries: Array<{ path: string }> }
  }
  assert.match(output.snapshotId, /^[0-9a-f]{64}$/u)
  assert.deepEqual(output.manifest.entries.map((item) => item.path), [".", "included.txt"])
})

test("real-chain preflight can invoke a Windows command wrapper", { skip: process.platform !== "win32" }, () => {
  const root = temporaryDirectory()
  const runDir = join(root, "run")
  const compilerStore = join(root, "compiler")
  const observerStore = join(root, "observer")
  const modelDir = join(root, "model")
  const external = join(root, "external")
  const pluginEntry = join(external, "experiment-runtime.js")
  const userInput = join(external, "user.txt")
  const harness = join(external, "harness.txt")
  const command = join(external, "opencode.cmd")
  for (const directory of [runDir, compilerStore, observerStore, modelDir, external]) mkdirSync(directory)
  writeFileSync(pluginEntry, "export default {}\n", "utf8")
  writeFileSync(userInput, "user\n", "utf8")
  writeFileSync(harness, "harness\n", "utf8")
  writeFileSync(
    command,
    "@echo off\r\nif \"%1\"==\"--version\" echo 1.18.31\r\nif \"%1\"==\"models\" echo openai/gpt-5.6-luna-fast\r\n",
    "utf8",
  )
  const pluginUrl = pathToFileURL(pluginEntry).href
  mkdirSync(join(runDir, ".opencode"))
  writeFileSync(
    join(runDir, ".opencode", "opencode.json"),
    `${JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [pluginUrl] }, null, 2)}\n`,
    "utf8",
  )

  const result = spawnSync(process.execPath, [
    compiledBin("real-chain-preflight.js"),
    "--opencode", command,
    "--provider", "openai",
    "--model", "gpt-5.6-luna-fast",
    "--run-dir", runDir,
    "--compiler-store", compilerStore,
    "--observer-store", observerStore,
    "--model-dir", modelDir,
    "--plugin-entry", pluginEntry,
    "--user-input-file", userInput,
    "--harness-system-file", harness,
    "--raw-requirement-file", userInput,
    "--concurrency", "1",
  ], { encoding: "utf8" })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal((JSON.parse(result.stdout) as { ok: boolean }).ok, true)
})

function compiledBin(name: string): string {
  return fileURLToPath(new URL(`../../dist/cli/${name}`, import.meta.url))
}
