import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import ts from "typescript"

test("pinned CLI finish patch awaits the plugin drain before returning and propagates errors", async () => {
  // Exercise the exact function body produced by the host patch, replacing only
  // host service imports with in-memory services (no provider/network calls).
  const source = `async function run() {
        if (!interactive) {
          async function finish() {
            if (args.attach) return
            const error = await completed
            if (error) process.exitCode = 1
          }
          if (args.command) {
            const result = await client.session.command({
              sessionID,
            })
            if (result.error) { process.exitCode = 1; return }
            await finish()
            return
          }
          const result = await client.session.prompt({ sessionID })
          if (result.error) { process.exitCode = 1; return }
          await finish()
          return
        }

        const model = pick(args.model)
}`
  const code = execFileSync("python", ["-c", [
    "import importlib.util",
    "s=importlib.util.spec_from_file_location('p', 'experiments/evocode/harbor/dpipe/patch-management-stream.py')",
    "m=importlib.util.module_from_spec(s);s.loader.exec_module(m)",
    "import sys; print(m.patch_run(sys.stdin.read()))",
  ].join("\n")], { cwd: resolve("."), encoding: "utf8", input: source })
  const patched = code.replace('await import("@/effect/app-runtime")', "({ AppRuntime })")
    .replace('await import("@/plugin")', "({ Plugin })")
    .replace('await import("@/project/instance-store")', "instanceStore")
    .replace("const { AppRuntime } =", "const { AppRuntime: runtime } =").replace("await AppRuntime.runPromise", "await runtime.runPromise")
    .replace("const { Plugin } =", "const { Plugin: pluginService } =").replace("Plugin.Service.use", "pluginService.Service.use")
  const js = ts.transpile(patched, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None })
  const make = new Function("args", "completed", "AppRuntime", "Plugin", "instanceStore", "cwd", "sessionID", "process", "client", "interactive", `${js}; return run`)
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const hooks = [{ "experimental.execution.drain": async (input: { sessionID: string }) => {
    assert.equal(input.sessionID, "executor"); await pending
  } }]
  // Startup and execution directories deliberately expose different plugins.
  // The former regression replaced runPromise with a constant hook list and
  // could not detect selection of the wrong instance.
  const instances: Record<string, typeof hooks> = { "/host": [], "/app": hooks }
  const plugin = { Service: { use: (fn: (p: { list: () => typeof hooks }) => typeof hooks) =>
    (directory: string) => fn({ list: () => instances[directory]! }) } }
  // The host's module-level use is an accessor object, NOT a callable.
  const instanceStore = { use: {}, Service: { use: (fn: (store: { provide: (input: { directory: string }, effect: (directory: string) => typeof hooks) => typeof hooks }) => typeof hooks) =>
    fn({ provide: (input, effect) => effect(input.directory) }) } }
  const makeFinish = (cwd: string, request = async (): Promise<{ error?: boolean }> => ({}), args = {}, completed = Promise.resolve(false)) => make(args, completed, { runPromise: async (value: unknown) => value },
    plugin, instanceStore, cwd, "executor", { env: { EXPERIMENT_ARM_MODE: "compiler" } },
    { session: { prompt: request, command: request } }, false)
  const finish = makeFinish("/app")
  let ended = false
  const finishing = finish().then(() => { ended = true })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(ended, false)
  release(); await finishing
  assert.equal(ended, true)
  hooks[0]!["experimental.execution.drain"] = async () => { throw new Error("return rejected") }
  await assert.rejects(finish(), /return rejected/)
  await assert.rejects(makeFinish("/host")(), /execution drain missing for directory \/host/)
  let requests = 0
  await assert.rejects(makeFinish("/host", async () => { requests++; return {} })(), /execution drain missing/)
  assert.equal(requests, 0, "real hook lookup must succeed before any prompt or model request")
  // Error responses and thrown requests have no guaranteed terminal event.
  // They must still drain without waiting on the unresolved event subscriber.
  let drained = 0
  hooks[0]!["experimental.execution.drain"] = async () => { drained++ }
  const noTerminalEvent = new Promise<boolean>(() => {})
  for (const args of [{}, { command: "test" }]) {
    await makeFinish("/app", async () => ({ error: true }), args, noTerminalEvent)()
    await assert.rejects(makeFinish("/app", async () => { throw new Error("request failed") }, args, noTerminalEvent)(), /request failed/)
  }
  assert.equal(drained, 4)
})
