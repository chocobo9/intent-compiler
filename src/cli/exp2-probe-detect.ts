#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { scoreDefects, probeDetect, type DefectTable } from "../exp2/acceptance.js"
import { parseProducts } from "../exp2/detect.js"
import { assembleSerial, loadLocalConfig } from "../exp2/local-config.js"
import { Exp2Store, type Exp2State } from "../exp2/store.js"

/**
 * Offline detection (BLOCK10 §2; REPAIR-BLOCK §4): writes the round's probes once with the configured probe writer
 * (recorded when the config records), runs them on every product of the list in the configured runner, judges each
 * product on its own, and prints per product the correction list, the ambiguous pairs and the cost, then the hits on
 * the defect table and the items on the clean products. Usage:
 *   intent-exp2-probe-detect --config <file> --state <exp2-state.json with the round accepted> --products <list.tsv> --out <dir> [--defects <r1-defects.json>]
 * The state is copied into <out>/store; a second run with the same --out reuses the probes and the kept verdicts.
 */
async function main(argv: string[]): Promise<number> {
  const at = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  const [config, stateFile, list, outDir] = ["--config", "--state", "--products", "--out"].map(at)
  if (!config || !stateFile || !list || !outDir) { process.stderr.write("usage: intent-exp2-probe-detect --config <file> --state <state.json> --products <list.tsv> --out <dir> [--defects <file>]\n"); return 2 }
  const out = resolve(outDir), storeDir = join(out, "store")
  mkdirSync(storeDir, { recursive: true })
  if (!existsSync(join(storeDir, "exp2-state.json"))) copyFileSync(resolve(stateFile), join(storeDir, "exp2-state.json"))
  const state = JSON.parse(readFileSync(join(storeDir, "exp2-state.json"), "utf8")) as Exp2State
  const store = new Exp2Store(storeDir, state.run_id, state.ablation ?? {})
  const { config: c } = assembleSerial(loadLocalConfig(resolve(config)))
  if (!c.probes || !c.judge) { process.stderr.write("the config switches the probe writer or the judge off (roles: null)\n"); return 2 }
  const products = parseProducts(readFileSync(resolve(list), "utf8")).map(p => ({ ...p, path: resolve(p.path) }))
  const result = await probeDetect({ store, probes: c.probes, judge: c.judge, ...(c.ruling ? { ruling: c.ruling } : {}), sandbox: c.sandbox, build: c.build, runner: c.runner, timeoutMs: c.limits.checkTimeoutMs, root: out, anchors: c.anchors, ...(c.buildAsync ? { buildAsync: c.buildAsync } : {}), mutants: c.limits.mutants ?? 0, platform: c.platform, maxRepairs: c.limits.probeRepairs }, products)
  const s = store.inspect()
  const key = (id: string) => s.probes.find(p => p.id === id)?.key ?? id
  const lines = ["# Probes and judge on products with known official results", ""]
  const w = s.probe_rounds.find(r => r.status === "accepted")
  const writerCalls = s.probe_calls.filter(x => w?.calls.includes(x.id))
  const sum = (cs: readonly { usage: { input_tokens: number; cache_read_tokens: number; output_tokens: number } }[]) => cs.reduce((t, x) => ({ input: t.input + x.usage.input_tokens, cache: t.cache + x.usage.cache_read_tokens, output: t.output + x.usage.output_tokens }), { input: 0, cache: 0, output: 0 })
  lines.push(`Probes: ${w?.entered.length ?? 0} for ${w?.units.length ?? 0} units (${w?.uncovered.length ?? 0} not exercised, ${w?.dropped.length ?? 0} dropped); cases ${w?.cases ? `${w.cases.covered}/${w.cases.total} reached, ${w.cases.excused} uncheckable, ${w.cases.open.length} open` : "n/a"}; writer ${[...new Set(writerCalls.map(x => x.model).filter(Boolean))].join(", ") || "?"}, ${writerCalls.length} calls, tokens ${JSON.stringify(sum(writerCalls))}.`)
  lines.push(`Judge: ${[...new Set(s.judge_calls.map(x => x.model).filter(Boolean))].join(", ") || "?"}, ${s.judge_calls.length} calls, tokens ${JSON.stringify(sum(s.judge_calls))}.`, "")
  lines.push("| product | official | built | items | ambiguous | cannot tell | mutants told apart | weak units | probes added | still not told apart | strengthening tokens (in / cache / out) | judge calls | judge tokens (in / cache / out) |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|")
  for (const p of result.products) {
    const m = p.measure, t = (u: { input_tokens: number; cache_read_tokens: number; output_tokens: number }) => `${u.input_tokens} / ${u.cache_read_tokens} / ${u.output_tokens}`
    lines.push(`| ${p.product.name} | ${p.product.official ?? ""} | ${p.built ? "yes" : "**no**"} | ${p.items.length} | ${p.ambiguous.length} | ${p.findings.filter(f => f.verdict === "cannot_tell").length} | ${m ? `${m.killed}/${m.killed + m.survived}` : "—"} | ${m?.weak_units.length ?? "—"} | ${m?.strengthened.length ?? "—"} | ${m?.still_weak ?? "—"} | ${m ? t(m.writer_tokens) : "—"} | ${p.judge_calls} | ${t(p.judge_tokens)} |`)
  }
  const defects = at("--defects")
  if (defects) {
    const table = JSON.parse(readFileSync(resolve(defects), "utf8")) as DefectTable
    const score = scoreDefects(table, result.products.map(p => ({ product: p.product.name, items: p.items, findings: p.findings, probeKey: key })))
    lines.push("", `## Defect table: ${score.hits}/${score.total}`, "", "| defect | hit | of |", "|---|---|---|", ...score.rows.map(r => `| ${r.name} | ${r.hit.join(", ") || "—"} | ${r.of.length} |`))
    lines.push("", `Items on the clean products: ${score.clean.map(x => `${x.product} ${x.items}`).join(", ")}`)
  }
  for (const p of result.products.filter(x => x.built)) {
    lines.push("", `## ${p.product.name}`, "", ...p.items.map(it => `- ${it.key} (${key(it.probe)}): ${it.finding.replace(/\n/gu, " ")}`))
    if (p.ambiguous.length) lines.push("", "Ambiguous (not sent):", ...p.ambiguous.map(f => `- ${f.probe}/${f.unit} (${key(f.probe)}): ${f.reason.replace(/\n/gu, " ")}`))
  }
  writeFileSync(join(out, "detect.md"), lines.join("\n") + "\n", "utf8")
  writeFileSync(join(out, "detect.json"), JSON.stringify({ written: result.written, products: result.products.map(p => ({ ...p, findings: p.findings })) }, null, 1) + "\n", "utf8")
  process.stdout.write(lines.join("\n") + "\n")
  return 0
}

main(process.argv.slice(2)).then(code => process.exit(code), e => { process.stderr.write(`${(e as Error).stack ?? e}\n`); process.exit(1) })
