export type LooseRecord = Record<string, any>

export interface ErrorValue {
  type: string
  message: string
  [key: string]: any
}

export interface ArtifactRef {
  artifact_type: string
  media_type: string
  digest: string
  size: number
  path: string
  [key: string]: any
}

export interface Manifest {
  schema_version?: string
  run_id: string
  arm_id: string
  task_id: string
  turn_id: string
  session_id: string
  [key: string]: any
}

export interface Registration extends Manifest {
  schema_version: "0.1"
  created_at?: string
  /**
   * The exact user turn and harness text supplied by the host.  These values
   * are materialized by SessionRegistry from the host's isolated UTF-8 files;
   * they are not read from process arguments or environment text values.
   */
  user_input_text?: string
  harness_system_text?: string
  /** Optional stable identity shared by executor messages for one user turn. */
  input_identity?: string
  source_category?: string
  stage_id?: string
  path_id?: string
  round?: number
  task_occurrence_id?: string
  workspace_snapshot_id?: string
  produced_at?: string
}

export interface EventInput {
  turn_id?: string
  session_id?: string
  component: string
  event_type: string
  status?: string
  message_id?: string
  call_id?: string
  parent_event_id?: string
  artifact_refs?: ArtifactRef[]
  metrics?: LooseRecord
  error?: ErrorValue
  data?: LooseRecord
  [key: string]: any
}

export interface ObserverEvent extends EventInput {
  schema_version: string
  event_id: string
  sequence: number
  timestamp: string
  monotonic_ns: string
  run_id: string
  arm_id: string
  task_id: string
  turn_id: string
  session_id: string
}

export interface TextPart {
  id: string
  type: "text"
  text: string
  sessionID?: string
  messageID?: string
  [key: string]: any
}

export interface ObserverPart {
  id?: string
  type?: string
  text?: string
  sessionID?: string
  messageID?: string
  callID?: string
  tool?: string
  state?: LooseRecord
  tokens?: LooseRecord
  cost?: number
  reason?: string
  snapshot?: unknown
  attempt?: number
  [key: string]: any
}

export interface ChatMessageInput {
  sessionID: string
  messageID?: string
  [key: string]: any
}

export interface ChatMessageOutput {
  message?: { id?: string; [key: string]: any }
  parts: ObserverPart[]
  [key: string]: any
}

export interface ModelRequestInput {
  sessionID: string
  agent?: string
  model?: { id?: string; modelID?: string; providerID?: string; [key: string]: any }
  message?: { id?: string; [key: string]: any }
  [key: string]: any
}

export interface ModelRequestOutput {
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  [key: string]: any
}

export interface ToolHookInput {
  sessionID: string
  callID: string
  tool?: string
  [key: string]: any
}

export interface ToolBeforeOutput {
  args?: unknown
  [key: string]: any
}

export interface ToolAfterOutput {
  title?: string
  output?: unknown
  metadata?: unknown
  [key: string]: any
}

export interface ObserverEventEnvelope {
  type?: string
  properties?: LooseRecord
  [key: string]: any
}

export interface SdkMessage {
  info?: SdkMessageInfo
  parts?: ObserverPart[]
  [key: string]: any
}

export interface SdkMessageInfo {
  id: string
  sessionID?: string
  role?: string
  time?: LooseRecord
  modelID?: string
  providerID?: string
  cost?: number
  tokens?: LooseRecord
  finish?: string
  error?: unknown
  [key: string]: any
}

export interface PendingDelivery {
  schema_version: string
  message_id: string
  session_id: string
  turn_id: string
  expected_parts: Array<{ id: string; text: string }>
  expected_digest: string
  expected_artifact: ArtifactRef
  observed_parts: Record<string, string>
  resolved?: boolean
  observed_digest?: string
  matches_expected?: boolean
  part_update_resolved?: boolean
  part_update_digest?: string
  part_update_matches_expected?: boolean
  sdk_readback_status?: "confirmed" | "rejected"
  sdk_readback_digest?: string
  [key: string]: any
}

export interface ObserverClient {
  session?: {
    messages?: (options: { path: { id: string } }) => Promise<unknown>
    [key: string]: any
  }
  [key: string]: any
}

export interface RunSummary {
  schema_version: "0.1"
  run_id: string
  arm_id: string
  task_id: string
  turn_id: string
  session_id: string
  status: string
  event_count: number
  inputs: Array<{ event_type: string; message_id?: string; digest?: string; matches_expected?: boolean }>
  tools: {
    total: number
    completed: number
    error: number
    unresolved: number
    calls: Array<LooseRecord>
  }
  models: {
    requests: number
    usage_bearing_completions: number
    unmetered_requests_lower_bound: number
    input_tokens: number | "unavailable"
    output_tokens: number | "unavailable"
    reasoning_tokens: number | "unavailable"
    cache_read_tokens: number | "unavailable"
    cost: number | "unavailable"
    cost_kinds: string[]
    messages: Array<LooseRecord>
    request_events: Array<LooseRecord>
  }
  workspace_changes: unknown[]
  instrumentation_failures: Array<{ event_id: string; event_type: string; error?: ErrorValue }>
}
