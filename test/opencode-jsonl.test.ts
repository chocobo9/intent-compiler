import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  createOpenCodeJsonlFile,
  openCodeJsonlFileName,
  OpenCodeJsonlError,
  type OpenCodeJsonlIdentity,
} from "../src/adapters/opencode-jsonl.js"

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "opencode-jsonl-"))
  temporaryDirectories.push(directory)
  return directory
}

test.after(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function identity(overrides: Partial<OpenCodeJsonlIdentity> = {}): OpenCodeJsonlIdentity {
  return {
    runId: "run-1",
    stageId: "coding/main",
    pathId: "path:one",
    round: 1,
    turnId: "turn-1",
    ...overrides,
  }
}

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof OpenCodeJsonlError && error.code === code)
}

test("filename is stable, unique by turn identity, and path-safe", () => {
  const first = openCodeJsonlFileName(identity())
  const second = openCodeJsonlFileName(identity())
  const differentPath = openCodeJsonlFileName(identity({ pathId: "path:two" }))
  const differentRound = openCodeJsonlFileName(identity({ round: 2 }))

  assert.equal(first, second)
  assert.notEqual(first, differentPath)
  assert.notEqual(first, differentRound)
  assert.match(first, /^run-run-1__stage-coding%2Fmain__path-path%3Aone__round-1__turn-turn-1\.jsonl$/u)
  assert.doesNotMatch(first, /[\\/:*?"<>|]/u)
})

test("exclusive creation and raw line append preserve every event", () => {
  const directory = temporaryDirectory()
  const record = createOpenCodeJsonlFile({ directory, identity: identity() })
  const first = JSON.stringify({
    type: "step_start",
    sessionID: "session-1",
    part: { id: "part-1", messageID: "message-1", sessionID: "session-1" },
  })
  const second = JSON.stringify({
    type: "text",
    sessionID: "session-1",
    part: { id: "part-2", messageID: "message-2", sessionID: "session-1", text: "first" },
  })
  const third = JSON.stringify({
    type: "text",
    sessionID: "session-1",
    part: { id: "part-3", messageID: "message-2", sessionID: "session-1", callID: "call-1", text: "done" },
  })

  record.append(first)
  record.append(`${second}\r\n`)
  record.append(third)

  assert.equal(readFileSync(record.filePath, "utf8"), `${first}\n${second}\n${third}\n`)
  const read = record.read()
  assert.equal(read.events.length, 3)
  assert.equal(read.events[0]?.type, "step_start")
  assert.equal(read.firstSessionId, "session-1")
  assert.equal(read.lastText, "done")
  assert.deepEqual(read.partIds, ["part-1", "part-2", "part-3"])
  assert.deepEqual(read.messageIds, ["message-1", "message-2"])
  assert.deepEqual(read.sessionIds, ["session-1"])
  assert.deepEqual(read.callIds, ["call-1"])
})

test("duplicate creation never overwrites the existing stream", () => {
  const directory = temporaryDirectory()
  const first = createOpenCodeJsonlFile({ directory, identity: identity() })
  first.append('{"type":"text","sessionID":"session-1","part":{"text":"keep"}}')
  const before = readFileSync(first.filePath, "utf8")

  expectCode(() => createOpenCodeJsonlFile({ directory, identity: identity() }), "FILE_EXISTS")
  assert.equal(readFileSync(first.filePath, "utf8"), before)
})

test("parallel identities each receive a distinct real file", async () => {
  const directory = temporaryDirectory()
  const identities = [
    identity({ stageId: "stage-a", pathId: "path-a", round: 1, turnId: "turn-a" }),
    identity({ stageId: "stage-a", pathId: "path-b", round: 1, turnId: "turn-b" }),
    identity({ stageId: "stage-b", pathId: "path-a", round: 2, turnId: "turn-c" }),
    identity({ stageId: "stage-b", pathId: "path-b", round: 2, turnId: "turn-d" }),
  ]
  const records = await Promise.all(
    identities.map(async (item) => createOpenCodeJsonlFile({ directory, identity: item })),
  )
  assert.equal(new Set(records.map((item) => item.filePath)).size, identities.length)
  for (const record of records) assert.equal(readFileSync(record.filePath, "utf8"), "")

  const sameIdentity = identity({ stageId: "parallel", pathId: "same", turnId: "same" })
  const outcomes = await Promise.allSettled(
    Array.from({ length: 4 }, async () => createOpenCodeJsonlFile({ directory, identity: sameIdentity })),
  )
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1)
  assert.equal(
    outcomes.filter(
      (item): item is PromiseRejectedResult => item.status === "rejected" && item.reason instanceof OpenCodeJsonlError && item.reason.code === "FILE_EXISTS",
    ).length,
    3,
  )
})

test("invalid JSON lines fail explicitly instead of being skipped", () => {
  const directory = temporaryDirectory()
  const record = createOpenCodeJsonlFile({ directory, identity: identity() })
  writeFileSync(record.filePath, '{"type":"text"}\nnot-json\n', "utf8")
  assert.throws(
    () => record.read(),
    (error: unknown) => error instanceof OpenCodeJsonlError && error.code === "INVALID_JSON_LINE" && error.line === 2,
  )
})

test("append rejects invalid or multiple events before changing the file", () => {
  const directory = temporaryDirectory()
  const record = createOpenCodeJsonlFile({ directory, identity: identity() })

  expectCode(() => record.append("not-json"), "INVALID_JSON_LINE")
  expectCode(() => record.append('{"type":"one"}\n{"type":"two"}'), "INVALID_JSON_LINE")
  assert.equal(readFileSync(record.filePath, "utf8"), "")
})

test("conflicting session identity fails explicitly", () => {
  const directory = temporaryDirectory()
  const record = createOpenCodeJsonlFile({ directory, identity: identity() })
  record.append('{"type":"step_start","sessionID":"session-1"}')
  record.append('{"type":"text","sessionID":"session-2","part":{"text":"wrong session"}}')
  assert.throws(
    () => record.read(),
    (error: unknown) => error instanceof OpenCodeJsonlError && error.code === "IDENTITY_CONFLICT" && error.line === 2,
  )
})
