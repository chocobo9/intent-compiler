#!/usr/bin/env node
import { resolve } from "node:path"
import { readFileSync } from "node:fs"
import { EventStore, projectRun, renderReport, SessionRegistry } from "../index.js"
import type { Manifest, Registration } from "../observer/types.js"

const [command, ...args] = process.argv.slice(2)
const options = parseArgs(args)
const storeDir = resolve(required(options, "store"))

if (command === "register") {
  const registry = new SessionRegistry(storeDir)
  const result = registry.register({
    schema_version: "0.1",
    run_id: required(options, "run"),
    arm_id: required(options, "arm"),
    task_id: required(options, "task"),
    turn_id: required(options, "turn"),
    session_id: required(options, "session"),
    created_at: new Date().toISOString(),
    ...(options["user-input-file"] === undefined ? {} : { user_input_file: options["user-input-file"] }),
    ...(options["harness-system-file"] === undefined ? {} : { harness_system_file: options["harness-system-file"] }),
    ...(options["executor-workspace"] === undefined ? {} : { executor_workspace: options["executor-workspace"] }),
    ...(options["input-identity"] === undefined ? {} : { input_identity: options["input-identity"] }),
    ...(options["source-category"] === undefined ? {} : { source_category: options["source-category"] }),
    ...(options.stage === undefined ? {} : { stage_id: options.stage }),
    ...(options.path === undefined ? {} : { path_id: options.path }),
    ...(options.round === undefined ? {} : { round: nonNegativeInteger(options.round, "round") }),
    ...(options["task-occurrence"] === undefined ? {} : { task_occurrence_id: options["task-occurrence"] }),
    ...(options["workspace-snapshot"] === undefined ? {} : { workspace_snapshot_id: options["workspace-snapshot"] }),
    ...(options["produced-at"] === undefined ? {} : { produced_at: options["produced-at"] }),
  })
  // Do not echo the registered user/harness text into shell logs.  The
  // registry persists it for the adapter, while this command returns only
  // registration metadata.
  const { user_input_text: _userInputText, harness_system_text: _harnessSystemText, ...safeResult } = result
  process.stdout.write(`${JSON.stringify(safeResult, null, 2)}\n`)
} else if (command === "report") {
  const runId = required(options, "run")
  const store = new EventStore(storeDir)
  const manifest = JSON.parse(readFileSync(resolve(storeDir, "runs", runId, "manifest.json"), "utf8")) as Manifest
  const run = store.openRun(manifest)
  const events = run.readEvents()
  const summary = projectRun(events, manifest)
  run.writeProjection(summary, renderReport(summary, events))
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
} else {
  process.stderr.write(
    "Usage:\n" +
      "  observer-cli.js register --store ABS --run ID --arm ID --task ID --turn ID --session ID [--input-identity ID]\n" +
      "    [--executor-workspace ABS --user-input-file ABS --harness-system-file ABS]\n" +
      "    [--source-category NAME --stage ID --path ID --round N --task-occurrence ID --workspace-snapshot ID --produced-at ISO]\n" +
      "  observer-cli.js report --store ABS --run ID\n",
  )
  process.exitCode = 2
}

function parseArgs(values: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    if (!key?.startsWith("--") || values[index + 1] === undefined) throw new Error(`invalid argument: ${key}`)
    result[key.slice(2)] = values[index + 1]
  }
  return result
}

function required(options: Record<string, string>, key: string): string {
  const value = options[key]
  if (!value) throw new Error(`--${key} is required`)
  return value
}

function nonNegativeInteger(value: string, label: string): number {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) throw new Error(`--${label} must be a non-negative integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`--${label} must be a safe integer`)
  return parsed
}
