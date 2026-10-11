# 取消运行时间硬上限，保留次数限制

用户在 R1 设计阶段被 30 分钟截断后要求去掉时间上限，分析后再次明确要求立即实施。修改位于 `integration/sdd`，仅涉及共同运行适配。

## 策略与消费者

- `budget-policy.json`：版本 `sdd-count-bounded-v3`，`round_deadline_seconds` 和全部 `stage_max_seconds` 使用 JSON null，明确表示无时间截止。
- `budget.py`：支持空截止时间；不再因经过时间或剩余复验时间拒绝工作。仍记录开始时间、计数和事件，检查策略哈希；原有有限时间配置仍可解析。两个 reserve 字段仅在显式有限截止时适用。
- `run_r1.py`：取消当前策略下的阶段定时终止；日志显示 `deadline=none (count limits retained)`，provenance 中的 deadline 来自冻结策略。
- `run_series.py`：整轮上限同样来自策略；null 时等待当前轮自然结束，没有原 3660 秒的外层截断。
- `execution-context.md`：明确告知角色使用有限返修次数、无整轮或阶段时间截止。

文档续做合计 2 次、规格修订 2 次、coding 返修 2 次、PRD 返修 1 次、产品返修合计 3 次、辅助委派上限及各独立门禁保持。Go helper 单次执行、工具预检、数据库锁等待、Docker 停止和进程收尾超时保持。SDD 核心和官方测试未改。

取消时间截止后单次模型任务仍可能停滞，持续跟进根据实际活动及错误证据诊断，不把累计耗时直接当成失败。失败或阻断必须通知用户，不能对已停止任务持续静默。

## 验证与实验版本

`python -m pytest experiments/sdd --ignore=experiments/sdd/overlay -q`：47 passed，11.35 秒。包括模拟经过 30 天仍允许工作但超出修复次数拒绝、无截止阶段真实子进程结束与清理、串行控制器 timeout=None、有限策略兼容、既有模型参数/中文/生命周期/结果门禁测试。

旧 series `20261009-021543z-e683ceba` 保留 R1 stage_timeout 记录：PRD/SD/change 通过，规格第二次独立审查被截断，coding 未进入。没有恢复旧预算或改写旧冻结目录。

新 series：`D:/huawei/EvoCodeBench/harbor_runs/sdd-luna-dpipe-15round-20261009-030417z-31faf30d`。从 R1 开始，模型 `openai/gpt-6-luna-fast / high-fast`，目标为 15 轮完整结果。它属于取消时间限制后的新实验条件，不能与旧运行拼接为一次成功链路。
