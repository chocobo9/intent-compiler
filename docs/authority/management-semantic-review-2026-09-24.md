> **历史/专题材料，非现行指令。** 保留当时的观察、方案或取舍；实现与状态须从 [模块地图](../../development/README.md) 核对，不执行本文旧“下一步”。原 CURRENT-DESIGN 节号均指历史设计。

# 管理层候选的语义复核（2026-09-24，gpt-6-luna 独立复核）

**这份记录回答什么**：机械门槛接受的候选，在语义上是否真的成立？具体量化两件事——

1. **引用可核验**（代码判定，不含模型）：候选/引用的 `digest` 与 `span` 是否真的指向原文。
2. **语义正确性**（独立模型复核）：候选是否规划了委托要求的工作、是否漏掉委托明确的语义、是否引入委托外的要求。

**材料**：`results/evocodebench/intent-on/replay-2026-09-22-qwen/` 的 **14 条 accepted 候选**（r4–r11 的历史管理请求，按当时的当前解析器/schema 重放后全部通过机械门槛的那 14 条）。请求原文与候选来自 `results/evocodebench/intent-on/runtime-r4…r11/store/v2-runs/*/snapshot.json` 的 `management_log[]`，候选文本来自重放目录的 `*-response.txt`。

**性质声明**：这批材料是历史请求，`request.ir` 全为空（`{}`），因此**不代表 d3_w9 当前系统的行为**；它量化的是"机械通过 ≠ 语义正确"这一缺口本身。

---

## 1. 方法与隔离

| 项 | 值 |
| --- | --- |
| 复核者 | `gpt-6-luna`（与候选生成者 qwen3.8-flash **不同族**） |
| 推理强度 | `model_reasoning_effort = "max"` |
| service tier | 请求 `fast`；运行时报告 **`priority` 未被 gpt-6-luna 声明支持，请求里被省略** → 本次**没有**实际启用 fast |
| 运行方式 | `codex exec`（ChatGPT 订阅登录），`--output-schema` 约束输出形状，`--json` 记录事件与 usage |
| 隔离 | 在独立临时目录运行，`-s read-only` + `--skip-git-repo-check`；仓库与 `project\.env` 不在其可读范围内 |
| 批次 | A 批 12 个小候选（52,617 字符）；B 批 2 个大候选（97,493 字符）——按证据里"每次 `codex exec` 约 8 万输入 token 脚手架开销"合并，避免一候选一调用 |
| 复核者看到的内容 | 委托原文（逐字）+ 当前 IR + 候选逐字；**不含**我们的 contract 与能力目录（刻意如此：判据只以委托原文为真值来源） |
| 判的维度 | D1 对象与材料角色 / D2 输出与字段范围 / D6 是否引入委托外要求 + `plan_covers_delegation`（是否真的规划了委托要求的工作） |
| 三态 | `ok` / `violation` / `undetermined`（信息不足时不许猜） |

**D3（授权对象）与 D5（引用可核验）不在模型评判范围内**：D5 由代码判定（§2）；D3 需要能力目录，而这 14 份请求的 `request` 里没有（键只有 `budget / compiled / contract / events / executions / ir / run_id`）——这本身是一条计量缺口的证据（见 §5）。

### 用量（订阅额度，无 API 计费）

| 批次 | 输入 token | 输出 token | 其中 reasoning | 墙钟 |
| --- | --- | --- | --- | --- |
| A（12 条） | 95,252 | 11,563 | 9,610（83%） | ≈3.6 min |
| B（2 条） | 108,980 | 4,580 | 4,106（90%） | ≈1.5 min |
| 合计 | 204,232 | 16,143 | 13,716（85%） | ≈5 min |

> 输入里约 16 万 token 是 Codex 每次调用的**固定脚手架**（agent 系统提示 + 工具定义），不是我们的材料；材料本身约 43k token。reasoning 占输出 85%，与我们 qwen 管理调用的形态一致（84%）。

---

## 2. 机械核验：引用可核验（代码判定）

判定口径：候选里每个 `{digest, span}` 引用，`digest` 必须等于某条真实原文的 `sha256`（UTF-8），且 `span` 落在该原文长度内。代码与结果落 `results/evocodebench/intent-on/semantic-review-2026-09-24/mechanical.json`。

**结果：14 条里 0 条有可核验引用。**

| 情形 | 条数 | 例子 |
| --- | --- | --- |
| 有引用，但全是占位/伪造摘要 | 8 | `sha256:placeholder_f…`（r5/mgmt-1，33 个引用）、`sha256:0000…`/`sha256:1111…`（r6/mgmt-1）、`sha256:placeholder_e…`（r10/mgmt-2，107 个）、`sha256:placeholder_d…`（r11/mgmt-3，167 个）、`sha256:a958c15294ea2…`（r4/mgmt-2，20 个） |
| 完全没有引用 | 6 | r6/mgmt-2、r7/mgmt-1、r8/mgmt-1、r9/mgmt-1、r9/mgmt-2、r10/mgmt-1、r11/mgmt-1、r11/mgmt-2（8 条中部分与大候选重叠见下表） |

真实原文摘要（供对照）：`D1=c51b0ff3b7423de…`、`D2=e885843f75e985e…`、`D3=53f3d7c3e3cfe23…`、`D4=d1766b764c369f2…`——**没有一条候选引用与之相符**。

这与 r10 的观测是同一机制：现行校验只要求 `digest` 非空（`src/core/intent-contract.ts` 的 `isSourceRef`），所以占位摘要会被记录成"有效引用"。

---

## 3. 模型复核结果

| case | 候选字符 | 引用数 | 可核验引用 | D1 | D2 | D6 | 规划了委托工作 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| runtime-r5/mgmt-1 | 14,190 | 33 | 0 | ok | ok | **violation** | true |
| runtime-r4/mgmt-2 | 9,018 | 20 | 0 | ok | ok | **violation** | true |
| runtime-r6/mgmt-1 | 5,561 | 5 | 0 | ok | ok | **violation** | false |
| runtime-r7/mgmt-2 | 2,115 | 2 | 0 | undetermined | **violation** | **violation** | false |
| runtime-r6/mgmt-2 | 1,627 | 0 | 0 | undetermined | **violation** | **violation** | false |
| runtime-r9/mgmt-2 | 1,053 | 0 | 0 | undetermined | **violation** | **violation** | false |
| runtime-r8/mgmt-1 | 507 | 0 | 0 | undetermined | **violation** | **violation** | false |
| runtime-r11/mgmt-1 | 477 | 0 | 0 | undetermined | **violation** | ok | false |
| runtime-r10/mgmt-1 | 473 | 0 | 0 | undetermined | **violation** | ok | false |
| runtime-r9/mgmt-1 | 447 | 0 | 0 | undetermined | **violation** | ok | false |
| runtime-r7/mgmt-1 | 439 | 0 | 0 | undetermined | **violation** | ok | false |
| runtime-r11/mgmt-2 | 101 | 0 | 0 | undetermined | **violation** | ok | false |
| runtime-r11/mgmt-3 | 50,009 | 167 | 0 | ok | **violation** | **violation** | true |
| runtime-r10/mgmt-2 | 31,799 | 107 | 0 | ok | **violation** | **violation** | true |

**统计**

- `plan_covers_delegation = true`：**5/14**；`false`：**9/14**（全部是 0.1–5.6 KB 的极小候选）。
- D2 violation：**11/14**；D6 violation：**9/14**；D1 只有 5 条可判，其余 9 条复核者判 `undetermined`（因为候选里没有可判角色关系的内容）。
- 机械层"14/14 accepted"与语义层"5/14 真的规划了工作"并存——这就是缺口本身。

**复核者的关键证据（节选）**

- 极小候选（9 条）：`D2 violation` —— "No implementation work or output artifact is planned."（引 `"Fix these issues so all existing test programs produce correct output matching their .expected files."`）
- 大候选（2 条）的共同形态：`D2 violation` —— 计划里有 push 与短路，但**漏了委托明确写出的语义**（`"push returns the new length of the array"`、`"result is the left value (falsy)"`）；`D6 violation` —— "adds a mandatory read-only analysis and file-inventory deliverable, plus a test-results report, which the delegation does not request."
- r5/mgmt-1：`D6 violation` —— "adds a required source-analysis step and a dependency requiring that analysis before implementation."
- r6/mgmt-1：`D6 violation` —— 追加 `./run_tests.sh` runner 并把源文件限制为 `.c/.h`，委托没有要求。

---

## 4. 关键发现

1. **"accepted" 目前只等价于"形状合法"**。14 条机械通过的候选里，9 条没有规划任何工作，11 条缺委托明确要求的输出/语义。机械门槛挡的是解析与形状，挡不住"没干活"。
2. **引用不可核验是普遍状态，不是个别事故**：8 条用占位摘要、6 条零引用，0 条可核验。占位摘要能被"非空即通过"的校验放过（r10 已证实）。
3. **大候选的失败形态是"漏 + 加"**：漏掉委托逐字写明的语义（D2），同时加入委托外的产物与分析步骤（D6）。两者都需要引用委托原文的 span 才能成立——而候选恰恰没有可核验引用。
4. **三态 verdict 可用**：复核者对 9 条信息不足的案例主动给 `undetermined` 而不是硬判，说明"信息不足"这一档在实践中真的会被用到。
5. **跨族复核能给出有委托依据的结论**：r10/mgmt-2 与 r11/mgmt-3 的 D2/D6 判定都带了委托原文引证。这与 r10 当时那条核对意见部分重合，但**依据不同**——当时核对给的理由是 schema 惯例（"多了一个交付物"、"task 还是 goal"），复核者给的是委托原文。同一批意见里混着站得住的与站不住的，差别正是"能不能指出委托原文的 span"。这支持 T11 的"D 维度 + 证据引用要求"，而不支持"核对整体无效"。
6. **fast 模式对 gpt-6-luna 不可用**（`priority` 未声明支持，请求里被省略）；模型本地元数据缺失时 Codex 会用 fallback 元数据——两条都记入运行手册，避免下次误以为开了 fast。

---

## 5. 对我们的直接含义（T01 / T07 / T10 / T11）

- **D5 引用可核验应当先做成机械门槛**：它是纯代码判定、零模型成本，而当前 14/14 全不通过。先有它，"核对为什么拒"才可能定位到具体 span（T09 §5.2 的结论在这批数据上被复现）。
- **`plan_covers_delegation` 值得作为独立维度**：它抓的正是"只读/空转候选"这类失败（9/14），比 D6 更直接对应"没完成用户目标"。
- **D3 现在不可判，因为请求里没有能力目录**：这是 T10 字段缺口的直接证据——要么把能力目录放进请求，要么明确 D3 由代码在派发前判定。
- **判据要带证据要求，而不是收紧措辞**：本批复核的 D2/D6 结论都能引到委托原文；与之对照，r10 当时的意见引的是惯例。两者的差别不在"严不严"，在"有没有 span"。
- **`undetermined` 是必要的第三态**，并且必须被统计（否则"动不动 skip"无法被审计）。

---

## 6. 局限与不确定

- **复核者不是真值**：跨族复核降低了同源偏差，但不等于正确；本次是**单一复核者、单次、无金标准、无重复**，结论强度按 T01 草案属"候选结构"。
- **材料是历史请求**（IR 全空），未覆盖 d3_w9 真实运行的候选与核对记录——那批需要单独一轮复核。
- **D1 的 9 条 `undetermined` 是信息不足而非合格**：不能读成"这 9 条 D1 通过"。
- 复核者**没有**我们的 contract 与能力目录；它按"委托原文是唯一真值"判，因此它给出的 D6 结论是"委托没要求"，不是"我们的 contract 不允许"。

---

## 7. 复现

工件（材料、提示词、schema、原始 JSONL、解析后 JSON、机械核验结果）：

```
results/evocodebench/intent-on/semantic-review-2026-09-24/
  prompt-A.txt  prompt-B.txt  schema.json
  out-A.jsonl   out-B.jsonl   out-A.json  out-B.json
  mechanical.json  reviews.json
```

调用形态（不涉及任何密钥；凭据由 Codex 登录态持有）：

```powershell
Get-Content -Raw <prompt>.txt | codex exec -C <tmp> --skip-git-repo-check -s read-only --json `
  --output-schema schema.json `
  -c 'model_provider="openai"' -c 'forced_login_method="chatgpt"' `
  -c 'model_reasoning_effort="max"' -c 'service_tier="fast"' `
  -m gpt-6-luna -
```

`reviews.json` 里保留了每条的 `evidence`（≤20 词委托引文）与 `note`，可逐条复核本记录的判断。
