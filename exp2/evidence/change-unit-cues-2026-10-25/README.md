# 变化单元的作者线索提取（DESIGN-DEEP §7 第 2 步，2026-10-25，零模型成本）

问题：DESIGN-DEEP §1.1 说变化单元的第一来源是作者线索（代码可抓）。这一步只用正则在四个任务上数线索，看 cue 层能给出多少，以及它是否覆盖已知的丢分点。脚本 cues-units.py，输出 cues-units.txt，dpipe 的命中句子在 dpipe-cue-sentences.txt。

六类线索：changes_to（"Changes to `X`"段）、cross_list（"all commands / across …"）、prev_new（previously…now / instead of / no longer / now uses…）、scope_unchanged（未提到的行为照旧 / 继续成立）、author_id（F12、Section 21、round-3、v2 这类作者编号）、cmd-in-rev（修订句里点名的命令：`X` … now/no longer/instead）。

## 结果（合计）

| 任务 | 轮 | changes_to | cross | prev/new | scope | author_id | cmd-in-rev |
|---|---|---|---|---|---|---|---|
| dpipe（d5_w9）| 15 | 0 | 1 | 10 | 1 | 0 | 18 |
| d10_w4 migration | 7 | 0 | 0 | 9 | 18 | 78 | 9 |
| d12_w1 flowr | 7 | 0 | 0 | 7 | 6 | 173 | 19 |
| d8_w5 pipeline.sh | 11 | 5 | 3 | 5 | 0 | 2 | 4 |

## 读法

1. **线索层在不同任务上形态完全不同**：dpipe 几乎只有"修订句里点名命令"这一种；d10_w4 每轮一段范围声明加大量编号引用；d12_w1 靠 F 编号；d8_w5 用"Changes to X"分段。cue 层必须按类抓，不能指望一种写法。
2. **dpipe R5 的横切变更，作者写明了**（dpipe-cue-sentences.txt）：
   - "`manifest` command: produces BLAKE2b-256 checksums instead of SHA256."
   - "`ingest` command: no longer writes `.sha256`…" / "`transform` command: no longer writes…"
   - "The `verify` command still reads the checksum file…"
   四个命令在同一轮的修订句里被逐一点名。代码侧的 cmd-in-rev 规则把它们放进同一个变化单元，审查请求按单元列出四个命令，manifest 就不会漏（rep1j 丢 10、rep1k 丢 5 的那处）。**这是 cue 层能覆盖已知丢分点的一例，不是推断。**
3. R2、R3 的 cmd-in-rev 也对：fill 的 linear 策略、normalize 改样本标准差、pipeline 新步骤类型——都是早轮命令被本轮改动的句子。
4. dpipe 只有 1 处范围声明、0 处作者编号，所以在 dpipe 上 cue 层主要就是 cmd-in-rev；`revision` 和 `guard` 两种来源要补足其余。在 d10_w4 上范围声明每轮都有，"全部守卫在力"可以直接由代码读出。

## 局限

正则粗；author_id 会把 `v2` 之类算进去，d12_w1 的 173 里有不少是特性编号的重复引用，不是 173 个单元。cmd-in-rev 只抓反引号命令名，散文式点名（"the manifest command"）抓不到。这一步只回答"有没有、在哪"，不回答精度。
