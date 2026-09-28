import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import {
  createWorkspaceSnapshot,
  WorkspaceSnapshotError,
  type WorkspaceSnapshot,
} from "../src/adapters/workspace-snapshot.js"

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "workspace-snapshot-"))
  temporaryDirectories.push(directory)
  return directory
}

test.after(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function writeText(path: string, text: string): void {
  mkdirSync(resolve(path, ".."), { recursive: true })
  writeFileSync(path, text, "utf8")
}

function expectCode(action: () => unknown, code: WorkspaceSnapshotError["code"]): void {
  assert.throws(
    action,
    (error: unknown) => error instanceof WorkspaceSnapshotError && error.code === code,
  )
}

function entry(snapshot: WorkspaceSnapshot, path: string): Record<string, unknown> {
  const found = snapshot.manifest.entries.find((item) => item.path === path)
  assert.ok(found, `missing manifest entry ${path}`)
  return found as unknown as Record<string, unknown>
}

test("creates a sorted path-only manifest with file hashes and empty directories", () => {
  const workspace = temporaryDirectory()
  mkdirSync(join(workspace, "empty"), { recursive: true })
  writeText(join(workspace, "src", "z.txt"), "z")
  writeText(join(workspace, "src", "a.txt"), "a")
  writeText(join(workspace, "src", "excluded.txt"), "excluded")
  writeText(join(workspace, "ignored.txt"), "ignored")

  const snapshot = createWorkspaceSnapshot({
    workspaceDir: workspace,
    include: ["src", "empty"],
    exclude: ["src/excluded.txt"],
  })
  assert.match(snapshot.snapshotId, /^[0-9a-f]{64}$/u)
  assert.equal(JSON.stringify(snapshot).includes(workspace), false)
  assert.deepEqual(snapshot.manifest.include, ["empty", "src"])
  assert.deepEqual(snapshot.manifest.exclude, ["src/excluded.txt"])
  assert.deepEqual(
    snapshot.manifest.entries.map((item) => item.path),
    ["empty", "src", "src/a.txt", "src/z.txt"],
  )
  assert.deepEqual(entry(snapshot, "empty"), { path: "empty", type: "dir" })
  assert.deepEqual(entry(snapshot, "src/a.txt"), {
    path: "src/a.txt",
    type: "file",
    size: 1,
    sha256: createHash("sha256").update("a", "utf8").digest("hex"),
  })
})

test("uses one stable identity regardless of include order or workspace location", () => {
  const firstWorkspace = temporaryDirectory()
  const secondWorkspace = temporaryDirectory()
  for (const workspace of [firstWorkspace, secondWorkspace]) {
    mkdirSync(join(workspace, "one"), { recursive: true })
    writeText(join(workspace, "one", "file.txt"), "same")
    mkdirSync(join(workspace, "two"), { recursive: true })
  }

  const first = createWorkspaceSnapshot({
    workspaceDir: firstWorkspace,
    include: ["two", "one"],
    exclude: [],
  })
  const second = createWorkspaceSnapshot({
    workspaceDir: secondWorkspace,
    include: ["one", "two"],
    exclude: [],
  })
  assert.equal(first.snapshotId, second.snapshotId)
  assert.deepEqual(first.manifest, second.manifest)
})

test("included changes affect identity while excluded changes do not", () => {
  const workspace = temporaryDirectory()
  writeText(join(workspace, "included.txt"), "before")
  writeText(join(workspace, "excluded.txt"), "before")

  const before = createWorkspaceSnapshot({
    workspaceDir: workspace,
    include: ["."],
    exclude: ["excluded.txt"],
  })
  writeText(join(workspace, "excluded.txt"), "after but excluded")
  const afterExcludedChange = createWorkspaceSnapshot({
    workspaceDir: workspace,
    include: ["."],
    exclude: ["excluded.txt"],
  })
  assert.equal(afterExcludedChange.snapshotId, before.snapshotId)

  writeText(join(workspace, "included.txt"), "after and included")
  const afterIncludedChange = createWorkspaceSnapshot({
    workspaceDir: workspace,
    include: ["."],
    exclude: ["excluded.txt"],
  })
  assert.notEqual(afterIncludedChange.snapshotId, before.snapshotId)
})

test("requires an absolute workspace and explicit include and exclude lists", () => {
  const workspace = temporaryDirectory()
  writeText(join(workspace, "file.txt"), "content")
  expectCode(
    () => createWorkspaceSnapshot({ include: ["file.txt"], exclude: [] } as never),
    "WORKSPACE_REQUIRED",
  )
  expectCode(
    () => createWorkspaceSnapshot({ workspaceDir: workspace, exclude: [] } as never),
    "INCLUDE_REQUIRED",
  )
  expectCode(
    () => createWorkspaceSnapshot({ workspaceDir: workspace, include: ["file.txt"] } as never),
    "EXCLUDE_REQUIRED",
  )
  expectCode(
    () => createWorkspaceSnapshot({ workspaceDir: "relative", include: ["file.txt"], exclude: [] }),
    "WORKSPACE_NOT_ABSOLUTE",
  )
  expectCode(
    () => createWorkspaceSnapshot({
      workspaceDir: join(workspace, "missing"),
      include: ["file.txt"],
      exclude: [],
    }),
    "WORKSPACE_NOT_FOUND",
  )
  expectCode(
    () => createWorkspaceSnapshot({ workspaceDir: workspace, include: [], exclude: [] }),
    "INCLUDE_EMPTY",
  )
})

test("rejects unsafe, missing, duplicate, and overlapping paths", () => {
  const workspace = temporaryDirectory()
  mkdirSync(join(workspace, "dir"), { recursive: true })
  writeText(join(workspace, "dir", "file.txt"), "content")
  const base = { workspaceDir: workspace, include: ["dir"], exclude: [] as string[] }

  expectCode(() => createWorkspaceSnapshot({ ...base, include: ["/absolute"] }), "PATH_ABSOLUTE")
  expectCode(() => createWorkspaceSnapshot({ ...base, include: ["../outside"] }), "PATH_TRAVERSAL")
  expectCode(() => createWorkspaceSnapshot({ ...base, include: ["missing"] }), "INCLUDE_NOT_FOUND")
  expectCode(() => createWorkspaceSnapshot({ ...base, include: ["dir", "dir"] }), "INCLUDE_DUPLICATE")
  expectCode(
    () => createWorkspaceSnapshot({ ...base, include: ["dir", "dir/file.txt"] }),
    "INCLUDE_OVERLAP",
  )
  expectCode(
    () => createWorkspaceSnapshot({ ...base, exclude: ["dir/file.txt", "dir"] }),
    "EXCLUDE_OVERLAP",
  )
  expectCode(
    () => createWorkspaceSnapshot({ ...base, include: ["dir/file.txt"], exclude: ["dir"] }),
    "EXCLUDE_COVERS_INCLUDE",
  )
})

test("rejects symbolic links without following them", (t) => {
  const workspace = temporaryDirectory()
  const outside = temporaryDirectory()
  writeText(join(outside, "outside.txt"), "outside")
  const link = join(workspace, "link.txt")
  try {
    symlinkSync(join(outside, "outside.txt"), link)
  } catch {
    t.skip("symbolic links are unavailable in this test environment")
    return
  }
  expectCode(
    () => createWorkspaceSnapshot({ workspaceDir: workspace, include: ["link.txt"], exclude: [] }),
    "SYMLINK_NOT_ALLOWED",
  )
})

test("does not write to the workspace", () => {
  const workspace = temporaryDirectory()
  writeText(join(workspace, "file.txt"), "content")
  const before = readFileSync(join(workspace, "file.txt"), "utf8")
  createWorkspaceSnapshot({ workspaceDir: workspace, include: ["file.txt"], exclude: [] })
  assert.equal(readFileSync(join(workspace, "file.txt"), "utf8"), before)
})
