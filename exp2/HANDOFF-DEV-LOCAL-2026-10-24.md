# 交接：本地开发会话（2026-10-24 起）

云端开发会话已停，最后提交 `ccr-992739b3-u5bcay` @ cd7fe03（批 4 已验证；批 1 未跑完整测试）。设计以 `origin/exp2-pure-ic` 的 DESIGN.md 为准：**§6a 原文的运行逻辑**、**§12j 收编**（12j.7 第 1–12 条是决定，12j.5 是去留表）。

## 先读
1. DESIGN §6a（原文的运行逻辑）、**§6b（三句话、权威表、守卫三条规则）**、§12j（含 12j.7 决定）。任何涉及"给模型什么"或"谁判断什么"的改动，先对着 §6b 的权威表核。
2. exp2/BLOCK-ACCEPT-NOTES.md §15–§22（云端各批的做法、依据、验收；§22.8 是批 1 的未完成清单）。
3. exp2/evidence/real-runs-2026-10-23/README.md：七次真实 R1 和 15 轮 R1–R3 的状态与结论；ic15-all-scope 是 G77 重放材料。
4. exp2/evidence/corpus-scan-2026-10-23/：26 题的原文扫描、修订标准答案集（revision-gold.json，193 句）、AUDIT（守卫期望值来源、裁决 token、归属召回）。

## 接着做（顺序）
1. 在 cd7fe03 上跑完整 `npm test`，修掉剩下的失败（本机 Windows 下有约 18 项环境失败：Temp 里的 exe 被智能应用控制拦、测试写死 python3、sh；见记忆/AUDIT。门禁看云端 Linux 的数或在容器里跑）。
2. 批 1 未完成项（NOTES §22.8）：§14 预期数字回写；回放命令去掉 `--mode review`；用 ic15-all-scope 的 R3 真实状态重放 G77 的三次修补，验收是走分类不走回退。
3. 真实 R1 冒烟（delta 默认）：新目录 rep1h，端口新开，`bin/start-servers.ps1` 两服务间隔 8 秒，`bin/run-serial.ps1` 分离启动（都在 rep1g 目录里）。达标线是接口计数（报=进+挡、守恒、no_input 只在三处材料都没有时、准入≈入库、无假守卫），分数只记录；另加：R2 工单原文区字符数明显小于 all 档（替身串行已给 29.8k 对 46.5k）。
4. 批 2（前提降为记录）、批 3（一种记录加历史）按 §12j.7 第 8 条顺序。
5. 换题准备已做：exp2/inputs/lsm-kvstore/（8 轮原文，README 列了要参数化的 dpipe 写死处）。

## 云端批 1 的一处行为变化，冒烟时要看
期望值为派生值（derived）的守卫在原文未改时翻转，现在记为 disputed 交审查员当线索，不直接送修也不回退。约七成守卫断言是派生值（AUDIT §1），所以真退化（如 ic15 R3 的 G84/G92 hash）现在要多经过一次审查才送修。冒烟里看 "flips … disputed" 的计数和它们是否在同一轮被审查员确认。

## 运行环境
- Go：D:/huawei/intent_compiler/project/.scratch/sdd-phase1/go/bin；Python 3.12；docker 镜像 sdd-unattended-preflight:latest（重启后先确认 Docker Desktop 起来）。
- 对话框清理：D:/huawei/EvoCodeBench/harbor_runs/close-openwith.ps1（重启后重起）。
- 两个 OpenCode 服务共用一个 sqlite，不能同时启动。
- 启动用 Windows 路径；MSYS_NO_PATHCONV=1 下 /d/ 路径会失效。
