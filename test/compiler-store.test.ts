import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  CompilerStore,
  DeliveryBlockedError,
  EvidenceConflictError,
  IdentityConflictError,
  InputContentError,
  StorePathError,
} from "../src/core/compiler-store.js"
import type { EvidenceDecisionInput } from "../src/core/compiler-store.js"

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "intent-compiler-store-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function prepareTurn(run: ReturnType<CompilerStore["openRun"]>, identity: string, state: unknown, compiledIntent: unknown = state) {
  run.saveInput({ inputIdentity: identity, raw: `input:${identity}` })
  const proposal = run.saveProposal(identity, { operation: "test", identity })
  const validation = run.recordValidation({ inputIdentity: identity, proposalId: proposal.proposalId, valid: true })
  return { proposal, validation, result: run.commit({ inputIdentity: identity, proposalId: proposal.proposalId, validationId: validation.validationId, state, compiledIntent }) }
}

function finishDelivery(run: ReturnType<CompilerStore["openRun"]>, identity: string): void {
  const current = run.replay().current
  assert.ok(current.compiledIntentRef)
  const attempt = run.recordDeliveryAttempt({ inputIdentity: identity, artifactVersion: current.artifactVersion, expectedDigest: current.compiledIntentRef.digest, expectedRenderedDigest: current.renderedTextRef!.digest, readbackDigest: current.compiledIntentRef.digest, readbackRenderedDigest: current.renderedTextRef!.digest, status: "confirmed" })
  run.reconcileDelivery(attempt.attemptId, { terminal: true })
}

describe("CompilerStore", () => {
  it("rejects overlapping Observer/workspace paths and accepts an independent absolute path", () => {
    const root = temporaryDirectory()
    assert.throws(() => new CompilerStore({ storeDir: "relative-store" }), StorePathError)
    assert.throws(() => new CompilerStore({ storeDir: join(root, "compiler"), observerStoreDir: join(root, "compiler") }), StorePathError)
    assert.throws(() => new CompilerStore({ storeDir: join(root, "workspace", "compiler"), executorWorkspaceDir: join(root, "workspace") }), StorePathError)
    const store = new CompilerStore({ storeDir: join(root, "compiler"), observerStoreDir: join(root, "observer"), executorWorkspaceDir: join(root, "workspace") })
    assert.doesNotThrow(() => store.openRun("path-check"))
  })

  it("uses deterministic event and delivery identities derived from run and sequence", () => {
    const rootA = temporaryDirectory()
    const rootB = temporaryDirectory()
    const options = (storeDir: string) => ({ storeDir, clock: () => "2026-01-01T00:00:00.000Z" })
    const runA = new CompilerStore(options(rootA)).openRun("deterministic")
    const runB = new CompilerStore(options(rootB)).openRun("deterministic")
    prepareTurn(runA, "i1", { value: 1 })
    prepareTurn(runB, "i1", { value: 1 })
    finishDelivery(runA, "i1")
    finishDelivery(runB, "i1")
    assert.deepEqual(runA.history().map((record) => [record.eventId, record.type]), runB.history().map((record) => [record.eventId, record.type]))
    const attemptA = runA.history().find((record) => record.type === "delivery.attempt")
    const attemptB = runB.history().find((record) => record.type === "delivery.attempt")
    assert.equal((attemptA?.data as { attemptId: string }).attemptId, (attemptB?.data as { attemptId: string }).attemptId)
  })

  it("only lets a complete commit become current and reports a staged crash point", () => {
    const root = temporaryDirectory()
    const store = new CompilerStore({ storeDir: root })
    const run = store.openRun("crash")
    run.saveInput({ inputIdentity: "i1", raw: "hello" })
    const proposal = run.saveProposal("i1", { operations: [] })
    const validation = run.recordValidation({ inputIdentity: "i1", proposalId: proposal.proposalId, valid: true })
    const staged = run.stageCommit({ inputIdentity: "i1", proposalId: proposal.proposalId, validationId: validation.validationId, state: { value: 1 }, compiledIntent: { value: 1 } })
    assert.equal(staged.status, "staged")
    assert.equal(run.replay().current.version, 0)
    assert.equal(run.recover().action, "commit_pending")
    assert.ok(run.replay().reports.some((report) => report.kind === "orphan-stage"))
    const reopened = new CompilerStore({ storeDir: root }).openRun("crash")
    assert.equal(reopened.replay().current.version, 0)
    const committed = reopened.finalizeCommit(staged.stageId)
    assert.equal(committed.stateVersion, 1)
    assert.equal(reopened.replay().current.version, 1)
  })

  it("replays the authoritative inline state while ignoring a corrupted snapshot and supports a specified version", () => {
    const root = temporaryDirectory()
    const store = new CompilerStore({ storeDir: root })
    const run = store.openRun("replay")
    prepareTurn(run, "i1", { value: 1 })
    finishDelivery(run, "i1")
    prepareTurn(run, "i2", { value: 2 })
    const complete = [...run.history()].reverse().find((record) => record.type === "commit.complete")
    assert.ok(complete)
    const stateRef = complete.data as unknown as { stateArtifact: { path: string } }
    writeFileSync(join(root, "runs", "replay", stateRef.stateArtifact.path), "corrupted", "utf8")
    const replayed = run.replay()
    assert.equal(replayed.current.version, 2)
    assert.deepEqual(replayed.current.state, { value: 2 })
    assert.ok(replayed.reports.some((report) => report.kind === "snapshot-mismatch"))
    assert.deepEqual(run.replay(1).current.state, { value: 1 })
  })

  it("reuses duplicate input and stops identity/content conflicts", () => {
    const store = new CompilerStore({ storeDir: temporaryDirectory() })
    const run = store.openRun("idempotent")
    const first = run.saveInput({ inputIdentity: "same", raw: "stable" })
    const second = run.saveInput({ inputIdentity: "same", raw: "stable" })
    assert.equal(first.status, "saved")
    assert.equal(second.status, "duplicate")
    assert.throws(() => run.saveInput({ inputIdentity: "same", raw: "changed" }), IdentityConflictError)
    assert.equal(run.replay().current.version, 0)
  })

  it("does not increment state or artifact versions for a semantic no-op", () => {
    const store = new CompilerStore({ storeDir: temporaryDirectory() })
    const run = store.openRun("noop")
    prepareTurn(run, "i1", { value: 1 }, { compiled: "same" })
    finishDelivery(run, "i1")
    const before = run.replay().current
    const result = prepareTurn(run, "i2", { value: 1 }, { compiled: "same" }).result
    assert.equal((result as { status?: string }).status, "noop")
    assert.equal(run.replay().current.version, before.version)
    assert.equal(run.replay().current.artifactVersion, before.artifactVersion)
    assert.equal(run.replay().current.compiledIntentRef?.digest, before.compiledIntentRef?.digest)
  })

  it("records an initial state-version-zero no-op without consuming version one", () => {
    const store = new CompilerStore({ storeDir: temporaryDirectory() })
    const run = store.openRun("initial-noop")
    run.saveInput({ inputIdentity: "i0", raw: "no change" })
    const proposal = run.saveProposal("i0", { operations: [{ operation: "no_change" }] })
    const validation = run.recordValidation({ inputIdentity: "i0", proposalId: proposal.proposalId, valid: true })
    const result = run.commit({
      inputIdentity: "i0",
      proposalId: proposal.proposalId,
      validationId: validation.validationId,
      state: { state_version: 0, requirements: [] },
      compiledIntent: { state_version: 0, requirements: [] },
    })

    assert.equal("status" in result ? result.status : "committed", "noop")
    assert.equal(result.stateVersion, 0)
    assert.equal(result.artifactVersion, 0)
    assert.equal(run.history().some((record) => record.type === "commit.noop"), true)
    assert.equal(run.history().some((record) => record.type === "commit.complete"), false)
    assert.equal(run.replay().current.version, 0)
    assert.equal(run.replay().current.artifactVersion, 0)
    assert.ok(run.replay().current.compiledIntentRef)
    const recovery = run.recover()
    assert.equal(recovery.action, "delivery")
    assert.equal(recovery.stateVersion, 0)
    assert.equal(recovery.artifactVersion, 0)

    finishDelivery(run, "i0")
    const next = prepareTurn(run, "i1", { state_version: 1, requirements: [{ id: "r1" }] }).result
    assert.equal("status" in next ? next.status : "committed", "committed")
    assert.equal(next.stateVersion, 1)
    assert.equal(run.replay().current.version, 1)
  })

  it("keeps delivery attempts independent from artifact versions", () => {
    const store = new CompilerStore({ storeDir: temporaryDirectory() })
    const run = store.openRun("delivery")
    prepareTurn(run, "i1", { value: 1 }, { compiled: "same" })
    finishDelivery(run, "i1")
    const firstArtifactVersion = run.replay().current.artifactVersion
    prepareTurn(run, "i2", { value: 2 }, { compiled: "same" })
    assert.equal(run.replay().current.artifactVersion, firstArtifactVersion)
    const ref = run.replay().current.compiledIntentRef
    assert.ok(ref)
    const attempt = run.recordDeliveryAttempt({ inputIdentity: "i2", artifactVersion: firstArtifactVersion, expectedDigest: ref.digest, expectedRenderedDigest: run.replay().current.renderedTextRef!.digest, readbackDigest: ref.digest, readbackRenderedDigest: run.replay().current.renderedTextRef!.digest, status: "confirmed" })
    assert.equal(attempt.artifactVersion, firstArtifactVersion)
    assert.equal(attempt.attemptId.startsWith("delivery:delivery:"), true)
  })

  it("requires reconciliation after confirmed delivery and marks traced failures contaminated", () => {
    const store = new CompilerStore({ storeDir: temporaryDirectory() })
    const run = store.openRun("recovery")
    prepareTurn(run, "i1", { value: 1 })
    const current = run.replay().current
    assert.ok(current.compiledIntentRef)
    const confirmed = run.recordDeliveryAttempt({ inputIdentity: "i1", artifactVersion: current.artifactVersion, expectedDigest: current.compiledIntentRef.digest, expectedRenderedDigest: current.renderedTextRef!.digest, readbackDigest: current.compiledIntentRef.digest, readbackRenderedDigest: current.renderedTextRef!.digest, status: "confirmed" })
    assert.equal(run.recover().action, "reconcile")
    assert.throws(() => run.saveInput({ inputIdentity: "i2", raw: "blocked" }), DeliveryBlockedError)
    run.reconcileDelivery(confirmed.attemptId, { terminal: true })
    assert.equal(run.recover().action, "complete")

    const run2 = store.openRun("contaminated")
    prepareTurn(run2, "i1", { value: 1 })
    const current2 = run2.replay().current
    assert.ok(current2.compiledIntentRef)
    run2.recordDeliveryAttempt({ inputIdentity: "i1", artifactVersion: current2.artifactVersion, expectedDigest: current2.compiledIntentRef.digest, reason: "readback mismatch", executionTrace: { assistantStep: true }, status: "rejected" })
    const recovery = run2.recover()
    assert.equal(recovery.action, "contaminated")
    assert.equal(recovery.contaminated, true)

    const run3 = store.openRun("failed-reconciliation")
    prepareTurn(run3, "i1", { value: 1 })
    const current3 = run3.replay().current
    assert.ok(current3.compiledIntentRef && current3.renderedTextRef)
    const confirmed3 = run3.recordDeliveryAttempt({
      inputIdentity: "i1",
      artifactVersion: current3.artifactVersion,
      expectedDigest: current3.compiledIntentRef.digest,
      expectedRenderedDigest: current3.renderedTextRef.digest,
      readbackDigest: current3.compiledIntentRef.digest,
      readbackRenderedDigest: current3.renderedTextRef.digest,
      status: "confirmed",
    })
    run3.reconcileDelivery(confirmed3.attemptId, { terminal: true, status: "failed" })
    assert.equal(run3.recover().action, "contaminated")
  })

  it("does not accept a confirmed delivery without both exact readbacks", () => {
    const store = new CompilerStore({ storeDir: temporaryDirectory() })
    const run = store.openRun("strict-readback")
    prepareTurn(run, "i1", { value: 1 })
    const current = run.replay().current
    assert.ok(current.compiledIntentRef)
    assert.throws(
      () => run.recordDeliveryAttempt({
        inputIdentity: "i1",
        artifactVersion: current.artifactVersion,
        expectedDigest: current.compiledIntentRef!.digest,
        readbackDigest: current.compiledIntentRef!.digest,
        status: "confirmed",
      }),
      /requires expected and readback digests/u,
    )
  })

  it("retains evidence decisions, exposes only the named admitted-input boundary, and rejects conflicts", () => {
    const store = new CompilerStore({ storeDir: temporaryDirectory() })
    const run = store.openRun("evidence")
    const first = run.recordEvidenceDecision({ evidenceId: "ev1", payload: { result: "ok" }, boundaryInputIdentity: "future", decision: "admitted" })
    assert.equal(first.decision, "admitted")
    assert.throws(() => run.eligibleEvidence("future"), /unknown input/)
    run.saveInput({ inputIdentity: "future", raw: "new turn" })
    assert.equal(run.eligibleEvidence("future").length, 1)
    assert.throws(() => run.recordEvidenceDecision({ evidenceId: "ev1", payload: { result: "different" }, boundaryInputIdentity: "future", decision: "admitted" }), EvidenceConflictError)

    const other = store.openRun("evidence-boundaries")
    other.recordEvidenceDecision({ evidenceId: "future-only", payload: {}, boundaryInputIdentity: "future", decision: "admitted" })
    assert.throws(
      () => other.recordEvidenceDecision({ evidenceId: "missing-boundary", payload: {}, decision: "admitted" } as unknown as EvidenceDecisionInput),
      /non-empty string/,
    )
    other.saveInput({ inputIdentity: "current", raw: "current turn" })
    assert.deepEqual(other.eligibleEvidence("current").map((item) => item.evidenceId), [])
    assert.throws(() => other.eligibleEvidence("not-admitted"), /unknown input/)
  })

  it("accepts only parts with an explicit text type before a proposal can be saved", () => {
    const store = new CompilerStore({ storeDir: temporaryDirectory() })
    const run = store.openRun("text-only")
    assert.throws(() => run.saveInput({ inputIdentity: "image", raw: "caption", parts: [{ type: "image", url: "x" }] }), InputContentError)
    assert.throws(() => run.saveInput({ inputIdentity: "missing-type", raw: "caption", parts: [{ text: "caption" }] }), InputContentError)
    assert.throws(() => run.saveInput({ inputIdentity: "legacy-alias", raw: "caption", parts: [{ type: "input_text", text: "caption" }] }), InputContentError)
    assert.throws(() => run.saveInput({ inputIdentity: "string-part", raw: "caption", parts: ["caption"] }), InputContentError)
    assert.equal(run.history().filter((record) => record.type === "input.rejected").length, 4)

    const accepted = store.openRun("explicit-text")
    assert.equal(accepted.saveInput({ inputIdentity: "text", raw: "caption", parts: [{ type: "text", text: "caption" }] }).status, "saved")
  })

  it("restores a named version into a new run identity without changing the source history", () => {
    const store = new CompilerStore({ storeDir: temporaryDirectory() })
    const source = store.openRun("source")
    prepareTurn(source, "i1", { value: 1 })
    finishDelivery(source, "i1")
    prepareTurn(source, "i2", { value: 2 })
    const sourceHistoryLength = source.history().length
    const restored = store.restore("source", 1, "restored")
    assert.equal(restored.runId, "restored")
    assert.equal(restored.replay().current.version, 1)
    assert.deepEqual(restored.replay().current.state, { value: 1 })
    assert.equal(source.history().length, sourceHistoryLength)
    assert.equal(source.replay().current.version, 2)
    assert.equal(restored.history().some((record) => record.type === "commit.complete" && (record.data as { kind?: string }).kind === "restore"), true)
  })
})
