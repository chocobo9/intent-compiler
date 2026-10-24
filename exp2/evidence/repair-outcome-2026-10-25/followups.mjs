// Two follow-up tables over outcome.json (outcome.mjs's records; no model, no program run):
// 1. carry.md: items untouched at round end (output rule) and carried into the next round: their outcome there.
// 2. form.md: untouched share by the item's form (with a check / reviewer's words only) and by command age.
// Usage: node exp2/evidence/repair-outcome-2026-10-25/followups.mjs  (reads and writes the same directory)
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const DIR = dirname(fileURLToPath(import.meta.url))
const { items } = JSON.parse(readFileSync(join(DIR, "outcome.json"), "utf8"))
const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : "—"

// 1. The next round of an item carried in untouched. Its outcome there is the output rule's at the last cycle it went
// into in that round; "not sent again" when the round sent it into no cycle.
{
  const NEXT = ["fixed", "touched", "untouched", "build_failed", "unseen", "not sent again"]
  const carried = items.filter(r => r.output_end === "untouched" && r.carried_next)
  const nextOf = r => items.find(x => x.run === r.run && x.round === r.round + 1 && x.id === r.id)?.output_end ?? "not sent again"
  const lines = ["# Items carried in untouched: their outcome in the next round (output rule)", "",
    "An item untouched at the end of round n (its check's output unchanged since it was sent) and carried into round n+1, by the output rule at the last cycle it went into in n+1.", "",
    `| run | round carried from | carried | ${NEXT.join(" | ")} |`, `|---|---|---|${NEXT.map(() => "---").join("|")}|`]
  const key = r => `${r.run} ${r.round}`
  for (const k of [...new Set(carried.map(key))]) {
    const g = carried.filter(r => key(r) === k)
    lines.push(`| ${g[0].run} | R${g[0].round} → R${g[0].round + 1} | ${g.length} | ${NEXT.map(o => g.filter(r => nextOf(r) === o).length).join(" | ")} |`)
  }
  lines.push(`| all | — | ${carried.length} | ${NEXT.map(o => `${carried.filter(r => nextOf(r) === o).length} (${pct(carried.filter(r => nextOf(r) === o).length, carried.length)})`).join(" | ")} |`)
  // The same items over every later round: how many rounds in a row they stayed untouched.
  const streak = r => { let n = 1, x = r; for (;;) { const y = items.find(z => z.run === x.run && z.round === x.round + 1 && z.id === x.id); if (!y || y.output_end !== "untouched") return { n, end: y ? y.output_end : x.carried_next ? "not sent again" : "not carried" }; n++; x = y } }
  const firsts = items.filter(r => r.output_end === "untouched" && !(r.carried_in && items.some(x => x.run === r.run && x.round === r.round - 1 && x.id === r.id && x.output_end === "untouched")))
  const by = {}
  for (const r of firsts) { const s = streak(r); const k = `${Math.min(s.n, 4)}${s.n >= 4 ? "+" : ""} round(s), then ${s.end}`; by[k] = (by[k] ?? 0) + 1 }
  lines.push("", "Untouched runs: every item from the first round it ended untouched, the rounds in a row it stayed untouched, and what came after (not carried: the round was the run's last or the item left the ledger).", "",
    "| rounds untouched in a row, then | items |", "|---|---|", ...Object.entries(by).sort().map(([k, v]) => `| ${k} | ${v} |`))
  lines.push("", "Items:", "", "| run | item | rounds | next round |", "|---|---|---|---|", ...carried.map(r => `| ${r.run} | ${r.id} | R${r.round} → R${r.round + 1} | ${nextOf(r)} |`))
  writeFileSync(join(DIR, "carry.md"), lines.join("\n") + "\n", "utf8")
  console.log(lines.slice(0, lines.indexOf("Items:")).join("\n"))
}

// 2. Untouched share by form and by command age. The code rule judges both forms alike (anchors of the item's command
// changed or not; fixed only for a check that passes); the output rule judges items with a check only.
{
  const judged = (g, rule) => g.filter(r => ["fixed", "touched", "untouched"].includes(r[rule]))
  const row = (label, g) => {
    const c = judged(g, "code_end"), o = judged(g, "output_end"), u = (x, rule) => x.filter(r => r[rule] === "untouched").length
    return `| ${label} | ${g.length} | ${c.length} | ${u(c, "code_end")} (${pct(u(c, "code_end"), c.length)}) | ${g.filter(r => r.code_end === "unmapped").length} | ${o.length ? `${o.length} | ${u(o, "output_end")} (${pct(u(o, "output_end"), o.length)})` : "— | —"} |`
  }
  const head = ["| items | sent | judged (code rule) | untouched (code rule) | unmapped | judged (output rule) | untouched (output rule) |", "|---|---|---|---|---|---|---|"]
  const lines = ["# Which items the executor leaves untouched: by form and by command age", "",
    "Each item once per round it was sent in, at its round end. Code rule: the stem anchor mapping on every item (object from its check, else from its units); fixed only where a check passes. Output rule: items with a check only. Build-failed ends are left out of judged.", "",
    "## By form", "", ...head,
    row("with a check (command, input, expected values)", items.filter(r => r.form === "check")),
    row("reviewer's words only", items.filter(r => r.form === "words")),
    "", "## By command age (the object's earliest text in the item's round: new)", "", ...head,
    row("new command", items.filter(r => r.command_age === "new")),
    row("earlier command", items.filter(r => r.command_age === "earlier")),
    row("no object", items.filter(r => r.command_age === null)),
    "", "## By command age, rounds 2 and later (in round 1 every command is new)", "", ...head,
    row("new command", items.filter(r => r.round >= 2 && r.command_age === "new")),
    row("earlier command", items.filter(r => r.round >= 2 && r.command_age === "earlier")),
    "", "## Both", "", ...head]
  for (const f of ["check", "words"]) for (const a of ["new", "earlier"]) lines.push(row(`${f === "check" ? "with a check" : "words only"}, ${a} command`, items.filter(r => r.form === f && r.command_age === a)))
  lines.push("", "## By run (code rule; with a check / words only)", "", "| run | with a check: judged, untouched | words only: judged, untouched | new: judged, untouched | earlier: judged, untouched |", "|---|---|---|---|---|")
  for (const run of [...new Set(items.map(r => r.run))]) {
    const g = items.filter(r => r.run === run), cell = x => { const j = judged(x, "code_end"), u = j.filter(r => r.code_end === "untouched").length; return `${j.length}, ${u} (${pct(u, j.length)})` }
    lines.push(`| ${run} | ${cell(g.filter(r => r.form === "check"))} | ${cell(g.filter(r => r.form === "words"))} | ${cell(g.filter(r => r.command_age === "new"))} | ${cell(g.filter(r => r.command_age === "earlier"))} |`)
  }
  writeFileSync(join(DIR, "form.md"), lines.join("\n") + "\n", "utf8")
  console.log("\n" + lines.join("\n"))
}
