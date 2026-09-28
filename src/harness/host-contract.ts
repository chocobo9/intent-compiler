import type { OperationRequest, Ref, SourceRef } from "../core/intent-contract.js"

/**
 * Environment-neutral configuration and exchange shapes for a compiler host.
 * The v2 core never imports this module; adapters translate their own
 * environment into these values.
 */

export interface IntentCompilerRuntimeConfig {
  transport?: "opencode" | "deepseek-structured" | "dashscope"
  model: {
    providerId: string
    modelId: string
    agent?: string
    variant?: string
  }
  paths: {
    compilerStoreDir: string
    compilerModelDir: string
    observerStoreDir: string
    executorWorkspaceDir: string
  }
  /** Host facts handed to the management model; never file content. */
  capabilities: {
    operations: readonly string[]
    workspaceRoot?: string
  }
  observer?: {
    runId?: string
    armId?: string
    taskId?: string
    turnId?: string
  }
  env?: NodeJS.ProcessEnv
}

export interface HostToolInvocation {
  sessionId: string
  callId: string
  tool: string
  args?: unknown
}

export type HostOperationResolver = (
  invocation: HostToolInvocation,
  executionId: string,
  runId: string,
) => OperationRequest | undefined

export interface HostUserInput {
  sessionId: string
  messageId: string
  runId: string
  text: string
  source?: unknown
  taskIds?: string[]
}

export interface HostDispatchContent {
  dispatch_id: string
  task_id: string
  atom_id: string
  digest: string
  compiled_revision: number
  atom: unknown
}

export interface HostDelivery {
  runId: string
  contents: HostDispatchContent[]
}

export type Reference = Ref | SourceRef
