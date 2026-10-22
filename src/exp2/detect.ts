import { adjudicate, type AdjudicationTransport } from "./adjudication.js"
import { activeChecks, codeFacts } from "./checks.js"
import type { BuildResult } from "./execution.js"
import { materialize } from "./registry.js"
import type { CheckRunner } from "./runner.js"
import { upheldKinds, type Exp2State } from "./store.js"
import { objectStatuses, runCheck, type CheckRun } from "./verdict.js"

/**
 * The offline acceptance harness of BLOCK9 (ANALYSIS-MEDIUM-AND-ACCEPTANCE §5): the check library of a state, run on
 * products whose official results are known, with the current classification. A measurement tool for the local side:
 * the official numbers in the product list are printed next to the system's call, never fed to the system.
 */

export interface Product {
  name: string
  /** The round whose library judges it. */
  round: number
  /** The product's Go source tree (read only; built elsewhere). */
  path: string
  /** Official result, as the list gives it (for the table only). */
  official?: string
  note?: string
}

/** Tab-separated: name, round, path, official result, note; `#` starts a comment. */
export function parseProducts(text: string): Product[] {
  return text.split(/\r?\n/u).map(l => l.replace(/#.*$/u, "").trimEnd()).filter(l => l.trim()).map(l => {
    const [name, round, path, official, note] = l.split("\t").map(x => x.trim())
    if (!name || !round || !path || !Number.isSafeInteger(Number(round))) throw new Error(`product line needs name, round and path, tab-separated: ${l}`)
    return { name, round: Number(round), path, ...(official ? { official } : {}), ...(note ? { note } : {}) }
  })
}

export interface ProductResult {
  product: Product
  built: boolean
  build_output?: string
  runs: CheckRun[]
  /** Objects by status, as names. */
  not_landed: string[]
  landed: string[]
  unknown: string[]
  /** Failures by class/reason. */
  failures: Record<string, string[]>
}

export interface DetectReport {
  products: ProductResult[]
  /** Checks that failed on every product that built and ran them: by design of the test set, the wrong checks show here. */
  fail_everywhere: { check: string; key: string; object: string; classes: string[] }[]
  /** Rulings on reference disagreements (DESIGN §12g), once per check: check_right counts against the program. */
  rulings: { check: string; verdict: string; reason: string }[]
}

export async function detect(state: Exp2State, products: readonly Product[], deps: { build: (dir: string, label: string) => BuildResult; runner: CheckRunner; timeoutMs?: number; adjudicate?: AdjudicationTransport }): Promise<DetectReport> {
  const results: ProductResult[] = []
  // A reference disagreement is ruled on once per check, by the adjudicator when there is one; without one it stays disputed.
  const ruled = new Map<string, { verdict: string; reason: string }>()
  for (const p of products) {
    const registry = materialize(state.sources.filter(s => s.round <= p.round), state.rounds.filter(r => r.status === "accepted" && r.round <= p.round).map(r => r.acceptance!), { clauses: state.ablation?.clauses })
    const library = activeChecks(state.checks.filter(c => c.round <= p.round), state.check_events.filter(e => e.round <= p.round))
    const built = deps.build(p.path, `detect-${p.name}`)
    if (!built.ok) { results.push({ product: p, built: false, build_output: built.output.slice(0, 2000), runs: [], not_landed: [], landed: [], unknown: [], failures: {} }); continue }
    const facts = codeFacts(registry, p.round)
    const runs: CheckRun[] = []
    for (const c of library) {
      const upheld = upheldKinds(state, c.id)
      let run = await runCheck(c, built.program!, deps.runner, p.round, registry, facts, deps.timeoutMs ?? 20_000, upheld)
      if (deps.adjudicate && run.failure?.class === "disputed" && run.failure.reason === "reference") {
        if (!ruled.has(c.id)) {
          const out = await adjudicate(registry, p.round, c, run, "reference", run.failure.detail, deps.adjudicate, n => `D${ruled.size + 1}.${n}`)
          ruled.set(c.id, out.ruling ? { verdict: out.ruling.verdict, reason: out.ruling.reason } : { verdict: "none", reason: "no ruling came back" })
        }
        const r = ruled.get(c.id)!
        if (r.verdict === "check_right") run = await runCheck(c, built.program!, deps.runner, p.round, registry, facts, deps.timeoutMs ?? 20_000, new Set([...upheld, "reference"]))
        else if (r.verdict !== "none") continue
      }
      runs.push(run)
    }
    const statuses = objectStatuses(registry, state.checks, state.check_events, runs, p.round)
    const name = (id: string) => registry.objects.get(id)?.name ?? id
    const failures: Record<string, string[]> = {}
    for (const r of runs.filter(x => x.failure)) (failures[`${r.failure!.class}/${r.failure!.reason}`] ??= []).push(r.check)
    results.push({
      product: p, built: true, runs, failures,
      not_landed: statuses.filter(s => s.status === "not_landed").map(s => name(s.object)),
      landed: statuses.filter(s => s.status === "landed").map(s => name(s.object)),
      unknown: statuses.filter(s => s.status === "unknown").map(s => name(s.object)),
    })
  }
  const ran = results.filter(r => r.built)
  const ids = [...new Set(ran.flatMap(r => r.runs.map(x => x.check)))]
  const fail_everywhere = ids.filter(id => {
    const mine = ran.map(r => r.runs.find(x => x.check === id)).filter((x): x is CheckRun => !!x)
    return mine.length === ran.length && mine.every(x => x.outcome === "fail")
  }).map(id => {
    const k = state.checks.find(c => c.id === id)!
    const classes = [...new Set(ran.map(r => r.runs.find(x => x.check === id)!.failure).map(f => `${f!.class}/${f!.reason}`))]
    return { check: id, key: k.key, object: k.object, classes }
  })
  return { products: results, fail_everywhere, rulings: [...ruled.entries()].map(([check, r]) => ({ check, ...r })) }
}

export function renderDetect(r: DetectReport, state: Exp2State): string {
  const key = (id: string) => state.checks.find(c => c.id === id)?.key ?? id
  const list = (f: Record<string, string[]>, prefix: string) => Object.entries(f).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => `${k.split("/")[1]}: ${v.map(key).join(", ")}`).join("; ") || "—"
  const lines = [
    "# Detection on products with known official results", "",
    "| product | round | official | built | checks | passed | not landed (by cause) | disputed (by cause) | unknown | objects not landed |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...r.products.map(p => p.built
      ? `| ${p.product.name} | ${p.product.round} | ${p.product.official ?? ""} | yes | ${p.runs.length} | ${p.runs.filter(x => x.outcome === "pass").length} | ${list(p.failures, "not_landed")} | ${list(p.failures, "disputed")} | ${list(p.failures, "unknown")} | ${p.not_landed.join(", ") || "—"} |`
      : `| ${p.product.name} | ${p.product.round} | ${p.product.official ?? ""} | **no** | | | | | | |`),
    "", "## Checks that fail on every product that ran them", "",
    ...(r.fail_everywhere.length ? r.fail_everywhere.map(c => `- ${c.check} ${c.key} (${c.object}): ${c.classes.join(", ")}`) : ["(none)"]),
    "", "## Failure details", "",
    ...r.products.filter(p => p.built).flatMap(p => [`### ${p.product.name}`, "", ...p.runs.filter(x => x.failure).map(x => `- ${x.check} ${key(x.check)}: ${x.failure!.class}/${x.failure!.reason} — ${x.failure!.detail.slice(0, 300).replace(/\n/gu, " ")}`), ""]),
  ]
  return lines.join("\n") + "\n"
}
