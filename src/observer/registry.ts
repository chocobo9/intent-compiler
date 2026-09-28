import { readFileSync, realpathSync, statSync } from "node:fs"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { readJsonIfExists, safeSegment, writeJsonAtomic } from "./files.js"
import type { Registration } from "./types.js"

/**
 * Paths are deliberately the only file-registration inputs.  The file
 * contents never travel through argv or an environment variable.
 */
export interface RegistrationTextFileOptions {
  user_input_file?: string
  harness_system_file?: string
  executor_workspace?: string
}

type RegistrationInput = Omit<Registration, "schema_version"> &
  RegistrationTextFileOptions & {
    schema_version?: string
  }

export class SessionRegistry {
  readonly storeDir: string
  readonly env: NodeJS.ProcessEnv

  constructor(storeDir: string, env: NodeJS.ProcessEnv = process.env) {
    this.storeDir = storeDir
    this.env = env
  }

  register(registration: RegistrationInput, files?: RegistrationTextFileOptions): Registration {
    const value = validateRegistration(registration)
    const fileOptions = mergeTextFileOptions(registration, files)
    const materialized = fileOptions
      ? materializeTextFiles(value, fileOptions)
      : value
    writeJsonAtomic(this.path(materialized.session_id), materialized)
    return materialized
  }

  resolve(sessionId: string): Registration | undefined {
    const existing = this.resolveExisting(sessionId)
    if (existing) return validateRegistration(existing)
    if (this.env.EXPERIMENT_OBSERVER_AUTO_REGISTER !== "1") return undefined

    const configuredFiles = configuredTextFiles(this.env)
    return this.register({
      schema_version: "0.1",
      run_id: this.env.EXPERIMENT_RUN_ID ?? `smoke-${Date.now()}`,
      arm_id: this.env.EXPERIMENT_ARM_ID ?? "unclassified",
      task_id: this.env.EXPERIMENT_TASK_ID ?? "manual-smoke",
      turn_id: this.env.EXPERIMENT_TURN_ID ?? "1",
      session_id: sessionId,
      created_at: new Date().toISOString(),
      ...(configuredEnv(this.env, "EXPERIMENT_INPUT_IDENTITY") === undefined
        ? {}
        : {
            input_identity: configuredEnv(this.env, "EXPERIMENT_INPUT_IDENTITY"),
          }),
      ...(configuredEnv(this.env, "EXPERIMENT_INPUT_SOURCE_CATEGORY") === undefined
        ? {}
        : { source_category: configuredEnv(this.env, "EXPERIMENT_INPUT_SOURCE_CATEGORY") }),
      ...(configuredEnv(this.env, "EXPERIMENT_STAGE_ID") === undefined
        ? {}
        : { stage_id: configuredEnv(this.env, "EXPERIMENT_STAGE_ID") }),
      ...(configuredEnv(this.env, "EXPERIMENT_PATH_ID") === undefined
        ? {}
        : { path_id: configuredEnv(this.env, "EXPERIMENT_PATH_ID") }),
      ...(configuredRound(this.env) === undefined ? {} : { round: configuredRound(this.env) }),
      ...(configuredEnv(this.env, "EXPERIMENT_TASK_OCCURRENCE_ID") === undefined
        ? {}
        : { task_occurrence_id: configuredEnv(this.env, "EXPERIMENT_TASK_OCCURRENCE_ID") }),
      ...(configuredEnv(this.env, "EXPERIMENT_WORKSPACE_SNAPSHOT_ID") === undefined
        ? {}
        : { workspace_snapshot_id: configuredEnv(this.env, "EXPERIMENT_WORKSPACE_SNAPSHOT_ID") }),
      ...(configuredEnv(this.env, "EXPERIMENT_INPUT_PRODUCED_AT") === undefined
        ? {}
        : { produced_at: configuredEnv(this.env, "EXPERIMENT_INPUT_PRODUCED_AT") }),
    }, configuredFiles)
  }

  resolveExisting(sessionId: string): Registration | undefined {
    if (!/^[A-Za-z0-9._-]+$/u.test(sessionId)) return undefined
    const existing = readJsonIfExists(this.path(sessionId))
    return existing ? validateRegistration(existing) : undefined
  }

  path(sessionId: string): string {
    return join(this.storeDir, "registrations", `${safeSegment(sessionId, "session_id")}.json`)
  }
}

function configuredTextFiles(env: NodeJS.ProcessEnv): RegistrationTextFileOptions | undefined {
  const userInputFile = configuredEnv(env, "EXPERIMENT_USER_INPUT_FILE")
  const harnessSystemFile = configuredEnv(env, "EXPERIMENT_HARNESS_SYSTEM_FILE")
  const executorWorkspace = configuredEnv(env, "EXPERIMENT_EXECUTOR_WORKSPACE")
  if (userInputFile === undefined && harnessSystemFile === undefined && executorWorkspace === undefined) return undefined
  return { user_input_file: userInputFile, harness_system_file: harnessSystemFile, executor_workspace: executorWorkspace }
}

function configuredEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]
  return value === undefined || value.length === 0 ? undefined : value
}

function configuredRound(env: NodeJS.ProcessEnv): number | undefined {
  const value = configuredEnv(env, "EXPERIMENT_ROUND")
  if (value === undefined) return undefined
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) throw new Error("EXPERIMENT_ROUND must be a non-negative integer")
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error("EXPERIMENT_ROUND must be a safe integer")
  return parsed
}

function mergeTextFileOptions(
  registration: RegistrationInput,
  options?: RegistrationTextFileOptions,
): RegistrationTextFileOptions | undefined {
  const registrationRecord = registration as RegistrationInput & Record<string, unknown>
  const merged: RegistrationTextFileOptions = {
    user_input_file: options?.user_input_file ?? registrationRecord.user_input_file,
    harness_system_file: options?.harness_system_file ?? registrationRecord.harness_system_file,
    executor_workspace: options?.executor_workspace ?? registrationRecord.executor_workspace,
  }
  const hasAny = Object.values(merged).some((value) => value !== undefined)
  return hasAny ? merged : undefined
}

function materializeTextFiles(registration: Registration, files: RegistrationTextFileOptions): Registration {
  const hasUserFile = files.user_input_file !== undefined
  const hasHarnessFile = files.harness_system_file !== undefined
  if (hasUserFile !== hasHarnessFile) {
    throw new Error("user_input_file and harness_system_file must be provided together")
  }
  if (!hasUserFile) {
    if (files.executor_workspace !== undefined) throw new Error("executor_workspace requires both text files")
    return registration
  }
  if (registration.user_input_text !== undefined || registration.harness_system_text !== undefined) {
    throw new Error("text files cannot be combined with user_input_text or harness_system_text")
  }
  const workspace = requireAbsolutePath(files.executor_workspace, "executor_workspace")
  const userInputPath = externalTextFile(files.user_input_file as string, workspace, "user_input_file")
  const harnessSystemPath = externalTextFile(files.harness_system_file as string, workspace, "harness_system_file")
  return {
    ...registration,
    user_input_text: readUtf8Text(userInputPath, "user_input_file"),
    harness_system_text: readUtf8Text(harnessSystemPath, "harness_system_file"),
  }
}

function requireAbsolutePath(value: string | undefined, label: string): string {
  if (typeof value !== "string" || !isAbsolute(value)) throw new Error(`${label} must be an absolute path`)
  return resolve(value)
}

function externalTextFile(value: string, workspace: string, label: string): string {
  const lexicalPath = requireAbsolutePath(value, label)
  const workspacePath = requireExistingDirectory(workspace, "executor_workspace")
  if (isWithin(lexicalPath, workspacePath)) {
    throw new Error(`${label} must be outside the executor workspace`)
  }
  let realPath: string
  try {
    realPath = realpathSync(lexicalPath)
  } catch (error: unknown) {
    throw new Error(`${label} could not be resolved: ${errorMessage(error)}`)
  }
  const realWorkspacePath = realpathSync(workspacePath)
  if (isWithin(realPath, realWorkspacePath)) {
    throw new Error(`${label} must be outside the executor workspace`)
  }
  let stats
  try {
    stats = statSync(realPath)
  } catch (error: unknown) {
    throw new Error(`${label} could not be read: ${errorMessage(error)}`)
  }
  if (!stats.isFile()) throw new Error(`${label} must refer to a regular file`)
  return realPath
}

function requireExistingDirectory(value: string, label: string): string {
  let stats
  try {
    stats = statSync(value)
  } catch (error: unknown) {
    throw new Error(`${label} could not be read: ${errorMessage(error)}`)
  }
  if (!stats.isDirectory()) throw new Error(`${label} must refer to a directory`)
  return value
}

function readUtf8Text(path: string, label: string): string {
  let bytes
  try {
    bytes = readFileSync(path)
  } catch (error: unknown) {
    throw new Error(`${label} could not be read: ${errorMessage(error)}`)
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw new Error(`${label} must contain valid UTF-8 text`)
  }
}

function isWithin(candidate: string, parent: string): boolean {
  const normalizeCase = (value: string): string => (process.platform === "win32" ? value.toLowerCase() : value)
  const relativePath = relative(normalizeCase(parent), normalizeCase(candidate))
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function validateRegistration(value: unknown): Registration {
  if (!value || typeof value !== "object") throw new Error("registration must be an object")
  const record = value as Record<string, unknown>
  for (const field of ["run_id", "arm_id", "task_id", "turn_id", "session_id"]) {
    safeSegment(String(record[field] ?? ""), field)
  }
  const userInputText = optionalText(record.user_input_text, "user_input_text")
  const harnessSystemText = optionalText(record.harness_system_text, "harness_system_text")
  if ((userInputText === undefined) !== (harnessSystemText === undefined)) {
    throw new Error("user_input_text and harness_system_text must be provided together")
  }
  const inputIdentity = optionalIdentity(record.input_identity)
  const sourceCategory = optionalNonEmptyText(record.source_category, "source_category")
  const stageId = optionalNonEmptyText(record.stage_id, "stage_id")
  const pathId = optionalNonEmptyText(record.path_id, "path_id")
  const round = optionalNonNegativeInteger(record.round, "round")
  const taskOccurrenceId = optionalNonEmptyText(record.task_occurrence_id, "task_occurrence_id")
  const workspaceSnapshotId = optionalNonEmptyText(record.workspace_snapshot_id, "workspace_snapshot_id")
  const producedAt = optionalNonEmptyText(record.produced_at, "produced_at")
  const {
    user_input_file: _userInputFile,
    harness_system_file: _harnessSystemFile,
    executor_workspace: _executorWorkspace,
    ...canonicalRecord
  } = record
  return {
    schema_version: "0.1",
    ...canonicalRecord,
    run_id: String(record.run_id),
    arm_id: String(record.arm_id),
    task_id: String(record.task_id),
    turn_id: String(record.turn_id),
    session_id: String(record.session_id),
    ...(userInputText === undefined ? {} : { user_input_text: userInputText, harness_system_text: harnessSystemText }),
    ...(inputIdentity === undefined ? {} : { input_identity: inputIdentity }),
    ...(sourceCategory === undefined ? {} : { source_category: sourceCategory }),
    ...(stageId === undefined ? {} : { stage_id: stageId }),
    ...(pathId === undefined ? {} : { path_id: pathId }),
    ...(round === undefined ? {} : { round }),
    ...(taskOccurrenceId === undefined ? {} : { task_occurrence_id: taskOccurrenceId }),
    ...(workspaceSnapshotId === undefined ? {} : { workspace_snapshot_id: workspaceSnapshotId }),
    ...(producedAt === undefined ? {} : { produced_at: producedAt }),
  }
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${field} must be text`)
  return value
}

function optionalIdentity(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.length === 0) throw new Error("input_identity must be non-empty text")
  return value
}

function optionalNonEmptyText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be non-empty text`)
  return value
}

function optionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
  return value
}
