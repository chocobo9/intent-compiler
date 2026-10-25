import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { AttributionTransport } from "./attribution.js"
import { relationRecall, renderRecall, revisionRecall, type GoldSets, type RecallLine } from "./gold.js"
import { Exp2Store } from "./store.js"

/**
 * Attribution alone over a task's rounds (the chain block, effect 5): each round ingested into a fresh store under
 * `out`, then what the attribution recorded (modifications and edges) and, with the task's gold sets, revision
 * recall and precision and relation recall. Resumes: rounds already accepted in `out` are not asked again.
 */
export interface AttributeRound {
  round: number
  status: string
  calls: number
  modifications: { object: string; kind: string; parts: string[]; by: string[] }[]
  /** The round's change units (batch 4: in place of object edges). */
  units: { id: string; source: string; name: string; members: string[]; objects: string[] }[]
  revision?: RecallLine
  relation?: RecallLine
}

export async function attributeOnly(o: { inputs: string; to: number; out: string; transport: AttributionTransport; maxRepairs?: number; gold?: GoldSets | null }): Promise<AttributeRound[]> {
  mkdirSync(o.out, { recursive: true })
  const store = new Exp2Store(join(o.out, "state"), "attribute")
  const rounds: AttributeRound[] = []
  for (let round = 1; round <= o.to; round++) {
    const file = join(o.inputs, `round-${String(round).padStart(2, "0")}.md`)
    if (!existsSync(file)) break
    let record = store.inspect().rounds.find(r => r.round === round && r.status === "accepted")
    if (!record) record = await store.ingestRound(round, readFileSync(file, "utf8"), o.transport, { maxRepairs: o.maxRepairs ?? 2 })
    const registry = store.registry()
    const modifications = [...registry.objects.values()].flatMap(ob => ob.blocks.flatMap(b => b.modifications.filter(m => m.round === round).map(m => ({ object: ob.id, kind: m.kind, parts: m.parts, by: m.by }))))
    const units = registry.units(round).filter(u => u.round === round).map(u => ({ id: u.id, source: u.source, name: u.name, members: u.members, objects: u.objects }))
    rounds.push({ round, status: record.status, calls: record.calls.length, modifications, units, ...(o.gold && record.status === "accepted" ? { revision: revisionRecall(registry, round, o.gold), relation: relationRecall(registry, round, o.gold) } : {}) })
    if (record.status !== "accepted") break
  }
  writeFileSync(join(o.out, "attribute.json"), JSON.stringify({ task: o.gold?.task ?? null, rounds }, null, 1) + "\n")
  writeFileSync(join(o.out, "attribute.md"), renderAttribute(rounds, o.gold?.task ?? null))
  return rounds
}

export function renderAttribute(rounds: readonly AttributeRound[], task: string | null): string {
  const out = [`# Attribution${task ? ` (gold set ${task})` : ""}`, ""]
  const sum = (k: "revision" | "relation") => rounds.reduce((t, r) => r[k] ? { hit: t.hit + r[k]!.hit, located: t.located + r[k]!.located, gold: t.gold + r[k]!.gold } : t, { hit: 0, located: 0, gold: 0 })
  if (task) {
    const rv = sum("revision"), rl = sum("relation")
    const prec = rounds.reduce((t, r) => ({ on: t.on + (r.revision?.precision?.on_gold ?? 0), all: t.all + (r.revision?.precision?.recorded ?? 0) }), { on: 0, all: 0 })
    out.push(`All rounds: revision recall ${rv.hit}/${rv.located} (gold ${rv.gold}); revision precision ${prec.on}/${prec.all}; relation recall ${rl.hit}/${rl.located} (gold ${rl.gold}).`, "")
  }
  for (const r of rounds) {
    out.push(`## Round ${r.round}: ${r.status}, ${r.calls} calls`, "")
    if (r.revision) out.push(renderRecall("Revision recall", r.revision))
    if (r.relation) out.push(renderRecall("Relation recall", r.relation))
    out.push(`- Modifications (${r.modifications.length}): ${r.modifications.map(m => `${m.parts.join("+")} ${m.kind} by ${m.by.join("+")} (${m.object})`).join("; ") || "none"}`)
    out.push(`- Change units (${r.units.length}): ${r.units.map(u => `${u.id} ${u.source} ${JSON.stringify(u.name)} (${u.members.join(", ")}; ${u.objects.join(", ")})`).join("; ") || "none"}`, "")
  }
  return out.join("\n")
}
