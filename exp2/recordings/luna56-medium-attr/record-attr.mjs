// Records IC attribution R1..R15 with gpt-5.6-luna-fast (variant medium) through the isolated management server,
// using the run code at project-exp2-run (3e21ed0). Every call goes into a cassette. Stops at the first round that
// does not pass within its repair limit.
//   node record-attr.mjs [to-round]
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
const CODE = "file:///D:/huawei/intent_compiler/project-exp2-run/dist/exp2/"
const { openCodeHttpClient } = await import(CODE + "local-config.js")
const { createOpenCodeAttributionTransport } = await import(CODE + "transport.js")
const { emptyCassette, loadCassette, recordingTransports } = await import(CODE + "recording.js")
const { Exp2Store } = await import(CODE + "store.js")

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const to = Number(process.argv[2] ?? 15)
const server = { server_url: "http://127.0.0.1:45961", directory: "D:/huawei/EvoCodeBench/harbor_runs/exp2-ic-luna-dpipe-20261021-c83d99b7/management", provider: "openai", model: "gpt-5.6-luna-fast", variant: "medium", request_timeout_ms: 1_800_000 }
const transport = createOpenCodeAttributionTransport({ client: openCodeHttpClient(server), directory: server.directory, providerId: "openai", modelId: "gpt-5.6-luna-fast", variant: "medium", timeoutMs: 1_800_000 }, { delaysMs: [15_000, 45_000, 120_000] })
const file = join(ROOT, "cassette.json")
const cassette = existsSync(file) ? loadCassette(file) : emptyCassette("gpt-5.6-luna-fast medium (real, exp2 attribution recording)")
const recorded = recordingTransports({ attribution: transport, checks: async () => { throw new Error("checks not recorded here") } }, cassette, file)
const store = new Exp2Store(join(ROOT, "store"), "rec-luna56-medium-attr")
const done = store.inspect().rounds.filter(r => r.status === "accepted").map(r => r.round)
const pad = n => String(n).padStart(2, "0")
for (let r = (done.length ? Math.max(...done) : 0) + 1; r <= to; r++) {
  const text = readFileSync(`D:/huawei/intent_compiler/project-exp2-run/exp2/inputs/dpipe/round-${pad(r)}.md`, "utf8")
  const rec = await store.ingestRound(r, text, recorded.attribution, { maxRepairs: 2 })
  const s = store.inspect()
  const calls = s.calls.filter(c => c.round === r)
  const line = { round: r, status: rec.status, calls: calls.length, issues: calls.map(c => (c.issues ?? []).map(i => i.code)), usage: calls.map(c => c.usage) }
  writeFileSync(join(ROOT, "rounds.jsonl"), JSON.stringify(line) + "\n", { flag: "a" })
  console.log(JSON.stringify(line))
  if (rec.status !== "accepted") break
}
