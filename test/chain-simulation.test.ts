import { test } from "node:test"
import assert from "node:assert/strict"
import { deliveredAtoms } from "../src/adapters/opencode.js"
import { atomRef, compiledIntentRef } from "../src/core/compiled-intent.js"
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
  // A rerun of an incomplete return carries nothing beside the Atom.
  for (const turn of host.turns.filter(turn => turn.text !== undefined)) assert.deepEqual(JSON.parse(turn.text!), deliveredAtoms(turn.text!), turn.session)
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

// Identities code binds (identity-versions): the answer names objects by id; the
// version is code's.  Each scenario writes the field wrong or leaves it out.

/** The R2 plan with the model's version claims made wrong: a stale destination version, bad revisions, no previous_atom_ref. */
function sloppyRevisionPlan(host: ChainHost, tweak: (candidate: Candidate) => void = () => undefined) {
  const revise = revisionPlan(host, {})
  return (event: string): Candidate => {
    const candidate = revise(event)
    const group = candidate.groups[0]!
    if (group.compilation.decision !== "replace") throw Error("fixture")
    const atoms = group.compilation.drafts[0]!.atoms as AtomDraft[]
    const bundle = atoms.find(a => a.atom_id === "a-bundle")!
    const inspect = atoms.find(a => a.atom_id === "a-inspect")!
    bundle.revision = 0
    delete bundle.previous_atom_ref
    inspect.revision = 5
    for (const entry of group.coverage) {
      entry.refs = entry.refs.map(ref => "local_ref" in ref && ref.local_ref === "a-bundle"
        ? { id: "a-bundle", revision: 0, digest: `sha256:${"0".repeat(63)}9` } : ref)
    }
    tweak(candidate)
    return candidate
  }
}

test("scenario 5d: Atom revisions are code's (new 0, unchanged kept, changed +1) and a stale coverage destination is bound to the current version", async () => {
  let plan: (event: string) => Candidate = event => chainCandidate(2, event)
  const scripted = management(event => plan(event), satisfied)
  const host = new ChainHost({ propose: scripted.propose })
  // R1: the model wrote revision 3 for new Atoms; the plan stores 0.
  plan = event => {
    const candidate = chainCandidate(2, event)
    const group = candidate.groups[0]!
    if (group.compilation.decision !== "replace") throw Error("fixture")
    for (const atom of group.compilation.drafts[0]!.atoms) atom.revision = 3
    return candidate
  }
  await host.round(CANDIDATE_EXAMPLE_INPUT)
  assert.deepEqual(chainOrder(host), ["a-bundle@0", "a-inspect@0"], "a new atom_id starts at revision 0 whatever was written")
  plan = sloppyRevisionPlan(host)
  const second = await host.round(UPDATE, { source_category: "update" })
  assert.equal(second.user.error, undefined, "a stale destination version no longer rejects the batch")
  const snapshot = host.snapshot()
  const atoms = snapshot.compiled.t1!.atoms
  assert.deepEqual(atoms.filter(a => a.atom_id === "a-bundle").map(a => a.revision).sort(), [0, 1], "changed content takes the latest revision plus one")
  assert.deepEqual(atoms.filter(a => a.atom_id === "a-inspect").map(a => a.revision), [0], "unchanged content keeps its revision, whatever was written")
  const bundle1 = atoms.find(a => a.atom_id === "a-bundle" && a.revision === 1)!
  const state = snapshot.atom_states.find(s => s.atom_id === "a-bundle" && s.atom_revision === 1)!
  assert.deepEqual(state.previous_atom_ref, atomRef(atoms.find(a => a.atom_id === "a-bundle" && a.revision === 0)!), "the supersession is filled for the same id")
  const recorded = snapshot.management_log.filter(record => record.candidate?.groups[0]?.coverage.length).at(-1)!.candidate!.groups[0]!
  const destinations = recorded.coverage.flatMap(entry => entry.refs).filter(ref => "id" in ref && ref.id === "a-bundle")
  assert.ok(destinations.length > 0)
  for (const ref of destinations) assert.deepEqual(ref, atomRef(bundle1), "the destination is the version in this plan")
})

test("scenario 5e: previous_atom_ref names another Atom by id only; code binds that Atom's latest version", async () => {
  let plan: (event: string) => Candidate = event => chainCandidate(2, event)
  const scripted = management(event => plan(event), satisfied)
  const host = new ChainHost({ propose: scripted.propose })
  await host.round(CANDIDATE_EXAMPLE_INPUT)
  plan = sloppyRevisionPlan(host, candidate => {
    // a-bundle is replaced by a differently named Atom; the model writes a stale version of the replaced one.
    const text = JSON.stringify(candidate).replaceAll('"a-bundle"', '"a-bundle-v2"')
    Object.assign(candidate, JSON.parse(text) as Candidate)
    const group = candidate.groups[0]!
    if (group.compilation.decision !== "replace") throw Error("fixture")
    const replacement = group.compilation.drafts[0]!.atoms.find(a => a.atom_id === "a-bundle-v2")!
    replacement.previous_atom_ref = { id: "a-bundle", revision: 7, digest: "sha256:stale" }
  })
  const second = await host.round(UPDATE, { source_category: "update" })
  assert.equal(second.user.error, undefined, second.user.error?.message)
  const snapshot = host.snapshot()
  const held = snapshot.compiled.t1!.atoms.find(a => a.atom_id === "a-bundle")!
  const replacement = snapshot.compiled.t1!.atoms.find(a => a.atom_id === "a-bundle-v2")!
  assert.equal(replacement.revision, 0, "a new id starts at 0")
  assert.deepEqual(snapshot.atom_states.find(s => s.atom_id === "a-bundle-v2")!.previous_atom_ref, atomRef(held), "the other id is kept and bound to its latest version")
})

test("scenario 4d: a return batch's reuse, decision basis, criteria and coverage requirement are bound by code", async () => {
  const scripted = management(event => chainCandidate(2, event), (_atom, _execution, input) => {
    const answer = JSON.parse(assessmentAnswer(input, () => ({ result: "satisfied" })))
    const returnEvent = input.events.find(e => e.kind === "execution_return")!
    const group = answer.groups[0]
    group.compilation.current = [{ id: "compiled-99", revision: 4, digest: "sha256:wrong" }]
    for (const decision of group.execution_decisions) decision.basis = [{ id: "a-unknown", revision: 3, digest: "sha256:wrong" }]
    for (const assessment of group.assessments) assessment.criteria_refs = [
      { source_id: returnEvent.event_id, digest: "sha256:r", segment_id: "s1" },
      { id: "r-bundle", revision: 9, digest: "sha256:wrong" },
    ]
    group.coverage = [{ requirement: { id: "r-bundle", revision: 9, digest: "sha256:wrong" }, disposition: "assigned", refs: [{ id: "a-bundle", revision: 4, digest: "sha256:wrong" }], explanation: "kept" }]
    return JSON.stringify(answer)
  })
  const host = new ChainHost({ propose: scripted.propose })
  const round = await host.round(CANDIDATE_EXAMPLE_INPUT)
  assert.deepEqual(chainOrder(host), ["a-bundle@0", "a-inspect@0"])
  assert.deepEqual(round.pendingEventIds, [])
  const snapshot = host.snapshot()
  const recorded = snapshot.management_log.find(record => record.trigger_event_ids.some(id => id.endsWith(":return")))!.candidate!.groups[0]!
  if (recorded.compilation.decision !== "reuse") throw Error("fixture")
  assert.deepEqual(recorded.compilation.current, [compiledIntentRef(snapshot.compiled.t1!)], "reuse.current is the group's Compiled Intent")
  const ran = new Map(snapshot.dispatches.map(d => [d.dispatch_id, d]))
  for (const decision of recorded.execution_decisions) {
    const execution = snapshot.executions.find(e => e.execution_id === decision.execution_id)!
    const dispatch = ran.get(execution.dispatch_id)!
    const atom = snapshot.compiled.t1!.atoms.find(a => a.atom_id === dispatch.atom_id && a.revision === dispatch.atom_revision)!
    assert.deepEqual(decision.basis, [atomRef(atom)], "the basis is the Atom version the execution ran")
  }
  const item = snapshot.ir.t1!.content.find(c => c.item_id === "r-bundle")!
  for (const assessment of recorded.assessments) {
    assert.deepEqual(assessment.criteria_refs, [{ id: "r-bundle", revision: item.revision, digest: digestOf(item) }], "a return text is no criterion; an IR id gets its current version")
  }
  assert.deepEqual(recorded.coverage[0]!.requirement, { id: "r-bundle", revision: item.revision, digest: digestOf(item) }, "an assessment's coverage requirement is bound like an ordinary one")
})

test("scenario 4e: a criterion naming no IR item is rejected with the reason", async () => {
  const scripted = management(event => chainCandidate(2, event), (_atom, _execution, input) => {
    const answer = JSON.parse(assessmentAnswer(input, () => ({ result: "satisfied" })))
    for (const assessment of answer.groups[0].assessments) assessment.criteria_refs = [{ id: "r-nowhere", revision: 0, digest: "sha256:x" }]
    return JSON.stringify(answer)
  })
  const host = new ChainHost({ propose: scripted.propose })
  await host.round(CANDIDATE_EXAMPLE_INPUT)
  const failed = host.snapshot().management_log.filter(record => record.status !== "accepted")
  assert.ok(failed.length > 0)
  assert.match(failed[0]!.error_message ?? "", /criteria_refs names r-nowhere, which is no IR item of task t1/)
})

test("scenario 5f: a requirement's about and support name stored objects by id; code binds their version and digest", async () => {
  let plan: (event: string) => Candidate = event => chainCandidate(2, event)
  const scripted = management(event => plan(event), satisfied)
  const host = new ChainHost({ propose: scripted.propose })
  await host.round(CANDIDATE_EXAMPLE_INPUT)
  const stored = new Map(host.snapshot().ir.t1!.content.map(item => [item.item_id, item]))
  plan = sloppyRevisionPlan(host, candidate => {
    const change = candidate.groups[0]!.ir_changes[0]!
    if (change.action !== "revise" || change.target !== "content") throw Error("fixture")
    const value = change.value as Record<string, unknown>
    value.about = [{ id: "r-format" }]
    value.support = [{ refs: [{ id: "r-common" }], explanation: "shared rule" }]
  })
  const second = await host.round(UPDATE, { source_category: "update" })
  assert.equal(second.user.error, undefined, second.user.error?.message)
  const revised = host.snapshot().ir.t1!.content.find(c => c.item_id === "r-bundle")!
  const format = stored.get("r-format")!
  assert.deepEqual(revised.about, [{ id: "r-format", revision: format.revision, digest: digestOf(format) }])
  const common = stored.get("r-common")!
  assert.deepEqual(revised.support[0]!.refs, [{ id: "r-common", revision: common.revision, digest: digestOf(common) }])
})

test("scenario 5g: an about naming neither a supplied object nor one created in the batch is rejected", async () => {
  let plan: (event: string) => Candidate = event => chainCandidate(2, event)
  const scripted = management(event => plan(event), satisfied)
  const host = new ChainHost({ propose: scripted.propose })
  await host.round(CANDIDATE_EXAMPLE_INPUT)
  plan = sloppyRevisionPlan(host, candidate => {
    const change = candidate.groups[0]!.ir_changes[0]!
    if (change.action !== "revise" || change.target !== "content") throw Error("fixture")
    ;(change.value as Record<string, unknown>).about = [{ id: "r-nowhere" }]
  })
  const second = await host.round(UPDATE, { source_category: "update" })
  assert.match(second.user.error?.message ?? "", /about names r-nowhere, which is neither an object of the supplied IR nor created in this batch/)
})

/** Management wrapped to keep every request and to make each delegation batch's answer carry an assessment, as an earlier-shape model would. */
function recording(scripted: ReturnType<typeof management>) {
  const requests: CompilerModelV2Input[] = []
  const propose = async (input: CompilerModelV2Input, generation?: { checkRequired?: boolean }) => {
    requests.push(structuredClone(input))
    const raw = await scripted.propose(input, generation)
    if (input.generation_stage !== "ci" || input.assessment_batch === true) return raw
    const answer = JSON.parse(raw)
    const target = Object.values(input.compiled ?? {})[0]?.atoms[0]
    for (const group of answer.groups) {
      group.assessments = target === undefined ? [] : [{ target_ref: atomRef(target), criteria_refs: [], result: "satisfied", explanation: "judged in a delegation batch", method: "model" }]
    }
    return JSON.stringify(answer)
  }
  return { requests, propose }
}

test("scenario 7: a delegation batch records no assessment, and its request shows only the latest batch for each current version", async () => {
  // a-bundle is not_satisfied twice (retry, then stop), so its successor never runs and the version stays current.
  const seen = new Map<string, number>()
  let plan: (event: string) => Candidate = event => chainCandidate(2, event)
  const planned = management(event => plan(event), atomId => {
    const n = (seen.get(atomId) ?? 0) + 1
    seen.set(atomId, n)
    return n === 1 ? { result: "not_satisfied", decision: "retry" } : { result: "not_satisfied", decision: "stop" }
  })
  const wrapped = recording(planned)
  const host = new ChainHost({ propose: wrapped.propose })
  const first = await host.round(CANDIDATE_EXAMPLE_INPUT)
  assert.deepEqual(chainOrder(host), ["a-bundle@0", "a-bundle@0"], "retry still runs the version once more, in the return batch")
  assert.deepEqual(first.pendingEventIds, [])
  const afterR1 = host.snapshot()
  // The retry delivers the same Atom with the retry batch's findings after it.
  const runs = host.turns.filter(turn => turn.offered.includes("a-bundle@0"))
  assert.equal(runs.length, 2)
  assert.deepEqual(deliveredAtoms(runs[1]!.text!), deliveredAtoms(runs[0]!.text!), "the Atom itself is unchanged")
  assert.doesNotMatch(runs[0]!.text!, /management findings/, "a first dispatch carries no findings")
  const firstExecution = afterR1.executions.find(record => record.retry?.outcome === "dispatched")!
  assert.ok(runs[1]!.text!.endsWith(`\n\n[management findings for this retry] a-bundle@0\nExecution ${firstExecution.execution_id} of this same Atom version was assessed not_satisfied:\n- the returned work is not_satisfied\nReason for running it again: retry after not_satisfied`), runs[1]!.text)
  const bundleDispatches = afterR1.dispatches.filter(dispatch => dispatch.atom_id === "a-bundle")
  assert.equal(new Set(bundleDispatches.map(dispatch => dispatch.digest)).size, 1, "both dispatches carry one Atom digest")
  const bundleRecords = afterR1.assessments.filter(record => record.target_ref.id === "a-bundle")
  assert.equal(bundleRecords.length, 2, "one record per return batch; the delegation batch's own is dropped")
  const returnBatches = new Set(afterR1.management_log.filter(batch => batch.trigger_event_ids.every(id => id.endsWith(":return"))).map(batch => batch.sequence))
  assert.ok(afterR1.assessments.every(record => returnBatches.has(record.sequence)), "every recorded assessment comes from a return batch")
  assert.notEqual(afterR1.atom_states.find(state => state.atom_id === "a-bundle")?.status, "legacy", "the dropped satisfied assessment did not retire the Atom")

  plan = revisionPlan(host, {})
  const before = wrapped.requests.length
  await host.round(UPDATE, { source_category: "update" })
  const afterR2 = host.snapshot()
  const delegation = wrapped.requests.slice(before).filter(request => request.generation_stage === "ci" && request.assessment_batch !== true)
  assert.ok(delegation.length > 0, "the update's CI request was captured")
  const latest = Math.max(...bundleRecords.map(record => record.sequence))
  for (const request of delegation) {
    assert.deepEqual(request.assessments, bundleRecords.filter(record => record.sequence === latest),
      "only the latest batch's records for the current version, verbatim")
  }
  assert.ok(afterR2.management_log.some(batch => batch.status === "accepted" && batch.trigger_event_ids.includes(host.events().filter(e => e.kind === "user_input").at(-1)!.event_id)),
    "the update batch is accepted without any assessment")
  assert.deepEqual(afterR2.assessments.filter(record => !returnBatchesOf(afterR2).has(record.sequence)), [], "still no assessment from a delegation batch")
})

function returnBatchesOf(snapshot: ReturnType<ChainHost["snapshot"]>): Set<number> {
  return new Set(snapshot.management_log.filter(batch => batch.trigger_event_ids.every(id => id.endsWith(":return"))).map(batch => batch.sequence))
}

/** The chain plan with each Relation's kind set by its successor (unlisted ones keep no kind). */
function kinds(count: number, bySuccessor: Record<string, "consumes" | "serial_write" | "user_order">) {
  return (event: string): Candidate => {
    const candidate = chainCandidate(count, event)
    const group = candidate.groups[0]!
    if (group.compilation.decision !== "replace") throw Error("fixture")
    for (const relation of group.compilation.drafts[0]!.relations) {
      const successor = "local_ref" in relation.successor ? relation.successor.local_ref : relation.successor.id
      if (bySuccessor[successor] !== undefined) relation.kind = bySuccessor[successor]
    }
    return candidate
  }
}

/** Assessments by Atom: each call takes the next judgement for that Atom, the last one repeating. */
function judgements(byAtom: Record<string, ReturnJudgement[]>): Judge {
  const seen = new Map<string, number>()
  return atomId => {
    const list = byAtom[atomId] ?? [{ result: "satisfied" }]
    const n = seen.get(atomId) ?? 0
    seen.set(atomId, n + 1)
    return list[Math.min(n, list.length - 1)]!
  }
}

for (const kind of ["serial_write", "user_order"] as const) {
  test(`scenario 8 (${kind}): the successor starts once the predecessor's run is over, stopped or judged not_satisfied with stop`, async () => {
    // Stopped twice: code reruns it once, then the limit closes it; the successor waits for that rerun, then runs.
    const stopped = new ChainHost({ propose: management(kinds(2, { "a-inspect": kind }), judgements({ "a-bundle": [{ result: "unknown" }] })).propose,
      executor: offered => offered[0] === "a-bundle@0" ? "stopped" : "completed" })
    const first = await stopped.round(CANDIDATE_EXAMPLE_INPUT)
    report(`scenario 8 ${kind} stopped`, first, stopped)
    assert.deepEqual(chainOrder(stopped), ["a-bundle@0", "a-bundle@0", "a-inspect@0"])
    assert.deepEqual(first.pendingEventIds, [])
    assert.deepEqual(stopped.snapshot().compiled["t1"]!.relations.map(relation => relation.kind), [kind], "a non-default kind is stored")

    const rejected = new ChainHost({ propose: management(kinds(2, { "a-inspect": kind }), judgements({ "a-bundle": [{ result: "not_satisfied", decision: "stop" }] })).propose })
    const second = await rejected.round(CANDIDATE_EXAMPLE_INPUT)
    report(`scenario 8 ${kind} not_satisfied`, second, rejected)
    assert.deepEqual(chainOrder(rejected), ["a-bundle@0", "a-inspect@0"], "the B3 stall does not happen for an ordering Relation")
  })

  test(`scenario 9 (${kind}): a retried predecessor holds the successor until the retry's execution is closed`, async () => {
    const host = new ChainHost({ propose: management(kinds(2, { "a-inspect": kind }), judgements({ "a-bundle": [{ result: "not_satisfied", decision: "retry" }, { result: "not_satisfied", decision: "stop" }] })).propose })
    const round = await host.round(CANDIDATE_EXAMPLE_INPUT)
    report(`scenario 9 ${kind}`, round, host)
    assert.deepEqual(chainOrder(host), ["a-bundle@0", "a-bundle@0", "a-inspect@0"])
    const snapshot = host.snapshot()
    const retry = snapshot.dispatches.find(dispatch => dispatch.retry_of !== undefined)!
    const inspect = snapshot.dispatches.find(dispatch => dispatch.atom_id === "a-inspect")!
    assert.ok(Number(inspect.dispatch_id.split("-")[1]) > Number(snapshot.executions.find(e => e.dispatch_id === retry.dispatch_id)!.execution_id.split("-")[1]),
      "a-inspect is offered only after the retry ran")
    const batchOfRetry = host.turns.find(turn => turn.offered.includes("a-bundle@0") && turn.text?.includes("management findings"))!
    assert.deepEqual(batchOfRetry.offered, ["a-bundle@0"], "the retry is offered alone")
  })
}

test("scenario 10: consumes keeps the result rule; a mixed chain judges each edge by its own kind", async () => {
  // consumes (no kind given, read as consumes): not_satisfied with stop blocks the successor, as before.
  const blocked = new ChainHost({ propose: management(kinds(2, {}), judgements({ "a-bundle": [{ result: "not_satisfied", decision: "stop" }] })).propose })
  await blocked.round(CANDIDATE_EXAMPLE_INPUT)
  assert.deepEqual(chainOrder(blocked), ["a-bundle@0"])
  // a-bundle -> a-inspect serial_write, a-inspect -> a-step3 consumes: a-step3 reads only a-inspect's assessment.
  const mixed = new ChainHost({ propose: management(kinds(3, { "a-inspect": "serial_write", "a-step3": "consumes" }),
    judgements({ "a-bundle": [{ result: "not_satisfied", decision: "stop" }], "a-inspect": [{ result: "unknown" }] })).propose })
  await mixed.round(CANDIDATE_EXAMPLE_INPUT)
  assert.deepEqual(chainOrder(mixed), ["a-bundle@0", "a-inspect@0", "a-step3@0"])
  const held = new ChainHost({ propose: management(kinds(3, { "a-inspect": "serial_write", "a-step3": "consumes" }),
    judgements({ "a-bundle": [{ result: "satisfied" }], "a-inspect": [{ result: "not_satisfied", decision: "stop" }] })).propose })
  await held.round(CANDIDATE_EXAMPLE_INPUT)
  assert.deepEqual(chainOrder(held), ["a-bundle@0", "a-inspect@0"], "a-step3 waits on a-inspect's not_satisfied, whatever a-bundle was")
})

test("scenario 11: an answer without kind is consumes and leaves the Compiled Intent digest unchanged", async () => {
  const run = async (plan: (event: string) => Candidate) => {
    const host = new ChainHost({ propose: management(plan, satisfied).propose })
    await host.round(CANDIDATE_EXAMPLE_INPUT)
    return host.snapshot().compiled["t1"]!
  }
  const without = await run(event => chainCandidate(2, event))
  const explicit = await run(kinds(2, { "a-inspect": "consumes" }))
  const ordering = await run(kinds(2, { "a-inspect": "serial_write" }))
  assert.equal("kind" in without.relations[0]!, false, "consumes is not written")
  assert.equal(compiledIntentRef(explicit).digest, compiledIntentRef(without).digest)
  assert.equal(digestOf(explicit.relations), digestOf(without.relations))
  assert.notEqual(compiledIntentRef(ordering).digest, compiledIntentRef(without).digest)
})
