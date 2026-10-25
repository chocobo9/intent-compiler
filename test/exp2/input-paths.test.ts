import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { checkChecks, type CheckDraft } from "../../src/exp2/checks.js"
import { LocalProcessRunner, LocalScriptSandbox, nullBaseline, safePath, writeInputs, type ScriptSandbox } from "../../src/exp2/runner.js"
import { Exp2Store } from "../../src/exp2/store.js"
import { checkStubTransport } from "./check-stubs.js"
import { roundText } from "./inputs.js"
import { stubTransport } from "./stubs.js"

/**
 * rep1q R6 (2026-10-26): the check writer named a check's input file with its content ("age\n1\n"); nothing refused
 * the path, the reference script's input could not be written, and the exception left the serial. The path is a
 * format problem the writer is told about, and one check's admission failing fails that check only.
 */
const FIX = JSON.parse(readFileSync(resolve(process.cwd(), "exp2/evidence/replay-2026-10-26/rep1q-r6-bad-path-check.json"), "utf8")) as { check: CheckDraft }

describe("[mech] input paths a runner cannot write, and an admission that throws", () => {
  const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-paths-")), "paths")
  before(async () => { await store.ingestRound(1, roundText(1), stubTransport()) })

  it("safePath refuses a line break, a control character and the characters Windows refuses; ordinary names pass", () => {
    for (const p of ["age\n1\n", "a\tb.csv", "out<1>.csv", "x:y.csv", "q?.csv", "a|b", "a*b", "\"a\".csv"]) assert.equal(safePath(p), false, JSON.stringify(p))
    for (const p of ["in.csv", "dir/in.csv", "review-fixtures/base-profile.json", "data.bin", "a b.csv"]) assert.equal(safePath(p), true, p)
    assert.throws(() => writeInputs(mkdtempSync(join(tmpdir(), "exp2-paths-w-")), FIX.check.input.files), /Unsafe input path/u, "refused before any file is written")
  })

  it("the real answer's check: input_invalid, said so the writer can mend it (a line break in the name)", () => {
    const reg = store.registry(), ingest = reg.objectByName("ingest")!.id
    const block = [...reg.objects.get(ingest)!.blocks][0].block
    const k: CheckDraft = { ...FIX.check, object: ingest, uses: [], blocks: [block] }
    const issues = checkChecks(reg, 1, { checks: [k], retire: [], uncheckable: [] }, [], [])
    const own = issues.filter(i => i.check === k.key && i.code === "input_invalid")
    assert.equal(own.length, 1, JSON.stringify(issues.map(i => [i.code, i.message.slice(0, 120)])))
    assert.match(own[0].message, /input path "age\\n1\\n" must be a relative file name inside the run directory, with no line break/u)
  })

  // The sandbox throws once, as writing "age\n1\n" did; every other run goes through.
  const throwingOnce = () => { const real = new LocalScriptSandbox(); let n = 0; return { sandbox: { run: async (...a: Parameters<ScriptSandbox["run"]>) => { if (n++ === 0) throw new Error("ENOENT: no such file or directory, open 'age\n1\n'"); return real.run(...a) } } as ScriptSandbox, thrown: () => n > 0 } }
  const fresh = async (name: string) => { const st = new Exp2Store(mkdtempSync(join(tmpdir(), `exp2-paths-${name}-`)), name); await st.ingestRound(1, roundText(1), stubTransport()); return st }
  const baseline = () => nullBaseline(mkdtempSync(join(tmpdir(), "exp2-paths-b-")))

  it("admission inside the writing loop (the real run's path) throwing: that check gets admission_failed, the round goes on", async () => {
    const st = await fresh("loop"), t = throwingOnce()
    const r = await st.deriveRoundChecks(1, checkStubTransport(), { sandbox: t.sandbox, runner: new LocalProcessRunner(), baseline: baseline(), admitInLoop: true })
    assert.ok(t.thrown(), "the sandbox was reached")
    assert.notEqual(r.status, "interrupted")
    const calls = st.inspect().check_calls.filter(c => r.calls.includes(c.id))
    assert.ok(calls.some(c => c.issues.some(i => i.code === "admission_failed" && /its admission could not run: ENOENT/u.test(i.message))), JSON.stringify(calls.map(c => c.issues.map(i => i.code))))
  })

  it("admission as a check enters throwing: that check enters unknown with the reason, the others as usual", async () => {
    const st = await fresh("enter"), t = throwingOnce()
    const r = await st.deriveRoundChecks(1, checkStubTransport(), { sandbox: t.sandbox, runner: new LocalProcessRunner(), baseline: baseline() })
    assert.ok(t.thrown())
    assert.equal(r.status, "accepted")
    const entered = st.inspect().checks.filter(c => c.round === 1)
    const failed = entered.filter(c => /its admission could not run: ENOENT/u.test(c.admission_reason ?? ""))
    assert.equal(failed.length, 1, JSON.stringify(entered.map(c => [c.key, c.admission, c.admission_reason?.slice(0, 60)])))
    assert.equal(failed[0].admission, "unknown")
    assert.ok(entered.length > 1 && entered.some(c => c.admission === "admitted"), "the other checks enter as usual")
  })
})
