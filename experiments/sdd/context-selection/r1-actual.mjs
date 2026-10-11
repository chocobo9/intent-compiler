/**
 * The adapted version's real R1 store (frozen R1 source, real management
 * answers): rebuild each stage's request at the state it was sent in, with the
 * request the adapted version built and with the new construction.  Offline;
 * no model is called.
 *
 *   npm run build && node experiments/sdd/context-selection/r1-actual.mjs [--store <ci-sdd.json>]
 */
import { readFileSync, existsSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const project = resolve(here, "../../..")
const args = process.argv.slice(2)
const file = args[args.indexOf("--store") + 1] && args.includes("--store") ? args[args.indexOf("--store") + 1]
  : "D:/huawei/EvoCodeBench/harbor_runs/ic-sdd-dpipe-r1-20261009-133851z/store/ci-sdd.json"
if (!existsSync(file)) { console.log(`r1-actual: skipped, ${file} not found`); process.exit(0) }
const load = path => import(pathToFileURL(join(project, "dist", path)).href)
const { irRequest, deliveryRequest, checkRequest, assessRequest } = await load("core/sdd-context.js")
const { canonicalJson, digestText } = await load("core/intent-contract.js")
const { sourceSegments, userText } = await load("core/source-payload.js")
const { V2_COMPILER_CONTRACT } = await load("model/compiler-model-v2.js")

const final = JSON.parse(readFileSync(file, "utf8"))
const event = final.events[0]
const b = final.batches[0]
const at = (state, extra = {}) => ({ ...structuredClone(final), ir: {}, runs: [], assessment_calls: [], batches: [{ ...structuredClone(b), state, ...extra }] })
const irInput = { generation_stage: "ir", run_id: final.run_id, events: [event], source_events: [], source_segments: sourceSegments(final.events),
  event_source_refs: [{ source_id: event.event_id, digest: digestText(userText(event)) }], ir: {}, budget: { requests_used: 3, max_requests: 9 }, contract: V2_COMPILER_CONTRACT }
const sIr = at("ir"); delete sIr.batches[0].parent; delete sIr.batches[0].delivery
const sCi = at("ci"); delete sCi.batches[0].delivery
const sCheck = at("check")
const legacyCi = { ir: b.parent.ir, events: final.events, previous_deliveries: [], results: [], issues: [] }
const rows = [
  ["ir", irInput, irRequest(sIr, event, irInput)],
  ["ci", legacyCi, deliveryRequest(sCi, sCi.batches[0])],
  ["check", { ...legacyCi, delivery: b.delivery, previous_ir: {} }, checkRequest(sCheck, sCheck.batches[0])],
  ["assess", { delivery: b.delivery, result: final.runs[0].result, ir: b.parent.ir }, assessRequest(final, final.runs[0])],
]
const usage = { ir: b.calls.filter(c => c.stage === "ir").at(-1).call?.usage, ci: b.calls.filter(c => c.stage === "ci").at(-1).call?.usage, check: b.calls.filter(c => c.stage === "check").at(-1).call?.usage, assess: final.assessment_calls[0]?.call?.usage }
for (const [stage, legacy, built] of rows) {
  const a = canonicalJson(legacy).length, n = canonicalJson(built.request).length
  console.log(`${stage.padEnd(6)} adapted ${String(a).padStart(7)}  new ${String(n).padStart(7)}  ${(n / a * 100).toFixed(1).padStart(5)}%  recorded input_tokens ${usage[stage]?.input_tokens ?? "-"}  warnings ${built.report.warnings.length}  ${JSON.stringify(built.report.counts)}`)
}
