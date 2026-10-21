# Haiku 参考录音（R1–R3 归属，2026-10-20）

**这不是正式录音。** 正式运行用 gpt-6-luna-fast。这批录音由设计会话在 luna 暂时无法调用时，用 Claude Haiku 5.5（effort medium）录下，用来检验真实模型能否读懂请求与 schema、代码的核对与修补能否收敛，以及真实模型的出错方式。不能用来统计 luna 的错误率，也不能代替 luna 的录音。

- 请求由 `exp2-block1` 分支 dfeb22e 的代码生成（`buildRequest`、`ATTRIBUTION_SYSTEM_PROMPT`、`ATTRIBUTION_SCHEMA`、`requestJson`），原样保存在 `R<n>-prompt<k>.md` 中；回答原样保存在 `R<n>-ans<k>.json`。
- 驱动脚本：`hk.mjs`（step 生成下一次请求并报告核对结果；commit 按顺序回放录音，经 store 入库）。`state-after-R3.json` 是回放三轮之后的状态。

| 轮 | 调用 | 结果 | 观察 |
|---|---|---|---|
| R1 | 2（首答 + 1 次修补） | 通过 | 首答 46 条归属、12 条边，语义合理（按操作拆分 transform，单独出了 expression 对象）。唯一的错误：把有子小节的上级标题 `R1.S1`（"Commands"）标为 none，本意是"只指标题这一行"；但小节包含子小节，于是与其余 44 条归属全部重叠，代码报了 44 条 overlap。修补时只删掉这一条就通过了 |
| R2 | 1 | 通过 | 新命令 profile、compare，新操作各成对象；Fill `linear` 归给已有的 fill（新增）；两处 Pipeline extension 都归给 pipeline |
| R3 | 1 | 通过 | fill：只有 `R2.S13.P4.s4.c3`（"the cell remains empty."）判为被部分修订；normalize：只有 population stddev 的两个子句 `R2.S11.P5.s3.c1–c2` 判为被部分修订；p05/p95 是 profile 的新增；drift、resample、watermark 各成新对象 |

由此暴露的两个设计问题（替身从来不会这么写）：
1. 缺一个"只指标题本身、不含子小节"的单位。上级标题的那一行，模型很自然会想单独标注。
2. 同一个根源的错误，代码会逐条报出（44 条），修补请求从 3.0 万字符涨到 4.3 万字符。应当按根源合并。
