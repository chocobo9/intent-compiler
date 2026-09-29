// Type-check the injected lifecycle functions against the frozen host's actual
// services and dependency types. Does not start OpenCode or call a provider.
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const root = resolve(process.argv[2]).replaceAll('\\', '/')
const patcher = resolve(dirname(fileURLToPath(import.meta.url)), 'patch-management-stream.py')
const source = execFileSync(process.env.PYTHON ?? 'python', ['-X', 'utf8', '-c',
  'import importlib.util,pathlib,sys; s=importlib.util.spec_from_file_location("patch",sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.patch_run(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")))',
  patcher, `${root}/packages/opencode/src/cli/cmd/run.ts`,
], { encoding: 'utf8' }).replace(/\r\n/g, '\n')
const parsed = ts.createSourceFile('run.ts', source, ts.ScriptTarget.ESNext, true)
if (parsed.parseDiagnostics.length) throw new Error('Patched host CLI has syntax errors')
const functions = []
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ['executionHooks', 'drainExecution'].includes(node.name?.text)) {
    functions.push(node.getText(parsed))
  }
  ts.forEachChild(node, visit)
}
visit(parsed)
if (functions.length !== 2) throw new Error('Expected both real CLI lifecycle helpers')
const version = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')).workspaces.catalog.effect
const effect = `${root}/node_modules/.bun/effect@${version}/node_modules/effect/dist/index.d.ts`
if (!existsSync(effect)) throw new Error(`Pinned Effect types missing: ${effect}`)
const file = resolve('.intent-host-api-check.ts').replaceAll('\\', '/')
const declarations = 'declare const args: { attach?: string }; declare const cwd: string; declare const sessionID: string;\n'
const options = {
  noEmit: true, skipLibCheck: true, strict: true, target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  baseUrl: root, typeRoots: [resolve('node_modules/@types')],
  paths: { '@/*': ['packages/opencode/src/*'], '@opencode-ai/core/*': ['packages/core/src/*'], effect: [effect] },
}
function check(code) {
  const host = ts.createCompilerHost(options)
  const original = host.getSourceFile.bind(host)
  host.getSourceFile = (name, ...args) => name.replaceAll('\\', '/') === file
    ? ts.createSourceFile(file, code, ts.ScriptTarget.ESNext, true) : original(name, ...args)
  const program = ts.createProgram([file], options, host)
  const probe = program.getSourceFile(file)
  return [...program.getSyntacticDiagnostics(probe), ...program.getSemanticDiagnostics(probe)]
}
const probe = declarations + functions.join('\n')
const diagnostics = check(probe)
if (diagnostics.length) {
  for (const d of diagnostics) console.error(ts.flattenDiagnosticMessageText(d.messageText, '\n'))
  process.exit(1)
}
// Confirm this check catches the concrete regression that escaped mock tests.
const broken = probe.replace('InstanceStore.Service.use(', 'InstanceStore.use(')
if (broken === probe || !check(broken).some(d => d.code === 2349)) {
  throw new Error('Host API regression check could not detect the known non-callable API')
}
console.log(`Host lifecycle API check passed against Effect ${version}; known broken call rejected.`)
