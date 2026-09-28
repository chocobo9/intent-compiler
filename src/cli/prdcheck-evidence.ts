#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import { admitPrdcheckEvidence } from "../runtime/prdcheck-evidence.js"
import type { PrdcheckHostEvidence } from "../adapters/prdcheck.js"

const options = parseArgs(process.argv.slice(2))
const inputPath = absoluteFile(required(options, "input"), "--input")
const evidence = parseEvidence(inputPath)
const result = admitPrdcheckEvidence({
  compilerStoreDirectory: required(options, "compiler-store"),
  observerStoreDirectory: required(options, "observer-store"),
  executorWorkspaceDirectory: required(options, "executor-workspace"),
  evidence,
})

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (!result.ok) process.exitCode = 1

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

function absoluteFile(value: string, label: string): string {
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path`)
  const path = resolve(value)
  if (!statSync(path).isFile()) throw new Error(`${label} must refer to a regular file`)
  return path
}

function parseEvidence(path: string): PrdcheckHostEvidence {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--input must contain one JSON object")
  }
  return parsed as PrdcheckHostEvidence
}
