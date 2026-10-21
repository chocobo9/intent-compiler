import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { goBuilder } from "../../src/exp2/build.js"
import { activeChecks, codeFacts } from "../../src/exp2/checks.js"
import { applyMutation, mutationSites, mutationTest, renderMutationReport, sample } from "../../src/exp2/mutation.js"
import { LocalProcessRunner, LocalScriptSandbox, nullBaseline } from "../../src/exp2/runner.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { checkStubTransport } from "./check-stubs.js"
import { FILTER, GO_MOD, MAIN, TRANSFORM, VERIFY } from "./go-fixtures.js"
import { roundText } from "./inputs.js"
import { stubTransport } from "./stubs.js"

describe("exp2 mutation testing of produced Go code (local tool, not in the round flow)", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-mut-"))
  const tree = join(dir, "tree")
  const store = new Exp2Store(join(dir, "store"), "mut")
  const runner = new LocalProcessRunner()
  before(async () => {
    assert.equal((await store.ingestRound(1, roundText(1), stubTransport())).status, "accepted")
    assert.equal((await store.deriveRoundChecks(1, checkStubTransport(), { sandbox: new LocalScriptSandbox(), runner, baseline: nullBaseline(join(dir, "null")) })).status, "accepted")
    mkdirSync(tree, { recursive: true })
    for (const [f, text] of Object.entries({ "go.mod": GO_MOD, "main.go": MAIN, "verify.go": VERIFY(), "transform.go": TRANSFORM(["filter"]), "filter.go": FILTER(false) })) writeFileSync(join(tree, f), text, "utf8")
  })

  it("lists comparison, constant and branch sites with their exact source text", () => {
    const sites = mutationSites(tree)
    assert.ok(["compare", "constant", "branch"].every(k => sites.some(s => s.kind === k)))
    const gt = sites.find(s => s.kind === "compare" && s.file === "filter.go" && s.from === ">")!
    assert.equal(gt.to, "<=")
    assert.equal(sample(sites, 5).length, 5)
    const copy = applyMutation(tree, gt)
    assert.match(readFileSync(join(copy, "filter.go"), "utf8"), /keep = v <= th/u)
  })

  it("a mutant is killed when a check passing on the original fails on it", async () => {
    const state = store.inspect()
    const registry = store.registry()
    const checks = activeChecks(state.checks, state.check_events)
    const sites = mutationSites(tree).filter(s => s.file === "filter.go" && s.kind === "compare")
    const report = await mutationTest(tree, checks, { build: goBuilder(join(dir, "builds")), runner, registry, facts: codeFacts(registry, 1), round: 1 }, 50)
    assert.ok(report.baseline_passing.length > 0)
    const gt = report.mutants.find(m => m.site.id === sites.find(s => s.from === ">")!.id)
    assert.equal(gt?.status, "killed", "the filter check catches gt turned into lte")
    assert.ok(report.mutants.some(m => m.status === "survived"), "the library does not catch everything (e.g. the lt case it never checks)")
    assert.equal(report.counts.killed + report.counts.survived + report.counts.build_failed, report.mutants.length)
    assert.match(renderMutationReport(report), /Score: \d\.\d\d/u)
  })
})
