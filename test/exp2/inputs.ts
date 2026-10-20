import { readFileSync } from "node:fs"
import { resolve } from "node:path"

export const ROUNDS = Array.from({ length: 15 }, (_, i) => i + 1)

export function roundText(round: number): string {
  return readFileSync(resolve(process.cwd(), "exp2/inputs/dpipe", `round-${String(round).padStart(2, "0")}.md`), "utf8")
}
