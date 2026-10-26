// Batch 1 of DESIGN-OPUS-2026-10-26, commit 6 (no model, read only): the review-end rule on rep1j3 R5 and R6.
// rep1j3's R5 and R6 each had one review and then stopped reviewing (R5: an empty list; R6: one entry, nothing sent),
// with 18 cases failing at the end. For each round: the scope the rule would give (the round's behaviour sentences,
// and the slice replayed from R2 as slice-replay.mjs chooses it), what of it a passing guard held when the round's
// reviews ended (the recorded guards up to that round), and so whether a further review would follow (reviews < 3 and
// scope owed) and what would be the round's gaps if none covered more. This shows only that the reviews would not end
// early; what a further review would find or cover is the model's, not replayable.
// Usage (opus1 worktree, after `npm run build`): node exp2/evidence/opus-b1-2026-10-26/end-rule-replay.mjs <out.md> <runs dir>
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const V = await import(D + "verification.js")
const S = await import(D + "slice.js")
const W = await import(D + "view.js")
const L = await import(D + "delivery.js")
const C = await import(D + "covered.js")
const G = await import(D + "guards.js")
const [OUT, RUNS] = process.argv.slice(2)
const dir = join(RUNS, "exp2-icacc-r6-luna56-low-rep1j3-20261026")
const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
const tmp = mkdtempSync(join(tmpdir(), "b1e-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry()
const upTo = r => ({ guards: s.guards.filter(g => g.round <= r), guardEvents: s.guard_events.filter(e => e.round <= r), library: s.checks.filter(k => k.round <= r), checkEvents: s.check_events.filter(e => e.round <= r) })
const openAt = r => {
  const e = s.executions.find(x => x.round === r)
  const items = new Map(s.executions.flatMap(x => x.review_items ?? []).map(i => [i.id, i]))
  return (e?.final ?? []).map(f => ({ id: f.id, units: s.guards.find(g => g.id === f.id)?.units ?? items.get(f.id)?.check?.blocks ?? items.get(f.id)?.units ?? [] }))
}
const md = ["# Batch 1, commit 6: the review-end rule on rep1j3 R5 and R6", "",
  "Scope: the round's behaviour sentences and the replayed slice's debt sentences. Owed: no passing guard (recorded, up to the round's end) names it or a clause of it, and no open item at the round's end covers it. rep1j3 had no COVERED lines, so its reviews covered nothing; the rule's decision is what follows.", "",
  "| round | reviews recorded | scope (round / slice) | held at the end | owed | under the rule |", "|---|---|---|---|---|---|"]
let last
const detail = []
for (const r of [2, 3, 4, 5, 6]) {
  const states = V.verificationStates(reg, r - 1, { ...upTo(r - 1), open: openAt(r - 1) })
  const pkg = W.roundPackage(reg, r, [], { delivery: true })
  const ab = pkg.segments.filter(x => x.why === "this round" || x.why === "revised").reduce((n, x) => n + (x.parts?.length ? x.parts.reduce((m, p) => m + reg.block(p).text.trim().length, 0) : x.text.length), 0)
  const slice = S.chooseSlice(reg, r, states, last ? { last } : {}, { chars: L.deliveryLine(s.sources.find(x => x.round === r).text.length) - ab })
  last = slice
  if (r < 5) continue
  const own = V.sentencesInForce(reg, r).filter(x => x.round === r && !V.ruleNotBehaviour(reg, x)).map(x => x.id)
  const scope = [...own, ...slice.sent.flatMap(x => x.sentences)]
  const end = upTo(r), status = G.guardStatuses(end.guardEvents)
  const owed = C.uncoveredScope(reg, scope, end.guards.filter(g => status.get(g.id) !== "retired"), status, openAt(r).flatMap(o => o.units))
  const reviews = (s.executions.find(x => x.round === r)?.accept?.reviews ?? []).length
  md.push(`| R${r} | ${reviews} | ${scope.length} (${own.length} / ${scope.length - own.length}) | ${scope.length - owed.length} | ${owed.length} | ${reviews < 3 && owed.length ? `another review follows (${reviews} < 3); without COVERED lines, ${3 - reviews} more, then ${owed.length} gaps head R${r + 1}'s slice` : "reviews end"} |`)
  detail.push(`## R${r}: the owed scope sentences, by paragraph`, "", ...idsBy(owed), "")
}
function idsBy(ids) { const by = new Map(); for (const id of ids) { const at = id.lastIndexOf("."); const p = id.slice(0, at); by.set(p, [...(by.get(p) ?? []), id.slice(at + 1)]) } return [...by].map(([p, x]) => `- ${p}: ${x.join(", ")}`) }
md.push("", ...detail)
writeFileSync(OUT, md.join("\n") + "\n", "utf8")
console.log(md.slice(0, 8 + 2).join("\n"))
