import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { CHECKS_SCHEMA, CHECKS_SYSTEM_PROMPT, buildCheckRequest, checkChecks, type CheckDraft, type CheckRecord, type CheckRequest } from "../../src/exp2/checks.js"
import { LocalProcessRunner, LocalScriptSandbox, nullBaseline, type ProgramRef } from "../../src/exp2/runner.js"
import { Exp2Store } from "../../src/exp2/store.js"
import type { CheckRun, ObjectStatus } from "../../src/exp2/verdict.js"
import { requestJson, strictSchemaProblems } from "../../src/model/opencode-transport.js"
import { checkStubTransport } from "./check-stubs.js"
import { roundText } from "./inputs.js"
import { writeProgram } from "./programs.js"
import { stubTransport } from "./stubs.js"

describe("exp2 block 2: the check library over R1–R3, against stand-in programs", () => {
  const dir = mkdtempSync(join(tmpdir(), "exp2-checks-"))
  const store = new Exp2Store(join(dir, "store"), "offline-2")
  const runner = new LocalProcessRunner()
  const sandbox = new LocalScriptSandbox()
  const requests: CheckRequest[] = []
  const programs: Record<string, ProgramRef> = {}
  const statuses = new Map<string, ObjectStatus[]>()
  const runs = new Map<string, CheckRun[]>()

  const named = (name: string) => store.registry().objectByName(name)!.id
  const status = (key: string, name: string) => statuses.get(key)!.find(s => s.object === named(name))!
  const check = (key: string): CheckRecord => store.inspect().checks.find(c => c.key === key)!
  const runOf = (key: string, checkKey: string) => runs.get(key)!.find(r => r.check === check(checkKey).id)!
  // The stand-in adjudicator upholds every reference of the stand-in library at once (DESIGN §12g): a failure of a
  // derived or computed value then counts against the program, as the programs here are wrong where they fail.
  const upholdReferences = async (round: number) => {
    const ds = store.inspect().checks.filter(c => c.round === round && c.assertions.some(a => a.source.kind === "derived" || a.source.kind === "computed"))
      .map(c => ({ check: c.id, run: { check: c.id, round, program: "-", outcome: "fail" as const, assertions: [], exit_code: 0, stderr_head: "", failure: null }, kind: "reference" as const, detail: "stand-in" }))
    if (ds.length) await store.settle(round, ds, async r => ({ stub: true, text: JSON.stringify({ verdict: "check_right", basis: [r.check.blocks[0]], reason: "stand-in" }) }))
  }
  /** The first program of each round is that round's verdict run; the others are probes on other versions. */
  const runOn = async (round: number, program: string, verdict = false) => {
    // Disputed checks are not ruled on in the round any more (§12j.7 item 1): they stay disputed.
    const r = await store.runRoundChecks(round, programs[program], runner, { verdict })
    statuses.set(`${round}:${program}`, r.statuses)
    runs.set(`${round}:${program}`, r.runs)
  }

  before(async () => {
    const t = stubTransport()
    for (const round of [1, 2, 3]) assert.equal((await store.ingestRound(round, roundText(round), t)).status, "accepted")
    programs.null = nullBaseline(join(dir, "baseline"))
    programs.r1 = writeProgram(dir, "r1", "R1 correct", {})
    programs.shell = writeProgram(dir, "shell", "dispatch only", { shell: true })
    programs.badError = writeProgram(dir, "bad-error", "R1 with a wrong error format", { errors: "wrong" })
    programs.badDigest = writeProgram(dir, "bad-digest", "R1 whose verify digests the content without its final newline", { checksum: "trimmed" })
    programs.r2 = writeProgram(dir, "r2", "R2 correct", { normalize: "population", profile: true })
    programs.noProfile = writeProgram(dir, "no-profile", "R2 without profile", { normalize: "population" })
    programs.r3 = writeProgram(dir, "r3", "R3 correct", { normalize: "sample", profile: true })

    const checks = checkStubTransport(undefined, requests)
    assert.equal((await store.deriveRoundChecks(1, checks, { sandbox, runner, baseline: programs.null })).status, "accepted")
    await upholdReferences(1)
    await runOn(1, "r1", true)
    for (const p of ["shell", "badError", "badDigest"]) await runOn(1, p)
    assert.equal((await store.deriveRoundChecks(2, checks, { sandbox, runner, baseline: programs.r1 })).status, "accepted")
    await upholdReferences(2)
    await runOn(2, "r2", true)
    await runOn(2, "noProfile")
    assert.equal((await store.deriveRoundChecks(3, checks, { sandbox, runner, baseline: programs.r2 })).status, "accepted")
    await upholdReferences(3)
    await runOn(3, "r3", true)
    for (const p of ["r2", "shell"]) await runOn(3, p)
    for (const round of [4, 5]) assert.equal((await store.ingestRound(round, roundText(round), t)).status, "accepted")
    programs.r5 = writeProgram(dir, "r5", "R5: no sidecar, BLAKE2b verify", { normalize: "sample", profile: true, sidecar: false, checksum: "blake2b" })
    assert.equal((await store.deriveRoundChecks(5, checks, { sandbox, runner, baseline: programs.r3 })).status, "accepted")
    await upholdReferences(5)
    await runOn(5, "r5", true)
    await runOn(5, "r3")
    for (let round = 6; round <= 10; round++) assert.equal((await store.ingestRound(round, roundText(round), t)).status, "accepted")
    programs.r10 = writeProgram(dir, "r10", "R10 with reconcile", { normalize: "sample", profile: true, reconcile: true, sidecar: false, checksum: "blake2b" })
    programs.r10wrong = writeProgram(dir, "r10-wrong", "R10 with reconcile, wrong error format", { normalize: "sample", profile: true, reconcile: true, errors: "wrong" })
    assert.equal((await store.deriveRoundChecks(10, checks, { sandbox, runner, baseline: programs.r5 })).status, "accepted")
    await upholdReferences(10)
    await runOn(10, "r10", true)
    await runOn(10, "r5")
  })

  it("R1 first answer: an invented option, a value cited to a unit that does not state it and a convention left out of uses are sent back; the patch fixes them", () => {
    const first = store.inspect().check_calls.filter(c => c.round === 1)
    assert.deepEqual(first.map(c => c.kind), ["attribute", "repair"])
    const codes = first[0].issues.filter(i => i.code !== "uncovered").map(i => `${i.code}:${i.check}`).sort()
    assert.deepEqual(codes, ["computed_by_hand:verify-match-2", "name_unknown:filter-gt", "uses_missing:transform-missing-input", "verbatim_mismatch:verify-match"])
    assert.match(first[0].issues.find(i => i.code === "verbatim_mismatch")!.message, /"VERIFIED" does not occur in R1\.S4\.P2\.s1, which reads "Reads <path>, computes SHA-256/u)
    assert.match(first[0].issues.find(i => i.code === "name_unknown")!.message, /option --precision does not appear/u)
    assert.match(first[0].issues.find(i => i.code === "uses_missing")!.message, /`ERROR: file not found: <path>` of O\d+ \(error handling\)/u)
    assert.deepEqual(first[1].issues, [])
    for (const c of first) assert.ok(c.stub && Object.values(c.usage).every(v => v === 0))
  })

  it("a check of the exit code alone is weak; on a dispatch-only shell it passes and still lands nothing", () => {
    const exitOnly = check("transform-runs")
    assert.equal(exitOnly.strength!.strong, false)
    assert.match(exitOnly.strength!.reason, /no assertion about data/u)
    assert.equal(runOf("1:shell", "transform-runs").outcome, "pass")
    const transform = status("1:shell", "transform")
    assert.equal(transform.status, "unknown")
    assert.deepEqual(transform.reasons, ["only_weak"])
    // Checks that read the data fail on the shell, as a wrong value: not landed.
    assert.equal(status("1:shell", "filter").status, "not_landed")
    assert.equal(runOf("1:shell", "filter-gt").failure!.reason, "value_mismatch")
    assert.equal(check("filter-gt").strength!.strong, true, "fails on the null baseline and reads the output")
  })

  it("on the correct R1 program, filter and the error convention land; the badly built verify input is disputed and does not block landed", () => {
    assert.equal(status("1:r1", "filter").status, "landed")
    assert.equal(status("1:r1", "error handling").status, "landed", "the convention lands through the check that uses it")
    assert.equal(status("1:r1", "transform").status, "unknown", "its only own check is weak")
    const bad = runOf("1:r1", "verify-match-2")
    assert.equal(bad.outcome, "fail")
    assert.equal(bad.failure!.class, "disputed")
    assert.equal(bad.failure!.reason, "input_incomplete")
    assert.match(bad.failure!.detail, /the program reports other\.sha256, which the check names but does not give/u)
    const verify = status("1:r1", "verify")
    assert.equal(verify.status, "landed", "the suspect failure is shown but takes no part in the verdict")
    assert.deepEqual(verify.unknown, [check("verify-match-2").id])
    assert.equal(runOf("1:r1", "verify-match").outcome, "pass")
  })

  it("a digest the input needs comes from the reference script; the program's own mismatch on it is a wrong value, not a suspect input", () => {
    const k = check("verify-match")
    assert.deepEqual(k.computed_inputs, ["digest"])
    assert.match(k.input.files.find(f => f.path === "data.csv.sha256")!.content, /^[0-9a-f]{64}\n$/u, "filled by the code before any run")
    const run = runOf("1:badDigest", "verify-match")
    assert.deepEqual([run.outcome, run.failure!.class, run.failure!.reason], ["fail", "not_landed", "value_mismatch"])
    assert.match(run.failure!.detail, /own rule `MISMATCH expected=<expected> actual=<actual>`/u)
    assert.equal(status("1:badDigest", "verify").status, "not_landed")
  })

  it("R2 first answer: a check without an expected exit code is sent back", () => {
    const calls = store.inspect().check_calls.filter(c => c.round === 2)
    assert.deepEqual(calls[0].issues.filter(i => i.code !== "uncovered").map(i => `${i.code}:${i.check}`), ["exit_missing:profile-numeric"])
    assert.deepEqual(calls[1].issues, [])
  })

  it("a wrong error format fails the convention, not the business object", () => {
    const run = runOf("1:badError", "transform-missing-input")
    assert.equal(run.failure!.class, "not_landed")
    assert.deepEqual(run.failure!.roles, ["convention"])
    assert.equal(status("1:badError", "error handling").status, "not_landed")
    assert.notEqual(status("1:badError", "transform").status, "not_landed")
    assert.equal(status("1:badError", "filter").status, "landed")
  })

  it("R2: derived values enter only where both methods agree; a disagreement is kept out as unknown with its reason", () => {
    const profile = check("profile-numeric")
    assert.deepEqual(profile.assertions.map(a => a.id), ["rows", "mean", "sd", "exit"])
    assert.equal(profile.unknown.length, 1)
    assert.equal(profile.unknown[0].assertion.id, "p25")
    assert.match(profile.unknown[0].reason, /methods disagree: A 2\.5, B 3/u)
    assert.equal(profile.admission, "admitted")
    assert.equal(profile.strength!.strong, true, "the R1 program has no profile command")
    assert.equal(status("2:r2", "profile").status, "landed")
    assert.equal(status("2:r2", "normalize").status, "landed")
  })

  it("R2: a command missing from the program's source is not landed for that reason", () => {
    const run = runOf("2:noProfile", "profile-numeric")
    assert.equal(run.failure!.class, "not_landed")
    assert.equal(run.failure!.reason, "missing_name")
    assert.match(run.failure!.detail, /names profile/u)
    assert.equal(status("2:noProfile", "profile").status, "not_landed")
  })

  it("R3: checks resting on revised text go stale by code; a retire proposal is accepted only where the text changed", () => {
    const state = store.inspect()
    const old = check("normalize-zscore"), minmax = check("normalize-minmax")
    const r3 = state.check_events.filter(e => e.round === 3).map(e => [e.check, e.status, e.by].join(" ")).sort()
    assert.deepEqual(r3, [`${old.id} retired model`, `${old.id} stale code`, `${minmax.id} stale code`].sort())
    assert.match(state.check_events.find(e => e.check === old.id)!.reason, /basis R2\.S11\.P5: R2\.S11\.P5\.s3 partly revised in round 3/u)
    // The proposal to retire the profile check is turned down: R3 only added to profile's text.
    const record = state.check_rounds.find(r => r.round === 3)!
    assert.deepEqual(record.rejected_retire.map(r => r.check), [check("profile-numeric").id])
    assert.deepEqual(record.retired, [old.id])
    assert.ok(!runs.get("3:r3")!.some(r => r.check === old.id || r.check === minmax.id), "stale checks are not run")
    // The stale checks were listed to the model, which derived min-max again on its item.
    const req = requests.filter(q => q.round === 3)[0]
    // (No ruling retires the disputed verify check any more, §12j.7 item 1: it is not derived again.)
    assert.deepEqual(req.stale.map(x => x.id).sort(), [old.id, minmax.id].sort())
    assert.equal(runOf("3:r3", "minmax-again").outcome, "pass")
  })

  it("R3: on the correct program normalize lands; with the wrong denominator it is not landed, as a wrong value", () => {
    const state = store.inspect()
    assert.equal(status("3:r3", "normalize").status, "landed")
    const wrong = runOf("3:r2", "zscore-sample")
    assert.equal(wrong.failure!.class, "not_landed")
    assert.equal(wrong.failure!.reason, "value_mismatch")
    assert.match(wrong.failure!.detail, /n1: got "-1\.22474487139158\d*"/u)
    assert.equal(status("3:r2", "normalize").status, "not_landed")
    // R3's paraphrased quote was sent back once.
    const r3calls = state.check_calls.filter(c => c.round === 3)
    assert.deepEqual(r3calls[0].issues.filter(i => i.code !== "uncovered").map(i => i.code), ["verbatim_not_found"])
  })

  it("a check the previous version already satisfied is weak against that baseline", () => {
    // n < 2 gave "0" in R2 already, so in R3 it does not tell the revision apart.
    const single = check("zscore-single")
    assert.equal(single.strength!.baseline, "r2")
    assert.equal(single.strength!.strong, false)
    assert.equal(check("zscore-sample").strength!.strong, true)
  })

  it("every round reruns the whole active library and computes status from those runs alone", () => {
    const state = store.inspect()
    const active = state.checks.filter(c => c.round <= 3 && c.admission === "admitted" && !state.check_events.some(e => e.check === c.id && e.round <= 3)).map(c => c.id).sort()
    assert.deepEqual(runs.get("3:r3")!.map(r => r.check).sort(), active)
    // Landed in R2 on the correct program; on the shell in R3 nothing carries over.
    assert.equal(status("2:r2", "profile").status, "landed")
    assert.equal(status("3:shell", "profile").status, "not_landed")
    assert.deepEqual(store.statuses(3, "r3"), statuses.get("3:r3"))
    assert.deepEqual(state.checks.map(c => c.id), state.checks.map((_, i) => `K${i + 1}`), "check ids are sequential and never reused")
  })

  it("R10: JSON fields are compared parsed; the command's own error rule is business; a missing command is not landed", () => {
    const diff = check("reconcile-diff")
    assert.equal(diff.assertions.length, 5)
    assert.equal(diff.strength!.strong, true)
    assert.equal(check("reconcile-invalid").strength!.strong, true, "the message carries the input file's name")
    assert.equal(status("10:r10", "reconcile").status, "landed")
    assert.ok(runs.get("10:r10")!.every(r => r.outcome === "pass"))
    const missing = runOf("10:r5", "reconcile-diff")
    assert.equal(missing.failure!.reason, "missing_name")
    assert.equal(status("10:r5", "reconcile").status, "not_landed")
    // Earlier rounds' checks run again in R10 (the regression), against the R10 program.
    assert.equal(runOf("10:r10", "filter-gt").outcome, "pass")
  })

  it("R5 (constructed): a withdrawn behaviour is strong when the baseline still shows it, passes when it is gone, fails while it stays", () => {
    const k = check("transform-no-sidecar")
    assert.equal(k.direction, "withdrawn")
    assert.equal(k.strength!.baseline, "r3")
    assert.equal(k.strength!.baseline_ok, true, "the R3 program still writes the sidecar")
    assert.equal(k.strength!.strong, true)
    assert.equal(runOf("5:r5", "transform-no-sidecar").outcome, "pass")
    const stays = runOf("5:r3", "transform-no-sidecar")
    assert.equal(stays.outcome, "fail")
    assert.deepEqual([stays.failure!.class, stays.failure!.reason], ["not_landed", "still_present"])
    assert.equal(status("5:r3", "transform").status, "not_landed")
    assert.equal(status("5:r5", "transform").status, "landed")
  })

  it("R5: a check its round made stale is derived again in that round, and the object's status follows the new check", () => {
    const state = store.inspect()
    const old = check("verify-match")
    const e = state.check_events.find(x => x.check === old.id && x.status === "stale")!
    assert.deepEqual([e.round, e.by, e.cause?.kind], [5, "code", "basis"])
    const request = requests.filter(q => q.round === 5)[0]
    assert.ok(request.stale.some(s => s.id === old.id), "listed for re-derivation in the same round")
    const fresh = check("verify-blake2b")
    assert.equal(fresh.round, 5)
    assert.equal(fresh.strength!.strong, true, "the R3 program still compares SHA-256")
    const verify = status("5:r5", "verify")
    assert.equal(verify.status, "landed")
    assert.deepEqual(verify.passing_strong, [fresh.id])
    assert.ok(!runs.get("5:r5")!.some(r => r.check === old.id), "the stale check is not run")
  })

  it("a repair repeats the first request byte for byte up to the issues and draft", () => {
    const [first, repair] = requests.filter(r => r.round === 1).map(r => requestJson(r))
    const cut = (s: string) => s.slice(0, s.indexOf(`,"issues":`))
    assert.ok(cut(first).length > 15_000)
    assert.equal(cut(repair), cut(first))
    assert.ok(first.startsWith(`{"sources":"===== R1 =====`))
    assert.deepEqual(strictSchemaProblems(CHECKS_SCHEMA), [])
    assert.ok(CHECKS_SYSTEM_PROMPT.length > 0)
  })

  it("the request lists only this round's objects and their existing checks", () => {
    const r3 = buildCheckRequest(store.registry(), 3, [], [])
    const names = r3.scope.map(s => s.name).sort()
    assert.ok(names.includes("normalize") && names.includes("fill") && !names.includes("verify"))
    assert.ok(r3.scope.find(s => s.name === "normalize")!.changed.includes("R3.S3"))
  })
})

describe("exp2 check admission: definite errors only", () => {
  it("names each definite error, and lets the model's own choices through", async () => {
    const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-adm-")), "t")
    await store.ingestRound(1, roundText(1), stubTransport())
    const registry = store.registry()
    const id = (n: string) => registry.objectByName(n)!.id
    const base: CheckDraft = {
      key: "k", object: id("filter"), blocks: ["R1.S3.P2.s4"], uses: [], direction: "holds", note: null, reference_script: null,
      input: { args: ["transform", "--input", "data.csv", "--recipe", "recipe.json", "--output", "out.csv", "--seed", "1"], files: [{ path: "data.csv", content: "id,value\n1,5\n" }, { path: "recipe.json", content: "[{\"op\": \"filter\", \"column\": \"value\", \"condition\": \"gt\", \"threshold\": 1}]" }] },
      assertions: [
        { id: "a", role: "business", target: { kind: "file_line", path: "out.csv", line: 2, pointer: null, column: null }, expect_json: "\"1,5\"", tolerance: null, source: { kind: "derived", block: null, quote: null } },
        { id: "x", role: "business", target: { kind: "exit_code", path: null, line: null, pointer: null, column: null }, expect_json: "0", tolerance: null, source: { kind: "derived", block: null, quote: null } },
      ],
    }
    const codes = (edit: (k: CheckDraft) => void, retire: { check: string; reason: string }[] = []) => {
      const k = structuredClone(base); edit(k)
      return checkChecks(registry, 1, { checks: [k], retire }, [], []).map(i => i.code).sort()
    }
    assert.deepEqual(codes(k => { k.reference_script = { language: "python", code: "print('{}')" } }), [], "a well-formed check")
    assert.deepEqual(codes(() => {}), ["script_missing"], "derived values without method B")
    const ok = (k: CheckDraft) => { k.reference_script = { language: "python", code: "print('{}')" } }
    assert.deepEqual(codes(k => { ok(k); k.assertions.pop() }), ["exit_missing"], "no expected exit code")
    assert.deepEqual(codes(k => { ok(k); k.object = "O999" }), ["unknown_object"])
    assert.deepEqual(codes(k => { ok(k); k.blocks = ["R1.S4"] }), ["basis_not_object"], "basis that is another object's text")
    assert.deepEqual(codes(k => { ok(k); k.input.files[0].path = "../data.csv" }), ["input_invalid"])
    assert.deepEqual(codes(k => { ok(k); k.input.files[1].content = "[{\"op\": \"filter\", \"colum\": \"value\"}]" }), ["name_unknown"], "a JSON key the text never shows")
    assert.deepEqual(codes(k => { ok(k); k.assertions[0].target = { kind: "json", path: "out.json", line: null, pointer: "row_count", column: null } }), ["target_invalid"])
    assert.deepEqual(codes(k => { ok(k); k.assertions[0].expect_json = "{oops" }), ["expect_invalid"])
    assert.deepEqual(codes(ok, [{ check: "K9", reason: "x" }]), ["retire_invalid"])
    // Not judged: which file and line to read, uses that a reader might find needless, a malformed JSON input on purpose.
    assert.deepEqual(codes(k => { ok(k); k.uses = [id("determinism contract")]; k.assertions[0].target.line = 9 }), [])
    assert.deepEqual(codes(k => { ok(k); k.input.files[1].content = "{not json" }), [])
  })
})

describe("exp2 check admission: a file's existence is stated by naming the file", () => {
  it("file_exists true, cited to the unit that names <output>.sha256: admitted; cited to a unit that names no such file: sent back", async () => {
    const store = new Exp2Store(mkdtempSync(join(tmpdir(), "exp2-exists-")), "t")
    await store.ingestRound(1, roundText(1), stubTransport())
    const registry = store.registry()
    const unit = "R1.S3.P24.s1"
    assert.match(registry.block(unit)!.text, /\.sha256/u)
    const draft = (block: string): CheckDraft => ({
      key: "k", object: registry.coverOf(unit)!.owner, blocks: [unit], uses: [], direction: "holds", note: null, reference_script: null,
      input: { args: ["transform", "--input", "data.csv", "--recipe", "recipe.json", "--output", "out.csv", "--seed", "1"], files: [{ path: "data.csv", content: "id,value\n1,5\n" }, { path: "recipe.json", content: "[{\"op\": \"filter\", \"column\": \"value\", \"condition\": \"gt\", \"threshold\": 1}]" }] },
      assertions: [
        { id: "side", role: "business", target: { kind: "file_exists", path: "out.csv.sha256", line: null, pointer: null, column: null }, expect_json: "true", tolerance: null, source: { kind: "verbatim", block, quote: null } },
        { id: "x", role: "business", target: { kind: "exit_code", path: null, line: null, pointer: null, column: null }, expect_json: "0", tolerance: null, source: { kind: "verbatim", block: "R1.S8.P1.s1", quote: null } },
      ],
    })
    const mismatches = (block: string) => checkChecks(registry, 1, { checks: [draft(block)], retire: [] }, [], []).filter(i => i.code === "verbatim_mismatch" && /assertion side/u.test(i.message)).map(i => i.message)
    assert.deepEqual(mismatches(unit), [])
    assert.equal(mismatches("R1.S3.P2.s4").length, 1, "a unit that does not name the file does not state its existence")
  })
})

describe("exp2 runner and sandbox", () => {
  it("a reference script runs in its own directory with only the input files, and is stopped at the time limit", async () => {
    const sandbox = new LocalScriptSandbox()
    const ok = await sandbox.run("python", "import os, json\nprint(json.dumps(sorted(os.listdir('.'))))", [{ path: "a.csv", content: "x\n" }], 5000)
    assert.deepEqual(JSON.parse(ok.stdout), ["__reference__.py", "a.csv"])
    const slow = await sandbox.run("python", "import time\ntime.sleep(5)", [], 300)
    assert.equal(slow.timed_out, true)
    await assert.rejects(sandbox.run("python", "print(1)", [{ path: "../escape.txt", content: "x" }], 1000), /Unsafe input path/u)
  })
})
