import { execFileSync, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { createServer } from "node:net"
import { dirname, resolve } from "node:path"

export async function startDedicatedOpenCodeServer({ cwd, configDir, batch }) {
  const port = await reserveLoopbackPort()
  batch.assertCanStartRequest()
  const executable = resolveOpenCodeCommand()
  const childEnv = {
    ...process.env,
    OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_DISABLE_PRUNE: "true",
  }
  // Keep the dedicated server on a per-run project/config directory and ask it
  // not to update itself or prune the shared profile while the experiment runs.
  // The user's existing OpenCode auth/profile remains available to the provider.
  delete childEnv.OPENCODE_CONFIG
  delete childEnv.OPENCODE_CONFIG_CONTENT
  batch.assertCanStartRequest()
  const child = spawn(executable, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--pure"], {
    cwd,
    env: childEnv,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  })
  let exitResult
  let spawnError
  const exitPromise = new Promise((resolve) => {
    child.once("error", (error) => {
      spawnError = errorRecord(error)
      if (!child.pid) {
        exitResult = { exited: true, error: spawnError, spawn_failed: true }
        resolve(exitResult)
      }
    })
    child.once("close", (code, signal) => {
      exitResult = { exited: true, code, signal, ...(spawnError ? { spawn_error: spawnError } : {}) }
      resolve(exitResult)
    })
  })
  child.once("error", () => {})
  let terminationPromise

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    pid: child.pid ?? null,
    terminate() {
      terminationPromise ??= this.terminateOnce()
      return terminationPromise
    },
    async terminateOnce() {
      if (exitResult?.exited) return exitResult
      if (!child.pid) {
        try { child.kill() } catch { /* process did not start */ }
        return await exitPromise
      }
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
            encoding: "utf8",
            stdio: "ignore",
            windowsHide: true,
          })
        } catch {
          try { child.kill("SIGTERM") } catch { /* already exited */ }
        }
      } else {
        try { child.kill("SIGTERM") } catch { /* already exited */ }
      }
      const result = await exitPromise
      return { ...result, exited: result.exited === true }
    },
  }
}

export async function waitForOpenCodeHealth({ client, batch, maxWaitMs = 30_000 }) {
  const start = batch.elapsedMs()
  let lastError
  while (batch.elapsedMs() - start < maxWaitMs) {
    batch.assertCanStartRequest()
    try {
      const health = await batch.hostOperation({ name: "global.health", invoke: ({ signal }) => client.health({ signal }) })
      if (health?.healthy === true) return health
      lastError = new Error("OpenCode /global/health did not report healthy=true")
    } catch (error) {
      lastError = error
    }
    await delay(200)
  }
  throw new Error(`OpenCode server did not become healthy within ${maxWaitMs} ms: ${lastError?.message ?? "unknown error"}`)
}

async function reserveLoopbackPort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("could not reserve a loopback TCP port")
  const port = address.port
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

function resolveOpenCodeCommand() {
  if (process.env.OPENCODE_CLI) {
    const override = resolve(process.env.OPENCODE_CLI)
    if (process.platform === "win32" && !override.toLowerCase().endsWith(".exe")) {
      throw new Error("OPENCODE_CLI must point to the native opencode.exe executable on Windows")
    }
    return override
  }
  if (process.platform === "win32") {
    const entries = execFileSync("where.exe", ["opencode.cmd"], { encoding: "utf8", windowsHide: true })
      .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
    if (entries.length > 0) {
      const native = resolve(dirname(entries[0]), "node_modules", "opencode-ai", "bin", "opencode.exe")
      if (existsSync(native)) return native
      throw new Error("could not resolve the native opencode.exe next to the installed CLI shim")
    }
    throw new Error("opencode.cmd was not found in PATH")
  }
  return "opencode"
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorRecord(error) {
  return { name: error?.name ?? "Error", message: error?.message ?? String(error), code: error?.code ?? null }
}
