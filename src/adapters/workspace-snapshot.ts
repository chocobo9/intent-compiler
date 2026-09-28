import { createHash } from "node:crypto"
import {
  lstatSync,
  readFileSync,
  readdirSync,
  type Dirent,
  type Stats,
} from "node:fs"
import { isAbsolute, join, posix, relative, win32 } from "node:path"

export interface WorkspaceSnapshotInput {
  workspaceDir: string
  include: readonly string[]
  exclude: readonly string[]
}

export interface WorkspaceSnapshotDirectoryEntry {
  readonly path: string
  readonly type: "dir"
}

export interface WorkspaceSnapshotFileEntry {
  readonly path: string
  readonly type: "file"
  readonly size: number
  readonly sha256: string
}

export type WorkspaceSnapshotEntry =
  | WorkspaceSnapshotDirectoryEntry
  | WorkspaceSnapshotFileEntry

export interface WorkspaceSnapshotManifest {
  readonly entries: readonly WorkspaceSnapshotEntry[]
  readonly exclude: readonly string[]
  readonly include: readonly string[]
  readonly version: 1
}

export interface WorkspaceSnapshot {
  readonly snapshotId: string
  readonly manifest: WorkspaceSnapshotManifest
}

export type WorkspaceSnapshotErrorCode =
  | "INPUT_REQUIRED"
  | "WORKSPACE_REQUIRED"
  | "WORKSPACE_NOT_ABSOLUTE"
  | "WORKSPACE_NOT_FOUND"
  | "WORKSPACE_NOT_DIRECTORY"
  | "WORKSPACE_SYMLINK"
  | "WORKSPACE_INSPECTION_FAILED"
  | "INCLUDE_REQUIRED"
  | "INCLUDE_EMPTY"
  | "EXCLUDE_REQUIRED"
  | "PATH_NOT_STRING"
  | "PATH_EMPTY"
  | "PATH_ABSOLUTE"
  | "PATH_TRAVERSAL"
  | "PATH_INVALID"
  | "INCLUDE_DUPLICATE"
  | "EXCLUDE_DUPLICATE"
  | "INCLUDE_OVERLAP"
  | "EXCLUDE_OVERLAP"
  | "EXCLUDE_COVERS_INCLUDE"
  | "INCLUDE_NOT_FOUND"
  | "SYMLINK_NOT_ALLOWED"
  | "ENTRY_UNSUPPORTED"
  | "PATH_INSPECTION_FAILED"
  | "READ_FAILED"

export class WorkspaceSnapshotError extends Error {
  readonly code: WorkspaceSnapshotErrorCode
  readonly path?: string

  constructor(code: WorkspaceSnapshotErrorCode, message: string, path?: string) {
    super(message)
    this.name = "WorkspaceSnapshotError"
    this.code = code
    this.path = path
  }
}

/**
 * Hash the explicitly selected files and directories without writing to the
 * workspace. The host owns the include and exclude policy.
 */
export function createWorkspaceSnapshot(input: WorkspaceSnapshotInput): WorkspaceSnapshot {
  const request = validateInput(input)
  const entries: WorkspaceSnapshotEntry[] = []

  for (const selectedPath of request.include) {
    const absolutePath = workspacePath(request.workspaceDir, selectedPath)
    const stats = inspectPath(absolutePath, "include", selectedPath)
    collectEntry(absolutePath, selectedPath, request.exclude, entries, stats)
  }

  entries.sort((left, right) => comparePath(left.path, right.path))
  const manifest: WorkspaceSnapshotManifest = Object.freeze({
    entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
    exclude: Object.freeze([...request.exclude]),
    include: Object.freeze([...request.include]),
    version: 1,
  })
  return Object.freeze({
    snapshotId: sha256(stableJson(manifest)),
    manifest,
  })
}

function validateInput(input: WorkspaceSnapshotInput): WorkspaceSnapshotInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new WorkspaceSnapshotError("INPUT_REQUIRED", "workspace snapshot input must be an object")
  }
  if (typeof input.workspaceDir !== "string" || input.workspaceDir.length === 0) {
    throw new WorkspaceSnapshotError("WORKSPACE_REQUIRED", "workspaceDir must be a non-empty string")
  }
  if (!isAbsolute(input.workspaceDir)) {
    throw new WorkspaceSnapshotError(
      "WORKSPACE_NOT_ABSOLUTE",
      `workspaceDir must be absolute: ${input.workspaceDir}`,
    )
  }
  validateWorkspaceDirectory(input.workspaceDir)

  if (!Array.isArray(input.include)) {
    throw new WorkspaceSnapshotError("INCLUDE_REQUIRED", "include must be an array of relative paths")
  }
  if (input.include.length === 0) {
    throw new WorkspaceSnapshotError("INCLUDE_EMPTY", "include must contain at least one path")
  }
  if (!Array.isArray(input.exclude)) {
    throw new WorkspaceSnapshotError("EXCLUDE_REQUIRED", "exclude must be an array of relative paths")
  }

  const include = normalizePathList(input.include, "include")
  const exclude = normalizePathList(input.exclude, "exclude")
  validatePathList(include, "include")
  validatePathList(exclude, "exclude")

  for (const excludedPath of exclude) {
    for (const includedPath of include) {
      if (isSameOrDescendant(includedPath, excludedPath)) {
        throw new WorkspaceSnapshotError(
          "EXCLUDE_COVERS_INCLUDE",
          `exclude path covers an include path: ${excludedPath} covers ${includedPath}`,
          excludedPath,
        )
      }
    }
  }

  return {
    workspaceDir: input.workspaceDir,
    include: [...include].sort(comparePath),
    exclude: [...exclude].sort(comparePath),
  }
}

function validateWorkspaceDirectory(workspaceDir: string): void {
  let stats: Stats
  try {
    stats = lstatSync(workspaceDir)
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new WorkspaceSnapshotError(
        "WORKSPACE_NOT_FOUND",
        `workspaceDir does not exist: ${workspaceDir}`,
      )
    }
    throw new WorkspaceSnapshotError(
      "WORKSPACE_INSPECTION_FAILED",
      `workspaceDir cannot be inspected: ${workspaceDir}`,
    )
  }
  if (stats.isSymbolicLink()) {
    throw new WorkspaceSnapshotError(
      "WORKSPACE_SYMLINK",
      `workspaceDir must not be a symbolic link: ${workspaceDir}`,
    )
  }
  if (!stats.isDirectory()) {
    throw new WorkspaceSnapshotError(
      "WORKSPACE_NOT_DIRECTORY",
      `workspaceDir is not a directory: ${workspaceDir}`,
    )
  }
}

function normalizePathList(
  paths: readonly unknown[],
  kind: "include" | "exclude",
): string[] {
  return paths.map((path) => {
    if (typeof path !== "string") {
      throw new WorkspaceSnapshotError("PATH_NOT_STRING", `${kind} paths must be strings`)
    }
    return normalizeRelativePath(path, kind)
  })
}

function normalizeRelativePath(value: string, kind: "include" | "exclude"): string {
  if (value.length === 0) {
    throw new WorkspaceSnapshotError("PATH_EMPTY", `${kind} paths must be non-empty relative paths`)
  }
  if (value.includes("\0")) {
    throw new WorkspaceSnapshotError("PATH_INVALID", `${kind} path contains a NUL byte: ${value}`)
  }
  if (
    isAbsolute(value) ||
    posix.isAbsolute(value) ||
    win32.isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value)
  ) {
    throw new WorkspaceSnapshotError("PATH_ABSOLUTE", `${kind} path must be relative: ${value}`)
  }

  const canonical: string[] = []
  for (const part of value.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") {
      throw new WorkspaceSnapshotError(
        "PATH_TRAVERSAL",
        `${kind} path must not contain '..': ${value}`,
      )
    }
    canonical.push(part)
  }
  return canonical.length === 0 ? "." : canonical.join("/")
}

function validatePathList(paths: readonly string[], kind: "include" | "exclude"): void {
  for (let leftIndex = 0; leftIndex < paths.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < paths.length; rightIndex += 1) {
      const left = paths[leftIndex]!
      const right = paths[rightIndex]!
      if (samePath(left, right)) {
        throw new WorkspaceSnapshotError(
          kind === "include" ? "INCLUDE_DUPLICATE" : "EXCLUDE_DUPLICATE",
          `${kind} paths contain a duplicate: ${right}`,
          right,
        )
      }
      if (isSameOrDescendant(left, right) || isSameOrDescendant(right, left)) {
        throw new WorkspaceSnapshotError(
          kind === "include" ? "INCLUDE_OVERLAP" : "EXCLUDE_OVERLAP",
          `${kind} paths overlap: ${left} and ${right}`,
          right,
        )
      }
    }
  }
}

function workspacePath(workspaceDir: string, selectedPath: string): string {
  const absolutePath = selectedPath === "."
    ? workspaceDir
    : join(workspaceDir, ...selectedPath.split("/"))
  const relativePath = relative(workspaceDir, absolutePath)
  const parentPrefix = process.platform === "win32" ? "..\\" : "../"
  if (relativePath === ".." || relativePath.startsWith(parentPrefix) || isAbsolute(relativePath)) {
    throw new WorkspaceSnapshotError(
      "PATH_TRAVERSAL",
      `path escapes workspace: ${selectedPath}`,
      selectedPath,
    )
  }
  return absolutePath
}

function inspectPath(
  absolutePath: string,
  kind: "include" | "entry",
  selectedPath: string,
): Stats {
  try {
    return lstatSync(absolutePath)
  } catch (error) {
    if (kind === "include" && isNodeError(error) && error.code === "ENOENT") {
      throw new WorkspaceSnapshotError(
        "INCLUDE_NOT_FOUND",
        `include path does not exist: ${selectedPath}`,
        selectedPath,
      )
    }
    throw new WorkspaceSnapshotError(
      "PATH_INSPECTION_FAILED",
      `snapshot path cannot be inspected: ${selectedPath}`,
      selectedPath,
    )
  }
}

function collectEntry(
  absolutePath: string,
  selectedPath: string,
  exclude: readonly string[],
  entries: WorkspaceSnapshotEntry[],
  knownStats: Stats,
): void {
  if (isExcluded(selectedPath, exclude)) return
  if (knownStats.isSymbolicLink()) {
    throw new WorkspaceSnapshotError(
      "SYMLINK_NOT_ALLOWED",
      `snapshot path must not be a symbolic link: ${selectedPath}`,
      selectedPath,
    )
  }

  if (knownStats.isFile()) {
    let bytes: Buffer
    try {
      bytes = readFileSync(absolutePath)
    } catch {
      throw new WorkspaceSnapshotError(
        "READ_FAILED",
        `file cannot be read: ${selectedPath}`,
        selectedPath,
      )
    }
    entries.push({
      path: selectedPath,
      type: "file",
      size: bytes.byteLength,
      sha256: sha256(bytes),
    })
    return
  }

  if (!knownStats.isDirectory()) {
    throw new WorkspaceSnapshotError(
      "ENTRY_UNSUPPORTED",
      `snapshot path is neither a file nor a directory: ${selectedPath}`,
      selectedPath,
    )
  }
  entries.push({ path: selectedPath, type: "dir" })

  let children: Dirent[]
  try {
    children = readdirSync(absolutePath, { withFileTypes: true })
  } catch {
    throw new WorkspaceSnapshotError(
      "READ_FAILED",
      `directory cannot be read: ${selectedPath}`,
      selectedPath,
    )
  }
  children.sort((left, right) => comparePath(left.name, right.name))
  for (const child of children) {
    const childPath = selectedPath === "." ? child.name : `${selectedPath}/${child.name}`
    if (isExcluded(childPath, exclude)) continue
    const childAbsolutePath = join(absolutePath, child.name)
    collectEntry(
      childAbsolutePath,
      childPath,
      exclude,
      entries,
      inspectPath(childAbsolutePath, "entry", childPath),
    )
  }
}

function isExcluded(path: string, exclude: readonly string[]): boolean {
  return exclude.some((excludedPath) => isSameOrDescendant(path, excludedPath))
}

function isSameOrDescendant(candidate: string, parent: string): boolean {
  if (samePath(candidate, parent)) return true
  if (parent === ".") return true
  return pathKey(candidate).startsWith(`${pathKey(parent)}/`)
}

function samePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right)
}

function pathKey(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new WorkspaceSnapshotError("PATH_INVALID", "snapshot manifest is not JSON serializable")
    return encoded
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => comparePath(left, right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
  return `{${entries.join(",")}}`
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex")
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
