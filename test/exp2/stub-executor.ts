import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { TokenUsage } from "../../src/exp2/attribution.js"
import { SessionBroken, type Executor, type ExecutorContext, type ExecutorSession } from "../../src/exp2/execution.js"

/**
 * A stand-in executor (DEV-GUIDELINES §3): a script that edits the work tree for each message the way an agent
 * would, including the usual failures (stopping early, a wrong detail, a broken or hung session). It never commits;
 * the controller does. An action may return the reply's text (for a CONTEST line).
 */

export type Action = "hang" | "break" | ((workdir: string, message: string) => void | string)

export interface ExecutorScript {
  /** Per message, counted across sessions: what the executor does. The last entry repeats. */
  messages: Action[]
}

export interface ExecutorLog { sessions: { id: string; resume: ExecutorContext["resume"] }[]; messages: { session: string; text: string }[] }

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
  readonly log: ExecutorLog = { sessions: [], messages: [] }
  private sent = 0
  constructor(private readonly script: ExecutorScript) {}
  async open(context: ExecutorContext): Promise<ExecutorSession> {
    const id = `stub-session-${this.log.sessions.length + 1}`
    this.log.sessions.push({ id, resume: context.resume })
    const self = this
    return {
      id,
      async send(text: string) {
        self.log.messages.push({ session: id, text })
        const action = self.script.messages[Math.min(self.sent++, self.script.messages.length - 1)]
        if (action === "hang") return new Promise<never>(() => {})
        if (action === "break") throw new SessionBroken("the stand-in session lost its context")
        const said = action(context.workdir, text)
        return { usage: { ...zero(), output_tokens: 10 }, note: typeof said === "string" ? said : `stand-in edit, message ${self.sent}` }
      },
      async close() {},
    }
  }
}
