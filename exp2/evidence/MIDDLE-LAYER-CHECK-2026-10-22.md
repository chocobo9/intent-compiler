状态文件：`D:/huawei/EvoCodeBench/harbor_runs/exp2-b12-accept-20261022/later-a/store/exp2-state.json`；修改时间：2026-10-22 17:08:24.692 UTC（America/Toronto：2026-10-22 13:08:24.692）。

# 1. 仅从需求原文建立的参照表

| 编号 | 修改轮次与行号 | 被修改的轮次、行为与行号 | 改动类型 | 改动内容 |
|---|---|---|---|---|
| C01 | R3:5–14 | R2:213–229，尤其 226；fill linear 单锚点边界留空 | 部分修订 | 单锚点改为常量外推，双锚点插值、无锚点留空及其他 fill 策略保留。 |
| C02 | R3:16–24 | R2:185–209，尤其 200、206；normalize zscore 总体标准差 | 部分修订 | zscore 改用样本标准差，补充 n<2 输出 0；minmax 不变，profile 总体标准差不变。 |
| C03 | R5:3–7、12、16 | R1:204–209；verify SHA-256 | 修订 | verify 摘要算法换成 BLAKE2b-256，比对接口与成功/失败输出保留。 |
| C04 | R5:8–9、12、15 | R1:211–227，尤其 216、222；manifest SHA-256 摘要 | 部分修订 | manifest 摘要换成 BLAKE2b-256，目录扫描、文件排序和时间戳保留。 |
| C05 | R5:10–11、17 | R1:35；ingest 生成 .sha256 | 撤回 | 取消 ingest 的 .sha256 sidecar，已有同名 sidecar 必须删除。 |
| C06 | R5:10–11、18 | R1:202；transform 生成 .sha256 | 部分修订 | 保留结果 CSV 输出，撤回 sidecar 输出并删除已有 sidecar。 |
| C07 | R6:5、9、15–16、72 | R1:248–250；确定性约定只豁免 manifest generated_at | 部分修订（隐含） | 启用 audit 后追加含执行时间及耗时的日志，新增不满足相同输入字节相同的输出例外。 |
| C08 | R7:3–24 | R5:35–44，尤其 41；lineage manifest 把 dir 作为输入节点 | 部分修订 | manifest 步骤无输入节点、无边，dir 不进节点，输出节点及其他步骤映射保留。 |
| C09 | R10:3–20 | R1:217–225 的 manifest 条目；R5:8–9、15 的算法更新；R10:5、10–13 自述旧字段 blake2b | 部分修订 | manifest 旧摘要字段换为 checksum 与 algorithm；算法不变。R5 未明定 blake2b 字段，旧字段首次出现于 R10 的旧格式说明。 |
| C10 | R12:3–12 | R2:185–209 的 normalize；R3:16–24 的 zscore 更新；旧默认行为由 R12:5、7 自述 | 部分修订 | method 省略或空时改走 minmax，等值数值行输出 0，显式 zscore/minmax 保留；R2 未明定省略方法的旧行为。 |
| C11 | R15:3–7 | R13:23、34、51–56；snapshot row_hash MD5/32 位 | 部分修订 | 同一排序行内容改算 SHA-256/64 位，其他字段及排序规则保留。 |

| 计数口径 | 数量 |
|---|---:|
| 原文参照行总数 | 11 |
| 修订 | 1 |
| 撤回 | 1 |
| 部分修订 | 9 |
| 明示 / 隐含 | 10 / 1 |
| 已逐轮阅读 | R1–R15，共 15 轮 |
| 无上述替换、撤回或旧行为修订的轮次 | R1、R2、R4、R8、R9、R11、R13、R14，共 8 轮 |

| 范围说明 | 依据 |
|---|---|
| 只添加新命令、新操作、新可选策略、新输出字段或新步骤类型，且不取消旧输入的既有行为，不另算修改行 | 如 R2:213–229 添加 linear 策略、R3:26–35 添加 p05/p95，以及各轮 Pipeline/Lineage extension |
| 同一行为的标题、解释、重复清单和示例合并为一行 | R5:14–18 重复 5–11；R7:14–24 重复 9–12 |
| C06、C08、C09、C11 按原文复合规则保留未修改部分；C03 是算法规则替换，接口另行保留 | 各行原文定位 |

# 2. 环节 2：改动分类

| 核对口径 | 依据 |
|---|---|
| 状态读取方式 | JSON 不直接存 objects；只读调用 source.ts 的 splitRound 与 registry.ts 的 materialize，根据 sources + rounds[].acceptance 还原各轮对象 blocks/state/modifications；没有调用 attribution/check/probe 模型函数，也没有运行检查或实验。 |
| 类型与有效状态 | registry.ts:9、18–27、45–70、194–259；归属父块的 state 与 modifications.parts 指向的句/子句分开核对。 |
| 行号与编号 | R<n>:行号指第 1 节指定的 round-NN.md；本文 C01–C11 是参照行，C3.2 等是 registry 的 ChangeRecord.id；K/P 是状态内稳定条目 id。 |
| 判定计数 | 每个参照行记一个主判定；类型已对应但旧范围吞入未修改规则，记旧块指错；多登另计。add 不等于已登记一条旧行为 modification。 |
| 原文一致性 | 状态 sources[].text 与指定 R1–R15 原文逐字相同，15/15；物化函数校验全部 source hash 通过。 |

| 参照行 | IC 是否登记这次修改 | IC 类型 | IC 旧块 → 新块 / 对象与变更编号 | 判定 | 依据 |
|---|---|---|---|---|---|
| C01 | 是 | partial | R2.S13.P4.s4 → R3.S2.P2；O8 / C3.2 | 一致 | 目标是 R2:226 的单锚点边界规则，其他 linear 规则未被标改。 |
| C02 | 是 | partial + revise + partial | R2.S11.P5.s3 → R3.S3.P1（partial）及 P2（revise）；R2.S11.P6.s4 → R3.S3.P3（partial）；O18 / C3.6 | 旧块指错 | P6.s4（R2:206）还包含未被撤回的非零公式 (x-mean)/stddev，却整句被覆盖，未细分 c3；P5.s3 同轮有两条记录。 |
| C03 | 是 | revise | R1.S4.P2 → R5.S1.P1；O9 / C5.3 | 旧块指错 | P2 覆盖 R1:208–209，连未修改的 VERIFIED/MISMATCH 与退出码规则 s2 也整体取代。 |
| C04 | 是 | partial | R1.S5.P2.s2 → R5.S1.P2.s2/s3/s4/s5/s6；O10 / C5.4 | 一致 | 旧目标是 R1:216 的 SHA-256 规则，目录扫描、排序与时间戳仍在。 |
| C05 | 是 | partial | R1.S2.P6.s3 → R5.S1.P2.s2/s3/s4/s5/s6；O2 / C5.1 | 类型错 | 原文撤回 sidecar 生成规则；modifications.kind 是 partial，未登记 withdraw。 |
| C06 | 是 | partial | R1.S3.P24.s1 → R5.S1.P2.s2/s3/s4/s5/s6；O3 / C5.2 | 旧块指错 | 目标 R1:202 整句还含写结果 CSV；sidecar 子句 c3 之外的 CSV 子句 c2 一并标改。 |
| C07 | 否 | add（R6 新 audit）；无对应 modification | 旧 R1.S7.P1（O12）→ 无；新 R6.S1、S2 等归 audit（O32） | 漏登 | O12 在 R6 无 modification，R1:250 的 only exception 仍为 active。 |
| C08 | 是 | partial | R5.S4.P3.s5、R5.S5.P2.s1、R5.S5.P3.s1 → R7.S1.P3.s1/s3/s4；O31 / C7.1 | 旧块指错 | 除 manifest 映射，还把 R5:66、71 的通用节点/边规则整句标改；R7 只改 manifest。 |
| C09 | 是 | revise | R1.S5.P2.s3 → R10.S1；O10 / C10.1 | 类型错 | R10 只改摘要字段；IC 用 revise 替换含完整 JSON schema 的 item，未作保留其他字段的 partial/amended。旧 blake2b 字段在更早原文中的定位不知道（R5 未命名）。 |
| C10 | 否 | add（R12.S2.P1/P2/P3）；无对应 modification | 旧块：不知道（R2/R3 未写默认方法旧行为）；新 R12.S2.P1/P2/P3，O18 / C12.1 | 漏登 | R12 明示的默认方法纠正仅作为 add 登记，没有旧行为改动关系；不能据此虚构一个旧默认规则块。 |
| C11 | 是 | partial | R13.S7.P1.s8/s9 → R15.S2.P1.s1/s2；R13.S4.P1、S5.P1、S7.P1.s9 → R15.S2.P2.s1；O41 / C15.1 | 一致 | 算法/长度规则被覆盖，代码示例与字段表列入 amended，其他字段和排序保留。 |

| 计数范围 | 一致 | 漏登 | 类型错 | 旧块指错 | 多登 |
|---|---|---|---|---|---|
| 11 个参照行 | 3 | 2 | 2 | 4 | 0 |
| 下表额外登记 | 0 | 0 | 0 | 0 | 1 |
| 合计 | 3 | 2 | 2 | 4 | 1 |

## 2.1 参照表中没有的修改（多登）

| 编号 | 轮次 / IC 类型 | IC 旧块 → 新块 | 原文依据 | 判定 |
|---|---|---|---|---|
| X01 | R2 / revise；O8 / C2.2 | R1.S3.P22、R1.S3.P23 → R2.S13 | R2:215 明说 additional strategy；R1:189–200 的 forward/backward/constant 和通用 fill 规则未撤回。 | 多登 |

| 计数口径 | 数量 |
|---|---|
| 多登的 assignment（X01） | 1 |
| 由该 assignment 产生的旧 Ownership modification | 2 |
| 全部非 add/none assignments | 11 |
| 还原的全部 Ownership modifications | 18 |
| 全部 modifications.parts 目标次数（同一旧块可重复） | 19 |
| R3 同一旧块 R2.S11.P5.s3 同时有 partial 与 revise；都对应 C02，不另算无参照多登 | 2 |

# 3. 环节 4：修改当轮的当前有效视图

| 读取口径 | 依据 |
|---|---|
| 只使用修改当轮已接受记录 | 每轮物化均只取 round<=当轮的 sources 与 acceptance；不拿 R15 最终状态冒充历史状态。 |
| state 与被改子块 | Ownership.state 存在于归属父块；parts 下句/子句没有单独 Ownership.state。workorder.ts:199–216 把普通 parts 标 revised/withdrawn，amended 则保留旧文本及新覆盖文本；attribution.ts:158–161 将非 amended parts 列为 modified。 |
| 部分修订的判定 | 父块 partially_modified 本身不足以证明未改部分仍有效；逐项核对 parts 是否吞入未变规则以及 amended 列表。 |

| 参照行 | 旧块编号 | IC 当轮 state / 标记 | 按原文应当是什么；未改部分是否保留 | 判定 |
|---|---|---|---|---|
| C01 | R2.S13，parts=R2.S13.P4.s4 | R3：partially_modified；s4 标 revised | 父块部分修改，边界规则改用 R3；双锚点、数值解析及格式继续有效。 | 对 |
| C02 | R2.S11，parts=P5.s3、P6.s4 | R3：partially_modified；P5.s3 两次标 revised，P6.s4 整句标 revised | 样本标准差与 n<2 例外生效；P6.s4.c3 的非零公式仍应有效；minmax 保留。当前 c3 同在被覆盖的 s4 内，未独立保留。 | 错 |
| C03 | R1.S4.P2（R1:208–209） | R5：superseded | 应只改 s1 的算法；s2 的 VERIFIED/MISMATCH 与退出码继续有效，整个 P2 不应 superseded。 | 错 |
| C04 | R1.S5.P2，parts=s2 | R5：partially_modified；s2 标 revised | SHA-256 算法被替换，s1 的递归扫描及 s4/s5 的排序和时间戳有效。 | 对 |
| C05 | R1.S2.P6，parts=s3 | R5：partially_modified；s3 标 revised（kind=partial），非独立 Ownership.state | 生成 sidecar 的旧 s3 不再有效；s1/s2 的有效/拒绝 CSV 和排序继续有效；父块应部分修改。kind 的差异已计于环节 2。 | 对 |
| C06 | R1.S3.P24，parts=s1 | R5：partially_modified；唯一句 s1 整句标 revised | 应仅撤回 s1.c3 的 sidecar 输出，s1.c2 的结果 CSV 输出仍有效；IC 的 parts 包含整个 s1。 | 错 |
| C07 | R1.S7.P1（R1:250） | R6：active；modifications=[] | 普通输出保持确定性，manifest 时间戳例外保留，audit 日志增加例外；旧 only exception 不能无修订继续有效。 | 错 |
| C08 | R5.S4.P3；R5.S5.P2；R5.S5.P3 | R7：三个父块均 partially_modified；parts 分别为 s5、s1、s1，均标 revised | manifest 不再有输入节点/边；R7.S1.P3.s2 保留输出节点；R5:66、71 对其他步骤的通用规则应继续有效，IC 把两条通用句也标改。 | 错 |
| C09 | R1.S5.P2，parts=s3（R1:217–225） | R10：partially_modified；s3.kind=item，modification.kind=revise，amended 缺省；s3 标 revised | 应保留 files 容器、rows、size_bytes、path、generated_at，只改摘要字段；包含示例的整条 item 不应整体失效。 | 错 |
| C10 | 旧默认行为块：不知道；可定位显式方法父块 R2.S11 | R12：R2.S11 为 partially_modified（仅有 R3 的 modifications）；R12.S2.P1/P2/P3 为 active | 显式方法仍有效，新的默认 minmax 文本有效；旧默认行为是否被正确取代不知道，缺 R12 之前规定省略/空 method 行为的原文块。 | 不知道 |
| C11 | R13.S4、R13.S5、R13.S7 | R15：均 partially_modified；S4.P1、S5.P1 在 modifications.amended；S7.P1.s8/s9 标 revised | JSON 示例与字段表 amended 保留未变字段；排序/拼接 s5/s6/s7 保留；MD5/32 位被 SHA-256/64 位替换。 | 对 |

| 计数范围 | 对 | 错 | 不知道 |
|---|---|---|---|
| 11 个参照行 | 4 | 6 | 1 |

## 3.1 多登 X01 的有效视图

| 参照行 | 旧块编号 | IC state | 按原文应当是什么 | 判定 |
|---|---|---|---|---|
| X01 / R2 | R1.S3.P22（R1:189–192） | superseded | 旧策略参数继续有效，linear 只是新增策略。 | 错 |
| X01 / R2 | R1.S3.P23（R1:194–200） | superseded | forward/backward/constant、非空不改、行序及缺列错误继续有效。 | 错 |

| 计数范围 | 对 | 错 | 不知道 |
|---|---|---|---|
| X01 额外旧块 | 0 | 2 | 0 |
| 主表按参照行 + 附表按旧块（混合口径，不作为主表总数） | 4 | 8 | 1 |

# 4. 环节 5 和 8：旧行为依据的检查与探针

| 计数/证据口径 | 内容 |
|---|---|
| 清单范围 | 扫描 checks 全部 147 条（139 admitted、8 unknown）和 probes 全部 436 条；读取输入 args/files、assertions、reference_script 文本、covers.case/trigger_values/wrong_would 及全部事件；没有执行 reference_script 或探针。 |
| 旧条目 | 仅纳入修改轮之前已存在的条目；新轮产生的替代条目不算原旧条目已过期。checks.admission=unknown 没有进入库，另列且不计应过期。 |
| 直接引用 | 表中“是”指 checks.blocks/assertions.source 或 probes.covers 与 IC modifications.parts 重叠（含祖先/后代）；“否”指不重叠。是否实质依赖旧行为另看输入/计算依据，不能用引用是否重叠代替。 |
| 语义判定 | 直接包含被修改规则的库引用可构成需要重新导出依据，即使某个样例值恰巧相同；只覆盖该句未变 case 的探针、仅靠对象边被牵连而输入/预期不受影响的条目，记不该过期。 |
| 未知界限 | 探针只存输入与 covers/wrong_would；judgments、judge_calls、probe_measures 均为 0。无法从这些字段证明使用旧数值期望的候选写不知道。 |
| 事件定位 | 下标为 JSON 数组的 0-based 下标；条目另可按 checks[].id / probes[].id 找到。“是否过期”同时查看 stale 与 retired，同一条目先 stale 后 retired 只计一个。 |
| 规则代码 | checks.ts:122–157、167–169、196–240、424–426；probes.ts:279–295。K1/K80 的 unknown 断言不算执行中的断言，但这两条 admitted 库记录仍直接引用旧规则。 |

| 参照行 | 依据旧行为或被牵连的条目编号 | 引用的块是否就是被修改块 | 是否被标过期/退役 | 判定 | 输入/预期/引用依据 |
|---|---|---|---|---|---|
| C01 | P95（R3 核对） | 是 | 是（R3 probe_events[14] stale） | 正确过期 | covers=R2.S13.P4.s4；wrong_would 明说边界应留空；R3 改为外推。 |
| C02 | K43（R3 核对） | 是 | 是（R3 check_events[0] stale） | 正确过期 | blocks=R2.S11.P5.s3、P6.s4；reference_script 用 statistics.pstdev；nzm 恰为 0，但旧计算依据已改。 |
| C02 | P145（R3 核对） | 是 | 是（R3 probe_events[15] stale） | 正确过期 | covers=R2.S11.P5.s3；wrong_would 将 sample stddev 当错误。 |
| C02 | P146（R3 核对） | 是 | 是（R3 probe_events[16] stale） | 正确过期 | covers=R2.S11.P6.s4；输入 2、2、8，读取 zscore 数值和格式。 |
| C02 | P148（R3 核对） | 是 | 是（R3 probe_events[17] stale） | 不该过期却过期 | covers 的 case 只测 R2.S11.P6.s4.c1/c2 的等值输出 0；输入 7、7，R3:22 保留该规则。 |
| C02 | P144（R3 核对） | 否 | 否（当轮及其后均无事件） | 不知道 | 输入 value=2、2、8 且 method=zscore；covers=R2.S11.P2.s1、P3.s1/s2/s3，wrong_would 仅区分错误方法/列/表头；不知道是否固定使用旧总体标准差数值，缺该探针的实际期望或裁判计算记录。 |
| C03 | K2（R5 核对） | 是 | 是（R5 check_events[2] stale；[11] retired） | 正确过期 | verify-match 输入 digest.txt 由 SHA-256 产生；v-ok-exit/v-ok-out 期待匹配。 |
| C03 | K3（R5 核对） | 是 | 是（R5 check_events[3] stale；[12] retired） | 正确过期 | v-bad-out 固定包含旧 SHA-256 actual；blocks=R1.S4.P2。 |
| C03 | K9（R5 核对） | 是 | 是（R5 check_events[5] stale） | 正确过期 | reference_script 用 hashlib.sha256 填 sum；cli-exit=0、cli-out=VERIFIED；assertions.source=R1.S4.P2.s2 落在 IC 整体替换的 P2 内。 |
| C03 | P82（R5 核对） | 是 | 是（R5 probe_events[20] stale） | 正确过期 | covers=R1.S4.P2.s1/s2；sum.txt 是空文件 SHA-256 e3b0…b855。 |
| C03 | P83（R5 核对） | 是 | 是（R5 probe_events[21] stale） | 正确过期 | covers=R1.S4.P2.s1/s2，检查 MISMATCH expected/actual，实际摘要算法改变。 |
| C03 | P86（R5 核对） | 否 | 否（当轮及其后均无事件） | 应过期未过期 | 只引用 R1.S6.P1.s1；pipeline 调 verify，sum.txt=e3b0…b855（空文件 SHA-256），旧成功输入在 R5 失效。 |
| C03 | K8（R5 核对） | 否 | 否（当轮及其后均无事件） | 应过期未过期 | 只引用 R1.S6.P1/P2；pipeline 期望 ingest 的 SHA-256 sidecar 可被 verify 成功消费，pipe-exit=0。 |
| C03 | P9（R5 核对） | 否 | 是（R5 probe_events[18] stale） | 正确过期 | pipeline ingest→transform→verify 消费旧 SHA-256 sidecar；事件实际由 C05 的 R1.S2.P6.s3 触发。 |
| C04 | K15（R5 核对） | 是 | 是（R5 check_events[7] stale；[13] retired） | 正确过期 | mf-hash 是旧 SHA-256 值，pointer 指向 /files/0/sha256；blocks=R1.S5.P2。 |
| C04 | P84（R5 核对） | 是 | 是（R5 probe_events[22] stale） | 正确过期 | covers=R1.S5.P2.s2；wrong_would 要求文件对应 sha256 摘要。 |
| C05 | K1（R5 核对） | 是 | 是（R5 check_events[1] stale） | 正确过期 | blocks 包含 R1.S2.P6（含 s3）；i-sha 已在 unknown，不当作执行断言，但库条目仍直接引用旧 sidecar 规则。 |
| C05 | K10（R5 核对） | 是 | 是（R5 check_events[6] stale） | 正确过期 | iv-digest 从 clean.csv.sha256 第 1 行读固定 SHA-256；blocks=R1.S2.P6。 |
| C05 | P9（R5 核对） | 是 | 是（R5 probe_events[18] stale） | 正确过期 | covers=R1.S2.P6.s3，要求 clean.csv 的 checksum 文件；同一输入也消费 final.csv.sha256。 |
| C05 | K8（R5 核对） | 否 | 否（当轮及其后均无事件） | 应过期未过期 | config.json 第 2 步 verify clean.csv.sha256，输入文件未预置 sidecar；pipe-exit 仍为 0。 |
| C05 | K7（R5 核对） | 否 | 是（R5 check_events[4] stale） | 不该过期却过期 | 仅测缺失 missing.csv 的退出码和报错（R1.S8.P1.s1）；R5 未修改此错误规则。 |
| C05 | K17（R5 核对） | 否 | 是（R5 check_events[8] stale） | 不该过期却过期 | 仅测未知 op 错误（R1.S8.P1.s3）；输入不依赖 sidecar。 |
| C05 | K18（R5 核对） | 否 | 是（R5 check_events[9] stale） | 不该过期却过期 | 仅测 malformed JSON（R1.S8.P1.s4）；输入不依赖 sidecar。 |
| C05 | K19（R5 核对） | 否 | 是（R5 check_events[10] stale） | 不该过期却过期 | 仅测无效正则错误（R1.S8.P1.s5）；输入不依赖 sidecar。 |
| C05 | P87（R5 核对） | 否 | 是（R5 probe_events[23] stale） | 不该过期却过期 | 只测 verify 输入文件 absent.csv 缺失；摘要文件虽是 SHA-256，缺文件路径不进入摘要比对；covers=R1.S8.P1.s1。 |
| C05 | P88（R5 核对） | 否 | 是（R5 probe_events[24] stale） | 不该过期却过期 | 只测 ingest 拒绝 bad、保留 2 且成功退出；covers=R1.S8.P1.s2。 |
| C05 | P89（R5 核对） | 否 | 是（R5 probe_events[25] stale） | 不该过期却过期 | 只测未知 op teleport；covers=R1.S8.P1.s3。 |
| C05 | P90（R5 核对） | 否 | 是（R5 probe_events[26] stale） | 不该过期却过期 | 只测 broken.json 解析错误；covers=R1.S8.P1.s4。 |
| C05 | P91（R5 核对） | 否 | 是（R5 probe_events[27] stale） | 不该过期却过期 | 只测 pattern=[ 错误；covers=R1.S8.P1.s5。 |
| C06 | P44（R5 核对） | 是 | 是（R5 probe_events[19] stale） | 正确过期 | covers=R1.S3.P24.s1.c3，wrong_would 明列缺少 result.csv.sha256 为错。 |
| C06 | P9（R5 核对） | 否 | 是（R5 probe_events[18] stale） | 正确过期 | 输入第 3 步 verify final.csv.sha256，未引用 R1.S3.P24；已由 C05 同轮标 stale。 |
| C08 | K80（R7 核对） | 是 | 是（R7 check_events[14] stale） | 正确过期 | blocks=R5.S4.P3.s5；pipeline.json 包含 manifest dir=data；lg-nodes/edges/steps 在 unknown，仅 lg-exit 入库，仍有明确旧行为引用。 |
| C08 | P296（R7 核对） | 是 | 是（R7 probe_events[28] stale） | 正确过期 | covers=R5.S4.P3.s5.c1；wrong_would 要求 data-dir 为单一输入节点。 |
| C09 | K79（R10 核对） | 是 | 是（R10 check_events[18] stale） | 正确过期 | mb-digest 读取 /files/0/sha256；blocks=R1.S5.P2；新格式使用 checksum。 |
| C09 | P85（R10 核对） | 是 | 是（R10 probe_events[29] stale） | 正确过期 | covers=R1.S5.P2.s3；wrong_would 把缺少 sha256 字段当错误。 |
| C09 | K93（R10 核对） | 否 | 是（R10 check_events[19] stale） | 不该过期却过期 | 只运行 lineage，断言节点、边、steps；不读 manifest 内容，R10 不改变 R7:9–12。 |
| C09 | P335（R10 核对） | 否 | 是（R10 probe_events[30] stale） | 不该过期却过期 | 只测 lineage manifest 无输入节点/无边；covers=R7.S1.P3.s1/s4、S2.P1.s2。 |
| C09 | P336（R10 核对） | 否 | 是（R10 probe_events[31] stale） | 不该过期却过期 | 只测 lineage manifest 输出节点和 produced_by；covers=R7.S1.P3.s2、S2.P2.s2。 |
| C11 | K130（R15 核对） | 是 | 是（R15 check_events[21] stale） | 正确过期 | sn-hash=7707d8209fa864332943291152f81bce，32 位 MD5；引用 R13.S4.P1、S5.P1、S7.P1.s8/s9。 |
| C11 | P410（R15 核对） | 是 | 是（R15 probe_events[32] stale） | 正确过期 | covers=R13.S4.P1.s1、S5.P1.s1；wrong_would 明列 MD5 row_hash。 |
| C11 | P412（R15 核对） | 是 | 是（R15 probe_events[33] stale） | 正确过期 | covers=R13.S7.P1.s8；wrong_would 将 SHA-256 当错误。 |
| C11 | P413（R15 核对） | 是 | 是（R15 probe_events[34] stale） | 正确过期 | covers=R13.S7.P1.s9；wrong_would 将 64 位摘要当错误。 |
| C11 | P411（R15 核对） | 否 | 否（当轮及其后均无事件） | 不知道 | covers=R13.S7.P1.s4，wrong_would 检查排序行内容与原始字节；不知道是否固定使用旧 MD5 期望，缺实际 hash 期望或裁判计算记录。 |

| 无旧依赖条目的参照行 | 条目数 | 依据 |
|---|---|---|
| C07 | 0 | R6 前无使用 --audit 的条目；R1 确定性块仅被 K16、P85 用于 manifest 时间戳，R6 未改变该例外。 |
| C10 | 0 | R12 前的 normalize 输入均指定 zscore 或 minmax，没有省略/空 method 的 checks/probes；K126/K127、P403/P404 是 R12 新条目。 |

| 计数范围 | 正确过期 | 应过期未过期 | 不该过期却过期 | 不知道 | 合计 |
|---|---|---|---|---|---|
| 主表按“参照行×条目” | 25 | 3 | 13 | 2 | 43 |
| 主表按“轮次×条目”去重 | 23 | 2 | 13 | 2 | 40 |
| 其中 checks（去重） | 10 | 1 | 5 | 0 | 16 |
| 其中 probes（去重） | 13 | 1 | 8 | 2 | 24 |

| 逐参照行计数 | 正确过期 | 应过期未过期 | 不该过期却过期 | 不知道 |
|---|---|---|---|---|
| C01 | 1 | 0 | 0 | 0 |
| C02 | 3 | 0 | 1 | 1 |
| C03 | 6 | 2 | 0 | 0 |
| C04 | 2 | 0 | 0 | 0 |
| C05 | 3 | 1 | 9 | 0 |
| C06 | 2 | 0 | 0 | 0 |
| C07 | 0 | 0 | 0 | 0 |
| C08 | 2 | 0 | 0 | 0 |
| C09 | 2 | 0 | 3 | 0 |
| C10 | 0 | 0 | 0 | 0 |
| C11 | 4 | 0 | 0 | 1 |

| 重复口径 | 次数 |
|---|---|
| K8 同轮同时涉及 C03/C05，按条目去重减去 | 1 |
| P9 同轮涉及 C03/C05/C06，按条目去重减去 | 2 |

## 4.1 应过期未过期，且引用块不是被修改块

| 条目 | 参照行 / 修改轮 | 实际引用 | 未被引用但输入依赖的行为 | 事件 |
|---|---|---|---|---|
| K8 | C03、C05 / R5 | R1.S6.P1、P2；pipe-exit 来源 R1.S6.P2.s3 | ingest 生成 clean.csv.sha256（R1:35），verify SHA-256（R1:208）；config.json 第 2 步直接消费 clean.csv.sha256；R5:5、10–11、17 使旧成功预期失效。 | check_events 无 K8。 |
| P86 | C03 / R5 | R1.S6.P1.s1 | pipeline 调 verify，空文件的 sum.txt 固定为 SHA-256 e3b0c442…7852b855；R5:5 改为 BLAKE2b-256，旧匹配输入失效。 | probe_events 无 P86。 |

| 计数口径 | 数量 |
|---|---|
| 按唯一条目 | 2 |
| checks / probes | 1 / 1 |
| 按参照行×条目 | 3 |
| P144、P411 证据不足，未混入本表 | 2 |

## 4.2 没有入库的旧候选与未受影响的对照

| 参照行 | 条目 | 引用/输入依据 | 处理 | 计数 |
|---|---|---|---|---|
| C01 | K25 | 引用 R2.S13.P4.s4；fl-leading 位于 unknown；admission=unknown、assertions=[]。 | 未入库，不记应过期未过期。 | 1 |
| C06 | K12 | 引用 R1.S3.P24；to-sha 位于 unknown；admission=unknown、assertions=[]。 | 未入库，不记应过期未过期。 | 1 |
| X01 | K6 | 引用 R1.S3.P22/P23；admission=unknown、assertions=[]。 | 未入库，不计过期传播错误。 | 1 |
| C04 | P85（R5 时） | wrong_would 只列字段与时间戳；R5 未明定把 sha256 字段改名，摘要字段命名不作为 R5 必须过期的证据。 | R5 不计漏过期；R10 字段替换按 C09 计正确过期。 | 1 |
| C07 | K16、P85 | 引用 R1.S7.P1.s3，仅检查 manifest generated_at。 | R6 的 audit 不改变该断言/覆盖目标。 | 2 |
| C08 | K83、P298 | pipeline→lineage 的内层只有 profile 步骤。 | R7 manifest 映射修改不影响该输入。 | 2 |
| C09 | P337 | 只检查 lineage manifest steps/output；不读 manifest 文件内容。 | R10 未标 stale，未列入异常。 | 1 |
| C11 | K132、K133、P415、P416 | 只检查 snapshot 的行数/文件生成或 lineage 文件映射。 | R15 摘要算法不改变这些目标，未列入异常。 | 4 |

| 计数范围 | 未入库候选 | 对照条目提及次数 |
|---|---|---|
| 本表 | 3 | 10 |

## 4.3 参照表以外的全部过期事件

| 参照行/轮次 | 条目编号 | 引用是否为被修改块 | 是否标过期 | 判定 | 依据 |
|---|---|---|---|---|---|
| X01 / R2 | P11、P12、P13、P14、P15、P16、P17 | 否 | 是：probe_events[0–6] | 不该过期却过期（7 条） | 引用 R1.S3.P2 的 transform/filter/derive；输入仅 derive/filter，无 fill；R2:215 新增 linear 未改变这些行为。 |
| X01 / R2 | P75、P76、P77、P78、P79、P80、P81 | 是（IC 错改的旧块） | 是：probe_events[7–13] | 不该过期却过期（7 条） | 引用 R1.S3.P22/P23；输入测 forward/backward/constant/缺列，R2:215 未撤回这些行为。 |
| 无对应修改 / R8 | K85 | 否 | 是：check_events[15] | 不该过期却过期 | 检查 profile 缺文件的 audit 错误；R8:76–77 只添加 quality 缺文件/空 CSV 错误，未改 R6:18 的 audit error 字段。 |
| 无对应修改 / R9 | K94 | 否 | 是：check_events[16] | 不该过期却过期 | 事件引用 R9.S1.P2（R9:9–13）；新 schema 使用 quality 的类型逻辑，未修改 R8:20–27 的 quality 规则，未确定新的空列类型。 |
| 无对应修改 / R9 | K99 | 否 | 是：check_events[17] | 不该过期却过期 | 事件同引 R9.S1.P2；新 schema 规则没有修改 R8:72 的 quality JSON 格式，也没有解决 qf-file 的键序 reading。 |
| 无对应修改 / R14 | K11 | 否 | 是：check_events[20] | 不该过期却过期 | 事件引用 R14.S8（R14:55–63）的 changelog pipeline 扩展；K11 输入第 1 步 ingest 缺文件，旧 R1:245 的停止/报错行为未变。 |

| 计数范围 | 正确过期 | 应过期未过期 | 不该过期却过期 | 不知道 |
|---|---|---|---|---|
| 本附表：checks / probes | 0 | 0 | 4 / 14 | 0 |
| 本附表总计 | 0 | 0 | 18 | 0 |
| 主表去重 + 本附表 | 23 | 2 | 31 | 2 |

| 事件总账 | 数量 |
|---|---|
| check_events：stale / retired | 19 / 3 |
| probe_events：stale | 35 |
| 唯一已过期条目（19 checks + 35 probes） | 54 |
| 54 个已过期条目的判定：正确 / 不该过期 | 23 / 31 |
| 另有已确认未过期条目（K8、P86） | 2 |
| 另有未能定性的候选（P144、P411） | 2 |
| 已审全部事件条数 | 57 |
| K2、K3、K15 的 retired 与同轮 stale 重复，不另增条目 | 3 |

| 核对文件身份与只读范围 | 结果 |
|---|---|
| 状态文件 SHA-256 | f10da50e4dc4100377f1e876275888be7b77944d4eb400f17abf1bc0226263ad |
| 状态文件修改时间（精确） | 2026-10-22T17:08:24.692Z；America/Toronto：2026-10-22 13:08:24.692。 |
| 已知人工结果的使用 | 读取指定 VERIFY-2026-10-22.md；仅用其 K8 旧 sidecar 记录与本次 JSON 核对交叉确认；未读取其提到的官方 tests/solution 或 official 目录。 |
| 本次新增写入 | 仅本报告；自有临时目录中另有纯只读 JSON/registry 解析模块，无其他产出文件。 |
| 模型接口 / 实验 / 官方测试及答案读取 / git 提交 | 0 / 0 / 0 / 0。 |


# 5. 观察到的问题

| 编号 | 现象与计数 |
|---|---|
| 1 | 11 项参照修改中，改动分类一致 3 项、漏登 2 项、类型错 2 项、旧块指错 4 项；另有 1 次多登 assignment 涉及 2 个旧块。 |
| 2 | C02、C03、C06、C08 的旧范围包含未改变的公式、返回规则、CSV 输出或通用图规则，共 4 项。 |
| 3 | R2 把原有 fill 参数与行为两块标成 superseded，R2 的原文只增加 linear 策略。 |
| 4 | R5 对 ingest sidecar 撤回登记为 partial，R10 对 manifest 部分字段修改登记为 revise，共 2 项类型差异。 |
| 5 | R6 的确定性例外没有旧块 modification，R12 的默认方法纠正只登记 add，共 2 项未建立旧行为修改关系。 |
| 6 | 11 项参照行的当轮有效视图为对 4 项、错 6 项、不知道 1 项，另有多登 X01 的 2 个旧块视图错误。 |
| 7 | K8、P86 共 2 个唯一条目在 R5 仍使用旧依赖且没有过期事件，两者都未直接引用相应被修改块。 |
| 8 | 全部 54 个唯一已过期条目中，23 个正确过期、31 个对应的覆盖目标没有被该轮修改。 |
| 9 | P144、P411 共 2 个候选缺少实际期望或裁判计算记录，无法确定是否应因数值算法变化而过期。 |
| 10 | R12 之前的需求没有明确写出默认 normalize 的旧行为，R10 所称旧 blake2b 字段未在 R5 原文命名，共 2 处旧来源定位缺口。 |

