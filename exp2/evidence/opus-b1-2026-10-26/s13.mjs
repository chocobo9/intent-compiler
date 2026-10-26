// DESIGN-OPUS section 13 on a run (no model, read only; case names, origin_step and requirement_ref only): each line
// with its value and 过 / 不过 / 只报, the per-round tables the design session asked for, and the contamination check.
//   (i): A cases (failing in the run and passing in both control runs at the round's end) that also failed at the
//     first delivery and whose op no review item of the round names (ledger.mjs's kindOf), per round R3-R6; line <= 4.
//   R5 / R6 official; original text per recipient and round (the report's delivery) against the line; non-executor
//   cost over six rounds (the measures' non_executor_cost) <= 3.90M; wall <= 248 min; whole-cycle reverts = 0.
//   COVERED (only reported): the share of this round's behaviour sentences bound by a snapshot guard, two runs again
//   alike (guards over guards + unstable), sentences a line, reviewer tokens. Debt per round, slice paragraphs.
//   Snapshot guards per round: their flips (regressions on unchanged text) and the A cases failing at the round's end
//   on a requirement_ref whose op is that guard's recipe op or command, with whether the guard was sent back to the
//   executor; held items per round and what became of them by the round's end.
// Usage (opus1 worktree): node exp2/evidence/opus-b1-2026-10-26/s13.mjs <run dir> <runs dir> <dev worktree>   (writes <run dir>/prereg-s13.md)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const [D, RUNS, DEV] = process.argv.slice(2)
const { kindOf, readCases, opOf } = await import(pathToFileURL(join(DEV, "exp2/evidence/prereg/ledger.mjs")).href)
const costRows = JSON.parse(readFileSync(join(DEV, "exp2/evidence/rep1o-2026-10-25/revert-cost.json"), "utf8"))
const s = JSON.parse(readFileSync(join(D, "state", "exp2-state.json"), "utf8"))
const lines = f => existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : []
const scores = lines(join(D, "checkpoints", "scores.jsonl")), measures = lines(join(D, "checkpoints", "measures.jsonl"))
const report = r => JSON.parse(readFileSync(join(D, "checkpoints", `round-0${r}`, "report.json"), "utf8"))
const ctrlDirs = ["exp2-review15-luna56-low-revmed-rep1-dpipe-20261022", "exp2-review15-luna56-low-revmed-rep2-dpipe-20261022"]
const ctrlEnd = (d, r) => { const dir = join(RUNS, d, "official", `round-${String(r).padStart(2, "0")}`); const sub = existsSync(dir) ? readdirSync(dir) : []; return sub.length === 1 ? readCases(join(dir, sub[0], "verifier.log")) : null }
const icLog = (r, kind) => { const sc = scores.find(x => x.round === r && (kind ? x.kind === kind : !x.kind)); return sc ? readCases(join(D, "official", `round-0${r}`, sc.commit.slice(0, 12), "verifier.log")) : new Map() }
const fails = (m, id) => m.has(id) && !m.get(id).ok, passes = (m, id) => m.has(id) && m.get(id).ok
const pass = b => b ? "过" : "不过"
const R = [1, 2, 3, 4, 5, 6]
const A = {}, iByRound = {}
for (const r of R) {
  const e = s.executions.find(x => x.round === r), ic = icLog(r), first = icLog(r, "first_delivery"), ctrl = ctrlDirs.map(c => ctrlEnd(c, r))
  if (!e || ctrl.some(x => !x)) continue
  const a = [...ic.keys()].filter(id => fails(ic, id) && ctrl.every(m => passes(m, id)))
  const kind = kindOf(e, r, "opusb3", costRows)
  A[r] = a.map(id => ({ id, ref: ic.get(id).ref, op: opOf(ic.get(id).ref), first: fails(first, id) }))
  iByRound[r] = A[r].filter(c => c.first && kind(ic.get(c.id)) === "i")
}
const md = [`# DESIGN-OPUS section 13 on ${D.split(/[\\/]/u).pop()}`, ""]
md.push("| line | value | |", "|---|---|---|")
const iLine = [3, 4, 5, 6].map(r => `R${r} ${iByRound[r]?.length ?? "—"}`)
const iOk = [3, 4, 5, 6].every(r => (iByRound[r]?.length ?? 99) <= 4)
md.push(`| R3–R6 (i) a round (A: against both control runs) <= 4 | ${iLine.join(", ")} | ${pass(iOk)} |`)
const sc = r => scores.find(x => x.round === r && !x.kind)?.passed
md.push(`| R5 >= 656, R6 >= 688 | R5 ${sc(5)}, R6 ${sc(6)} | ${pass(sc(5) >= 656 && sc(6) >= 688)} |`)
const deliv = R.map(r => { const d = report(r).delivery; return { r, line: d.line, ex: d.recipients.executor, rv: d.recipients.reviewer } })
const overOther = deliv.filter(d => d.ex.over_line === "other" || d.rv.over_line === "other")
md.push(`| executor and reviewer original text a round <= round text x 2 + 10k (A+B over: sent, marked) | ${deliv.map(d => `R${d.r} ${(d.ex.total / 1000).toFixed(1)}k/${(d.rv.total / 1000).toFixed(1)}k of ${(d.line / 1000).toFixed(1)}k`).join("; ")} | ${pass(!overOther.length)}${deliv.some(d => d.ex.over_line === "A+B" || d.rv.over_line === "A+B") ? " (A+B over marked)" : ""} |`)
const cost = measures.reduce((n, m) => n + (m.non_executor_cost ?? 0), 0)
md.push(`| non-executor tokens over six rounds <= 3.90M (uncached + 0.1 x cache read + output) | ${(cost / 1e6).toFixed(2)}M | ${pass(cost <= 3.9e6)} |`)
const wall = measures.reduce((n, m) => n + m.wall_ms, 0) / 60000
md.push(`| wall over six rounds <= 248 min | ${wall.toFixed(0)} min | ${pass(wall <= 248)} |`)
const reverted = s.executions.reduce((n, e) => n + (e.accept?.reverted ?? 0), 0)
md.push(`| whole-cycle reverts = 0 | ${reverted} | ${pass(reverted === 0)} |`)
// COVERED, only reported.
const cov = R.map(r => { const c = report(r).covered ?? {}; const e = s.executions.find(x => x.round === r); const own = (e.slice ? null : null); return { r, c, rev: report(r).review?.reviewer?.tokens } })
md.push(`| COVERED (only reported): guards / sentences bound / a line / unstable / conflicts, by round | ${cov.map(x => `R${x.r} ${x.c.guards ?? 0}/${x.c.bound ?? 0}/${x.c.per_line ?? "—"}/${x.c.unstable ?? 0}/${x.c.conflicts ?? 0}`).join("; ")} | 只报（预先记为不过：冻结错误输出） |`)
md.push(`| debt (only reported): entered / cleared / left, slice paragraphs | ${R.map(r => { const v = report(r).verification, sl = report(r).slice; return `R${r} +${v.delta?.entered ?? "—"}/−${v.delta?.cleared ?? "—"}/${v.debt.sentences} (${sl?.sent?.length ?? 0})` }).join("; ")} | 只报 |`)
md.push("")
// Snapshot guards per round, and the losses on their ops.
md.push("## Snapshot guards: flips (regressions on unchanged text) and A cases on their op at the round's end", "", "| round | snapshot flips | sent back to the executor | ops | A cases failing at the end on those ops |", "|---|---|---|---|---|")
const recipeOps = g => { try { const rf = (g.input?.files ?? []).find(f => /\.json$/u.test(f.path)); const ops = rf ? JSON.parse(rf.content).map(x => x.op) : []; return [...new Set([g.input?.args?.[0], ...ops].filter(Boolean))] } catch { return [g.input?.args?.[0]].filter(Boolean) } }
let snapLoss = 0
for (const r of R) {
  const e = s.executions.find(x => x.round === r)
  const flips = (e.accept?.guards?.flips ?? []).filter(f => f.how === "regression").map(f => s.guards.find(g => g.id === f.id)).filter(g => g?.snapshot)
  const sent = new Set(e.cycles.flatMap(c => (c.items ?? []).filter(i => i.action === "send").map(i => i.id)))
  const ops = [...new Set(flips.flatMap(recipeOps).filter(o => o !== "transform"))]
  const hit = (A[r] ?? []).filter(c => ops.includes(c.op) || ops.includes(c.ref))
  snapLoss += hit.length
  md.push(`| R${r} | ${flips.length}${flips.length ? ` (${flips.map(g => g.id).join(", ")})` : ""} | ${flips.filter(g => sent.has(g.id)).length} | ${ops.join(", ") || "—"} | ${hit.length}${hit.length ? ` (${[...new Set(hit.map(c => c.ref))].join(", ")})` : ""} |`)
}
md.push("")
// Held items: per round, how many were held, and at the end of the round fixed or still open.
md.push("## Items held (no progress) and their end", "", "| round | held (distinct items) | of them passing at the round's end | still open at the end | guards among the held |", "|---|---|---|---|---|")
for (const r of R) {
  const e = s.executions.find(x => x.round === r)
  const held = [...new Set(e.cycles.flatMap(c => (c.items ?? []).filter(i => i.action === "hold").map(i => i.id)))]
  const open = new Set((e.final ?? []).map(f => f.id))
  md.push(`| R${r} | ${held.length} | ${held.filter(h => !open.has(h)).length} | ${held.filter(h => open.has(h)).length} | ${held.filter(h => h.startsWith("G")).length} |`)
}
md.push("")
// (i) cases by round, listed.
md.push("## (i) cases (A, failing at first delivery and at the end, op named by no review item)", "")
for (const r of [3, 4, 5, 6]) md.push(`- R${r}: ${(iByRound[r] ?? []).map(c => `${c.id} ${c.ref}`).join("; ") || "none"}`)
md.push("", "## Verdict", "")
const failed = [!iOk && "(i)", !(sc(5) >= 656 && sc(6) >= 688) && "R5/R6", overOther.length && "original text", cost > 3.9e6 && "tokens", wall > 248 && "wall", reverted && "reverts"].filter(Boolean)
md.push(`Lines failing: ${failed.join(", ") || "none"}. COVERED: pre-recorded as 不过 (frozen wrong output). A cases on ops of flipped snapshot guards, summed over rounds: ${snapLoss}. Whether a failing line's loss falls on regressions the snapshot guards pulled back (then 未证明 under the contamination rule) is in the case accounts.`)
writeFileSync(join(D, "prereg-s13.md"), md.join("\n") + "\n", "utf8")
console.log(md.join("\n"))
