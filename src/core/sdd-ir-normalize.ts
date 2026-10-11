/**
 * Deterministic repair of IR answers whose shape, not content, fails the strict
 * schema, where exactly one mapping exists. Every change is recorded (path, from,
 * to, why). Anything ambiguous is left as it is, so the original validation
 * still rejects it. The IR design and instructions are unchanged.
 */
export interface IrNormalization { path: string; from: unknown; to: unknown; reason: string }

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v)
const SOURCE_KEYS = ["quote", "segment_id", "span"] as const

export function normalizeIrProposal(input: unknown): { value: unknown; changes: IrNormalization[] } {
  const value = structuredClone(input)
  const changes: IrNormalization[] = []
  if (!isObject(value)) return { value, changes }
  const note = (path: string, from: unknown, to: unknown, reason: string) => changes.push({ path, from, to, reason })

  // A source reference that names its input but leaves out a nullable locator key: the key is null.
  const sourceRef = (ref: unknown, path: string) => {
    if (!isObject(ref) || typeof ref.source_id !== "string" || typeof ref.digest !== "string") return
    for (const key of SOURCE_KEYS) if (!(key in ref)) { ref[key] = null; note(`${path}/${key}`, undefined, null, "omitted nullable source locator") }
  }
  const sourceRefs = (refs: unknown, path: string) => { if (Array.isArray(refs)) refs.forEach((r, i) => sourceRef(r, `${path}/${i}`)) }

  const groups = Array.isArray(value.groups) ? value.groups : []
  // source_coverage belongs to the answer, not to a group: move it when the answer has none.
  if (!("source_coverage" in value)) {
    const nested = groups.filter(g => isObject(g) && Array.isArray(g.source_coverage)) as Json[]
    if (nested.length) {
      value.source_coverage = nested.flatMap(g => g.source_coverage as unknown[])
      nested.forEach(g => { delete g.source_coverage })
      note("/source_coverage", "in groups", "answer level", "source_coverage written inside groups")
    }
  }
  // questions belong to a group: with exactly one group, an answer-level list is that group's.
  if (Array.isArray(value.questions) && groups.length === 1 && isObject(groups[0]) && !("questions" in groups[0])) {
    (groups[0] as Json).questions = value.questions
    delete value.questions
    note("/groups/0/questions", "answer level", "group", "questions written at answer level with one group")
  }
  groups.forEach((g, gi) => {
    if (!isObject(g) || !Array.isArray(g.ir_changes) || !Array.isArray(g.task_refs)) return
    if (!("questions" in g)) { g.questions = []; note(`/groups/${gi}/questions`, undefined, [], "a group without questions has none") }
    g.ir_changes.forEach((ch, ci) => {
      if (!isObject(ch)) return
      const path = `/groups/${gi}/ir_changes/${ci}`
      // revise, retire and edit address an existing object by id; a local_ref beside it names nothing.
      if (["revise", "retire", "edit"].includes(ch.action as string) && typeof ch.id === "string" && "local_ref" in ch) {
        note(`${path}/local_ref`, ch.local_ref, undefined, `${ch.action} addresses ${ch.id} by id`); delete ch.local_ref
      }
      if (ch.action === "edit" && "sources" in ch) {
        if (Array.isArray(ch.basis) && ch.basis.length) { note(`${path}/sources`, "present", undefined, "edit carries its basis; sources is not an edit field"); delete ch.sources }
        else if (!("basis" in ch) || (Array.isArray(ch.basis) && !ch.basis.length)) { ch.basis = ch.sources; delete ch.sources; note(`${path}/basis`, "sources", "basis", "edit names its basis as sources") }
      }
      // Only the nullable source_ref form takes null locators; content changes and edits use the
      // quote-or-segment form, which has no null fields and stays as written.
      const contentForm = ch.action === "edit" || (["create", "revise"].includes(ch.action as string) && ch.target === "content")
      if (!contentForm) sourceRefs(ch.sources, `${path}/sources`)
    })
  })
  if (Array.isArray(value.source_coverage)) value.source_coverage.forEach((entry, i) => {
    if (!isObject(entry)) return
    sourceRef(entry.source, `/source_coverage/${i}/source`)
    sourceRefs(entry.basis, `/source_coverage/${i}/basis`)
  })
  return { value, changes }
}
