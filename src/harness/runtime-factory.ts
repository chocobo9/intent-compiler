import { isAbsolute, relative, resolve, sep } from "node:path"
import { IntentStoreV2 } from "../core/compiler-store-v2.js"
import { createIntentCompilerV2, type IntentCompilerV2 } from "../core/intent-compiler-v2.js"
import type {
  AdvanceResult,
  AuthorizationResult,
  AuthorizeRequest,
  CompilerEvent,
  EventReceipt,
  RunView,
} from "../core/intent-contract.js"
import { createCompilerModelV2 } from "../model/compiler-model-v2.js"
import {
  CHECK_SYSTEM_PROMPT,
  createOpenCodeCheckTransportV2,
  createOpenCodeModelTransportV2,
  type OpenCodeModelClient,
} from "../model/opencode-transport.js"
import type { CompilerModelV2CheckInput } from "../model/compiler-model-v2.js"
import {
  createStructuredProviderTransport,
  StructuredProviderTransportError,
} from "../model/structured-provider-transport.js"
import { buildStrictCandidateSchema } from "../model/candidate-schema-strict.js"
import { buildStrictCandidateCheckSchema } from "../model/candidate-check-schema-strict.js"
import { CANDIDATE_CHECK_JSON_SCHEMA } from "../model/candidate-check-schema.js"
import { existsSync, accessSync, constants } from "node:fs"
import { createHash } from "node:crypto"
import { createReadStream, statSync } from "node:fs"
import type { IntentCompilerRuntimeConfig } from "./host-contract.js"

export interface IntentCompilerRuntimeOptions {
  client: OpenCodeModelClient
  config: IntentCompilerRuntimeConfig
  onModelSessionCreated?: (sessionId: string) => void
}

/**
 * The host-neutral runtime factory.  It owns one v2 store per run and one
 * shared management-model transport.  Environment adapters provide config;
 * no environment variable names or OpenCode hook types live here.
 */
export function createIntentCompilerRuntime(options: IntentCompilerRuntimeOptions): IntentCompilerV2 {
  const config = options.config
  const modelDir = requireAbsolute(config.paths.compilerModelDir, "compilerModelDir")
  const storeDir = requireAbsolute(config.paths.compilerStoreDir, "compilerStoreDir")
  const observerDir = requireAbsolute(config.paths.observerStoreDir, "observerStoreDir")
  const workspaceDir = requireAbsolute(config.paths.executorWorkspaceDir, "executorWorkspaceDir")
  requireNonOverlap(storeDir, observerDir, "compilerStoreDir", "observerStoreDir")
  requireNonOverlap(storeDir, modelDir, "compilerStoreDir", "compilerModelDir")
  requireNonOverlap(modelDir, observerDir, "compilerModelDir", "observerStoreDir")
  requireOutside(storeDir, workspaceDir, "compilerStoreDir", "executorWorkspaceDir")
  requireOutside(modelDir, workspaceDir, "compilerModelDir", "executorWorkspaceDir")
  requireOutside(observerDir, workspaceDir, "observerStoreDir", "executorWorkspaceDir")

  const openCodeTransport = createOpenCodeModelTransportV2({
    client: options.client,
    directory: modelDir,
    providerId: nonEmpty(config.model.providerId, "providerId"),
    modelId: nonEmpty(config.model.modelId, "modelId"),
    ...(config.model.variant === undefined ? {} : { variant: config.model.variant }),
    ...(config.model.agent === undefined ? {} : { agent: config.model.agent }),
    ...(options.onModelSessionCreated === undefined ? {} : { onSessionCreated: options.onModelSessionCreated }),
  })
  const structuredTransport = config.transport === "deepseek-structured"
    ? createStructuredProviderTransport({
        providerId: config.model.providerId,
        modelId: config.model.modelId,
        ...(config.model.agent === undefined ? {} : { agent: config.model.agent }),
        apiKey: config.env?.DEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY,
      })
    : config.transport === "dashscope"
      ? createStructuredProviderTransport({
          endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
          providerId: config.model.providerId,
          modelId: config.model.modelId,
          apiKey: config.env?.DASHSCOPE_API_KEY ?? process.env.DASHSCOPE_API_KEY,
          strict: true,
          schema: buildStrictCandidateSchema("groq"),
          // The management model thinks for minutes: stream the answer so the
          // request cannot die on a long wait for response headers, and keep a
          // generous overall cap.
          stream: true,
          timeoutMs: 900_000,
        })
      : undefined
  const transport = structuredTransport === undefined
    ? openCodeTransport
    : async (request: Parameters<typeof openCodeTransport>[0]) => {
        try {
          return await structuredTransport(request)
        } catch (error) {
          if (config.transport === "deepseek-structured" && error instanceof StructuredProviderTransportError && error.code === "STRUCTURED_UNSUPPORTED") {
            return openCodeTransport(request)
          }
          throw error
        }
      }
  // The independent check runs on the same provider with its own schema: it
  // may only return a verdict and findings, never business content.
  const checkTransport = config.transport === "opencode"
    ? createOpenCodeCheckTransportV2({
        client: options.client,
        directory: modelDir,
        providerId: nonEmpty(config.model.providerId, "providerId"),
        modelId: nonEmpty(config.model.modelId, "modelId"),
        ...(config.model.variant === undefined ? {} : { variant: config.model.variant }),
        ...(config.model.agent === undefined ? {} : { agent: config.model.agent }),
        ...(options.onModelSessionCreated === undefined ? {} : { onSessionCreated: options.onModelSessionCreated }),
      })
    : config.transport === "dashscope"
    ? createStructuredProviderTransport<CompilerModelV2CheckInput>({
        endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
        providerId: config.model.providerId,
        modelId: config.model.modelId,
        apiKey: config.env?.DASHSCOPE_API_KEY ?? process.env.DASHSCOPE_API_KEY,
        strict: true,
        schema: buildStrictCandidateCheckSchema("groq"),
        systemPrompt: CHECK_SYSTEM_PROMPT,
        stream: true,
        timeoutMs: 900_000,
      })
    : config.transport === "deepseek-structured"
      ? createStructuredProviderTransport<CompilerModelV2CheckInput>({
          providerId: config.model.providerId,
          modelId: config.model.modelId,
          apiKey: config.env?.DEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY,
          schema: CANDIDATE_CHECK_JSON_SCHEMA,
          systemPrompt: CHECK_SYSTEM_PROMPT,
        })
      : undefined
  const compilers = new Map<string, IntentCompilerV2>()

  const compilerFor = (runId: string): IntentCompilerV2 => {
    const existing = compilers.get(runId)
    if (existing) return existing
    const compiler = createIntentCompilerV2({
      store: new IntentStoreV2({ storeDir, runId }),
      model: createCompilerModelV2(transport, checkTransport),
      capabilities: {
        operations: [...config.capabilities.operations],
        workspace_root: config.capabilities.workspaceRoot,
        describeMaterial: (paths) => paths.map((path) => ({
          path,
          exists: existsSync(path),
          readable_by_executor: readableByExecutor(path),
        })),
        describeArtifacts: (paths) => describeArtifacts(workspaceDir, paths),
      },
    })
    compilers.set(runId, compiler)
    return compiler
  }

  return Object.freeze({
    acceptEvent(event: CompilerEvent): Promise<EventReceipt> {
      return compilerFor(event.run_id).acceptEvent(event)
    },
    advance(input: { runId: string }): Promise<AdvanceResult> {
      return compilerFor(input.runId).advance(input)
    },
    authorize(request: AuthorizeRequest): AuthorizationResult {
      return compilerFor(request.run_id).authorize(request)
    },
    inspect(input: { runId: string }): Promise<RunView> {
      return compilerFor(input.runId).inspect(input)
    },
  })
}

/** Readability only; the compiler never reads material content. */
function readableByExecutor(path: string): boolean {
  try {
    accessSync(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024
const artifactDigestCache = new Map<string, { size: number; mtimeMs: number; digest: string }>()

/**
 * Host-side artifact digests.  Only the paths the executor declared are read,
 * the file must stay inside the workspace, and a file above the size cap is
 * reported as unverifiable instead of being streamed.  Cached by
 * (path, size, mtime) so a repeated return does not re-read unchanged files.
 */
async function describeArtifacts(
  workspaceDir: string,
  paths: readonly string[],
): Promise<Array<{ path: string; digest?: string; reason?: string }>> {
  const facts: Array<{ path: string; digest?: string; reason?: string }> = []
  for (const path of paths) {
    const absolute = resolve(workspaceDir, path)
    const relativeToWorkspace = path === "" ? ".." : requireInsideWorkspace(workspaceDir, absolute)
    if (relativeToWorkspace !== undefined) {
      facts.push({ path, reason: relativeToWorkspace })
      continue
    }
    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(absolute)
    } catch {
      facts.push({ path, reason: "missing" })
      continue
    }
    if (!stats.isFile()) {
      facts.push({ path, reason: "not_a_file" })
      continue
    }
    if (stats.size > MAX_ARTIFACT_BYTES) {
      facts.push({ path, reason: `larger_than_${MAX_ARTIFACT_BYTES}` })
      continue
    }
    const cached = artifactDigestCache.get(absolute)
    if (cached !== undefined && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
      facts.push({ path, digest: cached.digest })
      continue
    }
    try {
      const digest = await hashFile(absolute)
      artifactDigestCache.set(absolute, { size: stats.size, mtimeMs: stats.mtimeMs, digest })
      facts.push({ path, digest })
    } catch {
      facts.push({ path, reason: "read_failed" })
    }
  }
  return facts
}

function requireInsideWorkspace(workspaceDir: string, absolute: string): string | undefined {
  const relative = relativePath(workspaceDir, absolute)
  if (relative === undefined) return "outside_workspace"
  return undefined
}

function relativePath(workspaceDir: string, absolute: string): string | undefined {
  const relativeTo = relative(workspaceDir, absolute)
  if (relativeTo === "" || relativeTo.startsWith("..") || isAbsolute(relativeTo)) return undefined
  return relativeTo
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash("sha256")
    const stream = createReadStream(path)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", (error) => rejectPromise(error))
    stream.on("end", () => resolvePromise(`sha256:${hash.digest("hex")}`))
  })
}

function requireAbsolute(value: string, label: string): string {
  if (typeof value !== "string" || !isAbsolute(value)) throw new Error(`${label} must be an absolute path`)
  return value
}

function nonEmpty(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be non-empty`)
  return value
}

function requireNonOverlap(left: string, right: string, leftLabel: string, rightLabel: string): void {
  if (pathsOverlap(left, right)) throw new Error(`${leftLabel} and ${rightLabel} must not overlap`)
}

function requireOutside(candidate: string, parent: string, candidateLabel: string, parentLabel: string): void {
  if (isWithin(candidate, parent)) throw new Error(`${candidateLabel} must be outside ${parentLabel}`)
}

function pathsOverlap(left: string, right: string): boolean {
  return isWithin(left, right) || isWithin(right, left)
}

function isWithin(candidate: string, parent: string): boolean {
  const path = relative(resolve(parent), resolve(candidate))
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
}
