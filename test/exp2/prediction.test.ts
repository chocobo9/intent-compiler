import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { freezePrediction, predictionIntact, reconcile } from "../../src/exp2/prediction.js"

const objects = [
  { object: "O2", name: "filter", status: "landed" as const, reasons: [], passing_strong: [], not_landed: [], unknown: [] },
  { object: "O1", name: "transform", status: "not_landed" as const, reasons: [], passing_strong: [], not_landed: [], unknown: [] },
  { object: "O3", name: "verify", status: "unknown" as const, reasons: [], passing_strong: [], not_landed: [], unknown: [] },
  { object: "O4", name: "profile", status: "landed" as const, reasons: [], passing_strong: [], not_landed: [], unknown: [] },
  { object: "O5", name: "normalize", status: "not_landed" as const, reasons: [], passing_strong: [], not_landed: [], unknown: [] },
]

describe("exp2 pre-registration: frozen statuses and reconciliation", () => {
  it("freezes the statuses with a hash that does not depend on order and breaks on any change", () => {
    const p = freezePrediction(3, "abc123", objects)
    assert.deepEqual(p.objects.map(o => o.object), ["O1", "O2", "O3", "O4", "O5"])
    assert.equal(p.sha256, freezePrediction(3, "abc123", [...objects].reverse()).sha256)
    assert.ok(predictionIntact(p))
    assert.ok(!predictionIntact({ ...p, objects: p.objects.map(o => o.object === "O1" ? { ...o, status: "landed" } : o) }))
  })

  it("reconciles official cases mapped to objects: IC wrong, too strict, agreement, unknown, no cases", () => {
    const p = freezePrediction(3, "abc123", objects)
    const r = reconcile(p, [
      { id: "t1", passed: true, objects: ["O2"] }, { id: "t2", passed: false, objects: ["O4"] },
      { id: "t3", passed: true, objects: ["O1"] }, { id: "t4", passed: false, objects: ["O3"] }, { id: "t5", passed: true, objects: ["O9"] },
    ])
    assert.deepEqual(Object.fromEntries(r.rows.map(x => [x.name, x.verdict])), { transform: "too_strict", filter: "agree_landed", verify: "unknown", profile: "ic_wrong", normalize: "no_cases" })
    assert.deepEqual(r.unmapped, ["t5"])
    assert.equal(r.prediction_sha256, p.sha256)
    assert.throws(() => reconcile({ ...p, commit: "other" }, []), /does not match its hash/u)
  })
})
