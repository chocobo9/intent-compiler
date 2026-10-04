> **历史/专题材料，非现行指令。** 保留当时的观察、方案或取舍；实现与状态须从 [模块地图](../../development/README.md) 核对，不执行本文旧“下一步”。原 CURRENT-DESIGN 节号均指历史设计。

# 结构化输出：已有方法与成功结果（2026-09-22 定向检索）

本文件是本轮为“按 JSON Schema 生成是否已有成熟解法”做的定向检索证据，只记录事实与来源，不改变 development/DESIGN-HISTORY.md 的实施依据。

## 结论

1. **语法层面的“按 schema 100% 合法”是被解决的问题**，不是模型发展至今未解决的难题。解法是 token 级约束解码（constrained decoding），OpenAI、Google Gemini、Groq（strict 模式）以及本地推理引擎（vLLM+XGrammar、SGLang、llama.cpp GBNF 等）都已有生产实现和公开量化结果。
2. **未解决的是语义**：约束只保证结构与类型合法，不保证字段值正确；这由模型能力决定，官方文档有明确说明。
3. 我们当前的困境不是新问题，而是**选了不支持 json_schema 的 provider（DeepSeek）+ 走了主机的提示级降级（OpenCode StructuredOutput 工具）**，机械保证在这条链路上丢失。排除微调后已有现成解法：换原生支持的 provider，或自托管约束解码引擎。

## 1. Provider 级原生结构化输出

### OpenAI Structured Outputs

- 通过 `response_format: {"type":"json_schema","json_schema":{"name","strict","schema"}}` 启用；官方表述：模型“将始终生成符合所提供 JSON Schema 的响应”。
- 文档：<https://platform.openai.com/docs/guides/structured-outputs>
- 本地模型目录（OpenCode models.dev 缓存 `C:\Users\HuaWeiClient\.cache\opencode\models.json`）中 gpt-5.4/5.5/5.6 系列多数模型 `structured_output=true`（如 gpt-5.6-luna、gpt-5.5、gpt-5.4）。注意 gpt-5.2-pro、gpt-5.4-pro 标记为 `false`。

### Google Gemini

- 提供 `response_format`（`mime_type: application/json` + `schema`）与 `response_schema`；Gemini 2.5 系列采用 XGrammar 约束解码。
- 文档：<https://ai.google.dev/gemini-api/docs/structured-output>
- XGrammar 论文：arXiv:2411.15100，报告相对既有结构化生成栈最高约百倍加速、部分场景接近零开销。

### Groq Structured Outputs

- 两种模式（同一 `response_format: {"type":"json_schema","json_schema":{"name","strict","schema"}}`）：
  - `strict: true`：token 级约束解码，原文承诺“Never errors or produces invalid JSON”“100% schema adherence”。支持模型：`openai/gpt-oss-20b`、`openai/gpt-oss-120b`、`qwen/qwen3.8-27b`。要求 schema 中所有字段必填、对象 `additionalProperties:false`。
  - `strict: false`（默认）：只保证合法 JSON，不保证 schema 符合；适用于所有 Structured Outputs 模型（含 llama-3.3-70b-versatile 等）。
- 文档：<https://console.groq.com/docs/structured-outputs>
- 本地模型目录中 groq 的 `openai/gpt-oss-20b`、`openai/gpt-oss-120b`、`qwen/qwen3.8-27b`、`qwen/qwen3.6-27b` 均标 `structured_output=true`。

### Anthropic

- 以 tool use 的 `input_schema` 作为结构化输出机制，没有独立的 json_schema response_format。
- 文档：<https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview>

### DeepSeek

- 只支持 JSON Output 模式：`response_format: {"type":"json_object"}`，并要求 prompt 中出现 “json” 字样及示例；**没有 json_schema**。
- 文档：<https://api-docs.deepseek.com/guides/json_mode>
- 与本项目实测一致：直连 `response_format: json_schema` 返回 “This response_format type is unavailable now”。
- 本地模型目录标 deepseek-flash `structured_output=true`，但这是 OpenCode 侧能力标记，实际由 OpenCode 用 StructuredOutput 工具（提示级）实现，**不等于 provider 原生强制**。

### OpenCode 的降级行为

- 本项目通过 `session.prompt` 传 `format:{type:"json_schema",schema,retryCount:1}`。对无原生支持的 DeepSeek，模型以 StructuredOutput 工具调用形式输出，文本回传是 DSML 标记（本项目已兼容多种渲染变体）。
- 直接证据（本项目 2026-09-22 重放实验，见 `results/evocodebench/intent-on/replay-2026-09-22/`）：14 个历史失败请求重放，14/14 产出正文但 14/14 首轮 schema 失败，共 1125 条错误、454 种路径；集中缺 `authority.rules[*].resource_ref/allowed_use/conditions`、ir_changes 多属性、sources 缺 digest。说明该 schema 在这条链路上未被机械执行。

## 2. 引擎级约束解码（自托管可用）

- vLLM guided decoding / structured outputs：<https://docs.vllm.ai/en/latest/features/structured_outputs.html>
- XGrammar：<https://github.com/mlc-ai/xgrammar>，论文 arXiv:2411.15100。
- SGLang：<https://docs.sglang.ai/backend/structured_outputs.html>
- llama.cpp grammar（GBNF）：<https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md>
- Outlines：<https://dottxt-ai.github.io/outlines/>；Guidance：<https://github.com/guidance-ai/guidance>；LMQL：<https://lmql.ai/>

以上都属于同一保证类别：在开源权重模型上做语法约束解码，本机可控、无 provider 依赖；代价是需要自托管推理服务。

## 3. 应用层校验+重试

- Instructor：pydantic 校验 + 跨 provider 重试（含 Groq/Anthropic/OpenAI 等），保证最终拿到合法对象，不保证一次生成。文档：<https://python.useinstructor.com/>
- BAML：schema-first + 校验循环。文档：<https://docs.boundaryml.com/>
- 这类方法解决“最终合法”，成本随重试放大；无法消除单次生成失败，本质与“提示词+重试”同族。

## 4. 语法合法 ≠ 语义正确

- OpenAI 文档明确：结构化输出保证“格式正确”，字段内容仍可能出错（模型仍可幻觉值）。
- 因此本项目的分层方向成立：结构合法性应落在机械层（约束解码/确定性校验），语义正确性继续由管理层核对承担。当前缺口是机械层本身（DeepSeek+OpenCode 链路没有它）。

## 5. 直接回答

**这不是未解决的特殊问题。** token 级约束解码是成熟、多 provider 生产部署并有公开量化结果的解法（OpenAI/Gemini/Groq strict 的“100% 合法”承诺、XGrammar 的性能数字）。排除微调后，可用路径是：

1. 换支持 json_schema 的 provider（Groq `openai/gpt-oss-120b` 或 `qwen/qwen3.8-27b` strict 模式成本最低；Gemini/OpenAI 也可）；
2. 或自托管 vLLM+XGrammar 等对开源模型做约束解码。

本项目的已知落地条件：当前 CANDIDATE_JSON_SCHEMA 含可选字段（如 `source_ref.span`、`previous_atom_ref`、`expectation`），不满足 Groq strict 的“全部必填”要求，启用 strict 前需要一份 strict 兼容的 schema 变体；否则只能得到 best-effort（合法 JSON、不保证 schema）。

## 6. 本项目实测对照（2026-09-22）

同一批 14 个历史失败的管理请求，只换结构化输出链路，单发（无重试）：

- DeepSeek + OpenCode（无原生 json_schema，提示级降级）：14/14 首轮 schema 失败，1125 条错误。
- Qwen3.8-flash + Alibaba DashScope 兼容端点（原生 `response_format: json_schema`，strict + strict 兼容 schema + 关闭思考）：14/14 首轮 schema 通过。

实现见 `src/model/candidate-schema-strict.ts`（profile 化 strict schema、可选字段空值化）、`src/model/structured-provider-transport.ts`（strict/schema/超时/extra body 选项）。原始记录在 `results/evocodebench/intent-on/replay-2026-09-22-qwen`（Qwen 14/14 通过；DeepSeek 0/14 的对照数字记录于本文件，其原始目录已按清理约定移除）。该结果只证明“结构合法性可由 provider 层保证”，不证明候选字段值的语义正确；语义仍由管理层核对承担。
