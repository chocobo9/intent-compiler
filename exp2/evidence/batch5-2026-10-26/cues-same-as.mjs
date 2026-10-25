// Batch 5 C (no model): the same-as cue. (1) On four tasks' round texts (each round's instruction only, no tests), the
// cue counts by kind as batch 4 had them (they must not change) and every same-as hit, with the names it gives; units
// need the attribution's objects, which these texts have none of here, so the hits are what code would offer.
// (2) On rep1o (dpipe, its recorded attribution): R3's same-as unit, and where it goes — the review lists' units across
// commands and the package's delivery.
// Usage (dev worktree, after `npm run build`):
//   node exp2/evidence/batch5-2026-10-26/cues-same-as.mjs <out.md> <rep1o run dir> <task dir> [<task dir> …]
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Registry } = await import(D + "registry.js")
const { splitRound } = await import(D + "source.js")
const { Exp2Store } = await import(D + "store.js")
const U = await import(D + "units.js")
const L = await import(D + "lists.js")
const V = await import(D + "view.js")
const [OUT, run, ...tasks] = process.argv.slice(2)
const KINDS = ["changes_to", "cross_list", "prev_new", "scope_unchanged", "author_id", "cmd_in_revision"]
const out = ["# The same-as cue (batch 5 C)", "", "## Four tasks: counts by kind (as in batch 4) and the same-as hits", ""]
const hitsAll = []
for (const dir of tasks) {
  const rounds = readdirSync(join(dir, "steps")).filter(d => /^round-\d+$/u.test(d)).sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]))
  const reg = new Registry()
  const tot = Object.fromEntries([...KINDS, "same_as"].map(k => [k, 0]))
  for (const r of rounds) {
    const n = Number(r.split("-")[1])
    reg.addSource(splitRound(n, readFileSync(join(dir, "steps", r, "instruction.md"), "utf8")))
    for (const h of U.cuesIn(reg, n)) { tot[h.kind] = (tot[h.kind] ?? 0) + 1; if (h.kind === "same_as") hitsAll.push({ task: basename(dir).replace(/^theme_/u, "").split("_").slice(0, 2).join("_"), round: n, block: h.block, names: h.names, text: reg.block(h.block).text.trim() }) }
  }
  out.push(`- ${basename(dir)}: ${[...KINDS, "same_as"].map(k => `${k} ${tot[k]}`).join(", ")}`)
}
out.push("", `Same-as hits: ${hitsAll.length}.`, "", "| task | round | sentence | names | the sentence |", "|---|---|---|---|---|", ...hitsAll.map(h => `| ${h.task} | ${h.round} | ${h.block} | ${h.names.join(", ")} | ${h.text.replace(/\|/gu, "\\|").replace(/\n/gu, " ").slice(0, 300)} |`))

// rep1o: its recorded attribution, R3.
const s = JSON.parse(readFileSync(join(run, "state", "exp2-state.json"), "utf8"))
const tmp = mkdtempSync(join(tmpdir(), "b5c-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry()
out.push("", "## rep1o (dpipe), with its attribution", "")
for (let r = 1; r <= 6; r++) for (const h of U.cuesIn(reg, r).filter(x => x.kind === "same_as")) {
  const u = U.cueUnits(reg, r).find(x => x.cue?.kind === "same_as" && x.members.includes(h.block))
  out.push(`- R${r} ${h.block} (${h.names.join(", ")}): ${u ? `unit ${u.id} over ${u.objects.map(o => `${o} ${reg.objects.get(o)?.name}`).join(" + ")}` : "no unit (the name is no command of the attribution other than the sentence's own)"} — ${JSON.stringify(reg.block(h.block).text.trim().slice(0, 200))}`)
}
const e3 = s.executions.find(e => e.round === 3)
const items = new Map(s.executions.flatMap(e => e.review_items ?? []).map(i => [i.id, i]))
const open = (e3.carried_in ?? []).map(c => ({ id: c.id, units: items.get(c.id)?.units ?? s.guards.find(g => g.id === c.id)?.units ?? [] }))
const pkg = V.fitPackage(V.roundPackage(reg, 3, open)).pkg
const lists = L.reviewLists(reg, 3, [], s.executions.filter(e => e.round < 3))
out.push("", `R3 package, units across commands: ${pkg.units.cross.map(u => `${u.id} ${u.name}: ${u.objects.join("+")}, delivered ${u.delivered.length}/${u.objects.length}`).join("; ") || "none"}.`)
out.push(`R3 review lists, changes across commands: ${lists.cross.map(u => `${u.id} ${u.name}: ${u.names.join(", ")}`).join("; ") || "none"}.`)
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
console.log(out.join("\n"))
