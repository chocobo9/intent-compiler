> **历史/专题材料，非现行指令。** 保留当时的观察、方案或取舍；实现与状态须从 [模块地图](README.md) 核对，不执行本文旧“下一步”。原 CURRENT-DESIGN 节号均指历史设计。

# 严格两级流程 · IR 阶段最小改动草案（2026-09-30）

> 边界：只处理"IR 阶段不再要求模型输出 `execution_decisions / assessments / checks`，保留 `questions`"。
> 不涉及 D4 核对、task ref 语义、积压处置、提交边界。不启动真实运行。

## 一、职责表述（拟写入规范）

> IR 阶段根据本批 instruction、当前 IR 和可引用来源，提出 IR 变更、说明来源文本的处置、记录无法解决的问题。
> 执行安排、执行结果评价与计划核对由实际消费它们的阶段承担。

## 二、IR 阶段输出（改动后）

| 字段 | 处理 | 依据 |
| --- | --- | --- |
| `basis` | 保留 | 标明提案依据 |
| `source_coverage` | 保留 | 来源处置是本阶段职责 |
| group `local_ref / task_refs / depends_on` | 保留（现有处理） | 合并路径使用 |
| `ir_changes` | 保留 | 本阶段核心产物 |
| `questions` | 保留 | 会并入最终候选；历史样本为空不构成删除理由 |
| `execution_decisions / assessments / checks` | **从模型输出要求中移除**（schema 中禁用，与 `compilation/coverage` 同机制） | 已确认不进入最终应用；实测 77 份 IR 提案中 `execution_decisions` 非空 46 份（67 条）被丢弃 |

## 三、内部接口衔接（已追踪）

仍假设三个字段存在的代码：

1. `IRProposal` 类型（`Omit<CandidateGroup,"compilation"|"coverage">`）→ 追加 omit 三个字段；
2. `ParentGeneration.prepare()`：把 IR 提案升级成临时父候选时 `{...group, coverage: [], compilation: {reuse}}` → **在此补 `execution_decisions: []`、`assessments: []`、`checks: []`**，维持内部 `CandidateGroup` 类型；
3. `generation_repair.ir_proposal`：`groups.map(({compilation,coverage,...group}) => group)` 会把父阶段的三个字段（现在是模型产生的，将来是空数组）**继续发给 CI**——这是一条真实存在的"间接展示"路径；
4. 共享 schema/示例（`candidate-schema.ts`、`candidate-schema-strict.ts`、`candidate-example.ts`）——属于 CI/legacy 共用，不改；
5. `candidate-repair.responseDraft`：只处理 `ir_changes/sources`，不受影响；legacy（整份 Candidate）路径不设 `generation_stage`，不涉及。

**修复路径**：IR 重试仍通过 `generation_repair.ir_proposal`（改动后不含三字段）+ `validation_errors` 呈现；CI 父缺陷回退走 `invalidate()`，行为不变。

## 四、配套合同/示例改动（最小）

1. `generation-schema.ts` IR 说明句："except compilation and coverage" → "except compilation, coverage, execution_decisions, assessments and checks"；
2. 同文件 IR 示例剥离列表：`({compilation, coverage, ...group})` → 同时剥离三个字段（示例里三字段本来就是 `[]`，剥离是形状要求）；
3. `generation-schema.ts` CI 说明句 "preserve the parent groups and their management decisions" → "preserve the parent groups (local_ref/task_refs/depends_on) and any parent questions"（与合并代码实际行为一致：合并只保留 `questions`）。
4. **不动**共用条款：`candidate_shape`、执行回传仅作证据的规则、group 字段归属说明、核对合同——它们服务 CI/评估/legacy。

## 五、IR 阶段其余输入的用途核对（只查了待定项）

| 输入 | 支持的 IR 判断 | 依据 | 结论 |
| --- | --- | --- | --- |
| `existing_objects.tasks[]` | task_refs / expected_revision 的身份与版本 | 合同 "use that exact task_id and task_revision…" | 保留 |
| `existing_objects.atoms[]` | `previous_atom_ref` 属 Atom 草案字段（CI 阶段）；IR 阶段不能创建/修改 Atom | IR schema 禁止 compilation | **尚未发现 IR 阶段用途**（删除候选） |
| `atom_states` | 生命周期区分，合同只对计划/评估提出要求 | `compiler-model-v2.ts:335,384` | **尚未发现 IR 阶段用途**（删除候选） |
| `capabilities.operations` | 原子权限/前提（CI） | `authority` 属 Atom | **尚未发现 IR 阶段用途**（删除候选） |
| `capabilities.material / workspace_root` | 材料/绑定声明与路径事实 | "a path that exists and is readable is provided material…" | 可能有用途，保留待讨论 |

## 六、仍未查明的信息

- CI 模型是否实际读过 `generation_repair.ir_proposal` 里的父阶段决定（发送路径已确认，消费无法离线观测）；
- 删除三字段对输出 token 的实际影响（当前只知条数，不知 token；`execution_decisions` 的说明文字在共用条文中，不随本次一起删）；
- IR 视图删掉 `existing_objects.atoms[] / atom_states / capabilities.operations` 是否改变 IR 质量——属于第二批，不在本草案。

## 七、可验证的价值

消除已查实的无效生成（46/77 份 IR 提案中的 `execution_decisions`）与随之的协议负担；是否改善 dpipe 的派发与完成效果留给后续真实运行回答。
