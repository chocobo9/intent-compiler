import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { canonicalJson, digestOf, digestText, validateEvent, type CompilerEvent, type ContentItem, type Ref, type TaskIntent } from "./intent-contract.js"
import { prepareIntentIR } from "./parent-generation.js"
import { resolveSourceRefs } from "./intent-compiler-v2.js"
import { locateQuote, sourceSegments, userText } from "./source-payload.js"
import { Ajv } from "ajv"
import { createCompilerModelV2, V2_COMPILER_CONTRACT, type CompilerModelV2Input, type CompilerModelV2Result } from "../model/compiler-model-v2.js"
import { buildGenerationSchema } from "../model/generation-schema.js"
import { normalizeIrProposal, type IrNormalization } from "./sdd-ir-normalize.js"
import { decodeSdd, SDD_DELIVERY_SCHEMA, SDD_CHECK_SCHEMA, SDD_EXAMPLES_SCHEMA, SDD_DERIVE_SCHEMA, type ExamplesRequest, type SddModel, type SddCheck } from "../model/sdd-model.js"
import { SDD_PROFILE, type CIDelivery, type DeliveryContract, type DeliveryDraft, type RemovedPassage, type SddBatch, type SddCheckFinding, type SddRun, type SddResult, type SddSnapshot } from "./sdd-contract.js"
import { checkRequest, deliveryRequest, irRequest, type CheckRequest, type ContextReport, type DeliveryRequest } from "./sdd-context.js"
import { currentRevisions, narrowedItems, planCarry, previousContract } from "./sdd-increment.js"
import { markCheckable } from "./sdd-examples.js"
import { LEDGER_FEEDBACK, computeLedger, ledgerSection } from "./sdd-ledger.js"
import { changeSection, changedItems, settleChanges } from "./sdd-changes.js"
import { carryExecutable, executableSection, keepExamples, type Derivation, type ProposedExample } from "./sdd-executable.js"

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
function requireThat(value: unknown, message: string): asserts value { if (!value) throw Error(message) }
function unique(values: string[], label: string): void {
  const seen = new Set<string>(), repeated = new Set<string>()
  for (const v of values) (seen.has(v) ? repeated : seen).add(v)
  // Name what repeats, so the next answer can merge exactly those entries.
  requireThat(!repeated.size, `Duplicate ${label}: ${[...repeated].join(", ")}; give each only once, combining what the repeated entries say into one entry`)
}

/** A separate durable store and entry point: never calls authorize/pendingDeliveries. */
export class SddCompiler {
  readonly directory: string
  private readonly file: string
  constructor(directory: string, readonly runId: string, private readonly model: SddModel) {
    this.directory = resolve(directory)
    mkdirSync(this.directory, { recursive: true })
    this.file = resolve(this.directory, "ci-sdd.json")
    requireThat(!existsSync(resolve(this.directory, "snapshot.json")), "Use a new store; legacy Atom snapshots cannot be mixed")
  }
  inspect(): SddSnapshot {
    if (!existsSync(this.file)) return { profile: SDD_PROFILE, run_id: this.runId, events: [], ir: {}, batches: [], runs: [] }
    const s = JSON.parse(readFileSync(this.file, "utf8")) as SddSnapshot
    requireThat(s.profile === SDD_PROFILE && s.run_id === this.runId && Array.isArray(s.runs) && Array.isArray(s.batches), "Store profile/run mismatch")
    return s
  }
  private save(s: SddSnapshot): void {
    const temp = `${this.file}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(s, null, 2) + "\n", "utf8")
    renameSync(temp, this.file)
  }
  private async transaction<T>(action: (s: SddSnapshot) => Promise<T> | T): Promise<T> {
    const lock = `${this.file}.lock`
    // A live owner blocks concurrent mutation; a dead process leaves only management work to resume.
    if (existsSync(lock)) {
      const pid = Number(readFileSync(lock, "utf8"))
      requireThat(Number.isSafeInteger(pid) && pid > 0, "Invalid store lock; inspect before recovery")
      let alive = true
      try { process.kill(pid, 0) } catch (e) { if ((e as NodeJS.ErrnoException).code === "ESRCH") alive = false; else throw e }
      requireThat(!alive, "Compiler store is busy")
      unlinkSync(lock)
    }
    const fd = openSync(lock, "wx")
    try { writeFileSync(fd, String(process.pid)); return await action(this.inspect()) }
    finally { closeSync(fd); unlinkSync(lock) }
  }
  async accept(event: CompilerEvent, maxRequests: number): Promise<void> {
    await this.transaction(s => {
      validateEvent(event)
      requireThat(event.run_id === this.runId && event.kind === "user_input" && event.source.channel === "user", "Only user updates create delivery batches")
      requireThat(Number.isSafeInteger(maxRequests) && maxRequests >= 3, "Explicit management budget of at least IR+CI+check is required")
      const old = s.events.find(e => e.event_id === event.event_id)
      if (old) { requireThat(same(old, event), "Event identity conflict"); return }
      requireThat(!s.batches.some(b => !["accepted", "rejected"].includes(b.state)), "Finish or explicitly reject the pending management batch first")
      s.events.push(structuredClone(event))
      s.batches.push({ event_id: event.event_id, state: "ir", requests_used: 0, max_requests: maxRequests, calls: [] })
      this.save(s)
    })
  }
  /**
   * Resume a rejected batch after an adapter change, with an explicit number
   * of extra management calls. It continues from the stage its IR reached;
   * earlier calls and their errors stay recorded.
   */
  async reopen(eventId: string, extraRequests: number, reason: string): Promise<SddBatch> {
    return this.transaction(s => {
      const batch = s.batches.find(b => b.event_id === eventId)
      requireThat(batch?.state === "rejected", "Only a rejected batch can be reopened")
      requireThat(s.batches.at(-1) === batch, "Only the latest batch can be reopened")
      requireThat(!s.runs.some(r => r.event_id === eventId), "This batch already has an SDD run")
      requireThat(Number.isSafeInteger(extraRequests) && extraRequests > 0 && reason.trim(), "Reopening needs an explicit budget and reason")
      ;(batch.reopened ??= []).push({ reason, extra_requests: extraRequests, requests_used: batch.requests_used, previous_error: batch.error ?? "" })
      batch.max_requests += extraRequests
      batch.state = batch.parent ? "ci" : "ir"
      delete batch.delivery
      // The last rejection stays as the issue the next call repairs (with last_draft at the CI stage).
      if (batch.error === "Management request budget exhausted") delete batch.error
      this.save(s)
      return structuredClone(batch)
    })
  }
  /** Management recovery consumes the same persisted budget; it never launches SDD. */
  async advance(eventId: string): Promise<SddBatch> {
    return this.transaction(async s => {
      const batch = s.batches.find(b => b.event_id === eventId)
      requireThat(batch, "Unknown user event")
      if (["accepted", "rejected"].includes(batch.state)) return structuredClone(batch)
      const event = s.events.find(e => e.event_id === eventId)!
      while (batch.requests_used < batch.max_requests && !["accepted", "rejected"].includes(batch.state)) {
        // The examples stage never holds back the delivery: it writes what it can and accepts.
        if (batch.state === "examples") { await this.writeExamples(s, batch); this.acceptBatch(s, batch); this.save(s); continue }
        const needed = batch.state === "ir" ? 3 : batch.state === "ci" ? 2 : 1
        if (batch.max_requests - batch.requests_used < needed) break
        const stage = batch.state
        // Code keeps the full input for preparation; the model receives the
        // request built from the store.  A request that cannot be built
        // completely is a deterministic defect: it is reported, never sent.
        const input: CompilerModelV2Input | undefined = stage !== "ir" ? undefined : {
          generation_stage: "ir", run_id: this.runId, events: [event], source_events: s.events.filter(e => e.event_id !== eventId),
          source_segments: sourceSegments(s.events), event_source_refs: [{ source_id: eventId, digest: digestText(userText(event) ?? "") }],
          ir: s.ir, budget: { requests_used: batch.requests_used + 1, max_requests: batch.max_requests }, contract: V2_COMPILER_CONTRACT,
          ...(batch.error ? { validation_errors: [batch.error] } : {}),
        }
        let built: { request: unknown; report: ContextReport }
        try {
          built = stage === "ir" ? irRequest(s, event, input as unknown as Parameters<typeof irRequest>[2])
            : stage === "ci" ? deliveryRequest(s, batch) : checkRequest(s, batch)
        } catch (error) {
          batch.state = "rejected"; batch.error = `${stage} request cannot be built: ${error instanceof Error ? error.message : String(error)}`
          this.save(s); return structuredClone(batch)
        }
        batch.requests_used++
        if (stage === "ir") built.report.warnings.push("sent in the full IR input form; this report describes the compressed view that was not sent")
        const record: SddBatch["calls"][number] = { stage, context: built.report }
        batch.calls.push(record); this.save(s) // Crash cannot refund a model invocation.
        try {
          if (stage === "ir") {
            // The IR model receives the full input form it was built and validated on.
            // The pointer-compressed view (built above only for the record) led the model
            // to answer in a malformed shape on revision rounds; see the 2026-10-10 decisions.
            let proposed = await this.model.ir.propose(input!)
            record.call = proposed.call
            // A shape-only defect with exactly one mapping is repaired by code and re-validated by the same path.
            const repaired = proposed.ok ? undefined : await reproposeNormalized(proposed, input!)
            if (repaired) { record.normalized = repaired.changes; proposed = repaired.result }
            requireThat(proposed.ok && proposed.ir_proposal, proposed.error?.message ?? "No IR proposal")
            batch.parent = prepareIntentIR(input!, proposed.ir_proposal, candidate => resolveSourceRefs(candidate, s.events), candidate => ({
              ok: same(candidate.basis.event_ids, [eventId]), message: "IR basis must name this user update exactly",
            }))
            batch.state = "ci"
          } else if (stage === "ci") {
            record.call = await this.model.deliver(built.request as DeliveryRequest)
            const draft = decodeSdd<DeliveryDraft>(record.call, SDD_DELIVERY_SCHEMA)
            // Kept whether or not it holds: a repair revises this draft instead of starting over.
            batch.last_draft = draft
            batch.delivery = this.assemble(s, batch, draft)
            batch.state = "check"
          } else {
            requireThat(batch.delivery && batch.parent, "Missing frozen CI/check input")
            const request = built.request as CheckRequest
            record.call = await this.model.check(request)
            const check = decodeSdd<SddCheck>(record.call, SDD_CHECK_SCHEMA)
            // Only a finding whose evidence resolves against what this request
            // showed can block; the rest are recorded and set aside.
            const findings = resolveCheckFindings(check.findings, request, s)
            ;(batch.checks ??= []).push({ verdict: check.verdict, repair_stage: check.repair_stage, findings })
            // Only a resolved blocking finding sends the batch back; notes are recorded.
            const blocking = findings.filter(f => f.evidence_resolved && f.severity === "blocking")
            if (blocking.length > 0) {
              requireThat(check.repair_stage !== "none", "A blocking check finding needs a repair target")
              batch.state = check.repair_stage
              if (batch.state === "ir") { delete batch.parent; delete batch.delivery; delete batch.last_draft }
              const rest = findings.length - blocking.length
              throw Error(`Independent check: ${blocking.map(f => `${f.dimension} ${f.claim} - expected ${f.expected}, observed ${f.observed}`).join("; ")}${rest ? ` (${rest} further finding(s) are notes or cite nothing this check showed; recorded, not applied)` : ""}`)
            }
            if (this.model.examples && this.model.derive) batch.state = "examples"
            else this.acceptBatch(s, batch)
          }
          delete batch.error
        } catch (error) { batch.error = error instanceof Error ? error.message : String(error); record.error = batch.error }
        this.save(s)
      }
      // The examples stage has its own two calls, outside the management budget, so it runs however many calls the CI took.
      if (batch.state === "examples") { await this.writeExamples(s, batch); this.acceptBatch(s, batch); this.save(s) }
      if (batch.state !== "accepted") { batch.state = "rejected"; batch.error ??= "Management request budget exhausted"; this.save(s) }
      return structuredClone(batch)
    })
  }
  private acceptBatch(s: SddSnapshot, batch: SddBatch): void {
    s.ir = batch.parent!.ir
    batch.state = "accepted"
    delete batch.error
  }
  /** Items this delivery does not deliver (paused or unresolved). */
  private undelivered(batch: SddBatch): Set<string> {
    return new Set(batch.delivery!.draft.tasks.flatMap(t => t.coverage.filter(c => c.disposition !== "assigned" && c.disposition !== "supported").map(c => c.item_id)))
  }
  /** Carry the previous executable examples whose items are unchanged; no model call. */
  private carryOnly(s: SddSnapshot, batch: SddBatch): void {
    const d = batch.delivery!
    const { carried, dropped } = carryExecutable(previousContract(s, batch)?.executable, batch.parent!.ir, this.undelivered(batch), narrowedItems(s.ir, batch.parent!.ir))
    this.setExecutable(d, carried, dropped)
  }
  private setExecutable(d: CIDelivery, executable: NonNullable<DeliveryContract["executable"]>, dropped: DeliveryContract["dropped"]): void {
    d.contract.executable = executable
    d.contract.dropped.push(...dropped)
    const at = d.text.indexOf("\n## Original user update 1")
    if (at >= 0) d.text = `${d.text.slice(0, at + 1)}${executableSection(executable)}${d.text.slice(at + 1)}`
    const { ref, ...content } = d
    d.ref = { ...ref, digest: digestOf(content) }
  }
  /**
   * The separate examples call (and, for derived examples, the independent
   * derivation) for the requirements this round writes for. Failures are
   * recorded; the delivery goes ahead with what was carried and kept.
   */
  private async writeExamples(s: SddSnapshot, batch: SddBatch): Promise<void> {
    const d = batch.delivery!, ir = batch.parent!.ir
    const excluded = this.undelivered(batch)
    const previous = previousContract(s, batch)
    const { carried, dropped, rewrite } = carryExecutable(previous?.executable, ir, excluded, narrowedItems(s.ir, ir))
    const toWrite = [...new Set([...planCarry(previous, s.ir, ir).toWrite, ...rewrite])].filter(id => !excluded.has(id))
    const counts = { verbatim: 0, derived_kept: 0, derived_dropped: 0, not_checkable: 0, invalid_input: 0, runs_kept: 0, runs_dropped: 0 }
    let kept: NonNullable<DeliveryContract["executable"]> = []
    let state: "written" | "failed" | "skipped" = "written", reason: string | undefined
    // The examples stage has its own limit per user update, outside the management budget.
    const used = batch.calls.filter(c => c.stage === "examples" || c.stage === "derive").length
    if (!toWrite.length) { state = "skipped"; reason = "no requirement to write examples for" }
    else if (used + 2 > EXAMPLES_CALL_LIMIT) { state = "skipped"; reason = `examples-stage call limit (${EXAMPLES_CALL_LIMIT}) reached: ${used} used` }
    else {
      const requirements = Object.values(ir).flatMap(t => t.content).filter(c => toWrite.includes(c.item_id)).map(c => ({ item_id: c.item_id, revision: c.revision, text: c.text }))
      // The other delivered requirements, read only: the command lines, options and input formats an example's invocation must follow.
      const context = Object.values(ir).flatMap(t => t.content).filter(c => !toWrite.includes(c.item_id) && !excluded.has(c.item_id)).map(c => ({ item_id: c.item_id, text: c.text }))
      const request: ExamplesRequest = { request_view: "The requirements to write executable examples for, as their original text; context holds the other current requirements, read only; carried examples are named.", requirements, context,
        carried: carried.map(e => `${e.subject}: ${e.given.replace(/\s+/gu, " ").slice(0, 100)}`),
        field_dictionary: d.contract.fields.filter(o => o.items.some(id => toWrite.includes(id))).map(o => ({ object: o.object, fields: o.fields.map(f => f.field) })), issues: [] }
      const record: SddBatch["calls"][number] = { stage: "examples" }
      batch.calls.push(record); this.save(s)
      try {
        record.call = await this.model.examples!(request)
        const proposal = decodeSdd<{ examples: ProposedExample[] }>(record.call, SDD_EXAMPLES_SCHEMA)
        // Every example goes to the independent derivation: it judges the invocation and works out the result without seeing the expectations.
        const derived = proposal.examples.map((e, index) => ({ e, index }))
        const derivedChecks = new Map<number, Derivation>()
        if (derived.length) {
          const again: SddBatch["calls"][number] = { stage: "derive" }
          batch.calls.push(again); this.save(s)
          try {
            again.call = await this.model.derive!({ request_view: "Judge each example's invocation and work out its result from the requirements; the examples' own expectations are not shown.", requirements, context,
              examples: derived.map(x => ({ index: x.index, given: x.e.given, run: x.e.run })) })
            for (const r of decodeSdd<{ results: Array<Derivation & { index: number }> }>(again.call, SDD_DERIVE_SCHEMA).results) derivedChecks.set(r.index, r)
          } catch (error) { again.error = error instanceof Error ? error.message : String(error) }
        }
        const original = d.text.slice(d.text.indexOf("## Original user update 1"))
        const result = keepExamples(proposal.examples, derivedChecks, original, ir, batch.event_id)
        kept = result.kept; Object.assign(counts, result.counts)
      } catch (error) { state = "failed"; reason = error instanceof Error ? error.message : String(error); record.error = reason }
    }
    d.examples_call = { state, ...(reason ? { reason } : {}), ...counts }
    this.setExecutable(d, [...carried, ...kept], dropped)
  }
  private assemble(s: SddSnapshot, b: SddBatch, draft: DeliveryDraft): CIDelivery {
    const ir = b.parent!.ir
    unique(draft.tasks.map(t => t.task_id), "task")
    requireThat(same([...draft.tasks.map(t => t.task_id)].sort(), Object.keys(ir).sort()), `CI must account for every current task: expected task_id ${Object.keys(ir).sort().join(", ")}; got ${draft.tasks.map(t => t.task_id).sort().join(", ") || "none"}`)
    requireThat(draft.reason.trim(), "CI decision needs a reason")
    const segments = new Map(sourceSegments(s.events).map(x => [`${x.source_id}|${x.segment_id}`, x]))
    // What this round writes (to_write) and what code carries, as the CI request stated it.
    const previous = previousContract(s, b)
    const plan = planCarry(previous, s.ir, ir)
    const delivered: ContentItem[] = []
    const dispositions = new Map<ContentItem, string>()
    const effective: EffectivePlacement[] = []
    for (const t of draft.tasks) {
      const task = ir[t.task_id]!
      unique(t.coverage.map(c => c.item_id), "coverage")
      const given = new Set(t.coverage.map(c => c.item_id)), expected = new Set(task.content.map(c => c.item_id))
      const missing = [...expected].filter(id => !given.has(id)), unknown = [...given].filter(id => !expected.has(id))
      requireThat(!missing.length && !unknown.length, `Every IR requirement needs exactly one disposition: task ${t.task_id}${missing.length ? `; missing coverage for item_id ${missing.join(", ")}` : ""}${unknown.length ? `; coverage names item_id ${unknown.join(", ")}, which task ${t.task_id} does not have` : ""}. Give one coverage entry for each of: ${[...expected].join(", ")}`)
      requireThat(t.coverage.every(c => c.explanation.trim()), "Coverage needs explanation")
      const chosen = t.coverage.filter(c => c.disposition === "assigned" || c.disposition === "supported")
      for (const c of t.coverage) dispositions.set(task.content.find(x => x.item_id === c.item_id)!, c.disposition)
      unique(t.effective.map(e => e.item_id), "effective statement")
      for (const e of t.effective) {
        requireThat(chosen.some(c => c.item_id === e.item_id), `Effective statement for ${e.item_id} needs a delivered requirement`)
        requireThat(e.text.trim() && e.basis.length > 0, `Effective statement for ${e.item_id} needs text and basis`)
        requireThat(e.basis.every(x => segments.has(`${x.source_id}|${x.segment_id}`)), `Effective statement for ${e.item_id} cites an unknown input segment`)
        requireThat(plan.toWrite.includes(e.item_id), `Effective statement for ${e.item_id}: this requirement is unchanged since the accepted delivery and its effective statement, if any, is carried by code; write effective only for requirements in to_write`)
        const item = task.content.find(x => x.item_id === e.item_id)!
        // An effective statement restates what a later input changed in an earlier one; a requirement
        // whose passages all come from one input has nothing to restate (its text is attached verbatim).
        const order = new Map(s.events.map((x, i) => [x.event_id, i]))
        const inputs = new Set(item.sources.map(x => x.source_id))
        requireThat(inputs.size > 1, `Effective statement for ${e.item_id}: its passages all come from one input (${[...inputs].join(", ")}), so no later input changes it; leave effective out for it — its original text is delivered verbatim`)
        const earliest = Math.min(...[...inputs].map(id => order.get(id) ?? Infinity))
        requireThat(e.basis.some(x => (order.get(x.source_id) ?? -1) > earliest), `Effective statement for ${e.item_id}: its basis must include the later input that changes the requirement, not only its earliest input`)
        effective.push({ item, entry: e })
      }
      if (chosen.length) requireThat(draft.decision === "deliver" && task.current_scope.disposition === "proceed", "Selected requirements require approved proceed scope")
      delivered.push(...chosen.map(c => task.content.find(x => x.item_id === c.item_id)!))
    }
    requireThat(draft.decision === "deliver" ? delivered.length > 0 : delivered.length === 0, "Delivery decision and selected coverage disagree")
    const original = s.events.map(e => userText(e) ?? "").join("\n")
    // An effective statement that repeats the original restates nothing.
    for (const { entry } of effective) {
      const sentences = entry.text.split(/(?<=[.!?。])\s+|\n+/u).map(x => x.trim()).filter(x => x.length >= 20)
      const copied = sentences.filter(x => original.includes(x)).reduce((n, x) => n + x.length, 0)
      requireThat(!sentences.length || copied < 0.6 * sentences.reduce((n, x) => n + x.length, 0),
        `Effective statement for ${entry.item_id} is the same as the original text, which is delivered verbatim; no effective statement is needed for it — give one only to state, in new words, what a later input makes hold`)
    }
    // The final carry: entries of requirements not delivered now are dropped too.
    const now = currentRevisions(ir)
    const excluded = new Set([...dispositions].filter(([, d]) => d !== "assigned" && d !== "supported").map(([item]) => item.item_id))
    const final = planCarry(previous, s.ir, ir, excluded)
    const writtenFields = draft.fields, writtenSubjects = draft.acceptance
    const carriedNames = (names: string[], written: string[], kind: string) => {
      const clash = written.filter(n => names.includes(n))
      requireThat(!clash.length, `${kind} ${clash.join(", ")} already carried unchanged from the accepted delivery; use another name or leave it out`)
    }
    carriedNames(final.fields.map(o => o.object), writtenFields.map(o => o.object), "Field dictionary object")
    carriedNames(final.acceptance.map(a => a.subject), writtenSubjects.map(a => a.subject), "Acceptance subject")
    for (const [kind, entries] of [["field dictionary object", writtenFields.map(o => ({ name: o.object, items: o.items }))], ["acceptance subject", writtenSubjects.map(a => ({ name: a.subject, items: a.items }))]] as const) {
      for (const e of entries) {
        const unknown = e.items.filter(id => !now.has(id))
        requireThat(e.items.length && !unknown.length, `${kind} ${e.name}: items must name current IR content items${unknown.length ? `; unknown ${unknown.join(", ")}` : " (none given)"}`)
        requireThat(e.items.some(id => plan.toWrite.includes(id)), `${kind} ${e.name}: describes only requirements carried unchanged (${e.items.join(", ")}); write entries only for requirements in to_write`)
      }
    }
    for (const c of final.effective) {
      const item = ir[c.task_id]?.content.find(x => x.item_id === c.entry.item_id)
      if (item && !excluded.has(item.item_id)) effective.push({ item, entry: c.entry })
    }
    const earlier = s.batches.filter(x => x.state === "accepted" && x.parent && x.event_id !== b.event_id).map(x => x.parent!.ir)
    // A hold delivers nothing, so it has no SDD input text.
    const built = delivered.length === 0 ? { text: "", removed: [] } : accumulatedText(s.events, earlier, ir, delivered, dispositions, effective)
    // An effective statement must not bring back original text this delivery cuts as withdrawn or superseded.
    for (const { entry } of effective) {
      const back = built.removed.map(r => r.text.trim()).filter(t => t.length >= 20 && entry.text.includes(t))
      requireThat(!back.length, `Effective statement for ${entry.item_id} repeats text this delivery cuts as withdrawn or superseded: ${back.map(t => JSON.stringify(t.slice(0, 120))).join("; ")}; state only what holds now`)
    }
    const removed = built.removed
    let text = built.text
    const emptyObjects: string[] = [], namesAdded: string[] = []
    const revisionsOf = (items: string[]) => Object.fromEntries(items.map(id => [id, now.get(id)!]))
    const taskOf = (itemId: string) => Object.values(ir).find(t => t.content.some(c => c.item_id === itemId))!.task_id
    const contract: DeliveryContract = { fields: [], acceptance: [], effective: [], dropped: [...final.dropped] }
    // Requirements the starting code does not meet, from the store's run results (code, not model).
    const ledger = computeLedger(s, ir)
    // This round's change list (not in the first delivery, where everything is new): the model's entries settled by code against the IR change.
    const settled = Object.keys(s.ir).length ? settleChanges(draft.changes ?? [], changedItems(s.ir, ir, excluded)) : { changes: [], dropped: [] }
    contract.dropped.push(...settled.dropped)
    if (delivered.length) {
      // Newly written entries must hold; a carried entry whose names the delivered text no longer writes is dropped.
      checkFields(writtenFields, text, original)
      checkAcceptance(writtenSubjects, text, original, true)
      const carriedFields = final.fields.filter(o => { try { checkFields([o], text, original); return true } catch (e) { contract.dropped.push({ kind: "field", name: o.object, reason: (e as Error).message }); return false } })
      const carriedSubjects = final.acceptance.filter(a => { try { checkAcceptance([a], text, original, true); return true } catch (e) { contract.dropped.push({ kind: "acceptance", name: a.subject, reason: (e as Error).message }); return false } })
      contract.fields = [...carriedFields, ...writtenFields.map(o => ({ ...o, revisions: revisionsOf(o.items), carried: false }))]
      // Every example, carried or new, is marked checkable against what the delivered text writes now.
      contract.acceptance = markCheckable([...carriedSubjects, ...writtenSubjects.map(a => ({ ...a, revisions: revisionsOf(a.items), carried: false }))], text)
      contract.effective = [...final.effective.filter(c => !excluded.has(c.entry.item_id)),
        ...draft.tasks.flatMap(t => t.effective.map(entry => ({ task_id: taskOf(entry.item_id), revision: now.get(entry.item_id)!, entry, carried: false })))]
      requireThat(contract.acceptance.length > 0, "CI needs acceptance examples for the commands and operations the delivered requirements define")
      // Code merges repeated rows, leaves out objects without fields, and adds every name the text writes that no object lists.
      const completed = completeFields(contract.fields, text)
      emptyObjects.push(...completed.leftOut)
      namesAdded.push(...completed.added)
      text = `${ACCUMULATED_HEADER}\n${changeSection(settled.changes, LEDGER_FEEDBACK ? ledger : [], ir)}${fieldSection(completed.fields)}${acceptanceSection(contract.acceptance)}${LEDGER_FEEDBACK ? ledgerSection(ledger, ir) : ""}${text.slice(ACCUMULATED_HEADER.length)}`
    }
    const content = { profile: SDD_PROFILE, event_id: b.event_id, ir_digest: b.parent!.digest, draft, text, removed, contract, ...(settled.changes.length ? { changes: settled.changes } : {}), ...(Object.keys(s.ir).length && draft.changes === undefined ? { changes_not_given: true } : {}), ...(ledger.length ? { ledger } : {}), ...(emptyObjects.length ? { field_objects_left_out: emptyObjects } : {}), ...(namesAdded.length ? { field_names_added: namesAdded } : {}) }
    return { ...content, ref: { id: `ci-${digestText(this.runId + ":" + b.event_id).slice(0, 24)}`, revision: 1, digest: digestOf(content) } }
  }
  /** Durable claim precedes any external preparation. Repeating a claim never grants a second launch. */
  async claim(eventId: string, baseline: SddRun["baseline"], configDigest: string, voidedPrevious?: string, retryVoided?: string): Promise<SddRun> {
    return this.transaction(s => {
      const earlier = s.runs.filter(r => r.event_id === eventId)
      if (retryVoided === undefined) requireThat(!earlier.length, "This user update already has an SDD claim; reconcile the existing run")
      requireThat(!s.runs.some(r => r.state !== "returned"), "Previous SDD run has not returned")
      if (retryVoided !== undefined) {
        // The experiment's rule voided this update's latest run: the same delivery runs again from the same baseline.
        const last = earlier.at(-1)
        requireThat(retryVoided.trim() && !voidedPrevious, "A retry needs the void reason and is not a new round")
        requireThat(last?.result && s.runs.at(-1) === last, "Only the latest returned run can be retried")
        requireThat(baseline.digest === last.baseline.digest, "A retry starts from the voided run's own baseline")
        last.voided = { reason: retryVoided }
      }
      const b = s.batches.find(x => x.event_id === eventId)
      requireThat(b?.state === "accepted" && b.delivery?.draft.decision === "deliver", "No approved delivery")
      requireThat(s.batches.at(-1) === b, "A newer user update supersedes this unstarted delivery")
      requireThat(baseline.path && baseline.digest && configDigest, "Baseline and config identities required")
      // An attempt superseded by an adopted earlier run of the same update does not count.
      const previous = s.runs.filter(r => !r.superseded).at(-1)
      if (previous?.result && voidedPrevious) {
        // The experiment's fixed rule voided the previous round (SpecArt handed it to the user):
        // continue from the code that round started from.
        requireThat(voidedPrevious.trim(), "A voided previous round needs a reason")
        requireThat(baseline.digest === previous.baseline.digest, "After a voided round, the next delivery uses that round's own baseline")
        previous.voided = { reason: voidedPrevious }
      } else if (previous?.result && retryVoided === undefined) requireThat(baseline.digest === previous.result.source_digest, "Next delivery must use this IC run's previous source baseline")
      const run: SddRun = { run_id: earlier.length ? `sdd-${b.delivery.ref.id}-attempt${earlier.length + 1}` : `sdd-${b.delivery.ref.id}`, ci_ref: b.delivery.ref, event_id: eventId, baseline,
        config_digest: configDigest, state: "preparing", ...(earlier.length ? { retry_of: earlier.at(-1)!.run_id } : {}) }
      s.runs.push(run); this.save(s); return structuredClone(run)
    })
  }
  /**
   * Adopt an earlier returned run of the latest update as that update's result (e.g. its
   * void came from a misread score): its void mark is cleared and every later attempt of
   * the same update is marked superseded. The next round continues from the adopted run.
   */
  async adopt(runId: string, reason: string): Promise<SddRun> {
    return this.transaction(s => {
      const run = s.runs.find(r => r.run_id === runId)
      requireThat(run?.result && reason.trim(), "Adopt needs a returned run and a reason")
      requireThat(!s.runs.some(r => r.state !== "returned"), "Every run must have returned before an adoption")
      const later = s.runs.slice(s.runs.indexOf(run) + 1)
      requireThat(later.length > 0 && later.every(r => r.event_id === run.event_id), "Only an earlier attempt of the latest update can be adopted")
      delete run.voided
      for (const r of later) r.superseded = { by: run.run_id, reason }
      this.save(s)
      return structuredClone(run)
    })
  }
  async prepared(runId: string, directory: string, ciRef: Ref): Promise<void> {
    await this.transition(runId, "preparing", "prepared", r => { requireThat(same(r.ci_ref, ciRef), "Prepared CI identity mismatch"); r.directory = resolve(directory) })
  }
  async launchClaim(runId: string): Promise<void> { await this.transition(runId, "prepared", "launching") }
  async started(runId: string): Promise<void> { await this.transition(runId, "launching", "running") }
  private async transition(id: string, from: SddRun["state"], to: SddRun["state"], update?: (r: SddRun) => void): Promise<void> {
    await this.transaction(s => { const r = s.runs.find(x => x.run_id === id); requireThat(r?.state === from, `Expected ${from} run; no automatic relaunch`); update?.(r); r.state = to; this.save(s) })
  }
  async receive(result: SddResult): Promise<void> {
    await this.transaction(s => {
      requireThat(result.event_id && result.run_id && result.source_digest && ["finished", "blocked", "interrupted"].includes(result.status)
        && ["pass", "not_passed", "unknown"].includes(result.sdd_status), "Invalid SDD result")
      unique(result.artifacts.map(a => a.path), "result artifact")
      requireThat(result.artifacts.every(a => a.path && a.digest), "Result evidence needs identity")
      const check = result.prd_check
      requireThat(check === undefined || (typeof check.status === "string" && Array.isArray(check.open_gaps)
        && check.open_gaps.every(g => typeof g.title === "string" && typeof g.text === "string")), "Invalid PRD check summary")
      const r = s.runs.find(x => x.run_id === result.run_id)
      requireThat(r && same(r.ci_ref, result.ci_ref), "Result must bind to the actual CI version")
      if (r.result) { requireThat(same(r.result, result), "Conflicting duplicate result"); return }
      requireThat(["launching", "running"].includes(r.state), "Run was never claimed for launch")
      requireThat(!s.runs.some(x => x.result?.event_id === result.event_id), "Result event already belongs to another run")
      r.result = structuredClone(result); r.state = "returned"; this.save(s)
    })
  }
}

/**
 * A check finding resolves when one of its refs names material the check
 * request showed: a listed input with an exact quote of it, an IR object of a
 * supplied version (an optional quote must occur in it), or the CI under check.
 */
export function resolveCheckFindings(findings: SddCheck["findings"], request: CheckRequest, s: SddSnapshot): SddCheckFinding[] {
  const listed = new Set(request.sources.inputs.map(x => x.event_id))
  const texts = new Map(s.events.flatMap(e => { const t = userText(e); return t !== undefined && listed.has(e.event_id) ? [[e.event_id, t] as const] : [] }))
  const objects = new Map<string, string[]>()
  const add = (id: string, revision: number, text: string) => objects.set(`${id}@${revision}`, [...(objects.get(`${id}@${revision}`) ?? []), text])
  // The request may show an item's text by pointer to its delivered block; quotes are matched on the stored text.
  const prepared = s.batches.find(b => b.delivery?.ref.id === request.delivery.ref.id)?.parent?.ir ?? request.ir
  for (const ir of [prepared, request.ir_change.previous_versions]) for (const task of Object.values(ir)) {
    add(task.task_id, task.revision, canonicalJson(task))
    for (const item of task.content) add(item.item_id, item.revision, `${item.text}\n${item.interpretation ?? ""}`)
    for (const b of task.bindings) add(b.binding_id, b.revision, canonicalJson(b))
    for (const o of task.outputs) add(o.output_id, o.revision, canonicalJson(o))
  }
  const delivery = s.batches.find(b => b.delivery?.ref.id === request.delivery.ref.id)?.delivery
  if (delivery) add(delivery.ref.id, delivery.ref.revision, delivery.text)
  const found = (text: string, quote: string) => text.includes(quote) || locateQuote(quote, text).match !== "none"
  return findings.map(f => ({ ...f, evidence_resolved: f.refs.some(ref => {
    const source = texts.get(ref.id)
    if (source !== undefined) return ref.quote.trim() !== "" && found(source, ref.quote)
    const candidates = objects.get(`${ref.id}@${ref.revision}`)
    return candidates !== undefined && (ref.quote.trim() === "" || candidates.some(text => found(text, ref.quote)))
  }) }))
}

/**
 * Header and per-input framing of the SDD-only arm's node-1 input
 * (experiments/sdd/run_series.py cumulative_requirement), so that a delivery
 * that cuts nothing is byte-identical to what SDD alone receives.
 */
/** Calls the examples stage (examples and derive) may make per user update, outside the management budget. */
export const EXAMPLES_CALL_LIMIT = 4
const ACCUMULATED_HEADER = "# Accumulated original user requirements\nApply each update in order. Later explicit revisions replace only the affected earlier requirements.\n"

/**
 * Every JSON key an acceptance example's input writes ("key":) must be written
 * by the delivered requirements, as "key" or `key`; code reads the keys, so an
 * operation's parameter names are checked without the model listing them. A key
 * found only in passages this delivery cuts is withdrawn or superseded.
 */
export function checkAcceptance(acceptance: DeliveryDraft["acceptance"], delivered: string, original: string, allowEmpty = false): void {
  requireThat(allowEmpty || acceptance.length > 0, "CI needs acceptance examples for the commands and operations the delivered requirements define")
  unique(acceptance.map(a => a.subject), "acceptance subject")
  const written = (text: string, key: string) => text.includes(`"${key}"`) || text.includes(`\`${key}\``)
  const problems: string[] = []
  for (const a of acceptance) {
    if (!a.subject.trim()) problems.push("an acceptance entry has no subject")
    if (!a.examples.length) problems.push(`acceptance subject ${a.subject} has no example`)
    a.examples.forEach((e, i) => {
      const where = `acceptance ${a.subject} example ${i + 1}`
      if (!e.given.trim() || !e.expect.trim()) problems.push(`${where} needs both given and expect`)
      for (const key of new Set([...e.given.matchAll(/"([^"\\\n]+)"\s*:/gu)].map(m => m[1]!))) {
        if (written(delivered, key)) continue
        problems.push(written(original, key)
          ? `${where}: key "${key}" occurs only in text this delivery cuts as withdrawn or superseded`
          : `${where}: key "${key}" is not a key the requirements write; use the requirement's own key, copied exactly`)
      }
    })
  }
  requireThat(!problems.length, `Acceptance examples do not hold: ${problems.join("; ")}`)
}

/** A field name the requirements write: quoted, in backticks, or as a dashed command-line option. */
const writes = (text: string, name: string) => text.includes(`"${name}"`) || text.includes(`\`${name}\``) || (name.startsWith("-") && text.includes(name))

/** Every field of the dictionary must be a name the delivered requirements write (not only in cut text). */
export function checkFields(fields: DeliveryDraft["fields"], delivered: string, original: string): void {
  unique(fields.map(o => o.object), "field dictionary object")
  const problems: string[] = []
  for (const o of fields) {
    if (!o.object.trim()) problems.push("a field dictionary object has no name")
    for (const f of o.fields) {
      if (writes(delivered, f.field)) continue
      const option = `--${f.field.replace(/^-+/u, "")}`
      problems.push(writes(original, f.field)
        ? `field dictionary ${o.object}: field "${f.field}" occurs only in text this delivery cuts as withdrawn or superseded`
        : `field dictionary ${o.object}: field "${f.field}" is not a name the requirements write (quoted, in backticks or as a dashed option); use the requirement's own name, copied exactly${delivered.includes(option) && option !== f.field ? `; the requirements write ${option}, a command-line option: list it under its command as ${option}` : ""}`)
    }
  }
  requireThat(!problems.length, `Field dictionary does not hold: ${problems.join("; ")}`)
}

/** JSON keys ("key":) and command-line options (--option) the text writes: the interface names code can read. */
export function interfaceNames(text: string): string[] {
  const keys = [...text.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:/gu)].map(m => m[1]!)
  const options = [...text.matchAll(/(?<![\w-])(--[a-z][a-z0-9-]*)/gu)].map(m => m[1]!)
  return [...new Set([...keys, ...options])]
}

/**
 * The dictionary as rendered: an object's repeated field names merged into one row
 * (a nested key may share a name), objects without fields left out, and every
 * interface name the delivered text writes that no object lists added, so the
 * dictionary is complete whatever the model omitted.
 */
export function completeFields(fields: DeliveryDraft["fields"], delivered: string): { fields: DeliveryDraft["fields"]; added: string[]; leftOut: string[] } {
  const merged = fields.filter(o => o.fields.length).map(o => {
    const rows = new Map<string, DeliveryDraft["fields"][number]["fields"][number]>()
    for (const f of o.fields) {
      const seen = rows.get(f.field)
      rows.set(f.field, seen ? { ...seen, meaning: `${seen.meaning}; ${f.meaning}` } : { ...f })
    }
    return { object: o.object, items: o.items, fields: [...rows.values()] }
  })
  const listed = new Set(merged.flatMap(o => o.fields.map(f => f.field)))
  const added = interfaceNames(delivered).filter(name => !listed.has(name))
  if (added.length) merged.push({ object: OTHER_NAMES, items: [], fields: added.map(field => ({ field, type: "", required: "", meaning: "see the requirements below" })) })
  return { fields: merged, added, leftOut: fields.filter(o => !o.fields.length).map(o => o.object) }
}

export const OTHER_NAMES = "Other names the requirements write (listed by code)"

export function fieldSection(fields: DeliveryDraft["fields"]): string {
  const cell = (v: string) => v.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ").trim()
  const body = fields.map(o => `## ${o.object.trim()}\n| Field | Type | Required | Meaning |\n|---|---|---|---|\n${o.fields.map(f => `| \`${cell(f.field)}\` | ${cell(f.type)} | ${cell(f.required)} | ${cell(f.meaning)} |`).join("\n")}`).join("\n\n")
  return `# Interface and data: field dictionary\n${FIELD_NOTE}\n\n${body}\n\n`
}

export const FIELD_NOTE = "Management derived this dictionary from the original requirements that follow, for the PRD's interface-and-data section. Each field name is part of the external interface (command-line options, file and configuration keys, output fields) and must be kept and implemented exactly as written."

export function acceptanceSection(acceptance: DeliveryDraft["acceptance"]): string {
  const body = acceptance.map(a => `## ${a.subject.trim()}\n${a.examples.map((e, i) => `Example ${i + 1}\nGiven:\n${e.given.trim()}\nExpect:\n${e.expect.trim()}`).join("\n\n")}`).join("\n\n")
  return `# Acceptance examples\n${ACCEPTANCE_NOTE}\n\n${body}\n\n`
}

export const ACCEPTANCE_NOTE = "Management derived these examples from the original requirements that follow; every name, key, value, fixed text and exit code in them is written exactly as the requirements write it and must be implemented exactly so. They are acceptance criteria for every command and operation listed; the original requirements below remain the full specification."

export interface EffectivePlacement { item: ContentItem; entry: DeliveryDraft["tasks"][number]["effective"][number] }
type Spans = Map<string, Array<{ start: number; end: number; item: ContentItem }>>
function spansOf(items: Iterable<ContentItem>): Spans {
  const out: Spans = new Map()
  for (const item of items) for (const x of item.sources) if (x.span) out.set(x.source_id, [...(out.get(x.source_id) ?? []), { start: x.span.start, end: x.span.end, item }])
  return out
}

/**
 * Every user input verbatim and in order. Code cuts only what an accepted or
 * the current IR selected and this delivery does not deliver (withdrawn,
 * superseded, paused or unresolved); text no IR ever selected (headings,
 * examples, connecting prose) always stays. Each effective statement follows
 * the paragraph where its requirement's text was first cut, or else the one
 * holding its first current passage.
 */
export function accumulatedText(events: readonly CompilerEvent[], earlier: ReadonlyArray<Record<string, TaskIntent>>, current: Record<string, TaskIntent>,
  delivered: readonly ContentItem[], dispositions: ReadonlyMap<ContentItem, string>, effective: readonly EffectivePlacement[]): { text: string; removed: RemovedPassage[] } {
  const inputOrder = new Map(events.map((e, i) => [e.event_id, i + 1]))
  const before = spansOf(earlier.flatMap(ir => Object.values(ir).flatMap(t => t.content)))
  const now = spansOf(Object.values(current).flatMap(t => t.content))
  const kept = spansOf(delivered)
  const texts = new Map(events.map(e => [e.event_id, userText(e)!]))
  const cuts = new Map(events.map((event, index) => {
    const text = texts.get(event.event_id)!
    const mark = (spans: Spans) => {
      const mask = new Uint8Array(text.length)
      for (const x of spans.get(event.event_id) ?? []) {
        requireThat(0 <= x.start && x.start <= x.end && x.end <= text.length, `IR span ${x.start}-${x.end} lies outside user input ${index + 1}`)
        mask.fill(1, x.start, x.end)
      }
      return mask
    }
    const earlierMask = mark(before), nowMask = mark(now), keep = mark(kept)
    const cut = earlierMask.map((x, i) => (x === 1 || nowMask[i] === 1) && keep[i] === 0 ? 1 : 0)
    // A line left holding only its list marker or blanks goes with its cut text;
    // a paragraph cut whole also takes one of the blank lines around it.
    const lines: Array<[number, number]> = []
    for (let start = 0; start < text.length;) { const nl = text.indexOf("\n", start); const end = nl < 0 ? text.length : nl + 1; lines.push([start, end]); start = end }
    const blank = (k: number) => k < 0 || k >= lines.length || /^[ \t]*\r?\n?$/u.test(text.slice(...lines[k]!))
    lines.forEach(([start, end], k) => {
      const rest = [...text.slice(start, end)].filter((_, i) => cut[start + i] === 0).join("")
      if (!cut.subarray(start, end).includes(1) || !/^[ \t]*(?:[-*+]|\d+[.)])?[ \t]*\r?\n?$/u.test(rest)) return
      cut.fill(1, start, end)
      if (blank(k - 1) && k + 1 < lines.length && blank(k + 1)) cut.fill(1, ...lines[k + 1]!)
    })
    return [event.event_id, cut] as const
  }))
  const inserts = new Map<string, Map<number, string[]>>()
  const byPosition = (a: { source_id: string; start: number }, c: { source_id: string; start: number }) => inputOrder.get(a.source_id)! - inputOrder.get(c.source_id)! || a.start - c.start
  for (const { item, entry } of effective) {
    // In place: after the paragraph where text of this requirement was cut; otherwise after the paragraph of its first current passage.
    const cutAt = [...before.entries(), ...now.entries()].flatMap(([source_id, spans]) => spans.filter(x => x.item.item_id === item.item_id && inputOrder.has(source_id)).flatMap(x => {
      const i = cuts.get(source_id)!.subarray(x.start, x.end).indexOf(1)
      return i < 0 ? [] : [{ source_id, start: x.start + i }]
    })).sort(byPosition)[0]
    const first = cutAt ?? item.sources.filter(x => x.span && inputOrder.has(x.source_id)).map(x => ({ source_id: x.source_id, start: x.span!.start })).sort(byPosition)[0]
    const inputs = [...new Set(entry.basis.map(x => inputOrder.get(x.source_id)!))].sort((a, c) => a - c)
    const block = `[requirement as it now holds, per user input ${inputs.join(", ")}]\n${entry.text.trim()}`
    // Without a located passage the statement goes after the latest input it rests on.
    const event = events[(first ? inputOrder.get(first.source_id)! : inputs.at(-1)!) - 1]!
    const length = texts.get(event.event_id)!.length
    const at = first ? sourceSegments([event]).find(x => x.span.start <= first.start && first.start < x.span.end)?.span.end ?? length : length
    const forEvent = inserts.get(event.event_id) ?? new Map<number, string[]>()
    forEvent.set(at, [...(forEvent.get(at) ?? []), block]); inserts.set(event.event_id, forEvent)
  }
  const removed: RemovedPassage[] = []
  const parts = [ACCUMULATED_HEADER]
  events.forEach((event, index) => {
    const text = texts.get(event.event_id)!
    const mask = cuts.get(event.event_id)!
    const cut = (i: number) => mask[i] === 1
    const at = inserts.get(event.event_id) ?? new Map<number, string[]>()
    let out = ""
    for (let i = 0; i <= text.length; i++) {
      for (const block of at.get(i) ?? []) out += i === text.length ? `\n\n${block}` : `${block}\n\n`
      if (i === text.length) break
      if (!cut(i)) { out += text[i]; continue }
      let end = i
      while (end < text.length && cut(end)) end++
      const overlaps = (spans: Spans) => (spans.get(event.event_id) ?? []).filter(x => x.start < end && i < x.end)
      removed.push({ input: index + 1, source_id: event.event_id, start: i, end, text: text.slice(i, end),
        selected_before: [...new Set(overlaps(before).map(x => `${x.item.item_id}@${x.item.revision}`))],
        now: [...new Map(overlaps(now).map(x => [`${x.item.item_id}@${x.item.revision}`, dispositions.get(x.item) ?? "not in coverage"])).entries()].map(([item, disposition]) => ({ item, disposition })) })
      // A statement anchored inside the cut still appears, where the cut was.
      for (let j = i + 1; j < end; j++) for (const block of at.get(j) ?? []) out += `${block}\n\n`
      i = end - 1
    }
    parts.push(`\n## Original user update ${index + 1}\n\n${out}\n`)
  })
  return { text: parts.join("\n"), removed }
}

const IR_SCHEMA = buildGenerationSchema("ir", "openai", { checkRequired: false, assessment: false, activeExecutions: false })

/**
 * When the IR answer failed only the strict schema and normalizeIrProposal maps
 * its shape unambiguously, run the normalized answer through the same proposal
 * path (strict schema, code schema) the model answer took. Undefined when there
 * is nothing to normalize; the original failure then stands.
 */
export async function reproposeNormalized(proposed: CompilerModelV2Result, input: CompilerModelV2Input): Promise<{ result: CompilerModelV2Result; changes: IrNormalization[] } | undefined> {
  if (proposed.error?.code !== "schema" || !proposed.call?.text) return undefined
  let parsed: unknown
  try { parsed = JSON.parse(proposed.call.text) } catch { return undefined }
  const { value, changes } = normalizeIrProposal(parsed)
  if (!changes.length) return undefined
  const text = JSON.stringify(value)
  const validate = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true }).compile(IR_SCHEMA)
  const errors = validate(value) ? undefined : (validate.errors ?? []).map(e => `${e.instancePath || "/"}: ${e.message ?? "invalid"} ${JSON.stringify(e.params)}`)
  const call = { ...proposed.call, text, ...(errors ? { structured_schema_errors: errors } : {}) }
  if (!errors) delete (call as { structured_schema_errors?: string[] }).structured_schema_errors
  const result = await createCompilerModelV2(async () => call).propose(input)
  return { result: { ...result, call: { ...result.call!, normalized_from: proposed.call.text } as CompilerModelV2Result["call"] }, changes }
}
