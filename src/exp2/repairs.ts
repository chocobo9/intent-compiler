/**
 * What a round does with an item it sent for repair (DESIGN-DEEP §4.1, §4.2). After each cycle the code judges the
 * item by its check, never by the executor's words: fixed when the check passes; untouched when its output on that
 * call is the same as when it was sent (the program did not change there); touched when the output changed and the
 * check still fails; reverted when the cycle's change was taken back. Then:
 * - untouched is not stopped: it goes in a message of its own, apart from the other items, once a round after its
 *   first send; still untouched after that resend, it is carried into the next round;
 * - touched in two cycles in a row without a fix is stopped and goes to the reviewer with its check;
 * - a second revert of the same item sends the guard that broke and the item to the reviewer together;
 * - the executor answers each item of the untouched message done / not done / disagree; the answer only routes:
 *   disagree, or done while the check still fails, goes to the reviewer.
 * An item with the reviewer is held until the reviewer answers; one the reviewer upheld is held for the rest of the
 * round (it is carried into the next). `quiet`: items the ledger lists only (touched over rounds without a fix).
 */

export type Outcome = "fixed" | "touched" | "untouched" | "reverted"
export type Answer = "done" | "not done" | "disagree"
export type Channel = "repair" | "untouched"
export type RulingWhy = "touched_twice" | "reverted_twice" | "disagree" | "done_failing"

export interface RepairPlan {
  action: "send" | "hold"
  /** Which message a send goes in: the repair list, or the message of untouched items. */
  channel?: Channel
  why?: string
  /** The item goes to the reviewer (the question channel), and why. */
  ruling?: RulingWhy
}

interface ItemState {
  /** The output's digest when it was last sent. */
  sentAt: string
  /** Sends this round (a carried item's work message counts; a resend after a revert does not). */
  sends: number
  /** Resends in the untouched message this round. */
  untouchedSends: number
  /** Cycles in a row it came back touched. */
  touched: number
  reverts: number
  answer?: Answer
  /** With the reviewer (asked or to be asked), or upheld by the reviewer: held for the rest of the round. */
  ruling?: RulingWhy
  upheld?: boolean
}

/** Resends of an untouched item a round in the untouched message (after its first send): one. */
export const UNTOUCHED_RESENDS = 1
/** Cycles in a row an item may come back touched before it goes to the reviewer. */
export const TOUCHED_CYCLES = 2

const RULING_WHY: Record<RulingWhy, string> = {
  touched_twice: "touched in two cycles in a row, not fixed: to the reviewer with its check",
  reverted_twice: "a repair of it was reverted twice: the guard that broke and the item go to the reviewer together",
  disagree: "the executor disagrees: to the reviewer with its check",
  done_failing: "the executor answered done and the check still fails: to the reviewer with its check",
}

export class Repairs {
  private readonly items = new Map<string, ItemState>()
  /** carried: items the work order sends (their digest on the baseline: that send is the round's first). */
  constructor(carried: ReadonlyMap<string, string> = new Map(), private readonly quiet: ReadonlySet<string> = new Set()) {
    for (const [id, d] of carried) this.items.set(id, { sentAt: d, sends: 1, untouchedSends: 0, touched: 0, reverts: 0 })
  }

  /** The item's outcome on a cycle that kept its change, against the output it was sent at; null when never sent. */
  outcome(id: string, digest: string, pass: boolean): Outcome | null {
    const s = this.items.get(id)
    if (!s) return null
    return pass ? "fixed" : digest === s.sentAt ? "untouched" : "touched"
  }

  /** The executor's answer on an item of the untouched message; it routes the next sighting only. */
  answer(id: string, a: Answer): void { const s = this.items.get(id); if (s) s.answer = a }

  /** The reviewer's word on an item it was asked about: upheld (held for the round) or superseded (it ends). */
  ruled(id: string, upheld: boolean): void { const s = this.items.get(id); if (!s) return; s.upheld = upheld; if (!upheld) s.ruling = undefined }

  /** Items waiting for the reviewer, and why. */
  questions(): { id: string; why: RulingWhy }[] {
    return [...this.items].filter(([, s]) => s.ruling && !s.upheld).map(([id, s]) => ({ id, why: s.ruling! }))
  }

  /** What to do with a failing item seen on a cycle that kept its change. Nothing is recorded until `mark`. */
  plan(id: string, digest: string): RepairPlan {
    if (this.quiet.has(id)) return { action: "hold", why: "listed only: touched over rounds without a fix" }
    const s = this.items.get(id)
    if (!s) return { action: "send", channel: "repair" }
    if (s.upheld) return { action: "hold", why: "the reviewer upheld it: carried into the next round" }
    if (s.ruling) return { action: "hold", why: RULING_WHY[s.ruling] }
    const outcome = digest === s.sentAt ? "untouched" : "touched"
    if (s.answer === "disagree") return { action: "hold", why: RULING_WHY.disagree, ruling: "disagree" }
    if (s.answer === "done") return { action: "hold", why: RULING_WHY.done_failing, ruling: "done_failing" }
    if (outcome === "touched") {
      if (s.touched + 1 >= TOUCHED_CYCLES) return { action: "hold", why: RULING_WHY.touched_twice, ruling: "touched_twice" }
      return { action: "send", channel: "repair" }
    }
    if (s.untouchedSends >= UNTOUCHED_RESENDS) return { action: "hold", why: "untouched after its resend in the untouched message: carried into the next round" }
    return { action: "send", channel: "untouched" }
  }

  /**
   * Records what was done with an item seen on a cycle. On a cycle whose change was reverted (`reverted`) the outcome
   * counts for nothing and the resend is not one of the round's sends.
   */
  mark(id: string, digest: string, plan: RepairPlan, reverted = false): void {
    const s = this.items.get(id)
    if (s && !reverted) { s.touched = digest !== s.sentAt ? s.touched + 1 : 0; s.answer = undefined }
    if (plan.ruling) { if (s) s.ruling = plan.ruling; else this.items.set(id, { sentAt: digest, sends: 0, untouchedSends: 0, touched: 0, reverts: 0, ruling: plan.ruling }) }
    if (plan.action !== "send") return
    if (!s) { this.items.set(id, { sentAt: digest, sends: 1, untouchedSends: 0, touched: 0, reverts: 0 }); return }
    s.sentAt = digest
    if (!reverted) { s.sends++; if (plan.channel === "untouched") s.untouchedSends++ }
  }

  /**
   * A repair the item was sent for was reverted (its outcome is reverted: no untouched, no touched count). The first
   * time it goes once more at the output it was sent at; the second time it goes to the reviewer with the guard.
   */
  reverted(id: string): RepairPlan {
    const s = this.items.get(id)
    if (!s) return { action: "send", channel: "repair" }
    s.reverts++
    s.answer = undefined
    if (s.reverts >= 2) { s.ruling = "reverted_twice"; return { action: "hold", why: RULING_WHY.reverted_twice, ruling: "reverted_twice" } }
    return { action: "send", channel: "repair", why: "the repair was reverted: sent again" }
  }
}

/** The executor's answers to the untouched message: `<n>. done`, `<n>. not done: …`, `<n>. disagree: …`, by item number. */
export function answersIn(reply: string): Map<number, Answer> {
  const out = new Map<number, Answer>()
  for (const m of reply.matchAll(/^\s*[-*]?\s*\**(\d+)[.):]\**\s*\**\s*(done|not done|disagree)\b/gimu)) {
    const n = Number(m[1])
    if (!out.has(n)) out.set(n, m[2].toLowerCase() as Answer)
  }
  return out
}

export const UNTOUCHED_INTRO = "These items were sent to you before, and on each one the program's output for its check has not changed since. Each comes with its check: the command, the input files, what the program outputs now, and what is expected. Fix them; the requirements are the authority."
export const UNTOUCHED_ANSWER = "Answer every item by its number, each on a line of its own: `<n>. done` when you changed the program so that the check passes, `<n>. not done: <why>` when you did not, or `<n>. disagree: <why>` when you think the expected output is not what the requirements say."

/** The message of untouched items: the intro, the items numbered, the instruction to answer each, then any notes. */
export function untouchedMessage(items: readonly { text: string }[], notes: readonly string[] = []): string {
  return [UNTOUCHED_INTRO, items.map((it, n) => `${n + 1}. ${it.text.trim()}`).join("\n\n"), UNTOUCHED_ANSWER, ...notes].join("\n\n")
}
