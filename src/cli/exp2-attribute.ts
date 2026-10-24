#!/usr/bin/env node
import { resolve } from "node:path"
import { attributeOnly } from "../exp2/attribute.js"
import { loadGold } from "../exp2/gold.js"
import { attributionTransportOf, codeGoldDir, loadLocalConfig } from "../exp2/local-config.js"

/**
 * Attribution alone over a task's rounds (the chain block, effect 5): the modifications and edges each round records,
 * and, with --gold-task, revision recall and precision and relation recall against the gold sets. The model is the
 * configuration's management server and model. Usage:
 * intent-exp2-attribute --config <file> --inputs <dir> --to <round> --out <dir> [--gold-task <name>] [--gold-dir <dir>]
 */
async function main(argv: string[]): Promise<number> {
  const at = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  const file = at("--config"), inputs = at("--inputs"), out = at("--out"), to = Number(at("--to"))
  if (!file || !inputs || !out || !Number.isSafeInteger(to) || to < 1) { process.stderr.write("usage: intent-exp2-attribute --config <file> --inputs <dir> --to <round> --out <dir> [--gold-task <name>] [--gold-dir <dir>]\n"); return 2 }
  const config = loadLocalConfig(resolve(file))
  const task = at("--gold-task"), dir = at("--gold-dir") ?? codeGoldDir()
  const gold = task ? loadGold(resolve(dir), task) : null
  if (task && !gold) { process.stderr.write(`no gold sets in ${dir}\n`); return 2 }
  const rounds = await attributeOnly({ inputs: resolve(inputs), to, out: resolve(out), transport: attributionTransportOf(config), maxRepairs: config.limits?.attribution_repairs ?? 2, gold })
  process.stdout.write(`${rounds.map(r => `R${r.round} ${r.status}: ${r.modifications.length} modifications, ${r.edges.length} edges${r.revision ? `; revision ${r.revision.hit}/${r.revision.located}` : ""}${r.relation ? `; relation ${r.relation.hit}/${r.relation.located}` : ""}`).join("\n")}\n`)
  return rounds.every(r => r.status === "accepted") ? 0 : 1
}

main(process.argv.slice(2)).then(code => process.exit(code), e => { process.stderr.write(`${(e as Error).stack ?? e}\n`); process.exit(1) })
