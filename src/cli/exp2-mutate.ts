#!/usr/bin/env node
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { goBuilder } from "../exp2/build.js"
import { activeChecks, codeFacts } from "../exp2/checks.js"
import { assembleSerial, loadLocalConfig } from "../exp2/local-config.js"
import { mutationTest, renderMutationReport } from "../exp2/mutation.js"
import { materialize } from "../exp2/registry.js"
import { LocalProcessRunner } from "../exp2/runner.js"
import type { Exp2State } from "../exp2/store.js"

/**
 * Mutation test of a produced Go tree against the check library of a checkpoint (local only, existing products).
 * With --config the run's runner and build are used (docker included); otherwise local processes. Usage:
 *   intent-exp2-mutate --tree <dir> --state <checkpoint state.json> --round <n> [--config <file>] [--max <n>] [--out <file.md>]
 */
async function main(argv: string[]): Promise<number> {
  const at = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  const [tree, stateFile, roundArg] = ["--tree", "--state", "--round"].map(at)
  if (!tree || !stateFile || !roundArg) { process.stderr.write("usage: intent-exp2-mutate --tree <dir> --state <state.json> --round <n> [--config <file>] [--max <n>] [--out <file.md>]\n"); return 2 }
  const round = Number(roundArg)
  const state = JSON.parse(readFileSync(resolve(stateFile), "utf8")) as Exp2State
  const registry = materialize(state.sources.filter(s => s.round <= round), state.rounds.filter(r => r.status === "accepted" && r.round <= round).map(r => r.acceptance!), { clauses: state.ablation?.clauses })
  const checks = activeChecks(state.checks.filter(c => c.round <= round), state.check_events.filter(e => e.round <= round))
  const config = at("--config")
  const assembled = config ? assembleSerial(loadLocalConfig(resolve(config))).config : null
  const builds = mkdtempSync(join(tmpdir(), "exp2-mutate-builds-"))
  const report = await mutationTest(resolve(tree), checks, {
    build: assembled ? assembled.build : goBuilder(builds), runner: assembled ? assembled.runner : new LocalProcessRunner(),
    registry, facts: codeFacts(registry, round), round, checkTimeoutMs: assembled?.limits.checkTimeoutMs,
  }, Number(at("--max") ?? 30))
  const md = renderMutationReport(report)
  const out = at("--out")
  if (out) { writeFileSync(resolve(out), md, "utf8"); writeFileSync(resolve(out).replace(/\.md$/u, "") + ".json", JSON.stringify(report, null, 2) + "\n", "utf8") } else process.stdout.write(md)
  return 0
}

main(process.argv.slice(2)).then(code => process.exit(code), e => { process.stderr.write(`${(e as Error).stack ?? e}\n`); process.exit(1) })
