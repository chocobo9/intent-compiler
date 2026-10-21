import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { TokenUsage } from "../../src/exp2/attribution.js"
import { QuotaExhausted } from "../../src/exp2/attribution.js"
import { SessionBroken, type ApprovedStep, type Executor, type ExecutorContext, type ExecutorSession, type StepProposal } from "../../src/exp2/execution.js"
import { DROP, FILTER, GO_MOD, MAIN, NORMALIZE, RENAME, SORT, stamp, TRANSFORM, TRANSFORM_STUB, VERIFY, VERIFY_STUB } from "./go-fixtures.js"
import { write } from "./stub-executor.js"

/**
 * The stand-in executor for the end-to-end serial. It reads the work order the way a coding agent would and plans
 * from its task zone: a foundation first, verify, the transform command with the operations it knows (filter, sort,
 * drop, rename, normalize), and a placeholder function for every other object. It knows nothing of the checks, so
 * objects it only stubs fail theirs, and those failures come back in later work orders as evidence.
 *
 * Interruptions can be injected: a spent quota, a hung or broken session, each once, at a given round and step.
 */

const OPS: Record<string, (round: number) => string> = {
  filter: () => FILTER(false), sort: () => SORT, drop: () => DROP, rename: () => RENAME,
  // The text's z-score uses the population stddev until R3, the sample one from R3 on.
  normalize: round => NORMALIZE(round >= 3 ? "sample" : "population"),
}

export interface Injection { round: number; step: string; action: "quota" | "hang" | "break" | "crash" }

/** The whole process stops (killed, out of memory): nothing in the serial catches it. */
export class ProcessCrash extends Error {}

const zero = (): TokenUsage => ({ input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 })
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

export function serialExecutor(injections: Injection[] = [], fired = new Set<string>()): (round: number) => Executor {
  return round => ({
    async open(context: ExecutorContext): Promise<ExecutorSession> {
      const task = context.workorder.task
      const byName = new Map(task.map(t => [t.name, t]))
      return {
        id: `stand-in-R${round}-${context.resume ? `resume-${context.resume.done.length}` : "first"}`,
        async propose() {
          const steps: StepProposal[] = []
          const has = (n: string) => byName.has(n)
          const foundation = !existsSync(join(context.workdir, "main.go"))
          if (foundation) steps.push({ label: "foundation", summary: "command dispatch", objects: ["transform", "verify"].filter(has).map(n => ({ object: byName.get(n)!.object, coverage: "partial" as const })) })
          if (has("verify")) steps.push({ label: "verify", summary: "verify", objects: [{ object: byName.get("verify")!.object, coverage: "full" }] })
          const transformGroup = [...(has("transform") ? ["transform"] : []), ...Object.keys(OPS).filter(has)]
          for (let i = 0; i < transformGroup.length; i += 5) steps.push({ label: `transform-${i / 5 + 1}`, summary: "transform and its operations", objects: transformGroup.slice(i, i + 5).map(n => ({ object: byName.get(n)!.object, coverage: "full" as const })) })
          const known = new Set(["transform", "verify", ...Object.keys(OPS)])
          const others = task.filter(t => !known.has(t.name))
          for (let i = 0; i < others.length; i += 5) steps.push({ label: `generic-${i / 5 + 1}`, summary: "placeholders", objects: others.slice(i, i + 5).map(t => ({ object: t.object, coverage: "full" as const })) })
          return { steps: steps.filter(s => s.objects.length), usage: zero() }
        },
        async work(step: ApprovedStep) {
          const key = `${round}:${step.label}`
          const injected = injections.find(x => x.round === round && x.step === step.label)
          if (injected && !fired.has(key)) {
            fired.add(key)
            if (injected.action === "quota") throw new QuotaExhausted(`coding quota, round ${round}`)
            if (injected.action === "hang") return new Promise<never>(() => {})
            if (injected.action === "crash") throw new ProcessCrash(`the process stops, round ${round}`)
            throw new SessionBroken(`session broke, round ${round}`)
          }
          const wd = context.workdir
          const names = step.objects.map(o => task.find(t => t.object === o.object)!.name)
          const tag = `R${round} ${step.id}`
          if (step.label === "foundation") write(wd, { "go.mod": GO_MOD, "main.go": MAIN, "verify.go": VERIFY_STUB, "transform.go": TRANSFORM_STUB })
          else if (step.label === "verify") write(wd, { "verify.go": stamp(VERIFY(), "runVerify", tag) })
          else if (step.label.startsWith("transform")) {
            const present = readdirSync(wd).filter(f => /^op_\w+\.go$/u.test(f)).map(f => f.slice(3, -3))
            const ops = [...new Set([...present, ...names.filter(n => n in OPS)])].sort()
            const files: Record<string, string> = {}
            for (const n of names.filter(n => n in OPS)) files[`op_${n}.go`] = stamp(OPS[n](round), `op${cap(n)}`, tag)
            // The sidecar went away in R5.
            files["transform.go"] = names.includes("transform") ? stamp(TRANSFORM(ops, round < 5), "runTransform", tag) : TRANSFORM(ops, round < 5)
            write(wd, files)
          } else {
            const files: Record<string, string> = {}
            for (const o of step.objects) {
              const t = task.find(x => x.object === o.object)!
              files[`obj_${o.object.toLowerCase()}.go`] = `package main\n\n// ${t.name.replace(/\n/gu, " ")}\nfunc impl${o.object}() int {\n\t// ${tag}\n\treturn ${t.version}\n}\n`
            }
            write(wd, files)
          }
          return { usage: zero(), note: `stand-in ${step.label}` }
        },
        async close() {},
      }
    },
  })
}
