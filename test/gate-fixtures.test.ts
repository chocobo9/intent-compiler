import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { candidateIssues, resolveSourceRefs } from "../src/core/intent-compiler-v2.js"
import { evaluateCondition } from "../src/core/execution-state.js"
import { CANDIDATE_EXAMPLE } from "../src/model/candidate-example.js"

/**
 * Offline conformance fixtures: one fixed input per clause, answered by the
 * same functions the runtime calls.  No model requests, no keys, milliseconds.
 *
 * Each case says which clauses it guards and which gates must fire — the exact
 * set, so a rule that gets tightened ("this legal candidate is now rejected")
 * fails here in seconds instead of costing a real run (that is how the r11d
 * over-strict registration rule and the r11c check schema drift were found).
 *
 * Files live in test/fixtures/gates/; `_shared.json` holds the bases that cases
 * patch.  Merge rule: objects merge recursively, arrays and scalars replace.
 */
const projectRoot = new URL("../../", import.meta.url)
const fixtureDir = join(projectRoot.pathname.replace(/^\/([A-Za-z]:)/u, "$1"), "test", "fixtures", "gates")
const readJson = (path: string): any => JSON.parse(readFileSync(path, "utf8"))

const enforcement = readJson(join(projectRoot.pathname.replace(/^\/([A-Za-z]:)/u, "$1"), "development", "contract-enforcement.json"))
const clauseIds = new Set(readJson(join(projectRoot.pathname.replace(/^\/([A-Za-z]:)/u, "$1"), "development", "contract-clauses.json")).clauses.map((clause: any) => clause.id))
const factIds = new Set((enforcement.facts_to_recheck ?? []).map((fact: any) => fact.id))
const GATES: Array<{ id: string; clause: string; match: string }> = enforcement.gate_index

/** Which gate a candidate issue belongs to. The order in gate_index decides. */
function classify(message: string): string | undefined {
  return GATES.find((gate) => message.includes(gate.match))?.id
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Objects merge recursively; arrays and scalars replace. */
function merge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return structuredClone(base)
  if (!isPlainObject(base) || !isPlainObject(patch)) return structuredClone(patch)
  const out: Record<string, unknown> = structuredClone(base)
  for (const [key, value] of Object.entries(patch)) out[key] = merge((base as Record<string, unknown>)[key], value)
  return out
}

const shared = readJson(join(fixtureDir, "_shared.json"))
const files = readdirSync(fixtureDir).filter((name) => name.endsWith(".json") && !name.startsWith("_"))

interface Case {
  id: string
  kind?: "gate" | "conditions"
  base?: string
  edits?: Edit[]
  why?: string
  authority?: Authority
  clauses?: string[]
  clause?: string
  known_issue?: string
  events?: unknown
  ir?: unknown
  compiled?: unknown
  candidate?: unknown
  expect_gates?: string[]
  condition?: unknown
  context?: unknown
  expect?: string
}

interface Edit { path: string; value?: unknown; remove?: boolean }

/**
 * Where the expected result comes from.  A fixture is only evidence about the
 * project when its expectation is written somewhere the project already
 * agreed on — a clause, a line of the design document, or a recorded decision.
 * `behaviour: "current"` is the opposite: it records what the code does today
 * while a fact says the project wants something else.  Those cases are kept
 * visible in the counts instead of passing as if they were conformance.
 */
interface Authority {
  /** One of the enumerated clause ids (C.*, K.*, D.*). */
  clause?: string
  /** A written source that is not an enumerated clause, with a verbatim quote. */
  doc?: string
  quote?: string
  /** No normative authority: this expected result is today's behaviour. */
  behaviour?: "current"
  fact?: string
}

/**
 * Cases and bases address the ones that differ by path (`candidate.groups.0.task_refs`)
 * instead of restating a whole object: a fixture should show the one thing it varies.
 */
function applyEdits<T>(scenario: T, edits: readonly Edit[] = []): T {
  for (const edit of edits) {
    const parts = edit.path.split(".")
    const last = parts.pop() as string
    let node: any = scenario
    for (const part of parts) node = node?.[part]
    if (node === undefined) throw new Error(`edit path ${edit.path} does not exist`)
    if (edit.remove === true) delete node[last]
    else node[last] = structuredClone(edit.value)
  }
  return scenario
}

const cases: Array<{ file: string; entry: Case; bases: Record<string, any> }> = []
for (const file of files) {
  const payload = readJson(join(fixtureDir, file))
  const bases: Record<string, any> = { ...shared.bases, ...(payload.bases ?? {}) }
  for (const entry of payload.cases ?? []) cases.push({ file, entry, bases })
}

/** A base is either a scenario, or `{ extends, edits }` on top of another base. */
function resolveBase(name: string, bases: Record<string, any>, seen: string[] = []): Record<string, any> {
  const entry = bases[name]
  if (entry === undefined) throw new Error(`fixture base ${name} does not exist`)
  if (entry.extends === undefined) return structuredClone(entry)
  if (seen.includes(name)) throw new Error(`fixture base ${name} extends itself`)
  return applyEdits(resolveBase(entry.extends, bases, [...seen, name]), entry.edits ?? [])
}

test("every fixture declares what it guards and where its expectation comes from", () => {
  assert.ok(cases.length >= 20, `expected a real fixture set, found ${cases.length} cases`)
  let conforming = 0
  let characterizing = 0
  let anchoredToDocument = 0
  for (const { file, entry } of cases) {
    assert.ok(entry.id, `${file}: a case has no id`)
    const guarded = [...(entry.clauses ?? []), ...(entry.clause === undefined ? [] : [entry.clause])]
    for (const id of guarded) {
      assert.ok(clauseIds.has(id), `${entry.id}: cites unknown clause ${id}`)
    }
    const authority = entry.authority
    assert.ok(authority, `${entry.id}: no authority — say which clause, which document line, or which recorded fact the expected result comes from`)
    if (authority.behaviour === "current") {
      assert.equal(
        authority.fact,
        entry.known_issue,
        `${entry.id}: a case that records today's behaviour must carry known_issue equal to its authority fact`,
      )
      assert.ok(factIds.has(authority.fact as string), `${entry.id}: ${String(authority.fact)} is not in facts_to_recheck`)
      characterizing += 1
      continue
    }
    if (authority.clause !== undefined) {
      assert.ok(clauseIds.has(authority.clause), `${entry.id}: authority clause ${authority.clause} does not exist`)
      assert.ok(
        guarded.includes(authority.clause),
        `${entry.id}: authority clause ${authority.clause} is not among the clauses this case declares (${guarded.join(", ") || "none"})`,
      )
    } else {
      assert.ok(authority.doc && authority.quote, `${entry.id}: authority needs either a clause, or a doc plus a verbatim quote`)
      const source = readFileSync(join(projectRoot.pathname.replace(/^\/([A-Za-z]:)/u, "$1"), authority.doc as string), "utf8")
      assert.ok(
        source.includes(authority.quote as string),
        `${entry.id}: ${String(authority.doc)} no longer contains the quoted authority: ${String(authority.quote)}`,
      )
      anchoredToDocument += 1
    }
    conforming += 1
  }
  assert.ok(conforming >= 30, `expected the set to be mostly conformance cases, found ${conforming}`)
  assert.ok(characterizing >= 4, `expected the known deviations to stay visible, found ${characterizing}`)
  assert.ok(anchoredToDocument >= 5, `expected several cases anchored to a quoted document line, found ${anchoredToDocument}`)
})

for (const { entry, bases } of cases) {
  if (entry.kind === "conditions") {
    test(`gate fixture: ${entry.id}`, () => {
      const verdict = evaluateCondition(entry.condition as never, entry.context as never)
      assert.equal(verdict, entry.expect, `${entry.id}: ${entry.why ?? ""}`)
    })
    continue
  }
  test(`gate fixture: ${entry.id}`, () => {
    const fromBase = entry.base === undefined ? {} : resolveBase(entry.base, bases)
    const scenario = applyEdits(merge(fromBase, {
      events: entry.events,
      ir: entry.ir,
      compiled: entry.compiled,
      candidate: entry.candidate,
    }) as Record<string, unknown>, entry.edits)
    assert.ok(scenario.events !== undefined, `${entry.id}: no events (missing base?)`)
    assert.ok(scenario.candidate !== undefined, `${entry.id}: no candidate (missing base?)`)

    // Mirror the runtime order: source digests are written before any gate runs.
    const events = structuredClone(scenario.events) as never
    const candidate = structuredClone(scenario.candidate) as never
    resolveSourceRefs(candidate, events)
    const issues: string[] = candidateIssues(
      candidate,
      events,
      structuredClone(scenario.ir ?? {}) as never,
      structuredClone(scenario.compiled ?? {}) as never,
      { nextCompiledIntentId: () => "compiled-dry-run" } as never,
    )

    const unclassified = issues.filter((issue) => classify(issue) === undefined)
    assert.deepEqual(
      unclassified,
      [],
      `${entry.id}: these issues match no gate in development/contract-enforcement.json — attribute them to a clause before using them`,
    )
    const fired = [...new Set(issues.map((issue) => classify(issue) as string))].sort()
    assert.deepEqual(
      fired,
      [...(entry.expect_gates ?? [])].sort(),
      `${entry.id}: ${entry.why ?? ""}\nissues: ${JSON.stringify(issues, null, 2)}`,
    )
  })
}

/**
 * The candidate the model is shown must survive the gates it is shown with.
 * Its source ids are placeholders ("input-event-id") that resolve to nothing,
 * which today is recorded and not blocking (F12 in contract-enforcement.json).
 *
 * Authority: §8 "示例候选改为带 read/edit/bash、以 coverage 指向自身原子的
 * 交付原子" — the shipped example is the reference candidate, so a gate that
 * rejects it is wrong; the unresolvable source ids are the F12 deviation.
 */
test("the shipped example candidate passes the gate layer", () => {
  const candidate = structuredClone(CANDIDATE_EXAMPLE) as never as { basis: { event_ids: string[] } }
  candidate.basis.event_ids = ["ev-1"]
  const events = [
    {
      schema_version: 2,
      run_id: "run-fixture",
      event_id: "ev-1",
      kind: "user_input",
      source: { producer_id: "host", channel: "user" },
      payload: { text: "Fix the failing parser bug and prove it with a test." },
    },
  ]
  resolveSourceRefs(candidate as never, events as never)
  const issues = candidateIssues(candidate as never, events as never, {}, {}, { nextCompiledIntentId: () => "compiled-dry-run" } as never)
  assert.deepEqual(issues, [])
})
