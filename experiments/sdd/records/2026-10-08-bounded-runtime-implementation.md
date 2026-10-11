# SDD 运行预算与收尾实施记录

日期：2026-10-08。分支 `integration/sdd`，基于 HEAD `ccf37ecb946d4214c96fed9bcac96ea0b0eb0189` 的未提交工作区。用户在 [设计分析](2026-10-08-budget-constraints-design.md) 后明确授权“修”。本文记录实际实施，原分析文档保留为历史设计证据。

## 实际变化

只修改 IC 仓库 `experiments/sdd` 共同运行适配、测试和文档。没有修改 SDD 核心、官方测试或历史冻结运行。没有启动新的付费模型开发或官方评测。

| 文件 | 实施行为 |
| --- | --- |
| `budget-policy.json`、`budget.py` | 单一策略与 SQLite 事务账本；跨进程调用去重、并发准入、次数/截止/停止原因持久化 |
| `budget-plugin.mjs` | `tool.execute.before` 拦截内部 task，拒绝超限/未知角色/后台派发；after 记录完成；到限后其他工具也拒绝 |
| `model_guard.py` | 保留原生参数及模型配置校验，外层 coding 编译修复、PRD fix 共用账本；PRD 检查记录源码前后摘要 |
| `prepare.py` | 冻结策略；coding 外层编译检查最多 3 次，PRD 最多 2 轮检查；保留 PRD，添加明确角色标记 |
| `process_scope.py` | Windows 挂起创建进程，加入 Job Object 后恢复；收尾终止整个树并确认 ActiveProcesses=0，包括失去原父进程的子进程 |
| `run_r1.py` | 同一 run 按配置分组执行原 shell 的设计/coding/PRD，保留门禁、不 force；分阶段截止、最终独立及机械验证，清理确认后才评测 |
| `run_results.py` | 读取具体阶段状态、coding verdict、PRD verdict/TSV；官方 CASE_SUMMARY 必须与逐用例结果一致 |
| `build_go_cli.sh` | 保存原命令结果；特定多包输出错误时验证全部包并构建唯一 main，多 main 或真实编译错误仍失败 |

主日志 `sdd-flow.log` 使用 UTF-8，记录阶段开始/截止、角色派发及完成、累计返修、停止原因、最终结果路径。progress/completion 原子写入。冻结文件哈希在启动前核对。

## 实际预算

版本 `sdd-bounded-v1`，只对以后新冻结的运行生效：

- coding：首次实现 + 最多 2 次修复，包括外层编译修复。
- PRD：最多 1 次修复、2 轮检查。第二轮仍需修复时拒绝新修复，保留未解决报告。
- 产品修复全局最多 3 次。外层 fix 已扣费时，内部首次 implement 不重复扣费，后续 implement 仍计费。
- 规格 author 初次之后最多 2 次修订，review 最多 3 次。
- coding verifier 最多 3 次，PRD verifier 最多 2 次，最终 verifier 1 次；可选 slice/fallback 各阶段各角色最多 24 次，仍受阶段截止约束。
- 总计 60 分钟：设计 30、coding 13、PRD 8、最终验证及机械校验 4、官方构建评测 4、收尾预留 1。
- 修复准入至少保留 120 秒复验时间。这是准入门槛，不保证模型在剩余时间内完成；执行中仍受阶段硬截止。

原设计候选的设计 24 分钟没有采用：R3 实际约用 28.5 分钟，因此改为 30 分钟。上述分配是当前共同默认值，模型能否在此时限内完成尚待真实试跑。两组必须使用相同策略，不能运行途中单边延长。

## 门禁、恢复和结果

coding 不通过时，PRD 状态是前置门禁未通过，不能伪造完成标记。PRD 检查后若编译修复又改了源码，绑定不匹配，输出 `prd_report_stale_or_missing_binding`；本次没有添加绕过上游状态的自动重跑路径。

最终独立验证使用新的固定 obligations/proof/report 路径，调用原 SDD report validator 检验当前源码绑定与 PASS 结论。进程退出 0、实现者宣称成功或旧报告通过不能替代验收。

completion 分开记录 SDD 状态、阶段状态、时间/次数、清理状态和官方成绩。取消未确认时禁止官方评测。失败/部分产物可以在模型停止后评测，成绩不回传模型。

同一目录再次 launch 被拒绝。打开账本不重置次数或截止；本次不提供完整 SDD 断点恢复，不能通过换会话恢复预算。

## 打包变化对实验报告的影响

新增“一个 main + 一个库包”测试发现 `go build -o dpipe ./...` 会报 `cannot write multiple packages to non-directory dpipe`。此前仅入口包的测试漏掉了这个问题。

新脚本先运行原命令并保存 `requested-command.log`、`requested-command-exit-code.txt`；只有该特定输出布局错误才继续执行 `go build ./...`、发现唯一 main，再 `go build -o dpipe <main-package>`。保存 packaging-mode 和 main-package，completion 记录 `requested_build_exit_code`、`packaging_mode`。

官方测试本身不变。适配打包成功不能写成“原要求构建命令通过”；新旧策略对比时必须将打包适配单独列为差异因素。

## 验证证据

运行适配离线套件：**30 项通过**。覆盖原生参数传递、Python3 双 shell、共同准备、并发/去重/恢复/共享次数、复验预留、Windows 孤儿进程清理、超时终态日志、结果汇总、最终门禁失败、重复启动、多包打包及多入口拒绝。

```text
python -m pytest -q experiments/sdd/test_budget.py experiments/sdd/test_process_scope.py experiments/sdd/test_runtime_results.py experiments/sdd/test_budget_plugin.py experiments/sdd/test_run_r1.py experiments/sdd/test_prepare.py experiments/sdd/test_sync.py
```

`test_budget_plugin.py` 使用本机原生 OpenCode 和本地 HTTP 模拟模型服务，固定返回禁止的 task 调用，证实 hook 在子任务建立前拒绝。只启用 probe provider，没有远端模型调用。

完整准备预检成功：`.scratch/sdd-bounded-preflight/harbor_runs/sdd-luna-dpipe-r1-20261008-204150z-16b8cdf6`。该快照不包含随后补充的 PRD 摘要绑定和日志完善，不热更旧快照；最终准备检查另建目录。

随后完整冻结与阶段分组预检通过：`.scratch/sdd-bounded-preflight/harbor_runs/sdd-luna-dpipe-r1-20261008-204837z-021ee772`。分组实际为 design=`prd,sd,change,specart`，coding=`main-coding`，prd=`main-prdcheck`。未执行模型开发；该快照仍不是下一次真实运行的目录。

容器内合成多包 CLI 构建和运行通过，输出 42；证据 `.scratch/sdd-container-packaging/probe-kkqqetqm/probe-result.json`。镜像 ID `sha256:54ad67e11d148e7a3c1b354d350b3db7ccec8840a1a8d9b17cc54adff34cb9b5`。未执行官方 test.sh。

本次未修改 validator，没有重复运行其历史 97 项测试，也不把历史测试计入本次 30 项。

## 后续实测

仍需真实试跑验证模型能否在这些限制内完整经过有限返修、PRD 和最终验收。新运行保存策略/实现哈希、各阶段时长、修复和验证次数、终止原因、原命令构建结果及官方成绩。本文不将离线通过表述为 SDD r1 已验收通过。
