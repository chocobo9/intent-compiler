// Step 1 (no model): every send of a repair item whose outcome was untouched (and, for the shares by session length,
// every judged send: fixed, touched or untouched) (the output rule: the item's check gave
// the same output on the cycle it was sent into as when it was sent), in rep1n and rep1p. For each: the run, the round,
// the cycle the item was sent into, the message it went in (the work message, the repair list or the untouched
// message), the executor's session, the commits before and after the cycle (for the diff and the time window of the
// session's messages), the cycle's changed anchors, and the item's text and its command.
// Usage: node exp2/evidence/executor-sessions-2026-10-26/sends.mjs <out.json> <run dir> [<run dir> …]
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"

const [OUT, ...runs] = process.argv.slice(2)
const out = []
for (const dir of runs) {
  const run = basename(dir).replace(/^exp2-icacc-r\d-luna56-low-/u, "").replace(/-\d{8}$/u, "")
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const items = new Map(s.executions.flatMap(e => e.review_items ?? []).map(i => [i.id, i]))
  const time = c => Number(execFileSync("git", ["-C", join(dir, "app"), "log", "-1", "--format=%ct", c], { encoding: "utf8" }).trim()) * 1000
  for (const e of [...s.executions].sort((a, b) => a.round - b.round)) {
    e.cycles.forEach((c, k) => {
      const prev = k ? e.cycles[k - 1] : null
      for (const it of (c.items ?? []).filter(x => x.outcome === "untouched" || x.outcome === "fixed" || x.outcome === "touched")) {
        const sentBy = prev ? (prev.items ?? []).find(x => x.id === it.id && x.action === "send") : null
        // A sighting has an outcome once the item was ever sent; it is a send into this cycle only when the cycle before
        // sent it (or, on the round's first cycle, the work message carried it in). Held items are not sends.
        if (prev ? !sentBy : !(e.carried_in ?? []).some(x => x.id === it.id)) continue
        const via = !prev ? "work message (carried in)" : sentBy?.channel === "untouched" ? "untouched message" : "repair list"
        const rec = items.get(it.id), guard = s.guards.find(g => g.id === it.id)
        const text = rec?.text ?? guard?.origin?.text ?? (guard ? `guard ${guard.id}` : it.id)
        const object = rec?.check?.object ?? guard?.object ?? null
        const base = prev ? prev.commit : e.base
        out.push({
          run, round: e.round, cycle: c.id, prev_cycle: prev?.id ?? null, item: it.id, via, session: c.session,
          base, commit: c.commit, window: [prev ? time(prev.commit) : null, time(c.commit)],
          files: execFileSync("git", ["-C", join(dir, "app"), "diff", "--name-only", base, c.commit], { encoding: "utf8" }).trim().split("\n").filter(Boolean),
          anchors: c.anchors ?? [], object, text,
          answer: c.untouched?.answers?.[it.id] ?? null, untouched_n: c.untouched?.items ? c.untouched.items.indexOf(it.id) + 1 || null : null, outcome: it.outcome,
        })
      }
    })
  }
}
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n", "utf8")
const by = out.reduce((m, x) => (m[`${x.run} ${x.via}`] = (m[`${x.run} ${x.via}`] ?? 0) + 1, m), {})
console.log(out.length, JSON.stringify(by))
