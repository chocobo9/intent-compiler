import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { createHash, randomBytes } from "node:crypto"
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path"

/**
 * The store deliberately accepts JSON-shaped payloads instead of importing the
 * Intent state or model modules.  That keeps the persistence seam independent
 * while still allowing those modules to use their own richer types at runtime.
 */
export type JsonPrimitive = null | boolean | number | string
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface CompilerStoreOptions {
  /** Root of this Compiler store. */
  storeDir: string
  /** A separately configured Observer store must not overlap this directory. */
  observerStoreDir?: string
  /** The Compiler store may not be inside this executor-modifiable directory. */
  executorWorkspaceDir?: string
  clock?: () => string
}

export interface ArtifactRef {
  artifactType: string
  mediaType: string
  digest: string
  size: number
  path: string
}

export interface CompilerInput {
  inputIdentity: string
  raw: unknown
  /** Optional OpenCode/source identities and exact task-content parts. */
  source?: unknown
  parts?: unknown[]
  digest?: string
}

export interface InputRecord {
  inputIdentity: string
  digest: string
  raw: JsonValue
  source?: JsonValue
  artifact: ArtifactRef
  sequence: number
  timestamp: string
}

export interface ProposalRecord {
  proposalId: string
  inputIdentity: string
  digest: string
  proposal: JsonValue
  sequence: number
  timestamp: string
}

export interface ValidationRecord {
  validationId: string
  inputIdentity: string
  proposalId: string
  valid: boolean
  errors: JsonValue
  result?: JsonValue
  sequence: number
  timestamp: string
}

export interface CommitInput {
  inputIdentity: string
  proposalId?: string
  validationId?: string
  baseVersion?: number
  state: unknown
  compiledIntent?: unknown
  renderedText?: string
  operationIds?: string[]
  sourceDigests?: string[]
  stateDigest?: string
  compiledIntentDigest?: string
  /** Optional expected version; code checks rather than trusting this value. */
  newVersion?: number
}

export interface CommitReference {
  runId: string
  inputIdentity: string
  stateVersion: number
  stateDigest: string
  artifactVersion: number
  compiledIntent: ArtifactRef
  renderedText: ArtifactRef
  operationIds: string[]
  sourceDigests: string[]
  commitSequence: number
}

export interface CurrentState {
  runId: string
  version: number
  state?: JsonValue
  stateDigest?: string
  artifactVersion: number
  compiledIntent?: JsonValue
  renderedText?: string
  compiledIntentRef?: ArtifactRef
  renderedTextRef?: ArtifactRef
  commit?: CommitReference
}

export interface SnapshotReport {
  kind: "snapshot-mismatch" | "snapshot-missing" | "history-corrupt" | "invalid-commit" | "orphan-stage"
  path?: string
  digest?: string
  expectedDigest?: string
  sequence?: number
  message: string
}

export interface ReplayResult {
  runId: string
  requestedVersion?: number
  current: CurrentState
  commits: CommitReference[]
  reports: SnapshotReport[]
}

export type DeliveryStatus = "pending" | "confirmed" | "rejected" | "failed"

export interface ExecutionTrace {
  assistantStep?: boolean
  toolCall?: boolean
  workspaceChange?: boolean
  [key: string]: unknown
}

export interface DeliveryAttemptInput {
  inputIdentity: string
  artifactVersion: number
  expectedDigest?: string
  expectedRenderedDigest?: string
  readbackDigest?: string
  readbackRenderedDigest?: string
  status: DeliveryStatus
  reason?: string
  executionTrace?: ExecutionTrace
  metadata?: unknown
}

export interface DeliveryAttempt {
  attemptId: string
  runId: string
  inputIdentity: string
  artifactVersion: number
  expectedDigest?: string
  expectedRenderedDigest?: string
  readbackDigest?: string
  readbackRenderedDigest?: string
  status: DeliveryStatus
  reason?: string
  executionTrace: ExecutionTrace
  sequence: number
  timestamp: string
}

export interface EvidenceDecisionInput {
  evidenceId: string
  payload?: unknown
  digest?: string
  decision: "admitted" | "rejected"
  reason?: string
  /** Explicit next-input boundary to which this evidence is confined. */
  boundaryInputIdentity: string
  metadata?: unknown
}

export interface EvidenceDecision {
  evidenceId: string
  digest: string
  decision: "admitted" | "rejected"
  reason?: string
  boundaryInputIdentity: string
  payload?: JsonValue
  sequence: number
  timestamp: string
}

export type RecoveryAction =
  | "idle"
  | "model"
  | "validate"
  | "commit"
  | "commit_pending"
  | "delivery"
  | "retry_delivery"
  | "reconcile"
  | "contaminated"
  | "blocked"
  | "complete"

export interface RecoveryResult {
  runId: string
  action: RecoveryAction
  inputIdentity?: string
  inputDigest?: string
  proposalId?: string
  validationId?: string
  stateVersion?: number
  artifactVersion?: number
  attemptId?: string
  reason?: string
  contaminated: boolean
  blocked: boolean
  reports: SnapshotReport[]
}

export class CompilerStoreError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "CompilerStoreError"
    this.code = code
  }
}

export class StorePathError extends CompilerStoreError {
  constructor(message: string) {
    super("STORE_PATH_INVALID", message)
    this.name = "StorePathError"
  }
}

export class IdentityConflictError extends CompilerStoreError {
  constructor(message: string) {
    super("IDENTITY_CONTENT_CONFLICT", message)
    this.name = "IdentityConflictError"
  }
}

export class EvidenceConflictError extends CompilerStoreError {
  constructor(message: string) {
    super("EVIDENCE_IDENTITY_CONTENT_CONFLICT", message)
    this.name = "EvidenceConflictError"
  }
}

export class DeliveryBlockedError extends CompilerStoreError {
  constructor(message: string) {
    super("DELIVERY_BLOCKED", message)
    this.name = "DeliveryBlockedError"
  }
}

export class VersionConflictError extends CompilerStoreError {
  constructor(message: string) {
    super("BASE_VERSION_CONFLICT", message)
    this.name = "VersionConflictError"
  }
}

export class VersionNotFoundError extends CompilerStoreError {
  constructor(message: string) {
    super("VERSION_NOT_FOUND", message)
    this.name = "VersionNotFoundError"
  }
}

export class InputContentError extends CompilerStoreError {
  constructor(message: string) {
    super("NON_TEXT_INPUT", message)
    this.name = "InputContentError"
  }
}

interface HistoryRecord {
  schema: "compiler-store/0.1"
  eventId: string
  sequence: number
  timestamp: string
  type: string
  data: JsonValue
}

interface RunManifest {
  schema: "compiler-run/0.1"
  runId: string
  maxArtifactBytes: number
  maxRenderedBytes: number
}

interface StageData {
  stageId: string
  inputIdentity: string
  proposalId?: string
  validationId?: string
  baseVersion: number
  stateVersion: number
  artifactVersion: number
  noOp: boolean
  state: JsonValue
  stateDigest: string
  compiledIntent: JsonValue
  compiledIntentDigest: string
  renderedText: string
  renderedTextDigest: string
  stateArtifact?: ArtifactRef
  compiledArtifact: ArtifactRef
  renderedArtifact: ArtifactRef
  operationIds: string[]
  sourceDigests: string[]
}

interface ParsedHistory {
  records: HistoryRecord[]
  reports: SnapshotReport[]
}

const HISTORY_SCHEMA = "compiler-store/0.1" as const
const RUN_ID_RE = /^[A-Za-z0-9._-]+$/
const storeInternals = new WeakMap<CompilerStore, { storeDir: string; clock: () => string }>()

/** Stable JSON encoding used for all content addresses and inline history. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function digestOf(value: unknown): string {
  return `sha256:${createHash("sha256").update(Buffer.from(canonicalJson(value), "utf8")).digest("hex")}`
}

function digestText(value: string): string {
  return `sha256:${createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex")}`
}

function assertCompilerStorePath(
  storeDir: string,
  options: Pick<CompilerStoreOptions, "observerStoreDir" | "executorWorkspaceDir"> = {},
): string {
  if (typeof storeDir !== "string" || !isAbsolute(storeDir)) {
    throw new StorePathError(`Compiler store path must be absolute: ${String(storeDir)}`)
  }
  const store = resolve(storeDir)
  const observer = options.observerStoreDir
  const workspace = options.executorWorkspaceDir
  if (observer !== undefined) {
    if (typeof observer !== "string" || !isAbsolute(observer)) {
      throw new StorePathError(`Observer store path must be absolute: ${String(observer)}`)
    }
    const observerResolved = resolve(observer)
    if (pathsOverlap(store, observerResolved)) {
      throw new StorePathError("Compiler store and Observer store must be separate, non-overlapping paths")
    }
  }
  if (workspace !== undefined) {
    if (typeof workspace !== "string" || !isAbsolute(workspace)) {
      throw new StorePathError(`Executor workspace path must be absolute: ${String(workspace)}`)
    }
    const workspaceResolved = resolve(workspace)
    if (isWithin(store, workspaceResolved)) {
      throw new StorePathError("Compiler store cannot be inside the executor-modifiable workspace")
    }
  }
  return store
}

function canonicalize(value: unknown, seen = new Set<unknown>()): JsonValue {
  if (value === null) return null
  if (typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CompilerStoreError("NON_JSON_VALUE", "JSON payload contains a non-finite number")
    return value
  }
    if (value === undefined) throw new CompilerStoreError("NON_JSON_VALUE", "Store payload must be JSON serializable")
    if (typeof value !== "object") throw new CompilerStoreError("NON_JSON_VALUE", "Store payload must be JSON serializable")
  if (seen.has(value)) throw new CompilerStoreError("NON_JSON_VALUE", "Store payload contains a cycle")
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((item) => item === undefined ? null : canonicalize(item, seen))
    const result: { [key: string]: JsonValue } = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const member = (value as Record<string, unknown>)[key]
      if (member === undefined) continue
      result[key] = canonicalize(member, seen)
    }
    return result
  } finally {
    seen.delete(value)
  }
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T
}

function isWithin(candidate: string, parent: string): boolean {
  const rel = relative(parent, candidate)
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function pathsOverlap(a: string, b: string): boolean {
  return isWithin(a, b) || isWithin(b, a)
}

function safeRunId(value: string): string {
  if (typeof value !== "string" || !RUN_ID_RE.test(value)) {
    throw new CompilerStoreError("RUN_ID_INVALID", `run id must contain only letters, numbers, dot, underscore, or dash: ${String(value)}`)
  }
  return value
}

function safeIdentity(value: string, label = "identity"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw new CompilerStoreError("IDENTITY_INVALID", `${label} must be a non-empty string no longer than 512 characters`)
  }
  return value
}

function fsyncWrite(path: string, bytes: Buffer): void {
  mkdirSync(dirname(path), { recursive: true })
  const descriptor = openSync(path, "w")
  try {
    writeFileSync(descriptor, bytes)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function atomicWrite(path: string, bytes: Buffer): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`
  fsyncWrite(temporary, bytes)
  renameSync(temporary, path)
}

function artifactDigestForBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function digestHex(digest: string): string {
  return digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest
}

function asJson(value: unknown): JsonValue {
  return canonicalize(value)
}

function boolTrace(trace: ExecutionTrace | undefined): boolean {
  return Boolean(trace?.assistantStep || trace?.toolCall || trace?.workspaceChange)
}

function findLast<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item !== undefined && predicate(item)) return item
  }
  return undefined
}

function internalStore(store: CompilerStore): { storeDir: string; clock: () => string } {
  const internal = storeInternals.get(store)
  if (!internal) throw new CompilerStoreError("STORE_INTERNALS_MISSING", "Compiler store internals are unavailable")
  return internal
}

function normalizeDeliveryStatus(value: DeliveryAttemptInput): DeliveryStatus {
  const raw = value.status
  if (raw === "pending" || raw === "confirmed" || raw === "rejected" || raw === "failed") return raw
  throw new CompilerStoreError("DELIVERY_STATUS_INVALID", `unknown delivery status: ${String(raw)}`)
}

/**
 * Independent append-only Compiler persistence.  The class exposes a small
 * run handle while keeping all physical directories and marker files private.
 */
export class CompilerStore {
  private readonly storeDir: string
  private readonly clock: () => string
  private readonly openRuns = new Map<string, CompilerRun>()

  constructor(options: CompilerStoreOptions) {
    this.storeDir = assertCompilerStorePath(options.storeDir, options)
    this.clock = options.clock ?? (() => new Date().toISOString())
    storeInternals.set(this, { storeDir: this.storeDir, clock: this.clock })
    mkdirSync(this.storeDir, { recursive: true })
    mkdirSync(join(this.storeDir, "runs"), { recursive: true })
  }

  openRun(runId: string): CompilerRun {
    const id = safeRunId(runId)
    let run = this.openRuns.get(id)
    if (!run) {
      run = new CompilerRun(this, id)
      this.openRuns.set(id, run)
    }
    return run
  }

  restore(runId: string, version: number, newRunId: string): CompilerRun {
    const source = this.openRun(runId)
    const replayed = source.replay(version)
    const destinationId = safeRunId(newRunId)
    if (existsSync(join(this.storeDir, "runs", destinationId))) {
      throw new CompilerStoreError("RUN_EXISTS", `restore destination already exists: ${destinationId}`)
    }
    const destination = new CompilerRun(this, destinationId, { sourceRunId: runId, replayed })
    this.openRuns.set(destinationId, destination)
    return destination
  }
}

class CompilerRun {
  private readonly store: CompilerStore
  readonly runId: string
  private readonly dir: string
  private readonly historyPath: string

  constructor(store: CompilerStore, runId: string, restore?: { sourceRunId: string; replayed: ReplayResult }) {
    this.store = store
    this.runId = safeRunId(runId)
    this.dir = join(internalStore(store).storeDir, "runs", this.runId)
    this.historyPath = join(this.dir, "history.jsonl")
    mkdirSync(join(this.dir, "snapshots", "sha256"), { recursive: true })
    mkdirSync(join(this.dir, "artifacts", "sha256"), { recursive: true })
    if (!this.hasEventType("run.created")) {
      this.append("run.created", { runId: this.runId })
    }
    if (restore) this.restoreBaseline(restore.sourceRunId, restore.replayed)
  }

  /** Read valid records without exposing the physical log path to callers. */
  history(): ReadonlyArray<HistoryRecord> {
    return this.readParsedHistory().records.map((record) => cloneJson(record as unknown as JsonValue) as unknown as HistoryRecord)
  }

  configureProjectionLimits(input: { maxArtifactBytes: number; maxRenderedBytes: number }): void {
    const manifest: RunManifest = {
      schema: "compiler-run/0.1",
      runId: this.runId,
      maxArtifactBytes: positiveSafeInteger(input.maxArtifactBytes, "maximum artifact bytes"),
      maxRenderedBytes: positiveSafeInteger(input.maxRenderedBytes, "maximum rendered-message bytes"),
    }
    const path = join(this.dir, "manifest.json")
    if (existsSync(path)) {
      let existing: unknown
      try {
        existing = JSON.parse(readFileSync(path, "utf8"))
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        throw new CompilerStoreError("RUN_MANIFEST_INVALID", `run manifest cannot be read: ${message}`)
      }
      if (canonicalJson(existing) !== canonicalJson(manifest)) {
        throw new CompilerStoreError(
          "RUN_CONFIGURATION_CONFLICT",
          "run projection limits differ from the limits fixed by its manifest",
        )
      }
    } else {
      atomicWrite(path, Buffer.from(`${canonicalJson(manifest)}\n`, "utf8"))
    }
    if (!this.hasEventType("run.configured")) {
      this.append("run.configured", asJson(manifest))
    }
  }

  saveInput(input: CompilerInput): { status: "saved" | "duplicate"; record: InputRecord; proposal?: ProposalRecord; commit?: CommitReference } {
    const normalized = input
    const identity = safeIdentity(normalized.inputIdentity, "input identity")
    const raw = normalized.raw
    const rawJson = asJson(raw)
    const digest = typeof raw === "string" ? digestText(raw) : digestOf(rawJson)
    if (normalized.digest !== undefined && normalized.digest !== digest) {
      throw new CompilerStoreError("INPUT_DIGEST_INVALID", "raw input digest does not match the supplied payload")
    }
    if (normalized.source !== undefined) {
      const source = asJson(normalized.source)
      if (
        source !== null &&
        !Array.isArray(source) &&
        typeof source === "object" &&
        "payload_digest" in source &&
        source.payload_digest !== digest
      ) {
        throw new CompilerStoreError(
          "INPUT_SOURCE_DIGEST_INVALID",
          "source payload_digest does not match the admitted raw input",
        )
      }
    }

    const previous = this.findInput(identity)
    if (previous) {
      if (previous.digest !== digest) {
        this.append("input.identity-conflict", { inputIdentity: identity, existingDigest: previous.digest, receivedDigest: digest })
        throw new IdentityConflictError(`input identity ${identity} was already saved with a different raw digest`)
      }
      return { status: "duplicate", record: previous, proposal: this.findLatestProposal(identity), commit: this.findCommitForInput(identity) }
    }
    this.assertCanBeginInput()

    const parts = normalized.parts
    if (Array.isArray(parts) && parts.some((part) => !isTextPart(part))) {
      this.append("input.rejected", { inputIdentity: identity, digest, reason: "registered Compiler input contains non-text task-content parts" })
      throw new InputContentError("Compiler accepts text-only task messages; non-text task-content parts were rejected before model use")
    }

    const artifact = this.writeJsonArtifact("raw-input", rawJson, "input")
    const record = this.append("input.admitted", {
      inputIdentity: identity,
      digest,
      raw: rawJson,
      source: normalized.source === undefined ? undefined : asJson(normalized.source),
      artifact,
    })
    return {
      status: "saved",
      record: inputRecordFromEvent(this.runId, record),
    }
  }

  saveProposal(inputIdentity: string, proposal: unknown): ProposalRecord {
    const identity = safeIdentity(inputIdentity, "input identity")
    const input = this.findInput(identity)
    if (!input) throw new CompilerStoreError("INPUT_NOT_FOUND", `cannot save proposal for unknown input ${identity}`)
    const payload = asJson(proposal)
    const digest = digestOf(payload)
    const existing = this.findProposals(identity).find((item) => item.digest === digest)
    if (existing) return existing
    const priorAttempt = this.findProposals(identity).length + 1
    const proposalId = safeIdentity(`${identity}:proposal:${priorAttempt}`, "proposal id")
    const record = this.append("proposal.saved", {
      proposalId,
      inputIdentity: identity,
      digest,
      proposal: payload,
    })
    return proposalRecordFromEvent(this.runId, record)
  }

  recordValidation(input: {
    inputIdentity: string
    proposalId?: string
    valid: boolean
    errors?: unknown
    result?: unknown
  }): ValidationRecord {
    const identity = safeIdentity(input.inputIdentity, "input identity")
    const proposal = input.proposalId ? this.findProposal(input.proposalId) : this.findLatestProposal(identity)
    if (!proposal || proposal.inputIdentity !== identity) throw new CompilerStoreError("PROPOSAL_NOT_FOUND", "validation must reference a saved proposal for the same input")
    const record = this.append("validation.recorded", {
      validationId: `${proposal.proposalId}:validation:${this.nextSequence()}`,
      inputIdentity: identity,
      proposalId: proposal.proposalId,
      valid: Boolean(input.valid),
      errors: input.errors === undefined ? [] : asJson(input.errors),
      result: input.result === undefined ? undefined : asJson(input.result),
    })
    return validationRecordFromEvent(this.runId, record)
  }

  /** Write snapshots/artifacts and a staged marker, but not the authoritative commit. */
  stageCommit(input: CommitInput): {
    status: "staged" | "noop"
    stageId: string
    stateVersion: number
    artifactVersion: number
    commit?: CommitReference
  } {
    const identity = safeIdentity(input.inputIdentity, "input identity")
    const inputRecord = this.findInput(identity)
    if (!inputRecord) throw new CompilerStoreError("INPUT_NOT_FOUND", `cannot commit unknown input ${identity}`)
    const proposal = input.proposalId ? this.findProposal(input.proposalId) : this.findLatestProposal(identity)
    if (!proposal || proposal.inputIdentity !== identity) throw new CompilerStoreError("PROPOSAL_NOT_FOUND", "commit requires a saved proposal for the same input")
    const validation = input.validationId ? this.findValidation(input.validationId) : this.findLatestValidation(proposal.proposalId)
    if (!validation || validation.inputIdentity !== identity || validation.proposalId !== proposal.proposalId) {
      throw new CompilerStoreError("VALIDATION_NOT_FOUND", "commit requires a saved validation for the same proposal")
    }
    if (!validation.valid) throw new CompilerStoreError("VALIDATION_FAILED", "an invalid proposal cannot become a committed version")

    const replayed = this.replay()
    const baseVersion = input.baseVersion ?? replayed.current.version
    if (baseVersion !== replayed.current.version) {
      throw new VersionConflictError(`commit base version ${baseVersion} does not equal current version ${replayed.current.version}`)
    }
    const state = asJson(input.state)
    const stateDigest = digestOf(state)
    if (input.stateDigest !== undefined && input.stateDigest !== stateDigest) throw new CompilerStoreError("STATE_DIGEST_INVALID", "state digest does not match the proposed state")
    const compiledIntent = input.compiledIntent === undefined ? state : asJson(input.compiledIntent)
    const compiledIntentDigest = digestOf(compiledIntent)
    if (input.compiledIntentDigest !== undefined && input.compiledIntentDigest !== compiledIntentDigest) throw new CompilerStoreError("ARTIFACT_DIGEST_INVALID", "Compiled Intent digest does not match the proposed artifact")
    const renderedText = input.renderedText ?? canonicalJson(compiledIntent)
    const renderedTextDigest = digestText(renderedText)
    const operationIds = [...(input.operationIds ?? [])]
    const sourceDigests = [...(input.sourceDigests ?? [])]

    const pendingStage = this.findLatestStageForInput(identity)
    if (pendingStage && !this.findCommitByStage(pendingStage.stageId) && !this.findNoopByStage(pendingStage.stageId)) {
      // A crash after the staged marker must not manufacture a second state
      // version.  The caller can explicitly finalize this durable stage.
      return { status: "staged", stageId: pendingStage.stageId, stateVersion: pendingStage.stateVersion, artifactVersion: pendingStage.artifactVersion }
    }

    const currentCompiledDigest = replayed.current.compiledIntentRef?.digest
    const currentRenderedDigest = replayed.current.renderedTextRef?.digest
    const initialSemanticNoOp = replayed.current.version === 0 && jsonStateVersion(state) === 0
    const semanticNoOp = initialSemanticNoOp || (replayed.current.stateDigest !== undefined && replayed.current.stateDigest === stateDigest)
    if (semanticNoOp) {
      if (currentCompiledDigest !== undefined && currentCompiledDigest !== compiledIntentDigest) {
        throw new CompilerStoreError("NOOP_ARTIFACT_MISMATCH", "a semantic no-op must reuse the existing Compiled Intent artifact")
      }
      if (currentRenderedDigest !== undefined && currentRenderedDigest !== renderedTextDigest) {
        throw new CompilerStoreError("NOOP_RENDERED_MISMATCH", "a semantic no-op must reuse the existing rendered artifact")
      }
      const stateArtifact = this.writeJsonArtifact("state-snapshot", state, "snapshot")
      const compiledArtifact = replayed.current.compiledIntentRef ?? this.writeJsonArtifact("compiled-intent", compiledIntent, "compiled")
      const renderedArtifact = replayed.current.renderedTextRef ?? this.writeTextArtifact("compiled-intent-rendered", renderedText, "rendered")
      verifyArtifact(this.pathForRef(stateArtifact), stateArtifact.digest)
      verifyArtifact(this.pathForRef(compiledArtifact), compiledArtifact.digest)
      verifyArtifact(this.pathForRef(renderedArtifact), renderedArtifact.digest)
      const stageId = `noop-${this.nextSequence()}-${digestHex(stateDigest).slice(0, 12)}`
      const staged = this.append("commit.staged", {
        stageId,
        inputIdentity: identity,
        proposalId: proposal.proposalId,
        validationId: validation.validationId,
        baseVersion,
        stateVersion: replayed.current.version,
        artifactVersion: replayed.current.artifactVersion,
        noOp: true,
        state,
        stateDigest,
        compiledIntent,
        compiledIntentDigest,
        renderedText,
        renderedTextDigest,
        stateArtifact,
        compiledArtifact,
        renderedArtifact,
        operationIds,
        sourceDigests,
      })
      const final = this.append("commit.noop", {
        stageId,
        inputIdentity: identity,
        proposalId: proposal.proposalId,
        validationId: validation.validationId,
        baseVersion,
        newVersion: replayed.current.version,
        stateVersion: replayed.current.version,
        artifactVersion: replayed.current.artifactVersion,
        state,
        stateDigest,
        compiledIntent,
        compiledIntentDigest,
        renderedText,
        renderedTextDigest,
        stateArtifact,
        compiledArtifact,
        renderedArtifact,
        operationIds,
        sourceDigests,
      })
      return { status: "noop", stageId: String((staged.data as Record<string, JsonValue>).stageId), stateVersion: replayed.current.version, artifactVersion: replayed.current.artifactVersion, commit: commitReferenceFromEvent(this.runId, final) }
    }

    const stateArtifact = this.writeJsonArtifact("state-snapshot", state, "snapshot")
    const compiledArtifact = this.writeJsonArtifact("compiled-intent", compiledIntent, "compiled")
    const renderedArtifact = this.writeTextArtifact("compiled-intent-rendered", renderedText, "rendered")
    verifyArtifact(this.pathForRef(stateArtifact), stateArtifact.digest)
    verifyArtifact(this.pathForRef(compiledArtifact), compiledArtifact.digest)
    verifyArtifact(this.pathForRef(renderedArtifact), renderedArtifact.digest)

    const stateVersion = replayed.current.version + 1
    if (input.newVersion !== undefined && input.newVersion !== stateVersion) throw new VersionConflictError(`new version ${input.newVersion} is not the next version ${stateVersion}`)
    const artifactVersion = currentCompiledDigest === compiledIntentDigest ? replayed.current.artifactVersion : replayed.current.artifactVersion + 1
    const stageId = `stage-${this.nextSequence()}-${digestHex(stateDigest).slice(0, 12)}`
    this.append("commit.staged", {
      stageId,
      inputIdentity: identity,
      proposalId: proposal.proposalId,
      validationId: validation.validationId,
      baseVersion,
      stateVersion,
      artifactVersion,
      noOp: false,
      state,
      stateDigest,
      compiledIntent,
      compiledIntentDigest,
      renderedText,
      renderedTextDigest,
      stateArtifact,
      compiledArtifact,
      renderedArtifact,
      operationIds,
      sourceDigests,
    })
    return { status: "staged", stageId, stateVersion, artifactVersion }
  }

  finalizeCommit(stageId: string): CommitReference {
    const stage = this.findStage(stageId)
    if (!stage) {
      const existing = this.findCommitByStage(stageId)
      if (existing) return existing
      throw new CompilerStoreError("STAGE_NOT_FOUND", `unknown staged commit ${stageId}`)
    }
    if (stage.noOp) {
      const existing = this.findCommitByStage(stageId)
      if (existing) return existing
      const completedNoop = this.findNoopByStage(stageId)
      if (completedNoop) return completedNoop
      const record = this.append("commit.noop", {
        stageId,
        inputIdentity: stage.inputIdentity,
        proposalId: stage.proposalId,
        validationId: stage.validationId,
        baseVersion: stage.baseVersion,
        newVersion: stage.stateVersion,
        stateVersion: stage.stateVersion,
        artifactVersion: stage.artifactVersion,
        state: stage.state,
        stateDigest: stage.stateDigest,
        compiledIntent: stage.compiledIntent,
        compiledIntentDigest: stage.compiledIntentDigest,
        renderedText: stage.renderedText,
        renderedTextDigest: stage.renderedTextDigest,
        stateArtifact: stage.stateArtifact,
        compiledArtifact: stage.compiledArtifact,
        renderedArtifact: stage.renderedArtifact,
        operationIds: stage.operationIds,
        sourceDigests: stage.sourceDigests,
      })
      return commitReferenceFromEvent(this.runId, record)
    }
    const current = this.replay().current
    if (current.version !== stage.baseVersion) throw new VersionConflictError("staged commit became stale before its authoritative commit marker")
    verifyArtifact(this.pathForRef(stage.stateArtifact as ArtifactRef), stage.stateDigest)
    verifyArtifact(this.pathForRef(stage.compiledArtifact), stage.compiledIntentDigest)
    verifyArtifact(this.pathForRef(stage.renderedArtifact), stage.renderedTextDigest)
    const existing = this.findCommitByStage(stageId)
    if (existing) return existing
    const record = this.append("commit.complete", {
      kind: "normal",
      stageId,
      inputIdentity: stage.inputIdentity,
      proposalId: stage.proposalId,
      validationId: stage.validationId,
      baseVersion: stage.baseVersion,
      newVersion: stage.stateVersion,
      artifactVersion: stage.artifactVersion,
      state: stage.state,
      stateDigest: stage.stateDigest,
      compiledIntent: stage.compiledIntent,
      compiledIntentDigest: stage.compiledIntentDigest,
      renderedText: stage.renderedText,
      renderedTextDigest: stage.renderedTextDigest,
      stateArtifact: stage.stateArtifact,
      compiledArtifact: stage.compiledArtifact,
      renderedArtifact: stage.renderedArtifact,
      operationIds: stage.operationIds,
      sourceDigests: stage.sourceDigests,
    })
    return commitReferenceFromEvent(this.runId, record)
  }

  commit(input: CommitInput): CommitReference | { status: "noop"; stateVersion: number; artifactVersion: number; commit: CommitReference } {
    const staged = this.stageCommit(input)
    if (staged.status === "noop") return { status: "noop", stateVersion: staged.stateVersion, artifactVersion: staged.artifactVersion, commit: staged.commit as CommitReference }
    return this.finalizeCommit(staged.stageId)
  }

  recordDeliveryAttempt(input: DeliveryAttemptInput): DeliveryAttempt {
    const identity = safeIdentity(input.inputIdentity, "input identity")
    const commit = this.findCommitForInput(identity)
    if (!commit) throw new CompilerStoreError("COMMIT_NOT_FOUND", `delivery requires a committed input ${identity}`)
    if (input.artifactVersion !== commit.artifactVersion) {
      throw new VersionConflictError(`delivery artifact version ${input.artifactVersion} does not match committed artifact version ${commit.artifactVersion}`)
    }
    const status = normalizeDeliveryStatus(input)
    if (
      status === "confirmed" &&
      (
        input.expectedDigest === undefined ||
        input.expectedRenderedDigest === undefined ||
        input.readbackDigest === undefined ||
        input.readbackRenderedDigest === undefined
      )
    ) {
      throw new CompilerStoreError(
        "DELIVERY_READBACK_REQUIRED",
        "confirmed delivery requires expected and readback digests for both artifact and rendered text",
      )
    }
    let finalStatus = status
    let reason = input.reason
    if (input.expectedDigest !== undefined && input.expectedDigest !== commit.compiledIntent.digest) {
      finalStatus = "rejected"
      reason = reason ?? "delivery expected digest does not match the committed artifact"
    }
    if (input.expectedRenderedDigest !== undefined && input.expectedRenderedDigest !== commit.renderedText.digest) {
      finalStatus = "rejected"
      reason = reason ?? "delivery expected rendered digest does not match the committed artifact"
    }
    if (status === "confirmed" && input.expectedDigest !== undefined && input.readbackDigest !== input.expectedDigest) {
      finalStatus = "rejected"
      reason = reason ?? "delivery readback digest mismatch"
    }
    if (status === "confirmed" && input.expectedRenderedDigest !== undefined && input.readbackRenderedDigest !== input.expectedRenderedDigest) {
      finalStatus = "rejected"
      reason = reason ?? "rendered delivery readback digest mismatch"
    }
    const attemptId = `${this.runId}:delivery:${this.nextSequence()}`
    const trace = input.executionTrace === undefined ? {} : asJson(input.executionTrace) as unknown as ExecutionTrace
    const record = this.append("delivery.attempt", {
      attemptId,
      inputIdentity: identity,
      artifactVersion: input.artifactVersion,
      expectedDigest: input.expectedDigest,
      expectedRenderedDigest: input.expectedRenderedDigest,
      readbackDigest: input.readbackDigest,
      readbackRenderedDigest: input.readbackRenderedDigest,
      status: finalStatus,
      reason,
      executionTrace: trace as unknown as JsonValue,
      metadata: input.metadata === undefined ? undefined : asJson(input.metadata),
    })
    const attempt = deliveryAttemptFromEvent(this.runId, record)
    if ((finalStatus === "rejected" || finalStatus === "failed") && boolTrace(attempt.executionTrace)) {
      this.append("run.contaminated", {
        inputIdentity: identity,
        attemptId,
        reason: reason ?? "delivery failed after assistant/tool/workspace execution trace",
        executionTrace: attempt.executionTrace as unknown as JsonValue,
      })
    }
    return attempt
  }

  recordExecutionTrace(attemptId: string, trace: ExecutionTrace): void {
    const attempt = this.findDeliveryAttempt(attemptId)
    if (!attempt) throw new CompilerStoreError("DELIVERY_NOT_FOUND", `unknown delivery attempt ${attemptId}`)
    const normalized = asJson(trace)
    this.append("delivery.trace", { attemptId, inputIdentity: attempt.inputIdentity, executionTrace: normalized })
    if ((attempt.status === "rejected" || attempt.status === "failed") && boolTrace(trace)) {
      this.append("run.contaminated", { inputIdentity: attempt.inputIdentity, attemptId, reason: "delivery attempt has an assistant/tool/workspace trace", executionTrace: normalized })
    }
  }

  reconcileDelivery(attemptId: string, input: { terminal?: boolean; status?: "complete" | "pending" | "failed"; executionTrace?: ExecutionTrace; workspaceSnapshotDigest?: string; result?: unknown } = {}): void {
    const attempt = this.findDeliveryAttempt(attemptId)
    if (!attempt) throw new CompilerStoreError("DELIVERY_NOT_FOUND", `unknown delivery attempt ${attemptId}`)
    const trace = input.executionTrace === undefined ? {} : asJson(input.executionTrace)
    const status = input.status ?? (input.terminal === false ? "pending" : "complete")
    const terminal = input.terminal ?? status !== "pending"
    if ((status === "pending") === terminal) {
      throw new CompilerStoreError(
        "DELIVERY_RECONCILIATION_INVALID",
        "pending reconciliation must be non-terminal and complete/failed reconciliation must be terminal",
      )
    }
    this.append("delivery.reconciliation", {
      attemptId,
      inputIdentity: attempt.inputIdentity,
      status,
      terminal,
      executionTrace: trace,
      workspaceSnapshotDigest: input.workspaceSnapshotDigest,
      result: input.result === undefined ? undefined : asJson(input.result),
    })
    if (status === "failed") {
      this.append("run.contaminated", {
        inputIdentity: attempt.inputIdentity,
        attemptId,
        reason: "confirmed delivery could not be reconciled after the executor request",
        executionTrace: trace,
      })
    } else if ((attempt.status === "rejected" || attempt.status === "failed") && boolTrace(input.executionTrace)) {
      this.append("run.contaminated", {
        inputIdentity: attempt.inputIdentity,
        attemptId,
        reason: "delivery reconciliation observed an assistant/tool/workspace trace on a failed attempt",
        executionTrace: trace,
      })
    }
  }

  recordEvidenceDecision(input: EvidenceDecisionInput): EvidenceDecision {
    const boundaryInputIdentity = safeIdentity(input.boundaryInputIdentity, "evidence boundary input identity")
    const payloadInput = input.payload
    const payload = payloadInput === undefined ? undefined : asJson(payloadInput)
    const digest = input.digest ?? (payload === undefined ? digestOf(null) : digestOf(payload))
    if (payload !== undefined && digest !== digestOf(payload)) throw new EvidenceConflictError("evidence digest does not match its payload")
    const evidenceId = safeIdentity(input.evidenceId, "evidence identity")
    const prior = this.findEvidence(evidenceId)
    if (prior) {
      if (prior.digest !== digest || prior.boundaryInputIdentity !== boundaryInputIdentity || prior.decision !== input.decision) {
        this.append("evidence.identity-conflict", { evidenceId, existingDigest: prior.digest, receivedDigest: digest, existingBoundaryInputIdentity: prior.boundaryInputIdentity, receivedBoundaryInputIdentity: boundaryInputIdentity })
        throw new EvidenceConflictError(`evidence identity ${evidenceId} was already saved with different content, decision, or input boundary`)
      }
      return prior
    }
    const record = this.append("evidence.decision", {
      evidenceId,
      digest,
      decision: input.decision,
      reason: input.reason,
      boundaryInputIdentity,
      payload,
      metadata: input.metadata === undefined ? undefined : asJson(input.metadata),
    })
    return evidenceRecordFromEvent(this.runId, record)
  }

  eligibleEvidence(inputIdentity: string): EvidenceDecision[] {
    const identity = safeIdentity(inputIdentity, "input identity")
    const records = this.readParsedHistory().records
    const input = records.find((record) => record.type === "input.admitted" && dataString(record.data, "inputIdentity") === identity)
    if (!input) throw new CompilerStoreError("INPUT_NOT_FOUND", `cannot expose evidence for unknown input ${identity}`)
    return records
      .filter((record) => record.type === "evidence.decision" && dataString(record.data, "decision") === "admitted")
      .filter((record) => record.sequence < input.sequence)
      .filter((record) => dataString(record.data, "boundaryInputIdentity") === identity)
      .map((record) => evidenceRecordFromEvent(this.runId, record))
  }

  replay(version?: number): ReplayResult {
    const parsed = this.readParsedHistory()
    const reports = [...parsed.reports]
    const commits: CommitReference[] = []
    let current: CurrentState = { runId: this.runId, version: 0, artifactVersion: 0 }
    let versionZero = current
    for (const record of parsed.records) {
      const data = record.data as Record<string, JsonValue>
      if (record.type === "commit.noop") {
        const candidate = validateCommitPayload(this.runId, this.dir, record, data, reports)
        if (!candidate) continue
        if (candidate.state.baseVersion !== current.version || candidate.state.version !== current.version) {
          reports.push({ kind: "invalid-commit", sequence: record.sequence, message: `no-op sequence ${record.sequence} does not preserve current replay version ${current.version}` })
          continue
        }
        current = candidate.state
        if (current.version === 0) versionZero = current
        continue
      }
      if (record.type !== "commit.complete") continue
      const kind = dataString(data, "kind")
      if (kind === "restore") {
        const candidate = validateCommitPayload(this.runId, this.dir, record, data, reports)
        if (!candidate) continue
        current = candidate.state
        commits.push(candidate.reference)
        continue
      }
      const candidate = validateCommitPayload(this.runId, this.dir, record, data, reports)
      if (!candidate) continue
      if (candidate.state.baseVersion !== current.version) {
        reports.push({ kind: "invalid-commit", sequence: record.sequence, message: `commit sequence ${record.sequence} has base version ${candidate.state.baseVersion}, current replay version is ${current.version}` })
        continue
      }
      current = candidate.state
      commits.push(candidate.reference)
    }
    const requestedVersion = version
    if (version !== undefined) {
      if (!Number.isInteger(version) || version < 0) throw new VersionNotFoundError(`invalid requested state version: ${version}`)
      const target = commits.find((commit) => commit.stateVersion === version)
      if (version === 0) {
        current = versionZero
      } else if (!target) {
        throw new VersionNotFoundError(`state version ${version} was not found in complete Compiler history`)
      } else {
        const targetRecord = parsed.records.find((record) => record.type === "commit.complete" && dataNumber(record.data, "newVersion") === version)
        if (targetRecord) {
          const targetPayload = validateCommitPayload(this.runId, this.dir, targetRecord, targetRecord.data as Record<string, JsonValue>, reports)
          if (targetPayload) current = targetPayload.state
        }
      }
    }
    for (const staged of parsed.records.filter((record) => record.type === "commit.staged")) {
      const stageId = dataString(staged.data, "stageId")
      const finalized = parsed.records.some((record) => (record.type === "commit.complete" || record.type === "commit.noop") && dataString(record.data, "stageId") === stageId)
      if (!finalized) {
        reports.push({ kind: "orphan-stage", sequence: staged.sequence, message: `staged commit ${stageId} has no complete commit marker and is ignored during replay` })
      }
    }
    return { runId: this.runId, requestedVersion, current, commits, reports }
  }

  recover(): RecoveryResult {
    const replayed = this.replay()
    const reports = replayed.reports
    const records = this.readParsedHistory().records
    const conflict = records.find((record) => record.type === "evidence.identity-conflict")
    if (conflict) {
      return { runId: this.runId, action: "blocked", reason: "evidence identity/digest conflict blocks the next update", contaminated: false, blocked: true, reports }
    }
    const inputs = records.filter((record) => record.type === "input.admitted")
    const latestInput = inputs.at(-1)
    if (!latestInput) return { runId: this.runId, action: "idle", contaminated: false, blocked: false, reports }
    const inputIdentity = dataString(latestInput.data, "inputIdentity")
    const inputDigest = dataString(latestInput.data, "digest")
    const proposals = records.filter((record) => record.type === "proposal.saved" && dataString(record.data, "inputIdentity") === inputIdentity)
    const proposal = proposals.at(-1)
    if (!proposal) return { runId: this.runId, action: "model", inputIdentity, inputDigest, contaminated: false, blocked: false, reports }
    const proposalId = dataString(proposal.data, "proposalId")
    const validations = records.filter((record) => record.type === "validation.recorded" && dataString(record.data, "proposalId") === proposalId)
    const validation = validations.at(-1)
    if (!validation) return { runId: this.runId, action: "validate", inputIdentity, inputDigest, proposalId, contaminated: false, blocked: false, reports }
    if (dataBool(validation.data, "valid") !== true) return { runId: this.runId, action: "blocked", inputIdentity, inputDigest, proposalId, validationId: dataString(validation.data, "validationId"), reason: "proposal validation failed", contaminated: false, blocked: true, reports }
    const commit = this.findCommitForInput(inputIdentity)
    const staged = this.findLatestStageForInput(inputIdentity)
    if (!commit) {
      if (staged && !this.findCommitByStage(staged.stageId)) return { runId: this.runId, action: "commit_pending", inputIdentity, inputDigest, proposalId, validationId: dataString(validation.data, "validationId"), stateVersion: staged.stateVersion, artifactVersion: staged.artifactVersion, contaminated: false, blocked: false, reports }
      return { runId: this.runId, action: "commit", inputIdentity, inputDigest, proposalId, validationId: dataString(validation.data, "validationId"), contaminated: false, blocked: false, reports }
    }
    const attempts = records.filter((record) => record.type === "delivery.attempt" && dataString(record.data, "inputIdentity") === inputIdentity)
    const attemptRecord = attempts.at(-1)
    if (!attemptRecord) return { runId: this.runId, action: "delivery", inputIdentity, inputDigest, proposalId, validationId: dataString(validation.data, "validationId"), stateVersion: commit.stateVersion, artifactVersion: commit.artifactVersion, contaminated: false, blocked: false, reports }
    const attempt = deliveryAttemptFromEvent(this.runId, attemptRecord)
    const contaminated = records.some((record) => record.type === "run.contaminated" && dataString(record.data, "inputIdentity") === inputIdentity)
    if (contaminated) return { runId: this.runId, action: "contaminated", inputIdentity, inputDigest, proposalId, validationId: dataString(validation.data, "validationId"), stateVersion: commit.stateVersion, artifactVersion: commit.artifactVersion, attemptId: attempt.attemptId, reason: "delivery attempt has execution traces; restart from declared workspace/state snapshot", contaminated: true, blocked: true, reports }
    if (attempt.status === "rejected" || attempt.status === "failed") return { runId: this.runId, action: "retry_delivery", inputIdentity, inputDigest, proposalId, validationId: dataString(validation.data, "validationId"), stateVersion: commit.stateVersion, artifactVersion: commit.artifactVersion, attemptId: attempt.attemptId, reason: attempt.reason ?? "delivery was not confirmed", contaminated: false, blocked: true, reports }
    if (attempt.status === "confirmed") {
      const reconciliations = records.filter((record) => record.type === "delivery.reconciliation" && dataString(record.data, "attemptId") === attempt.attemptId)
      const reconciliation = reconciliations.at(-1)
      if (!reconciliation || dataString(reconciliation.data, "status") === "pending" || dataBool(reconciliation.data, "terminal") === false) {
        return { runId: this.runId, action: "reconcile", inputIdentity, inputDigest, proposalId, validationId: dataString(validation.data, "validationId"), stateVersion: commit.stateVersion, artifactVersion: commit.artifactVersion, attemptId: attempt.attemptId, reason: "confirmed delivery must be reconciled before another delivery or turn", contaminated: false, blocked: true, reports }
      }
      return { runId: this.runId, action: "complete", inputIdentity, inputDigest, proposalId, validationId: dataString(validation.data, "validationId"), stateVersion: commit.stateVersion, artifactVersion: commit.artifactVersion, attemptId: attempt.attemptId, contaminated: false, blocked: false, reports }
    }
    return { runId: this.runId, action: "delivery", inputIdentity, inputDigest, proposalId, validationId: dataString(validation.data, "validationId"), stateVersion: commit.stateVersion, artifactVersion: commit.artifactVersion, attemptId: attempt.attemptId, contaminated: false, blocked: false, reports }
  }

  /** Called only by CompilerStore.restore; it creates a new run baseline. */
  private restoreBaseline(sourceRunId: string, replayed: ReplayResult): void {
    if (this.history().some((record) => record.type === "commit.complete" && dataString(record.data, "kind") === "restore")) {
      throw new CompilerStoreError("RUN_ALREADY_RESTORED", `run ${this.runId} already has a restore baseline`)
    }
    if (replayed.current.version === 0 || replayed.current.state === undefined) {
      this.append("run.restored", { sourceRunId, sourceVersion: 0, stateVersion: 0 })
      return
    }
    const state = replayed.current.state
    const compiledIntent = replayed.current.compiledIntent ?? state
    const renderedText = replayed.current.renderedText ?? canonicalJson(compiledIntent)
    const stateArtifact = this.writeJsonArtifact("state-snapshot", state, "snapshot")
    const compiledArtifact = this.writeJsonArtifact("compiled-intent", compiledIntent, "compiled")
    const renderedArtifact = this.writeTextArtifact("compiled-intent-rendered", renderedText, "rendered")
    const record = this.append("commit.complete", {
      kind: "restore",
      stageId: `restore-${this.nextSequence()}`,
      sourceRunId,
      sourceVersion: replayed.current.version,
      inputIdentity: `restore:${sourceRunId}:${replayed.current.version}`,
      baseVersion: null,
      newVersion: replayed.current.version,
      artifactVersion: replayed.current.artifactVersion,
      state,
      stateDigest: replayed.current.stateDigest ?? digestOf(state),
      compiledIntent,
      compiledIntentDigest: replayed.current.compiledIntentRef?.digest ?? digestOf(compiledIntent),
      renderedText,
      renderedTextDigest: replayed.current.renderedTextRef?.digest ?? digestText(renderedText),
      stateArtifact,
      compiledArtifact,
      renderedArtifact,
      operationIds: [],
      sourceDigests: [],
    })
    void record
  }

  private append(type: string, data: Record<string, unknown> | JsonValue): HistoryRecord {
    const parsed = this.readParsedHistory()
    const sequence = parsed.records.reduce((max, record) => Math.max(max, record.sequence), 0) + 1
    const record: HistoryRecord = {
      schema: HISTORY_SCHEMA,
      eventId: `${this.runId}:${sequence}`,
      sequence,
      timestamp: internalStore(this.store).clock(),
      type,
      data: asJson(data),
    }
    mkdirSync(dirname(this.historyPath), { recursive: true })
    const descriptor = openSync(this.historyPath, "a")
    try {
      appendFileSync(descriptor, `${canonicalJson(record)}\n`, "utf8")
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    return record
  }

  private nextSequence(): number {
    return this.readParsedHistory().records.reduce((max, record) => Math.max(max, record.sequence), 0) + 1
  }

  private hasEventType(type: string): boolean {
    return this.readParsedHistory().records.some((record) => record.type === type)
  }

  private readParsedHistory(): ParsedHistory {
    if (!existsSync(this.historyPath)) return { records: [], reports: [] }
    const records: HistoryRecord[] = []
    const reports: SnapshotReport[] = []
    const lines = readFileSync(this.historyPath, "utf8").split(/\r?\n/)
    lines.forEach((line, index) => {
      if (!line.trim()) return
      try {
        const value = JSON.parse(line) as HistoryRecord
        if (value.schema !== HISTORY_SCHEMA || typeof value.sequence !== "number" || typeof value.type !== "string") throw new Error("invalid record shape")
        records.push(value)
      } catch (error) {
        reports.push({ kind: "history-corrupt", sequence: index + 1, message: `ignored malformed Compiler history line ${index + 1}: ${String(error)}` })
      }
    })
    records.sort((a, b) => a.sequence - b.sequence)
    return { records, reports }
  }

  private findInput(identity: string): InputRecord | undefined {
    const record = findLast(this.readParsedHistory().records, (item) => item.type === "input.admitted" && dataString(item.data, "inputIdentity") === identity)
    return record ? inputRecordFromEvent(this.runId, record) : undefined
  }

  private findLatestProposal(identity: string): ProposalRecord | undefined {
    return this.findProposals(identity).at(-1)
  }

  private findProposals(identity: string): ProposalRecord[] {
    return this.readParsedHistory().records.filter((record) => record.type === "proposal.saved" && dataString(record.data, "inputIdentity") === identity).map((record) => proposalRecordFromEvent(this.runId, record))
  }

  private findProposal(proposalId: string): ProposalRecord | undefined {
    const record = findLast(this.readParsedHistory().records, (item) => item.type === "proposal.saved" && dataString(item.data, "proposalId") === proposalId)
    return record ? proposalRecordFromEvent(this.runId, record) : undefined
  }

  private findLatestValidation(proposalId: string): ValidationRecord | undefined {
    const record = findLast(this.readParsedHistory().records, (item) => item.type === "validation.recorded" && dataString(item.data, "proposalId") === proposalId)
    return record ? validationRecordFromEvent(this.runId, record) : undefined
  }

  private findValidation(validationId: string): ValidationRecord | undefined {
    const record = findLast(this.readParsedHistory().records, (item) => item.type === "validation.recorded" && dataString(item.data, "validationId") === validationId)
    return record ? validationRecordFromEvent(this.runId, record) : undefined
  }

  private findCommitForInput(identity: string): CommitReference | undefined {
    const commits = this.replay().commits.filter((item) => item.inputIdentity === identity)
    const direct = commits.at(-1)
    if (direct) return direct
    const noop = findLast(this.readParsedHistory().records, (record) => record.type === "commit.noop" && dataString(record.data, "inputIdentity") === identity)
    if (!noop) return undefined
    return commitReferenceFromEvent(this.runId, noop)
  }

  private findCommitByStage(stageId: string): CommitReference | undefined {
    const record = findLast(this.readParsedHistory().records, (item) => item.type === "commit.complete" && dataString(item.data, "stageId") === stageId)
    return record ? commitReferenceFromEvent(this.runId, record) : undefined
  }

  private findStage(stageId: string): StageData | undefined {
    const record = findLast(this.readParsedHistory().records, (item) => item.type === "commit.staged" && dataString(item.data, "stageId") === stageId)
    if (!record) return undefined
    return stageFromEvent(record)
  }

  private findNoopByStage(stageId: string): CommitReference | undefined {
    const record = findLast(this.readParsedHistory().records, (item) => item.type === "commit.noop" && dataString(item.data, "stageId") === stageId)
    return record ? commitReferenceFromEvent(this.runId, record) : undefined
  }

  private findLatestStageForInput(identity: string): StageData | undefined {
    const record = findLast(this.readParsedHistory().records, (item) => item.type === "commit.staged" && dataString(item.data, "inputIdentity") === identity)
    return record ? stageFromEvent(record) : undefined
  }

  private findDeliveryAttempt(attemptId: string): DeliveryAttempt | undefined {
    const record = findLast(this.readParsedHistory().records, (item) => item.type === "delivery.attempt" && dataString(item.data, "attemptId") === attemptId)
    return record ? deliveryAttemptFromEvent(this.runId, record) : undefined
  }

  private findEvidence(identity: string): EvidenceDecision | undefined {
    const record = findLast(this.readParsedHistory().records, (item) => item.type === "evidence.decision" && dataString(item.data, "evidenceId") === identity)
    return record ? evidenceRecordFromEvent(this.runId, record) : undefined
  }

  private pathForRef(ref: ArtifactRef): string {
    const path = resolve(this.dir, ref.path)
    if (!isWithin(path, this.dir)) throw new CompilerStoreError("ARTIFACT_PATH_INVALID", `artifact path escapes run directory: ${ref.path}`)
    return path
  }

  private writeJsonArtifact(type: string, value: JsonValue, kind: "input" | "snapshot" | "compiled"): ArtifactRef {
    const bytes = Buffer.from(canonicalJson(value), "utf8")
    const digest = artifactDigestForBytes(bytes)
    const relativePath = join(kind === "snapshot" ? "snapshots" : "artifacts", "sha256", `${digestHex(digest)}.${kind}.json`).replaceAll("\\", "/")
    const path = join(this.dir, relativePath)
    if (!existsSync(path)) atomicWrite(path, bytes)
    return { artifactType: type, mediaType: "application/json", digest, size: bytes.length, path: relativePath }
  }

  private writeTextArtifact(type: string, value: string, kind: "rendered"): ArtifactRef {
    const bytes = Buffer.from(value, "utf8")
    const digest = artifactDigestForBytes(bytes)
    const relativePath = join("artifacts", "sha256", `${digestHex(digest)}.${kind}.txt`).replaceAll("\\", "/")
    const path = join(this.dir, relativePath)
    if (!existsSync(path)) atomicWrite(path, bytes)
    return { artifactType: type, mediaType: "text/plain; charset=utf-8", digest, size: bytes.length, path: relativePath }
  }

  private assertCanBeginInput(): void {
    const recovery = this.recover()
    if (recovery.action !== "idle" && recovery.action !== "complete") {
      throw new DeliveryBlockedError(`run ${this.runId} has unfinished Compiler work; recovery action is ${recovery.action}`)
    }
  }
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CompilerStoreError("RUN_CONFIGURATION_INVALID", `${label} must be a positive safe integer`)
  }
  return value
}

function isTextPart(part: unknown): boolean {
  if (!part || typeof part !== "object") return false
  return (part as Record<string, unknown>).type === "text"
}

function jsonStateVersion(state: JsonValue): number | undefined {
  if (!state || typeof state !== "object" || Array.isArray(state)) return undefined
  const value = state.state_version
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined
}

function dataString(data: JsonValue, key: string): string {
  const value = (data as Record<string, JsonValue>)[key]
  return typeof value === "string" ? value : ""
}

function dataNumber(data: JsonValue, key: string): number {
  const value = (data as Record<string, JsonValue>)[key]
  return typeof value === "number" ? value : NaN
}

function dataBool(data: JsonValue, key: string): boolean {
  return (data as Record<string, JsonValue>)[key] === true
}

function inputRecordFromEvent(runId: string, event: HistoryRecord): InputRecord {
  const data = event.data as Record<string, JsonValue>
  return {
    inputIdentity: dataString(data, "inputIdentity"),
    digest: dataString(data, "digest"),
    raw: data.raw as JsonValue,
    ...(data.source === undefined ? {} : { source: data.source as JsonValue }),
    artifact: data.artifact as unknown as ArtifactRef,
    sequence: event.sequence,
    timestamp: event.timestamp,
  }
}

function proposalRecordFromEvent(_runId: string, event: HistoryRecord): ProposalRecord {
  const data = event.data as Record<string, JsonValue>
  return {
    proposalId: dataString(data, "proposalId"),
    inputIdentity: dataString(data, "inputIdentity"),
    digest: dataString(data, "digest"),
    proposal: data.proposal as JsonValue,
    sequence: event.sequence,
    timestamp: event.timestamp,
  }
}

function validationRecordFromEvent(_runId: string, event: HistoryRecord): ValidationRecord {
  const data = event.data as Record<string, JsonValue>
  return {
    validationId: dataString(data, "validationId"),
    inputIdentity: dataString(data, "inputIdentity"),
    proposalId: dataString(data, "proposalId"),
    valid: dataBool(data, "valid"),
    errors: data.errors as JsonValue,
    ...(data.result === undefined ? {} : { result: data.result as JsonValue }),
    sequence: event.sequence,
    timestamp: event.timestamp,
  }
}

function stageFromEvent(event: HistoryRecord): StageData {
  const data = event.data as Record<string, JsonValue>
  return {
    stageId: dataString(data, "stageId"),
    inputIdentity: dataString(data, "inputIdentity"),
    ...(data.proposalId === undefined ? {} : { proposalId: dataString(data, "proposalId") }),
    ...(data.validationId === undefined ? {} : { validationId: dataString(data, "validationId") }),
    baseVersion: dataNumber(data, "baseVersion"),
    stateVersion: dataNumber(data, "stateVersion"),
    artifactVersion: dataNumber(data, "artifactVersion"),
    noOp: dataBool(data, "noOp"),
    state: data.state as JsonValue,
    stateDigest: dataString(data, "stateDigest"),
    compiledIntent: data.compiledIntent as JsonValue,
    compiledIntentDigest: dataString(data, "compiledIntentDigest"),
    renderedText: dataString(data, "renderedText"),
    renderedTextDigest: dataString(data, "renderedTextDigest"),
    ...(data.stateArtifact === undefined ? {} : { stateArtifact: data.stateArtifact as unknown as ArtifactRef }),
    compiledArtifact: data.compiledArtifact as unknown as ArtifactRef,
    renderedArtifact: data.renderedArtifact as unknown as ArtifactRef,
    operationIds: Array.isArray(data.operationIds) ? data.operationIds.filter((item): item is string => typeof item === "string") : [],
    sourceDigests: Array.isArray(data.sourceDigests) ? data.sourceDigests.filter((item): item is string => typeof item === "string") : [],
  }
}

function commitReferenceFromEvent(runId: string, event: HistoryRecord): CommitReference {
  const data = event.data as Record<string, JsonValue>
  return {
    runId,
    inputIdentity: dataString(data, "inputIdentity"),
    stateVersion: dataNumber(data, "newVersion"),
    stateDigest: dataString(data, "stateDigest"),
    artifactVersion: dataNumber(data, "artifactVersion"),
    compiledIntent: data.compiledArtifact as unknown as ArtifactRef,
    renderedText: data.renderedArtifact as unknown as ArtifactRef,
    operationIds: Array.isArray(data.operationIds) ? data.operationIds.filter((item): item is string => typeof item === "string") : [],
    sourceDigests: Array.isArray(data.sourceDigests) ? data.sourceDigests.filter((item): item is string => typeof item === "string") : [],
    commitSequence: event.sequence,
  }
}

function deliveryAttemptFromEvent(runId: string, event: HistoryRecord): DeliveryAttempt {
  const data = event.data as Record<string, JsonValue>
  return {
    attemptId: dataString(data, "attemptId"),
    runId,
    inputIdentity: dataString(data, "inputIdentity"),
    artifactVersion: dataNumber(data, "artifactVersion"),
    ...(data.expectedDigest === undefined ? {} : { expectedDigest: dataString(data, "expectedDigest") }),
    ...(data.expectedRenderedDigest === undefined ? {} : { expectedRenderedDigest: dataString(data, "expectedRenderedDigest") }),
    ...(data.readbackDigest === undefined ? {} : { readbackDigest: dataString(data, "readbackDigest") }),
    ...(data.readbackRenderedDigest === undefined ? {} : { readbackRenderedDigest: dataString(data, "readbackRenderedDigest") }),
    status: dataString(data, "status") as DeliveryStatus,
    ...(data.reason === undefined ? {} : { reason: dataString(data, "reason") }),
    executionTrace: (data.executionTrace ?? {}) as unknown as ExecutionTrace,
    sequence: event.sequence,
    timestamp: event.timestamp,
  }
}

function evidenceRecordFromEvent(runId: string, event: HistoryRecord): EvidenceDecision {
  const data = event.data as Record<string, JsonValue>
  return {
    evidenceId: dataString(data, "evidenceId"),
    digest: dataString(data, "digest"),
    decision: dataString(data, "decision") as "admitted" | "rejected",
    ...(data.reason === undefined ? {} : { reason: dataString(data, "reason") }),
    boundaryInputIdentity: dataString(data, "boundaryInputIdentity"),
    ...(data.payload === undefined ? {} : { payload: data.payload as JsonValue }),
    sequence: event.sequence,
    timestamp: event.timestamp,
  }
}

function verifyArtifact(path: string, expectedDigest: string): void {
  if (!existsSync(path)) throw new CompilerStoreError("ARTIFACT_MISSING", `required artifact is missing: ${path}`)
  const actual = artifactDigestForBytes(readFileSync(path))
  if (actual !== expectedDigest) throw new CompilerStoreError("ARTIFACT_DIGEST_MISMATCH", `artifact digest mismatch at ${path}`)
}

function validateCommitPayload(
  runId: string,
  runDir: string,
  event: HistoryRecord,
  data: Record<string, JsonValue>,
  reports: SnapshotReport[],
): { state: CurrentState & { baseVersion: number }; reference: CommitReference } | undefined {
  const state = data.state as JsonValue
  const stateDigest = dataString(data, "stateDigest")
  const compiledIntent = data.compiledIntent as JsonValue
  const compiledIntentDigest = dataString(data, "compiledIntentDigest")
  const renderedText = dataString(data, "renderedText")
  const renderedTextDigest = dataString(data, "renderedTextDigest")
  if (state === undefined || digestOf(state) !== stateDigest || compiledIntent === undefined || digestOf(compiledIntent) !== compiledIntentDigest || digestText(renderedText) !== renderedTextDigest) {
    reports.push({ kind: "invalid-commit", sequence: event.sequence, message: `commit sequence ${event.sequence} has an invalid authoritative payload digest` })
    return undefined
  }
  const stateArtifact = data.stateArtifact as unknown as ArtifactRef
  const compiledArtifact = data.compiledArtifact as unknown as ArtifactRef
  const renderedArtifact = data.renderedArtifact as unknown as ArtifactRef
  for (const [ref, label] of [[stateArtifact, "state snapshot"], [compiledArtifact, "Compiled Intent artifact"], [renderedArtifact, "rendered artifact"]] as const) {
    if (!ref || typeof ref.path !== "string" || typeof ref.digest !== "string") {
      reports.push({ kind: "invalid-commit", sequence: event.sequence, message: `commit sequence ${event.sequence} has no valid ${label} reference` })
      return undefined
    }
    const path = resolve(runDir, ref.path)
    if (!isWithin(path, runDir)) {
      reports.push({ kind: "invalid-commit", sequence: event.sequence, message: `commit sequence ${event.sequence} has an artifact path outside its run directory` })
      return undefined
    }
    if (!existsSync(path)) {
      reports.push({ kind: "snapshot-missing", path: ref.path, digest: ref.digest, expectedDigest: ref.digest, sequence: event.sequence, message: `${label} is missing; replay uses the authoritative inline history payload` })
      continue
    }
    const actual = artifactDigestForBytes(readFileSync(path))
    if (actual !== ref.digest) {
      reports.push({ kind: "snapshot-mismatch", path: ref.path, digest: actual, expectedDigest: ref.digest, sequence: event.sequence, message: `${label} digest does not match its content; snapshot/artifact ignored during replay` })
    }
  }
  const baseVersion = data.baseVersion === null ? 0 : dataNumber(data, "baseVersion")
  const current: CurrentState & { baseVersion: number } = {
    runId,
    version: dataNumber(data, "newVersion"),
    state: cloneJson(state),
    stateDigest,
    artifactVersion: dataNumber(data, "artifactVersion"),
    compiledIntent: cloneJson(compiledIntent),
    renderedText,
    compiledIntentRef: compiledArtifact,
    renderedTextRef: renderedArtifact,
    commit: {
      runId,
      inputIdentity: dataString(data, "inputIdentity"),
      stateVersion: dataNumber(data, "newVersion"),
      stateDigest,
      artifactVersion: dataNumber(data, "artifactVersion"),
      compiledIntent: compiledArtifact,
      renderedText: renderedArtifact,
      operationIds: Array.isArray(data.operationIds) ? data.operationIds.filter((item): item is string => typeof item === "string") : [],
      sourceDigests: Array.isArray(data.sourceDigests) ? data.sourceDigests.filter((item): item is string => typeof item === "string") : [],
      commitSequence: event.sequence,
    },
    baseVersion,
  }
  return { state: current, reference: current.commit as CommitReference }
}
