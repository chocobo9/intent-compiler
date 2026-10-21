// Experiment 2 (prototype): repair from a correction list, verified on held-out official tests.
//   node repair.mjs <name> <source-repo> <commit>
// The fixer (gpt-5.6-luna-fast, variant medium, OpenCode build agent) gets the round's original text and the
// correction list the judge wrote for this product (Haiku probes, luna 5.6 medium judge), unedited, in one fresh
// session on a clone of the product. The result is committed and scored with the official R1 tests.
import { spawnSync } from "node:child_process"
import http from "node:http"
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const JUDGE = "C:/Users/HUAWEI~1/AppData/Local/Temp/claude/D--huawei-intent-compiler/0270a275-0a16-4459-8bb6-d30a56f9710d/scratchpad/b5/hk2/judge"
const SERVER = "http://127.0.0.1:45963"
const [name, repo, commit] = process.argv.slice(2)
const APP = join(ROOT, name, "app")
const log = o => appendFileSync(join(ROOT, "logs", "repair.jsonl"), JSON.stringify({ at: new Date().toISOString(), name, ...o }) + "\n")
const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`); return r.stdout.trim() }
const post = (path, body) => new Promise((done, fail) => {
  const req = http.request(new URL(SERVER + path), { method: "POST", headers: { "Content-Type": "application/json" } }, r => { let d = ""; r.setEncoding("utf8"); r.on("data", c => { d += c }); r.on("end", () => done({ status: r.statusCode, text: d })) })
  req.on("error", fail); req.end(JSON.stringify(body))
})

// The correction list: every item the judge marked wrong for this product, with the call, inputs and actual output.
const corrections = JSON.parse(readFileSync(join(JUDGE, "corrections-haiku-luna.json"), "utf8"))[name]
const probes = Object.fromEntries(JSON.parse(readFileSync(join(JUDGE, "probes-haiku.json"), "utf8")).probes.map(p => [p.id, p]))
const runs = JSON.parse(readFileSync(join(JUDGE, "runs-haiku.json"), "utf8"))[name]
const units = Object.fromEntries(JSON.parse(readFileSync(join(JUDGE, "r1-units.json"), "utf8")).map(u => [u.id, u.text]))
const items = corrections.map((c, i) => ({
  n: i + 1, rule: c.unit.split(/[ ,;]+/u).filter(u => units[u]).map(u => units[u].trim()), finding: c.reason,
  call: ["dpipe", ...probes[c.probe].args], input_files: probes[c.probe].files, actual: runs[c.probe],
}))
const text = readFileSync("D:/huawei/intent_compiler/project-exp2-run/exp2/inputs/dpipe/round-01.md", "utf8")
const prompt = [
  "The Go program in this directory was built from the requirements below. An independent check ran the program and compared what it did with the requirements; the correction list after the requirements is what it found. Each item gives the rule (quoted from the requirements), the call, its input files, what the program actually did, and what the checker concluded.",
  "Fix the code so that the program follows the requirements. The requirements are the authority: if an item seems to contradict them, follow the requirements. Do not change behaviour the items do not concern. Build with `go build -o dpipe ./...`.",
  "", "# Requirements", "", text, "", "# Correction list", "", JSON.stringify(items, null, 1),
].join("\n")

mkdirSync(join(ROOT, "logs"), { recursive: true })
if (!existsSync(APP)) { run("git", ["clone", "-q", repo, APP]); run("git", ["-C", APP, "checkout", "-q", commit]); run("git", ["-C", APP, "checkout", "-q", "-b", "repair"]) }
writeFileSync(join(ROOT, name, "prompt.md"), prompt)
const q = `?directory=${encodeURIComponent(APP)}`
const session = JSON.parse((await post(`/session${q}`, { title: `repair ${name}` })).text)
log({ event: "start", session: session.id, items: items.length, prompt_chars: prompt.length })
const started = Date.now()
const r = await post(`/session/${session.id}/message${q}`, { model: { providerID: "openai", modelID: "gpt-5.6-luna-fast" }, variant: "medium", agent: "build", parts: [{ type: "text", text: prompt }] })
let info = {}
try { info = JSON.parse(r.text).info ?? {} } catch {}
writeFileSync(join(ROOT, name, "reply.json"), r.text)
log({ event: "answered", status: r.status, seconds: Math.round((Date.now() - started) / 1000), error: info.error ?? null })
run("git", ["-C", APP, "add", "-A"])
run("git", ["-C", APP, "-c", "user.name=exp2-repair", "-c", "user.email=exp2@local", "commit", "-q", "--allow-empty", "-m", `repair ${name}`])
const after = run("git", ["-C", APP, "rev-parse", "HEAD"])
const score = (c, script) => { const s = spawnSync(process.execPath, [join(ROOT, "bin", script), "1", c, APP], { encoding: "utf8" }); return s.status === 0 ? JSON.parse(s.stdout.trim().split("\n").pop()) : { error: s.stderr.slice(-300) } }
log({ event: "scored", session: session.id, before: commit, after, official_before: score(commit, "score.mjs"), official_after: score(after, "score.mjs") })
console.log(name, "done")
