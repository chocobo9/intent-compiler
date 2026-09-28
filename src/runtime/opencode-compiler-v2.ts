import { isAbsolute, relative, resolve, sep } from "node:path"
import type { IntentCompilerV2 } from "../core/intent-compiler-v2.js"
import type { OpenCodeModelClient } from "../model/opencode-transport.js"
import { createIntentCompilerRuntime } from "../harness/runtime-factory.js"

export interface OpenCodeCompilerRuntimeV2Options {
  readonly client: OpenCodeModelClient
  readonly executorDirectory: string
  readonly observerStoreDirectory: string
  readonly env?: NodeJS.ProcessEnv
  readonly onModelSessionCreated?: (sessionId: string) => void
}

export class OpenCodeCompilerRuntimeV2Error extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "OpenCodeCompilerRuntimeV2Error"
    this.code = code
  }
}

/**
 * Build the v2 Compiler seam for the OpenCode host.  The returned object is
 * the same four-operation public interface, but it owns one v2 store per
 * run and creates the model transport once.
 */
export function createOpenCodeCompilerRuntimeV2(
  options: OpenCodeCompilerRuntimeV2Options,
): IntentCompilerV2 {
  const env = options.env ?? process.env
  const executorDirectory = requireAbsoluteDirectory(options.executorDirectory, "EXECUTOR_DIRECTORY_NOT_ABSOLUTE", "executorDirectory")
  const observerStoreDirectory = requireAbsoluteDirectory(options.observerStoreDirectory, "OBSERVER_STORE_DIRECTORY_NOT_ABSOLUTE", "observerStoreDirectory")
  const compilerStoreDirectory = requireAbsoluteDirectory(
    requiredEnv(env, "INTENT_COMPILER_STORE"),
    "COMPILER_STORE_DIRECTORY_NOT_ABSOLUTE",
    "INTENT_COMPILER_STORE",
  )
  const modelDirectory = requireAbsoluteDirectory(
    requiredEnv(env, "INTENT_COMPILER_MODEL_DIRECTORY"),
    "MODEL_DIRECTORY_NOT_ABSOLUTE",
    "INTENT_COMPILER_MODEL_DIRECTORY",
  )
  const providerId = requiredEnv(env, "INTENT_COMPILER_PROVIDER_ID")
  const modelId = requiredEnv(env, "INTENT_COMPILER_MODEL_ID")
  const variant = env.INTENT_COMPILER_MODEL_VARIANT
  const agent = env.INTENT_COMPILER_AGENT
  const operations = (env.INTENT_COMPILER_OPERATIONS ?? "read,write,edit,bash,glob,grep")
    .split(",")
    .map((operation) => operation.trim())
    .filter((operation) => operation.length > 0)
  const transport = env.INTENT_COMPILER_TRANSPORT === "deepseek-structured"
    ? "deepseek-structured" as const
    : env.INTENT_COMPILER_TRANSPORT === "dashscope"
      ? "dashscope" as const
      : "opencode" as const

  rejectInside(executorDirectory, compilerStoreDirectory, "COMPILER_STORE_INSIDE_EXECUTOR", "Compiler store")
  rejectInside(executorDirectory, modelDirectory, "MODEL_DIRECTORY_INSIDE_EXECUTOR", "Compiler model directory")
  rejectInside(executorDirectory, observerStoreDirectory, "OBSERVER_STORE_INSIDE_EXECUTOR", "Observer store")
  if (pathsOverlap(compilerStoreDirectory, observerStoreDirectory)) {
    throw new OpenCodeCompilerRuntimeV2Error("COMPILER_OBSERVER_STORE_OVERLAP", "Compiler store and Observer store must be separate, non-overlapping paths")
  }
  if (pathsOverlap(modelDirectory, compilerStoreDirectory)) {
    throw new OpenCodeCompilerRuntimeV2Error("MODEL_DIRECTORY_STORE_OVERLAP", "Compiler model directory and Compiler store must be separate, non-overlapping paths")
  }
  if (pathsOverlap(modelDirectory, observerStoreDirectory)) {
    throw new OpenCodeCompilerRuntimeV2Error("MODEL_DIRECTORY_OBSERVER_OVERLAP", "Compiler model directory and Observer store must be separate, non-overlapping paths")
  }

  return createIntentCompilerRuntime({
    client: options.client,
    config: {
      transport,
      model: {
        providerId,
        modelId,
        ...(variant === undefined ? {} : { variant }),
        ...(agent === undefined ? {} : { agent }),
      },
      paths: {
        compilerStoreDir: compilerStoreDirectory,
        compilerModelDir: modelDirectory,
        observerStoreDir: observerStoreDirectory,
        executorWorkspaceDir: executorDirectory,
      },
      capabilities: {
        operations,
        workspaceRoot: executorDirectory,
      },
    },
    ...(options.onModelSessionCreated === undefined ? {} : { onModelSessionCreated: options.onModelSessionCreated }),
  })
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OpenCodeCompilerRuntimeV2Error("ENV_REQUIRED", `${name} must be configured with non-empty text`)
  }
  return value
}

function requireAbsoluteDirectory(value: string, code: string, label: string): string {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new OpenCodeCompilerRuntimeV2Error(code, `${label} must be an absolute directory`)
  }
  return resolve(value)
}

function rejectInside(workspace: string, candidate: string, code: string, label: string): void {
  if (isWithin(candidate, workspace)) {
    throw new OpenCodeCompilerRuntimeV2Error(code, `${label} must be outside the executor workspace`)
  }
}

function pathsOverlap(left: string, right: string): boolean {
  return isWithin(left, right) || isWithin(right, left)
}

function isWithin(candidate: string, parent: string): boolean {
  const path = relative(resolve(parent), resolve(candidate))
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
}
