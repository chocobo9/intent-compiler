#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { renderMeasures, summarizeMeasures, type ScoreLine } from "../exp2/measures.js"
import type { RoundMeasures } from "../exp2/report.js"

/**
 * The §12i measures of a run, from its checkpoints: one table a round and the preregistered verdict (fix block B4).
 * Usage: intent-exp2-measures --checkpoints <dir> [--from 5] [--to 15] [--control-cost <n>] [--bar 948]
 * Writes <dir>/measures.md and prints it.
 */
function main(argv: string[]): number {
  const at = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  const dir = at("--checkpoints")
  if (!dir) { process.stderr.write("usage: intent-exp2-measures --checkpoints <dir> [--from 5] [--to 15] [--control-cost <n>] [--bar 948]\n"); return 2 }
  const lines = <T>(f: string): T[] => existsSync(join(resolve(dir), f)) ? readFileSync(join(resolve(dir), f), "utf8").split("\n").filter(l => l.trim()).map(l => JSON.parse(l) as T) : []
  const num = (f: string) => at(f) !== undefined ? Number(at(f)) : undefined
  const summary = summarizeMeasures(lines<RoundMeasures>("measures.jsonl"), lines<ScoreLine>("scores.jsonl"), { from: num("--from"), to: num("--to"), controlCost: num("--control-cost"), bar: num("--bar") })
  const text = renderMeasures(summary)
  writeFileSync(join(resolve(dir), "measures.md"), text, "utf8")
  process.stdout.write(text)
  return 0
}

process.exit(main(process.argv.slice(2)))
