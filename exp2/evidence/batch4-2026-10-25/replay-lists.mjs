// Batch 4 E4 acceptance 2: the review's lists of each round, rebuilt from what the round had as it started — the
// items it carried in (with "untouched since" where their output had not changed), the earlier library checks
// failing on the baseline (the run's check runs on R{n-1}-final), the review items of earlier rounds — by the new
// code, with no model. Also whether the appendix holds a command's text in force (window, for rep1n R2).
// Usage (dev worktree, after `npm run build`): node exp2/evidence/batch4-2026-10-25/replay-lists.mjs <out.md> <command name> <run dir> [<run dir> …]
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const L = await import(D + "lists.js")
const { reviewAppendix } = await import(D + "review.js")
const { untouchedSince } = await import(D + "serial.js")
const [OUT, watch, ...runs] = process.argv.slice(2)
const out = ["# Review lists by round (batch 4 E4)", "", `Watched command: ${watch}. Patrol: commands with items before and none for ${L.PATROL_QUIET} rounds or more, ${L.PATROL_MAX} a round.`, "",
  "| run | round | open (reasons) | patrol | across commands | global | list chars (patrol text left out) | appendix holds the watched command's text |", "|---|---|---|---|---|---|---|---|"]
for (const dir of runs) {
  const run = basename(dir).replace(/^exp2-icacc-r\d-luna56-low-/u, "").replace(/-\d{8}$/u, "")
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const tmp = mkdtempSync(join(tmpdir(), "lists-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
  const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry()
  const items = new Map(s.executions.flatMap(e => e.review_items ?? []).map(i => [i.id, i]))
  const before = []
  for (const e of [...s.executions].sort((a, b) => a.round - b.round)) {
    const r = e.round
    const facts = [
      ...(e.carried_in ?? []).map(c => { const it = items.get(c.id), g = s.guards.find(x => x.id === c.id); const n = untouchedSince(before, c.id, c.digest); return { id: c.id, kind: "carried", round: it?.round ?? g?.round ?? 0, object: it?.check?.object ?? g?.object ?? null, units: it?.units ?? g?.units ?? [], why: n ? `untouched since R${n}` : "still open from an earlier round" } }),
      ...s.check_runs.filter(x => x.round === r && x.program === `R${r - 1}-final` && x.outcome === "fail").flatMap(x => { const k = s.checks.find(c => c.id === x.check); return k && k.round < r ? [L.checkFact(k, x.failure ? `fails (${x.failure.class}/${x.failure.reason})` : "fails")] : [] }),
    ]
    const lists = L.reviewLists(reg, r, facts, before)
    const appendix = reviewAppendix({ round: r, units: [], guardFailures: [], leads: [], lists })
    const watched = [...lists.open, ...lists.patrol].filter(c => c.name.toLowerCase().includes(watch.toLowerCase()))
    const holds = watched.length ? watched.every(c => c.texts.length && c.texts.every(t => appendix.includes(t.text.trimEnd().slice(0, 200)))) : false
    out.push(`| ${run} | ${r} | ${lists.open.map(c => `${c.name} (${c.reasons.length}: ${c.reasons.map(x => x.split(":")[0]).join(", ")})`).join("; ") || "—"} | ${lists.patrol.map(c => c.name).join(", ") || "—"} | ${lists.cross.map(u => `${u.id} ${u.names.join("+")}`).join("; ") || "—"} | ${lists.global.length} | ${lists.chars}${lists.dropped_text.length ? ` (${lists.dropped_text.join(", ")})` : ""} | ${watched.length ? (holds ? "yes" : "no") : "not listed"} |`)
    before.push(e)
  }
}
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
console.log(out.join("\n"))
