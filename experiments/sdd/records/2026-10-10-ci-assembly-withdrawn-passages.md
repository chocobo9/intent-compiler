# 2026-10-10 初版 CI 装配对撤销内容的处理（离线回放）

问题：IC 挂在 PRD 之上（挂点 1）时，初版 CI 交给 SDD 的正文里，用户已经撤销或修改的旧原文还在不在。如果在，PRD 仍然要自己消化撤销。

## 方法（不调用模型）

- IR：真实 IC 存储 `management_runs/intent-luna-dpipe-pending-r7return-20261005-140834z-19ebeb/.../snapshot.json`，dpipe 7 条输入，R5 已并入。
- 历史选择：R5 之前的存储 `intent-luna-dpipe-offline-r5-20261005-002917z-9a89a4`，其中各条目 rev 0 的 sources。
- 装配：直接调用 `attachAssignedRequirements`，即 CI 正文的生成函数，取自当前 `.scratch/ic-sdd-dist` 构建。脚本：`project/.scratch/ci-assembly-check/replay.mjs`，输出在同目录。

## 结果

- `r-ingest@1`：IR 已经把 R1 那句“校验和写入 `<output>.sha256`”从当前 sources 中切掉（R1 335–2535 + 2678–2680，缺 2535–2678）。但装配时 `withdrawnFor` 又把这句原样加了回来，没有任何标记。正文是：R1 全段（含 `.sha256` 那句）→ R5 “旁路文件已移除”→ R5 “若存在须删除”，开头一句“后面的输入覆盖前面的”。
- `r-verify@1` / `r-manifest@1`：IR 条目本身同时保留 R1 的“计算 SHA-256”和 R5 的“改用 BLAKE2b-256”，正文同样是新旧并列，靠“后面的输入覆盖前面的”来区分。

## 结论

1. 初版 CI 交给 SDD 的是“按条目重新分组的原文 + 被修改或撤销的旧原文 + 后者覆盖前者的提示”。消化撤销的负担和 SDD-only 拼接原文时一样，仍然在 PRD 身上，只是范围按条目缩小了。这是装配代码有意的设计（见 `requirement-flow.ts` 中的注释）。
2. 原因有两层：(a) 装配主动把已撤销片段加回去；(b) 初版 IR 只能引用原文片段，修改是用新旧片段并列来表达的，不会生成“修改后的有效表述”。
3. 因此在初版里，挂点 1 的价值主要是按条目分组和选择范围，跨轮修改的处理基本没有替 PRD 分担。第三组对照实验如果直接用初版 CI，预计和 SDD-only 差别不大。

## 后续（同日）

已按用户的决策改为 SDD 模式装配：不再加回已撤销的片段，被修改的条目附上“现在有效的要求”。见 `development/SDD-IC-ADAPTATION-DECISIONS-2026-10-10.md`。
