// Batch 4 E1b acceptance (the design session's decisions 1 and 2): what changes when object edges give way to change
// units, on the runs' own records, with no model. The registry is rebuilt from each run's accepted answers by the new
// code: their edges are not read, and every cue candidate of their rounds stands as code finds it (their answers name
// no units). Then, against what the run recorded:
// 1. every guard flip, classified again (text changed behind it, or a regression), with the sources;
// 2. checks code marks stale, round by round (the library as it stood at each round's start);
// 3. objects that entered a round's scope through another object's text (an applies_to edge then, a change unit now).
// Usage (dev worktree, after `npm run build`): node exp2/evidence/batch4-2026-10-25/replay-e1b.mjs <out dir> <run dir> [<run dir> …]
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const { changedTextBehind } = await import(D + "guards.js")
const { staleChecks, activeChecks } = await import(D + "checks.js")
const [OUT, ...runs] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const out = ["# Batch 4 E1b: flips, stale checks and scope under change units, against the runs' records", ""]
const flipRows = [], staleRows = [], scopeRows = [], summary = []
for (const dir of runs) {
  const run = basename(dir).replace(/^exp2-icacc-r\d-luna56-low-/u, "").replace(/-\d{8}$/u, "")
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const tmp = mkdtempSync(join(tmpdir(), "e1b-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
  const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry()
  const name = o => reg.objects.get(o)?.name ?? o
  // 1. Flips.
  let flips = 0, same = 0
  for (const e of s.executions) for (const f of e.accept?.guards?.flips ?? []) {
    flips++
    const g = s.guards.find(x => x.id === f.id)
    const behind = changedTextBehind(reg, g, e.round)
    const how = behind.length ? "changed_text" : "regression"
    const sources = [...new Set(behind.map(b => b.source))]
    const retired = (e.accept.guards.retired ?? []).some(r => r.id === f.id)
    if (how === f.how && JSON.stringify(sources) === JSON.stringify(f.sources.filter(x => x !== "edge").concat(f.sources.includes("edge") && how === "changed_text" && !sources.length ? ["?"] : []))) same++
    flipRows.push({ run, round: e.round, guard: f.id, cycle: f.cycle, recorded: `${f.how} (${f.sources.join(", ") || "none"})`, now: `${how} (${sources.join(", ") || "none"})`, retired, differs: how !== f.how, units: behind.filter(b => b.source === "unit").map(b => b.text) })
  }
  // 2. Stale checks, round by round: the library at the round's start, as recorded.
  let staleDiffs = 0
  for (const e of [...s.executions].sort((a, b) => a.round - b.round)) {
    const r = e.round
    const library = s.checks.filter(k => k.round < r)
    const events = s.check_events.filter(v => v.round < r)
    const now = new Set(staleChecks(reg, library, events, r).map(v => v.check))
    const was = new Set(s.check_events.filter(v => v.round === r && v.status === "stale" && v.by === "code").map(v => v.check))
    const more = [...now].filter(k => !was.has(k)), fewer = [...was].filter(k => !now.has(k))
    if (more.length || fewer.length) { staleDiffs++; staleRows.push({ run, round: r, more: more.map(k => `${k} (${staleChecks(reg, library.filter(c => c.id === k), events, r)[0]?.reason ?? ""})`), fewer }) }
  }
  // 3. Scope through another object's text: applies_to targets then, unit targets now.
  let scopeDiffs = 0
  for (const a of s.rounds.filter(x => x.status === "accepted").sort((x, y) => x.round - y.round)) {
    const r = a.round, refs = a.acceptance?.answer?.references ?? []
    const ids = new Map((a.acceptance?.allocated ?? []).map(x => [x.name.toLowerCase(), x.id]))
    const target = to => /^O\d+$/u.test(to) ? to : (reg.coverOf(to)?.owner ?? ids.get(String(to).toLowerCase()))
    const then = new Set(refs.filter(e => e.kind === "applies_to").map(e => target(e.to)).filter(o => o && o !== "none"))
    const nowSet = new Set(reg.roundScope(r).filter(c => c.types.includes("unit")).map(c => c.object))
    // An object the edge put in scope that is in scope now by its own text is no difference.
    const scope = new Set(reg.roundScope(r).map(c => c.object))
    const more = [...nowSet].filter(o => !then.has(o)), fewer = [...then].filter(o => !scope.has(o))
    if (more.length || fewer.length) { scopeDiffs++; scopeRows.push({ run, round: r, more: more.map(o => `${o} ${name(o)} (${reg.roundScope(r).find(c => c.object === o).applied.map(x => x.unit).filter((v, i, l) => l.indexOf(v) === i).join(", ")})`), fewer: fewer.map(o => `${o} ${name(o)}`) }) }
  }
  summary.push({ run, flips, flipsDiffer: flipRows.filter(x => x.run === run && x.differs).length, staleDiffs, scopeDiffs })
}
out.push("| run | flips | classification changed | rounds with stale-check differences | rounds with scope differences |", "|---|---|---|---|---|", ...summary.map(x => `| ${x.run} | ${x.flips} | ${x.flipsDiffer} | ${x.staleDiffs} | ${x.scopeDiffs} |`))
out.push("", "## Flips", "", "| run | round | guard | cycle | recorded | now | retired by the reviewer | units behind it now |", "|---|---|---|---|---|---|---|---|", ...flipRows.map(f => `| ${f.run} | ${f.round} | ${f.guard} | ${f.cycle} | ${f.recorded} | ${f.now}${f.differs ? " **differs**" : ""} | ${f.retired ? "yes" : ""} | ${f.units.join("; ").replace(/\|/gu, "\\|")} |`))
out.push("", "## Stale checks: more or fewer than the run marked", "", "| run | round | stale now, not then | stale then, not now |", "|---|---|---|---|", ...staleRows.map(x => `| ${x.run} | ${x.round} | ${x.more.join("; ").replace(/\|/gu, "\\|") || "—"} | ${x.fewer.join(", ") || "—"} |`))
out.push("", "## Objects in scope through another object's text (edge then, unit now)", "", "| run | round | in scope now through a unit, not through an edge then | through an edge then, out of scope now |", "|---|---|---|---|", ...scopeRows.map(x => `| ${x.run} | ${x.round} | ${x.more.join("; ") || "—"} | ${x.fewer.join("; ") || "—"} |`))
writeFileSync(join(OUT, "replay-e1b.md"), out.join("\n") + "\n", "utf8")
writeFileSync(join(OUT, "replay-e1b.json"), JSON.stringify({ summary, flips: flipRows, stale: staleRows, scope: scopeRows }, null, 1) + "\n", "utf8")
console.log(out.join("\n"))
