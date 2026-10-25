// The ledger's one definition (independent review, third round, item 3), used by prereg.mjs and by the case-by-case
// comparisons: a case failing at a round's end is put in one kind by what the round's review items and repairs did.
//   (i) its op named by none of the round's review items (recall2.py's rule: the last part of requirement_ref as a word
//   of the items' text; rename-drop by rename or drop); (iii) an item naming it was fixed and lost: on a cycle later
//   reverted (revert-cost.json's lost list) or its guard failing at the round's end; (iv) an item naming it was touched
//   and not fixed; (ii) an item naming it was untouched (outcome.mjs's output rule, its last judged sending of the
//   round); other: named, but no item naming it ended touched or untouched. One kind a case, in the order iii, iv, ii.
import { existsSync, readFileSync } from "node:fs"

/** A verifier log's cases: id → origin round (the build check, origin "base", is 0), requirement_ref, passed. */
export function readCases(log) {
  const out = new Map()
  if (!log || !existsSync(log)) return out
  for (const m of readFileSync(log, "utf8").matchAll(/CASE_RESULT case_id=(\S+) origin_step=(\S+) requirement_ref=(\S+)[^\n]*? status=(\S+)/gu)) out.set(m[1], { id: m[1], origin: m[2] === "base" ? 0 : Number(m[2].replace(/^round-0?/u, "")), ref: m[3], ok: m[4] === "success" })
  return out
}

export const opOf = ref => ref.split(".").at(-1)
export const mentions = (text, op) => new RegExp(`\\b${op.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u").test(text) || (op === "rename-drop" && (text.includes("rename") || text.includes("drop")))

/** Each item's last judged outcome in a round's execution (fixed / touched / untouched), by the output rule. */
export function outcomes(e) {
  const sentAt = new Map((e.carried_in ?? []).map(c => [c.id, c.digest ?? ""])), last = new Map()
  for (const c of e.cycles) for (const it of c.items ?? []) {
    if (it.outcome === "reverted") continue
    if (sentAt.has(it.id) && it.action !== "blocked" && it.verdict !== "unverified") last.set(it.id, it.verdict === "pass" ? "fixed" : it.digest === sentAt.get(it.id) ? "untouched" : "touched")
    if (it.verdict === "pass") sentAt.delete(it.id)
    if (it.action === "send") sentAt.set(it.id, it.digest)
  }
  return last
}

/** The kind of a case failing at the round's end, for one run's round: "i" | "ii" | "iii" | "iv" | "other". */
export function kindOf(e, round, run, costRows) {
  const items = (e.review_items ?? []).filter(i => i.round === round), text = items.map(i => i.text).join(" ").toLowerCase()
  const oc = outcomes(e), finalIds = new Set((e.final ?? []).map(f => f.id))
  const lost = new Set(costRows.filter(r => r.run === run && r.round === round).flatMap(r => r.lost))
  return c => {
    const op = opOf(c.ref)
    if (!mentions(text, op)) return "i"
    const on = items.filter(i => mentions(i.text.toLowerCase(), op))
    if (on.some(i => lost.has(i.id) || (i.guard && finalIds.has(i.guard)))) return "iii"
    if (on.some(i => oc.get(i.id) === "touched")) return "iv"
    if (on.some(i => oc.get(i.id) === "untouched")) return "ii"
    return "other"
  }
}
