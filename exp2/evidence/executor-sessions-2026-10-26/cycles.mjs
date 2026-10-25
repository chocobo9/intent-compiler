// Step 4 (no model): one file per cycle that received an untouched send — the executor's messages of the cycle in full
// (the work order, the repair list, the untouched message), its replies in full, the files the cycle changed (git diff
// names; files its tool calls wrote, its task sessions' included) and the anchors code saw change; then the untouched
// sends it received with their class.
// Usage: node exp2/evidence/executor-sessions-2026-10-26/cycles.mjs <sessions.json> <untouched-sends.json> <out dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [IN, CLS, DIR] = process.argv.slice(2)
const rows = JSON.parse(readFileSync(IN, "utf8")), cls = JSON.parse(readFileSync(CLS, "utf8"))
mkdirSync(DIR, { recursive: true })
const cycles = new Map()
for (const c of cls) { const k = `${c.run}-${c.cycle}`; cycles.set(k, [...(cycles.get(k) ?? []), c]) }
for (const [k, sends] of cycles) {
  const r = rows.find(x => `${x.run}-${x.cycle}` === k)
  const md = [`# ${r.run} ${r.cycle}: the executor's session ${r.session}`, "", `Session length when the cycle began: ${r.messages_before} messages; context of the last reply before it: ${r.context_before.toLocaleString("en-US")} tokens. Tool calls in the cycle: ${r.tool_calls} (task calls ${r.task_calls}); patches ${r.patches.length}.`, "",
    "## Untouched sends it received", "", "| item | sent in | class | quote |", "|---|---|---|---|", ...sends.map(s => `| ${s.item} | ${s.via} | ${s.cls} | ${s.quote.replace(/\|/gu, "\\|")} |`), "",
    "## Files the cycle changed", "", `git diff: ${r.files.join(", ") || "none"}`, "", `written by its tool calls: ${r.tool_files.map(f => f.replace(/^.*[\\/]app[\\/]/u, "")).join(", ") || "none"}`, "", `anchors changed: ${r.anchors.join(", ") || "none"}`, "",
    ...r.user.flatMap((u, i) => [`## The message to the executor${r.user.length > 1 ? ` (${i + 1} of ${r.user.length})` : ""}`, "", "````", u, "````", ""]),
    "## The executor's replies", "", "````", r.reply, "````", ""]
  writeFileSync(join(DIR, `${k}.md`), md.join("\n"), "utf8")
}
console.log(cycles.size, "cycles")
