// Batch 1 of DESIGN-OPUS-2026-10-26, commit 5 (no model, read only): the debt slice replayed on recorded runs.
// For each run, round by round from R2: the verification state at the round's start (rounds before it; open items those
// of the last round's final list), the budget (the reviewer's line less this round's A and B, as the delivery package
// gives them; at most 8 paragraphs), the slice chosen with the last replayed round's rotation and cuts.
// (i)   (i)-class commands (ic-vs-control-cases: A cases failing at first delivery, their op named by no review item):
//       the share whose command has a paragraph in the slice within 2 rounds of the residual appearing.
// (ii)  sentences both in the slice and under an open item: the count (0 by construction, checked).
// (iii) a debt sentence's entry to its first send: the rounds, max and distribution; sentences never sent by the end.
// Old runs have no COVERED lines, so nothing leaves the debt through the slice here: this replays the queue, not its effect.
// Usage (opus1 worktree, after `npm run build`): node exp2/evidence/opus-b1-2026-10-26/slice-replay.mjs <out.md> <runs dir> <dev dist/exp2 dir> <dev worktree>
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const V = await import(D + "verification.js")
const S = await import(D + "slice.js")
const W = await import(D + "view.js")
const L = await import(D + "delivery.js")
const [OUT, RUNS, DEV, DEVTREE] = process.argv.slice(2)
const DevStore = (await import(pathToFileURL(join(DEV, "store.js")).href)).Exp2Store
const DevView = await import(pathToFileURL(join(DEV, "view.js")).href)
// A and B of the delivery package: this branch's package; on a dev-line registry (no edge list) the dev line's package's
// this-round paragraphs, and the earlier text of the units its revised paragraphs name (class B, as this branch gives it).
const aAndB = (run, r) => {
  if (run.via === "this branch") return W.roundPackage(run.reg, r, [], { delivery: true }).segments.filter(s => s.why === "this round" || s.why === "revised").reduce((n, s) => n + (s.parts?.length ? s.parts.reduce((m, p) => m + run.reg.block(p).text.trim().length, 0) : s.text.length), 0)
  const pkg = DevView.roundPackage(run.reg, r, [])
  const a = pkg.segments.filter(s => s.why === "this round").reduce((n, s) => n + s.text.length, 0)
  const parts = [...new Set(pkg.segments.filter(s => s.why === "revised").flatMap(s => [...s.text.matchAll(/^earlier text of (S+?):/gmu)].map(m => m[1])))]
  return a + parts.reduce((n, p) => n + (run.reg.block(p)?.text.trim().length ?? 0), 0)
}
const { kindOf, readCases, opOf } = await import(pathToFileURL(join(DEVTREE, "exp2/evidence/prereg/ledger.mjs")).href)
const costRows = JSON.parse(readFileSync(join(DEVTREE, "exp2/evidence/rep1o-2026-10-25/revert-cost.json"), "utf8"))
const ctrlDirs = ["exp2-review15-luna56-low-revmed-rep1-dpipe-20261022", "exp2-review15-luna56-low-revmed-rep2-dpipe-20261022"]
const ctrlEnd = (d, r) => { const dir = join(RUNS, d, "official", `round-${String(r).padStart(2, "0")}`); const sub = existsSync(dir) ? readdirSync(dir) : []; return sub.length === 1 ? readCases(join(dir, sub[0], "verifier.log")) : null }

const load = name => {
  const dir = join(RUNS, `exp2-icacc-r6-luna56-low-${name}`)
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const tmp = mkdtempSync(join(tmpdir(), "b1s-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
  let reg, via = "this branch"
  try { reg = new Exp2Store(join(tmp, "state"), s.run_id).registry() } catch { reg = new DevStore(join(tmp, "state"), s.run_id).registry(); via = "the dev line" }
  return { name, dir, s, reg, via }
}
const upTo = (s, r) => ({ guards: s.guards.filter(g => g.round <= r), guardEvents: s.guard_events.filter(e => e.round <= r), library: s.checks.filter(k => k.round <= r), checkEvents: s.check_events.filter(e => e.round <= r) })
const openAt = (s, r) => {
  const e = s.executions.find(x => x.round === r)
  const items = new Map(s.executions.flatMap(x => x.review_items ?? []).map(i => [i.id, i]))
  return (e?.final ?? []).map(f => ({ id: f.id, units: s.guards.find(g => g.id === f.id)?.units ?? items.get(f.id)?.check?.blocks ?? items.get(f.id)?.units ?? [] }))
}
// The (i)-class A cases at a round's end (cases.mjs's definition), with their op.
const iCases = (run, r) => {
  const e = run.s.executions.find(x => x.round === r)
  const scores = readFileSync(join(run.dir, "checkpoints", "scores.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l))
  const fin = scores.find(x => x.round === r && !x.kind), first = scores.find(x => x.round === r && x.kind === "first_delivery")
  if (!e || !fin) return null
  const log = c => join(run.dir, "official", `round-0${r}`, c.commit.slice(0, 12), "verifier.log")
  const ic = readCases(log(fin)), icFirst = first ? readCases(log(first)) : new Map(), ctrl = ctrlDirs.map(c => ctrlEnd(c, r))
  if (ctrl.some(x => !x)) return null
  const fails = (m, id) => m.has(id) && !m.get(id).ok, passes = (m, id) => m.has(id) && m.get(id).ok
  const kind = kindOf(e, r, run.name.split("-")[0], costRows)
  return [...ic.keys()].filter(id => fails(ic, id) && ctrl.every(m => passes(m, id)) && fails(icFirst, id) && kind(ic.get(id)) === "i").map(id => ({ id, op: opOf(ic.get(id).ref) }))
}
const objectOf = (reg, op) => [...reg.objects.values()].filter(o => new RegExp(`^${op}\\b`, "iu").test(o.name)).map(o => o.id)

const md = ["# Batch 1, commit 5: the debt slice replayed on recorded runs", "",
  "Budget per round: the reviewer's line (round text × 2 + 10k) less A and B of the delivery package, at most 8 paragraphs. Old runs have no COVERED lines: nothing leaves the debt through the slice here, so this replays the queue and the rotation, not their effect.", ""]
const data = {}
for (const name of ["rep1n-20261025", "rep1p-20261026", "rep1q-20261026"]) {
  const run = load(name)
  const rounds = [...new Set(run.s.executions.map(e => e.round))].sort((a, b) => a - b)
  const entered = new Map(), firstSent = new Map(), sliceBy = new Map()
  let last, both = 0
  md.push(`## ${name.split("-")[0]}${run.via === "the dev line" ? " (registry by the dev line's code)" : ""}`, "", "| round | debt sentences / paragraphs at start | line | A + B | budget D | sent | cut | sent characters | rotation |", "|---|---|---|---|---|---|---|---|---|")
  for (const r of rounds) {
    const open = openAt(run.s, r - 1)
    const states = V.verificationStates(run.reg, r - 1, { ...upTo(run.s, r - 1), open })
    for (const st of states) if (st.debt && !entered.has(st.id)) entered.set(st.id, r)
    if (r === 1) continue
    const line = L.deliveryLine(run.s.sources.find(x => x.round === r).text.length)
    const ab = aAndB(run, r)
    const slice = S.chooseSlice(run.reg, r, states, last ? { last } : {}, { chars: line - ab })
    last = slice
    sliceBy.set(r, slice)
    const openSentences = new Set(states.filter(s => s.open).map(s => s.id))
    both += slice.sent.flatMap(x => x.sentences).filter(id => openSentences.has(id)).length
    for (const x of slice.sent) for (const id of x.sentences) if (!firstSent.has(id)) firstSent.set(id, r)
    md.push(`| R${r} | ${slice.debt.sentences} / ${slice.debt.paragraphs} | ${line.toLocaleString("en-US")} | ${ab.toLocaleString("en-US")} | ${slice.budget.chars.toLocaleString("en-US")} | ${slice.sent.length} | ${slice.cut.length} | ${slice.sent.reduce((n, x) => n + x.chars, 0).toLocaleString("en-US")} | ${slice.rotation.length}/${slice.debt.paragraphs} |`)
  }
  // (i): residual at round r → a paragraph of its command's object in the slice at r+1 or r+2.
  const iRows = []
  for (const r of rounds) {
    const cs = iCases(run, r)
    if (!cs) continue
    for (const op of [...new Set(cs.map(c => c.op))]) {
      const objs = objectOf(run.reg, op)
      const hit = [r + 1, r + 2].find(k => (sliceBy.get(k)?.sent ?? []).some(x => objs.includes(x.object)))
      iRows.push({ r, op, cases: cs.filter(c => c.op === op).length, objects: objs, hit: hit ?? null, in_run: [r + 1, r + 2].some(k => rounds.includes(k)) })
    }
  }
  const judged = iRows.filter(x => x.in_run && x.objects.length)
  // (iii): entry → first send.
  const waits = [...entered].filter(([id]) => firstSent.has(id)).map(([id, r]) => firstSent.get(id) - r)
  const never = [...entered].filter(([id]) => !firstSent.has(id)).length
  const dist = {}; for (const w of waits) dist[w] = (dist[w] ?? 0) + 1
  md.push("", `(i) (i)-class commands with a paragraph in the slice within 2 rounds: ${judged.filter(x => x.hit).length}/${judged.length}${judged.length ? ` (${Math.round(100 * judged.filter(x => x.hit).length / judged.length)}%)` : ""}; not judged (no round after it, or no object by that name): ${iRows.length - judged.length}.`,
    ...iRows.map(x => `  - R${x.r} ${x.op} (${x.cases} cases; objects ${x.objects.join(", ") || "none"}): ${x.hit ? `in the slice at R${x.hit}` : x.in_run ? "not in the slice within 2 rounds" : "no round after it"}`),
    `(ii) sentences in the slice and under an open item: ${both}.`,
    `(iii) entry to first send: sent ${waits.length}, never sent by the end ${never} (of ${entered.size} that entered the debt); rounds waited: ${Object.entries(dist).map(([w, n]) => `${w} → ${n}`).join(", ") || "none"}; max ${waits.length ? Math.max(...waits) : "—"}; within 3 rounds ${waits.filter(w => w <= 3).length}.`, "")
  data[name] = { iRows, both, waits: dist, never, entered: entered.size }
}
md.push("<!-- data: " + JSON.stringify(data) + " -->")
writeFileSync(OUT, md.join("\n") + "\n", "utf8")
console.log(md.slice(0, -1).join("\n"))
