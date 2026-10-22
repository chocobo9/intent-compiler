#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { officialScore, productStore, repairProducts } from "../exp2/acceptance.js"
import { parseProducts } from "../exp2/detect.js"
import { assembleSerial, loadLocalConfig } from "../exp2/local-config.js"
import { Exp2Store, type Exp2State } from "../exp2/store.js"

/**
 * Offline repair (BLOCK10 §2; REPAIR-BLOCK §4): for each product, a copy of its repository is repaired in one
 * execution session from the correction list the probes and judge of a detection run give, with the cycles of the
 * round's flow. The configured scoring command scores it before and after; with per-case results it compares them by
 * (requirement, intent, scenario). Usage:
 *   intent-exp2-repair --config <file> --detect <out dir of intent-exp2-probe-detect> --products <list.tsv> --out <dir>
 * The scoring command (config `scoring.command`, with {round}, {commit}, {repo}) prints {"passed", "total"} and, for
 * the comparison, "cases" or "verifier_log".
 */
async function main(argv: string[]): Promise<number> {
  const at = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  const [config, detectDir, list, outDir] = ["--config", "--detect", "--products", "--out"].map(at)
  if (!config || !detectDir || !list || !outDir) { process.stderr.write("usage: intent-exp2-repair --config <file> --detect <dir> --products <list.tsv> --out <dir>\n"); return 2 }
  const storeDir = join(resolve(detectDir), "store")
  const state = JSON.parse(readFileSync(join(storeDir, "exp2-state.json"), "utf8")) as Exp2State
  const store = new Exp2Store(storeDir, state.run_id, state.ablation ?? {})
  const local = loadLocalConfig(resolve(config))
  const { config: c } = assembleSerial(local)
  if (!c.judge) { process.stderr.write("the config switches the judge off (roles: null)\n"); return 2 }
  const products = parseProducts(readFileSync(resolve(list), "utf8")).map(p => ({ ...p, path: resolve(p.path) }))
  const score = local.scoring ? (commit: string, repo: string, round: number) => officialScore(local.scoring!.command, round, commit, repo) : undefined
  const results = await repairProducts({
    store, storeFor: p => existsSync(join(resolve(detectDir), "products", p.name, "store", "exp2-state.json")) ? productStore(store, resolve(detectDir), p.name) : store, judge: c.judge, ...(c.ruling ? { ruling: c.ruling } : {}), sandbox: c.sandbox, build: c.build, runner: c.runner, timeoutMs: c.limits.checkTimeoutMs, executor: () => c.executor(1), anchors: c.anchors,
    limits: c.limits.execution, binary: c.binary ?? "app", text: c.text, ...(score ? { score } : {}),
  }, products, resolve(outDir))
  const lines = ["# Repair from correction lists", "", "| product | items | official before → after | fixed | broke | still failing | cycles | open after | coding tokens (in / cache / out) |", "|---|---|---|---|---|---|---|---|---|"]
  for (const r of results) {
    const u = r.record?.usage
    lines.push(`| ${r.product.name} | ${r.items_before.length} | ${r.official_before ? `${r.official_before.passed}/${r.official_before.total}` : "?"} → ${r.official_after ? `${r.official_after.passed}/${r.official_after.total}` : "?"} | ${r.cases?.fixed.length ?? "?"} | ${r.cases?.broke.length ?? "?"} | ${r.cases?.still.length ?? "?"} | ${r.record?.cycles.length ?? 0} | ${r.open_after.length} | ${u ? `${u.input_tokens} / ${u.cache_read_tokens} / ${u.output_tokens}` : ""} |`)
  }
  for (const r of results.filter(x => x.cases?.broke.length)) lines.push("", `## ${r.product.name}: broke`, ...r.cases!.broke.map(k => `- ${k}`))
  writeFileSync(join(resolve(outDir), "repair.md"), lines.join("\n") + "\n", "utf8")
  writeFileSync(join(resolve(outDir), "repair.json"), JSON.stringify(results.map(r => ({ ...r, official_before: r.official_before && { ...r.official_before, cases: r.official_before.cases && Object.fromEntries(r.official_before.cases) }, official_after: r.official_after && { ...r.official_after, cases: r.official_after.cases && Object.fromEntries(r.official_after.cases) } })), null, 1) + "\n", "utf8")
  process.stdout.write(lines.join("\n") + "\n")
  return 0
}

main(process.argv.slice(2)).then(code => process.exit(code), e => { process.stderr.write(`${(e as Error).stack ?? e}\n`); process.exit(1) })
