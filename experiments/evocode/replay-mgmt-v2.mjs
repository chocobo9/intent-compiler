// Diagnostic replay: re-send previously failed management requests through the
// CURRENT parser/schema/contract so we can separate "old parser defects" from
// "provider structured-output gap".  Read-only against old stores; results go
// to a fresh directory and never mutate run history.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { spawn, spawnSync } from "node:child_process"
import { createCompilerModelV2, V2_COMPILER_CONTRACT } from "../../dist/model/compiler-model-v2.js"
import { createOpenCodeModelTransportV2 } from "../../dist/model/opencode-transport.js"
import { createStructuredProviderTransport } from "../../dist/model/structured-provider-transport.js"
import { buildStrictCandidateSchema } from "../../dist/model/candidate-schema-strict.js"
import { atomRef } from "../../dist/core/compiled-intent.js"

const PROJECT = "D:/huawei/intent_compiler/project"
const MODEL_DIR = "D:/huawei/intent_compiler/v2-deepseek-smoke/replay-model"
const MODE = process.argv.includes("--provider") ? (process.argv[process.argv.indexOf("--provider") + 1] ?? "opencode") : "opencode"
// --cases runtime/run/request_id,... replays exactly those management records,
// including records that were accepted at the time (e.g. a run whose atom
// missed the goal).  Without --cases the original behaviour is kept: every
// record that failed under the old parser is replayed.
const CASES = process.argv.includes("--cases") ? process.argv[process.argv.indexOf("--cases") + 1] : undefined
const OUT_ARG = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : undefined
// Thinking stays on unless --thinking off is passed: thinking-off management
// runs produced empty candidates on this provider.
const THINKING = process.argv.includes("--thinking") ? process.argv[process.argv.indexOf("--thinking") + 1] : "on"
const CASE_STAMP = new Date().toISOString().replaceAll(":", "").replace(/\..+$/u, "")
const OUT_DIR = OUT_ARG !== undefined
  ? join(PROJECT, OUT_ARG)
  : CASES !== undefined
    ? join(PROJECT, `results/evocodebench/intent-on/replay-cases-${CASE_STAMP}`)
    : join(PROJECT, `results/evocodebench/intent-on/replay-2026-09-22-${MODE}`)
const STORE = join(PROJECT, "results/evocodebench/intent-on")

// {runtime, run, take: "all" | count}
const SOURCES = [
  { runtime: "runtime-r4", run: "smoke-1790078432773", take: "all" },
  { runtime: "runtime-r5", run: "smoke-1790079029212", take: "all" },
  { runtime: "runtime-r6", run: "smoke-1790084303117", take: 2 },
  { runtime: "runtime-r7", run: "smoke-1790084757304", take: "all" },
  { runtime: "runtime-r8", run: "smoke-1790085315856", take: "all" },
  { runtime: "runtime-r9", run: "smoke-1790086581064", take: "all" },
  { runtime: "runtime-r10", run: "smoke-1790086947233", take: "all" },
  { runtime: "runtime-r11", run: "smoke-1790087462076", take: "all" },
]

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, "report.jsonl"), "", "utf8")
mkdirSync(MODEL_DIR, { recursive: true })
writeFileSync(join(MODEL_DIR, "opencode.json"), `${JSON.stringify({
  $schema: "https://opencode.ai/config.json",
  model: "deepseek/deepseek-flash",
  provider: {
    deepseek: {
      models: {
        "deepseek-flash": {
          options: { reasoningEffort: "low" },
        },
      },
    },
  },
}, null, 2)}\n`, "utf8")

for (const line of readFileSync(join(PROJECT, ".env"), "utf8").split(/\r?\n/u)) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(line)
  if (match && match[1] && process.env[match[1]] === undefined) process.env[match[1]] = match[2] ?? ""
}

const records = []
if (CASES !== undefined) {
  for (const spec of CASES.split(",")) {
    const [runtime, run, requestId] = spec.trim().split("/")
    if (!runtime || !run || !requestId) throw new Error(`--cases entries must be runtime/run/request_id, got ${spec}`)
    const snapshot = JSON.parse(readFileSync(join(STORE, runtime, "store", "v2-runs", run, "snapshot.json"), "utf8"))
    const record = snapshot.management_log.find((item) => item.request_id === requestId)
    if (!record) throw new Error(`no ${requestId} in ${runtime}/${run}`)
    records.push({ runtime, run, record })
  }
} else {
  for (const source of SOURCES) {
    const snapshot = JSON.parse(readFileSync(join(STORE, source.runtime, "store", "v2-runs", source.run, "snapshot.json"), "utf8"))
    const failed = snapshot.management_log.filter((record) => record.status !== "accepted")
    const selected = source.take === "all" ? failed : failed.slice(0, source.take)
    for (const record of selected) {
      records.push({ ...source, record })
    }
  }
}
console.log(`replaying ${records.length} management request${records.length === 1 ? "" : "s"}${CASES === undefined ? " (previously failed ones)" : " (selected by --cases)"}`)

function openCodeExecutable() {
  if (process.platform !== "win32") return "opencode"
  const prefix = spawnSync("npm", ["config", "get", "prefix"], { encoding: "utf8" }).stdout?.trim()
  if (!prefix) return "opencode"
  return join(prefix, "node_modules", "opencode-ai", "bin", "opencode.exe")
}

const serverEnv = {
  ...process.env,
  OPENCODE_SERVER_USERNAME: "replay",
  OPENCODE_SERVER_PASSWORD: process.env.OPENCODE_SERVER_PASSWORD ?? "replay-local",
}

const auth = `Basic ${Buffer.from(`${serverEnv.OPENCODE_SERVER_USERNAME}:${serverEnv.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`
async function http(method, path, body) {
  const response = await fetch(`http://127.0.0.1:4199${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(path === "/config" ? 5000 : 240000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${path}`)
  return response.json()
}

let client
let model
let server
if (MODE === "groq") {
  model = createCompilerModelV2(createStructuredProviderTransport({
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    providerId: "groq",
    modelId: "openai/gpt-oss-120b",
    apiKey: process.env.GROQ_API_KEY,
    strict: true,
    schema: buildStrictCandidateSchema(),
  }))
} else if (MODE === "gemini") {
  model = createCompilerModelV2(createStructuredProviderTransport({
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    providerId: "google",
    modelId: "gemini-3.6-flash",
    apiKey: process.env.GEMINI_API_KEY,
    strict: true,
    schema: buildStrictCandidateSchema("gemini"),
  }))
} else if (MODE === "qwen") {
  model = createCompilerModelV2(createStructuredProviderTransport({
    endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    providerId: "dashscope",
    modelId: "qwen3.8-flash",
    apiKey: process.env.DASHSCOPE_API_KEY,
    strict: true,
    schema: buildStrictCandidateSchema("groq"),
    timeoutMs: 600000,
    ...(THINKING === "off" ? { bodyExtras: { enable_thinking: false } } : {}),
  }))
} else {
  server = spawn(openCodeExecutable(), ["serve", "--hostname", "127.0.0.1", "--port", "4199"], {
    cwd: MODEL_DIR,
    env: serverEnv,
    windowsHide: true,
    stdio: "ignore",
  })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await http("GET", `/config?directory=${encodeURIComponent(MODEL_DIR)}`)
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  client = {
    session: {
      create: async ({ query, body }) => ({ data: await http("POST", `/session?directory=${encodeURIComponent(query.directory)}`, body) }),
      prompt: async ({ path, query, body }) => ({ data: await http("POST", `/session/${path.id}/message?directory=${encodeURIComponent(query.directory)}`, body) }),
    },
  }
  model = createCompilerModelV2(createOpenCodeModelTransportV2({
    client,
    directory: MODEL_DIR,
    providerId: "deepseek",
    modelId: "deepseek-flash",
    agent: "build",
  }))
}

try {
  const report = []
  for (const item of records) {
    const request = structuredClone(item.record.request)
    request.contract = V2_COMPILER_CONTRACT
    request.atom_refs = Object.fromEntries(
      Object.entries(request.compiled ?? {}).map(([taskId, intent]) => [taskId, intent.atoms.map((atom) => atomRef(atom))]),
    )
    const startedAt = new Date().toISOString()
    let result = await model.propose(request)
    if (result.error?.code === "transport" && /fetch failed/iu.test(result.error?.message ?? "")) {
      await new Promise((resolve) => setTimeout(resolve, 5000))
      result = await model.propose(request)
    }
    const entry = {
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      source: `${item.runtime}/${item.run}`,
      request_id: item.record.request_id,
      old_status: item.record.status,
      ok: result.ok,
      error_code: result.error?.code,
      error_message: result.error?.message,
      schema_errors: result.schema_errors,
      text_source: result.call?.text_source,
      provider: result.call?.provider,
      model: result.call?.model,
      usage: result.call?.usage,
      response_length: result.call?.text?.length,
    }
    report.push(entry)
    const safeId = entry.source.replaceAll("/", "__").replaceAll("\\", "__")
    writeFileSync(join(OUT_DIR, `${safeId}-${item.record.request_id}-response.txt`), result.call?.text ?? "(no text)", "utf8")
    console.log(`${entry.source} ${item.record.request_id}: old=${item.record.status} now=${result.ok ? "ok" : result.error?.code}${result.error?.code === "schema" ? ` (${result.schema_errors?.length} errors)` : ""} source=${result.call?.text_source ?? "none"} out=${result.call?.usage?.output_tokens ?? 0} reasoning=${result.call?.usage?.reasoning_tokens ?? 0} cost=${result.call?.usage?.cost ?? "?"}`)
    appendLine(join(OUT_DIR, "report.jsonl"), JSON.stringify(entry))
    if (
      result.error?.code === "transport" &&
      /invalid|schema|400/iu.test(result.error?.message ?? "")
    ) {
      console.log("STOPPING: provider rejected the request schema; not continuing with the remaining records")
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8")
} finally {
  server?.kill()
}

function appendLine(path, line) {
  writeFileSync(path, `${line}\n`, { flag: "a" })
}
