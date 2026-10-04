# 历史实验协议与实施记录

> 本文保留各日期的研究安排和验证事实；“当前/最新/下一步/授权”按当时语境理解。现行入口为 [当前设计](../../development/CURRENT-DESIGN.md) 与 [产物状态](../../experiments/evocode/harbor/dpipe/README.md)。历史协议未自动成为下一次实验定义；更改须另行决策。

## 整理前的状态与研究正文（保留记录）


Status: active prototype specification — implementation evidence reconciled 2026-09-18

Design checkpoint: 2026-09-21 — Atom terminology corrected in CONTEXT; a provisional candidate and development checks are recorded below. The user subsequently corrected the premature design closure: research and mechanism design must continue beyond agreement with existing documents. The proposed implementation shape, call budget and checks are not frozen. No new implementation or experiment results are implied. First-candidate restrictions describe that implementation, not all future designs.

Research readiness: prototype-ready; no formal benchmark evidence yet

Implementation status: the first-candidate TypeScript implementation, deterministic tests, OpenCode Adapter, and prdcheck source/evidence conversion code exist. One real OpenCode/Luna no-tool compatibility run completed on 2026-09-17. Initial requirement capture, real coding execution, prdcheck host wiring, and added value have not been demonstrated by that run.

On 2026-09-18, after the contract and turn-validation repair below, `semantic-003` passed the single first-request no-tool check: task creation and selection, all seven stated requirements and provenance in Compiled Intent, matching delivery and an accurate executor restatement. This is one-case Compiler correctness evidence, not coverage of all multi-turn behavior or a coding/value result.

## Problem Statement

Users disclose, revise, retract, suspend, resume, and sometimes form intent over long interactions. A downstream Agent can appear successful while misunderstanding the current intent, preserving invalidated requirements, merging similar tasks, or recovering incorrectly. EvoCode-Bench and the adjacent evidence reviewed for this project already establish these long-horizon failure phenomena as the research premise. This program does not attempt to prove that the general problem exists again; it obtains a reproducible baseline failure profile on each selected testbed before using that profile to compare Intent IR mechanisms.

The central research hypothesis is that a persistent, Compiler-owned Intent IR and a distinct Compiled Intent provide a more effective way to manage evolving intent than relying directly on history, summaries, retrieval memory, rewrites, or ordinary planning. The program must design, ablate, and compare alternative Intent IR mechanisms while isolating intent understanding and maintenance from execution skill, measuring cost, and allowing different mechanisms to win on different task distributions. Representation, granularity, relations, storage, and algorithms remain open design variables to be investigated rather than neutral details that the project never selects.

## Solution

Build a staged Intent IR research-and-validation program around the established system flow: continuous input is interpreted and managed by an Intent Compiler; the Compiler maintains Intent IR and produces a distinct Compiled Intent; an environment-specific adapter delivers that artifact to a fixed Exec Loop; execution status returns as evidence for the Compiler to interpret. The Exec Loop cannot mutate Intent IR or Compiled Intent. Controlled experiments first establish the testbed baseline and attribution chain, then support iterative mechanism design before frozen confirmation.

Compiled Intent is the experimental intervention. It remains separate from the fixed System Prompt, tool descriptions, long-term memory policy, source-history policy, and other executor inputs. A runtime adapter may serialize or inject it into a model prompt, file, structured call, workflow, or other execution mechanism, but that adapter representation does not redefine Compiled Intent.

Run four progressively less controlled stages:

1. **Experiment 0 — baseline, attribution, and early mechanism research:** subphase 0a-s uses development/calibration twins to validate wiring and turn observed schemas into a frozen operational Matrix v1; subphase 0a-g then applies that v1 to untouched gate twins to obtain the benchmark-specific baseline failure profile and test oracle headroom and sham attribution. Neither 0a step re-tests whether the general research problem exists. Subphase 0b designs, qualifies, ablates, and compares treatments that maintain Intent IR and emit a distinct Compiled Intent; it begins local mechanism discovery without preselecting Atom or Relation design.
2. **Experiment 1 — persistent development:** audited 5–15 turn coding workflows test drift, recovery, regression, Authority carryover, and interleaved task identity in a persistent workspace. It contains both replayed and controlled-interactive tracks.
3. **Experiment 2 — environment transfer:** the same semantic contract and measurement protocol move through environment-specific adapters to at least one non-code tool environment.
4. **Experiment 3 — human calibration:** representative interactive conditions are rerun with real users to test simulator and authored-trajectory transfer.

The first executable calibration establishes how the already known failure phenomena appear in the chosen testbed and whether the measurement chain can distinguish them. Only Experiment 0b and later stages compare Intent IR solutions or support a claim about their usefulness; none assumes a universally best internal representation.

### Current prototype boundary and actual progress

The project is organized around two coupled loops:

```text
user / benchmark input
        ↓
Intent Compiler ── maintains private Intent IR ── emits Compiled Intent
        ↑                                      ↓
eligible execution evidence ← fixed Exec Loop and persistent coding workspace
```

The upper loop progressively interprets and maintains intent. The lower loop performs coding work. The Compiler may interpret returned execution evidence on the next update, but the Exec Loop cannot create, rewrite, or promote its own state into user Intent. `Intent IR` is the Compiler-owned persistent working state; `Compiled Intent` is the separately versioned artifact delivered to the Exec Loop for one turn. They are not two names for one JSON document, and neither is ordinary chat history, long-term memory, a System Prompt, or an executor plan.

The first runtime is an **OpenCode plugin management layer** planned for `legacy-external/sdd-loop-prdcheck`, which is the first host workflow and experiment harness; its shell is not yet wired. OpenCode supplies the execution session, coding tools, and workspace; prdcheck supplies workflow stages, workspace copies, build/test gates and run artifacts; neither is the Intent Compiler. The Compiler remains an independently usable package in `../..` and must not import prdcheck stage names, paths, skill conventions or run-state structure. Harbor may later drive official benchmark tasks and verification outside the product boundary, but it is not the first runtime and is not required to implement the management layer. WorkSwarm/openJiuwen is outside the present project scope.

Current implementation evidence is deliberately separated from the research claim:

| Present now | Not present or not yet demonstrated |
| --- | --- |
| First-candidate code restricts the model to proposals; code validates operations, allocates IDs, applies changes, and projects Compiled Intent | Correct natural-language interpretation, a final Intent IR/Atom/Relation design, or a proven management mechanism |
| Separate Compiler history for input, proposals, validation, commits, state, delivery, evidence, replay and recovery; independent Observer records | Real-chain verification of all retry, recovery, lifecycle and evidence-return paths |
| OpenCode in-place message replacement, pre-provider SDK readback guard and terminal reconciliation; exercised in `compat-007` | Provider-wire byte capture or real coding execution |
| Deterministic tests for the candidate, stores, model boundary, Adapters and Observer; one real no-tool compatibility run | A coding comparison, reliability or efficiency gain, or C1/C2/C3/C4 evidence |
| prdcheck source/evidence conversion and host helper commands in `../..` | Actual wiring or execution in `legacy-external/sdd-loop-prdcheck` |

The first candidate exists, but its semantic correctness and added value remain unproven. The model may propose operations; it may not return the next state or freely write Compiled Intent. Format compliance, deterministic test results and compatibility success are distinct evidence and do not establish improved long-task reliability.

#### Verified compatibility record and its limit

Run `compat-007` used OpenCode `1.18.31` and `openai/gpt-5.6-luna-fast` for Compiler and executor. Evidence: `../..-compat-smoke\compiler-store-7\runs\compat-007\history.jsonl` and `../..-compat-smoke\observer-store-7\runs\compat-007\events.jsonl`, with the referenced SDK readback artifacts and session registration. The model proposed `no_change`; validation accepted it with `changed:false`, the store recorded `commit.noop` at state version 0, delivery was `confirmed`, and terminal reconciliation was `complete`. The executor returned `COMPATIBILITY_OK` without tool calls.

The delivered artifact had no selected task, no active requirements and no source IDs. The harness itself requested `COMPATIBILITY_OK`. Consequently this run proves plugin/model/validation/commit/delivery/reconciliation compatibility, not successful first-task creation, requirement capture, sufficient task information in Compiled Intent, coding execution, or added value. Earlier failed attempts remain failure records. The Fast model ID does not by itself prove max reasoning effort was applied.

Real-chain checks still pending include multiple executor sessions under one run, a second user input in one session, invalid-proposal retry, interrupted commit/delivery recovery, mismatch recovery, actual tool/diff/test evidence entering the next update, suspension/resumption/switching/retraction, coding, prdcheck wiring and matched references. In particular, Observer `RunStore.activate()` still checks manifest `session_id` equality; Adapter tests using an Observer spy do not settle cross-session support.

#### Authorized no-tool first-request test and results

Attempt `semantic-001` on 2026-09-18 is retained at `../..-semantic-smoke-001`. Its Compiler history records an initial `create_task` proposal using local_ref `task-1`, rejected with `persistent_id_in_proposal`; the recorded retry proposes `create_task` and six `add_requirement` operations covering the timer requirements, but uses `task-1` and `requirement-1` through `requirement-6` and is rejected for the same reason. Neither proposal includes `select_task`. Both use user-source identity/digest and span `[0,107)`. There is no commit, Compiled Intent, delivery or executor restatement. This is a failed attempt, not successful first-task establishment. Executor session metadata records variant `max`, but the two Compiler sessions record `default`; this attempt does not establish the requested Compiler max-effort condition.

Repeat `semantic-002` used the same user text and harness, with model options `reasoningEffort: "max"` in the isolated Compiler workspace configuration. The resolved configuration is saved at `../..-semantic-smoke-002\logs\compiler-resolved-config.json`; this is configuration evidence, not provider-wire capture. Its Compiler history at `compiler-store\runs\semantic-002\history.jsonl` records an accepted proposal creating one task and seven requirements (pause and resume are separate), with user provenance covering the same input. No `select_task` was proposed. Code committed state version 1 with `selected_task_id: null`, so the generated artifact has `selected_task: null`, no active requirements and no source IDs. Delivery was confirmed and reconciliation completed. The executor answered: “No current task or active requirements are present in the compiled intent.” Observer records zero tools and an empty workspace diff. No semantic prompt, operation rule or source code was changed between these attempts.

The pre-fix first-request test failed: non-empty state was established in semantic-002, but the task and requirements were not projected to the executor. These two runs do not establish an effect of max effort.

On 2026-09-18 the failure was reproduced through the public Compiler interface without a model call or coding workspace. The actual model request listed operation names and fields but did not explain that create_task leaves selection unchanged, how proposal-local references are reused, or the reserved reference pattern. The projection correctly followed the existing no-selection rule; the public turn accepted an incomplete proposal and silently prepared an empty task delivery.

The fix keeps the operation set and projection unchanged. The model-visible contract now describes first-task creation, requirement capture, explicit selection, local-reference rules shared with the validator, lifecycle effects and legitimate no_change cases. At the public prepareTurn boundary, a proposal that leaves no selected task while creating a new task that remains active is rejected before commit with new_active_task_not_selected and receives the existing single recorded retry. Code never selects a task automatically. Explicitly suspended new tasks, a genuine empty-state no_change, and creating another task while retaining an existing selection remain permitted. This is a bounded structural check, not a proof that selection, deferral, requirement text or no_change is semantically justified by arbitrary natural language. Direct state operations and projection still support unselected states. The original semantic-002 proposal was replayed and rejected before commit after the fix; real-model verification is recorded separately.

#### Current validation scope (user decision, 2026-09-18)

Post-fix real run `semantic-003` is retained at `../..-semantic-smoke-003`. Its `compiler-store\runs\semantic-003\history.jsonl` records one accepted proposal, state version 1, a selected task and seven active requirements covering the unchanged timer input, confirmed delivery and complete reconciliation. The delivered artifact and `logs\opencode.jsonl` were checked directly against the original input: initial time, start, pause, resume, reset, completion and minimal UI are all present without additional product requirements. Every item cites the admitted user identity/digest and `[0,107)` span. This span links to the entire input; its validity alone does not establish semantic support. The executor restated all seven requirements. The model remains Luna Fast with max configured as in semantic-002; resolved configuration is evidence of configured options, not provider-wire capture. No coding or prdcheck task was run. This one-case pass does not estimate model adherence rates or independently attribute improvement to a particular contract sentence.

The current milestone evaluates the Compiler's products and behavior against this document; a complete coding artifact is not required. Check current task, active and invalidated requirements, source correspondence, task selection and isolation, changes across turns, Authority/evidence separation, deterministic state/projection behavior and delivery. The immediate repair remains the observed first-request failure; do not expand it into a large benchmark. Semantic expected outcomes are specified from admitted user inputs independently of the generated proposal, so format compliance, non-empty state and executor restatement alone cannot pass the test. A single first-request result does not validate the remaining change/lifecycle/recovery cases. Coding outcomes and matched references remain necessary for later claims about coding reliability or added value, not prerequisites for this narrower correctness milestone.

On 2026-09-18 the user approved testing an explicit first request for a simple web Pomodoro timer: initial `25:00`, start countdown, pause preserving remaining time, start again to resume, reset to `25:00` and stop, stop at `00:00` and display “完成”, with only a time display and start/pause/reset buttons. Raw requirements enter only the Compiler. The executor harness prohibits tools and file changes and asks only for a restatement of the task and requirements present in Compiled Intent, or an explicit report of missing content; it contains no timer requirements or expected answer.

Check the real proposal, creation and selection of a task, active requirements and their input provenance, the deterministically generated artifact, exact delivery, and the executor restatement against every stated requirement and unsupported additions. Non-empty state alone is insufficient. Use 5.6-luna with max effort and fast mode, recording the actual configuration evidence. Success would establish only that this first request survived state creation and no-tool delivery; it would not establish functional timer behavior, long-term maintenance or added value. Do not proceed to coding or prdcheck without the user's next confirmation. A repeated `no_change` requires inspection of the actual request, operation/response contract, available source references and validator responsibility, not an automatic prompt-only fix.

#### Single coding diagnostic (2026-09-18)

Subsequent single-coding diagnostic (2026-09-18): `../..-single-coding-001` uses the original SWE-bench Verified issue `astropy__astropy-13236` verbatim, followed by three locally authored turns fixed before model execution. This is one coding topic with scope revision, reversal and paraphrase; it is not an official Evolving Intent generated trajectory or coding implementation. Expected semantics were kept outside model input. All four Luna Fast turns passed operation validation and exact delivery/reconciliation; task identity persisted, deferral was superseded when reversed, and the final no_change retained state/artifact version 3. However, executor restatements on turns 3 and 4 still said to retain the conversion now and defer its removal. The trajectory is not a complete semantic pass. An active reinstated requirement and a same-worded superseded/do_not_apply record coexist in the artifact; future-version wording and retained executor history are additional possible contributors, not established causes. See `report.md` and raw histories there. The same-session re-registration path worked in this example; cross-executor-session support remains unverified. No Compiler repair, TypeSafe/Jev comparison or added-value result is implied.

Follow-up diagnosis of single-coding-001 (2026-09-18), recorded at `../../../reference/reports/intent-single-coding-diagnostic-001.md`: three fresh-session OpenCode HTTP probes used the same harness and Luna Fast/max configuration. Original turn-3 delivery still yielded deferral; clearing inactive_requirements alone still yielded deferral; changing only the active requirement text to explicitly include the planned 5.2 change in this change removed the observed deferral in that one response, with inactive records retained. These are diagnostic message interventions, not valid newly committed artifacts or a Compiler repair. The original proposal already used the weaker future-version wording, which deterministic code preserved. The priority is preserving the user's revised scope in model-proposed text; correct record status and fourth-turn no_change do not establish adequate semantics. Old executor history is not necessary for this failure, and inactive-record deletion alone was insufficient in this probe. Each condition ran once; HTTP/directory differences from the original CLI limit causal claims. No unique universal cause or success rate is established. A future repair must regenerate the proposal from unchanged user input and prior state, not insert the manually edited diagnostic text.

Repair verification (2026-09-18): `src/model/compiler-model.ts` now explicitly requires revised requirement text to preserve current scope, timing, conditions and exceptions, distinguish release targets from current-work inclusion, and retain optionality/priority/release conditions. This is a model-contract repair, not deterministic semantic validation. First regression `single-coding-fix-001` removed the deferral symptom but omitted the optional 5.1 condition, so was not a complete pass. After the optional-condition clarification, `../..-single-coding-fix-002` passed manual checks against the unchanged original four inputs, harness and prewritten expectations: scope reversal survived turns 3/4, other requirements remained, final no_change retained version 3; four deliveries/readbacks matched and reconciliations completed, with zero tools. A separate real-model replay from the original failed run's exact turn-2 state also produced explicit current-work inclusion and a non-deferred executor restatement. That local replay had runner faults documented in its report and does not independently verify store/plugin delivery. Build and 10 focused model tests passed. See `../../../reference/reports/intent-single-coding-fix-002.md`. These are exposed development-case regressions, not held-out reliability, coding or added-value evidence; prior failures remain retained.

New-case verification (2026-09-18): `../..-new-case-001` ran the untouched repaired Compiler on SWE-bench issue `astropy__astropy-14508` plus two locally authored, pre-frozen updates (not an official Evolving Intent generated trajectory). Three real turns preserved core FITS/number/comment requirements, restricted work to a regression test, and restored the formatter fix when that restriction was withdrawn; all three deliveries/readbacks and reconciliations succeeded with zero tools. It was not a complete pass against the prewritten information-retention expectations: the tentative str(value)/20-character approach and uncertainty were absent from managed state/Compiled Intent, although raw input remained stored and the approach was not incorrectly made mandatory. A further observed ambiguity is that the broader valid-FITS-card requirement remained withdrawn after restoring the fix; restoration of that entire scope was not a separately pre-scored criterion. No repair/tuning or rerun was performed on this new case. See its report.md. This is new development-case evidence, not a full coding or benchmark/value result.

#### Model-comparison adapter decision (user decision, 2026-09-18)

Use TypeSafe's official `system-one-adapter-python` as a basis for model comparison, reusing it directly or making limited adaptations where needed. This is a comparison-tool decision, not a decision to replace the current Compiler model, adopt Jev as the whole Compiler, or add Python to the core TypeScript package. The adapter runs ordinary LLMs through a TypeSafe-style question/answer interface; Jev itself requires its own model access. Its request, response, retry and usage records can support analysis but do not replace Compiler state/commit/delivery history or independent Observer records.

Implementation evidence (2026-09-18): optional tooling in `../..\experiments\typesafe` reuses upstream commit `adffc2eab300a4fa3c0e92252d4ffd6ceaa53700` unchanged, with an OpenCode custom provider and non-overwriting audit runner. It uses prompted JSON, not native constrained decoding, and does not translate judgments into Compiler operations. Eight focused tests passed using the real adapter and a local fake HTTP server. Real run `../..-typesafe-smoke\runs\compat-001` returned the correct label for a transport fixture in one adapter attempt; OpenCode recorded Luna Fast and variant max, with max in resolved model configuration. This verifies comparison transport/parsing/audit only, not Intent semantics, calibration, provider-wire effort or complete accounting of OpenCode-internal calls. No Jev run or Compiler comparison has occurred. The TypeScript Compiler remains unchanged.

Benchmark preparation checked official Evolving Intent commit `993d6be9597ac03854b46362ccd647eb1bfd267a` at `../../../reference/evolving-intent`. The repository contains construction code and fixed source IDs but no generated `final_dataset` pool; the SWE guide explicitly marks it generated/gitignored. Obtaining or generating the corresponding data is necessary to reproduce those generated trajectories, not a prerequisite for the user's requested single-case diagnostic. The authorized diagnostic above used one original SWE-bench issue and explicitly local follow-up turns, with expectations fixed separately before execution. No official Evolving Intent generated trajectory has been run. Details are in `../../experiments/intent/README.md`.

The existing program compares multiple testbeds and task/change distributions and permits different approaches to win in different settings. A small local comparison develops and diagnoses a candidate; it does not replace that program or establish a universally preferred approach. Further changes to model output, question decomposition, uncertainty handling and external-module inputs remain alternatives for analysis and testing, not adopted implementation requirements. Preserve the distinction between reduced format errors, correct interpretation, correct state maintenance and added value.

#### Clarifications for candidate comparison (2026-09-18)

These clarify the existing representation-independent scoring, development/held-out separation and cost rules; they do not select a new state structure or model. Shared correctness checks concern the current effective intent and its changes, not exact reproduction of the first candidate's proposal, operation order or number of requirement records. Candidate-specific structural tests remain useful, but correct isolated judgments must also produce a correct combined state and Compiled Intent across turns.

Retain the admitted benchmark input before candidate-specific preprocessing. When it includes code, quotations, objections, revisions or ambiguous references, do not silently replace it with manually simplified questions and report success on the original task. If preprocessing, candidate construction, question decomposition or context selection belongs to the implementation, record that transformation and include its calls, latency and other applicable costs. A test starting from supplied candidates or simplified text may diagnose that narrower judgment, but does not establish understanding of the original input. Evaluator-only annotations remain hidden from the candidate.

Record the development exposure and interventions behind each compared version, including prompt changes, candidate construction and manual corrections; apply the existing equal-development-opportunity rule. A trajectory used to diagnose or repair a failure remains useful for regression, but its later pass is not independent held-out evidence. These clarifications preserve the selected public benchmarks and existing phase rules; they do not adopt TypeSafe's policy of retiring public evaluations. The Pomodoro case remains a minimal first-request check. The current unresolved-content constraints are implementation facts whose adequacy has not yet been tested on the selected benchmarks, not an established defect or an instruction to redesign them.

The external motivation and its limits are recorded in `outputs/intent-compiler-experiment-research.md`, section 17. No new project terminology, probability policy, memory module, task dependency representation or scheduling implementation is adopted here.

### Confirmed implementation language and first-host position

- Compiler source, deterministic state logic, stores, Adapters and tests are written in **TypeScript**. The package builds to Node.js 22 ESM JavaScript; OpenCode and shell hosts consume built JavaScript and versioned JSON rather than requiring a TypeScript runtime.
- `../..` owns the reusable package. `legacy-external/sdd-loop-prdcheck` is the first host and experiment harness, not the location or domain model of the Compiler. Its existing Bash workflow and skills are adapted at their existing centralized invocation/result seams rather than refactored around the Compiler.
- The prdcheck Adapter must explicitly label source channels. Initial requirements and later explicit user answers/updates may alter Intent IR. Generated stage prompts (`prd`, `coding`, `prd-check`, `code-fix` and similar) are harness instructions and never become user intent. `run-state.json`, OpenCode session continuation, build/test results, diffs and stage outcomes are workflow/session state or execution evidence and cannot directly change requirements or Authority.
- The reusable Compiler interface accepts source-labelled user input and admitted evidence and returns committed version references plus Compiled Intent. It does not know `workflow.json`, stage names, `[ASK]`, `SPECLANG_*`, HarmonyOS, run-directory layout or verdict files; the prdcheck Adapter translates those host details.
- For isolated Compiler experiments, raw requirement/history files that would let the Exec Loop bypass Compiled Intent are excluded from the executor-visible workspace unless the arm explicitly declares that source-history condition. Product-mode visibility is a separate host policy.
- Docker is not a prerequisite for the package or first OpenCode/prdcheck smoke. Initial deterministic tests and the real OpenCode integration run on the host. Containerized workspaces and verifiers remain an optional later execution choice for reproducible benchmark arms; HarmonyOS SDK/device paths may remain host-based.

### Immediate prototype milestone

The immediate milestone is Compiler correctness under the scope above, without requiring coding output. The coding vertical slice below remains a later, separately authorized way to test execution behavior and eventual added value; passing the first-request test does not automatically start it:

1. Select one clean, official multi-turn coding task with clear instructions, executable checks, and at least one meaningful revision, correction, or task switch. Do not invent a broad synthetic dataset first.
2. Run the task once through unmodified OpenCode as the raw product baseline, preserving its native result and telemetry.
3. Run the same task through the plugin with the first qualifying Compiler candidate defined below. The model may propose source-grounded changes, but it may not write the next state or Compiled Intent. Deterministic code validates and applies the changes, persists the resulting state, and projects the versioned Compiled Intent that replaces the executor's task message.
4. Capture, for every turn, the exact raw input, prior and next state versions/digests, exact Compiled Intent delivered after readback, executor model steps, tool calls and failures, workspace diff, tests/verifier result, tokens, latency, retries, and errors.
5. Inspect the first semantic divergence: whether the Compiler preserved active requirements, invalidated superseded requirements, kept distinct task occurrences separate, and changed executor behavior in the expected direction. Final pass/fail alone is insufficient.

This slice is exploratory and may use an LLM only to interpret natural-language references and propose source-grounded changes. Every model-interpreted field must be labeled `[LLM-PROTOTYPE]`; the model cannot return a free-form next state or a free-form Compiled Intent. Identities, legal transitions, provenance checks, versioning, digests, commit/replay, projection, delivery gating, access restrictions, and telemetry remain deterministic code. Passing the slice shows that a real Compiler candidate can be exercised and observed. It does not establish benefit until compared with at least a raw baseline and a strong non-persistent rewrite/reference under matched conditions. Oracle and paired-sham controls enter when the vertical slice has stable behavior and the testbed can support them without hiding basic wiring failures.

### Design closure summary / reader map

- **What is being researched:** whether a persistent Intent IR and distinct Compiled Intent improve long-horizon reliability beyond strong context-management and ordinary-planning references, and which representation, update, relation, inference, and compilation choices work best for which intent-change conditions.
- **What exists today:** the first-candidate implementation, deterministic tests, an independent Observer, real no-tool compatibility and single first-request checks, the exposed four-turn regression/diagnostic, and the three-turn new-instance result with the limitations recorded above. Coding quality, prdcheck wiring and added value remain unproved. The 2026-09-21 checkpoint below is design only.
- **What is agreed and what remains proposed:** Atom denotes executable task content in Compiled Intent. Task dependencies and model completion are directions to develop; the update/compile/check contract below is one provisional candidate. Its agreement with existing project goals does not conclude research or select the best mechanism. IR structure, Atom granularity, Relation design, inference and compilation algorithms remain open to substantive improvement.
- **Stage order:** 0a-s calibrates the protocol; untouched 0a-g obtains the selected testbed's baseline failure profile and verifies oracle/sham attribution; 0b begins Intent IR mechanism design, ablation, and local validation; Experiment 1 tests persistent development, history, interaction, and Authority; Experiment 2 tests frozen zero-shot environment transfer; Experiment 3 calibrates authored/simulated findings with humans.
- **Evidence rule:** no single final score, model self-report, readable IR field, or published leaderboard is sufficient. Claims require matched contrasts joining independent intent probes, observed action/environment outcomes, causal controls, and cost accounting.
- **What remains open:** numerical formulas, aggregation rules, minimum practical effects, thresholds, sample sizes, models, seeds, action limits, rendering limits, and phase-specific sampling are frozen only at the Matrix maturity point that has evidence to justify them.

### Next candidate: bounded design checkpoint (2026-09-21)

**后续用户校正（同日）。** 本节过早将讨论收束为实现契约。用户明确要求继续研究和创新，不受已有文档或当前实现束缚，也不能反复将既有目标作为新结论。以下保留为一份可审查的候选；具体表示、调用次数、实现顺序和六项检查均可因更好的方案修订。Atom 的术语修正保留。当前工作要继续说明新的算法选择、成立条件及相对已有候选的实质差异。

继续研究产物：[Atom 形成、推测补全与变化后重编译](../../../reference/history/atom-decomposition-evidence-2026-09-21.md)。新增方案推论是用具体行为差异参与解释选择和 Atom 划分、按获得的依据进一步编译，以及分别判断任务与已有成果的适用性；这些仍是待比较候选，不是新完成的实现或实测结论。

**随后用户补充（同日）。** IR 保存完整目标；Compiled Intent 是系统从中生成的结构化蓝图/运行索引，内容可包括执行任务、可选工具和系统认为该任务符合用户意图的可信度。用户认同前轮行为差异研究方向并要求继续。字段、可信度计算及工具绑定算法仍待设计；不将模型可信度等同于 Authority。对应设计推论见 [候选稿 §11](../../../reference/history/intent-design-candidate-2026-09-21.md)，补充一手证据见 [可信度研究材料](../../../reference/history/intent-confidence-evidence-2026-09-21.md)。当前仅文档与研究推进，未修改实现或运行模型。

**状态与决定边界。** 用户已认同：把逐渐形成的意图转成可执行任务，并在变化时调整相关任务、依赖和完成判断。这是项目既有目标的具体化，不是本轮发现的新主张。Atom 按 CONTEXT 修正为 Compiled Intent 中的最小有效执行任务或足够确定的可执行任务；IR 的管理条目不叫 Atom，Goal 与 Atom 不再预设固定分类关系。下述实现选择用于收束下一候选，不等同于用户逐项确认的最终架构。

当时完成了候选整理与代码差距核对，但尚未完成机制设计。源码、模型运行、宿主接入和正式实验均未启动。此前“先讨论、不默认修改代码或跑模型”的范围继续有效。本节可作为比较与改进对象，不要求下一方案继承它的实现分工。该候选不构成通过 0a/0b 阶段门槛，也不替代正式比较程序。

#### 1. 这一候选具体实现什么

| 部分 | 为下一候选选定的行为 |
| --- | --- |
| Intent IR | 维护任务身份、Goal、约束、当前范围、可选办法、推断依据和未决内容；允许旧理解被修正。暂缓与撤回可分别表达。内部使用有身份和来源的自然语言内容及显式引用，不要求与 Atom 一一对应。 |
| 更新 | 模型提出显式指定范围的候选新增、修订、替代与撤回；代码比较前后内容并控制提交。候选中遗漏某项不自动删除它。可在有依据时扩大修订范围，不受旧 15 项 operation 的表达能力限制。 |
| 推测补全 | 允许指代解析、省略条件恢复、合理默认和必要任务依赖推断；维护推断依据和适用范围。推断不能自动扩大 Authority，也不能将需要用户选择的结果伪装成已确认要求。 |
| Atom | 表达任务、对象/输入、适用约束、前提和完成/返回问题的依据。可有多个工具步骤；调查也可成为 Atom。暂不满足前提的 Atom 可以出现在产物中，但不得被视为已经可以开始。 |
| Relation | 首先表达任务之间所需产物、证据或明确顺序及其满足条件。禁止只按数组位置推断必要顺序。暂不增加独立调度器、图数据库或完整关系分类。 |
| Compiled Intent | 包含本次任务的 Atom、相关 Relation、约束、Authority 和必要未决说明；直接选取需要精确保留的原文。模型产生候选语义内容，代码检查、固定序列化并交付。 |
| 证据回传 | 关联任务、Atom/产物版本及适用执行对象。历史完成声明不能自动满足新 Atom 的前提；Exec Loop 不能直接编辑意图或产物。 |

这份候选建议用可校验的版本化 JSON 承载以上内容，区分 IR 内容身份与 Atom 身份。来源引用、前提引用和约束适用范围显式表示；Atom 的完成说明与实际执行完成状态分开保存。这些表示选择尚未固定为后续设计必须遵循的方案。

#### 2. 最小调用流程与失败处理

模型输入包含本轮原始交互、旧 IR、上一已提交 Compiled Intent、相关已保存原文和合格证据。上一产物用于比较、引用与可能的精确复用，不代替意图原始依据。初始实现直接读取所涉任务已接纳的来源及明确引用的上下文；任务尚不清楚时提供已有任务信息与相关对话进行判断。先不建设新的语义检索设施；超过声明的输入容量须显式报告，不能静默截掉内容后宣称完整保留。

普通一轮采用一次候选生成和一次定向语义核对：

1. 保存输入及身份，读取上述依据。
2. 模型返回候选 IR 变化、推断依据及对应 Compiled Intent。编译时发现需要补入的新理解必须反映到候选 IR，不能在产物中私自增加义务。
3. 代码校验结构、版本、身份、来源范围、替换范围、任务归属以及 Atom/Relation 引用；不把校验通过称为语义正确。
4. 核对调用读取原始依据、旧 IR 和候选结果，检查变化是否落实、有效内容是否保留、是否无依据扩展、Atom 是否可执行及依赖是否合理。
5. 通过后共同提交候选 IR 与确切产物；执行接入只接收已通过检查的产物。

普通预算为两次模型调用。一次候选生成失败或核对发现可修订错误时，最多追加一次候选修订及一次核对，总计最多四次；结构已无法解析时直接用于修订，不另做无意义的语义核对。该预算是下一候选的起始配置，不是最终最优调用策略。所有响应、核对结论、修订和成本均保留，核对模型不持有 evaluator 预期。后续真实测试仍使用 5.6-luna、max effort、快速模式，区分配置证据和 provider 实际行为。

缺少用户信息与候选生成错误分别处理：真实未决内容可以作为有效 IR 修订提交，Compiled Intent 仅交付有依据的工作及明确未决说明；没有可推进工作时允许不含可执行 Atom。无效候选修订预算耗尽则不提交、不交付原始输入作为替代，也不继续派发可能已被新输入撤销的旧任务。交付失败不撤销已接受的意图；保存结果用于重放，不重新调用模型冒充同一产物。

同一输入的幂等重试复用已保存结果。仅 IR 的来源说明发生变化而执行含义不变时，可以保存新的 IR 修订并复用旧产物；语义是否相同先由候选核对判断，代码只保证复用的字节、身份和引用一致。共享执行产物对各 IR 修订的关联保存在提交记录中。

#### 3. 实现位置与可复用部分

代码核查截至 2026-09-21，仅阅读，未修改：

| 文件/职责 | 必要变化或复用范围 |
| --- | --- |
| `src/core/intent-state.ts` | 当前以 requirements 等记录及固定操作维护状态，并由 compiledPayload 直接投影。下一候选需要独立的 IR 更新/结构校验和 Atom/Relation 产物校验；不能将 active_requirements 直接改名为 Atom。 |
| `src/model/compiler-model.ts` | 当前明确禁止 next_state、compiled_intent 等输出。需要版本化的新候选生成/核对契约，并允许来源原文进入请求。旧 operation 契约保留其历史版本含义。 |
| `src/core/intent-compiler.ts` | 保持 prepareTurn、recordDelivery、admitEvidence、recover 的外部职责；内部接入生成、核对、有限修订和提交顺序，保存全部中间结果。 |
| `src/core/compiler-store.ts` | 复用输入、内容寻址产物、提交与恢复；当前已有独立产物 digest/version，但 state no-op 要求复用相同产物，集成时核对该约束与新候选的含义一致。补入契约版本及核对记录，不能将已有运行静默解释成新 schema。 |
| `src/adapters/opencode.ts` | 当前消费 prepared.renderedText 并做交付读回，主要行为可复用；只按新契约核对必要的类型和证据归属。暂不接入 prdcheck 或新增执行调度。 |

实现顺序限定为：先打通新契约下的无模型确定性提交/重放，再接模型生成与核对，最后接现有 OpenCode 交付。新增模型语义能力和确定性代码职责分别验收。保留旧运行和失败记录，不迁移或覆写它们以制造新候选成功记录。

#### 4. 开发验收的六项行为

以下是待实现检查，不是已通过结果。确切输入、原文片段和逐轮可接受行为须在未来模型调用前固定，并置于候选不可见的评价侧。允许多种正确拆分，不以 Atom 数量或字段措辞作为语义答案。

| 场景 | 必须观察到的行为 | 判失败的代表现象 |
| --- | --- | --- |
| 从完整输入编译任务 | 同一输入包含样例/代码、约束和可选办法时，形成可执行任务，保留精确内容与可选性；不要求固定拆成三步 | 内容只剩标题；可选办法变强制；精确片段改变 |
| 暂缓期间修改再恢复 | 修复全部范围 → 保留目标但只加测试并新增无依赖限制 → 最终范围改为指定子集 → 恢复修复；最终纳入子集修复、测试及新增约束 | 回滚快照丢掉新约束；恢复已撤回的广泛范围；执行仍延期 |
| 依赖与迟到证据 | Atom B 依赖 A 的具体结果；A 未提供结果或回传只对应旧输入/旧产物时，不将 B 前提标为已满足；匹配证据到达后正确更新 | 仅凭“完成”声明或错误版本证据就继续 |
| 补全后被纠正 | 利用明确上下文补全指代/省略条件；随后用户纠正该解释，只修订相关任务与依赖，保留有独立依据的内容 | 推断被固化为用户要求；纠正连带删除无关约束 |
| 未决内容与调查 | 区分实现自由、可通过调查解决的事实缺口、确需用户取舍的结果；形成有依据的调查任务或明确未决内容 | 什么都问；什么都猜；为继续执行擅自选择结果或扩大权限 |
| 任务切换与恢复 | 两个任务有相似措辞但约束/Authority 不同；切换后隔离，恢复后使用该任务的最新意图和适用证据 | 同名合并；跨任务权限或约束误传；使用陈旧产物 |

每项查看实际输入、前后 IR、模型补全与核对记录、确切 Compiled Intent，以及受控执行器收到产物后选择的任务/等待行为。无工具执行器的选择和复述只能证明其接收与理解的局部表现；依赖调度的硬约束需确定性消费检查或后续执行证据，不能靠文字承诺认定已经实现。

确定性失败检查只围绕本次变化：错误/跨任务引用、无效替换范围、缺失前提、无效候选不提交、提交后重放和交付身份一致。模型语义失败与结构拒绝分别记载。检查发生错误时先定位输入理解、IR 维护、Atom/Relation 编译、核对、交付或消费中的具体问题，不默认提示词修补或扩大架构。

#### 5. 本轮及下一开发阶段的结束条件

撤回“本轮总设计已结束、仅有冲突才重开”的判断。已有职责、流程和检查可以帮助比较候选，但尚未解决怎样形成 Atom、选择拆分粒度、依据新交互修正任务与依赖等算法问题。后续研究应给出超出现有共识的方案差异与可反驳预测；不必等当前候选失败才能探索更优方案。

下一开发阶段的完成条件是：确定性契约检查通过；六项已冻结开发场景完成语义核对；实际交付与记录一致；失败和未覆盖边界被保留。若某项失败，候选仍未完成，不以其余项通过抵消。以上支持的是候选功能成立，不能称为 coding 质量、独立泛化、长期可靠性或管理层额外价值。

随后按既有 spec 的研究阶段开展强对照和归因；若任务中的实际行为尚不可测，应先解决可观察性。通过开发验收不自动启动大 benchmark、宿主集成或长期记忆/偏好接入。每轮全历史重建和普通 Agent 仍是有效比较方向，不因选择本候选而预先排除。

## User Stories

1. As a research lead, I want each claimed benefit expressed as a falsifiable comparison, so that a null or negative result remains informative.
2. As a research lead, I want the first study to target local usefulness rather than universal generality, so that the MVP does not overclaim.
3. As an experiment designer, I want every Compiler treatment to manage Intent IR and emit Compiled Intent through one semantic contract, so that internal representations can vary without changing what is being tested.
4. As an experiment designer, I want Compiler treatments separated from context-management baselines and causal controls, so that generic preprocessing is not mislabeled as Intent Compiler evidence.
5. As an experiment designer, I want multiple qualifying Compiler mechanisms behind the same semantic contract, so that a specific implementation is not confused with the category.
6. As an evaluator, I want a hidden Current-Intent Ledger for every trajectory prefix, so that behavior can be judged independently of a candidate Intent IR representation.
7. As an evaluator, I want behaviorally phrased probes, so that opaque, natural-language, and structured mechanisms can be compared without field alignment.
8. As an evaluator, I want oracle-current-intent substitution, so that upstream maintenance error can be separated from executor limitations.
9. As an evaluator, I want persistent end-to-end execution, so that understanding improvements must survive contact with a changing workspace.
10. As an evaluator, I want final success and turnwise intent measures reported separately, so that lucky success and verifier blind spots are visible.
11. As an evaluator, I want false merge, false split, stale-requirement retention, collateral damage, first drift, and recovery measured, so that averages do not hide characteristic failures.
12. As an experiment operator, I want fresh and history-enabled executor conditions distinguished, so that an isolation control is not mistaken for the production architecture.
13. As an experiment operator, I want matched information, model, tool, and action budgets, so that extra capability is not attributed to architecture.
14. As an experiment operator, I want both equal-budget and natural-cost results, so that causal attribution and practical efficiency can be assessed separately.
15. As a reproducibility reviewer, I want dataset provenance, verifier isolation, reference-solution checks, and future-information audits, so that benchmark leakage cannot produce a false gain.
16. As a reproducibility reviewer, I want trajectory and twin group splits kept intact, so that near-duplicate semantic paths do not leak across development and test sets.
17. As a framework integrator, I want compiler calls, Compiled Intent delivery, executor calls, tokens, latency, retries, truncation, tools, and artifacts logged separately per turn, so that cost and failures can be reconstructed.
18. As a framework integrator, I want evaluation diagnostics emitted as structured artifacts, so that the trial-level scalar reward does not erase turnwise evidence.
19. As a method author, I want negative results against strong rewrite, folding, memory, or structured-state baselines retained, so that the study can reveal specialization rather than force a winner.
20. As a future adopter, I want the same boundary tested outside coding before it is called relatively general, so that domain-specific improvements are not advertised as framework-level evidence.
21. As a future adopter, I want human calibration before relying on simulated-user rankings, so that deployment expectations reflect real interaction behavior.
22. As a user in an interactive task, I want the system's clarification and repair behavior evaluated, so that passive replay is not presented as complete intent understanding.
23. As a user with scoped Authority, I want grants, revocations, expiry, and cross-task isolation tested behaviorally, so that reliability gains do not hide dangerous permission carryover.
24. As a research lead, I want a Measurement & Identification Matrix to mature with the experiment, so that measurement logic is explicit early without inventing formulas or decision thresholds before the design and runtime evidence can support them.
25. As a research lead, I want evaluation-only interventions on a Compiler's opaque managed state, so that improvements can be attributed to persistent intent maintenance without requiring every Intent IR to expose the same schema.
26. As a method author, I want 0b to support deliberate design and ablation of Intent IR representations, relations, update rules, inference policies, and compilation methods, so that the project produces new mechanism knowledge rather than only ranking pre-existing systems.

## Implementation Decisions

- The experiment fixes a semantic flow—Intent Compiler manages Intent IR and emits Compiled Intent—while treating how Intent IR is represented, related, stored, updated, inferred over, and rendered as the mechanism design space. Those choices remain open before 0b so that they can be deliberately prototyped and compared rather than assumed in advance.
- A treatment qualifies as an Intent Compiler only if it incrementally interprets eligible interaction and evidence, manages continuity and change in intent separately from the Exec Loop, and emits a distinct Compiled Intent. It must behaviorally handle revision/invalidation, unresolved alternatives, occurrence identity, and suspension/resumption where the trajectory contains them. These are functional requirements, not a schema.
- Context-management references are a separate comparison family: raw history, recent window, rolling summary, retrieval memory, conversation rewrite, and intent-aware folding such as U-Fold. Their outputs remain labeled as history or memory inputs rather than being renamed Compiled Intent. If a particular implementation satisfies the full Compiler contract, it may additionally be analyzed as a Compiler competitor, but its name alone does not qualify it.
- Causal controls are separate again: paired sham computation, oracle Compiled Intent, and guardrail-only execution. A sham is paired to one nominated active arm and emits a matched but semantically non-informative artifact; it is never treated as a universal placebo or as Compiled Intent.
- The experiment uses one common variable-artifact delivery seam immediately before each executor turn. Raw current/history input, rewrite, structured state, sham, oracle, and Compiler outputs all use the same executor-side placement and Adapter path, while an immutable type label preserves what each artifact actually is. Only oracle and qualifying Compiler artifacts are called Compiled Intent. Fixed System Prompt, tools, tool permissions, and workspace access remain separate. In the first isolated condition, current user input and source history are inputs to the arm that produces the variable artifact; they are not also exposed directly to the executor.
- An environment-specific wrapper acts only as the Adapter. It serializes the arm's typed variable artifact for a fixed executor and separately records exactly what the executor received; only artifacts typed as oracle or qualifying treatment are Compiled Intent. Prompt injection, structured calls, files, or other delivery mechanisms are implementation details, not the project interface.
- The first isolation condition uses a persistent workspace with a fresh executor conversation each turn. Experiment 1 adds a matched history-enabled condition; raw history or memory is supplied explicitly and equally rather than inherited through uncontrolled native resume.
- Executor outputs and environment observations return as eligible evidence on the next Compiler update. Only the Intent Compiler decides whether and how that evidence changes Intent IR and the next Compiled Intent.
- The Current-Intent Ledger is evaluator-only and remains outside the product domain model. It represents acceptable behavior sets, forbidden outcomes, superseded commitments, unresolved or not-yet-formed alternatives, relevant evidence dependencies, and occurrence identity where observable. It may preserve multiple valid interpretations and annotator disagreement instead of forcing a unique intent state.
- Experiment 0a uses context-management references plus nominated paired shams and oracle controls to validate wiring and attribution. Experiment 0b adds at least one qualifying Compiler treatment; an Atom/Relation implementation is not required, but a generic summary or rewrite is insufficient unless it meets the functional contract.
- Three evaluation paths reuse the same variable-artifact seam: frozen behavioral probes, oracle-current-intent substitution, and persistent end-to-end execution. All arm artifacts traverse that seam for positional parity, but only qualifying Compiler and oracle arms place Compiled Intent there.
- Every result is reported under equal total budget and natural running cost. Oracle is an upper-bound diagnostic and is excluded from practical cost rankings.
- Separate verifier execution, hidden evaluator assets, source-evidence digests, and artifact-only handoff are required for confirmatory runs.
- No unprovenanced or future-requirement-contaminated task set is eligible for formal results. Experiment 1 requires a verified fixed dataset or a fully audited derived subset.
- The replayed track cannot support claims about clarification policy, intent formation through interaction, or user repair. Experiment 1 adds an external controlled-interaction driver; Experiment 3 replaces it with real users for calibration.
- Authority representation remains undecided, but Experiment 1 includes behavioral trajectories for grant, expiry, revocation, task switch, and cross-task non-transfer.
- Final executor/compiler models, supported seeds, action caps, Compiled Intent size limits, Adapter rendering, probe density, task sample, minimum effect, and final sample size remain open until smoke or pilot evidence exists. Every 0a-s calibration batch nevertheless runs from a versioned provisional configuration recorded before that batch; changing it invalidates only the affected calibration checks and requires them to be repeated.
- The Measurement & Identification Matrix lives in this spec, keeping it inside the approved source-of-truth set. It is a staged design artifact rather than a fully specified prerequisite:
  - **v0 — identification map, before prototyping:** records each phase's experimental contrast, target dimension, observable family, supported inference, unsupported inference, and the evidence needed to mature the row. It does not require metric formulas, minimum effects, or pass/fail thresholds.
  - **v1 — operational map, after Experiment 0a-s smoke and before 0a-g:** adds definitions grounded in the actual task, event, log, probe, and verifier schemas, including observation timing, aggregation level, missing-data handling, coverage checks, the C0 diagnostic comparator, and the gate rules used on untouched 0a-g twins. It need not contain confirmatory MDE or sample-size decisions.
  - **v2 — frozen analysis contract, after a non-confirmatory pilot:** preregisters primary and secondary endpoints, formulas, minimum practical effects, decision thresholds, sample size or power logic, multiplicity handling, and stopping or progression rules for the confirmatory stage. Data used to form v2 is not reused as confirmatory evidence.
- Later phases extend the Matrix only for the new claims and conditions they introduce. Unresolved Phase 1–3 formulas or thresholds do not block Experiment 0a; a phase cannot become confirmatory until its applicable Matrix rows reach v2.
- State-causality testing uses an evaluation seam rather than a production Intent IR schema. A candidate must permit opaque snapshot/restore/reset, or an equivalent deterministic replay of admitted events to a named state version. The harness may record state-version and content digests but does not inspect or score private fields. Mechanisms that cannot support either control remain eligible for exploratory comparison but cannot contribute state-causal evidence toward C2.

### First qualifying Compiler candidate: implementation-ready decisions

This section freezes the behaviour of the first candidate only. It is not the final Intent IR, Atom, Relation, Authority representation, or a claim that this representation is best. Its purpose is to cross the zero-to-one boundary with behaviour that cannot be reproduced merely by asking a model to summarize or format the conversation.

#### 1. What the Compiler persists

The Compiler store is separate from the observer store and the coding worktree. Its authoritative history is an append-only sequence of admitted inputs, model proposals, validation results, committed changes, state versions, Compiled Intent artifacts, delivery attempts, and evidence-admission decisions. Content-addressed state snapshots are replay accelerators; a snapshot is ignored if its digest does not match replay.

For this candidate, the current state contains only the minimum records needed for the required behaviour:

- task occurrences with code-assigned stable IDs, `active` or `suspended` status, source references, and the currently selected task ID;
- requirements with code-assigned stable IDs, task ownership, `[LLM-PROTOTYPE]` normalized text, `active`, `superseded`, or `withdrawn` status, source references, and replacement links where applicable;
- unresolved content with code-assigned stable IDs, the affected task, `[LLM-PROTOTYPE]` alternatives, source references, and open/resolved status;
- explicit Authority statements with stable IDs, `global` or one-task scope, active/superseded/withdrawn status, and user-input source references; fixed OpenCode tool policy remains separate and cannot be enlarged by these records, and task-scoped Authority never transfers to another occurrence;
- execution facts and an execution status chosen from `unknown`, `in_progress`, `reported_complete`, `check_failed`, or `verified_complete`, each linked only to admitted evidence IDs and kept separate from user requirements and Authority.

Stable IDs, versions, timestamps, source identities, digests, status transitions, and replacement links are assigned or checked by code. The model never chooses persistent IDs and never overwrites a record. A withdrawn or superseded record remains replayable.

#### 2. What the model may propose

The first candidate accepts text-only task messages; a registered Compiler turn containing image, file, or other task-content parts is rejected before the model call rather than partly compiled. On each admitted input, the model receives the current state, the exact new user text with source offsets, and only the evidence admitted under section 3. It has no coding tools, worktree access, evaluator assets, Compiler-store write access, or direct channel to the Exec Loop.

The model returns one ordered proposal containing `base_state_version`, the input identity and digest, and operations chosen from this closed set:

```text
create_task
select_task
suspend_task
resume_task
add_requirement
replace_requirement
withdraw_requirement
add_unresolved
resolve_unresolved
add_authority
replace_authority
withdraw_authority
record_execution_fact
record_execution_status
no_change
```

Every intent or Authority operation must cite an exact span of the current user input. An operation that refers to an existing task, requirement, unresolved item, or Authority statement must use its existing ID. New records use proposal-local references; code allocates their persistent IDs after validation. Evidence-based operations may only be `record_execution_fact` or `record_execution_status` and must cite admitted evidence IDs. Model confidence and model self-report have no effect on validation.

The model does **not** return `next_private_state`, `compiled_intent`, a replacement prompt, a plan, or an executor answer. Natural-language interpretation remains fallible and is evaluated experimentally; deterministic code guarantees only that a proposal is source-grounded, refers to existing records, uses permitted transitions, and cannot cross the user/evidence authority boundary.

#### 3. Which execution evidence enters the next update

All observed execution data may be retained by the observer, but only the following may be admitted to the Compiler:

- persisted terminal `ToolPart` results or errors with `sessionID`, `messageID`, and `callID`; `tool.execute.after` alone is supplementary and cannot establish a terminal result;
- persisted assistant and step-finish records with model/provider identity, tokens, timestamps, finish/error status, and retry parts;
- workspace diffs tied to the same run, task occurrence, turn, and post-execution workspace snapshot;
- test or verifier results explicitly marked Compiler-visible before the run and tied to the exact workspace snapshot they checked;
- executor completion statements, stored only as statements made by the executor, never as verified completion;
- declared environment observations produced by an allowed tool and tied to its persisted terminal tool result.

Evidence is admitted only if its run, task occurrence, turn, session, message and call identities required by that source are present; its payload digest is stable; its causal parent exists; it was produced after the previous update boundary and before the new input was admitted; and any referenced workspace snapshot matches. Exact duplicate identities and digests are deduplicated. The same identity with a different digest is an instrumentation failure and blocks the update. Cross-run, cross-task, future, stale, incomplete, unverifiable, undeclared-side-channel, Compiler-store, and evaluator-only evidence is retained for audit where available but not shown to the model.

If valid sources disagree semantically, both remain visible with their provenance. A persisted tool result outranks an unmatched hook callback about that same call, and a declared verifier result proves only the checks it actually ran. A workspace diff proves that files changed, not that the change is correct. An executor claim proves only that the claim was made. The model may record the conflict or uncertainty, but no evidence may add, replace, or withdraw a user requirement or Authority statement.

The deterministic validator limits execution-status changes by evidence type: an observed assistant/tool step may establish `in_progress`; an executor statement may establish only `reported_complete`; a declared check failure may establish `check_failed`; and only a predeclared full verifier pass tied to the exact current workspace snapshot may establish `verified_complete`. Any later workspace mutation makes that verification stale and returns the status to `in_progress` until the applicable verifier runs again. Feasibility judgments that exceed these facts remain source-linked execution facts or unresolved content, not verified status.

#### 4. Deterministic validation and commit

Code validates the whole proposal in order against one exact base version. It checks the schema, input/evidence digests, source spans, existing targets, proposal-local references, task ownership, permitted status transitions, duplicate/conflicting operations, and the channel allowed to support each operation. A suspended task may receive user-requested requirement changes but cannot be selected for execution until resumed. The selected task must be active. Similar text never merges task occurrences; continuity requires an explicit existing task ID, and ambiguity is recorded with `add_unresolved` instead of guessed.

The proposal is all-or-nothing. No valid-looking subset is committed when another operation fails. Parse/schema failures and invalid references may receive one recorded model retry containing only the validation errors and the same inputs. If that retry fails, the turn stops with no state change and nothing is delivered to the Exec Loop. There is no fallback to raw input, summary, or model-written text.

After validation, code applies the operations to an in-memory copy and computes a canonical digest. A semantic no-op records the turn and proposal result but does not create a new state version. Any actual state change creates exactly one monotonically increasing version. State artifacts are written first; a durable commit record containing the base version, new version, operation IDs, source digests, state digest, and resulting Compiled Intent reference makes the version current. Files written without a complete commit record are ignored during recovery.

#### 5. Deterministic Compiled Intent

Compiled Intent is projected by code from one committed state version. The model is not called during projection. The canonical artifact contains:

```text
artifact type and schema version
state version and state digest
selected active task ID and its current description
active requirements for that task, in stable creation order
superseded or withdrawn requirements for that task that the executor must no longer apply
open unresolved content for that task
current global Authority statements plus statements scoped to the selected task, and their source references
admitted execution facts that are still relevant to that task
source IDs for every included item
```

It excludes other active or suspended tasks, private model reasoning, rejected evidence, raw observer logs, hidden verifier data, plans, and complete chat history. If no task is selected, it emits no coding instruction. If unresolved content is open, the artifact states deterministically that the executor must not make workspace changes that depend on choosing one alternative; an interactive run may request clarification through a separately declared policy, while replay waits for the next supplied input.

The canonical artifact is serialized with stable key and list ordering. A fixed renderer turns it into the executor message; it may change presentation but may not add, drop, summarize, or reinterpret fields. The artifact and rendered message have separate digests. The run manifest fixes a maximum UTF-8 artifact and rendered-message size. Exceeding either limit fails projection and blocks execution; the first candidate never silently truncates, summarizes, or asks a model to compress intent.

Compiled Intent has its own monotonically increasing version. Projection reuses the prior artifact version and digest when its canonical payload is unchanged, including a genuine no-op turn. Each delivery attempt is recorded separately, so repeated delivery does not manufacture a new semantic artifact.

#### 6. Turn order, retries, and recovery

Only one turn per run may be unfinished. Its order is:

1. durably save the exact raw input and its OpenCode identities;
2. load the last committed state and the eligible evidence window;
3. obtain and durably save the model proposal;
4. validate the proposal and deterministically build the next state;
5. write the state snapshot and Compiled Intent artifact, then append the durable commit record;
6. mutate the existing OpenCode text parts in place with the fixed rendering of that artifact;
7. in the awaited `chat.params` hook of pinned OpenCode v1.18.31, read the just-persisted user message by the supplied session/message ID and compare the complete expected text-part ID/text set and digest; a missing target, extra/unexpected text part, mismatch, or read failure throws a non-retryable delivery-guard error before provider dispatch;
8. allow provider execution only after that matching readback; after idle/terminal state, perform a second SDK reconciliation of persisted messages, parts, tool results, retries, usage, and workspace diff;
9. admit eligible returned evidence only at the next input boundary.

An input identity plus raw digest is the idempotency key. Repeating both reuses the saved proposal, committed state, and Compiled Intent without another model call or version increment. Reusing an identity with different content is a hard conflict. Recovery follows the last durable point: raw input without a saved proposal repeats only the model call; a saved proposal without a commit is revalidated; a commit without confirmed delivery reuses the same artifact; confirmed delivery with unfinished execution is reconciled and is never blindly redelivered. A delivery retry is allowed only when no assistant step, tool call, or workspace change exists for the prior attempt. Otherwise the run is marked contaminated and must restart from the declared workspace/state snapshot.

A delivery mismatch does not roll back the admitted user intent or delete the committed state. It blocks further turns and execution until recovery because silently returning to the previous state would lose an accepted user change. The failed delivery remains explicit in the history. Old versions are inspected by replay; evaluation reset/restore starts a separately identified run from a named version rather than overwriting normal history.

#### 7. Read/write ownership in the OpenCode prototype

- The Intent Compiler is the only writer of its input/proposal/change/state/Compiled Intent store. Its small external interface prepares one turn, confirms or rejects delivery, and admits the prior turn's eligible evidence.
- The model adapter receives a read-only input bundle and returns a proposal. It cannot access the store, workspace, OpenCode client, or Exec Loop.
- The deterministic projection code reads one committed state and returns a canonical Compiled Intent plus rendered text; it writes nothing.
- The OpenCode adapter calls the Compiler from awaited hooks, mutates the existing text-part objects in place, and in pinned v1.18.31 uses the awaited pre-provider `chat.params` hook for strict target-message SDK readback. A non-retryable guard error blocks provider dispatch on missing or mismatched delivery. The Adapter reports these facts but does not interpret intent; this proves the persisted pre-model path, not provider-wire bytes after later transforms or serialization.
- The observer independently records OpenCode inputs, persisted messages, model/tool/usage/timing data, retries, diffs, and reports. It may record copies of Compiler events for a joined report, but those copies are not the Compiler's source of truth and the observer cannot modify Compiler state.
- The Exec Loop receives only the rendered artifact and fixed executor inputs for the first isolation condition. It has no Compiler mutation tool and its tool permissions deny the external Compiler store. This is logical access isolation inside one OpenCode process, not an OS security boundary.
- Hidden evaluators and verifiers write evaluation records outside the Compiler. Only results declared Compiler-visible before the run may be admitted on the next boundary.

The first isolated Compiler condition does not also expose the raw current user message or native conversation history to the executor; either would permit the executor to bypass the intervention by reconstructing intent itself. Raw history, rewrite, and later history-enabled conditions use the same delivery position as separately typed comparison arms.

OpenCode does not provide a project-controlled ordering contract for multiple files inside the same project plugin directory. Therefore a run never loads an independently active observer entry and Compiler entry that both handle the same `chat.message`. One project plugin entry selects the arm and calls modules in explicit order: observer raw capture, Compiler preparation and in-place mutation when applicable, then observer delivery expectation. In a raw arm the same entry calls only the observer path. The observer remains a separate module and separate store, but hook ordering is owned by this single entry rather than filename order.

#### 8. What this candidate would and would not prove

The candidate has system-owned, testable behaviour: stable occurrence identity; source-grounded legal changes; preserved tombstones; all-or-nothing commit; deterministic replay; deterministic selective projection; no-op stability; evidence/intent separation; and delivery/version reconciliation. Unit tests can prove those code behaviours. Semantic interpretation by the model remains fallible and requires the already-defined behavioural experiment. A successful model proposal or readable artifact alone proves neither correct intent understanding nor usefulness. Experiment ordering and selection of the first official coding trajectory remain deliberately open for the user discussion requested after this architecture is fixed.

#### 9. Implemented file responsibilities

Implementation belongs in `../..`; TypeScript builds to `dist/` ESM JavaScript. The observer stays independently named and is not folded into the Compiler. Migrating observer source from JavaScript to TypeScript is a mechanical implementation step and is not counted as Compiler progress.

- `src/core/intent-compiler.ts`: the only public Compiler interface; prepare one turn, confirm/reject delivery, admit returned evidence, and recover one run while hiding ordering and persistence details from host Adapters.
- `src/core/intent-state.ts`: the closed proposal operations, deterministic validation, ID allocation, legal transitions, all-or-nothing reducer, and deterministic Compiled Intent projection.
- `src/core/compiler-store.ts`: append-only Compiler history, content-addressed state/artifact files, commit markers, idempotency lookup, replay, and recovery. It does not reuse the observer event log as the source of truth.
- `src/model/compiler-model.ts`: construct the read-only interpretation request, invoke the selected independent model session with tools disabled, and parse only the proposal envelope. It has no state-update or Compiled Intent rendering code.
- `src/adapters/opencode.ts`: awaited hook coordination, in-place message replacement, the v1.18.31 pre-execution `chat.params` readback gate, terminal reconciliation, and forwarding observations to the separate evidence-admission path.
- `src/adapters/prdcheck.ts`: translate explicitly tagged prdcheck user inputs, harness instructions and execution results without importing prdcheck semantics into the core; preserve run/stage/session/turn identities needed for provenance and parallel-path isolation.
- `src/observer/*.ts`: retain passive observer responsibility but split raw capture from delivery expectation so the explicit project entry can record the pre-mutation input and post-mutation expected message without relying on plugin-file order.
- `.opencode/plugins/experiment-runtime.js`: the built-JavaScript project entry for experiment runs; its declared arm mode wires observer-only or observer-plus-Compiler in a fixed call order. It replaces the current standalone entry rather than adding a second competing `chat.message` plugin.
- `test/intent-state.test.ts`: direct deterministic tests for every legal/illegal transition, occurrence identity, evidence non-escalation, atomic rejection, no-op stability, suspended-task behaviour, and projection selectivity.
- `test/compiler-store.test.ts`: commit-marker, replay, duplicate-input, crash-point, retry and restore tests.
- `test/compiled-intent.test.ts`: stable ordering/digests, exclusions, unresolved behaviour, current/stale artifacts, and size-limit rejection.
- `test/opencode-compiler-adapter.test.ts`: hook ordering, exact in-place replacement, readback mismatch blocking, and reconciliation tests against a narrow client Adapter.
- `test/prdcheck-adapter.test.ts`: source-channel classification, parallel stage/session identity, evidence translation, and prevention of raw-input leakage into isolated executor arms.

Tests use explicit proposal and evidence objects at the deterministic interface. They do not introduce a fake model server, fixed fake `compiled_intent`, or a smoke text file and do not present fixture passing as Compiler evidence. The separately recorded compat-007 real-model run establishes no-tool compatibility only; it does not replace semantic or coding validation.

### Environment-neutral Experiment 0 protocol

Experiment 0 fixes semantic capabilities and observable boundaries independently of a final runtime product, hardware class, container system, model host, or deployment topology. The first concrete implementation uses OpenCode, but its results must be described through this contract rather than treated as properties of all runtimes.

#### Common turn contract

Each arm receives the same eligible source input for a turn: the current user input, the predeclared source-history condition, the same eligible prior execution evidence, and a workspace cloned from the same matched snapshot. The arm transforms the admitted source into exactly one typed artifact. Executor inputs are delivered through distinguishable channels:

- **Fixed executor inputs:** System Prompt, tool descriptions, tool permissions, and workspace or environment handle. These do not become Compiled Intent.
- **Variable-artifact seam:** exactly one arm-specific artifact is delivered through the same executor-side position and Adapter path. Its immutable type is raw current/history input, rewrite, summary, retrieval result, structured state, sham, oracle Compiled Intent, or treatment Compiled Intent. In the first isolation condition this is the executor's only task-content channel; positional parity does not rename a baseline artifact as Compiled Intent.
- **Execution return:** proposed and performed actions, tool/environment observations, completion claims, errors, and other predeclared eligible evidence. It becomes available to the Intent Compiler only on the next update boundary.

Compiled Intent content remains structurally opaque to the harness. The harness may require an envelope carrying arm identity, artifact type, turn identity, version, provenance digests, size, and delivery status, but it may not require an Atom, Relation, graph, field ontology, or human-readable payload. The Adapter must preserve the distinction among channels and record exactly what reached the executor.

For attribution, the Experiment 0b Compiler is read-only with respect to the task environment: it interprets admitted inputs and returned evidence but cannot perform task actions, mutate the workspace, consult evaluator-only assets, or send undeclared side-channel messages to the executor. Compiled Intent may carry user-grounded goals, constraints, methods, Authority implications, resolved references, unresolved alternatives, and risk-conditioned inferences grounded in admitted interaction, declared environment capabilities, eligible evidence, and the applicable Authority/risk policy. It may not contain independently completed task artifacts, privileged evaluator knowledge, or task-solving work unrelated to expressing current intent. Any benefit from a separate planner, verifier, policy monitor, or execution advisor must be tested through an additional labeled factor rather than hidden inside the Compiler treatment.

Before 0b, development-only admissibility fixtures operationalize this boundary without prescribing an IR schema. Positive fixtures cover justified reference resolution, capability mapping, default inference, uncertainty preservation, and risk-conditioned escalation. Negative fixtures cover hidden planning, artifact completion, unverifiable assumptions, privileged-information use, and execution optimization unrelated to intent. Independent reviewers adjudicate disputed cases; unresolved boundary cases become an explicit factor or are excluded from the qualifying comparison rather than silently accepted.

#### Arm construction protocol

Every arm receives the same current user input, declared source-history condition, eligible evidence prefix, environment capabilities and task snapshot. It emits exactly one typed variable artifact at the same pre-execution boundary. The arm manifest, not its prose label, determines qualification.

| Arm | Eligible view and update rule | Typed output and timing | Evidence return and identification role |
| --- | --- | --- | --- |
| Raw history | Declared eligible history prefix, assembled without intent-specific transformation; no managed state | `raw-history`, emitted every executor turn | Receives no private return; the same declared evidence may appear next turn only through the source view. Full-information Compiler-absent reference and default C0 candidate |
| Conversation rewrite | Same admitted prefix transformed anew or by a declared rewrite policy; no persistent Intent IR or Compiler-only evidence channel | `rewrite`, emitted every turn at the common seam | If execution evidence is included next turn, it must be equally eligible for matched arms. Strong open-text context-management reference |
| Structured reference | Same admitted prefix mapped to a declared situation/task record without satisfying the full Compiler contract | `structured-reference`, emitted every turn at the common seam | No privileged return or private state. Strong structured context-management reference |
| Other context references | Recent window, rolling summary, retrieval memory or folding over the same declared source pool | Their real type, emitted at the common seam under a frozen update schedule | Remain references unless they independently pass the Compiler contract; useful for baseline-strength robustness |
| Paired sham | Same admitted source boundary and nominated arm's transformation opportunity, but a procedure barred from retaining or emitting current-intent semantics or action advice | `sham:<paired-arm>`, matched in timing, location and output envelope | Receives only the same eligible inputs/evidence opportunity as its nominated arm. Isolates extra compute, serialization, delivery and attention effects; never a universal placebo |
| Oracle | Evaluator projection from the hidden ledger for the current prefix only | `compiled-intent:oracle`, emitted at the same boundary | No learning/update from executor output; next-turn oracle is independently projected from that prefix's ledger. Information/headroom diagnostic, never a deployable treatment or cost competitor |
| Qualifying Compiler | Current input, declared source-history access and eligible prior execution evidence; incrementally updates Compiler-owned state under the functional contract | `compiled-intent:treatment`, separately versioned and emitted after update, before execution | Proposed/performed actions and declared observations return only at the next Compiler boundary. Tests C1/C2/C4; Exec Loop cannot write state or artifact |
| Guardrail-only | Same non-Compiler intent input as its matched reference; intervention occurs after interpretation and is explicitly labeled | `guardrail` or unchanged reference artifact at the common seam, with enforcement logged separately | Diagnoses downstream prevention/enforcement gains and cannot establish intent understanding |

Recent-window, summary, retrieval, folding and guardrail variants may be retained when development evidence shows they are competitive. They do not replace raw, sham or oracle, and placement never renames them Compiled Intent.

The **C0 diagnostic comparator** is frozen using only 0a-s development/calibration twins before 0a-g oracle-headroom or later Compiler-treatment results are examined. Selection prioritizes protocol compliance and adequate static/no-change performance; the exact rule becomes part of Matrix v1. It is used to establish whether progressive change is measurable and is not assumed to be the later C1 strongest matched reference. Oracle is excluded from the C0 primary estimate. All competitively plausible references remain eligible for 0b. The non-confirmatory 0b pilot then either selects the C1 reference through a predeclared rule or establishes a simultaneous comparison against all retained strong references; that choice is frozen in Matrix v2 before confirmation. If reference strength remains indistinguishable, results preserve that ambiguity rather than choosing a favorable comparator after the fact.

#### Trajectory and twin construction

- A base task begins from a behaviorally verified initial state and has an environment-observable outcome. Each prefix receives a hidden ledger entry containing acceptable action/outcome sets, forbidden and superseded outcomes, unresolved alternatives, and the semantic event introduced at that turn.
- A progressive/static twin pair shares the initial state, available capabilities, turn count, and final semantic objective. Reference execution must show that both endpoints are feasible and behaviorally equivalent; the intended difference is the history of intent change or interleaving, not final-task difficulty.
- Each primary pair manipulates one declared factor. Other differences—surface length, lexical cues, tool availability, action count, and environment facts—are matched or explicitly annotated as residual differences.
- No-change/paraphrase turns are negative controls; seeded stale, missed-update, wrong-occurrence, and collateral-action traces are positive controls for the evaluator.
- Authors record event boundaries without requiring a single correct hidden mental state. When multiple actions satisfy the current intent, the ledger preserves the acceptable set rather than choosing a reference action solely for scoring convenience.
- A reviewer who did not author the treatment mechanism checks prefix validity, future-information absence, endpoint equivalence, and whether the intended factor is actually isolated. Disputed or genuinely ambiguous prefixes are retained as ambiguity strata or removed from the deterministic calibration set; they are not silently forced into one label.

#### Evaluator and harness asset contract

These assets describe the experiment and its evidence boundary. They are evaluator/harness manifests, **not** a production Intent IR schema and not requirements on a candidate's private state representation.

| Asset | Required semantic identity and relations | Access boundary |
| --- | --- | --- |
| Base-task record | Source/version identity, initial observable state, capabilities, final-outcome verifier, provenance and contamination status; parent of every derived trajectory | Public task view excludes solutions, future turns, ledger and hidden verifier assets |
| Trajectory record | Ordered visible inputs and eligible evidence; links to one base task, one source graph where applicable, one twin group and one split; declares endpoint semantics and history condition | A turn exposes only its prefix to ordinary arms |
| Semantic-event record | Turn boundary and event family: reveal, revise, retract/relax, switch/interleave, suspend/resume, interpretation repair, world/evidence update, formed preference, infeasibility/negotiation, occurrence identity, or no-op/paraphrase; identifies the intended isolated factor | Event labels and counterfactual annotations remain evaluator-only unless naturally present in user input |
| Twin-group record | Groups static/progressive, counterfactual, paraphrase, occurrence, Authority, or other minimal pairs sharing the required initial/final invariants; records residual mismatches | Split as an indivisible group |
| Current-Intent Ledger prefix view | Acceptable and forbidden behavior/outcome sets, active/superseded/unresolved/not-yet-formed commitments, occurrence and Authority consequences, plus annotator disagreement | Evaluator-only; never supplied to ordinary arms or scored by structural alignment |
| Arm manifest | Arm family and immutable type, eligible source view, transformation/update timing, model/capability tier, state policy, output envelope, nominated sham/oracle relation, budget regime and delivery rule | Frozen before the applicable held-out comparison |
| Typed arm artifact | Exact payload or authorized auditable copy, immutable type, source-provenance digest, arm/turn/version identity, size, emission time and Adapter delivery status | All artifacts use the common seam; type identity is never collapsed |
| Managed-state record | Opaque state version/digest and named snapshot/reset/restore/replay events where supported; no shared private fields required | Compiler-owned; evaluator may control versions but Exec Loop cannot mutate state |
| Run record | Base task, trajectory, twin, split, arm, turn and stochastic identities; initial snapshot; causal event chain; executor/tool actions; environment observations/diffs; probes; verifier outcomes; errors; retries; truncation and attributed costs | Auditable after the run; evaluator-only fields remain segregated from execution |
| Split/provenance manifest | Development, 0a-g gate, 0b selection pilot, confirmatory, or later held-out assignment; upstream commit/archive hash, license, derivation method, generation model/seed when applicable, reviewer and known contamination/repair notes | Frozen before any data-dependent selection for the corresponding stage |

#### Benchmark allocation and thin overlay

No public benchmark is a complete Intent Compiler experiment. Existing assets supply task substrates or diagnostics; the common seam, evaluator ledger, causal controls, and split discipline remain a small project-specific overlay.

| Asset | Classification and allocated Matrix use | Reused | Required overlay / limitation |
| --- | --- | --- | --- |
| Microsoft Evolving Intent | **Primary substrate for M0a-C0/M0a-O and eligible 0b controlled trajectories**; its generated pool is frozen before use | Fully-specified/evolving task construction, reveal/revise/function-switch change plans and native source verifiers | Prefix ledger views, agent/evaluator separation, twins, probes, oracle, paired shams and common seam; regenerated pools are not direct replications of unpublished paper pools |
| EvolIF | **Secondary diagnostic for M0a-C0 and intent probes**, not an end-to-end Agent substrate | Constraint addition/modification/deletion, topic evolution and rule/checker assets | Hide instruction stacks/topic labels; add twins, oracle/sham and seam; no persistent task environment, so it cannot support long-horizon execution claims alone |
| Clean EvoCode-Bench release | **Primary substrate for M1-L long-horizon coding**, after provenance and grader audit | 5–15 turn persistent development, extension/correction/conflict tracks and cumulative executable tests | Ledger and requirement-to-test mapping, fresh/history factor, probes, oracle/shams, twins, common seam, separate verifier and small missing-event overlay; contaminated or unprovenanced copies are ineligible |
| LHAW | **Primary supplement for M1-I and M2-C3 non-code/clarification conditions** | Validated underspecification variants, removed information, expected questions, tool environments and interaction traces | Hide originals/gold fields, create prefix ledger and common controls; it mainly tests missing-information/clarification, not revision, suspension or Authority |

The thin overlay contains only what the claim requires: agent/evaluator-separated views; Current-Intent Ledger mappings; common typed delivery; static/progressive and other minimal twins; frozen probes; oracle projection; one sham per nominated active arm; grouped split/provenance records; and a small authored gap set for Authority lifecycle, explicit suspend/resume, occurrence identity, retract/relax and benign no-op cases. It does not recreate the underlying coding, research, or tool tasks.

#### Budget matching

- Equal-budget comparisons hold the executor, eligible source information, tool surface, action cap, initial state, and total pre-execution model-call and token ceilings constant within a matched set. Where a backend cannot enforce a field, it must expose it as unavailable rather than silently treating it as equal.
- The primary architectural contrast also holds the transformation/Compiler model and decoding capability constant wherever the mechanisms permit. A candidate whose learned weights, training data or required model capacity cannot be matched receives a capacity-matched reference or an explicit mechanism-by-capacity factorial; without one, its result is labeled whole-system evidence and cannot by itself support C2.
- Sham is paired to a nominated transformation or Compiler treatment, not used as one universal placebo. It uses the nominated arm's exact transformation model, decoding controls, call opportunities, source boundary, output-size envelope, delivery timing and common variable-artifact seam wherever those controls exist. Any unavoidable capability mismatch is declared and analyzed as an additional factor; it cannot support clean semantic attribution. The sham remains semantically non-informative.
- Oracle is an information upper bound and is excluded from practical equal-cost and natural-cost rankings. Its executor-side budget remains matched.
- Natural-cost runs preserve each arm's ordinary stopping behavior and report preprocessing, Compiler, Adapter, executor, tool, retry, and rework costs separately.
- A budget truncation or failed call is an observed event, not silently repaired with information unavailable to other arms.

#### Oracle, ledger, probe, and verifier independence

- **Ledger construction:** the Current-Intent Ledger is authored from task semantics before treatment outputs are inspected. It records acceptable behavior sets, forbidden and superseded outcomes, unresolved and not-yet-formed alternatives, occurrence identity, Authority consequences and event boundaries without prescribing a candidate representation. Multiple reasonable interpretations remain an acceptable set or disagreement stratum.
- **Oracle projection:** each oracle artifact is projected afresh from only the ledger state justified by the visible prefix. It may express current user-grounded outcomes, constraints, uncertainty, identity and Authority consequences. It must not expose later input, hidden tests, verifier logic, reference solutions, task implementation steps, privileged environment facts, or a unique choice where the prefix permits several.
- **Oracle review:** an independent reviewer audits prefix sufficiency, acceptable-set preservation and prohibited-information absence. Automated provenance checks confirm that every oracle claim traces to admitted prefix evidence or declared public capability. A leakage challenge deliberately searches for future, solution and verifier information before 0a-g.
- **Oracle consumption:** delivery is checked first; then counterfactual oracle pairs alter one intent consequence while holding executor inputs and environment fixed, and paraphrase/no-op pairs preserve semantics while changing wording. Directionally selective behavior is evidence of consumption. Model acknowledgment or restatement alone is not.
- **Oracle interpretation:** not delivered means a protocol/Adapter failure; delivered but not behaviorally consumed means a consumption/interface failure; consumed but without task headroom means intent information is not the active bottleneck for that testbed/executor; improvement only on leaked or solution-like content invalidates the oracle. None is evidence that an implementable Compiler works.
- **Paired-sham construction:** every nominated active transformation or Compiler has its own sham because capability, call schedule and output envelope can differ. The sham matches model/capability tier, source-access boundary, call opportunity, output-size band, emission time, common-seam placement and applicable budget as closely as enforceable, while containing no current-intent semantics, action recommendation, future input, ledger, verifier or solution information.
- **Sham audit:** blinded reviewers and development-only behavioral probes test that a sham does not improve identification of active, stale, unresolved or occurrence-specific requirements above its admitted non-semantic information. Exact text need not be meaningless, but it cannot resolve the task's current intent. If semantic non-informativeness cannot be maintained, that sham contrast is invalid rather than replaced by a universal placebo.
- **Sibling probes:** frozen probes run from a cloned prefix and frozen typed artifact. They cannot mutate the main executor conversation, workspace, Compiler state or subsequent evidence. The shared probe families are: active/superseded requirement discrimination; unresolved/not-yet-formed recognition; occurrence attribution; change recognition; action-consequence choice; suspend/resume recall; Authority allow/deny/expiry; and no-op stability.
- **Layered observation:** intent probes measure the artifact's actionable semantics; proposed/performed actions and tool traces measure behavioral choice; environment diffs measure actual effects and collateral changes; independent verifiers measure declared outcomes. Self-reports and private IR field matches are diagnostic only.
- **Verifier independence:** verifiers inspect observable environment state and declared artifacts, not private Intent IR, ledger structure or treatment labels. Ledger authoring, oracle projection, probe construction and verifier implementation have independent review paths; shared LLM judges, where unavoidable, are calibrated against blinded human/programmatic samples and reported separately from executable outcomes.

#### Semantic event log

Every turn must be reconstructible from immutable, causally linked events. The environment may choose its physical log format, but it must expose at least: eligible-input admission; arm transformation start/end; evaluation-only state snapshot/restore/reset/replay when invoked; typed arm-artifact emission; Adapter delivery and the executor-received type/digest; executor start, proposed/performed actions, tool observations and end status; evidence return; sibling probe result; verifier result; budget use; retry, timeout, truncation, and failure. Events carry run, base-task, twin-group, arm, turn, state-version, artifact-version, and causal-parent identities, plus timestamps and content digests. Raw sensitive content may be access-controlled, but a digest alone cannot replace the auditable artifact for authorized evaluators.

#### Isolation and leakage requirements

- Base-task, final-semantics, trajectory, and twin-group splits remain intact across development, pilot, and confirmatory sets.
- Every arm starts from an equivalent snapshot. Workspace state may persist within a trajectory, but conversation state, caches, retrieval indexes, Compiler state, and artifacts cannot cross arms or twin groups unless they are the explicit factor under study.
- Future turns, hidden ledger contents, probe answers, verifier assets, and reference solutions are unavailable to Compiler, Adapter, and executor processes. Artifact access and source-history access are allowlisted and auditable.
- Native conversation continuation is disabled for the fresh-context condition. A history-enabled condition must inject the same declared history channel across matched arms rather than inherit opaque runtime state.
- Compiler or reference output at turn *t* may use only inputs admitted through turn *t*. Execution evidence from turn *t* enters the management loop at turn *t+1* unless the protocol explicitly defines a separately analyzed within-turn repair loop.
- Seeded positive and negative faults test that probes and verifiers detect stale retention, missed update, collateral change, and channel leakage before treatment comparisons are interpreted.

#### Data partitions and freeze order

All variants descended from one base task, source graph, final semantic target, generated conversation family, or twin group stay in the same partition. Lexical rewrites, static/progressive versions, counterfactuals and adjacent prefixes never cross a boundary merely because their text differs.

| Partition | Permitted uses | Becomes unavailable for |
| --- | --- | --- |
| Development / 0a-s | Build and repair tasks, ledgers, twins, probes, oracle/sham procedures and logging; select the C0 diagnostic comparator and retain the competitively plausible C1 reference set; define Matrix v1 operational rules | C0/oracle/sham gate estimation, treatment confirmation, reported generalization |
| Untouched 0a-g | Apply frozen v1 to estimate phenomenon sensitivity, oracle consumption/headroom and nominated sham interpretability | Any later change to the tested v1 metric, comparator or gate rule; Compiler usefulness claims |
| 0b mechanism-selection pilot | Qualify and compare candidate mechanisms; discover heterogeneity; form endpoint formulas, MDE, sampling, multiplicity and decision rules for v2 | Confirmatory C1/C2/C4 evidence when used for prompt, mechanism, metric or threshold selection |
| 0b confirmatory | Test frozen C1/C2/C4 contrasts under v2 | Post-hoc mechanism, baseline, endpoint or subgroup selection; reused pilot tuning |
| Phase 1–3 held-out groups | Extend only the preregistered new phase claims after the applicable rows reach v2 | Earlier-phase tuning or Adapter/Compiler customization using their outcomes |

Before a partition is opened, its task/source/twin membership, provenance and evaluator access policy are sealed. Candidate prompts, update policies, mechanism composition and baseline settings receive equal development opportunity. C0 comparator selection uses only development/0a-s evidence. The eligible C1 reference set is retained before the 0b pilot; pilot evidence may apply the predeclared strongest-reference rule or justify simultaneous comparison, but any choice it informs is frozen in v2 and the contributing pilot data are excluded from confirmation. The 0a-g results can stop or redirect 0b but cannot tune the treatment. Pilot-discovered subgroup patterns are hypotheses unless repeated on untouched confirmatory groups. Later transfer failures may motivate separately labeled adapted variants, never retroactively alter the frozen zero-shot arm.

#### Experiment 0a baseline calibration and gate protocol

Experiment 0 uses two complementary functional substrate classes without fixing an implementation environment: a low-execution-noise intent-transition substrate that isolates understanding and update behavior, and a short executable substrate whose environment effects can be independently verified. Public benchmark allocation supplies most source tasks; the thin overlay fills only missing event/control cases.

**0a-s is protocol and baseline-instrument calibration, not effect estimation or problem-existence research.** Its coverage manifest includes every retained core arm and nominated sham; both functional substrate classes; every semantic event used in 0a-g; static/progressive and no-op twins; acceptable-set ambiguity; delivery/consumption checks; budget truncation and failed-call paths; and seeded stale, missed-update, wrong-occurrence, collateral, future-information and verifier-blind-spot faults. Coverage, not a fixed run count, determines its size.

0a-s exits only when authorized reviewers can reconstruct each turn from admitted input through typed delivery, action, evidence return, probe and verifier result; seeded faults are detected in the intended observation layer without unacceptable false positives on negative controls; evaluator assets are inaccessible to ordinary arms; endpoint-equivalent twins pass the declared feasibility check; oracle and nominated sham artifacts pass their independent audits; costs are attributable; and all rules needed for M0a-C0/M0a-O/M0a-P have been frozen as Matrix v1. Failure triggers repair and new development checks, never a treatment claim.

**0a-g applies v1 without revision to untouched twins.** Its primary C0 contrast characterizes the selected testbed: progressive versus static/no-change under the single frozen C0 diagnostic comparator selected in 0a-s; oracle is excluded from C0. This produces the baseline failure distribution against which later Intent IR mechanisms will be studied; it does not establish the problem's general existence. In parallel, oracle counterfactuals must show verified delivery and directional semantic consumption, then usable headroom on independent intent and end-to-end observations. Each nominated active reference is compared only with its own valid sham. Numerical progression rules are defined in v1, not here.

The gate branches are causal diagnoses rather than a binary search for significance:

- no C0 sensitivity: the selected task/measurement does not expose enough of the already established target phenomenon to discriminate Intent IR mechanisms; retain and report that baseline result, stop 0b on that testbed, and admit a different pre-eligible substrate or a newly versioned task design with new untouched gate twins rather than tuning the same gate until it becomes positive;
- oracle not delivered or not consumed: repair the seam/Adapter or executor interface before testing a Compiler;
- oracle consumed but no headroom: the executor/task has a floor, ceiling or non-intent bottleneck; change the diagnostic testbed, not the claim wording;
- sham reproduces the nominated arm's gain: attribute the effect to compute/delivery/attention and redesign that contrast;
- all three gates interpretable: open untouched 0b pilot groups; this still does not establish C1.

### Intent IR mechanism research for Experiment 0b

Experiment 0b is an active mechanism-discovery stage, not only a neutral evaluation of systems that already exist. On development and non-confirmatory pilot partitions, the project may formulate new Intent IR representations, relation systems, update operations, inference policies, and compilation methods; implement controlled prototypes; inspect mechanism-specific failures; run ablations; and revise them. Any data used for this research is excluded from frozen confirmation.

The following are competing design regions, not selected implementations. Each may be newly designed by this project and must independently satisfy the Compiler functional contract and emit Compiled Intent through the common variable-artifact seam; otherwise it remains a baseline or guardrail.

| Candidate family | Distinct internal principle | Experimental factors most likely to distinguish it | Qualification risk |
| --- | --- | --- | --- |
| Transactional event-state compiler | Preserves admitted interaction/evidence as an append-only change stream and incrementally materializes current intent through explicit add, revise, invalidate, suspend, resume, and no-op transitions; payloads may remain open text | Retraction, correction ordering, suspend/resume, long update chains, recovery after a bad intermediate update | A full-history rewrite masquerading as an event store does not qualify; update operations alone do not require an Atom schema |
| Intent-conditioned retrieval compiler | Maintains occurrence- and intent-conditioned indexes over source evidence, selects compatible evidence for the current task segment, and compiles the selected evidence into current intent | Similar-task collision, long-range resumption, distractor density, source sparsity, task-switch depth | Generic similarity retrieval is only a memory baseline unless it manages invalidation, continuity, unresolved alternatives, and occurrence identity |
| Temporal provenance compiler | Maintains evidence validity and causal/provenance dependencies over time, resolves superseding or contradictory evidence, and projects the currently supported intent | World update versus intent change, misleading correction, conflicting sources, Authority provenance, cross-task contamination | A fixed graph or obligation ontology is not required; if it only blocks actions after planning, analyze it as guardrail-only |
| Learned memory-policy compiler | Learns when and how to preserve, update, delete, reorganize, or abstract internal state, which may be latent, explicit, or hybrid, then decodes a distinct Compiled Intent | Noisy/paraphrased updates, distribution shift, representation compression, update selectivity, unseen change compositions | Extra model capacity and training data are major confounds; equal-capability and natural-cost reporting are mandatory |
| Adaptive multi-resolution compiler | Maintains multiple abstraction levels and selects or consolidates them according to current evidence and horizon rather than using one fixed granularity | Short versus long horizon, detail-sensitive constraints, cross-task reuse, abrupt scope change, context pressure | It must preserve source-grounded invalidation and not collapse into rolling summary or workflow-template retrieval |

Recent primary evidence motivates these regions without selecting one: learned CRUD memory policies show active update/delete/reorganize behavior ([UMA](https://arxiv.org/abs/2602.18493), [Memory-R1](https://aclanthology.org/2026.acl-long.583/)); intent-conditioned indexing reduces retrieval interference among similar facts ([STITCH](https://aclanthology.org/2026.findings-acl.584/)); learned abstraction can transfer separately from a frozen task executor ([MCMA](https://aclanthology.org/2026.findings-acl.1535/)); and provenance/dependency approaches expose materially different enforcement and traceability mechanisms ([FORGE / Formal Policy Enforcement](https://arxiv.org/abs/2602.16708), [ProvenanceGuard](https://arxiv.org/abs/2607.01236)). These are adjacent mechanism evidence rather than direct Intent Compiler effectiveness evidence. Policy or workflow-template compilation is therefore one adjacent seed, not the default architecture.

The candidate families are design regions and are not assumed to be mutually exclusive. For C2, each candidate preregisters a mechanism profile covering its primary state substrate, update policy, evidence-selection rule, projection/compilation rule, learning or training dependence, and shared components. Two candidates count as internally distinct only when their primary causal management mechanism differs and neither is merely a prompt, parameterization, or strict superset of the other. Hybrids require component ablations or a separately labeled factorial analysis.

The 0b pilot should cross mechanism profile with predeclared discriminating factors rather than rank one aggregate score alone. Candidate selection must not tune on confirmatory twins, and each candidate receives the same development budget. Mechanism-specific diagnostics are allowed, but shared outcome scoring remains behavioral and representation-agnostic.

Before entering a 0b treatment comparison, a candidate passes a representation-agnostic contract check on development-only fixtures. It must: update from newly admitted interaction or eligible evidence without delegating intent-state mutation to the Exec Loop; preserve continuity across turns; distinguish a revision/invalidation from a new occurrence when the evidence permits; retain unresolved alternatives instead of silently committing; suspend and resume relevant intent where the fixture requires it; emit a separately versioned Compiled Intent; and reject direct downstream mutation of its managed state. The check establishes treatment eligibility, not usefulness. A candidate that fails these semantic requirements remains an implementation experiment, baseline, or guardrail and is not counted toward C1/C2. State-control auditability is recorded separately: a qualifying candidate that lacks opaque state control or deterministic replay may contribute to C1, but it cannot supply M0b-SC evidence or count toward the state-causal component of C2.

#### Experiment 0b qualification, selection and confirmation

Candidate admission has three independent checks:

1. **Functional-contract check:** the continuity, update, uncertainty, occurrence, suspend/resume, versioning and ownership requirements above are demonstrated on development-only fixtures.
2. **Intent-inference admissibility:** positive fixtures permit source-grounded reference resolution, capability mapping, declared defaults, uncertainty preservation and risk-conditioned escalation; negative fixtures reject hidden task planning, completed artifacts, unsupported assumptions, privileged evaluator information and execution optimization unrelated to expressing current intent. Disputed behavior is excluded or made a labeled factor.
3. **Operational distinctness:** mechanism profiles declare state substrate, update policy, evidence selection, compilation rule, learning/training dependence, capacity tier and shared components. Two candidates support C2 only if their primary causal management mechanisms differ; prompt variants, parameter variants and an unablated strict superset do not count as distinct.

The 0b pilot compares every qualified candidate with every retained strong reference, each candidate's own paired sham, and the oracle upper bound on grouped held-out twins. It jointly records independent intent outcomes, end-to-end behavior, state-causality where supported, safety/tail events, equal-budget performance and natural running cost. Under a predeclared rule, the pilot may select the strongest matched C1 reference or establish a simultaneous-all-reference confirmatory comparison; because that decision uses pilot evidence, the contributing groups remain non-confirmatory. Candidate-to-oracle gaps are diagnostic: failed probes imply maintenance/projection error; correct probes with failed action sensitivity imply consumption; consumed intent with failed environment outcomes implies execution or verifier limits.

Pilot data may select candidate mechanisms and predeclared strata and may form Matrix v2, but cannot count as confirmatory evidence for any decision it informed. Before confirmation, v2 freezes primary/secondary endpoints, formulas, aggregation and missing-data rules, minimum practical effects, multiplicity, sample-size/power logic, stopping/progression rules, candidate set and baseline/sham pairings. Confirmation uses untouched grouped twins and the frozen protocol. C1 requires a qualifying non-sham local gain on both independent intent and end-to-end evidence without unacceptable safety or applicable cost tradeoff; C2 additionally requires repeatable gains from at least two operationally distinct mechanisms and applicable state-causal evidence; C4 is concluded separately from both equal-budget and natural-cost analyses. A result may support C1 without C2 or C4.

### Environment handoff contract

A future implementation environment is eligible for Experiment 0 only if it can provide or faithfully emulate all of the following capabilities:

1. Cloneable, equivalent initial task snapshots and persistent within-trajectory environment state.
2. Fresh executor context per turn for the isolation condition, plus explicit controllable history injection for later factorial conditions.
3. A pre-execution hook for reference or Compiler updates, one common variable-artifact delivery seam with immutable artifact-type labels, and a post-execution evidence-return boundary.
4. One fixed executor configuration per matched comparison, with auditable model/capability identity, tool surface, permissions, action limits, and supported stochastic controls.
5. Enforceable or auditable call/token/action/time ceilings and separate natural-cost telemetry for preprocessing, Compiler, Adapter, executor, tools, retries, and rework.
6. Sibling probe execution that cannot mutate the main run, and independent verifier execution over declared artifacts or observable state.
7. Inaccessible evaluator ledger, future turns, hidden tests, reference solutions, and verifier assets from the treatment and executor boundary; access attempts must be observable.
8. Immutable semantic event export with causal identities, content digests, exact delivered artifacts for authorized audit, errors, retries, truncation, and timestamps.
9. Dataset/task provenance, snapshot/version hashes, twin-group identity, and clean separation of development, pilot, and confirmatory artifacts.
10. Deterministic seeded-fault fixtures or equivalent controls that demonstrate the evaluator can detect stale state, missed revision, collateral damage, action non-consumption, and leakage before experimental interpretation.
11. Evaluation-only opaque Compiler-state snapshot/restore/reset, or deterministic replay of admitted events to a named state version, with state interventions isolated from the Exec Loop and recorded in the semantic event log.
12. Group-aware partitioning and run assignment that keeps base-task/source/twin families intact and prevents development, gate, pilot and confirmatory artifacts or caches from crossing boundaries.
13. Programmatic verifier support where the task permits, plus blinded independent review or judge calibration for semantic outcomes; evaluator failures and disagreements remain observable rather than collapsed into a scalar.
14. For interactive phases, a controllable external user/driver boundary that records questions, answers, latency and termination without granting it hidden treatment state; for human phases, support for the applicable consent, privacy and review requirements.

An environment may implement these capabilities with any suitable runtime. Eligibility is decided from a capability-and-observability audit, not from product name, hardware, container technology or deployment location. Failure to expose a capability is an environment limitation to resolve or declare; it is not evidence for or against Intent Compiler.

## Testing Decisions

### Evidence and research ladder

- **C0 — benchmark-specific baseline profile:** under matched final-task difficulty, characterize how progressive change or task interleaving affects turnwise reliability in the frozen C0 diagnostic comparator. C0 is a testbed-admission and reference result, not a new claim that long-horizon intent failure exists in general. Insufficient sensitivity means the current testbed cannot discriminate Intent IR usefulness.
- **C1 — local Intent IR usefulness:** at least one qualifying Compiler with independently managed Intent IR improves both an independent intent outcome and an end-to-end outcome over the strongest matched reference, beyond its paired sham and without unacceptable safety or applicable cost tradeoffs, on the preregistered task distribution and executor.
- **C2 — Intent IR architecture evidence:** at least two operationally distinct Intent IR mechanisms produce repeatable non-sham gains through the same Compiled Intent contract, supported by applicable state and mechanism ablations. Different mechanisms may win on different preregistered change strata; this establishes design knowledge about the architecture and its conditions, not merely a ranking or proof that one representation is universal.
- **C3 — relative generality:** a frozen Compiler mechanism and update/compilation protocol retain useful effects on held-out tasks and change compositions in at least two execution environments and more than one model family. Environment-specific Adapter translation is allowed and logged; Compiler prompts, weights, update policy, retrieval/selection policy, and task-specific logic may not change in the zero-shot transfer arm. Adapted variants are reported separately.
- **C4 — efficiency:** relative to the strongest matched reference, a qualifying Compiler lies on the performance-cost Pareto frontier or achieves comparable reliability with lower total token, latency, interaction, tool, and rework cost. Interaction cost is included only in controlled-interactive or human tracks.

### Measurement & Identification Matrix v0

This is the single authoritative Matrix. Stable row IDs connect each claim to its comparison, evidence, limits, and failure branch while formulas and confirmatory thresholds remain appropriately staged.

| ID | Claim / primary contrast | Unit and grouping | Primary substrate | Observable family | Supported inference | Not supported | Failure branch | Evidence to mature row |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M0a-S | Protocol integrity across every retained arm/sham; no treatment contrast | Complete development trajectory; arm, snapshot and twin linked | Evolving Intent plus deterministic authored overlay; EvolIF diagnostic | Causal-event reconstruction, type/channel/budget audit, seeded-fault and leakage detection | Protocol can be operationalized as v1 | C0 or any Compiler benefit | Repair assets, evaluator or capability boundary and repeat development checks | Coverage manifest and 0a-s exit obligations pass; freeze v1 before 0a-g |
| M0a-C0 | **C0:** progressive/interleaved vs static/no-change twin under frozen C0 diagnostic comparator | Complete untouched trajectory; twin-paired, turns repeated within trajectory, grouped by source task | Evolving Intent primary; EvolIF secondary | Reliability trajectory, first drift, stale/change/recovery and verifier outcomes | Baseline failure distribution and whether this testbed can discriminate later Intent IR mechanisms | General problem existence, Intent IR usefulness, strongest-reference identity or oracle quality | Retain/report the insensitive baseline; use a different pre-eligible substrate or newly versioned design with new gate twins | v1 freezes diagnostic comparator, unit, observation timing, missingness, aggregation and gate rule |
| M0a-O | Oracle Compiled Intent vs frozen C0 diagnostic comparator; counterfactual oracle consumption pairs | Complete untouched trajectory and frozen prefix; arm/twin paired | Same tasks as M0a-C0 | Delivery, selective action sensitivity, independent probes, environment/verifier headroom, leakage audit | Correct current-intent information is consumed and is an active bottleneck | Implementable Compiler effectiveness, strongest-reference identity or task solution quality | Delivery failure: repair seam; no consumption: repair interface; no headroom: change testbed/executor | v1 freezes consumption manipulation and headroom observations |
| M0a-P | Each nominated active reference vs its own paired sham | Arm-paired complete trajectory within source/twin group | Same tasks as nominated arm | Capability/call/output/timing parity, sham semantic audit, behavior and cost delta | Separates semantic information from extra compute/delivery/attention | Standalone arm quality or a universal placebo effect | If sham reproduces gain, invalidate semantic attribution and redesign that pair | v1 freezes each pairing and semantic non-information test |
| M0b-C1 | **C1:** qualifying Intent IR Compiler vs v2-frozen strongest matched reference, or simultaneous comparison against every retained strong reference, plus its paired sham; oracle upper bound | Held-out complete trajectory; base/source/twin grouped, selection data excluded | Evolving Intent controlled set | Independent intent outcomes, end-to-end outcomes, safety tails, oracle gap and both budget regimes | Local usefulness of the tested Intent IR management mechanism for the frozen task distribution/executor | C2, cross-environment generality or best representation | Keep null/negative result; localize maintenance, projection, consumption, execution or cost failure | Pilot forms v2 reference rule/endpoints/effects/sampling; untouched confirmation applies them |
| M0b-G | Candidate vs oracle on M0b-C1 tasks | Same grouped trajectories and diagnostic prefixes | Same as M0b-C1 | Oracle gap and probe/action/environment divergence by event stratum | Where attainable performance is lost | Cause of the gap without targeted ablation | Add separate development ablation; do not reinterpret confirmation | v1 defines divergence paths; v2 freezes diagnostic summaries |
| M0b-SC | Persistent/current state and artifact vs reset, stale, swap and no-op/paraphrase within candidate | Matched frozen prefixes/state versions; sibling probes isolated | Event-rich 0b tasks | Manipulation checks, artifact versions/digests, selective behavior, probes, diffs and verifier outcomes | Continuity/admitted update causally affects artifact and behavior | Correctness of a private IR field or representation | No state effect: audit control; artifact-only effect: consumption failure; self-report-only: no causal credit | Candidate-specific intervention map in v1; outcome/aggregation rules frozen in v2 |
| M0b-C2 | **C2:** at least two operationally distinct Intent IR mechanisms through the same contract, with targeted ablations | Mechanism × event-family trajectories; common held-out twins and capacity strata | Pooled controlled 0b substrates | Repeatable non-sham gains, contract/state-causal checks, component ablations, mechanism profiles and heterogeneity | Evidence for the Intent IR architecture plus conditional design knowledge about which mechanisms help which change families | C3 or a universally best representation | One winner: retain C1 only; shared capacity difference: add matched/factorial control; no component specificity: weaken architectural attribution | Distinctness, capacity and ablation audit before pilot; v2 freezes candidates/strata |
| M0b-C4 | **C4:** candidate vs the v2-frozen C1 reference rule under equal-budget and natural-cost regimes | Same grouped trajectories as C1; all costs attributed by component | Same as M0b-C1 | Reliability-cost frontier, calls/tokens/latency/tools/retries/truncation/rework; interaction only when present | Local practical efficiency or natural-cost system tradeoff | Cross-environment efficiency | Equal-budget loss: report only natural-cost result; missing costs: no C4 conclusion | v1 fixes telemetry; pilot forms v2 cost aggregation and practical margin |
| M1-L | Persistent replay; Compiler/reference × fresh/history-enabled executor factorial | Complete 5–15 turn trajectory; task/twin/event grouped | Clean audited EvoCode-Bench primary | Reliability AUC, first drift, recovery, false merge/split, stale/collateral and final success | Long-horizon coding maintenance and dependence on executor history | Interactive behavior or cross-environment generality | History-only/fresh-only gain is bounded to that condition; dataset failures block claim | Phase-specific v1 adds audited mapping/history policy; pilot freezes v2 |
| M1-I | Controlled-interactive treatment/reference vs matched replay and policy controls | Complete interaction; task/user-driver grouped | LHAW primary supplement | Ask/answer timing, unnecessary interruption, correction uptake, recovery and interaction regret | Clarification, repair and intent formation under validated driver | Real-user validity | Driver mismatch or policy artifacts require recalibration; defer human claim | Interaction v1 validates driver/events; v2 freezes policy endpoints and costs |
| M1-A | Authority grant/expiry/revocation/task-switch counterfactual twins | Complete Authority-bearing trajectory; event/twin grouped | Small authored gap overlay on M1 tasks | Unsafe carryover, expired use, cross-task leakage, false blocking and irreversible outcomes | Behavioral Authority lifecycle reliability | Universal Authority representation or policy completeness | Any catastrophic tail blocks positive safety wording even if mean rises | Authority v1 defines opportunities/severity; v2 freezes tail bounds/decision rules |
| M2-C3 | **C3:** frozen Compiler/protocol through declared Adapters vs matched references; adapted variants separate | Held-out base/source/task/event groups across environments and model families | LHAW non-code candidates | Effect/ranking stability, task-family interaction, zero-shot customization audit and failure strata | Relative generality under declared environments/models | Universal domain independence | Zero-shot failure bounds C3; adapted recovery is a new labeled claim | Transfer v1 freezes Compiler hash/customization budget; v2 freezes heterogeneity/generalization rules |
| M3-H | Authored/simulator conditions vs representative real-user interactions | User/task grouped complete interaction | Representative subsets inherited from M1/M2 | Ranking/effect calibration, clarification burden, repair, safety and subgroup divergence | Sim-to-real calibration for prior findings | Broad deployment validity | Rank reversal or subgroup harm limits deployment inference and simulator use | Human protocol v1 covers sampling/ethics; pilot forms v2 analyses |

Matrix maturity and phase progression are separate. Data from **0a-s** may define v1 and is excluded from M0a-C0/M0a-O gate estimation. Before any **0a-g** run, v1 freezes the C0 diagnostic comparator and selection rule, observable definitions, aggregation and missing-data handling, artifact-consumption checks, and the internal progression rule on untouched gate twins. This v1 gate need not identify the later C1 strongest matched reference or contain a confirmatory MDE, power calculation, or final sample size. Entry to 0b requires 0a-g phenomenon sensitivity, consumed oracle information with usable headroom, an interpretable paired-sham contrast, and untouched pilot groups. Before C2 analysis, v1 is extended with the exact state versions, intervention timing, manipulation checks, and failure interpretation for M0b-SC. The non-confirmatory 0b pilot may define v2; pilot data used for reference selection, formulas, endpoints, minimum practical effects, thresholds, multiplicity, sample size, or mechanism selection is excluded from confirmatory evidence.

### State-causality protocol

State causality is tested within a candidate mechanism; private IR fields are never aligned across candidates. Each intervention begins from the same admitted source prefix, environment snapshot, executor configuration, stochastic control, and budget except for the named state manipulation:

1. **Persistent vs reset:** compare the normal managed state with a fresh state that receives only the current-turn admissible input. A persistent advantage on long-range revision, resumption, or occurrence cases is evidence that continuity contributes beyond a per-turn rewrite.
2. **Current vs stale:** after a declared semantic update, compare the current state/Compiled Intent with a snapshot from immediately before that update. The expected behavioral difference is limited to consequences of the update; unrelated changes count as collateral sensitivity.
3. **Compiled-Intent swap:** hold executor inputs and environment fixed while delivering current versus stale Compiled Intent artifacts produced by the same candidate. This separates downstream semantic consumption from upstream state maintenance.
4. **No-op/paraphrase control:** admit an update that should not change current intent. Unnecessary state, Compiled Intent, or behavior changes indicate instability rather than useful responsiveness.

Every intervention requires a manipulation check: the requested state version was restored or replayed; the resulting Compiled Intent version/digest was captured; and the executor received the intended typed artifact. A changed self-description without the predicted probe, action, or environment consequence is not evidence that state management affected execution. Explicit implementations may add field-level diagnostics, but those remain mechanism-specific and cannot enter shared outcome scoring.

A candidate without opaque state control may use deterministic replay from the same admitted event prefix. A candidate supporting neither can still enter C1 if it otherwise qualifies, but it cannot contribute M0b-SC evidence or satisfy the state-causal component of C2. State interventions support claims about persistence, update and downstream consumption; they do not prove that a particular IR representation is necessary, sufficient or correctly human-interpretable.

### Measurement dictionary

These are conceptual observables, not final formulas. Programmatic environment/verifier evidence is preferred; ledger-scored probes cover semantics not directly observable in the environment. The complete trajectory is the primary unit, and turns are repeated observations within it.

| Measure | Concept and observation source | Applicable rows/phases | Common misread | Freeze point |
| --- | --- | --- | --- | --- |
| Reliability AUC | Trajectory-wide accumulation of turnwise current-intent reliability from requirement/outcome checks; preserves intermediate failures | M0a-C0, M0b-C1, M1-L, M2-C3 | Not literal geometric area or final-pass score until formula is frozen | Observation/turn rules v1; weighting/aggregation v2 |
| First drift | First prefix where behavior or observable state departs from all acceptable current-intent paths; sourced from probes/actions/verifier | M0a-C0, M0b-C1, M1-L | A transient model statement is not drift unless it affects the declared behavioral layer | Event/censoring rule v1; survival summary v2 |
| Active-requirement satisfaction | Degree to which requirements still active at a prefix are satisfied in action or environment | All end-to-end rows | Denominator is not every historical requirement | Ledger mapping v1; combination formula v2 |
| Stale retention | Superseded, retracted or expired requirement still influencing artifact, action or environment | M0a-C0, M0b-C1, M1-L/M1-A | Mere historical mention is not failure without current behavioral influence | Failure opportunities v1; severity/aggregation v2 |
| Change recognition | Probe/action evidence that the system detects a semantic update | 0a/0b/M1 | Recognition does not mean the update was correctly implemented | Probe rubric v1; summary v2 |
| Change resolution | Correct downstream consequence of a recognized update | 0a/0b/M1 | Must be reported separately from recognition | Outcome mapping v1; gap formula v2 |
| Recovery | Return to an acceptable path after diagnosed drift or corrective signal; delay and rate come from subsequent prefixes | M0b/M1/M3 | Final success alone hides slow, repetitive or unsafe recovery | Recovery event/censoring v1; aggregation v2 |
| False merge | Distinct task/intent occurrences improperly share constraints, state or Authority | Occurrence twins in 0b/M1/M2 | Semantic similarity is not identity | Occurrence keys/opportunities v1; rate/severity v2 |
| False split | One continuing occurrence is incorrectly treated as unrelated, losing valid continuity | Resume/interleaving cases in 0b/M1 | Legitimate subtask decomposition is not false split | Continuity ground truth v1; rate v2 |
| Premature commitment | Irreversible, risky or high-rework action taken while an outcome-critical choice is unresolved/not yet formed | 0b/M1-I/M1-A/M3 | A reversible exploratory action is not automatically premature | Opportunity/risk classes v1; severity/threshold v2 |
| Correction selectivity | Accept justified correction while resisting misleading pressure and preserve unrelated correct commitments | 0b/M1 | Raw correction uptake rewards gullibility | Paired correction rubric v1; joint score v2 |
| Collateral damage | Previously correct, still-active behavior/state harmed while resolving a new change | End-to-end 0b/M1/M2 | New requirement failure and collateral regression are separate | Requirement-to-effect map v1; severity/aggregation v2 |
| Final task success | Native executable or independently reviewed terminal outcome | 0b/M1/M2/M3 | Cannot establish intent understanding or hide intermediate drift | Verifier mapping v1; endpoint role v2 |
| Authority failure | Unsafe carryover, use after expiry/revocation, cross-task transfer, or false blocking at an Authority opportunity | M1-A and safety strata elsewhere | Authority is not model confidence or generic capability | Opportunity/severity taxonomy v1; tail bounds/decision rule v2 |
| Cost | Separately attributed Compiler/reference, Adapter, executor and tool calls/tokens, latency, retries, truncation and failure-driven rework | M0b-C4 and all practical reports | Short prompt or low preprocessing cost alone is not system efficiency | Telemetry completeness v1; currency/aggregation/Pareto margin v2 |
| Clarification / interaction regret | Question timing, relevance, repeated/unnecessary questions, answer utilization, stopping, user burden and performance relative to a frozen feasible policy | M1-I/M3 only | Replay cannot measure asking policy; fewer questions is not always better | Driver/human event schema v1; regret reference/formula v2 |

Independent intent and end-to-end outcomes remain joint evidence: probe gain without execution gain localizes consumption/execution limits; execution gain without probe gain is treated as guardrail, extra compute, chance or verifier-blind-spot evidence until resolved. Rare catastrophic outcomes receive separate bounds and cannot be averaged away by Reliability AUC.

### Phase 1–3 extension contracts

**Experiment 1 — persistent development.** The Compiler ownership boundary, common seam, frozen executor within a matched set, oracle/sham logic, grouped splits and dual budget regimes remain unchanged. M1-L adds audited 5–15 turn persistent coding trajectories and a declared `Compiler/reference × fresh/history-enabled executor` factorial; opaque native history is prohibited. M1-I adds a controlled external interaction driver and can newly claim clarification, repair and intent formation. M1-A adds grant, expiry, revocation, task switch and cross-task non-transfer opportunities without selecting an Authority representation. Before confirmation, phase-specific v1 maps requirement tests, history exposure, driver behavior and Authority opportunities; the pilot freezes v2 endpoints, tails and sampling. Gains limited to fresh context, one task family or replay are labeled accordingly; unsafe Authority tails can block positive reliability wording despite average gains.

**Experiment 2 — environment transfer.** A candidate's Compiler mechanism, prompts/weights, update policy, evidence-selection policy and compilation protocol are frozen before held-out environments are opened. Only the Adapter may translate the already-defined semantic contract to the environment; its changes and information surface are audited. At least one non-code environment and more than one executor model family are required for M2-C3. Phase-specific v1 defines environment outcomes, comparable event strata and a customization budget; v2 freezes heterogeneity and transfer rules. Failure of the zero-shot arm bounds C3. An environment-adapted Compiler may be studied later as a separate claim and cannot repair the frozen result retrospectively.

**Experiment 3 — human calibration.** Representative authored/simulated conditions and treatment/reference pairs are frozen before recruitment. The system boundary and treatment identities remain unchanged; only the user source changes. Phase-specific v1 defines sampling, consent/privacy/review, task assignment, interaction capture and simulator-to-human linkage; a human pilot forms v2 effect/ranking, burden, subgroup and stopping analyses. Ranking reversal, systematic calibration error or subgroup harm limits claims based on the simulator; a small human study does not establish broad deployment validity.

### Threats and failure decisions

| Threat / observation | Decision consequence |
| --- | --- |
| Ceiling or floor | If reference already saturates or even oracle cannot act successfully, the testbed/executor cannot identify intent-management value; change development substrate and use new held-out gates |
| Oracle not consumed | Verified delivery without selective behavior is an interface/Adapter/executor-consumption failure; pause candidate comparison |
| Oracle consumed but no headroom | Intent information is not the active bottleneck for that setting; do not infer Compiler futility in general or continue C1 there |
| Sham reproduces gain | Attribute result to compute, output, timing or attention; invalidate the semantic-management contrast |
| Probe improves, E2E does not | Localize projection consumption, action execution or environment/verifier limitation; no end-to-end usefulness claim |
| E2E improves, probe does not | Treat as guardrail, extra compute, lucky success or verifier-blind-spot evidence until an independent measure resolves it |
| Verifier blind spot / shared LLM-judge bias | Seeded faults, executable checks, blinded human calibration and judge-disagreement reporting take precedence; shared agreement alone cannot support a claim |
| Benchmark contamination or future leakage | Exclude affected source/twin groups, document provenance, repair only on development data and replace held-out groups; published leaderboard is not a fallback control |
| Task-family heterogeneity | Report strata and interactions; do not hide a mechanism that helps one event family and harms another behind an aggregate mean |
| Candidate capacity confound | Match capability tier and budget, disclose training/data/calls, use paired sham or factorial ablation; otherwise report a whole-system result, not architectural evidence |
| History or cache leakage | Invalidate affected matched sets; fresh/history conditions require explicit identical injection, isolated state and cache boundaries |
| Rare catastrophic outcome | Analyze severity and confidence bounds separately; a mean gain cannot compensate for unacceptable irreversible harm or Authority violation |
| Strong reference equals or beats Compiler | Retain as a substantive negative/specialization result; do not weaken the reference post hoc or redefine it as a Compiler without contract qualification |
| Oracle improves but candidates fail | The testbed has an information upper bound, while the tested maintenance/projection mechanisms fail; revise candidates only on development data |

### Open-parameters register

Open parameters are deliberately frozen at the first stage with relevant evidence. Absence of a number before that point is not an incomplete protocol.

| Freeze point | Parameters to decide | Evidence required / prohibited shortcut |
| --- | --- | --- |
| Before environment selection | Eligible task releases and license/provenance standard; required capabilities and observability; evaluator isolation; broad executor/candidate capability-matching rule | Decide against the handoff contract, not current-machine convenience; do not select hardware, product, container or deployment here |
| Before each 0a-s calibration batch | Versioned provisional environment/runtime and source release; exact arm/model/procedure versions; supported seed or replicate controls; per-turn action/time/token caps; artifact-size and delivery/rendering settings; coverage manifest | Required for reproducible calibration, but not treated as a final design choice; any change is logged and the affected calibration checks are repeated |
| After 0a-s, in Matrix v1 | C0 diagnostic comparator and selection rule; retained C1 reference set; exact 0a-g executor/reference versions and stochastic controls; exact agent/evaluator views; event and opportunity definitions; observation timing; missingness; grouping/aggregation level; oracle consumption check; each sham pairing/audit; artifact limits and delivery rendering; probe/verifier coverage; 0a-g repetition and internal progression rule | Derived only from development/calibration coverage and actual schemas; freeze before untouched 0a-g |
| After 0b mechanism-selection pilot, in Matrix v2 | Confirmatory candidate set and operational-distinctness strata; strongest-matched-reference selection rule or simultaneous-reference procedure; primary/secondary endpoint formulas; minimum practical effects; decision thresholds; sample size/power; multiplicity; stopping; cost aggregation/Pareto rule; state-causal timing; model/seed/action/token/rendering limits needed to reproduce the chosen comparison | Derived from grouped pilot variance, failures and enforceable backend controls; pilot-selected data excluded from confirmation |
| Before Experiment 1 | Audited clean coding subset, requirement mapping, event mix, trajectory lengths, fresh/history policy, interaction-driver protocol, Authority opportunity/severity taxonomy and phase-specific held-out groups | Phase 1 development/pilot only; no unprovenanced or contaminated task release |
| Before Experiment 2 | Held-out environments/model families, comparable event strata, Adapter-only customization budget, frozen Compiler identifiers and zero-shot transfer analysis | Fixed before target outcomes are seen; adapted variants remain separate |
| Before Experiment 3 | Human population/task sampling, recruitment/ethics/privacy, simulator linkage, burden/safety endpoints, subgroup and stopping rules | Human-study review and pilot; authored/simulator confirmation does not choose human endpoints post hoc |

Candidate algorithms, private Intent IR representations, Atom/Relation designs and storage methods are **research alternatives to be instantiated and compared during 0b and later mechanism work**, not parameters this environment-neutral v0 should decide in advance. Exact hardware and deployment topology are **execution choices**, not project semantics. Prior experimental evidence remains in `outputs/intent-compiler-experiment-research.md`; feasibility observations do not override this environment-neutral protocol.

## 2026-09-24 后续修复批次（实现与离线验证事实）

本批由用户授权源码、文档及离线验证；没有真实模型、宿主业务任务或 benchmark 运行。固定验收及逐项结果见 [SCOPE](../../development/validation/2026-09-24-repair-batch/SCOPE.md)、[RESULTS](../../development/validation/2026-09-24-repair-batch/RESULTS.md)。关联设计集中于 DESIGN-HISTORY.md §9，不将未实施部分当现状。

- 新写入的管理失败记录与返回使用同一最终 code。核对拒绝、核对不可用、机械失败、提议错误、必要核对额度不足分别归因；旧核对标志不污染后一次候选失败。历史运行记录不回写。
- 修订输入新增 repair_context，传递准确旧稿、摘要及输入依据变更状态；逐次记录候选 JSON 变化路径。它不复用语义通过或执行资格，不增加自动重跑、请求上限或超时。
- R3 保存 django__django-11163 turn 2 原始反例；关于无成立 finding 时的核对完成/通过定义仍有冲突，运行判定与两份核对 schema 未改。反例保全测试通过不等于误拒已修。
- 最小回归修复前 9 项中 6 失败，首轮修复后 9/9 通过；关联测试 58/58；最终 `npm test` 313 项、312 通过、1 跳过、0 失败；`npm run typecheck` 通过。R1/R2 未使用二次修正，无回滚。
- 实际模型成本和有效派发率收益未验证；M2 仍未达成。新限制生效、执行资格及宿主等待只完成关联设计，未在本批实施。

## Out of Scope

- Fixing one Atom granularity, Relation system, graph structure, Intent IR schema, storage method, or compiler algorithm as the project answer before mechanism evidence exists. Designing and comparing such choices during 0b and later research is in scope.
- Proving that one internal representation is universally best.
- Treating the evaluator ledger as the production Intent IR.
- Optimizing a user-facing explanation or visualization of intent.
- Allowing the Exec Loop to mutate Intent IR or Compiled Intent.
- Claiming cross-domain generality from the coding stage alone.
- Running formal Phase 1 results on any unprovenanced or future-requirement-contaminated task set.
- Fixing confirmatory sample size before smoke and pilot variance are observed.
- Full production deployment, workflow self-improvement, reusable Skill extraction, or selection of an Authority representation. Behavioral Authority reliability remains in scope.
- WorkSwarm/openJiuwen integration and non-coding task execution in the first prototype iteration.

## Further Notes

- The staged route is deliberately cumulative: controlled baseline and attribution calibration, Intent IR mechanism discovery and confirmation, persistent development, environment transfer, then human calibration. Failure at an earlier gate changes the usable testbed or bounds a later claim rather than being hidden by a larger benchmark.
- The environment-neutral design and Matrix v0 are complete enough to guide a prototype. The first-candidate implementation and no-tool compatibility evidence are recorded above. The immediate authorized work is the first-request no-tool test; coding remains a later confirmed step. Once the coding slice is stable, the formal route remains: (1) instantiate 0a-s on development/calibration twins; (2) use its schemas and audit evidence to freeze Matrix v1; (3) run 0a-g on untouched gate twins to establish the testbed baseline and attribution chain; (4) only after its progression conditions pass, design, ablate, and pilot operationally distinct 0b Intent IR candidates without preselecting one IR or workflow architecture as the answer; and (5) freeze applicable rows as v2 before confirmatory work. Phase 1–3 Matrix rows mature only when their own design work begins.
- The closest Apple App Intents analogy is the low-noise, predefined capability surface used for controlled validation. Apple is not an experimental arm and its typed schema is not adopted by this spec.
- The research objective is to produce both architectural evidence for Intent IR and design knowledge about its mechanisms. A finding that multiple qualifying Compiler treatments win on different change distributions can support the Intent Compiler direction even when no universal internal winner exists. Strong rewrite, folding, memory, ordinary-planning, and guardrail results remain necessary comparisons; they help determine which Intent IR mechanisms add value rather than turning the project into a neutral leaderboard.

## 2026-09-28 Harbor 逐轮执行门槛修复（离线验证事实）

EvoCodeBench dpipe 运行暴露出宿主适配层只检查整次运行累计 `dispatches` 的错误：Compiler 在某轮拒绝输入、没有启动执行时，历史派发仍让该轮进入官方 verifier。dpipe 与 paired-d3w9 的 Harbor 适配器现于每轮调用前记下已有 `execution_id`，调用后要求快照中出现新的执行记录；复用已有 `dispatch_id` 但确实启动新执行仍可通过。无本轮执行则抛错，阻止该轮进入 verifier。dpipe 准备脚本改从仓库内复制适配器和安装模板，避免沿用旧运行目录中的宿主代码。标准库 `unittest` 在两个适配器上覆盖历史记录误放行、仅派发未启动、复用派发并启动执行。该修复未修改历史运行记录，也未发起新模型或 benchmark 运行。

## 2026-09-24 用户更新与派发前职责批次（实现与离线验证事实）

用户已认可具体方案并授权此批源码与离线验证。DESIGN-HISTORY.md §10 为本批当前说明，完整证据见 development/validation/2026-09-24-update-batch/{SCOPE,RESULTS}.md。

本批使用已有增量/复用表达，合同与范例默认不生成自查报告，明确业务定位/实现调查由执行层在授权范围内完成。核心在私有状态准备一次结果，用户输入（包括 reuse）触发配置的独立核对，核对后提交同一对象；交付携带 constraints / return_when。未处理用户事件独立持久化，run 范围暂停后续授权；当前范围和本次资格共同控制开始/继续。读取依据变化返回 stale_basis 并保存草稿；已关闭执行的匹配迟到回传只存历史证据。没有实现部分接纳或新增核对层。

OpenCode 零派发报告 COMPILER_HOST_WAIT_UNSUPPORTED，并携带管理结果；这表示宿主正常等待能力尚缺，hook 仍中止，不能称正常等待已实现。finding 判定、资源级强制权限、通用语义修复预算、真实业务运行不在本批。

验证：新增 12 个固定模型/可控并发行为测试；三条旧断言按已确认的触发范围与失败归因更新，未改 finding 反例或通过定义。一次 npm test 共 325 项，324 通过、1 环境跳过、0 失败，重建 dist；一次 npm run typecheck 通过。没有真实模型/provider/benchmark 调用，未证明 token、时长、有效业务派发或 M2 收益。

## 2026-09-28 逐条要求闭合修复（源码与离线事实）

用户根据 dpipe 编译器快照确认功能边界并授权修复。新编译任务默认要求 `IR.content` 逐条记录当前规范性要求及可解析的用户原文片段；coverage 为每条当前内容指定 Atom 或暂停/未决去向。管理代码根据 coverage 生成当前内容引用，并把完整正文投影为 `ExecutionTask.requirements`。修改内容不能复用旧编译，同 id/revision 的 Atom 不能在要求绑定后悄悄换内容。提案和独立核对得到相关历史用户输入作为来源证据；历史输入不按新委托处理。旧合同夹具显式选 legacy 兼容路径，新 run 默认严格。

机械检查只保证已登记内容的来源、分配和投影闭合；原文中是否还有未提取的规范性要求、要求适用范围以及材料与委托的语义区分仍由独立核对判断。此批没有新模型请求、宿主执行或 benchmark。离线 `npm test` 共 353 项：352 通过、0 失败、1 项因当前环境不支持符号链接而跳过；`npm run typecheck` 与合同条款离线检查通过。这些不是业务任务或模型质量结果。

## 2026-09-28 dpipe ingest 语义解析 smoke（后续事实）

用户将本次修复限定为一次管理提议产出具体 IR 要求，不增加独立模型核对调用。content 候选来源改为精确原文摘录，管理代码在不可变用户事件中唯一定位，计算 UTF-16 span 与 digest；未找到或重复摘录不能获得有效要求来源。原有逐条要求闭合、Atom 绑定和派发投影继续使用。

隔离 run `dpipe-ingest-boundary-smoke-20260928-003` 用 `openai/gpt-5.6-sol-fast@medium` 对 dpipe 首轮 2,682 字符 ingest 切片进行一次管理调用，未配置独立核对器。结果为候选接受、1 个任务、8 条 `IR.content`、1 个 Atom、8 条派发要求；所有要求有非零原文区间，文本与原文逐项人工对照后涵盖该切片主要行为，未出现此前额外的“小写”要求。记录耗时 65.2 秒、输入 15,342 tokens、输出 4,673 tokens、reasoning 438 tokens；runtime 的 `cost: 0` 不是账单金额。最终 `npm test` 357 项中 356 通过、0 失败、1 跳过；`npm run typecheck` 通过。没有执行层工作或官方 verifier 分数；不据此推断完整 dpipe 通过率。原始记录保存在 `D:\huawei\intent_compiler\smoke\dpipe-ingest-20260928-003`。

## 2026-09-28 完整任务语义链与 Relation 修复（后续实现）

用户要求重审完整任务，而非继续将 ingest 切片成功泛化。实现与当前边界见 DESIGN-HISTORY.md §12.2。新增管理解析的新 Atom Relation 本地引用、精确端点/环校验、真实回传加管理验收的依赖门控、reuse 后继释放、start/operation 再检、后继结果元数据与 completion evidence 投影。模型合同依据最小有效交付和实际消费者选择拆合，不规定 Atom 数量；未新增强制独立核对模型调用。

固定模型测试已复现修改前的新关系无法合法生成及虚假关系未被执行门控，并覆盖更新和验收后释放路径。多任务且宿主未标任务的更新保留管理所需历史原文，执行交付保持 Atom 范围。完整首轮原文 19,344 字符的首次真实 smoke 因 OpenCode 服务连接中断未得到候选，此事实既非语义成功也非语义拒绝。后续完整输入结果、全量测试和成本须从本批结果报告读取；不继承旧切片或旧 benchmark 分数。

## 2026-09-28 完整首轮语义审查后的来源与规范边界修复

完整首轮 smoke `dpipe-full-semantic-smoke-20260928-002` 的 4 Atom/3 Relation 不构成语义通过：实际发现 r-ingest 增加无依据的小写限定和遗漏精确拒绝字符串，r-transform 以指代原文的摘要替代完整规则，部分 source 仅指标题/命令，失配的 Relation 引文未被拒绝。真实记录仍保留，未改写为成功样本。

后续修复见 CURRENT-DESIGN §12.3：严格新 run 拒绝整个候选中的不可解析来源；Atom.constraints 只准原样绑定已分配 IR，ExecutionTask 带代码截取的来源片段及字段职责说明；合同与示例加强完整行为和支持引文，未增加强制独立核对。机械门槛不证明语义完备性，提示词改善需要新完整输入和连续更新产物验证。新增回归覆盖这些机械边界，最终全量统计与后续真实结果应以本批报告为准。

### 2026-09-28 — 规范原文保存与显式去向（待本批完整验收）

完整 dpipe smoke 003 的 14 条 content / 6 Atom / 5 Relation 仍遗漏细则，说明增加拆分和要求详细转述不足。本批在一个 TaskIntent 内让模型选择语义规则与必要上下文；source segment 仅作定位，代码将已选不可变用户原文保存为 content.text，摘要另存 interpretation 且不投影为执行规范。source_coverage 完整记录当前文本的角色与 IR 去向，校验来源内容保存、逐条对应及旧规范撤回的当前输入依据。局部修订保留旧规则未变部分；材料不会因出现在输入而自动成为权限。

不新增 mandatory checker，不改变模型设置。89 项目标测试通过，仅证明结构与保存机制；角色误判、上下文缺失、错误作用域/撤回及说明性文字的语义误导仍需真实产物审查。本轮最后由主线程只跑一次完整测试和一次完整首轮 smoke，随后报告并停止，不循环修复。执行层、官方 verifier 和 15 轮连续输入不在已证实范围。

### 2026-09-28 — -004 后用户重新授权的整链路修复

-004 使用全局原版 OpenCode，不能沿用独立补丁 host 的 strict=true 证据。严格生成现在要求非 null source_coverage；transport 按本次发送 Schema 验证 info.structured，原样保留错误产物和 usage，作为 schema 失败而非网络失败处理。IR 显式选入原文即构成规范采用映射，避免模型重复登记；剩余文字和旧规则撤回仍需明确语义去向。没有清洗五个根级数组或伪造漏掉的分类。

真实 -004 原字节已作离线夹具。同一 transport/parser/compiler 链路验证原始六项错误、形状修正后八处来源缺口，以及手工明确补齐上下文的期望候选贯通完整正文/10 content/6 Atom/5 Relation/1 当前派发。此期望只验证机制，不能称为模型成功产物。

静态 typecheck 通过；完整 npm test 380 项，379 pass、0 fail、1 skip；合同 170 条与 enforcement/settlement 同步，缺 fixture 77/79，未放宽。主线程负责隔离补丁 host 的身份和 SDK boundary strict=true 证据，并只运行一次真实首轮。尚未有本批业务执行或官方 verifier 的成功证据。

### 2026-09-28 — Atom 直接交付边界

用户否定了把 IR 全文重组为大 `ExecutionTask` 再发给执行层的实现选择。当前源码移除该类型及投影：编译器返回当前获准 Atom，OpenCode 将 Atom 本体交付给执行模型并读回核对。IR 仍是来源和当前规范记录；Atom 必须由管理模型写成可独立推进、可回传和可验收的具体执行任务，而不是一行索引。旧 `ExecutionTask` 快照仅代表旧实现，不是本候选的交付格式。此修改的类型检查与固定测试结果另按实际运行记录；它们不能证明真实管理模型已写出足够具体的 Atom，更不能代替执行层或官方 verifier。

本批类型检查通过；全量测试 380 项中 379 pass、0 fail、1 skip。隔离完整首轮真实管理 smoke `dpipe-atom-direct-smoke-20260928-001` 成功形成 5 Atom/4 Relation、交付 1 Atom，无 `execution_task` 字段。人工审读发现该 Atom 仍省略精确拒绝字符串并擅加 checksum 小写限定，其他 Atom 对聚合边界和 ntile 公式仍有“按规定”式概括；所以交付格式修复已验证，语义质量尚未通过。没有执行层或官方 verifier 结果，也未进行第二次模型请求。

### 2026-09-28 — 管理模型语义生成职责与整链路对齐

在上批基础上完成 CURRENT-DESIGN §13.6：统一管理模型对整体 IR、整体 CI、Atom 可执行行为和验收、Relation 及执行回传的要求；修复生成合同与 schema、更新逻辑的冲突，OpenCode 与 structured-provider 同步。提议输入携带已有状态、回传和验收，核对以完整 prepared IR/CI/台账及派发范围为对象；新 IR 条目可作为核对引用。保留原文存证、版本、原子提交、直接 Atom 交付和可选核对，不引入业务专用规则。

整套改完后 typecheck/build 通过；完整 381 项离线套件初次 378 pass、2 项文档索引 fail、1 项原有 skip。修复旧条款行号引用后，仅复验受影响的 48 项，全部通过；当前没有未解决失败。新整链路回归覆盖等待中 Atom 的拒绝与修订、私有提交、反馈输入及验收后放行。详细结果见 `development/validation/2026-09-28-semantic-plan/RESULTS.md`。本批没有真实模型调用或 smoke，不能据此宣称新管理模型的整份语义产物已通过。

### 2026-09-28 — 按完整语义与字段职责修订生成、更新、修复和验收

前次真实 dpipe 修订通过机械编译，但全量产物审查仍发现配置接口和部分行为边界缺失、阻塞回传被写成成功替代条件；小写十六进制本身可为合法实现选择，不能单凭它判定业务失败。完整原始证据保留于包根 smoke/dpipe-full-20260928-001/runs/dpipe-semantic-fields-smoke-20260928-001/repair-01。

本轮按 CURRENT-DESIGN §13.9 修订管理模型的实际职责说明与既有字段合同：两个生成 transport 共用同一说明，IR/CI/Atom、用户更新、反馈修订、可选核对及执行验收同时对齐。通用示例说明接口与示例值的区别，完成与阻塞返回分别填写。修订指纹补入历史来源、分段和来源身份；既有状态输入、原文保存、结构/版本门槛和直接 Atom 交付继续保留。没有新增 Schema 字段、语义算法、强制核对或业务执行。验证结果随后据实际运行补记。

后续实际结果：canonical/strict Schema 补充既有字段职责说明，strict 转换保留 union 描述；结构和允许值未扩张。受影响的 27 项离线回归通过。002、003 两次完整 dpipe 管理采集均一次提议即机械接纳，零执行，但全量实物审查均未通过：transform 接口/边界及 pipeline type 仍遗漏。003 的完成/阻塞及终验范围有改善，不足以称语义修复完成。实际 wire request、原始响应、IR、完整 CI 和分析分别保存在包根对应 run 目录；不再用测试通过代替真实语义结论。

## 2026-09-28：按用户指令撤回扩大修复

checkpoint b8ce617之后的实现修改已回滚；统一流程重写、来源反馈、宿主隔离及其分析不再有效，不作为设计依据。旧文本保存在包根rollback-archive/20260928-scope-expansion。此前已有工作保留；最新分析范围见 CURRENT-DESIGN §13.11，不再限定为只分析原始 Atom。没有新管理模型调用或执行层调用。

### 2026-09-28 — 按最新完整分析同步文档

修正“只看原始运行、只修 Atom”的过窄结论。原始运行证明已登记要求在 Atom 中被概括；后续原始失败稿另外证明有效要求没有被完整选入 IR 草案，同稿 IR 与 Atom 的规则也不一致。后续稿均未提交，不能称其已形成有效 IR。修订中模型删掉原有内容、后续又沿用最新退化稿，放大了后来的问题；原始运行没有修订，因此这不是最初错误的原因。

最有支持的解释是管理模型保留功能大意，却未在各节点始终保留具体规定；这属于产物支持的推断，尚未证明唯一的提示词或宿主原因。引用、coverage 和机械接纳不证明语义完整。检查点之前已补好的错误文字、部分计算规则及成功/阻塞区分继续保留，未解决的接口和边界不能被这些改善掩盖。统一职责、证据范围和待确定的修复范围集中在 CURRENT-DESIGN §13.11，详细对照见 [语义生成重新分析](../../development/validation/2026-09-28-semantic-plan/ATOM-BASELINE-REANALYSIS.md)。

本次只同步文档及入口，没有源码修改、模型调用、执行层调用或新增测试结果；此前撤回的实现方案没有恢复，语义修复仍未完成。

### 2026-09-28 — 按最新分析制定待实施修复方案

用户要求用合适的 skill 出方案，不修改实现。本次使用 diagnosing-bugs 与 codebase-design，核对当前管理说明、字段合同、示例、修订输入及真实采集入口后，将方案集中写入 CURRENT-DESIGN §13.12。现有代码已经要求完整、自包含及修订保留；本轮拟替换生成说明和配套示例，使实际原文选取与各 Atom 的具体行为保持一致，覆盖 IR、CI、Atom 和修订，不新增中间协议或重构来源/宿主。

验证计划在整体修改完成后使用完整 dpipe 管理采集，首稿与修订分别评价；复用现有可选核对反馈和 Resume，设置明确总调用上限，零执行层。构建和有限接入检查不作为语义通过证据。当前只完成方案及文档同步，未修改源码、未执行测试或模型调用。

方案继续具体化：§13.12 现包含“已确认失效—对应改动—起作用的位置”的对照、四段可直接替换的生成/修订说明，以及一份确定的 bundle/inspect 配套示例。示例明确公共要求、共享文件格式与各命令行为的分别归属，避免用完整性口号代替操作方法，也避免把生产者的全部职责错误分配给消费者。本次仍只编辑方案文档。

整体生效复核补齐了实际接入缺口：现有 smoke 的请求预检只识别 propose，直接接入 check 会读取不存在的 example_candidate；方案已规定两种请求分别预检、逐次留证及区分采集/接纳/语义审查。现有跨批 Resume 依赖已保存的 candidate，不能把仅有原始错误响应或 Check 不可用视为可带稿修订；方案已明确恢复条件和总调用上限。语义部分补入有效更新优先于旧原文、共享要求的适用范围、引用定位错误与无依据规则的区别，以及必须先原文到 IR 再到完整 CI 的审查。所有调整仍为方案文档，未修改实现或执行测试、模型调用。

### 2026-09-28 — /tdd 后本轮实施与真实结果

依 CURRENT-DESIGN §13.12 完成管理说明、IR/Atom 合同、修订说明和成对示例修改，接通验证驱动的两种请求预检和一次有界 Resume；未改 Schema 结构或来源/状态/执行机制。构建及26项相关接入检查通过。

真实完整 dpipe 管理运行 dpipe-semantic-alignment-20260928-001 未通过：首稿 IR 业务原文选全，但 Atom 仍缺 recipe.op、aggregate 嵌套结构、window.function 等；核对器只拒绝了 scope 的文字与 conditional 状态冲突。修订改为 proceed，却把34条来源替换为不匹配原文的重复引文，未进入第二次核对。实际3次管理请求，零执行，正式 IR/CI 为空，代码未提交/推送。

新增发现是规范化 span 的修订输入与仅允许 quote/segment_id 的 content 输出字段未衔接，本轮“照抄有效引用”说明不适用于直接回填这些字段；它不解释首次 Atom 的遗漏。完整事实与实物链接见 [ALIGNMENT-RESULTS.md](../../development/validation/2026-09-28-semantic-plan/ALIGNMENT-RESULTS.md)，最新状态见 CURRENT-DESIGN §13.13。语义修复仍未完成。


### 2026-09-28 — 继续修复并通过完整 dpipe 管理产物审查

修订交接先复现 strict 返回格式缺 quote，再由同范围选择的格式转换修复；不修改原稿或来源含义。构建、44项相关检查通过。真实 transfer-001 保住全部业务规范，但暴露路径要求被扩大成全任务启动限制；据此同步生成/核对的路径适用范围，再构建并通过12项受影响检查。

最终运行 transfer-002 完成：完整19344字符原始输入，生成1次、独立核对1次，正式提交1份 IR（1条完整规范 content）、1份 CI（1个 Atom、0条 Relation），选出1个 Atom 并只保存派发产物，执行层调用0。原始输入与实际 IR.content.text 完全相等，且完整原文是 Atom.task 的连续子串；不依赖引号解码或关键词匹配，业务规范无删减。

逐项审查 task 以外字段：goal 表达完整任务；scope 为 proceed，只许可现有授权工作区的工作；authority 未授予未知位置权限；judgment 明确 /app 创建/映射权限未知；completion 仍要求从 /app/ 构建成功的真实证据；return_when 的失败/阻塞不算完成；outputs、coverage 和 goal_refs 均对应整项工作。独立子代理复核未发现上一轮路径范围扩大或新权限扩大。核对 verdict 为 consistent，与原文实物审查一致。

本次完整 dpipe 首稿通过语义审查，已修好的接口、公式、精确错误文字及成功标准均保留。没有触发真实模型修订；来源格式修订的等价性及保留行为由前述真实编译路径回归检查验证，不声称本次发生过真实模型修订。没有执行业务任务，也没有取得业务构建成功结果。两份本轮真实运行共4次管理调用、0次执行；没有追加抽样。

实物：D:/huawei/intent_compiler/smoke/dpipe-full-20260928-001/runs/dpipe-semantic-transfer-20260928-002/artifacts.md，原始快照 round-01-snapshot.json，完整差异 source-to-atom.diff，审查记录 semantic-review.json。代码尚未提交/推送。


### 2026-09-28 — 用户指定 GPT-5.6 Sol medium 的真实管理运行

未修改生产代码，以 openai/gpt-5.6-sol@medium 跑完整19344字符 dpipe 首轮，run_id=dpipe-sol-medium-20260928-001，保留全部请求/响应、宿主日志、候选及状态、源码与构建摘要。首稿提出5条内容，但全部来源指向输入末尾9字符；Atom已完整保留业务规范，IR来源选择仍错，被原文去向检查拒绝，未提交。沿同一run反馈修订后，模型改为一条完整r-spec，IR保存全部原文；Atom仅去掉外层引号和展示转义，业务规则完整保留。独立核对consistent，提交1份IR/1条content、1份CI/1个Atom，0条Relation，执行0次。

本次证明这一次反馈恢复成功，不能把首稿说成成功，也没有得到有效的多内容拆分结果。实际3次管理调用，输入117351、输出19876、推理1724 tokens。最终/app构建要求及未知路径权限边界保留。完整证据见 [运行记录](D:/huawei/intent_compiler/smoke/dpipe-full-20260928-001/runs/dpipe-sol-medium-20260928-001/README.md)。本次没有继续改语义提示或生产代码来重跑。

后续只读调用链复核确认：模型拿到旧 IR（本次为空），同次提出 IR 更新与完整 CI/Atom；程序之后才形成实际 IR 正文，绑定引用并封装已生成的 Atom。不能以程序先处理 IR 再构建 CI 来证明语义生成依据成立。本次首稿 IR 选源与 Atom 内容脱节，暴露了仅靠提示词约束这项依赖的不足；不据此推断单次响应必错，也不把整体提交改成分次保存。最新分析见 [CURRENT-DESIGN §13.16](../../development/DESIGN-HISTORY.md#1316-生成依赖复核先处理-ir-不等于依据-ir-生成-ci2026-09-28)。没有新增模型调用、执行或生产代码修改。


### 2026-09-29 — 父子生成依赖修复及真实dpipe产物验证

run_id=dpipe-parent-first-20260928-001，沿用完整19344字符首轮原文和用户指定 openai/gpt-5.6-sol@medium。按真实阶段执行 IR、CI、check 各一次，3次调用、0次执行、无修订、无追加抽样。一个IR包含13条content，连续拼接逐字等于原文；随后CI请求实际收到这份IR，代码计算的parent_basis与模型返回相同。最终1份CI、1个Atom、0条Relation；13条要求均有对应的goal_refs和coverage，最终要求与传给CI的父要求一致。

Atom.task为20245字符，完整19344字符原文是连续子串，无需引号解码或换行归一化；具体错误文本、JSON嵌套接口、公式、排序/空值/NaN规则和确定性例外全部保留。新增前后文字仅说明实现与验证交付。逐项审查authority、inputs/outputs、completion、return_when、judgments：未新增无依据的业务限制，未把示例路径变成必需材料，未授予创建/app的无条件权限；最终仍要求实际从/app/执行构建并提供成功证据，阻塞报告不算完成。主线程与独立子代理实物复核均未发现本样本的确定语义缺陷，核对模型consistent与实物结论一致。

本次证明初始完整任务经实际父IR生成单Atom方案成功；没有在真实模型中验证多Atom拆分、后续更新或执行实现，不把工程回归替代这些事实。实际input119736、output12975、reasoning1227 tokens。全部请求/响应、宿主证据、阶段状态、源码/构建摘要和关键实物保存在[本次记录](D:/huawei/intent_compiler/smoke/dpipe-full-20260928-001/runs/dpipe-parent-first-20260928-001/README.md)。


## 2026-09-29 完整dpipe尝试与管理长流修复

用户授权完整15轮官方任务执行。-001在首轮CI固定basis.refs不一致处停止（5管理调用，0执行，verifier null），随后补充字段复制说明与精确修订反馈；该批回归396通过、1跳过。-002首个IR参数流超过25分钟未完成，用户要求检查后主动取消；0执行、verifier null，不能把Harbor汇总Mean 0当官方评分。两次记录位于D:/huawei/EvoCodeBench/harbor_runs/intent-sol-dpipe-parent-20260929-001/RESULTS.md和-002/INVESTIGATION.md。

后续已修改OpenCode管理prompt总期限、真实session取消确认、有限重试与新宿主流观测接入，详见CURRENT-DESIGN §13.22。用户要求修完停止、不测试；最终修复未构建/测试/再次运行。正式verifier成绩仍未取得。


### 再次真实dpipe：管理返回正常，执行工具身份不匹配（2026-09-29）

用户要求“再测试一次”后，run intent-sol-dpipe-parent-20260929-007首轮IR/CI/check分别84696/107489/4461ms正常返回，1份IR含14条内容，1份CI含1个Atom/0条Relation；首次方案接纳，派发并启动执行。没有复现上次首个IR长流，也未触发总期限，不能称超时改动解决了长流根因。

官方首轮reward=0.0，219项全部失败。确定阻断：prepare.py和runtime默认capabilities.operations只有read/write/edit/bash/glob/grep，Atom照此授权；宿主执行实际使用apply_patch，适配器以工具名作为operation_id，精确权限检查拒绝apply_patch。执行最终报告阻塞，没有实现文件。先前还拒绝了todowrite。此为实际工具、能力声明和权限身份的接入缺口，不能解释成模型漏选一个已声明能力。

Harbor自动开始第二轮后，为避免同一配置继续付费失败，保存记录并取消第二轮IR。实际发出4次管理请求，3次完成、1次中断；首轮0分有效，全程verifier_result=null，无15轮总分。未在运行中改权限或再抽样。详情与实物：[RESULTS](D:/huawei/EvoCodeBench/harbor_runs/intent-sol-dpipe-parent-20260929-007/RESULTS.md)。

启动前补齐了ManagementAttemptRecord/ManagementCallRecord的新超时诊断字段，否则tsc失败；构建和1项超时取消专项检查通过。Windows复制Linux依赖及只读单文件挂载失败后，prepare改为复用原只读宿主、仅复制并挂载完整session源码目录。003–006均未发模型请求。当前宿主观测已在007实际运行；未跑完整离线回归。没有修复本次发现的apply_patch配置缺口。


### 修复执行工具与回传交接，交给下一session测试（2026-09-29）

用户指令：“去修复完成然后handoff。下一个session替你测试”。本轮仅改代码、核对源码、构建及语法/类型检查；没有运行测试、宿主、模型或dpipe。当前交接：[当时交接的 Git 恢复入口](../../development/cleanup-2026-10-04/README.md#恢复与保留条件)。

已修复：新增runtime/opencode-operations.ts统一OpenCode具体工具名称，依据当前固定宿主registry的GPT选择规则，GPT默认声明read/apply_patch/bash/glob/grep/todowrite，不再声明该模型实际隐藏的write/edit；非GPT对应write/edit。INTENT_COMPILER_EXECUTOR_MODEL_ID可与管理模型分开指定；显式配置包含被执行模型隐藏的编辑工具时在模型调用前报错，不自动扩充已有Atom授权。prepare从同一模块生成能力列表，容器安装时比较冻结runtime配置。模型字段说明明确具体工具名与规划工具职责，执行门控保持精确operation_id匹配。

同时核对到实际回传交接缺口：固定宿主plugin/index.ts对event回调使用void，原adapter只等待Observer reconciliation，不等待完整的return和管理advance；onEvent还把对账成功当completed，且不带最终执行说明。现在跟踪完整异步处理并由dispose等待，同session重复terminal事件合并；工具结果等待持久化并传播失败。execution_return携带SDK中的实际assistant文字、结束信息和工具错误；宿主只报告stopped/ready，不凭日志对账声称任务完成，管理层根据原始回传评估。未把文本关键词当作业务成功判据，未修改core验收职责。

驱动现在要求新执行有execution_outcomes，且return事件已被管理层处理，才继续官方verifier。每轮finally保存该轮执行日志和message/part/session三表，避免被下一轮覆盖，不导出认证表。prepare直接复制EvoCodeBench原题并自动保存45文件哈希、源码/driver和Git状态；仍复用固定只读宿主与session目录覆盖挂载，不再复制Linux依赖。

验证事实：npm run build通过；测试源码仅tsc --noEmit编译通过；4份Python文件ast.parse通过；git diff --check通过。新增/更新公开runtime与adapter回归源码已交给下一session，未运行。007首轮0分是改动前的结果，不是本轮结果；上次长流根因仍未由证据确认，007未复现。尚无15轮总分。

## 2026-09-29 交接后验证（续跑进行中）

交接相关回归77项通过。`intent-sol-dpipe-handoff-20260929-001` 首轮官方219/219，reward=1.0；apply_patch接入已真实成功。回传仅入库、未完成管理处理，驱动误用pending为空放行，已保存离线失败复现并停止第二轮。详见CURRENT-DESIGN §13.25与该run RESULTS.md。用户授权修复后从第二轮续测，已增加CLI显式等待、accepted return记录门槛和重开return恢复；74项相关TS、5项Python及1项CLI补丁回归通过。续跑目录 `intent-sol-dpipe-handoff-resume-20260929-002` 恢复首轮真实Docker快照；没有重跑首轮，没有oracle。尚无15轮总分，不能将首轮1.0或离线通过写成全链路已完成。

用户后续明确停止续跑，Harbor及容器已停止。保留首轮1.0；第二轮未派发执行，第三次IR调用中断，无全程分数。新增CLI drain仅离线通过，真实闭环尚未验证。后续单独完整测试需按最新用户安排，不自动重启。见CURRENT-DESIGN §13.25及续跑RESULTS.md。


## 2026-09-29 standalone失败后的接入检查

直接核查启动至退出链路，修复执行目录实例选择、请求错误分支漏等、tee/Harbor退出码被忽略及run-full将异常trial视作正常结束。16项TS、8项Python、生产构建和真实宿主补丁语法检查通过，旧失败产物只读复查通过。无付费调用，无新官方分数。详见[接入核查](../../experiments/evocode/harbor/dpipe/INTEGRATION-AUDIT-20260929.md)。



## 2026-09-29 接入API真实故障纠正

102950-f691792d仍无官方结果，根因是接入补丁错误调用InstanceStore.use；此前模拟测试漏检。现改Service.use，真实插件检查提前到请求前。固定宿主类型核对旧调用TS2349、新调用合法，8项生命周期回归通过。语义核心未改，没有再次启动模型。详见接入核查最新纠正。



最新接入收尾：prepare在创建run和调用模型前运行check-host-patch.mjs，直接用固定宿主及Effect真实类型检查生成的CLI辅助函数，并验证已知错误调用确实会被拒绝。检查已通过。adapter在terminal失败时仍等待其余pendingWork；驱动证据采集异常不覆盖原始执行异常。17项TS和9项Python检查、生产构建通过。仅接入层变更，无核心语义改动，无付费运行。



实际宿主接入检查已完成：复用现有镜像和固定宿主，当前项目只读挂载；网络禁用，认证目录与/app使用空tmpfs，未调用模型。直接抽取生成补丁的executionHooks/drainExecution函数，真实AppRuntime、InstanceStore、Plugin加载Compiler插件，调用drain并dispose。输出REAL_PLUGIN_LOADED 1、REAL_DRAIN_COMPLETE、REAL_RUNTIME_DISPOSED，进程退出0。证据：project/.scratch/host-connectivity-d2567239/result.log及overlay内intent-probe.ts。此检查覆盖真实插件加载和无执行请求的收尾；不代表执行后的管理模型回传或官方15轮已完成。

## 2026-10-01 普通 CI coverage 身份投影及核对职责取证

按用户限定范围，只删减普通 CI `coverage.requirement` 的版本填写义务：使用既有 local_ref 选择固定父任务的条目，由代码从该父 IR 补齐 revision/digest；旧带版本响应拒绝。父 basis、唯一身份、父任务归属及实际分配检查保留；共享 Ref、assessment、legacy、edit 和 verifier 未改。类型编译及 73 项针对性离线测试通过，call-26 重现旧版 stale revision，并验证新版正确对象绑定 rev2、未知/外任务/歧义对象及错误父 basis 仍拒绝。只证明该机械阻塞移除，没有整批接纳或新模型运行。C 只读确认：已有独立核对收到完整原始更新材料与最终装配计划，且 repair_target=ir 可返回 IR 阶段；当前受核对普通 CI 路径有依据减少 parent_issues 的重复语义阻断，但底层无 verify 路径不具备该统一裁决。本轮未删除 C 职责。详细 diff、复现及边界见 [记录](../../development/validation/2026-10-01-local-source-edit/CI-COVERAGE-IDENTITY.md)。

后续用户审阅通过 A，已单独提交 `10898f46e131afc4d009c80fc48db96fdc73d1e3`。按新授权实施 C：只在配置独立核对的普通 CI 路径移除 parent_issues 输出及父 IR 语义退回职责，同步替换阶段指令、合同及相关通用规则。代码复用 checkTransport/verify 配置，经 transport 的第二个内部参数传递，不新增模型可见模式字段；无 verify 和 assessment 保留旧职责。父身份、组关联、引用与实际分配、prepare 和独立核对 repair_target=ir 路由未改变。类型编译及 77 项相关离线测试通过，含 provider 投影、实际 runtime 工厂、正常三次调用、原始材料与最终计划进入核对、无 verify 退回和 assessment。没有新模型运行；只验证职责接线，不证明真实返工总数下降。实际 diff 直接打印，未生成新的 diff 文件。


2026-10-01 C 收口：A 提交 10898f46e131afc4d009c80fc48db96fdc73d1e3，C 提交 e14660b94889e6ce133ba74d24ba1b72934229a9。实际调用 generationContract 提取 C.rules.6/19/20/21/23 的完整前后文本，沿用现有 enforcement/settlement 注释记录只适用于普通且配置独立核对的 CI；其余 18 条规则原样保留，IR/无核对/assessment 不采用这五条替换。最后配置连接确认 ParentGeneration.checkRequired 与 model.verify/checkTransport 对齐，实际核对仍受非空任务、prepare 和预算条件约束。重新编译及已有七个针对性文件 77/77 通过；未改功能或测试、未做全库扫描、未启动模型运行。完整文本和适用范围见 CI-COVERAGE-IDENTITY.md 的收口审计；日志位于 .scratch/ci-parent-review-20261001-closeout/。

2026-10-01 C 最终文字修正：仅 C.rules.19 在固定父 IR 职责说明后逐字恢复 execution_decisions 归属、continue/stop/await_result 含义及未核准工作暂停的原三句，模型选择指引不能由机械检查替代。其他四条规则投影、A、字段和机制未改。类型编译及现有 generation-stages.test 9/9 通过；此前 77/77 作为前次验证记录。未新增测试或模型运行。最终投影与日志见 CI-COVERAGE-IDENTITY.md 末节及 .scratch/ci-parent-review-20261001-guidance/。

2026-10-01 用户单次授权真实续跑 intent-luna-dpipe-cont-r4r5-20261001-165442-219770a1 完成：f94a16b冻结哈希复核一致，从原R3恢复R4/R5。R4宿主UnknownError未进入管理调用，具体根因尚未由保留日志确定；R5携带R4同批，call-20至25全部IR，被活跃来源/superseded冲突、丢弃缺少撤回依据和来源选择器冲突拒绝。无CI/核对/提交/新增派发，最终25调用、pending/unresolved 2/2，IR和计划保持R3。两轮reward均0，case通过540/639与537/680；测继承工件，聚合0.2含历史R3。新增管理usage输入421280、输出36200、推理13352、缓存5632；调用合计618.734秒、批次622.479秒、trial932.473183秒；实际USD及执行器用量未确证。A/C路径未覆盖，不能据调用13降至6判断收益。详细报告：D:\huawei\EvoCodeBench\harbor_runs\intent-luna-dpipe-cont-r4r5-20261001-165442-219770a1/RESULTS.md。无修改或补跑。


### 2026-10-01 — 授权从原R3重跑R4–R5（f94a16b，完成）

run `intent-luna-dpipe-cont-r4r5-20261001-212435-1e7a6b29`，trial task__YBuacd7；原R3归档/store/会话及历史恢复，起点19调用、pending/unresolved 0/0，冻结runtime前后3797文件哈希匹配。仅一次启动，无R6/自动补跑，无实现或运行中候选修改。R4管理9次（更新8＋评估1），新增dispatch-89/execution-90，官方639/639、reward1；R5管理6次，已到CI/独立核对，但IR修复被来源门槛拒绝，无新派发，官方继承R4工件635/680、reward0。最终管理累计34、pending/unresolved1/1。

A的identity-only coverage及C的普通CI无parent_issues均被真实使用；assessment仍保留parent_issues。R4核对ci/ir返修有依据并收敛。R5pipeline edit选错范围与lineage goal_refs遗漏真实；核对把明确SHA→BLAKE更新后的新旧并存判成矛盾为误判，不能据此否定整次IR返回，因为pipeline真实缺陷仍需IR修复。call33采用ingest e1/s9同时声明sidecar原句superseded的机械冲突有依据。R5候选未提交，最终IR/计划与R4准备结果相同。

本次新增management_calls逐次usage：input1,653,926/output45,491/reasoning20,459/cache_read8,448；不重复历史19次。cost记录0而美元账单未知；执行器独立记录input1,203,154/output6,019/cache1,127,936。调用耗时865.185秒、批次墙钟合计878.547秒、trial1397.876893秒。上一轮错误err_69555811的有限日志排查未定位根因，本次未重现R4管理前故障，不能宣称已修复。完整报告：`D:\huawei\EvoCodeBench\harbor_runs\intent-luna-dpipe-cont-r4r5-20261001-212435-1e7a6b29\RESULTS.md`。旧失败运行的成绩、成本及证据保持。

### 2026-10-01 — 有限取证后的归因纠正与离线修改

纠正上一节“R4 核对 ci/ir 返修有依据”及“lineage goal_refs 遗漏真实”的笼统归因：call-22 的四项新要求与 call-31 的 lineage，在实际核对请求的 prepared 当前 Atom 中均有完整 content goal_refs 和附加正文，两次引用遗漏 finding 是独立核对误判。call-22 描述与历史版本吻合，支持版本混淆解释，但不能确定模型具体读错哪个字段。pipeline 有效行为丢失是实际 IR 缺陷；明确算法更新被判矛盾是误判，应逐项评价。严格线上选择器为 segment/span，不支持 quote，不能继续把 quote 当作模型当时可用的选择。详细字段与现有计算结果保存在该 run 的 provenance/limited-forensics-call22-34.json。今后判定 finding 为真实缺陷，须核对它声称检查的实际最终字段。

按用户本轮授权，仅修改严格装配核对的原有比较条款、严格 edit 空 remove 支持及过期 quote 说明。代码仍保证身份、版本、coverage 到 content goal_refs 的绑定与正文装配；核对保留语义分配、忠实行为与完成条件、原始要求在 IR 中的遗漏，按 prepared.atom_states 区分当前与历史状态并合读明确更新。纯追加复用现有来源解析和物化，不生成撤回；双空操作仍拒绝。basis/reason、revise、legacy、来源处置门、finding 类型及重试额度未变。

验证：`node node_modules/typescript/bin/tsc -p tsconfig.test.json --outDir .scratch/check-role-append-20261001/compiled` 通过；对该输出运行既有 generation-stages.test.js、local-source-edit.test.js、requirement-flow.test.js，共 51/51 通过；git diff --check 通过。新增纯追加用例明确标为人工接口验证，没有重放修好真实候选，不代表新版模型成功。未启动真实运行或模型调用；实际 diff 直接打印，未生成 diff 文件。当前限制与设计边界见 CURRENT-DESIGN §13.30。

2026-10-01 审阅收口：代码对 content 引用与原文装配的责任仅限本次经过绑定和装配的 Atom；保留 Atom 不重新装配、历史摘要 Atom 不自动修复，核对仍按保留 Atom 的实际最终正文判断当前适用要求。分配、行为与 completion 的语义判断保留。edit 的 basis/reason 错误文字改为来源变更，不再要求纯追加解释删除。类型编译及受影响的两个现有测试文件 local-source-edit、requirement-flow 42/42 通过；前次 51/51 作为历史验证记录。没有新字段、机制、全面扫描或真实模型运行。源码与测试提交 b31f41bb482e7f414addb6c77340d95dde9d713e；本 spec 沿用既有忽略状态，未纳入提交。

2026-10-01 下一轮仅离线恢复准备：限定核查最近成功 R4 的 run/data/trial，R4 归档含工作区与 OpenCode 数据库，但 external bind 的 compiler-store 未入镜像，未找到配套的完整 R4 store；现存活动 store 为 R5 后累计 34 调用、队列 1/1，不可与 R4 镜像拼接。按用户退路从原真实 R3 准备新 run intent-luna-dpipe-cont-r4r5-20261001-223836-466f6ff5，冻结 b31f41b，原 R3 三份封存哈希匹配，副本 19 调用/87 行/队列 0/0，仅预算改为单批 8、总计 59。新生产构建、3797 文件哈希、配置与映射、现有 launcher --check 和 shim 离线导入通过；旧 run 不变，新结果为空、无锁/启动日志、新模型调用 0。只准备 R4–R5 退路和 R5 多角度分析口径，没有启动授权。详见 RUN-MATERIALS-R4R5.md 的 b31f41b 新方案及新 run provenance/preflight.json、recovery-source-audit.json。

2026-10-01 用户随后授权上述新 run 单次启动，已正常结束：冻结 b31f41bb482e7f414addb6c77340d95dde9d713e，trial task__Pvb2H9v，从原 R3 恢复且只实跑 R4/R5。R4 627/639、reward 0；R5 663/680、reward 0，两轮各新增 5 次管理调用及一条派发/执行，均已回传关闭。R4 call-20 组任务/身份重复、R5 call-25 采用与 superseded 冲突各触发一次确定性 IR 返修；call-23/28 核对均一致。最终累计 29/59 调用，pending/unresolved 0/0，无 R6、补跑或宿主异常，冻结 runtime 与官方材料哈希未变。

实际最终字段取证：R3 normalize n-1 修正在核对原始材料中，但 R4 prepared 当前 IR/Atom 仍为旧 n，核对漏检真实遗漏，对应 4 项失败；validate 8 项为行号相对官方期望大 1，未直接归为 CI/IR 遗漏。R5 继承这 12 项，另 manifest 5 项为 BLAKE 算法值仍输出在 sha256 键下，官方读取 blake2b；原 R5 文本只直接声明算法更新，字段改名责任尚不能仅凭测试确定。R5 pipeline 原行为保留，lineage 18/18、pipeline 26/26、verify 13/13。当前 Atom 引用/全文完整且明确新旧更新合读，前次两类核对误判未重现；两轮均未使用 edit，纯追加接口仍无真实模型使用证据。

新增管理 usage 合计 input 1106763 / output 25384 / reasoning 12223 / cache_read 4224，仅求 call-20..29 逐次 usage，历史 19 次未计入；执行器分开统计。记录 cost=0 不代表免费，美元账单未知。管理调用耗时 501.581 秒、批次墙钟 513.207 秒、trial 墙钟 1402.164722 秒。逐轮用量、原始拒绝、prepared 字段、执行/官方日志见该 run provenance/post-run-summary.json 与 limited-r4r5-analysis.json；原始证据未修改。R4 回传评估结束且 R5 未入队时另保留了完整原样 store，与自动工作区/会话归档配套，见 provenance/checkpoints/round_4/checkpoint.json；该断点 reward 0。R1–R3 为历史 fast-forward，不能用 aggregate 0.2 表示本版实跑成绩。未修改实现、合同、候选或 verifier，未新增测试/运行。

### 2026-10-02 — 用户限定的默认 context 删减与历史核查

validateSourceCoverage 删除未选当前来源自动 context 补写和当前原文逐段完整处置检查；显式处置的来源／身份／目标／理由／撤回依据校验、采用与非规范处置冲突检查、历史规范来源删除保护保留。携带委托事件级认领要求未改。模型合同、阶段文字和错误修复提示同步移除默认分类／全覆盖义务；新管理记录不再生成 source_defaults.count，历史字段及存量 store 未修改。没有新增字段、门、调用或来源分类框架。

首次全覆盖检查：75750760ca2dd63fafb8519e378311d47660dc7a，提交说明 Bind source requirements and deliver atoms directly；没有查到该检查单独的同期理由。首次自动 context：55ae8fce9436aa111b06a0717987125480a4dc38，提交说明 Hand out one event per batch and let code account for unselected text。其正文明确写出事件 1 -> 3 -> 5 放大和 source accounting grew past what a model can close，并说明 one unmentioned paragraph cannot fail an otherwise complete batch。此前合同要求显式分类每一剩余段落，同一提交保留全覆盖检查、由默认分类参与覆盖；缓解来源账目阻塞的设计理由有实际提交记录。

类型编译：node node_modules/typescript/bin/tsc -p tsconfig.test.json --outDir .scratch/context-removal-20261002/compiled。既有五个相关测试文件 source-payload、dpipe-structured-replay、parent-generation、generation-stages、local-source-edit 共 79/79 通过，git diff --check 通过。没有重跑完整套件、模型或真实验证，实际 diff 直接打印，不生成 diff 文件。源码未提交；主设计和 spec 延续本地忽略状态。

normalize 回退是此前只读取证事实，本次删减不能作为修复 normalize 漏检或回退的证据；原运行的成绩、成本、候选、工作区和配套断点均未修改。

2026-10-02 删减源码/测试已提交 c6e1f6444a3f9518a8dc11e07134bb6469b72e62；随后按用户要求封存四个实验状态及新源码。封存目录 D:\huawei\EvoCodeBench\harbor_checkpoints\intent-dpipe-20261002-091821，五份记录包含来源、版本、工件路径/哈希、成绩、缺陷、恢复条件；144 文件只读，143 清单条目核验通过。原 R3 535/535（IR 漏 normalize）、212435 R4 639/639（缺同点 store，不完整）、223836 R4 627/639（完整，12 失败）、223836 R5 663/680（完整，17 失败）分别保存；未拼接 store 或改写原数据、官方结果。R5 同点 store 为累计29调用/队列0/0，四条执行关闭，执行器身份在对应镜像数据库中存在；DB/WAL/SHM 原字节保留。新提交仅保存 source.zip/Git bundle，未真实运行或新建 runtime。没有测试重跑、模型调用或实际恢复启动，下一恢复来源未决定。


### 2026-10-02 — c6e1f64 全新 R1–R5 单次真实验证


2026-10-02 用户授权的新运行已完成：intent-luna-dpipe-full-r1r5-20261002-053740-e6308341，完整冻结提交 c6e1f6444a3f9518a8dc11e07134bb6469b72e62，runtime 重新构建并核验 3797 个文件。从任务初始工作区、空 compiler/observer store 和新会话开始，R1–R5 均实际运行，没有导入旧 IR/产物/会话，没有 R6 或补跑。单批上限8、全程48，实际26次管理调用（逐批最大6），3条派发/执行回传；连续两轮零派发条件未触发，R5硬结束。

官方 R1 218/219（reward0）、R2 481/481（1）、R3 484/535（0）、R4 608/639（0）、R5 604/680（0），本次官方 aggregate reward0.2。R3、R5没有派发，分别评分继承的R2、R4工件；与此前包含历史fast-forward的aggregate口径不同。R1 ntile失败在R2自然修正。R3已收集sample stddev到prepared IR/Atom，但局部来源删除截断 numeric ParseFloat 说明；独立核对D7的实际最终字段损伤已核实，repair_target=ir，返修又触发仍采用/声明superseded冲突。R4自然携带R3，用revise保留完整旧来源并附入明确更新，source_coverage=[]，核对通过；normalize实现分母n−1，相关测试通过。resample完整正文和引用已交付，执行代码无该分支；validate整数ParseInt返回值被丢弃，min/max用零比较，分别13/18失败。R5六次IR拒绝为采用/撤回冲突、不存在segment及历史规范来源缺少处置，没有进入CI或独立核对。R3代码/二进制与R2相同，R5与R4相同，不能将新版评分变化称作已执行的算法回退。

管理成本只求本run management_calls[].usage：input1744703/output85021/reasoning34324/cache_read96768，26条usage完整。执行器分开按新执行host_identity的123条assistant记录计：input258939/output39618/reasoning11631/cache_read5701632。SDK记录cost合计0，实际美元账单未知。trial起止09:40:34.570444Z–10:36:41.948514Z，墙钟3367.378秒；逐次调用耗时与批次墙钟另列在post-run-summary.json。运行中未改实现、合同、候选、官方verifier或预算，未补测或另启模型。两类先前确认的核对误判未重现，纯追加edit未使用，不能量化单项删减的调用/语义收益；行号规范歧义与manifest字段名测试差异仍单独记录，不调整成绩。

五个匹配断点已独立封存至D:\huawei\EvoCodeBench\harbor_checkpoints\intent-luna-dpipe-full-r1r5-20261002-053740-e6308341，115文件只读，manifest SHA256=b973318a41aee5ec02fb2153e10df6a95ac9d84fa14d9cfac05b9fa858dde933。每份record.json保留原工作区/会话镜像、同点完整store、历史官方结果、路径/哈希、成绩、已知缺陷和恢复限制；R3/R5 pending/unresolved=1/1，其余0/0，下一轮事件均未进入对应store。DB完整性及执行器session匹配通过。原四份历史断点封存保持独立且未修改；旧c6e1f64源码封存的“尚未运行”是当时状态，本段记录之后的真实运行。完整结果及实际最终字段见新run provenance/RESULTS-R1R5.txt、post-run-summary.json、final-field-evidence.json；没有为早期镜像拼接最新store。


### 2026-10-02 — R3/R5来源选择与R1单例的只读取证保存


本轮只读分析全新运行 `intent-luna-dpipe-full-r1r5-20261002-053740-e6308341` 的既有证据；实现冻结提交仍为 `c6e1f6444a3f9518a8dc11e07134bb6469b72e62`。没有修改实现、合同、schema、候选、verifier 或预算，没有测试或模型调用。原五轮成绩、管理26次调用、成本与五个配套断点保持原记录。取证原件在新run的 `provenance/source-selection-evidence/`；报告、完整取证归档及哈希索引保存到仓库 `experiments/evocode/harbor/dpipe/records/2026-10-02-source-selection/`。这是记录提交，不是新的实现版本或真实验证。

**R3 精确归因。** 实际进入核对的 call-13 是 `revise r-transform-basic-additions`，不是 edit remove；同一切口先出现在 call-11/12 新 normalize 内容项的 sources。模型收到 e57/s51=[10080,10366) 的完整解析/统计计算段，却输出 [10080,10169) 与 [10258,10366) 两个子范围，并将 [10169,10258) 声明 superseded。被删89个UTF-16单元从 ParseFloat 中间的 `seFloat` 开始，到 `- For zscore: compute` 结束；population stddev 公式仍在。prepared 当前IR与Atom确实含 `strconv.Par` 截断，且sample stddev更新完整存在，所以call-15 D7的该项缺陷有最终字段支持。call-16收到具体finding，选择完整s51恢复了解析句，却保留重叠撤回声明；最终被采用/撤回冲突拒绝。6次后IR→CI→check还需3次，超过单批8；status=validation_failed/error_code=invalid_candidate，无派发。

**R5 六次的区分。** 同一checksum/sidecar更新及lineage新增反复重列来源；21采用旧句又声明撤回；22使用不存在的`:none`；23把独立segment_id`s18`写成`e155:s18`；24/25首次历史来源缺口均为Ingestion标题e1/[335,350)，去空白为[335,348)，不是整条e1缺失。25虽填入处置，却整段撤回s9、s34、s37、s40，包含仍适用的输出/排序、verify退出码字符串和manifest格式等规则。26仅preserve，未继承尚未提交的前次提案，却保留四项superseded，重新与R4已提交IR冲突。六次既有重复账目和选择器失败，也有真实过度撤回；没有CI/check/提交/派发，不应全部按同一种原因评价。revise要求重列未变来源并另填删除范围/basis/reason；edit已有保留、区间相减、合并、物化及余段处置能力，删除含义仍由模型判断。

**quote范围纠正。** 严格content create/revise sources及edit remove/add/basis的`source_ref_with_quote`投影仅允许segment/span；共享SourceRef和显式source_coverage没有全局禁quote，call-21两个quote已成功定位后才因冲突被拒。以前“线上不支持quote”的表述应限定到这些content/edit字段。当前注释以模型容易错误复制、失败损失整个批次作为排除理由；已有resolver实际可检查quote存在和唯一性并计算UTF-16 span。合同`a copied passage cannot be verified`表述过宽；范围合法同样不保证选择含义正确。本轮只保留接口审阅依据，未决定或实施开放quote、新选择器、精度规则或来源门修改。

**R1唯一失败。** 官方c148是ntile的7行/3组：原文要求3/2/2，prepared r-transform revision0及最终Atom逐字保留公式和示例。执行器固定所有组为ceil(k/n)，实际3/3/1，id6输出6,60,2而官方要求6,60,3。原文明确、测试一致、最终载荷完整，责任为执行实现错误。R4已知执行器问题维持前轮记录，不据此追加管理规则或调用。

实际发送合同从host-part用户文本获取，区别于management attempt中投影前request；source_segments逐项一致。记录包含原响应、完整finding、实际prepared相关字段、混合段全文、每次修复及区间核算。8个引用源码文件与运行冻结源码哈希一致；归档CRC、逐文件SHA及原输入未变已核实。这些是记录完整性检查，不是新增测试或模型正确性证明。


本轮记录保存提交：89e11dec795a93a4523b707a82990c5cedf1f4d5（Record R1-R5 source selection evidence and update handoff）。仅取证报告、原字段归档、哈希索引和交接入口进入Git；实现与测试树相对冻结c6e1f6444a3f9518a8dc11e07134bb6469b72e62未变。主设计/spec与根导航继续按既有本地忽略约定保存。

### 2026-10-02 — 严格来源 quote 选择的最小实施与离线验证

按用户授权，严格来源选择复用现有 SourceRef.quote：source_ref_with_quote 增加互斥的 quote 分支，segment/span 保留。共享构建器同时影响严格 IR 的 content create/revise、edit remove/add/basis，以及 legacy 严格整候选的 content create/revise；CI 不输出 IR changes，只有其未使用的共享定义随之更新。共享 source_ref/source_coverage 原有 quote 能力不变，canonical 字段与操作不变，没有增加模式参数或复制定义。

合同改为整段使用 supplied segment、局部可使用 exact quote，由代码计算 UTF-16 范围；说明缺失或重复匹配按现有 quote_unresolved 拒绝。删除阶段合同将 exact quotes 改写为 explicit spans 的逻辑，同步来源错误提示及过期注释。resolveSourceRefs 算法、edit 区间运算与删除处置、来源冲突和历史删除保护均未修改；edit 继续保留其余来源并生成删除处置，不要求重复申报。

人工离线 R3 用例复用 test/fixtures/fill-edit 中与封存 e57/e114 完整原文 SHA256 相同的文本（运行/事件身份不同）。人工选择旧 zscore 整句，严格 IR schema 接受后，经生产解析器和现有 resolver 得到 [10235,10323)；edit 物化保留 ParseFloat 解析句和 minmax，加入原 sample 更新，代码生成一项 superseded，重复准备不重复记录，来源处置检查通过。基线和动作均为人工构造，仅证明定位、保留及处置接线，不是原候选修复、执行器重放或真实运行成功，不证明模型会正确选文。

验证：tsconfig.test.json 编译通过；candidate-schema-strict、generation-stages、local-source-edit、source-ref-contract 四个既有文件 39/39；单独复用 requirement-flow 中缺失/重复 quote 两个拒绝用例 2/2；git diff --check 通过。编译输出独立写入 .test-dist/quote-selection-20261002，没有重建或覆盖 dist。日志和实际 diff 保存于 development/validation/2026-10-02-quote-selection/。

净收益目标是减少模型手算位置，增加一个 schema 分支并复用已有定位算法；没有新增调用、重试、来源处置义务或任务专用规则。quote 仍不能判断混合段含义、解决采用/撤回矛盾或证明模型整体收益。改动未提交，供审阅；HEAD 仍为 89e11dec795a93a4523b707a82990c5cedf1f4d5。没有模型调用、新 benchmark 运行或官方成绩变更。

2026-10-02 审阅收口：用户已审阅并通过完整 quote diff。提交前核对 c6e1f6444a3f9518a8dc11e07134bb6469b72e62..89e11dec795a93a4523b707a82990c5cedf1f4d5，仅有后者一笔取证记录提交（HANDOFF 与四份取证材料），无源码、测试、依赖或构建配置差异。本次暂存补丁与已审阅 implementation.patch 逐字一致，SHA256=3664602d2ae3da4305f181864eb6f58f7cb71169f56517a59aabaed34450b17e。

本次已提交：751c4d10aceb0597ef52b247d69696db1ae5685c（Allow exact quote selection in strict source schemas），10 个文件，+118/-38。未 push；已跟踪工作区干净，原未跟踪 .scratch/ 保留。提交阶段没有重跑测试或调用模型；沿用前述离线验证，不宣称真实采用率、边界错误率或返修成本已有改善。原补丁和测试日志保持不变。
