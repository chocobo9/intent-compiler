# IC+SDD R1 独立真实试跑

用户于本轮明确授权并行跑一轮真实IC+SDD R1。运行入口在 integration/sdd，实验目录：
`D:/huawei/EvoCodeBench/harbor_runs/ic-sdd-dpipe-r1-20261009-133851z`。

2026-10-09 13:39:34 UTC进入真实IC IR生成。控制器按 compile → start → reconcile → assess 串行执行，只运行R1，不自动开始R2。最终结果写result.json；controller-status.json和controller.log记录阶段/阻断，SDD目录启动后写sdd-run.json。控制器路径为项目`.scratch/ic-sdd-dpipe-r1-20261009-133851z/controller.py`。

管理服务独立监听127.0.0.1:43363，有效配置验证为openai/gpt-6-luna-fast、无plugin/instructions，请求high-fast、业务工具禁用。管理调用上限9次、回传评估2次，调用前持久化计数。传输使用现有timer-safe最大值2147483647ms，不恢复旧60分钟开发上限。SDD使用冻结v4：文档续做2、规格修订5、coding返修2、PRD返修1，无整轮/阶段硬时间上限。

R1原始instruction逐字复制，初始代码基线为空、独立于SDD-only。IC源码/构建/桥接/控制器单独保存；共同adapter与SDD技能指向R4冻结根124641z-65b36d45及其runtime，输入身份和源码摘要由桥接核验。frozen-hashes.json保存本次文件摘要。官方评测由原共同runner执行，官方结果仅进实验result，不反馈给IC改写要求/产品。

同时核对发现SDD-only R4于13:37:16 UTC因design_revision_limit_reached停止，13:37:39官方阶段结束；未进入coding，series为runner_blocked。最后独立review指出checkpoint的algorithm字段/JSON映射遗漏，属于模型规格遗漏，尚无共同适配故障证据。未重启R4、未增加预算，原A组失败证据完整保留。B组从自己的空基线运行，不使用该未完成设计作为基线。

## 13:43 UTC：实际进入SDD

IC用了7/9次调用：IR三次（来源id错误、严格schema字段遗漏各一次），CI三次（coverage遗漏两次），独立核对一次通过。交付正文22275字符，已保存delivered-ci.md。未手工修改模型产物。

首次prepare发现把运行快照当作可复用adapter包时，execution-context.md、Go系统设计扩展目录及build_go_cli.sh不在模块预期的相邻位置。新增共同打包工具package_adapter.py，逐字从同一R4冻结版本对应位置复制并记录摘要；未改R4冻结目录。完整实际freeze预检通过，工具链/有效配置检查完成。

首次prepare未启动SDD。恢复用独立preparation-recovery/request.json和证据，沿用同一CI、空基线、原claim和管理计数；通过prepared manifest关联后执行reconcile、launch-prepared，仅启动一次。原失败日志保留。恢复控制器为`.scratch/ic-sdd-dpipe-r1-20261009-133851z/controller-recovery.py`，日志controller-recovery.log，原控制器保持停止。

真实SDD目录：`D:/huawei/EvoCodeBench/harbor_runs/sdd-luna-dpipe-r1-20261009-134309z-f513ab0e`。13:43:40 UTC开始sdd-design，13:43:42进入PRD生成。后续自动等待completion、回传原SDD证据并执行最多2次管理评估，最终写实验result.json。最终结果以实时状态文件为准。

监控：在PowerShell运行实验目录的monitor.ps1，每10秒刷新管理/SDD阶段；Ctrl+C只停止监控，不停止实跑。
