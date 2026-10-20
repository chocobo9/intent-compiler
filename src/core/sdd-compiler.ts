import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { canonicalJson, digestOf, digestText, validateEvent, type CompilerEvent, type ContentItem, type Ref, type SourceRef, type TaskIntent } from "./intent-contract.js"
import { prepareIntentIR } from "./parent-generation.js"
import { resolveSourceRefs } from "./intent-compiler-v2.js"
import { locateQuote, selectedSourceHistory, sourceSegments, userText } from "./source-payload.js"
import { Ajv } from "ajv"
import { createCompilerModelV2, V2_COMPILER_CONTRACT, type CompilerModelV2Input, type CompilerModelV2Result } from "../model/compiler-model-v2.js"
import { buildGenerationSchema } from "../model/generation-schema.js"
import { normalizeIrProposal, type IrNormalization } from "./sdd-ir-normalize.js"
import { decodeSdd, SDD_DELIVERY_SCHEMA, SDD_CHECK_SCHEMA, SDD_EXAMPLES_SCHEMA, SDD_DERIVE_SCHEMA, type ExamplesRequest, type SddModel, type SddCheck } from "../model/sdd-model.js"
import { SDD_PROFILE, type CIDelivery, type DeliveryContract, type SettledConflict, type DeliveryDraft, type RemovedPassage, type SddBatch, type SddCheckFinding, type SddRun, type SddResult, type SddSnapshot } from "./sdd-contract.js"
import { checkRequest, deliveryRequest, irRequest, type CheckRequest, type ContextReport, type DeliveryRequest } from "./sdd-context.js"
import { currentRevisions, inputOf, narrowedItems, planCarry, previousContract } from "./sdd-increment.js"
import { computeLedger, fedBack, ledgerSection } from "./sdd-ledger.js"
import { changeSection, changedItems, RulingNeeded, settleChanges } from "./sdd-changes.js"
import { answerRevisions, carryRulings, rulingQuestions, rulingSection, rulingView, settleRulings } from "./sdd-rulings.js"
import { carryExecutable, executableSection, itemOf, keepExamples, originalInputs, type Derivation, type ProposedExample } from "./sdd-executable.js"
import { quoteBlock, refList, resolveQuotes, segmentIndex, writtenIn } from "./sdd-quotes.js"
import { ledgerRevisions, markFactsValid, purge } from "./sdd-revisions.js"
import type { AcceptanceSubject, ConflictEntry, DraftAcceptance, Quote, RulingEntry } from "./sdd-contract.js"

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
        const last = previousContract(s, batch)
        // A′: open revisions of earlier updates are not put to the IR again (no backfill, not even internally); only this
        // update's revisions whose old values code cannot find are asked, through RulingNeeded.
        const questions: ReturnType<typeof rulingQuestions> = []
        const input: CompilerModelV2Input | undefined = stage !== "ir" ? undefined : {
          generation_stage: "ir", run_id: this.runId, events: [event], source_events: s.events.filter(e => e.event_id !== eventId),
          source_segments: sourceSegments(s.events), event_source_refs: [{ source_id: eventId, digest: digestText(userText(event) ?? "") }],
          ir: s.ir, budget: { requests_used: batch.requests_used + 1, max_requests: batch.max_requests }, contract: V2_COMPILER_CONTRACT,
          ...(batch.error ? { validation_errors: [batch.error] } : {}),
          // Management state the IR rules with (v7 R10 fix): the rulings kept so far, and the open revisions whose old values are to be ruled.
          ...({ current_rulings: rulingView(last?.conflicts), ruling_questions: questions.map(q => ({ ...q, before: q.before.map(({ source_id, segment_id, input, text }) => ({ source_id, segment_id, input, text })), now: q.now.map(({ source_id, segment_id }) => ({ source_id, segment_id })) })) } as object),
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
            const parent = prepareIntentIR(input!, proposed.ir_proposal, candidate => resolveSourceRefs(candidate, s.events), candidate => ({
              ok: same(candidate.basis.event_ids, [eventId]), message: "IR basis must name this user update exactly",
            }), undefined, undefined, normativeHistoryOf(s))
            // The rulings the answer gives with its IR, settled by code against the prepared IR.
            const extension = (proposed.call as { ir_extension?: { rulings?: RulingEntry[]; withdraw_rulings?: Array<{ ruling_id: string; reason: string }> } } | undefined)?.ir_extension
            const ruled = settleRulings(extension?.rulings ?? [], extension?.withdraw_rulings ?? [], { eventId, index: segmentIndex(s.events), ir: parent.ir, questions, current: last?.conflicts ?? [] })
            batch.parent = { ...parent, ...(ruled.rulings.length ? { rulings: ruled.rulings } : {}), ...(ruled.withdrawn.length ? { withdrawn_rulings: ruled.withdrawn } : {}) }
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
        } catch (error) {
          batch.error = error instanceof Error ? error.message : String(error); record.error = batch.error
          // An earlier state the update names in its own words is the IR's to rule on: back to the IR stage with the question.
          if (error instanceof RulingNeeded) { batch.state = "ir"; delete batch.parent; delete batch.delivery; delete batch.last_draft }
        }
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
    // An open revision drops what states a value it replaced; the rest is marked by whether its inputs are the requirement's own.
    const purged = purge(d.contract.revisions ?? [], [], [], executable)
    const reference = d.reference_text ?? d.text
    d.contract.executable = purged.executable.map(e => ({ ...e, original_inputs: originalInputs(e.run, reference) }))
    d.contract.dropped.push(...dropped, ...purged.dropped)
    // Before the requirement baseline (incremental delivery) or the first original update delivered.
    const at = [d.text.indexOf(`\n${BASELINE_HEADING}`), d.text.indexOf("\n## Original user update ")].filter(i => i >= 0).sort((a, b) => a - b)[0]
    if (at !== undefined) d.text = `${d.text.slice(0, at + 1)}${executableSection(d.contract.executable)}${d.text.slice(at + 1)}`
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
    const { carried: carriedAll, dropped, rewrite } = carryExecutable(previous?.executable, ir, excluded, narrowedItems(s.ir, ir))
    // A carried example stating a value an open revision replaced is dropped and its items written again now.
    const stale = purge(d.contract.revisions ?? [], [], [], carriedAll)
    const carried = stale.executable
    dropped.push(...stale.dropped)
    const toWrite = [...new Set([...planCarry(previous, s.ir, ir, new Set(), inputOf(s, batch.event_id)).toWrite, ...rewrite, ...stale.rewrite])].filter(id => !excluded.has(id))
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
        // Checked against every input as SDD alone would receive it (the delivered text may start from a PRD baseline).
        const original = d.reference_text ?? d.text.slice(d.text.indexOf("## Original user update 1"))
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
    const plan = planCarry(previous, s.ir, ir, new Set(), inputOf(s, b.event_id))
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
    const final = planCarry(previous, s.ir, ir, excluded, inputOf(s, b.event_id))
    // Bookkeeping is code's: an entry naming items that are not current, or describing only requirements
    // carried unchanged, is left out and recorded; a written entry replaces a carried one of the same name.
    const sorted: DeliveryContract["dropped"] = []
    const admissible = <T extends { items: string[] }>(kind: "field" | "acceptance", name: (e: T) => string, entries: T[]): T[] => entries.flatMap(e => {
      const items = e.items.map(id => itemOf(id, now)).filter((id): id is string => id !== undefined)
      const unknown = e.items.filter(id => itemOf(id, now) === undefined)
      if (unknown.length) sorted.push({ kind, name: name(e), reason: `names items that are not current: ${unknown.join(", ")}` })
      if (!items.length) { sorted.push({ kind, name: name(e), reason: "names no current item" }); return [] }
      if (!items.some(id => plan.toWrite.includes(id))) { sorted.push({ kind, name: name(e), reason: `describes only requirements carried unchanged (${items.join(", ")})` }); return [] }
      return [{ ...e, items: [...new Set(items)] }]
    })
    // A field object whose items changed is edited on its accepted version (v7 R10 fix): rows the answer does not touch stay.
    const edits = mergeFieldEdits(admissible("field", o => o.object, draft.fields), final.revisedFields.map(o => ({ ...o, items: o.items.filter(id => now.has(id)) })).filter(o => o.items.length), sorted)
    const writtenFields = edits.fields, writtenSubjects = admissible("acceptance", a => a.subject, draft.acceptance)
    const replaced = (carried: string[], written: string[], kind: "field" | "acceptance") => new Set(carried.filter(n => written.includes(n)).map(n => { sorted.push({ kind, name: n, reason: "replaced by the entry of the same name written this round" }); return n }))
    const replacedFields = replaced(final.fields.map(o => o.object), writtenFields.map(o => o.object), "field")
    const replacedSubjects = replaced(final.acceptance.map(a => a.subject), writtenSubjects.map(a => a.subject), "acceptance")
    final.fields = final.fields.filter(o => !replacedFields.has(o.object))
    final.acceptance = final.acceptance.filter(a => !replacedSubjects.has(a.subject))
    for (const c of final.effective) {
      const item = ir[c.task_id]?.content.find(x => x.item_id === c.entry.item_id)
      if (item && !excluded.has(item.item_id)) effective.push({ item, entry: c.entry })
    }
    const earlier = s.batches.filter(x => x.state === "accepted" && x.parent && x.event_id !== b.event_id).map(x => x.parent!.ir)
    // Every input as SDD alone would receive it, minus cuts: what names and quotes are checked against.
    // A hold delivers nothing, so it has no SDD input text.
    const built = delivered.length === 0 ? { text: "", removed: [] } : accumulatedText(s.events, earlier, ir, delivered, dispositions, effective)
    // An effective statement must not bring back original text this delivery cuts as withdrawn or superseded.
    for (const { entry } of effective) {
      const back = built.removed.map(r => r.text.trim()).filter(t => t.length >= 20 && entry.text.includes(t))
      requireThat(!back.length, `Effective statement for ${entry.item_id} repeats text this delivery cuts as withdrawn or superseded: ${back.map(t => JSON.stringify(t.slice(0, 120))).join("; ")}; state only what holds now`)
    }
    const removed = built.removed
    const reference = built.text
    // From the second update the PRD SDD wrote for an earlier update stands for the inputs up to it.
    const baseline = delivered.length === 0 ? undefined : prdBaseline(s, b.event_id)
    const shown = baseline ? accumulatedText(s.events, earlier, ir, delivered, dispositions, effective, baseline.input + 1).text : reference
    let text = ""
    const emptyObjects: string[] = [], namesAdded: string[] = [], requiredNotStated: NonNullable<CIDelivery["required_not_stated"]> = []
    const revisionsOf = (items: string[]) => Object.fromEntries(items.map(id => [id, now.get(id)!]))
    const taskOf = (itemId: string) => Object.values(ir).find(t => t.content.some(c => c.item_id === itemId))!.task_id
    const contract: DeliveryContract = { fields: [], acceptance: [], effective: [], dropped: [...final.dropped, ...sorted] }
    const index = segmentIndex(s.events)
    const input = inputOf(s, b.event_id)
    // A passage this delivery cuts in part or whole is not quoted.
    const cut = (q: { source_id: string; start: number; end: number }) => removed.some(r => r.source_id === q.source_id && r.start < q.end && q.start < r.end)
    // Management's rulings (the IR's, kept across rounds): the earlier ones still standing and this update's.
    const conflicts = b.parent!.rulings ?? []
    const rulings = carryRulings(previous?.conflicts ?? [], conflicts, b.parent!.withdrawn_rulings ?? [], ir, contract.dropped)
    // This round's change list (not in the first delivery, where everything is new): the model's entries settled by code against the IR change.
    const settled = Object.keys(s.ir).length ? settleChanges(draft.changes ?? [], changedItems(s.ir, ir, excluded), { index, cut, input, previous: s.ir, current: ir, rulings }) : { changes: [], dropped: [] }
    contract.dropped.push(...settled.dropped)
    // The revision ledger: earlier revisions still open (those a ruling answered now with their old values), and this update's.
    const revisions = answerRevisions(ledgerRevisions(previous?.revisions, settled.changes, s, ir, b.event_id, input), rulings)
    // Requirements the starting code does not meet, from the store's run results (code, not model).
    const ledger = markFactsValid(computeLedger(s, ir), revisions)
    if (delivered.length) {
      // Newly written rows must hold; a carried entry, or a row of an edited object's base, whose names the requirements no longer write is dropped.
      checkFields(edits.written, reference, original)
      for (const o of writtenFields) o.fields = o.fields.filter(f => {
        if (!edits.base.has(`${o.object}|${f.field}`) || writes(reference, f.field)) return true
        contract.dropped.push({ kind: "field", name: `${o.object}: ${f.field}`, reason: "a row of the accepted object that the delivered requirements no longer write" })
        return false
      })
      const carriedFields = final.fields.filter(o => { try { checkFields([o], reference, original); return true } catch (e) { contract.dropped.push({ kind: "field", name: o.object, reason: (e as Error).message }); return false } })
      const rewrite = new Set<string>()
      // A carried example whose passage this delivery now cuts no longer states what holds.
      const carriedSubjects = final.acceptance.flatMap(a => {
        const examples = a.examples.filter(e => ![...(e.given_quotes ?? []), ...(e.expect_quotes ?? [])].some(q => { const at = index.get(`${q.source_id}|${q.segment_id}`); return !at || cut(at) }))
        if (examples.length < a.examples.length) { contract.dropped.push({ kind: "acceptance", name: a.subject, reason: "an example quotes a passage this delivery cuts" }); a.items.forEach(id => rewrite.add(id)) }
        return examples.length ? [{ ...a, examples }] : []
      })
      const written = quotedAcceptance(writtenSubjects, index, cut, contract.dropped)
      const purged = purge(revisions,
        [...carriedFields, ...writtenFields.map(o => ({ ...o, revisions: revisionsOf(o.items), carried: false }))],
        [...carriedSubjects, ...written.map(a => ({ ...a, revisions: revisionsOf(a.items), carried: false }))])
      // Required yes or no stands only on the requirements' own words, written or carried alike.
      const required = settleRequired(purged.fields, reference)
      contract.fields = required.fields
      requiredNotStated.push(...required.unsupported)
      contract.acceptance = purged.acceptance
      contract.dropped.push(...purged.dropped)
      purged.rewrite.forEach(id => rewrite.add(id))
      if (rewrite.size) contract.rewrite_next = [...rewrite].filter(id => now.has(id))
      contract.effective = [...final.effective.filter(c => !excluded.has(c.entry.item_id)),
        ...draft.tasks.flatMap(t => t.effective.map(entry => ({ task_id: taskOf(entry.item_id), revision: now.get(entry.item_id)!, entry, carried: false })))]
      contract.revisions = revisions
      contract.conflicts = rulings
      // Code merges repeated rows, leaves out objects without fields, and adds every name the requirements write that no object lists.
      const completed = completeFields(contract.fields, reference)
      emptyObjects.push(...completed.leftOut)
      namesAdded.push(...completed.added)
      const head = baseline ? `${INCREMENTAL_HEADER}\n` : `${ACCUMULATED_HEADER}\n`
      const body = baseline ? `${baselineSection(baseline)}${shown.slice(ACCUMULATED_HEADER.length)}` : reference.slice(ACCUMULATED_HEADER.length)
      text = `${head}${changeSection(settled.changes, revisions, fedBack(ledger), ir, b.event_id, baseline ? baseline.input + 1 : 1)}${rulingSection(deliveredRulings(contract.conflicts ?? [], changedItems(s.ir, ir, excluded), previous?.revisions ?? []))}${fieldSection(completed.fields)}${acceptanceSection(contract.acceptance, baseline ? baseline.input + 1 : 1)}${ledgerSection(fedBack(ledger), ir)}${body}`
    }
    const content = { profile: SDD_PROFILE, event_id: b.event_id, ir_digest: b.parent!.digest, draft, text, removed, contract,
      ...(delivered.length ? { reference_text: reference } : {}),
      ...(baseline ? { baseline_prd: { run_id: baseline.run_id, event_id: baseline.event_id, input: baseline.input, digest: baseline.digest, chars: baseline.text.length } } : {}),
      ...(settled.changes.length ? { changes: settled.changes } : {}), ...(conflicts.length ? { conflicts } : {}), ...(Object.keys(s.ir).length && draft.changes === undefined ? { changes_not_given: true } : {}), ...(ledger.length ? { ledger } : {}), ...(emptyObjects.length ? { field_objects_left_out: emptyObjects } : {}), ...(namesAdded.length ? { field_names_added: namesAdded } : {}), ...(requiredNotStated.length ? { required_not_stated: requiredNotStated } : {}) }
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
      requireThat(result.acceptance === undefined || (typeof result.acceptance.outcome === "string" && Array.isArray(result.acceptance.open)
        && result.acceptance.open.every(o => typeof o.id === "string" && typeof o.subject === "string")), "Acceptance result needs its open checks")
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
 * The rulings the delivered text shows (A′): those written this round on an item this update added or revised, and not
 * answering a revision of an earlier update. Every ruling stays in the contract (IC state, used by the ledger); carried
 * ones and those about earlier revisions are not delivered again.
 */
export function deliveredRulings(rulings: NonNullable<DeliveryContract["conflicts"]>, changed: ReadonlyMap<string, unknown>, earlier: ReadonlyArray<{ id: string }>): NonNullable<DeliveryContract["conflicts"]> {
  const old = new Set(earlier.map(r => r.id))
  return rulings.filter(c => !c.carried && c.items.some(id => changed.has(id)) && !(c.question && old.has(c.question)))
}

/**
 * Every span a content item of this run has selected: the content selections of
 * the accepted batches and the current IR, as the source ledger reads them.
 */
export function normativeHistoryOf(s: SddSnapshot): SourceRef[] {
  const log = s.batches.filter(b => b.state === "accepted" && b.parent).map(b => ({ status: "accepted", candidate: b.parent!.candidate }))
  return [...selectedSourceHistory(log, s.ir).values()].flat()
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

const PRD_ARTIFACT = "output/02-澄清后PRD.md"
export const BASELINE_HEADING = "# Requirement baseline: "
const INCREMENTAL_HEADER = "# Requirement baseline and later original user updates\nThe PRD below is the requirement as SDD clarified it for an earlier user update; the original user updates after it follow verbatim, in order. Apply each update in order. Later explicit revisions replace only the affected earlier requirements.\n"

/**
 * The PRD that stands for the inputs up to its update: the latest run whose
 * code counts (not voided, not superseded) that returned one, before this
 * update. Undefined when no such run has (the first update).
 */
export function prdBaseline(s: SddSnapshot, eventId: string): { run_id: string; event_id: string; input: number; text: string; digest: string } | undefined {
  const order = new Map(s.events.filter(e => e.kind === "user_input").map((e, i) => [e.event_id, i + 1]))
  for (const run of [...s.runs].reverse()) {
    if (!run.result || run.superseded || run.voided || run.event_id === eventId) continue
    const prd = run.result.artifacts.find(a => a.path.replace(/\\/gu, "/").endsWith(PRD_ARTIFACT) && a.text)
    if (prd) return { run_id: run.run_id, event_id: run.event_id, input: order.get(run.event_id)!, text: prd.text!, digest: prd.digest }
  }
  return undefined
}

export function baselineSection(baseline: { input: number; text: string }): string {
  return `\n${BASELINE_HEADING}the PRD SDD clarified for user update ${baseline.input}\n\n${baseline.text.trim()}\n`
}

/**
 * The acceptance subjects as delivered: each example's passages resolved to
 * verbatim quotes. A reference no input has, or to a passage this delivery
 * cuts, is left out; an example left with no passage, and a subject left with
 * no example, is dropped. Each is recorded.
 */
export function quotedAcceptance(acceptance: DraftAcceptance[], index: ReturnType<typeof segmentIndex>, cut: Parameters<typeof resolveQuotes>[2], dropped: DeliveryContract["dropped"]): AcceptanceSubject[] {
  unique(acceptance.map(a => a.subject), "acceptance subject")
  return acceptance.flatMap(a => {
    const examples = a.examples.flatMap((e, i) => {
      const given = resolveQuotes(e.given, index, cut), expect = resolveQuotes(e.expect, index, cut)
      const lost = [...given.dropped, ...expect.dropped]
      if (lost.length) dropped.push({ kind: "acceptance", name: `${a.subject} example ${i + 1}`, reason: `passages left out: ${lost.join("; ")}` })
      if (!given.quotes.length && !expect.quotes.length) return []
      return [{ given: quoteBlock(given.quotes), expect: quoteBlock(expect.quotes), given_quotes: given.quotes, expect_quotes: expect.quotes }]
    })
    if (!examples.length) { dropped.push({ kind: "acceptance", name: a.subject, reason: "no example quotes a delivered passage" }); return [] }
    return [{ subject: a.subject, items: a.items, examples }]
  })
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

/**
 * The CI's field objects with each edit merged onto its accepted version (v7 R10 fix): an entry naming an object of
 * fields_to_revise (by revises, or by the same name) keeps every row of that object it does not change or remove;
 * a row of the same field name replaces the old one. An object of fields_to_revise no entry edits stands as it was.
 * written: the objects with only the rows the answer wrote (checked strictly); base: "object|field" of rows kept
 * from the accepted versions.
 */
export function mergeFieldEdits(written: DeliveryDraft["fields"], bases: readonly DeliveryDraft["fields"][number][], dropped: DeliveryContract["dropped"]):
  { fields: DeliveryDraft["fields"]; written: DeliveryDraft["fields"]; base: Set<string> } {
  const byName = new Map(bases.map(o => [o.object, o]))
  const unknown = written.filter(w => w.revises?.trim() && !byName.has(w.revises.trim())).map(w => `${w.object} revises ${JSON.stringify(w.revises)}`)
  requireThat(!unknown.length, `Field dictionary edits name objects fields_to_revise does not list: ${unknown.join("; ")}; revises names one of ${[...byName.keys()].map(n => JSON.stringify(n)).join(", ") || "none"}, or is empty for a new object`)
  const used = new Set<string>(), base = new Set<string>()
  const fields = written.map(w => {
    const from = byName.get(w.revises?.trim() || w.object)
    const { revises: _revises, removed = [], ...rest } = w
    if (!from || used.has(from.object)) return rest
    used.add(from.object)
    const gone = removed.filter(name => !from.fields.some(f => f.field === name))
    if (gone.length) dropped.push({ kind: "field", name: w.object, reason: `removed names fields its accepted version does not have: ${gone.join(", ")}` })
    const kept = from.fields.filter(f => !removed.includes(f.field) && !w.fields.some(n => n.field === f.field))
    kept.forEach(f => base.add(`${w.object}|${f.field}`))
    return { ...rest, items: [...new Set([...from.items, ...w.items])], fields: [...kept, ...w.fields] }
  })
  for (const o of bases) if (!used.has(o.object)) {
    o.fields.forEach(f => base.add(`${o.object}|${f.field}`))
    fields.push({ object: o.object, items: o.items, fields: o.fields })
    dropped.push({ kind: "field", name: o.object, reason: "its items changed and the answer gave no edit: kept as accepted" })
  }
  return { fields, written: written.map(({ revises: _r, removed: _x, ...o }) => o), base }
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

/**
 * A field is delivered as required yes or no only with the requirements' own words saying so, written in the
 * delivered text; otherwise as not stated, and recorded. This holds for carried rows too, so a requiredness an
 * earlier round wrote from a sample value (a seed shown in one configuration) is not carried on.
 */
export function settleRequired<T extends DeliveryDraft["fields"][number]>(fields: T[], delivered: string): { fields: T[]; unsupported: Array<{ object: string; field: string; was: string }> } {
  const unsupported: Array<{ object: string; field: string; was: string }> = []
  const out = fields.map(o => ({ ...o, fields: o.fields.map(f => {
    if (f.required === "not stated" || writtenIn(delivered, f.required_wording ?? "")) return f
    unsupported.push({ object: o.object, field: f.field, was: f.required })
    return { ...f, required: "not stated", required_wording: "" }
  }) }))
  return { fields: out, unsupported }
}

export type { SettledConflict } from "./sdd-contract.js"

/**
 * The model's conflict entries, settled by code. Ruling and basis are required (a ruling without its basis is
 * rejected). An entry is left out, and recorded, when it names no current item this round writes, or when fewer
 * than two of its passages remain to quote (a passage this delivery cuts was already settled by a later update).
 */
export function settleConflicts(entries: readonly ConflictEntry[], index: ReturnType<typeof segmentIndex>,
  cut: (q: { source_id: string; start: number; end: number }) => boolean, now: ReturnType<typeof currentRevisions>, toWrite: readonly string[],
  dropped: DeliveryContract["dropped"]): SettledConflict[] {
  return entries.flatMap(e => {
    requireThat(e.ruling.trim().length > 0 && e.basis.trim().length > 0, `Conflict "${e.subject}": give both the ruling and its basis (a later update governs the part it changes; a specific rule takes precedence over a general one)`)
    const items = [...new Set(e.items.map(id => itemOf(id, now)).filter((id): id is string => id !== undefined))]
    if (!items.some(id => toWrite.includes(id))) { dropped.push({ kind: "conflict", name: e.subject, reason: "names no requirement this round writes" }); return [] }
    const resolved = resolveQuotes(e.passages, index, cut)
    if (resolved.quotes.length < 2) { dropped.push({ kind: "conflict", name: e.subject, reason: `fewer than two passages to quote (${resolved.dropped.join("; ") || "one passage given"})` }); return [] }
    return [{ subject: e.subject.trim(), items, quotes: resolved.quotes, ruling: e.ruling.trim(), basis: e.basis.trim() }]
  })
}

/**
 * Earlier rulings carried into this delivery: kept while every item they rule on is current at the same revision
 * and every passage they quote stands. A ruling written this round on any of the same items replaces it.
 */
export function carryConflicts(previous: NonNullable<DeliveryContract["conflicts"]>, written: readonly SettledConflict[], now: ReturnType<typeof currentRevisions>,
  excluded: ReadonlySet<string>, gone: (q: Quote) => boolean, dropped: DeliveryContract["dropped"]): NonNullable<DeliveryContract["conflicts"]> {
  return previous.flatMap(c => {
    const why = written.some(w => w.items.some(id => c.items.includes(id))) ? "replaced by a ruling written this round on the same items"
      : Object.entries(c.revisions).some(([id, r]) => now.get(id) !== r || excluded.has(id)) ? "an item it rules on was revised, withdrawn or is not delivered now"
      : c.quotes.some(gone) ? "a passage it quotes is cut from this delivery" : undefined
    if (why) { dropped.push({ kind: "conflict", name: c.subject, reason: why }); return [] }
    return [{ ...c, carried: true }]
  })
}

export function conflictSection(conflicts: readonly SettledConflict[]): string {
  if (!conflicts.length) return ""
  const body = conflicts.map(c => `## ${c.subject}\n${quoteBlock(c.quotes)}\n\n- Ruling: ${c.ruling}\n- Basis: ${c.basis}`).join("\n\n")
  return `# Inconsistencies in the original requirements\n${CONFLICT_NOTE}\n\n${body}\n\n`
}

export const CONFLICT_NOTE = "The original requirements say different things in the places below. Each passage is quoted verbatim with the user update it comes from; management's ruling and its basis follow. Carry the ruling into the PRD and implement it; the passages themselves stay authoritative as written."

export function fieldSection(fields: DeliveryDraft["fields"]): string {
  const cell = (v: string) => v.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ").trim()
  const required = (f: DeliveryDraft["fields"][number]["fields"][number]) => f.required === "not stated" ? "not stated in the original (a sample value is not a constraint)"
    : f.required_wording ? `${f.required} ("${f.required_wording}")` : f.required
  const body = fields.map(o => `## ${o.object.trim()}\n| Field | Type | Required | Meaning |\n|---|---|---|---|\n${o.fields.map(f => `| \`${cell(f.field)}\` | ${cell(f.type)} | ${cell(required(f))} | ${cell(f.meaning)} |`).join("\n")}`).join("\n\n")
  return `# Interface and data: field dictionary\n${FIELD_NOTE}\n\n${body}\n\n`
}

export const FIELD_NOTE = "Management derived this dictionary from the original requirements that follow, for the PRD's interface-and-data section. Each field name is part of the external interface (command-line options, file and configuration keys, output fields) and must be kept and implemented exactly as written."

export function acceptanceSection(acceptance: AcceptanceSubject[], deliveredFrom = 1): string {
  if (!acceptance.length) return ""
  // C1 (v6): examples name the passages they rest on; the original text is delivered once, below.
  const part = (label: string, quotes: AcceptanceSubject["examples"][number]["given_quotes"], text: string) => quotes?.length ? [`${label}:\n${refList(quotes, deliveredFrom)}`] : text.trim() ? [`${label}:\n${text.trim()}`] : []
  const body = acceptance.map(a => `## ${a.subject.trim()}\n${a.examples.map((e, i) => [`Example ${i + 1}`, ...part("Given", e.given_quotes, e.given), ...part("Expect", e.expect_quotes, e.expect)].join("\n")).join("\n\n")}`).join("\n\n")
  return `# Acceptance examples\n${ACCEPTANCE_NOTE}\n\n${body}\n\n`
}

export const ACCEPTANCE_NOTE = "Management lists, per command and operation, the passages of the original requirements that give an input and the result they state. Each passage is named by its user update and opening words and is found in the original text below (an update the PRD baseline stands for is covered by the PRD); every name, key, value, fixed text and exit code in it must be implemented exactly so."

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
  delivered: readonly ContentItem[], dispositions: ReadonlyMap<ContentItem, string>, effective: readonly EffectivePlacement[], from = 1): { text: string; removed: RemovedPassage[] } {
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
    // An input not delivered (it stands in the PRD baseline): after the latest input the statement rests on.
    const placed = first ? inputOrder.get(first.source_id)! : inputs.at(-1)!
    const event = events[(placed >= from ? placed : Math.max(inputs.at(-1)!, from)) - 1] ?? events.at(-1)!
    const anchored = placed >= from ? first : undefined
    const length = texts.get(event.event_id)!.length
    const at = anchored ? sourceSegments([event]).find(x => x.span.start <= anchored.start && anchored.start < x.span.end)?.span.end ?? length : length
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
    if (index + 1 >= from) parts.push(`\n## Original user update ${index + 1}\n\n${out}\n`)
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
