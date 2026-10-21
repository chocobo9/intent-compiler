// Lists the R1 rule-bearing units (sentence level, inline code or a number) with the block 9 code, from the Haiku
// attribution state; every R1 block is changed text in round 1.
import { readFileSync, writeFileSync } from "node:fs"
import { Exp2Store } from "../../.test-dist/src/exp2/store.js"
import { coverage, EMPTY_CHECKS } from "../../.test-dist/src/exp2/checks.js"
const store = new Exp2Store("hk2/checks-run/store", "haiku-checks")
const s = store.inspect()
const registry = store.registry(s)
const cov = coverage(registry, 1, { ...EMPTY_CHECKS, checks: [] }, [], [])
const units = cov.units.map(id => ({ id, owner: registry.coverOf(id)?.owner ?? null, text: registry.block(id).text }))
writeFileSync("hk2/judge/r1-units.json", JSON.stringify(units, null, 1))
console.log(units.length, "units;", new Set(units.map(u => u.owner)).size, "owners")
for (const u of units.slice(0, 8)) console.log(u.id, "|", u.owner, "|", u.text.slice(0, 110).replace(/\n/g, " "))
