# 实验 2：本地运行前要做的事

分支 `exp2-block1`。第 1–5 块都已完成，并在云端做过离线验证（见各 `BLOCKn-NOTES.md`）。下面列出真实运行之前还要在本地接上和核实的部分（DESIGN 第 12 节第 6 项），以及每一项接口在代码里的位置。代码里没有任何地方读取官方测试或答案。

## 0. 怎样拼成一次串行

入口是 `Serial`（`src/exp2/serial.ts:84`），配置见 `SerialConfig`（`serial.ts:35`）。离线测试里的完整组装可以照抄 `test/exp2/serial.test.ts` 的 `serialIn`，把其中的替身换成下面第 1–3 项的真实实现：

```ts
new Serial({
  store: new Exp2Store(storeDir, runId),
  workdir,                      // 被测程序的 git 工作树（空目录即可，第一次运行时自动建库）
  checkpoints,                  // 检查点目录，必须在 workdir 之外
  text: round => readFileSync(`exp2/inputs/dpipe/round-${pad(round)}.md`, "utf8"),
  attribution: createOpenCodeAttributionTransport(opts),   // 第 1 项
  checks: createOpenCodeChecksTransport(opts),             // 第 1 项
  executor: () => new OpenCodeExecutor({ client, providerId, modelId, variant }),  // 第 2 项
  executorIsStub: false,
  anchors: new GoAnchorExtractor(),
  runner, sandbox,              // 第 3 项（docker）
  build: goBuilder(buildsDir),  // 若在容器里编译，换成第 3 项的构建
  limits: { attributionRepairs: 2, checkRepairs: 2, managementTimeoutMs, checkTimeoutMs, execution: DEFAULT_LIMITS },
}).run({ to: 15 })
```

还没有命令行入口。需要的话，在 `src/cli/` 下加一个按上面方式组装的小脚本即可。不要把它放进 `src/core/`。

## 1. OpenCode 管理调用（归属、检查推导）

| 内容 | 位置 |
|---|---|
| 归属：一个 schema、一个系统提示，首答和修补相同 | `src/exp2/transport.ts:10` `createOpenCodeAttributionTransport`；schema 和提示见 `src/exp2/attribution.ts` 的 `ATTRIBUTION_SCHEMA`、`ATTRIBUTION_SYSTEM_PROMPT` |
| 检查推导：同上 | `src/exp2/transport.ts:28` `createOpenCodeChecksTransport`；schema 和提示见 `src/exp2/checks.ts` 的 `CHECKS_SCHEMA`、`CHECKS_SYSTEM_PROMPT` |
| 请求接口 | `AttributionTransport`（`attribution.ts:78`）、`ChecksTransport`（`checks.ts:512`） |

本地要做：
- **核实结构化输出**：两个 schema 都通过了 `strictSchemaProblems`，但还没在真实的 gpt-6-luna-fast 上跑过。先各跑一次 R1，看 `structured_schema_errors` 和回答是否能被 `shapeProblems` / `checksShapeProblems` 接受。
- **额度用完要抛 `QuotaExhausted`**（`attribution.ts:85`）。现在的 OpenCode 传输层把所有失败都当作普通错误，串行会把它算作一次失败的尝试，而不是停下等待。需要在本地按提供方返回的额度错误包一层：识别到额度错误就抛 `QuotaExhausted`。
- **核实缓存**：首答与修补的请求前缀逐字节相同（有测试）。真实运行时看第二次调用的 cache read 是否命中（BACKGROUND 第 5 节）。
- **看门狗**：`managementTimeoutMs` 是串行对单次管理调用的看门狗（`withWatchdog`，`serial.ts:75`）。它应当比传输层自己的 `timeoutMs` 稍长，或与之一致。

## 2. 编码会话执行方

| 内容 | 位置 |
|---|---|
| 执行方接口 | `Executor`、`ExecutorSession`（`src/exp2/execution.ts:38,46`）；会话坏了抛 `SessionBroken`（`execution.ts:49`） |
| OpenCode 实现 | `OpenCodeExecutor`（`src/exp2/opencode-executor.ts:74`），客户端接口 `OpenCodeCodingClient`（`opencode-executor.ts:12`） |
| 分步的 schema 和执行方的系统提示 | `opencode-executor.ts` 的 `PLAN_SCHEMA`、`EXECUTOR_SYSTEM_PROMPT` |
| 限额 | `ExecutionLimits`（`execution.ts:51`）、`DEFAULT_LIMITS` |

本地要做：
- **对照真实 SDK**：`OpenCodeExecutor` 按 OpenCode SDK 的 `session.create`、`session.prompt`、`session.abort` 写成，没有运行过。要核实：
  - `agent: "build"` 下编辑工具是否开着；
  - 结构化分步是否从 `info.structured` 返回；
  - token 是否在 `info.tokens` 里。
- **执行方不能提交**：它只改工作树，提交由代码完成。要确认 OpenCode 的 build agent 不会自己 `git commit`；如果会，就在系统提示里禁止，或把 git 改成只读。
- **额度错误**：编码会话遇到额度用完，也要抛 `QuotaExhausted`，而不是 `SessionBroken`。否则会被当作会话坏了，另开会话重试。
- **超时**：`stepTimeoutMs` 默认 20 分钟，是一步的看门狗。超时按会话坏了处理：回到检查点，另开会话。

## 3. docker 运行器

| 内容 | 位置 |
|---|---|
| 被测程序的运行器接口 | `CheckRunner`（`src/exp2/runner.ts:32`）：`run(program, input, timeoutMs)` 和 `literals(program)` |
| 参考脚本沙箱接口 | `ScriptSandbox`（`runner.ts:40`） |
| 本地进程实现（离线用） | `LocalProcessRunner`（`runner.ts:87`）、`LocalScriptSandbox`（`runner.ts:133`） |
| 程序引用 | `ProgramRef`（`runner.ts:16`）：`command` 是参数前缀，`source_dir` 供"命令没实现"的代码事实判断读源码 |
| 第 1 轮基线 | `nullBaseline`（`runner.ts:125`），代码生成的空程序 |
| 编译 | `goBuilder`（`src/exp2/build.ts:10`），编译到工作树之外 |

本地要做：
- **docker 实现**：实现 `CheckRunner`：每次在新的临时目录里只放检查的输入文件，挂进容器，运行程序，限时，收回目录里的全部文件，返回退出码和 stdout/stderr。`literals` 可以直接用 `sourceLiterals(program.source_dir)`，它只读源码，不运行程序。
- **参考脚本**：`ScriptSandbox` 换成容器里的 `python3` / `node`，只挂输入文件，不挂被测程序（BLOCK2-NOTES 4.8，DESIGN 第 8 节第 9 项）。
- **构建**：被测程序要求在 `/app/` 里用 `go build -o dpipe ./...` 构建。如果在容器里编译，按同样的方式包一个 `build(workdir, label)`，返回在容器里运行的 `ProgramRef`；`source_dir` 仍指向工作树。
- **基线**：基线是上一轮检查点的代码，由串行在每轮开始时编译（`Serial.program`）；在容器里同样处理。

## 4. 官方验证器计分

| 内容 | 位置 |
|---|---|
| 报告里的得分栏 | `RoundReport.official_score`（`src/exp2/report.ts:15`），离线为 null |
| 每轮的检查点 | `checkpoints/round-NN/`：`meta.json` 里的 `head` 是这一轮最终代码的提交 |

本地要做：
- 每轮检查点写完以后，在 `meta.json` 的 `head` 上运行官方验证器，把得分写进那一轮的 `report.json` 和 `report.md`。
- **只在本地写，不回送给系统。** 系统的任何一步都不读 `official_score`，也不读验证器的输出。不要把验证器结果放进 `store` 或 `checkpoints/round-NN/state.json`。
- 失分归因按第 14 节的三类，要对照官方用例重新归。报告里的 `loss` 是离线时按状态机械分出来的，只能作参考（BLOCK5-NOTES 3.6）。

## 5. 运行环境

- Node 22、Go（锚点辅助程序 `src/exp2/go/anchors` 第一次使用时会编译并缓存）、git、Python 3（本地沙箱用）。
- **Windows**：`.gitattributes` 已让 `exp2/inputs/**` 不转换换行；切分代码也能处理 CRLF。工作树的 `core.autocrlf` 在建库时设为 false。
- 检查点目录和构建目录都要在工作树之外，因为恢复时会对工作树执行 `git clean -fdx`。
- 不要手工修改 `store` 或检查点。续跑只靠 `Serial.run`：它总是先恢复上一轮的检查点，再重跑这一轮。

## 6. 第一次真实运行前建议先确认的

1. 只跑 R1：看归属和检查推导在真实模型上是否收敛，修补次数和 token 是否在 0.3M 以内（DESIGN 第 13.2 节）。
2. 只跑 R1 的编码：看 OpenCode 执行方的分步是否能通过 `planProblems`，每步是否真的动到了锚点。
3. 人为制造一次额度错误和一次挂死，确认会走 `QuotaExhausted` 和看门狗的路径，从检查点续跑。
4. 各 `BLOCKn-NOTES.md` 里"需要设计会话决定"的各项，尤其是 BLOCK3 4.1 和 BLOCK5 3.1（检查在编码之前推导），最好在正式串行之前由设计会话确认。
