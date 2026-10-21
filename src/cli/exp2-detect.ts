#!/usr/bin/env node
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { goBuilder } from "../exp2/build.js"
import { detect, parseProducts, renderDetect } from "../exp2/detect.js"
import { assembleSerial, loadLocalConfig } from "../exp2/local-config.js"
import { LocalProcessRunner } from "../exp2/runner.js"
import type { Exp2State } from "../exp2/store.js"

/**
 * The offline acceptance harness (BLOCK9; ANALYSIS-MEDIUM-AND-ACCEPTANCE §5): runs the check library of a state on
 * products whose official results are known and prints a per-product table. No model is called. With --config the
 * run's runner and build are used (docker included); otherwise local processes. Usage:
 *   intent-exp2-detect --products <list.tsv> --state <state.json> [--config <file>] [--binary <name>] [--out <file.md>]
 * The list is tab-separated: name, round, path of the product's source tree, official result, note.
 */
async function main(argv: string[]): Promise<number> {
  const at = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  const [list, stateFile] = ["--products", "--state"].map(at)
  if (!list || !stateFile) { process.stderr.write("usage: intent-exp2-detect --products <list.tsv> --state <state.json> [--config <file>] [--binary <name>] [--out <file.md>]\n"); return 2 }
  const state = JSON.parse(readFileSync(resolve(stateFile), "utf8")) as Exp2State
  const products = parseProducts(readFileSync(resolve(list), "utf8")).map(p => ({ ...p, path: resolve(p.path) }))
  const config = at("--config")
  const assembled = config ? assembleSerial(loadLocalConfig(resolve(config))).config : null
  const build = assembled ? assembled.build : goBuilder(mkdtempSync(join(tmpdir(), "exp2-detect-builds-")), {}, at("--binary") ?? "dpipe")
  const report = await detect(state, products, { build, runner: assembled ? assembled.runner : new LocalProcessRunner(), timeoutMs: assembled?.limits.checkTimeoutMs })
  const md = renderDetect(report, state)
  const out = at("--out")
  if (out) {
    writeFileSync(resolve(out), md, "utf8")
    writeFileSync(resolve(out).replace(/\.md$/u, "") + ".json", JSON.stringify({ ...report, products: report.products.map(p => ({ ...p, runs: p.runs.map(r => ({ check: r.check, outcome: r.outcome, failure: r.failure, exit_code: r.exit_code, stderr_head: r.stderr_head })) })) }, null, 2) + "\n", "utf8")
  } else process.stdout.write(md)
  return 0
}

main(process.argv.slice(2)).then(code => process.exit(code), e => { process.stderr.write(`${(e as Error).stack ?? e}\n`); process.exit(1) })
