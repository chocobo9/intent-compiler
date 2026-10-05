import { test } from "node:test"
import { stageCandidate } from "./fixtures/stage-candidate.js"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IntentStoreV2 } from "../src/core/compiler-store-v2.js"
import { createIntentCompilerV2 } from "../src/core/intent-compiler-v2.js"
import { createCompilerModelV2, V2_CHECK_CONTRACT, V2_CHECK_CONTRACT_FOR_ASSEMBLED_TASKS, type CompilerModelV2CheckInput, type CompilerModelV2Input } from "../src/model/compiler-model-v2.js"
import { LATER_STATEMENT_SETTLES } from "../src/model/management-instructions.js"
import { atomRef, compiledIntentRef, AtomStateLedger } from "../src/core/compiled-intent.js"
import { atomAdmission } from "../src/core/atom-admission.js"
import { bindCurrentRequirements, contentKey, LATER_INPUT_GOVERNS, selectedSourceHistory, selectSourceEvents, userInputOrder, type RequirementAssembly } from "../src/core/requirement-flow.js"
import { IntentStateManager } from "../src/core/intent-state-v2.js"
import { SourceLedger } from "../src/core/source-payload.js"
import { digestOf, digestText, type Candidate, type CompilerEvent, type SourceRef, type TaskIntent } from "../src/core/intent-contract.js"

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

/**
 * Three user inputs, of which the batch is shown only the first and the third:
 * the delivered block still names each passage by its place in the whole run.
 */
function orderedFixture() {
  const later = "Write the result with a header row."
  const userEvent = (id: string, text: string): CompilerEvent => ({ schema_version: 2, run_id: "run1", event_id: id, kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text } })
  const e1 = userEvent("e1", raw), e2 = userEvent("e2", "An unrelated note."), e3 = userEvent("e3", later)
  const records = [
    { sequence: 1, event: e1 },
    { sequence: 2, event: { ...e2 } },
    { sequence: 3, event: { schema_version: 2, run_id: "run1", event_id: "x1", kind: "execution_return", source: { producer_id: "host", channel: "executor" }, payload: { text: "done" } } as CompilerEvent },
    { sequence: 4, event: e3 },
  ]
  const proposal = candidate()
  const group = proposal.groups[0]!
  const task = new IntentStateManager({}).apply(group.ir_changes, ["t1"]).tasks.t1!
  const earlier = raw.slice(0, 14)
  const r1 = task.content[0]!
  r1.sources = [
    { source_id: "e1", digest: digestText(raw), span: { unit: "utf16", start: 0, end: 14 } },
    { source_id: "e3", digest: digestText(later), span: { unit: "utf16", start: 0, end: later.length } },
  ]
  r1.text = `${earlier}\n\n${later}`
  r1.text_origin = "source"
  const r2 = task.content[1]!
  r2.text = raw.slice(15)
  r2.text_origin = "source"
  return { group, task, records, sources: [e3, e1], earlier, later }
}

test("assembled passages name their user input by its place in the run and run in input order", () => {
  const { group, task, records, sources, earlier, later } = orderedFixture()
  const order = userInputOrder(records)
  assert.deepEqual([...order], [["e1", 1], ["e2", 2], ["e3", 3]], "only user inputs are counted, in journal order")
  const before = structuredClone(task)
  const delivered = bindCurrentRequirements(group, task, undefined, sources, [], assemblyOf(order))[0]!.atoms[0]!.task
  assert.deepEqual(task, before, "assembly leaves the IR content and its digest unchanged")
  const r1 = task.content[0]!, r2 = task.content[1]!
  const r1Block = `[assigned requirement r1@0 ${digestOf(r1)}]\n${LATER_INPUT_GOVERNS}\n[user input 1]\n${earlier}\n\n[user input 3]\n${later}`
  const r2Block = `[assigned requirement r2@0 ${digestOf(r2)}]\n[user input 1]\n${r2.text}`
  assert.ok(delivered.endsWith(`\n\n${r1Block}\n\n${r2Block}`), delivered)
  const stripped = r1Block.split("\n").slice(1).filter(line => line !== LATER_INPUT_GOVERNS && !/^\[user input \d+\]$/u.test(line)).join("\n")
  assert.equal(stripped, r1.text, "without the labels the block is the stored requirement text byte for byte")

  // The same item listed newest-first still delivers its passages oldest-first.
  const reversed = structuredClone(task)
  reversed.content[0]!.sources.reverse()
  reversed.content[0]!.text = `${later}\n\n${earlier}`
  const reorderedTask = bindCurrentRequirements(group, reversed, undefined, sources, [], assemblyOf(order))[0]!.atoms[0]!.task
  assert.ok(reorderedTask.includes(`${LATER_INPUT_GOVERNS}\n[user input 1]\n${earlier}\n\n[user input 3]\n${later}`))

  // Without the run order the block is attached exactly as before.
  const unordered = bindCurrentRequirements(group, task, undefined, sources, [])[0]!.atoms[0]!.task
  assert.ok(unordered.endsWith(`[assigned requirement r1@0 ${digestOf(r1)}]\n${r1.text}\n\n[assigned requirement r2@0 ${digestOf(r2)}]\n${r2.text}`))
})

test("a run order taken from a longer journal keeps every input's number", () => {
  const { group, task, records, sources } = orderedFixture()
  const later = [...records, { sequence: 5, event: { ...records[0]!.event, event_id: "e5" } }]
  const short = bindCurrentRequirements(group, task, undefined, sources, [], assemblyOf(userInputOrder(records)))[0]!.atoms[0]!.task
  const long = bindCurrentRequirements(group, task, undefined, [sources[1]!, sources[0]!], [], assemblyOf(userInputOrder(later)))[0]!.atoms[0]!.task
  assert.equal(long, short, "a later input and a different selection order do not renumber earlier inputs")
})

const assemblyOf = (inputOrder: ReadonlyMap<string, number>, texts: ReadonlyMap<string, string> = new Map(), selected: ReadonlyMap<string, readonly SourceRef[]> = new Map()): RequirementAssembly =>
  ({ inputOrder, texts, ledger: new SourceLedger({ texts, selected, dispositions: [] }) })

/**
 * Generic withdrawal fixture: input 1 states two duties in one sentence; input
 * 2 changes one of them (or voids the sentence); the model withdrew the whole
 * sentence.  The prior IR selected the sentence, the current IR does not.
 */
function withdrawalFixture(update: string) {
  const sentence = "Write the report to report.txt and its checksum to report.sum."
  const userEvent = (id: string, text: string): CompilerEvent => ({ schema_version: 2, run_id: "run1", event_id: id, kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text } })
  const e1 = userEvent("e1", `${raw}\n\n${sentence}`), e2 = userEvent("e2", update)
  const e1Text = (e1.payload as { text: string }).text
  const span = (text: string, part: string, id: string): SourceRef => ({ source_id: id, digest: digestText(text), span: { unit: "utf16", start: text.indexOf(part), end: text.indexOf(part) + part.length } })
  const proposal = candidate()
  const group = proposal.groups[0]!
  const task = new IntentStateManager({}).apply(group.ir_changes, ["t1"]).tasks.t1!
  for (const item of task.content) { item.sources = item.sources.map(source => ({ ...source, digest: digestText(e1Text) })); item.text_origin = "source" }
  const previous = structuredClone(task)
  previous.content[0]!.sources = [span(e1Text, "Implement CSV.", "e1"), span(e1Text, sentence, "e1")]
  previous.content[0]!.text = `Implement CSV.\n\n${sentence}`
  task.content[0]!.sources = [span(e1Text, "Implement CSV.", "e1"), span(update, update, "e2")]
  task.content[0]!.text = `Implement CSV.\n\n${update}`
  task.content[0]!.revision = 1
  group.coverage[1]!.requirement = { local_ref: "r1" }
  const records = [{ sequence: 1, event: e1 }, { sequence: 2, event: e2 }]
  const selected = selectedSourceHistory([], { t1: previous })
  const assembly = assemblyOf(userInputOrder(records), new Map([["e1", e1Text], ["e2", update]]), selected)
  return { group, task, previous, sentence, update, assembly, selected, sources: [e1, e2] }
}

for (const [label, update] of [
  ["only one of its two duties is changed", "Write the checksum to report.b2 instead."],
  ["the whole sentence is voided", "Do not write the report or its checksum; print the report instead."],
] as const) {
  test(`a withdrawn sentence is still delivered before the later input when ${label}`, () => {
    const { group, task, sentence, assembly, sources } = withdrawalFixture(update)
    const beforeTask = structuredClone(task), beforeGroup = structuredClone(group)
    const delivered = bindCurrentRequirements(group, task, undefined, sources, [], assembly)[0]!.atoms[0]!.task
    assert.deepEqual(task, beforeTask, "IR text, sources and digest are unchanged")
    assert.deepEqual(group, beforeGroup, "the candidate and its records are unchanged")
    const r1 = task.content[0]!
    const block = delivered.slice(delivered.indexOf(`[assigned requirement r1@1 ${digestOf(r1)}]`), delivered.indexOf("[assigned requirement r2@"))
    assert.equal(block, `[assigned requirement r1@1 ${digestOf(r1)}]\n${LATER_INPUT_GOVERNS}\n[user input 1]\nImplement CSV.\n\n[user input 1]\n${sentence}\n\n[user input 2]\n${update}\n\n`)
    assert.doesNotMatch(delivered, /withdr|supersed|retract|removed|deleted|撤回|作废/iu, "a withdrawn passage carries no mark")
    const stripped = block.trimEnd().split("\n").slice(1).filter(line => line !== LATER_INPUT_GOVERNS && !/^\[user input \d+\]$/u.test(line)).join("\n")
    assert.equal(stripped, ["Implement CSV.", sentence, update].join("\n\n"), "without labels the block is the passages joined in input order")
    assert.equal(r1.text.includes(sentence), false, "the IR keeps the model's withdrawal")
  })
}

test("a passage another current item still selects is not attached again as withdrawn", () => {
  const { group, task, sentence, assembly, selected, sources } = withdrawalFixture("Write the checksum to report.b2 instead.")
  const moved = structuredClone(task)
  moved.content[1]!.sources = [...moved.content[1]!.sources, selected.get(contentKey("t1", "r1"))![1]!]
  moved.content[1]!.text = `${moved.content[1]!.text}\n\n${sentence}`
  const delivered = bindCurrentRequirements(group, moved, undefined, sources, [], assembly)[0]!.atoms[0]!.task
  assert.equal(delivered.split(sentence).length - 1, 1, "the moved sentence is delivered once, by the item that selects it now")
})

test("selection history reads accepted content changes and the prior IR, and a retire ends it", () => {
  const ref = (id: string, start: number, end: number): SourceRef => ({ source_id: id, digest: "d", span: { unit: "utf16", start, end } })
  const group = (changes: unknown[]) => ({ local_ref: "g", task_refs: ["t1"], ir_changes: changes }) as never
  const history = selectedSourceHistory([
    { status: "accepted", candidate: { groups: [group([{ action: "create", target: "content", local_ref: "r1", sources: [ref("e1", 0, 5)] }, { action: "create", target: "content", local_ref: "r2", sources: [ref("e1", 6, 9)] }])] } },
    { status: "validation_failed", candidate: { groups: [group([{ action: "revise", target: "content", id: "r1", sources: [ref("e9", 0, 1)] }])] } },
    { status: "accepted", candidate: { groups: [group([{ action: "edit", target: "content", id: "r1", remove: [ref("e1", 0, 2)], add: [ref("e2", 0, 4)] }, { action: "retire", target: "content", id: "r2" }])] } },
  ], {})
  assert.deepEqual(history.get(contentKey("t1", "r1")), [ref("e1", 0, 5), ref("e2", 0, 4)])
  assert.equal(history.has(contentKey("t1", "r2")), false)
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
      async (input, generation) => JSON.stringify(stageCandidate(input, proposal, generation)),
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
  assert.deepEqual(prepared.dispatchable_atoms, [atomRef(delivered)], "the dispatch subset is named by ref; its content is the prepared.compiled Atom")
  assert.equal(store.current().compiled.t1!.atoms[0]!.task, delivered.task)
  assert.equal(result.deliveries![0]!.digest, atomRef(delivered).digest)
  const checkedCompilation = checks[0]!.candidate.groups[0]!.compilation
  assert.equal(checkedCompilation.decision, "replace")
  if (checkedCompilation.decision !== "replace") throw new Error("fixture")
  assert.equal(checkedCompilation.drafts[0]!.atoms[0]!.task, instruction)
  assert.ok(delivered.task.startsWith(instruction))
  assert.deepEqual(checks[0]!.contract, V2_CHECK_CONTRACT_FOR_ASSEMBLED_TASKS)
  const contract = checks[0]!.contract.check_contract
  assert.equal(contract.includes("assignments are semantically appropriate"), true)
  assert.equal(contract.includes("Each assigned requirement needs relevant Atoms' goal_refs AND"), false)
  assert.equal(contract.includes("for Atoms bound and assembled in this preparation, it owns coverage-to-content-goal_refs binding"), true)
  assert.equal(contract.includes("Retained Atoms are not reassembled and historical summary Atoms are not automatically repaired"), true)
  assert.equal(contract.includes("judge retained Atoms against currently applicable requirements using their actual final task text"), true)
  assert.equal(contract.includes("each Atom's corresponding prepared.atom_states record"), true)
  assert.equal(contract.includes("applicable scope and explicit correction relationships"), true)
  assert.equal(contract.includes("Their coexistence is not itself an inconsistency"), true)
  assert.equal(contract.includes("each passage is labelled with the number of the run's user input it came from and listed in input order"), true)
  assert.equal(contract.includes("the attached passages include those an item once adopted and later withdrew"), true)
  assert.equal(contract.split("\n").at(-1)!.startsWith("prepared.withdrawals lists every passage this candidate withdrew from the IR"), true)
  assert.equal(contract.includes("Whether a current requirement is omitted is judged on the delivered text: report an omission only when a current requirement cannot be found in the final task of the Atoms that need it, or when that delivered text presents it with a changed meaning."), true)
  assert.equal(contract.includes("It is context for what this batch changed. A withdrawal wider than what the current input actually voids is not a finding while the delivered Atom tasks still carry those passages"), true)
  assert.equal(contract.includes("Removed words that still apply and are not restated are an omitted requirement"), false, "an imprecise IR withdrawal alone is no longer a D4 finding")
  assert.equal(contract.includes("check omitted or wrongly classified meaning"), false, "omission is judged on the delivered text, not on prepared.ir")
  assert.deepEqual(contract.split("\n").slice(0, -2), V2_CHECK_CONTRACT.check_contract.split("\n").slice(0, -1),
    "only the assembled-task comparison clause changes and the withdrawal clause is added; the other check duties remain")
  assert.equal(V2_CHECK_CONTRACT.check_contract.includes("prepared.withdrawals"), false)
  assert.deepEqual(prepared.withdrawals, [], "a first delegation withdraws nothing")
  assert.deepEqual(checks[0]!.contract.rules, V2_CHECK_CONTRACT.rules)
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
      async (input, generation) => {
        if (input.generation_stage === "ir") {
          // Retained prior text must still be offered: it now travels as the
          // addressed segments the current IR cites, not as a raw event list.
          const batchIds = new Set(input.events.map(event => event.event_id))
          seenSources.push([...new Set((input.source_segments ?? []).map(segment => segment.source_id))]
            .filter(id => !batchIds.has(id)))
        }
        return JSON.stringify(stageCandidate(input, proposal, generation))
      },
      async input => {
        checked.push({
          sources: (input.source_events ?? []).map(event => event.event_id),
          requirements: Object.values(input.prepared?.compiled ?? {}).flatMap(intent => intent.atoms)
            .find(atom => atom.atom_id === input.prepared?.dispatchable_atoms[0]?.id && atom.revision === input.prepared?.dispatchable_atoms[0]?.revision)?.goal_refs.map(ref => ref.id) ?? [],
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

test("a second batch's actual CI and check requests show each body once and carry every field their contracts name", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "projection-")), runId: "run1" })
  const update = "Write the result with a header row."
  const second = (): Candidate => {
    const c = candidate()
    const group = c.groups[0]!
    c.basis = { event_ids: ["e2"], refs: [] }
    c.source_coverage = []
    group.ir_changes = [{ action: "revise", target: "content", id: "r1", expected_revision: 0,
      value: { text: "Implement CSV with a header row.", about: [], scope: [{ target_id: "t1" }], support: [] },
      sources: [{ ...source, span: { unit: "utf16", start: 0, end: 14 } }, { source_id: "e2", digest: digestText(update), span: { unit: "utf16", start: 0, end: update.length } }] }]
    if (group.compilation.decision !== "replace") throw new Error("fixture")
    group.compilation.drafts[0]!.atoms[0]!.revision = 1
    return c
  }
  let batch = 1
  const ciRequests: CompilerModelV2Input[] = []
  const checks: CompilerModelV2CheckInput[] = []
  const compiler = createIntentCompilerV2({ store, model: createCompilerModelV2(
    async (input, generation) => {
      if (input.generation_stage === "ci") ciRequests.push(structuredClone(input))
      return JSON.stringify(stageCandidate(input, batch === 1 ? candidate() : second(), generation))
    },
    async input => { checks.push(structuredClone(input)); return JSON.stringify({ schema_version: 2, verdict: "consistent", findings: [] }) },
  ) })
  const user = (id: string, text: string): CompilerEvent => ({ schema_version: 2, run_id: "run1", event_id: id, kind: "user_input", source: { producer_id: "user", channel: "user" }, payload: { text } })
  await compiler.acceptEvent(user("e1", raw))
  assert.equal((await compiler.advance({ runId: "run1" })).ok, true)
  const firstAtom = structuredClone(store.current().compiled.t1!.atoms[0]!)
  const firstPlan = structuredClone(store.current().compiled.t1!)
  const firstIr = structuredClone(store.current().ir)
  batch = 2
  await compiler.acceptEvent(user("e2", update))
  const result = await compiler.advance({ runId: "run1" })
  assert.equal(result.ok, true, result.message)

  // CI request: the stored plan, each current Atom complete.
  const ci = ciRequests.at(-1)!
  assert.deepEqual(ci.compiled, { t1: { ...firstPlan, historical_atoms: [] } }, "the pre-batch plan has one current Atom and no history yet")
  assert.ok(JSON.stringify(ci.contract).length > 0)

  // Check request: wording, fields and one copy of each body.
  const check = checks.at(-1)!
  assert.ok(check.contract.rules.includes(LATER_STATEMENT_SETTLES), "the check contract carries the later-statement rule")
  const prepared = check.prepared!
  const current = store.current().compiled.t1!.atoms.find(atom => atom.revision === 1)!
  assert.deepEqual(prepared.compiled.t1!.atoms, [current], "the current Atom once, complete")
  assert.deepEqual(prepared.compiled.t1!.historical_atoms.map(entry => [entry.id, entry.revision, entry.digest]), [[firstAtom.atom_id, 0, atomRef(firstAtom).digest]], "the superseded version by identity")
  assert.deepEqual(prepared.dispatchable_atoms, [atomRef(current)])
  assert.deepEqual(check.compiled.t1!.atoms, [firstAtom], "the replaced Atom's pre-candidate state, complete")
  assert.deepEqual(Object.keys(check.ir), ["t1"])
  assert.deepEqual(check.ir.t1!.content, [firstIr.t1!.content[0]!], "only the changed content item's pre-candidate state")
  assert.deepEqual(prepared.ir, store.current().ir)
  assert.deepEqual(prepared.withdrawals, [])
  // Every field the check contract names exists in this request.
  for (const field of ["ir", "compiled", "candidate", "events", "source_events", "event_source_refs"] as const) assert.ok(field in check, field)
  for (const field of ["ir", "compiled", "atom_states", "dispatchable_atoms", "withdrawals", "source_dispositions", "eligible_task_ids", "eligible_execution_ids"] as const) assert.ok(field in prepared, `prepared.${field}`)
  assert.deepEqual(prepared.source_dispositions, { not_requirements: [], earlier_unplaced: [] }, "every passage of both inputs is adopted")
  assert.ok(Array.isArray(check.candidate.groups[0]!.execution_decisions))
  const contract = `${check.contract.check_contract}\n${check.contract.rules.join("\n")}`
  for (const named of ["prepared.ir", "prepared.compiled", "prepared.atom_states", "prepared.dispatchable_atoms", "prepared.eligible_task_ids", "prepared.eligible_execution_ids", "prepared.withdrawals", "prepared.source_dispositions.not_requirements", "prepared.source_dispositions.earlier_unplaced", "historical_atoms", "candidate.groups[].execution_decisions", "event_source_refs"]) {
    assert.ok(contract.includes(named), `the contract names ${named}`)
  }
})
