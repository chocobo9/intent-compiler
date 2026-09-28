import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { artifactBytes, eventId, sha256 } from "./codec.js"
import {
  appendJsonLineDurable,
  ensureDir,
  readJsonIfExists,
  safeSegment,
  writeJsonAtomic,
  writeTextAtomic,
} from "./files.js"
import type { ArtifactRef, EventInput, Manifest, ObserverEvent } from "./types.js"

export const EVENT_SCHEMA_VERSION = "0.1"

export class EventStore {
  readonly storeDir: string
  readonly clock: () => string
  readonly monotonic: () => bigint
  readonly runs = new Map<string, RunStore>()

  constructor(
    storeDir: string,
    clock: () => string = () => new Date().toISOString(),
    monotonic: () => bigint = () => process.hrtime.bigint(),
  ) {
    this.storeDir = storeDir
    this.clock = clock
    this.monotonic = monotonic
    ensureDir(join(storeDir, "runs"))
    ensureDir(join(storeDir, "registrations"))
  }

  openRun(manifest: Manifest): RunStore {
    const runId = safeSegment(manifest.run_id, "run_id")
    let run = this.runs.get(runId)
    if (!run) {
      run = new RunStore(this, manifest)
      this.runs.set(runId, run)
    } else {
      run.activate(manifest)
    }
    return run
  }
}

export class RunStore {
  readonly parent: EventStore
  readonly manifest: Manifest
  activeManifest: Manifest
  readonly runId: string
  readonly dir: string
  readonly eventsPath: string
  sequence: number

  constructor(parent: EventStore, manifest: Manifest) {
    this.parent = parent
    this.manifest = structuredClone(manifest)
    this.activeManifest = structuredClone(manifest)
    this.runId = safeSegment(manifest.run_id, "run_id")
    this.dir = join(parent.storeDir, "runs", this.runId)
    this.eventsPath = join(this.dir, "events.jsonl")
    this.sequence = lastSequence(this.eventsPath)
    ensureDir(join(this.dir, "artifacts", "sha256"))
    ensureDir(join(this.dir, "pending"))

    const manifestPath = join(this.dir, "manifest.json")
    if (!existsSync(manifestPath)) writeJsonAtomic(manifestPath, this.manifest)
    if (this.sequence === 0) {
      this.append({ component: "run", event_type: "run.started", status: "registered" })
    }
  }

  append(event: EventInput): ObserverEvent {
    const active = this.activeManifest
    const record: ObserverEvent = {
      schema_version: EVENT_SCHEMA_VERSION,
      event_id: eventId(),
      sequence: ++this.sequence,
      timestamp: this.parent.clock(),
      monotonic_ns: this.parent.monotonic().toString(),
      run_id: this.manifest.run_id,
      arm_id: active.arm_id,
      task_id: active.task_id,
      turn_id: event.turn_id ?? active.turn_id,
      session_id: event.session_id ?? active.session_id,
      component: event.component,
      event_type: event.event_type,
      status: event.status,
      ...(event.message_id ? { message_id: event.message_id } : {}),
      ...(event.call_id ? { call_id: event.call_id } : {}),
      ...(event.parent_event_id ? { parent_event_id: event.parent_event_id } : {}),
      ...(event.artifact_refs ? { artifact_refs: event.artifact_refs } : {}),
      ...(event.metrics ? { metrics: event.metrics } : {}),
      ...(event.error ? { error: event.error } : {}),
      ...(event.data ? { data: event.data } : {}),
    }
    appendJsonLineDurable(this.eventsPath, record)
    this.writeStatus(record)
    return record
  }

  activate(manifest: Manifest): void {
    for (const field of ["run_id", "arm_id", "task_id", "session_id"] as const) {
      if (String(manifest[field]) !== String(this.manifest[field])) {
        throw new Error(`run ${this.runId} cannot change ${field}`)
      }
    }
    this.activeManifest = structuredClone(manifest)
  }

  saveArtifact(
    value: unknown,
    { artifactType, mediaType = "application/json", extension }: { artifactType?: string; mediaType?: string; extension?: string } = {},
  ): ArtifactRef {
    const bytes = artifactBytes(value, mediaType)
    const digest = sha256(bytes)
    const suffix = extension ?? extensionFor(mediaType)
    const relative = join("artifacts", "sha256", `${digest}${suffix}`).replaceAll("\\", "/")
    const path = join(this.dir, relative)
    if (!existsSync(path)) writeFileSync(path, bytes)
    return {
      artifact_type: artifactType ?? "opaque",
      media_type: mediaType,
      digest: `sha256:${digest}`,
      size: bytes.length,
      path: relative,
    }
  }

  pendingPath(messageId: string): string {
    return join(this.dir, "pending", `${safeSegment(messageId, "message_id")}.json`)
  }

  readPending(messageId: string): unknown {
    return readJsonIfExists(this.pendingPath(messageId))
  }

  writePending(messageId: string, value: unknown): void {
    writeJsonAtomic(this.pendingPath(messageId), value)
  }

  readEvents(): ObserverEvent[] {
    if (!existsSync(this.eventsPath)) return []
    return readFileSync(this.eventsPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ObserverEvent)
  }

  writeProjection(summary: unknown, reportHtml: string): void {
    writeJsonAtomic(join(this.dir, "summary.json"), summary)
    writeTextAtomic(join(this.dir, "report.html"), reportHtml)
  }

  writeStatus(event: ObserverEvent): void {
    const status = statusFor(event)
    if (!status) return
    writeJsonAtomic(join(this.dir, "status.json"), {
      schema_version: EVENT_SCHEMA_VERSION,
      run_id: this.manifest.run_id,
      task_id: this.manifest.task_id,
      turn_id: event.turn_id,
      session_id: event.session_id,
      status,
      source_event_id: event.event_id,
      updated_at: event.timestamp,
    })
  }
}

function lastSequence(eventsPath: string): number {
  if (!existsSync(eventsPath)) return 0
  const lines = readFileSync(eventsPath, "utf8").trim().split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) return 0
  return Number((JSON.parse(lines.at(-1) as string) as ObserverEvent).sequence) || 0
}

function extensionFor(mediaType: string): string {
  if (mediaType === "application/json") return ".json"
  if (mediaType.startsWith("text/")) return ".txt"
  return ".bin"
}

function statusFor(event: ObserverEvent): string | undefined {
  const states: Record<string, string> = {
    "run.started": "registered",
    "user_input.observed": "input_observed",
    "executor_message.part_update_observed": "part_update_observed",
    "executor_message.sdk_readback_confirmed": "delivery_observed",
    "executor_message.rejected": "instrumentation_failed",
    "session.busy": "executing",
    "session.idle": "exec_idle",
    "session.error": "failed",
    "reconciliation.completed": "observed",
    "reconciliation.failed": "instrumentation_failed",
    "turn.completed": "turn_completed",
    "run.finished": "completed",
    "run.failed": "failed",
  }
  return states[event.event_type]
}
