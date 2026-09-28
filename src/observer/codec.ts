import { createHash, randomUUID } from "node:crypto"

export function sha256(value: unknown): string {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")
  return createHash("sha256").update(bytes).digest("hex")
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

export function artifactBytes(value: unknown, mediaType: string): Buffer {
  if (Buffer.isBuffer(value)) return value
  if (mediaType === "application/json") return Buffer.from(stableJson(value), "utf8")
  return Buffer.from(String(value), "utf8")
}

export function eventId(): string {
  return randomUUID()
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== "object" || value instanceof Date) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue((value as Record<string, unknown>)[key])]),
  )
}
