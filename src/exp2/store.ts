import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { attributeRound, type AttributionTransport, type Issue, type ModelCallRecord } from "./attribution.js"
import { materialize, type Registry, type RoundAcceptance, type Signal } from "./registry.js"
import { contentHash } from "./source.js"

/**
 * Exp2 external state (DESIGN §5): one JSON file kept by code, append-only, changed only inside a locked
 * transaction that writes a temp file and renames it over the old one. It holds the source log, every model call
 * with its token usage, and each round's outcome; objects, versions and change records are replayed from these.
 */

export const EXP2_PROFILE = "exp2-ic/block1"

export interface RoundRecord {
  round: number
  status: "accepted" | "failed"
  calls: string[]
  acceptance?: RoundAcceptance
  issues?: Issue[]
}

export interface Exp2State {
  profile: typeof EXP2_PROFILE
  run_id: string
  sources: { round: number; text: string; hash: string }[]
  calls: ModelCallRecord[]
  rounds: RoundRecord[]
  /** Reserved for split/merge suspicion signals (DESIGN §4.2); nothing writes them in this block. */
  signals: Signal[]
}

export interface IngestOptions { maxRepairs?: number }

export class Exp2Store {
  readonly directory: string
  private readonly file: string
  constructor(directory: string, readonly runId: string) {
    this.directory = resolve(directory)
    mkdirSync(this.directory, { recursive: true })
    this.file = resolve(this.directory, "exp2-state.json")
  }

  inspect(): Exp2State {
    if (!existsSync(this.file)) return { profile: EXP2_PROFILE, run_id: this.runId, sources: [], calls: [], rounds: [], signals: [] }
    const s = JSON.parse(readFileSync(this.file, "utf8")) as Exp2State
    if (s.profile !== EXP2_PROFILE || s.run_id !== this.runId) throw new Error("Store profile/run mismatch")
    return s
  }

  registry(state: Exp2State = this.inspect()): Registry {
    return materialize(state.sources, state.rounds.filter(r => r.status === "accepted").map(r => r.acceptance!))
  }

  /** Logs round `round`'s text, runs attribution, and records the outcome; a failed round can be ingested again. */
  async ingestRound(round: number, text: string, transport: AttributionTransport, options: IngestOptions = {}): Promise<RoundRecord> {
    return this.transaction(async s => {
      const accepted = s.rounds.filter(r => r.status === "accepted").map(r => r.round)
      const expected = accepted.length ? Math.max(...accepted) + 1 : 1
      if (round !== expected) throw new Error(`Round ${round} cannot be ingested; the next round is ${expected}`)
      const hash = contentHash(text)
      const logged = s.sources.find(x => x.round === round)
      if (logged && (logged.text !== text || logged.hash !== hash)) throw new Error(`Round ${round} text differs from the logged source; the log is append-only`)
      if (!logged) s.sources.push({ round, text, hash })
      const registry = this.registry(s)
      const outcome = await attributeRound(registry, round, transport, { maxRepairs: options.maxRepairs ?? 2, callId: n => `M${s.calls.length + n}` })
      s.calls.push(...outcome.calls)
      const record: RoundRecord = outcome.status === "accepted"
        ? { round, status: "accepted", calls: outcome.calls.map(c => c.id), acceptance: outcome.acceptance }
        : { round, status: "failed", calls: outcome.calls.map(c => c.id), issues: outcome.issues }
      if (record.acceptance) {
        // Replaying the accepted answer must reproduce a full, single cover of the round.
        registry.apply(record.acceptance)
        const problems = registry.coverageProblems(round)
        if (problems.length) throw new Error(`Accepted answer does not cover round ${round}: ${problems.slice(0, 5).join("; ")}`)
      }
      s.rounds.push(record)
      return record
    })
  }

  private save(before: Exp2State, after: Exp2State): void {
    appendOnly(before, after)
    const temp = `${this.file}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(after, null, 2) + "\n", "utf8")
    renameSync(temp, this.file)
  }

  private async transaction<T>(action: (s: Exp2State) => Promise<T> | T): Promise<T> {
    const lock = `${this.file}.lock`
    // A live owner blocks concurrent mutation; a lock left by a dead process is cleared.
    if (existsSync(lock)) {
      const pid = Number(readFileSync(lock, "utf8"))
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid store lock; inspect before recovery")
      let alive = true
      try { process.kill(pid, 0) } catch (e) { if ((e as NodeJS.ErrnoException).code === "ESRCH") alive = false; else throw e }
      if (alive) throw new Error("Exp2 store is busy")
      unlinkSync(lock)
    }
    const fd = openSync(lock, "wx")
    try {
      writeFileSync(fd, String(process.pid))
      const before = this.inspect()
      const working = structuredClone(before)
      const result = await action(working)
      this.save(before, working)
      return result
    } finally { closeSync(fd); unlinkSync(lock) }
  }
}

/** Every list in the state may only grow; existing entries must stay byte-identical. */
export function appendOnly(before: Exp2State, after: Exp2State): void {
  for (const key of ["sources", "calls", "rounds", "signals"] as const) {
    const a = before[key] as unknown[], b = after[key] as unknown[]
    if (b.length < a.length || a.some((x, i) => JSON.stringify(x) !== JSON.stringify(b[i]))) throw new Error(`Exp2 state ${key} is append-only`)
  }
  if (before.profile !== after.profile || before.run_id !== after.run_id) throw new Error("Exp2 state identity changed")
}
