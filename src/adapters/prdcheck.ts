import { existsSync, realpathSync } from "node:fs"
import { isAbsolute, relative, resolve, sep } from "node:path"
import type {
  EvidenceRequest,
  PrepareTurnRequest,
} from "../core/intent-compiler.js"
import { sha256, stableJson } from "../observer/codec.js"

export type PrdcheckInputSource =
  | "initial_requirement"
  | "explicit_user_update"
  | "generated_harness_instruction"
  | "default_skip_instruction"
  | "workflow_state"
  | "session_state"

export type PrdcheckEvidenceSource =
  | "tool_result"
  | "build_result"
  | "test_result"
  | "workspace_diff"
  | "executor_statement"
  | "hidden_verifier_result"

export interface PrdcheckTurnIdentity {
  runId: string
  stageId: string
  pathId?: string
  round: number
  turnId: string
  sessionId: string
  messageId: string
  taskOccurrenceId?: string
  workspaceSnapshotId: string
  producedAt: string
}

export interface PrdcheckHostInput {
  source: PrdcheckInputSource
  inputIdentity: string
  text: string
  identity: PrdcheckTurnIdentity
}

export interface PrdcheckEvidenceIdentity extends PrdcheckTurnIdentity {
  pathId: string
  compilerTaskId: string
  resultWorkspaceSnapshotId: string
  causalParentId: string
  callId?: string
}

export interface PrdcheckHostEvidence {
  source: PrdcheckEvidenceSource
  evidenceId: string
  boundaryInputIdentity: string
  identity: PrdcheckEvidenceIdentity
  payload: unknown
  outcome?: "pass" | "fail" | "result" | "error"
  complete: boolean
  predeclared?: boolean
  compilerVisible?: boolean
  exactWorkspaceSnapshot?: boolean
}

export interface PrdcheckEvidenceCandidate {
  status: "candidate"
  request: EvidenceRequest
}

export type PrdcheckDeliveryStatus = "pending" | "confirmed" | "rejected" | "failed"

export interface PrdcheckAuditInput {
  arm: string
  artifactType: string
  turnIdentity: string
  version: number
  provenanceDigest: string
  size: number
  deliveryStatus: PrdcheckDeliveryStatus
  reference: string
}

export interface PrdcheckAuditEnvelope {
  readonly arm: string
  readonly artifactType: string
  readonly turnIdentity: string
  readonly version: number
  readonly provenanceDigest: string
  readonly size: number
  readonly deliveryStatus: PrdcheckDeliveryStatus
  readonly reference: string
}

export interface PrdcheckIsolationCheck {
  rawInputPath: string
  executorWorkspacePath: string
}

export interface PrdcheckAdapter {
  toPrepareTurnRequest(input: PrdcheckHostInput): PrepareTurnRequest | undefined
  toEvidenceCandidate(input: PrdcheckHostEvidence): PrdcheckEvidenceCandidate
  auditEnvelope(input: PrdcheckAuditInput): PrdcheckAuditEnvelope
  assertIsolatedArm(input: PrdcheckIsolationCheck): void
}

export class PrdcheckAdapterError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "PrdcheckAdapterError"
    this.code = code
  }
}

const USER_INPUT_SOURCES = new Set<PrdcheckInputSource>([
  "initial_requirement",
  "explicit_user_update",
])

const VERIFIER_SOURCES = new Set<PrdcheckEvidenceSource>([
  "build_result",
  "test_result",
  "hidden_verifier_result",
])

export function createPrdcheckAdapter(): PrdcheckAdapter {
  return Object.freeze({
    toPrepareTurnRequest,
    toEvidenceCandidate,
    auditEnvelope,
    assertIsolatedArm,
  })
}

function toPrepareTurnRequest(input: PrdcheckHostInput): PrepareTurnRequest | undefined {
  validateInputSource(input.source)
  if (!USER_INPUT_SOURCES.has(input.source)) return undefined

  const inputIdentity = requiredText(input.inputIdentity, "input identity")
  const text = requiredText(input.text, "user input text")
  const identity = validateTurnIdentity(input.identity)
  const digest = digestText(text)
  return {
    runId: identity.runId,
    input: {
      inputIdentity,
      raw: text,
      digest,
      parts: [{ type: "text", text }],
      source: {
        channel: "user",
        source_category: input.source,
        run_id: identity.runId,
        stage_id: identity.stageId,
        ...(identity.pathId === undefined ? {} : { path_id: identity.pathId }),
        round: identity.round,
        turn_id: identity.turnId,
        session_id: identity.sessionId,
        message_id: identity.messageId,
        ...(identity.taskOccurrenceId === undefined ? {} : { task_occurrence_id: identity.taskOccurrenceId }),
        workspace_snapshot_id: identity.workspaceSnapshotId,
        produced_at: identity.producedAt,
        payload_digest: digest,
      },
    },
    currentWorkspaceSnapshotId: identity.workspaceSnapshotId,
  }
}

function toEvidenceCandidate(input: PrdcheckHostEvidence): PrdcheckEvidenceCandidate {
  validateEvidenceSource(input.source)
  const identity = validateEvidenceIdentity(input.identity, input.source)
  const evidenceId = requiredText(input.evidenceId, "evidence identity")
  const boundaryInputIdentity = requiredText(input.boundaryInputIdentity, "evidence boundary input identity")
  if (input.complete !== true) throw new PrdcheckAdapterError("EVIDENCE_INCOMPLETE", "candidate evidence must be complete")
  if (VERIFIER_SOURCES.has(input.source)) {
    if (input.predeclared !== true) {
      throw new PrdcheckAdapterError("EVIDENCE_VERIFIER_NOT_PREDECLARED", `${input.source} must be predeclared before the run`)
    }
    if (input.compilerVisible !== true) {
      throw new PrdcheckAdapterError("EVIDENCE_VERIFIER_NOT_VISIBLE", `${input.source} must be declared Compiler-visible before the run`)
    }
    if (input.exactWorkspaceSnapshot !== true) {
      throw new PrdcheckAdapterError("EVIDENCE_SNAPSHOT_UNVERIFIED", `${input.source} must check the exact workspace snapshot`)
    }
  }

  const result = jsonPayload(input.payload)
  const sourcePayloadDigest = digestJson(result)
  const kind = evidenceKind(input.source, input.outcome)
  const payload = {
    kind,
    run_id: identity.runId,
    stage_id: identity.stageId,
    ...(identity.pathId === undefined ? {} : { path_id: identity.pathId }),
    round: identity.round,
    task_id: identity.compilerTaskId,
    ...(identity.taskOccurrenceId === undefined
      ? {}
      : { task_occurrence_id: identity.taskOccurrenceId }),
    turn_id: identity.turnId,
    session_id: identity.sessionId,
    message_id: identity.messageId,
    ...(identity.callId === undefined ? {} : { call_id: identity.callId }),
    input_workspace_snapshot_id: identity.workspaceSnapshotId,
    workspace_snapshot_id: identity.resultWorkspaceSnapshotId,
    causal_parent_id: identity.causalParentId,
    produced_at: identity.producedAt,
    payload_digest: sourcePayloadDigest,
    complete: true,
    ...(VERIFIER_SOURCES.has(input.source)
      ? { compiler_visible: true, predeclared: true, exact_workspace_snapshot: true }
      : {}),
    result,
  }
  return {
    status: "candidate",
    request: {
      runId: identity.runId,
      evidence: {
        evidenceId,
        payload,
        digest: digestJson(payload),
        boundaryInputIdentity,
      },
    },
  }
}

function auditEnvelope(input: PrdcheckAuditInput): PrdcheckAuditEnvelope {
  const version = nonNegativeInteger(input.version, "artifact version")
  const size = nonNegativeInteger(input.size, "artifact size")
  if (!["pending", "confirmed", "rejected", "failed"].includes(input.deliveryStatus)) {
    throw new PrdcheckAdapterError("AUDIT_DELIVERY_STATUS_INVALID", `invalid delivery status: ${String(input.deliveryStatus)}`)
  }
  return Object.freeze({
    arm: requiredText(input.arm, "arm identity"),
    artifactType: requiredText(input.artifactType, "artifact type"),
    turnIdentity: requiredText(input.turnIdentity, "turn identity"),
    version,
    provenanceDigest: digestValue(input.provenanceDigest, "provenance digest"),
    size,
    deliveryStatus: input.deliveryStatus,
    reference: requiredText(input.reference, "artifact or delivery reference"),
  })
}

function assertIsolatedArm(input: PrdcheckIsolationCheck): void {
  const rawInputPath = absoluteExistingOrLexical(input.rawInputPath, "raw input path")
  const executorWorkspacePath = absoluteExistingOrLexical(input.executorWorkspacePath, "executor workspace path")
  if (isWithin(rawInputPath, executorWorkspacePath)) {
    throw new PrdcheckAdapterError(
      "RAW_INPUT_VISIBLE_TO_EXECUTOR",
      `isolated Compiler arm raw input is inside the executor workspace: ${rawInputPath}`,
    )
  }
}

function validateTurnIdentity(identity: PrdcheckTurnIdentity): PrdcheckTurnIdentity {
  return {
    runId: requiredText(identity.runId, "run identity"),
    stageId: requiredText(identity.stageId, "stage identity"),
    ...(identity.pathId === undefined ? {} : { pathId: requiredText(identity.pathId, "path identity") }),
    round: nonNegativeInteger(identity.round, "round"),
    turnId: requiredText(identity.turnId, "turn identity"),
    sessionId: requiredText(identity.sessionId, "session identity"),
    messageId: requiredText(identity.messageId, "message identity"),
    ...(identity.taskOccurrenceId === undefined
      ? {}
      : { taskOccurrenceId: requiredText(identity.taskOccurrenceId, "task occurrence identity") }),
    workspaceSnapshotId: requiredText(identity.workspaceSnapshotId, "workspace snapshot identity"),
    producedAt: validTimestamp(identity.producedAt, "produced timestamp"),
  }
}

function validateEvidenceIdentity(identity: PrdcheckEvidenceIdentity, source: PrdcheckEvidenceSource): PrdcheckEvidenceIdentity {
  const common = validateTurnIdentity(identity)
  const callId = identity.callId === undefined ? undefined : requiredText(identity.callId, "call identity")
  if (source === "tool_result" && callId === undefined) {
    throw new PrdcheckAdapterError("EVIDENCE_CALL_ID_REQUIRED", "tool_result evidence requires a call identity")
  }
  return {
    ...common,
    pathId: requiredText(identity.pathId, "path identity"),
    compilerTaskId: requiredText(identity.compilerTaskId, "Compiler task identity"),
    resultWorkspaceSnapshotId: requiredText(
      identity.resultWorkspaceSnapshotId,
      "result workspace snapshot identity",
    ),
    causalParentId: requiredText(identity.causalParentId, "causal parent identity"),
    ...(callId === undefined ? {} : { callId }),
  }
}

function evidenceKind(source: PrdcheckEvidenceSource, outcome: PrdcheckHostEvidence["outcome"]): string {
  if (source === "workspace_diff") return "workspace_diff"
  if (source === "executor_statement") return "executor_statement"
  if (source === "tool_result") return outcome === "error" || outcome === "fail" ? "tool_error" : "tool_result"
  if (outcome !== "pass" && outcome !== "fail") {
    throw new PrdcheckAdapterError("EVIDENCE_OUTCOME_REQUIRED", `${source} requires a pass or fail outcome`)
  }
  if (source === "test_result") return outcome === "pass" ? "test_pass" : "test_failure"
  if (source === "build_result") return outcome === "pass" ? "check_pass" : "check_failure"
  return outcome === "pass" ? "verifier_pass" : "verifier_failure"
}

function validateInputSource(source: PrdcheckInputSource): void {
  const values: readonly string[] = [
    "initial_requirement",
    "explicit_user_update",
    "generated_harness_instruction",
    "default_skip_instruction",
    "workflow_state",
    "session_state",
  ]
  if (!values.includes(source)) throw new PrdcheckAdapterError("INPUT_SOURCE_INVALID", `unknown prdcheck input source: ${String(source)}`)
}

function validateEvidenceSource(source: PrdcheckEvidenceSource): void {
  const values: readonly string[] = [
    "tool_result",
    "build_result",
    "test_result",
    "workspace_diff",
    "executor_statement",
    "hidden_verifier_result",
  ]
  if (!values.includes(source)) throw new PrdcheckAdapterError("EVIDENCE_SOURCE_INVALID", `unknown prdcheck evidence source: ${String(source)}`)
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PrdcheckAdapterError("IDENTITY_REQUIRED", `${label} must be a non-empty string`)
  }
  return value
}

function digestValue(value: unknown, label: string): string {
  const digest = requiredText(value, label)
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) {
    throw new PrdcheckAdapterError("DIGEST_INVALID", `${label} must be a sha256 digest`)
  }
  return digest
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new PrdcheckAdapterError("NUMBER_INVALID", `${label} must be a non-negative integer`)
  }
  return value
}

function validTimestamp(value: unknown, label: string): string {
  const text = requiredText(value, label)
  if (!Number.isFinite(Date.parse(text))) {
    throw new PrdcheckAdapterError("TIMESTAMP_INVALID", `${label} must be a valid timestamp`)
  }
  return text
}

function jsonPayload(value: unknown): unknown {
  let encoded: string | undefined
  try {
    encoded = stableJson(value)
  } catch {
    throw new PrdcheckAdapterError("EVIDENCE_PAYLOAD_INVALID", "evidence payload must be JSON serializable")
  }
  if (typeof encoded !== "string") {
    throw new PrdcheckAdapterError("EVIDENCE_PAYLOAD_INVALID", "evidence payload must be JSON serializable")
  }
  return JSON.parse(encoded) as unknown
}

function digestText(value: string): string {
  return `sha256:${sha256(value)}`
}

function digestJson(value: unknown): string {
  return `sha256:${sha256(stableJson(value))}`
}

function absoluteExistingOrLexical(path: string, label: string): string {
  const value = requiredText(path, label)
  if (!isAbsolute(value)) throw new PrdcheckAdapterError("PATH_NOT_ABSOLUTE", `${label} must be absolute`)
  const absolute = resolve(value)
  return existsSync(absolute) ? realpathSync(absolute) : absolute
}

function isWithin(candidate: string, parent: string): boolean {
  const value = relative(parent, candidate)
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value))
}
