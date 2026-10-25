// Batch 4's four pre-registered lines on rep1o (design session, 2026-10-25), and the extra numbers asked: R1 cases
// failing at the end of R2 (line ≤ 1); share of commands delivered for the units across commands (line 100%);
// official score gap per round to rep1j (line ≤ 2) and R3–R6 review request characters against rep1j (line ≥ 30%
// lower); findings on listed commands and how many of them have failing official cases on their requirement_ref
// (case names and requirement_ref only: at the round's first delivery, and failing first and passing at the end).
// Also: still untouched after the untouched message (against 26%), the lists' appendix characters, global coverage.
// Usage: node exp2/evidence/rep1o-2026-10-25/prereg.mjs <out.md> <run dir> <rep1j dir>
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [OUT, dir, base] = process.argv.slice(2)
const lines = f => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l))
const load = d => ({ d, s: JSON.parse(readFileSync(join(d, "state", "exp2-state.json"), "utf8")), scores: lines(join(d, "checkpoints", "scores.jsonl")) })
const o = load(dir), j = load(base)
const score = (r, n, kind) => r.scores.find(x => x.round === n && (kind ? x.kind === kind : !x.kind))
const failing = (r, n, kind) => {
  const sc = score(r, n, kind), log = join(r.d, "official", `round-0${n}`, sc.commit.slice(0, 12), "verifier.log")
  const out = []
  if (existsSync(log)) for (const m of readFileSync(log, "utf8").matchAll(/CASE_RESULT case_id=(\S+) origin_step=round-0?(\d+) requirement_ref=(\S+)[^\n]*? status=fail\b/gu)) out.push({ id: m[1], origin: +m[2], ref: m[3] })
  return out
}
const rep = n => JSON.parse(readFileSync(join(dir, "checkpoints", `round-0${n}`, "report.json"), "utf8"))
const items = new Map(o.s.executions.flatMap(e => e.review_items ?? []).map(i => [i.id, i]))
// The command an item's check runs: the subcommand; for transform, the recipe's first op, as the verifier's refs name it.
const refOf = check => {
  const a = check?.input?.args ?? [], cmd = a[0]
  if (cmd !== "transform") return cmd ?? null
  const ri = a.indexOf("--recipe"), f = ri >= 0 ? check.input.files.find(x => x.path === a[ri + 1]) : null
  try { const op = JSON.parse(f.content)[0].op; return `transform.${op === "unpivot" ? "pivot" : op === "rename" || op === "drop" ? "rename-drop" : op}` } catch { return "transform" }
}
const out = ["# rep1o: batch 4's pre-registered lines", ""]
const rounds = [...o.s.executions].sort((a, b) => a.round - b.round)

const r2 = failing(o, 2).filter(c => c.origin === 1)
out.push(`1. R1 cases failing at the end of R2: ${r2.length} (line ≤ 1; rep1j ${failing(j, 2).filter(c => c.origin === 1).length}). By ref: ${Object.entries(r2.reduce((m, c) => (m[c.ref] = (m[c.ref] ?? 0) + 1, m), {})).map(([k, v]) => `${k} ${v}`).join(", ")}.`)

const cross = rounds.flatMap(e => (rep(e.round).zones?.package?.units?.cross ?? []).map(u => ({ round: e.round, ...u })))
const dl = cross.reduce((a, u) => a + u.delivered.length, 0), inv = cross.reduce((a, u) => a + u.objects.length, 0)
out.push(`2. Units across commands, commands delivered: ${dl}/${inv} (${inv ? Math.round(100 * dl / inv) : "—"}%; line 100%). ${cross.map(u => `R${u.round} ${u.id} ${u.delivered.length}/${u.objects.length}`).join(", ")}.`)

const gaps = rounds.map(e => `R${e.round} ${score(o, e.round).passed - score(j, e.round).passed}`)
const chars = r => r.s.review_calls.filter(c => c.round >= 3).reduce((x, c) => x + (c.request_chars ?? 0), 0)
const co = chars(o), cj = chars(j)
out.push(`3. Official score minus rep1j's, per round: ${gaps.join(", ")} (line ≤ 2 each). R3–R6 review request characters: ${co} against rep1j's ${cj}, ${Math.round(100 * (co - cj) / cj)}% (line −30% or lower).`)

const findings = rounds.flatMap(e => (e.accept?.lists?.findings ?? []).map(id => ({ round: e.round, id })))
const rows = findings.map(f => {
  const it = items.get(f.id), ref = refOf(it?.check)
  const first = failing(o, f.round, "first_delivery").filter(c => c.ref === ref && c.origin < f.round), end = new Set(failing(o, f.round).map(c => c.id))
  return { ...f, ref, first: first.length, saved: first.filter(c => !end.has(c.id)).length, cases: first.map(c => `R${f.round} ${c.id}`), passed: first.filter(c => !end.has(c.id)).map(c => `R${f.round} ${c.id}`) }
})
const distinct = k => new Set(rows.flatMap(r => r[k])).size
out.push(`4. Findings on listed commands: ${rows.length}; with failing official cases on their requirement_ref (earlier rounds' cases) at the round's first delivery: ${rows.filter(r => r.first > 0).length}, on ${new Set(rows.filter(r => r.first > 0).map(r => `R${r.round} ${r.ref}`)).size} round-and-ref pairs; distinct cases ${distinct("cases")}, of them failing first and passing at the round's end ${distinct("passed")}.`)
out.push("", "| round | finding | requirement_ref | earlier-round cases failing at first delivery | of them passing at the end |", "|---|---|---|---|---|", ...rows.map(r => `| R${r.round} | ${r.id} | ${r.ref} | ${r.first} | ${r.saved} |`))

out.push("", "## The extra numbers", "", "| round | still untouched after the untouched message (line 26%) | lists: open / patrol / across / global | appendix chars (cap 15k) | left out | coverage gaps | global units: flag, commands |", "|---|---|---|---|---|---|---|")
let ut = 0, uj = 0
for (const e of rounds) {
  const p = e.accept?.repairs, l = e.accept?.lists
  const after = p?.after_untouched ?? p?.untouched_after ?? null
  const still = after ? after.untouched ?? after.still_untouched ?? 0 : 0, judged = after ? (after.fixed ?? 0) + (after.touched ?? 0) + still : 0
  ut += still; uj += judged
  out.push(`| R${e.round} | ${judged ? `${still}/${judged}` : "—"} | ${l ? `${l.open.length} / ${l.patrol.length} / ${l.cross.length} / ${l.global.length}` : "—"} | ${l?.chars ?? "—"} | ${l?.dropped_text?.length ?? 0} | ${l?.gaps?.length ?? 0} | ${(l?.global_coverage ?? []).map(g => `${g.id} ${g.flag ?? "no flag: undecided"}${g.flag ? `, ${g.commands.length}` : ""}`).join("; ") || "—"} |`)
}
out.push("", `Still untouched after the untouched message, all rounds: ${ut}/${uj}${uj ? ` (${Math.round(100 * ut / uj)}%)` : ""}.`)
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
console.log(out.join("\n"))
