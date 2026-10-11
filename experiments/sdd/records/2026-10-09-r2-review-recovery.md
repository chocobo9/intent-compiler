# R2 保留次数的独立复审恢复

父系列 `050058z-f8d50c5b`、父R2 `050125z-10784540` 保持停止和原结果。针对增量设计审查边界纠正，启动一次显式复审恢复：

`D:/huawei/EvoCodeBench/harbor_runs/sdd-luna-dpipe-r2-20261009-060241z-a73e7a7c`

2026-10-09 06:03:01 UTC 启动，模型保持 openai/gpt-6-luna-fast / high-fast。它是新编排会话承接同轮冻结产物，不宣称恢复旧模型内存，也不重新开发R1/R2规格。

## 实现和限制

- `recover_design.py` 只接受文档通过、设计未接受、作者额度耗尽且仍有独立审查额度的停止运行；核对 completion 与账本一致、模型一致、进程及容器收尾、外置规格相对路径和未接受的生命周期状态。拒绝恢复记录再次恢复。
- 复制原 output/repos 和已通过的三个文档状态；原产物及计数保持，原运行外的单次 claim 防重复创建。绑定父 completion、账本、文档、源码和日志哈希。
- 新账本保留原 started/deadline/stages/counts/admitted/events/policy_hash。原 stop_reason 保留在不可变父账本；派生账本显式记录 prior_stop_reason 和 recovery 事件，再允许使用剩余配额。这是介入，不是普通的重新初始化预算。
- 作者仍6/6、独立审查继承2/6，产品修复0/3。新增作者调用仍拒绝；复审仍按原限额计数。无时间截止，规格修订仍5次，coding2、PRD1。
- `run_r1.py` 对带恢复清单的运行只执行 specart 设计子阶段，跳过已完成文档；独立复审通过后按上游生命周期机械验证和 accept-design，再允许 coding。未写入任何宿主PASS。
- 启动前校验父证据、复制产物及派生账本；设计结束后核对源码和继承文档/规格未被更改，避免复审借机继续修订。原 PRD、最终验证和官方测试流程保持。

## 离线验证

`test_design_recovery.py test_run_r1.py test_runtime_results.py test_series.py`：37 passed。覆盖原账本不变、所有计数和时间保留、可用复审计数累加、作者及复审超额拒绝、文档阶段跳过、源码新增/改写阻断、启动前产物/账本漂移拒绝，以及原运行器和串行行为。

## 06:08 UTC 检查：复审通过，路径迁移缺陷阻断机械验收

独立审查 `ses_ee0bd4fdfffe123QJZJt5PgQwS` 在06:04:49返回PASS。Root在06:05:18结束设计，原因是start-design找不到task record、accept-design找不到before.json，未进入coding。运行06:05:34结束；作者仍6次，审查累计3次。

归因：恢复入口复制了 `repos/main/.specart-verify/d23a50305b669c09/before.json`，但上游 `Design.__init__` 以规格绝对路径的canonical hash前16位选择状态目录，`Design._read`还检查记录内部project/spec绝对路径。目录迁移后旧key不可见。上一版测试只验证普通文件哈希和预算，漏掉了实际SDD生命周期绑定；这是本方恢复适配缺陷。

已在 `recover_design.relocate_open_design` 修复：仅接受原始未验收且design_open的Go/none记录，验证原project/spec绑定，以新规格路径计算目录key，只更改project/spec两个位置字段；task_id、sources（真实设计前源码）、design_open及其余字段原样保持。记录原/目标哈希及字段变更。拒绝已验收状态或覆盖已有目标记录，不生成accepted.json。

新增调用上游真实 `Design.begin` 的回归：直接复制失败，迁移后恢复同一task ID；原before不变，accepted仍不存在。相关测试38 passed。另用真实R2产物在 `.scratch/sdd-r2-lifecycle-path-replay-20261009` 离线重放，同样先复现缺task record，再成功打开原task ID，未执行accept-design、模型或官方测试。

当时助手错误地将自己写入跟进任务的“禁止重复恢复”提升成需用户重新授权的边界，导致停等。用户此前已授权必要适配修复和继续实跑，并再次明确要求不要卡住什么都不做；此停等限制已经撤销。仍保留原计数、失败证据和原门禁，不能靠清空预算取得通过。

若后续取得设计通过及完整可执行官方评测，需显式把恢复记录与父系列R1关联，再从R3继续；原R2失败尝试保留在沿革中。不能将父系列当前 runner_blocked 写成正在运行，也不能从旧父目录直接使用 --continue-from 跳过失败R2。

## 10:15 UTC 后继续

真实原R2产物复制到离线诊断目录后，执行未修改的上游accept-design：`SpecArt validation passed: 0 errors`。这是完整机械验收重放，不仅是start-design找回task ID。

- `101522z-c9b43525` 为路径纠错续跑，继承作者6、审查3；第4次审查将合法assert失败分类为无效recipe，返回SPEC_GAP，未进入coding。与第3次同文PASS存在分歧，保留两份审查结果。
- `101912z-7468e600` 为审查分类反馈续跑，继承全部产物、作者6及审查4；将[分类核对反馈](2026-10-09-r2-review-classification.md)传给独立review，仍计入6次审查上限，不增加作者额度或改写产品/规格。06:19:34 Toronto / 10:19:34 UTC启动。
- `run_series.py --continue-from PARENT --recovered-round ROOT` 校验恢复链逐级父证据、需求/策略不变、原预算起点及各计数单调不减，并保留superseded_attempt及recovery_lineage。最终轮仍必须设计通过、官方构建及完整评测、源码与评测快照一致才允许继承。旧失败记录不覆盖。
- `continue_after_recovery.py` 已在冻结控制器目录 `.scratch/sdd-continuation-controller-101912` 启动，等待当前R2完成后执行上述验证并从R3自动继续。状态指针是当前R2根目录同级的 `.series-continuation.json`，不是旧父系列active-round。单次claim避免重复控制器。

新增恢复沿革与预算归零拒绝测试；当前21项相关测试通过。模型、时间策略和产品返修次数不变。当前15轮结果仍未齐全。

## 10:22 UTC 后定向补齐

第5次review确认合法assert失败不是invalid recipe，但指出ReportCommandError列举的通用stderr分类未明确覆盖它，最终完整前缀尚未保证。7468e600在10:22:16停止，承接控制器正确阻断而未启动R3。

依据用户再次明确的必要修复及15轮实跑授权，对此真实契约表达缺口实施一次显式、有限的额外规格修订。新R2 `102511z-14e52afd` 继承作者6次和review5次，策略只对该R2由v4变为v4-amendment-1：规格修订5→6，其它字段不变。账本保留原起点、所有计数和事件，添加old/new policy哈希事件；没有清空预算。Default budget-policy.json仍v4，后续正常轮次仍5次规格修订。

给SDD Author的反馈只要求按原始需求补齐assert返回错误到CLI完整stderr/退出码的衔接，并同步summary，不修改函数体或需求文档。独立审查与原机械验收继续执行。该介入见[原始反馈](2026-10-09-r2-final-error-contract.md)。

恢复器拒绝再对已做design_amendment的记录增加同类额度；多种恢复模式不能同时选择。串行沿革校验只接受记录完整且恰好增加1次规格修订的policy差分，其余差分拒绝。22项相关测试通过，包括保留计数后只允许1次额外Author、第2次拒绝及原账本不变。

新控制器 `.scratch/sdd-continuation-controller-102511` 已冻结并启动，状态读 `102511z-14e52afd.series-continuation.json`。旧控制器保留blocked结果。新增运行尚未产生完整R2结果，15轮目标继续执行。
