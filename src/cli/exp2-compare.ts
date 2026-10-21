#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { compareAttributions, registryOf, renderComparison, type IndependentAttribution } from "../exp2/compare.js"
import { materialize } from "../exp2/registry.js"
import type { Exp2State } from "../exp2/store.js"

/**
 * Compares the system's attribution (a store or checkpoint state.json) with an independent one, block and clause
 * level, and writes the disagreements. Usage:
 *   intent-exp2-compare --state <state.json> --independent <file.json> --inputs <dir> [--rounds <n>] [--out <file.md>]
 */
function main(argv: string[]): number {
  const at = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  const [stateFile, other, inputs] = ["--state", "--independent", "--inputs"].map(at)
  if (!stateFile || !other || !inputs) { process.stderr.write("usage: intent-exp2-compare --state <state.json> --independent <file.json> --inputs <dir> [--rounds <n>] [--out <file.md>]\n"); return 2 }
  const state = JSON.parse(readFileSync(resolve(stateFile), "utf8")) as Exp2State
  const accepted = state.rounds.filter(r => r.status === "accepted").map(r => r.acceptance!)
  const independent = JSON.parse(readFileSync(resolve(other), "utf8")) as IndependentAttribution
  const n = Number(at("--rounds") ?? Math.min(accepted.length, independent.rounds.length))
  const texts = Array.from({ length: n }, (_, i) => readFileSync(join(resolve(inputs), `round-${String(i + 1).padStart(2, "0")}.md`), "utf8"))
  const system = materialize(state.sources.filter(s => s.round <= n), accepted.filter(a => a.round <= n), state.split)
  const built = registryOf(texts, { ...independent, rounds: independent.rounds.filter(r => r.round <= n) })
  if (built.failed) process.stderr.write(`independent round ${built.failed.round} does not pass the check (compared up to round ${built.rounds}):\n- ${built.failed.issues.map(i => i.message).join("\n- ")}\n`)
  const rounds = Array.from({ length: built.rounds }, (_, i) => i + 1)
  const md = renderComparison(compareAttributions(system, built.registry, rounds), { a: "system", b: independent.label })
  const out = at("--out")
  if (out) writeFileSync(resolve(out), md, "utf8"); else process.stdout.write(md)
  return built.failed ? 1 : 0
}

process.exit(main(process.argv.slice(2)))
