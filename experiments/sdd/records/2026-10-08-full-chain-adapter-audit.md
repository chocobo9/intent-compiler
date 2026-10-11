# 全链路适配审计与修复

用户授权：持续修复并用 GPT 6 Luna high fast 完成 SDD-only dpipe 15 轮。分支 `integration/sdd`。本次只改共同运行适配与模型角色配置，未修改 SDD 核心技能、验收器或官方测试。

## 实际失败与调用链

旧 series `sdd-luna-dpipe-15round-20261009-015108z-379361dd` 的 R1 在 880 秒后退出设计阶段。`runs/r1/output/05-变更说明书.md` 自述缺少 Sec 2、4、7.1 的逐行 CHG 追溯，VERDICT 为 false。调用链为 `execute_series → run_r1.execute → speclang-flow.sh → model_guard → OpenCode(change)`。文档任务首次返回后，guard 只转交退出码，原工作流遇到 false verdict 立即退出。控制器随后错误地把尚未开发的 main 交给 R2。

已终止旧控制器 PID 536；其 Job Object 同时收掉 R2 运行器及模型后代。进程检查确认该 R2 的 Python/OpenCode/Bash 均已退出，Docker 无活动容器。保留 R1 失败结果与 R2 中断产物；这组不会继续冒充完整实验。

## 修复与审计结果

| 位置 | 问题 | 最终行为 |
|---|---|---|
| `model_guard.py`、`budget.py` | 文档交回未完成稿后没有预算内续做 | prd/sd/change 读取冻结目标产物的 verdict；失败且有有效 session 时续同一个会话，所有文档合计最多 2 次；仍共用原 30 分钟设计阶段与 60 分钟整轮截止。保留每次稿件、session 和结果。非零进程退出或缺失 session 不盲目重试。 |
| `run_series.py` | 设计失败仍传播空基线 | 设计未通过，或官方未得到完整可执行评测时阻断下一轮；失败记录保留。普通完整评测中的功能失败仍如实记录，可继续多轮轨迹。active-round 同步写阻断状态。 |
| `prepare.py` | 禁止写 main 外文件与外置 SPEC 生命周期记录冲突 | 业务源码限制在 main，明确允许原 SpecArt 命令维护外置规格的生命周期记录；独立验证文件仍写 `.specart-verify`，已验收规格与只读输入受保护。 |
| `run_r1.agent_profiles` | slice 使用 Root 技能、fallback 使用完整 Verifier 技能 | 两个辅助角色读上游 verification-reference，返回分析与源码证据；不编排、不继续委派、不写最终报告。Verifier 保留原完整生命周期。 |
| `run_r1.BUILD_COMMAND`、规格 prompt | 开发 `go build ./...` 与原始交付 `go build -o dpipe ./...` 不同 | 开发执行原始要求的可执行文件命令，再执行 go test；规格设计明确收到该构建约束。通用 prepare 仍由调用方传 build_command。官方打包 fallback 只作独立证据，不代替开发构建门槛。 |

检查过共同路径 origin/main/SPEC、设计→实现→PRD→最终验证、PRD 报告源码绑定、OpenCode 原生参数/中文传递、进程树收尾、官方结果收集与串行基线。Go 无形式证明适配器按原 capability fallback 验证，不需要额外 Z3；未修改此规则。

## 验证

先执行 `python -m pytest experiments/sdd/test_series.py experiments/sdd/test_document_continuation.py -q`：3 failed / 5 passed，分别复现无效设计仍进入下一轮、未完成文档只调用一次。

修复后 `python -m pytest experiments/sdd --ignore=experiments/sdd/overlay -q`：41 passed。随后新增原生进程 UTF-8 / 同 session 续做用例，文档用例 3 passed；合计 42 个用例覆盖当前改动。此前一次递归收集误包含 overlay 的上游测试复制件，因缺少原仓 conftest 收集失败；改用正确共同运行适配测试入口。未把此次收集失败算作运行器失败。

原生测试使用本机 Python 脚本替代模型，验证真实 guard 子进程、中文流、session 参数和失败/通过稿件保存。原生 OpenCode 插件测试仅连接本地脚本 provider。真实模型全流程结果以新实跑产物为准。

## 新实跑版本

新 series：`D:/huawei/EvoCodeBench/harbor_runs/sdd-luna-dpipe-15round-20261009-021543z-e683ceba`。

冻结策略 `sdd-bounded-v2`，新增文档续做总上限 2，原设计修订 2、coding 修复 2、PRD 修复 1 与整轮 60 分钟不变。模型 `openai/gpt-6-luna-fast / high-fast`。这是适配修复后新版本从 R1 开始的实验；旧运行预算和验收记录不迁移，不把两版结果拼成同一次运行。

每轮原始输入截至当前轮、只承接本组上一轮代码，官方测试结果不回传模型。终点仍是 15 轮逐轮结果和完整证据；当前尚未完成。
