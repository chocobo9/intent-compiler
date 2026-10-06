#!/usr/bin/env node
/**
 * Replay recorded management answers on the current code (built dist/), one
 * round at a time from that round's own pre-round store.
 *
 * What it tests: whether the new code accepts the answers real models wrote,
 * and whether the deterministic assembly (source ledger, withdrawal order,
 * delivered projection) changed.  It does not test what a model would write
 * for the new requests, and it is not a gate before real runs.  The executor
 * reports belong to that year's delivered text, so replaying a return batch
 * checks the mechanism, not the judgement.
 *
 * Evidence is read only: every store is copied to a temp directory first.
 * No model, executor or verifier is called.  The recorded data stays in the
 * EvoCodeBench tree; when it is absent the command skips.
 *
 *   npm run build && node experiments/evocode/harbor/dpipe/replay-recorded.mjs [--evo <root>] [--only R3,R4] [--out <file>] [--no-isolated]
 */
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const project = resolve(here, "../../../..")
const recordsDir = join(here, "records/2026-10-06-recorded-replay")
const args = process.argv.slice(2)
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const evo = option("--evo") ?? process.env.EVOCODEBENCH_ROOT ?? "D:/huawei/EvoCodeBench"
const only = option("--only")?.split(",")
// --then-path feeds only the answers that year's code accepted, so a round where
// the new code accepts an earlier answer (and the state diverges) can still be
// compared along the path the run actually took.  It never accepts an answer
// the new code rejects.
const thenPath = args.includes("--then-path")
const isolated = !args.includes("--no-isolated") && !thenPath

const plan = JSON.parse(readFileSync(join(recordsDir, "rounds.json"), "utf8"))
const rules = JSON.parse(readFileSync(join(recordsDir, "classification.json"), "utf8")).rules
  .map(rule => ({ ...rule, regex: new RegExp(rule.pattern, "su") }))
const rounds = plan.rounds.filter(round => !only || only.includes(round.id))
const missing = rounds.filter(round => !existsSync(join(evo, round.post)) || (round.pre && !existsSync(join(evo, round.pre))))
if (!existsSync(evo) || missing.length === rounds.length) {
  console.log(`replay-recorded: skipped, recorded data not found under ${evo}`)
  process.exit(0)
}

const load = path => import(pathToFileURL(join(project, "dist", path)).href)
const { IntentStoreV2 } = await load("core/compiler-store-v2.js")
const { createIntentCompilerV2 } = await load("core/intent-compiler-v2.js")
const { createCompilerModelV2 } = await load("model/compiler-model-v2.js")
const { atomRef } = await load("core/compiled-intent.js")
const { turnClaimsCompletion } = await load("adapters/opencode.js")

const readStore = dir => ({
  snapshot: JSON.parse(readFileSync(join(evo, dir, "snapshot.json"), "utf8")),
  events: readFileSync(join(evo, dir, "events.jsonl"), "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)),
})
const stageOf = attempt => attempt.generation_stage ?? attempt.kind
const firstIssue = attempt => (attempt.issues ?? [])[0]
const scratch = []

/** A writable working copy: the pre-round store, or an empty one. */
function workingStore(preDir, runId, budget) {
  const root = mkdtempSync(join(tmpdir(), "replay-recorded-"))
  scratch.push(root)
  const dir = join(root, "v2-runs", runId)
  mkdirSync(dir, { recursive: true })
  if (preDir) for (const name of readdirSync(join(evo, preDir))) {
    copyFileSync(join(evo, preDir, name), join(dir, name))
    chmodSync(join(dir, name), 0o644)
  }
  const store = new IntentStoreV2({ storeDir: root, runId })
  // The round runs under that year's limits.
  store.applyDeltas({ max_management_requests: budget.max_management_requests })
  store.snapshot.budget.max_total_management_requests = budget.max_total_management_requests
  store.writeSnapshot()
  return { root, store }
}

function cloneStore(root, runId) {
  const copy = mkdtempSync(join(tmpdir(), "replay-recorded-"))
  scratch.push(copy)
  cpSync(root, copy, { recursive: true })
  return { root: copy, store: new IntentStoreV2({ storeDir: copy, runId }) }
}

/** The recorded answers of one batch by stage, each call taking the next one of the stage it asks for. */
function queuesOf(batch, keep = () => true) {
  const queues = {}
  batch.attempts.forEach((attempt, index) => {
    if (!keep(stageOf(attempt), index)) return
    ;(queues[stageOf(attempt)] ??= []).push({ index, text: attempt.text, transport: !attempt.text && attempt.failure_diagnostic !== undefined })
  })
  return queues
}

function recordedModel(queues, calls, rewrite) {
  const next = stage => {
    const entry = (queues[stage] ?? []).shift()
    calls.push({ stage, recorded: entry?.index ?? "exhausted" })
    // An answer that fails the schema at once: no transport backoff, just a rejection.
    if (entry === undefined) return "{}"
    if (entry.transport) throw new Error("recorded transport failure")
    return rewrite(entry.text)
  }
  return createCompilerModelV2(
    async request => next(request.generation_stage ?? "single"),
    async request => { const text = next("check"); calls.at(-1).prepared_now = request.prepared?.digest; return text },
  )
}

/** Checks on the recorded answer itself, so a class never depends on what the new code did. */
const predicates = {
  quote_inside_named_segment(attempt, reason) {
    if (/quote_unresolved|segment_unknown|span_invalid|source_unknown|alias_not_offered/u.test(reason)) return false
    let answer
    try { answer = JSON.parse(attempt.text.slice(attempt.text.indexOf("{"), attempt.text.lastIndexOf("}") + 1)) } catch { return false }
    const segments = attempt.request?.source_segments ?? []
    const both = []
    const visit = value => {
      if (Array.isArray(value)) return value.forEach(visit)
      if (value === null || typeof value !== "object") return
      if (typeof value.segment_id === "string" && typeof value.quote === "string" && value.quote.length > 0) both.push(value)
      Object.values(value).forEach(visit)
    }
    visit(answer)
    return both.length > 0 && both.every(ref => segments.some(segment => segment.segment_id === ref.segment_id && segment.source_id === ref.source_id
      && segment.text.split(ref.quote).length === 2))
  },
}

function classify(reason, attempt) {
  if (reason === undefined) return undefined
  const rule = rules.find(candidate => candidate.regex.test(reason) && (!candidate.predicate || predicates[candidate.predicate](attempt, reason)))
  return rule === undefined ? { class: "unclassified", expect: "review", label: reason.slice(0, 120) } : { class: rule.class, expect: rule.expect, label: rule.label, fixed_by: rule.fixed_by ?? null }
}

/** Line-level difference between that year's delivered Atom text and the new one, with line numbers. */
function textDiff(then, now) {
  const a = then.split("\n"), b = now.split("\n")
  const inB = new Set(b), inA = new Set(a)
  return {
    identical: then === now, then_chars: then.length, now_chars: now.length,
    only_then: a.flatMap((line, i) => (!inB.has(line) && line.trim() ? [{ line: i + 1, text: line.slice(0, 240) }] : [])),
    only_now: b.flatMap((line, i) => (!inA.has(line) && line.trim() ? [{ line: i + 1, text: line.slice(0, 240) }] : [])),
  }
}

function fieldDiff(a, b, path = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return []
  if (a && b && typeof a === "object" && typeof b === "object") return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => fieldDiff(a[key], b[key], `${path}.${key}`))
  return [path]
}

const fieldGroup = path => path.replace(/\.\d+/gu, "").split(".").slice(0, 3).join(".")

async function replayRound(round) {
  const pre = round.pre ? readStore(round.pre) : { snapshot: undefined, events: [] }
  const post = readStore(round.post)
  const out = { id: round.id, kind: round.kind, then_code: round.then_code, batches: [], executions: [], delivered: [], skipped_events: {}, halted: undefined }
  const preLog = pre.snapshot?.management_log.length ?? 0
  const batches = post.snapshot.management_log.slice(preLog)
  const events = post.events.slice(pre.events.length).map(row => row.event)
  const work = workingStore(round.pre, round.run_id, post.snapshot.budget)
  out.readable = { events: work.store.readEvents().length, malformed: work.store.readEventJournal().malformed, pending_at_start: work.store.current().pending_event_ids.length }
  const compiler = () => createIntentCompilerV2({ store: work.store, model: { propose: () => { throw new Error("no batch is running") } } })
  const execMap = new Map()
  const mapIds = text => [...execMap.entries()].sort((x, y) => y[0].length - x[0].length)
    .reduce((acc, [from, to]) => acc.replace(new RegExp(`\\b${from}\\b`, "gu"), to), text)
  const present = new Set(work.store.current().pending_event_ids)
  let next = 0

  const runBatch = async batch => {
    const before = cloneStore(work.root, round.run_id)
    const calls = []
    const keepThen = (stage, index) => !thenPath || stage === "check" || firstIssue(batch.attempts[index]) === undefined && Boolean(batch.attempts[index].text)
    const advanced = await createIntentCompilerV2({ store: work.store, model: recordedModel(queuesOf(batch, keepThen), calls, mapIds) }).advance({ runId: round.run_id })
    const record = work.store.current().management_log.at(-1)
    const then = { status: batch.status, error_code: batch.error_code ?? null }
    const now = { ok: advanced.ok, status: advanced.ok ? record.status : record?.status, error_code: advanced.code ?? record?.error_code ?? null, message: advanced.ok ? undefined : advanced.message?.slice(0, 400) }
    const entry = {
      batch: batch.request_id, trigger: batch.trigger_event_ids.some(id => id.includes(":user:")) ? "user" : "return", then, now,
      calls: calls.map((call, i) => ({ ...call, rejected_now: (record?.attempts?.[i]?.issues ?? []).length > 0, reason_now: firstIssue(record?.attempts?.[i] ?? {})?.slice(0, 200) })),
      attempts: [], assessments_then: post.snapshot.assessments.filter(a => a.sequence === batch.sequence).map(a => a.result),
    }
    entry.assessments_now = advanced.ok ? work.store.current().assessments.filter(a => a.sequence === record.sequence).map(a => a.result) : []
    // An answer rejected then but accepted now changes the state the later
    // recorded answers were written against: what follows is not comparable.
    const diverged = calls.some((call, i) => typeof call.recorded === "number" && firstIssue(batch.attempts[call.recorded]) !== undefined
      && (record?.attempts?.[i]?.issues ?? []).length === 0)
    if (diverged) entry.diverged = "an answer rejected then was accepted now; later recorded answers were written for another state"
    if (batch.status === "accepted" && !advanced.ok) {
      entry.outcome = diverged ? "not comparable: diverged after a flip" : "regression: accepted then, rejected now"
      out.halted = `${batch.request_id} rejected now; the rest of the round is not comparable`
    }
    else if (batch.status !== "accepted" && advanced.ok) entry.outcome = "flip: rejected then, accepted now"
    else entry.outcome = advanced.ok ? "accepted both" : "rejected both"
    if (now.error_code === "budget_exhausted" || then.error_code === "budget_exhausted") entry.budget_closure = true
    // Every recorded answer on its own, from the same pre-batch state.
    for (const [index, attempt] of batch.attempts.entries()) {
      const stage = stageOf(attempt)
      const reason = firstIssue(attempt)
      const item = { index, stage, then: reason !== undefined ? "rejected" : !attempt.text ? "transport" : "accepted", reason_then: reason?.slice(0, 200), class: classify(reason, attempt) }
      if (stage === "check") {
        let verdict
        try { verdict = JSON.parse(attempt.text ?? "{}").verdict } catch { verdict = "unparsed" }
        Object.assign(item, { then: `check:${verdict}`, comparable: false, prepared_then: attempt.prepared_digest })
        entry.attempts.push(item); continue
      }
      if (!isolated || item.then === "transport") { entry.attempts.push(item); continue }
      // The other stages take the answer that year's code accepted.
      const lastIr = batch.attempts.findLastIndex(a => stageOf(a) === "ir" && firstIssue(a) === undefined)
      const lastCi = batch.attempts.findLastIndex(a => stageOf(a) === "ci" && firstIssue(a) === undefined)
      const keep = (s, i) => s === stage ? i === index : s === "ir" ? i === lastIr : s === "ci" ? i === lastCi : true
      const trial = cloneStore(before.root, round.run_id)
      const trialCalls = []
      await createIntentCompilerV2({ store: trial.store, model: recordedModel(queuesOf(batch, keep), trialCalls, mapIds) }).advance({ runId: round.run_id })
      const trialRecord = trial.store.current().management_log.at(-1)
      const at = trialCalls.findIndex(call => call.recorded === index)
      if (at < 0) { item.now = "not_reached"; entry.attempts.push(item); continue }
      const issue = firstIssue(trialRecord?.attempts?.[at] ?? {})
      item.now = issue === undefined ? "accepted" : "rejected"
      item.reason_now = issue?.slice(0, 200)
      item.class_now = issue === undefined ? undefined : classify(issue, attempt)
      item.verdict = verdictOf(item)
      entry.attempts.push(item)
      rmSync(trial.root, { recursive: true, force: true })
    }
    rmSync(before.root, { recursive: true, force: true })
    out.batches.push(entry)
    if (advanced.ok && entry.trigger === "user") compareDelivered(advanced.deliveries ?? [])
    if (advanced.ok && entry.trigger === "return") {
      const offered = await compiler().pendingDeliveries({ runId: round.run_id })
      if (offered.length > 0) entry.offered_after = offered.map(d => `${d.atom_id}@${d.atom.revision}`)
    }
    return advanced.ok
  }

  const compareDelivered = deliveries => {
    for (const delivery of deliveries) {
      const thenAtom = post.snapshot.compiled[delivery.task_id]?.atoms.find(a => a.atom_id === delivery.atom_id && a.revision === delivery.atom.revision)
      if (!thenAtom) { out.delivered.push({ now: `${delivery.atom_id}@${delivery.atom.revision}`, then: null, note: "that year's plan has no such version" }); continue }
      const fields = fieldDiff({ ...thenAtom, task: "" }, { ...delivery.atom, task: "" })
      const goalRefs = fieldDiff(thenAtom.goal_refs, delivery.atom.goal_refs).length === 0 ? undefined
        : { then: thenAtom.goal_refs.map(r => `${r.id}@${r.revision}:${r.digest.slice(7, 19)}`), now: delivery.atom.goal_refs.map(r => `${r.id}@${r.revision}:${r.digest.slice(7, 19)}`) }
      out.delivered.push({ atom: `${delivery.atom_id}@${delivery.atom.revision}`, text: textDiff(thenAtom.task, delivery.atom.task), other_fields: [...new Set(fields.map(fieldGroup))], other_field_count: fields.length, ...(goalRefs ? { goal_refs: goalRefs } : {}) })
    }
  }

  const drain = async () => {
    while (next < batches.length && !out.halted) {
      const batch = batches[next]
      const triggers = batch.trigger_event_ids.map(mapIds)
      if (!triggers.every(id => present.has(id) || work.store.current().pending_event_ids.includes(id))) return
      next += 1
      await runBatch(batch)
    }
  }

  await drain()
  for (const event of events) {
    if (out.halted) break
    if (event.kind === "user_input") {
      const receipt = await compiler().acceptEvent(event)
      present.add(event.event_id)
      if (!receipt.ok && receipt.status !== "duplicate") { out.halted = `user input rejected: ${receipt.message}`; break }
    } else if (event.kind === "execution_return") {
      const oldId = event.execution_id
      const thenExecution = post.snapshot.executions.find(e => e.execution_id === oldId)
      const thenDispatch = post.snapshot.dispatches.find(d => d.dispatch_id === thenExecution?.dispatch_id)
      const offers = await compiler().pendingDeliveries({ runId: round.run_id })
      const offer = offers.find(o => o.atom_id === thenDispatch?.atom_id)
      if (!offer) { out.halted = `no offer for ${thenDispatch?.atom_id} to carry ${oldId}; the rest of the round is not comparable`; break }
      const start = compiler().authorize({ kind: "start", run_id: round.run_id, dispatch_id: offer.dispatch_id, host_identity: "replay" })
      if (!start.ok) { out.halted = `start refused: ${start.message}`; break }
      execMap.set(oldId, start.execution_id)
      const payload = structuredClone(event.payload)
      const succeeded = payload.reason !== "opencode-sdk-reconciliation-failed"
      const claimNow = turnClaimsCompletion(payload.executor_report ?? [], succeeded) ? "completed" : "stopped"
      const refNow = atomRef(offer.atom)
      const refThen = payload.outcome.atom_ref
      payload.state_claim = claimNow
      payload.outcome = { ...payload.outcome, execution_id: start.execution_id, atom_ref: refNow, suggested_status: claimNow === "completed" ? "completed" : "ready" }
      const receipt = await compiler().acceptEvent({ ...event, event_id: `${start.execution_id}:return`, execution_id: start.execution_id, payload })
      present.add(`${start.execution_id}:return`)
      out.executions.push({
        then: oldId, now: start.execution_id, version_then: `${thenDispatch.atom_id}@${thenDispatch.atom_revision}`, version_now: `${offer.atom_id}@${offer.atom.revision}`,
        claim_then: event.payload.state_claim, claim_now: claimNow, atom_ref_rewritten: JSON.stringify(refThen) !== JSON.stringify(refNow), receipt: receipt.status ?? receipt.code,
        ...(claimNow !== event.payload.state_claim ? { claim_changed: `completion claim ${event.payload.state_claim} then, ${claimNow} now (d21ecb4)` } : {}),
        ...(claimNow === "stopped" ? { not_comparable: "a stopped claim is run once more by code (4da499b); that execution has no recording" } : {}),
      })
    } else {
      out.skipped_events[event.kind] = (out.skipped_events[event.kind] ?? 0) + 1
      continue
    }
    await drain()
  }
  if (next < batches.length && !out.halted) out.halted = `${batches.length - next} recorded batch(es) never became runnable`
  out.pending_end = { then: post.snapshot.pending_event_ids.length, now: work.store.current().pending_event_ids.length }
  // The IR at the end of the round against that year's (return batches never revise it).
  const irPaths = fieldDiff(post.snapshot.ir, work.store.current().ir)
  out.ir = { identical: irPaths.length === 0, differing: [...new Set(irPaths.map(fieldGroup))].slice(0, 20) }
  return out
}

function verdictOf(item) {
  if (item.then === "accepted") return item.now === "rejected" ? "regression" : "same"
  const expect = item.class?.expect
  // A rejection whose own defect is gone can still meet another gate.
  const sameRule = item.class_now !== undefined && item.class_now.label === item.class?.label
  if (expect === "accept") return item.now === "accepted" ? "flipped (expected)" : sameRule ? "A still rejected (unexpected)" : "A resolved; another gate rejects"
  if (expect === "reject") return item.now === "accepted" ? "B now accepted (gate loosened?)" : sameRule ? "still rejected (expected)" : "B passed; another gate rejects"
  if (expect === "reject_known_gap") return item.now === "rejected" ? "known gap, still rejected" : "known gap now accepted"
  return `unclassified: ${item.now}`
}

const results = []
for (const round of rounds) {
  if (missing.includes(round)) { results.push({ id: round.id, skipped: "data not found" }); continue }
  const started = Date.now()
  try { results.push({ ...(await replayRound(round)), seconds: Math.round((Date.now() - started) / 1000) }) }
  catch (error) { results.push({ id: round.id, error: error instanceof Error ? error.stack : String(error) }) }
  const r = results.at(-1)
  console.log(`${round.id}: ${r.error ? `ERROR ${r.error.split("\n")[0]}` : r.skipped ?? `${r.batches.map(b => `${b.batch}=${b.outcome}`).join(", ")}${r.halted ? ` | halted: ${r.halted}` : ""} (${r.seconds}s)`}`)
}
for (const root of scratch) rmSync(root, { recursive: true, force: true })

const attempts = results.flatMap(r => (r.batches ?? []).flatMap(b => b.attempts.map(a => ({ round: r.id, batch: b.batch, ...a }))))
const tally = {}
for (const a of attempts) {
  const key = a.stage === "check" ? `check (${a.then})` : a.then === "transport" ? "transport" : a.verdict ?? a.now ?? "not evaluated"
  tally[key] = (tally[key] ?? 0) + 1
}
const summary = { code: process.env.REPLAY_CODE_LABEL ?? "dist", tally, rounds: results }
if (option("--out")) writeFileSync(option("--out"), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify(tally, null, 2))
