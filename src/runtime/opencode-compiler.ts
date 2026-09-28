import { isAbsolute, relative, resolve, sep } from "node:path"
import { CompilerStore } from "../core/compiler-store.js"
import { createIntentCompiler, type IntentCompiler } from "../core/intent-compiler.js"
import { createCompilerModel } from "../model/compiler-model.js"
import {
  createOpenCodeModelTransport,
  type OpenCodeModelClient,
} from "../model/opencode-transport.js"

export interface OpenCodeCompilerRuntimeOptions {
  readonly client: OpenCodeModelClient
  readonly executorDirectory: string
  readonly observerStoreDirectory: string
  readonly env?: NodeJS.ProcessEnv
  readonly onModelSessionCreated?: (sessionId: string) => void
}

export class OpenCodeCompilerRuntimeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "OpenCodeCompilerRuntimeError"
    this.code = code
  }
}

/**
 * Build the real Compiler seam for the OpenCode host without exposing its
 * store, model, or transport construction steps to the host.  Construction
 * is synchronous and does not invoke session.create or session.prompt; the
 * injected client is used only when the Compiler later requests a proposal.
 */
export function createOpenCodeCompilerRuntime(options: OpenCodeCompilerRuntimeOptions): IntentCompiler {
  const env = options.env ?? process.env
  const executorDirectory = requireAbsoluteDirectory(options.executorDirectory, "EXECUTOR_DIRECTORY_NOT_ABSOLUTE", "executorDirectory")
  const observerStoreDirectory = requireAbsoluteDirectory(
    options.observerStoreDirectory,
    "OBSERVER_STORE_DIRECTORY_NOT_ABSOLUTE",
    "observerStoreDirectory",
  )
  const compilerStoreDirectory = requiredEnv(env, "INTENT_COMPILER_STORE")
  const modelDirectory = requiredEnv(env, "INTENT_COMPILER_MODEL_DIRECTORY")
  const providerId = requiredEnv(env, "INTENT_COMPILER_PROVIDER_ID")
  const modelId = requiredEnv(env, "INTENT_COMPILER_MODEL_ID")
  const agent = env.INTENT_COMPILER_AGENT

  const storeDirectory = requireAbsoluteDirectory(
    compilerStoreDirectory,
    "COMPILER_STORE_DIRECTORY_NOT_ABSOLUTE",
    "INTENT_COMPILER_STORE",
  )
  const modelWorkspaceDirectory = requireAbsoluteDirectory(
    modelDirectory,
    "MODEL_DIRECTORY_NOT_ABSOLUTE",
    "INTENT_COMPILER_MODEL_DIRECTORY",
  )

  rejectInside(executorDirectory, storeDirectory, "COMPILER_STORE_INSIDE_EXECUTOR", "Compiler store")
  rejectInside(executorDirectory, modelWorkspaceDirectory, "MODEL_DIRECTORY_INSIDE_EXECUTOR", "Compiler model directory")
  rejectInside(executorDirectory, observerStoreDirectory, "OBSERVER_STORE_INSIDE_EXECUTOR", "Observer store")
  if (pathsOverlap(storeDirectory, observerStoreDirectory)) {
    throw new OpenCodeCompilerRuntimeError(
      "COMPILER_OBSERVER_STORE_OVERLAP",
      "Compiler store and Observer store must be separate, non-overlapping paths",
    )
  }
  if (pathsOverlap(modelWorkspaceDirectory, storeDirectory)) {
    throw new OpenCodeCompilerRuntimeError(
      "MODEL_DIRECTORY_STORE_OVERLAP",
      "Compiler model directory and Compiler store must be separate, non-overlapping paths",
    )
  }
  if (pathsOverlap(modelWorkspaceDirectory, observerStoreDirectory)) {
    throw new OpenCodeCompilerRuntimeError(
      "MODEL_DIRECTORY_OBSERVER_OVERLAP",
      "Compiler model directory and Observer store must be separate, non-overlapping paths",
    )
  }

  const store = new CompilerStore({
    storeDir: storeDirectory,
    observerStoreDir: observerStoreDirectory,
    executorWorkspaceDir: executorDirectory,
  })
  const transport = createOpenCodeModelTransport({
    client: options.client,
    directory: modelWorkspaceDirectory,
    providerId,
    modelId,
    ...(agent === undefined ? {} : { agent }),
    ...(options.onModelSessionCreated === undefined ? {} : { onSessionCreated: options.onModelSessionCreated }),
  })
  const model = createCompilerModel(transport)
  return createIntentCompiler({ store, model })
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OpenCodeCompilerRuntimeError("ENV_REQUIRED", `${name} must be configured with non-empty text`)
  }
  return value
}

function requireAbsoluteDirectory(value: string, code: string, label: string): string {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new OpenCodeCompilerRuntimeError(code, `${label} must be an absolute directory`)
  }
  return resolve(value)
}

function rejectInside(workspace: string, candidate: string, code: string, label: string): void {
  if (isWithin(candidate, workspace)) {
    throw new OpenCodeCompilerRuntimeError(code, `${label} must be outside the executor workspace`)
  }
}

function pathsOverlap(left: string, right: string): boolean {
  return isWithin(left, right) || isWithin(right, left)
}

function isWithin(candidate: string, parent: string): boolean {
  const path = relative(resolve(parent), resolve(candidate))
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
}
