import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  createOpenCodeCompilerRuntime,
  OpenCodeCompilerRuntimeError,
} from "../src/runtime/opencode-compiler.js"
import { ExperimentRuntimePlugin, type OpenCodeObserver } from "../src/adapters/opencode.js"
import type { IntentCompiler } from "../src/core/intent-compiler.js"

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "opencode-compiler-runtime-"))
  temporaryDirectories.push(directory)
  return directory
}

test.after(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function validEnvironment(root: string): NodeJS.ProcessEnv {
  return {
    INTENT_COMPILER_STORE: join(root, "compiler-store"),
    INTENT_COMPILER_MODEL_DIRECTORY: join(root, "compiler-model"),
    INTENT_COMPILER_PROVIDER_ID: "provider-test",
    INTENT_COMPILER_MODEL_ID: "model-test",
    INTENT_COMPILER_AGENT: "build",
  }
}

function narrowClient(calls: { create: number; prompt: number }): {
  session: {
    create: () => Promise<unknown>
    prompt: () => Promise<unknown>
  }
} {
  return {
    session: {
      create: async () => {
        calls.create += 1
        throw new Error("session.create must not run in configuration tests")
      },
      prompt: async () => {
        calls.prompt += 1
        throw new Error("session.prompt must not run in configuration tests")
      },
    },
  }
}

function observerThatIgnoresSession(ignoredSession: string): OpenCodeObserver {
  return {
    captureRawInput: (input) => input.sessionID !== ignoredSession,
    expectDelivery: () => true,
    observeEvent: () => true,
  }
}

test("builds a real Compiler from environment without invoking OpenCode sessions", () => {
  const root = temporaryDirectory()
  const executorDirectory = join(root, "executor")
  const observerStoreDirectory = join(root, "observer-store")
  const calls = { create: 0, prompt: 0 }
  const compiler = createOpenCodeCompilerRuntime({
    client: narrowClient(calls),
    executorDirectory,
    observerStoreDirectory,
    env: validEnvironment(root),
  })

  assert.equal(typeof compiler.prepareTurn, "function")
  assert.equal(typeof compiler.recordDelivery, "function")
  assert.equal(typeof compiler.admitEvidence, "function")
  assert.equal(typeof compiler.recover, "function")
  assert.equal(calls.create, 0)
  assert.equal(calls.prompt, 0)
  assert.equal(existsSync(join(root, "compiler-store")), true)
})

test("raw plugin arm never constructs the Compiler runtime", async () => {
  const root = temporaryDirectory()
  const calls = { create: 0, prompt: 0 }
  const hooks = await ExperimentRuntimePlugin({
    client: narrowClient(calls),
    directory: join(root, "executor"),
    arm: "raw",
    observer: observerThatIgnoresSession("internal-model-session"),
    env: {},
  })

  await hooks["chat.params"]({ sessionID: "internal-model-session", message: { id: "model-message" } }, {})
  assert.equal(calls.create, 0)
  assert.equal(calls.prompt, 0)
})

test("compiler plugin arm builds the environment-backed Compiler and ignores an internal model session", async () => {
  const root = temporaryDirectory()
  const calls = { create: 0, prompt: 0 }
  const hooks = await ExperimentRuntimePlugin({
    client: narrowClient(calls),
    directory: join(root, "executor"),
    arm: "compiler",
    observer: observerThatIgnoresSession("internal-model-session"),
    env: {
      ...validEnvironment(root),
      EXPERIMENT_OBSERVER_STORE: join(root, "observer-store"),
      EXPERIMENT_COMPILER_SCHEMA: "legacy",
    },
  })

  await hooks["chat.message"](
    { sessionID: "internal-model-session", messageID: "model-message" },
    { message: { id: "model-message" }, parts: [{ id: "model-part", type: "text", text: "internal" }] },
  )
  await hooks["chat.params"]({ sessionID: "internal-model-session", message: { id: "model-message" } }, {})
  assert.equal(calls.create, 0)
  assert.equal(calls.prompt, 0)
  assert.equal(existsSync(join(root, "compiler-store")), true)
})

test("compiler plugin arm preserves an injected Compiler without requiring runtime environment", async () => {
  const root = temporaryDirectory()
  const injectedCompiler = {} as IntentCompiler
  const hooks = await ExperimentRuntimePlugin({
    client: {},
    directory: join(root, "executor"),
    arm: "compiler",
    observer: observerThatIgnoresSession("internal-model-session"),
    compiler: injectedCompiler,
    env: {},
  })

  assert.equal(typeof hooks["chat.message"], "function")
})

test("requires every compiler environment identity without guessing a model", () => {
  const required = [
    "INTENT_COMPILER_STORE",
    "INTENT_COMPILER_MODEL_DIRECTORY",
    "INTENT_COMPILER_PROVIDER_ID",
    "INTENT_COMPILER_MODEL_ID",
  ] as const

  for (const name of required) {
    const root = temporaryDirectory()
    const env = validEnvironment(root)
    delete env[name]
    assert.throws(
      () => createOpenCodeCompilerRuntime({
        client: narrowClient({ create: 0, prompt: 0 }),
        executorDirectory: join(root, "executor"),
        observerStoreDirectory: join(root, "observer-store"),
        env,
      }),
      (error: unknown) => error instanceof OpenCodeCompilerRuntimeError && error.code === "ENV_REQUIRED",
      name,
    )
  }
})

test("requires absolute Compiler store and model directories", () => {
  const root = temporaryDirectory()
  const cases = [
    { name: "INTENT_COMPILER_STORE", code: "COMPILER_STORE_DIRECTORY_NOT_ABSOLUTE" },
    { name: "INTENT_COMPILER_MODEL_DIRECTORY", code: "MODEL_DIRECTORY_NOT_ABSOLUTE" },
  ] as const

  for (const scenario of cases) {
    const env = validEnvironment(root)
    env[scenario.name] = "relative/compiler-path"
    assert.throws(
      () => createOpenCodeCompilerRuntime({
        client: narrowClient({ create: 0, prompt: 0 }),
        executorDirectory: join(root, "executor"),
        observerStoreDirectory: join(root, "observer-store"),
        env,
      }),
      (error: unknown) => error instanceof OpenCodeCompilerRuntimeError && error.code === scenario.code,
      scenario.name,
    )
  }
})

test("rejects Compiler store or model directory inside the executor workspace", () => {
  const root = temporaryDirectory()
  const executorDirectory = join(root, "executor")
  const cases = [
    { name: "store", update: (env: NodeJS.ProcessEnv) => { env.INTENT_COMPILER_STORE = join(executorDirectory, "store") }, code: "COMPILER_STORE_INSIDE_EXECUTOR" },
    { name: "model", update: (env: NodeJS.ProcessEnv) => { env.INTENT_COMPILER_MODEL_DIRECTORY = join(executorDirectory, "model") }, code: "MODEL_DIRECTORY_INSIDE_EXECUTOR" },
  ] as const

  for (const scenario of cases) {
    const env = validEnvironment(root)
    scenario.update(env)
    assert.throws(
      () => createOpenCodeCompilerRuntime({
        client: narrowClient({ create: 0, prompt: 0 }),
        executorDirectory,
        observerStoreDirectory: join(root, "observer-store"),
        env,
      }),
      (error: unknown) => error instanceof OpenCodeCompilerRuntimeError && error.code === scenario.code,
      scenario.name,
    )
  }
})

test("rejects overlapping Compiler and Observer store directories", () => {
  const root = temporaryDirectory()
  const env = validEnvironment(root)
  assert.throws(
    () => createOpenCodeCompilerRuntime({
      client: narrowClient({ create: 0, prompt: 0 }),
      executorDirectory: join(root, "executor"),
      observerStoreDirectory: join(root, "compiler-store", "observer-child"),
      env,
    }),
    (error: unknown) => error instanceof OpenCodeCompilerRuntimeError && error.code === "COMPILER_OBSERVER_STORE_OVERLAP",
  )
})

test("keeps the Compiler model session directory separate from both stores", () => {
  const root = temporaryDirectory()
  const cases = [
    {
      name: "Compiler store",
      observerStoreDirectory: join(root, "observer-store"),
      modelDirectory: join(root, "compiler-store", "model-child"),
      code: "MODEL_DIRECTORY_STORE_OVERLAP",
    },
    {
      name: "Observer store",
      observerStoreDirectory: join(root, "observer-store"),
      modelDirectory: join(root, "observer-store", "model-child"),
      code: "MODEL_DIRECTORY_OBSERVER_OVERLAP",
    },
  ] as const

  for (const scenario of cases) {
    const env = validEnvironment(root)
    env.INTENT_COMPILER_MODEL_DIRECTORY = scenario.modelDirectory
    assert.throws(
      () => createOpenCodeCompilerRuntime({
        client: narrowClient({ create: 0, prompt: 0 }),
        executorDirectory: join(root, "executor"),
        observerStoreDirectory: scenario.observerStoreDirectory,
        env,
      }),
      (error: unknown) => error instanceof OpenCodeCompilerRuntimeError && error.code === scenario.code,
      scenario.name,
    )
  }
})
