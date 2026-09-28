export { ExperimentObserverPlugin } from "./observer/plugin.js"
export { ObserverRuntime } from "./observer/runtime.js"
export { SessionRegistry } from "./observer/registry.js"
export { EventStore } from "./observer/event-store.js"
export { projectRun, renderReport } from "./observer/projector.js"

export { createIntentCompiler, IntentCompilerError } from "./core/intent-compiler.js"
export type {
  IntentCompiler,
  IntentCompilerOptions,
  PrepareTurnRequest,
  PrepareTurnResult,
  PrepareTurnSuccess,
  PrepareTurnFailure,
  CompilerErrorDetail,
  DeliveryRequest,
  DeliveryResult,
  EvidenceRequest,
  EvidenceResult,
  RecoveryRequest,
} from "./core/intent-compiler.js"

export { createIntentCompilerV2, IntentCompilerV2Error } from "./core/intent-compiler-v2.js"
export type { CapabilitySource, IntentCompilerV2, IntentCompilerV2Options } from "./core/intent-compiler-v2.js"
export { IntentStoreV2 } from "./core/compiler-store-v2.js"
export type {
  AssessmentRecord,
  CheckRecord,
  ExecutionOutcomeRecord,
  ManagementRequestRecord,
  QuestionRecord,
  V2AdvanceDeltas,
  V2EventRecord,
  V2RunSnapshot,
  V2StoreOptions,
} from "./core/compiler-store-v2.js"
export {
  SCHEMA_VERSION,
  IntentContractError,
  canonicalJson,
  digestOf,
  digestText,
  isRef,
  isSourceRef,
  validateCandidate,
  validateCompiledIntent,
  validateEvent,
  validateExecutionOutcome,
  validateExecutionReturnPayload,
} from "./core/intent-contract.js"
export type {
  AdvanceResult,
  AssessmentDraft,
  Atom,
  AtomInput,
  AtomOutput,
  AtomStatus,
  AuthorizationResult,
  AuthorizeRequest,
  Binding,
  Candidate,
  CandidateGroup,
  CompiledIntent,
  CompiledIntentDraft,
  CompilerEvent,
  Condition,
  ContentItem,
  EventReceipt,
  ExecutionReturnPayload,
  ExecutionView,
  ExecutionOutcome,
  ExecutionTask,
  IntentJudgment,
  IrChange,
  OperationRequest,
  OutputSpec,
  PermissionRule,
  Ref,
  Relation,
  RunView,
  Scope,
  SourceRef,
  StartRequest,
  Support,
  TaskIntent,
} from "./core/intent-contract.js"
export { applyIrChanges, IntentStateManager, validateTaskIntent } from "./core/intent-state-v2.js"
export type { IntentStateError, IntentStateResult } from "./core/intent-state-v2.js"
export { AtomStateLedger, atomStateKey, buildCompiledIntents, compiledIntentRef, summarizeCompiledIntent } from "./core/compiled-intent.js"
export { evaluateCondition, ExecutionStateManager } from "./core/execution-state.js"
export type { AuthorizationContext, ConditionVerdict, DispatchRecord, ExecutionRecord } from "./core/execution-state.js"
export { createCompilerModelV2, CompilerModelV2Error } from "./model/compiler-model-v2.js"
export type { CompilerModelV2, CompilerModelV2Input, CompilerModelV2Transport } from "./model/compiler-model-v2.js"
export type {
  CompilerModelV2Call,
  CompilerModelV2FailureDiagnostic,
  CompilerModelV2Result,
  CompilerModelV2Usage,
  ExistingObjectDirectory,
} from "./model/compiler-model-v2.js"
export { CANDIDATE_JSON_SCHEMA, validateCandidateSchema } from "./model/candidate-schema.js"
export type { CandidateSchemaResult } from "./model/candidate-schema.js"
export { buildStrictCandidateSchema } from "./model/candidate-schema-strict.js"
export {
  createStructuredProviderTransport,
  StructuredProviderTransportError,
} from "./model/structured-provider-transport.js"
export type { StructuredProviderTransportOptions } from "./model/structured-provider-transport.js"

export {
  createOpenCodeModelTransportV2,
  OpenCodeModelTransportError,
} from "./model/opencode-transport.js"
export type {
  OpenCodeModelTransportV2,
  OpenCodeModelTransportV2Options,
} from "./model/opencode-transport.js"

export { createIntentCompilerRuntime } from "./harness/runtime-factory.js"
export type { IntentCompilerRuntimeOptions } from "./harness/runtime-factory.js"
export type {
  HostDispatchContent,
  HostOperationResolver,
  HostToolInvocation,
  HostUserInput,
  IntentCompilerRuntimeConfig,
} from "./harness/host-contract.js"

export {
  createOpenCodeCompilerRuntimeV2,
  OpenCodeCompilerRuntimeV2Error,
} from "./runtime/opencode-compiler-v2.js"
export type { OpenCodeCompilerRuntimeV2Options } from "./runtime/opencode-compiler-v2.js"

export {
  createOpenCodeAdapter,
  ExperimentRuntimePlugin,
  OpenCodeAdapterError,
} from "./adapters/opencode.js"
export type {
  OpenCodeAdapter,
  OpenCodeAdapterHooks,
  OpenCodeAdapterOptions,
  OpenCodeArm,
  OpenCodeV2Delivery,
  ResolveV2Operation,
  OpenCodeTurnIdentity,
  ResolveOpenCodeTurn,
} from "./adapters/opencode.js"

export { createPrdcheckAdapter, PrdcheckAdapterError } from "./adapters/prdcheck.js"
export type {
  PrdcheckAdapter,
  PrdcheckHostInput,
  PrdcheckHostEvidence,
  PrdcheckEvidenceCandidate,
  PrdcheckAuditEnvelope,
  PrdcheckIsolationCheck,
} from "./adapters/prdcheck.js"

export {
  ensurePrdcheckRunConfig,
  PrdcheckRunConfigError,
} from "./adapters/prdcheck-run-config.js"
export type {
  PrdcheckRunConfigInput,
  PrdcheckRunConfigResult,
} from "./adapters/prdcheck-run-config.js"

export {
  appendOpenCodeJsonlEvent,
  createOpenCodeJsonlFile,
  openCodeJsonlFileName,
  OpenCodeJsonlError,
  readOpenCodeJsonl,
} from "./adapters/opencode-jsonl.js"
export type {
  OpenCodeJsonEventEnvelope,
  OpenCodeJsonlFile,
  OpenCodeJsonlIdentity,
  OpenCodeJsonlReadResult,
} from "./adapters/opencode-jsonl.js"

export {
  createWorkspaceSnapshot,
  WorkspaceSnapshotError,
} from "./adapters/workspace-snapshot.js"
export type {
  WorkspaceSnapshot,
  WorkspaceSnapshotDirectoryEntry,
  WorkspaceSnapshotEntry,
  WorkspaceSnapshotErrorCode,
  WorkspaceSnapshotFileEntry,
  WorkspaceSnapshotInput,
  WorkspaceSnapshotManifest,
} from "./adapters/workspace-snapshot.js"

export { runRealChainPreflight } from "./runtime/real-chain-preflight.js"
export type {
  RealChainPreflightCheck,
  RealChainPreflightInput,
  RealChainPreflightProbe,
  RealChainPreflightResult,
  RealChainProbeSnapshot,
} from "./runtime/real-chain-preflight.js"

export { admitPrdcheckEvidence } from "./runtime/prdcheck-evidence.js"
export type { PrdcheckEvidenceAdmissionOptions } from "./runtime/prdcheck-evidence.js"

export {
  CurrentCompiledIntentError,
  readCurrentCompiledIntent,
} from "./runtime/current-compiled-intent.js"
export type {
  CurrentCompiledIntentOptions,
  CurrentCompiledIntentResult,
} from "./runtime/current-compiled-intent.js"

export {
  CurrentCompiledIntentV2Error,
  readCurrentCompiledIntentV2,
} from "./runtime/current-compiled-intent-v2.js"
export type {
  CurrentCompiledIntentV2Options,
  CurrentCompiledIntentV2Result,
} from "./runtime/current-compiled-intent-v2.js"

export {
  compareCostSummaries,
  CostSummaryError,
  readCostSummary,
} from "./runtime/cost-summary.js"
export type {
  CostComparison,
  CostDelta,
  CostSummary,
  CostSummaryOptions,
  NumericCosts,
} from "./runtime/cost-summary.js"
