import { CompilerStore, type CommitReference } from "../core/compiler-store.js"
import type { CompiledIntentArtifact } from "../core/intent-state.js"

export interface CurrentCompiledIntentOptions {
  compilerStoreDirectory: string
  observerStoreDirectory: string
  executorWorkspaceDirectory: string
  runId: string
}

export interface CurrentCompiledIntentResult {
  runId: string
  stateVersion: number
  artifactVersion: number
  commit: CommitReference
  artifact: CompiledIntentArtifact
  latestDeliveryAttemptId?: string
}

export class CurrentCompiledIntentError extends Error {
  readonly code: "COMMIT_NOT_FOUND" | "ARTIFACT_INVALID"

  constructor(code: "COMMIT_NOT_FOUND" | "ARTIFACT_INVALID", message: string) {
    super(message)
    this.name = "CurrentCompiledIntentError"
    this.code = code
  }
}

/** Read only the currently committed public artifact and its commit reference. */
export function readCurrentCompiledIntent(options: CurrentCompiledIntentOptions): CurrentCompiledIntentResult {
  const store = new CompilerStore({
    storeDir: options.compilerStoreDirectory,
    observerStoreDir: options.observerStoreDirectory,
    executorWorkspaceDir: options.executorWorkspaceDirectory,
  })
  const run = store.openRun(options.runId)
  const current = run.replay().current
  if (!current.commit || current.compiledIntent === undefined) {
    throw new CurrentCompiledIntentError("COMMIT_NOT_FOUND", `Compiler run ${options.runId} has no committed Compiled Intent`)
  }
  if (!isCompiledIntentArtifact(current.compiledIntent)) {
    throw new CurrentCompiledIntentError("ARTIFACT_INVALID", `Compiler run ${options.runId} has an invalid committed Compiled Intent`)
  }
  const commit = current.commit
  const latestDelivery = [...run.history()].reverse().find((event) => {
    if (event.type !== "delivery.attempt") return false
    const data = event.data as Record<string, unknown>
    return data.inputIdentity === commit.inputIdentity
  })
  const latestDeliveryAttemptId = latestDelivery === undefined
    ? undefined
    : (latestDelivery.data as Record<string, unknown>).attemptId
  if (latestDeliveryAttemptId !== undefined && typeof latestDeliveryAttemptId !== "string") {
    throw new CurrentCompiledIntentError("ARTIFACT_INVALID", `Compiler run ${options.runId} has invalid delivery metadata`)
  }
  return {
    runId: options.runId,
    stateVersion: current.version,
    artifactVersion: current.artifactVersion,
    commit,
    artifact: current.compiledIntent,
    ...(latestDeliveryAttemptId === undefined ? {} : { latestDeliveryAttemptId }),
  }
}

function isCompiledIntentArtifact(value: unknown): value is CompiledIntentArtifact {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.artifact_type === "compiled_intent" && record.schema_version === 1
}
