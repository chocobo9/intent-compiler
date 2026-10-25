// Closure in each round, the control group (L: every round's full text, reviewer at medium) beside IC's runs, from the
// verifier logs alone (case names, origin_step and requirement_ref only; no model). Closure = (end − first delivery) /
// (cases − first delivery), the independent review's 1(a). Also: cases failing at first delivery and still at the
// end, and of them those from an earlier round (origin_step before this round; the build check, origin "base", counts
// as earlier).
// The control: first delivery from official-diag-first (the host Go module cache mounted read-only), the end from
// official (no module cache, as IC's scorer) and from official-diag (the cache, as the first delivery's): both pairings
// are shown. IC: first delivery and end both from official/ (the run's scoring hook), the commits of scores.jsonl.
// Usage: node exp2/evidence/closure-vs-control/closure.mjs <out.md> <runs dir>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [OUT, RUNS] = process.argv.slice(2)
const read = f => {
  const out = new Map()
  if (!existsSync(f)) return null
  for (const m of readFileSync(f, "utf8").matchAll(/CASE_RESULT case_id=(\S+) origin_step=(\S+) requirement_ref=\S+[^\n]*? status=(\S+)/gu)) out.set(m[1], { origin: m[2] === "base" ? 0 : Number(m[2].replace(/^round-0?/u, "")), ok: m[3] === "success" })
  return out
}
const one = d => { if (!existsSync(d)) return null; const sub = readdirSync(d); return sub.length === 1 ? join(d, sub[0], "verifier.log") : null }
const row = (round, first, end) => {
  if (!first || !end) return null
  const passed = m => [...m.values()].filter(c => c.ok).length
  const f = passed(first), e = passed(end), total = end.size
  const stuck = [...first].filter(([id, c]) => !c.ok && end.get(id) && !end.get(id).ok)
  return { first: f, end: e, total, closure: total > f ? (e - f) / (total - f) : null, stuck: stuck.length, early: stuck.filter(([, c]) => c.origin < round).length, firstFailEarly: [...first.values()].filter(c => !c.ok && c.origin < round).length }
}
const pct = x => x === null ? "—" : `${Math.round(100 * x)}%`
const cell = r => r ? `${r.first} → ${r.end} / ${r.total} (${pct(r.closure)}) | ${r.stuck} | ${r.early} of ${r.firstFailEarly}` : "— | — | —"
const out = ["# Closure each round: the control group beside IC", "", "Closure = (end − first delivery) / (cases − first delivery). Then: cases failing at first delivery and at the end; and those of them from an earlier round, of the earlier-round cases failing at first delivery (the build check counts as earlier).", ""]

// The control.
const restarted = []
const control = readdirSync(RUNS).filter(d => /^exp2-review15-luna56-low-revmed-rep\d-dpipe-20261022$/u.test(d))
for (const d of control) {
  const name = d.match(/rep\d/u)[0], dir = join(RUNS, d)
  out.push(`## Control ${name} (${d})`, "", "| round | first (diag-first) → end (official) / cases (closure) | failing first and at end | earlier-round of them | first (diag-first) → end (diag) / cases (closure) | failing first and at end | earlier-round of them |", "|---|---|---|---|---|---|---|")
  for (let r = 1; r <= 15; r++) {
    // A round restarted scores its first delivery again: the last entry of the round, the attempt that went on to the end.
    const fd = (existsSync(join(dir, "logs", "scores-diag-first.jsonl")) ? readFileSync(join(dir, "logs", "scores-diag-first.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l)) : []).filter(x => x.round === r).at(-1)
    const pad = String(r).padStart(2, "0"), first = read(fd ? join(dir, "official-diag-first", `round-${pad}`, fd.commit.slice(0, 12), "verifier.log") : one(join(dir, "official-diag-first", `round-${pad}`)) ?? "")
    if (fd && readdirSync(join(dir, "official-diag-first", `round-${pad}`)).length > 1) restarted.push(`${name} R${r}: ${readdirSync(join(dir, "official-diag-first", `round-${pad}`)).length} first deliveries scored (a restarted round), the last taken`)
    const a = row(r, first, read(one(join(dir, "official", `round-${pad}`)) ?? "")), b = row(r, first, read(one(join(dir, "official-diag", `round-${pad}`)) ?? ""))
    out.push(`| R${r} | ${cell(a)} | ${cell(b)} |`)
  }
  out.push("")
}

if (restarted.length) out.push(...restarted.map(x => `- ${x}.`), "")
// IC: the six-round runs (and the shorter ones).
const ic = readdirSync(RUNS).filter(d => /^exp2-icacc-r6-luna56-low-rep1[j-q]-2026102\d$/u.test(d)).sort()
out.push("## IC runs (official/ for both, the commits scores.jsonl names)", "", "| run | round | first → end / cases (closure) | failing first and at end | earlier-round of them |", "|---|---|---|---|---|")
for (const d of ic) {
  const dir = join(RUNS, d), name = d.match(/rep1[a-z]/u)[0]
  const scores = existsSync(join(dir, "checkpoints", "scores.jsonl")) ? readFileSync(join(dir, "checkpoints", "scores.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l)) : []
  for (let r = 1; r <= 6; r++) {
    const f = scores.find(x => x.round === r && x.kind === "first_delivery"), e = scores.find(x => x.round === r && !x.kind)
    if (!f || !e) continue
    const log = c => read(join(dir, "official", `round-0${r}`, c.commit.slice(0, 12), "verifier.log"))
    out.push(`| ${name} | R${r} | ${cell(row(r, log(f), log(e)))} |`)
  }
}
out.push("")
// The scorers.
const s = (d, f) => existsSync(join(RUNS, d, "bin", f)) ? readFileSync(join(RUNS, d, "bin", f), "utf8") : ""
const c0 = control[0], strip = t => t.replace(/^\/\/ DIAGNOSTIC ONLY[^\n]*\n/u, "").replace(/"official-diag(-first)?"/gu, '"official"').replace(/"--mount", "type=bind,source=C:\/Users\/HuaWeiClient\/go\/pkg\/mod,target=\/gomod,readonly", "-e", "GOMODCACHE=\/gomod", "-e", "GOPROXY=off", "-e", "GOFLAGS=-mod=mod", /u, "").replace(/, verifier_log: [^}]*\}/u, " }")
const same = (a, b) => strip(a).trim() === strip(b).trim()
out.push("## The scorers", "",
  `- The control's score-diag-first.mjs is its score.mjs with the host Go module cache mounted read-only (GOMODCACHE, GOPROXY=off, GOFLAGS=-mod=mod) and its output under official-diag-first/: otherwise the same (${same(s(c0, "score.mjs"), s(c0, "score-diag-first.mjs")) ? "checked: identical apart from those" : "NOT identical apart from those"}).`,
  `- IC's score.mjs (rep1p) is the control's score.mjs plus the verifier log's path in its output: ${same(s(c0, "score.mjs"), s(ic.find(x => x.includes("rep1p")) ?? ic.at(-1), "score.mjs")) ? "checked: identical apart from that" : "NOT identical apart from that"}. Both mount the same official tests (theme_d5_w9…/steps/round-N/tests) in the same image.`, "")
writeFileSync(OUT, out.join("\n") + "\n", "utf8")
console.log(out.join("\n"))
