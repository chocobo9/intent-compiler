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
import { dirname, resolve } from "node:path"

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"))
}

export function readJsonIfExists(path: string): unknown {
  return existsSync(path) ? readJson(path) : undefined
}

export function writeJsonAtomic(path: string, value: unknown): void {
  ensureDir(dirname(path))
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  renameSync(temporary, path)
}

export function writeTextAtomic(path: string, value: string): void {
  ensureDir(dirname(path))
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, value, "utf8")
  renameSync(temporary, path)
}

export function appendJsonLineDurable(path: string, value: unknown): void {
  ensureDir(dirname(path))
  const descriptor = openSync(path, "a")
  try {
    appendFileSync(descriptor, `${JSON.stringify(value)}\n`, "utf8")
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

export function requireAbsolute(path: string, name: string): string {
  const absolute = resolve(path)
  if (absolute !== path) throw new Error(`${name} must be an absolute path: ${path}`)
  return absolute
}

export function safeSegment(value: string, name: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`${name} must contain only letters, numbers, dot, underscore, or dash`)
  }
  return value
}
