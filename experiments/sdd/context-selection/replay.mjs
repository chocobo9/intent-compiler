/**
 * Offline replay of SDD request construction on recorded history.  No model,
 * SDD or verifier is called.
 *
 * Source: the original IC's recorded R15 store (a 15-input dpipe run).  The
 * user inputs and the accepted IR answers of every round are real; they are fed
 * through the current SddCompiler (prepareIntentIR included), and each round's
 * IR must come out equal to the IR the original run prepared.  What SDD did not
 * produce in that run is synthesized and labelled: the CI draft (every
 * proceed-scope requirement assigned, one fixed instruction), the check verdict
 * (consistent), the SDD result (one artifact, a new source digest per round) and
 * the item-level assessment (each delivered item takes the original return
 * batch's verdict on the Atom that carried it).  The recorded R1-R5 answers
 * predate the gate that requires every passage of the turn's input to be
 * placed; for the passages such an answer left without a destination the
 * replay adds a labelled `context` disposition, which does not change the IR.
 *
 * For every model call it records the request the new code sent and the
 * request the adapted version (frozen R1 source) would have built from the same
 * store, and rebuilds the new request twice from a copy of the store taken at
 * the call to check that it is reproducible.
 *
 *   npm run build && node experiments/sdd/context-selection/replay.mjs [--evo D:/huawei/EvoCodeBench] [--out dir] [--dump]
 */
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const project = resolve(here, "../../..")
const args = process.argv.slice(2)
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const evo = option("--evo") ?? process.env.EVOCODEBENCH_ROOT ?? "D:/huawei/EvoCodeBench"
const out = resolve(option("--out") ?? here)
const storeDir = join(evo, "harbor_checkpoints/intent-luna-dpipe-online-r11r15-20261005-174552z-536c06a9/round-15/compiler-store/v2-runs/intent-luna-dpipe-full-r1r5-20261002-053740-e6308341")
if (!existsSync(join(storeDir, "snapshot.json"))) { console.log(`context replay: skipped, recorded store not found under ${evo}`); process.exit(0) }

const load = path => import(pathToFileURL(join(project, "dist", path)).href)
const { SddCompiler } = await load("core/sdd-compiler.js")
const { irRequest, deliveryRequest, checkRequest, assessRequest, DELIVERED_TEXT } = await load("core/sdd-context.js")
const { LATER_INPUT_GOVERNS } = await load("core/requirement-flow.js")
const { canonicalJson, digestOf, digestText } = await load("core/intent-contract.js")
const { sourceSegments, userText, SourceLedger, selectedSourceHistory, recordedDispositions } = await load("core/source-payload.js")
const { V2_COMPILER_CONTRACT } = await load("model/compiler-model-v2.js")

const v2 = JSON.parse(readFileSync(join(storeDir, "snapshot.json"), "utf8"))
const journal = readFileSync(join(storeDir, "events.jsonl"), "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line).event)
const users = journal.filter(e => e.kind === "user_input")
const runId = v2.run_id
const log = v2.management_log.filter(r => r.status === "accepted")
const rounds = users.map((event, index) => {
  const record = log.find(r => r.trigger_event_ids.includes(event.event_id))
  const ci = (record?.attempts ?? []).filter(a => a.generation_stage === "ci" && a.request).at(-1)
  if (!ci) throw Error(`round ${index + 1}: no accepted CI attempt recorded`)
  const atom = record.candidate.groups.flatMap(g => g.compilation.drafts ?? []).flatMap(d => d.atoms)[0]
  const ret = log.find(r => r.sequence > record.sequence && r.trigger_event_ids.every(id => id.startsWith("execution")))
  const verdicts = v2.assessments.filter(a => ret && a.sequence === ret.sequence)
  return { index: index + 1, event, proposal: ci.request.generation_repair.ir_proposal, expectedIr: ci.request.ir, atom, verdicts }
})

const scratch = mkdtempSync(join(tmpdir(), "sdd-context-replay-"))
const storeFile = join(scratch, "ci-sdd.json")
const calls = []
let round
const snapshotNow = () => JSON.parse(readFileSync(storeFile, "utf8"))
/** What the adapted version (frozen R1 source) sent for this stage, built from the same store. */
function legacy(stage, s, extra) {
  const b = s.batches.at(-1)
  const event = s.events.find(e => e.event_id === b.event_id)
  if (stage === "ir") return { generation_stage: "ir", run_id: runId, events: [event], source_events: s.events.filter(e => e.event_id !== event.event_id),
    source_segments: sourceSegments(s.events), event_source_refs: [{ source_id: event.event_id, digest: digestText(userText(event) ?? "") }],
    ir: s.ir, budget: { requests_used: b.requests_used, max_requests: b.max_requests }, contract: V2_COMPILER_CONTRACT }
  const delivery = { ir: b.parent.ir, events: s.events, previous_deliveries: s.batches.filter(x => x.state === "accepted" && x.delivery).map(x => x.delivery),
    results: s.runs.flatMap(r => r.result ? [r.result] : []), issues: b.error ? [b.error] : [] }
  if (stage === "ci") return delivery
  if (stage === "check") return { ...delivery, delivery: b.delivery, previous_ir: s.ir }
  return extra
}
/**
 * What must hold for a request built from store `s`, checked on the real data:
 * every segment of every recorded input appears exactly once (with its text or
 * in a run whose item carries it verbatim); every IR item of the batch is
 * present with its version; an item shown by pointer to its delivered block is
 * exactly that block's passages; every source an item cites is listed.
 */
function integrity(stage, request, s) {
  const problems = []
  const b = stage === "assess" ? s.batches.find(x => x.event_id === s.runs.at(-1).event_id) : s.batches.at(-1)
  const stored = stage === "ir" ? s.ir : b.parent.ir
  const items = new Map(Object.values(stored).flatMap(t => t.content.map(c => [`${t.task_id}/${c.item_id}`, c])))
  const previous = request.ir_change?.previous_versions ?? {}
  const holder = p => (p.in === "ir" ? stored : previous)[p.task_id]?.content.find(c => c.item_id === p.item_id && c.revision === p.revision)
  if (stage !== "assess") {
    const listed = stage === "ir"
      ? new Map(s.events.map(e => [e.event_id, [...request.source_segments.filter(x => x.source_id === e.event_id), ...(request.adopted_segments.find(x => x.source_id === e.event_id)?.runs ?? [])]]))
      : new Map(request.sources.inputs.map(x => [x.event_id, x.segments]))
    for (const event of s.events) {
      const shown = listed.get(event.event_id) ?? []
      const ids = shown.flatMap(x => "text" in x ? [x.segment_id] : Array.from({ length: Number(x.to.slice(1)) - Number(x.from.slice(1)) + 1 }, (_, i) => `s${Number(x.from.slice(1)) + i}`))
      const expected = sourceSegments([event])
      // The IR request lists text segments and adopted runs in two fields; compare as a set of numbered segments.
      const sorted = [...ids].sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)))
      if (canonicalJson(sorted) !== canonicalJson(expected.map(x => x.segment_id))) problems.push(`${stage}: segments of ${event.event_id} not shown exactly once`)
      for (const run of shown.filter(x => "text_in" in x)) for (const id of ids.filter(id => Number(id.slice(1)) >= Number(run.from.slice(1)) && Number(id.slice(1)) <= Number(run.to.slice(1)))) {
        const segment = expected.find(x => x.segment_id === id)
        if (!holder(run.text_in)?.text.includes(segment.text.trim())) problems.push(`${stage}: ${id} is not carried by ${run.text_in.item_id}`)
      }
    }
    for (const item of items.values()) for (const source of item.sources) if (!listed.has(source.source_id)) problems.push(`${stage}: ${item.item_id} cites an unlisted source`)
  }
  for (const [key, item] of items) {
    const [taskId] = key.split("/")
    const shown = request.ir?.[taskId]?.content.find(c => c.item_id === item.item_id)
    if (!shown || shown.revision !== item.revision) { problems.push(`${stage}: ${key}@${item.revision} missing`); continue }
    if (shown.text === item.text) continue
    const header = `[assigned requirement ${item.item_id}@${item.revision} ${digestOf(item)}]\n`
    if (shown.text !== DELIVERED_TEXT(header)) { problems.push(`${stage}: ${key} text changed`); continue }
    const text = request.delivery.text, start = text.indexOf(header) + header.length
    const end = [text.indexOf("\n\n[assigned requirement ", start), text.indexOf("\n\nInputs:\n", start)].filter(x => x >= 0).sort((x, y) => x - y)[0]
    const body = text.slice(start, end)
    const passages = (body.startsWith(LATER_INPUT_GOVERNS + "\n") ? body.slice(LATER_INPUT_GOVERNS.length + 1) : body).replace(/^\[user input \d+\]\n/u, "").split(/\n\n\[user input \d+\]\n/u).join("\n\n")
    if (passages !== item.text) problems.push(`${stage}: ${key} pointer does not reconstruct its text`)
  }
  return problems
}
function capture(stage, request, rebuild, legacyRequest) {
  const s = snapshotNow()
  const again = [rebuild(structuredClone(s)), rebuild(JSON.parse(JSON.stringify(s)))].map(x => canonicalJson(x.request))
  const sent = canonicalJson(request)
  // The IR request's contract is identical on both sides; it is reported apart.
  const contract = stage === "ir" ? canonicalJson(V2_COMPILER_CONTRACT).length : 0
  calls.push({ round: round.index, stage, chars: sent.length, legacy_chars: canonicalJson(legacyRequest).length, contract_chars: contract,
    reproducible: again.every(x => x === sent), integrity_problems: integrity(stage, request, s), report: rebuild(structuredClone(s)).report, request })
}
const worst = results => results.includes("not_satisfied") ? "not_satisfied" : results.includes("unknown") || results.length === 0 ? "unknown" : "satisfied"
const model = {
  ir: { propose: async request => {
    const s = snapshotNow(), b = s.batches.at(-1), event = s.events.find(e => e.event_id === b.event_id)
    const full = legacy("ir", s)
    capture("ir", request, x => irRequest(x, event, { ...full, budget: request.budget, ...(b.error ? { validation_errors: [b.error] } : {}) }), full)
    return { ok: true, ir_proposal: structuredClone(round.proposal), call: { text: JSON.stringify(round.proposal) } }
  } },
  deliver: async request => {
    const s = snapshotNow(), b = s.batches.at(-1)
    capture("ci", request, x => deliveryRequest(x, x.batches.at(-1)), legacy("ci", s))
    // Synthesized: assign every requirement of a proceed task.
    return { text: JSON.stringify({ decision: "deliver", reason: `user input ${round.index}`, tasks: Object.values(request.ir).map(t => ({
      task_id: t.task_id, instruction: `Implement and validate the current requirements of ${t.task_id}.`, input_ids: t.bindings.map(x => x.binding_id), output_ids: t.outputs.map(x => x.output_id),
      completion: [{ text: "Every assigned requirement behaves as its attached text states.", evidence_required: "Command runs and their outputs" }],
      coverage: t.content.map(c => ({ item_id: c.item_id, disposition: t.current_scope.disposition === "proceed" ? "assigned" : "paused", explanation: "synthesized for the replay" })),
    })) }) }
  },
  check: async request => {
    const s = snapshotNow()
    capture("check", request, x => checkRequest(x, x.batches.at(-1)), legacy("check", s))
    return { text: JSON.stringify({ verdict: "consistent", findings: [], repair_stage: "none" }) }
  },
  assess: async request => {
    const s = snapshotNow(), run = s.runs.at(-1), b = s.batches.find(x => x.event_id === run.event_id)
    capture("assess", request, x => assessRequest(x, x.runs.at(-1)), { delivery: b.delivery, result: run.result, ir: b.parent.ir })
    const carried = new Set((round.atom?.goal_refs ?? []).map(g => g.id))
    const verdict = worst(round.verdicts.map(v => v.result))
    return { text: JSON.stringify({ assessments: request.delivery.draft.tasks.flatMap(t => t.coverage.filter(c => ["assigned", "supported"].includes(c.disposition)).map(c => {
      const result = carried.has(c.item_id) ? verdict : "unknown"
      return { task_id: t.task_id, item_id: c.item_id, result, explanation: "synthesized from the original Atom verdict", artifact_paths: result === "satisfied" ? [request.result.artifacts[0].path] : [] }
    })) }) }
  },
}

const compiler = new SddCompiler(scratch, runId, model)
const mismatches = []
let previousSource = "baseline-empty"
const addedDispositions = []
for (round of rounds) {
  const before = compiler.inspect()
  const texts = new Map(before.events.concat([round.event]).map(e => [e.event_id, userText(e)]))
  const priorLog = before.batches.filter(b => b.state === "accepted").map(b => ({ status: "accepted", candidate: b.parent.candidate }))
  const ledger = new SourceLedger({ texts, selected: selectedSourceHistory([...priorLog, { status: "accepted", candidate: round.proposal }], round.expectedIr),
    dispositions: recordedDispositions([...priorLog, { status: "accepted", candidate: round.proposal }]) })
  const text = userText(round.event)
  for (const passage of ledger.unplaced(round.event.event_id, round.expectedIr)) {
    round.proposal.source_coverage = [...(round.proposal.source_coverage ?? []), { source: { source_id: round.event.event_id, digest: digestText(text), span: { unit: "utf16", start: passage.start, end: passage.end } },
      disposition: "context", requirements: [], reason: "replay: the recorded answer predates the placement gate and gave this passage no destination", basis: [] }]
    addedDispositions.push({ round: round.index, segment_id: passage.segment_id, chars: passage.end - passage.start, text: passage.text.slice(0, 80) })
  }
  await compiler.accept(round.event, 9)
  const batch = await compiler.advance(round.event.event_id)
  if (batch.state !== "accepted") throw Error(`round ${round.index}: ${batch.state} ${batch.error}`)
  if (digestOf(batch.parent.ir) !== digestOf(round.expectedIr)) {
    const fields = []
    for (const [taskId, task] of Object.entries(round.expectedIr)) {
      const got = batch.parent.ir[taskId]
      for (const key of Object.keys(task)) if (key !== "content" && canonicalJson(task[key]) !== canonicalJson(got?.[key])) fields.push(`${taskId}.${key}`)
      for (const item of task.content) {
        const mine = got?.content.find(x => x.item_id === item.item_id)
        for (const key of new Set([...Object.keys(item), ...Object.keys(mine ?? {})])) if (canonicalJson(item[key]) !== canonicalJson(mine?.[key])) fields.push(`${item.item_id}.${key}`)
      }
    }
    mismatches.push({ round: round.index, fields })
  }
  const run = await compiler.claim(round.event.event_id, { path: "/replay/baseline", digest: previousSource }, "replay-config")
  await compiler.prepared(run.run_id, scratch, run.ci_ref)
  await compiler.launchClaim(run.run_id)
  await compiler.started(run.run_id)
  const source = `replay-source-r${round.index}`
  await compiler.receive({ event_id: `return-r${round.index}`, run_id: run.run_id, ci_ref: run.ci_ref, status: "finished", sdd_status: "not_passed", stages: { validation: "synthesized" },
    artifacts: [{ path: `r${round.index}/verdict.md`, digest: digestText(source), text: `synthesized verdict for round ${round.index}` }], source_digest: source, reason: "synthesized result" })
  await compiler.assess(run.run_id, 2)
  previousSource = source
}

mkdirSync(out, { recursive: true })
const rows = calls.map(({ request: _request, ...row }) => row)
const totals = {}
for (const c of rows) {
  const t = totals[c.stage] ??= { calls: 0, chars: 0, legacy_chars: 0 }
  t.calls++; t.chars += c.chars; t.legacy_chars += c.legacy_chars
}
writeFileSync(join(out, "replay-report.json"), JSON.stringify({
  source_store: storeDir, rounds: rounds.length, ir_mismatch_rounds: mismatches, replay_added_dispositions: addedDispositions,
  synthesized: ["CI draft", "check verdict", "SDD result", "item-level assessment"], totals, calls: rows,
}, null, 2) + "\n")
// --dump writes the last round's requests, for reading what the model would actually see.
if (args.includes("--dump")) for (const c of calls.filter(c => c.round === rounds.length)) writeFileSync(join(out, `r${c.round}-${c.stage}-request.json`), JSON.stringify(c.request, null, 2) + "\n")
console.log(`rounds ${rounds.length}; IR differs from the recorded run in rounds: ${mismatches.map(m => `${m.round}[${m.fields.slice(0, 6).join(" ")}${m.fields.length > 6 ? " ..." : ""}]`).join(", ") || "none"}; replay-added context dispositions: ${addedDispositions.length}`)
for (const c of rows) console.log(`R${String(c.round).padStart(2)} ${c.stage.padEnd(6)} legacy ${String(c.legacy_chars).padStart(8)}  new ${String(c.chars).padStart(7)}  ${(c.chars / c.legacy_chars * 100).toFixed(1).padStart(5)}%  reproducible=${c.reproducible}  integrity_problems=${c.integrity_problems.length}  warnings=${c.report.warnings.length}`)
for (const [stage, t] of Object.entries(totals)) console.log(`${stage}: ${t.calls} calls, legacy ${t.legacy_chars}, new ${t.chars} (${(t.chars / t.legacy_chars * 100).toFixed(1)}%)`)
