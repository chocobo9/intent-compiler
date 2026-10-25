// The one table a user reads after a real run (independent review, third round, §1): `<run dir>/prereg.md`, eight
// items. Zero cost: the run's state, its scores, the verifier logs (case names and requirement_ref only) and git.
//   1 code: the src commits since the base commit, each [mech] or [behav] (subject prefix, else commit-kinds.json), and
//     how many behavioural batches they make;
//   2 R1, R2 closure: (round's end − first delivery) / (cases − first delivery); lines R1 ≥ 52%, R2 ≥ 81%;
//   3 the ledger, each round: the cases failing at first delivery and at the round's end, in four kinds —
//     (i) their op named by none of the round's review items (recall2.py's rule: the last part of requirement_ref as a
//     word of the items' text; rename-drop by rename or drop); (iii) an item naming it was fixed and lost: on a cycle
//     later reverted (revert-cost.json's lost list) or its guard failing at the round's end; (iv) an item naming it was
//     touched and not fixed; (ii) an item naming it was untouched (outcome.mjs's output rule: fixed when its check
//     passes, untouched when its output digest is the one it was sent at, else touched; its last judged sending of the
//     round); the rest: named, but no item naming it ended touched or untouched (fixed by its own check, or never sent);
//     one kind per case, in the order iii, iv, ii;
//   4 R5 ≥ 656, R6 ≥ 688;
//   5 R3–R6 review request characters ≤ 598,799 (rep1j);
//   6 conservation 0, no_input ≤ 2 a round;
//   7 the batch's own pre-registered lines (--lines batch3|batch4|batch5), each 过 / 不过 / 未证明;
//   8 one word for the run: 未证明 when the code is not one behavioural batch; else 不过 when any of 2, 4, 7 does not
//     pass; else 真实成立（一次）.
// Usage (dev worktree): node exp2/evidence/prereg/prereg.mjs <run dir> --base <commit> --code <commit> --lines <set>
//   [--report <set>] [--pair <run dir>] [--rep1j <dir>] [--rep1o <dir>] [--revert-cost <json>]   (writes <run dir>/prereg.md)
// --pair: another run of the same code; its numbers (from the data line of its prereg.md) beside this run's, each
// run's own, no mean.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2), dir = argv.shift()
const opt = k => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined }
const RUNS = dirname(dir)
const runDir = name => join(RUNS, (existsSync(RUNS) ? execFileSync("ls", [RUNS], { encoding: "utf8" }) : "").split("\n").find(d => d.includes(`-${name}-`)) ?? name)
const BASE = opt("base"), CODE = opt("code"), LINES = opt("lines"), REPORT = opt("report"), PAIR = opt("pair")
const J = opt("rep1j") ?? runDir("rep1j"), O = opt("rep1o") ?? runDir("rep1o")
const COST = opt("revert-cost") ?? join(HERE, "..", "rep1o-2026-10-25", "revert-cost.json")
const short = d => basename(d).replace(/^exp2-icacc-r\d-luna56-low-/u, "").replace(/-\d{8}$/u, "")
const lines = f => existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : []
const load = d => ({ d, name: short(d), s: JSON.parse(readFileSync(join(d, "state", "exp2-state.json"), "utf8")), scores: lines(join(d, "checkpoints", "scores.jsonl")), measures: lines(join(d, "checkpoints", "measures.jsonl")) })
const run = load(dir), rounds = [...run.s.executions].sort((a, b) => a.round - b.round)
const score = (r, n, kind) => r.scores.find(x => x.round === n && (kind ? x.kind === kind : !x.kind))
const cases = (r, n, kind) => {
  const sc = score(r, n, kind), log = sc && join(r.d, "official", `round-0${n}`, sc.commit.slice(0, 12), "verifier.log")
  const out = new Map()
  if (log && existsSync(log)) for (const m of readFileSync(log, "utf8").matchAll(/CASE_RESULT case_id=(\S+) origin_step=round-0?(\d+) requirement_ref=(\S+)[^\n]*? status=(\S+)/gu)) out.set(m[1], { id: m[1], origin: +m[2], ref: m[3], ok: m[4] === "success" })
  return out
}
const word = ok => ok === null ? "未证明" : ok ? "过" : "不过"
const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : "—"
const out = [`# ${run.name}: the pre-registered table`, ""]

// 1. Code.
const kinds = JSON.parse(readFileSync(join(HERE, "commit-kinds.json"), "utf8"))
const repo = join(HERE, "..", "..", "..")
const commits = BASE && CODE ? execFileSync("git", ["-C", repo, "log", "--format=%h %s", `${BASE}..${CODE}`, "--", "src"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map(l => {
  const [h, ...rest] = l.split(" "), subject = rest.join(" "), tag = subject.match(/^\[(mech|behav)\]/u)?.[1]
  const known = Object.entries(kinds).find(([k]) => !k.startsWith("_") && h.startsWith(k))?.[1]
  return { h, subject, kind: tag ?? known?.[0] ?? "untagged", batch: known?.[1] ?? (tag ? subject.match(/batch \d+/u)?.[0] ?? "—" : "—") }
}) : []
const behavBatches = [...new Set(commits.filter(c => c.kind === "behav").map(c => c.batch))]
const untagged = commits.filter(c => c.kind === "untagged")
out.push("## 1. Code", "", `${commits.length} src commits from ${BASE} to ${CODE}; behavioural batches: ${behavBatches.length}${behavBatches.length ? ` (${behavBatches.join(", ")})` : ""}${untagged.length ? `; untagged: ${untagged.length}` : ""}.`, "", ...commits.map(c => `- ${c.h} [${c.kind}] ${c.batch}: ${c.subject.replace(/^\[(mech|behav)\]\s*/u, "")}`), "")

// 2. Closure.
const closure = n => { const f = score(run, n, "first_delivery"), e = score(run, n); return f && e ? { first: f.passed, end: e.passed, total: e.total, rate: (e.passed - f.passed) / (e.total - f.passed) } : null }
const c1 = closure(1), c2 = closure(2)
const L2 = [c1 ? c1.rate >= 0.52 : null, c2 ? c2.rate >= 0.81 : null]
out.push("## 2. Closure in R1 and R2", "", "| round | first delivery → end / cases | closure | line | |", "|---|---|---|---|---|",
  ...[[1, c1, "≥ 52%", L2[0]], [2, c2, "≥ 81%", L2[1]]].map(([n, c, l, ok]) => `| R${n} | ${c ? `${c.first} → ${c.end} / ${c.total}` : "—"} | ${c ? pct(c.end - c.first, c.total - c.first) : "—"} | ${l} | ${word(ok)} |`), "")

// 3. The ledger.
const costRows = existsSync(COST) ? JSON.parse(readFileSync(COST, "utf8")) : []
const opOf = ref => ref.split(".").at(-1)
const mentions = (text, op) => new RegExp(`\\b${op.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u").test(text) || (op === "rename-drop" && (text.includes("rename") || text.includes("drop")))
const outcomes = e => {
  const sentAt = new Map((e.carried_in ?? []).map(c => [c.id, c.digest ?? ""])), last = new Map()
  for (const c of e.cycles) for (const it of c.items ?? []) {
    if (it.outcome === "reverted") continue
    if (sentAt.has(it.id) && it.action !== "blocked" && it.verdict !== "unverified") last.set(it.id, it.verdict === "pass" ? "fixed" : it.digest === sentAt.get(it.id) ? "untouched" : "touched")
    if (it.verdict === "pass") sentAt.delete(it.id)
    if (it.action === "send") sentAt.set(it.id, it.digest)
  }
  return last
}
out.push("## 3. Ledger: cases failing at first delivery and at the round's end", "", "| round | failing first and at the end | (i) op not named | (ii) untouched | (iii) fixed and lost | (iv) touched, not fixed | named, otherwise | largest |", "|---|---|---|---|---|---|---|---|")
const ledger = {}
for (const e of rounds) {
  const n = e.round, first = cases(run, n, "first_delivery"), end = cases(run, n)
  const stuck = [...first.values()].filter(c => !c.ok && end.get(c.id) && !end.get(c.id).ok)
  const items = (e.review_items ?? []).filter(i => i.round === n), text = items.map(i => i.text).join(" ").toLowerCase()
  const oc = outcomes(e), finalIds = new Set((e.final ?? []).map(f => f.id))
  const lost = new Set(costRows.filter(r => r.run === run.name && r.round === n).flatMap(r => r.lost))
  const k = { i: 0, ii: 0, iii: 0, iv: 0, other: 0 }
  for (const c of stuck) {
    const op = opOf(c.ref)
    if (!mentions(text, op)) { k.i++; continue }
    const on = items.filter(i => mentions(i.text.toLowerCase(), op))
    if (on.some(i => lost.has(i.id) || (i.guard && finalIds.has(i.guard)))) k.iii++
    else if (on.some(i => oc.get(i.id) === "touched")) k.iv++
    else if (on.some(i => oc.get(i.id) === "untouched")) k.ii++
    else k.other++
  }
  const top = Object.entries({ "(i)": k.i, "(ii)": k.ii, "(iii)": k.iii, "(iv)": k.iv }).sort((a, b) => b[1] - a[1])[0]
  ledger[n] = k
  out.push(`| R${n} | ${stuck.length} | ${k.i} | ${k.ii} | ${k.iii} | ${k.iv} | ${k.other} | ${stuck.length ? `${top[0]} ${top[1]}` : "—"} |`)
}
out.push("")

// 4–6.
const s5 = score(run, 5), s6 = score(run, 6)
const L4 = [s5 ? s5.passed >= 656 : null, s6 ? s6.passed >= 688 : null]
const chars = r => r.s.review_calls.filter(c => c.round >= 3).reduce((x, c) => x + (c.request_chars ?? 0), 0)
const ch = chars(run), L5 = rounds.some(e => e.round >= 6) ? ch <= 598799 : null
const meas = n => run.measures.find(m => m.round === n)?.items ?? {}
const cons = rounds.reduce((a, e) => a + (meas(e.round).conservation_errors ?? 0), 0), noi = rounds.map(e => meas(e.round).no_input ?? 0)
const L6 = cons === 0 && noi.every(x => x <= 2)
out.push("## 4–6. Late scores, cost, interfaces", "",
  `- 4. R5 ${s5?.passed ?? "—"} (line ≥ 656): ${word(L4[0])}; R6 ${s6?.passed ?? "—"} (line ≥ 688): ${word(L4[1])}.`,
  `- 5. R3–R6 review request characters ${ch.toLocaleString("en-US")} (line ≤ 598,799, rep1j): ${word(L5)}.`,
  `- 6. Conservation errors ${cons}; no_input by round ${noi.join(", ")} (line 0 and ≤ 2 a round): ${word(L6)}.`, "")

// 7. The batch's lines.
const J1 = existsSync(J) ? load(J) : null, O1 = existsSync(O) ? load(O) : null
const SETS = {
  batch3: () => {
    let ut = 0, judged = 0
    for (const e of rounds) { const a = e.accept?.repairs?.after_untouched; if (a) { ut += a.untouched; judged += a.judged } }
    return [{ line: "still untouched after the untouched message ≤ 26%", value: `${ut}/${judged} (${pct(ut, judged)})`, ok: judged ? ut / judged <= 0.26 : null }]
  },
  batch4: () => {
    const r2 = [...cases(run, 2).values()].filter(c => c.origin === 1 && !c.ok).length
    const cross = rounds.flatMap(e => { const f = join(dir, "checkpoints", `round-0${e.round}`, "report.json"); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).zones?.package?.units?.cross ?? [] : [] })
    const dl = cross.reduce((a, u) => a + u.delivered.length, 0), inv = cross.reduce((a, u) => a + u.objects.length, 0)
    const gaps = J1 ? rounds.map(e => (score(run, e.round)?.passed ?? 0) - (score(J1, e.round)?.passed ?? 0)) : []
    const cj = J1 ? chars(J1) : null
    // A finding's requirement_ref: its check's subcommand; for transform, the recipe's first op (as rep1o's table read it).
    const items = new Map(run.s.executions.flatMap(e => e.review_items ?? []).map(i => [i.id, i]))
    const refOf = check => { const a = check?.input?.args ?? [], cmd = a[0]; if (cmd !== "transform") return cmd ?? null; const ri = a.indexOf("--recipe"), f = ri >= 0 ? check.input.files.find(x => x.path === a[ri + 1]) : null; try { const op = JSON.parse(f.content)[0].op; return `transform.${op === "unpivot" ? "pivot" : op === "rename" || op === "drop" ? "rename-drop" : op}` } catch { return "transform" } }
    const findings = rounds.flatMap(e => (e.accept?.lists?.findings ?? []).map(id => ({ round: e.round, id })))
    const withLoss = findings.filter(f => { const ref = refOf(items.get(f.id)?.check); return [...cases(run, f.round, "first_delivery").values()].some(c => !c.ok && c.ref === ref && c.origin < f.round) })
    return [
      { line: "R1 cases failing at the end of R2 ≤ 1", value: String(r2), ok: r2 <= 1 },
      { line: "units across commands delivered 100%", value: `${dl}/${inv}`, ok: inv ? dl === inv : null },
      { line: "score − rep1j's ≤ 2 every round, and R3–R6 review requests ≥ 30% below rep1j's", value: `${gaps.join(", ")}; ${ch.toLocaleString("en-US")} against ${cj?.toLocaleString("en-US") ?? "—"}`, ok: J1 ? gaps.every(g => Math.abs(g) <= 2) && ch <= 0.7 * cj : null },
      { line: "findings brought by the lists with official cases failing on their requirement_ref (0: the lists are withdrawn)", value: `${withLoss.length} of ${findings.length}`, ok: rounds.some(e => e.accept?.lists) ? withLoss.length > 0 : null },
    ]
  },
  batch5: () => {
    const OREV = { 2: 2, 3: 3, 4: 3, 5: 2, 6: 3 }
    const left = rounds.map(e => ({ n: e.round, left: (e.final ?? []).filter(f => (e.accept?.guards?.flipped_unchanged ?? []).includes(f.id)).length }))
    const raised = rounds.reduce((a, e) => a + (e.accept?.repairs?.regressions?.raised ?? 0), 0), fixedNext = rounds.reduce((a, e) => a + (e.accept?.repairs?.regressions?.fixed_next ?? 0), 0)
    return [
      { line: "regressions left at a round's end ≤ rep1o's reverts that round (R2 2, R3 3, R4 3, R5 2, R6 3)", value: left.filter(x => x.n >= 2).map(x => `R${x.n} ${x.left}`).join(", "), ok: left.filter(x => x.n >= 2).every(x => x.left <= OREV[x.n]) },
      { line: "regressions fixed on the next cycle / raised ≥ 50%", value: `${fixedNext}/${raised} (${pct(fixedNext, raised)})`, ok: raised ? fixedNext / raised >= 0.5 : null },
      { line: "R5 ≥ 656 and R6 ≥ 688", value: `${s5?.passed ?? "—"}, ${s6?.passed ?? "—"}`, ok: L4[0] === null || L4[1] === null ? null : L4[0] && L4[1] },
      { line: "R3–R6 review request characters ≤ 599k", value: ch.toLocaleString("en-US"), ok: L5 },
    ]
  },
}
const L7 = LINES ? SETS[LINES]() : []
out.push(`## 7. The batch's lines (${LINES ?? "none"})`, "", "| line | value | |", "|---|---|---|", ...L7.map(l => `| ${l.line} | ${l.value} | ${word(l.ok)} |`), "")
if (REPORT) for (const set of REPORT.split(",")) out.push(`Reported, not judged (${set}):`, "", "| line | value |", "|---|---|", ...SETS[set]().map(l => `| ${l.line} | ${l.value} |`), "")
if (run.name === "rep1p" || rounds.some(e => e.accept?.repairs?.regressions)) {
  out.push("Regressions by round (batch 5 A): raised / fixed on the next cycle / still failing then; the reviewer's word on those.", "", "| round | raised | fixed next | persisted | superseded / upheld / unasked |", "|---|---|---|---|---|",
    ...rounds.map(e => { const r = e.accept?.repairs?.regressions; return `| R${e.round} | ${r?.raised ?? "—"} | ${r?.fixed_next ?? "—"} | ${r?.persisted ?? "—"} | ${r ? `${r.adjudicated.superseded} / ${r.adjudicated.upheld} / ${r.adjudicated.unasked}` : "—"} |` }), "")
}

// The numbers behind the table, for a later run of the same code to set beside its own (--pair).
const data = { run: run.name, code: CODE, closure: { 1: c1, 2: c2 }, ledger, late: { 5: s5?.passed ?? null, 6: s6?.passed ?? null }, chars: ch, lines: L7.map(l => ({ line: l.line, value: l.value, word: word(l.ok) })) }
if (PAIR) {
  const other = readFileSync(join(PAIR, "prereg.md"), "utf8").match(/<!-- prereg-data (.*) -->/u)
  if (!other) throw new Error(`${PAIR}/prereg.md has no data line: run prereg.mjs on it first`)
  const a = JSON.parse(other[1]), b = data
  const cl = (x, n) => x.closure[n] ? `${x.closure[n].first} → ${x.closure[n].end} (${pct(x.closure[n].end - x.closure[n].first, x.closure[n].total - x.closure[n].first)})` : "—"
  const lg = (x, n) => { const k = x.ledger[n]; return k ? `${k.i} / ${k.ii} / ${k.iii} / ${k.iv} / ${k.other}` : "—" }
  out.push(`## Two runs of the same code: ${a.run} and ${b.run}`, "", `Each run's own numbers; no mean. Code: ${a.code ?? "—"} and ${b.code ?? "—"}.`, "", `| | ${a.run} | ${b.run} |`, "|---|---|---|",
    ...b.lines.map((l, i) => `| ${l.line} | ${a.lines[i] ? `${a.lines[i].value}: ${a.lines[i].word}` : "—"} | ${l.value}: ${l.word} |`),
    `| R1 closure (≥ 52%) | ${cl(a, 1)} | ${cl(b, 1)} |`, `| R2 closure (≥ 81%) | ${cl(a, 2)} | ${cl(b, 2)} |`,
    ...[1, 2, 3, 4, 5, 6].map(n => `| R${n} ledger i / ii / iii / iv / other | ${lg(a, n)} | ${lg(b, n)} |`),
    `| R5 (≥ 656) | ${a.late[5] ?? "—"} | ${b.late[5] ?? "—"} |`, `| R6 (≥ 688) | ${a.late[6] ?? "—"} | ${b.late[6] ?? "—"} |`,
    `| R3–R6 review request characters (≤ 598,799) | ${a.chars.toLocaleString("en-US")} | ${b.chars.toLocaleString("en-US")} |`, "",
    `A line both runs pass is 真实成立 for this code; one pass and one not, 未证明; both not, 不过: ${b.lines.map((l, i) => `${l.line.split(" ").slice(0, 3).join(" ")}… ${a.lines[i]?.word === "过" && l.word === "过" ? "真实成立" : a.lines[i]?.word === "不过" && l.word === "不过" ? "不过" : "未证明"}`).join("; ")}.`, "")
}

// 8. One word.
const passes = [...L2, ...L4, ...L7.map(l => l.ok)]
const verdict = behavBatches.length !== 1 ? `未证明（原因：代码含 ${behavBatches.length} 个行为批次${behavBatches.length ? `：${behavBatches.join("、")}` : ""}）` : passes.some(x => x === false) ? "不过（见第 3 项）" : passes.some(x => x === null) ? "未证明（原因：有线未能判定）" : "真实成立（一次）"
out.push("## 8. The run", "", verdict, "")
out.push(`<!-- prereg-data ${JSON.stringify(data)} -->`)
writeFileSync(join(dir, "prereg.md"), out.join("\n") + "\n", "utf8")
console.log(out.join("\n"))
