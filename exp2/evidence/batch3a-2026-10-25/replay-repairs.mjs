// Batch 3a acceptance: the repair loop's new decisions (src/exp2/repairs.ts, DESIGN-DEEP §4.2) replayed on the
// sightings four real runs recorded, cycle by cycle, against what those runs decided. No model, no program run: the
// outputs are the recorded ones, so this replays decisions only. What the executor would have done with the new
// messages is not known offline; fixed counts are the recorded ones (a consistency check, not evidence).
// Usage (dev worktree, after `npm run build`): node exp2/evidence/batch3a-2026-10-25/replay-repairs.mjs <out dir> <run dir> [<run dir> …]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"

const { Repairs } = await import(pathToFileURL(join(process.cwd(), "dist/exp2/repairs.js")).href)
const [OUT, ...runs] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const failing = v => v === "wrong" || v === "not_landed"
const noProgress = why => /no progress/u.test(why ?? "")
const rows = [], decisions = []
for (const dir of runs) {
  const run = basename(dir).replace(/^exp2-icacc-r\d-luna56-low-/u, "").replace(/-\d{8}$/u, "")
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  for (const e of [...s.executions].sort((a, b) => a.round - b.round)) {
    const r = new Repairs(new Map((e.carried_in ?? []).map(c => [c.id, c.digest])))
    const row = { run, round: e.round, sightings: 0, old_held_no_progress: 0, old_held_no_progress_untouched: 0, new_untouched_messages: 0, new_untouched_items: 0, new_held_after_resend: 0, new_held_no_progress: 0, new_rulings: {}, old_fixed: 0, new_fixed: 0, reverted: 0, items_held_no_progress_untouched: new Set(), items_into_untouched: new Set() }
    for (const c of e.cycles) {
      if (c.build?.ok === false) continue
      const resent = new Set(c.reverted ? c.reverted.resent ?? c.reverted.discarded ?? [] : [])
      let untouchedHere = 0
      for (const i of c.items ?? []) {
        if (i.action === "blocked" || i.verdict === "blocked" || i.verdict === "unverified" || i.verdict === "malformed") continue
        row.sightings++
        if (resent.has(i.id)) {
          // A sighting the run made for an item whose repair was reverted: the new rule's revert decision.
          row.reverted++
          const p = r.reverted(i.id)
          r.mark(i.id, i.digest, p, true)
          if (p.ruling) row.new_rulings[p.ruling] = (row.new_rulings[p.ruling] ?? 0) + 1
          decisions.push({ run, round: e.round, cycle: c.id, id: i.id, old: `${i.action}${i.why ? ` (${i.why})` : ""}`, outcome: "reverted", new: `${p.action}${p.channel ? `/${p.channel}` : ""}${p.ruling ? ` → reviewer (${p.ruling})` : ""}` })
          continue
        }
        const outcome = r.outcome(i.id, i.digest, i.verdict === "pass")
        if (i.verdict === "pass") { if (outcome === "fixed") { row.old_fixed++; row.new_fixed++ } continue }
        if (!failing(i.verdict)) continue
        const p = r.plan(i.id, i.digest)
        r.mark(i.id, i.digest, p)
        if (i.action === "hold" && noProgress(i.why)) { row.old_held_no_progress++; if (outcome === "untouched") { row.old_held_no_progress_untouched++; row.items_held_no_progress_untouched.add(i.id) } }
        if (p.action === "send" && p.channel === "untouched") { untouchedHere++; row.items_into_untouched.add(i.id) }
        if (p.action === "hold" && /untouched after its resend/u.test(p.why ?? "")) row.new_held_after_resend++
        if (p.action === "hold" && noProgress(p.why)) row.new_held_no_progress++
        if (p.ruling) row.new_rulings[p.ruling] = (row.new_rulings[p.ruling] ?? 0) + 1
        decisions.push({ run, round: e.round, cycle: c.id, id: i.id, old: `${i.action}${i.why ? ` (${i.why})` : ""}`, outcome, new: `${p.action}${p.channel ? `/${p.channel}` : ""}${p.ruling ? ` → reviewer (${p.ruling})` : ""}${p.why && p.action === "hold" ? ` (${p.why})` : ""}` })
      }
      if (untouchedHere) { row.new_untouched_messages++; row.new_untouched_items += untouchedHere }
    }
    row.untouched_held_items = row.items_held_no_progress_untouched.size
    row.untouched_held_into_message = [...row.items_held_no_progress_untouched].filter(id => row.items_into_untouched.has(id)).length
    delete row.items_held_no_progress_untouched; delete row.items_into_untouched
    rows.push(row)
  }
}
const sum = k => rows.reduce((n, r) => n + r[k], 0)
const rul = rows.reduce((m, r) => { for (const [k, v] of Object.entries(r.new_rulings)) m[k] = (m[k] ?? 0) + v; return m }, {})
const lines = ["# Repair decisions replayed (batch 3a)", "", "The new rule on the sightings the runs recorded (decisions only; see the script's header).", "",
  "| run | round | sightings | old: held for no progress (of them untouched) | items held so (untouched) | of them in an untouched message under the new rule | new: untouched messages (items) | new: held after the resend | new: held for no progress | new: to the reviewer | reverted sightings | fixed (old = new) |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map(r => `| ${r.run} | ${r.round} | ${r.sightings} | ${r.old_held_no_progress} (${r.old_held_no_progress_untouched}) | ${r.untouched_held_items} | ${r.untouched_held_into_message} | ${r.new_untouched_messages} (${r.new_untouched_items}) | ${r.new_held_after_resend} | ${r.new_held_no_progress} | ${Object.entries(r.new_rulings).map(([k, v]) => `${k} ${v}`).join(", ") || "0"} | ${r.reverted} | ${r.old_fixed} = ${r.new_fixed} |`),
  `| all | — | ${sum("sightings")} | ${sum("old_held_no_progress")} (${sum("old_held_no_progress_untouched")}) | ${sum("untouched_held_items")} | ${sum("untouched_held_into_message")} | ${sum("new_untouched_messages")} (${sum("new_untouched_items")}) | ${sum("new_held_after_resend")} | ${sum("new_held_no_progress")} | ${Object.entries(rul).map(([k, v]) => `${k} ${v}`).join(", ") || "0"} | ${sum("reverted")} | ${sum("old_fixed")} = ${sum("new_fixed")} |`]
const j5 = decisions.filter(d => d.run.includes("rep1j") && d.round === 5 && /^V5\.\d\.1$/u.test(d.id))
lines.push("", "rep1j R5, the three sidecar items, decision by decision:", "", "| cycle | item | the run did | outcome | the new rule |", "|---|---|---|---|---|", ...j5.map(d => `| ${d.cycle} | ${d.id} | ${d.old} | ${d.outcome} | ${d.new} |`))
writeFileSync(join(OUT, "repairs.md"), lines.join("\n") + "\n", "utf8")
writeFileSync(join(OUT, "repairs.json"), JSON.stringify({ rows, decisions }, null, 1) + "\n", "utf8")
console.log(lines.join("\n"))
