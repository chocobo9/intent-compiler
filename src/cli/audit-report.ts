import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { IntentStoreV2 } from "../core/compiler-store-v2.js"
import { buildAuditReport, summarizeAuditReport } from "../runtime/audit-report.js"

/**
 * Read one run's compiler store and print the audit facts for it.  This is a
 * read-only view: it never writes to the store and never changes a run.
 *
 *   intent-audit-report <store-dir> <run-id> [--out report.json] [--summary-only]
 */
function main(argv: string[]): number {
  const [storeDir, runId] = argv
  if (storeDir === undefined || runId === undefined) {
    console.error("usage: intent-audit-report <store-dir> <run-id> [--out report.json] [--summary-only]")
    return 2
  }
  if (!isAbsolute(storeDir)) {
    console.error("store-dir must be an absolute path")
    return 2
  }
  const snapshotPath = join(resolve(storeDir), "v2-runs", runId, "snapshot.json")
  if (!existsSync(snapshotPath)) {
    console.error(`no snapshot for run ${runId} under ${storeDir}`)
    return 1
  }
  // Reading through the store keeps the same migration the runtime applies to
  // older runs, so the report sees the ledger the compiler would see.
  const snapshot = new IntentStoreV2({ storeDir: resolve(storeDir), runId }).current()
  const report = buildAuditReport(snapshot)
  console.log(summarizeAuditReport(report))
  const outIndex = argv.indexOf("--out")
  if (outIndex >= 0) {
    const outPath = argv[outIndex + 1]
    if (outPath === undefined || !isAbsolute(outPath)) {
      console.error("--out requires an absolute path")
      return 2
    }
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
    console.log(`wrote ${outPath}`)
  }
  if (!argv.includes("--summary-only")) {
    console.log(JSON.stringify(report, null, 2))
  }
  return 0
}

process.exitCode = main(process.argv.slice(2))
