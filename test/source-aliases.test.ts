import { test } from "node:test"
import assert from "node:assert/strict"
import { buildSourceAliasIndex, decodeIRProposal, expressIRRequest } from "../src/core/source-aliases.js"
import { digestOf, digestText, type CompilerEvent, type SourceRef, type TaskIntent } from "../src/core/intent-contract.js"
import type { CompilerModelV2Input } from "../src/model/compiler-model-v2.js"
import type { IRProposal } from "../src/model/generation-schema.js"

const event = (id: string, text: string, sequence: number) => ({
  sequence,
  digest: digestOf({ schema_version: 2, run_id: "r", event_id: id, kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text } }),
  event: { schema_version: 2, run_id: "r", event_id: id, kind: "user_input",
    source: { channel: "user", producer_id: "user" }, payload: { text } } as CompilerEvent,
})

const ref = (sourceId: string, note = "x"): SourceRef => ({ source_id: sourceId, digest: `sha256:${note}`,
  span: { unit: "utf16", start: 0, end: 1 } })

const task = (sourceId: string): TaskIntent => ({
  task_id: "t1", revision: 0,
  goal: { text: "goal", sources: [ref(sourceId)] },
  current_scope: { text: "scope", disposition: "proceed", sources: [ref(sourceId)] },
  bindings: [{ binding_id: "b1", revision: 0, ref: ref(sourceId), role: "task_data", purpose: "p", sources: [ref(sourceId)] }],
  outputs: [{ output_id: "o1", revision: 0, description: "d", format: "text", sources: [ref(sourceId)] }],
  content: [{ item_id: "c1", revision: 0, text: "rule", sources: [ref(sourceId)], about: [], scope: [], support: [] }],
  unresolved: [],
})

const proposal = (sourceId: string): IRProposal => ({
  schema_version: 2,
  basis: { event_ids: [sourceId], refs: [] },
  source_coverage: [{ source: ref(sourceId), disposition: "context", requirements: [], reason: "r", basis: [ref(sourceId)] }],
  groups: [{ local_ref: "g1", task_refs: ["t1"], depends_on: [],
    ir_changes: [{ action: "preserve", reason: "kept", sources: [ref(sourceId)] }],
    questions: [{ text: "e7 is only text here, not an id", affects: [] }] }],
} as unknown as IRProposal)

const input = (sourceId: string): CompilerModelV2Input => ({
  run_id: "r",
  events: [event(sourceId, "the user text", 7).event],
  source_segments: [{ source_id: sourceId, segment_id: "s1", span: { unit: "utf16", start: 0, end: 5 }, text: "the user text" }],
  event_source_refs: [ref(sourceId)],
  ir: { t1: task(sourceId) },
  budget: { requests_used: 0, max_requests: 1 },
  contract: { schema_version: 2, candidate_shape: "", reference_contract: "", compilation_contract: "",
    ir_change_contract: "", atom_contract: "", atom_input_contract: "", atom_output_contract: "",
    judgment_contract: "", coverage_contract: "", checks_contract: "", example_input: "", example_candidate: "", rules: [] },
  carried_delegations: [{ event_id: sourceId, sequence: 7, failed_batches: 0, stalled: false }],
  gap_event_ids: [sourceId],
  generation_repair: { issues: [], ir_proposal: proposal(sourceId) },
} as unknown as CompilerModelV2Input)

const index = (entries: Array<{ alias: string; event_id: string }>) => ({
  lookup: (id: string) => {
    const found = entries.find(entry => entry.event_id === id)
    return found === undefined ? undefined : { ...found, digest: "sha256:x" }
  },
})

test("every known source field of an IR request is expressed under its alias", () => {
  const request = input("long-event-id")
  const { request: wire, aliases } = expressIRRequest(request, index([{ alias: "e7", event_id: "long-event-id" }]))
  assert.deepEqual(aliases, [{ alias: "e7", event_id: "long-event-id", digest: "sha256:x" }])
  const task = wire.ir.t1!
  assert.deepEqual(task.goal.sources.map(source => source.source_id), ["e7"])
  assert.deepEqual(task.current_scope.sources.map(source => source.source_id), ["e7"])
  assert.deepEqual(task.bindings[0]!.sources.map(source => source.source_id), ["e7"])
  assert.equal((task.bindings[0]!.ref as SourceRef).source_id, "e7", "a binding's material ref can be a source")
  assert.deepEqual(task.outputs[0]!.sources.map(source => source.source_id), ["e7"])
  assert.deepEqual(task.content[0]!.sources.map(source => source.source_id), ["e7"])
  assert.deepEqual(wire.events.map(item => item.event_id), ["e7"])
  assert.deepEqual(wire.source_segments?.map(segment => segment.source_id), ["e7"])
  assert.deepEqual(wire.event_source_refs?.map(item => item.source_id), ["e7"])
  assert.deepEqual(wire.carried_delegations?.map(item => item.event_id), ["e7"])
  assert.deepEqual(wire.gap_event_ids, ["e7"])
  assert.deepEqual(wire.generation_repair!.ir_proposal!.basis.event_ids, ["e7"])
  assert.deepEqual(wire.generation_repair!.ir_proposal!.groups[0]!.ir_changes[0]!.sources.map(source => source.source_id), ["e7"])
  assert.deepEqual(wire.generation_repair!.ir_proposal!.source_coverage![0]!.source!.source_id, "e7")
  // Text that happens to look like an alias is never rewritten.
  assert.equal(wire.generation_repair!.ir_proposal!.groups[0]!.questions[0]!.text, "e7 is only text here, not an id")
  // The stored input keeps the full identity it had.
  assert.equal(request.ir.t1!.goal.sources[0]!.source_id, "long-event-id")
  assert.equal(request.events[0]!.event_id, "long-event-id")
})

test("the same journal event keeps its alias when the offered set changes", () => {
  const entries = [{ alias: "e7", event_id: "long-event-id" }]
  const first = expressIRRequest(input("long-event-id"), index(entries)).aliases
  const secondInput = input("long-event-id")
  secondInput.source_segments = []
  secondInput.event_source_refs = []
  secondInput.carried_delegations = []
  secondInput.gap_event_ids = []
  const second = expressIRRequest(secondInput, index(entries))
  assert.deepEqual(first.map(entry => entry.alias), ["e7"])
  assert.deepEqual(second.aliases.map(entry => entry.alias), ["e7"],
    "the IR body still displays the event, and it keeps the alias its journal position gave it")
  // An id the journal does not record is never guessed at: it stays as written
  // and the existing source validation owns the defect.
  const foreign = expressIRRequest(input("unknown-event"), index(entries))
  assert.deepEqual(foreign.aliases, [])
  assert.equal(foreign.request.events[0]!.event_id, "unknown-event")
})

test("decode restores the full identity and refuses an alias the request did not offer", () => {
  const restored = decodeIRProposal(proposal("e7"), [{ alias: "e7", event_id: "long-event-id", digest: "sha256:x" }])
  assert.equal(restored.ok, true)
  assert.deepEqual(restored.ok && restored.proposal.basis.event_ids, ["long-event-id"])
  assert.deepEqual(restored.ok && restored.proposal.groups[0]!.ir_changes[0]!.sources.map(source => source.source_id), ["long-event-id"])
  const refused = decodeIRProposal(proposal("e9"), [{ alias: "e7", event_id: "long-event-id", digest: "sha256:x" }])
  assert.equal(refused.ok, false)
  assert.match((refused as { message: string }).message, /basis\.event_ids\[0\] names e9: alias_not_offered/)
  assert.match((refused as { message: string }).message, /This request offered e7;/)
  // A full id is not an alias: decode leaves it to the existing validation.
  const full = decodeIRProposal(proposal("long-event-id"), [{ alias: "e7", event_id: "long-event-id", digest: "sha256:x" }])
  assert.equal(full.ok, true)
})

test("an alias index is only built from a journal that fully parses without conflicts", () => {
  const good = buildSourceAliasIndex({ records: [event("a", "first", 1), event("b", "second", 2)], malformed: 0 })
  assert.equal(good.ok, true)
  assert.deepEqual(good.ok && good.index.lookup("b"), { alias: "e2", event_id: "b", digest: digestText("second") })
  const malformed = buildSourceAliasIndex({ records: [event("a", "first", 1)], malformed: 1 })
  assert.equal(malformed.ok, false)
  const duplicateSequence = buildSourceAliasIndex({ records: [event("a", "first", 1), event("b", "second", 1)], malformed: 0 })
  assert.match((duplicateSequence as { message: string }).message, /two records claim e1/)
  const duplicateEvent = buildSourceAliasIndex({ records: [event("a", "first", 1), event("a", "first", 2)], malformed: 0 })
  assert.match((duplicateEvent as { message: string }).message, /event a appears twice/)
  const wrongDigest = buildSourceAliasIndex({ records: [{ ...event("a", "first", 1), digest: "sha256:0000" }], malformed: 0 })
  assert.match((wrongDigest as { message: string }).message, /recorded digest of event a does not match/)
})
