import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SddCompiler } from "../src/core/sdd-compiler.js"
import { SddAdapter, type SddHost } from "../src/adapters/sdd.js"
import type { SddModel } from "../src/model/sdd-model.js"
import type { SddResult } from "../src/core/sdd-contract.js"
import { CANDIDATE_EXAMPLE, CANDIDATE_EXAMPLE_INPUT } from "../src/model/candidate-example.js"
import type { CompilerEvent } from "../src/core/intent-contract.js"

const event: CompilerEvent = { schema_version: 2, run_id: "sdd-test", event_id: "input-event-id", kind: "user_input", source: { channel: "user", producer_id: "test" }, payload: { text: CANDIDATE_EXAMPLE_INPUT } }
/** One acceptance example whose input writes a key the example input defines ("items"). */
function acceptanceFor(_e: CompilerEvent, items: string[] = []) {
  return { subject: "tool", items, examples: [{ given: '{"items": []}', expect: "exit code 0", run: null, check: null }] }
}
const itemsOf = (ir: Record<string, { content: Array<{ item_id: string }> }>) => Object.values(ir).flatMap(t => t.content.map(c => c.item_id))
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "ic-sdd-"))
  const proposal = structuredClone(CANDIDATE_EXAMPLE)
  const model: SddModel = {
    ir: { propose: async () => ({ ok: true, ir_proposal: proposal, call: { text: JSON.stringify(proposal) } }) },
    deliver: async input => ({ text: JSON.stringify({ decision: "deliver", reason: "Current user update", tasks: Object.values(input.ir).map(t => ({
      task_id: t.task_id, effective: [],
      coverage: t.content.map(c => ({ item_id: c.item_id, disposition: "assigned", explanation: "Included" })),
    })), fields: [{ object: "tool", items: itemsOf(input.ir), fields: [{ field: "items", type: "array", required: "yes", meaning: "bundled items" }] }], acceptance: [acceptanceFor(event, itemsOf(input.ir))], changes: [] }) }),
    check: async () => ({ text: JSON.stringify({ verdict: "consistent", findings: [], repair_stage: "none" }) }),
  }
  const compiler = new SddCompiler(directory, event.run_id, model)
  return { directory, compiler, model, proposal }
}
async function compile(f: ReturnType<typeof fixture>) {
  await f.compiler.accept(event, 6)
  const batch = await f.compiler.advance(event.event_id)
  assert.equal(batch.state, "accepted", batch.error)
  return batch.delivery!
}
test("CI-SDD compiles IR directly, preserves source bytes, and never stores Atom dispatches", async () => {
  const f = fixture(), delivery = await compile(f)
  assert.ok(delivery.text.includes('INPUT_MISSING'))
  assert.ok(delivery.text.includes('"items"'))
  assert.ok(!("atoms" in delivery.draft))
  assert.deepEqual(f.compiler.inspect().runs, [])
  assert.equal(f.compiler.inspect().batches[0]!.requests_used, 3)
  const restored = new SddCompiler(f.directory, event.run_id, f.model)
  assert.deepEqual((await restored.advance(event.event_id)).delivery, delivery)
  assert.equal(restored.inspect().batches[0]!.requests_used, 3)
})
test("one user update launches once, duplicate/late returns do not dispatch and are bound to CI", async () => {
  const f = fixture(); await compile(f)
  let launches = 0
  let result: SddResult | undefined
  const host: SddHost = { prepare: async r => ({ directory: join(f.directory, "sdd-run"), ci_ref: r.ci_ref }), launch: async () => { launches++ }, inspect: async () => result }
  const adapter = new SddAdapter(f.compiler, host)
  const run = await adapter.start(event.event_id, { path: f.directory, digest: "baseline" }, "config")
  await assert.rejects(() => adapter.start(event.event_id, run.baseline, "config"), /already has/)
  await f.compiler.accept({ ...event, event_id: "next" }, 6)
  result = { event_id: "return-1", run_id: run.run_id, ci_ref: run.ci_ref, status: "finished", sdd_status: "not_passed", stages: { coding: "fail" }, artifacts: [], source_digest: "same-source", reason: "No code change; failed validation" }
  await assert.rejects(() => f.compiler.receive({ ...result!, ci_ref: { ...run.ci_ref, digest: "wrong" } }), /actual CI/)
  await adapter.reconcile(run.run_id)
  await f.compiler.receive(result)
  assert.equal(launches, 1)
  assert.equal(f.compiler.inspect().batches.at(-1)!.state, "ir")
  await assert.rejects(() => f.compiler.receive({ ...result!, reason: "conflict" }), /Conflicting/)
})
test("ambiguous spawn failure survives restart and cannot become a second development run", async () => {
  const f = fixture(); await compile(f)
  let calls = 0
  const host: SddHost = { prepare: async r => ({ directory: f.directory, ci_ref: r.ci_ref }), launch: async () => { calls++; throw Error("lost after spawn") }, inspect: async () => undefined }
  await assert.rejects(() => new SddAdapter(f.compiler, host).start(event.event_id, { path: f.directory, digest: "baseline" }, "config"), /lost/)
  const restored = new SddCompiler(f.directory, event.run_id, f.model)
  assert.equal(restored.inspect().runs[0]!.state, "launching")
  await assert.rejects(() => new SddAdapter(restored, host).start(event.event_id, { path: f.directory, digest: "baseline" }, "config"), /already has/)
  await new SddAdapter(restored, host).reconcile(restored.inspect().runs[0]!.run_id)
  assert.equal(calls, 1)
})
test("independent check sees assembled source and can reject it within the persisted budget", async () => {
  const f = fixture()
  f.model.check = async input => {
    // The check is told how code built the text; the inputs themselves are in sources once.
    assert.ok(input.delivery.text.startsWith("(not repeated here"))
    assert.ok(Object.values(input.ir).some(t => t.content.some(c => c.text.includes("INPUT_MISSING"))))
    return { text: JSON.stringify({ verdict: "inconsistent", repair_stage: "ci", findings: [{ severity: "blocking", dimension: "D7", claim: "Wrong business boundary", expected: "the stated boundary", observed: "another one",
      refs: [{ id: event.event_id, revision: 0, quote: "INPUT_MISSING" }] }] }) }
  }
  await f.compiler.accept(event, 3)
  assert.equal((await f.compiler.advance(event.event_id)).state, "rejected")
  assert.deepEqual(f.compiler.inspect().ir, {})
  await assert.rejects(() => f.compiler.claim(event.event_id, { path: "a", digest: "b" }, "c"), /No approved/)
})
test("hold and paused content never become a delivery and unselected requirements are not attached", async () => {
  const f = fixture()
  const deliver = f.model.deliver
  f.model.deliver = async input => {
    const answer = JSON.parse((await deliver(input)).text)
    answer.decision = "hold"
    for (const t of answer.tasks) for (const c of t.coverage) c.disposition = "paused"
    return { text: JSON.stringify(answer) }
  }
  const d = await compile(f)
  assert.equal(d.text, "")
  await assert.rejects(() => f.compiler.claim(event.event_id, { path: "a", digest: "b" }, "c"), /No approved/)
})
test("legacy stores cannot silently enter the new profile", () => {
  const f = fixture()
  writeFileSync(join(f.directory, "snapshot.json"), "{}")
  assert.throws(() => new SddCompiler(f.directory, event.run_id, f.model), /legacy/)
})
test("SDD's PRD check is kept with the result; a malformed summary is rejected", async () => {
  const f = fixture(); await compile(f)
  const run = await f.compiler.claim(event.event_id, { path: f.directory, digest: "b" }, "c")
  await f.compiler.prepared(run.run_id, f.directory, run.ci_ref)
  await f.compiler.launchClaim(run.run_id)
  const base: SddResult = { event_id: "r", run_id: run.run_id, ci_ref: run.ci_ref, status: "finished", sdd_status: "not_passed", stages: { prd: "fail" }, artifacts: [], source_digest: "s", reason: "PRD check open" }
  await assert.rejects(() => f.compiler.receive({ ...base, prd_check: { open_gaps: "GAP-004" } as unknown as SddResult["prd_check"] }), /PRD check summary/)
  const prd_check = { state: "NEED_MANUAL_DECISION", status: "fail_or_missing_prd_gate", unresolved: 1, blocked: 0, manual_review: 0,
    open_gaps: [{ title: "GAP-004 F-PIPE-001", text: "top-level seed may be omitted" }], report: "output/08-验证结果.md" }
  await f.compiler.receive({ ...base, prd_check })
  assert.deepEqual(f.compiler.inspect().runs[0]!.result!.prd_check, prd_check)
  assert.equal(f.compiler.inspect().runs[0]!.state, "returned")
})
test("an IR-level check finding invalidates the parent instead of endlessly rewriting CI", async () => {
  const f = fixture()
  let checks = 0, irCalls = 0
  const propose = f.model.ir.propose
  f.model.ir.propose = async input => { irCalls++; return propose(input) }
  f.model.check = async () => ({ text: JSON.stringify(++checks === 1
    ? { verdict: "inconsistent", repair_stage: "ir", findings: [{ severity: "blocking", dimension: "D1", claim: "Repair source interpretation", expected: "x", observed: "y", refs: [{ id: event.event_id, revision: 0, quote: "INPUT_MISSING" }] }] }
    : { verdict: "consistent", findings: [], repair_stage: "none" }) })
  await compile(f)
  assert.equal(irCalls, 2)
  assert.equal(f.compiler.inspect().batches[0]!.requests_used, 6)
})
test("a check finding that cites nothing the request showed is recorded but cannot block", async () => {
  const f = fixture()
  f.model.check = async () => ({ text: JSON.stringify({ verdict: "inconsistent", repair_stage: "ci", findings: [
    { severity: "blocking", dimension: "D6", claim: "Unsupported restriction", expected: "x", observed: "y", refs: [{ id: event.event_id, revision: 0, quote: "a sentence the user never wrote" }] },
    { severity: "blocking", dimension: "D4", claim: "Missing requirement", expected: "x", observed: "y", refs: [{ id: "no-such-object", revision: 3, quote: "" }] },
  ] }) })
  const delivery = await compile(f)
  assert.ok(delivery.text)
  const checks = f.compiler.inspect().batches[0]!.checks!
  assert.equal(checks.length, 1)
  assert.deepEqual(checks[0]!.findings.map(x => x.evidence_resolved), [false, false])
})
test("prepared recovery locates the same run and only a proven prepared run may launch", async () => {
  const f = fixture(); await compile(f)
  const run = await f.compiler.claim(event.event_id, { path: f.directory, digest: "b" }, "c")
  let count = 0
  const adapter = new SddAdapter(f.compiler, { prepare: async () => { throw Error("must not prepare again") },
    locatePrepared: async r => ({ directory: f.directory, ci_ref: r.ci_ref }), launch: async () => { count++ }, inspect: async () => undefined })
  assert.equal((await adapter.reconcile(run.run_id)).state, "prepared")
  await adapter.launchPrepared(run.run_id)
  await assert.rejects(() => adapter.launchPrepared(run.run_id), /Expected prepared/)
  assert.equal(count, 1)
})
test("paused source is omitted from SDD while its management coverage survives", async () => {
  const f = fixture(), deliver = f.model.deliver
  let omitted = ""
  f.model.deliver = async input => {
    const answer = JSON.parse((await deliver(input)).text)
    const t = Object.values(input.ir)[0]!
    const item = t.content.at(-1)!
    omitted = item.text
    answer.tasks[0].coverage.find((c: { item_id: string }) => c.item_id === item.item_id).disposition = "paused"
    return { text: JSON.stringify(answer) }
  }
  const delivery = await compile(f)
  assert.ok(!delivery.text.includes(omitted))
  assert.ok(delivery.draft.tasks[0]!.coverage.some(c => c.disposition === "paused"))
})
test("SDD input is the user's input verbatim; an effective statement on a requirement from one input is rejected", async () => {
  const f = fixture()
  const deliver = f.model.deliver
  let answers = 0
  f.model.deliver = async input => {
    const answer = JSON.parse((await deliver(input)).text)
    const task = answer.tasks[0]
    if (answers++ === 0) task.effective = [{ item_id: task.coverage[0].item_id, text: "The command now reports items.", basis: [{ source_id: event.event_id, segment_id: "s1" }] }]
    return { text: JSON.stringify(answer) }
  }
  const d = await compile(f)
  const errors = f.compiler.inspect().batches[0]!.calls.map(c => c.error ?? "").join(" ")
  assert.match(errors, /its passages all come from one input \(input-event-id\), so no later input changes it/)
  assert.ok(d.text.startsWith("# Accumulated original user requirements\n"))
  assert.ok(!d.text.includes("[requirement as it now holds"))
  assert.ok(d.text.includes(`## Original user update 1\n\n${CANDIDATE_EXAMPLE_INPUT}\n`))
  assert.deepEqual(d.removed, [])
})
test("an effective statement citing a segment no input has is rejected, never delivered", async () => {
  const f = fixture()
  const deliver = f.model.deliver
  f.model.deliver = async input => {
    const answer = JSON.parse((await deliver(input)).text)
    answer.tasks[0].effective = [{ item_id: answer.tasks[0].coverage[0].item_id, text: "Changed.", basis: [{ source_id: event.event_id, segment_id: "s999" }] }]
    return { text: JSON.stringify(answer) }
  }
  await f.compiler.accept(event, 6)
  const batch = await f.compiler.advance(event.event_id)
  assert.equal(batch.state, "rejected")
  assert.match(batch.calls.map(c => c.error ?? "").join(" "), /unknown input segment/)
})
test("a rejected batch reopens once from the stage it reached, with its history and an explicit budget", async () => {
  const f = fixture()
  const deliver = f.model.deliver
  let failing = true
  f.model.deliver = async input => failing ? { text: "not json" } : deliver(input)
  await f.compiler.accept(event, 3)
  assert.equal((await f.compiler.advance(event.event_id)).state, "rejected")
  await assert.rejects(() => f.compiler.reopen(event.event_id, 0, "x"), /explicit budget/)
  failing = false
  const reopened = await f.compiler.reopen(event.event_id, 2, "CI input strictness relaxed")
  assert.equal(reopened.state, "ci")
  assert.equal(reopened.reopened![0]!.requests_used, 2)
  const batch = await f.compiler.advance(event.event_id)
  assert.equal(batch.state, "accepted", batch.error)
  assert.equal(batch.requests_used, 4)
  await assert.rejects(() => f.compiler.reopen(event.event_id, 2, "again"), /Only a rejected batch/)
})
test("after a voided round the next claim must start from that round's own baseline, and the void is recorded", async () => {
  const f = fixture(); await compile(f)
  const run = await f.compiler.claim(event.event_id, { path: "b0", digest: "base-0" }, "c")
  await f.compiler.prepared(run.run_id, f.directory, run.ci_ref)
  await f.compiler.launchClaim(run.run_id)
  await f.compiler.receive({ event_id: "r", run_id: run.run_id, ci_ref: run.ci_ref, status: "finished", sdd_status: "not_passed", stages: { coding: "fail" }, artifacts: [], source_digest: "code-1", reason: "SpecArt BLOCKED" })
  // A second accepted delivery, written directly: this test is about the claim rule.
  const store = join(f.directory, "ci-sdd.json")
  const snapshot = JSON.parse(readFileSync(store, "utf8"))
  snapshot.events.push({ ...event, event_id: "next" })
  snapshot.batches.push({ ...structuredClone(snapshot.batches[0]), event_id: "next" })
  writeFileSync(store, JSON.stringify(snapshot))
  const next = { event_id: "next" }
  await assert.rejects(() => f.compiler.claim(next.event_id, { path: "b", digest: "base-0" }, "c"), /previous source baseline/)
  await assert.rejects(() => f.compiler.claim(next.event_id, { path: "b", digest: "code-1" }, "c", "SpecArt BLOCKED"), /own baseline/)
  await f.compiler.claim(next.event_id, { path: "b", digest: "base-0" }, "c", "SpecArt BLOCKED")
  assert.deepEqual(f.compiler.inspect().runs[0]!.voided, { reason: "SpecArt BLOCKED" })
})
test("a voided run is retried with the same delivery from the same baseline, and the retry names what it replaces", async () => {
  const f = fixture(); await compile(f)
  const first = await f.compiler.claim(event.event_id, { path: "b0", digest: "base-0" }, "c")
  await assert.rejects(() => f.compiler.claim(event.event_id, { path: "b0", digest: "base-0" }, "c", undefined, "void"), /has not returned/)
  await f.compiler.prepared(first.run_id, f.directory, first.ci_ref)
  await f.compiler.launchClaim(first.run_id)
  await f.compiler.receive({ event_id: `return-${first.run_id}`, run_id: first.run_id, ci_ref: first.ci_ref, status: "finished", sdd_status: "not_passed", stages: { coding: "fail" }, artifacts: [], source_digest: "code-1", reason: "SPEC_GAP" })
  await assert.rejects(() => f.compiler.claim(event.event_id, { path: "b0", digest: "base-0" }, "c"), /already has an SDD claim/)
  await assert.rejects(() => f.compiler.claim(event.event_id, { path: "b", digest: "code-1" }, "c", undefined, "void"), /own baseline/)
  const second = await f.compiler.claim(event.event_id, { path: "b0", digest: "base-0" }, "c", undefined, "auto_void_round: coding SPEC_GAP")
  assert.equal(second.run_id, `${first.run_id}-attempt2`)
  assert.equal(second.retry_of, first.run_id)
  assert.deepEqual(second.ci_ref, first.ci_ref)
  const s = f.compiler.inspect()
  assert.deepEqual(s.runs[0]!.voided, { reason: "auto_void_round: coding SPEC_GAP" })
  assert.equal(s.batches[0]!.requests_used, 3, "a retry makes no management call")
})
test("a coverage that misses a requirement is rejected with the missing item ids", async () => {
  const f = fixture()
  const deliver = f.model.deliver
  let answers = 0
  f.model.deliver = async input => {
    const answer = JSON.parse((await deliver(input)).text)
    if (answers++ === 0) answer.tasks[0].coverage = answer.tasks[0].coverage.slice(1)
    else assert.match(input.issues.join(" "), /missing coverage for item_id \S+/)
    return { text: JSON.stringify(answer) }
  }
  const delivery = await compile(f)
  assert.ok(delivery.text)
  const errors = f.compiler.inspect().batches[0]!.calls.map(c => c.error ?? "").join(" ")
  assert.match(errors, /missing coverage for item_id .+\. Give one coverage entry for each of: /)
})
test("acceptance examples open SDD's input; a literal the cited input does not contain is rejected with its name", async () => {
  const f = fixture(), deliver = f.model.deliver
  let answers = 0
  f.model.deliver = async input => {
    const answer = JSON.parse((await deliver(input)).text)
    if (answers++ === 0) answer.acceptance[0].examples[0].given += ' {"not-in-the-input": 2}'
    return { text: JSON.stringify(answer) }
  }
  const d = await compile(f)
  const errors = f.compiler.inspect().batches[0]!.calls.map(c => c.error ?? "").join(" ")
    assert.match(errors, /key "not-in-the-input" is not a key the requirements write/)
  assert.ok(d.text.startsWith("# Accumulated original user requirements\nApply each update in order. Later explicit revisions replace only the affected earlier requirements.\n\n# Interface and data: field dictionary\n"))
  assert.ok(d.text.indexOf("## tool\nExample 1\nGiven:\n{") < d.text.indexOf("## Original user update 1\n"))
  assert.ok(d.text.includes(`## Original user update 1\n\n${CANDIDATE_EXAMPLE_INPUT}\n`))
})
test("a key that survives only in text this delivery cuts, or that the requirements never write, is rejected", async () => {
  const { checkAcceptance } = await import("../src/core/sdd-compiler.js")
  const original = 'Use the old key `legacy_key` with {"op": "x"}.'
  const example = (given: string) => [{ subject: "op", items: [], examples: [{ given, expect: "ok" }] }]
  assert.throws(() => checkAcceptance(example('{"op": "x", "legacy_key": 1}'), 'with {"op": "x"}.', original), /key "legacy_key" occurs only in text this delivery cuts/)
  assert.doesNotThrow(() => checkAcceptance(example('{"op": "x", "legacy_key": 1, "file": ignored}'.replace('"file": ignored', '"legacy_key": 2')), original, original))
  assert.throws(() => checkAcceptance(example('{"operator": "gt"}'), original, original), /key "operator" is not a key the requirements write/)
  assert.throws(() => checkAcceptance([], "x", "x"), /needs acceptance examples/)
})
test("the field dictionary precedes the examples; a field the requirements never write is rejected", async () => {
  const { checkFields } = await import("../src/core/sdd-compiler.js")
  const original = 'Run with --input <path>; the recipe uses {"op": "filter", "condition": "gt"}.'
  const dict = (field: string) => [{ object: "filter", items: [], fields: [{ field, type: "string", required: "yes", meaning: "m" }] }]
  assert.doesNotThrow(() => checkFields(dict("condition"), original, original))
  assert.doesNotThrow(() => checkFields(dict("--input"), original, original))
  assert.throws(() => checkFields(dict("operator"), original, original), /field "operator" is not a name the requirements write/)
  assert.throws(() => checkFields(dict("condition"), "cut", original), /occurs only in text this delivery cuts/)
  const f = fixture(), d = await compile(f)
  assert.ok(d.text.indexOf("# Interface and data: field dictionary\n") < d.text.indexOf("# Acceptance examples\n"))
  assert.ok(d.text.includes("| `items` | array | yes | bundled items |"))
})
test("an earlier attempt can be adopted; later attempts are superseded and the next round continues from the adopted code", async () => {
  const f = fixture(); await compile(f)
  const finish = async (run: { run_id: string; ci_ref: SddResult["ci_ref"] }, source: string) => {
    await f.compiler.prepared(run.run_id, f.directory, run.ci_ref)
    await f.compiler.launchClaim(run.run_id)
    await f.compiler.receive({ event_id: `return-${run.run_id}`, run_id: run.run_id, ci_ref: run.ci_ref, status: "finished", sdd_status: "not_passed", stages: {}, artifacts: [], source_digest: source, reason: "" })
  }
  const first = await f.compiler.claim(event.event_id, { path: "b0", digest: "base-0" }, "c"); await finish(first, "code-1")
  const second = await f.compiler.claim(event.event_id, { path: "b0", digest: "base-0" }, "c", undefined, "misread as void"); await finish(second, "code-2")
  await assert.rejects(() => f.compiler.adopt(second.run_id, "x"), /earlier attempt/)
  await f.compiler.adopt(first.run_id, "score parser misread attempt 1")
  const s = f.compiler.inspect()
  assert.equal(s.runs[0]!.voided, undefined)
  assert.deepEqual(s.runs[1]!.superseded, { by: first.run_id, reason: "score parser misread attempt 1" })
  const store = join(f.directory, "ci-sdd.json"), snapshot = JSON.parse(readFileSync(store, "utf8"))
  snapshot.events.push({ ...event, event_id: "next" }); snapshot.batches.push({ ...structuredClone(snapshot.batches[0]), event_id: "next" })
  writeFileSync(store, JSON.stringify(snapshot))
  await assert.rejects(() => f.compiler.claim("next", { path: "b", digest: "code-2" }, "c"), /previous source baseline/)
  await f.compiler.claim("next", { path: "b", digest: "code-1" }, "c")
})
test("a repeated effective statement is rejected naming the item; an empty field object is left out and recorded", async () => {
  const f = fixture(), deliver = f.model.deliver
  let answers = 0
  f.model.deliver = async input => {
    const answer = JSON.parse((await deliver(input)).text)
    const item = answer.tasks[0].coverage[0].item_id
    const e = { item_id: item, text: "Holds.", basis: [{ source_id: event.event_id, segment_id: "s1" }] }
    answer.tasks[0].effective = answers++ === 0 ? [e, e] : []
    answer.fields.push({ object: "plain CSV data", items: itemsOf(input.ir), fields: [] })
    return { text: JSON.stringify(answer) }
  }
  const d = await compile(f)
  const errors = f.compiler.inspect().batches[0]!.calls.map(c => c.error ?? "").join(" ")
  assert.match(errors, /Duplicate effective statement: \S+; give each only once/)
  assert.deepEqual(d.field_objects_left_out, ["plain CSV data"])
  assert.ok(!d.text.includes("## plain CSV data"))
})
test("code completes the field dictionary with every key and option the text writes and merges repeated rows", async () => {
  const { completeFields, OTHER_NAMES } = await import("../src/core/sdd-compiler.js")
  const text = 'Run `dpipe compare --left a --tolerance 0`. Recipe: {"op": "aggregate", "column": "v", "having": {"column": "n", "condition": "gt"}}'
  const out = completeFields([
    { object: "aggregate", items: [], fields: [{ field: "column", type: "string", required: "yes", meaning: "outer" }, { field: "column", type: "string", required: "yes", meaning: "inside having" }] },
    { object: "plain CSV", items: [], fields: [] },
  ], text)
  assert.deepEqual(out.fields[0]!.fields, [{ field: "column", type: "string", required: "yes", meaning: "outer; inside having" }])
  assert.deepEqual(out.leftOut, ["plain CSV"])
  assert.deepEqual(out.added.sort(), ["--left", "--tolerance", "condition", "having", "op"].sort())
  assert.equal(out.fields.at(-1)!.object, OTHER_NAMES)
})
test("a field written only as a command-line option is rejected with the option to use", async () => {
  const { checkFields } = await import("../src/core/sdd-compiler.js")
  const text = "Compare with --tolerance <number>."
  assert.throws(() => checkFields([{ object: "pipeline config", items: [], fields: [{ field: "tolerance", type: "number", required: "no", meaning: "m" }] }], text, text), /the requirements write --tolerance, a command-line option/)
})
test("a CI repair receives the rejected draft with the issue and revises it, also after a reopen", async () => {
  const f = fixture(), deliver = f.model.deliver
  const seen: Array<{ previous: boolean; issues: string[] }> = []
  f.model.deliver = async input => {
    seen.push({ previous: input.previous_draft !== undefined, issues: input.issues })
    const answer = JSON.parse((await deliver(input)).text)
    if (seen.length === 1) answer.acceptance[0].examples[0].given += ' {"not-in-the-input": 2}'
    return { text: JSON.stringify(answer) }
  }
  await f.compiler.accept(event, 3)
  assert.equal((await f.compiler.advance(event.event_id)).state, "rejected")
  await f.compiler.reopen(event.event_id, 3, "repair")
  assert.equal((await f.compiler.advance(event.event_id)).state, "accepted")
  assert.deepEqual(seen.map(x => x.previous), [false, true])
  assert.match(seen[1]!.issues.join(" "), /not-in-the-input/)
  assert.ok(f.compiler.inspect().batches[0]!.last_draft)
})
test("code carries unchanged entries, drops withdrawn ones and rewrites revised or held ones", async () => {
  const { planCarry } = await import("../src/core/sdd-increment.js")
  const ir = (items: Array<[string, number]>) => ({ t: { task_id: "t", revision: 0, content: items.map(([item_id, revision]) => ({ item_id, revision })) } }) as unknown as Parameters<typeof planCarry>[1]
  const entry = (name: string, revisions: Record<string, number>) => ({ object: name, subject: name, items: Object.keys(revisions), revisions, carried: false, fields: [], examples: [] })
  const previous = { fields: [entry("keep", { a: 0 }), entry("gone", { b: 0 }), entry("revised", { c: 0, a: 0 }), entry("held", { d: 0, e: 0 })],
    acceptance: [entry("keep", { a: 0 })], effective: [{ task_id: "t", revision: 0, entry: { item_id: "c", text: "x", basis: [] }, carried: false }], dropped: [] }
  const accepted = ir([["a", 0], ["b", 0], ["c", 0], ["d", 0], ["e", 0]])
  const plan = planCarry(previous as never, accepted, ir([["a", 0], ["c", 1], ["d", 0], ["e", 0], ["f", 0]]), new Set(["d"]))
  assert.deepEqual(plan.fields.map(o => o.object), ["keep"])
  assert.deepEqual(plan.acceptance.map(o => o.subject), ["keep"])
  assert.deepEqual(plan.dropped.map(d => [d.kind, d.name]), [["field", "gone"], ["field", "revised"], ["field", "held"], ["effective", "c"]])
  assert.deepEqual([...plan.toWrite].sort(), ["a", "c", "e", "f"], "new f, revised c, and the still-current items of entries not carried")
})
test("an item a later update cut part of without revising it counts as revised for carrying", async () => {
  const { planCarry, narrowedItems } = await import("../src/core/sdd-increment.js")
  const ir = (spans: Record<string, [number, number]>) => ({ t: { task_id: "t", revision: 0, content: Object.entries(spans).map(([item_id, [start, end]]) => ({ item_id, revision: 0, sources: [{ source_id: "r1", span: { start, end } }] })) } }) as never
  const accepted = ir({ ingest: [0, 100], transform: [100, 200] })
  const current = ir({ ingest: [0, 100], transform: [100, 160] })
  assert.deepEqual([...narrowedItems(accepted, current)], ["transform"])
  const entry = (name: string) => ({ object: name, subject: name, items: [name], revisions: { [name]: 0 }, carried: false, fields: [], examples: [] })
  const plan = planCarry({ fields: [entry("ingest"), entry("transform")], acceptance: [], effective: [], dropped: [] } as never, accepted, current)
  assert.deepEqual(plan.fields.map(o => o.object), ["ingest"])
  assert.match(plan.dropped.find(d => d.name === "transform")!.reason, /cut or moved part of it/u)
  assert.deepEqual([...plan.toWrite], ["transform"])
})
test("a check note is recorded but does not send the CI back; a resolved blocking finding does", async () => {
  const f = fixture()
  let checks = 0
  f.model.check = async () => ({ text: JSON.stringify({ verdict: "inconsistent", repair_stage: "ci", findings: [
    { severity: checks++ === 0 ? "blocking" : "note", dimension: "D6", claim: "c", expected: "e", observed: "o", refs: [{ id: event.event_id, revision: 0, quote: "INPUT_MISSING" }] }] }) })
  const d = await compile(f)
  assert.ok(d.text)
  const records = f.compiler.inspect().batches[0]!.checks!
  assert.deepEqual(records.map(r => r.findings[0]!.severity), ["blocking", "note"])
})
test("IR shape normalization maps only unambiguous shapes and records each change", async () => {
  const { normalizeIrProposal } = await import("../src/core/sdd-ir-normalize.js")
  const answer = {
    schema_version: 2, basis: { event_ids: ["e"], refs: [] }, questions: [],
    groups: [{ local_ref: "g", task_refs: ["t"], depends_on: [], source_coverage: [{ source: { source_id: "e", digest: "d", segment_id: "s9" }, disposition: "context", requirements: [], reason: "r", basis: [] }],
      ir_changes: [
        { action: "revise", target: "task", id: "t", local_ref: "t", value: {}, sources: [{ source_id: "e", digest: "d", quote: "Q" }] },
        { action: "create", target: "content", local_ref: "c", value: {}, sources: [{ source_id: "e", digest: "d", segment_id: "s1" }] },
        { action: "edit", target: "content", id: "c0", remove: [], add: [{ source_id: "e", digest: "d", segment_id: "s2" }], sources: [{ source_id: "e", digest: "d", segment_id: "s2" }], reason: "r" },
      ] }],
  }
  const { value, changes } = normalizeIrProposal(answer) as { value: any; changes: Array<{ reason: string }> }
  assert.equal(value.questions, undefined); assert.deepEqual(value.groups[0].questions, [])
  assert.equal(value.groups[0].source_coverage, undefined); assert.equal(value.source_coverage.length, 1)
  assert.deepEqual(value.source_coverage[0].source, { source_id: "e", digest: "d", segment_id: "s9", quote: null, span: null })
  const [task, content, edit] = value.groups[0].ir_changes
  assert.equal(task.local_ref, undefined); assert.deepEqual(task.sources[0], { source_id: "e", digest: "d", quote: "Q", segment_id: null, span: null })
  assert.deepEqual(content.sources[0], { source_id: "e", digest: "d", segment_id: "s1" }, "the quote-or-segment content form is left as written")
  assert.equal(edit.sources, undefined); assert.deepEqual(edit.basis, [{ source_id: "e", digest: "d", segment_id: "s2" }])
  assert.ok(changes.every(c => c.reason))
  const ambiguous = { schema_version: 2, basis: {}, questions: [], groups: [{ local_ref: "a", task_refs: [], ir_changes: [] }, { local_ref: "b", task_refs: [], ir_changes: [] }] }
  assert.ok((normalizeIrProposal(ambiguous).value as any).questions, "answer-level questions with two groups stay where they are")
})
test("an example is checkable only when every expected value is written by the requirements", async () => {
  const { checkability } = await import("../src/core/sdd-examples.js")
  const text = "Prints `VERIFIED` and exits with code 0; on mismatch prints `MISMATCH expected=<e> actual=<a>` and exit code 1.\nOutput:\nid,v\n1,a\n"
  const run = { args: ["verify"], files: [], stdin: null }
  const check = (c: object) => ({ exit_code: null, stdout_exact: null, stdout_contains: [], stderr_contains: [], files: [], ...c })
  const ok = checkability({ given: "g", expect: "e", run, check: check({ exit_code: 1, stdout_contains: ["MISMATCH expected="] }) }, text)
  assert.equal(ok.checkable, true); assert.equal(ok.exit_code, 1)
  assert.deepEqual(ok.asserts, [{ where: "either", mode: "contains", value: "MISMATCH expected=", source: "verbatim" }], "the requirement states no stream for it")
  // A filled-in placeholder is never itself checked: the template is, with placeholders open.
  const filled = checkability({ given: "g", expect: "e", run, check: check({ stdout_contains: ["MISMATCH expected=abc actual=def"] }) }, text)
  assert.equal(filled.asserts[0]!.mode, "pattern"); assert.ok(new RegExp(filled.asserts[0]!.value, "u").test("MISMATCH expected=x actual=y"))
  // The stream is the requirement's: a line that says stderr makes it stderr whatever the example said.
  const stream = checkability({ given: "g", expect: "e", run, check: check({ stdout_contains: ["ERROR: file not found: a.csv"] }) }, "Missing input files: exit code 1, stderr message `ERROR: file not found: <path>`.")
  assert.equal(stream.asserts[0]!.where, "stderr")
  assert.ok(checkability({ given: "g", expect: "e", run, check: check({ files: [{ path: "o.csv", exact: "id,v\n1,a\n", contains: [] }] }) }, text).checkable)
  const computed = checkability({ given: "g", expect: "e", run, check: check({ stdout_exact: "42.5" }) }, text)
  assert.equal(computed.checkable, false); assert.match(computed.reasons[0]!, /not written/)
  assert.equal(checkability({ given: "g", expect: "e", run, check: check({ exit_code: 3 }) }, text).checkable, false)
  assert.equal(checkability({ given: "g", expect: "e", run: null, check: null }, text).checkable, false)
})
test("the ledger opens failing examples, closes passing ones, drops revised ones, and writes the section", async () => {
  const { computeLedger, ledgerSection } = await import("../src/core/sdd-ledger.js")
  const example = { given: "verify a mismatch", expect: "MISMATCH expected=", run: { args: [], files: [], stdin: null }, check: null, checkable: true }
  const delivery = (ref: string, revision: number) => ({ ref: { id: ref }, contract: { acceptance: [{ subject: "verify", items: ["r-verify"], revisions: { "r-verify": revision }, examples: [example] }] } })
  const run = (ref: string, event: string, passed: boolean, gaps: string[] = []) => ({ run_id: `run-${ref}`, event_id: event, ci_ref: { id: ref }, result: { example_results: [{ id: "verify#1", passed, failures: passed ? [] : ["stdout lacks 'MISMATCH expected='"] }], prd_check: { open_gaps: gaps.map(title => ({ title, text: `${title} text` })) } } })
  const ir = (revision: number) => ({ t: { content: [{ item_id: "r-verify", revision, text: "verify prints MISMATCH expected=<e> actual=<a>" }] } })
  const store = (runs: unknown[]) => ({ batches: [{ delivery: delivery("c1", 0) }, { delivery: delivery("c2", 0) }], runs }) as never
  const open = computeLedger(store([run("c1", "r1-user-input", false, ["GAP-1 seed"])]), ir(0) as never)
  assert.deepEqual(open.map(e => [e.id, e.state, e.first_failed]), [["verify#1", "open", "r1-user-input"], ["gap:GAP-1 seed", "open", "r1-user-input"]])
  const section = ledgerSection(open, ir(0) as never)
  assert.match(section, /^# Existing requirements the current code does not yet meet\n/u)
  assert.match(section, /Failing since user update 1/u); assert.match(section, /verify prints MISMATCH/u); assert.match(section, /left open by SDD's own PRD check/u)
  const later = computeLedger(store([run("c1", "r1-user-input", false, ["GAP-1 seed"]), run("c2", "r2-user-input", true)]), ir(0) as never)
  assert.deepEqual(later.map(e => e.state), ["closed", "closed"])
  assert.deepEqual(computeLedger(store([run("c1", "r1-user-input", false)]), ir(1) as never).map(e => e.state), ["removed"])
  assert.equal(ledgerSection(later, ir(0) as never), "")
})
test("a placeholder-only fixed text is no template: an example cannot pass on it vacuously", async () => {
  const { checkability } = await import("../src/core/sdd-examples.js")
  const text = "Writes the report to `<path>`; errors print `ERROR: file not found: <path>`."
  const run = { args: [], files: [], stdin: null }
  const check = (c: object) => ({ exit_code: null, stdout_exact: null, stdout_contains: [], stderr_contains: [], files: [], ...c })
  assert.equal(checkability({ given: "", expect: "", run, check: check({ stdout_contains: ["anything at all"] }) }, text).checkable, false)
  const r = checkability({ given: "", expect: "", run, check: check({ stdout_contains: ["ERROR: file not found: x.csv"] }) }, text)
  assert.ok(r.checkable && r.asserts[0]!.value.startsWith("ERROR: file not found: "))
})
test("the examples stage keeps verbatim examples the requirement writes and derived ones an independent derivation reproduces", async () => {
  const f = fixture()
  const run = { args: ["bundle"], files: [], stdin: null }
  const check = (c: object) => ({ exit_code: null, stdout_exact: null, stdout_contains: [], stderr_contains: [], files: [], ...c })
  let derivedSeen: unknown
  f.model.examples = async input => ({ text: JSON.stringify({ examples: [
    { subject: "missing input", items: input.requirements.map(r => r.item_id).slice(0, 1), tier: "verbatim", given: "no config", run, check: check({ stderr_contains: ["INPUT_MISSING"] }) },
    { subject: "agreed", items: input.requirements.map(r => r.item_id).slice(0, 1), tier: "derived", given: "a", run, check: check({ stdout_exact: "x" }) },
    { subject: "disputed", items: input.requirements.map(r => r.item_id).slice(0, 1), tier: "derived", given: "b", run, check: check({ stdout_exact: "y" }) },
    { subject: "invalid call", items: input.requirements.map(r => r.item_id).slice(0, 1), tier: "verbatim", given: "required option left out", run, check: check({ stderr_contains: ["INPUT_MISSING"] }) },
    { subject: "illustration", items: input.requirements.map(r => r.item_id).slice(0, 1), tier: "verbatim", given: "an input the written value does not follow from", run, check: check({ stderr_contains: ["INPUT_MISSING"] }) },
  ] }) })
  const valid = { invocation_valid: true, invalid_reason: null }
  f.model.derive = async input => { derivedSeen = input; return { text: JSON.stringify({ results: [{ index: 0, ...valid, check: check({ stderr_contains: ["INPUT_MISSING"] }) }, { index: 1, ...valid, check: check({ stdout_exact: "x" }) }, { index: 2, ...valid, check: check({ stdout_exact: "z" }) },
    { index: 3, invocation_valid: false, invalid_reason: "the required option is missing", check: check({}) }, { index: 4, ...valid, check: check({ stdout_contains: ["done"] }) }] }) } }
  const d = await compile(f)
  assert.deepEqual(d.examples_call, { state: "written", verbatim: 1, derived_kept: 1, derived_dropped: 1, not_checkable: 1, invalid_input: 1, runs_kept: 0, runs_dropped: 0 }, "a written value the example's own input does not determine is not asserted")
  assert.deepEqual(d.contract.executable!.map(e => [e.subject, e.tier]), [["missing input", "verbatim"], ["agreed", "derived"]])
  assert.ok(!JSON.stringify(derivedSeen).includes('"stdout_exact"'), "the derivation never sees the expected results")
  assert.ok(d.text.includes("# Executable acceptance examples\n") && d.text.includes("## 1. missing input"))
  assert.ok(!d.text.includes("agreed"), "derived examples are not delivered to SDD")
  const b = f.compiler.inspect().batches[0]!
  assert.equal(b.requests_used, 3, "the examples stage has its own calls, outside the management budget")
  assert.deepEqual(b.calls.map(c => c.stage).slice(-2), ["examples", "derive"])
})
test("derived agreement compares what each check claims, place by place, and item labels map to their ids", async () => {
  const { agreedAsserts, itemOf } = await import("../src/core/sdd-executable.js")
  const check = (c: object) => ({ exit_code: null, stdout_exact: null, stdout_contains: [], stderr_contains: [], files: [], ...c })
  const a = check({ exit_code: 0, files: [{ path: "out.csv", exact: "id,v\n1,2\n", contains: [] }], stdout_contains: ["done"] })
  const b = check({ exit_code: 0, files: [{ path: "out.csv", exact: "id,v\n1,2", contains: [] }], stdout_contains: ["finished"] })
  const r = agreedAsserts(a, b)
  assert.equal(r.exit_code, 0)
  assert.deepEqual(r.asserts, [{ where: "file:out.csv", mode: "lines", value: JSON.stringify(["=id,v", "=1,2"]), source: "derived" }])
  assert.deepEqual(agreedAsserts(a, check({ files: [{ path: "out.csv", exact: null, contains: ["id,v", "1,2"] }] })).asserts, [], "a whole line and a part of a line are different claims")
  assert.deepEqual(agreedAsserts(check({ stdout_exact: "x\ny" }), check({ stdout_exact: "y\nx" })).asserts, [], "line order is part of the claim")
  const now = new Map([["r-dpipe-validate", 0], ["r-dpipe-validate-extra", 1]])
  assert.equal(itemOf("r-dpipe-validate: Output format", now), "r-dpipe-validate")
  assert.equal(itemOf("r-dpipe-validate-extra", now), "r-dpipe-validate-extra")
  assert.equal(itemOf("r-other", now), undefined)
})
test("the change list keeps entries on items this update changed, fills uncovered changed items, and lists open ledger entries", async () => {
  const { changedItems, settleChanges, changeSection } = await import("../src/core/sdd-changes.js")
  const task = (items: Array<[string, number, string]>) => ({ t: { task_id: "t", content: items.map(([item_id, revision, text]) => ({ item_id, revision, text })) } }) as never
  const before = task([["r-fill", 0, "### fill\nLinear fill uses both anchors."], ["r-sort", 0, "### sort\nSorts rows."]])
  const after = task([["r-fill", 1, "### fill\nLinear fill with one anchor copies that anchor."], ["r-sort", 0, "### sort\nSorts rows."], ["r-clip", 0, "### clip\n`{\"op\": \"clip\", \"column\": \"v\", \"min\": 0}`"]])
  const changed = changedItems(before, after, new Set())
  assert.deepEqual([...changed.keys()], ["r-fill", "r-clip"])
  const { changes, dropped } = settleChanges([
    { kind: "revised", subject: "fill", items: ["r-fill: linear"], old_rule: "both anchors needed", new_rule: "one anchor is copied", parameters: [], quote: "Linear fill with one anchor   copies that anchor." },
    { kind: "revised", subject: "sort", items: ["r-sort"], old_rule: "x", new_rule: "y", parameters: [], quote: "Sorts rows." },
  ], changed)
  assert.deepEqual(changes.map(c => [c.subject, c.items, !!c.filled_by_code, !!c.quote_replaced]), [["fill", ["r-fill"], false, false], ["clip", ["r-clip"], true, false]])
  assert.deepEqual(dropped.map(d => d.name), ["sort"])
  const ledger = [{ id: "x#1", kind: "example", subject: "verify mismatch", items: ["r-sort"], revisions: {}, first_failed: "r1-user-input", last: { event_id: "r1-user-input", run_id: "run", passed: false, observed: "printed nothing" }, state: "open" }] as never
  const section = changeSection(changes, ledger, after)
  assert.match(section, /^# Changes in this update\n/u)
  assert.match(section, /## Changed: fill\nBefore: both anchors needed\nNow: one anchor is copied/u)
  assert.match(section, /## New: clip/u); assert.match(section, /## Not yet met: verify mismatch[\s\S]*printed nothing/u)
})
test("a runs example is kept only when it uses the requirement's own sample, and asserts that it runs", async () => {
  const { keepExamples, usesSample } = await import("../src/core/sdd-executable.js")
  const text = "### clip\n```json\n{\"op\": \"clip\", \"column\": \"v\", \"min\": 0, \"max\": 9}\n```\n`dpipe transform --input <path> --recipe <path> --output <path> --seed <uint64> [--verbose]`"
  const recipe = (o: object) => ({ args: ["transform", "--input", "d.csv", "--recipe", "r.json", "--output", "o.csv", "--seed", "1"], files: [{ path: "r.json", content: JSON.stringify([o]) }], stdin: null })
  assert.ok(usesSample(recipe({ max: 9, min: 0, column: "v", op: "clip" }), text), "key order aside")
  assert.ok(usesSample({ args: ["transform", "--input", "a", "--recipe", "b", "--output", "c", "--seed", "1"], files: [], stdin: null }, text.slice(text.indexOf("`dpipe"))), "a command line counts where the text writes no JSON sample; its bracketed option is optional")
  assert.ok(!usesSample({ args: ["transform", "--input", "a", "--recipe", "b", "--output", "c", "--seed", "1"], files: [], stdin: null }, text), "where JSON samples exist, the command line alone is not the sample")
  assert.ok(!usesSample({ args: ["transform", "--input", "a", "--recipe", "b", "--output", "c"], files: [], stdin: null }, text.split("\n`dpipe")[0]!.replace("\"max\": 9", "\"max\": 8")))
  const current = { t: { task_id: "t", content: [{ item_id: "r-clip", revision: 0, text }] } } as never
  const check = { exit_code: null, stdout_exact: null, stdout_contains: [], stderr_contains: [], files: [{ path: "o.csv", exact: null, contains: [] }] }
  const r = keepExamples([
    { subject: "clip runs", items: ["r-clip"], tier: "runs", given: "sample", run: recipe({ op: "clip", column: "v", min: 0, max: 9 }), check },
    { subject: "made up", items: ["r-clip"], tier: "runs", given: "other", run: recipe({ op: "clip", column: "w" }), check },
    { subject: "blank row", items: ["r-clip"], tier: "runs", given: "a blank data line", run: { ...recipe({ op: "clip", column: "v", min: 0, max: 9 }), files: [{ path: "d.csv", content: "v\n1\n\n2\n" }, ...recipe({ op: "clip", column: "v", min: 0, max: 9 }).files] }, check },
  ], new Map([[0, { invocation_valid: true, invalid_reason: null, check: { ...check, files: [...check.files, { path: "o.csv.sha256", exact: null, contains: [] }] } }]]), text, current, "r2")
  assert.equal(r.counts.runs_kept, 1); assert.equal(r.counts.runs_dropped, 1); assert.equal(r.counts.invalid_input, 1, "a blank line inside CSV data is an undecided input")
  assert.deepEqual(r.kept[0]!.asserts, [{ where: "either", mode: "absent", value: "ERROR", source: "runs" }, { where: "file:o.csv", mode: "exists", value: "", source: "runs" }])
  assert.equal(r.kept[0]!.exit_code, 0)
})
test("a change entry code fills states plainly that code listed it from the IR change", async () => {
  const { settleChanges, changeSection } = await import("../src/core/sdd-changes.js")
  const { changes } = settleChanges([], new Map([["r-x", { existed: true, text: "### x\nNow x rounds up." }]]))
  assert.equal(changes[0]!.filled_by_code, true); assert.equal(changes[0]!.old_rule, null)
  assert.match(changeSection(changes, [], {} as never), /Listed by code from this update's IR change; quotes the original./u)
})
