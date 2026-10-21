// One structured call to gpt-5.6-luna-fast (variant medium) through the isolated management OpenCode server.
//   node luna-call.mjs <prompt-file> <schema-module-export: file.mjs#NAME> <out-file>
// Writes the structured answer to out-file and the usage to out-file.usage.json. No header timeout.
import http from "node:http"
import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
const [promptFile, schemaRef, out, MODEL = "gpt-5.6-luna-fast", VARIANT = "medium"] = process.argv.slice(2)
// SKIP_DONE: an answer already written (by a parallel worker) is not asked for again.
import { existsSync } from "node:fs"
if (existsSync(out)) { console.log("ok skip", out); process.exit(0) }
const [mod, name] = schemaRef.split("#")
const schema = (await import(pathToFileURL(mod).href))[name]
const SERVER = "http://127.0.0.1:45961", DIR = "D:/huawei/EvoCodeBench/harbor_runs/exp2-ic-luna-dpipe-20261021-c83d99b7/management"
const q = `?directory=${encodeURIComponent(DIR)}`
const post = (path, body) => new Promise((done, fail) => {
  const req = http.request(new URL(SERVER + path), { method: "POST", headers: { "Content-Type": "application/json" } }, r => { let d = ""; r.setEncoding("utf8"); r.on("data", c => { d += c }); r.on("end", () => done({ status: r.statusCode, text: d })) })
  req.on("error", fail); req.end(JSON.stringify(body))
})
const session = JSON.parse((await post(`/session${q}`, { title: "exp2 judge experiment" })).text)
const started = Date.now()
const r = await post(`/session/${session.id}/message${q}`, { model: { providerID: "openai", modelID: MODEL }, variant: VARIANT, parts: [{ type: "text", text: readFileSync(promptFile, "utf8") }], format: { type: "json_schema", schema, retryCount: 1 } })
const j = JSON.parse(r.text)
if (r.status >= 300 || j.info?.error) { console.error(r.status, JSON.stringify(j.info?.error ?? r.text.slice(0, 500))); process.exit(1) }
writeFileSync(out, JSON.stringify(j.info.structured, null, 1))
writeFileSync(out + ".usage.json", JSON.stringify({ seconds: Math.round((Date.now() - started) / 1000), tokens: j.info.tokens, session: session.id }))
console.log("ok", Math.round((Date.now() - started) / 1000), "s", JSON.stringify(j.info.tokens))
