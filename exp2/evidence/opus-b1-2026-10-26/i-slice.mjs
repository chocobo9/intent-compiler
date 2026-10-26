// Account 4 after opusb3 (no model, read only; case names, origin_step and requirement_ref only): the (i) cases of
// R3–R6 (A against both control runs, failing at first delivery and at the end, op named by no review item; s13.mjs)
// against the debt slice. Per round: what the slice carried (why, round of origin, characters against its budget);
// for the objects of each (i) op (objects whose name holds the op), their behaviour sentences at the round's start
// by verification state (held / failing / unverified), in debt, under an open item, and whether the slice reached them.
// Usage (opus1 worktree, after `npm run build`): node exp2/evidence/opus-b1-2026-10-26/i-slice.mjs <run dir> <runs dir> <dev worktree>
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const B = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(B + "store.js")
const V = await import(B + "verification.js")
const [D, RUNS, DEV] = process.argv.slice(2)
const { kindOf, readCases, opOf } = await import(pathToFileURL(join(DEV, "exp2/evidence/prereg/ledger.mjs")).href)
const costRows = JSON.parse(readFileSync(join(DEV, "exp2/evidence/rep1o-2026-10-25/revert-cost.json"), "utf8"))
const s = JSON.parse(readFileSync(join(D, "state", "exp2-state.json"), "utf8"))
const tmp = mkdtempSync(join(tmpdir(), "isl-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry()
const lines = f => existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : []
const scores = lines(join(D, "checkpoints", "scores.jsonl"))
const report = r => JSON.parse(readFileSync(join(D, "checkpoints", `round-0${r}`, "report.json"), "utf8"))
const ctrlDirs = ["exp2-review15-luna56-low-revmed-rep1-dpipe-20261022", "exp2-review15-luna56-low-revmed-rep2-dpipe-20261022"]
const ctrlEnd = (d, r) => { const dir = join(RUNS, d, "official", `round-${String(r).padStart(2, "0")}`); const sub = existsSync(dir) ? readdirSync(dir) : []; return sub.length === 1 ? readCases(join(dir, sub[0], "verifier.log")) : null }
const icLog = (r, kind) => { const sc = scores.find(x => x.round === r && (kind ? x.kind === kind : !x.kind)); return readCases(join(D, "official", `round-0${r}`, sc.commit.slice(0, 12), "verifier.log")) }
const upTo = r => ({ guards: s.guards.filter(g => g.round <= r), guardEvents: s.guard_events.filter(e => e.round <= r), library: s.checks.filter(k => k.round <= r), checkEvents: s.check_events.filter(e => e.round <= r) })
const items = new Map(s.executions.flatMap(x => x.review_items ?? []).map(i => [i.id, i]))
const openAt = r => (s.executions.find(x => x.round === r)?.final ?? []).map(f => ({ id: f.id, units: s.guards.find(g => g.id === f.id)?.units ?? items.get(f.id)?.check?.blocks ?? items.get(f.id)?.units ?? [] }))
const declared = V.declarations(reg, s.executions)
const statesAt = r => V.verificationStates(reg, r, { ...upTo(r), open: openAt(r), declared })
const objName = id => reg.objects.get(id)?.name ?? id
const md = ["# (i) cases against the debt slice, opusb3", ""]
md.push("## The slice per round", "", "| round | paragraphs sent | why | origin rounds | characters / budget | debt at the start (sentences / paragraphs) |", "|---|---|---|---|---|---|")
for (const r of [1, 2, 3, 4, 5, 6]) {
  const sl = report(r).slice ?? { sent: [], budget: {} }, v = report(r - 1 > 0 ? r - 1 : 1).verification
  const why = {}, orig = {}; let chars = 0
  for (const p of sl.sent) { why[p.why] = (why[p.why] ?? 0) + 1; const o = p.paragraph.split(".")[0]; orig[o] = (orig[o] ?? 0) + 1; chars += p.chars }
  md.push(`| R${r} | ${sl.sent.length} | ${Object.entries(why).map(([k, n]) => `${k} ${n}`).join(", ") || "—"} | ${Object.entries(orig).map(([k, n]) => `${k} ${n}`).join(", ") || "—"} | ${chars} / ${sl.budget?.chars ?? "—"} | ${r > 1 ? `${v.debt.sentences} / ${v.debt.paragraphs}` : "—"} |`)
}
md.push("", "## Objects of the (i) ops at the round's start", "", "| round | op | (i) cases | objects | behaviour sentences | held | failing | unverified | in debt | under an open item | in this round's slice |", "|---|---|---|---|---|---|---|---|---|---|---|")
const totals = {}
for (const r of [3, 4, 5, 6]) {
  const e = s.executions.find(x => x.round === r), ic = icLog(r), first = icLog(r, "first_delivery"), ctrl = ctrlDirs.map(c => ctrlEnd(c, r))
  const kind = kindOf(e, r, "opusb3", costRows)
  const iCases = [...ic.keys()].filter(id => !ic.get(id).ok && ctrl.every(m => m?.get(id)?.ok) && first.has(id) && !first.get(id).ok && kind(ic.get(id)) === "i")
  const byOp = {}; for (const id of iCases) { const op = opOf(ic.get(id).ref); (byOp[op] ??= []).push(id) }
  const st = statesAt(r - 1).filter(x => !x.not_behaviour)
  const sliced = new Set((report(r).slice?.sent ?? []).map(p => p.paragraph))
  for (const [op, ids] of Object.entries(byOp).sort((a, b) => b[1].length - a[1].length)) {
    const word = op === "rename-drop" ? /\b(rename|drop)\b/u : new RegExp(String.raw`\b${op}\b`, "u")
    const objs = [...reg.objects.keys()].filter(o => word.test(objName(o)))
    const xs = st.filter(x => objs.includes(x.object))
    const c = k => xs.filter(x => x.state === k).length
    const row = { held: c("held"), failing: c("failing"), unverified: c("unverified"), debt: xs.filter(x => x.debt).length, open: xs.filter(x => x.open).length, sliced: new Set(xs.filter(x => sliced.has(x.paragraph)).map(x => x.paragraph)).size }
    const t = totals[r] ??= { cases: 0, held: 0, failing: 0, unverified: 0, debt: 0, sliced: 0 }
    t.cases += ids.length; for (const k of ["held", "failing", "unverified", "debt", "sliced"]) t[k] += row[k]
    md.push(`| R${r} | ${op} | ${ids.length} | ${objs.map(o => `${o} ${objName(o)}`).join("; ") || "none by name"} | ${xs.length} | ${row.held} | ${row.failing} | ${row.unverified} | ${row.debt} | ${row.open} | ${row.sliced} paragraphs |`)
  }
}
md.push("", "Totals by round: " + Object.entries(totals).map(([r, t]) => `R${r} ${t.cases} cases; their objects' sentences held ${t.held}, failing ${t.failing}, unverified ${t.unverified}, in debt ${t.debt}; paragraphs sliced ${t.sliced}`).join(". ") + ".")
writeFileSync(join(D, "i-slice.md"), md.join("\n") + "\n", "utf8")
console.log(md.join("\n"))
