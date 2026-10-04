> **历史/专题材料，非现行指令。** 保留当时的观察、方案或取舍；实现与状态须从 [模块地图](../../development/README.md) 核对，不执行本文旧“下一步”。原 CURRENT-DESIGN 节号均指历史设计。

# 结构性成本成因的既有判定方法（T09 研究结果，2026-09-23）

本文件是 wayfinder 研究票 **T09**（`project/development/wayfinder-cost-structure/issues/T09-structural-cost-methods.md`）的产出，只做「已有方法 + 一手证据 + 特化提案」，**本轮不写实现代码**。

**写入范围声明：**唯一写入的文件是本文件；仓库其余部分只读。本轮没有修改源码、测试、配置、官方任务数据，没有运行 `npm run build` / `npm test`，没有启动真实模型或 benchmark。所有仓库事实均来自只读读取（文件、`snapshot.json`、`audit-report.json`、job/trial 记录）。

读法：第 1 节是结论；第 2 节事实表（方法 → 允许下什么结论 → 前提 → 一手来源）；第 3 节实现证据；第 4 节**适用边界**（本票重点）；第 5 节特化成我们的方法；第 6 节 adopt-from；第 7 节开放问题；第 8 节是给 T01 的输入（不是 T01 的结论）。

---

## 1. 结论

1. **既有方法都遵循同一个形状：把「某处耗时」换成「某个可枚举资源的某个量在增长」。**USE（资源 = 利用率/饱和/错误）、little's law（队列长度 ↔ 到达率 × 驻留时间）、Amdahl（固定工作负载下的串行比例）、关键路径（span 树上的最长链）都是这个形状的不同投影。**只有当我们能说明"它在随什么量增长"时，观测才升级为结构性结论。**（第 2 节 A/B/D 组）
2. **"结构性成本"在方法上等价于"可被机制解释的标度关系"，而不是"某个 run 里出现过"。** 性能工程判定机制靠三件事：可枚举资源、可测标度（随输入形状变化的量）、可扰动性（把它压小看是否随之变小）。三者缺一时只能写"现象"，不能写"结构"。（第 4.1/8 节）
3. **分布式追踪的成熟结论是：单请求的耗时归因必须走因果链（span 树关键路径），聚合指标（均值、总量、采样 trace）不能反推单请求机制。** Dapper 显式选择采样并说明其代价；Tail at Scale 用 63% 与 140ms/10ms 两组数字说明"扇出把单点抖动放大成整体尾延迟"。（第 2 节 B 组）
4. **反模式清单在公开资料里已经存在，且每条都能落到机制，不落到现象：** N+1（1+10=11 次依赖调用）、重试风暴（SRE 的"最坏 3X、加客户端 10% 重试预算后 1.1x"）、单点串行化（Amdahl 串行比例 + single-flight 合并）、重复计算（缓存命中率/缓存写入代价）、metastable failure（触发条件 + 反馈回路 + 持续负载）。（第 2 节 D 组）
5. **实验设计上，"最小可行的反例实验"不是统计显著性检验，而是受控扰动：**关闭/替换被怀疑的机制、保持其它条件不变、看标度是否消失；差分火焰图、"before/after" 剖析、SRE 的重试预算测算都是这个形状。benchstat/hyperfine 提供的是"重复与方差"这一层，不提供因果。（第 2 节 C 组）
6. **我们当前记录里最缺的不是时长，而是"能定位到机制的引用"。** r10 的候选与核对都写下了无法核验的引用：原文 362 个 UTF-16 码元、规范摘要应为 `sha256:2a1c9f89…`，而候选写的是占位 `sha256:0000…0001` + span `[0,63)`，核对 findings 写的是 `sha256:77c16c00…` + span `[0,116)`。在没有可核验引用的前提下，"核对成本高"与"核对判错了什么"无法归因到机制，只能归因到"模型不行"。（见第 5.2 节与 3.4 节的记录）
7. **对本项目的可操作形态是三层标度表（批次 / 事件 / 调用）× 三类量（请求数、生成量、被重复次数），**加上两条判定规则：①结论必须写明随什么量增长、在什么输入形状下不放大；②每条结论必须给出一个已经做过的反例/扰动尝试（或明确写"未做，因此只是候选"）。（第 5.1 节）
8. **"测试不是边界"在方法上靠三个具体动作落实：**（a）用形状而不是用例数描述输入（把 49 个用例换成"形状参数"）；（b）用机制外推而不是用样本内插（Little/Amdahl/关键路径都能算"没跑过的形状"）；（c）用扰动实验制造样本外点（主动把机制压小）。只做（a）（b）而不做（c）时，结论仍是"候选结构"，不能当边界。（第 8 节）

---

## 2. 事实表：方法 → 结论 → 前提 → 一手来源

### A. 性能工程方法

| 方法 | 它允许你下的结论 | 前提 | 一手来源（链接 + 年份 + 关键数字/引文） |
| --- | --- | --- | --- |
| **USE 方法**（Utilization / Saturation / Errors） | "在某资源上，利用率/饱和/错误里哪一项随负载增长"，从而指出瓶颈资源；它给的是**检查清单的构造规则**，不是数字阈值 | 系统能被枚举成"资源"（CPU、磁盘、总线…，也包括软件资源与资源控制）；每个资源至少有一个可观测的 U/S/E 量 | Brendan Gregg，*The USE Method*（个人站点，ACM Queue 版 *Thinking Methodically about Performance*, 2012；CACM 2013）："For every resource, check utilization, saturation, and errors."；作者自述"以 5% 的精力解决约 80% 的服务器问题"，并明确"有很多问题类型它不解决"。<https://www.brendangregg.com/usemethod.html> |
| **Drill-down / Top-down 分析** | 从"某个大类计数器"逐层下钻到"某段代码/某个微架构事件"，用于把聚合指标归因到可改动的层 | 存在分层计数器或分层采样；上层计数与下层归因是可分配的（不重叠、不遗漏） | Intel Top-Down Microarchitecture Analysis Method（Yasin, ISPASS 2014, DOI 10.1109/ISPASS.2014.6844459；Intel VTune 文档中的 top-down 视图）。注意：本票未能取得 Intel 站点正文（403），只按论文/文档的既有定义引用，**未见原文时不用作数字依据**。 |
| **Workload characterization（工作负载刻画）** | 把"输入形状"参数化，说明结论随哪些形状变量变化、哪些不变 | 能给出形状参数（大小、扇出、重复率、批次结构…）并能在不同参数下取到样本 | Calzarossa, Massari, Tessera，*Workload Characterization*，ACM Computing Surveys 48(3):1–43, 2016，DOI 10.1145/2856127（综述；本条已用 Crossref 元数据核对标题/作者/年卷页）——**只作方法学引用**：它给的是"用形状而不是用例描述负载"这一做法，不提供我们的数字。 |
| **队列/运行定律（Little's law）** | "驻留时间 = 队列长度 ÷ 到达率"这一守恒关系可用于判断"耗时增长是否来自排队（等待）而不是服务本身" | 系统近似稳态、边界一致（同一时间窗内统计 L/λ/W）、不区分服务时间与等待时间的观测会掩盖排队 | Little, J. D. C.，*A Proof for the Queuing Formula: L = λW*，Operations Research 9(3):383–387, 1961，DOI 10.1287/opre.9.3.383（原始形式）；工程用法见 Gregg 对 USE/little's law 的解释。 |
| **Amdahl 定律** | 固定工作负载下，整体加速比被**串行比例**封顶：`S = 1/(s + (1-s)/p)` | 工作负载规模固定；串行部分不随并行度改变 | Amdahl, G. M.，*Validity of the single processor approach to achieving large scale computing capabilities*，AFIPS 1967（原论文）。 |
| **Gustafson 定律** | 若问题规模随算力增长，串行部分被摊薄，`S' = s + p·N` 形式成立：结论从"封顶"变为"可扩展" | 允许改变问题规模；串行部分占比随规模变化 | Gustafson, J. L.，*Reevaluating Amdahl's Law*，CACM 31(5), 1988，DOI 10.1145/42411.42415。 |

**要点：**Amdahl 与 Gustafson 的差别不是数学口味，而是**"工作负载是否随规模变化"这一前提**。我们讨论"管理层成本是否随任务变长而摊薄"时，必须写明是固定输入（Amdahl 适用）还是输入增长（Gustafson 适用），否则结论会互相矛盾。

### B. 剖析与关键路径

| 方法 | 它允许你下的结论 | 前提 | 一手来源 |
| --- | --- | --- | --- |
| **火焰图 / 分层剖析** | "哪些调用栈占用了采样到的 CPU 时间"，用于把耗时归因到函数/子树；宽度是采样分布，不是墙钟时间 | 采样覆盖了真正在跑的那部分；对"等待、阻塞、排队"不敏感 | Brendan Gregg，*The Flame Graph*（ACM Queue, 2016）与作者站点：分层是"y 轴是栈深、x 轴是总体占比、宽度正比于样本"，顶端是实际在运行的部分。<https://www.brendangregg.com/flamegraphs.html> |
| **差分剖析（differential profiling）** | "两次运行之间，哪些部分变多/变少"，是**反例实验的直接读数**：改动后机制是否消失 | 两次运行可比（同一采集方式、同一工作量口径），差异要能被归因到改动 | Brendan Gregg，*Differential Flame Graphs*（2014-11-09）："Take stack profile 1. Take stack profile 2. Generate a flame graph using 2 … Colorize … using the '2 - 1' delta."；作者用途写明是"before & after profiles, such as for non-regression testing or benchmarking code changes"。<https://www.brendangregg.com/blog/2014-11-09/differential-flame-graphs.html> |
| **分布式追踪（Dapper 的 span 模型）** | 一个请求在系统内的耗时可以分解为因果链上的 span；跨机器、跨进程的等待也能被看到（这是火焰图看不到的部分） | 关键路径上的每个组件都有插桩；采样率与聚合方式已知且被记录 | Google Technical Report `dapper-2010-1`（2010-04）："In a Dapper trace tree, the tree nodes are basic units of work which we refer to as spans. The edges indicate a causal relationship between a span and its parent span."；每个 span 平均 **426 bytes**，trace 采集占生产网络流量 **<0.01%**；"such as the use of sampling" 明确列为成功要素之一。<https://research.google.com/pubs/archive/36356.pdf> |
| **OpenTelemetry span 模型** | 标准化了"每个 span 零或一个父、零或多个子，构成一个 trace"，使关键路径可被通用算法计算 | 插桩正确（父子关系表达真实因果，而不是"调用顺序"） | OpenTelemetry Specification, Trace API："Each span has zero or one parent span and zero or more child spans… A span is said to be a *root span* if it does not have a parent."<https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/trace/api.md> |
| **关键路径归因（critical path）** | 从 span 树算出"真正决定端到端时间的那一段"，并把"其它并行/被等待的部分"排除出去 | span 因果正确；并发/等待语义能从时间戳推断（Jaeger 的算法用 last-finishing child 递归） | Jaeger 的 critical path 实现（Apache-2.0）："The algorithm begins with the top-level span and iterates through the last finishing children (LFCs)."<https://github.com/jaegertracing/jaeger/blob/main/cmd/jaeger/internal/extension/jaegerquery/internal/mcptools/internal/criticalpath/criticalpath.go> |
| **扇出放大尾延迟（fan-out amplification）** | "单点抖动"被扇出放大成整体尾延迟；这解释了为什么均值/单点观感与整体完全脱节 | 请求由多台服务器并行完成，且整体要等最慢者（同步扇出） | Dean & Barroso，*The Tail at Scale*，CACM 56(2), 2013-02, DOI 10.1145/2408776.2408794："If a user request must collect responses from 100 such servers in parallel, then **63%** of user requests will take more than one second"；真实服务表 1：单个随机请求 p99 = **10ms**，全部请求完成 p99 = **140ms**，"waiting for the slowest 5% of the requests to complete is responsible for half of the total 99%-percentile latency"。<https://www.barroso.org/publications/TheTailAtScale.pdf> |

### C. 实验设计

| 方法 | 它允许你下的结论 | 前提 | 一手来源（含年份） |
| --- | --- | --- | --- |
| **受控变量法 / 随机化与重复** | 只有改变的因子可以归因；重复提供方差估计（这是"几次观察"的方法学下限） | 随机化/配对可行；其它因子被固定或平衡 | Fisher, R. A.，*The Design of Experiments*（1935，随机化、重复、区组的思想源头）；Montgomery, D. C.，*Design and Analysis of Experiments*（Wiley，第 9 版 2017）中 2^k 与分数因子设计。 |
| **因子与分数因子实验** | 在多因子下估计主效应与交互（例如"核对开关 × 输入形状"），**不必跑满所有组合**；代价是牺牲高阶交互的估计 | 因子可设水平、可施加且可复原；假设（效应可加等）被记录 | 同 Montgomery 2017；软件工程落法见 Wohlin et al., *Experimentation in Software Engineering*（Springer 2012）。 |
| **消融（ablation）** | "去掉/替换某机制后，标度是否消失"——这是本票最需要的反例实验形状 | 被消融的机制可被单独关闭，且关闭不改变其它通路 | 论文级实例：CoVe（Dhuliawala et al., arXiv:2309.11495, 2023）用 **joint / factored / factor+revise** 三种消融对照，报告"factored 变体在所有三个任务上带来进一步增益"，即机制被拆分后效果变化可被读出（第 2.95→0.68 等数字见下）。 |
| **受控扰动 / 逃逸实验（metastable failure 的方法）** | "系统在什么条件下会进入自持的坏状态、退出需要什么扰动"；结论必须包含**触发条件 + 反馈回路 + 持续负载**三要素 | 允许施加扰动（负载脉冲、依赖变慢、错误注入）并能测量恢复 | Bronson, Aghayev, Charapko, Zhu，*Metastable Failures in Distributed Systems*，HotOS '21，DOI 10.1145/3458336.3465286（机制三要素）；后续形式化工作 arXiv:2510.03551（2025-10）："a stressor such as a temporary spike in workload causes the system performance to drop and, subsequently, the system performance continues to remain low even when the stressor is removed"，并给出"用逃逸概率定义 metastable、可预测恢复时间"的算法。 |
| **重试预算的定量对照** | 把"重试放大"从定性抱怨变成可算的量：最坏情况请求量放大倍数 | 能观测到重试比例与拒绝比例；客户端有共享的重试预算 | Google SRE Book, *Handling Overload*（2017）：每请求重试上限 3 次；**客户端级重试预算 10%**；无预算时"the number of requests will grow significantly, to somewhere just below **3X**"，加预算后"reduces the growth to just **1.1x** in the general case"。<https://sre.google/sre-book/handling-overload/> |

### D. 反模式 → 机制（每条都指向机制，不指向现象）

| 反模式（现象） | 机制（可测的量） | 一手来源 |
| --- | --- | --- |
| N+1 调用 | **每个父项触发一次依赖调用**：调用次数 = 1 + N，成本随父集合大小线性增长 | Rails Guides, *Active Record Query Interface*（N + 1 Queries Problem）："The above code executes 1 (to find 10 books) + 10 (one per each book to load the author) = **11** queries in total."<https://guides.rubyonrails.org/active_record_querying.html> |
| 重试风暴 | **失败触发重试 → 请求量乘性增长 → 排队上升 → 更多失败**（正反馈）；可用"重试比 + 放大倍数"测量 | SRE Book *Handling Overload*（同上，3X → 1.1x）；gRPC `retryThrottling`（`maxTokens`/`tokenRatio`，按 server name 维护 `token_count`，低于 `maxTokens/2` 时不再重试）见 gRFC A6 §Throttling：<https://github.com/grpc/proposal/blob/master/A6-client-retries.md>；Envoy `retry_budget`（`budget_percent`、`min_retry_concurrency`）见集群熔断配置：<https://www.envoyproxy.io/docs/envoy/latest/configuration/upstream/cluster_manager/cluster_circuit_breakers> |
| 单点串行化 | **并行度被某一段串行限制**：整体吞吐/时延由串行段决定（Amdahl 串行比例）；重复的相同调用可被合并（single-flight） | Amdahl 1967；`golang.org/x/sync/singleflight`（BSD-3）："provides a duplicate function call suppression mechanism"：<https://github.com/golang/sync/blob/master/singleflight/singleflight.go> |
| 重复计算 | **同一输入被反复处理**：成本 = 处理次数 × 单次代价；缓存命中率与缓存写入代价决定净收益 | OpenAI Prompt Caching 文档（2026 现行版）："Pay the model's reduced cached-input rate for reused tokens, discounted up to **90%**."<https://platform.openai.com/docs/guides/prompt-caching>；Anthropic Prompt Caching 文档：5 分钟 TTL，"5-minute cache writes cost **25% more** than base input tokens, 1-hour cache writes cost **2x** base input tokens…"：<https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching> |
| 自持坏状态（metastable） | **触发条件 + 反馈回路 + 持续负载**：负载撤去后系统仍留在低性能状态，需扰动才逃逸 | HotOS '21（同上）；形式化与恢复时间预测见 arXiv:2510.03551（2025）。 |

---

## 3. 代码/实现证据（它解决了什么、没解决什么）

1. **Jaeger critical path**（Apache-2.0，`cmd/jaeger/.../criticalpath/criticalpath.go` + `find_lfc.go`）：解决"从 span 树里取出决定端到端时间的那一段"；没解决"span 因果本身错了怎么办"——注释里直接把算法建立在"last finishing children"这一时间戳假设上。对我们的含义：**要有正确的父子关系与时间戳，这段代码才有意义**。
2. **OpenTelemetry Trace API**（Apache-2.0，`specification/trace/api.md`）：解决 span 的父子/链接/根 span 语义；没解决"语义层的成本应该记在哪个 span 上"。对我们的含义：批次=根 span、事件=触发 span、调用=子 span 是自然映射（第 5 节），但**归因语义要我们自己写进属性**。
3. **Brendan Gregg 的 FlameGraph 仓库**（`flamegraph.pl`、`difffolded.pl`）：解决"把两次剖析做差并可视化"；该仓库根目录**没有 LICENSE 文件**（本票核对：README 亦无许可证声明），因此**不进入 adopt-from**，仅作方法引用（差分剖析这一做法本身可用其它实现替代，例如 `google/pprof` 的 `-diff_base`，Apache-2.0）。
4. **SRE / gRPC / Envoy 的重试控制**：解决"把重试放大限制在可算的倍数内"，并把"重试被拒绝"本身变成可观测事件（Envoy 计数器 `upstream_rq_retry_overflow`）；没解决"重试是否值得"（收益侧要靠评测/验收）。
5. **Dapper**：解决"跨组件因果可见性"，并明确代价（采样、<0.01% 网络、426 bytes/span）；没解决"单请求级别的完整真值"——采样意味着**单个请求可能不可解释**，这正是我们不能用聚合数据反推单批行为的原因。
6. **本仓库已有的事实**（只读核对）：
   - `src/model/structured-provider-transport.ts` 已经走 SSE 流式（`stream: true` + `stream_options: { include_usage: true }`），但只把"总时长 + usage"回传，**没有记录首包时间**（`streamed: true` 是唯一痕迹）。见第 5.3 节与 T10 文档。
   - `src/core/intent-compiler-v2.ts` 的 `recordManagementCall()` 已经为每次管理调用单独落一条 `management_calls`（`kind: "propose" | "check"`、`started_at`/`completed_at`/`duration_ms`/`status`/`error_code`/`usage`），批次级 `management_log` 仍在——**但是** `src/runtime/audit-report.ts` 与 `src/cli/audit-report.ts` 目前只暴露批次级 `per_request`，per-call 切片尚未进入报告（这正是 T02 的未竟部分）。
   - `semantic_checks` 目前记 `sequence`/`verdict`/`findings`/`task_ids`/`usage`/`provider`/`model`/`response_digest`，**没有时长**（T02 的原始缺口）。
     - 例子（r10 记录）：`{"sequence":1,"verdict":"inconsistent","findings":1,"task_ids":["t1"],"usage":{"input_tokens":3493,"output_tokens":18344,"reasoning_tokens":17971}}`——注意这里**有 token、没有 duration**。

---

## 4. 适用边界：这些方法在什么条件下不成立（本票重点）

### 4.1 逐方法的"不成立条件"

| 方法 | 不成立/不可用的条件 | 如果违反会犯什么错 |
| --- | --- | --- |
| USE | 资源不可枚举（例如"模型思考"不是一个资源）；缺少饱和/错误量；现象由排队以外原因主导（算法、数据形状） | 把"某资源利用率高"当成根因；对不可枚举的对象（"核对质量"）强行套 U/S/E |
| Drill-down / Top-down | 分层计数器不覆盖真正的时间去向（例如等待模型返回的时间落在"外部"）；归因层不是可控层 | 在错误的层做优化（改了没有影响力的层） |
| Workload characterization | 形状参数选错（把无关变量当形状）；形状之间不可比（条件同时变化） | 用"用例集"冒充"形状分布"，把 49 个用例当可能性边界 |
| Little's law | 非稳态（观测窗比系统变化还长）；边界不一致（L、λ、W 统计的口径不同）；把"服务时间"当"驻留时间" | 用平均值解释排队，或反过来把排队说成"模型慢" |
| Amdahl / Gustafson | 未声明工作负载是否随规模变化；串行段会因缓存/批处理改变 | 用固定负载结论否定规模化的可能性（或反之） |
| 火焰图 | 关心的是等待/阻塞/排队/IO 而非 CPU；采样偏差；符号/栈不完整 | 把"没出现在火焰图上"当成"不花时间" |
| Dapper / OTel 追踪 | 采样率导致单个请求缺失；插桩不一致（跨语言/跨进程断开）；父子关系被"调用顺序"污染 | 用聚合说明单请求；把断链当成"没有成本" |
| Critical path | 并发/等待语义无法从时间戳推断（例如同一 span 内既有等待又有计算）；异步/事件驱动导致父子不表达真实阻塞 | 把"时间上最后结束"误当"因果上导致最慢" |
| 因子/分数因子实验 | 因子不可独立施加；效应非可加且交互极高；样本量不足 | 报了主效应却漏掉交互，或把噪声当效应 |
| 消融 | 机制无法单独关闭（关掉同时改了其它东西）；关闭后任务语义变化 | 把"换了个任务"当成"机制被消融" |
| 受控扰动 | 不允许扰动（生产、付费模型、官方计分不可变）；只能观察 | 只能得到相关性，必须把结论标为"候选" |
| 重试预算 | 对端不区分重试与新请求；重试落在同一后端（无洗牌）；无共享预算 | 放大倍数被低估 |

### 4.2 贯穿性边界（我们最容易踩的三条）

1. **"样本 ≠ 边界"**：任何观测（含 49 个官方用例）只提供**形状的一个点**。方法上必须做形状参数化（workload characterization）+ 机制外推（Little/Amdahl/关键路径）+ 扰动（差分/消融），三者中至少两项才允许把"现象"写成"结构"。
2. **"聚合 ≠ 归因"**：Dapper 的采样、Tail at Scale 的 63%、SRE 的 3X→1.1x 都指向同一件事：**聚合数字能证明"存在放大"，不能证明"是哪一次调用造成的"**。单请求归因必须靠 span 级因果链，而我们的"单请求"单位是**批次/事件/调用**三层。
3. **"机制不可关 = 结论只能是候选"**：在不动官方计分、不降低难度的前提下，很多机制（"核对是否必要"）无法直接关掉。此时允许的替代是：**同输入形状下的形状对照**（例如同一批事件在"提议+核对"与"仅提议+机械门槛"两种运行形状下的对比——这是运行拓扑的变化，不是参数放宽；决策归属由 T04/T06 定），以及**离线重放**（把历史请求重放，改变的是记录链路而不是任务难度）。

---

## 5. 特化成我们的方法（映射到管理调用 / 候选 / 核对 / 批次 / 事件 / 审计记录 / 任务预算）

### 5.1 三层标度表（我们建议的判定装置）

把"结构 = 决定生成量与被重复次数的形状"落成一张表。**每一行必须能回答"随什么量增长"**，否则不进这张表。

| 层 | 对象 | 我们要记的量（现有 → 目标） | 依据什么判定 | 什么算反例 |
| --- | --- | --- | --- | --- |
| **批次**（一次 `advance` 处理一批事件） | `management_log[].duration_ms`（已有）；请求数、输入/输出/reasoning token（已在 `budget`） | 目标：批次的**标度**（请求数、生成量、墙钟）与**形状参数**（事件数、候选组数、原子数、是否含拒绝） | 批次时长 ÷ 批次输出 token：是否稳定在某个区间（r10 实测 58.3–62.9 token/s；r4 48.4；r5 47.2） | 同一形状下该比值显著变化；或形状改变但该比值不变（说明不是"生成量"在解释） |
| **事件**（触发本批的 user_input / execution_return 等） | 批次的 `trigger_event_ids`（已有，但未用于标度） | 目标：每事件**产生的批次数**与**产生的调用数** | 一个用户事件是否触发 1 批还是 N 批（r10：1 事件 → 2 批 = 4 次调用；r4：1 事件 → 1 批 = 1 propose + 1 check） | 事件数不变而调用数翻倍（说明"拒绝 → 再推进"在复制整批，而不是只修订差异） |
| **调用**（propose / check / 将来的 revise） | `management_calls`（已有，未进报告）；`semantic_checks`（有 token、无时长） | 目标：每次调用的 kind、时长、首包时间、usage、状态、错误类型 | 单次调用的输出 token ÷ 时长（"生成速率"作为**分母**，用于把别的量归一化，而不是当作结论） | 相同 kind 的调用在相同输入形状下时长成倍变化而 usage 不变（说明成本来自排队/传输/重试，不属于生成） |

**为什么这样分层**：Dapper/OTel 的 span 树、Jaeger 的关键路径都要求"父子关系正确 + 时间戳在正确的层"。我们现在的记录里，批次有总时长、调用有独立时长但没有首包时间、事件没有独立时间戳（只有事件写入时刻），因此**目前能算的关键路径只到"批次"这一层**。

### 5.2 引用可核验（机制的定位前提）

这是 r10 暴露、且方法学上优先级最高的一项：**没有可核验的引用，"核对成本"无法归因到"核对在查什么"。**

已核对的事实（只读读取 r10 记录）：

- 用户原文（`store/v2-runs/intent-on-d3w9-r1-qwen-r10/events.jsonl` 的 `payload.text`）长度 **362 个 UTF-16 码元**；其 UTF-8 摘要为 `sha256:2a1c9f895467ce87e5cd8a5e42dd74202ce865edbb3fbd03797ea9b5308eaf87`（与 Observer `user_input.observed` 的 `data.digest` 一致）。
- 候选（`mgmt-1`/`mgmt-2` 的 `sources`）写入的引用是占位摘要 `sha256:0000000000000000000000000000000000000000000000000000000000000001` + `span {start:0,end:63}`。
- 核对结论（`semantic_checks[1].findings[*].refs`）写入的是 `sha256:77c16c00d0d34a1486489659f2e7c75d1114c827617f904e8c511e33e4159d9e` + `span {start:0,end:116}`。
- 即：**候选与核对双方都没有引用到真实原文范围**，而当前校验只要求 `digest` 非空（`source_ref.digest` 只校验非空），所以两者都被记录为"有效引用"。

方法学结论：**引用可核验是一条机械门槛（Gate），不是一条核对（Check）**——它由代码判定，不依赖模型；它一旦成立，"核对为什么贵/为什么拒"才可能被定位到具体 span。

### 5.3 差分与反例实验（我们的最小可行集合）

| 实验 | 做什么 | 允许得出的结论 | 不允许得出的结论 |
| --- | --- | --- | --- |
| **E1 调用形态对照（运行拓扑，不是参数）** | 同一输入形状、同一模型，比较"提议 + 独立核对"与"提议 + 机械门槛"两种**调用拓扑**下的请求数、生成量、墙钟、派发结果 | 核对这项机制在当前形状下放大了多少成本、它换来了什么（拒绝率/发现数） | 不能得出"核对不值得"；这需要评测（Evaluation）而非单次对照 |
| **E2 拒绝后修订 vs 整批重掷（差分）** | 对同一次拒绝，比较"重新生成整份候选"与"只提交字段级 patch 并只复核差异"的成本与结果 | 若后者在同等拒绝率下显著减少生成量且不放行错误，则"整批重掷"是结构性放大（机制 = 拒绝复制整批） | 不能证明 patch 一定更安全（放弃的理由：误报的反驳通道，见 T08/T11） |
| **E3 引用规范化后的核对（差分）** | 把候选/核对的引用换成代码生成的 SourceRef（真实 digest + 真实 span），其它不变 | 若核对 findings 从"分不清对象"变为"指向具体 span"，则"引用不可核验"是核对成本/误报的放大机制之一 | 不能证明核对范围已经正确（那要 T07 的范围设计） |
| **E4 形状扫描（把机制压小/换形状）** | 对同一任务族构造不同形状（单轮 vs 多轮、1 个原子 vs N 个原子、无拒绝 vs 强制一次拒绝），观察哪些量随之变化 | 标度关系的方向与量级（例如"生成量 ∝ 原子数"是否成立） | 不能把 49 个官方用例的通过率变化当作机制结论——形状扫描是自建材料，不是官方评分 |

**门槛约定建议**（供 T01 采用；本票不替 T01 下结论）：一条结论要写成"结构性"，至少满足：

1. 写明**放大机制**（一句话，形如"X 导致 Y 被重复 Z 次"）；
2. 写明**标度量**（随哪个量增长：原子数？事件数？被拒次数？）；
3. 有**至少两次不同形状下的观测**，且标度方向一致；
4. 有**至少一次反例尝试**（E1–E4 之一），并写明结果（变小 / 不变 / 变大都算结果）；
5. 明确列出**不成立的输入形状**（例如"单轮单原子时看不出这一项"）。

### 5.4 与现有记录的逐项对应

| 现有记录 | 现在有什么 | 缺什么（按本票方法） | 依据本票方法要补的判断 |
| --- | --- | --- | --- |
| `management_log[]` | 批次总时长、事件集合、状态、usage、错误、`retry` | 没有"这一批为什么发生"的形状参数（事件数/组数/原子数/是否因拒绝再推进） | 批次成本的标度与形状归属 |
| `management_calls[]` | 每次调用的 kind/时长/状态/usage（**已有但未暴露**） | 没有首包时间；没有"该调用是否携带上一批拒绝理由" | 调用级关键路径（propose vs check）；"重掷 vs 修订"机制可测 |
| `semantic_checks[]` | 结论、findings、任务、usage、模型、响应摘要 | **无时长**；findings 的引用不可核验；没有"核对判了什么维度" | 核对成本、误报率、维度覆盖率 |
| `atom_states[]` | 原子的生命周期状态与接替关系 | 没有"这个原子被派发几次/被拒绝几次"的计数（派发在 `dispatches`） | "原子层被重复"这一机制（T05/T06 的问题边界） |
| `dispatches[]` / `executions[]` | 派发身份、内容摘要、允许调用 | 与批次/事件的对齐关系（哪个批次派发了它） | 管理成本 vs 执行成本的分界（T03 的桶） |
| `audit-report.json` | D1–D9 的结构化事实（含 `cost.per_request`、`checks.independent`、`failures`） | per-call 切片；标度字段；引用可核验性 | 审计视角下的"结构成本"视图（T03 基线） |
| `budget`（run/批级） | 请求数、三类 token、cache_read、上限 | cache_write、成本（当前 `unavailable`）、队列/等待分解 | 把"被拒绝的尝试"正确计入成本而不是丢失（T10 §3） |

---

## 6. adopt-from（可借鉴的实现）

只列**有代码依据**的条目；纯文献条目在第 7 节末尾单列。

| 借用项 | 参考实现（仓库 + 文件/模块 + 许可证） | 抄哪一段 | 改写哪一段 | 适配到我们哪个文件 | 风险与代价 |
| --- | --- | --- | --- | --- | --- |
| 关键路径算法 | `jaegertracing/jaeger` → `cmd/jaeger/internal/extension/jaegerquery/internal/mcptools/internal/criticalpath/{criticalpath.go,find_lfc.go,find_lfc_test.go}`（Apache-2.0） | LFC（last-finishing child）递归 + 回退选择"在前一个子 span 开始前结束"的兄弟节点这一段 | 把"span 树"换成我们三层（批次→事件→调用）；把微秒时间戳换成我们记录的 ISO 时刻 + `duration_ms` | `src/runtime/audit-report.ts`（新增关键路径视图）；`src/core/intent-compiler-v2.ts`（提供调用级时间戳，已部分存在） | 需要**正确的时间戳**；我们的事件目前没有独立起止时刻，只有"写入时刻"，必须先补（否则算法退化为伪关键路径） |
| span/属性模型 | `open-telemetry/opentelemetry-specification` → `specification/trace/api.md`（Apache-2.0） | "每个 span 零或一个父、零或多个子"这一结构定义与 root span 概念 | 不照抄 API 名称；把我们已有的 `request_id`/`trigger_event_ids`/`management_call_sequence` 映射成 span 身份 | `src/core/intent-contract.ts`（如需导出审计用 span 视图）、`src/runtime/audit-report.ts` | 只借结构，不引入 OTel SDK；风险是"用结构掩盖缺失的时间戳"——必须同时补时间 |
| 差分剖析（反例实验的读数） | `google/pprof`（Apache-2.0）的 `-diff_base`；概念来源 Brendan Gregg *Differential Flame Graphs*（2014） | "两次采集做差、用差值着色"的读数方式 | 我们不做采样剖析，改为**三次运行记录做差**：基线 run / 改动 run / 形状变化 run | `src/runtime/cost-summary.ts` + `src/cli/cost-compare.ts`（已有比较入口，可扩展为多次对比） | 需要"可比性"约定（同一模型、同一输入形状）；否则差分会把条件差异算成机制差异 |
| 重复与方差 | `sharkdp/hyperfine`（Apache-2.0） | "warmup + 多次运行 + 统计摘要（均值/σ/离群）"的测量协议 | 我们不做 shell 计时，改为**对同一形状重复跑批**并报中位数与极差 | 实验脚本文档 + `src/runtime/cost-summary.ts` | 重复运行要付费/耗时；且重复本身会引入缓存效应（见 T10 的 cache 字段） |
| 重试预算与抑制 | `grpc/proposal` → `A6-client-retries.md`（Apache-2.0，`retryThrottling`）；`envoyproxy/envoy` → `docs/.../cluster_circuit_breakers.rst`（Apache-2.0，`retry_budget.budget_percent`/`min_retry_concurrency`） | "失败率超过阈值即抑制重试"的控制回路；"拒绝的重试要计入计数器"这一可观测约定 | 我们把"重试"限定为同批内的传输重发与"拒绝后再推进"；**不引入新的参数上限**，只把当前行为显式记录为 retry 事件 | `src/model/structured-provider-transport.ts`（重发计数）、`src/core/intent-compiler-v2.ts`（再推进的归属） | 若把抑制当作"少花钱"，就会撞上用户禁止的参数式收紧；这里只借"记录与归属"，不借阈值 |
| 单次调用合并（single-flight） | `golang/sync` → `singleflight/singleflight.go`（BSD-3-Clause） | "相同 key 的并发调用只执行一次、其余共享结果"的语义 | 我们已有派发幂等（dispatch 按内容身份去重，见 CURRENT-DESIGN §3.8），此处只借"相同输入 → 同一结果可复用"的判据 | `src/core/compiler-store-v2.ts`（如需把核对结论按 claim 内容摘要缓存，见 T11 文档 §5.4） | 若 key 选取过宽会把"输入其实变了"的调用也合并；必须用内容摘要而不是自然语言近似 |
| 内容寻址的增量 | `bazelbuild/bazel`（Apache-2.0）的 action cache / "content digest → 复用"设计（骨架级借鉴） | "输入摘要不变则输出可复用"这一因果结构 | 适配为"引用摘要（span+digest）+ 核对维度 → 已判定结论"的可复用键 | `src/core/compiler-store-v2.ts`（记录侧）；`src/core/intent-compiler-v2.ts`（判定侧） | 需要先有 5.2 的可核验引用；否则摘要不稳定，缓存会误命中 |

**仅文献（无代码依据，不进采纳清单）**：USE 方法；top-down 方法论（论文/文档）；workload characterization 综述；Little 1961；Amdahl 1967；Gustafson 1988；Tail at Scale 的扇出放大与 hedged/tied requests；metastable failures 的三要素与逃逸实验；Fisher/Montgomery/Wohlin 的实验设计（书）。

---

## 7. 开放问题

1. **"生成量"的最好标度是什么**：输出 token？含 reasoning 的输出 token？"reasoning × 权重"？r10 里 reasoning 占输出 84.2%——如果我们只报 output_tokens，标度会被 reasoning 与正文的混合比例污染。是否要分别报 `gen_ai.client.inference.usage.output_tokens` 与 `gen_ai.client.inference.usage.reasoning.output_tokens` 两个标度？（T10 会给出字段名）
2. **"批次"是不是合适的样本单位**：官方计分与任务单位是"任务/轮次"，我们的成本单位是"批次"。两者之间的换算（每任务几个批次）目前只有 r4–r10 这一小串样本，不足以定边界。
3. **拒绝判定是否属于"成本结构"**：拒绝是"核对"的输出，它决定后续批次数。按本票方法，它同时是"成本"与"质量"。归因时要不要把它折成两个量（拒绝率、每拒绝的边际成本）？——建议由 T01 决定边界，T07/T08 决定范围与反驳。
4. **能否在不降低官方难度的前提下做扰动实验**：E4 的形状扫描用的是自建材料；它证明不了官方 49 用例上的表现。是否接受"自建形状扫描 + 官方用例作为少数锚点"这一组合？需要用户拍板（属于"官方任务与计分"类问题）。
5. **离线重放的合法性**：本项目的重放（把历史管理请求重新发一遍）在历史上已经做过（`replay-2026-09-22-qwen`）。作为反例实验手段，它是否足以替代真实运行？（我们倾向于"重放用于机制定位，真实运行用于结论"，但需要确认。）
6. **多模型/多 provider 的对照什么时候需要**：用户排除了"换模型/provider 作为唯一出路"，但没有排除"为了归因做一次对照"。若要做，必须在同一形状下比较，并把差异明确归因到"模型"而不是机制。

---

## 8. 给 T01 的输入（可操作判据草案；**这是输入，不是 T01 的结论**）

### 8.1 "什么算结构性成本"（草案）

一条结论满足以下全部条件时，才允许在文档里写成"结构性成本"，否则只能写成"样本现象（候选）"：

1. **有机制句**：格式为"当输入形状为 S 时，机制 M 使量 Q 随 V 增长（比例/次数/倍率）"。禁止出现没有 M 的句子（例如"核对很贵"）。
2. **有标度关系**：写明 Q 与 V 的对应（至少是方向 + 一个量级），并说明在什么 V 下不放大（例如"单原子、无拒绝时不出现"）。
3. **有标签可核验的证据**：涉及的引用必须能被代码验证（真实 `source_id` + 真实 `digest` + 覆盖原文的 `span`）。引用不可核验时，结论自动降级为候选——这是 r10 的直接教训（第 5.2 节）。
4. **有反例尝试**：E1–E4 至少做过一次，并记录"机制变小 / 不变 / 变大"。
5. **有形状描述**：用形状参数（轮次、原子数、拒绝次数、事件数）而不是用例编号描述观测；官方 49 用例只能作为锚点出现，不能作为分布。

### 8.2 需要什么证据、什么类型的观察

| 结论强度 | 最少证据 | 说明 |
| --- | --- | --- |
| **现象（弱）** | 1 次运行 + 记录可核验 | 只允许写"在形状 X 下观察到 Y" |
| **候选结构（中）** | ≥2 次不同形状的观测，标度方向一致 + 1 次反例尝试 | 允许写"形状 S 下存在机制 M"，并要求列出不成立的形状 |
| **结构（强）** | 中等级证据 + 机制在**两种不同实现路径**下都能被观测到（例如"整批重掷"和"无理由的新批"两种路径下都出现放大） | 允许写"结构性成本"，并可进入 T04–T08 的设计输入 |

### 8.3 "什么算反例实验"（最小形态）

一个反例实验的最低要求：**改一个与机制直接相关的量（其它保持），并预先写下"如果机制为真，读数应如何变化"**。例如：

- 若"机制 = 拒绝后重掷整批"，则把重掷换成"只重提被拒字段"，读数应为：请求数不变而生成量下降；
- 若"机制 = 引用不可核验导致核对方差大"，则改用代码生成的引用，读数应为：findings 的可定位比例上升（引用能被解析到原文 span）；
- 若"机制 = 管理成本随原子数线性"，则把原子数从 1 改到 N，读数应为：生成量随 N 近似线性（在固定的每原子描述长度下）。

**预先写下预期**这一步不能省：否则任何结果都能被解释成支持原假设（这正是 r10 第一批"规则全指向用户原文"却没有被任何机械门槛拦下的原因）。

### 8.4 与 T01 其余部分的接口

- 8.1 的第 3 条需要 T10 的字段清单才能落地（字段名与归属在 `cost-instrumentation-research-2026-09-23.md`）。
- 8.1 的第 4 条与 T11 的"误报如何被反驳"共用同一套记录（findings 的维度、证据、反驳）。
- 8.2 的强度分级建议写进 T01 的判据，但"多少次观察算够"这类**统计口径**不应由本票拍板——本票只给出方法学下限（可重复 + 可读数 + 有对照）。
