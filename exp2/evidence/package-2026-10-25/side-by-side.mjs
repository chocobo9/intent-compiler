// R1–R2 of several runs side by side (rep1j, rep1l, rep1m): the B-row numbers, the package, R2's failures by the
// cases' requirement_ref (their names only), and which R2 commands and transforms the first delivery of R2 wrote.
// Usage: node exp2/evidence/package-2026-10-25/side-by-side.mjs <run dir> [<run dir> …]
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"

const R2_FEATURES = ["profile", "compare", "deduplicate", "split", "assert", "normalize", "encode", "rollup", "detect", "bin", "hash"]
const lines = f => existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : []
for (const dir of process.argv.slice(2)) {
  const name = basename(dir).replace(/^exp2-icacc-r6-luna56-low-/u, "").replace(/-\d{8}$/u, "")
  const s = JSON.parse(readFileSync(join(dir, "state", "exp2-state.json"), "utf8"))
  const scores = lines(join(dir, "checkpoints", "scores.jsonl")), measures = lines(join(dir, "checkpoints", "measures.jsonl"))
  for (const r of [1, 2]) {
    const e = s.executions.find(x => x.round === r), m = measures.find(x => x.round === r)
    const rep = JSON.parse(readFileSync(join(dir, "checkpoints", `round-0${r}`, "report.json"), "utf8"))
    const final = scores.find(x => x.round === r && !x.kind), first = scores.find(x => x.round === r && x.kind === "first_delivery")
    const flips = e.accept?.guards.flips ?? [], p = rep.zones.package
    const use = p?.utilization
    console.log(`${name} R${r}: official ${final?.passed} (first delivery ${first?.passed}); flips ${flips.length} (regressions ${flips.filter(f => f.how === "regression").length}), reverted ${e.accept?.reverted ?? 0}; reviews ${e.accept?.reviews.length} (survivors ${e.accept?.reviews.map(v => v.sent).join(",")}); review request chars ${s.review_calls.filter(c => c.round === r).reduce((n, c) => n + (c.request_chars ?? 0), 0)}; uncached formalizer ${m?.tokens.formalizer.uncached_input} reviewer ${m?.tokens.reviewer.uncached_input}; conservation errors ${m?.items?.conservation_errors} no_input ${m?.items?.no_input}; package ${rep.zones.source_chars} chars${p?.segments ? `, ${p.segments.length} paragraphs, ${new Set(p.segments.map(x => x.object)).size} objects` : p?.objects ? `, ${p.objects.length} objects` : ""}${use ? `; use objects ${use.objects.in_package}/${use.objects.total}, paragraphs ${use.paragraphs.cited}/${use.paragraphs.total}` : ""}`)
  }
  // R2's failures by requirement_ref, from the verifier log of the scored final commit.
  const final2 = scores.find(x => x.round === 2 && !x.kind)
  if (final2) {
    const log = readFileSync(join(dir, "official", "round-02", final2.commit.slice(0, 12), "verifier.log"), "utf8")
    const by = {}
    for (const m of log.matchAll(/CASE_RESULT case_id=\S+ origin_step=(\S+) requirement_ref=(\S+)[^\n]*? status=fail\b/gu)) { const k = `${m[1].replace("round-", "R")} ${m[2]}`; by[k] = (by[k] ?? 0) + 1 }
    console.log(`${name} R2 failures: ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`)
  }
  // Which of R2's new commands and transforms the first delivery of R2 wrote (the dispatch cases its diff added).
  const e2 = s.executions.find(x => x.round === 2), c1 = e2.cycles[0]
  const diff = execFileSync("git", ["-C", join(dir, "app"), "diff", "-U0", e2.base, c1.commit, "--", "*.go"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const added = R2_FEATURES.filter(f => new RegExp(`^\\+.*case "${f}"`, "mu").test(diff))
  console.log(`${name} R2 first delivery (${c1.id}) wrote: ${added.join(", ") || "none"}; missing: ${R2_FEATURES.filter(f => !added.includes(f)).join(", ") || "none"}; output tokens ${c1.usage?.output_tokens}`)
  console.log("")
}
