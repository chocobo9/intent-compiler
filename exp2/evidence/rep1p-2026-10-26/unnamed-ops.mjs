// rep1p (no model): the ledger's kind (i) cases of chosen rounds — failing at first delivery and at the round's end,
// their op named by no review item of the round (prereg.mjs's rule) — by op; whether the op's command was on the round's
// lists (open, patrol, units across commands: accept.lists), and whether a review of the round ran it (accept.lists.ran).
// Case names and requirement_ref only. The op's command: the object named "<op>", "<op> command", "<op> operation" or
// "<op> transformation" (the attribution's names), for transform.X the X.
// Usage (dev worktree, after `npm run build`): node exp2/evidence/rep1p-2026-10-26/unnamed-ops.mjs <out.md> <run dir> <round> [<round> …]
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const D = pathToFileURL(join(process.cwd(), "dist/exp2/")).href
const { Exp2Store } = await import(D + "store.js")
const [OUT, dir, ...rs] = process.argv.slice(2)
const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
const tmp = mkdtempSync(join(tmpdir(), "uo-")); mkdirSync(join(tmp, "state")); writeFileSync(join(tmp, "state", "exp2-state.json"), JSON.stringify(s))
const reg = new Exp2Store(join(tmp, "state"), s.run_id).registry()
const scores = readFileSync(join(dir, "checkpoints", "scores.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l))
const cases = (n, kind) => {
  const sc = scores.find(x => x.round === n && (kind ? x.kind === kind : !x.kind)), out = new Map()
  const log = join(dir, "official", `round-0${n}`, sc.commit.slice(0, 12), "verifier.log")
  if (existsSync(log)) for (const m of readFileSync(log, "utf8").matchAll(/CASE_RESULT case_id=(\S+) origin_step=round-0?(\d+) requirement_ref=(\S+)[^\n]*? status=(\S+)/gu)) out.set(m[1], { id: m[1], origin: +m[2], ref: m[3], ok: m[4] === "success" })
  return out
}
const opOf = ref => ref.split(".").at(-1)
const mentions = (text, op) => new RegExp(`\\b${op.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u").test(text) || (op === "rename-drop" && (text.includes("rename") || text.includes("drop")))
const objectOf = op => [...reg.objects.values()].find(o => [op, `${op} command`, `${op} operation`, `${op} transformation`].includes(o.name.toLowerCase()) || (op === "rename-drop" && /^rename/u.test(o.name.toLowerCase())))
const out = ["# rep1p: the cases no review item named, by op, against the round's lists", ""]
for (const n of rs.map(Number)) {
  const e = s.executions.find(x => x.round === n), l = e.accept?.lists
  const first = cases(n, "first_delivery"), end = cases(n)
  const text = (e.review_items ?? []).filter(i => i.round === n).map(i => i.text).join(" ").toLowerCase()
  const stuck = [...first.values()].filter(c => !c.ok && end.get(c.id) && !end.get(c.id).ok && !mentions(text, opOf(c.ref)))
  const byOp = new Map()
  for (const c of stuck) { const k = `R${c.origin} ${c.ref}`; byOp.set(k, [...(byOp.get(k) ?? []), c]) }
  const open = new Set((l?.open ?? []).map(x => x.object)), patrol = new Set(l?.patrol ?? []), cross = new Set((l?.cross ?? []).flatMap(u => u.objects)), ran = new Set(l?.ran ?? [])
  out.push(`## R${n}: ${stuck.length} cases, ${byOp.size} ops`, "", "| origin, requirement_ref | cases | command | open list | patrol | across | a review ran it |", "|---|---|---|---|---|---|---|")
  let listed = 0, listedNotNamed = 0
  for (const [k, cs] of [...byOp].sort((a, b) => b[1].length - a[1].length)) {
    const o = objectOf(opOf(cs[0].ref)), on = o && (open.has(o.id) || patrol.has(o.id) || cross.has(o.id))
    if (on) { listed++; listedNotNamed++ }
    out.push(`| ${k} | ${cs.length} | ${o ? `${o.id} ${o.name}` : "—"} | ${o && open.has(o.id) ? "yes" : "no"} | ${o && patrol.has(o.id) ? "yes" : "no"} | ${o && cross.has(o.id) ? "yes" : "no"} | ${o && ran.has(o.id) ? "yes" : "no"} |`)
  }
  out.push("", `Ops on a list (open, patrol or across) that no review item of the round named: ${listedNotNamed} of ${byOp.size}. The round's lists: open ${l?.open.length ?? 0}, patrol ${l?.patrol.length ?? 0} (${[...patrol].map(id => reg.objects.get(id)?.name).join(", ") || "none"}), across ${l?.cross.length ?? 0}.`, "")
}
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
console.log(out.join("\n"))
