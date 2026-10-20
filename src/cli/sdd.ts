import { readFileSync } from "node:fs"
import { SddCompiler } from "../core/sdd-compiler.js"
import { SddAdapter } from "../adapters/sdd.js"
import { connectSddManagement, requireSeparateDirectories, type SddManagementConfig } from "../runtime/sdd-runtime.js"
import { createSddProcessHost } from "../runtime/sdd-host.js"
import type { SddModel } from "../model/sdd-model.js"

// Explicit command file keeps multiline user input out of shell quoting and never drains pending Atom work.
async function main() {
  const path = process.argv[2]
  if (!path) throw Error("Usage: node dist/cli/sdd.js <command.json> (inspect|compile|reopen|adopt|start|reconcile|launch-prepared)")
  const c = JSON.parse(readFileSync(path, "utf8")) as {
    command: string; store: string; run_id: string; event_id: string; execution_id: string;
    event?: Parameters<SddCompiler["accept"]>[0]; observations?: Parameters<SddCompiler["accept"]>[2]; max_requests: number; extra_requests: number; reason: string;
    management: SddManagementConfig; host: Parameters<typeof createSddProcessHost>[0];
    baseline: { path: string; digest: string }; config_digest: string; previous_voided?: string; retry_voided?: string; directory: string; result: Parameters<SddCompiler["receive"]>[0];
  }
  const disabled = async (): Promise<never> => { throw Error("This operation cannot call a model") }
  const noModel: SddModel = { ir: { propose: disabled }, deliver: disabled, check: disabled }
  let compiler = new SddCompiler(c.store, c.run_id, noModel)
  if (c.command === "compile") compiler = await connectSddManagement(c.store, c.run_id, c.management)
  if (c.command === "inspect") {
    const s = compiler.inspect()
    console.log(JSON.stringify(s, null, 2)); return
  }
  if (c.command === "adopt") { console.log(JSON.stringify(await compiler.adopt(c.execution_id, c.reason), null, 2)); return }
  if (c.command === "reopen") { console.log(JSON.stringify(await compiler.reopen(c.event_id, c.extra_requests, c.reason), null, 2)); return }
  if (c.command === "compile") {
    if (c.event) await compiler.accept(c.event, c.max_requests, c.observations)
    console.log(JSON.stringify(await compiler.advance(c.event?.event_id ?? c.event_id), null, 2)); return
  }
  if (c.command === "claim-adopted") {
    // An already completed SDD run is adopted for this delivery: claimed and bound to its directory, never prepared or launched.
    const claim = await compiler.claim(c.event_id, c.baseline, c.config_digest)
    await compiler.prepared(claim.run_id, c.directory, claim.ci_ref)
    await compiler.launchClaim(claim.run_id)
    await compiler.started(claim.run_id)
    console.log(JSON.stringify(compiler.inspect().runs.find(r => r.run_id === claim.run_id), null, 2)); return
  }
  if (c.command === "receive") { await compiler.receive(c.result); console.log(JSON.stringify(compiler.inspect().runs.at(-1), null, 2)); return }
  if (!["start", "reconcile", "launch-prepared"].includes(c.command)) throw Error("Unknown command")
  if (c.command === "start") requireSeparateDirectories(c.management.directory, c.baseline.path)
  const adapter = new SddAdapter(compiler, createSddProcessHost(c.host))
  if (c.command === "launch-prepared") { await adapter.launchPrepared(c.execution_id); console.log(JSON.stringify(compiler.inspect().runs)); return }
  const run = c.command === "start" ? await adapter.start(c.event_id, c.baseline, c.config_digest, c.previous_voided, c.retry_voided) : await adapter.reconcile(c.execution_id)
  console.log(JSON.stringify(run, null, 2))
}
main().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1 })
