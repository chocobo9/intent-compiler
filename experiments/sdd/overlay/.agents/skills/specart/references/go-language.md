# Go 源码适配

使用 `language: go`、真实 `.go` 文件和 `--ui none`（仅当任务无 UI）。
Go 使用现有源码设计、独立审查、accept-design、start-implementation、check、obligations、prove、report 生命周期。
没有 Go 实现证明适配器：`formal_proof: false`，独立 Verifier 按原 fallback 规则寻找反例并绑定源码证据；不得把能力受限写成 PROVED。

## 声明与来源

- 新函数在设计阶段写完整签名而不写函数体；实现阶段才补函数体并通过真实 Go 构建。
- 已有函数保留函数体，设计修改用 `@pendingUpdate`，实现后移除此标记。
- 函数的行为规约使用紧邻声明的 `/* ... */` 完整块，包含 `行为规约:`、`@behavior`、`@src`；不把分散的多行 `//` 注释假定为一个规约块。`@changedBy` 是独立追溯标记，可位于关联的块注释或单行注释中；没有行为规约的类型/字段允许 `// @changedBy TASK_ID`，不要求为了标记另造行为块。
- summary 仍使用 `file/signature/owner/behavior/previous_signature`。类型 signature 写完整成员结构，包括嵌入字段、字段标签、接口方法；不带 package 行。
- 普通函数 owner 留空；方法 owner 是 receiver 的基础类型，例如 `Reader`。签名仍保留 `(r *Reader)`，不得丢掉指针、泛型、变长参数或返回值顺序。
- 函数参数与命名返回值的合并写法由 Go AST 展开后参与身份匹配，`a, b int` 与 `a int, b int` 等价；名称、顺序、类型及 receiver 仍受保护。实现阶段若意外改动规约注释，应恢复已验收契约，不能通过修改 summary 或验收记录迁就错误实现。真正需要变更设计时才走现有设计修订、独立审查与重新验收流程。
- Go helper 只解析源码，不加载依赖或执行项目。语法解析不代替构建；包依赖保护只比较 summary 文件到项目内部包的 import 边，标准库和第三方包不属于此保护范围。包身份使用相对项目目录，go.mod 的 module 名用于解析 import，不作为包身份。支持项目内声明的嵌套 module；不检查依赖版本，也不声称覆盖整个模块图。
- 有 import 但缺少 go.mod、模块声明不合法或存在尚不支持的 replace 映射时，保留 unresolved 提取事实，不伪装成完整空依赖图。必要项目配置由实现阶段建立，使用共同配置指定的构建命令验证。
- 成员检查只读取 summary 涉及的源码；需要检查跨文件类型时，显式把该类型声明列入 summary。同名类型按 Go package 目录区分。

## 行为表达式

规约继续采用 SpecArt 表达式和谓词，不能直接把任意 Go 表达式放进 clause。

| 返回声明 | 规约引用 |
| --- | --- |
| 无返回值 | 不可引用 result |
| 一个返回值 | result；若类型定义可解析，可引用其成员 |
| 多个返回值 | result.item1、result.item2……，严格按声明顺序 |

命名与未命名返回值使用相同位置约定。`(value int, ok bool)` 的第二项不是 error，也不提供 `result.ok` 别名。位置只存在于规约解释中，不往 Go 源码添加结构体。
方法通过真实 receiver 名称引用状态，例如 `OLD(r.Count)`。返回值不在入口可见，`OLD(result.item1)` 无效。
外部类型、推断类型等解析信息不足时，成员正确性仍需独立审查与构建证据，不能把缺少诊断写成类型证明。

Go helper 从标准库源码构建到临时缓存。可通过 `SPECART_GO` 指定 Go 可执行文件，或用 `SPECART_GO_HELPER` 指定已构建的 helper。行为表达式仍依赖现有仓颉 helper；不得因目标语言是 Go 就删掉该依赖。

## 最小声明示例

先执行现有 start-design，将返回的 task_id 替换下面的 TASK_ID，再按正常流程生成 manifest 和 summary。下面是设计骨架，不能直接当成已验收或已实现代码。

```go
package example

/* 行为规约:
返回输入与成功标记。
@behavior
@src requirements.md#echo
@changedBy TASK_ID
@ensures result.item1 == value
@ensures result.item2 == true
*/
func Echo(value int) (int, bool)
```

summary 中的 signature 为 `func Echo(value int) (int, bool)`，behavior 与源码规约一致。accept-design 成功后才补 `{ return value, true }`，随后执行 check、真实构建和独立验证。多返回值与 receiver 的可运行离线例子见 `tests/specart-validator/test_go_adapter.py`。
