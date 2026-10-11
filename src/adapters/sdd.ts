import { SddCompiler } from "../core/sdd-compiler.js"
import type { CIDelivery, SddResult, SddRun } from "../core/sdd-contract.js"

/** Host operations use the immutable claim identity as an idempotency key. */
export interface SddHost {
  prepare(run: SddRun, delivery: CIDelivery): Promise<{ directory: string; ci_ref: CIDelivery["ref"] }>
  launch(run: SddRun): Promise<void>
  inspect(run: SddRun): Promise<SddResult | undefined>
  locatePrepared?(run: SddRun): Promise<{ directory: string; ci_ref: CIDelivery["ref"] } | undefined>
}
export class SddAdapter {
  constructor(readonly compiler: SddCompiler, private readonly host: SddHost) {}
  async start(eventId: string, baseline: SddRun["baseline"], configDigest: string, voidedPrevious?: string, retryVoided?: string): Promise<SddRun> {
    const claim = await this.compiler.claim(eventId, baseline, configDigest, voidedPrevious, retryVoided)
    const delivery = this.compiler.inspect().batches.find(b => b.event_id === eventId)!.delivery!
    const prepared = await this.host.prepare(claim, delivery)
    await this.compiler.prepared(claim.run_id, prepared.directory, prepared.ci_ref)
    await this.compiler.launchClaim(claim.run_id)
    // Any failure from this point is ambiguous; only reconcile is legal, never start again.
    const run = this.compiler.inspect().runs.find(r => r.run_id === claim.run_id)!
    await this.host.launch(run)
    await this.compiler.started(claim.run_id)
    return this.compiler.inspect().runs.find(r => r.run_id === claim.run_id)!
  }
  async reconcile(runId: string): Promise<SddRun> {
    const run = this.compiler.inspect().runs.find(r => r.run_id === runId)
    if (!run) throw Error("Unknown SDD run")
    if (run.state === "returned") return run
    if (run.state === "preparing") {
      const prepared = await this.host.locatePrepared?.(run)
      if (prepared) await this.compiler.prepared(runId, prepared.directory, prepared.ci_ref)
      return this.compiler.inspect().runs.find(r => r.run_id === runId)!
    }
    const result = await this.host.inspect(run)
    if (result) await this.compiler.receive(result)
    return this.compiler.inspect().runs.find(r => r.run_id === runId)!
  }
  /** Resume only a proven prepared run, never an ambiguous launching/running run. */
  async launchPrepared(runId: string): Promise<void> {
    await this.compiler.launchClaim(runId)
    await this.host.launch(this.compiler.inspect().runs.find(r => r.run_id === runId)!)
    await this.compiler.started(runId)
  }
}
