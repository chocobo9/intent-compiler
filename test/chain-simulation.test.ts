import { test } from "node:test"
import assert from "node:assert/strict"
import { atomRef } from "../src/core/compiled-intent.js"
import { digestOf, digestText, type AtomDraft, type Candidate, type SourceRef } from "../src/core/intent-contract.js"
import { CANDIDATE_EXAMPLE_INPUT } from "../src/model/candidate-example.js"
import type { CompilerModelV2CheckInput, CompilerModelV2Input } from "../src/model/compiler-model-v2.js"
import { assessmentAnswer, ChainHost, chainCandidate, type ExecutorScript, type ReturnJudgement, type RoundRecord } from "./fixtures/chain-harness.js"
import { stageCandidate } from "./fixtures/stage-candidate.js"

// Offline chain simulation (chain-gate-audit-2026-10-06): real compiler, adapter
// and host turn loop; scripted management and executor.  Each scenario states
// what a round should end with; the audit item it covers is named in the title.

type Judge =(atomId: string, executionId: string, input: CompilerModelV2Input) => ReturnJudgement | string

function userEventOf(input: CompilerModelV2Input): string {
  const event = input.events.find(item => item.kind === "user_input")
  assert.ok(event, "a delegation batch carries its user input")
  return event.event_id
}

/** Scripted management: the plan for delegation batches, `judge` for return batches. */
function management(plan: (userEventId: string, input: CompilerModelV2Input) => Candidate, judge: Judge) {
  const calls: Array<{ stage: string; events: string[] }> = []
  const propose = async (input: CompilerModelV2Input, generation?: { checkRequired?: boolean }) => {
    calls.push({ stage: input.assessment_batch === true ? "assessment" : input.generation_stage ?? "single", events: input.events.map(e => e.event_id) })
    if (input.assessment_batch === true) {
      let raw: string | undefined
      const answer = assessmentAnswer(input, (atomId, executionId) => {
        const judged = judge(atomId, executionId, input)
        if (typeof judged === "string") { raw = judged; return { result: "unknown" } }
        return judged
      })
      return raw ?? answer
    }
    return JSON.stringify(stageCandidate(input, plan(userEventOf(input), input), generation))
  }
  return { calls, propose }
}

const satisfied: Judge = () => ({ result: "satisfied" })

function chainOrder(host: ChainHost): string[] {
  const snapshot = host.snapshot()
  return snapshot.executions.map(e => {
    const dispatch = snapshot.dispatches.find(d => d.dispatch_id === e.dispatch_id)!
    return `${dispatch.atom_id}@${dispatch.atom_revision}`
  })
}

function report(name: string, round: RoundRecord, host: ChainHost): void {
  const lines = [
    `[chain-sim] ${name}`,
    `  user turn: offered=${JSON.stringify(round.user.offered)} executions=${round.user.executions.length}${round.user.error ? ` error=${round.user.error.code}: ${round.user.error.message.slice(0, 300)}` : ""}`,
    ...round.host.turns.map((turn, i) => `  host turn ${i + 1}: offered=${JSON.stringify(turn.offered)} executions=${turn.executions.length}${turn.error ? ` error=${turn.error.code}: ${turn.error.message.slice(0, 300)}` : ""}`),
    `  host loop stopped: ${round.host.stopped} (cap ${round.host.cap})`,
    `  executed in order: ${JSON.stringify(chainOrder(host))}`,
    `  pending events at round end: ${JSON.stringify(round.pendingEventIds)}; pending dispatches: ${round.pendingDispatches.length}`,
  ]
  console.log(lines.join("\n"))
}

test("scenario 1: a five-Atom serial chain runs to the end within one round (satisfied and unknown both admit)", async () => {
  const chain = ["a-bundle", "a-inspect", "a-step3", "a-step4", "a-step5"]
  const scripted = management(event => chainCandidate(5, event),
    atomId => ({ result: atomId === "a-inspect" ? "unknown" : "satisfied" }))
  const host = new ChainHost({ propose: scripted.propose })
  const round = await host.round(CANDIDATE_EXAMPLE_INPUT)
  report("scenario 1", round, host)
  assert.deepEqual(chainOrder(host), chain.map(id => `${id}@0`))
  assert.deepEqual(round.pendingEventIds, [], "every return was assessed within the round")
  assert.deepEqual(round.pendingDispatches, [])
})

test("scenario 1b: executor variants (recovered tool error, stop, timeout) still finish the chain within the round", async () => {
  // a-inspect stops mid tool call once and a-step3 cannot be reconciled once;
  // code runs each version again.  a-bundle recovers from a failed patch.
  const runs = new Map<string, number>()
  const executor = (offered: readonly string[]): ExecutorScript => {
    const version = offered[0]!
    const n = (runs.get(version) ?? 0) + 1
    runs.set(version, n)
    if (version === "a-bundle@0") return "tool_error_then_completed"
    if (version === "a-inspect@0" && n === 1) return "stopped"
    if (version === "a-step3@0" && n === 1) return "timeout"
    return "completed"
  }
  const scripted = management(event => chainCandidate(3, event), (_atom, _execution, input) => {
    const ret = input.events.find(e => e.kind === "execution_return")!
    const claim = (ret.payload as { state_claim: string }).state_claim
    return { result: claim === "completed" ? "satisfied" : "unknown" }
  })
  const host = new ChainHost({ propose: scripted.propose, executor })
  const round = await host.round(CANDIDATE_EXAMPLE_INPUT)
  report("scenario 1b", round, host)
  assert.deepEqual(chainOrder(host), ["a-bundle@0", "a-inspect@0", "a-inspect@0", "a-step3@0", "a-step3@0"])
  assert.deepEqual(round.pendingEventIds, [])
})

test("scenario 2 (B1): a return batch that fails once is recovered within the same round", async () => {
  let host: ChainHost | undefined
  const failedBatches = (eventId: string) => host!.snapshot().management_log
    .filter(record => record.status !== "accepted" && record.trigger_event_ids.includes(eventId)).length
  const scripted = management(event => chainCandidate(3, event), (atomId, executionId) => {
    // Every answer in the first batch for a-inspect's return is unusable, so
    // that batch fails as a whole; later batches answer normally.
    if (atomId === "a-inspect" && failedBatches(`${executionId}:return`) === 0) return "the provider returned prose instead of JSON"
    return { result: "satisfied" }
  })
  host = new ChainHost({ propose: scripted.propose })
  const round = await host.round(CANDIDATE_EXAMPLE_INPUT)
  report("scenario 2", round, host)
  const inspectReturn = host.snapshot().executions.find(e => host!.snapshot().dispatches.find(d => d.dispatch_id === e.dispatch_id)?.atom_id === "a-inspect")!
  assert.equal(failedBatches(`${inspectReturn.execution_id}:return`), 1, "the failure was injected: one batch failed")
  assert.deepEqual(chainOrder(host), ["a-bundle@0", "a-inspect@0", "a-step3@0"], "the successor still runs this round")
  assert.deepEqual(round.pendingEventIds, [])
})

test("scenario 3 (B2): two returns pending at once are both assessed and the successor is not delayed", async () => {
  // a-bundle and a-inspect are independent and delivered in one turn; a-step3 follows a-inspect.
  const plan = (event: string) => {
    const candidate = chainCandidate(3, event)
    const group = candidate.groups[0]!
    if (group.compilation.decision !== "replace") throw Error("fixture")
    const draft = group.compilation.drafts[0]!
    draft.relations = draft.relations.filter(r => !("local_ref" in r.predecessor && r.predecessor.local_ref === "a-bundle"))
    return candidate
  }
  const scripted = management(plan, satisfied)
  const host = new ChainHost({ propose: scripted.propose })
  const round = await host.round(CANDIDATE_EXAMPLE_INPUT)
  report("scenario 3", round, host)
  assert.deepEqual(round.user.offered, ["a-bundle@0", "a-inspect@0"], "both heads are delivered in one turn")
  assert.deepEqual(chainOrder(host), ["a-bundle@0", "a-inspect@0", "a-step3@0"])
  assert.deepEqual(round.pendingEventIds, [])
})

test("scenario 4 (A1, A5): copied-wrong target_ref and criteria_refs digests are bound by code, and the chain runs on", async () => {
  const wrong = `sha256:${"0".repeat(63)}1`
  const scripted = management(event => chainCandidate(3, event), atomId => atomId === "a-bundle"
    ? { result: "satisfied", targetRef: ref => ({ ...ref, digest: wrong }), criteriaRefs: refs => refs.map(ref => ({ ...ref, digest: wrong })) }
    : { result: "satisfied" })
  const host = new ChainHost({ propose: scripted.propose })
  const round = await host.round(CANDIDATE_EXAMPLE_INPUT)
  report("scenario 4", round, host)
  assert.deepEqual(chainOrder(host), ["a-bundle@0", "a-inspect@0", "a-step3@0"])
  assert.deepEqual(round.pendingEventIds, [])
  const snapshot = host.snapshot()
  const bundle = snapshot.compiled.t1!.atoms.find(atom => atom.atom_id === "a-bundle")!
  const judged = snapshot.assessments.find(record => record.target_ref.id === "a-bundle")!
  assert.deepEqual(judged.target_ref, atomRef(bundle), "the target is the version that execution ran")
  const items = new Map(snapshot.ir.t1!.content.map(item => [item.item_id, digestOf(item)]))
  assert.ok(judged.criteria_refs.length > 0)
  for (const ref of judged.criteria_refs) assert.equal("id" in ref ? ref.digest : undefined, "id" in ref ? items.get(ref.id) : undefined, "criteria digests are the stored items'")
})

test("scenario 4b (A2): a return batch whose basis.event_ids were written wrong is accepted with the batch's events", async () => {
  const scripted = management(event => chainCandidate(2, event), (_atom, _execution, input) => {
    const answer = JSON.parse(assessmentAnswer(input, () => ({ result: "satisfied" })))
    answer.basis.event_ids = ["execution-99:return"]
    return JSON.stringify(answer)
  })
  const host = new ChainHost({ propose: scripted.propose })
  const round = await host.round(CANDIDATE_EXAMPLE_INPUT)
  report("scenario 4b", round, host)
  assert.deepEqual(chainOrder(host), ["a-bundle@0", "a-inspect@0"])
  assert.deepEqual(round.pendingEventIds, [])
  const returnBatch = host.snapshot().management_log.find(record => record.trigger_event_ids.some(id => id.endsWith(":return")))!
  assert.equal(returnBatch.status, "accepted")
})

test("scenario 4c: an assessment naming no Atom version is rejected with the reason, not committed as a judgement of nothing", async () => {
  const scripted = management(event => chainCandidate(2, event), atomId => atomId === "a-bundle"
    ? { result: "satisfied", targetRef: ref => ({ ...ref, id: "a-unknown" }) }
    : { result: "satisfied" })
  const host = new ChainHost({ propose: scripted.propose })
  const round = await host.round(CANDIDATE_EXAMPLE_INPUT)
  report("scenario 4c", round, host)
  const failed = host.snapshot().management_log.filter(record => record.status !== "accepted")
  assert.ok(failed.length > 0)
  assert.match(failed[0]!.error_message ?? "", /target_ref names no Atom version of this plan: a-unknown@0/)
})

const UPDATE = "An empty items array produces a bundle file containing [] followed by a newline."

/** R2: revise r-bundle from the update and recompile a-bundle as revision 1 of the completed version. */
function revisionPlan(host: ChainHost, edit: { previousDigest?: string; expectedRevision?: number }) {
  return (event: string): Candidate => {
    const first = host.events().find(e => e.kind === "user_input")!
    const candidate = chainCandidate(2, first.event_id)
    const group = candidate.groups[0]!
    const update: SourceRef = { source_id: event, digest: digestText(UPDATE), span: { unit: "utf16", start: 0, end: UPDATE.length } }
    const behavior = "an empty items array produces []."
    const at = CANDIDATE_EXAMPLE_INPUT.indexOf(behavior)
    assert.ok(at >= 0)
    const old: SourceRef = { source_id: first.event_id, digest: digestText(CANDIDATE_EXAMPLE_INPUT), span: { unit: "utf16", start: at - 2, end: at + behavior.length } }
    candidate.basis.event_ids = [event]
    candidate.source_coverage = [
      { source: update, disposition: "normative", requirements: [{ local_ref: "r-bundle" }], reason: "The user changes the empty-items output.", basis: [] },
      { source: old, disposition: "superseded", requirements: [], reason: "Replaced by the update.", basis: [update] },
    ]
    const stored = host.snapshot().ir.t1!.content.find(item => item.item_id === "r-bundle")!
    group.ir_changes = [{ action: "revise", target: "content", id: stored.item_id, expected_revision: edit.expectedRevision ?? stored.revision,
      value: { text: "Bundle configuration, ordered reading and empty-input behavior.", about: [], scope: [{ target_id: "t1" }], support: [] },
      // Withdraw the replaced sentence (and its "; " separator) from the passage that held it.
      sources: [...stored.sources.map(ref => ref.span && ref.span.start <= at && ref.span.end >= at + behavior.length
        ? { ...ref, span: { ...ref.span, end: at - 2 } } : ref), update] }]
    if (group.compilation.decision !== "replace") throw Error("fixture")
    const prior = host.snapshot().compiled.t1!.atoms.find(a => a.atom_id === "a-bundle" && a.revision === 0)!
    const bundle = group.compilation.drafts[0]!.atoms.find(a => a.atom_id === "a-bundle")! as AtomDraft
    bundle.revision = 1
    bundle.previous_atom_ref = { ...atomRef(prior), ...(edit.previousDigest === undefined ? {} : { digest: edit.previousDigest }) }
    bundle.task = `${bundle.task}\n\n${UPDATE}`
    return candidate
  }
}

for (const variant of [
  { name: "scenario 5 control: R1→R2 revision with correct identities", edit: {} },
  { name: "scenario 5a (A3): R2 revision whose previous_atom_ref digest was copied wrong", edit: { previousDigest: `sha256:${"0".repeat(63)}2` } },
  { name: "scenario 5b (A4): R2 revision whose expected_revision is wrong", edit: { expectedRevision: 3 } },
]) test(variant.name, async () => {
  let plan: (event: string) => Candidate = event => chainCandidate(2, event)
  const scripted = management(event => plan(event), satisfied)
  const host = new ChainHost({ propose: scripted.propose })
  const first = await host.round(CANDIDATE_EXAMPLE_INPUT)
  assert.deepEqual(chainOrder(host), ["a-bundle@0", "a-inspect@0"], "R1 completes")
  assert.deepEqual(first.pendingEventIds, [])
  plan = revisionPlan(host, variant.edit)
  const second = await host.round(UPDATE, { source_category: "update" })
  report(variant.name, second, host)
  assert.equal(second.user.error, undefined, "the R2 delegation batch is accepted")
  assert.ok(chainOrder(host).includes("a-bundle@1"), "the revised Atom runs in R2")
  assert.deepEqual(second.pendingEventIds, [])
})

test("scenario 5c (A4): two changes to one IR object in a batch are still rejected, with the reason", async () => {
  let plan: (event: string) => Candidate = event => chainCandidate(2, event)
  const scripted = management(event => plan(event), satisfied)
  const host = new ChainHost({ propose: scripted.propose })
  await host.round(CANDIDATE_EXAMPLE_INPUT)
  const revise = revisionPlan(host, {})
  plan = event => {
    const candidate = revise(event)
    const change = candidate.groups[0]!.ir_changes[0]!
    candidate.groups[0]!.ir_changes.push(structuredClone(change))
    return candidate
  }
  const second = await host.round(UPDATE, { source_category: "update" })
  report("scenario 5c", second, host)
  assert.match(second.user.error?.message ?? "", /already changed content r-bundle to revision 1/)
})

test("scenario 6 (B4): where a delegation batch closes after check rework, under an 8-request batch budget", async () => {
  let checks = 0
  const check = async (input: CompilerModelV2CheckInput) => {
    checks += 1
    if (checks > 2) return JSON.stringify({ schema_version: 2, verdict: "consistent", findings: [] })
    const event = input.events.find(e => e.kind === "user_input")!
    const text = (event.payload as { text: string }).text
    return JSON.stringify({ schema_version: 2, verdict: "inconsistent", repair_target: "ir", findings: [{
      dimension: "D2", claim: "the IR drops a source rule", expected: "the rule is kept", observed: "it is missing",
      refs: [{ source_id: event.event_id, digest: digestText(text) }] }] })
  }
  const scripted = management(event => chainCandidate(2, event), satisfied)
  const host = new ChainHost({ propose: scripted.propose, check, budget: { perBatch: 8, total: 180 } })
  const round = await host.round(CANDIDATE_EXAMPLE_INPUT)
  report("scenario 6", round, host)
  const log = host.snapshot().management_log
  const calls = log.map(batch => (batch.attempts ?? []).map(a => a.generation_stage ?? a.kind))
  log.forEach((batch, i) => console.log(`  [scenario 6] batch ${i + 1}: status=${batch.status} error=${batch.error_code ?? "-"} calls=${JSON.stringify(calls[i])} used=${calls[i]!.length}`))
  // Recorded, not a target: the B4 change waits for review.  IR→CI→check costs
  // 3 and an IR-targeted rejection restarts at IR, so two rejections use 6 of 8
  // requests and the third attempt (3 more) no longer fits: the delegation
  // batch closes with 2 unused.  A host turn then runs management once more
  // (B1), and that batch, starting over at IR, is accepted.
  assert.equal(log[0]!.status, "validation_failed")
  assert.deepEqual(calls[0], ["ir", "ci", "check", "ir", "ci", "check"])
  assert.equal(log[1]!.status, "accepted")
  assert.deepEqual(calls[1], ["ir", "ci", "check"])
  assert.equal(round.host.turns[0]!.offered[0], "a-bundle@0")
})
