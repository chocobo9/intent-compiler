#!/usr/bin/env node
import { createInterface } from "node:readline"
import {
  createOpenCodeJsonlFile,
  type OpenCodeJsonlIdentity,
} from "../adapters/opencode-jsonl.js"

const [command, ...args] = process.argv.slice(2)
if (command !== "record") {
  throw new Error(
    "usage: opencode-jsonl.js record --directory ABS --run ID --stage ID --path ID --round N --turn ID",
  )
}

const options = parseArgs(args)
const identity: OpenCodeJsonlIdentity = {
  runId: required(options, "run"),
  stageId: required(options, "stage"),
  pathId: required(options, "path"),
  round: nonNegativeInteger(required(options, "round"), "round"),
  turnId: required(options, "turn"),
}
const record = createOpenCodeJsonlFile({
  directory: required(options, "directory"),
  identity,
})

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of lines) record.append(line)

const contents = record.read()
process.stdout.write(`${JSON.stringify({
  filePath: record.filePath,
  firstSessionId: contents.firstSessionId,
  lastText: contents.lastText,
  partIds: contents.partIds,
  messageIds: contents.messageIds,
  sessionIds: contents.sessionIds,
  callIds: contents.callIds,
}, null, 2)}\n`)

function parseArgs(values: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    const value = values[index + 1]
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`invalid argument: ${key ?? "<missing>"}`)
    }
    result[key.slice(2)] = value
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
