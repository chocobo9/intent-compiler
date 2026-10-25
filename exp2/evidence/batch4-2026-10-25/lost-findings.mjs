// Batch 4 acceptance 5, decision (a): the review items of rep1j whose cited text is neither in the new package nor in
// the lists — what dropping them could cost, in official cases. For each: whether the run sent it and fixed it (its
// guard, or no failing record at round end), and the cases of its requirement_ref (case names and requirement_ref only,
// from the verifier logs of the round's first delivery and of its final commit): failing at first delivery, failing
// at the end. Cases failing first and passing at the end are the most the item's repair could have saved.
// Usage: node exp2/evidence/batch4-2026-10-25/lost-findings.mjs <out.md> <run dir> <item=origin:requirement_ref> …
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [OUT, dir, ...pairs] = process.argv.slice(2)
const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
const scores = readFileSync(join(dir, "checkpoints", "scores.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l))
const items = new Map(s.executions.flatMap(e => e.review_items ?? []).map(i => [i.id, i]))
const failing = (round, commit, origin, ref) => {
  const log = join(dir, "official", `round-0${round}`, commit.slice(0, 12), "verifier.log")
  if (!existsSync(log)) return null
  const out = new Set()
  for (const m of readFileSync(log, "utf8").matchAll(/CASE_RESULT case_id=(\S+) origin_step=(\S+) requirement_ref=(\S+)[^\n]*? status=fail\b/gu)) if (m[2].replace(/^round-0?/u, "R") === origin && m[3] === ref) out.add(m[1])
  return out
}
const out = ["# rep1j review items outside the new package and lists: what dropping them could cost", "", "| item | round | requirement_ref | sent | fixed in the run | its cases failing at first delivery | failing at the end | failing first, passing at the end |", "|---|---|---|---|---|---|---|---|"]
let saved = 0
for (const p of pairs) {
  const [id, spec] = p.split("="), [origin, ref] = spec.split(":")
  const it = items.get(id), r = it.round, e = s.executions.find(x => x.round === r)
  const sent = e.cycles.some(c => (c.items ?? []).some(i => i.id === id && i.action === "send"))
  const fixed = !!it.guard || !(e.final ?? []).some(f => f.id === id)
  const first = scores.find(x => x.round === r && x.kind === "first_delivery"), last = scores.find(x => x.round === r && !x.kind)
  const a = failing(r, first.commit, origin, ref), b = failing(r, last.commit, origin, ref)
  const rescued = a && b ? [...a].filter(c => !b.has(c)) : []
  saved += rescued.length
  out.push(`| ${id} | R${r} | ${origin} ${ref} | ${sent ? "yes" : "no"} (${it.disposition}) | ${fixed ? `yes${it.guard ? ` (${it.guard})` : ""}` : "no"} | ${a?.size ?? "—"} | ${b?.size ?? "—"} | ${rescued.length} |`)
}
out.push("", `Cases failing at first delivery and passing at the end, on these items' requirement_refs: ${saved} (an upper bound: other items and the executor's own work act on the same refs).`)
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
console.log(out.join("\n"))
