import assert from "node:assert/strict"
import test from "node:test"

test("built package entry exposes host helpers without internal store/model steps", async () => {
  const packageName: string = "opencode-intent-compiler-experiment"
  const publicModule = await import(packageName) as Record<string, unknown>

  for (const name of [
    "createIntentCompiler",
    "ExperimentRuntimePlugin",
    "ensurePrdcheckRunConfig",
    "createOpenCodeJsonlFile",
    "readCurrentCompiledIntent",
    "admitPrdcheckEvidence",
    "runRealChainPreflight",
    "createWorkspaceSnapshot",
  ]) {
    assert.equal(typeof publicModule[name], "function", `${name} must be a public function`)
  }

  for (const name of [
    "CompilerStore",
    "createCompilerModel",
    "createOpenCodeModelTransport",
    "admitEvidenceToStore",
  ]) {
    assert.equal(name in publicModule, false, `${name} must remain an internal implementation detail`)
  }
})
