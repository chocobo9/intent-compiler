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

## 7. 第 6 块之后的变化（以本节为准）

以下几项已经写成代码，本地只需要配置和核实：

- **命令行入口**：`intent-exp2-serial --config <file> [--to <round>]`（`src/cli/exp2-serial.ts`）。配置文件格式见 `exp2/local-config.example.json`，校验、组装和连接前检查在 `src/exp2/local-config.ts`。用同一个配置再运行一次，就从最近的检查点续跑。退出码：0 表示完成，1 表示停下（例如归属失败或登录失效），2 表示配置或连接前检查不通过，3 表示等额度的次数用完。
- **额度和登录**：`src/exp2/provider-errors.ts` 从错误文本识别额度用完和登录失效，两个管理调用传输层和编码执行方都已接上。额度用完抛 `QuotaExhausted`，串行等待后续跑；登录失效抛 `AuthInvalid`，串行停下并写 `stopped-round-NN.json`。**本地要做**：把真实遇到的报错原文补进 `test/exp2/local.test.ts` 的 `AUTH_TEXTS` 和 `QUOTA_TEXTS`；识别不出的，在 `provider-errors.ts` 里补正则。
- **docker**：`src/exp2/docker.ts` 有 `DockerRunner`、`DockerScriptSandbox`、`dockerGoBuilder`。配置里设 `runner.kind: "docker"`。命令行的构造已有测试，真正运行容器还没有做过。**本地要做**：
  - 确认镜像里有 `python3`。参考脚本要用它；如果没有，在 `runner.python` 里指定，或者换一个带 Python 的镜像。
  - 确认 Docker Desktop 接受 `C:\...:/work` 这种挂载写法。
  - 容器里编译时 Go 缓存每次都从空开始。如果太慢，可以用 `runner.extra` 挂一个缓存卷。注意 `extra` 对检查运行也生效。
- **官方计分**：配置里的 `scoring.command`，例如 `["node", "score.mjs", "{round}", "{commit}", "{repo}"]`，要求输出 `{"passed": n, "total": m}`。结果只写进那一轮检查点的 `report.json`、`report.md`，以及 `checkpoints/scores.jsonl`；状态文件里的 `official_score` 始终为 null，系统不读取它。
- **Windows**：可执行文件名、解释器、命令行和子进程环境都集中在 `src/exp2/platform.ts`。Python 默认用 `python`，可以用 `tools.python` 或环境变量 `EXP2_PYTHON` 指定完整路径；Go 用 `tools.go` 或 `EXP2_GO` 指定。

## 8. 第 7 块之后的变化（以本节为准，覆盖第 7 节里与之冲突的说法）

- **docker**：Python 默认 `/opt/sdd-python/bin/python3`（`runner.python` 可改）；镜像没有 node，node 参考脚本直接失败。Go 构建缓存用 `runner.buildCache`（卷名或主机目录），只挂进编译容器；不要再用 `runner.extra` 挂缓存。
- **程序名**从原文的构建命令读出（dpipe 为 `dpipe`），本地和 docker 构建都用它。
- **限流和额度**：429、rate limit 在同一次调用里按 `rate_limit.delays_ms` 退避重试，用尽后按额度用完处理；只有明确的额度文本才直接走 `resume.wait_ms` 的等待。**本地要做**：把真实遇到的限流文本补进 `test/exp2/local.test.ts` 的 `RATE_TEXTS`。
- **环境拦截**（Smart App Control：spawn `UNKNOWN`、"Application Control policy"）：启动重试 3 次，仍被拒时串行停下，写 `stopped-round-NN.json`，原因以 `environment:` 开头，不算步骤失败。处理完环境后用同一配置再运行即续跑。编码会话里 OpenCode 自己执行的命令仍在主机上（BLOCK7-NOTES 4.1）。
- **预先登记**：每轮检查点有 `prediction.json`（对象状态和 sha256），`checkpoints/predictions.jsonl` 汇总；计分记录带 `prediction_sha256`。**本地要做**：把官方逐条结果对回对象，写成 `{id, passed, objects}[]`，调用 `reconcile(prediction, cases)`（`src/exp2/prediction.ts`）。对账结果不放进状态或检查点。
- **录音**：`recordingTransports(t, cassette, file)` 包住真实的两个管理传输层，每次调用后保存回放文件；`replayTransports(loadCassette(file))` 回放（`src/exp2/recording.ts`）。**本地要做**：luna 的第一次真实运行用录音方式包一层，回放文件放在 `exp2/recordings/<名字>/`。命令行入口还没有录音开关，需要时在 `assembleSerial` 里包一层即可。
- **比较工具**：`intent-exp2-compare --state <checkpoints/round-15/state.json> --independent <标注.json> --inputs exp2/inputs/dpipe --out cmp.md`。标注格式：`{label, rounds: [{round, answer}]}`，`answer` 是整份 `AttributionAnswer`，要能通过同一套核对。
- **变异测试**：`intent-exp2-mutate --tree <某轮代码的副本> --state <该轮 state.json> --round <n> [--config <本地配置>] [--max 30] --out mut.md`。只对已有产物运行。
- **消融**：配置里的 `ablation: { zoning, checks, clauses }`，都默认 true，写进状态；用不同设置打开同一状态会报错，所以消融运行要换 `run_id` 和全部目录。

## 9. 第 8 块之后的变化

- **回放已有录音**：请求字节随提示词和报错变化。录音和当前代码不是同一版本时，用 `replayByRound(loadCassette(file))`：按步骤和轮次、按回答顺序回放，剩下没用上的回答由 `unused()` 列出。`replayTransports` 只用于同一版本代码录下的文件。
- **新状态 amended**：代码块、表格被新原文修订时不再被替换，工单原文区里两者都在，标明新原文优先。看工单时注意这个标记。
- 第一批的 `exp2/recordings/haiku-reference/cassette.json` 已不再被测试使用，第二批的 `batch2/cassette.json` 包含它的 4 条回答。

## 10. 第 9 块之后的变化（以本节为准，与前面冲突的地方以这里为准）

- **执行**：不再分步。每轮一个编码会话拿到工单，一次做完。之后代码构建、跑整个检查库、提交一个周期；有失败就把证据发回同一会话，最多 `limits.execution.repairCycles` 次（默认 3）。限额现在只有三项：`repairCycles`、`maxSessions`、`callTimeoutMs`，原来的分步限额已删除。执行方可以在回复里写 `CONTEST <检查编号>: …` 对检查提出异议，由裁决调用决定。
- **裁决**：用管理服务器、同一个模型，配置里不用另加。每条有争议的检查只裁决一次，结果记在状态的 `rulings` 里。
- **模型**：示例配置的管理调用和编码都是 `gpt-5.6-luna-fast` medium。**本地要做**：OpenCode 配置里给 `gpt-5.6-luna-fast` 也设上 promptCacheKey（O8：现在只给 gpt-6 设了，修补请求的缓存读大多是 0）。
- **编码服务器**：
  - 用 `GIT_PAGER=cat`、`PAGER=cat` 启动；
  - 配置里设 `"permission": { "external_directory": "deny" }`，否则连接前检查不通过；
  - 若 SDD 单独执行的编码代理是在 `sdd-unattended-preflight` 镜像里跑的，OpenCode 也放进同一镜像（DESIGN §12c 第 3 条）。
- **客户端**：IC 的 OpenCode 客户端改用 `node:http`，不再有 5 分钟的响应头超时。单次请求的上限是 `request_timeout_ms`（默认 60 分钟），编码时由 `callTimeoutMs` 的看门狗兜底，超时就中止会话。
- **token**：编码的 token 按会话全部助手消息加总（读 `/session/{id}/message`）。编码提示不再使用 json_schema。
- **录音**：配置项 `recording: { cassette, label }`。打开后，每次管理调用（归属、检查、裁决）都在调用后写进这个文件；续跑时接着往后写。回放用 `replayByRound`。
- **离线验收**：`intent-exp2-detect --products <list.tsv> --state <state.json> [--config <file>] --out detect.md`，见 BLOCK9-NOTES 第 6 节。state 用含 Haiku R1–R3 检查的那份（例如 hk2 串行的 store 状态）。

## 11. 第 10 块之后的变化（以本节为准）

- **默认流程**：检查关闭（`ablation.checks: false`），每轮写探针（`gpt-6-sol-fast` low），每个周期在目标镜像里跑全部有效探针，判断（`gpt-5.6-luna-fast` medium）给出纠错单，在执行会话里修。两个角色都在管理服务器上，每次调用一个新会话。配置项 `roles` 可以改模型；`roles: null` 关闭。要确认管理服务器能用 `gpt-6-sol-fast`，并给它也设上 promptCacheKey。
- **状态**：新增 `probes`、`probe_events`、`probe_calls`、`probe_rounds`、`judgments`、`judge_calls`。旧状态打开时这些为空，可以接着用；但检查开关写在状态里，第 9 块的状态（检查打开）不能用 `ablation.checks: false` 打开，要新开一个 `state_dir`。
- **离线发现**（§4 第一项）：

  ```
  intent-exp2-probe-detect --config <本地配置> --state <含 R1 归属的 exp2-state.json> --products exp2/acceptance/r1-products.tsv --defects exp2/acceptance/r1-defects.json --out <目录>
  ```

  - `--state` 用实验 1 所用的 Haiku 归属状态（`hk2/checks-run/store/exp2-state.json`），覆盖单位与 P 的 130 条一致（替身归属是 131 条）。状态会复制到 `<目录>/store`；
  - 产物列表照 `r1-products.example.tsv` 填路径，名字要与缺陷表一致；
  - 输出 `detect.md`、`detect.json`：每份产物的纠错条目、歧义条目、判断调用与 token，缺陷表命中数，满分产物上的条目数。
- **离线修复**（§4 第二项）：

  ```
  intent-exp2-repair --config <本地配置> --detect <上一步的目录> --products <4 份缺陷产物的列表> --out <目录>
  ```

  - 用上一步写好的探针和判断缓存，产物仓库复制到 `<目录>/<名字>/app` 再修；
  - 配置的 `scoring.command` 修前、修后各调一次。逐题对比要求它在最后一行 JSON 里给出 `cases`（键为"要求 | 意图 | 场景"，值 pass/fail）或 `verifier_log`（官方日志路径，按 `CASE_RESULT` 行解析）；
  - 输出 `repair.md`、`repair.json`：条目数、修前→修后、修好、改坏、仍失败、周期数、编码 token。
- **报告**：每轮报告多一节 Probes，含写探针、判断的模型、调用、token，以及占编码 token 的比例。

## 12. 第 10b 块之后的变化

- **提示已经中性化**：录音的请求变了，旧录音只能按回答顺序回放。
- **调用失败**：一步里累计 3 次调用失败，就判为不可用并停下；`stopped-round-NN.json` 里写着原因。录音目录会自动创建；写不进去的路径在启动时就报错。
- **区分力度量**：
  - 每轮第一个构建成功的周期里，跑 `limits.mutants` 个变异体（默认 20，`0` 关闭）。它需要本机有 Go（变异工具在宿主机上运行，和锚点工具一样）；
  - 变异体的构建走配置里的构建方式（docker）。
- **离线检出**：
  - 每份产物在 `<out>/products/<名字>/store` 有自己的状态副本，度量、加强、判断都在副本上做；
  - 第二次用同一个 `--out` 运行，会复用这些副本；要从头测，就换一个 `--out`；
  - 表格多了几列：区分开的变异体、弱点单位、新增探针、仍未区分、加强的 token。
- **离线修复**：`--detect` 指向检出的输出目录，每份产物用它自己的副本（包括加强后的探针）。

## 13. 第 10c 块之后的变化

- **写探针在后台进行**：第一条编码消息不再等它。每轮报告的 "Wall time" 一行，以及 `report.json` 的 `wall`，给出各阶段的墙钟时间。重跑时请对照这几项。
- **并发**：
  - 探针同时 4 个（`limits.probe_concurrency`）；
  - 写探针的组和判断的批次各同时 3 个；
  - 变异体同时 2 个。
- **资源限制**：`runner.limits`（`memoryMb`，默认 1024；`outputBytes`，默认 8 MiB；`pids`，默认 256），以及 `runner.buildMemoryMb`（默认 2048）。docker 容器带 `--memory`/`--memory-swap`/`--pids-limit`。可以不再用外部守护进程；如果仍想留着，阈值应高于这里的上限，避免抢先杀掉容器。

## 14. 第 11 块之后的变化（统一验收模型，见 BLOCK11-NOTES）

- **每个周期全部运行**：全部有效库检查一批、全部有效探针一批，docker 下每批一个容器（每批最多 1000 次运行）。镜像需要有 `timeout`（coreutils）和支持 `%N` 的 `date`。没有 `timeout` 时自动退回到每次运行一个容器；没有 `%N` 时，超时只能靠退出码 124 来识别。判断只在输出变化时重做。按锚点挑选和轮末检查已删除。
- **库检查默认打开**：示例配置去掉了 `ablation.checks: false`。已有 state 里记着 `checks: false` 的运行需要新的 state。
- **角色**：`roles` 有 `probes`、`judge`、`checks`、`adjudicate` 四项。前三项默认 `gpt-6-sol-fast` low（与 executor 不同的来源），`adjudicate` 默认 `gpt-5.6-luna-fast` medium（`local-config.ts` 的 `DEFAULT_ROLES`）。
- **变异体度量默认关闭**；要打开，设 `limits.mutants`。
- **报告**：新增两行。"Determinations on the final program" 给出 A/B/C 三类各多少；"Open" 按原因给出程序错、未覆盖、参考不一致待裁决、有歧义的条目数，以及由代码关闭为不可测的单位。"Runs per cycle" 给出每个周期的库检查数、探针数，以及判断重做、沿用缓存、由代码判定的数目。
- **判断要求计算时**，用配置里的脚本沙箱（docker 下是 `runner.python`）。离线检出和修复工具也会传入这个沙箱。

## 15. 第 12 块之后的变化（台账、无效修补、定向运行、回放，见 BLOCK12-NOTES）

- **每个周期定向运行，每轮全量兜底**，取代第 14 节"每个周期全部运行"：
  - 周期里只运行本轮原文改动的、台账里开放的、以及上次运行执行到了本周期改动过的函数的那些检查和探针；
  - 没有要送的东西时，在该周期的程序上全部运行一次，输出变了而定向时没选中的记为选择遗漏；
  - 这次全量就是本轮最终的探针结论。
- **覆盖构建**：配置项 `coverage` 默认 true，构建用 `go build -cover`，每次运行用自己的 GOCOVERDIR。docker 镜像里要有 `go`（covdata）；没有的话每个周期全部运行，结果不变，只是更慢。
- **不做无效修补**：同一条目送过一次、输出没变，就交 `adjudicate` 角色裁决（执行方写 CONTEST 也一样），不再重送；裁为程序对或有歧义即结束；连续两轮轮末输出相同的条目只列在报告里。
- **判断的计算**：`compute` 必须给出 `where`，代码比较程序在该处的值；依据计算的"错"不接受，退回改为计算。
- **台账**：每轮检查点里有 `ledger.json`、`ledger.md`；报告新增 "Selection"、"Ledger"、"Cache reads of input" 三行，"Runs per cycle" 里有每个周期的选择理由和全量。
- **回放**：`intent-exp2-replay --config <配置> --products <list.tsv> --out <目录> [--state <state>] [--defects <表>]`。不编码，逐轮建出检查和探针，在冻结程序上运行，每份程序输出台账；带 `--defects` 时，库检查和探针合并计分。产物路径可以写成 `<repo>@<commit>`。

