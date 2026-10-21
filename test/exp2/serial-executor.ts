import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { TokenUsage } from "../../src/exp2/attribution.js"
import { QuotaExhausted } from "../../src/exp2/attribution.js"
import { SessionBroken, type Executor, type ExecutorContext, type ExecutorSession } from "../../src/exp2/execution.js"
import { DROP, FILTER, GO_MOD, MAIN, NORMALIZE, RENAME, SORT, stamp, TRANSFORM, TRANSFORM_STUB, VERIFY, VERIFY_STUB } from "./go-fixtures.js"
import { write } from "./stub-executor.js"

/**
 * The stand-in executor for the end-to-end serial. It reads the work order the way a coding agent would and does
 * its task zone in one go: a foundation first, verify, the transform command with the operations it knows (filter,
 * sort, drop, rename, normalize), and a placeholder function for every other object. It knows nothing of the checks, so
 * objects it only stubs fail theirs, and those failures come back in later work orders as evidence.
 *
 * Interruptions can be injected: a spent quota, a hung or broken session, each once, at a given round and message.
 */

const OPS: Record<string, (round: number) => string> = {
  filter: () => FILTER(false), sort: () => SORT, drop: () => DROP, rename: () => RENAME,
  // The text's z-score uses the population stddev until R3, the sample one from R3 on.
  normalize: round => NORMALIZE(round >= 3 ? "sample" : "population"),
}

export interface Injection { round: number; message: number; action: "quota" | "hang" | "break" | "crash" }

/** The whole process stops (killed, out of memory): nothing in the serial catches it. */
export class ProcessCrash extends Error {}

const zero = (): TokenUsage => ({ input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 })
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/**
 * The first message of a session (the work order) gets the whole task zone done the way the stand-in knows; a
 * message with failing checks gets nothing new (the stand-in knows nothing of the checks), which is how an agent
 * that cannot fix something behaves.
 */
export function serialExecutor(injections: Injection[] = [], fired = new Set<string>()): (round: number) => Executor {
  return round => {
    // Messages are counted per round attempt (a new attempt after a stop counts from 1 again).
    let sent = 0
    return {
    async open(context: ExecutorContext): Promise<ExecutorSession> {
      const task = context.workorder.task
      const byName = new Map(task.map(t => [t.name, t]))
      let first = true
      return {
        id: `stand-in-R${round}-${context.resume ? "resume" : "first"}`,
        async send() {
          const n = ++sent
          const key = `${round}:${n}`
          const injected = injections.find(x => x.round === round && x.message === n)
          if (injected && !fired.has(key)) {
            fired.add(key)
            if (injected.action === "quota") throw new QuotaExhausted(`coding quota, round ${round}`)
            if (injected.action === "hang") return new Promise<never>(() => {})
            if (injected.action === "crash") throw new ProcessCrash(`the process stops, round ${round}`)
            throw new SessionBroken(`session broke, round ${round}`)
          }
          if (!first) return { usage: zero(), note: "stand-in: nothing more it can do" }
          first = false
          const wd = context.workdir
          const tag = `R${round}`
          const has = (name: string) => byName.has(name)
          if (!existsSync(join(wd, "main.go"))) write(wd, { "go.mod": GO_MOD, "main.go": MAIN, "verify.go": VERIFY_STUB, "transform.go": TRANSFORM_STUB })
          if (has("verify")) write(wd, { "verify.go": stamp(VERIFY(), "runVerify", tag) })
          const ops = Object.keys(OPS).filter(has)
          if (has("transform") || ops.length) {
            const present = readdirSync(wd).filter(f => /^op_\w+\.go$/u.test(f)).map(f => f.slice(3, -3))
            const all = [...new Set([...present, ...ops])].sort()
            const files: Record<string, string> = {}
            for (const name of ops) files[`op_${name}.go`] = stamp(OPS[name](round), `op${cap(name)}`, tag)
            // The sidecar went away in R5.
            files["transform.go"] = has("transform") ? stamp(TRANSFORM(all, round < 5), "runTransform", tag) : TRANSFORM(all, round < 5)
            write(wd, files)
          }
          const known = new Set(["transform", "verify", ...Object.keys(OPS)])
          const files: Record<string, string> = {}
          for (const t of task.filter(x => !known.has(x.name))) files[`obj_${t.object.toLowerCase()}.go`] = `package main\n\n// ${t.name.replace(/\n/gu, " ")}\nfunc impl${t.object}() int {\n\t// ${tag}\n\treturn ${t.version}\n}\n`
          write(wd, files)
          return { usage: zero(), note: "stand-in: done what it knows" }
        },
        async close() {},
      }
    },
    }
  }
}
