# 授权增加规格修订次数

用户在明确提出“规格修订从 2 次提高到 5 次，其他限制不变”的确认问题后回复“修”。据此调整 `budget-policy.json`：策略版本 `sdd-count-bounded-v4`，`max_design_revisions=5`。初稿加修订允许最多 6 次作者任务，并配套最多 6 次独立规格审查。第 7 次仍拒绝，重开账本也不会重置计数。

整轮及阶段时间限制继续为 null；文档续做2次、coding修复2次、PRD修复1次、产品修复合计3次、辅助委派上限和全部验收门禁保持。未更换模型、未改 SDD 核心或官方测试。

验证：预算、prepare、series 套件共 25 passed，0.85 秒。新增用例覆盖第六次作者/审查允许、第七次拒绝和账本重开后的次数保持；其余用例继续覆盖产品返修限制及无时间上限。

新 series：`D:/huawei/EvoCodeBench/harbor_runs/sdd-luna-dpipe-15round-20261009-042057z-2f223c98`，模型保持 `openai/gpt-6-luna-fast / high-fast`。这是获准增加预算后的新实验版本，从 R1 开始；旧 `034034z-2bfa8d5a` 的次数耗尽结果和全部产物保留，不热更、不冒充原运行恢复。
