# 当前运行状态（2026-10-11 00:54 UTC，交接用）

## 正在运行
- SDD-only：`D:/huawei/EvoCodeBench/harbor_runs/sdd-luna-dpipe-15round-20261011-004124z-b428d7bd`。R1–R4 继承（R1 自动决定放行 217/219，R2 467/481，R3 493/535，R4 600/639），从 R5 重跑（两处适配修复后）。
- IC+SDD：`D:/huawei/EvoCodeBench/harbor_runs/ic-sdd-dpipe-15round-20261011-010247z-52ca6648`，从 R1 开始（01:03 UTC；又补了 Go SD 空基线说明），包含全部改动：IR 完整请求、管理调用上限 20、IC 组专用 PRD 补丁（`experiments/sdd/ic_arm_sdd_patch.py`）、上一轮 PRD 作基线的交付（R2 起）、子 agent 路径基准、无人值守冲突措辞。

## 已停止、保留作记录的 IC 串行
- `ic-sdd-dpipe-15round-20261011-005351z-3d593046`：R1 的 SD 阶段在空基线上自判 `pass=false`（模型把“空目录无可描述”当成未完成），流程停止，0/219。属于适配缺口：Go SD 资料补充“空基线如实记录即为完成，VERDICT 写 pass=true；false 只用于文档未完成或有问题”。R2 刚启动即停止。
- `ic-sdd-dpipe-15round-20261010-173448z-deb3b414`：旧装配，停在 R5（IR 格式错误）。
- `ic-sdd-dpipe-15round-20261010-233647z-8edae855`：R1 作废（SpecArt 设计了多包结构，与 `go build -o dpipe ./...` 不兼容，属于模型设计失误），136/219；R2 从空基线启动后已停止，判为不具代表性，改由新串行重跑 R1。

## 晋级规则（两组相同，run_series.promotion_decision）
sdd_pass；auto_manual_decision（PRD 停在 NEED_MANUAL_DECISION 且能构建，保留当前代码）；其他一律 auto_void_round（本轮作废，下一轮从本轮 baseline 开始，记录 promotion.failure：停止阶段、流程报错、该阶段结论）。只有清理未确认、runner 出错时串行才停。

## 常用操作
- 查看进度：各串行目录下的 `series.log`、`series-report.md`、`series-results.json`。
- 中途停下再续跑：停掉串行器进程（某一轮的 SDD 是独立进程，不受影响）。SDD-only 用 `run_series.py --continue-from <旧串行> [--retry-from N --reason ...]`；IC 用 `run_ic_series.py --resume <串行> --reason ...`（已登记的 SDD 运行会被复用，不会重启）。
- 耗时分析脚本：`project/.scratch/time-analysis/`；素材：`experiments/sdd/records/2026-10-10-sdd-round-time-analysis.md`。
- 决策与改动的全部记录：`development/SDD-IC-ADAPTATION-DECISIONS-2026-10-10.md`、`experiments/sdd/records/2026-10-10-restore-upstream-sdd.md`。

## 尚未完成
- 两组跑完后写实验结果报告：每轮分数和晋级方式、作废原因分类（适配 vs SDD 自身）、IC 管理调用与 SDD 耗时、PRD 补丁只在 IC 组的口径说明、初版 IR 格式脆弱性等发现。
- 所有代码改动都在 `integration/sdd` 工作区，未提交。
