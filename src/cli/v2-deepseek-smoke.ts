#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"

const OPENCODE_VERSION = "1.18.31"
const PROVIDER_ID = "deepseek"
const MODEL_ID = "deepseek-flash"
// DeepSeek Flash at max reasoning effort can exhaust its 32k reasoning budget
// and emit zero output tokens.  The management model needs a JSON Candidate in
// a normal text part, so it runs at low reasoning; the executor keeps max.
const MANAGEMENT_REASONING_EFFORT = "low"
const EXECUTOR_REASONING_EFFORT = "max"
const OPENCODE_COMMAND = resolveOpenCodeExecutable()

interface SmokeOptions {
  projectDir: string
  runDir: string
  compilerStoreDir: string
  observerStoreDir: string
  compilerModelDir: string
  prompt: string
  title: string
  dryRun: boolean
  preflightOnly: boolean
  arm: "compiler" | "raw"
}

interface SmokePlan {
  projectDir: string
  runDir: string
  compilerStoreDir: string
  observerStoreDir: string
  compilerModelDir: string
  runConfigPath: string
  runConfig: string
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  dryRun: boolean
  preflightOnly: boolean
  arm: "compiler" | "raw"
}

const args = parseArgs(process.argv.slice(2))
const projectDir = resolve(required(args, "project-dir"))
const runDir = resolve(required(args, "run-dir"))
const plan = createSmokePlan({
  projectDir,
  runDir,
  compilerStoreDir: resolve(optional(args, "compiler-store") ?? join(runDir, "..", "compiler-store")),
  observerStoreDir: resolve(optional(args, "observer-store") ?? join(runDir, "..", "observer-store")),
  compilerModelDir: resolve(optional(args, "compiler-model") ?? join(runDir, "..", "compiler-model")),
  prompt: optional(args, "prompt") ?? "只输出一行 SMOKE_OK，不要使用任何工具或访问文件。",
  title: optional(args, "title") ?? "v2-deepseek-flash-smoke-001",
  dryRun: args.has("dry-run"),
  preflightOnly: args.has("preflight-only"),
  arm: optional(args, "arm") === "raw" ? "raw" : "compiler",
})

const loadedEnv = loadProjectEnv(plan.projectDir)
const env = { ...process.env, ...loadedEnv }
applyRuntimeEnvironment(env, plan)

if (plan.dryRun) {
  process.stdout.write(JSON.stringify({
    dryRun: true,
    projectDir: plan.projectDir,
    runDir: plan.runDir,
    runConfigPath: plan.runConfigPath,
    runConfig: plan.runConfig,
    command: plan.command,
    args: plan.args,
    arm: plan.arm,
    apiKeyConfigured: isNonEmptyEnv(env, "DEEPSEEK_API_KEY"),
  }, null, 2) + "\n")
  process.exit(0)
}

const checks: string[] = []
checkOpenCodeVersion(checks)
checkModelAvailable(checks, plan.projectDir)
checkApiKey(checks, env)
checkDirectoryIsolation(checks, plan)
if (checks.length > 0) {
  process.stderr.write(`v2 DeepSeek preflight failed:\n${checks.join("\n")}\n`)
  process.exit(1)
}

if (plan.preflightOnly) {
  process.stdout.write(JSON.stringify({
    preflightOnly: true,
    openCodeVersion: OPENCODE_VERSION,
    provider: PROVIDER_ID,
    model: MODEL_ID,
    apiKeyConfigured: isNonEmptyEnv(env, "DEEPSEEK_API_KEY"),
  }, null, 2) + "\n")
  process.exit(0)
}

prepareRunDirectory(plan, env)
const result = spawnSync(plan.command, plan.args, {
  cwd: plan.runDir,
  env,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
})
process.stdout.write(result.stdout ?? "")
process.stderr.write(result.stderr ?? "")
if (result.error) {
  process.stderr.write(`opencode run failed to start: ${result.error.message}\n`)
  process.exit(2)
}
process.exit(result.status ?? 1)

function createSmokePlan(options: SmokeOptions): SmokePlan {
  const pluginPath = join(options.projectDir, ".opencode", "plugins", "experiment-runtime.js")
  const pluginUrl = pathToFileURL(pluginPath).href
  const runConfigPath = join(options.runDir, ".opencode", "opencode.json")
  const runConfig = JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: `${PROVIDER_ID}/${MODEL_ID}`,
    provider: {
      [PROVIDER_ID]: {
        models: {
          [MODEL_ID]: {
            options: { reasoningEffort: EXECUTOR_REASONING_EFFORT },
          },
        },
      },
    },
    plugin: [pluginUrl],
  }, null, 2) + "\n"
  return {
    projectDir: options.projectDir,
    runDir: options.runDir,
    compilerStoreDir: options.compilerStoreDir,
    observerStoreDir: options.observerStoreDir,
    compilerModelDir: options.compilerModelDir,
    runConfigPath,
    runConfig,
    command: OPENCODE_COMMAND,
    args: [
      "run",
      "--model", `${PROVIDER_ID}/${MODEL_ID}`,
      "--variant", "max",
      "--format", "json",
      "--title", options.title,
      "--dir", options.runDir,
      options.prompt,
    ],
    env: {},
    dryRun: options.dryRun,
    preflightOnly: options.preflightOnly,
    arm: options.arm,
  }
}

function applyRuntimeEnvironment(env: NodeJS.ProcessEnv, plan: SmokePlan): void {
  env.INTENT_COMPILER_STORE = plan.compilerStoreDir
  env.INTENT_COMPILER_MODEL_DIRECTORY = plan.compilerModelDir
  env.INTENT_COMPILER_PROVIDER_ID = PROVIDER_ID
  env.INTENT_COMPILER_MODEL_ID = MODEL_ID
  env.INTENT_COMPILER_AGENT = "build"
  env.EXPERIMENT_ARM_MODE = plan.arm
  env.EXPERIMENT_OBSERVER_STORE = plan.observerStoreDir
  env.EXPERIMENT_OBSERVER_AUTO_REGISTER = "1"
  env.EXPERIMENT_RUN_ID = planRunId(plan)
  env.EXPERIMENT_ARM_ID = plan.arm === "raw" ? "raw" : "compiler-v2"
  env.EXPERIMENT_TASK_ID = plan.arm === "raw" ? "raw-deepseek-flash-smoke" : "v2-deepseek-flash-smoke"
  env.EXPERIMENT_TURN_ID = "1"
  env.EXPERIMENT_INPUT_IDENTITY = `${env.EXPERIMENT_RUN_ID}:smoke:1`
  env.EXPERIMENT_SOURCE_CATEGORY = "initial_requirement"
}

function prepareRunDirectory(plan: SmokePlan, env: NodeJS.ProcessEnv): void {
  assertExternalPath(plan.runDir, plan.projectDir, "run directory")
  mkdirSync(join(plan.runDir, ".opencode"), { recursive: true })
  writeFileSync(plan.runConfigPath, plan.runConfig, "utf8")
  mkdirSync(plan.compilerStoreDir, { recursive: true })
  mkdirSync(plan.compilerModelDir, { recursive: true })
  mkdirSync(plan.observerStoreDir, { recursive: true })
  const modelConfig = JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: `${PROVIDER_ID}/${MODEL_ID}`,
    provider: {
      [PROVIDER_ID]: {
        models: {
          [MODEL_ID]: {
            options: { reasoningEffort: MANAGEMENT_REASONING_EFFORT },
          },
        },
      },
    },
  }, null, 2) + "\n"
  writeFileSync(join(plan.compilerModelDir, "opencode.json"), modelConfig, "utf8")
}

function checkOpenCodeVersion(checks: string[]): void {
  const result = spawnSync(OPENCODE_COMMAND, ["--version"], { encoding: "utf8" })
  const version = (result.stdout ?? "").trim()
  if (version !== OPENCODE_VERSION) {
    checks.push(`OpenCode version must be exactly ${OPENCODE_VERSION}; observed ${JSON.stringify(version)}`)
  }
}

function checkModelAvailable(checks: string[], projectDir: string): void {
  const result = spawnSync(OPENCODE_COMMAND, ["models", PROVIDER_ID], { cwd: projectDir, encoding: "utf8" })
  const output = result.stdout ?? ""
  if (!output.split(/\r?\n/u).includes(`${PROVIDER_ID}/${MODEL_ID}`)) {
    checks.push(`${PROVIDER_ID}/${MODEL_ID} is not available in opencode models`)
  }
}

function resolveOpenCodeExecutable(): string {
  if (process.platform !== "win32") return "opencode"
  const prefix = spawnSync("npm", ["config", "get", "prefix"], {
    encoding: "utf8",
    shell: true,
  }).stdout?.trim()
  if (!prefix) return "opencode"
  const executable = join(prefix, "node_modules", "opencode-ai", "bin", "opencode.exe")
  return existsSync(executable) ? executable : "opencode"
}

function checkApiKey(checks: string[], env: NodeJS.ProcessEnv): void {
  if (!isNonEmptyEnv(env, "DEEPSEEK_API_KEY")) {
    checks.push("DEEPSEEK_API_KEY is empty in the project .env or host environment")
  }
}

function checkDirectoryIsolation(checks: string[], plan: SmokePlan): void {
  const entries = [
    ["RUN_DIR", plan.runDir],
    ["Compiler store", plan.compilerStoreDir],
    ["Observer store", plan.observerStoreDir],
    ["Compiler model directory", plan.compilerModelDir],
  ] as const
  for (const [label, value] of entries) {
    if (!isAbsolute(value)) {
      checks.push(`${label} must be absolute: ${value}`)
    }
  }
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      if (pathsOverlap(entries[left][1], entries[right][1])) {
        checks.push(`${entries[left][0]} and ${entries[right][0]} must not overlap`)
      }
    }
  }
  const normalized = (value: string): string => resolve(value).toLowerCase()
  const projectRelative = relative(normalized(plan.projectDir), normalized(plan.runDir))
  if (projectRelative === "" || (!projectRelative.startsWith(`..${sep}`) && projectRelative !== ".." && !isAbsolute(projectRelative))) {
    checks.push(`RUN_DIR must be outside the project directory: ${plan.runDir}`)
  }
}

function pathsOverlap(left: string, right: string): boolean {
  const normalized = (value: string): string => resolve(value).toLowerCase()
  const relativePath = relative(normalized(left), normalized(right))
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))
}

function loadProjectEnv(projectDir: string): NodeJS.ProcessEnv {
  const path = join(projectDir, ".env")
  if (!existsSync(path)) return {}
  const env: NodeJS.ProcessEnv = {}
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(line)
    if (!match) continue
    const value = match[2] ?? ""
    if (value.startsWith('"') && value.endsWith('"')) {
      env[match[1] as string] = value.slice(1, -1)
    } else {
      env[match[1] as string] = value
    }
  }
  return env
}

function isNonEmptyEnv(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name]
  return typeof value === "string" && value.trim().length > 0
}

function assertExternalPath(candidate: string, parent: string, label: string): void {
  const normalized = (value: string): string => resolve(value).toLowerCase()
  const relativePath = relative(normalized(parent), normalized(candidate))
  if (relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))) {
    throw new Error(`${label} must be outside the project directory: ${candidate}`)
  }
}

function planRunId(plan: SmokePlan): string {
  return `${plan.arm === "raw" ? "raw" : "v2"}-deepseek-flash-${basename(plan.runDir)}`
}

function basename(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path
}

function parseArgs(values: string[]): Map<string, string> {
  const result = new Map<string, string>()
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as string
    if (!value.startsWith("--")) throw new Error(`invalid argument: ${value}`)
    if (value === "--dry-run") {
      result.set("dry-run", "true")
      continue
    }
    if (value === "--preflight-only") {
      result.set("preflight-only", "true")
      continue
    }
    const next = values[index + 1]
    if (next === undefined || next.startsWith("--")) throw new Error(`missing value for ${value}`)
    result.set(value.slice(2), next)
    index += 1
  }
  return result
}

function required(args: Map<string, string>, key: string): string {
  const value = args.get(key)
  if (!value) throw new Error(`--${key} is required`)
  return value
}

function optional(args: Map<string, string>, key: string): string | undefined {
  return args.get(key)
}
