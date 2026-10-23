import { mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { acceptRound, type AcceptDeps } from "../../src/exp2/accept.js"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import type { ModelReply, TokenUsage } from "../../src/exp2/attribution.js"
import { goBuilder } from "../../src/exp2/build.js"
import { codeFacts, type CheckRecord, type CheckRequest } from "../../src/exp2/checks.js"
import { DEFAULT_LIMITS, type ReviewItemRecord } from "../../src/exp2/execution.js"
import { completeInput, formalizeProblems, type FormalizeTransport } from "../../src/exp2/formalize.js"
import { initRepo } from "../../src/exp2/git.js"
import { ledgerOf } from "../../src/exp2/ledger.js"
import { inputFromMaterials, programArgs, sessionMaterials, type ReviewMaterials } from "../../src/exp2/materials.js"
import { buildReport, renderReport } from "../../src/exp2/report.js"
import { reviewEntries, type ProgramRun } from "../../src/exp2/review.js"
import { LocalProcessRunner, LocalScriptSandbox, nullBaseline } from "../../src/exp2/runner.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { refusedCall, runChecks, UNKNOWN_COMMAND } from "../../src/exp2/verdict.js"
import { buildWorkOrder, renderWorkOrder } from "../../src/exp2/workorder.js"
import { DROP, FILTER, GO_MOD, MAIN, RENAME, SORT, TRANSFORM, VERIFY } from "./go-fixtures.js"
import { StubExecutor, write } from "./stub-executor.js"

/**
 * Batch C, stage 2 (DIAGNOSIS-R1-REP1D-REP1E-2026-10-23): every test replays what the real models wrote in the five
 * real R1 runs (exp2/evidence/replay-2026-10-23), so the interfaces are judged on real output. Stand-ins are used
 * only for the program under test (a Go stand-in built here) and, where a run has no formalizer reply, for that.
 */

const FIX = resolve(process.cwd(), "exp2/evidence/replay-2026-10-23")
interface Run {
  run: string; round1_text: string; attribution_replies: string[]; check_replies: string[]; checks: CheckRecord[]; first_cycle_runs: { check: string; outcome: string }[]
  review_calls: { id: string; review: number; session: string; response_text: string; program_runs: number }[]
  formalize_calls: { id: string; review: string; attempt: number; response_text: string }[]
}
const load = (r: string): Run => JSON.parse(readFileSync(join(FIX, `${r}.json`), "utf8")) as Run
const usage: TokenUsage = { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 }
const reply = (text: string): ModelReply => ({ text, usage, stub: true, model: "replay" })
const session = (id: string) => sessionMaterials(JSON.parse(readFileSync(join(FIX, "sessions", `review-session-${id}.json`), "utf8")))

/** A store holding the run's R1 with the run's own attribution, so object ids and units are the run's. */
async function storeOf(run: Run): Promise<Exp2Store> {
  const store = new Exp2Store(join(mkdtempSync(join(tmpdir(), "exp2-c-")), "store"), "c")
  let n = 0
  const a = await store.ingestRound(1, run.round1_text, async () => reply(run.attribution_replies[Math.min(n++, run.attribution_replies.length - 1)]))
  assert.equal(a.status, "accepted")
  return store
}

/** The run's check writing replayed: its replies in order, the requests kept. */
async function replayChecks(run: Run) {
  const store = await storeOf(run)
  const requests: CheckRequest[] = []
  let n = 0
  const record = await store.deriveRoundChecks(1, async request => { requests.push(request); return reply(run.check_replies[Math.min(n++, run.check_replies.length - 1)]) }, {
    sandbox: new LocalScriptSandbox(), runner: new LocalProcessRunner(), baseline: nullBaseline(mkdtempSync(join(tmpdir(), "exp2-c-null-"))), maxRepairs: 2, timeoutMs: 10_000, staleByReference: false, binary: "dpipe", admitInLoop: true,
  })
  return { store, record, requests }
}

const ALL = ["filter", "sort", "rename", "drop"]
const standIn = () => ({ "go.mod": GO_MOD, "main.go": MAIN, "verify.go": VERIFY(), "transform.go": TRANSFORM(ALL, true), "filter.go": FILTER(false), "sort.go": SORT, "rename.go": RENAME, "drop.go": DROP })
/** A program that answers every call as rep1e's answered the operations it lacked: an error, exit 1. */
const failing = () => ({ "go.mod": GO_MOD, "main.go": "package main\n\nimport (\n\t\"fmt\"\n\t\"os\"\n)\n\nfunc main() {\n\tfmt.Fprintln(os.Stderr, \"ERROR: invalid recipe: unknown operation\")\n\tos.Exit(1)\n}\n" })

function replayedFormalizer(texts: string[]): FormalizeTransport {
  let n = 0
  return async () => reply(texts[Math.min(n++, texts.length - 1)])
}
/** For a run with no formalizer reply (rep1c): every entry of the review, no input, as the real formalizer answered rep1b. */
const noInputFormalizer: FormalizeTransport = async request => reply(JSON.stringify({ items: reviewEntries(request.review).map((text, k) => ({ item: k + 1, text, units: ["R1.S3.P2"], input: null, why_no_input: "the file contents are not given", claims: [], assertions: [], reference_script: null })) }))

function scripted(script: { text: string; runs?: ProgramRun[]; materials?: ReturnType<typeof sessionMaterials> }[]): AcceptDeps["reviewer"] {
  let n = 0
  return { async review() { const s = script[Math.min(n++, script.length - 1)]; return { text: s.text, usage, model: "replay:reviewer", session: `s${n}`, runs: s.runs ?? [{ command: "./dpipe transform", exit_code: 0 }], ...(s.materials ? { materials: s.materials } : {}) } } }
}

async function round(store: Exp2Store, program: () => Record<string, string>, o: { reviewer: AcceptDeps["reviewer"]; formalize: FormalizeTransport; library?: CheckRecord[]; reviews?: number; repairs?: number }) {
  const dir = mkdtempSync(join(tmpdir(), "exp2-c-round-"))
  const workdir = join(dir, "work")
  mkdirSync(workdir, { recursive: true })
  initRepo(workdir)
  const registry = store.registry(), anchors = new GoAnchorExtractor()
  const w = buildWorkOrder({ registry, round: 1, library: o.library ?? [], events: [], statuses: [], runs: [], anchors: anchors.extract(workdir), links: [], steps: [], previous_task: [] })
  const executor = new StubExecutor({ messages: [wd => write(wd, program())] })
  const record = await acceptRound(workdir, w, renderWorkOrder(w), executor, {
    registry, library: o.library ?? [], events: [], facts: codeFacts(registry, 1), guards: [], guardEvents: [], runner: new LocalProcessRunner(), sandbox: new LocalScriptSandbox(), anchors, build: goBuilder(join(dir, "builds"), {}, "dpipe"),
    reviewer: o.reviewer, formalize: o.formalize, binary: "dpipe", sources: store.inspect().sources.map(s => ({ round: s.round, text: s.text })), copyDir: label => join(dir, "copies", label),
    record: { review: async () => {}, formalize: async () => {}, guards: async () => {} }, checkTimeoutMs: 10_000,
  }, { ...DEFAULT_LIMITS, repairCycles: o.repairs ?? 3, ...(o.reviews !== undefined ? { reviews: o.reviews } : {}) })
  return { record, executor, workorder: w, registry }
}

const items = (rs: readonly ReviewItemRecord[]) => rs.filter(x => x.item > 0)

describe("batch C effect 1: a check's output or argument shape code cannot read goes back to the model; nothing is silently void", () => {
  for (const [name, least] of [["rep1e", 20], ["rep1d", 20]] as const) {
    it(`${name}: the real check replies replayed: admitted ≥ ${least}, and no check is unknown without its reasons having gone back`, async () => {
      const run = load(name)
      const { store, record } = await replayChecks(run)
      const checks = store.inspect().checks
      const admitted = checks.filter(k => k.admission === "admitted")
      assert.ok(admitted.length >= least, `${name}: admitted ${admitted.length} of ${checks.length} (the run admitted ${run.checks.filter(k => k.admission === "admitted").length} of ${run.checks.length})`)
      assert.deepEqual(checks.filter(k => k.unknown.length && !k.fed_back).map(k => k.id), [], "unknown and never told")
      assert.equal(record.status, "accepted")
      // What could not be repaired is counted by cause, not lost.
      for (const d of record.dropped ?? []) assert.ok(d.issues.length > 0 && d.issues.every(i => i.code))
    })
  }

  it("rep1e: the Python dict output, the doubled escapes, the unquoted strings and the leading program name are read, and recorded as read", async () => {
    const { store } = await replayChecks(load("rep1e"))
    const notes = store.inspect().checks.flatMap(k => k.normalized ?? [])
    assert.ok(notes.some(n => /Python dict literal/u.test(n)) && notes.some(n => /doubled backslash/u.test(n)) && notes.some(n => /expect_json read as the string/u.test(n)))
    // The run's own 21 checks whose arguments started with dpipe: each, by its key, now starts with its subcommand.
    const prefixed = load("rep1e").checks.filter(k => k.input.args[0] === "dpipe")
    assert.equal(prefixed.length, 21)
    for (const k of prefixed) { const now = store.inspect().checks.find(x => x.key === k.key); if (now) assert.deepEqual(now.input.args, k.input.args.slice(1), k.key) }
    assert.ok(store.inspect().checks.every(k => k.input.args[0] !== "dpipe"))
  })

  it("the admission problems of the first answer are in the second request, with what the script printed", async () => {
    const { requests } = await replayChecks(load("rep1e"))
    const told = requests[1].issues.filter(i => ["reference_output", "reference_value_missing", "methods_disagree", "computed_missing"].includes(i.code))
    assert.ok(told.length > 0, JSON.stringify(requests[1].issues.map(i => i.code)))
    assert.ok(told.every(i => i.check && /reference script/u.test(i.message)))
  })

  it("a script whose output is neither JSON nor a literal: its check is not admitted silently; the reason went back and the check is recorded as told", async () => {
    const run = load("rep1e")
    const first = JSON.parse(run.check_replies[0]) as { upsert: { key: string; reference_script: { code: string } | null }[] }
    for (const k of first.upsert) if (k.reference_script) k.reference_script.code = "print('not a value')"
    const broken = { ...run, check_replies: [JSON.stringify(first), first ? JSON.stringify({ upsert: [], remove: [], retire_add: [], retire_remove: [] }) : "", JSON.stringify({ upsert: [], remove: [], retire_add: [], retire_remove: [] })] }
    const { store, record, requests } = await replayChecks(broken)
    assert.ok(requests[1].issues.some(i => i.code === "reference_output" && /it printed "not a value\\n"/u.test(i.message)), "the model hears what the script printed")
    const checks = store.inspect().checks
    assert.deepEqual(checks.filter(k => k.unknown.length && !k.fed_back).map(k => k.id), [])
    assert.ok(checks.filter(k => k.admission === "unknown").every(k => k.fed_back === true))
    assert.ok((record.dropped ?? []).length + checks.length > 0)
  })
})

describe("batch C effect 2: a call the program refuses as an unknown subcommand neither passes nor becomes a guard", () => {
  it("rep1e's K12 as written (args start with dpipe) on the stand-in: refused, not passing; read as written by its author (args after the name): it runs transform", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-c-refuse-"))
    mkdirSync(join(dir, "src"), { recursive: true })
    write(join(dir, "src"), standIn())
    const program = goBuilder(join(dir, "b"), {}, "dpipe")(join(dir, "src"), "standin").program!
    const store = await storeOf(load("rep1e"))
    const k12 = load("rep1e").checks.find(k => k.id === "K12")!
    assert.deepEqual(k12.input.args.slice(0, 2), ["dpipe", "transform"])
    const runner = new LocalProcessRunner()
    const [raw] = await runChecks([k12], program, runner, 1, store.registry(), codeFacts(store.registry(), 1), 10_000)
    assert.deepEqual([raw.outcome, raw.failure?.reason], ["fail", "refused_call"], JSON.stringify(raw))
    const fixed: CheckRecord = { ...k12, id: "K12n", input: { ...k12.input, args: k12.input.args.slice(1) } }
    const [run] = await runChecks([fixed], program, runner, 1, store.registry(), codeFacts(store.registry(), 1), 10_000)
    assert.notEqual(run.failure?.reason, "refused_call")
    assert.ok(!refusedCall(fixed, { exit_code: run.exit_code, stdout: "", stderr: run.stderr_head, files: {}, timed_out: false }, { exit_code: 1, stdout: "", stderr: `ERROR: unknown command ${UNKNOWN_COMMAND}\n`, files: {}, timed_out: false }))
  })

  it("rep1e replayed: G1 is not born from K12 as written; every check the writer prefixed with dpipe runs its own subcommand once read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp2-c-guard-"))
    const store = await storeOf(load("rep1e"))
    const asWritten = load("rep1e").checks.filter(k => k.admission === "admitted")
    assert.deepEqual(asWritten.map(k => k.id), ["K11", "K12", "K14"])
    const { record } = await round(store, standIn, { reviewer: scripted([{ text: "NO ISSUES" }]), formalize: noInputFormalizer, library: asWritten })
    assert.deepEqual(record.accept!.guards.born, [], "the run's G1 (K12) is not born")
    assert.ok(record.cycles[0].runs.filter(r => r.check === "K12").every(r => r.failure === "not_landed/refused_call"))
    // The same library replayed through the new check writing: the subcommands are the ones the requirements name.
    const replay = await replayChecks(load("rep1e"))
    const prefixed = new Set(load("rep1e").checks.filter(k => k.input.args[0] === "dpipe").map(k => k.key))
    const subcommands = new Set(replay.store.inspect().checks.filter(k => prefixed.has(k.key)).map(k => k.input.args[0]))
    assert.ok([...subcommands].every(c => ["ingest", "transform", "verify", "manifest", "pipeline"].includes(c)), [...subcommands].join(", "))
    const lib = replay.store.inspect().checks.filter(k => k.admission === "admitted" && (k.input.args[0] === "transform" || k.input.args[0] === "verify"))
    const prog = goBuilder(join(dir, "b2"), {}, "dpipe")((() => { const p = join(dir, "s2"); mkdirSync(p, { recursive: true }); write(p, standIn()); return p })(), "standin2").program!
    const runs = await runChecks(lib, prog, new LocalProcessRunner(), 1, replay.store.registry(), codeFacts(replay.store.registry(), 1), 10_000)
    assert.ok(runs.length > 5 && runs.every(r => r.failure?.reason !== "refused_call"), "transform and verify calls reach the stand-in's subcommands")
  })
})

describe("batch C effect 3: an item whose input is in IC's hands becomes a check", () => {
  it("the session's files are taken from the patch and write tools; deleting them at the end changes nothing", () => {
    const s = session("ses_e962941d3ffeMNkp2huLGt1mZ4")
    assert.ok(["base.csv", "derive-recipe.json", "left.csv", "right.csv", "sort-input.csv", "sort-schema.json"].every(p => s.files.some(f => f.path === p)), s.files.map(f => f.path).join(", "))
    assert.equal(s.files.find(f => f.path === "data.sha256")!.content.trim(), "332433b40eb045d6e5b43d74eaef139d5a3b13d5b81765253390a31482050641", "an Update hunk applied")
    const raw = JSON.parse(readFileSync(join(FIX, "sessions", "review-session-ses_e962941d3ffeMNkp2huLGt1mZ4.json"), "utf8")) as { parts?: { tool?: string; input?: { patchText?: string } }[] }[]
    assert.ok(raw.some(m => (m.parts ?? []).some(p => p.tool === "apply_patch" && /\*\*\* Delete File: base\.csv/u.test(p.input?.patchText ?? ""))), "the reviewer did delete base.csv")
    assert.deepEqual(programArgs("& .\\dpipe-review.exe transform --input a.csv; Write-Output x", "dpipe"), ["transform", "--input", "a.csv"])
    assert.deepEqual(programArgs("go run . ingest --input \"x y.csv\"", "dpipe"), ["ingest", "--input", "x y.csv"])
  })

  it("rep1d replayed (its real formalizer replies and the 13 leads it gave): the 6 items that name a lead get its check; none is no_input", async () => {
    const run = load("rep1d")
    const store = await storeOf(run)
    const leads = run.first_cycle_runs.filter(r => r.outcome === "fail" && /^K\d+$/u.test(r.check)).map(r => ({ id: r.check, check: run.checks.find(k => k.id === r.check)! }))
    assert.equal(leads.length, 13)
    const materials: ReviewMaterials = { leads, files: [], commands: [] }
    const f = run.formalize_calls.filter(x => x.review === "R1.1").at(-1)!
    const got = formalizeProblems(store.registry(), 1, JSON.parse(f.response_text), materials, "dpipe").items.map(it => completeInput(it, materials, "dpipe"))
    const byLead = got.filter(it => it.input_from?.startsWith("lead "))
    assert.deepEqual(byLead.map(it => [it.item, it.input_from]), [[1, "lead K8"], [2, "lead K9"], [3, "lead K10"], [4, "lead K11"], [5, "lead K12"], [7, "lead K16"]])
    assert.ok(byLead.every(it => it.from_lead && it.input))
    // The rest: rep1d's reviewer sessions were not exported, so the reviewer's own files are not in the replay; each says what it searched.
    for (const it of got.filter(x => !x.input)) assert.match(it.why_no_input!, /leads given: K5, K8.*session files: 0/u)
  })

  it("rep1d in a round: the lead items are checks, reproduced on the program and sent as verified items", async () => {
    const run = load("rep1d")
    const store = await storeOf(run)
    const r = run.review_calls[0]
    const { record } = await round(store, failing, { reviewer: scripted([{ text: r.response_text }, { text: "NO ISSUES" }]), formalize: replayedFormalizer(run.formalize_calls.filter(x => x.review === "R1.1").map(x => x.response_text)), library: run.checks, reviews: 1 })
    const recs = items(record.review_items!).filter(x => x.review === "R1.1")
    const lead = recs.filter(x => x.input_from?.startsWith("lead "))
    assert.equal(lead.length, 6)
    assert.ok(lead.every(x => x.disposition === "sent" && x.check && x.premise === null), JSON.stringify(lead.map(x => [x.item, x.disposition, x.premise, x.detail])))
    assert.ok(!recs.some(x => x.input_from?.startsWith("lead ") && x.logged?.some(l => l.premise === "no_input")))
  })

  it("rep1e replayed (three real reviews, their sessions, the real formalizer replies): no_input 0; every input taken from the session", async () => {
    const run = load("rep1e")
    const store = await storeOf(run)
    const script = run.review_calls.map(r => ({ text: r.response_text, materials: session(r.session) }))
    const { record } = await round(store, failing, { reviewer: scripted([...script, { text: "NO ISSUES" }]), formalize: replayedFormalizer(run.formalize_calls.map(x => x.response_text)) })
    const recs = items(record.review_items!)
    assert.equal(recs.length, 20)
    const noInput = recs.filter(x => x.premise === "no_input" || x.logged?.some(l => l.premise === "no_input"))
    assert.deepEqual(noInput.map(x => [x.id, x.detail ?? x.logged?.find(l => l.premise === "no_input")?.detail]), [])
    assert.ok(recs.filter(x => x.input_from).length >= 19, JSON.stringify(recs.map(x => [x.id, x.input_from ?? null])))
    // The verify item rests on the output of the session's earlier ingest call, run again on this program.
    const verify = recs.find(x => x.id === "V1.2.6")!
    assert.deepEqual(verify.produced?.map(p => [p.path, p.by[0]]), [["review-out.csv", "ingest"]])
    // The one item the formalizer wrote no assertion for goes out in the reviewer's words, and says so.
    assert.deepEqual(recs.filter(x => x.disposition === "fallback").map(x => [x.id, x.logged?.at(-1)?.premise]), [["V1.3.7", "no_assertion"]])
    // A verified item is reproduced: it fails on the program; after a fix it is a guard (the code path of the fix block).
    assert.ok(recs.filter(x => x.disposition === "sent").every(x => x.check))
  })
})

describe("batch C effect 4: every entry of the reviewer's list ends once; a whole reply counts its items", () => {
  it("rep1e replayed: reported 20, entered 20; the report says so; the ledger lists each item", async () => {
    const run = load("rep1e")
    const store = await storeOf(run)
    const script = run.review_calls.map(r => ({ text: r.response_text, materials: session(r.session) }))
    const { record, workorder, registry } = await round(store, failing, { reviewer: scripted([...script, { text: "NO ISSUES" }]), formalize: replayedFormalizer(run.formalize_calls.map(x => x.response_text)) })
    const a = record.accept!
    assert.deepEqual([a.reviews.reduce((n, x) => n + x.reported, 0), a.reviews.reduce((n, x) => n + x.sent, 0)], [20, 20])
    assert.ok(a.reviews.every(x => x.conservation?.ok), JSON.stringify(a.reviews.map(x => x.conservation)))
    assert.equal(a.conservation_errors, undefined)
    const report = buildReport({ round: 1, registry, workorder, execution: record, executorIsStub: true, understand: [], acceptance: [], interrupted: { attempts: 0, understand: [], acceptance: [], coding: { calls: 0, tokens: usage, stub_calls: 0 } }, statuses: [], checks: { entered: 0, stale: 0, retired: 0, run: 0, passed: 0, failed: 0 }, review: { accept: a, first_delivery: record.first_delivery ?? null, review_calls: [], formalize_calls: [], coverage: null } })
    assert.match(renderReport(report), /Reviewer items: reported 20, entered a repair list 20 \(verified \d+, logged \d+, fallback \d+\), blocked 0; every entry ended once: yes/u)
    const ledger = ledgerOf({ ...store.inspect(), executions: [record] }, store.registry())
    assert.equal(ledger.filter(e => e.source === "review").length, 20)
  })

  it("rep1b's whole-reply fallback (all 8 no input, as the real formalizer answered): 8 entered, each in the ledger, the message is the reply verbatim", async () => {
    const rb = JSON.parse(readFileSync(resolve(process.cwd(), "exp2/evidence/real-replies-2026-10-23/review_calls.jsonl"), "utf8").split("\n")[0]) as { response_text: string }
    const fb = readFileSync(resolve(process.cwd(), "exp2/evidence/real-replies-2026-10-23/formalize_calls.jsonl"), "utf8").trim().split("\n").map(l => (JSON.parse(l) as { response_text: string }).response_text)
    const store = await storeOf(load("rep1b"))
    const { record, executor } = await round(store, failing, { reviewer: scripted([{ text: rb.response_text }, { text: "NO ISSUES" }]), formalize: replayedFormalizer(fb), reviews: 1 })
    const r = record.accept!.reviews[0]
    assert.deepEqual([r.reported, r.sent, r.fallback, r.fallback_whole, r.conservation?.ok], [8, 8, 8, true, true])
    assert.match(executor.log.messages[1].text, /^An independent review/u)
    assert.ok(executor.log.messages[1].text.endsWith(rb.response_text.trim()))
    const ledger = ledgerOf({ ...store.inspect(), executions: [record] }, store.registry())
    assert.deepEqual(ledger.filter(e => e.source === "review").map(e => [e.id, e.reason, e.end?.how]), Array.from({ length: 8 }, (_, k) => [`V1.1.${k + 1}`, "unverified", "unverified"]))
  })

  // The five faults the real runs showed, injected into every real reply of the five runs (rep1 has none: void at the first review).
  const replies = (["rep1b", "rep1c", "rep1d", "rep1e"] as const).flatMap(name => load(name).review_calls.map(r => ({ name, r, f: load(name).formalize_calls.filter(x => x.review === `R1.${r.review}`).map(x => x.response_text) })))
  const hashIds = (t: string) => t.replace(/(R1\.S\d+\.P\d+)\.(s\d+)/gu, "$1#deadbeef:$2").replace(/"(R1\.S\d+\.P\d+)"/gu, "\"$1#deadbeef\"")
  const powershell = (t: string) => t.replace(/`(?:dpipe|go run \.|\.\\dpipe(?:\.exe)?) /gu, "`& .\\dpipe-review.exe ")
  const narrative = (t: string) => t.replace(/`[^`]*`/gu, "the command")
  const pythonPrint = (t: string) => { try { const a = JSON.parse(t) as { items: { reference_script: { code: string } | null }[] }; for (const it of a.items) if (it.reference_script) it.reference_script.code = it.reference_script.code.replace(/print\(json\.dumps\((.*)\)\)\s*$/u, "print($1)"); return JSON.stringify(a) } catch { return t } }
  const programFirst = (t: string) => { try { const a = JSON.parse(t) as { items: { input: { args: string[] } | null }[] }; for (const it of a.items) if (it.input) it.input.args = ["dpipe", ...it.input.args]; return JSON.stringify(a) } catch { return t } }
  const faults: [string, (x: { text: string; f: string[] }) => { text: string; f: string[] }][] = [
    ["unit ids with the content hash", x => ({ text: x.text, f: x.f.map(hashIds) })],
    ["commands run through PowerShell under another name", x => ({ text: powershell(x.text), f: x.f })],
    ["only a narrative, no input", x => ({ text: narrative(x.text), f: x.f.map(t => { try { const a = JSON.parse(t) as { items: { input: unknown }[] }; for (const it of a.items) it.input = null; return JSON.stringify(a) } catch { return t } }) })],
    ["reference scripts printing a Python literal", x => ({ text: x.text, f: x.f.map(pythonPrint) })],
    ["arguments starting with the program's name", x => ({ text: x.text, f: x.f.map(programFirst) })],
  ]
  for (const [fault, inject] of faults) {
    it(`fault injected into the 8 real replies of rep1b, rep1c, rep1d, rep1e: ${fault}; every entry ends once`, async () => {
      for (const { name, r, f } of replies) {
        const x = inject({ text: r.response_text, f })
        const store = await storeOf(load(name))
        const { record } = await round(store, failing, { reviewer: scripted([{ text: x.text, runs: [{ command: "& .\\dpipe-review.exe transform", exit_code: 0 }] }, { text: "NO ISSUES" }]), formalize: x.f.length ? replayedFormalizer(x.f) : noInputFormalizer, reviews: 1, library: name === "rep1d" ? load(name).checks : [] })
        const s = record.accept!.reviews[0]
        assert.ok(s.conservation?.ok, `${name} ${r.id}: ${JSON.stringify(s.conservation)} ${record.accept!.conservation_errors ?? ""}`)
        assert.equal(s.reported, reviewEntries(x.text).length, `${name} ${r.id}: reported is the reviewer's entries`)
        assert.equal(s.conservation!.sent + s.conservation!.logged + s.conservation!.fallback + s.conservation!.blocked, s.reported)
      }
    })
  }
})

describe("batch C: what is left of no_input says what was searched", () => {
  it("an item with a command not in the session and files in no material: no_input, naming them", () => {
    const m: ReviewMaterials = { leads: [], files: [{ path: "a.csv", content: "x\n" }], commands: [{ command: "./dpipe transform --input a.csv --output o.csv", output: "" }] }
    const got = inputFromMaterials("Command: `dpipe transform --input b.csv --output o.csv`", m, "dpipe")
    assert.equal(got.kind, "none")
    assert.match((got as { why: string }).why, /not among the session's commands, and b\.csv, o\.csv are in no material/u)
    const ran = inputFromMaterials("Command: `dpipe transform --input a.csv --output o.csv`", m, "dpipe")
    assert.equal(ran.kind, "session")
  })
})
