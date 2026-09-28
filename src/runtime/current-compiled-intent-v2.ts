import { IntentStoreV2 } from "../core/compiler-store-v2.js"
import type { CompiledIntent, TaskIntent } from "../core/intent-contract.js"

export interface CurrentCompiledIntentV2Options {
  storeDir: string
  runId: string
  taskId?: string
}

export interface CurrentCompiledIntentV2Result {
  runId: string
  schemaVersion: 2
  currentIr: Record<string, TaskIntent>
  compiled: Record<string, CompiledIntent>
  pendingEventIds: string[]
  selected?: CompiledIntent
}

export class CurrentCompiledIntentV2Error extends Error {
  readonly code: "RUN_MISMATCH" | "TASK_NOT_FOUND"

  constructor(code: "RUN_MISMATCH" | "TASK_NOT_FOUND", message: string) {
    super(message)
    this.name = "CurrentCompiledIntentV2Error"
    this.code = code
  }
}

/**
 * Read-only v2 run view.  Unlike the v1 reader this never mutates a run and
 * can return either one named task or the complete per-task index.
 */
export function readCurrentCompiledIntentV2(
  options: CurrentCompiledIntentV2Options,
): CurrentCompiledIntentV2Result {
  const store = new IntentStoreV2({ storeDir: options.storeDir, runId: options.runId })
  const snapshot = store.current()
  if (snapshot.run_id !== options.runId) {
    throw new CurrentCompiledIntentV2Error("RUN_MISMATCH", `v2 run ${options.runId} does not match persisted run ${snapshot.run_id}`)
  }
  const selected = options.taskId === undefined
    ? undefined
    : snapshot.compiled[options.taskId]
  if (options.taskId !== undefined && selected === undefined) {
    throw new CurrentCompiledIntentV2Error("TASK_NOT_FOUND", `no compiled intent exists for task ${options.taskId}`)
  }
  return {
    runId: snapshot.run_id,
    schemaVersion: 2,
    currentIr: snapshot.ir,
    compiled: snapshot.compiled,
    pendingEventIds: snapshot.pending_event_ids,
    ...(selected === undefined ? {} : { selected }),
  }
}

