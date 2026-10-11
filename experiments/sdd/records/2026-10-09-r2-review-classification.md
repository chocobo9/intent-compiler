# R2 审查分类核对（供独立Reviewer核查）

这是对已记录发现的核查反馈，不是规格修改或PASS指令。请保留全范围独立审查与真实缺口报告。

最新发现将“合法assert表达式返回false”归入“无效recipe/非法参数”，从而推断应添加invalid recipe前缀。请先验证这个分类是否出现在实际契约，而不是从函数体或错误类别名称推断：

- Transform对未知op、非法参数、普通缺列定义invalid recipe；assert条款单独规定表达式结果<=0/NaN时，错误精确为assertion failed on row N: <message>。
- ReportCommandError对“无效recipe”定义invalid recipe，对其它错误定义ERROR: <详情>。合法表达式的断言失败并不自动说明recipe编码或参数非法。
- 共同执行说明已规定具体行为优先于一般错误约定。请把assert的明确精确文本与CLI的ERROR前缀合起来判断。若仍发现真正冲突，请引用要求对“合法assert失败”添加invalid recipe的具体契约文字；不要将未写出的分类当成已定义行为。
- 当前函数体标记pendingUpdate，旧函数体的包装行为由coding修改，不是当前设计是否表达正确要求的证据。

同一源码与summary此前独立复审PASS（ses_ee0bd4fdfffe123QJZJt5PgQwS），本次并非据此自动接受；请直接核对现有文本与原始要求，决定PASS/SPEC_GAP。作者次数仍已耗尽，不能修改规格；本次复审计入原有最多6次独立审查额度。
