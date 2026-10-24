// The outcome of every review item sent for repair (DESIGN-DEEP-2026-10-25 §4.1), from the runs' state and git history
// alone: no model, no verifier, no program run. Run in the dev worktree after `npm run build`, Go on PATH:
//   node exp2/evidence/repair-outcome-2026-10-25/outcome.mjs <out dir> <run dir> [<run dir> …]
//
// The rules, as code reads the records:
// - A cycle's `items` are the ledger's sightings on that cycle's program: the item's verdict there (wrong / pass /
//   unverified / blocked) and what the next message does with it (send / hold / none). An item is sent into cycle
//   C(k+1) when C(k) sighted it with action send, and into the round's first cycle when the work message carried it in
//   (`carried_in`). A send on the round's last cycle reaches no cycle and has no outcome.
// - The outcome of a send into cycle C: fixed when C sights the item as pass; else touched when C's diff (`anchors`,
//   the anchors that changed against the cycle before) contains an anchor the item's command maps to; else untouched.
// - The item's command: the object its check names (`check.object`, the owner code gave its units). Its anchors at a
//   cycle: the anchors of the program before and after the cycle (each commit's tree, extracted as the run does) that
//   the mapping links to the object. Two mappings, reported side by side, neither guessed further:
//   strict: nameLinks as the serial calls it (a dispatch anchor whose name is the object's whole name);
//   stem:   the same with the object's name less a trailing "operation" or "command" ("pivot operation" → pivot).
//   An item whose object has no linked anchor under a mapping is unmapped under it: listed and counted apart. Under
//   stem, an object whose name ends in "operation" or "command" names its dispatch even when the program has none:
//   no anchor of that name before or after the cycle means the command was not written, and the item is untouched
//   (counted as absent within untouched). Any other name without a linked anchor stays unmapped.
// - An item sent without a check (verdict unverified, sent in the reviewer's words) has no check that could pass: it is
//   counted apart as no_check.
// - Stopped for no progress: a sighting in the round with action hold and a reason naming no progress.
// - Carried into the next round: the next round's `carried_in` names it.
// - Message size: the number of items the message sent (sends of the cycle before, or carried_in for the work message).
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const { GoAnchorExtractor } = await import(D + "anchors.js")
const { nameLinks } = await import(D + "workorder.js")
const extractor = new GoAnchorExtractor()

const [OUT, ...runs] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const MAPPINGS = ["strict", "stem"]
const NAMES_DISPATCH = /\s+(operation|command)$/iu
const stem = n => n.toLowerCase().replace(NAMES_DISPATCH, "")
const rows = [], events = []
for (const dir of runs) {
  const run = basename(dir).replace(/^exp2-icacc-r\d-luna56-low-/u, "").replace(/-\d{8}$/u, "")
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const tmp = mkdtempSync(join(tmpdir(), "outcome-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
  const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry()
  const cache = new Map()
  const anchorsAt = commit => {
    if (!cache.has(commit)) {
      const wd = join(tmp, "tree"); rmSync(wd, { recursive: true, force: true }); mkdirSync(wd)
      // The commit's tree into wd through an index of our own: the run's repository and its index stay as they are.
      const env = { ...process.env, GIT_INDEX_FILE: join(tmp, "index") }
      execFileSync("git", ["-C", join(dir, "app"), "read-tree", commit], { env })
      execFileSync("git", ["-C", join(dir, "app"), `--work-tree=${wd}`, "checkout-index", "-a", "-f"], { env })
      cache.set(commit, extractor.extract(wd))
    }
    return cache.get(commit)
  }
  const linked = (mapping, anchors, object, round) => mapping === "strict"
    ? nameLinks(reg, anchors, round).filter(l => l.object === object).map(l => l.anchor)
    : anchors.filter(a => a.kind === "dispatch" && reg.objects.get(object) && a.name.toLowerCase() === stem(reg.objects.get(object).name)).map(a => a.id)
  const execs = [...s.executions].sort((a, b) => a.round - b.round)
  const items = new Map(execs.flatMap(e => e.review_items ?? []).map(i => [i.id, i]))
  for (const e of execs) {
    const next = execs.find(x => x.round === e.round + 1)
    const carriedOut = new Set((next?.carried_in ?? []).map(c => c.id))
    const sends = new Map() // id → its sends in the round
    const cycles = e.cycles
    for (let k = 0; k < cycles.length; k++) {
      const c = cycles[k], before = anchorsAt(k === 0 ? e.base : cycles[k - 1].commit), after = anchorsAt(c.commit)
      const into = k === 0 ? (e.carried_in ?? []).map(x => x.id) : (cycles[k - 1].items ?? []).filter(i => i.action === "send").map(i => i.id)
      for (const id of into) {
        const it = items.get(id), seen = (c.items ?? []).find(i => i.id === id)
        const object = it?.check?.object ?? null
        const ev = { run, round: e.round, id, cycle: c.id, size: into.length, reverted: !!c.reverted, verdict: seen?.verdict ?? null }
        for (const m of MAPPINGS) {
          const anchors = object ? [...new Set([...linked(m, before, object, e.round), ...linked(m, after, object, e.round)])] : []
          const absent = !anchors.length && m === "stem" && NAMES_DISPATCH.test(reg.objects.get(object)?.name ?? "")
          ev[m] = !it?.check ? "no_check" : seen?.verdict === "pass" ? "fixed" : absent ? "untouched" : !anchors.length ? "unmapped" : c.anchors.some(a => anchors.includes(a)) ? "touched" : "untouched"
          if (ev[m] === "untouched" && absent) ev[`${m}_absent`] = true
        }
        events.push(ev)
        sends.set(id, [...(sends.get(id) ?? []), ev])
      }
    }
    for (const [id, evs] of sends) {
      const it = items.get(id), object = it?.check?.object ?? null
      const held = cycles.flatMap(c => c.items ?? []).some(i => i.id === id && i.action === "hold" && /no progress/u.test(i.why ?? ""))
      const row = { run, round: e.round, id, object, object_name: object ? reg.objects.get(object)?.name ?? null : null, first_sent_into: evs[0].cycle, stopped_no_progress: held, carried_next: carriedOut.has(id), carried_in: (e.carried_in ?? []).some(x => x.id === id) }
      for (const m of MAPPINGS) { row[`${m}_sequence`] = evs.map(v => `${v.cycle}:${v[m]}${v[`${m}_absent`] ? "(absent)" : ""}${v.reverted ? "(reverted)" : ""}`); row[`${m}_end`] = evs.at(-1)[m]; row[`${m}_absent`] = !!evs.at(-1)[`${m}_absent`] }
      rows.push(row)
    }
  }
  rmSync(tmp, { recursive: true, force: true })
}

const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : "—"
const lines = ["# Repair outcomes (DESIGN-DEEP §4.1)", "", "Rules in outcome.mjs's header. Items sent in a round (carried-in items count in the round they were carried into); outcome at the last cycle of the round the item went into. Percentages of all items sent."]
for (const m of MAPPINGS) {
  const end = r => r[`${m}_end`]
  lines.push("", `## Mapping: ${m}`, "", "| run | round | sent | fixed | touched | untouched | no check | unmapped | untouched stopped for no progress |", "|---|---|---|---|---|---|---|---|---|")
  const key = r => `${r.run} R${r.round}`
  const line = (label, round, g) => { const n = g.length, c = o => g.filter(r => end(r) === o).length; return `| ${label} | ${round} | ${n} | ${c("fixed")} (${pct(c("fixed"), n)}) | ${c("touched")} (${pct(c("touched"), n)}) | ${c("untouched")} (${pct(c("untouched"), n)}) | ${c("no_check")} | ${c("unmapped")} | ${g.filter(r => end(r) === "untouched" && r.stopped_no_progress).length} |` }
  for (const k of [...new Set(rows.map(key))]) { const g = rows.filter(r => key(r) === k); lines.push(line(g[0].run, g[0].round, g)) }
  lines.push(line("all", "—", rows))
  const c = o => rows.filter(r => end(r) === o).length, judged = c("fixed") + c("touched") + c("untouched")
  lines.push("", `Of the ${judged} items with a check and a mapped command: fixed ${pct(c("fixed"), judged)}, touched ${pct(c("touched"), judged)}, untouched ${pct(c("untouched"), judged)} (of which the command was not in the program at all: ${rows.filter(r => end(r) === "untouched" && r[`${m}_absent`]).length}).`)
  lines.push("", `By the size of the message that sent the item (every send, outcome at the cycle it went into), mapping ${m}:`, "", "| items in the message | sends | fixed | touched | untouched | untouched of judged | no check / unmapped |", "|---|---|---|---|---|---|---|")
  for (const [name, lo, hi] of [["1–5", 1, 5], ["6–10", 6, 10], ["11+", 11, Infinity]]) {
    const g = events.filter(v => v.size >= lo && v.size <= hi), k = o => g.filter(v => v[m] === o).length, j = k("fixed") + k("touched") + k("untouched")
    lines.push(`| ${name} | ${g.length} | ${k("fixed")} | ${k("touched")} | ${k("untouched")} | ${pct(k("untouched"), j)} | ${k("no_check")} / ${k("unmapped")} |`)
  }
  const un = rows.filter(r => end(r) === "unmapped"), byObj = {}
  for (const r of un) byObj[r.object_name ?? r.object ?? "none"] = (byObj[r.object_name ?? r.object ?? "none"] ?? 0) + 1
  lines.push("", `Unmapped under ${m}: ${un.length} (by object: ${Object.entries(byObj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")})`)
}
lines.push("", "## Items", "", "| run | round | item | object | first sent into | outcomes by cycle (stem) | end (stem) | end (strict) | stopped (no progress) | carried into next round |", "|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map(r => `| ${r.run} | ${r.round} | ${r.id}${r.carried_in ? " (carried in)" : ""} | ${r.object_name ?? "—"} | ${r.first_sent_into} | ${r.stem_sequence.join(" ")} | ${r.stem_end} | ${r.strict_end} | ${r.stopped_no_progress ? "yes" : ""} | ${r.carried_next ? "yes" : ""} |`))
writeFileSync(join(OUT, "outcome.md"), lines.join("\n") + "\n", "utf8")
writeFileSync(join(OUT, "outcome.json"), JSON.stringify({ items: rows, sends: events }, null, 1) + "\n", "utf8")
console.log(lines.slice(0, lines.indexOf("## Items")).join("\n"))
