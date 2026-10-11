import { spawn, execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdirSync, writeFileSync, readFileSync, openSync, closeSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { digestOf } from "../core/intent-contract.js"
import type { CIDelivery, SddRun, SddResult } from "../core/sdd-contract.js"
import type { SddHost } from "../adapters/sdd.js"

/** Explicit experiment host; no old intent_opencode_agent or pending-dispatch drain. */
export function createSddProcessHost(options: { python: string; bridge: string; adapter: string; sddSource: string; round: number; directory: string }): SddHost {
  const requests = resolve(options.directory)
  mkdirSync(requests, { recursive: true })
  const file = (r: SddRun) => resolve(requests, `${digestOf(r.run_id).replace(/[^a-zA-Z0-9]/g, "")}.json`)
  const invoke = async (mode: string, path: string): Promise<any> => {
    const { stdout } = await promisify(execFile)(options.python, [options.bridge, mode, path], {
      windowsHide: true, env: { ...process.env, PYTHONUTF8: "1" }, maxBuffer: 1024 * 1024,
    })
    return JSON.parse(stdout)
  }
  return {
    async locatePrepared(run) {
      const path = `${file(run)}.prepared`
      if (!existsSync(path)) return undefined
      const manifest = JSON.parse(readFileSync(path, "utf8"))
      if (manifest.run_id !== run.run_id || digestOf(manifest.ci_ref) !== digestOf(run.ci_ref)) throw Error("Prepared identity mismatch")
      return manifest
    },
    async prepare(run: SddRun, delivery: CIDelivery) {
      const path = file(run)
      writeFileSync(path, JSON.stringify({ run, delivery, adapter: resolve(options.adapter), sdd_source: resolve(options.sddSource), round: options.round }), { flag: "wx", encoding: "utf8" })
      return invoke("prepare", path)
    },
    async launch(run) {
      if (!run.directory) throw Error("No prepared directory")
      const path = file(run)
      const manifest = JSON.parse(readFileSync(`${path}.prepared`, "utf8"))
      if (manifest.directory !== run.directory || digestOf(manifest.ci_ref) !== digestOf(run.ci_ref)) throw Error("Prepared manifest differs")
      const fd = openSync(resolve(run.directory, "ic-launcher.log"), "ax")
      try {
        const child = spawn(options.python, [resolve(run.directory, "run_r1.py"), "--launch", run.directory], {
          cwd: run.directory, detached: true, windowsHide: true, stdio: ["ignore", fd, fd], env: { ...process.env, PYTHONUTF8: "1" },
        })
        await new Promise<void>((ok, fail) => { child.once("spawn", ok); child.once("error", fail) })
        writeFileSync(`${path}.pid`, JSON.stringify({ pid: child.pid, directory: run.directory }), { flag: "wx" })
        child.unref()
      } finally { closeSync(fd) }
    },
    async inspect(run): Promise<SddResult | undefined> {
      if (!existsSync(`${file(run)}.prepared`)) return undefined
      const result = await invoke("collect", file(run))
      return result ?? undefined
    },
  }
}
