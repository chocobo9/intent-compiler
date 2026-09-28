import { isAbsolute, relative, resolve } from "node:path"
import { ObserverRuntime } from "./runtime.js"
import type {
  ChatMessageInput,
  ChatMessageOutput,
  ModelRequestInput,
  ModelRequestOutput,
  ObserverClient,
  ObserverEventEnvelope,
  ToolAfterOutput,
  ToolBeforeOutput,
  ToolHookInput,
} from "./types.js"

export interface ExperimentObserverPluginContext {
  client: ObserverClient
  directory: string
}

export interface ExperimentObserverHooks {
  "chat.message": (input: ChatMessageInput, output: ChatMessageOutput) => Promise<void>
  "chat.params": (input: ModelRequestInput, output: ModelRequestOutput) => void
  "tool.execute.before": (input: ToolHookInput, output: ToolBeforeOutput) => void
  "tool.execute.after": (input: ToolHookInput, output: ToolAfterOutput) => void
  event: (input: { event: ObserverEventEnvelope }) => Promise<void>
  dispose: () => Promise<void>
}

export const ExperimentObserverPlugin = async ({
  client,
  directory,
}: ExperimentObserverPluginContext): Promise<ExperimentObserverHooks> => {
  const storeDir = resolve(
    process.env.EXPERIMENT_OBSERVER_STORE ??
      `${process.env.LOCALAPPDATA ?? process.cwd()}/opencode-experiment-observer`,
  )
  const fromWorkspace = relative(resolve(directory), storeDir)
  if (fromWorkspace === "" || (!fromWorkspace.startsWith("..") && !isAbsolute(fromWorkspace))) {
    throw new Error("EXPERIMENT_OBSERVER_STORE must be outside the OpenCode workspace")
  }
  const runtime = new ObserverRuntime({ storeDir, client })

  return {
    "chat.message": async (input, output) => {
      if (runtime.captureRawInput(input, output)) runtime.expectDelivery(input, output)
    },
    "chat.params": (input, output) => {
      runtime.modelRequested(input, output)
    },
    "tool.execute.before": (input, output) => {
      runtime.toolBefore(input, output)
    },
    "tool.execute.after": (input, output) => {
      runtime.toolAfter(input, output)
    },
    event: ({ event }) => {
      runtime.observeEvent(event)
      return Promise.resolve()
    },
    dispose: async () => {
      await Promise.allSettled(runtime.reconciliations.values())
    },
  }
}
