# DeepSeek KV cache 研究：开源边界、生产机制、API 命中与 IC 的关系

检索日期：2026-10-22。只使用 DeepSeek 官方文档、仓库、模型卡和论文；没有调用付费模型，没有运行推理或命中实验。GitHub 源码按检索时的 main 阅读，未固定到可靠 commit SHA。下文把源码确认、官方部署描述和工程推论分开；生产设计披露不等于相应服务已经完整开源。

## 核心结论与开源边界

**DeepSeek 公开了推理核心、模型计算、协议编码和 3FS 存储，但没有完整公开官方服务的跨请求 KV 缓存管理系统。** DeepInfer README 明列 KV cache system 不在当前开源范围；其部署说明也说缓存管理和负载均衡与内部基础设施耦合，尚未完全公开。[DeepInfer README](https://github.com/deepseek-ai/DeepInfer)

这里至少有四件不同的事：

| 层次 | 解决的问题 | 已核实的证据 |
| --- | --- | --- |
| 模型 KV 压缩、共享 | 每个上下文占多少内存、搬多少数据 | V2/V3 MLA；V4.1 的跨层共享与低精度 KV |
| 跨请求前缀复用 | 同一前缀能否避免再次 prefill | 官方 API 行为、生产架构；管理服务未完整公开 |
| KV 存储与搬运 | 缓存留在哪里、怎样快速加载 | 3FS、DeepInfer 的缓存布局与恢复代码 |
| IC 自有结果缓存 | 是否直接跳过整次模型调用 | 属于应用设计，不能与上面三者混算 |

KV 是注意力计算的中间状态。命中主要省去已处理前缀的重复 prefill；新后缀仍需计算，生成仍需读取上下文 KV 并逐步输出。不能把“命中 90% 输入”解释成“整次计算或费用省 90%”。

## 生产服务怎样完成一次复用

官方披露的路径可压缩为：

`请求编码 → CHECK 查前缀元数据 → 确定命中长度并路由 → 3FS 异步读取至主机共享内存 → 搬入 GPU HBM → 补算必要状态及未命中后缀 → 生成并保存新缓存`

CHECK 使用 hash-chain 前缀匹配。主 KV 存在共享 SSD 集群，各 prefill 节点都能读取，因而不依赖把相同前缀路由回原机器；SWA 窗口状态另存主机内存，跨机获取。生产说明给出的 V4.1 算法先将可命中位置限制在输入长度减 134 内，选择 128-token 对齐位置；附近没有可用 SWA 状态时回退一块并补算。**这描述的是特定部署，不是所有模型的 API 计费公式。** [官方部署 Q&A](https://github.com/deepseek-ai/DeepInfer/blob/main/doc/inference_deployment_qa.md)

3FS 自己不判断 prompt 是否相同。其 USRBIO 接口处理文件描述符、offset、length 和共享内存地址，利用共享数据区与请求环批量异步 I/O；token 前缀如何映射到这些文件位置，属于上层 KV 服务。[USRBIO 接口](https://github.com/deepseek-ai/3FS/blob/main/src/lib/api/UsrbIo.md)

## 模型为什么能让长期 KV 存储划算

V2/V3 的 MLA 将多头 K/V 压成低维 latent，并另存位置相关分量。V3 参考实现的 absorb 分支直接操作 `kv_cache` 和 `pe_cache`。这减少了单个上下文的缓存体积，本身没有实现跨请求查找。[V2 论文 §2.1](https://arxiv.org/html/2405.04434v5#S2.SS1)、[V3 模型代码](https://github.com/deepseek-ai/DeepSeek-V3/blob/main/inference/model.py)

V4.1 的 CSA2 进一步在层间共享：Full 层产生 KV 与索引，Reindex 层复用 KV、重算索引，Reuse 层复用两者；主 KV 低精度存储，SWA KV 单独处理。这里的“层间复用”与“两个 API 请求复用共同前缀”不是同一维度。[V4.1 模型卡](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash)

V4.1 报告披露：长期 global KV 命中而短期 SWA 状态缺失时，以 bounded replay 重建有限窗口。论文明确这是近似恢复，后续状态可能随命中边界变化；作者报告影响很小。因此不能保证最新路径的缓存恢复永远与全量重算数值完全一致。这一论文对应原始 V4.1 Flash 报告，不能把所有性能数字直接移植到当前 API 的 1017 版本。[V4.1 报告 §3.2](https://arxiv.org/html/2609.19969v1#S3.SS2)

## 源码能验证到哪里

| 文件与入口 | 源码确认的内容 | 不能据此推出的结论 |
| --- | --- | --- |
| [model_metadata_utils.py](https://github.com/deepseek-ai/DeepInfer/blob/main/deepinfer/model_executor/model_metadata_utils.py)：`resolved_tokens_per_block` | V4.1 引擎块大小 128 token；另一个 `kvcache_align_to=128` 是字节对齐 | 不能把所有 API 的最小命中长度都定为 128 |
| [cache_engine.py](https://github.com/deepseek-ai/DeepInfer/blob/main/deepinfer/worker/cache_engine.py)：`KVSTORE_GRAIN`、`GPUCacheInterface` | 128-token 存储对齐、KV 内存布局、SWA 状态保存和恢复 | 不能证明分布式前缀索引及淘汰服务已开源 |
| [sequence.hpp](https://github.com/deepseek-ai/DeepInfer/blob/main/csrc/engine/sequence.hpp)：`KvCacheState` | 保存命中 token 数、块表与 SWA 可见起点，支持注入命中长度 | 这是命中结果的消费者，不是全局查找服务 |
| [scheduler.hpp](https://github.com/deepseek-ai/DeepInfer/blob/main/csrc/engine/scheduler.hpp)：`_schedule_prefill` | 按序列长度减已缓存长度安排待算后缀 | 不解释跨机器怎样找到缓存 |
| [llm_engine.py](https://github.com/deepseek-ai/DeepInfer/blob/main/deepinfer/engine/llm_engine.py) | `add_request` 接收 token IDs；多个保存缓存及 PD 拆分入口为空虚函数 | 运行 offline wrapper 不会自动得到官方 SSD 缓存服务 |
| [environ.py](https://github.com/deepseek-ai/DeepInfer/blob/main/deepinfer/environ.py) | speculative 默认长度 5，回退至少 6；重放保留量需覆盖窗口与回退 | 128、134、README 推荐 140 不是同一个参数 |
| [input_metadata/yoco.py](https://github.com/deepseek-ai/DeepInfer/blob/main/deepinfer/model_executor/input_metadata/yoco.py)、[models/v4_modules/yoco.py](https://github.com/deepseek-ai/DeepInfer/blob/main/deepinfer/model_executor/models/v4_modules/yoco.py) | bounded replay 所需的 query、位置、SWA 可见范围与计算布局裁剪 | compact 并非应用侧历史摘要 |

补充：模型的 [minimal reference](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/blob/main/inference/README.md) 以可读性为目标；其 [kernel.py](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/blob/main/inference/kernel.py) 的 FP4 inplace 分支会把量化再反量化的数写回张量。不能仅凭这个函数名称，就认定参考实现已经按生产物理 FP4 格式持久化。

## 当前命中规则

**DeepSeek 缓存可复用的模型上下文，不是复用完整回答。** 服务默认开启磁盘缓存；输出仍由模型重新计算。当前指南明确：受 Sliding Window Attention 影响，必须完整匹配一个已经落盘的前缀单元。落盘发生在输入结束、输出结束、系统识别出跨请求共同前缀、以及长序列的固定 token 间隔处。[当前缓存指南](https://api-docs.deepseek.com/guides/kv_cache/)

| 顺序 | 官方示例中的结果 |
| --- | --- |
| 先请求 A+B，后请求 A+B+C | 后者复用已落盘的 A+B |
| 先请求 A+B，后请求 A+C | 第二次不能仅凭相同的 A 命中；系统此时发现共同前缀 A 并落盘 |
| 再请求 A+D | 第三次可以命中已落盘的 A |

这里假设 A 尚未通过其他路径形成可用单元。系统尽力命中，不承诺百分之百；构建耗时秒级，不再使用后通常数小时至数日清理。**因此“长前缀相同”不等于下一次必定命中。** [当前缓存指南](https://api-docs.deepseek.com/guides/kv_cache/)

## 当前与历史不可混用

2024-08-02 公告解释了分布式磁盘阵列、从第0个 token 起的前缀匹配，以及 MLA 缩小 KV 后适合低成本磁盘存储。它还给出64-token存储单元、128K输入首token延迟从13秒降至500毫秒、命中价0.014美元/百万token等历史信息。[2024公告](https://api-docs.deepseek.com/news/news0802/)

**当前 API 指南没有公布统一的固定落盘间隔或最短可缓存前缀，也没有重申 64-token 块。** 当前 DeepInfer 的具体引擎块为 128 token，见上面的源码证据；这与 API 的缓存单元边界不是同一份承诺。旧公告价格和“无并发限制”也不能用于当前服务。[当前并发文档](https://api-docs.deepseek.com/quick_start/rate_limit/)

## 怎么观测，而不是猜测

Chat Completions响应中：

- `prompt_cache_hit_tokens`：命中输入数。
- `prompt_cache_miss_tokens`：未命中输入数。
- `prompt_tokens = hit + miss`。
- `prompt_tokens_details.cached_tokens`与hit同义。

流式返回的最后一个内容块携带完整usage，不应丢弃该块。可以据此计算输入命中率 `hit/(hit+miss)`；不能用总token下降或响应更快代替命中统计。[Chat Completions定义](https://api-docs.deepseek.com/api/create-chat-completion/)

DeepSeek兼容Responses接口时，输入统计为`input_tokens`，缓存量为`input_tokens_details.cached_tokens`；该接口仍无状态，`previous_response_id`和`conversation`不支持。这说明磁盘前缀复用并不等于服务端替客户端保存会话。[Responses指南](https://api-docs.deepseek.com/guides/responses_api/)

同一账户可用`user_id`做业务用户KV隔离；Chat Completions在请求体传`user_id`，Anthropic兼容接口放在`metadata.user_id`。频繁更换这个标识可能隔离本来可复用的缓存——这是根据隔离语义的推论；文档没有保证跨API key或跨模型命中。[隔离文档](https://api-docs.deepseek.com/quick_start/rate_limit/)

## 当前价格与成本含义

截至检索时，模型别名对应Flash=`DeepSeek-V4.1-Flash-1017`，Pro=`DeepSeek-V4-Pro-0813`。下表单位为美元/百万token，列的是非高峰价；高峰全部翻倍。[官方价格](https://api-docs.deepseek.com/quick_start/pricing/)

| 模型 | 命中输入 | 未命中输入 | 输出 |
| --- | ---: | ---: | ---: |
| deepseek-flash | 0.003 | 0.15 | 0.6 |
| deepseek-v4-pro | 0.022 | 0.66 | 1.98 |

高峰：周一至周五UTC 01:00–04:00及06:00–10:00，中国法定假日除外。命中输入分别比未命中便宜50倍和30倍，但输出费用不随输入命中下降。[官方价格](https://api-docs.deepseek.com/quick_start/pricing/)

成本应按 `hit×命中价 + miss×未命中价 + output×输出价`（再除百万）计算。示例推算：Flash非高峰、10万输入token中90%命中、1万输出token，费用0.00777美元；完全未命中为0.021美元，整次省约63%，不是98%。这是上述价格的算术结果，不是实测。

## 对IC请求组织的直接含义

以下是根据上述接口行为作的工程推论，尚未实验：

1. 固定指令和共同原文放在变化内容之前，保持消息角色、顺序与模型实际接收文本稳定；把每轮时间戳、随机ID或本次问题放在前面，会提前截断公共前缀。完整缓存键未公开；不能声称 HTTP JSON 键顺序本身一定影响命中。
2. 首批并行请求不能假定彼此已经完成共同前缀的识别与落盘。针对A+B、A+C、A+D，区分顺序请求、紧接请求、并行请求，分别记录usage，才能验证当前账户的实际表现。
3. 每次记录具体模型版本、user_id作用域、hit/miss/output、首token延迟及费用。IC自有结果缓存和DeepSeek的KV命中要分开：前者跳过模型调用，后者仍调用模型并产生新输出。

## 对 IC 最直接的源码发现：工具也属于前缀

公开的 `deepseek-recipe` 负责把协议消息编码成模型输入。V4.1 的 `render_tool_prompt` 按工具列表顺序渲染；`render_conversation` 把工具提示、输出 schema 追加到首条 system 消息；thinking effort 文本也进入前部上下文。因此即使 IC 的需求原文完全一样，工具列表、顺序、schema 或 effort 的变化仍可能提前截断公共 token 前缀。这是源码推导的影响，尚未测量官方命中率。[dsv41.rs](https://github.com/deepseek-ai/deepseek-recipe/blob/main/deepseek-recipe-encoding/src/v4/dsv41.rs)

该编码器也会归一化某些消息和 JSON 表达，最终 tokenizer 按顺序产出 token IDs。所以应比较编码后的序列，而非原始 HTTP 字节，也不能用“意思差不多”代替前缀相同。[JSON 编码](https://github.com/deepseek-ai/deepseek-recipe/blob/main/deepseek-recipe-core/src/json.rs)、[tokenizer.rs](https://github.com/deepseek-ai/deepseek-recipe/blob/main/deepseek-recipe-encoding/src/tokenizer.rs)

由此，对 IC 更有价值的设计方向是：在质量所需的上下文不变的前提下，把请求组织成少量稳定模板及其追加后缀；不要每次重排整个状态摘要。不同模型、工具配置和 schema 的请求分开统计。KV 复用只依赖实际输入能否匹配，并不会理解 IC 的对象身份、版本号或“这份摘要与上一份等价”。这些都是工程推论，不是已验证收益。

## 可以验证哪些推论（方案，未执行）

用固定模型、相同隔离作用域、固定参数和较长公共前缀 A，每组独立前缀，做下列对照。记录每次 hit/miss/output、延迟、时间间隔和实际费用；重复多组，避免一次服务调度或淘汰决定结论。每组的首次请求也可能偶然命中其他共享内容，不能把它强行记为冷启动。

| 请求组 | 要检验什么 |
| --- | --- |
| AB → ABC | 完整已有前缀的续接收益 |
| AB → AC → AD；另外做并行组 | 共同前缀识别、构建等待与并发的区别 |
| 同一 A，分别只改后缀、前部时间戳、工具顺序、schema | 找到 IC 的实际失配位置 |
| 同一请求，固定与改变 user_id | 验证业务隔离对复用的影响 |
| 间隔若干秒、分钟、小时重复 | 得到当前工作负载下的可用性分布，不推出通用 TTL 保证 |

输入整体命中率用 `sum(hit) / sum(hit+miss)`，不是每次命中率的简单平均。最终判断看实际总费用、首 token 延迟和任务质量；不要为了提升命中百分比而无谓增加输入或串行化全部请求。

## 尚不能由公开资料确认

- 生产前缀哈希算法、完整键结构、全部命名空间、元数据一致性与故障恢复代码。
- 跨 API key、跨模型或模型版本的复用保证。
- 对所有用户承诺的精确保留时长、固定落盘间隔和最短命中长度。
- 当前 IC 请求在该服务上的真实命中率、质量和端到端成本：需要实际请求样本实验。

不能把其他框架的 radix tree、HiCache 或 Redis 方案当成 DeepSeek 已验证的实现。公开部署说明、模型参考代码与可直接部署的完整服务需要分别评价。
