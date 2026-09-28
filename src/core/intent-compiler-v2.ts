import {
  canonicalJson,
  digestOf,
  digestText,
  isRef,
  isRefOrSource,
  isRecord,
  refKey,
  type AdvanceResult,
  type AtomStateRecord,
  type AtomStatus,
  type AuthorizationResult,
  type AuthorizeRequest,
  type CapabilityCatalog,
  type Candidate,
  type CompiledIntentDraft,
  type CompiledIntent,
  type CompilerEvent,
  type CoverageRecord,
  type EventReceipt,
  type ExecutionOutcome,
  type ExecutionReturnPayload,
  type IrChange,
  type MaterialFact,
  type OperationRequest,
  type Ref,
  type RunView,
  type SemanticCheckFinding,
  type SemanticCheckRecord,
  type SourceRef,
  type StartRequest,
  type TaskIntent,
} from "./intent-contract.js"
import { IntentStateManager } from "./intent-state-v2.js"
import { AtomStateLedger, atomRef, buildCompiledIntents, compiledIntentRef, type BuildCompiledIntentOptions } from "./compiled-intent.js"
import { ExecutionStateManager } from "./execution-state.js"
import { candidateChanges, candidateRepairContext, type CandidateRepairContext } from "./candidate-repair.js"
import { IntentStoreV2, type AssessmentRecord, type CheckRecord, type DeclarationChangeRecord, type ExecutionOutcomeRecord, type ManagementAttemptRecord, type ManagementRequestRecord, type QuestionRecord, type V2AdvanceDeltas, type V2RunSnapshot } from "./compiler-store-v2.js"
import type {
  CompilerModelV2,
  CompilerModelV2CheckResult,
  CompilerModelV2Input,
  CompilerModelV2Result,
  CompilerModelV2Usage,
  CompilerModelV2FailureDiagnostic,
  ExistingObjectDirectory,
} from "../model/compiler-model-v2.js"
import { V2_CHECK_CONTRACT, V2_COMPILER_CONTRACT } from "../model/compiler-model-v2.js"
import { bindCurrentRequirements, selectSourceEvents } from "./requirement-flow.js"
import { atomAdmission, type AtomAdmissionContext } from "./atom-admission.js"
import { materializeSourceContent, sourceSegments, validateSourceCoverage } from "./source-payload.js"

export interface IntentCompilerV2Options {
  store: IntentStoreV2
  model: CompilerModelV2
  /** Opt-in compatibility for old runs and fixtures without IR requirements; strict is the default. */
  requirement_integrity?: "strict" | "legacy"
  /**
   * Host facts for the management model: which operations the executor can be
   * granted, the workspace root, and whether a named path exists and is
   * readable.  Never carries file content.
   */
  capabilities?: CapabilitySource
}

export interface CapabilitySource {
  operations: readonly string[]
  workspace_root?: string
  describeMaterial?: (paths: readonly string[]) => MaterialFact[]
  /**
   * Host-computed digests for declared artifacts.  The compiler never reads
   * business files: it receives `sha256:<hex>` facts (or a reason the host
   * could not produce one) and compares them with what the executor claimed.
   */
  describeArtifacts?: (paths: readonly string[]) => MaybePromise<Array<{ path: string; digest?: string; reason?: string }>>
}

type MaybePromise<T> = T | Promise<T>

export interface IntentCompilerV2 {
  acceptEvent(event: CompilerEvent): Promise<EventReceipt>
  advance(input: { runId: string }): Promise<AdvanceResult>
  authorize(request: AuthorizeRequest): AuthorizationResult
  inspect(input: { runId: string }): Promise<RunView>
}

export class IntentCompilerV2Error extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "IntentCompilerV2Error"
    this.code = code
  }
}

const advancingStores = new WeakSet<IntentStoreV2>()

export function createIntentCompilerV2(options: IntentCompilerV2Options): IntentCompilerV2 {
  if (!(options.store instanceof IntentStoreV2)) throw new TypeError("store must be an IntentStoreV2")
  if (!options.model || typeof options.model.propose !== "function") throw new TypeError("model must implement propose")
  // Concurrent calls through this store must not consume each other's events.


  return Object.freeze({
    async acceptEvent(event: CompilerEvent): Promise<EventReceipt> {
      let execution = hydrateExecutionManager(options.store.current())
      let atoms = new AtomStateLedger(options.store.current().atom_states)
      let verifiedArtifacts: Array<{ path: string; digest: string }> | undefined
      if (event.kind === "execution_return" && event.execution_id) {
        const known = options.store.readEvents().find((record) => record.event.event_id === event.event_id)
        if (known) {
          if (known.digest !== digestOf(event)) {
            return {
              ok: false,
              run_id: event.run_id,
              event_id: event.event_id,
              status: "rejected",
              sequence: known.sequence,
              code: "identity_conflict",
              message: `event_id ${event.event_id} was already saved with different content`,
            }
          }
          return { ok: true, run_id: event.run_id, event_id: event.event_id, status: "duplicate", sequence: known.sequence }
        }
        const check = validateExecutionReturnIdentity(execution, event)
        if (!check.ok) {
          return {
            ok: false,
            run_id: event.run_id,
            event_id: event.event_id,
            status: "rejected",
            sequence: -1,
            code: check.code,
            message: check.message,
          }
        }
        // Deterministic artifact check before anything is saved: the executor's
        // digest claims are compared with what the host computes from the files.
        const artifactCheck = await verifyDeclaredArtifacts(options.capabilities, event)
        if (!artifactCheck.ok) {
          return {
            ok: false,
            run_id: event.run_id,
            event_id: event.event_id,
            status: "rejected",
            sequence: -1,
            code: artifactCheck.code,
            message: artifactCheck.message,
          }
        }
        execution = hydrateExecutionManager(options.store.current())
        atoms = new AtomStateLedger(options.store.current().atom_states)
        const freshIdentity = validateExecutionReturnIdentity(execution, event)
        if (!freshIdentity.ok) return { ok: false, run_id: event.run_id, event_id: event.event_id, status: "rejected", sequence: -1, code: freshIdentity.code, message: freshIdentity.message }
        verifiedArtifacts = artifactCheck.verified.length === 0 ? undefined : artifactCheck.verified
      }
      const receipt = options.store.acceptEvent(event)
      if (receipt.ok && event.kind === "execution_return" && event.execution_id) {
        const payload = event.payload as ExecutionReturnPayload
        const historical = execution.getExecution(event.execution_id)?.status === "closed"
        if (!historical) execution.closeExecution(event.execution_id, `execution_return:${payload.state_claim}`)
        const deltas: V2AdvanceDeltas = {
          dispatches: execution.dispatchesSnapshot(),
          executions: execution.list(),
        }
        const outcomeRecord = recordExecutionOutcome(options.store, execution, atoms, event, payload, verifiedArtifacts, historical)
        if (outcomeRecord) {
          deltas.atom_states = outcomeRecord.atom_states
          deltas.execution_outcome_record = outcomeRecord.record
        }
        options.store.applyDeltas(deltas)
      }
      return receipt
    },
    async advance(input: { runId: string }) {
      if (advancingStores.has(options.store)) return failure(input.runId, "management_busy", "this store already has an advance in progress")
      advancingStores.add(options.store)
      try {
        return await advance(options.store, options.model, hydrateExecutionManager(options.store.current()), new AtomStateLedger(options.store.current().atom_states), options.capabilities, input, options.requirement_integrity !== "legacy")
      } finally { advancingStores.delete(options.store) }
    },
    authorize: (request: AuthorizeRequest) => authorize(options.store, hydrateExecutionManager(options.store.current()), new AtomStateLedger(options.store.current().atom_states), options.capabilities, request),
    async inspect(input: { runId: string }): Promise<RunView> {
      return inspect(options.store, hydrateExecutionManager(options.store.current()), input)
    },
  })
}

async function advance(
  store: IntentStoreV2,
  model: CompilerModelV2,
  execution: ExecutionStateManager,
  atoms: AtomStateLedger,
  capabilities: CapabilitySource | undefined,
  input: { runId: string },
  strictRequirements: boolean,
): Promise<AdvanceResult> {
  let snapshot = store.current()
  if (input.runId !== snapshot.run_id) return failure(input.runId, "identity_conflict", "runId does not match this store")

  const events = store.popPending()
  snapshot = store.current()
  const sourceEvents = selectSourceEvents(store.readEvents(), events, snapshot.ir)
  const availableSources = [...sourceEvents, ...events]
  if (events.length === 0) {
    return {
      ok: true,
      run_id: snapshot.run_id,
      disposition: "unchanged",
      pending_events: [],
      compiled_revisions: revisionMap(snapshot.compiled),
      ir_revisions: irRevisionMap(snapshot.ir),
    }
  }

  if (snapshot.budget.management_requests >= snapshot.budget.max_management_requests) {
    store.requeuePending(events.map((event) => event.event_id))
    return failure(snapshot.run_id, "budget_exhausted", "management request budget for this event batch is exhausted")
  }
  if (snapshot.budget.total_management_requests >= snapshot.budget.max_total_management_requests) {
    store.requeuePending(events.map((event) => event.event_id))
    return failure(snapshot.run_id, "budget_exhausted", "total management request budget for this run is exhausted")
  }

  // Retain the reasons and the exact rejected draft. This supplies a revision
  // starting point; it does not guarantee local repair or reuse a check result.
  const pendingIds = new Set(events.map((event) => event.event_id))
  const priorFailure = [...snapshot.management_log]
    .reverse()
    .find((record) => record.status !== "accepted" && record.trigger_event_ids.some((eventId) => pendingIds.has(eventId)))
  const previousRejection = priorFailure === undefined ? undefined : {
    request_id: priorFailure.request_id,
    status: priorFailure.status,
    message: priorFailure.error_message ?? "",
    findings: (snapshot.semantic_checks.find((check) => check.sequence === priorFailure.sequence)?.findings ?? []).map((finding) => ({
      dimension: finding.dimension ?? "unknown",
      claim: finding.claim,
      expected: finding.expected,
      observed: finding.observed,
      evidence_resolved: finding.evidence_resolved === true,
    })),
  }
  const modelInput: CompilerModelV2Input = {
    source_segments: sourceSegments(availableSources),
    run_id: snapshot.run_id,
    events,
    source_events: sourceEvents,
    event_source_refs: eventSourceRefs(availableSources),
    ir: snapshot.ir,
    compiled: snapshot.compiled,
    existing_objects: buildExistingObjectDirectory(snapshot.ir, snapshot.compiled),
    atom_refs: buildAtomRefs(snapshot.compiled),
    executions: execution.list().map(toExecutionView),
    atom_states: snapshot.atom_states,
    execution_outcomes: snapshot.execution_outcomes,
    assessments: snapshot.assessments,
    capabilities: describeCapabilities(capabilities, events),
    budget: {
      requests_used: snapshot.budget.management_requests,
      max_requests: snapshot.budget.max_management_requests,
    },
    contract: V2_COMPILER_CONTRACT,
    ...(previousRejection === undefined ? {} : { previous_rejection: previousRejection }),
  }
  if (priorFailure?.candidate !== undefined) {
    modelInput.repair_context = candidateRepairContext(priorFailure.request_id, priorFailure.candidate, priorFailure.request, modelInput)
  }
  const basisDigest = managementBasis(snapshot, store.readEvents())
  const mgmtSequence = snapshot.management_log.length + 1
  const startedAt = new Date().toISOString()
  // `compiled-<n>` never collides with the draft-local `ci-<n>` labels the
  // contract uses, so a candidate's local_ref can never look like an identity.
  const dryRun = { nextCompiledIntentId: () => "compiled-dry-run" }
  // Every call in this batch, in order, with the raw answer and the issues it
  // raised: a failed batch is diagnosed from this record, not re-run.  The text
  // is bounded so one runaway answer cannot bloat the store.
  const attemptsLog: ManagementAttemptRecord[] = []
  let activeRepairContext: CandidateRepairContext | undefined
  // Every model call is measured on its own, so cost attribution is a reading
  // and not an inference from token counts.
  const proposeTimed = async (request: CompilerModelV2Input): Promise<CompilerModelV2Result> => {
    activeRepairContext = request.repair_context === undefined ? undefined : structuredClone(request.repair_context)
    const startedAt = new Date().toISOString()
    const result = await model.propose(structuredClone(request))
    const usage = result.call?.usage ?? result.error?.diagnostic?.opencode_response?.usage
    recordManagementCall(store, `mgmt-${mgmtSequence}`, "propose", startedAt, new Date().toISOString(), result.ok ? "ok" : "error", result.error?.code, usage, result.error?.diagnostic)
    attemptsLog.push({
      kind: "propose",
      ...(result.error?.diagnostic === undefined ? {} : { failure_diagnostic: result.error.diagnostic }),
      ...boundedAttemptText(result.call?.text),
      ...(activeRepairContext === undefined ? {} : { repair_context: activeRepairContext }),
    })
    return result
  }
  /** Attach the issues an attempt produced to that attempt's own record. */
  const attachIssues = (kind: "propose" | "check", raised: readonly string[]): void => {
    for (let index = attemptsLog.length - 1; index >= 0; index -= 1) {
      if (attemptsLog[index]?.kind !== kind || attemptsLog[index]?.issues !== undefined) continue
      attemptsLog[index] = { ...attemptsLog[index] as ManagementAttemptRecord, issues: [...raised] }
      return
    }
  }
  let proposalInput = modelInput
  let proposal = await proposeTimed(proposalInput)
  let attempts = 1
  // Source references are resolved — and their digests written — before any
  // other check runs, so every later comparison sees a reference that resolves.
  let sourceRefs: SourceRefStats = { total: 0, resolved: 0, normalized: 0, unresolved: 0, unresolvedRefs: [] }
  let prepared: ReturnType<typeof prepareCandidate> | undefined
  const issuesFor = (result: CompilerModelV2Result): string[] => {
    prepared = undefined
    if (!result.ok || result.candidate === undefined) return proposalIssues(result, events, snapshot.ir, snapshot.compiled, dryRun, strictRequirements)
    result.candidate = structuredClone(result.candidate)
    sourceRefs = resolveSourceRefs(result.candidate, availableSources)
    if (strictRequirements && sourceRefs.unresolved > 0) {
      return [`candidate sources must cite a resolvable user text span or event; ${sourceRefs.unresolved} unresolved reference(s): ${JSON.stringify(sourceRefs.unresolvedRefs)}`]
    }
    const attempt = attemptsLog.at(-1)
    if (attempt?.kind === "propose" && activeRepairContext !== undefined) {
      attempt.candidate_changes = candidateChanges(activeRepairContext.candidate, result.candidate)
    }
    const candidateErrors = proposalIssues(result, events, snapshot.ir, snapshot.compiled, dryRun, strictRequirements)
    if (candidateErrors.length > 0) return candidateErrors
    try { prepared = prepareCandidate(snapshot, result.candidate, events, availableSources, strictRequirements, capabilities) }
    catch (error) { return [errorMessage(error)] }
    return []
  }
  let issues = issuesFor(proposal)
  attachIssues("propose", issues)
  const semanticChecks: SemanticCheckRecord[] = []
  const checkUsage: Array<NonNullable<SemanticCheckRecord["usage"]> | undefined> = []
  let semanticRejected = false
  let checkBudgetExhausted = false
  // A check that never produced a verdict is not a judgment about the
  // candidate: it is recorded with verdict `unavailable` and fails the batch as
  // infrastructure, never as "the checker said no".
  let checkFailure: { kind: "transport" | "deterministic"; message: string } | undefined
  // One management request proposes; a batch that compiles new atoms then gets
  // an independent check of the same candidate.  Transport failures re-send the
  // same request, revisions carry the reasons back, and every request counts
  // against the per-batch budget, so a slow provider cannot loop here.
  for (;;) {
    if (managementBasis(store.current(), store.readEvents()) !== basisDigest) break
    if (proposal.ok && proposal.candidate !== undefined && issues.length === 0) {
      if (model.verify === undefined || semanticCheckTaskIds(proposal.candidate, events).length === 0) break
      // A configured, applicable check must fit within the same batch budget.
      const maxAttempts = snapshot.budget.max_management_requests
      if (attempts + 1 > maxAttempts) {
        checkBudgetExhausted = true
        issues = ["no request budget remains for the independent check; a batch that compiles new atoms is not accepted unverified"]
        break
      }
      const runCheck = () => runSemanticCheck(model, proposal.candidate as Candidate, {
        run_id: snapshot.run_id,
        events,
        source_events: sourceEvents,
        ir: snapshot.ir,
        compiled: snapshot.compiled,
        capabilities: modelInput.capabilities ?? { operations: [], material: [] },
        prepared: prepared?.view,
        sequence: mgmtSequence,
        budget: { requests_used: attempts, max_requests: maxAttempts },
          recordCall: (startedAt, status, errorCode, usage, text, failureDiagnostic) => {
          recordManagementCall(store, `mgmt-${mgmtSequence}`, "check", startedAt, new Date().toISOString(), status, errorCode, usage, failureDiagnostic)
          attemptsLog.push({ kind: "check", ...(failureDiagnostic === undefined ? {} : { failure_diagnostic: failureDiagnostic }), ...boundedAttemptText(text), prepared_digest: prepared?.view.digest })
        },
      })
      let check = await runCheck()
      if (check === undefined) break
      attempts += 1
      semanticChecks.push(check.record)
      checkUsage.push(check.usage)
      attachIssues("check", check.issues)
      // The check itself did not run to a verdict.  A transport or unparseable
      // answer is worth one more sample of the same candidate; a contract
      // mismatch is not — with the strict-decoding transports we use, the
      // provider is constrained to the schema we sent, so re-sending the same
      // contract would spend minutes to fail identically (r11c).
      if (check.failure?.kind === "transport" && attempts + 1 <= maxAttempts) {
        check = await runCheck()
        if (check !== undefined) {
          attempts += 1
          semanticChecks.push(check.record)
          checkUsage.push(check.usage)
          attachIssues("check", check.issues)
        }
      }
      if (check === undefined) break
      if (managementBasis(store.current(), store.readEvents()) !== basisDigest) break
      if (check.failure !== undefined) {
        checkFailure = check.failure
        break
      }
      // A verdict of "inconsistent" whose findings cite nothing this input
      // contains does not block: the objections are recorded, the batch goes on.
      if (check.issues.length === 0) break
      semanticRejected = true
      issues = check.issues
    } else if (issues.length === 0 && !isRetryableTransportFailure(proposal)) {
      // Terminal model error (provider rejection, unparseable output): repeating
      // the same request would only spend budget.
      break
    }
    // When an independent check exists, a revision is only worth proposing if
    // the check that must follow it still fits: propose + check is two
    // requests.  Without a check, each revision costs one request.
    const checkRequired = model.verify !== undefined
    if (issues.length > 0 && checkRequired && attempts + 2 > snapshot.budget.max_management_requests) break
    if (attempts >= snapshot.budget.max_management_requests) break
    // A later proposal has its own outcome; an older check rejection remains in
    // the attempt history but cannot classify a new mechanical/provider error.
    semanticRejected = false
    if (issues.length === 0) {
      await delay(TRANSPORT_RETRY_BACKOFF_MS)
      // Format/transport retries repeat the most recent revision request,
      // including any validation errors and rejected-draft context.
      proposal = await proposeTimed(proposalInput)
    } else {
      const nextInput: CompilerModelV2Input = {
        ...proposalInput,
        validation_errors: issues,
      }
      if (proposal.candidate !== undefined) {
        nextInput.repair_context = candidateRepairContext(`mgmt-${mgmtSequence}`, proposal.candidate, proposalInput, modelInput)
        // A complete schema-valid candidate supersedes any earlier malformed
        // JSON draft as the explicit repair starting point.
        delete nextInput.schema_rejected_draft
      } else if (proposal.schema_rejected_draft !== undefined) {
        nextInput.schema_rejected_draft = structuredClone(proposal.schema_rejected_draft)
      }
      proposalInput = nextInput
      proposal = await proposeTimed(proposalInput)
    }
    attempts += 1
    issues = issuesFor(proposal)
    attachIssues("propose", issues)
  }
  const stale = managementBasis(store.current(), store.readEvents()) !== basisDigest
  const completedAt = new Date().toISOString()
  if (stale || !proposal.ok || !proposal.candidate || issues.length > 0 || checkFailure !== undefined) {
    const message = stale ? "input or execution state changed while management was running; draft retained without commit" : checkFailure !== undefined
      ? checkFailure.message
      : issues.length > 0
        ? `candidate rejected: ${issues.join("; ")}`
        : proposal.error?.message ?? "management model returned no candidate"
    // A check that never ran is infrastructure, not a semantic verdict: it is
    // recorded as such (status/error_code), and it never sets semanticRejected.
    const status = stale ? "validation_failed" : checkFailure !== undefined
      ? checkFailure.kind === "transport" ? "transport_failed" : "schema_failed"
      : issues.length > 0 && proposal.ok ? "validation_failed" : statusForModelError(proposal.error?.code)
    const errorCode = stale ? "stale_basis" : checkFailure !== undefined
      ? "check_unavailable"
      : checkBudgetExhausted ? "budget_exhausted"
        : semanticRejected ? "semantic_unresolved"
          : proposal.error?.code ?? "invalid_candidate"
    store.applyDeltas({
      management_requests: attempts,
      management_log_record: managementRecord({
        sequence: mgmtSequence,
        startedAt,
        completedAt,
        triggerEventIds: events.map((event) => event.event_id),
        request: modelInput,
        requestDigest: digestOf(modelInput),
        preparedDigest: prepared?.view.digest,
        readBasisDigest: basisDigest,
        call: proposal.call,
        candidate: proposal.candidate,
        sourceRefs,
        attempts: attemptsLog,
        status,
        errorCode,
        errorMessage: message,
        ir: snapshot.ir,
        compiled: snapshot.compiled,
        retry: attempts > 1,
      }),
      ...(semanticChecks.length === 0 ? {} : { semantic_checks: semanticChecks }),
      ...budgetDeltas(proposal.call?.usage ?? proposal.error?.diagnostic?.opencode_response?.usage, checkUsage),
    })
    store.requeuePending(events.map((event) => event.event_id))
    const retryable = stale ? false : checkFailure !== undefined
      ? checkFailure.kind === "transport"
      : issues.length === 0 && isRetryableTransportFailure(proposal)
    return failure(
      snapshot.run_id,
      errorCode,
      message,
      retryable,
    )
  }
  const candidate = proposal.candidate

  if (!prepared) throw new Error("valid candidate has no prepared state")
  const { ir, compiled, deliveries, questions, declarationChanges } = prepared
  const acceptedEventIds = events.map(event => event.event_id)

  store.applyDeltas({
    ir,
    compiled,
    atom_states: prepared.atom_states,
    compiled_intent_sequence: prepared.compiled_intent_sequence,
    dispatches: prepared.dispatches,
    executions: prepared.executions,
    unresolved_user_event_ids: (snapshot.unresolved_user_event_ids ?? []).filter(id => !acceptedEventIds.includes(id)),
    ...(prepared.execution_eligibility === undefined ? {} : { execution_eligibility: prepared.execution_eligibility }),
    management_requests: attempts,
    management_log_record: managementRecord({
      sequence: mgmtSequence,
      startedAt,
      completedAt,
      triggerEventIds: acceptedEventIds,
      request: modelInput,
      requestDigest: digestOf(modelInput),
      preparedDigest: prepared.view.digest,
      readBasisDigest: basisDigest,
      call: proposal.call,
      candidate,
      sourceRefs,
      attempts: attemptsLog,
      declarationChanges,
      status: "accepted",
      ir,
      compiled,
      retry: attempts > 1,
    }),
    assessments: collectAssessments(candidate, acceptedEventIds, mgmtSequence),
    checks: collectChecks(candidate, acceptedEventIds, mgmtSequence),
    questions: collectQuestions(candidate, acceptedEventIds, mgmtSequence),
    coverage: collectCoverage(candidate, acceptedEventIds, mgmtSequence),
    ...(semanticChecks.length === 0 ? {} : { semantic_checks: semanticChecks }),
    ...budgetDeltas(proposal.call?.usage ?? proposal.error?.diagnostic?.opencode_response?.usage, checkUsage),
    ...(proposal.call?.usage?.cache_read_tokens === undefined ? {} : { management_cache_read_tokens: proposal.call.usage.cache_read_tokens }),
    ...(proposal.call?.usage?.cache_write_tokens === undefined ? {} : { management_cache_write_tokens: proposal.call.usage.cache_write_tokens }),
    ...(proposal.call?.usage?.cost === undefined ? {} : { management_cost: proposal.call.usage.cost }),
  })

  return {
    ok: true,
    run_id: snapshot.run_id,
    disposition: prepared.disposition,
    pending_events: [],
    compiled_revisions: revisionMap(compiled),
    ir_revisions: irRevisionMap(ir),
    deliveries,
    ...(questions.length > 0 ? { questions } : {}),
  }
}

/** Prepare on private state; no persistence, authorization or host effects. */
function prepareCandidate(snapshot: V2RunSnapshot, candidate: Candidate, events: readonly CompilerEvent[], availableSources: readonly CompilerEvent[], strictRequirements: boolean, capabilities?: CapabilitySource) {
  const execution = hydrateExecutionManager(snapshot)
  const atoms = new AtomStateLedger(snapshot.atom_states)
  let compiledIntentSequence = snapshot.compiled_intent_sequence
  const nextCompiledIntentId = () => `compiled-${compiledIntentSequence += 1}`
  const ir = { ...snapshot.ir }
  const compiled = { ...snapshot.compiled }
  const deliveries: NonNullable<AdvanceResult["deliveries"]> = []
  const questions: string[] = []
  // Shape changes the derived IR entries took from this batch's atoms; recorded
  // on the batch instead of rejecting it (the check judges them under D2).
  const declarationChanges: DeclarationChangeRecord[] = []
  const changedTasks = new Set<string>()
  let irChanged = false
  let lifecycleChanged = false

  for (const group of candidate.groups) {
    const taskRefs = group.task_refs
    if (taskRefs.length === 0) continue

    if (group.ir_changes.some((change) => change.action !== "preserve")) {
      const stateResult = new IntentStateManager(ir).apply(group.ir_changes, taskRefs)
      if (!stateResult.ok) {
        throw new Error(stateResult.errors.map((error) => error.message).join("; "))
      }
      for (const [taskId, task] of Object.entries(stateResult.tasks)) ir[taskId] = task
      if (strictRequirements) materializeSourceContent(ir[taskRefs[0]!]!, group.ir_changes, availableSources)
      irChanged = true
    }

    for (const taskId of taskRefs) {
      if (!ir[taskId]) {
        throw new Error(`group.task_refs contains unknown task ${taskId}`)
      }
    }

    for (const executionDecision of group.execution_decisions) {
      const existing = execution.getExecution(executionDecision.execution_id)
      if (!existing || !taskRefs.includes(existing.task_id)) throw new Error(`execution decision references an execution outside this group: ${executionDecision.execution_id}`)
      if (executionDecision.decision === "stop") {
        execution.closeExecution(executionDecision.execution_id, executionDecision.reason)
        lifecycleChanged = true
      }
    }

    if (group.compilation.decision === "replace") {
      const drafts = strictRequirements
        ? bindCurrentRequirements(
          group, ir[taskRefs[0] as string] as TaskIntent, snapshot.ir[taskRefs[0] as string], availableSources,
          (compiled[taskRefs[0] as string]?.atoms ?? []).filter(atom => ["ready", "executing"].includes(atoms.status(taskRefs[0] as string, atom))),
        )
        : group.compilation.drafts
      if (strictRequirements) for (const draft of drafts) for (const atom of draft.atoms) {
        const prior = compiled[draft.task_id]?.atoms.find(existing => existing.atom_id === atom.atom_id && existing.revision === atom.revision)
        if (prior && atomRef(prior).digest !== atomRef(atom).digest) {
          throw new Error(`Atom ${atom.atom_id}@${atom.revision} changes content after requirement binding; raise its revision`)
        }
      }
      for (const draft of drafts) {
        if (!ir[draft.task_id]) {
          throw new Error(`compiled draft references unknown task ${draft.task_id}`)
        }
      }
      const build = buildCompiledIntents(compiled, drafts, { nextCompiledIntentId })
      if (!build.ok) {
        throw new Error(build.errors.join("; "))
      }
      // Register declared deliverables and materials in the same commit, so the
      // compiled intent is stored together with the IR entries it references.
      const registration = registrationChanges(taskRefs[0] as string, drafts, ir[taskRefs[0] as string], eventSourceRefs(events))
      if (registration.issues.length > 0) {
        throw new Error(registration.issues.join("; "))
      }
      if (registration.changes.length > 0) {
        const registered = new IntentStateManager(ir).apply(registration.changes, [taskRefs[0] as string])
        if (!registered.ok) {
          throw new Error(registered.errors.map((error) => error.message).join("; "))
        }
        for (const [taskId, task] of Object.entries(registered.tasks)) ir[taskId] = task
        irChanged = true
      }
      for (const change of registration.declarationChanges) declarationChanges.push(change)
      const existingStates = atoms.snapshot()
      atoms.apply(build.atom_states.filter(record => !existingStates.some(existing =>
        existing.task_id === record.task_id && existing.atom_id === record.atom_id && existing.atom_revision === record.atom_revision,
      )))
      // A replacement the model proposed becomes a ledger fact here, where the
      // prior atom and its owner are still known; the atom itself keeps content.
      for (const draft of group.compilation.drafts) {
        const prior = compiled[draft.task_id]
        for (const state of build.atom_states.filter(record => record.task_id === draft.task_id)) {
          const previous = state.previous_atom_ref
          if (previous === undefined) continue
          const superseded = prior?.atoms.find((candidate) => candidate.atom_id === previous.id && candidate.revision === previous.revision)
          // A failed atom keeps its failed record: the replacement chain is
          // visible through the new atom's previous_atom_ref, and only an atom
          // that was not already failed becomes a historical (legacy) record.
          if (superseded !== undefined && atoms.status(draft.task_id, superseded) !== "failed") {
            atoms.record(draft.task_id, superseded, prior?.compiled_intent_id ?? "unknown", "legacy")
          }
        }
      }
      for (const [taskId, intent] of Object.entries(build.intents)) {
        compiled[taskId] = intent
        changedTasks.add(taskId)
      }
    } else if (strictRequirements) {
      bindCurrentRequirements(
        group, ir[taskRefs[0] as string] as TaskIntent, snapshot.ir[taskRefs[0] as string], availableSources,
        (compiled[taskRefs[0] as string]?.atoms ?? []).filter(atom => ["ready", "executing"].includes(atoms.status(taskRefs[0] as string, atom))),
      )
    }

    for (const question of group.questions) questions.push(question.text)
  }

  // Management acceptance: a satisfied assessment targeting a completed atom
  if (strictRequirements) validateSourceCoverage(candidate, events, availableSources, snapshot.ir, ir)

  // is the code-committed signal that the atom becomes a historical record.
  const satisfiedTargets = candidate.groups
    .flatMap((group) => group.assessments)
    .filter((assessment) => assessment.result === "satisfied" && isRef(assessment.target_ref))
    .map((assessment) => assessment.target_ref as Ref)
  if (satisfiedTargets.length > 0) {
    for (const [taskId, intent] of Object.entries(compiled)) {
      let changed = false
      for (const atom of intent.atoms) {
        const target = satisfiedTargets.find((ref) => ref.id === atom.atom_id && ref.revision === atom.revision)
        if (!target || atoms.status(taskId, atom) !== "completed") continue
        if (target.digest !== atomRef(atom).digest) continue
        // The satisfied assessment is the management-committed signal that
        // this atom becomes a historical record.
        atoms.record(taskId, atom, intent.compiled_intent_id, "legacy")
        changed = true
      }
      if (changed) lifecycleChanged = true
    }
  }

  // A changed compilation invalidates prior execution authority for that task.
  const continued = new Set<string>()
  for (const group of candidate.groups) {
    for (const decision of group.execution_decisions) {
      if (decision.decision !== "continue") continue
      const active = execution.getExecution(decision.execution_id)
      const activeDispatch = active && execution.dispatch(active.dispatch_id)
      const oldAtom = active && snapshot.compiled[active.task_id]?.atoms.find(a => a.atom_id === active.atom_id && a.revision === activeDispatch?.atom_revision)
      const newAtom = active && compiled[active.task_id]?.atoms.find(a => a.atom_id === active.atom_id && a.revision === activeDispatch?.atom_revision)
      if (!active || active.status !== "active" || !oldAtom || !newAtom || atomRef(oldAtom).digest !== atomRef(newAtom).digest || !["ready", "executing"].includes(atoms.status(active.task_id, newAtom)) || ir[active.task_id]?.current_scope.disposition !== "proceed") {
        throw new Error(`continue requires an active execution with unchanged content and a proceeding scope: ${decision.execution_id}`)
      }
      atoms.record(active.task_id, newAtom, compiled[active.task_id]!.compiled_intent_id, "executing")
      continued.add(decision.execution_id)
    }
  }
  for (const executionRecord of execution.list()) {
    if (!continued.has(executionRecord.execution_id) && changedTasks.has(executionRecord.task_id) && executionRecord.status === "active") {
      execution.closeExecution(executionRecord.execution_id, "compiled_revision_advanced")
      // The atom whose execution just lost its authority returns to ready: its
      // content identity is unchanged, so it stays dispatchable instead of
      // being stuck at executing for the rest of the run.
      const intent = compiled[executionRecord.task_id]
      const atom = intent?.atoms.find((candidate) => candidate.atom_id === executionRecord.atom_id)
      if (intent !== undefined && atom !== undefined && atoms.status(intent.task_id, atom) === "executing") {
        atoms.record(intent.task_id, atom, intent.compiled_intent_id, "ready")
      }
    }
  }

  const admission: AtomAdmissionContext = { compiled, ir, atoms, capabilities,
    execution_outcomes: snapshot.execution_outcomes,
    assessments: [...snapshot.assessments, ...candidate.groups.flatMap(group => group.assessments)] }
  // Re-evaluate waiting successors after accepted results even with reuse.
  // User updates still clear only tasks explicitly handled by the candidate.
  const dispatchTasks = events.some(event => event.kind === "user_input")
    ? new Set(candidate.groups.flatMap(group => group.task_refs))
    : new Set(Object.keys(compiled).filter(taskId => !snapshot.execution_eligibility || snapshot.execution_eligibility.task_ids.includes(taskId)))
  for (const taskId of dispatchTasks) {
    const intent = compiled[taskId]
    if (!intent || ir[taskId]?.current_scope.disposition !== "proceed") continue
    for (const atom of intent.atoms) {
      const alreadyOffered = execution.dispatchesSnapshot().some(dispatch => dispatch.task_id === taskId && dispatch.atom_id === atom.atom_id && dispatch.atom_revision === atom.revision && dispatch.digest === atomRef(atom).digest)
      if (!changedTasks.has(taskId) && alreadyOffered) continue
      if (atoms.status(taskId, atom) === "ready" && atomAdmission(taskId, atom, admission) === undefined) {
        const dispatch = execution.createDispatch(intent, atom.atom_id)
        deliveries.push({
          dispatch_id: dispatch.dispatch_id,
          task_id: dispatch.task_id,
          atom_id: dispatch.atom_id,
          digest: dispatch.digest,
          compiled_revision: dispatch.compiled_revision,
          atom,
        })
      }
    }
  }

  const userUpdate = events.some(event => event.kind === "user_input")
  const taskIds = [...new Set(candidate.groups.flatMap(group => group.task_refs))]
  const eligibility = userUpdate ? {
    task_ids: taskIds.filter(taskId => ir[taskId]?.current_scope.disposition === "proceed"),
    execution_ids: [...continued],
  } : snapshot.execution_eligibility
  const dispatchableAtoms: import("./intent-contract.js").Atom[] = []
  for (const taskId of taskIds) {
    const intent = compiled[taskId]
    if (!intent || ir[taskId]?.current_scope.disposition !== "proceed") continue
    for (const atom of intent.atoms) {
      if (!["ready", "executing"].includes(atoms.status(taskId, atom))) continue
      const dispatch = execution.dispatchesSnapshot().find(d => d.task_id === taskId && d.atom_id === atom.atom_id && d.atom_revision === atom.revision && d.digest === atomRef(atom).digest)
      if (dispatch && atomAdmission(taskId, atom, admission) === undefined) dispatchableAtoms.push(atom)
    }
  }
  const view = {
    ir, compiled, atom_states: atoms.snapshot(), dispatchable_atoms: dispatchableAtoms,
    execution_decisions: candidate.groups.flatMap(group => group.execution_decisions),
    eligible_task_ids: eligibility?.task_ids ?? taskIds,
    eligible_execution_ids: eligibility?.execution_ids ?? execution.list().filter(e => e.status === "active").map(e => e.execution_id),
  }
  const disposition: AdvanceResult["disposition"] = deliveries.length > 0 ? "dispatched"
    : questions.length > 0 ? "clarifying"
      : taskIds.some(id => ir[id]?.current_scope.disposition !== "proceed") || candidate.groups.some(g => g.execution_decisions.some(d => d.decision === "await_result")) ? "waiting"
        : continued.size > 0 ? "continuing"
          : changedTasks.size > 0 || irChanged || lifecycleChanged ? "revised" : "unchanged"
  return { ir, compiled, deliveries, questions, disposition, declarationChanges,
    atom_states: atoms.snapshot(), dispatches: execution.dispatchesSnapshot(), executions: execution.list(),
    compiled_intent_sequence: compiledIntentSequence, execution_eligibility: eligibility,
    view: { ...view, digest: digestOf(view) },
  }
}

/** Compare read facts, excluding accounting written by this call itself. */
function managementBasis(snapshot: V2RunSnapshot, events: ReturnType<IntentStoreV2["readEvents"]>): string {
  return digestOf({ ir: snapshot.ir, compiled: snapshot.compiled, executions: snapshot.executions,
    dispatches: snapshot.dispatches, atom_states: snapshot.atom_states, assessments: snapshot.assessments,
    unresolved_user_event_ids: snapshot.unresolved_user_event_ids ?? [], execution_eligibility: snapshot.execution_eligibility ?? null,
    compiled_intent_sequence: snapshot.compiled_intent_sequence,
    events: events.map(row => ({ sequence: row.sequence, digest: row.digest })),
  })
}

function authorize(
  store: IntentStoreV2,
  execution: ExecutionStateManager,
  atoms: AtomStateLedger,
  capabilities: CapabilitySource | undefined,
  request: AuthorizeRequest,
): AuthorizationResult {
  if (request.run_id !== store.current().run_id) {
    const refused = deny(request.run_id, "identity_conflict", "runId does not match this store")
    recordDenial(store, request, refused)
    return refused
  }
  const snapshot = store.current()
  const taskId = request.kind === "start" ? execution.dispatch(request.dispatch_id)?.task_id : execution.getExecution(request.execution_id)?.task_id
  let refusal: AuthorizationResult | undefined
  if ((snapshot.unresolved_user_event_ids?.length ?? 0) > 0) refusal = deny(request.run_id, "user_update_pending", "a received user update has not been committed; run authority is suspended")
  else if (taskId && snapshot.ir[taskId]?.current_scope.disposition !== "proceed") refusal = deny(request.run_id, "scope_not_proceeding", "the current task scope does not permit execution")
  else if (snapshot.execution_eligibility && taskId && (!snapshot.execution_eligibility.task_ids.includes(taskId) || (request.kind === "operation" && !snapshot.execution_eligibility.execution_ids.includes(request.execution_id)))) refusal = deny(request.run_id, "execution_review_required", "this work has not been cleared under the latest user update")
  if (!refusal && taskId) {
    const dispatch = request.kind === "start" ? execution.dispatch(request.dispatch_id) : execution.dispatch(execution.getExecution(request.execution_id)?.dispatch_id ?? "")
    const atom = snapshot.compiled[taskId]?.atoms.find(candidate => candidate.atom_id === dispatch?.atom_id && candidate.revision === dispatch.atom_revision)
    if (atom) {
      const blocked = atomAdmission(taskId, atom, { compiled: snapshot.compiled, ir: snapshot.ir, atoms, assessments: snapshot.assessments, capabilities, execution_outcomes: snapshot.execution_outcomes })
      if (blocked) refusal = deny(request.run_id, "execution_inactive", blocked)
    }
  }
  if (refusal) { recordDenial(store, request, refusal); return refusal }
  const result = request.kind === "start"
    ? startExecution(store, execution, atoms, request)
    : authorizeOperation(store, execution, capabilities, request)
  // Every refusal is recorded: an audit has to show what was asked for and
  // rejected, not only what was allowed.
  if (!result.ok) recordDenial(store, request, result)
  return result
}

/**
 * Measure one management model call and persist it on its own.  The batch
 * record still totals its requests; this is what makes "the check was the
 * expensive half" a measurement instead of an inference.
 */
function recordManagementCall(
  store: IntentStoreV2,
  requestId: string,
  kind: "propose" | "check",
  startedAt: string,
  completedAt: string,
  status: "ok" | "error",
  errorCode: string | undefined,
  usage: CompilerModelV2Usage | undefined,
  failureDiagnostic?: CompilerModelV2FailureDiagnostic,
): void {
  const snapshot = store.current()
  const sequence = snapshot.management_call_sequence + 1
  store.applyDeltas({
    management_calls: [{
      call_id: `call-${sequence}`,
      request_id: requestId,
      kind,
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      status,
      ...(errorCode === undefined ? {} : { error_code: errorCode }),
      ...(failureDiagnostic === undefined ? {} : { failure_diagnostic: failureDiagnostic }),
      ...(usage === undefined ? {} : { usage }),
    }],
    management_call_sequence: sequence,
  })
}

function recordDenial(
  store: IntentStoreV2,
  request: AuthorizeRequest,
  result: { code?: string; message?: string },
): void {
  store.applyDeltas({
    denied_calls: [{
      kind: request.kind,
      at: new Date().toISOString(),
      code: result.code ?? "capability_unsupported",
      message: result.message ?? "the compiler refused this request",
      ...(request.kind === "start"
        ? { dispatch_id: request.dispatch_id }
        : {
            execution_id: request.execution_id,
            host_call_id: request.host_call_id,
            operation_id: request.operation_id,
            ...(request.invocation?.tool === undefined ? {} : { tool: request.invocation.tool }),
            ...(request.invocation?.args_digest === undefined ? {} : { args_digest: request.invocation.args_digest }),
          }),
    }],
  })
}

function startExecution(
  store: IntentStoreV2,
  execution: ExecutionStateManager,
  atoms: AtomStateLedger,
  request: StartRequest,
): AuthorizationResult {
  const dispatch = execution.dispatch(request.dispatch_id)
  if (!dispatch) return deny(request.run_id, "execution_inactive", `unknown dispatch ${request.dispatch_id}`)
  const intent = store.current().compiled[dispatch.task_id]
  if (!intent) return deny(request.run_id, "stale_basis", `dispatch ${request.dispatch_id} has no current compiled intent`)
  // A dispatch is bound to atom *content*, not to a compiled revision: a
  // re-offered dispatch stays usable while its atom content is still part of
  // the current artifact, and is refused as soon as that content changed or
  // disappeared.
  const dispatchedAtom = intent.atoms.find((candidate) => candidate.atom_id === dispatch.atom_id && candidate.revision === dispatch.atom_revision)
  if (dispatchedAtom === undefined || atomRef(dispatchedAtom).digest !== dispatch.digest) {
    return deny(request.run_id, "stale_basis", `dispatch ${request.dispatch_id} no longer matches the current compiled content`)
  }
  const status = atoms.status(dispatch.task_id, dispatchedAtom)
  if (status !== "ready") {
    return deny(request.run_id, "execution_inactive", `atom ${dispatch.atom_id}@${dispatch.atom_revision} is ${status}, not ready to start`)
  }
  const result = execution.authorizeStart(request)
  if (result.ok) {
    atoms.record(dispatch.task_id, dispatchedAtom, intent.compiled_intent_id, "executing")
    const deltas: V2AdvanceDeltas = {
      dispatches: execution.dispatchesSnapshot(),
      executions: execution.list(),
      atom_states: atoms.snapshot(),
      ...(store.current().execution_eligibility === undefined ? {} : { execution_eligibility: {
        task_ids: store.current().execution_eligibility!.task_ids,
        execution_ids: [...store.current().execution_eligibility!.execution_ids, result.execution_id!],
      } }),
    }
    store.applyDeltas(deltas)
  }
  return result
}

function authorizeOperation(
  store: IntentStoreV2,
  execution: ExecutionStateManager,
  capabilities: CapabilitySource | undefined,
  request: OperationRequest,
): AuthorizationResult {
  const snapshot = store.current()
  const intent = snapshot.compiled[execution.getExecution(request.execution_id)?.task_id ?? ""]
  const result = execution.authorizeOperation(request, {
    intent,
    ir: snapshot.ir,
    ...(capabilities === undefined ? {} : { capabilities: { operations: capabilities.operations } }),
    assessments: snapshot.assessments,
  })
  if (result.ok) persistExecutions(store, execution)
  return result
}

function inspect(
  store: IntentStoreV2,
  execution: ExecutionStateManager,
  input: { runId: string },
): RunView {
  const snapshot = store.current()
  return {
    run_id: snapshot.run_id,
    schema_version: 2,
    current_ir: snapshot.ir,
    current_compiled: snapshot.compiled,
    pending_event_ids: snapshot.pending_event_ids,
    unresolved_user_event_ids: snapshot.unresolved_user_event_ids ?? [],
    execution_eligibility: snapshot.execution_eligibility,
    executions: execution.list().map(toExecutionView),
    coverage: snapshot.coverage,
    atom_states: snapshot.atom_states,
    semantic_checks: snapshot.semantic_checks,
    denied_calls: snapshot.denied_calls,
  }
}

export function validateCandidateBasis(candidate: Candidate, events: readonly CompilerEvent[]): { ok: boolean; message?: string } {
  const eventIds = new Set(events.map((event) => event.event_id))
  if (!Array.isArray(candidate.basis.event_ids) || candidate.basis.event_ids.length === 0) {
    const carriesUserInput = events.some((event) => event.kind === "user_input")
    return {
      ok: false,
      message: carriesUserInput
        ? "candidate basis is empty, which claims this batch has nothing to act on, but this batch carries the user delegation: name the pending event in basis.event_ids and compile the delegated work (a create task plus its drafts), not a question"
        : "candidate basis must reference at least one pending event",
    }
  }
  for (const eventId of candidate.basis.event_ids) {
    if (typeof eventId !== "string" || !eventIds.has(eventId)) {
      return { ok: false, message: `candidate basis references unknown event ${String(eventId)}` }
    }
  }
  return { ok: true }
}

function hydrateExecutionManager(snapshot: V2RunSnapshot): ExecutionStateManager {
  const numbers: number[] = []
  for (const dispatch of snapshot.dispatches) numbers.push(numberSuffix(dispatch.dispatch_id))
  for (const execution of snapshot.executions) {
    numbers.push(numberSuffix(execution.execution_id))
    for (const call of execution.allowed_calls) numbers.push(numberSuffix(call.allowed_call_id))
  }
  const sequence = numbers.reduce((max, value) => Math.max(max, value), 0)
  return new ExecutionStateManager(snapshot.dispatches, snapshot.executions, sequence)
}

function persistExecutions(store: IntentStoreV2, execution: ExecutionStateManager): void {
  store.applyDeltas({ dispatches: execution.dispatchesSnapshot(), executions: execution.list() })
}

function validateExecutionReturnIdentity(
  execution: ExecutionStateManager,
  event: CompilerEvent,
): { ok: true } | { ok: false; code: string; message: string } {
  const executionId = event.execution_id as string
  const record = execution.getExecution(executionId)
  if (!record) return { ok: false, code: "execution_inactive", message: `unknown execution ${executionId}` }
  if (record.status !== "active" && record.status !== "closed") {
    return { ok: false, code: "execution_inactive", message: `execution ${executionId} is already ${record.status}` }
  }
  const dispatch = execution.dispatch(record.dispatch_id)
  if (!dispatch) return { ok: false, code: "execution_inactive", message: `execution ${executionId} has no dispatch record` }
  const outcome = (event.payload as ExecutionReturnPayload).outcome
  const expected = `${dispatch.atom_id}@${dispatch.atom_revision}:${dispatch.digest}`
  const actual = `${outcome.atom_ref.id}@${outcome.atom_ref.revision}:${outcome.atom_ref.digest}`
  if (actual !== expected) {
    return { ok: false, code: "identity_conflict", message: `outcome atom_ref ${actual} does not match dispatched atom ${expected}` }
  }
  return { ok: true }
}

function recordExecutionOutcome(
  store: IntentStoreV2,
  execution: ExecutionStateManager,
  atoms: AtomStateLedger,
  event: CompilerEvent,
  payload: ExecutionReturnPayload,
  verifiedArtifacts?: Array<{ path: string; digest: string }>,
  historical = false,
): { record: ExecutionOutcomeRecord; atom_states: AtomStateRecord[] } | undefined {
  const executionId = event.execution_id as string
  const executionRecord = execution.getExecution(executionId)
  if (!executionRecord) return undefined
  const snapshot = store.current()
  const intent = snapshot.compiled[executionRecord.task_id]
  const statusAfter: AtomStatus = payload.state_claim === "completed" ? "completed" : payload.state_claim === "failed" ? "failed" : "ready"
  let before: AtomStatus | "not_found" = "not_found"
  if (intent) {
    const atom = intent.atoms.find((candidate) => (
      candidate.atom_id === payload.outcome.atom_ref.id && candidate.revision === payload.outcome.atom_ref.revision
    ))
    if (atom !== undefined) {
      before = atoms.status(executionRecord.task_id, atom)
      if (!historical) atoms.record(executionRecord.task_id, atom, intent.compiled_intent_id, statusAfter)
    }
  }
  return {
    record: {
      execution_id: executionId,
      state_claim: payload.state_claim,
      outcome: payload.outcome,
      accepted_at: new Date().toISOString(),
      atom_status_before: before,
      atom_status_after: historical || before === "not_found" ? "unchanged" : statusAfter,
      ...(historical ? { historical: true as const } : {}),
      ...(verifiedArtifacts === undefined ? {} : { verified_artifacts: verifiedArtifacts }),
    },
    atom_states: atoms.snapshot(),
  }
}

/**
 * Compare the executor's declared file changes with the digests the host
 * computes.  An artifact that cannot be verified (missing file, outside the
 * workspace, too large for the host's policy) is rejected exactly like a
 * mismatch: a completed claim may not rest on an unverified artifact.
 */
async function verifyDeclaredArtifacts(
  capabilities: CapabilitySource | undefined,
  event: CompilerEvent,
): Promise<{ ok: true; verified: Array<{ path: string; digest: string }> } | { ok: false; code: string; message: string }> {
  const outcome = (event.payload as ExecutionReturnPayload | undefined)?.outcome
  const changes = outcome?.file_changes ?? []
  if (changes.length === 0) return { ok: true, verified: [] }
  const describe = capabilities?.describeArtifacts
  if (describe === undefined) return { ok: true, verified: [] }
  const facts = await describe(changes.map((change) => change.path))
  const verified: Array<{ path: string; digest: string }> = []
  for (const change of changes) {
    const fact = facts.find((candidate) => candidate.path === change.path)
    if (fact?.digest === undefined) {
      return {
        ok: false,
        code: "artifact_unverifiable",
        message: `artifact ${change.path} could not be verified: ${fact?.reason ?? "the host returned no digest"}`,
      }
    }
    if (fact.digest !== change.digest) {
      return {
        ok: false,
        code: "artifact_mismatch",
        message: `artifact ${change.path} digest mismatch: executor declared ${change.digest}, host computed ${fact.digest}`,
      }
    }
    verified.push({ path: change.path, digest: fact.digest })
  }
  return { ok: true, verified }
}

function buildAtomRefs(compiled: Record<string, CompiledIntent>): Record<string, Ref[]> {
  return Object.fromEntries(
    Object.entries(compiled).map(([taskId, intent]) => [taskId, intent.atoms.map((atom) => atomRef(atom))]),
  )
}

function buildExistingObjectDirectory(
  ir: Record<string, TaskIntent>,
  compiled: Record<string, CompiledIntent>,
): ExistingObjectDirectory {
  return {
    tasks: Object.entries(ir).map(([taskId, task]) => {
      const intent = compiled[taskId]
      return {
        task_id: taskId,
        task_revision: task.revision,
        task_digest: digestOf(task),
        summary: summarizeObject(`${task.goal.text} Current scope (${task.current_scope.disposition}): ${task.current_scope.text}`, 320),
        ...(intent === undefined ? {} : { compiled_intent_ref: compiledIntentRef(intent) }),
        atoms: (intent?.atoms ?? []).map((atom) => ({
          ref: atomRef(atom),
          summary: summarizeObject(atom.task, 240),
        })),
      }
    }),
  }
}

function summarizeObject(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

/**
 * Host facts for this batch: the operations the executor can be granted, the
 * workspace root, and whether each path the batch names exists and is
 * readable.  The model cannot derive any of these, and mistaking "I cannot
 * see its content" for "the material is missing" was a real self-block.
 */
function describeCapabilities(source: CapabilitySource | undefined, events: readonly CompilerEvent[]): CapabilityCatalog {
  const operations = [...(source?.operations ?? [])]
  const paths = collectNamedPaths(events)
  const material = source?.describeMaterial === undefined ? [] : source.describeMaterial(paths)
  return {
    operations,
    ...(source?.workspace_root === undefined ? {} : { workspace_root: source.workspace_root }),
    material,
  }
}

const NAMED_PATH_PATTERN = /(?:^|[\s"'`(])(\/[A-Za-z0-9._\-/]*[A-Za-z0-9._-])/gu
const MAX_NAMED_PATHS = 8

function collectNamedPaths(events: readonly CompilerEvent[]): string[] {
  const paths: string[] = []
  for (const event of events) {
    if (event.kind !== "user_input") continue
    const text = isRecord(event.payload) && typeof event.payload.text === "string" ? event.payload.text : ""
    for (const match of text.matchAll(NAMED_PATH_PATTERN)) {
      const path = match[1] as string
      if (!paths.includes(path)) paths.push(path)
      if (paths.length >= MAX_NAMED_PATHS) return paths
    }
  }
  return paths
}

/**
 * Independent check of one candidate: it reads the original input, the
 * candidate, and the current IR, and may only report inconsistencies.  A
 * When configured and applicable, a failed or unavailable check prevents
 * acceptance; a run without a checker does not reserve a phantom call.
 */
function semanticCheckTaskIds(candidate: Candidate, events: readonly CompilerEvent[]): string[] {
  return events.some(event => event.kind === "user_input")
    ? [...new Set(candidate.groups.flatMap(group => group.task_refs))] : compiledTasks(candidate)
}

async function runSemanticCheck(
  model: CompilerModelV2,
  candidate: Candidate,
  input: {
    run_id: string
    events: readonly CompilerEvent[]
    source_events?: readonly CompilerEvent[]
    ir: Record<string, TaskIntent>
    compiled: Record<string, CompiledIntent>
    capabilities: CapabilityCatalog
    prepared?: import("../model/compiler-model-v2.js").CompilerModelV2CheckInput["prepared"]
    sequence: number
    budget: { requests_used: number; max_requests: number }
    /** Timing hook so the caller can record this check as its own call. */
    recordCall: (startedAt: string, status: "ok" | "error", errorCode: string | undefined, usage: CompilerModelV2Usage | undefined, text: string | undefined, failureDiagnostic?: CompilerModelV2FailureDiagnostic) => void
  },
): Promise<{
  record: SemanticCheckRecord
  issues: string[]
  usage?: NonNullable<SemanticCheckRecord["usage"]>
  /**
   * Present when the check never reached a verdict.  `transport` means the
   * answer did not arrive (worth one more sample); `deterministic` means it
   * arrived but did not fit the contract we sent (re-sampling repeats it).
   */
  failure?: { kind: "transport" | "deterministic"; message: string }
} | undefined> {
  if (model.verify === undefined) return undefined
  const taskIds = semanticCheckTaskIds(candidate, input.events)
  if (taskIds.length === 0) return undefined
  const basisEventIds = input.events.map((event) => event.event_id)
  const preparedForCheck = input.prepared === undefined ? undefined : {
    ir: input.prepared.ir,
    compiled: input.prepared.compiled,
    atom_states: input.prepared.atom_states,
    dispatchable_atoms: input.prepared.dispatchable_atoms,
    eligible_task_ids: input.prepared.eligible_task_ids,
    eligible_execution_ids: input.prepared.eligible_execution_ids,
  }
  let result: CompilerModelV2CheckResult
  const startedAt = new Date().toISOString()
  try {
    result = await model.verify(structuredClone({
      run_id: input.run_id,
      events: input.events,
      source_events: input.source_events ?? [],
      event_source_refs: eventSourceRefs([...(input.source_events ?? []), ...input.events]),
      ir: input.ir,
      compiled: input.compiled,
      capabilities: input.capabilities,
      candidate: structuredClone(candidate),
      ...(preparedForCheck === undefined ? {} : { prepared: structuredClone(preparedForCheck) }),
      budget: input.budget,
      contract: V2_CHECK_CONTRACT,
    }))
  } catch (error) {
    const message = `independent check failed: ${errorMessage(error)}`
    input.recordCall(startedAt, "error", "transport", undefined, undefined, { phase: "check_transport", exception_chain: exceptionChain(error) })
    return {
      record: {
        basis_event_ids: basisEventIds,
        sequence: input.sequence,
        verdict: "unavailable",
        findings: [{ claim: "independent check could not be completed", expected: "a completed check", observed: message, refs: [] }],
        task_ids: taskIds,
      },
      issues: [],
      failure: { kind: "transport", message },
    }
  }
  const verdict = result.verdict
  if (verdict === undefined) {
    const message = `independent check returned no verdict: ${result.error?.message ?? "unknown error"}`
    const failedUsage = result.call?.usage ?? result.error?.diagnostic?.opencode_response?.usage
    input.recordCall(startedAt, "error", result.error?.code ?? "schema", failedUsage, result.call?.text, result.error?.diagnostic)
    // A quoted answer that did not fit the contract is deterministic for the
    // strict-decoding transports this project uses; a missing answer is not.
    const kind = result.error?.code === "transport" || result.error?.code === "json" ? "transport" : "deterministic"
    return {
      record: {
        basis_event_ids: basisEventIds,
        sequence: input.sequence,
        verdict: "unavailable",
        findings: [{ claim: "independent check returned no verdict", expected: "consistent or inconsistent", observed: message, refs: [] }],
        task_ids: taskIds,
        ...(failedUsage === undefined ? {} : { usage: failedUsage }),
      },
      issues: [],
      ...(failedUsage === undefined ? {} : { usage: failedUsage }),
      failure: { kind, message },
    }
  }
  input.recordCall(startedAt, "ok", undefined, result.call?.usage, result.call?.text)
  // The checker may cite either prior facts or exact newly prepared IR entries.
  // Resolve both versions separately: overlaying records would lose the prior revision.
  const sources = [...(input.source_events ?? []), ...input.events]
  const priorFindings = resolveCheckEvidence(verdict.findings, sources, input.ir, input.compiled)
  const preparedFindings = input.prepared === undefined ? priorFindings
    : resolveCheckEvidence(verdict.findings, sources, input.prepared.ir, input.prepared.compiled)
  const findings = priorFindings.map((finding, index) => ({
    ...finding, evidence_resolved: finding.evidence_resolved || preparedFindings[index]!.evidence_resolved,
  }))
  const blocking = findings.filter((finding) => finding.evidence_resolved === true)
  return {
    record: {
      basis_event_ids: basisEventIds,
      sequence: input.sequence,
      verdict: verdict.verdict,
      findings,
      task_ids: taskIds,
      ...(result.call?.provider === undefined ? {} : { provider: result.call.provider }),
      ...(result.call?.model === undefined ? {} : { model: result.call.model }),
      ...(result.call?.text === undefined ? {} : { response_digest: digestText(result.call.text) }),
      ...(result.call?.usage === undefined ? {} : { usage: result.call.usage }),
    },
    // Only a finding whose evidence resolves is a reason to revise; the rest are
    // kept in the record and audited by their count, not obeyed.
    issues: blocking.map((finding) => `independent check${finding.dimension === undefined ? "" : ` ${finding.dimension}`}: ${finding.claim} — expected ${finding.expected}, observed ${finding.observed}`),
    ...(result.call?.usage === undefined ? {} : { usage: result.call.usage }),
  }
}

/** Tasks this candidate compiles at least one new atom for. */
function compiledTasks(candidate: Candidate): string[] {
  const taskIds: string[] = []
  for (const group of candidate.groups) {
    if (group.compilation.decision !== "replace") continue
    for (const draft of group.compilation.drafts) {
      if (draft.atoms.length === 0) continue
      if (!taskIds.includes(draft.task_id)) taskIds.push(draft.task_id)
    }
  }
  return taskIds
}

/**
 * Token accounting for one batch: the proposing call plus every independent
 * check that ran.  A call whose usage the provider did not report makes the
 * batch total unavailable rather than silently understating the cost.
 */
function budgetDeltas(
  proposeUsage: CompilerModelV2Usage | undefined,
  checkUsage: ReadonlyArray<CompilerModelV2Usage | undefined>,
): Partial<Pick<V2AdvanceDeltas, "management_input_tokens" | "management_output_tokens" | "management_reasoning_tokens" | "management_cache_read_tokens" | "management_cache_write_tokens" | "management_cost">> {
  const usages = [proposeUsage, ...checkUsage]
  if (usages.every((usage) => usage === undefined)) return {}
  if (usages.some((usage) => usage === undefined)) return {}
  const present = usages as CompilerModelV2Usage[]
  const sum = (pick: (usage: CompilerModelV2Usage) => number | undefined): number | undefined => {
    const values = present.map(pick)
    if (values.some((value) => value === undefined)) return undefined
    return values.reduce<number>((total, value) => total + (value as number), 0)
  }
  const input = sum((usage) => usage.input_tokens)
  const output = sum((usage) => usage.output_tokens)
  const reasoning = sum((usage) => usage.reasoning_tokens)
  const cacheRead = sum((usage) => usage.cache_read_tokens)
  const cacheWrite = sum((usage) => usage.cache_write_tokens)
  const cost = sum((usage) => usage.cost)
  return {
    ...(input === undefined ? {} : { management_input_tokens: input }),
    ...(output === undefined ? {} : { management_output_tokens: output }),
    ...(reasoning === undefined ? {} : { management_reasoning_tokens: reasoning }),
    ...(cacheRead === undefined ? {} : { management_cache_read_tokens: cacheRead }),
    ...(cacheWrite === undefined ? {} : { management_cache_write_tokens: cacheWrite }),
    ...(cost === undefined ? {} : { management_cost: cost }),
  }
}

function revisionMap(compiled: V2RunSnapshot["compiled"]): Record<string, number> {
  return Object.fromEntries(Object.entries(compiled).map(([id, intent]) => [id, intent.compiled_revision]))
}

function irRevisionMap(ir: V2RunSnapshot["ir"]): Record<string, number> {
  return Object.fromEntries(Object.entries(ir).map(([id, task]) => [id, task.revision]))
}

function toExecutionView(execution: ReturnType<ExecutionStateManager["list"]>[number]): RunView["executions"][number] {
  return {
    execution_id: execution.execution_id,
    dispatch_id: execution.dispatch_id,
    task_id: execution.task_id,
    atom_id: execution.atom_id,
    status: execution.status,
    ...(execution.host_identity === undefined ? {} : { host_identity: execution.host_identity }),
    ...(execution.closed_reason === undefined ? {} : { closed_reason: execution.closed_reason }),
  }
}

interface ManagementRecordInput {
  sequence: number
  startedAt: string
  completedAt: string
  triggerEventIds: string[]
  request: CompilerModelV2Input
  requestDigest: string
  preparedDigest?: string
  readBasisDigest?: string
  call?: CompilerModelV2Result["call"]
  candidate?: Candidate
  sourceRefs?: SourceRefStats
  /** Every call this batch made, in order, with the issues each attempt raised. */
  attempts?: ManagementAttemptRecord[]
  /** Shape changes this batch made to derived IR declarations (recorded, not rejected). */
  declarationChanges?: DeclarationChangeRecord[]
  status: ManagementRequestRecord["status"]
  errorCode?: string
  errorMessage?: string
  ir: Record<string, TaskIntent>
  compiled: Record<string, CompiledIntent>
  retry?: boolean
}

function managementRecord(input: ManagementRecordInput): ManagementRequestRecord {
  const durationMs = Math.max(0, Date.parse(input.completedAt) - Date.parse(input.startedAt))
  return {
    request_id: `mgmt-${input.sequence}`,
    sequence: input.sequence,
    trigger_event_ids: input.triggerEventIds,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    duration_ms: durationMs,
    request: input.request,
    request_digest: input.requestDigest,
    ...(input.preparedDigest === undefined ? {} : { prepared_digest: input.preparedDigest }),
    ...(input.readBasisDigest === undefined ? {} : { read_basis_digest: input.readBasisDigest }),
    ...(input.attempts === undefined || input.attempts.length === 0 ? {} : { attempts: input.attempts }),
    ...(input.declarationChanges === undefined || input.declarationChanges.length === 0
      ? {}
      : { declaration_changes: input.declarationChanges }),
    ...(input.call?.text === undefined ? {} : { raw_response: input.call.text, raw_response_digest: digestText(input.call.text) }),
    ...(input.call?.text_source === undefined ? {} : { response_text_source: input.call.text_source }),
    ...(input.candidate === undefined ? {} : { candidate: input.candidate, candidate_digest: digestOf(input.candidate) }),
    ...(input.sourceRefs === undefined ? {} : { source_refs: input.sourceRefs }),
    ...(input.call?.provider === undefined ? {} : { provider: input.call.provider }),
    ...(input.call?.model === undefined ? {} : { model: input.call.model }),
    ...(input.call?.agent === undefined ? {} : { agent: input.call.agent }),
    ...(input.call?.usage === undefined ? {} : { usage: input.call.usage }),
    status: input.status,
    ...(input.errorCode === undefined ? {} : { error_code: input.errorCode }),
    ...(input.errorMessage === undefined ? {} : { error_message: input.errorMessage }),
    retry: input.retry ?? false,
    ir_revisions: irRevisionMap(input.ir),
    compiled_revisions: revisionMap(input.compiled),
  }
}

/** Per-attempt answer text is kept whole up to this many characters. */
const ATTEMPT_TEXT_LIMIT = 200_000

/** At most this many unresolved references are listed per batch. */
const MAX_UNRESOLVED_REFS = 20

/** Bound one management answer so a runaway response cannot bloat the store. */
function boundedAttemptText(text: string | undefined): Pick<ManagementAttemptRecord, "text" | "text_truncated"> {
  if (typeof text !== "string" || text.length === 0) return {}
  if (text.length <= ATTEMPT_TEXT_LIMIT) return { text }
  return { text: text.slice(0, ATTEMPT_TEXT_LIMIT), text_truncated: true }
}

function statusForModelError(code: "transport" | "json" | "schema" | undefined): ManagementRequestRecord["status"] {
  if (code === "transport") return "transport_failed"
  if (code === "json") return "json_failed"
  return "schema_failed"
}

function collectAssessments(candidate: Candidate, eventIds: string[], sequence: number): AssessmentRecord[] {
  return candidate.groups.flatMap((group) => group.assessments.map((assessment) => ({
    ...assessment,
    basis_event_ids: eventIds,
    sequence,
    ...(group.task_refs[0] === undefined ? {} : { task_id: group.task_refs[0] }),
  })))
}

function collectChecks(candidate: Candidate, eventIds: string[], sequence: number): CheckRecord[] {
  return candidate.groups.flatMap((group) => group.checks.map((check) => ({
    ...check,
    basis_event_ids: eventIds,
    sequence,
    ...(group.task_refs[0] === undefined ? {} : { task_id: group.task_refs[0] }),
  })))
}

function collectQuestions(candidate: Candidate, eventIds: string[], sequence: number): QuestionRecord[] {
  return candidate.groups.flatMap((group) => group.questions.map((question) => ({
    ...question,
    basis_event_ids: eventIds,
    sequence,
    ...(group.task_refs[0] === undefined ? {} : { task_id: group.task_refs[0] }),
  })))
}

function collectCoverage(candidate: Candidate, eventIds: string[], sequence: number): CoverageRecord[] {
  return candidate.groups.flatMap((group) => group.coverage.map((entry) => ({
    ...entry,
    basis_event_ids: eventIds,
    sequence,
    ...(group.task_refs[0] === undefined ? {} : { task_id: group.task_refs[0] }),
  })))
}

/**
 * Deterministic acceptance reasons for a well-formed candidate.  Schema
 * validation already guarantees the shapes; these are the record-level
 * requirements a candidate must satisfy before it is committed.  Reasons are
 * returned to the management model as `validation_errors` so it can revise
 * within the same batch budget.
 */
export function proposalIssues(
  proposal: CompilerModelV2Result,
  events: readonly CompilerEvent[],
  ir: Record<string, TaskIntent>,
  compiled: Record<string, CompiledIntent>,
  buildOptions: BuildCompiledIntentOptions,
  strictRequirements = false,
): string[] {
  if (!proposal.ok || !proposal.candidate) return proposal.schema_errors ?? []
  return candidateIssues(proposal.candidate, events, ir, compiled, buildOptions, strictRequirements)
}

/**
 * A management call that produced no candidate because the connection failed
 * or the provider timed out is worth one bounded re-send: these calls are
 * read-only, so a retry cannot repeat an external effect.  Deterministic
 * provider rejections (unsupported response_format, 4xx request errors) are
 * not re-sent, and every attempt counts against the same per-batch budget.
 */
function isRetryableTransportFailure(proposal: CompilerModelV2Result): boolean {
  if (proposal.ok || proposal.candidate !== undefined) return false
  const code = proposal.error?.code
  if (code !== "transport" && code !== "json") return false
  return !/response_format|not supported|unavailable|HTTP (400|401|403|404|422)\b/iu.test(proposal.error?.message ?? "")
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const TRANSPORT_RETRY_BACKOFF_MS = 3000

/**
 * A candidate must be grounded in the batch it answers: its basis has to name
 * at least one pending event (an empty basis is the shape we see when the
 * model decides to do nothing), and a batch that carries user input must
 * account for that delegation instead of returning an empty group.  Both are
 * returned as revision reasons rather than a silent stop, so the model can fix
 * them inside the batch budget.
 *
 * Compiled work must declare where the task's goal goes: a group that
 * replaces a task's compiled content with atoms has to record a coverage
 * entry for that work, naming the task or one of the atoms that carries it.
 * Without this, an atom that only prepares later work can be accepted as
 * though it were the deliverable, and nothing in the store shows the gap.
 */
export function candidateIssues(
  candidate: Candidate,
  events: readonly CompilerEvent[],
  ir: Record<string, TaskIntent>,
  compiled: Record<string, CompiledIntent>,
  buildOptions: BuildCompiledIntentOptions,
  strictRequirements = false,
): string[] {
  const issues: string[] = []
  const eventIds = events.map((event) => event.event_id)
  const carriesUserInput = events.some((event) => event.kind === "user_input")
  const basisCheck = validateCandidateBasis(candidate, events)
  if (!basisCheck.ok) {
    issues.push(`${basisCheck.message ?? "candidate basis is invalid"}; pending event ids for this batch: ${eventIds.join(", ")}`)
  }
  if (carriesUserInput && !candidate.groups.some((group) => group.task_refs.length > 0)) {
    issues.push(
      "this batch carries user input but no group names a task, so the delegation is unrecorded: create or revise the task and compile its work with coverage, or ask a specific question with questions[] and say why nothing can be compiled yet",
    )
  }
  // Dry-run the IR changes against the current IR so that an unapplicable
  // group (a task create named differently from task_refs, an unknown task,
  // a stale expected_revision) is reported as a revision reason instead of
  // aborting the batch after the model's budget is spent.
  const dryRun = new IntentStateManager(ir)
  let dryCompiled: Record<string, CompiledIntent> = compiled
  candidate.groups.forEach((group, index) => {
    if (group.task_refs.length === 0) return
    if (group.ir_changes.some((change) => change.action !== "preserve")) {
      const applied = dryRun.apply(group.ir_changes, group.task_refs)
      if (!applied.ok) {
        for (const error of applied.errors) {
          issues.push(`groups[${index}]${error.path === undefined ? "" : `.${error.path}`}: ${error.message}${applicationHint(error.message)}`)
        }
      }
    }
    const known = dryRun.snapshot()
    for (const taskId of group.task_refs) {
      if (known[taskId] === undefined) {
        issues.push(
          `groups[${index}].task_refs names unknown task ${taskId}: a create task's local_ref is the task_id, so task_refs, the draft, coverage and its binding/output/content creates must all use that same id (existing tasks: ${Object.keys(known).join(", ") || "none"})`,
        )
      }
    }
    // A delegation counts as recorded when the batch routes it somewhere the
    // machine can see: an IR change for the task, a coverage entry, or a
    // question.  A group that only says "reuse" and writes nothing is the
    // stall this check exists for.
    let destinationRecorded = group.coverage.length > 0
      || group.questions.length > 0
      || group.ir_changes.some((change) => change.action !== "preserve")
    let coverageGateFired = false
    if (group.compilation.decision === "replace") {
      for (const draft of group.compilation.drafts) {
        if (known[draft.task_id] === undefined) {
          issues.push(
            `groups[${index}].compilation.drafts names unknown task ${draft.task_id}: draft.task_id must be one of this group's task_refs (${group.task_refs.join(", ")})`,
          )
        }
      }
      const dryResult = dryBuild(dryCompiled, group.compilation.drafts, buildOptions)
      if (dryResult.errors.length > 0) {
        issues.push(...dryResult.errors.map((error) => `groups[${index}].compilation.drafts: ${error}`))
      } else {
        dryCompiled = dryResult.compiled
      }
      // Deliverables and materials an atom declares are registered in the
      // task's IR, so every id an atom references resolves afterwards;
      // restating an existing registry entry differently is a revision reason.
      const groupTaskId = group.task_refs[0] as string | undefined
      if (groupTaskId !== undefined && known[groupTaskId] !== undefined) {
        const registration = registrationChanges(groupTaskId, group.compilation.drafts, known[groupTaskId], eventSourceRefs(events))
        issues.push(...registration.issues.map((issue) => `groups[${index}].compilation: ${issue}`))
        if (registration.changes.length > 0) {
          const appliedRegistration = dryRun.apply(registration.changes, [groupTaskId])
          if (!appliedRegistration.ok) {
            issues.push(...appliedRegistration.errors.map((error) => `groups[${index}].compilation: ${error.message}`))
          }
        }
      }
      const drafts = group.compilation.drafts.filter((draft) => draft.atoms.length > 0)
      // Atom state is keyed by (task_id, atom_id, revision), so a proposal that
      // reuses an id and revision with different content would inherit the old
      // atom's lifecycle.  Content changes must come with a revision bump.
      for (const draft of drafts) {
        const currentIntent = compiled[draft.task_id]
        for (const atom of draft.atoms) {
          const prior = currentIntent?.atoms.find((candidate) => candidate.atom_id === atom.atom_id && candidate.revision === atom.revision)
          if (!strictRequirements && prior !== undefined && atomRef(prior).digest !== atomRef(atom).digest) {
            issues.push(
              `groups[${index}].compilation.drafts: atom ${atom.atom_id}@${atom.revision} already exists with different content; raise its revision so the new content gets its own lifecycle record`,
            )
          }
        }
      }
      const declared = new Set<string>()
      for (const entry of group.coverage) {
        for (const candidateRef of [entry.requirement, ...entry.refs]) {
          if (isRef(candidateRef)) declared.add(candidateRef.id)
          else if (isRecord(candidateRef) && typeof candidateRef.local_ref === "string") declared.add(candidateRef.local_ref)
        }
      }
      for (const draft of drafts) {
        const carrier = draft.atoms.find((atom) => declared.has(atom.atom_id))
        if (declared.has(draft.task_id) || carrier !== undefined) {
          destinationRecorded = true
          continue
        }
        coverageGateFired = true
        const carriers = draft.atoms.map((atom) => atom.atom_id).join(", ")
        issues.push(
          `groups[${index}].coverage must record where the compiled work for task ${draft.task_id} goes: add an entry whose requirement or refs names ${draft.task_id} or one of its atoms (${carriers}), with disposition assigned, supported, paused, or unresolved`,
        )
      }
    }
    // A user delegation must end this batch with a recorded destination:
    // compiled work that coverage points at, a coverage entry saying where the
    // goal stands, or a question.  Otherwise the run stalls with nothing to
    // show and the executor is never asked to do anything.
    if (carriesUserInput && !destinationRecorded && !coverageGateFired) {
      issues.push(
        `groups[${index}] carries user input for ${group.task_refs.join(", ")} but records no destination: compile the work with coverage, or add a coverage entry with disposition paused or unresolved, or ask a question in questions[]`,
      )
    }
  })
  return issues
}

function dryBuild(
  compiled: Record<string, CompiledIntent>,
  drafts: CompiledIntentDraft[],
  build: BuildCompiledIntentOptions,
): { compiled: Record<string, CompiledIntent>; errors: string[] } {
  try {
    const result = buildCompiledIntents(compiled, drafts, build)
    if (!result.ok) return { compiled, errors: result.errors }
    return { compiled: { ...compiled, ...result.intents }, errors: [] }
  } catch (error) {
    return { compiled, errors: [errorMessage(error)] }
  }
}

/**
 * Derive the task IR's deliverable and material entries from what a draft's
 * atoms declare.  The atom is the single place a shape is declared; the IR
 * entry is bookkeeping derived from it:
 *
 * - a new id is registered with the atom's own declaration, so every id an
 *   atom references resolves afterwards;
 * - a differing shape for an existing id is NOT a rejection: the entry follows
 *   the atom and the change is recorded (2026-09-24 decision — the independent
 *   check judges whether the delegation allows it, under D2, with the
 *   delegation text as evidence);
 * - one exception stays: an atom may not invent the material for a binding the
 *   IR records as missing (an undefined `ref`), because missing material is a
 *   delegation fact, not a compilation detail;
 * - two atoms in the same batch declaring one id differently stays a
 *   rejection: one deliverable cannot be two shapes at once.
 */
export function registrationChanges(
  taskId: string,
  drafts: readonly CompiledIntentDraft[],
  task: TaskIntent | undefined,
  sources: SourceRef[],
): { changes: IrChange[]; issues: string[]; declarationChanges: DeclarationChangeRecord[] } {
  const changes: IrChange[] = []
  const issues: string[] = []
  const declarationChanges: DeclarationChangeRecord[] = []
  const declaredOutputs = new Map<string, { description: string; format: string }>()
  const declaredBindings = new Map<string, { ref: Ref | SourceRef; role: string }>()

  for (const draft of drafts) {
    for (const atom of draft.atoms) {
      for (const output of atom.outputs) {
        const seen = declaredOutputs.get(output.output_id)
        if (seen !== undefined) {
          // Format is the substantive part of a declaration: one deliverable
          // cannot be an artifact for one atom and text for another. The
          // description is prose, and two wordings of the same deliverable are
          // not a contradiction — requiring byte-equal prose cost a whole batch
          // in r11d, whose rejection was two paraphrases of the binary.
          if (seen.format !== output.format) {
            issues.push(`atom ${atom.atom_id} declares output ${output.output_id} as format ${output.format} while another atom in the same batch declares it as ${seen.format}; one deliverable has one format`)
          }
          continue
        }
        declaredOutputs.set(output.output_id, { description: output.description, format: output.format })
        const existing = task?.outputs.find((candidate) => candidate.output_id === output.output_id)
        if (existing === undefined) {
          changes.push({
            action: "create",
            target: "output",
            local_ref: output.output_id,
            value: { description: output.description, format: output.format },
            sources,
          })
          continue
        }
        if (existing.format !== output.format) {
          declarationChanges.push({ target: "output", id: output.output_id, from: existing.format, to: output.format })
          changes.push({
            action: "revise",
            target: "output",
            id: output.output_id,
            expected_revision: existing.revision,
            value: { description: output.description, format: output.format },
            sources,
          })
        }
      }
      for (const input of atom.inputs) {
        const seen = declaredBindings.get(input.binding_id)
        if (seen !== undefined) {
          if (refKey(seen.ref) !== refKey(input.ref) || seen.role !== input.role) {
            issues.push(`atom ${atom.atom_id} declares binding ${input.binding_id} differently from another atom in the same batch; one material binding has one declaration`)
          }
          continue
        }
        declaredBindings.set(input.binding_id, { ref: input.ref, role: input.role })
        const existing = task?.bindings.find((candidate) => candidate.binding_id === input.binding_id)
        if (existing === undefined) {
          changes.push({
            action: "create",
            target: "binding",
            local_ref: input.binding_id,
            value: { ref: input.ref, role: input.role, purpose: input.use },
            sources,
          })
          continue
        }
        if (existing.ref === undefined) {
          // The IR records this material as missing (never bound).  An atom
          // cannot supply it: that would answer a delegation question with a
          // compilation guess.
          issues.push(
            `atom ${atom.atom_id} binds ${input.binding_id}, which the task records as missing material; the delegation has to supply it before an atom can use it`,
          )
          continue
        }
        if (refKey(existing.ref) !== refKey(input.ref) || existing.role !== input.role) {
          declarationChanges.push({
            target: "binding",
            id: input.binding_id,
            from: `${existing.role} ${refKey(existing.ref)}`,
            to: `${input.role} ${refKey(input.ref)}`,
          })
          changes.push({
            action: "revise",
            target: "binding",
            id: input.binding_id,
            expected_revision: existing.revision,
            value: { ref: input.ref, role: input.role, purpose: input.use },
            sources,
          })
        }
      }
    }
    if (draft.task_id !== taskId) {
      issues.push(`draft ${draft.local_ref} names task ${draft.task_id} while this group's first task_ref is ${taskId}; binding registration follows the group's task`)
    }
  }
  return { changes, issues, declarationChanges }
}

/** Source reference for a triggering event: id plus the digest of its text. */
function eventSourceRefs(events: readonly CompilerEvent[]): SourceRef[] {
  return events.map((event) => {
    const payload = isRecord(event.payload) ? event.payload : {}
    const text = typeof payload.text === "string" ? payload.text : canonicalJson(event.payload ?? null)
    return { source_id: event.event_id, digest: digestText(text) }
  })
}

/** What happened to the source references a candidate claimed, counted per batch. */
export interface SourceRefStats {
  total: number
  resolved: number
  normalized: number
  unresolved: number
  /**
   * The references that named no source in this batch (or spanned past the end
   * of one).  Bounded, so a candidate that cites garbage everywhere cannot
   * bloat the record; the counts above stay exact.
   */
  unresolvedRefs: Array<{ source_id: string; span?: { unit: string; start: number; end: number } }>
}

/**
 * A finding blocks a batch only when its evidence resolves.  The checker is a
 * model too: it can copy a source id but cannot compute a digest, and it can
 * cite an id that this input never contained.  Findings that resolve keep their
 * verdict power; the rest are recorded with `evidence_resolved: false` and set
 * aside, so an objection that cites nothing cannot cost a whole batch — r10
 * spent two of them, and the second batch never learned why the first failed.
 */
export function resolveCheckEvidence(
  findings: ReadonlyArray<SemanticCheckFinding>,
  events: readonly CompilerEvent[],
  ir: Record<string, TaskIntent>,
  compiled: Record<string, CompiledIntent>,
): SemanticCheckFinding[] {
  const textBySource = new Map<string, string>()
  for (const event of events) {
    const payload = isRecord(event.payload) ? event.payload : {}
    textBySource.set(event.event_id, typeof payload.text === "string" ? payload.text : canonicalJson(event.payload ?? null))
  }
  const atomIds = new Set<string>()
  for (const intent of Object.values(compiled)) {
    for (const atom of intent.atoms) atomIds.add(atom.atom_id)
  }
  return findings.map((finding) => {
    let resolved = false
    const refs = finding.refs.map((ref) => {
      if (isRef(ref)) {
        const task = ir[ref.id]
        if (task !== undefined && task.revision === ref.revision) resolved = true
        if (Object.values(ir).some(candidate => candidate.content.some(item =>
          item.item_id === ref.id && item.revision === ref.revision && digestOf(item) === ref.digest,
        ))) resolved = true
        if (atomIds.has(ref.id)) resolved = true
        return ref
      }
      const text = textBySource.get(ref.source_id)
      if (text === undefined) return ref
      const end = ref.span?.end
      if (end !== undefined && end > text.length) return ref
      resolved = true
      return { ...ref, digest: digestText(text) }
    })
    return { ...finding, refs, evidence_resolved: resolved }
  })
}

/**
 * Source references are code-owned where the model cannot be: a model can copy
 * a source id out of the batch it was given, but it cannot compute a sha256, so
 * whatever digest it writes is a guess — in practice a literal placeholder.  The
 * mechanical layer writes the digest of the referenced text back into the
 * candidate instead, and reports only what the model is answerable for: naming a
 * source that is in this batch, and staying inside that source's text.
 *
 * Without this, an unresolvable or placeholder digest is recorded as a valid
 * reference (the r10 store has both shapes), and every later question — "the
 * check cited which span of which source?" — is asked of data that cannot
 * answer it.
 */
export function resolveSourceRefs(
  candidate: Candidate,
  events: readonly CompilerEvent[],
): SourceRefStats {
  const textBySource = new Map<string, string>()
  for (const event of events) {
    const payload = isRecord(event.payload) ? event.payload : {}
    textBySource.set(event.event_id, typeof payload.text === "string" ? payload.text : canonicalJson(event.payload ?? null))
  }
  const stats: SourceRefStats = { total: 0, resolved: 0, normalized: 0, unresolved: 0, unresolvedRefs: [] }
  const segments = new Map(sourceSegments(events).map(segment => [`${segment.source_id}\0${segment.segment_id}`, segment]))
  /** Keep the audit's list bounded; the counters above stay exact. */
  const noteUnresolved = (value: Record<string, unknown>, span: Record<string, unknown> | undefined): void => {
    if (stats.unresolvedRefs.length >= MAX_UNRESOLVED_REFS) return
    const unit = typeof span?.unit === "string" ? span.unit : "utf16"
    const start = typeof span?.start === "number" ? span.start : 0
    const end = typeof span?.end === "number" ? span.end : 0
    stats.unresolvedRefs.push({ source_id: String(value.source_id), span: { unit, start, end } })
  }
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry)
      return
    }
    if (!isRecord(value)) return
    if (typeof value.source_id === "string" && typeof value.digest === "string") {
      stats.total += 1
      const text = textBySource.get(value.source_id)
      if (text === undefined) {
        // A source the batch does not contain: counted, left as the model wrote
        // it, so the record shows the defect instead of hiding it.
        stats.unresolved += 1
        noteUnresolved(value, isRecord(value.span) ? value.span : undefined)
      } else {
        if (typeof value.segment_id === "string") {
          const segment = segments.get(`${value.source_id}\0${value.segment_id}`)
          if (!segment || value.quote !== undefined) {
            stats.unresolved += 1
            noteUnresolved(value, undefined)
            return
          }
          value.span = { ...segment.span }
          delete value.segment_id
        }
        if (typeof value.quote === "string") {
          const start = text.indexOf(value.quote)
          const repeated = start >= 0 && text.indexOf(value.quote, start + 1) >= 0
          if (value.quote.length === 0 || start < 0 || repeated) {
            // A plausible model-written span must not rescue a missing or
            // ambiguous quote. The whole candidate fails the source gate.
            delete value.span
            stats.unresolved += 1
            noteUnresolved(value, undefined)
            return
          }
          value.span = { unit: "utf16", start, end: start + value.quote.length }
          delete value.quote
        }
        const span = isRecord(value.span) ? value.span : undefined
        if (span !== undefined && (span.unit !== "utf16" || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > text.length)) {
          stats.unresolved += 1
          noteUnresolved(value, span)
        } else {
          const expected = digestText(text)
          if (value.digest !== expected) stats.normalized += 1
          value.digest = expected
          stats.resolved += 1
        }
      }
    }
    for (const key of Object.keys(value)) visit(value[key])
  }
  visit(candidate)
  return stats
}

function applicationHint(message: string): string {
  if (/unknown task/u.test(message)) {
    return " (a create for binding, output, or content applies to the group's first task_ref; emit the create for that task in the same group, and use the same id everywhere)"
  }
  if (/already exists/u.test(message)) {
    return " (revise the existing task instead of creating it again, or use a new unique local_ref)"
  }
  if (/expected_revision/u.test(message)) {
    return " (use the revision currently recorded in the supplied IR)"
  }
  return ""
}

/**
 * A failed advance.  `retryable` tells the host whether spending another round
 * on the same pending events is worth it: only transport-level failures are,
 * because a re-roll of a semantic or mechanical rejection repeats itself.
 */
function failure(runId: string, code: string, message: string, retryable = false): AdvanceResult {
  return {
    ok: false,
    run_id: runId,
    disposition: "failed",
    pending_events: [],
    compiled_revisions: {},
    ir_revisions: {},
    retryable,
    code,
    message,
  }
}

function deny(runId: string, code: string, message: string): AuthorizationResult {
  return { ok: false, run_id: runId, code, message }
}

function numberSuffix(id: string): number {
  const match = /(\d+)$/u.exec(id)
  return match ? Number.parseInt(match[1] as string, 10) : 0
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function exceptionChain(error: unknown): NonNullable<CompilerModelV2FailureDiagnostic["exception_chain"]> {
  const chain: NonNullable<CompilerModelV2FailureDiagnostic["exception_chain"]> = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== undefined && current !== null && !seen.has(current) && chain.length < 8) {
    seen.add(current)
    if (current instanceof Error) {
      chain.push({ name: current.name || "Error", message: current.message.replace(/(Bearer\s+)[^\s"']+/giu, "$1[redacted]") })
      current = current.cause
    } else {
      chain.push({ name: typeof current, message: String(current) })
      current = typeof current === "object" && "cause" in current ? (current as { cause?: unknown }).cause : undefined
    }
  }
  return chain
}
