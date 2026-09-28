#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { isAbsolute } from "node:path"
import {
  createWorkspaceSnapshot,
  type WorkspaceSnapshotInput,
} from "../adapters/workspace-snapshot.js"

const inputPath = requiredArgument(process.argv.slice(2), "--input")
if (!isAbsolute(inputPath)) throw new Error("--input must be an absolute path")

const parsed = JSON.parse(readFileSync(inputPath, "utf8")) as WorkspaceSnapshotInput
const result = createWorkspaceSnapshot(parsed)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)

function requiredArgument(values: readonly string[], name: string): string {
  if (values.length !== 2 || values[0] !== name || !values[1]) {
    throw new Error(`usage: intent-workspace-snapshot ${name} <absolute-json-file>`)
  }
  return values[1]
}
