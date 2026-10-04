> **历史/专题材料，非现行指令。** 保留当时的观察、方案或取舍；实现与状态须从 [模块地图](README.md) 核对，不执行本文旧“下一步”。原 CURRENT-DESIGN 节号均指历史设计。

# 事件短标识（IR 接口）——草案 v2（2026-09-30）

状态：**已按 v2 收敛实现并提交（`84bee36`，评审修复见 `ebdf389`，2026-09-30）**。三处拍板按用户决定执行：
decode 只认本次展示的别名；不新增 snapshot 水位（journal 不可信时整批停止，`storage_unverified`）；
保留 `carried_delegations[].sequence`。CI 路径与核对输入保持完整身份。
评审后补：`ir_changes[].value.ref` 一并转换；journal 结构性坏行也计入不可信；run 内存在形如
`e\d+` 的事件 id 时该 run 不铸造别名（回退全 id，记录 `source_aliases_disabled`）；decode 以
"存储 id 优先"判定；别名拒绝保留最新坏稿作为修复起点；示例不再使用活别名。

**目标（准确表述）**：减少**事件 ID 的复制错误**。wire 上仍需模型复制 digest——
那是另一个接口问题（见 §7），本版不处理，也不用它衡量成败。

**v1 → v2 的关键变化**：别名不再按"本次请求的 offered 顺序"重新编号，改用
**run 内稳定的事件 sequence**（`e{sequence}`）。v1 的编号方式会让"上次 `e2`=事件 A、本次 `e2`=事件 B、
旧稿复制后被静默解释成 B"成立；稳定别名下这种错指不可能发生。稳定性核对见 REVIEW-20260930 §10。

## 1. 别名域与稳定性

- 别名 = `e` + 事件在该 run `events.jsonl` 里的 `sequence`。同一个 run 内唯一、不可变；
  与 `resolvableSources = store.readEvents().map(row => row.event)`（`intent-compiler-v2.ts:219`）
  一一对应。别名**不需要连续**，每次请求只展示本次可用来源。
- 唯一已知缺口：journal 出现无法解析的行时，`nextSequence()` 的 max 会忽略该行，理论上可复用编号。
  处理方式见 §9 决定点 2。
- 模型输入不重复事件身份的另一半：**完整 `event_id` 不再出现在 IR 请求里**（除 §4 列出的
  原样保留位置）。alias → 完整 id 的映射只进调用记录（§5）。

## 2. 模型输入里使用短标识的位置（IR 阶段全部字段）

一个请求里同一事件只有一种写法。以下字段用别名替换事件身份，其余内容不变：

| 位置 | 现状 | 改造后 |
| --- | --- | --- |
| `events[].event_id` | 完整事件 id + 正文 | 别名 + 同样的正文 |
| `source_segments[].source_id` | 完整事件 id | 别名（`segment_id`、`span`、`text` 不变） |
| `event_source_refs[].source_id` | 完整事件 id | 别名（`digest` 不变，仍由模型复制——§7） |
| `carried_delegations[].event_id` | 完整事件 id | 别名（其 `sequence` 字段变成冗余，见 §9 决定点 3） |
| `gap_event_ids[]` | 完整事件 id | 别名 |
| `ir`（当前 IR 正文，`content[].sources[].source_id`） | 完整事件 id + span + digest | 别名 + 同样的 span/digest |
| `generation_repair.ir_proposal`（结构化旧稿） | 完整事件 id | 别名（`basis.event_ids`、`ir_changes[].sources`、`source_coverage[].source/.basis`） |
| `generation_repair.ci_proposal`（CI 旧稿，结构化） | 完整事件 id | **若出现**则按别名转换（它是 IR 请求的一部分）。已记录 155 次 IR 请求中该字段从未出现——`invalidate` 在回到 IR 阶段前会清掉它 |
| `contract.example_candidate`（IR 阶段示例） | 示例里写死 `input-event-id` | 示例也表达为别名（用本次请求的首个别名作占位）。否则模型会从示例中复制一个 journal 里不存在的事件 id，直接触发来源门 |

`ir` 正文一并转换的理由：合同要求模型"复制已提供的 span/segment 选择器"来表示未改动内容，
而它复制的对象正是 `content[].sources[]`；若这里仍是完整 id，模型就会同时看到两种身份写法。

## 3. 恢复完整身份的位置与规则

```
stageInput("ir")            ← express：本节 §2 的字段按本次别名表改写
  → 模型回答
  → decode（纯函数，字段类型驱动）
  → state.ir_proposal = clone(decoded)        ← 完整身份，与今天一致
  → prepare(decoded)：validateBasis → 来源门 → apply ir_changes →
    materializeSourceContent → validateSourceCoverage
```

- decode 只走**已知的、确实表示事件身份的字段**：`basis.event_ids[]` 与各类 `SourceRef.source_id`
  （`source_coverage[].source`、`source_coverage[].basis[]`、`ir_changes[].sources[]`）。
  不做字符串替换；`text`、`reason`、`explanation`、`questions[].affects`（对象/局部 id，不是事件身份）
  一律不动。
- 接受的两种写法：本请求展示过的别名（`e{k}`，精确匹配）；以及 run journal 中存在的完整事件 id
  （原样通过，保持现存校验语义——旧稿、`schema_rejected_draft.text`、historical 反馈里的完整 id 仍可用）。
- 其他一律不猜：未知别名、未展示过的别名、拼接/截断的 id 都落到现有两道校验，
  返回带明细的错误（`basis references unknown event …` / 来源门的 `(alias) (selector): reason`）。
- 别名与完整 id 的对应关系由 journal 决定，不由请求顺序决定；因此 decode 的结果不随请求构成变化。
- 上面"未展示别名一律拒绝"是推荐规则；是否照此收紧见 §9 决定点 1。

## 4. 原样保留、不做身份改写的位置

| 位置 | 处理 | 原因 |
| --- | --- | --- |
| `schema_rejected_draft.text` | 原样（原始 JSON 文本） | 改写未解析的回答就是模糊替换；别名 run 内稳定，其中若含别名仍然有效，含完整 id 也仍然可解析（已记录 155 次 IR 请求中 0 次携带该字段，路径仍存在） |
| `previous_rejection.message`（上一批失败信息） | 原样（历史文本） | 它是"上一批说了什么"的证据；其中别名因稳定而仍然有效 |
| `check` 输入（核对器） | 完整 id | 独立核对不在本次范围 |
| `repair_context` | 不存在于严格流程的 IR 请求 | `stageInput` 已把它剔除，严格流程用 `generation_repair` |

## 5. 反馈里的身份呈现

批内生成的反馈消息必须与请求同一套写法，否则模型会被要求修改一个它没见过的 id。
代码里嵌入事件 id 的消息有四处，全部改为经同一个 `displayEventId()` 渲染（本次展示过的事件 → 别名；
其余 → 完整 id）：

1. `candidate basis references unknown event <id>`（`validateCandidateBasis`）；
2. `pending event ids for this batch: <ids>`（`candidateIssues`）；
3. `carried delegation <id> is missing from basis.event_ids`（`candidateIssues`）；
4. `IR sources do not resolve; … <source_id> (<selector>): <reason>`（`5b007f8` 新加，
   `ParentGeneration.unresolvedSources`）。

实现上是把显示函数作为可选参数传进消息构造处，默认恒等函数（legacy 调用不变），不做字符串替换。

另有两条嵌入事件 id 的消息只存在于 legacy / derived 路径（`candidate sources must cite a
resolvable user text span or event; …`、`an execution assessment must name this batch's events …`），
严格两级流程不经过它们，本次不动。

## 6. 调用记录（映射不在模型输入里）

- 每次 propose 尝试的记录里，与 `request` 并排新增
  `source_aliases: [{ alias: "e12", event_id: "<完整 id>", digest: "sha256:…" }]`。
  它**不发给模型**，只回答"这次请求里 `e12` 是哪个事件"。
- 该映射本来就可由 `events.jsonl` 推导（别名 = sequence）；落一条记录是为了审计不依赖重建，
  也让 journal 疑似损坏时能看出当时代码看到的是哪一份映射。
- 批量级 `management_log[].request`（`modelInput`）保持完整身份，别名表只出现在尝试级记录。

## 7. 本次不做（避免范围蔓延）

- **digest 复制负担**：wire 仍要求模型为每个 `SourceRef` 写 `digest`（schema 需要它、
  `resolveSourceRefs` 用它识别引用形状，随后仍由代码覆盖）。这是独立接口问题，单列后续。
- **CI 的引用转换**：CI 请求/响应、`atom.goal_refs`、执行决定、assessments、checks 全部保持完整 id；
  存储、CI、独立核对、回传评估继续接收今天的形状。
- **段内选择**：`span`/`quote` 保持现能力；不新增相对范围。段内 partial 调查到此停
  （结论见 REVIEW-20260930 §9，`s40` 的"意图区间"已标注为推断）。
- **来源可用范围**：`event_source_refs`（全部可用来源）与 `source_segments`（被引用的历史来源 +
  未编译委托 + 本批）的覆盖差异保持现状；别名表只覆盖"请求实际展示的事件身份"，
  原有来源校验继续执行。是否进一步收窄另行判断。
- **合同与示例的过期措辞**：`V2_COMPILER_CONTRACT.source_contract` 里的
  "A valid SourceRef.source_id is an event id in events or source_events" 必须随本改造修正
  （IR 阶段已不发 `source_events`）。该句是两阶段共用的，而 `generationContract()`
  目前只按阶段覆盖 `candidate_shape`/`example_candidate`（`generation-schema.ts:97-109`），
  所以要么给 `source_contract` 加一个按阶段的覆盖，要么把句子写成同时覆盖两种形态。
  `example_candidate` 与 `event_source_refs` 的说明句（"code-computed digests … copy those values"）
  在 IR 阶段保持成立，只是 id 变成别名。

## 8. 实现时的验证清单（离线）

- 请求形状：IR 请求的 §2 全部字段不含完整事件 id；同一事件在请求里只有一种写法。
- decode 顺序：别名在 `validateBasis`、来源门、`materializeSourceContent`、`validateSourceCoverage`
  之前恢复；`parent_basis`、落库 IR/CI、核对输入全部是完整 id。
- 旧稿：同批重试时结构化稿按本次请求重新表达；`schema_rejected_draft.text` 逐字不变；
  含完整 id 的引用仍能解析；引用未展示事件的完整 id 行为与今天一致。
- 拒绝路径：未展示/未知别名在 basis 路径与来源门路径各有一条带明细的用例。
- 反馈：上述四类消息渲染别名。
- 稳定性：同一 run 内两次不同请求（含顺序变化）中，同一事件的别名相同。

## 9. 需要拍板的决定点

1. **decode 是否限制在"本次展示过的别名"**（推荐：是）。这样模型凭空写 `e37` 不会恰好命中
   journal 里的第 37 个事件。行为差异仅在"旧稿引用本次未展示的事件"：
   完整 id 形式照旧可解析；别名形式要求该事件在本次请求里出现过（否则带明细拒绝）。
   若要保持与今天完全一致，可放开为"run 内任意别名都可 decode"——但那就少了一层防误指。
2. **是否为 journal 损坏补一道水位**（推荐：做）。`acceptEvent` 把已分配的最大 sequence 写进
   snapshot，`nextSequence = max(文件 max, 水位) + 1`。一个小字段换掉别名方案唯一的静默错指路径；
   不做的话需要在文档里明确接受"journal 损坏后可复用编号"。
3. **`carried_delegations[].sequence` 是否保留**（推荐：保留）。别名已含序号，字段冗余但无行为影响；
   删除属于无关改动。
