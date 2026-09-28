import { atomRef } from "../core/compiled-intent.js"
import type { AtomStateRecord } from "../core/intent-contract.js"
import type { DeniedCallRecord, V2RunSnapshot } from "../core/compiler-store-v2.js"

/**
 * Facts an auditor needs from one run, derived only from what the compiler
 * recorded.  The report states what happened; it does not judge whether the
 * work was semantically right, and it never invents a value the records do not
 * contain.
 */
export interface AuditReport {
  run_id: string
  chain: {
    tasks: Array<{
      task_id: string
      ir_revision: number
      compiled_intent_id?: string
      compiled_revision?: number
      atoms: Array<{
        atom_id: string
        revision: number
        content_digest: string
        status: AtomStateRecord["status"]
        superseded_by?: string
        dispatch_ids: string[]
        execution_ids: string[]
        outcomes: Array<{ execution_id: string; state_claim: string; verified_artifacts: number }>
      }>
    }>
  }
  permissions: {
    granted: Array<{ atom: string; operations: string[] }>
    allowed_calls: Array<{ execution_id: string; operation_id: string; tool?: string; args_digest?: string }>
    denied_calls: DeniedCallRecord[]
    granted_unused: Array<{ atom: string; operation_id: string }>
    tool_calls_by_operation: Record<string, number>
  }
  declarations: {
    outputs: Array<{ output_id: string; format: string; description: string }>
    bindings: Array<{ binding_id: string; role: string }>
    verified_artifacts: Array<{ path: string; digest: string }>
    /**
     * IR-declared deliverables and materials that no current atom declares.
     * The atom is the single place a shape is declared, so this is where a
     * delegation names something the plan never took up — information, not a
     * verdict (the independent check judges coverage under D2/D7).
     */
    declared_not_delivered: Array<{ task_id: string; target: "output" | "binding"; id: string }>
    /**
     * Shape changes a batch made to a derived entry, recorded instead of
     * rejected: the atom's declaration wins and the entry follows it.
     */
    shape_changes: Array<{ request_id: string; target: string; id: string; from: string; to: string }>
  }
  checks: {
    self_reported_checks: number
    self_reported_assessments: number
    independent: Array<{ sequence: number; verdict: string; findings: number; task_ids: string[] }>
    questions: number
    coverage: Array<{ disposition: string; requirement: string; task_id?: string }>
  }
  /**
   * Source references the candidates claimed, per batch.  A reference the model
   * wrote with a guessed digest is recorded as `normalized` (the mechanical layer
   * wrote the real digest); one that names no source in its own batch, or a span
   * past the end of that source, is `unresolvable` and is a revision reason.
   * Runs recorded before this was measured carry no entries here.
   */
  references: {
    claimed: number
    resolved: number
    normalized: number
    unresolvable: number
    by_request: Array<{ request_id: string; claimed: number; resolved: number; normalized: number; unresolvable: number }>
    /**
     * The unresolvable references themselves (bounded per batch), so a reader
     * can see which source id or span the model invented instead of a count.
     */
    unresolved_refs: Array<{
      request_id: string
      source_id: string
      span?: { unit: string; start: number; end: number }
    }>
  }
  cost: {
    management_requests: number
    total_management_requests: number
    max_management_requests: number
    max_total_management_requests: number
    management_input_tokens: number | "unavailable"
    management_output_tokens: number | "unavailable"
    management_reasoning_tokens: number | "unavailable"
    management_cost: number | "unavailable"
    per_request: Array<{ request_id: string; status: string; duration_ms: number; retry: boolean }>
    /**
     * Management calls grouped by the events that triggered them: one line per
     * user message answers "what did this message cost", which neither the
     * per-batch nor the per-run totals can.  `estimated` marks a batch whose
     * calls predate per-call records (its count then falls back to the batch).
     */
    by_user_event: Array<{
      event_ids: string[]
      batches: number
      calls: number
      propose: number
      check: number
      estimated?: true
    }>
    /**
     * One line per management model call.  The batch total (`per_request`) hides
     * which kind of call spent the time; this is the slice that answers
     * "propose or check?", measured rather than inferred from usage.
     */
    per_call: Array<{
      call_id: string
      request_id: string
      kind: string
      status: string
      duration_ms: number
      error_code?: string
      input_tokens?: number
      output_tokens?: number
      reasoning_tokens?: number
      cache_read_tokens?: number
    }>
    /** Per-call totals summed by call kind, so proposes and checks compare directly. */
    by_kind: Record<string, { calls: number; duration_ms: number; output_tokens: number; reasoning_tokens: number }>
    tool_calls: number
  }
  failures: Array<{ request_id?: string; status: string; code?: string; message?: string }>
  pending_events: string[]
}

export function buildAuditReport(snapshot: V2RunSnapshot): AuditReport {
  const stateByKey = new Map(snapshot.atom_states.map((state) => [atomKey(state.task_id, state.atom_id, state.atom_revision), state]))
  const supersededBy = new Map<string, string>()
  for (const state of snapshot.atom_states) {
    const previous = state.previous_atom_ref
    if (previous === undefined) continue
    supersededBy.set(atomKey(state.task_id, previous.id, previous.revision), `${state.atom_id}@${state.atom_revision}`)
  }

  const tasks: AuditReport["chain"]["tasks"] = []
  const granted: AuditReport["permissions"]["granted"] = []
  const declaredNotDelivered: AuditReport["declarations"]["declared_not_delivered"] = []
  const outputs: AuditReport["declarations"]["outputs"] = []
  const bindings: AuditReport["declarations"]["bindings"] = []

  for (const [taskId, intent] of Object.entries(snapshot.compiled)) {
    const task = snapshot.ir[taskId]
    for (const output of task?.outputs ?? []) {
      outputs.push({ output_id: output.output_id, format: output.format, description: output.description })
    }
    for (const binding of task?.bindings ?? []) {
      bindings.push({ binding_id: binding.binding_id, role: binding.role })
    }
    // What the current atoms declare, so the IR entries that nobody delivers
    // can be named below instead of passing silently.
    const deliveredOutputs = new Set<string>()
    const deliveredBindings = new Set<string>()
    for (const atom of intent.atoms) {
      for (const output of atom.outputs) deliveredOutputs.add(output.output_id)
      for (const input of atom.inputs) deliveredBindings.add(input.binding_id)
    }
    for (const output of task?.outputs ?? []) {
      if (!deliveredOutputs.has(output.output_id)) declaredNotDelivered.push({ task_id: taskId, target: "output", id: output.output_id })
    }
    for (const binding of task?.bindings ?? []) {
      if (!deliveredBindings.has(binding.binding_id)) declaredNotDelivered.push({ task_id: taskId, target: "binding", id: binding.binding_id })
    }
    const atoms: AuditReport["chain"]["tasks"][number]["atoms"] = []
    for (const atom of intent.atoms) {
      const key = atomKey(taskId, atom.atom_id, atom.revision)
      const dispatches = snapshot.dispatches.filter((dispatch) => dispatch.atom_id === atom.atom_id && dispatch.atom_revision === atom.revision && dispatch.task_id === taskId)
      const executions = dispatches.flatMap((dispatch) => snapshot.executions.filter((execution) => execution.dispatch_id === dispatch.dispatch_id))
      const outcomes = executions.flatMap((execution) => snapshot.execution_outcomes
        .filter((outcome) => outcome.execution_id === execution.execution_id)
        .map((outcome) => ({
          execution_id: outcome.execution_id,
          state_claim: outcome.state_claim,
          verified_artifacts: outcome.verified_artifacts?.length ?? 0,
        })))
      atoms.push({
        atom_id: atom.atom_id,
        revision: atom.revision,
        content_digest: atomRef(atom).digest,
        status: stateByKey.get(key)?.status ?? "ready",
        ...(supersededBy.get(key) === undefined ? {} : { superseded_by: supersededBy.get(key) as string }),
        dispatch_ids: dispatches.map((dispatch) => dispatch.dispatch_id),
        execution_ids: executions.map((execution) => execution.execution_id),
        outcomes,
      })
      granted.push({ atom: `${atom.atom_id}@${atom.revision}`, operations: atom.authority.rules.map((rule) => rule.operation_id) })
    }
    tasks.push({
      task_id: taskId,
      ir_revision: task?.revision ?? 0,
      compiled_intent_id: intent.compiled_intent_id,
      compiled_revision: intent.compiled_revision,
      atoms,
    })
  }

  const allowedCalls = snapshot.executions.flatMap((execution) => execution.allowed_calls.map((call) => ({
    execution_id: execution.execution_id,
    operation_id: call.operation_id,
    ...(call.tool === undefined ? {} : { tool: call.tool }),
    ...(call.args_digest === undefined ? {} : { args_digest: call.args_digest }),
  })))
  const usedOperations = new Set(allowedCalls.map((call) => call.operation_id))
  const grantedUnused = granted.flatMap((entry) => entry.operations
    .filter((operation) => !usedOperations.has(operation))
    .map((operation) => ({ atom: entry.atom, operation_id: operation })))
  const toolCallsByOperation = allowedCalls.reduce<Record<string, number>>((counts, call) => {
    counts[call.operation_id] = (counts[call.operation_id] ?? 0) + 1
    return counts
  }, {})

  const failures: AuditReport["failures"] = snapshot.management_log
    .filter((record) => record.status !== "accepted")
    .map((record) => ({
      request_id: record.request_id,
      status: record.status,
      ...(record.error_code === undefined ? {} : { code: record.error_code }),
      ...(record.error_message === undefined ? {} : { message: record.error_message }),
    }))
  for (const denied of snapshot.denied_calls) {
    failures.push({ status: `denied_${denied.kind}`, code: denied.code, message: denied.message })
  }

  // Per-call accounting: the batch total is not a call duration, and usage that
  // arrives after a failure still belongs to the call that spent it.
  const managementCalls = snapshot.management_calls ?? []
  const callsByKind: AuditReport["cost"]["by_kind"] = {}
  for (const call of managementCalls) {
    const entry = callsByKind[call.kind] ?? { calls: 0, duration_ms: 0, output_tokens: 0, reasoning_tokens: 0 }
    entry.calls += 1
    entry.duration_ms += call.duration_ms
    entry.output_tokens += call.usage?.output_tokens ?? 0
    entry.reasoning_tokens += call.usage?.reasoning_tokens ?? 0
    callsByKind[call.kind] = entry
  }

  const referencesByRequest = snapshot.management_log.flatMap((record) => record.source_refs === undefined
    ? []
    : [{
        request_id: record.request_id,
        claimed: record.source_refs.total,
        resolved: record.source_refs.resolved,
        normalized: record.source_refs.normalized,
        unresolvable: record.source_refs.unresolved,
      }])
  const references = referencesByRequest.reduce(
    (totals, entry) => ({
      claimed: totals.claimed + entry.claimed,
      resolved: totals.resolved + entry.resolved,
      normalized: totals.normalized + entry.normalized,
      unresolvable: totals.unresolvable + entry.unresolvable,
    }),
    { claimed: 0, resolved: 0, normalized: 0, unresolvable: 0 },
  )
  const unresolvedRefs: AuditReport["references"]["unresolved_refs"] = snapshot.management_log.flatMap((record) =>
    (record.source_refs?.unresolvedRefs ?? []).map((ref) => ({
      request_id: record.request_id,
      source_id: ref.source_id,
      ...(ref.span === undefined ? {} : { span: ref.span }),
    })))
  const shapeChanges: AuditReport["declarations"]["shape_changes"] = snapshot.management_log.flatMap((record) =>
    (record.declaration_changes ?? []).map((change) => ({
      request_id: record.request_id,
      target: change.target,
      id: change.id,
      from: change.from,
      to: change.to,
    })))

  // Which user event paid for which calls: a message that had to be re-rolled
  // shows up as more than one batch (and more than one check) on one line.
  const callsPerRequest = new Map<string, { propose: number; check: number }>()
  for (const call of managementCalls) {
    const entry = callsPerRequest.get(call.request_id) ?? { propose: 0, check: 0 }
    entry[call.kind] = (entry[call.kind] ?? 0) + 1
    callsPerRequest.set(call.request_id, entry)
  }
  const byUserEvent = new Map<string, AuditReport["cost"]["by_user_event"][number]>()
  for (const record of snapshot.management_log) {
    const key = [...record.trigger_event_ids].sort().join("\u0000")
    const entry = byUserEvent.get(key) ?? {
      event_ids: record.trigger_event_ids,
      batches: 0,
      calls: 0,
      propose: 0,
      check: 0,
    }
    entry.batches += 1
    const calls = callsPerRequest.get(record.request_id)
    if (calls === undefined) {
      // A batch recorded before per-call rows existed: count it as one proposal
      // and say so, rather than reporting a confident wrong split.
      entry.calls += 1
      entry.propose += 1
      entry.estimated = true
    } else {
      entry.calls += calls.propose + calls.check
      entry.propose += calls.propose
      entry.check += calls.check
    }
    byUserEvent.set(key, entry)
  }

  return {
    run_id: snapshot.run_id,
    chain: { tasks },
    permissions: {
      granted,
      allowed_calls: allowedCalls,
      denied_calls: snapshot.denied_calls,
      granted_unused: grantedUnused,
      tool_calls_by_operation: toolCallsByOperation,
    },
    declarations: {
      outputs,
      bindings,
      verified_artifacts: snapshot.execution_outcomes.flatMap((outcome) => outcome.verified_artifacts ?? []),
      declared_not_delivered: declaredNotDelivered,
      shape_changes: shapeChanges,
    },
    checks: {
      self_reported_checks: snapshot.checks.length,
      self_reported_assessments: snapshot.assessments.length,
      independent: snapshot.semantic_checks.map((check) => ({
        sequence: check.sequence,
        verdict: check.verdict,
        findings: check.findings.length,
        task_ids: check.task_ids,
      })),
      questions: snapshot.questions.length,
      coverage: snapshot.coverage.map((entry) => ({
        disposition: entry.disposition,
        requirement: "local_ref" in entry.requirement ? entry.requirement.local_ref : entry.requirement.id,
        ...(entry.task_id === undefined ? {} : { task_id: entry.task_id }),
      })),
    },
    references: { ...references, by_request: referencesByRequest, unresolved_refs: unresolvedRefs },
    cost: {
      management_requests: snapshot.budget.management_requests,
      total_management_requests: snapshot.budget.total_management_requests,
      max_management_requests: snapshot.budget.max_management_requests,
      max_total_management_requests: snapshot.budget.max_total_management_requests,
      management_input_tokens: snapshot.budget.management_input_tokens,
      management_output_tokens: snapshot.budget.management_output_tokens,
      management_reasoning_tokens: snapshot.budget.management_reasoning_tokens,
      management_cost: snapshot.budget.management_cost,
      per_request: snapshot.management_log.map((record) => ({
        request_id: record.request_id,
        status: record.status,
        duration_ms: record.duration_ms,
        retry: record.retry,
      })),
      per_call: managementCalls.map((call) => ({
        call_id: call.call_id,
        request_id: call.request_id,
        kind: call.kind,
        status: call.status,
        duration_ms: call.duration_ms,
        ...(call.error_code === undefined ? {} : { error_code: call.error_code }),
        ...(call.usage?.input_tokens === undefined ? {} : { input_tokens: call.usage.input_tokens }),
        ...(call.usage?.output_tokens === undefined ? {} : { output_tokens: call.usage.output_tokens }),
        ...(call.usage?.reasoning_tokens === undefined ? {} : { reasoning_tokens: call.usage.reasoning_tokens }),
        ...(call.usage?.cache_read_tokens === undefined ? {} : { cache_read_tokens: call.usage.cache_read_tokens }),
      })),
      by_kind: callsByKind,
      by_user_event: [...byUserEvent.values()],
      tool_calls: allowedCalls.length,
    },
    failures,
    pending_events: snapshot.pending_event_ids,
  }
}

/** One-line summary for logs: chain, refusals, tokens, unresolved events. */
export function summarizeAuditReport(report: AuditReport): string {
  const atoms = report.chain.tasks.reduce((total, task) => total + task.atoms.length, 0)
  const completed = report.chain.tasks.reduce((total, task) => total + task.atoms.filter((atom) => atom.status === "completed" || atom.status === "legacy").length, 0)
  const refusals = report.permissions.denied_calls.length
  const toolCalls = report.permissions.tool_calls_by_operation
  const tools = Object.entries(toolCalls).map(([operation, count]) => `${operation}x${count}`).join(",") || "none"
  const independent = report.checks.independent.map((check) => check.verdict).join(",") || "none"
  const callSplit = Object.entries(report.cost.by_kind).map(([kind, entry]) => `${kind} ${entry.calls}x/${entry.duration_ms}ms`).join(",") || "none"
  const perEvent = report.cost.by_user_event
  const maxCallsPerEvent = perEvent.reduce((max, entry) => Math.max(max, entry.calls), 0)
  return [
    `run=${report.run_id}`,
    `atoms=${atoms} completed=${completed}`,
    `tool_calls=${report.cost.tool_calls} (${tools})`,
    `refused=${refusals}`,
    `artifacts_verified=${report.declarations.verified_artifacts.length}`,
    `independent_checks=${independent}`,
    `pending=${report.pending_events.length}`,
    `management_requests=${report.cost.total_management_requests}/${report.cost.max_total_management_requests}`,
    `management_calls=${report.cost.per_call.length} (${callSplit})`,
    `user_events=${perEvent.length} max_calls_per_event=${maxCallsPerEvent}`,
    `source_refs=${report.references.resolved}/${report.references.claimed} written=${report.references.normalized} unresolvable=${report.references.unresolvable}`,
  ].join(" | ")
}

function atomKey(taskId: string, atomId: string, revision: number): string {
  return `${taskId}\u0000${atomId}@${revision}`
}
