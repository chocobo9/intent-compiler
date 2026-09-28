import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs"
import { join } from "node:path"

export interface OpenCodeJsonlIdentity {
  runId: string
  stageId: string
  pathId: string
  round: number
  turnId: string
}

export type OpenCodeJsonEventEnvelope = Record<string, unknown>

export interface OpenCodeJsonlReadResult {
  events: OpenCodeJsonEventEnvelope[]
  firstSessionId: string | undefined
  lastText: string | undefined
  partIds: string[]
  messageIds: string[]
  sessionIds: string[]
  callIds: string[]
  rawLines: string[]
}

export interface OpenCodeJsonlFile {
  readonly filePath: string
  readonly fileName: string
  append(rawEvent: string): void
  read(): OpenCodeJsonlReadResult
}

export type OpenCodeJsonlErrorCode =
  | "IDENTITY_REQUIRED"
  | "ROUND_INVALID"
  | "DIRECTORY_REQUIRED"
  | "FILE_EXISTS"
  | "RAW_EVENT_REQUIRED"
  | "INVALID_JSON_LINE"
  | "INVALID_EVENT_ENVELOPE"
  | "IDENTITY_INVALID"
  | "IDENTITY_CONFLICT"

export class OpenCodeJsonlError extends Error {
  readonly code: OpenCodeJsonlErrorCode
  readonly line?: number

  constructor(code: OpenCodeJsonlErrorCode, message: string, line?: number) {
    super(message)
    this.name = "OpenCodeJsonlError"
    this.code = code
    this.line = line
  }
}

export function openCodeJsonlFileName(identity: OpenCodeJsonlIdentity): string {
  const value = validateIdentity(identity)
  return [
    `run-${safeFilenameSegment(value.runId)}`,
    `stage-${safeFilenameSegment(value.stageId)}`,
    `path-${safeFilenameSegment(value.pathId)}`,
    `round-${String(value.round)}`,
    `turn-${safeFilenameSegment(value.turnId)}`,
  ].join("__") + ".jsonl"
}

export function createOpenCodeJsonlFile(input: {
  directory: string
  identity: OpenCodeJsonlIdentity
}): OpenCodeJsonlFile {
  if (typeof input.directory !== "string" || input.directory.length === 0) {
    throw new OpenCodeJsonlError("DIRECTORY_REQUIRED", "JSONL directory must be a non-empty string")
  }
  const fileName = openCodeJsonlFileName(input.identity)
  mkdirSync(input.directory, { recursive: true })
  const filePath = join(input.directory, fileName)

  let descriptor: number
  try {
    descriptor = openSync(filePath, "wx", 0o600)
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new OpenCodeJsonlError("FILE_EXISTS", `JSONL file already exists: ${filePath}`)
    }
    throw error
  }
  closeSync(descriptor)

  return {
    filePath,
    fileName,
    append: (rawEvent) => appendOpenCodeJsonlEvent(filePath, rawEvent),
    read: () => readOpenCodeJsonl(filePath),
  }
}

export function appendOpenCodeJsonlEvent(filePath: string, rawEvent: string): void {
  if (typeof rawEvent !== "string" || rawEvent.length === 0) {
    throw new OpenCodeJsonlError("RAW_EVENT_REQUIRED", "OpenCode JSON event must be a non-empty string")
  }
  const rawLine = rawEvent.replace(/\r?\n$/u, "")
  if (rawLine.length === 0 || /[\r\n]/u.test(rawLine)) {
    throw new OpenCodeJsonlError("INVALID_JSON_LINE", "one append call must contain exactly one JSON event")
  }
  parseEvent(rawLine, 1)

  const descriptor = openSync(filePath, "a")
  try {
    appendFileSync(descriptor, `${rawLine}\n`, "utf8")
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

export function readOpenCodeJsonl(filePath: string): OpenCodeJsonlReadResult {
  const rawLines = readFileSync(filePath, "utf8").split(/\r?\n/u)
  if (rawLines.at(-1) === "") rawLines.pop()

  const events: OpenCodeJsonEventEnvelope[] = []
  const partIds: string[] = []
  const messageIds: string[] = []
  const sessionIds: string[] = []
  const callIds: string[] = []
  const seenPartIds = new Set<string>()
  const seenMessageIds = new Set<string>()
  const seenSessionIds = new Set<string>()
  const seenCallIds = new Set<string>()
  let firstSessionId: string | undefined
  let lastText: string | undefined

  for (let index = 0; index < rawLines.length; index += 1) {
    const lineNumber = index + 1
    const envelope = parseEvent(rawLines[index], lineNumber)
    events.push(envelope)

    for (const container of eventContainers(envelope, lineNumber)) {
      const sessionId = stringField(container, "sessionID", lineNumber)
      const messageId = stringField(container, "messageID", lineNumber)
      const callId = stringField(container, "callID", lineNumber)
      if (sessionId !== undefined) {
        firstSessionId = requireSameSession(firstSessionId, sessionId, lineNumber)
        addUnique(sessionIds, seenSessionIds, sessionId)
      }
      if (messageId !== undefined) addUnique(messageIds, seenMessageIds, messageId)
      if (callId !== undefined) addUnique(callIds, seenCallIds, callId)
    }

    const parts = eventParts(envelope, lineNumber)
    for (const part of parts) {
      const partId = stringField(part, "id", lineNumber)
      const messageId = stringField(part, "messageID", lineNumber)
      const sessionId = stringField(part, "sessionID", lineNumber)
      const callId = stringField(part, "callID", lineNumber)
      if (partId !== undefined) addUnique(partIds, seenPartIds, partId)
      if (messageId !== undefined) addUnique(messageIds, seenMessageIds, messageId)
      if (callId !== undefined) addUnique(callIds, seenCallIds, callId)
      if (sessionId !== undefined) {
        firstSessionId = requireSameSession(firstSessionId, sessionId, lineNumber)
        addUnique(sessionIds, seenSessionIds, sessionId)
      }
    }

    if (envelope.type === "text") {
      const text = textField(envelope, parts, lineNumber)
      if (text !== undefined) lastText = text
    }
  }

  return { events, firstSessionId, lastText, partIds, messageIds, sessionIds, callIds, rawLines }
}

function validateIdentity(identity: OpenCodeJsonlIdentity): OpenCodeJsonlIdentity {
  if (!identity || typeof identity !== "object") {
    throw new OpenCodeJsonlError("IDENTITY_REQUIRED", "JSONL identity is required")
  }
  const runId = requiredIdentity(identity.runId, "runId")
  const stageId = requiredIdentity(identity.stageId, "stageId")
  const pathId = requiredIdentity(identity.pathId, "pathId")
  const turnId = requiredIdentity(identity.turnId, "turnId")
  if (!Number.isSafeInteger(identity.round) || identity.round < 0) {
    throw new OpenCodeJsonlError("ROUND_INVALID", "round must be a non-negative safe integer")
  }
  return { runId, stageId, pathId, round: identity.round, turnId }
}

function requiredIdentity(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new OpenCodeJsonlError("IDENTITY_REQUIRED", `${label} must be a non-empty string`)
  }
  return value
}

function safeFilenameSegment(value: string): string {
  let encoded: string
  try {
    encoded = encodeURIComponent(value).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  } catch (error: unknown) {
    throw new OpenCodeJsonlError("IDENTITY_REQUIRED", `identity cannot be encoded safely: ${errorMessage(error)}`)
  }
  if (encoded === ".") return "%2E"
  if (encoded === "..") return "%2E%2E"
  return encoded
}

function parseEvent(line: string, lineNumber: number): OpenCodeJsonEventEnvelope {
  if (line.trim().length === 0) {
    throw new OpenCodeJsonlError("INVALID_JSON_LINE", `JSONL line ${lineNumber} is empty`, lineNumber)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch (error: unknown) {
    throw new OpenCodeJsonlError(
      "INVALID_JSON_LINE",
      `JSONL line ${lineNumber} is not valid JSON: ${errorMessage(error)}`,
      lineNumber,
    )
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OpenCodeJsonlError("INVALID_EVENT_ENVELOPE", `JSONL line ${lineNumber} is not an event object`, lineNumber)
  }
  return parsed as OpenCodeJsonEventEnvelope
}

function requireSameSession(current: string | undefined, next: string, line: number): string {
  if (current !== undefined && current !== next) {
    throw new OpenCodeJsonlError(
      "IDENTITY_CONFLICT",
      `JSONL line ${line} has sessionID ${JSON.stringify(next)} after ${JSON.stringify(current)}`,
      line,
    )
  }
  return current ?? next
}

function eventContainers(envelope: OpenCodeJsonEventEnvelope, line: number): Record<string, unknown>[] {
  const containers: Record<string, unknown>[] = [envelope]
  const properties = envelope.properties
  if (properties !== undefined) {
    if (properties === null || typeof properties !== "object" || Array.isArray(properties)) {
      throw new OpenCodeJsonlError("INVALID_EVENT_ENVELOPE", `JSONL line ${line} has invalid properties`, line)
    }
    containers.push(properties as Record<string, unknown>)
  }
  return containers
}

function eventParts(envelope: OpenCodeJsonEventEnvelope, line: number): Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = []
  for (const container of eventContainers(envelope, line)) {
    const part = container.part
    if (part !== undefined) {
      if (part === null || typeof part !== "object" || Array.isArray(part)) {
        throw new OpenCodeJsonlError("INVALID_EVENT_ENVELOPE", `JSONL line ${line} has invalid part`, line)
      }
      parts.push(part as Record<string, unknown>)
    }
    const partList = container.parts
    if (partList !== undefined) {
      if (!Array.isArray(partList)) {
        throw new OpenCodeJsonlError("INVALID_EVENT_ENVELOPE", `JSONL line ${line} has invalid parts`, line)
      }
      for (const item of partList) {
        if (item === null || typeof item !== "object" || Array.isArray(item)) {
          throw new OpenCodeJsonlError("INVALID_EVENT_ENVELOPE", `JSONL line ${line} has invalid parts entry`, line)
        }
        parts.push(item as Record<string, unknown>)
      }
    }
  }
  return parts
}

function stringField(container: Record<string, unknown>, name: string, line: number): string | undefined {
  if (!(name in container) || container[name] === undefined) return undefined
  const value = container[name]
  if (typeof value !== "string" || value.length === 0) {
    throw new OpenCodeJsonlError("IDENTITY_INVALID", `JSONL line ${line} has invalid ${name}`, line)
  }
  return value
}

function textField(
  envelope: OpenCodeJsonEventEnvelope,
  parts: readonly Record<string, unknown>[],
  line: number,
): string | undefined {
  for (const part of [...parts].reverse()) {
    if (!Object.prototype.hasOwnProperty.call(part, "text")) continue
    if (typeof part.text !== "string") {
      throw new OpenCodeJsonlError("INVALID_EVENT_ENVELOPE", `JSONL line ${line} has invalid text`, line)
    }
    return part.text
  }
  if (!Object.prototype.hasOwnProperty.call(envelope, "text")) return undefined
  if (typeof envelope.text !== "string") {
    throw new OpenCodeJsonlError("INVALID_EVENT_ENVELOPE", `JSONL line ${line} has invalid text`, line)
  }
  return envelope.text
}

function addUnique(values: string[], seen: Set<string>, value: string): void {
  if (seen.has(value)) return
  seen.add(value)
  values.push(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
