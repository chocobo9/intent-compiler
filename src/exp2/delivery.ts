import type { Registry } from "./registry.js"

/**
 * The delivery ledger (DESIGN-OPUS-2026-10-26 §0a): one per round. For each recipient, the source blocks given to it
 * this round and their characters, by class. Every message that carries original text (the work order's package and
 * its open items, a repair message's regressions, a review request, a formalizer request) takes that text through
 * here; a block given once is named by its id after that.
 *
 * - A: this round's paragraphs. B: earlier sentences this round revises (their earlier text). C: the original text an
 *   item rests on (an open item's, a regression's). D: the debt slice (the reviewer's only). F: what the formalizer
 *   reads. A and B are never cut; C is cut to ids from the oldest item up when the executor's characters pass the
 *   line; D is cut by the slice (batch 1, effect 5).
 * - The line, per recipient: the round's text × 2 + 10k characters (§0). The formalizer, the attribution and the check
 *   writing are outside it (decision 4): their characters are recorded and flagged when above it.
 */

export type Recipient = "executor" | "reviewer" | "formalizer"
export type DeliveryClass = "A" | "B" | "C" | "D" | "F"

export const deliveryLine = (roundTextChars: number) => roundTextChars * 2 + 10_000

export interface Trimmed { recipient: Recipient; id: string; class: DeliveryClass; chars: number; why: string }

export interface DeliverySummary {
  line: number
  recipients: Record<Recipient, { chars: Record<DeliveryClass, number>; total: number; over_line: "A+B" | "other" | null }>
  trimmed: Trimmed[]
  /** Original-text characters read by the roles outside the line, and whether above it (decision 4). */
  outside: Record<string, { chars: number; above_line: boolean }>
}

const EMPTY = (): Record<DeliveryClass, number> => ({ A: 0, B: 0, C: 0, D: 0, F: 0 })

export class DeliveryLedger {
  private readonly given = new Map<Recipient, Map<string, { cls: DeliveryClass; chars: number }>>()
  readonly trimmed: Trimmed[] = []
  private readonly outside: Record<string, { chars: number; above_line: boolean }> = {}

  constructor(private readonly registry: Registry, readonly round: number, readonly line: number) {}

  private of(r: Recipient) { let m = this.given.get(r); if (!m) this.given.set(r, m = new Map()); return m }

  /** The block, or one holding it, was given to the recipient this round. */
  has(r: Recipient, id: string): boolean {
    const m = this.of(r)
    return this.registry.lineage(id).some(b => m.has(b.id))
  }

  /** Records a block given with `chars` characters of its text (once a block, a recipient, a round). */
  give(r: Recipient, cls: DeliveryClass, id: string, chars: number): void {
    if (this.has(r, id)) return
    this.of(r).set(id, { cls, chars })
  }

  chars(r: Recipient, cls?: DeliveryClass): number {
    let n = 0
    for (const x of this.of(r).values()) if (!cls || x.cls === cls) n += x.chars
    return n
  }

  /** Room left under the line for the recipient. */
  room(r: Recipient): number { return this.line - this.chars(r) }

  /**
   * The text of the units an item rests on, for the recipient: each unit's text once a round (a unit given already, or
   * held in a block given already, by its id); by its id too, recorded as trimmed, when its text would pass the line
   * (or `cut` says so).
   */
  quote(r: Recipient, units: readonly string[], cls: DeliveryClass = "C", cut = false): string[] {
    const out: string[] = []
    for (const u of units) {
      const b = this.registry.block(u)
      if (!b) continue
      const text = b.text.trim()
      if (this.has(r, u)) { out.push(`${u} (given above)`); continue }
      if (cut || this.chars(r) + text.length > this.line) {
        this.trimmed.push({ recipient: r, id: u, class: cls, chars: text.length, why: cut ? "cut to its id, oldest items first, to keep within the line" : "its text would pass the line" })
        out.push(u)
        continue
      }
      this.give(r, cls, u, text.length)
      out.push(JSON.stringify(text))
    }
    return out
  }

  /** A role outside the line read `chars` characters of original text (decision 4). */
  read(role: string, chars: number): void {
    const x = this.outside[role] ?? { chars: 0, above_line: false }
    x.chars += chars
    x.above_line = x.chars > this.line
    this.outside[role] = x
  }

  summary(): DeliverySummary {
    const recipients = {} as DeliverySummary["recipients"]
    for (const r of ["executor", "reviewer", "formalizer"] as const) {
      const chars = EMPTY()
      for (const x of this.of(r).values()) chars[x.cls] += x.chars
      const total = Object.values(chars).reduce((a, b) => a + b, 0)
      const over = r !== "formalizer" && total > this.line ? (chars.A + chars.B > this.line ? "A+B" as const : "other" as const) : null
      recipients[r] = { chars, total, over_line: over }
    }
    return { line: this.line, recipients, trimmed: [...this.trimmed], outside: { ...this.outside } }
  }
}

const k = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

export function renderDelivery(d: DeliverySummary): string {
  const one = (r: Recipient) => {
    const x = d.recipients[r], c = x.chars
    const parts = (Object.keys(c) as DeliveryClass[]).filter(cl => c[cl]).map(cl => `${cl} ${k(c[cl])}`).join(", ") || "none"
    return `${r} ${k(x.total)} (${parts})${x.over_line ? ` over the line (${x.over_line})` : ""}`
  }
  const out = Object.entries(d.outside).map(([role, x]) => `${role} ${k(x.chars)}${x.above_line ? " (above the line)" : ""}`).join(", ")
  const cut = d.trimmed.length ? `; cut to ids ${d.trimmed.length} (${k(d.trimmed.reduce((n, t) => n + t.chars, 0))})` : ""
  return `- Original text delivered: line ${k(d.line)}; ${one("executor")}; ${one("reviewer")}; ${one("formalizer")} (outside the line)${cut}${out ? `; read outside the line: ${out}` : ""}.`
}
