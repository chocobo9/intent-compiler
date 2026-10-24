#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { replayReview, scoreTexts, type DefectTable } from "../exp2/acceptance.js"
import { parseProducts, type Product } from "../exp2/detect.js"
import { assembleSerial, loadLocalConfig } from "../exp2/local-config.js"
import { Exp2Store, type Exp2State } from "../exp2/store.js"

/**
 * Acceptance-only replay (DESIGN §12h E6, §12i): no coding. Builds the attribution and library checks of rounds 1..N
 * with the configured roles (whatever the state does not have yet), then gives each frozen program of the list, at the
 * program's round, the library run and --reviews reviews (default 1) in copies of its tree; the formalizer's items are
 * checked for their premises and reproduction. The table shows the reviewer's raw items, what the premises stopped (by
 * premise) and what would have been sent, with each role's tokens; with --defects, the defects hit. Usage:
 *   intent-exp2-replay --config <file> --products <list.tsv> --out <dir> [--state <exp2-state.json>] [--defects <file>] [--reviews <n>]
 * The list is tab-separated: name, round, path, official result, note. A path `<repo>@<commit>` takes that commit of a
 * git repository (cloned under <out>/frozen). The state, when given, is copied into <out>/store and its rounds are
 * reused; a second run with the same --out reuses everything already built. (The probes mode is gone with the probes
 * path, §12j.4.)
 */
async function main(argv: string[]): Promise<number> {
  const at = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  const [config, list, outDir] = ["--config", "--products", "--out"].map(at)
  if (!config || !list || !outDir) { process.stderr.write("usage: intent-exp2-replay --config <file> --products <list.tsv> --out <dir> [--state <state.json>] [--defects <file>] [--reviews <n>]\n"); return 2 }
  const out = resolve(outDir), storeDir = join(out, "store")
  mkdirSync(storeDir, { recursive: true })
  const state = at("--state")
  if (state && !existsSync(join(storeDir, "exp2-state.json"))) copyFileSync(resolve(state), join(storeDir, "exp2-state.json"))
  const { config: c } = assembleSerial(loadLocalConfig(resolve(config)))
  const runId = existsSync(join(storeDir, "exp2-state.json")) ? (JSON.parse(readFileSync(join(storeDir, "exp2-state.json"), "utf8")) as Exp2State).run_id : `replay-${Date.now().toString(36)}`
  const ablation = existsSync(join(storeDir, "exp2-state.json")) ? (JSON.parse(readFileSync(join(storeDir, "exp2-state.json"), "utf8")) as Exp2State).ablation ?? {} : c.store.ablation
  const store = new Exp2Store(storeDir, runId, ablation)
  const products: Product[] = parseProducts(readFileSync(resolve(list), "utf8")).map(p => ({ ...p, path: frozen(p.path, join(out, "frozen", p.name)) }))
  return reviewReplay(c, store, products, out, at("--defects"), Number(at("--reviews") ?? 1))
}

const tok = (u: { input_tokens: number; cache_read_tokens: number; output_tokens: number }) => `${u.input_tokens} / ${u.cache_read_tokens} / ${u.output_tokens}`

/** The review-mode replay (DESIGN §12i): per product the raw list, the premises' verdicts, and the roles' tokens. */
async function reviewReplay(c: ReturnType<typeof assembleSerial>["config"], store: Exp2Store, products: Product[], out: string, defects: string | undefined, reviews: number): Promise<number> {
  const result = await replayReview({
    store, text: c.text, attribution: c.attribution, checks: c.checks, sandbox: c.sandbox, runner: c.runner, build: c.build, timeoutMs: c.limits.checkTimeoutMs, root: out,
    attributionRepairs: c.limits.attributionRepairs, checkRepairs: c.limits.checkRepairs, reviewer: c.reviewer, formalize: c.formalize, binary: c.binary ?? "app", reviews,
    ...(c.acceptance?.premiseBlock ? { premiseBlock: c.acceptance.premiseBlock } : {}), ...(c.acceptance?.fallback ? { fallback: c.acceptance.fallback } : {}), ...(c.acceptance?.voidWithoutRuns !== undefined ? { voidWithoutRuns: c.acceptance.voidWithoutRuns } : {}),
  }, products)
  const tally = (list: (string | null | undefined)[]) => [...list.reduce((m, k) => k ? m.set(k, (m.get(k) ?? 0) + 1) : m, new Map<string, number>())].map(([k, n]) => `${k} ${n}`).join(", ")
  const lines = ["# Acceptance-only replay under DESIGN §12i (reviewer, formalizer, premises)", "", "The blocking tier (acceptance.premise_block) stops an item, other premises are logged, items code cannot verify go out in the reviewer's words (fix block A1, A3).", "", "| product | round | official | built | reviews (void) | entries | blocked | sent (verified / logged / fallback) | library failing / passing | reviewer tokens (in / cache / out) | formalizer tokens |", "|---|---|---|---|---|---|---|---|---|---|---|"]
  for (const r of result) {
    const blocked = r.items.filter(i => i.premise)
    const sentBy = (d: string) => r.items.filter(i => !i.premise && i.disposition === d).length
    lines.push(`| ${r.product.name} | ${r.product.round} | ${r.product.official ?? ""} | ${r.built ? "yes" : "**no**"} | ${r.reviews.length} (${r.voided})${r.reviews.some(x => x.no_issues) ? ", NO ISSUES" : ""} | ${r.items.length} | ${blocked.length}${blocked.length ? ` (${tally(blocked.map(i => i.premise))})` : ""} | ${r.items.length - blocked.length} (${sentBy("sent")} / ${sentBy("logged")} / ${sentBy("fallback")}) | ${r.library.failing.length} / ${r.library.passing.length} | ${tok(r.usage.reviewer)} | ${tok(r.usage.formalizer)} |`)
    const dir = join(out, "products", r.product.name)
    mkdirSync(dir, { recursive: true })
    const md = [`# Review replay: ${r.product.name} (round ${r.product.round})`, ""]
    for (const v of r.reviews) md.push(`## Review ${v.n}${v.valid ? "" : " (void: the program never ran)"}${v.model ? ` — ${v.model}` : ""}`, "", `Program runs seen: ${v.program_runs}; attempts ${v.attempts}; tokens ${tok(v.usage)}.`, "", v.text, "")
    const cell = (t: string) => t.replace(/\|/gu, "\\|").replace(/\n/gu, " ")
    md.push("## Items", "", "| id | disposition | blocked by / logged | units | text |", "|---|---|---|---|---|", ...r.items.map(i => `| ${i.id} | ${i.premise ? "blocked" : `sent (${i.disposition})`} | ${cell([i.premise ? `${i.premise}: ${i.detail ?? ""}` : "", ...(i.logged ?? []).map(l => `${l.premise}: ${l.detail}`)].filter(Boolean).join("; "))} | ${i.units.join(" ")} | ${cell(i.text)} |`))
    if (r.malformed.length) md.push("", "Malformed (not formalized):", ...r.malformed.map(m => `- review ${m.review_n}: ${m.message}`))
    md.push("", `Library checks failing (leads): ${r.library.failing.join(", ") || "none"}; passing: ${r.library.passing.length}.`)
    writeFileSync(join(dir, "review.md"), md.join("\n") + "\n", "utf8")
    writeFileSync(join(dir, "review.json"), JSON.stringify(r, null, 1) + "\n", "utf8")
  }
  if (defects) {
    const table = JSON.parse(readFileSync(resolve(defects), "utf8")) as DefectTable
    const texts = (f: (i: ReviewedItem) => boolean) => result.map(r => ({ product: r.product.name, texts: r.items.filter(f).map(i => `${i.units.join(" ")} ${i.text}`) }))
    const raw = scoreTexts(table, result.map(r => ({ product: r.product.name, texts: [...r.items.map(i => `${i.units.join(" ")} ${i.text}`), ...r.reviews.map(v => v.text)] })))
    const sent = scoreTexts(table, texts(i => !i.premise))
    lines.push("", `## Defect table: reviewer's raw list ${raw.hits}/${raw.total}; sent ${sent.hits}/${sent.total}`, "", "| defect | raw | sent | of |", "|---|---|---|---|", ...raw.rows.map((r, k) => `| ${r.name} | ${r.hit.join(", ") || "—"} | ${sent.rows[k].hit.join(", ") || "—"} | ${r.of.length} |`))
    lines.push("", `Items on the clean products (all of them are false): raw ${raw.clean.map(x => `${x.product} ${x.items}`).join(", ")}; sent ${sent.clean.map(x => `${x.product} ${x.items}`).join(", ")}`)
  }
  writeFileSync(join(out, "replay.md"), lines.join("\n") + "\n", "utf8")
  writeFileSync(join(out, "replay.json"), JSON.stringify(result, null, 1) + "\n", "utf8")
  process.stdout.write(lines.join("\n") + "\n")
  return 0
}

type ReviewedItem = Awaited<ReturnType<typeof replayReview>>[number]["items"][number]

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
