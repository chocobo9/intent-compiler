> **历史/专题材料，非现行指令。** 保留当时的观察、方案或取舍；实现与状态须从 [模块地图](../../development/README.md) 核对，不执行本文旧“下一步”。原 CURRENT-DESIGN 节号均指历史设计。

# d3_w9 真实运行候选的语义复核（2026-09-24，gpt-6-luna 独立复核）

**这份记录回答什么**：d3_w9 第 1 轮系列真实运行里，管理层提出的候选在语义上是否成立；以及 r10 那条独立核对的拒绝，回头看在委托原文上站不站得住。

**材料**：`results/evocodebench/intent-on/runtime-d3w9-r1-r4…r10` 的 `management_log[]` 候选，共 6 条可复核（r6、r8 是传输失败、没有候选，故不在此列）。r4–r10 的 `request.ir` 均为空（`{}`），委托只有一条（802 字符）。

**方法**：与 `management-semantic-review-2026-09-24.md` 相同——`codex exec` + `--output-schema`，模型 `gpt-6-luna`，`model_reasoning_effort=max`，service tier 请求 `fast` 但该模型未声明支持 `priority`（请求里被省略）；在独立临时目录、`-s read-only` 运行，模型只看委托原文 + 当前 IR + 候选逐字。一次调用完成，用量 90,808 输入 / 7,539 输出（其中 reasoning 6,278）。

---

## 1. 结果

| case | 当时状态 | 候选字符 | D1 | D2 | D6 | 规划了委托工作 | 复核者一句话 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| r4/mgmt-1 | **accepted** | 4,247 | violation | violation | violation | **false** | "Plans to extract the spec as JSON instead of implementing and building the tool." |
| r5/mgmt-1 | validation_failed | 426 | ok | violation | ok | false | "Declines to plan the requested work because it considers the spec unavailable." |
| r7/mgmt-1 | validation_failed | 13,269 | ok | violation | violation | true | "Plans implementation of the right tool but adds many unspecified requirements and omits the requested binary artifact." |
| r9/mgmt-1 | validation_failed | 67 | undetermined | violation | ok | false | "The proposal is empty and plans none of the requested implementation or build work." |
| r10/mgmt-1 | validation_failed | 6,212 | ok | violation | ok | true | "Plans the implementation but does not specify the requested build." |
| r10/mgmt-2 | validation_failed | 9,138 | ok | ok | violation | true | "Plans the implementation and binary, but adds execution of the tool against a pipeline as a deliverable." |

合计：`plan_covers_delegation=true` **3/6**；D2 violation **5/6**；D6 violation **3/6**。**没有一条同时满足"覆盖委托"且"不引入委托外要求"。**

---

## 2. 关键发现

**① 系列里唯一被接受的候选，语义上不成立。**
r4/mgmt-1 是 d3_w9 系列唯一 `accepted` 的批次。它的候选只有一条原子：

```
atom a1 | task = "Read /app/docs/spec_v1.md to extract `repro-verify` requirements."
          ops = ["read"]   outputs = ["o1"]   coverage = []
```

这正是最初那轮真实运行的失败模式：**把"读材料提取需求"当成交付**，只授 `read`，执行层照做、verifier 0 分。它当时被接受，而该 run 没有独立核对记录（`semantic_checks` 为空）；coverage 门槛也是之后（2026-09-23）才加的。

**② r10 的两条拒绝，在委托原文上站得住。**
r10/mgmt-1 的原子本身是对的（"Implement the repro-verify tool according to the specification…"，read/write/edit/bash、coverage 齐全），但复核者指出它**没有把委托要求的 build 写清楚**；r10/mgmt-2 写了 build、输出也齐，但**加了委托没有的"对 pipeline 执行工具"作为交付物**。两条都被当时的独立核对拒掉——**拒绝本身不是凭空的**。

这修正了"r10 的核对只是发明政策"这一读法：核对给出的**理由**（schema 惯例、"多了一个交付物"、"task 还是 goal"）确实站不住，但它拒掉的**候选**确实各有缺陷。**"结论对"与"理由可核验"是两件事**——这正是 T11 要求 findings 必须引用委托原文 span 的原因，而不是"核对可以取消"的理由。

**③ 失败形态分两类。**
一类是**不交付**：r4（只读 spec）、r5（声称 spec 不可用而不规划）、r9（空提案）——三条都 `covers=false`。另一类是**交付但走形**：r7 加了大量未指定要求且漏掉二进制产物，r10/mgmt-1 漏 build，r10/mgmt-2 多产物。两类的判据都落在 D2（输出与字段范围）与 D6（委托外要求）上，而当时没有任何一维被机械层或核对以"可核验证据"的方式检查。

**④ 空提案会以"合法"的形状出现。**
r9 的候选只有 67 字符，仍通过了当时的形状校验后才被其它检查拦下。复核者对它给的是 `D1=undetermined`（无内容可判）而不是 `ok`——三态在本批同样被用到。

---

## 3. 局限

- **单一复核者、无金标准、无重复**：结论强度按 T01 草案属"候选结构"。
- **这批 run 的失败原因混着当时的传输/校验缺陷**（r6、r8 根本没返回候选），因此上表说明的是"候选的语义质量"，不是"当时系统的行为统计"。
- 复核者只按委托原文判，不看我们的 contract 与能力目录；它说的 D6 是"委托没要求"，不是"我们的 contract 不允许"。
- 6 条里只有 1 条是真被接受的（r4），样本极小；把它当成"管理层语义正确率"的分母并不合适。

---

## 4. 对设计的含义

1. **机械门槛不能替代语义维度**：r4 说明"形状合法 + 无人核对"会放行一个完全不交付的候选；r9 说明"空提案"同样能过形状校验。
2. **D2（输出与字段范围）与 D6（委托外要求）值得进契约**，且 findings 必须引用委托原文——否则像 r10 那样"结论对、理由错"的拒绝会反复出现，既贵又无法被反驳。
3. **`plan_covers_delegation` 该单独成一维**：本批 3/6 为 false，正是"没完成用户目标"这一类失败的直接指示器，比 D6 更早命中。
4. **accepted 的含义需要写清楚**：在 r4 那次，`accepted` 只代表"通过当时的形状校验"，不代表委托被完成。审计报告与运行手册都应避免把它读成后者。

---

## 5. 复现

工件与 A/B 批同目录：

```
results/evocodebench/intent-on/semantic-review-2026-09-24/
  prompt-C.txt  out-C.jsonl  out-C.json  recorded-d3w9.json
```

调用形态与 `management-semantic-review-2026-09-24.md` §7 相同（`codex exec` + `--output-schema` + ChatGPT 登录态，无密钥）。
