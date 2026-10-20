import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { TokenUsage } from "../../src/exp2/attribution.js"
import { SessionBroken, type ApprovedStep, type Executor, type ExecutorContext, type ExecutorSession, type StepProposal } from "../../src/exp2/execution.js"

/**
 * A stand-in executor (DEV-GUIDELINES §3): a script that edits the work tree for each step the way an agent would,
 * scripted per step label and attempt, including the usual failures. It never commits; the controller does.
 */

export type Action = "hang" | "break" | ((workdir: string) => void)

export interface ExecutorScript {
  /** Plans in order of proposal; each sees the task-zone object ids by name. */
  plans: ((id: (name: string) => string) => StepProposal[])[]
  /** Per step label, per attempt (counted across sessions): what the executor does. The last entry repeats. */
  steps: Record<string, Action[]>
}

export interface ExecutorLog { sessions: { id: string; resume: ExecutorContext["resume"] }[]; work: { session: string; step: string; feedback: string[] }[]; proposals: string[][] }

const zero = (): TokenUsage => ({ input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0 })

export function write(workdir: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    const full = join(workdir, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text, "utf8")
  }
}

export function remove(workdir: string, path: string): void { rmSync(join(workdir, path), { force: true }) }

export class StubExecutor implements Executor {
  readonly log: ExecutorLog = { sessions: [], work: [], proposals: [] }
  private attempts = new Map<string, number>()
  private plan = 0
  constructor(private readonly script: ExecutorScript, private readonly names: (name: string) => string) {}
  async open(context: ExecutorContext): Promise<ExecutorSession> {
    const id = `stub-session-${this.log.sessions.length + 1}`
    this.log.sessions.push({ id, resume: context.resume })
    const self = this
    return {
      id,
      async propose(feedback: string[]) {
        self.log.proposals.push(feedback)
        const make = self.script.plans[Math.min(self.plan++, self.script.plans.length - 1)]
        return { steps: make(self.names), usage: zero() }
      },
      async work(step: ApprovedStep, feedback: string[]) {
        self.log.work.push({ session: id, step: step.id, feedback })
        const n = self.attempts.get(step.label) ?? 0
        self.attempts.set(step.label, n + 1)
        const actions = self.script.steps[step.label] ?? [() => {}]
        const action = actions[Math.min(n, actions.length - 1)]
        if (action === "hang") return new Promise<never>(() => {})
        if (action === "break") throw new SessionBroken("the stand-in session lost its context")
        action(context.workdir)
        return { usage: zero(), note: `stand-in edit for ${step.label}, attempt ${n + 1}` }
      },
      async close() {},
    }
  }
}
