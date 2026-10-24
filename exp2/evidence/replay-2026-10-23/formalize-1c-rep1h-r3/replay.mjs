// Batch 1c acceptance: rep1h R3's three reviews, formalized with the old request (recorded replies) and the new one (live calls).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
const P = "file:///D:/huawei/intent_compiler/project-exp2-dev/dist/"
const { Exp2Store } = await import(P + "exp2/store.js")
const F = await import(P + "exp2/formalize.js")
const { roundPackage } = await import(P + "exp2/view.js")
const { codeFacts } = await import(P + "exp2/checks.js")
const { DockerRunner, DockerScriptSandbox, dockerGoBuilder } = await import(P + "exp2/docker.js")
const { sessionInput } = await import(P + "exp2/materials.js")
const { reviewEntries } = await import(P + "exp2/review.js")
const { openCodeHttpClient, roleOptions } = await import(P + "exp2/local-config.js")
const { createOpenCodeFormalizeTransport } = await import(P + "exp2/transport.js")
const H = "D:/huawei/EvoCodeBench/harbor_runs/exp2-icacc-r1-luna56-low-rep1h-20261024", OUT = process.argv[2]
const cfg = JSON.parse(readFileSync(H + "/local-config.json", "utf8"))
const st = new Exp2Store(H + "/state", cfg.run_id), s = st.inspect(), reg = st.registry(), facts = codeFacts(reg, 3)
const saved = JSON.parse(readFileSync(OUT + "/materials.json", "utf8"))
const pkg = roundPackage(reg, 3, saved.units)
const docker = { ...cfg.runner, cover: true }
const runner = new DockerRunner(docker), sandbox = new DockerScriptSandbox(docker), build = dockerGoBuilder(OUT + "/builds", docker, undefined, "dpipe")
const mgmt = { client: openCodeHttpClient(cfg.management), directory: cfg.management.directory, providerId: cfg.management.provider, modelId: cfg.management.model, variant: cfg.management.variant, timeoutMs: cfg.management.request_timeout_ms }
const live = createOpenCodeFormalizeTransport(roleOptions(mgmt, cfg, "formalize"))
const programs = {}
const programAt = commit => {
  if (programs[commit]) return programs[commit]
  const wd = join(OUT, "trees", commit.slice(0, 8)); rmSync(wd, { recursive: true, force: true }); mkdirSync(wd, { recursive: true })
  execFileSync("git", ["-C", H + "/app", "worktree", "add", "--detach", wd, commit], { stdio: "ignore" })
  const b = build(wd, commit.slice(0, 8)); if (!b.ok) throw new Error(b.output)
  return programs[commit] = b.program
}
const block = new Set(F.DEFAULT_PREMISE_BLOCK)
async function outcome(rc, transport, pkgArg) {
  const m = saved.out[rc.review].materials
  const f = await F.formalizeReview(reg, 3, rc.response_text, "dpipe", transport, { reviewId: `R3.${rc.review}`, callId: k => `X${rc.review}.${k}`, materials: m, ...(pkgArg ? { pkg: pkgArg } : {}) })
  const program = programAt(rc.commit)
  const d = { calls: f.calls.map(c => c.request_chars), items: f.items.length, malformed: f.malformed.length, no_input: 0, sent: 0, logged_sent: 0, fallback: 0, blocked: {}, free: 0 }
  for (const it of f.items) {
    if (it.input && it.produced?.length) for (const pr of it.produced) { const o = await runner.run(program, sessionInput(pr.by, m), 60000); if (o.files[pr.path] !== undefined) it.input.files.push({ path: pr.path, content: o.files[pr.path] }) }
    const a = await F.assessPremises(reg, 3, it, sandbox, 60000)
    if (a.failures.some(x => x.premise === "no_input")) d.no_input++
    const stop = a.failures.find(x => block.has(x.premise)), own = a.failures.find(x => !block.has(x.premise) && F.OWN_FAILURES.has(x.premise))
    if (stop) { d.blocked[stop.premise] = (d.blocked[stop.premise] ?? 0) + 1; continue }
    if (a.check) {
      const rep = await F.reproduces(F.itemCheckRecord(`V3.${rc.review}.${it.item}`, 3, it, a.check), program, runner, 3, reg, facts, 60000)
      if (rep.reproduced) d.sent++; else d.blocked.not_reproduced = (d.blocked.not_reproduced ?? 0) + 1
    } else if (own) d.fallback++
    else d.free++
  }
  const handled = new Set([...f.items.map(i => i.item), ...f.malformed.filter(x => x.item !== null).map(x => x.item)])
  d.entries = reviewEntries(rc.response_text).length
  d.not_formalized = Math.max(0, d.entries - handled.size)
  d.fallback += new Set(f.malformed.filter(x => x.item !== null).map(x => x.item)).size + d.not_formalized
  return d
}
const res = {}
for (const rc of s.review_calls.filter(c => c.round === 3)) {
  const recorded = s.formalize_calls.filter(c => c.review === `R3.${rc.review}`)
  let n = 0
  const replay = async () => ({ text: recorded[Math.min(n++, recorded.length - 1)].response_text, usage: { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 }, stub: true, model: "replay" })
  const old = await outcome(rc, replay, null)
  const usage = []
  const neu = await outcome(rc, async r => { const x = await live(r); usage.push(x.usage); return x }, pkg)
  res[`R3.${rc.review}`] = { review_request: rc.request_chars, old, new: neu, usage }
  console.log(`R3.${rc.review}`, JSON.stringify(res[`R3.${rc.review}`]))
  writeFileSync(OUT + "/result.json", JSON.stringify(res, null, 1))
}
