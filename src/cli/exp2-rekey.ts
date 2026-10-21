#!/usr/bin/env node
import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { emptyCassette, rekeyAttribution, saveCassette } from "../exp2/recording.js"

/**
 * Re-keys recorded attribution answers (`R<n>-ans<k>.json` in a directory) against the requests the current code
 * builds, and writes a cassette for replay. Usage:
 *   intent-exp2-rekey --answers <dir> --inputs <dir> --rounds <n> --label <model label> --from <commit> --out <file>
 */
async function main(argv: string[]): Promise<number> {
  const at = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  const [dir, inputs, rounds, label, from, out] = ["--answers", "--inputs", "--rounds", "--label", "--from", "--out"].map(at)
  if (!dir || !inputs || !rounds || !label || !out) { process.stderr.write("usage: intent-exp2-rekey --answers <dir> --inputs <dir> --rounds <n> --label <label> [--from <commit>] --out <file>\n"); return 2 }
  const n = Number(rounds)
  const pad = (k: number) => String(k).padStart(2, "0")
  const texts = Array.from({ length: n }, (_, i) => readFileSync(join(resolve(inputs), `round-${pad(i + 1)}.md`), "utf8"))
  const files = readdirSync(resolve(dir))
  const answers = texts.map((_, i) => files.filter(f => new RegExp(`^R${i + 1}-ans\\d+\\.json$`, "u").test(f))
    .sort((a, b) => Number(/ans(\d+)/u.exec(a)![1]) - Number(/ans(\d+)/u.exec(b)![1])).map(f => readFileSync(join(resolve(dir), f), "utf8")))
  const cassette = { ...emptyCassette(label), ...(from ? { rekeyed_from: from, note: `Answers recorded against requests built at ${from}; the requests here are rebuilt by the current code, answers given in their recorded order.` } : {}) }
  const rounds_ = await rekeyAttribution(mkdtempSync(join(tmpdir(), "exp2-rekey-")), texts, answers, cassette)
  saveCassette(resolve(out), cassette)
  process.stdout.write(JSON.stringify(rounds_, null, 1) + "\n")
  return rounds_.every(r => r.status === "accepted" && r.used === r.recorded) ? 0 : 1
}

main(process.argv.slice(2)).then(code => process.exit(code), e => { process.stderr.write(`${(e as Error).stack ?? e}\n`); process.exit(1) })
