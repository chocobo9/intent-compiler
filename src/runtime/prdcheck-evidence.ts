import { CompilerStore } from "../core/compiler-store.js"
import {
  admitEvidenceToStore,
  type EvidenceResult,
} from "../core/intent-compiler.js"
import {
  createPrdcheckAdapter,
  type PrdcheckHostEvidence,
} from "../adapters/prdcheck.js"

export interface PrdcheckEvidenceAdmissionOptions {
  compilerStoreDirectory: string
  observerStoreDirectory: string
  executorWorkspaceDirectory: string
  evidence: PrdcheckHostEvidence
}

/**
 * Convert one explicitly sourced prdcheck result and admit it for its named
 * next-input boundary. This path constructs no model client or session.
 */
export function admitPrdcheckEvidence(options: PrdcheckEvidenceAdmissionOptions): EvidenceResult {
  const candidate = createPrdcheckAdapter().toEvidenceCandidate(options.evidence)
  const store = new CompilerStore({
    storeDir: options.compilerStoreDirectory,
    observerStoreDir: options.observerStoreDirectory,
    executorWorkspaceDir: options.executorWorkspaceDirectory,
  })
  return admitEvidenceToStore(store, candidate.request)
}
