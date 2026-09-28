#!/usr/bin/env node
import { readCurrentCompiledIntent } from "../runtime/current-compiled-intent.js"

const options = parseArgs(process.argv.slice(2))
const result = readCurrentCompiledIntent({
  compilerStoreDirectory: required(options, "compiler-store"),
  observerStoreDirectory: required(options, "observer-store"),
  executorWorkspaceDirectory: required(options, "executor-workspace"),
  runId: required(options, "run"),
})
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)

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
