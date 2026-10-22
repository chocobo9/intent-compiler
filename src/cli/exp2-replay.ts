#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { replayAcceptance, scoreTexts, type DefectTable } from "../exp2/acceptance.js"
import { parseProducts, type Product } from "../exp2/detect.js"
import { renderLedger } from "../exp2/ledger.js"
import { assembleSerial, loadLocalConfig } from "../exp2/local-config.js"
import { Exp2Store, type Exp2State } from "../exp2/store.js"

/**
 * Acceptance-only replay (DESIGN §12h E6): no coding. Builds the attribution, library checks and probes of rounds
 * 1..N with the configured roles (whatever the state does not have yet), then runs them on each frozen program of the
 * list, at the program's round, and writes per program the ledger and, with --defects, one table of the defects hit
 * by library checks and probes together. Usage:
 *   intent-exp2-replay --config <file> --products <list.tsv> --out <dir> [--state <exp2-state.json>] [--defects <file>]
 * The list is tab-separated: name, round, path, official result, note. A path `<repo>@<commit>` takes that commit of a
 * git repository (cloned under <out>/frozen). The state, when given, is copied into <out>/store and its rounds are
 * reused; a second run with the same --out reuses everything already built.
 */
async function main(argv: string[]): Promise<number> {
  const at = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  const [config, list, outDir] = ["--config", "--products", "--out"].map(at)
  if (!config || !list || !outDir) { process.stderr.write("usage: intent-exp2-replay --config <file> --products <list.tsv> --out <dir> [--state <state.json>] [--defects <file>]\n"); return 2 }
  const out = resolve(outDir), storeDir = join(out, "store")
  mkdirSync(storeDir, { recursive: true })
  const state = at("--state")
  if (state && !existsSync(join(storeDir, "exp2-state.json"))) copyFileSync(resolve(state), join(storeDir, "exp2-state.json"))
  const { config: c } = assembleSerial(loadLocalConfig(resolve(config)))
  if (!c.probes || !c.judge) { process.stderr.write("the config switches the probe writer or the judge off (roles: null)\n"); return 2 }
  const runId = existsSync(join(storeDir, "exp2-state.json")) ? (JSON.parse(readFileSync(join(storeDir, "exp2-state.json"), "utf8")) as Exp2State).run_id : `replay-${Date.now().toString(36)}`
  const ablation = existsSync(join(storeDir, "exp2-state.json")) ? (JSON.parse(readFileSync(join(storeDir, "exp2-state.json"), "utf8")) as Exp2State).ablation ?? {} : c.store.ablation
  const store = new Exp2Store(storeDir, runId, ablation)
  const products: Product[] = parseProducts(readFileSync(resolve(list), "utf8")).map(p => ({ ...p, path: frozen(p.path, join(out, "frozen", p.name)) }))
  const result = await replayAcceptance({
    store, text: c.text, attribution: c.attribution, checks: c.checks, probes: c.probes, judge: c.judge, ...(c.ruling ? { ruling: c.ruling } : {}), ...(c.adjudicate ? { adjudicate: c.adjudicate } : {}),
    sandbox: c.sandbox, runner: c.runner, build: c.build, timeoutMs: c.limits.checkTimeoutMs, root: out, attributionRepairs: c.limits.attributionRepairs, checkRepairs: c.limits.checkRepairs, probeRepairs: c.limits.probeRepairs,
  }, products)
  const lines = ["# Acceptance-only replay", "", "| product | round | official | built | program wrong | uncovered | reference pending | listed only | judge calls | rulings |", "|---|---|---|---|---|---|---|---|---|---|"]
  for (const r of result) {
    const open = (reason: string) => r.ledger.filter(e => e.state === "open" && e.reason === reason).length
    lines.push(`| ${r.product.name} | ${r.product.round} | ${r.product.official ?? ""} | ${r.built ? "yes" : "**no**"} | ${open("program_wrong")} | ${open("uncovered")} | ${open("reference_pending")} | ${r.ledger.filter(e => e.state === "report_only").length} | ${r.calls.judge} | ${r.calls.adjudication} |`)
    const dir = join(out, "products", r.product.name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "ledger.json"), JSON.stringify(r.ledger, null, 1) + "\n", "utf8")
    writeFileSync(join(dir, "ledger.md"), `# Ledger: ${r.product.name} (round ${r.product.round})\n\n${renderLedger(r.ledger)}\n`, "utf8")
  }
  const defects = at("--defects")
  if (defects) {
    const table = JSON.parse(readFileSync(resolve(defects), "utf8")) as DefectTable
    const score = scoreTexts(table, result.map(r => ({ product: r.product.name, texts: r.texts.map(t => t.text) })))
    lines.push("", `## Defect table, library checks and probes together: ${score.hits}/${score.total}`, "", "| defect | hit | of |", "|---|---|---|", ...score.rows.map(r => `| ${r.name} | ${r.hit.join(", ") || "—"} | ${r.of.length} |`))
    lines.push("", `Items on the clean products: ${score.clean.map(x => `${x.product} ${x.items}`).join(", ")}`)
  }
  for (const r of result.filter(x => x.built)) lines.push("", `## ${r.product.name}`, "", ...r.texts.map(t => `- ${t.id}: ${t.text.replace(/\n/gu, " ")}`))
  writeFileSync(join(out, "replay.md"), lines.join("\n") + "\n", "utf8")
  writeFileSync(join(out, "replay.json"), JSON.stringify(result, null, 1) + "\n", "utf8")
  process.stdout.write(lines.join("\n") + "\n")
  return 0
}

/** A product's source tree: a path as given, or `<repo>@<commit>` cloned at that commit (once). */
function frozen(path: string, dir: string): string {
  const m = /^(.*)@([0-9a-f]{7,40})$/u.exec(path)
  if (!m) return resolve(path)
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(join(dir, ".."), { recursive: true })
    execFileSync("git", ["clone", "-q", resolve(m[1]), dir], { stdio: "ignore" })
    execFileSync("git", ["-C", dir, "checkout", "-q", m[2]], { stdio: "ignore" })
  }
  return dir
}

main(process.argv.slice(2)).then(code => process.exit(code), e => { process.stderr.write(`${(e as Error).stack ?? e}\n`); process.exit(1) })
