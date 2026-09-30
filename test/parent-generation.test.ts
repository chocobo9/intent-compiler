import { test } from "node:test"
import assert from "node:assert/strict"
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IntentStoreV2 } from "../src/core/compiler-store-v2.js"
import { createIntentCompilerV2 } from "../src/core/intent-compiler-v2.js"
import { createCompilerModelV2 } from "../src/model/compiler-model-v2.js"
import type { CompilerModelV2Input } from "../src/model/compiler-model-v2.js"
import { V2_COMPILER_CONTRACT } from "../src/model/compiler-model-v2.js"
import { ParentGeneration } from "../src/core/parent-generation.js"
import { CANDIDATE_EXAMPLE, CANDIDATE_EXAMPLE_INPUT } from "../src/model/candidate-example.js"
import { atomRef, compiledIntentRef } from "../src/core/compiled-intent.js"
import { digestOf, digestText } from "../src/core/intent-contract.js"

function parent() {
  const c = structuredClone(CANDIDATE_EXAMPLE)
  return {
    ...c, groups: c.groups.map(({
      compilation: _compilation, coverage: _coverage,
      execution_decisions: _decisions, assessments: _assessments, checks: _checks, ...group
    }) => group),
  }
}
function child(basis: string) {
  const c = structuredClone(CANDIDATE_EXAMPLE)
  return { schema_version: 2, basis: c.basis, parent_basis: basis, parent_issues: [],
    groups: c.groups.map(({ ir_changes, ...group }) => group) }
}
const consistent = async () => JSON.stringify({ schema_version: 2, verdict: "consistent", findings: [] })

test("CI basis repair names the changed field and supplies the unchanged parent value", async () => {
  let children = 0
  const { store, compiler } = await setup(async input => {
    if (input.generation_stage === "ir") return JSON.stringify(parent())
    const next = child(input.parent_basis!)
    if (++children === 1) {
      const task = input.existing_objects!.tasks[0]!
      next.basis.refs = [{ id: task.task_id, revision: task.task_revision, digest: task.task_digest }]
    } else {
      const feedback = input.validation_errors!.join("\n")
      assert.match(feedback, /basis\.refs/)
      assert.match(feedback, /expected=\[\]/)
      assert.match(feedback, /received=\[\{/)
      assert.deepEqual(store.current().ir, {})
      assert.deepEqual(input.generation_repair!.ir_proposal!.basis.refs, [])
    }
    return JSON.stringify(next)
  })
  store.applyDeltas({ max_management_requests: 4 })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
  assert.equal(children, 2)
  assert.equal(store.current().budget.total_management_requests, 4)
})
async function setup(transport: Parameters<typeof createCompilerModelV2>[0], checker = consistent) {
  const storeDir = mkdtempSync(join(tmpdir(), "parent-generation-"))
  const store = new IntentStoreV2({ storeDir, runId: "parent" })
  const compiler = createIntentCompilerV2({ store, model: createCompilerModelV2(transport, checker) })
  await compiler.acceptEvent({ schema_version: 2, run_id: "parent", event_id: "input-event-id", kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text: CANDIDATE_EXAMPLE_INPUT } })
  return { store, compiler, storeDir }
}

test("a check attempt records the input it sent and the prepared view behind its digest", async () => {
  const { store, compiler, storeDir } = await setup(async input =>
    JSON.stringify(input.generation_stage === "ir" ? parent() : child(input.parent_basis!)))
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
  const record = store.current().management_log.at(-1)!
  const check = (record.attempts ?? []).find(attempt => attempt.kind === "check")
  assert.ok(check, "the batch ran an independent check")
  const view = check.prepared_view as Record<string, unknown>
  const { digest, ...rest } = view
  assert.equal(digestOf(rest), digest, "the recorded prepared view matches its own digest")
  assert.equal(check.prepared_digest, digest, "and that digest is the one recorded on the attempt")
  const sent = check.check_input as { prepared?: { ir?: unknown }; candidate?: unknown }
  assert.deepEqual(sent.prepared?.ir, view.ir, "the check input carries the prepared projection")
  assert.ok(sent.candidate, "the check input carries the candidate it judged")
  const evidence = join(storeDir, "v2-runs", "parent", "check-inputs.jsonl")
  assert.ok(existsSync(evidence), "the check input is persisted before the call")
  const first = JSON.parse(readFileSync(evidence, "utf8").split(/\r?\n/).filter(Boolean)[0]!) as { input?: unknown; prepared_view?: unknown }
  assert.ok(first.input, "the append-only file carries the check input")
  assert.ok(first.prepared_view, "and the prepared view")
})

test("CI generation reads the materialized parent before any child can be committed", async () => {
  const stages: string[] = []
  const { store, compiler } = await setup(async request => {
    const input = request as typeof request & { generation_stage: string; parent_basis: string }
    stages.push(input.generation_stage)
    assert.deepEqual(store.current().ir, {})
    assert.deepEqual(store.current().compiled, {})
    if (stages.length === 1) {
      assert.equal(input.generation_stage, "ir")
      return JSON.stringify(parent())
    }
    assert.equal(input.generation_stage, "ci")
    assert.equal(input.ir.t1!.content.length, 4)
    const shared = input.ir.t1!.content.find(c => c.item_id === "r-common")!
    assert.match(shared.text, /INPUT_MISSING/)
    assert.notEqual(shared.text, shared.interpretation)
    assert.ok(input.parent_basis)
    return JSON.stringify(child(input.parent_basis))
  })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
  assert.deepEqual(stages, ["ir", "ci"])
  assert.equal(store.current().ir.t1!.content.length, 4)
  assert.equal(store.current().compiled.t1!.atoms.length, 2)
  assert.equal(store.current().budget.total_management_requests, 3)
  assert.equal(store.current().executions.length, 0)
})

test("an IR selecting only the tail records the head as a code default and reaches CI generation", async () => {
  const stages: string[] = []
  const { store, compiler } = await setup(async input => {
    stages.push(input.generation_stage!)
    const proposal = parent()
    for (const change of proposal.groups[0]!.ir_changes) {
      if (change.action === "create" && change.target === "content") change.sources = [{
        ...change.sources[0]!, quote: CANDIDATE_EXAMPLE_INPUT.slice(-9), segment_id: undefined,
      }]
    }
    return JSON.stringify(proposal)
  })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, false)
  assert.doesNotMatch(result.message!, /no complete disposition/)
  assert.equal(stages[0], "ir")
  // The IR stage handed over; this fixture writes no CI answer, so the batch
  // ends there.  Before the default, the accounting itself stopped it here.
  assert.ok(stages.includes("ci"), "the IR stage hands over instead of rejecting an unclassified head")
  assert.deepEqual(store.current().ir, {})
  assert.deepEqual(store.current().compiled, {})
})

test("stage requests drop the bodies their operation cannot use and keep the whole IR", async () => {
  const requests: CompilerModelV2Input[] = []
  const { compiler } = await setup(async input => {
    requests.push(structuredClone(input))
    return JSON.stringify(input.generation_stage === "ir" ? parent() : child(input.parent_basis!))
  })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
  const irStage = requests.find(request => request.generation_stage === "ir")!
  const ciStage = requests.find(request => request.generation_stage === "ci")!
  assert.equal(irStage.source_events, undefined, "the raw prior-event list is redundant with the segments and the IR")
  assert.equal(irStage.compiled, undefined, "an IR edit does not carry plan bodies")
  assert.equal(irStage.executions, undefined)
  assert.equal(irStage.assessments, undefined)
  assert.ok((irStage.source_segments ?? []).length > 0, "this batch's own text stays addressable")
  assert.equal(ciStage.source_segments, undefined, "a compile does not re-send the raw source history")
  assert.equal(ciStage.source_events, undefined)
  assert.ok(ciStage.compiled, "the plan stays available to the compile stage")
  assert.equal(ciStage.ir.t1!.content.length, 4, "the whole current IR stays in both stages")
  assert.deepEqual(irStage.ir, {}, "the first IR stage starts from the stored IR, not from a plan")
  const repair = ciStage.generation_repair!.ir_proposal as unknown as { groups: Array<Record<string, unknown>> }
  assert.deepEqual(Object.keys(repair.groups[0]!).sort(),
    ["depends_on", "ir_changes", "local_ref", "questions", "task_refs"],
    "the parent proposal travels in the IR stage shape only")
})

test("a rejected IR answer is told which source references failed and why", async () => {
  const requests: CompilerModelV2Input[] = []
  const { store, compiler } = await setup(async input => {
    requests.push(structuredClone(input))
    if (input.generation_stage !== "ir") return JSON.stringify(child(input.parent_basis!))
    const proposal = parent()
    if (requests.filter(request => request.generation_stage === "ir").length === 1) {
      let replaced = false
      for (const change of proposal.groups[0]!.ir_changes) {
        if (replaced || change.action !== "create" || change.target !== "content") continue
        replaced = true
        change.sources = [
          { source_id: "spliced-input-event-id", digest: "sha256:x", segment_id: "s1" },
          { source_id: "input-event-id", digest: "sha256:x", segment_id: "s99" },
          { source_id: "input-event-id", digest: "sha256:x", segment_id: "s1", quote: "bundle accepts a config file path" },
          { source_id: "input-event-id", digest: "sha256:x", quote: "a paraphrase the user never wrote" },
          { source_id: "input-event-id", digest: "sha256:x", span: { unit: "utf16", start: 0, end: 9_999 } },
        ]
      }
    }
    return JSON.stringify(proposal)
  })
  store.applyDeltas({ max_management_requests: 6 })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
  const retry = requests.filter(request => request.generation_stage === "ir")[1]!
  assert.deepEqual(retry.events.map(event => event.event_id), ["e1"],
    "the retry offers the same alias for the same event")
  const feedback = retry.validation_errors!.join("\n")
  assert.match(feedback, /IR sources do not resolve; 5 reference\(s\) failed the source gate/)
  assert.match(feedback, /spliced-input-event-id \(segment_id=s1\): source_unknown/)
  assert.match(feedback, /e1 \(segment_id=s99\): segment_unknown/)
  assert.match(feedback, /e1 \(segment_id=s1\): selector_conflict/)
  assert.match(feedback, /e1 \(quote="a paraphrase the user never wrote"\): quote_unresolved/)
  assert.match(feedback, /e1 \(span=utf16:0-9999\): span_invalid/)
  assert.match(feedback, /Showing all 5/)
  assert.match(retry.generation_repair!.issues!.join("\n"), /IR sources do not resolve/)
})

test("a failure list longer than the cap keeps the exact count and says it is capped", async () => {
  const requests: CompilerModelV2Input[] = []
  const { store, compiler } = await setup(async input => {
    requests.push(structuredClone(input))
    if (input.generation_stage !== "ir") return JSON.stringify(child(input.parent_basis!))
    const proposal = parent()
    if (requests.filter(request => request.generation_stage === "ir").length === 1) {
      let replaced = false
      for (const change of proposal.groups[0]!.ir_changes) {
        if (replaced || change.action !== "create" || change.target !== "content") continue
        replaced = true
        change.sources = Array.from({ length: 22 }, (_, index) =>
          ({ source_id: `invented-event-${index + 1}`, digest: "sha256:x", segment_id: "s1" }))
      }
    }
    return JSON.stringify(proposal)
  })
  store.applyDeltas({ max_management_requests: 6 })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
  const feedback = requests.filter(request => request.generation_stage === "ir")[1]!.validation_errors!.join("\n")
  assert.match(feedback, /22 reference\(s\) failed the source gate/)
  assert.match(feedback, /Showing the first 20 of 22 \(2 more are not listed\)/)
  assert.equal((feedback.match(/invented-event-\d+ \(/g) ?? []).length, 20)
})

test("an IR request shows this run's aliases and no full event id", async () => {
  const requests: CompilerModelV2Input[] = []
  const { store, compiler } = await setup(async input => {
    requests.push(structuredClone(input))
    return JSON.stringify(input.generation_stage === "ir" ? parent() : child(input.parent_basis!))
  })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
  const ir = requests.find(request => request.generation_stage === "ir")!
  assert.deepEqual(ir.events.map(event => event.event_id), ["e1"])
  assert.ok((ir.source_segments ?? []).every(segment => segment.source_id === "e1"),
    "segments are addressed by the event's alias")
  assert.deepEqual(ir.event_source_refs?.map(ref => ref.source_id), ["e1"])
  // Everything the model reads, minus the static example (the provider
  // transport re-expresses that example; this fake transport hands the
  // contract through untouched).
  const { contract: _contract, ...wire } = structuredClone(ir)
  assert.equal(JSON.stringify(wire).includes("input-event-id"), false,
    "no field of the request leaks the stored event id")
  const attempt = (store.current().management_log.at(-1)!.attempts ?? [])
    .find(entry => entry.kind === "propose" && entry.generation_stage === "ir")!
  assert.deepEqual(attempt.source_aliases,
    [{ alias: "e1", event_id: "input-event-id", digest: digestText(CANDIDATE_EXAMPLE_INPUT) }],
    "the call record carries the mapping the request used")
})

test("one event keeps the same alias in later batches, including inside the IR body", async () => {
  const requests: CompilerModelV2Input[] = []
  let irCalls = 0
  const { store, compiler } = await setup(async input => {
    requests.push(structuredClone(input))
    if (input.generation_stage === "ci") {
      if (irCalls === 1) return JSON.stringify(child(input.parent_basis!))
      // The stored plan stands: reuse it, keeping the group the IR stage named.
      return JSON.stringify({ schema_version: 2, basis: { event_ids: ["later-turn"], refs: [] },
        parent_basis: input.parent_basis!, parent_issues: [],
        groups: [{ local_ref: "g2", task_refs: ["t1"], depends_on: [],
          compilation: { decision: "reuse", current: [compiledIntentRef(store.current().compiled.t1!)], reason: "the stored plan is unchanged" },
          execution_decisions: [], assessments: [], coverage: [], checks: [], questions: [] }] })
    }
    if (++irCalls === 1) return JSON.stringify(parent())
    return JSON.stringify({ schema_version: 2, basis: { event_ids: ["later-turn"], refs: [] }, source_coverage: [],
      groups: [{ local_ref: "g2", task_refs: ["t1"], depends_on: [],
        ir_changes: [{ action: "preserve", reason: "the stored IR stands", sources: [] }],
        questions: [{ text: "What exact output should the status command print?", affects: [] }] }] })
  })
  const first = await compiler.advance({ runId: "parent" })
  assert.equal(first.ok, true, `${first.message} ${JSON.stringify(first.code)}`)
  await compiler.acceptEvent({ schema_version: 2, run_id: "parent", event_id: "later-turn", kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text: "Add a status command that prints ok." } })
  const later = await compiler.advance({ runId: "parent" })
  assert.equal(later.ok, true, `${later.message} ${JSON.stringify(later.code)}`)
  const second = requests.filter(request => request.generation_stage === "ir")[1]!
  assert.deepEqual(second.events.map(event => event.event_id), ["e2"])
  const task = second.ir.t1!
  assert.deepEqual(task.goal.sources.map(source => source.source_id), ["e1"],
    "the event compiled in the first batch keeps its alias in the later request")
  assert.ok(task.content[0]!.sources.every(source => source.source_id === "e1"),
    "the stored IR body is shown under the same alias")
  const attempt = (store.current().management_log.at(-1)!.attempts ?? [])
    .find(entry => entry.kind === "propose" && entry.generation_stage === "ir")!
  assert.deepEqual(attempt.source_aliases?.map(entry => entry.alias), ["e2", "e1"],
    "the request offers the new turn's alias and the already-cited event's alias")
})

test("an alias this request did not offer is rejected by name, not by journal lookup", async () => {
  const requests: CompilerModelV2Input[] = []
  const { store, compiler } = await setup(async input => {
    requests.push(structuredClone(input))
    if (input.generation_stage !== "ir") return JSON.stringify(child(input.parent_basis!))
    const proposal = parent()
    if (requests.filter(request => request.generation_stage === "ir").length === 1) {
      proposal.basis = { event_ids: ["e9"], refs: [] }
      for (const change of proposal.groups[0]!.ir_changes) {
        if (change.action !== "create" || change.target !== "content") continue
        change.sources = [{ source_id: "e7", digest: "sha256:x", segment_id: "s1" }]
        break
      }
    }
    return JSON.stringify(proposal)
  })
  store.applyDeltas({ max_management_requests: 6 })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
  const retry = requests.filter(request => request.generation_stage === "ir")[1]!
  const feedback = retry.validation_errors!.join("\n")
  assert.match(feedback, /2 reference\(s\) name an alias this request did not offer/)
  assert.match(feedback, /basis\.event_ids\[0\] names e9: alias_not_offered/)
  assert.match(feedback, /groups\[0\]\.ir_changes\[1\]\.sources\[0\] names e7: alias_not_offered/)
  assert.match(feedback, /This request offered e1;/)
  assert.match(retry.schema_rejected_draft?.text ?? "", /"e9"/,
    "the answer that named the wrong alias comes back as the repair draft")
  assert.match((retry.schema_rejected_draft?.errors ?? []).join(" "), /alias_not_offered/)
  const record = store.current().management_log.at(-1)!
  assert.match((record.attempts?.[0]?.issues ?? []).join("\n"), /alias_not_offered/,
    "the rejection is recorded on the attempt that produced it")
  assert.ok(store.current().ir.t1 !== undefined, "the retry still commits normally")
})

test("a full-id answer and an alias answer reach the same IR, plan and dispatch", async () => {
  const aliasAnswer = () => JSON.parse(JSON.stringify(parent()).split('"input-event-id"').join('"e1"')) as ReturnType<typeof parent>
  const run = async (answer: () => unknown) => {
    const { store, compiler } = await setup(async input =>
      JSON.stringify(input.generation_stage === "ir" ? answer() : child(input.parent_basis!)))
    const result = await compiler.advance({ runId: "parent" })
    assert.equal(result.ok, true, result.message)
    return { store, result }
  }
  const withIds = await run(parent)
  const withAliases = await run(aliasAnswer)
  assert.deepEqual(withAliases.store.current().ir, withIds.store.current().ir,
    "the code restores the alias before validation and materialization, so the stored IR is identical")
  assert.deepEqual(withAliases.store.current().compiled, withIds.store.current().compiled)
  assert.deepEqual(withAliases.result.deliveries, withIds.result.deliveries)
})

test("a journal that cannot be verified stops the batch before any alias is derived", async () => {
  let calls = 0
  const { store, compiler, storeDir } = await setup(async input => {
    calls += 1
    return JSON.stringify(input.generation_stage === "ir" ? parent() : child(input.parent_basis!))
  })
  const journal = join(storeDir, "v2-runs", "parent", "events.jsonl")
  appendFileSync(journal, "{ this line never parses\n", "utf8")
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, false)
  assert.equal(result.code, "storage_unverified")
  assert.match(result.message ?? "", /has 1 line\(s\) that cannot be read as event records/)
  assert.equal(calls, 0, "the model is never asked to repair the store")
  assert.ok(store.current().pending_event_ids.includes("input-event-id"), "the batch is requeued, not consumed")
})

test("a conflicting or digest-mismatched journal record also stops the batch", async () => {
  let calls = 0
  const { store, compiler, storeDir } = await setup(async () => { calls += 1; return JSON.stringify({}) })
  const journal = join(storeDir, "v2-runs", "parent", "events.jsonl")
  appendFileSync(journal, `${JSON.stringify({ sequence: 2, event: { schema_version: 2, run_id: "parent",
    event_id: "later", kind: "user_input", source: { channel: "user", producer_id: "user" },
    payload: { text: "later" } }, digest: "sha256:0000" })}\n`, "utf8")
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, false)
  assert.equal(result.code, "storage_unverified")
  assert.match(result.message ?? "", /recorded digest of event later does not match/)
  assert.equal(calls, 0)
  assert.ok(store.current().pending_event_ids.includes("input-event-id"))
})

test("a journal line that parses but is not an event record also stops the batch", async () => {
  let calls = 0
  const { store, compiler, storeDir } = await setup(async () => { calls += 1; return JSON.stringify({}) })
  const journal = join(storeDir, "v2-runs", "parent", "events.jsonl")
  // All three parse as JSON; none is a record the journal can be read by:
  // null, a record without its event, and an event without a source channel.
  appendFileSync(journal, "null\n", "utf8")
  appendFileSync(journal, `${JSON.stringify({ sequence: 2 })}\n`, "utf8")
  appendFileSync(journal, `${JSON.stringify({ sequence: 3, event: { event_id: "no-source" }, digest: "sha256:0" })}\n`, "utf8")
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, false)
  assert.equal(result.code, "storage_unverified")
  assert.match(result.message ?? "", /has 3 line\(s\) that cannot be read as event records/)
  assert.equal(calls, 0, "the model is never reached with an unusable journal")
  assert.ok(store.current().pending_event_ids.includes("input-event-id"))
})

test("a corrupt line for the queued event itself stops instead of reporting unchanged", async () => {
  let calls = 0
  const { store, compiler, storeDir } = await setup(async () => { calls += 1; return JSON.stringify({}) })
  const journal = join(storeDir, "v2-runs", "parent", "events.jsonl")
  // The one queued delegation's own line is destroyed: the queue still names
  // it, but the journal can no longer produce its text.
  writeFileSync(journal, "{ this line never parses\n", "utf8")
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, false, `accepted ${result.disposition} without reporting the damaged store`)
  assert.equal(result.code, "storage_unverified")
  assert.match(result.message ?? "", /has 1 line\(s\) that cannot be read as event records/)
  assert.equal(calls, 0, "the model is never reached while the queue is untrustworthy")
  assert.deepEqual(store.current().pending_event_ids, ["input-event-id"],
    "the queued instruction is neither consumed nor dropped")
})

test("a binding create restores the alias inside value.ref before the IR is applied", async () => {
  const { store, compiler } = await setup(async input => {
    if (input.generation_stage !== "ir") return JSON.stringify(child(input.parent_basis!))
    const proposal = parent()
    proposal.groups[0]!.ir_changes.push({
      action: "create", target: "binding", local_ref: "b1",
      value: { ref: { source_id: "e1", digest: "sha256:x", segment_id: "s1" }, role: "task_data", purpose: "the selected requirement text" },
      sources: [{ source_id: "e1", digest: "sha256:x", segment_id: "s1" }],
    } as never)
    return JSON.stringify(proposal)
  })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, `${result.message} ${JSON.stringify(result.code)}`)
  const binding = store.current().ir.t1!.bindings.find(entry => entry.binding_id === "b1")!
  assert.equal((binding.ref as { source_id?: string }).source_id, "input-event-id",
    "the material ref is restored with the rest of the answer, not stored as an alias")
})

test("a run whose event ids can be read as aliases keeps full ids and says why", async () => {
  const requests: CompilerModelV2Input[] = []
  const basis = { event_ids: ["e2", "input-event-id"], refs: [] }
  const { store, compiler } = await setup(async input => {
    requests.push(structuredClone(input))
    if (input.generation_stage !== "ir") return JSON.stringify({ ...child(input.parent_basis!), basis })
    return JSON.stringify({ ...parent(), basis })
  })
  await compiler.acceptEvent({ schema_version: 2, run_id: "parent", event_id: "e2", kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text: "Name this event like an alias." } })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, `${result.message} ${JSON.stringify(result.code)}`)
  const ir = requests.find(request => request.generation_stage === "ir")!
  assert.deepEqual(ir.events.map(event => event.event_id), ["e2", "input-event-id"],
    "a stored id that reads like an alias is shown as itself, never as another event's alias")
  assert.ok((ir.source_segments ?? []).every(segment => segment.source_id === "e2" || segment.source_id === "input-event-id"))
  const attempt = (store.current().management_log.at(-1)!.attempts ?? [])
    .find(entry => entry.kind === "propose" && entry.generation_stage === "ir")!
  assert.deepEqual(attempt.source_aliases, [], "no aliases are minted for this run")
  assert.match(attempt.source_aliases_disabled ?? "", /reads like an alias \(e2\)/)
})

test("the IR-stage contract and example are written in the alias form", async () => {
  const { generationContract } = await import("../src/model/generation-schema.js")
  const ir = generationContract(V2_COMPILER_CONTRACT, "ir")
  assert.match(ir.reference_contract, /short event aliases/)
  assert.match(ir.reference_contract, /never copy a source id out of the example/)
  // The example keeps a placeholder id: copying it must fail loudly instead of
  // resolving to whichever event happens to carry the first alias.
  assert.match(ir.example_candidate, /"source_id": "input-event-id"/)
  const ci = generationContract(V2_COMPILER_CONTRACT, "ci", undefined, "parent")
  assert.match(ci.reference_contract, /short event aliases/, "the clause covers both forms")
  assert.match(ci.example_candidate, /input-event-id/, "the CI example keeps the full identity it copies from the parent")
})

test("an older IR draft loses its execution-facing fields when it is re-sent", async () => {
  const events = [{
    schema_version: 2 as const, run_id: "parent", event_id: "turn-1", kind: "user_input" as const,
    source: { channel: "user" as const, producer_id: "user" }, payload: { text: "Revise the export rule." },
  }]
  const oldProposal = {
    schema_version: 2, basis: { event_ids: ["turn-1"], refs: [] }, source_coverage: [],
    groups: [{
      local_ref: "t1", task_refs: ["t1"], depends_on: [],
      ir_changes: [{ action: "preserve", reason: "kept", sources: [] }],
      execution_decisions: [{ execution_id: "exec-1", decision: "stop", reason: "old draft", basis: [] }],
      assessments: [{
        target_ref: { id: "a1", revision: 0, digest: "sha256:x" }, criteria_refs: [], evidence_refs: [],
        result: "unknown", explanation: "old", method: "model",
      }],
      checks: [{ scenario: "s", expected: "e", observed_in_candidate: "o", sources: [], unresolved: false }],
      questions: [{ text: "Is the old rule still current?", affects: [] }],
    }],
  }
  const input = {
    run_id: "parent", events, ir: {}, compiled: {}, atom_refs: {}, executions: [],
    budget: { requests_used: 0, max_requests: 4 }, contract: V2_COMPILER_CONTRACT,
  } as unknown as CompilerModelV2Input
  let seen: CompilerModelV2Input | undefined
  const generation = new ParentGeneration({
    input, sourceBasis: "basis-1",
    restored: { source_basis: "basis-1", phase: "ir", ir_proposal: oldProposal as never, issues: [] },
    checkRequired: false, remaining: () => 5, currentBasis: () => "basis-1",
    call: async (request) => { seen = request; return { ok: false, error: { code: "schema", message: "stub" } } },
    aliases: { lookup: () => undefined, records: () => false },
    resolve: () => ({ unresolved: 0 }), validateBasis: () => ({ ok: true }), directory: () => ({ tasks: [] }),
  })
  const result = await generation.propose(input)
  assert.equal(result.ok, false)
  const group = (seen!.generation_repair!.ir_proposal as unknown as { groups: Array<Record<string, unknown>> }).groups[0]!
  for (const key of ["compilation", "coverage", "execution_decisions", "assessments", "checks"]) {
    assert.equal(key in group, false, `${key} must not travel in an IR proposal`)
  }
  assert.deepEqual(group.questions, [{ text: "Is the old rule still current?", affects: [] }])
  assert.deepEqual(group.ir_changes, [{ action: "preserve", reason: "kept", sources: [] }])
})

test("an uncompiled delegation beyond the carried cap keeps its text and is listed by id", async () => {
  const requests: CompilerModelV2Input[] = []
  const { compiler } = await setup(async input => {
    requests.push(structuredClone(input))
    return JSON.stringify({})
  })
  for (const id of ["gap-2", "gap-3", "gap-4", "gap-5"]) {
    await compiler.acceptEvent({ schema_version: 2, run_id: "parent", event_id: id, kind: "user_input",
      source: { channel: "user", producer_id: "user" }, payload: { text: `Delegation ${id} still has no accepted batch.` } })
  }
  assert.equal((await compiler.advance({ runId: "parent" })).ok, false)
  const irStage = requests.find(request => request.generation_stage === "ir")
  assert.ok(irStage, "the IR stage ran for the batch")
  assert.deepEqual(irStage.carried_delegations?.map(entry => entry.event_id), ["e1", "e2", "e3"],
    "the three oldest uncompiled delegations ride along with their text, under this run's aliases")
  assert.deepEqual(irStage.gap_event_ids, ["e4"], "the delegation beyond the cap is still visible by id")
  const offered = new Set((irStage.source_segments ?? []).map(segment => segment.source_id))
  for (const id of ["e1", "e2", "e3", "e4", "e5"]) {
    assert.ok(offered.has(id), `${id} keeps its text in the IR-stage request`)
  }
})

test("a turn answers its own delegation and carries the earlier uncompiled one as an unresolved task", async () => {
  const seen: CompilerModelV2Input[] = []
  const { store, compiler } = await setup(async input => {
    seen.push(structuredClone(input))
    const proposal = parent()
    // Keep only this turn's event in basis (on both stages): the carried
    // delegation then has no destination, and the batch must be sent back.
    proposal.basis = { event_ids: ["next-turn"], refs: [] }
    if (input.generation_stage === "ir") return JSON.stringify(proposal)
    const next = child(input.parent_basis!)
    next.basis = { event_ids: ["next-turn"], refs: [] }
    return JSON.stringify(next)
  })
  await compiler.acceptEvent({ schema_version: 2, run_id: "parent", event_id: "next-turn", kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text: "Add a status command that prints ok." } })
  assert.equal((await compiler.advance({ runId: "parent" })).ok, false)
  const second = await compiler.advance({ runId: "parent" })
  assert.equal(second.ok, false)
  const carriedRequests = seen.filter(input => input.carried_delegations !== undefined)
  assert.ok(carriedRequests.length > 0, "the turn's batch carries the earlier uncompiled delegation")
  assert.deepEqual(carriedRequests[0]!.events.map(event => event.event_id), ["e2", "e1"])
  assert.deepEqual(carriedRequests[0]!.carried_delegations, [{
    event_id: "e1", sequence: 1, failed_batches: 0, stalled: false,
  }])
  // This defect is reported through the CI-stage candidate check, and that
  // request still shows full ids, so its message keeps naming the full id.
  assert.match(second.message!, /carried delegation input-event-id is missing from basis\.event_ids/)
  assert.deepEqual(store.carriedDelegations().map(gap => ({ id: gap.event_id, failed: gap.failed_batches })),
    [{ id: "input-event-id", failed: 2 }, { id: "next-turn", failed: 2 }])
})

test("resume after a CI transport failure reuses the exact temporary parent without committing it early", async () => {
  const stages: string[] = []
  const parents: unknown[] = []
  let broken = true
  const { store, compiler } = await setup(async input => {
    stages.push(input.generation_stage!)
    if (input.generation_stage === "ir") return JSON.stringify(parent())
    parents.push(structuredClone(input.ir))
    if (broken) throw Error("CI connection interrupted")
    return JSON.stringify(child(input.parent_basis!))
  })
  assert.equal((await compiler.advance({ runId: "parent" })).ok, false)
  const saved = store.current().management_log.at(-1)!
  assert.equal(saved.candidate, undefined)
  assert.equal(saved.generation!.phase, "ci")
  assert.equal(saved.generation!.parent!.ir.t1!.content.length, 4)
  assert.deepEqual(store.current().ir, {})
  broken = false
  const resumed = await compiler.advance({ runId: "parent" })
  assert.equal(resumed.ok, true, resumed.message)
  assert.deepEqual(stages, ["ir", "ci", "ci"])
  assert.deepEqual(parents[0], parents[1])
  assert.equal(store.current().budget.total_management_requests, 4)
  assert.equal(store.current().ir.t1!.content[0]!.revision, 0)
})

test("a child cannot attach to another parent or spend a check on it", async () => {
  let checks = 0
  const { store, compiler } = await setup(async input => JSON.stringify(input.generation_stage === "ir"
    ? parent() : child("a-different-parent")), async () => { checks++; return consistent() })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, false)
  assert.match(result.message!, /different parent basis/)
  assert.equal(checks, 0)
  assert.equal(store.current().budget.total_management_requests, 2)
  assert.deepEqual(store.current().compiled, {})
})

test("generation reserves the complete chain before spending the first request", async () => {
  let calls = 0
  const { store, compiler } = await setup(async () => { calls++; return JSON.stringify(parent()) })
  store.applyDeltas({ max_management_requests: 2 })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, false)
  assert.equal(result.code, "budget_exhausted")
  assert.equal(calls, 0)
  assert.equal(store.current().budget.total_management_requests, 0)
})

test("a reported parent defect returns to IR and invalidates the previous child basis", async () => {
  const stages: string[] = [], bases: string[] = []
  let parents = 0
  const { store, compiler } = await setup(async input => {
    stages.push(input.generation_stage!)
    if (input.generation_stage === "ir") {
      const next = parent()
      if (++parents > 1) {
        const creation = next.groups[0]!.ir_changes[0]!
        if (creation.action === "create") (creation.value as any).current_scope.text += " Preserve the required command interfaces."
      }
      return JSON.stringify(next)
    }
    bases.push(input.parent_basis!)
    if (parents === 1) return JSON.stringify({ ...child(input.parent_basis!), groups: [], parent_issues: ["Clarify the authorized scope in the parent before planning."] })
    return JSON.stringify(child(input.parent_basis!))
  })
  store.applyDeltas({ max_management_requests: 5 })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
  assert.deepEqual(stages, ["ir", "ci", "ir", "ci"])
  assert.notEqual(bases[0], bases[1])
  assert.equal(store.current().budget.total_management_requests, 5)
})

test("a checker identifying an IR defect repairs the parent before recompiling and counts every call", async () => {
  const stages: string[] = []
  let checks = 0, parents = 0
  const { store, compiler } = await setup(async input => {
    stages.push(input.generation_stage!)
    const proposal = parent()
    if (input.generation_stage === "ir" && ++parents > 1) {
      const change = proposal.groups[0]!.ir_changes[0]!
      if (change.action === "create") (change.value as any).current_scope.text += " Retain all required behavior."
    }
    return { text: JSON.stringify(input.generation_stage === "ir" ? proposal : child(input.parent_basis!)), usage: { input_tokens: 2, output_tokens: 1 } }
  }, async () => {
    checks++
    if (checks > 1) return consistent()
    return JSON.stringify({ schema_version: 2, verdict: "inconsistent", repair_target: "ir", findings: [{
      dimension: "D2", claim: "Parent scope needs correction", expected: "Retain all required behavior", observed: "Parent scope omits required scope detail",
      refs: [{ source_id: "input-event-id", digest: CANDIDATE_EXAMPLE.groups[0]!.ir_changes[0]!.sources[0]!.digest, span: { unit: "utf16", start: 0, end: CANDIDATE_EXAMPLE_INPUT.indexOf("\n\n") } }],
    }] })
  })
  store.applyDeltas({ max_management_requests: 6 })
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
  assert.deepEqual(stages, ["ir", "ci", "ir", "ci"])
  assert.equal(checks, 2)
  assert.equal(store.current().budget.total_management_requests, 6)
  assert.deepEqual(store.current().management_calls.filter(c => c.kind === "propose").map(c => c.generation_stage), stages)
  assert.equal(store.current().ir.t1!.revision, 0, "temporary creation is applied only once to the original baseline")
})

test("changed host facts invalidate a saved temporary parent before resume", async () => {
  const requests: CompilerModelV2Input[] = []
  const { store, compiler } = await setup(async input => {
    requests.push(structuredClone(input))
    if (input.generation_stage === "ir") return JSON.stringify(parent())
    throw Error("CI connection interrupted")
  })
  assert.equal((await compiler.advance({ runId: "parent" })).ok, false)
  const stages: string[] = []
  const resumed = createIntentCompilerV2({ store,
    capabilities: { operations: ["read", "edit", "bash"], workspace_root: "D:/changed-authorized-workspace" },
    model: createCompilerModelV2(async input => {
      stages.push(input.generation_stage!)
      requests.push(structuredClone(input))
      return JSON.stringify(input.generation_stage === "ir" ? parent() : child(input.parent_basis!))
    }, consistent),
  })
  const result = await resumed.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
  assert.deepEqual(stages, ["ir", "ci"])
  const irRequests = requests.filter(request => request.generation_stage === "ir")
  assert.ok(irRequests.length >= 2, "both the failed batch and the resumed batch asked for an IR stage")
  assert.ok(irRequests.every(request => request.events[0]!.event_id === "e1"),
    "a resume rebuilds the same alias from the journal")
})

test("Resume returns a rejected stage response to that stage and clears its feedback before compiling", async () => {
  let broken = true
  const invalid = JSON.stringify({ ...parent(), forbidden_plan: "not an IR field" })
  const { store, compiler } = await setup(async input => {
    if (broken) return invalid
    if (input.generation_stage === "ir") {
      assert.equal(input.schema_rejected_draft?.text, invalid)
      return JSON.stringify(parent())
    }
    assert.equal(input.schema_rejected_draft, undefined)
    assert.deepEqual(input.validation_errors ?? [], [])
    return JSON.stringify(child(input.parent_basis!))
  })
  assert.equal((await compiler.advance({ runId: "parent" })).ok, false)
  assert.deepEqual(store.current().ir, {})
  broken = false
  const result = await compiler.advance({ runId: "parent" })
  assert.equal(result.ok, true, result.message)
})

test("an execution return is assessed by the CI stage alone and can never become an IR source", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "assessment-batch-")), runId: "assess" })
  const batches: Array<{ stage?: string; assessment?: boolean }> = []
  let returned = false
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async input => {
      batches.push({ stage: input.generation_stage, assessment: input.assessment_batch })
      if (!returned) return JSON.stringify(input.generation_stage === "ir" ? parent() : child(input.parent_basis!))
      // The assessment batch: no IR stage ran, so this stage authors the
      // decisions the plan is committed from, with the return as evidence.
      const atom = input.compiled!.t1!.atoms[0]!
      return JSON.stringify({
        schema_version: 2,
        basis: { event_ids: ["return"], refs: [] },
        parent_basis: input.parent_basis!,
        parent_issues: [],
        groups: [{
          local_ref: "t1", task_refs: ["t1"], depends_on: [],
          compilation: { decision: "reuse", current: [compiledIntentRef(input.compiled!.t1!)], reason: "the plan is unchanged" },
          execution_decisions: [],
          assessments: [{
            target_ref: atomRef(atom), criteria_refs: atom.goal_refs,
            evidence_refs: [{ source_id: "return", digest: input.event_source_refs!.find(ref => ref.source_id === "return")!.digest }],
            result: "unknown", explanation: "the return reports no products or evidence to accept", method: "model",
          }],
          coverage: [], checks: [], questions: [],
        }],
      })
    }, consistent),
  })
  await compiler.acceptEvent({ schema_version: 2, run_id: "assess", event_id: "input-event-id", kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text: CANDIDATE_EXAMPLE_INPUT } })
  const first = await compiler.advance({ runId: "assess" })
  assert.equal(first.ok, true, first.message)
  const irAfterFirst = structuredClone(store.current().ir)
  const dispatch = first.deliveries![0]!
  const start = compiler.authorize({ kind: "start", run_id: "assess", dispatch_id: dispatch.dispatch_id, host_identity: "host" })
  assert.equal(start.ok, true)
  const receipt = await compiler.acceptEvent({ schema_version: 2, run_id: "assess", event_id: "return", kind: "execution_return",
    source: { producer_id: "host", channel: "executor" }, execution_id: start.execution_id!,
    payload: { state_claim: "stopped", text: "Ran the work; no product references or evidence attached.", outcome: {
      schema_version: 2, execution_id: start.execution_id!, atom_ref: atomRef(dispatch.atom), suggested_status: "ready",
      product_refs: [], file_changes: [], evidence_refs: [],
    } },
  })
  assert.equal(receipt.ok, true)
  returned = true
  const before = batches.length
  const second = await compiler.advance({ runId: "assess" })
  assert.equal(second.ok, true, second.message)
  assert.deepEqual(batches.slice(before), [{ stage: "ci", assessment: true }],
    "a returned execution is assessed by the CI stage alone: no IR stage runs and no IR source is selected")
  assert.deepEqual(store.current().ir, irAfterFirst, "assessing a return must not rewrite the user's IR")
  assert.equal(store.current().assessments.at(-1)!.result, "unknown")
  assert.deepEqual(store.current().assessments.at(-1)!.basis_event_ids, ["return"])
})

test("an assessment that finds the stored IR defective records it and still completes the return batch", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "assessment-repair-")), runId: "repair" })
  store.applyDeltas({ max_management_requests: 6 })
  const batches: Array<{ stage?: string; assessment?: boolean }> = []
  let returned = false
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async input => {
      batches.push({ stage: input.generation_stage, assessment: input.assessment_batch })
      if (!returned) return JSON.stringify(input.generation_stage === "ir" ? parent() : child(input.parent_basis!))
      // The assessment reports a defect in the stored IR instead of compiling around it.
      return JSON.stringify({ schema_version: 2, basis: { event_ids: ["return"], refs: [] },
        parent_basis: input.parent_basis!, parent_issues: ["the stored content selection must exclude the host's wrapper quotes"], groups: [] })
    }, consistent),
  })
  await compiler.acceptEvent({ schema_version: 2, run_id: "repair", event_id: "input-event-id", kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text: CANDIDATE_EXAMPLE_INPUT } })
  const first = await compiler.advance({ runId: "repair" })
  assert.equal(first.ok, true, first.message)
  const start = compiler.authorize({ kind: "start", run_id: "repair", dispatch_id: first.deliveries![0]!.dispatch_id, host_identity: "host" })
  assert.equal(start.ok, true)
  assert.equal((await compiler.acceptEvent({ schema_version: 2, run_id: "repair", event_id: "return", kind: "execution_return",
    source: { producer_id: "host", channel: "executor" }, execution_id: start.execution_id!,
    payload: { state_claim: "stopped", text: "Ran the work.", outcome: {
      schema_version: 2, execution_id: start.execution_id!, atom_ref: atomRef(first.deliveries![0]!.atom), suggested_status: "ready",
      product_refs: [], file_changes: [], evidence_refs: [],
    } },
  })).ok, true)
  returned = true
  const irBeforeReturn = structuredClone(store.current().ir)
  const second = await compiler.advance({ runId: "repair" })
  assert.equal(second.ok, true, second.message)
  assert.deepEqual(batches.slice(-1), [{ stage: "ci", assessment: true }],
    "the return batch assesses through the CI stage only: the IR is not revised from an execution return")
  assert.equal(second.disposition, "waiting")
  assert.match(second.questions?.[0] ?? "", /wrapper quotes/)
  assert.deepEqual(store.current().ir, irBeforeReturn, "the stored IR is unchanged")
  assert.deepEqual(store.current().pending_event_ids, [], "the return is consumed, not requeued")
  const record = store.current().management_log.at(-1)!
  assert.equal(record.status, "accepted")
  assert.equal(record.error_code, "assessment_deferred")
  assert.deepEqual(record.trigger_event_ids, ["return"])
  assert.deepEqual(store.current().questions.map(question => question.text), second.questions)
})
