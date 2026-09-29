/** Concrete local tools exposed by the pinned OpenCode registry for this model.
 * These are capabilities, not grants: each Atom still needs its own Authority.
 */
export function openCodeOperationsForModel(modelId: string, configured?: string): string[] {
  const usePatch = modelId.includes("gpt-") && !modelId.includes("oss") && !modelId.includes("gpt-4")
  const defaults = ["read", ...(usePatch ? ["apply_patch"] : ["write", "edit"]), "bash", "glob", "grep", "todowrite"]
  if (configured === undefined) return defaults
  const operations = [...new Set(configured.split(",").map(value => value.trim()).filter(Boolean))]
  if (operations.length === 0) throw new Error("INTENT_COMPILER_OPERATIONS must list at least one concrete tool")
  const hidden = usePatch ? ["write", "edit"] : ["apply_patch"]
  const unavailable = operations.filter(operation => hidden.includes(operation))
  if (unavailable.length) {
    throw new Error(`OpenCode hides ${unavailable.join(", ")} for executor model ${modelId}; use ${usePatch ? "apply_patch" : "write/edit"} for file editing`)
  }
  return operations
}
