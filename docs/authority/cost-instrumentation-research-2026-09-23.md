> **历史/专题材料，非现行指令。** 保留当时的观察、方案或取舍；实现与状态须从 [模块地图](../../development/README.md) 核对，不执行本文旧“下一步”。原 CURRENT-DESIGN 节号均指历史设计。

# 成本归因的最小计量集合（T10 研究结果，2026-09-23）

本文件是 wayfinder 研究票 **T10**（`project/development/wayfinder-cost-structure/issues/T10-cost-instrumentation-minimum.md`）的产出。目标是把"时间到底花在哪"从推理变成测量，且**字段名沿用行业规范，不自创命名**。

**写入范围声明：**唯一写入的文件是本文件；仓库其余部分只读。没有改源码/测试/配置/官方任务数据，没有跑 `npm run build`/`npm test`，没有调用模型或 benchmark。仓库内事实均来自只读读取。

**术语口径：**本文件只用 `CONTEXT.md` 的四个词——机械门槛（Gate，代码可判定的拒绝条件）、独立核对（Check，一次独立的模型调用，只给通过/不通过与理由）、验收（Acceptance，管理层依据回传与证据的提交判断）、评测（Evaluation，外部计分与我们的审计维度，只衡量、不放行）。

---

## 0. 我们的现状（只读核对，逐条给文件与字段）

| 现有记录 | 位置 | 实际字段 | 缺什么 |
| --- | --- | --- | --- |
| 批次记录 | `src/core/compiler-store-v2.ts` → `ManagementRequestRecord`；落库在 `snapshot.management_log[]` | `request_id`、`sequence`、`trigger_event_ids`、`started_at`、`completed_at`、`duration_ms`、`request`、`request_digest`、`raw_response`、`candidate`、`provider`、`model`、`usage{input,output,reasoning,cache_read,cache_write,cost}`、`status`（`accepted`/`transport_failed`/`json_failed`/`schema_failed`/`validation_failed`）、`error_code`、`retry`、`ir_revisions`、`compiled_revisions` | 形状参数（本批几个事件/几个组/几个原子/是否因拒绝再推进）；本批内各调用的切分 |
| 调用记录 | 同文件 → `ManagementCallRecord`；`src/core/intent-compiler-v2.ts` 的 `recordManagementCall()` | `call_id`、`request_id`、`kind: "propose" \| "check"`、`started_at`、`completed_at`、`duration_ms`、`status`、`error_code`、`usage{…}` | **没有首包时间**；没有"是否携带上一批拒绝理由"；`src/runtime/audit-report.ts` 尚未把它暴露到报告（T02 的未竟部分） |
| 核对记录 | `SemanticCheckRecord`（`semantic_checks[]`） | `basis_event_ids`、`sequence`、`verdict`、`findings[]`（`claim`/`expected`/`observed`/`refs`）、`task_ids`、`provider`、`model`、`response_digest`、`usage` | **没有时长**（T02 原始缺口）；没有"判了哪些维度" |
| 传输层 | `src/model/structured-provider-transport.ts` | 已走 SSE：`stream: true` + `stream_options: { include_usage: true }`；把 `prompt_tokens`→`input_tokens`、`completion_tokens`→`output_tokens`、`completion_tokens_details.reasoning_tokens`→`reasoning_tokens`、`prompt_tokens_details.cached_tokens`→`cache_read_tokens`；返回 `streamed: true` | **首包/尾包时间被丢弃**；`cache_write` 未映射；没有重发序号 |
| run 预算 | `snapshot.budget` | `management_requests`、`total_management_requests`、`management_input_tokens`、`management_output_tokens`、`management_reasoning_tokens`、`management_cache_read_tokens`、`management_cache_write_tokens`（`unavailable`）、`management_cost`（`unavailable`）、四个上限 | 与"被拒绝的尝试"的归属关系（当前按批累加，不区分成功/失败调用的成本去向） |

r10 实测（用于后面每条字段的"值不值"判断）：一条用户消息 → **4 次调用**（2 批 × [propose, check]），批次时长 **537.911s + 662.293s = 1200.2s**（占 agent 执行 1216.4s 的 **98.7%**）；输出 **72,421** tokens，其中 reasoning **61,004**（**84.2%**）；propose 合计 30,161（41.6%）、check 合计 42,260（**58.4%**）；输入 17,437、`cache_read` 3,584；**0 派发**。批次输出速率：mgmt-1 = 33,809/537.9 = **62.9 tok/s**，mgmt-2 = 38,612/662.3 = **58.3 tok/s**（同 run 的 propose+check 合计口径）；对照 r4 = 12,588/260.1 = **48.4 tok/s**、r5 = 12,168/257.7 = **47.2 tok/s**。

---

## 1. 结论

> 本节与第 2 节引用的全部一手来源，其精确 URL 汇总在文末 **附录：来源链接**。

1. **"最小可归因"的最小集合是 6 个字段族，全部有行业规范名**：调用身份与类型（`gen_ai.operation.name`）、两端时间与首包（`gen_ai.client.operation.duration`、`gen_ai.client.operation.time_to_first_chunk` 或 span 属性 `gen_ai.response.time_to_first_chunk`）、用量三分（`gen_ai.usage.input_tokens` / `output_tokens` / `reasoning.output_tokens`）、缓存两类（`gen_ai.usage.cache_read.input_tokens` / `cache_write.input_tokens`）、错误与重试（`error.type`、`http.request.resend_count`）、提供商与模型（`gen_ai.provider.name`、`gen_ai.request.model`、`gen_ai.response.model`）。
2. **我们离"最小集合"只差两件事**：①首包时间——传输层已经在读 SSE，首包时刻是**现成的**，现在被丢掉；②调用级切分进报告——`management_calls` 已经写了，缺的是 `audit-report` 的暴露与断言（T02 未竟）。
3. **token 的三个"子集"关系必须先写清楚，否则成本会算错**：OTel 明确 `cache_read/cache_write` **包含在** `input_tokens` 内，`reasoning` **包含在** `output_tokens` 内；把四者相加会重复计数（r10 若把 61,004 当"额外"加上，会高估 **84%**）。
4. **队列等待与 prefill/decode 只有在自托管侧才有规范字段**（`gen_ai.server.time_to_first_token`、`vllm:request_queue_time_seconds` / `prefill` / `decode`）。托管 API（我们的 dashscope 路径）**不暴露**这些；能测的是客户端侧的 `time_to_first_chunk`（含排队+prefill+网络），因此"排队 vs 生成"的区分必须标注为**不可分辨**，不能靠推理补上。
5. **"被拒绝的尝试"必须独立成条目并独立计量，而不是折进下一批**：SRE 用客户端级重试预算（10%）与每请求上限（3 次）把放大从 3X 压到 1.1x；gRPC 用 `retryThrottling`；Envoy 用 `retry_budget`；OTel 用 `http.request.resend_count` 给每次重发编号。**结论：重试是"量"，不是"噪声"**；它必须有编号、有归属、有计数。
6. **关键路径计算需要"调用级父子关系 + 时间戳"**：在我们这里，批次是根、事件是触发、调用是子；Jaeger 的 LFC 算法只有在时间戳正确时才有意义（T09 文档 §6 已给 adopt-from）。
7. **反面清单里最危险的一条是"用批次时长当调用时长"**：它把传输重试、排队、核对与提议混成一个数；r10 的"提案 30.2k / 核对 42.3k"就是从 usage 反推的，**不是测出来的**。

---

## 2. 字段清单（精确字符串 → 来源 → 解锁哪个判断 → 采集成本）

### 2.1 OpenTelemetry GenAI：调用级 span 属性

来源：`open-telemetry/semantic-conventions-genai`（Apache-2.0，主分支 2026-09；该仓库从 `semantic-conventions` 迁出，页内引用核心 semconv **v1.44.0**）。全部为 **Development** 稳定性——这一点很重要：**名字本身仍在演进**（历史上 `gen_ai.usage.prompt_tokens`/`completion_tokens` 已让位于 `input_tokens`/`output_tokens`），所以我们要么跟随名字、要么在适配层做映射，不能自创第三套。

| 精确字段名 | 来源（文件/文档） | 类型/单位 | 它解锁哪个具体判断 | 采集成本 |
| --- | --- | --- | --- | --- |
| `gen_ai.operation.name` | `docs/registry/attributes/gen-ai.md`；取值示例 `chat`; `generate_content`; `text_completion` | string | 区分"提议"与"核对"（我们映射为 `propose`/`check` 两个自定义 operation 名，或保留 `chat` + 自定义子属性） | 极低（常量） |
| `gen_ai.provider.name` | 同上；示例 `openai`; `gcp.gen_ai` | string | 归因"provider 侧变化"与"我们侧变化"（用户排除 provider 吞吐，但记录不能缺） | 极低 |
| `gen_ai.request.model` / `gen_ai.response.model` | 同上 | string | 证明"跑的是哪个模型"（配置值 ≠ 实际返回；design doc 已要求分别保存） | 极低（响应里现成） |
| `gen_ai.usage.input_tokens` | 同上；注 **[41] "This value SHOULD include all types of input tokens, including cached tokens."** | int | 输入侧成本与缓存收益的分母 | 低（usage 里现成） |
| `gen_ai.usage.output_tokens` | 同上；注 **[42]** 要求"提供 billed 与 consumed 两种计数时，报 billed" | int | 生成量标度（T09 §7 问题 1） | 低（现成） |
| `gen_ai.usage.reasoning.output_tokens` | 同上；注 **[43] "The value SHOULD be included in `gen_ai.usage.output_tokens`."** | int | 把 reasoning 从"输出"里拆出来——r10 中它占 84.2% | 低（`completion_tokens_details.reasoning_tokens` 现成） |
| `gen_ai.usage.cache_read.input_tokens` | 同上；注 **[36] "The value SHOULD be included in `gen_ai.usage.input_tokens`."** | int | 缓存命中（重启/重放时成本是否下降） | 低（`prompt_tokens_details.cached_tokens` 已映射） |
| `gen_ai.usage.cache_write.input_tokens` | 同上；注 **[37] 同样计入 input** | int | 缓存代价（Anthropic：5 分钟写入比基线贵 25%，1 小时写入 2×） | 中（dashscope 当前未返回；需标记 `unavailable`） |
| `gen_ai.response.time_to_first_chunk` | `docs/registry/attributes/gen-ai.md`："Time to first chunk in a streaming response, measured from request issuance, in seconds."（示例 `0.5`; `1.2`） | double, `s` | 把"等待开始产出"与"产出速度"分开 | **低但需改代码**：SSE 首包到达时打时间戳 |
| `gen_ai.request.stream` | 同上（请求属性） | boolean | 判定"这条记录是否可比"（流式 vs 非流式阈值不同） | 极低 |
| `gen_ai.response.finish_reasons` | 同上 | string[] | 区分"正常结束"与"被截断/超长"（截断会伪装成失败） | 低 |
| `error.type` | 核心 semconv `docs/registry/attributes/error.md`（**Stable**）；示例 `timeout`; `500` | string | 把失败分类（传输 / schema / 语义），替代我们自造的枚举 | 低 |
| `http.request.resend_count` | 核心 semconv `docs/http/http-spans.md`（**Stable**，Recommended "if and only if request was retried"）；"The ordinal number of request resending attempt (for any reason, including redirects)." | int | 给每次重发编号 → 重试放大可数 | 低（传输层已有重发点） |

### 2.2 OpenTelemetry GenAI：指标（时间与量）

| 精确字段名 | 类型/单位 | 关键定义（原文） | 解锁的判断 | 采集成本 |
| --- | --- | --- | --- | --- |
| `gen_ai.client.operation.duration` | Histogram, `s`（建议桶 `[0.01 … 81.92]`） | "GenAI operation duration."；属性含 `gen_ai.operation.name`(Required)、`error.type`、`gen_ai.provider.name`、`gen_ai.request.model` | 每次调用的时长分布（不只是总量） | 低：包一层计时器 |
| `gen_ai.client.operation.time_to_first_chunk` | Histogram, `s` | "Time to receive the first chunk… **SHOULD be reported for streaming calls and SHOULD NOT be reported otherwise**." | 首包延迟的分布 | 低（与上一行同一处打点） |
| `gen_ai.client.operation.time_per_output_chunk` | Histogram, `s` | 每输出块时间 | 生成速率（我们目前只有"总量÷总时长"的粗略值） | 低 |
| `gen_ai.server.request.duration` / `gen_ai.server.time_to_first_token` / `gen_ai.server.time_per_output_token` | Histogram, `s` | `time_to_first_token` 的说明："It helps measure **the time spent in the queue and the prefill phase**." | 只适用于**自托管**侧；托管 API 拿不到 | 高（需要服务端） |

### 2.3 token 计数器（新规范，按 modality 分解）

来源：`docs/gen-ai/gen-ai-token-metrics.md`（同一仓库）。**Usage 族**（Counter, `{token}`，属性含 `gen_ai.token.modality`）：

| 精确字段名 | 关键定义 |
| --- | --- |
| `gen_ai.client.inference.usage.input_tokens` | "The number of input (prompt) tokens used, including cached tokens."；"When systems report both used tokens and billable tokens, instrumentation MUST report billable tokens." |
| `gen_ai.client.inference.usage.output_tokens` | 输出 token 计数 |
| `gen_ai.client.inference.usage.cache_read.input_tokens` | "…served from a provider-managed cache."（**是 input 的子集**） |
| `gen_ai.client.inference.usage.cache_write.input_tokens` | 写入缓存的输入 token |
| `gen_ai.client.inference.usage.reasoning.output_tokens` | "…used for reasoning (e.g. chain-of-thought, extended thinking)."（**是 output 的子集**） |
| `gen_ai.client.inference.operation.input_tokens` / `…output_tokens` | 直方图（分布）。规范明确："They should not be used for total usage or cost calculations." |

**用途**：Counter 族用于"总量与速率"，Histogram 族用于"分位数与离群"。我们现在两样都没有。

### 2.4 其它实现/平台的字段（同类信息的不同命名）

| 平台/规范 | 精确字段 | 出处 | 对我们的价值 |
| --- | --- | --- | --- |
| OpenLLMetry（Apache-2.0） | span 上写 `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` / `gen_ai.usage.cache_read_input_tokens`；来源字段是 provider 的 `prompt_tokens` / `completion_tokens` / `prompt_tokens_details.cached_tokens`；另有 `SpanAttributes.GEN_AI_IS_STREAMING` | `packages/opentelemetry-instrumentation-openai/opentelemetry/instrumentation/openai/shared/__init__.py` | **这就是我们 transport 的映射方式**，可以作为"我们写得对不对"的对照 |
| OpenInference（Apache-2.0） | `llm.token_count.prompt` / `llm.token_count.completion` / `llm.token_count.total` / `llm.token_count.prompt_details.cache_read` / `llm.token_count.prompt_details.cache_write` / `llm.token_count.completion_details.reasoning`；成本：`llm.cost.prompt` / `llm.cost.completion` / `llm.cost.total` / `llm.cost.completion_details.reasoning` / `llm.cost.prompt_details.cache_read` / `llm.cost.prompt_details.cache_write` | `spec/semantic_conventions.md` | **唯一把"成本"也标准化的规范**：把 reasoning 与 cache 的成本单列，正是我们 D8 报告需要的形状 |
| Langfuse（MIT Expat，`ee/` 除外） | 观测字段 `completionStartTime`（"The completion start time of the observation"）、`usageDetails`（"Key is the name of the usage metric, value is the number of units consumed. The `total` key is the sum of all (non-total) usage metrics"）、`costDetails`（同理，单位 USD）、`metrics.timeToFirstToken` | `web/public/generated/api/openapi.yml`；文档示例用 `usage_details = {"input":…, "output":…, "cache_read_input_tokens":…}` | **"首 token 时刻 + 用量明细 + 成本明细"三件套**的现成数据模型；`total` 的"派生而非相加"约定能防重复计数 |
| LangSmith（MIT） | `usage_metadata.input_tokens` / `output_tokens` / `total_tokens`、`input_token_details.cache_read` / `cache_creation`、`output_token_details.reasoning`、`input_cost` / `output_cost` / `total_cost`；TTFT 通过 `new_token` 事件自动填充 | `docs.langchain.com/langsmith/log-llm-trace` | 与我们 transport 的字段一一对应；且明确"成本可直接上报（非线性定价）" |
| vLLM（Apache-2.0） | `vllm:time_to_first_token_seconds`、`vllm:request_queue_time_seconds`（"Queue time."）、`vllm:request_prefill_time_seconds`、`vllm:request_decode_time_seconds`、`vllm:request_time_per_output_token_seconds`（TPOT）、`vllm:e2e_request_latency_seconds` | `docs/design/metrics.html` | **队列/prefill/decode 的规范分解**；托管 API 无此信息时的对照目标 |

### 2.5 重试与返工

| 机制 | 精确字段/配置 | 出处 | 解锁的判断 |
| --- | --- | --- | --- |
| 每请求重试上限 | 3 次（SRE 约定） | SRE Book *Handling Overload*（2017） | 单次失败的放大上界 |
| 客户端重试预算 | retry 比例 < **10%**；效果 3X → **1.1x** | 同上 | 重试风暴的门槛量 |
| gRPC 重试节流 | `retryThrottling`：`maxTokens`(0,1000]、`tokenRatio`>0；成功 +`tokenRatio`、失败 −1；`token_count ≤ maxTokens/2` 时不再重试 | gRFC A6 | "失败率超过阈值就抑制"的控制回路 |
| Envoy 重试预算 | `retry_budget.budget_percent`、`min_retry_concurrency`；计数器 `upstream_rq_retry_overflow` | Envoy docs（集群熔断） | 被抑制的重试也要计入观测 |
| 幂等键 | `Idempotency-Key` 请求头；"the client does not know if it can safely retry the request"（正文 §Retry） | IETF `draft-ietf-httpapi-idempotency-key-header-07` | 判定"这次重发是否安全" |
| 重复调用合并 | single-flight："duplicate function call suppression" | `golang/sync`（BSD-3） | 合并相同请求、避免重复计费 |
| 重发编号 | `http.request.resend_count`（Stable） | OTel HTTP semconv | 每次尝试的序号（可算放大倍数） |

### 2.6 缓存（成本的真分母）

- OpenAI Prompt Caching："Pay the model's reduced cached-input rate for reused tokens, **discounted up to 90%**."
- Anthropic Prompt Caching：默认 **5 分钟** TTL；"5-minute cache writes cost **25% more** than base input tokens, 1-hour cache writes cost **2x** base input tokens, and cache hits cost a fraction of the base input token price"。
- 规范侧对应字段：`gen_ai.usage.cache_read.input_tokens` / `gen_ai.usage.cache_write.input_tokens`（span）、`gen_ai.client.inference.usage.cache_read|cache_write.input_tokens`（counter）。

---

## 3. 最小集合与取舍理由

**最小可归因集合（建议冻结为 P0，一次调用一行）**

| # | 字段（规范名） | 为什么不能省 |
| --- | --- | --- |
| 1 | `gen_ai.operation.name`（本项目的取值：`propose` / `check` / 将来的 `revise`） | 没有它，propose 与 check 无法分开；r10 的 58.4% 核对占比就无法验证 |
| 2 | `call_id` + `request_id` + `sequence`（我们已有） | 同一批内多次调用与重发要用编号区分 |
| 3 | `start_time` / `end_time`（→ `gen_ai.client.operation.duration`） | 时长必须由调用自己的两端算出，不能用批次时长 |
| 4 | `first_chunk_time`（→ `gen_ai.client.operation.time_to_first_chunk` / `gen_ai.response.time_to_first_chunk`） | 唯一能把"排队+prefill+网络"与"decode"分开的客户端侧量 |
| 5 | `gen_ai.usage.input_tokens` / `output_tokens` | 生成量标度 |
| 6 | `gen_ai.usage.reasoning.output_tokens` | 84.2% 是 reasoning；不分列会把"思考"与"正文"混成一个量 |
| 7 | `gen_ai.usage.cache_read.input_tokens` | 决定"重放/重试是否更便宜"；r10 已有 3,584 |
| 8 | `error.type`（+ 我们的 `status`） | 失败分类（传输 vs schema vs 语义），也是"被拒绝的尝试"的载体 |
| 9 | `http.request.resend_count`（或等价的 attempt ordinal） | 重试放大可数；SRE/gRPC/Envoy 都要求把抑制/溢出也记下来 |
| 10 | `gen_ai.provider.name` / `gen_ai.request.model` / `gen_ai.response.model` | 配置 ≠ 实际返回；不许用配置推断行为 |

**第一批可以延后的（P1）**：`cache_write`（dashscope 未返回，先记 `unavailable`）、`gen_ai.client.operation.time_per_output_chunk`（我们已能算总量/总时长，先做分布）、成本（`management_cost` 仍 `unavailable`；OpenInference 的 `llm.cost.*` 是目标形状）、`gen_ai.server.*`（只在自托管时才有）。

**取舍理由（三条）**

1. **能回答具体判断才留**：上表每行都对应"某个我们已经在争论的判断"（谁贵、贵在排队还是生成、重试放大多少、缓存是否生效）。不满足这条的一律不进 P0。
2. **默认采集优先**：`usage.*`、`provider/model`、`finish_reasons` 都在 provider 响应里，属于"顺手就有"；只有 `first_chunk_time` 与 `resend_count` 需要改代码，所以它们必须**先做**（收益最大、成本最低）。
3. **不做"自创命名"**：批次的形状参数（事件数/组数/原子数）用我们自己的域内名字，但**时间与用量的名字一律用规范名**，避免两套词汇。

---

## 4. 对我们现有记录的映射（逐项：加什么、加在哪一层）

**三层结构**（与 T09 §5.1 一致）：**批次（root）→ 事件（trigger）→ 调用（child）**。

| 记录 | 层 | 现在 | 应加（字段名建议） | 谁写 | 解锁 |
| --- | --- | --- | --- | --- | --- |
| `management_log[]` | 批次 | `duration_ms`、`usage`、`status`、`retry` | 形状参数：`shape{event_count, group_count, atom_count, rejection_reason_present}`；`calls[]` 的引用（`call_id` 列表） | `intent-compiler-v2.ts`（提交时） | 批次成本的形状归属（T09 §5.1） |
| `management_calls[]` | 调用 | `kind`、两端时间、`duration_ms`、`status`、`usage` | `first_chunk_at`、`attempt`（= `http.request.resend_count`）、`streamed`、`finish_reasons`、`error_type`；`carried_findings`（本次调用是否携带上一批拒绝理由） | `structured-provider-transport.ts`（打时间戳）+ `recordManagementCall()` | 排队 vs 生成；重试放大；"重掷 vs 修订"机制可测 |
| `semantic_checks[]` | 调用（属于 check 类） | 结论、findings、usage | `started_at`/`completed_at`/`duration_ms`、`dimensions[]`（判了哪些维度，见 T11）、`evidence_spans[]` | `runSemanticCheck()` | 核对成本、误报定位、维度覆盖率 |
| `dispatches[]` | 事件/原子 | 内容身份、`compiled_intent_id` | 触发它的批次/事件编号（对齐键） | store 提交路径 | 管理成本与执行成本的分界（T03） |
| `executions[]` / `allowed_calls[]` | 执行 | 会话绑定、允许调用 | 执行侧墙钟（首/尾）与工具调用耗时（如宿主能给） | Adapter/runtime | 执行层桶（T03 的"执行 ≈14s"目前来自 job log） |
| `budget` | run | 请求数、三类 token、cache_read | `management_cache_write_tokens` 已有位；补 `management_retry_requests`（被拒绝/重发的次数）与按 `kind` 的分解 | store | "被拒绝的尝试"正确计入成本 |
| `audit-report.json` | 报告 | `cost.per_request[]{request_id,status,duration_ms,retry}`、`checks.independent[]{sequence,verdict,findings,task_ids}` | `cost.per_call[]{call_id,kind,duration_ms,first_chunk_ms,usage,attempt}`；`checks.independent[]` 增 `duration_ms`；`cost.by_kind{propose,check}`；`failures[]` 增 `error_type` | `src/runtime/audit-report.ts` + `src/cli/audit-report.ts`（T02 的 ①） | 一次查看即得"propose vs check"的实测切分 |

**归属规则（避免双记）**

1. **一次调用一行**：`management_calls` 是成本的事实来源；`management_log` 只是批次汇总（它的 `duration_ms` 已经是批次墙钟，不得再当调用时长）。
2. **子集不叠加**：`input_tokens` 已含 cache_read/cache_write；`output_tokens` 已含 reasoning。汇总时只加顶层两列，子集只用于**比例**与**成本**。
3. **失败尝试独立成行**：被拒绝/传输失败的调用保留自己的 `call_id`、`error.type`、`attempt`，并计入 `budget`；不得折进下一次调用的用量。
4. **`unavailable` 是合法值**：provider 不给的字段写 `unavailable`（现有 `budget` 已是这个约定），不许用 0 或推断值填充（0 会被当成"确实没花"）。

### 4.1 span 树上的关键路径：怎么算，以及它对我们三层结构的含义

**算法（Jaeger 的 LFC 递归，Apache-2.0）**："The algorithm begins with the top-level span and iterates through the last finishing children (LFCs). It recursively computes the critical path for each LFC span. Upon return from recursion, the algorithm walks backward and picks another child that finished just before the LFC's start."（`criticalpath.go` 注释；同一文件把结果表达为 `Section{span_id, section_start, section_end}`）

**映射到我们**：

| OTel 概念 | 我们的对应物 | 现在能不能算 | 必须补什么 |
| --- | --- | --- | --- |
| root span | 一次 `advance` 批次（`management_log[].duration_ms` 的两端） | 能（有 `started_at`/`completed_at`） | 批次的形状参数（§4 表） |
| child span | 一次管理调用（`management_calls[]`：propose / check / 将来的 revise） | **部分能**：有 `started_at`/`completed_at`/`duration_ms`，但未暴露到报告 | 把 `management_calls` 并进 `audit-report.cost`（T02 的 ①），补 `attempt` 与 `first_chunk_at` |
| span 内区间（work vs wait） | 一次调用内的"等首包"与"收流" | **不能**：现在只有两端时间 | `gen_ai.client.operation.time_to_first_chunk`（首包时刻） |
| 子 span 的时间重叠 | 同批内 propose 与 check 是**串行**的（同一批先提案后核对），因此重叠只在"重发/并发探针"时出现 | 能（时间戳已够） | 重发序号（`http.request.resend_count`） |
| 跨批次的关键路径 | r10：第 1 批被拒 → 第 2 批重掷；两批**串行** | 能（批次两端时间） | 拒绝理由的携带标记（`rejection_reason_present`），否则无法区分"从零重掷"与"定向修订" |

**结论**：我们的关键路径今天只能粗到"批次"；要细到"哪一次调用、哪一段是排队/首包/收尾"，**只差三样东西**——暴露 `management_calls`、记录首包时刻、记录重发序号。三者都在 P0 集合里（§3），不需要新机制。

---

## 5. 反面清单：哪些常见指标对归因无用或误导

| 指标 | 为什么会误导 | 依据 |
| --- | --- | --- |
| **批次总时长** | 把 propose + check + 传输重发 + 排队混成一个数；用它反推"谁贵"只能靠猜（r10 的 30.2k/42.3k 就是这么来的） | 我们的记录本身：`management_log[].duration_ms` 是批次口径 |
| **平均延迟** | 在大扇出系统里，均值与尾部分布可以完全脱节：单点 p99 = 10ms，全部完成 p99 = 140ms | Tail at Scale（CACM 56(2), 2013）Table 1 |
| **只报 token 总量** | 无法区分 reasoning 与正文；也无法区分缓存命中——r10 中 reasoning 占 84.2%，缓存读 3,584 | `gen_ai.usage.reasoning.output_tokens` 注 [43]；`gen_ai.usage.cache_read.input_tokens` 注 [36] |
| **把四类 token 相加** | 直接重复计数（cache 计入 input、reasoning 计入 output） | 同上两条注 |
| **按配置推断实际模型/成本** | 配置值 ≠ 实际返回 | semconv 同时定义 `gen_ai.request.model` 与 `gen_ai.response.model`；我们的 design doc 已要求分别保存 |
| **用采样 trace 解释单请求** | 采样意味着单个请求可能没有完整链路 | Dapper（2010）：把 "the use of sampling" 列为设计要素；聚合数据无法反推单请求 |
| **客户端时长当"模型生成时间"** | 客户端 `gen_ai.client.operation.duration` 含排队、网络与重试；只有 `gen_ai.server.*` 才是服务端视角 | semconv 客户端/服务端指标分列；`time_to_first_chunk` 定义"measured from request issuance" |
| **没有分母的速率** | "token/s" 若不写明是否含 reasoning/缓存，跨 run 不可比 | 我们自己的实测：47.2 / 48.4 / 58.3 / 62.9 tok/s 分别是不同口径（propose only / propose+check） |
| **把"没被接受的尝试"丢掉** | 只统计成功调用会让重试的成本消失，正好掩盖最贵的机制 | SRE/gRPC/Envoy 都把被抑制/溢出的重试计入观测；OTel 给重发编号 |
| **成本字段留 0 而不是 `unavailable`** | 0 会被聚合读成"免费"，导致"独立预算"之类的结论失真 | 我们已有 `management_cost: "unavailable"` 约定 |

---

## 6. adopt-from（可借鉴的实现）

| 借用项 | 参考实现（仓库 + 文件 + 许可证） | 抄哪一段 | 改写哪一段 | 适配到我们哪个文件 | 风险与代价 |
| --- | --- | --- | --- | --- | --- |
| 调用级时长与首包 | `open-telemetry/semantic-conventions-genai` → `docs/gen-ai/gen-ai-metrics.md`（`gen_ai.client.operation.duration`、`…time_to_first_chunk`）+ 核心 semconv 的 `gen_ai.response.time_to_first_chunk`（Apache-2.0） | 两个指标名、单位（`s`）、桶边界（`[0.01 … 81.92]`）与"流式才报 first chunk"的规则 | 不引入 OTel SDK；在 transport 里用自己的计时器产出同名字段 | `src/model/structured-provider-transport.ts` + `src/core/intent-compiler-v2.ts`（`recordManagementCall`） | 名字是 Development 稳定性，未来可能改名；需在适配层集中映射，别散落各处 |
| 用量与成本的字段名 | `Arize-ai/openinference` → `spec/semantic_conventions.md`（`llm.token_count.*`、`llm.cost.*`，Apache-2.0） | 成本的分项名（`llm.cost.completion_details.reasoning`、`llm.cost.prompt_details.cache_read` 等） | 我们的 usage 已有 input/output/reasoning/cache_read；把成本分项加为可选字段 | `src/core/compiler-store-v2.ts`（`usage` 结构）+ `src/runtime/audit-report.ts` | provider 多半不给成本；要接受 `unavailable`，不能自算冒充实测 |
| usage/cache 映射 | `traceloop/openllmetry` → `packages/opentelemetry-instrumentation-openai/.../shared/__init__.py`（Apache-2.0） | provider 字段 → `gen_ai.usage.*` 的映射方式（`prompt_tokens`→input、`completion_tokens`→output、`prompt_tokens_details.cached_tokens`→cache_read） | 我们已经写了同样的映射（`structured-provider-transport.ts`），把它抽成单点并在测试里对照 openllmetry 的字段名 | `src/model/structured-provider-transport.ts` | 该仓库同时写入旧名（如 `gen_ai.system`）；我们只取新名 |
| 首 token 与用量明细的数据模型 | `langfuse/langfuse` → `web/public/generated/api/openapi.yml`（MIT Expat；`ee/` 与 `web/src/ee/` 例外） | `completionStartTime`、`usageDetails`、`costDetails`、"`total` 由明细派生"的约定 | 我们用 `first_chunk_at` + `usage{}` 表达同一语义，不引入 Langfuse 服务 | `src/core/compiler-store-v2.ts`；`src/runtime/audit-report.ts` | 若照搬"明细 key 任意"，会丢失规范名的可比性——建议 key 固定为 semconv 名 |
| 重试预算与溢出计数 | `grpc/proposal` → `A6-client-retries.md`（`retryThrottling`，Apache-2.0）；`envoyproxy/envoy` → `cluster_circuit_breakers.rst`（`retry_budget` + `upstream_rq_retry_overflow`，Apache-2.0） | "抑制的重试也要计数"、"按 server/服务聚合"的观测口径 | 我们只借观测口径：`attempt` 序号 + 被抑制/未重发的记录；阈值（若有）由 T04/T06 定，不在本票 | `src/model/structured-provider-transport.ts`；`src/core/intent-compiler-v2.ts` | 引入阈值就是参数式收紧，超出本票范围——**明确不做** |
| 幂等与单飞 | `golang/sync` → `singleflight/singleflight.go`（BSD-3）；IETF `draft-ietf-httpapi-idempotency-key-header`（文本草案） | "相同 key 只执行一次/可安全重发"的判据 | 我们已有 dispatch 幂等；这里补的是**传输层重发的判据**（同请求摘要 → 可重发） | `src/model/structured-provider-transport.ts` | 误判"可安全重发"仍会重复计费；必须有请求摘要 |
| 队列/prefill/decode 的分解 | `vllm-project/vllm` → `docs/design/metrics.html`（`vllm:request_queue_time_seconds` 等，Apache-2.0） | 指标名与分解方式（queue / prefill / decode / TTFT / TPOT） | 托管 API 拿不到这些，改记为 `unavailable` 并说明"客户端 first_chunk 含排队" | 文档与 `audit-report` 的字段说明 | 若把客户端量硬解释成 prefill，会产生假结论 |
| 缓存成本 | OpenAI Prompt Caching 文档（90% 折扣）、Anthropic Prompt Caching 文档（5 分钟 TTL；写入 +25%/2×） | "缓存要不要用"的代价模型 | 我们只记录 `cache_read`/`cache_write` 与 `unavailable`；不做折扣假设 | `src/core/compiler-store-v2.ts`（usage）+ `audit-report` | 平台折扣会变；不能把 90% 写进代码常量 |

---

## 7. 开放问题

1. **首个可比的 dashscope 首包时间**：我们的探测记录是"2.8s 收到响应头、312s 完成"（CURRENT-DESIGN §8），但那是单发探针，不是每调用记录。要不要以它作为初始基线，并要求所有运行都写 `first_chunk_at`？
2. **`cache_write` 的可用性**：dashscope 当前未见返回；DeepSeek 的 `prompt_cache_hit_tokens`（命中）已知但写入侧语义不同。是否需要按 provider 分别标注"语义"（否则跨 provider 的 cache 数字不可比）？
3. **成本（`management_cost`）**：我们是否接受"由价格表推断"而不是 provider 实测？若接受，就必须在记录里区分 `measured` 与 `derived`（否则会污染"实测"这个词）。
4. **执行侧的时间**：harness 的 `agent_execution.started_at/finished_at` 在 job 记录里（r10 = 1216.4s），但不在 store 里。要不要把执行墙钟也收进 store（跨存储对齐口径），还是维持"store 记管理、job 记执行"的分工？
5. **审计报告与 T02 的关系**：本票建议的字段与 T02 未竟的 ①（暴露 per-call）完全重叠；本票只出文档，**不替 T02 实现**。
6. **能否在不动官方计分的前提下测"排队"**：托管 API 不暴露队列时间。唯一可做的近似是"同形状下把并发降到 1 后重测 first_chunk"，这属于运行拓扑变化（须由 T06 定归属），本票不擅自决定。

---

## 附录：来源链接（精确 URL）

**规范与字段名（OpenTelemetry）**

- GenAI semantic conventions（已迁出主仓库）：<https://github.com/open-telemetry/semantic-conventions-genai>
  - 指标：`docs/gen-ai/gen-ai-metrics.md` → <https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/gen-ai-metrics.md>
  - token 计数器：`docs/gen-ai/gen-ai-token-metrics.md` → <https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/gen-ai-token-metrics.md>
  - 事件：`docs/gen-ai/gen-ai-events.md`（`gen_ai.client.inference.operation.details`、`gen_ai.evaluation.result`）→ <https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/gen-ai-events.md>
  - 属性注册表：`docs/registry/attributes/gen-ai.md` → <https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/registry/attributes/gen-ai.md>
- 核心 semconv（`error.type`、`http.request.resend_count`）：<https://github.com/open-telemetry/semantic-conventions>
  - HTTP spans：`docs/http/http-spans.md` → <https://raw.githubusercontent.com/open-telemetry/semantic-conventions/main/docs/http/http-spans.md>
- Trace API（span 父子语义）：<https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/trace/api.md>

**实现与平台**

- OpenLLMetry（Apache-2.0）：<https://github.com/traceloop/openllmetry> ；文件 `packages/opentelemetry-instrumentation-openai/opentelemetry/instrumentation/openai/shared/__init__.py`
- OpenInference（Apache-2.0）：<https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md>
- Langfuse（MIT Expat，`ee/` 除外）：OpenAPI 定义 <https://github.com/langfuse/langfuse/blob/main/web/public/generated/api/openapi.yml> ；文档 <https://langfuse.com/docs/observability/features/token-and-cost-tracking>
- LangSmith（MIT）：<https://docs.langchain.com/langsmith/log-llm-trace>
- vLLM（Apache-2.0）指标：<https://docs.vllm.ai/en/latest/design/metrics.html>
- Jaeger critical path（Apache-2.0）：<https://github.com/jaegertracing/jaeger/blob/main/cmd/jaeger/internal/extension/jaegerquery/internal/mcptools/internal/criticalpath/criticalpath.go>
- 单飞：<https://github.com/golang/sync/blob/master/singleflight/singleflight.go>（BSD-3-Clause）
- 重试预算：gRFC A6 <https://github.com/grpc/proposal/blob/master/A6-client-retries.md>（Apache-2.0）；Envoy 集群熔断 <https://www.envoyproxy.io/docs/envoy/latest/configuration/upstream/cluster_manager/cluster_circuit_breakers>（Apache-2.0）
- 幂等键草案：<https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/>
- 内容寻址增量（骨架借鉴）：<https://github.com/bazelbuild/bazel>（Apache-2.0）
- 语义缓存（仅对照，本票不采用其近似命中）：<https://github.com/zilliztech/GPTCache>（MIT）

**运营与缓存**

- Google SRE Book, *Handling Overload*（2017）：<https://sre.google/sre-book/handling-overload/>
- OpenAI Prompt Caching：<https://platform.openai.com/docs/guides/prompt-caching>
- Anthropic Prompt Caching：<https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching>

**机制数字的出处（本文件引用的两个外部数字）**

- Dapper（2010，426 bytes/span、<0.01% 网络、采样）：<https://research.google.com/pubs/archive/36356.pdf>
- The Tail at Scale（CACM 56(2), 2013；63%、10ms/140ms）：<https://www.barroso.org/publications/TheTailAtScale.pdf>
