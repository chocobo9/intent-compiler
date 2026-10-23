#!/usr/bin/env node
import { resolve } from "node:path"
import { assembleSerial, loadLocalConfig, preflight } from "../exp2/local-config.js"

/**
 * Runs the exp2 serial from a configuration file (see exp2/local-config.example.json). Running it again resumes
 * from the latest checkpoint. Usage: intent-exp2-serial --config <file> [--to <round>]
 */
async function main(argv: string[]): Promise<number> {
  const at = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  const file = at("--config")
  if (!file) { process.stderr.write("usage: intent-exp2-serial --config <file> [--to <round>]\n"); return 2 }
  const config = loadLocalConfig(resolve(file))
  const to = Number(at("--to") ?? config.rounds)
  const problems = await preflight(config)
  if (problems.length) { process.stderr.write(`Preflight failed:\n- ${problems.join("\n- ")}\n`); return 2 }
  const { serial } = assembleSerial(config)
  const outcome = await serial.run({ to, resumeWaitMs: config.resume?.wait_ms, maxResumes: config.resume?.max_resumes, environmentWaitMs: config.resume?.environment_wait_ms })
  process.stdout.write(JSON.stringify(outcome, null, 2) + "\n")
  return outcome.status === "done" ? 0 : outcome.status === "suspended" ? 3 : 1
}

main(process.argv.slice(2)).then(code => process.exit(code), e => { process.stderr.write(`${(e as Error).stack ?? e}\n`); process.exit(1) })
