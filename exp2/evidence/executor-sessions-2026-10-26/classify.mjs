// Step 3 (no model): each untouched send, from what its cycle's session shows (sessions.json from export.py), put in one
// class, checked in this order, sentence by sentence (a sentence of the reply is the item's when it names the item's id
// or one of its own terms; its command alone does not make it the item's):
//   declined     the executor's numbered answer to the untouched message was "not done" or "disagree", or a sentence of
//                the item's says it did not, will not or cannot change it, disagrees, or that it conflicts with or
//                contradicts the requirements;
//   already      a sentence of the item's says it is already correct (implemented, handled, …);
//   other work   its patches (the session's and its task sessions') touch the item's command or one of its terms, and
//                still the check's output did not change;
//   said done    a sentence of the item's is in the reply, or its numbered answer was "done", and no patch touches it;
//   not read     neither the reply nor the patches touch it.
// The item's command: its check's subcommand and, for transform, the recipe's ops. Its terms: the backticked words and
// the quoted strings of the item's text (4 characters or more), less the program's name and the command's own names.
// The session's length when the cycle began: the messages before it. Also: whether the item's text was in the cycle's
// message at all. The quote: the item's numbered answer line, else its first sentence in the reply, else the reply's
// first line.
// Usage: node exp2/evidence/executor-sessions-2026-10-26/classify.mjs <sessions.json> <out.md> <rep1n dir> <rep1p dir>
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [IN, OUT, ...dirs] = process.argv.slice(2)
const rows = JSON.parse(readFileSync(IN, "utf8"))
const states = Object.fromEntries(dirs.map(d => [d.match(/rep1[a-z]/u)[0], JSON.parse(readFileSync(join(d, "state", "exp2-state.json"), "utf8"))]))
const checkOf = (run, id) => {
  const s = states[run], it = s.executions.flatMap(e => e.review_items ?? []).find(i => i.id === id)
  if (it?.check) return it.check
  const g = s.guards.find(x => x.id === id)
  if (!g) return null
  return g.source === "library" ? s.checks.find(k => k.id === g.check) ?? null : { input: g.input }
}
const opsOf = check => {
  const a = check?.input?.args ?? [], cmd = a[0]
  if (cmd !== "transform") return cmd ? [cmd] : []
  const ri = a.indexOf("--recipe"), f = ri >= 0 ? check.input.files.find(x => x.path === a[ri + 1]) : null
  try { return ["transform", ...new Set(JSON.parse(f.content).map(s => s.op).filter(Boolean))] } catch { return ["transform"] }
}
const termsOf = (text, ops) => [...new Set([...text.matchAll(/`([^`\n]{4,80})`/gu), ...text.matchAll(/"([^"\n]{4,80})"/gu)].map(m => m[1].trim()).filter(t => !/^(\.\/)?dpipe(\.exe)?$/iu.test(t) && !/^dpipe\s/u.test(t) && !ops.includes(t.toLowerCase())))]
const has = (hay, t) => hay.toLowerCase().includes(t.toLowerCase())
const word = (hay, w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "iu").test(hay)
const sentencesOf = text => text.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9`*-])/u).map(s => s.trim()).filter(Boolean)
const DECLINE = /\b(not done|disagree|disagrees|did not change|didn't change|will not|won't|cannot|can't|unable to|left unchanged|no change (was|is) needed|conflicts? with|contradicts?|is wrong|expectation is (wrong|incorrect))\b/iu
const ALREADY = /\b(already|is) (correct|right|implemented|handles|handled|does|produces|returns|emits|matches|satisf\w*|passes|works|supported|compliant|conforms?)\b/iu
const CLASSES = ["not read", "said done", "other work", "already", "declined"]
const out = [], counts = {}
for (const r of rows.filter(x => x.outcome === "untouched")) {
  const check = checkOf(r.run, r.item), ops = opsOf(check), terms = termsOf(r.text, ops)
  const flat = t => t.replace(/\*+/gu, "").replace(/\s+/gu, " ")
  const delivered = r.user.some(u => flat(u).includes(flat(r.text).trim().slice(0, 40)) || u.includes(r.item))
  const patch = r.patches.join("\n"), reply = r.reply
  const named = ops.filter(o => o !== "transform")
  const patchTouches = (named.length ? named : ops).some(o => word(patch, o)) || terms.some(t => has(patch, t))
  const sentences = sentencesOf(reply)
  const own = sentences.filter(s => has(s, r.item) || terms.some(t => has(s, t)))
  const numbered = r.untouched_n ? sentences.find(s => new RegExp(`^\\W*${r.untouched_n}[.):]\\s*\\**\\s*${r.answer ?? ""}`, "iu").test(s)) ?? null : null
  const declined = r.answer === "not done" || r.answer === "disagree" ? (numbered ?? `(answer: ${r.answer})`) : own.find(s => DECLINE.test(s))
  const already = declined ? null : own.find(s => ALREADY.test(s))
  const cls = declined ? "declined" : already ? "already" : patchTouches ? "other work" : own.length || r.answer === "done" ? "said done" : "not read"
  counts[cls] = (counts[cls] ?? 0) + 1
  const quote = (declined ?? already ?? numbered ?? own[0] ?? reply.trim().split("\n").find(l => l.trim()) ?? "").replace(/\s+/gu, " ").slice(0, 220)
  out.push({ ...r, ops, terms, cls, delivered, patchTouches, named: own.length > 0, quote, patchCount: r.patches.length })
}
// Session length: three bands by the messages before the cycle (tertiles of all judged sends). The untouched share by
// band: untouched sends over every judged send (fixed, touched, untouched) of the same band.
const lens = rows.map(o => o.messages_before).sort((a, b) => a - b), q = p => lens[Math.min(lens.length - 1, Math.floor(p * lens.length))]
const t1 = q(1 / 3), t2 = q(2 / 3), band = n => n <= t1 ? `≤ ${t1}` : n <= t2 ? `${t1 + 1}–${t2}` : `> ${t2}`
const md = ["# The executor's sessions behind the untouched sends (rep1n, rep1p)", "", `Judged sends: ${rows.length} (fixed ${rows.filter(r => r.outcome === "fixed").length}, touched ${rows.filter(r => r.outcome === "touched").length}, untouched ${out.length}). Item text in the cycle's message: ${out.filter(o => o.delivered).length}/${out.length}. Cycles with no patch at all: ${out.filter(o => !o.patchCount).length}.`, "",
  "| class | sends | rep1n | rep1p |", "|---|---|---|---|",
  ...CLASSES.map(c => `| ${c} | ${counts[c] ?? 0} | ${out.filter(o => o.cls === c && o.run === "rep1n").length} | ${out.filter(o => o.cls === c && o.run === "rep1p").length} |`), "",
  "By the message it went in:", "", `| sent in | sends | ${CLASSES.join(" | ")} |`, "|---|---|---|---|---|---|---|",
  ...["work message (carried in)", "repair list", "untouched message"].map(v => { const g = out.filter(o => o.via === v); return `| ${v} | ${g.length} | ${CLASSES.map(c => g.filter(o => o.cls === c).length).join(" | ")} |` }), "",
  `By the session's length when the cycle began (messages before it; bands at ${t1} and ${t2}):`, "", `| band | judged sends | untouched (share) | ${CLASSES.join(" | ")} | median context tokens |`, "|---|---|---|---|---|---|---|---|---|",
  ...[`≤ ${t1}`, `${t1 + 1}–${t2}`, `> ${t2}`].map(b => { const g = out.filter(o => band(o.messages_before) === b), all = rows.filter(o => band(o.messages_before) === b), ctx = all.map(o => o.context_before).sort((x, y) => x - y); return `| ${b} | ${all.length} | ${g.length} (${all.length ? Math.round(100 * g.length / all.length) : 0}%) | ${CLASSES.map(c => g.filter(o => o.cls === c).length).join(" | ")} | ${ctx.length ? ctx[Math.floor(ctx.length / 2)].toLocaleString("en-US") : "—"} |` }), "",
  "## Every untouched send", "", "| run | round | cycle | item | sent in | class | messages before | context tokens | patches | quote |", "|---|---|---|---|---|---|---|---|---|---|",
  ...out.map(o => `| ${o.run} | R${o.round} | ${o.cycle} | ${o.item} | ${o.via.replace(" (carried in)", "")} | ${o.cls}${o.delivered ? "" : " (not in the message)"} | ${o.messages_before} | ${o.context_before.toLocaleString("en-US")} | ${o.patchCount} | ${o.quote.replace(/\|/gu, "\\|")} |`)]
writeFileSync(OUT, md.join("\n") + "\n", "utf8")
writeFileSync(OUT.replace(/\.md$/u, ".json"), JSON.stringify(out.map(({ user, reply, patches, ...o }) => o), null, 1) + "\n", "utf8")
console.log(md.slice(0, md.indexOf("## Every untouched send")).join("\n"))
