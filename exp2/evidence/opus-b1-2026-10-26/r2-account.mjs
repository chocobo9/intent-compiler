// Account 2 after opusb3 (no model, read only; case names and requirement_ref only): R2's first delivery against the
// items carried in from R1. For each run: R1 cases passing at R1's end and failing at R2's first delivery (by op), R2's
// new cases passing at the first delivery, the R2 work order's zones in characters (from the executor's first session,
// read-only from the OpenCode database), carried task lines and open items, and the first cycle's diff size.
// Usage: node exp2/evidence/opus-b1-2026-10-26/r2-account.mjs <runs dir> <dev worktree> <opencode data dir> <run name>...
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { execFileSync } from "node:child_process"
import { DatabaseSync } from "node:sqlite"

const [RUNS, DEV, OC, ...names] = process.argv.slice(2)
const { readCases, opOf } = await import(pathToFileURL(join(DEV, "exp2/evidence/prereg/ledger.mjs")).href)
const lines = f => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l))
const firstPrompt = sid => {
  for (const f of readdirSync(OC).filter(f => f.endsWith(".db"))) {
    const db = new DatabaseSync(join(OC, f), { readOnly: true })
    try { const rows = db.prepare("select p.data as data from part p join message m on m.id = p.message_id where m.session_id = ? order by p.time_created limit 3").all(sid); if (rows.length) return rows.map(r => JSON.parse(r.data)).filter(d => d.type === "text").map(d => d.text).join("\n") } catch { /* another database */ }
  }
  return ""
}
const md = ["# R2 first delivery against the items carried in from R1", "", "| run | R1 passing at R1 end | broken at R2 first delivery (by op) | R2 new cases passing at first delivery | work order chars: task / source / open | carried task lines | failing evidence lines | open items | C2.1 lines added |", "|---|---|---|---|---|---|---|---|---|"]
for (const name of names) {
  const D = join(RUNS, `exp2-icacc-r6-luna56-low-${name}`)
  const s = JSON.parse(readFileSync(join(D, "state", "exp2-state.json"), "utf8")), sc = lines(join(D, "checkpoints", "scores.jsonl"))
  const log = (r, k) => { const x = sc.find(y => y.round === r && (k ? y.kind === k : !y.kind)); return readCases(join(D, "official", `round-0${r}`, x.commit.slice(0, 12), "verifier.log")) }
  const r1 = log(1), f2 = log(2, "first_delivery")
  const broke = [...r1.keys()].filter(id => r1.get(id).ok && f2.has(id) && !f2.get(id).ok), byOp = {}
  for (const id of broke) { const o = opOf(f2.get(id).ref); byOp[o] = (byOp[o] ?? 0) + 1 }
  const fresh = [...f2.keys()].filter(id => !r1.has(id))
  const e = s.executions.find(x => x.round === 2), wo = firstPrompt(e.cycles[0].session)
  const zone = {}; let z = ""; for (const l of wo.split("\n")) { if (/^## Task zone/u.test(l)) z = "task"; else if (/^## Anchor zone/u.test(l)) z = "anchor"; else if (/^## Source zone/u.test(l)) z = "source"; else if (/^## Still open/u.test(l)) z = "open"; zone[z] = (zone[z] ?? 0) + l.length + 1 }
  const task = wo.split(/^## Anchor zone/mu)[0], open = wo.split(/^## Still open/mu)[1] ?? ""
  const added = execFileSync("git", ["-C", join(D, "app"), "diff", "--numstat", e.base, e.cycles[0].commit], { encoding: "utf8" }).trim().split("\n").reduce((n, l) => n + (+l.split("\t")[0] || 0), 0)
  md.push(`| ${name.split("-")[0]} | ${[...r1.values()].filter(c => c.ok).length}/${r1.size} | ${broke.length} ${JSON.stringify(byOp)} | ${fresh.filter(id => f2.get(id).ok).length}/${fresh.length} | ${zone.task ?? 0} / ${zone.source ?? 0} / ${zone.open ?? 0} | ${(task.match(/carried/gu) ?? []).length} | ${(task.match(/^ {2}- failing/gmu) ?? []).length} | ${(open.match(/^\d+\. /gmu) ?? []).length} | ${added} |`)
}
console.log(md.join("\n"))
