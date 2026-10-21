import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { goBuilder } from "../../src/exp2/build.js"
import { codeFacts, type CheckRecord } from "../../src/exp2/checks.js"
import { detect, parseProducts, renderDetect } from "../../src/exp2/detect.js"
import { LocalProcessRunner, LocalScriptSandbox, nullBaseline, type RunOutput } from "../../src/exp2/runner.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { classify, compare, crashed } from "../../src/exp2/verdict.js"
import { checkStubTransport } from "./check-stubs.js"
import { FILTER, GO_MOD, MAIN, TRANSFORM, VERIFY } from "./go-fixtures.js"
import { roundText } from "./inputs.js"
import { write } from "./stub-executor.js"
import { stubTransport } from "./stubs.js"

const out = (o: Partial<RunOutput>): RunOutput => ({ exit_code: 0, stdout: "", stderr: "", files: {}, timed_out: false, ...o })

describe("exp2 block 9: failure classes (BLOCK9 §2.3)", () => {
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-b9-")), "b9")
  before(async () => { await store.ingestRound(1, roundText(1), stubTransport()) })
  const check = (assertions: CheckRecord["assertions"], args = ["pipeline", "--config", "config.json"]): CheckRecord => ({
    id: "K1", round: 1, key: "k", object: store.registry().objectByName("pipeline")!.id, blocks: ["R1.S6.P2"], uses: [], direction: "holds",
    input: { args, files: [{ path: "config.json", content: "{}" }] }, assertions, unknown: [], reference_script: null, admission: "admitted", admission_reason: null, strength: null, status: "active", calls: [],
  })
  const t = (kind: string, line: number | null = null) => ({ kind, path: null, line, pointer: null, column: null }) as CheckRecord["assertions"][number]["target"]
  const a = (id: string, target: CheckRecord["assertions"][number]["target"], expect: unknown) => ({ id, role: "business" as const, target, expect, tolerance: null, source: { kind: "verbatim" as const, block: "R1.S6.P2" } })
  // The program names every command and option the check calls (no missing name).
  const judge = (k: CheckRecord, o: RunOutput) => classify(k, compare(k.assertions, o), o, new Set(k.input.args), store.registry(), codeFacts(store.registry(), 1))

  it("a Go panic, or a run ended by a signal, is a crash: not landed", () => {
    const k = check([a("exit", t("exit_code"), 0)])
    const panic = out({ exit_code: 2, stderr: "panic: runtime error: index out of range [3] with length 3\n\ngoroutine 1 [running]:\nmain.opWindow(...)\n" })
    assert.match(crashed(panic)!, /^panic: runtime error/u)
    assert.deepEqual([judge(k, panic).class, judge(k, panic).reason], ["not_landed", "crash"])
    assert.deepEqual([judge(k, out({ exit_code: null })).class, judge(k, out({ exit_code: null })).reason], ["not_landed", "crash"])
    assert.equal(crashed(out({ exit_code: 1, stderr: "ERROR: panic: not really" })), null, "the word alone is not a crash")
  })

  it("the expected text appears in the output, only not where the check reads it: the check is disputed, not the program", () => {
    // As pipeline_ok on every product: the first line is VERIFIED, the expected line comes second.
    const ok = check([a("exit", t("exit_code"), 0), a("line", t("stdout_line", 1), "PIPELINE OK: 1 steps completed")])
    const f1 = judge(ok, out({ stdout: "VERIFIED\nPIPELINE OK: 1 steps completed\n" }))
    assert.deepEqual([f1.class, f1.reason], ["disputed", "position"])
    // As pipeline_fail: the message is on stderr, the check reads stdout.
    const fail = check([a("exit", t("exit_code"), 1), a("msg", t("stdout_line", 1), "ERROR: pipeline step failed")])
    assert.equal(judge(fail, out({ exit_code: 1, stderr: "ERROR: pipeline step failed\n" })).reason, "position")
    // A value that is wrong is still the program's.
    assert.deepEqual([judge(ok, out({ stdout: "PIPELINE OK: 2 steps completed\n" })).class], ["not_landed"])
    // Upheld by a ruling, the same failure counts against the program.
    const upheld = classify(ok, compare(ok.assertions, out({ stdout: "VERIFIED\nPIPELINE OK: 1 steps completed\n" })), out({ stdout: "VERIFIED\nPIPELINE OK: 1 steps completed\n" }), new Set(["pipeline", "--config"]), store.registry(), codeFacts(store.registry(), 1), new Set(["position"]))
    assert.equal(upheld.class, "not_landed")
  })

  it("a refused input the check holds valid is not landed; a missing input the check itself names but does not give is disputed", () => {
    const k = check([a("exit", t("exit_code"), 0)], ["transform", "--input", "data.csv", "--recipe", "recipe.json", "--output", "out.csv"])
    const refused = judge({ ...k, input: { ...k.input, files: [{ path: "data.csv", content: "a\n1\n" }, { path: "recipe.json", content: "[]" }] } }, out({ exit_code: 1, stderr: "ERROR: invalid recipe: missing ) after function\n" }))
    assert.deepEqual([refused.class, refused.reason], ["not_landed", "refused"])
    const incomplete = judge(k, out({ exit_code: 1, stderr: "ERROR: file not found: data.csv\n" }))
    assert.deepEqual([incomplete.class, incomplete.reason], ["disputed", "input_incomplete"])
  })
})

describe("exp2 block 9: the offline acceptance harness (products with known official results)", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-detect-"))
  const store = new Exp2Store(join(dir, "store"), "detect")
  const product = (name: string, files: Record<string, string>) => { const p = join(dir, name); mkdirSync(p, { recursive: true }); write(p, files); return p }
  const base = { "go.mod": GO_MOD, "main.go": MAIN, "verify.go": VERIFY() }
  before(async () => {
    await store.ingestRound(1, roundText(1), stubTransport())
    await store.deriveRoundChecks(1, checkStubTransport(), { sandbox: new LocalScriptSandbox(), runner: new LocalProcessRunner(), baseline: nullBaseline(join(dir, "null")) })
  })

  it("prints a table per product: a panic and a missing operation are not landed, a correct product lands, a check wrong for all shows up", async () => {
    const products = parseProducts([
      `correct\t1\t${product("correct", { ...base, "transform.go": TRANSFORM(["filter"]), "filter.go": FILTER(false) })}\t219\t`,
      `# a comment line`,
      `wrong-value\t1\t${product("wrong", { ...base, "transform.go": TRANSFORM(["filter"]), "filter.go": FILTER(true) })}\t210`,
      `panic\t1\t${product("panic", { ...base, "transform.go": TRANSFORM(["filter"]), "filter.go": FILTER(false).replace("func opFilter(t table, op map[string]any) (table, error) {", "func opFilter(t table, op map[string]any) (table, error) {\n\tvar xs []int\n\t_ = xs[len(t.rows)]") })}\t191`,
      `stopped-early\t1\t${product("early", { ...base, "transform.go": TRANSFORM([]) })}\t91`,
    ].join("\n"))
    const report = await detect(store.inspect(), products, { build: goBuilder(join(dir, "builds"), {}, "dpipe"), runner: new LocalProcessRunner() })
    const by = (n: string) => report.products.find(p => p.product.name === n)!
    assert.ok(by("correct").landed.includes("filter"))
    assert.ok(by("wrong-value").not_landed.includes("filter"))
    assert.ok(by("panic").not_landed.includes("filter") && by("panic").failures["not_landed/crash"]?.length)
    assert.ok(by("stopped-early").not_landed.includes("filter") && by("stopped-early").failures["not_landed/missing_name"]?.length)
    // The badly built verify check fails on every product, and as disputed: it never counts against any of them.
    const verify2 = store.inspect().checks.find(c => c.key === "verify-match-2")!.id
    assert.deepEqual(report.fail_everywhere.find(c => c.check === verify2)?.classes, ["disputed/input_incomplete"])
    const md = renderDetect(report, store.inspect())
    assert.match(md, /\| panic \| 1 \| 191 \| yes \|.*crash: filter-gt/u)
    assert.match(md, /## Checks that fail on every product that ran them\n\n- K\d+ verify-match-2/u)
  })
})
