// Batch 4 acceptance 3: the code's cue extraction (src/exp2/units.ts) on four tasks' round texts, by kind and round,
// beside the regex count of evidence/change-unit-cues-2026-10-25; and the scope declarations each round. Reads only
// each round's instruction (steps/round-N/instruction.md), no tests. No model.
// Usage (dev worktree, after `npm run build`): node exp2/evidence/batch4-2026-10-25/cues-tasks.mjs <out.md> <task dir> [<task dir> …]
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Registry } = await import(D + "registry.js")
const { splitRound } = await import(D + "source.js")
const U = await import(D + "units.js")
const [OUT, ...tasks] = process.argv.slice(2)
const KINDS = ["changes_to", "cross_list", "prev_new", "scope_unchanged", "author_id", "cmd_in_revision"]
const out = ["# Cue extraction on four tasks (batch 4, acceptance 3)", "", "Hits are sentences (author ids: each id cited). Units: the cue units code proposes for the round (before any object is known, commands are the names in backticks).", ""]
for (const dir of tasks) {
  const rounds = readdirSync(join(dir, "steps")).filter(d => /^round-\d+$/u.test(d)).sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]))
  const reg = new Registry()
  out.push(`## ${basename(dir)}`, "", `| round | chars | ${KINDS.join(" | ")} | cue units | scope declarations |`, `|---|---|${KINDS.map(() => "---").join("|")}|---|---|`)
  const tot = Object.fromEntries(KINDS.map(k => [k, 0])); let units = 0, scopes = 0, withScope = 0
  for (const r of rounds) {
    const n = Number(r.split("-")[1]), text = readFileSync(join(dir, "steps", r, "instruction.md"), "utf8")
    reg.addSource(splitRound(n, text))
    const hits = U.cuesIn(reg, n), by = Object.fromEntries(KINDS.map(k => [k, hits.filter(h => h.kind === k).length]))
    for (const k of KINDS) tot[k] += by[k]
    const cu = U.cueUnits(reg, n), sc = U.scopeDeclarations(reg, n)
    units += cu.length; scopes += sc.length; if (sc.length) withScope++
    out.push(`| ${n} | ${text.length} | ${KINDS.map(k => by[k]).join(" | ")} | ${cu.length} | ${sc.length}${sc.length ? `: ${sc.map(x => JSON.stringify(x.text.slice(0, 60))).join("; ")}` : ""} |`)
  }
  out.push(`| total | — | ${KINDS.map(k => tot[k]).join(" | ")} | ${units} | ${scopes} (rounds with one: ${withScope}/${rounds.length}) |`, "")
}
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
console.log(out.join("\n"))
