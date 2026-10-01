import { test } from "node:test"
import { stageCandidate } from "./fixtures/stage-candidate.js"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IntentStoreV2 } from "../src/core/compiler-store-v2.js"
import { createIntentCompilerV2 } from "../src/core/intent-compiler-v2.js"
import { createCompilerModelV2, V2_CHECK_CONTRACT, V2_CHECK_CONTRACT_FOR_ASSEMBLED_TASKS, type CompilerModelV2CheckInput } from "../src/model/compiler-model-v2.js"
import { atomRef, compiledIntentRef, AtomStateLedger } from "../src/core/compiled-intent.js"
import { atomAdmission } from "../src/core/atom-admission.js"
import { bindCurrentRequirements, selectSourceEvents } from "../src/core/requirement-flow.js"
import { IntentStateManager } from "../src/core/intent-state-v2.js"
import { digestText, type Candidate, type CompilerEvent, type SourceRef, type TaskIntent } from "../src/core/intent-contract.js"

const raw = "Implement CSV. Missing file must print ERROR: missing file."
const source: SourceRef = { source_id: "e1", digest: digestText(raw), span: { unit: "utf16", start: 0, end: raw.length } }

function candidate(): Candidate {
  return {
    schema_version: 2,
    basis: { event_ids: ["e1"], refs: [] },
    source_coverage: [{ source, disposition: "normative", requirements: [{ local_ref: "r1" }, { local_ref: "r2" }], reason: "CSV and its error behavior", basis: [] }],
    groups: [{
      local_ref: "g1", task_refs: ["t1"], depends_on: [],
      ir_changes: [
        { action: "create", target: "task", local_ref: "t1", value: { goal: { text: "Implement CSV" }, current_scope: { text: "proceed", disposition: "proceed" } }, sources: [source] },
        { action: "create", target: "content", local_ref: "r1", value: { text: "Implement CSV.", about: [], scope: [{ target_id: "t1" }], support: [] }, sources: [{ ...source, span: { unit: "utf16", start: 0, end: 14 } }] },
        { action: "create", target: "content", local_ref: "r2", value: { text: "Missing file must print ERROR: missing file.", about: [], scope: [{ target_id: "t1" }], support: [] }, sources: [{ ...source, span: { unit: "utf16", start: 15, end: raw.length } }] },
      ],
      compilation: { decision: "replace", drafts: [{
        local_ref: "ci1", task_id: "t1", intent_basis: [], relations: [], attachments: [],
        atoms: [{
          atom_id: "a1", revision: 0, goal_refs: [], task: "Implement the CSV CLI. When an input file is missing, print the exact text ERROR: missing file.", inputs: [], outputs: [], constraints: [], optional_tools: [],
          authority: { basis: [source], rules: [], lifetime: "this_execution", delegation: "not_supported" },
          preconditions: [], completion: [{ text: "The CSV CLI prints ERROR: missing file for a missing input.", evidence_required: "A focused missing-input test result" }], return_when: [], intent_judgments: [],
        }],
      }] },
      execution_decisions: [], assessments: [],
      coverage: [
        { requirement: { local_ref: "t1" }, disposition: "assigned", refs: [{ local_ref: "a1" }], explanation: "CLI" },
        { requirement: { local_ref: "r1" }, disposition: "assigned", refs: [{ local_ref: "a1" }], explanation: "CSV behavior" },
        { requirement: { local_ref: "r2" }, disposition: "assigned", refs: [{ local_ref: "a1" }], explanation: "Exact error" },
      ],
      checks: [], questions: [],
    }],
  }
}

async function run(proposal: Candidate) {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "requirements-")), runId: "run1" })
  const compiler = createIntentCompilerV2({ store, model: createCompilerModelV2(async input => JSON.stringify(stageCandidate(input, proposal))) })
  const event: CompilerEvent = { schema_version: 2, run_id: "run1", event_id: "e1", kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text: raw } }
  await compiler.acceptEvent(event)
  return { result: await compiler.advance({ runId: "run1" }), store }
}

test("current IR requirements are bound to the Atom and only the Atom is delivered", async () => {
  const proposal = candidate()
  const change = proposal.groups[0]!.ir_changes[2]!
  if (change.action !== "create") throw new Error("fixture")
  ;(change.value as { text: string }).text = "Apply the specified error rule, but lowercase every message."
  const { result, store } = await run(proposal)
  assert.equal(result.ok, true, result.message)
  const delivered = result.deliveries?.[0]?.atom
  assert.match(delivered?.task ?? "", /ERROR: missing file/)
  assert.deepEqual(delivered?.completion, [{ text: "The CSV CLI prints ERROR: missing file for a missing input.", evidence_required: "A focused missing-input test result" }])
  assert.equal("execution_task" in result.deliveries![0]!, false)
  assert.deepEqual(store.current().compiled.t1?.atoms[0]?.goal_refs.map(ref => ref.id), ["r1", "r2"])
  assert.deepEqual(store.current().compiled.t1?.intent_basis.map(ref => ref.id), ["r1", "r2"])
  assert.equal(store.current().ir.t1!.content[1]!.interpretation, "Apply the specified error rule, but lowercase every message.")
  assert.equal("interpretation" in delivered!, false)
})

test("assembly attaches the assigned requirement texts once and leaves the model draft untouched", () => {
  const proposal = candidate()
  const group = proposal.groups[0]!
  if (group.compilation.decision !== "replace") throw new Error("fixture")
  const applied = new IntentStateManager({}).apply(group.ir_changes, ["t1"])
  assert.equal(applied.ok, true)
  const task = applied.tasks.t1!
  const before = structuredClone(group)
  const instruction = group.compilation.drafts[0]!.atoms[0]!.task
  const compilerEvent: CompilerEvent = { schema_version: 2, run_id: "run1", event_id: "e1", kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text: raw } }
  const prepare = () => bindCurrentRequirements(group, task, undefined, [compilerEvent], [])
  const first = prepare()
  assert.deepEqual(group, before, "binding must not modify the submitted group")
  const second = prepare()
  assert.deepEqual(group, before, "preparing twice must not accumulate on the submitted group")
  assert.deepEqual(first, second, "the same submitted group prepares to the same drafts")
  assert.equal((first[0]!.atoms[0]!.task.match(/\[assigned requirement /g) ?? []).length, 2)
  assert.ok(first[0]!.atoms[0]!.task.startsWith(instruction))
  assert.ok(first[0]!.atoms[0]!.task.includes("Implement CSV."))
  assert.ok(first[0]!.atoms[0]!.task.includes("Missing file must print ERROR: missing file."))
})

test("two independent runs of the same model draft produce the same delivered task and digest", async () => {
  const first = await run(candidate())
  const second = await run(candidate())
  assert.equal(first.result.ok, true, first.result.message)
  assert.equal(second.result.ok, true, second.result.message)
  const a = first.result.deliveries![0]!
  const b = second.result.deliveries![0]!
  assert.equal(a.atom.task, b.atom.task)
  assert.equal(a.digest, b.digest)
  assert.equal((a.atom.task.match(/\[assigned requirement /g) ?? []).length, 2)
  const record = first.store.current().management_log.at(-1)!
  const recordedCompilation = record.candidate!.groups[0]!.compilation
  assert.equal(recordedCompilation.decision, "replace")
  if (recordedCompilation.decision !== "replace") throw new Error("fixture")
  const expectedCompilation = candidate().groups[0]!.compilation
  if (expectedCompilation.decision !== "replace") throw new Error("fixture")
  assert.equal(recordedCompilation.drafts[0]!.atoms[0]!.task, expectedCompilation.drafts[0]!.atoms[0]!.task)
})

test("check, commit and dispatch read the same assembled task", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "assembly-")), runId: "assembly" })
  const proposal = candidate()
  if (proposal.groups[0]!.compilation.decision !== "replace") throw new Error("fixture")
  const instruction = proposal.groups[0]!.compilation.drafts[0]!.atoms[0]!.task
  const checks: CompilerModelV2CheckInput[] = []
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(
      async input => JSON.stringify(stageCandidate(input, proposal)),
      async input => {
        checks.push(structuredClone(input))
        return JSON.stringify({ schema_version: 2, verdict: "consistent", findings: [] })
      },
    ),
  })
  await compiler.acceptEvent({ schema_version: 2, run_id: "assembly", event_id: "e1", kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text: raw } })
  const result = await compiler.advance({ runId: "assembly" })
  assert.equal(result.ok, true, result.message)
  assert.equal(checks.length, 1)
  const delivered = result.deliveries![0]!.atom
  const prepared = checks[0]!.prepared!
  assert.equal(prepared.compiled.t1!.atoms[0]!.task, delivered.task)
  assert.equal(prepared.dispatchable_atoms[0]!.task, delivered.task)
  assert.equal(store.current().compiled.t1!.atoms[0]!.task, delivered.task)
  assert.equal(result.deliveries![0]!.digest, atomRef(delivered).digest)
  const checkedCompilation = checks[0]!.candidate.groups[0]!.compilation
  assert.equal(checkedCompilation.decision, "replace")
  if (checkedCompilation.decision !== "replace") throw new Error("fixture")
  assert.equal(checkedCompilation.drafts[0]!.atoms[0]!.task, instruction)
  assert.ok(delivered.task.startsWith(instruction))
  assert.deepEqual(checks[0]!.contract, V2_CHECK_CONTRACT_FOR_ASSEMBLED_TASKS)
  assert.equal(checks[0]!.contract.check_contract.includes("prepared task carries the assigned behavior"), true)
})

test("legacy checks keep the base contract and legacy delivery keeps the model's full instruction", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "legacy-")), runId: "legacy" })
  const proposal = candidate()
  if (proposal.groups[0]!.compilation.decision !== "replace") throw new Error("fixture")
  const instruction = proposal.groups[0]!.compilation.drafts[0]!.atoms[0]!.task
  const checks: CompilerModelV2CheckInput[] = []
  const compiler = createIntentCompilerV2({
    store,
    requirement_integrity: "legacy",
    model: createCompilerModelV2(
      async () => JSON.stringify(proposal),
      async input => {
        checks.push(structuredClone(input))
        return JSON.stringify({ schema_version: 2, verdict: "consistent", findings: [] })
      },
    ),
  })
  await compiler.acceptEvent({ schema_version: 2, run_id: "legacy", event_id: "e1", kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text: raw } })
  const result = await compiler.advance({ runId: "legacy" })
  assert.equal(result.ok, true, result.message)
  assert.equal(checks.length, 1)
  assert.deepEqual(checks[0]!.contract, V2_CHECK_CONTRACT)
  assert.equal(checks[0]!.contract.check_contract.includes("assigned requirement blocks attached verbatim from prepared.ir"), false)
  assert.equal(result.deliveries![0]!.atom.task, instruction)
  assert.equal(result.deliveries![0]!.atom.task.includes("[assigned requirement "), false)
})

test("a run without a checker can accept its last permitted CI call", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "one-proposal-")), runId: "one" })
  store.applyDeltas({ max_management_requests: 2 })
  const compiler = createIntentCompilerV2({ store, model: createCompilerModelV2(async input => JSON.stringify(stageCandidate(input, candidate()))) })
  await compiler.acceptEvent({ schema_version: 2, run_id: "one", event_id: "e1", kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text: raw } })
  const result = await compiler.advance({ runId: "one" })
  assert.equal(result.ok, true, result.message)
  assert.equal(store.current().management_calls.length, 2)
  assert.deepEqual(store.current().management_calls.map(call => call.generation_stage), ["ir", "ci"])
  assert.equal(store.current().management_calls[0]!.kind, "propose")
})

test("new dependent Atoms use local identities and only the predecessor is dispatched", async () => {
  const proposal = candidate()
  const group = proposal.groups[0]!
  if (group.compilation.decision !== "replace") throw new Error("fixture")
  const draft = group.compilation.drafts[0]!
  const successor = structuredClone(draft.atoms[0]!)
  successor.atom_id = "a2"
  successor.task = "Consume the completed CSV implementation for an independently requested report"
  draft.atoms.push(successor)
  draft.relations = [{ predecessor: { local_ref: "a1" }, successor: { local_ref: "a2" }, requires: "The accepted CSV implementation", conditions: [], basis: [source] }] as never
  group.coverage[2]!.refs = [{ local_ref: "a2" }]
  const { result, store } = await run(proposal)
  assert.equal(result.ok, true, result.message)
  assert.deepEqual(result.deliveries?.map(delivery => delivery.atom_id), ["a1"])
  const intent = store.current().compiled.t1!
  assert.deepEqual(intent.relations[0]!.predecessor, atomRef(intent.atoms[0]!))
  assert.deepEqual(intent.relations[0]!.successor, atomRef(intent.atoms[1]!))
  assert.match(intent.atoms[0]!.task, /\[assigned requirement r1@0 /)
})

test("a dependency cannot name a fabricated predecessor digest", async () => {
  const proposal = candidate()
  const group = proposal.groups[0]!
  if (group.compilation.decision !== "replace") throw new Error("fixture")
  const draft = group.compilation.drafts[0]!
  const successor = structuredClone(draft.atoms[0]!)
  successor.atom_id = "a2"
  draft.atoms.push(successor)
  draft.relations = [{ predecessor: { id: "a1", revision: 0, digest: "fabricated" }, successor: { id: "a2", revision: 0, digest: "fabricated" }, requires: "CSV implementation", conditions: [], basis: [source] }]
  group.coverage[2]!.refs = [{ local_ref: "a2" }]
  const { result } = await run(proposal)
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /relation.*(unknown|digest|resolve)/i)
})

test("a Relation with an unresolvable quoted basis rejects the complete candidate", async () => {
  const proposal = candidate()
  const group = proposal.groups[0]!
  if (group.compilation.decision !== "replace") throw new Error("fixture")
  const draft = group.compilation.drafts[0]!
  draft.atoms.push({ ...structuredClone(draft.atoms[0]!), atom_id: "a2" })
  draft.relations = [{ predecessor: { local_ref: "a1" }, successor: { local_ref: "a2" }, requires: "Accepted implementation", conditions: [], basis: [{ source_id: "e1", digest: digestText(raw), quote: "words not present in the source" }] }]
  group.coverage[2]!.refs = [{ local_ref: "a2" }]
  const { result, store } = await run(proposal)
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /unresolved reference/)
  assert.deepEqual(store.current().compiled, {})
})

test("a malformed source span in Authority cannot bypass the requirement source checks", async () => {
  const proposal = candidate()
  const group = proposal.groups[0]!
  if (group.compilation.decision !== "replace") throw new Error("fixture")
  group.compilation.drafts[0]!.atoms[0]!.authority.basis = [{ ...source, span: { unit: "utf16", start: 10, end: 5 } }]
  const { result, store } = await run(proposal)
  assert.equal(result.ok, false)
  assert.deepEqual(store.current().compiled, {})
})

test("Atom constraints cannot introduce a second behavioral specification outside assigned IR", async () => {
  const proposal = candidate()
  const group = proposal.groups[0]!
  if (group.compilation.decision !== "replace") throw new Error("fixture")
  group.compilation.drafts[0]!.atoms[0]!.constraints = [{ text: "Always sort every output column alphabetically.", basis: [source], scope: [{ target_id: "t1" }] }]
  const { result, store } = await run(proposal)
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /constraints must repeat an assigned IR requirement verbatim/)
  assert.deepEqual(store.current().compiled, {})
})

test("an exact repeated Atom constraint is bound to its canonical IR item", async () => {
  const proposal = candidate()
  const group = proposal.groups[0]!
  if (group.compilation.decision !== "replace") throw new Error("fixture")
  group.compilation.drafts[0]!.atoms[0]!.constraints = [{ text: "Missing file must print ERROR: missing file.", basis: [source], scope: [{ target_id: "t1" }] }]
  const { result, store } = await run(proposal)
  assert.equal(result.ok, true, result.message)
  assert.equal(store.current().compiled.t1!.atoms[0]!.constraints[0]!.basis[0] && "id" in store.current().compiled.t1!.atoms[0]!.constraints[0]!.basis[0]!, true)
  assert.deepEqual(store.current().compiled.t1!.atoms[0]!.constraints[0]!.basis, [store.current().compiled.t1!.atoms[0]!.goal_refs.find(ref => ref.id === "r2")])
})

test("accepted result releases a dependent Atom on reuse, and revised acceptance blocks its old dispatch", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "dependency-")), runId: "chain" })
  let proposal = candidate()
  const group = proposal.groups[0]!
  if (group.compilation.decision !== "replace") throw new Error("fixture")
  const draft = group.compilation.drafts[0]!
  draft.atoms.push({ ...structuredClone(draft.atoms[0]!), atom_id: "a2", task: "Deliver the report using the accepted CSV implementation" })
  draft.relations = [{ predecessor: { local_ref: "a1" }, successor: { local_ref: "a2" }, requires: "Accepted CSV implementation", conditions: [], basis: [source] }]
  group.coverage[2]!.refs = [{ local_ref: "a2" }]
  const compiler = createIntentCompilerV2({ store, model: createCompilerModelV2(async input => JSON.stringify(stageCandidate(input, proposal))) })
  await compiler.acceptEvent({ schema_version: 2, run_id: "chain", event_id: "e1", kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text: raw } })
  const first = await compiler.advance({ runId: "chain" })
  assert.deepEqual(first.deliveries?.map(delivery => delivery.atom_id), ["a1"])
  const start = await compiler.authorize({ kind: "start", run_id: "chain", dispatch_id: first.deliveries![0]!.dispatch_id, host_identity: "host" })
  assert.equal(start.ok, true)
  const prior = atomRef(store.current().compiled.t1!.atoms[0]!)
  const returned = await compiler.acceptEvent({ schema_version: 2, run_id: "chain", event_id: "return", kind: "execution_return", source: { producer_id: "host", channel: "executor" }, execution_id: start.execution_id!, payload: {
    state_claim: "completed", outcome: { schema_version: 2, execution_id: start.execution_id!, atom_ref: prior, suggested_status: "completed", product_refs: [], file_changes: [], evidence_refs: [] },
  } })
  assert.equal(returned.ok, true)
  const before = store.current()
  assert.match(atomAdmission("t1", before.compiled.t1!.atoms[1]!, { compiled: before.compiled, ir: before.ir, atoms: new AtomStateLedger(before.atom_states), assessments: [], execution_outcomes: before.execution_outcomes }) ?? "", /has not been accepted/)
  proposal = { schema_version: 2, basis: { event_ids: ["return"], refs: [] }, source_coverage: [], groups: [{
    local_ref: "accept", task_refs: ["t1"], depends_on: [], ir_changes: [], compilation: { decision: "reuse", current: [compiledIntentRef(before.compiled.t1!)], reason: "accepted predecessor releases known successor" }, execution_decisions: [], assessments: [{ target_ref: prior, result: "satisfied", criteria_refs: [], evidence_refs: [], explanation: "result checked against dependency", method: "model" }], coverage: [], checks: [], questions: [],
  }] }
  const second = await compiler.advance({ runId: "chain" })
  assert.equal(second.ok, true, second.message)
  assert.deepEqual(second.deliveries?.map(delivery => delivery.atom_id), ["a2"])
  assert.equal(second.deliveries![0]!.atom.atom_id, "a2")
  assert.deepEqual(store.current().compiled.t1!.relations[0]!.predecessor, prior)
  const retained = store.current().compiled.t1!.atoms.find(atom => atom.atom_id === "a1" && atom.revision === 0)!
  assert.equal(retained.task, first.deliveries![0]!.atom.task)
  assert.deepEqual(atomRef(retained), prior)
  // A later management finding is authoritative even if the old dispatch exists.
  store.applyDeltas({ assessments: [{ ...proposal.groups[0]!.assessments[0]!, result: "not_satisfied", basis_event_ids: ["return"], sequence: 999 }] })
  const denied = await compiler.authorize({ kind: "start", run_id: "chain", dispatch_id: second.deliveries![0]!.dispatch_id, host_identity: "host" })
  assert.equal(denied.ok, false)
  assert.match(denied.message ?? "", /has not been accepted/)
})

test("cyclic local dependencies are rejected rather than accepted as permanently waiting", async () => {
  const proposal = candidate()
  const group = proposal.groups[0]!
  if (group.compilation.decision !== "replace") throw new Error("fixture")
  const draft = group.compilation.drafts[0]!
  draft.atoms.push({ ...structuredClone(draft.atoms[0]!), atom_id: "a2" })
  draft.relations = [
    { predecessor: { local_ref: "a1" }, successor: { local_ref: "a2" }, requires: "A", conditions: [], basis: [source] },
    { predecessor: { local_ref: "a2" }, successor: { local_ref: "a1" }, requires: "B", conditions: [], basis: [source] },
  ]
  group.coverage[2]!.refs = [{ local_ref: "a2" }]
  const { result } = await run(proposal)
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /relation dependency cycle/)
})

test("a quoted user source is located before the requirement is committed and dispatched", async () => {
  const proposal = candidate()
  const change = proposal.groups[0]!.ir_changes[2]!
  if (change.action !== "create") throw new Error("fixture")
  change.sources = [{ source_id: "e1", digest: digestText(raw), quote: "Missing file must print ERROR: missing file." } as SourceRef]
  const { result, store } = await run(proposal)
  assert.equal(result.ok, true, result.message)
  const expectedStart = raw.indexOf("Missing file")
  const committed = store.current().ir.t1?.content.find(item => item.item_id === "r2")
  assert.deepEqual(committed?.sources[0]?.span, { unit: "utf16", start: expectedStart, end: raw.length })
  assert.equal("quote" in (committed?.sources[0] ?? {}), false)
  assert.deepEqual(result.deliveries?.[0]?.atom.goal_refs.map(ref => ref.id), ["r1", "r2"])
  assert.equal("execution_task" in result.deliveries![0]!, false)
})

test("a quote that does not occur in the user event cannot become a requirement source", async () => {
  const proposal = candidate()
  const change = proposal.groups[0]!.ir_changes[2]!
  if (change.action !== "create") throw new Error("fixture")
  change.sources = [{ source_id: "e1", digest: digestText(raw), quote: "ERROR: invented" } as SourceRef]
  const { result, store } = await run(proposal)
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /IR sources do not resolve; 1 reference\(s\) failed the source gate/)
  assert.match(result.message ?? "", /\(quote="ERROR: invented"\): quote_unresolved/)
  assert.deepEqual(store.current().ir, {})
})

test("a repeated quote cannot silently choose the first occurrence", async () => {
  const proposal = candidate()
  const change = proposal.groups[0]!.ir_changes[2]!
  if (change.action !== "create") throw new Error("fixture")
  change.sources = [{ source_id: "e1", digest: digestText(raw), quote: "file" } as SourceRef]
  const { result } = await run(proposal)
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /IR sources do not resolve; 1 reference\(s\) failed the source gate/)
  assert.match(result.message ?? "", /\(quote="file"\): quote_unresolved/)
})

test("a compiled task cannot omit the IR requirement ledger", async () => {
  const proposal = candidate()
  proposal.groups[0]!.ir_changes = proposal.groups[0]!.ir_changes.filter(change => change.action === "preserve" || change.target !== "content")
  const { result, store } = await run(proposal)
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /source_coverage\[0\] names unknown or ambiguous IR r1/)
  assert.deepEqual(store.current().ir, {})
  assert.deepEqual(store.current().compiled, {})
  assert.ok(store.current().management_calls.every(call => call.generation_stage === "ir"), "missing requirement entries must fail before CI generation")
})

test("every current requirement needs an explicit destination", async () => {
  const proposal = candidate()
  proposal.groups[0]!.coverage = proposal.groups[0]!.coverage.filter(entry => !("local_ref" in entry.requirement && entry.requirement.local_ref === "r2"))
  const { result } = await run(proposal)
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /IR content r2 has no coverage destination/)
})

test("requirement text must cite a resolvable user span", async () => {
  const proposal = candidate()
  const change = proposal.groups[0]!.ir_changes[1]!
  if (change.action !== "create") throw new Error("fixture")
  change.sources = [{ source_id: "unknown", digest: digestText(raw), span: { unit: "utf16", start: 0, end: 5 } }]
  const { result } = await run(proposal)
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /IR sources do not resolve; 1 reference\(s\) failed the source gate/)
  assert.match(result.message ?? "", /unknown \(span=utf16:0-5\): source_unknown/)
})

test("a requirement cannot lose its task or output scope", async () => {
  const proposal = candidate()
  const change = proposal.groups[0]!.ir_changes[1]!
  if (change.action !== "create") throw new Error("fixture")
  change.value = { text: "Implement CSV.", about: [], scope: [], support: [] }
  const { result } = await run(proposal)
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /IR content r1 needs actual selected text and an already declared scope target/)
})

test("paused requirements cannot launch an Atom with no assigned work", async () => {
  const proposal = candidate()
  for (const entry of proposal.groups[0]!.coverage) {
    if (!("local_ref" in entry.requirement) || entry.requirement.local_ref === "t1") continue
    entry.disposition = "paused"
    entry.refs = []
  }
  const { result } = await run(proposal)
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /Atom a1 has no assigned current IR requirement/)
})

test("a later revision keeps prior exact requirements and replaces only the changed rule", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "requirements-")), runId: "run2" })
  let proposal = candidate()
  const seenSources: string[][] = []
  const checked: Array<{ sources: string[]; requirements: string[] }> = []
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(
      async input => {
        if (input.generation_stage === "ir") {
          // Retained prior text must still be offered: it now travels as the
          // addressed segments the current IR cites, not as a raw event list.
          const batchIds = new Set(input.events.map(event => event.event_id))
          seenSources.push([...new Set((input.source_segments ?? []).map(segment => segment.source_id))]
            .filter(id => !batchIds.has(id)))
        }
        return JSON.stringify(stageCandidate(input, proposal))
      },
      async input => {
        checked.push({
          sources: (input.source_events ?? []).map(event => event.event_id),
          requirements: input.prepared?.dispatchable_atoms[0]?.goal_refs.map(ref => ref.id) ?? [],
        })
        return JSON.stringify({ schema_version: 2, verdict: "consistent", findings: [] })
      },
    ),
  })
  await compiler.acceptEvent({ schema_version: 2, run_id: "run2", event_id: "e1", kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text: raw } })
  const first = await compiler.advance({ runId: "run2" })
  assert.equal(first.ok, true, first.message)
  const prior = store.current().compiled.t1?.atoms[0]
  assert.ok(prior)

  const update = "Missing file must print ERROR: absent."
  const updateSource: SourceRef = { source_id: "e2", digest: digestText(update), span: { unit: "utf16", start: 0, end: update.length } }
  proposal = candidate()
  proposal.source_coverage = [
    { source: updateSource, disposition: "normative", requirements: [{ local_ref: "r2" }], reason: "Replaces the error rule", basis: [] },
    { source: { ...source, span: { unit: "utf16", start: 15, end: raw.length } }, disposition: "superseded", requirements: [], reason: "User changed the exact error", basis: [updateSource] },
  ]
  proposal.basis.event_ids = ["e2"]
  const group = proposal.groups[0]!
  group.ir_changes = [{ action: "revise", target: "content", id: "r2", expected_revision: 0,
    value: { text: update, about: [], scope: [{ target_id: "t1" }], support: [] }, sources: [updateSource] }]
  if (group.compilation.decision !== "replace") throw new Error("fixture")
  const replacement = group.compilation.drafts[0]!.atoms[0]!
  replacement.revision = 1
  replacement.previous_atom_ref = atomRef(prior)
  replacement.task = "Implement the CSV CLI. When an input file is missing, print the exact text ERROR: absent."
  await compiler.acceptEvent({ schema_version: 2, run_id: "run2", event_id: "e2", kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text: update } })
  const second = await compiler.advance({ runId: "run2" })
  assert.equal(second.ok, true, second.message)
  assert.deepEqual(seenSources[1], ["e1"])
  assert.deepEqual(checked[1], { sources: ["e1"], requirements: ["r1", "r2"] })
  assert.deepEqual(second.deliveries?.map(delivery => delivery.atom_id), ["a1"])
  assert.match(second.deliveries?.[0]?.atom.task ?? "", /ERROR: absent/)
  assert.deepEqual(store.current().ir.t1?.content.map(item => item.text), ["Implement CSV.", update])
  assert.equal(store.current().atom_states.find(state => state.atom_id === "a1" && state.atom_revision === 0)?.status, "legacy")
})

test("an IR requirement change cannot reuse old compiled work", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "requirements-")), runId: "run3" })
  let proposal = candidate()
  const compiler = createIntentCompilerV2({ store, model: createCompilerModelV2(async input => JSON.stringify(stageCandidate(input, proposal))) })
  await compiler.acceptEvent({ schema_version: 2, run_id: "run3", event_id: "e1", kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text: raw } })
  assert.equal((await compiler.advance({ runId: "run3" })).ok, true)
  const current = store.current().compiled.t1
  assert.ok(current)

  const update = "Missing file must print ERROR: absent."
  proposal = candidate()
  proposal.basis.event_ids = ["e2"]
  const group = proposal.groups[0]!
  group.ir_changes = [{ action: "revise", target: "content", id: "r2", expected_revision: 0,
    value: { text: update, about: [], scope: [{ target_id: "t1" }], support: [] },
    sources: [{ source_id: "e2", digest: digestText(update), span: { unit: "utf16", start: 0, end: update.length } }] }]
  // Keep the parent update valid so this test still reaches the reuse guard.
  const replacementSource = { source_id: "e2", digest: digestText(update), span: { unit: "utf16" as const, start: 0, end: update.length } }
  proposal.source_coverage = [
    { source: replacementSource, disposition: "normative", requirements: [{ local_ref: "r2" }], reason: "The updated error rule", basis: [] },
    { source: { ...source, span: { unit: "utf16", start: 15, end: raw.length } }, disposition: "superseded", requirements: [], reason: "The user replaces the old error text", basis: [replacementSource] },
  ]
  group.compilation = { decision: "reuse", current: [compiledIntentRef(current)], reason: "unchanged" }
  await compiler.acceptEvent({ schema_version: 2, run_id: "run3", event_id: "e2", kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text: update } })
  const result = await compiler.advance({ runId: "run3" })
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /IR requirements changed without replacing the compiled work/)
})

test("historical source selection excludes another task's user text", () => {
  const oldOne: CompilerEvent = { schema_version: 2, run_id: "run4", event_id: "old-one", kind: "user_input",
    source: { producer_id: "user", channel: "user" }, task_ids: ["external-one"], payload: { text: "private task one" } }
  const oldTwo: CompilerEvent = { schema_version: 2, run_id: "run4", event_id: "old-two", kind: "user_input",
    source: { producer_id: "user", channel: "user" }, task_ids: ["external-two"], payload: { text: "private task two" } }
  const now: CompilerEvent = { ...oldOne, event_id: "new-one", payload: { text: "update task one" } }
  const task = (taskId: string, event: CompilerEvent): TaskIntent => ({
    task_id: taskId, revision: 0, goal: { text: "deliver", sources: [{ source_id: event.event_id, digest: digestText(String((event.payload as { text: string }).text)) }] },
    bindings: [], outputs: [], content: [], current_scope: { text: "proceed", disposition: "proceed", sources: [] }, unresolved: [],
  })
  const selected = selectSourceEvents([{ event: oldOne }, { event: oldTwo }, { event: now }], [now], {
    t1: task("t1", oldOne), t2: task("t2", oldTwo),
  })
  assert.deepEqual(selected.map(event => event.event_id), ["old-one"])
})

test("an update covering two tasks keeps their requirements in separate execution tasks", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "multi-requirements-")), runId: "multi" })
  let proposal = candidate()
  const second = JSON.parse(JSON.stringify(proposal.groups[0]).replaceAll('"t1"', '"t2"').replaceAll('"a1"', '"a2"').replaceAll('"r1"', '"r3"').replaceAll('"r2"', '"r4"').replaceAll('"g1"', '"g2"')) as Candidate["groups"][number]
  proposal.groups.push(second)
  proposal.source_coverage![0]!.requirements.push({ local_ref: "r3" }, { local_ref: "r4" })
  const compiler = createIntentCompilerV2({ store, model: createCompilerModelV2(async input => JSON.stringify(stageCandidate(input, proposal))) })
  await compiler.acceptEvent({ schema_version: 2, run_id: "multi", event_id: "e1", kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text: raw } })
  const first = await compiler.advance({ runId: "multi" })
  assert.equal(first.ok, true, first.message)
  const firstGroup = proposal.groups[0]!, secondGroup = proposal.groups[1]!
  if (firstGroup.compilation.decision !== "replace" || secondGroup.compilation.decision !== "replace") throw new Error("fixture")
  firstGroup.ir_changes = []
  secondGroup.ir_changes = []
  proposal = { ...proposal, basis: { event_ids: ["e2"], refs: [] }, groups: [firstGroup, secondGroup] }
  proposal.source_coverage = [{ source: { source_id: "e2", digest: "computed-by-management", quote: "Keep both scopes and requirements." }, disposition: "management", requirements: [], reason: "Retains both current tasks", basis: [] }]
  await compiler.acceptEvent({ schema_version: 2, run_id: "multi", event_id: "e2", kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text: "Keep both scopes and requirements." } })
  const update = await compiler.advance({ runId: "multi" })
  assert.equal(update.ok, true, update.message)
  assert.deepEqual(update.deliveries?.map(delivery => [delivery.task_id, delivery.atom.goal_refs.map(ref => ref.id)]), [["t1", ["r1", "r2"]], ["t2", ["r3", "r4"]]])
})

test("raising an Atom revision retires the earlier ready revision even without a supersession hint", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "atom-revision-")), runId: "revision" })
  let proposal = candidate()
  const compiler = createIntentCompilerV2({ store, model: createCompilerModelV2(async input => JSON.stringify(stageCandidate(input, proposal))) })
  await compiler.acceptEvent({ schema_version: 2, run_id: "revision", event_id: "e1", kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text: raw } })
  const first = await compiler.advance({ runId: "revision" })
  assert.equal(first.ok, true, first.message)
  proposal = candidate()
  proposal.basis.event_ids = ["e2"]
  proposal.groups[0]!.ir_changes = []
  proposal.source_coverage = [{ source: { source_id: "e2", digest: "computed-by-management", quote: "Keep requirements, refine the execution boundary." }, disposition: "management", requirements: [], reason: "Changes work organization only", basis: [] }]
  const compilation = proposal.groups[0]!.compilation
  if (compilation.decision !== "replace") throw new Error("fixture")
  compilation.drafts[0]!.atoms[0]!.revision = 1
  compilation.drafts[0]!.atoms[0]!.task = "Implement the same CSV behavior with a different execution boundary"
  await compiler.acceptEvent({ schema_version: 2, run_id: "revision", event_id: "e2", kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text: "Keep requirements, refine the execution boundary." } })
  const updated = await compiler.advance({ runId: "revision" })
  assert.equal(updated.ok, true, updated.message)
  assert.deepEqual(updated.deliveries?.map(delivery => delivery.atom.revision), [1])
  assert.equal(store.current().atom_states.find(state => state.atom_id === "a1" && state.atom_revision === 0)?.status, "legacy")
  const stale = await compiler.authorize({ kind: "start", run_id: "revision", dispatch_id: first.deliveries![0]!.dispatch_id, host_identity: "host" })
  assert.equal(stale.ok, false)
})
