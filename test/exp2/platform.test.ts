import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { exeName, goCommand, minimalEnv, nodeCommand, pythonCommand, scriptCommand, scriptFile } from "../../src/exp2/platform.js"
import { LocalProcessRunner, nullBaseline, nullRun } from "../../src/exp2/runner.js"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("exp2 platform: one place decides names, interpreters and command lines", () => {
  it("built programs end in .exe on Windows only", () => {
    assert.equal(exeName("dpipe", { platform: "win32" }), "dpipe.exe")
    assert.equal(exeName("dpipe.exe", { platform: "win32" }), "dpipe.exe")
    assert.equal(exeName("dpipe", { platform: "linux" }), "dpipe")
    assert.equal(exeName("anchors", { platform: "win32" }), "anchors.exe")
  })

  it("Python is `python` on Windows (python3 there is the Store placeholder), `python3` elsewhere, and configurable", () => {
    assert.equal(pythonCommand({ platform: "win32", env: {} }), "python")
    assert.equal(pythonCommand({ platform: "linux", env: {} }), "python3")
    assert.equal(pythonCommand({ platform: "win32", env: { EXP2_PYTHON: "C:\\Python312\\python.exe" } }), "C:\\Python312\\python.exe")
    assert.equal(pythonCommand({ platform: "win32", python: "D:\\py\\python.exe", env: { EXP2_PYTHON: "x" } }), "D:\\py\\python.exe", "an explicit option wins")
    assert.equal(goCommand({ env: { EXP2_GO: "C:\\Go\\bin\\go.exe" } }), "C:\\Go\\bin\\go.exe")
    assert.equal(goCommand({ env: {} }), "go")
  })

  it("scripts are run by naming their interpreter, never through a shebang", () => {
    assert.deepEqual(scriptCommand("python", scriptFile("python"), { platform: "win32", env: {} }), ["python", "-I", "__reference__.py"])
    assert.deepEqual(scriptCommand("python", scriptFile("python"), { platform: "linux", env: {} }), ["python3", "-I", "__reference__.py"])
    assert.deepEqual(scriptCommand("node", scriptFile("node"), { node: "C:\\node\\node.exe" }), ["C:\\node\\node.exe", "__reference__.mjs"])
    assert.equal(nodeCommand(), process.execPath)
  })

  it("the child environment keeps what Windows programs need and nothing else", () => {
    const host = { Path: "C:\\Windows;C:\\Go\\bin", SystemRoot: "C:\\Windows", TEMP: "C:\\T", LOCALAPPDATA: "C:\\L", SECRET_TOKEN: "x", PATHEXT: ".EXE" }
    const win = minimalEnv("C:\\H", { platform: "win32", env: host })
    assert.deepEqual(win, { PATH: "C:\\Windows;C:\\Go\\bin", PATHEXT: ".EXE", SystemRoot: "C:\\Windows", TEMP: "C:\\T", LOCALAPPDATA: "C:\\L", HOME: "C:\\H" })
    const linux = minimalEnv("/h", { platform: "linux", env: { PATH: "/usr/bin", SECRET_TOKEN: "x" } })
    assert.deepEqual(linux, { PATH: "/usr/bin", LANG: "C.UTF-8", HOME: "/h" })
  })

  it("the null baseline is answered directly by the runner on any platform: exit 1, no output", async () => {
    const program = nullBaseline(join(mkdtempSync(join(tmpdir(), "exp2-null-")), "b"))
    assert.equal(program.kind, "null")
    const input = { args: ["verify", "--file", "a"], files: [{ path: "dir\\a.csv", content: "x" }] }
    const out = await new LocalProcessRunner({ platform: "win32" }).run(program, input, 1000)
    assert.deepEqual(out, nullRun(input))
    assert.deepEqual([out.exit_code, out.stdout, out.stderr, Object.keys(out.files)], [1, "", "", ["dir/a.csv"]])
  })
})
