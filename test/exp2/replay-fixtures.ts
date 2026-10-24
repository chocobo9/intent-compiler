import { mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import assert from "node:assert/strict"
import { acceptRound, type AcceptDeps } from "../../src/exp2/accept.js"
import { GoAnchorExtractor } from "../../src/exp2/anchors.js"
import type { ModelReply, TokenUsage } from "../../src/exp2/attribution.js"
import { goBuilder } from "../../src/exp2/build.js"
import { codeFacts, type CheckRecord, type CheckRequest } from "../../src/exp2/checks.js"
import { DEFAULT_LIMITS, type ReviewItemRecord } from "../../src/exp2/execution.js"
import type { FormalizeTransport } from "../../src/exp2/formalize.js"
import { initRepo } from "../../src/exp2/git.js"
import { sessionMaterials } from "../../src/exp2/materials.js"
import { reviewEntries, type ProgramRun } from "../../src/exp2/review.js"
import { LocalProcessRunner, LocalScriptSandbox, nullBaseline } from "../../src/exp2/runner.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { buildWorkOrder, renderWorkOrder } from "../../src/exp2/workorder.js"
import { DROP, FILTER, GO_MOD, MAIN, RENAME, SORT, TRANSFORM, VERIFY } from "./go-fixtures.js"
import { StubExecutor, write } from "./stub-executor.js"

/** The seven real R1 runs replayed (exp2/evidence/replay-2026-10-23): shared by batch-c and the replay baseline. */

export const FIX = resolve(process.cwd(), "exp2/evidence/replay-2026-10-23")
export interface Run {
  run: string; round1_text: string; attribution_replies: string[]; check_replies: string[]; checks: CheckRecord[]; first_cycle_runs: { check: string; outcome: string }[]
  review_calls: { id: string; review: number; session: string; response_text: string; program_runs: number }[]
  formalize_calls: { id: string; review: string; attempt: number; response_text: string }[]
}
export const load = (r: string): Run => JSON.parse(readFileSync(join(FIX, `${r}.json`), "utf8")) as Run
export const usage: TokenUsage = { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 }
export const reply = (text: string): ModelReply => ({ text, usage, stub: true, model: "replay" })
export const session = (id: string) => sessionMaterials(JSON.parse(readFileSync(join(FIX, "sessions", `review-session-${id}.json`), "utf8")))

/** A store holding the run's R1 with the run's own attribution, so object ids and units are the run's. */
export async function storeOf(run: Run): Promise<Exp2Store> {
  const store = new Exp2Store(join(mkdtempSync(join(tmpdir(), "exp2-c-")), "store"), "c")
  let n = 0
  const a = await store.ingestRound(1, run.round1_text, async () => reply(run.attribution_replies[Math.min(n++, run.attribution_replies.length - 1)]))
  assert.equal(a.status, "accepted")
  return store
}

/** The run's check writing replayed: its replies in order, the requests kept. */
export async function replayChecks(run: Run) {
  const store = await storeOf(run)
  const requests: CheckRequest[] = []
  let n = 0
  const record = await store.deriveRoundChecks(1, async request => { requests.push(request); return reply(run.check_replies[Math.min(n++, run.check_replies.length - 1)]) }, {
    sandbox: new LocalScriptSandbox(), runner: new LocalProcessRunner(), baseline: nullBaseline(mkdtempSync(join(tmpdir(), "exp2-c-null-"))), maxRepairs: 2, timeoutMs: 10_000, binary: "dpipe", admitInLoop: true,
  })
  return { store, record, requests }
}

export const ALL = ["filter", "sort", "rename", "drop"]
export const standIn = () => ({ "go.mod": GO_MOD, "main.go": MAIN, "verify.go": VERIFY(), "transform.go": TRANSFORM(ALL, true), "filter.go": FILTER(false), "sort.go": SORT, "rename.go": RENAME, "drop.go": DROP })
/** A program that answers every call as rep1e's answered the operations it lacked: an error, exit 1. */
export const failing = () => ({ "go.mod": GO_MOD, "main.go": "package main\n\nimport (\n\t\"fmt\"\n\t\"os\"\n)\n\nfunc main() {\n\tfmt.Fprintln(os.Stderr, \"ERROR: invalid recipe: unknown operation\")\n\tos.Exit(1)\n}\n" })

export function replayedFormalizer(texts: string[]): FormalizeTransport {
  let n = 0
  return async () => reply(texts[Math.min(n++, texts.length - 1)])
}
/** For a run with no formalizer reply (rep1c): every entry of the review, no input, as the real formalizer answered rep1b. */
export const noInputFormalizer: FormalizeTransport = async request => reply(JSON.stringify({ items: reviewEntries(request.review).map((text, k) => ({ item: k + 1, text, units: ["R1.S3.P2"], input: null, why_no_input: "the file contents are not given", assertions: [], reference_script: null })) }))

export function scripted(script: { text: string; runs?: ProgramRun[]; materials?: ReturnType<typeof sessionMaterials> }[]): AcceptDeps["reviewer"] {
  let n = 0
  return { async review() { const s = script[Math.min(n++, script.length - 1)]; return { text: s.text, usage, model: "replay:reviewer", session: `s${n}`, runs: s.runs ?? [{ command: "./dpipe transform", exit_code: 0 }], ...(s.materials ? { materials: s.materials } : {}) } } }
}

export async function round(store: Exp2Store, program: () => Record<string, string>, o: { reviewer: AcceptDeps["reviewer"]; formalize: FormalizeTransport; library?: CheckRecord[]; reviews?: number; repairs?: number }) {
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

export const items = (rs: readonly ReviewItemRecord[]) => rs.filter(x => x.item > 0)

