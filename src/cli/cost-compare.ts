#!/usr/bin/env node
import { compareCostSummaries, readCostSummary } from "../runtime/cost-summary.js"

const args = parseArgs(process.argv.slice(2))
const on = readCostSummary({
  observerStoreDir: required(args, "on-observer-store"),
  runId: required(args, "on-run"),
  ...(args.get("on-v2-store") === undefined ? {} : { v2StoreDir: args.get("on-v2-store") as string }),
})
const off = readCostSummary({
  observerStoreDir: required(args, "off-observer-store"),
  runId: required(args, "off-run"),
  ...(args.get("off-v2-store") === undefined ? {} : { v2StoreDir: args.get("off-v2-store") as string }),
})
process.stdout.write(`${JSON.stringify(compareCostSummaries(on, off), null, 2)}\n`)

function parseArgs(values: string[]): Map<string, string> {
  const result = new Map<string, string>()
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    const value = values[index + 1]
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument: ${key ?? "<missing>"}`)
    result.set(key.slice(2), value)
  }
  return result
}

function required(args: Map<string, string>, key: string): string {
  const value = args.get(key)
  if (!value) throw new Error(`--${key} is required`)
  return value
}

