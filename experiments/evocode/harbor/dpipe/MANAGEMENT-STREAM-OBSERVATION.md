# 本轮 OpenCode 管理流观测补丁

状态：2026-09-29用户要求再次测试后，已在run intent-sol-dpipe-parent-20260929-007通过session目录覆盖挂载实际接入；首轮3条管理流完成，参数片段和结束事件已记录。旧宿主和历史运行目录未改动。此前停止测试的记录仍适用于前一批次。

## 作用

`patch-management-stream.py` 读取指定宿主，检查 4 个精确源码锚点，只向全新目标目录写入新副本。默认复制宿主（保留依赖，排除 `.git`），然后增加 `management-stream-observer.ts`，在 `processor.ts` 的真实 `llm.stream` 消费路径前后接入观察器。锚点不匹配或目标已存在就拒绝；指定历史运行目录作为目标也会拒绝。

仅设置 `OPENCODE_MANAGEMENT_STREAM_LOG` 且本次模型请求提供 `StructuredOutput` 工具时开启。其余请求不记录。补丁不改提示、Schema、参数、重试策略、完成判断、工具权限、业务工具或流事件。

## 应用方式（下一次运行使用prepare的session目录覆盖挂载）

```powershell
python experiments/evocode/harbor/dpipe/patch-management-stream.py --source D:/huawei/opencode-v1.18.31-strict --target D:/huawei/opencode-session-observed --overlay-only
```

将新运行的 OpenCode 挂载或启动路径改为生成的新副本，给该进程设置 `OPENCODE_MANAGEMENT_STREAM_LOG` 为新运行可写的 JSONL 文件绝对路径。容器例：`/opt/intent-data/audit/management-stream.jsonl`。不要修改历史运行的宿主挂载。可加 `--overlay-only` 复制session源码目录，修改其中processor并加入观察器和清单；prepare将整个session目录只读挂到原宿主同位置，避免Windows复制Linux依赖链接及Docker只读嵌套单文件挂载错误。这不是可独立启动的完整宿主。

输出 `management-stream-patch.json` 记录源路径、目标路径、原 processor、新 processor 和观察器的 SHA-256，便于追溯。它不读取或保存认证文件、请求 headers 或环境变量全集。

## 日志含义

- `stream-start`：开始消费一条管理模型流；每次宿主重试单独记录 stream ID。
- `heartbeat`：每 5 秒记录累计事件数、参数 delta 次数、参数 UTF-8 字节数、距最近事件/参数 delta 的时间，以及 text/reasoning 字节计数。不会保存 reasoning/text 正文。
- `parameter-sample`：只保存 StructuredOutput 参数 delta 的最前 4096 字节，整条流共享此上限。使用 Base64 保留 UTF-8 原始片段，包括截在码点中间的情况；不是完整参数。其他工具参数不记录。
- `tool-input-start/end`、`tool-call/result`：记录阶段及单个调用的累计次数/字节，不记录已解析参数或工具返回内容。
- `step-finish`、`provider-finish`：记录提供方结束原因（若已出现）。
- `stream-close`：Effect 流退出时记录 success、failure 或 interrupted；不把 success 等同于业务完成。若进程被强杀，可能没有 close，不能据此猜测提供方结束原因。

连续 heartbeat 中参数字节/次数增长表示长参数仍在输出；不增长且 `idle_parameter_ms` 增加表示参数没有推进。若事件数或 reasoning 字节仍增长，则是另一种流活动，不能说整个网络断了。若 heartbeat 自身停止，只能说明进程、事件循环或日志写入状态未知。日志写失败会关闭观察器，不中断生成。

这是对“是否推进”的观测修复，**不自行终止长输出，也不证明 pending 的根因已消除**。管理请求的墙钟截止与取消由编译器 transport 的另一个修复负责。
