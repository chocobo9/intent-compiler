from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

from .bundle import Bundle
from .diagnostics import Diagnostic
from .helpers.cangjie import HelperError
from .languages import base_capability, valid_identifier, registered
from .paths import logical, unbounded_scope, unsafe_relative


UI_CALL = re.compile(
    r"(?P<kind>[A-Za-z][A-Za-z0-9_]*)\(id=(?P<surface>[A-Za-z][A-Za-z0-9_-]*)\."
    r"(?P<id>UI-[A-Z0-9-]+)\)\.(?P<operation>[A-Za-z][A-Za-z0-9_]*)(?:\s*\([^)]*\))?"
)
RESULT_ADAPTER_MEMBERS = {"Result": {"isSuccess", "isFailure", "value", "error"}}
SOURCE_IR_ERRORS = {"SA003", "SA004", "SA100", "SA101", "SA102", "SA103", "SA104"}


def _schema_type_name(value: object) -> str:
    if isinstance(value, bool):
        return "TrueClass" if value else "FalseClass"
    return {
        str: "String", dict: "Hash", list: "Array", int: "Integer",
        float: "Float", type(None): "NilClass",
    }.get(type(value), type(value).__name__)


class Validator:
    def __init__(self, *, bundle: Bundle, helper: Any, predicates: Any,
                 ui_registry: Any, a2ui_validator: Any = None):
        self.bundle = bundle
        self.helper = helper
        self.predicates = predicates
        self.ui_registry = ui_registry
        self.a2ui_validator = a2ui_validator
        self.diagnostics: list[Diagnostic] = [
            *bundle.diagnostics, *predicates.diagnostics, *ui_registry.diagnostics,
        ]
        self._function_index_cache: dict[str, dict] | None = None
        self._type_names_cache: set[str] | None = None
        self._class_names_cache: set[str] | None = None

    def run(self) -> "Validator":
        self._validate_bundle_root()
        self._validate_manifest()
        if self._source_ir_unavailable():
            self._validate_ui_layout()
            self._sort()
            return self
        self._validate_ui_layout()
        self._validate_source_dependencies()
        self._validate_behaviors()
        self._validate_orphan_actions()
        self._validate_traces()
        self._sort()
        return self

    def _validate_source_dependencies(self) -> None:
        from .dependencies import extract, relationships
        graph = {}
        for source, target in relationships(extract(self.bundle.project_root, self.bundle.language, self.bundle.files)):
            graph.setdefault(source, set()).add(target)
        for cycle in self._find_cycles(graph):
            self._error('SA062', 'summary 文件中存在包依赖环', self._manifest_path(), cycle,
                        '仅检查 summary 范围内已提取的关系。', '由设计角色调整包间依赖。')

    @property
    def success(self) -> bool:
        return not self.diagnostics

    def _sort(self) -> None:
        self.diagnostics.sort(key=lambda item: (
            str(item.file or ""), int(item.line or 0), int(item.column or 0), str(item.code or ""),
        ))

    def _source_ir_unavailable(self) -> bool:
        return self.bundle.adapter is None or any(item.code in SOURCE_IR_ERRORS for item in self.diagnostics)

    def _validate_bundle_root(self) -> None:
        if self.bundle.valid_source_root:
            return
        self._error(
            "SA000", "bundle 路径无效", self.bundle.path,
            "目标不是以 .specart 结尾的目录。",
            "SpecArt bundle 必须使用 <feature>.specart/ 目录。", "传入正确 bundle 根目录。",
        )

    def _validate_manifest(self) -> None:
        required: dict[str, type | None] = {
            "language": str, "feature_context": dict,
            "traceability_and_validation": dict, "version": None,
        }
        allowed = set(required) | {"formal_proof", "ui_layout", "project_root"}
        for key in sorted(set(self.bundle.manifest) - allowed):
            self._error(
                "SA013", "manifest 包含未知顶层字段", self._manifest_path(), key,
                "声明和行为规约位于真实源码，summary 记录本次设计。",
                "删除该字段；共享 YAML 只保留 version、language、feature_context、traceability_and_validation，以及可选 project_root、formal_proof、ui_layout。",
            )
        for key, expected_type in required.items():
            if key not in self.bundle.manifest:
                self._error("SA010", "manifest 缺少字段", self._manifest_path(), key, "缺少必需的共享字段。", f"添加 `{key}`。")
                continue
            value = self.bundle.manifest[key]
            if expected_type and not isinstance(value, expected_type):
                self._error(
                    "SA011", "manifest 字段类型错误", self._manifest_path(),
                    f"{key}={_schema_type_name(value)}", f"{key} 必须是 {_schema_type_name(expected_type())}。",
                    "按 format-reference.md 修正该 section。",
                )
        if "ui_layout" in self.bundle.manifest and not isinstance(self.bundle.manifest["ui_layout"], str):
            value = self.bundle.manifest["ui_layout"]
            self._error(
                "SA011", "manifest 字段类型错误", self._manifest_path(), f"ui_layout={_schema_type_name(value)}",
                "ui_layout 必须是 bundle 内 A2UI JSONL 文件的相对路径。",
                "改为类似 `ui/layout.a2ui.jsonl` 的字符串；无 UI 时删除该字段。",
            )
        if 'project_root' in self.bundle.manifest and not isinstance(self.bundle.manifest['project_root'], str):
            self._error('SA011', 'project_root 类型错误', self._manifest_path(), self.bundle.manifest['project_root'],
                        '项目位置必须是路径字符串。', '填写相对于规格目录的真实项目路径。')
        if "formal_proof" in self.bundle.manifest and type(self.bundle.manifest["formal_proof"]) is not bool:
            value = self.bundle.manifest["formal_proof"]
            self._error(
                "SA011", "manifest 字段类型错误", self._manifest_path(), f"formal_proof={_schema_type_name(value)}",
                "formal_proof 必须是布尔值。",
                "严格形式化验证写为 `formal_proof: true`；默认 LLM fallback 写为 `formal_proof: false` 或省略该字段。",
            )
        if "version" in self.bundle.manifest and str(self.bundle.manifest["version"]) != "2.0":
            self._error(
                "SA014", "manifest version 不支持", self._manifest_path(), self.bundle.manifest["version"],
                "当前 validator 只接受 SpecArt 2.0。", "将 version 设为 2.0。",
            )
        if "language" in self.bundle.manifest and not registered(self.bundle.language):
            self._error(
                "SA016", "manifest language 无效", self._manifest_path(), self.bundle.manifest["language"],
                "language 必须是非空且不含空白的实现语言标识。",
                "填写 cangjie 或 arkts；其他源码语言需先增加提取适配器。",
            )
        language_value = self.bundle.manifest.get("language")
        if self.bundle.manifest.get("formal_proof") is True and registered(language_value):
            if base_capability(language_value).proof_adapter is None:
                self._error(
                    "SA017", "当前语言不支持严格形式化验证", self._manifest_path(), language_value,
                    "formal_proof: true 要求该语言具有 implementation proof adapter；"
                    + ("当前 ArkTS 仅支持 LLM fallback。" if language_value == "arkts"
                       else f"当前 {language_value} 仅支持 LLM fallback。"),
                    "删除 strict/formal 要求并设为 `formal_proof: false`，或改用支持严格形式化验证的语言。",
                )
        for legacy_root in ("review", "impl", "spec"):
            if (Path(self.bundle.path) / legacy_root).is_dir():
                self._error(
                    "SA020", "旧规格源码树不再支持", str(Path(self.bundle.path) / legacy_root), legacy_root,
                    "规格已迁入项目真实源码。", "使用真实声明和 summary.yaml。",
                )
        context = self.bundle.manifest.get("feature_context")
        if isinstance(context, dict):
            context_types = {"sources": list, "goal": str, "success_signals": list, "out_of_scope": list}
            for key, expected_type in context_types.items():
                if key not in context:
                    self._error("SA010", "feature_context 缺少字段", self._manifest_path(), key, "v1 feature_context 不完整。", f"添加 `{key}`。")
                elif not isinstance(context[key], expected_type):
                    self._error(
                        "SA015", "feature_context 字段类型错误", self._manifest_path(),
                        f"{key}={_schema_type_name(context[key])}", f"{key} 必须是 {_schema_type_name(expected_type())}。",
                        "按 format-reference.md 修正 feature_context。",
                    )
        trace = self.bundle.manifest.get("traceability_and_validation")
        if isinstance(trace, dict):
            if "spec_to_code_trace" in trace:
                self._error("SA012", "旧代码映射字段已移除", self._manifest_path(), "spec_to_code_trace", "summary 已直接定位源码。", "删除该字段。")
            for key in ("pm_to_spec_trace", "nl_to_intent_trace", "architecture_to_code_trace", "spec_to_test_trace"):
                if not isinstance(trace.get(key), list):
                    self._error("SA012", "trace section 无效", self._manifest_path(), key, "每个 trace 列表必须存在且为数组。", f"把 `{key}` 写成 YAML list。")


    def _validate_ui_layout(self) -> None:
        self._ui_elements: dict[str, dict] = {}
        self._ui_actions: list[dict] = []
        self._matched_actions: dict[str, int] = defaultdict(int)
        self._binding_sources: set[tuple[Any, Any, Any]] = set()
        if not self.bundle.ui_layout or not self.bundle.ui_layout_path:
            return
        self._validate_official_a2ui()
        messages = self.bundle.ui_messages
        if not messages:
            self._error('SA081', 'A2UI 布局为空', self.bundle.ui_layout_path, 0,
                        'UI 规格至少需要一个 surface。', '添加 createSurface 和完整 updateComponents。')
            return
        if len(messages) % 2:
            self._error(
                "SA081", "A2UI surface 消息不成对", self.bundle.ui_layout_path, len(messages),
                "每个页面必须连续包含一条 createSurface 和一条完整 updateComponents。",
                "为每个 surface 只保留相邻的 createSurface + updateComponents。",
            )
        seen_surfaces: set[Any] = set()
        for offset in range(0, len(messages), 2):
            create_message = messages[offset]
            update_message = messages[offset + 1] if offset + 1 < len(messages) else None
            create = create_message.get("createSurface")
            update = update_message.get("updateComponents") if update_message else None
            if not isinstance(create, dict) or not isinstance(update, dict):
                self._error(
                    "SA081", "A2UI surface 消息顺序无效", self.bundle.ui_layout_path,
                    f"line {create_message.get('__specart_line')}",
                    "每个 surface 必须严格使用 createSurface 后接 updateComponents。",
                    "删除 updateDataModel/deleteSurface，并按 surface 重排两条消息。",
                    create_message.get("__specart_line"),
                )
                continue
            surface = create.get("surfaceId")
            if surface != update.get("surfaceId"):
                self._error(
                    "SA081", "A2UI surfaceId 不一致", self.bundle.ui_layout_path,
                    f"{surface!r} / {update.get('surfaceId')!r}",
                    "成对消息必须描述同一个 surface。", "统一两条消息的 surfaceId。",
                    update_message.get("__specart_line"),
                )
                continue
            if surface in seen_surfaces:
                self._error(
                    "SA083", "surfaceId 重复", self.bundle.ui_layout_path, surface,
                    "一个页面只能声明一个 createSurface + updateComponents 对。",
                    "合并重复页面或使用不同 surfaceId。", create_message.get("__specart_line"),
                )
            seen_surfaces.add(surface)
            if create.get("catalogId") != self.ui_registry.catalog_id:
                self._error(
                    "SA082", "catalogId 不匹配", self.bundle.ui_layout_path, create.get("catalogId"),
                    f"SpecArt UI structure 必须使用预制 catalog {self.ui_registry.catalog_id}。",
                    "将 createSurface.catalogId 改为预制 catalogId。", create_message.get("__specart_line"),
                )
            self._index_surface(surface, list(update.get("components") or []), update_message.get("__specart_line"))

    def _validate_official_a2ui(self) -> None:
        if not self.a2ui_validator:
            return
        result = self.a2ui_validator.validate(
            catalog_path=self.ui_registry.a2ui_catalog_path,
            input_path=self.bundle.ui_layout_path,
        )
        for diagnostic in result.get("diagnostics") or []:
            environment_error = str(diagnostic.get("code", "")).startswith("A2UI_ENV_")
            found = " ".join(str(value) for value in (diagnostic.get("code"), diagnostic.get("path")) if str(value or ""))
            self._error(
                "SA160", "A2UI 校验环境不可用" if environment_error else "官方 A2UI 校验失败",
                self.bundle.ui_layout_path, found, diagnostic.get("message"),
                "执行 `python -m pip install -r python/requirements.txt`。" if environment_error else
                "按官方 A2UI v0.9.1 schema 和预制 catalog 修正消息。",
                diagnostic.get("line"), diagnostic.get("column"),
            )

    def _index_surface(self, surface: Any, components: list, line: int | None) -> None:
        by_id: dict[Any, dict] = {}
        for component in components:
            if not isinstance(component, dict):
                continue
            component_id, kind = component.get("id"), component.get("component")
            key = f"{surface}.{component_id}"
            if component_id in by_id:
                self._error(
                    "SA083", "同一 surface 组件 ID 重复", self.bundle.ui_layout_path, key,
                    "A2UI component id 在 surface 内必须唯一。", "为组件分配唯一 id。", line,
                )
            by_id[component_id] = component
            self._ui_elements[key] = {
                "kind": kind, "component": component, "surface": surface, "scope": None,
            }
        root = by_id.get("root")
        if root and root.get("component") not in self.ui_registry.root_kinds:
            self._error(
                "SA082", "UI root kind 无效", self.bundle.ui_layout_path, root.get("component"),
                "id=root 的组件必须是全表面容器。",
                f"使用 {', '.join(sorted(self.ui_registry.root_kinds))}。", line,
            )
        self._assign_template_scopes(surface, by_id, "root", None, set())
        self._index_binding_sources(surface)
        self._index_actions(surface)

    def _assign_template_scopes(self, surface: Any, by_id: dict, component_id: Any,
                                scope: str | None, visited: set[tuple[Any, Any]]) -> None:
        visit_key = (component_id, scope)
        if visit_key in visited:
            return
        visited.add(visit_key)
        record = self._ui_elements.get(f"{surface}.{component_id}")
        if not record:
            return
        if record.get("scope") is None:
            record["scope"] = scope
        component = by_id.get(component_id) or {}
        child = component.get("child")
        if isinstance(child, str):
            self._assign_template_scopes(surface, by_id, child, scope, visited)
        children = component.get("children")
        if isinstance(children, list):
            for child_id in children:
                self._assign_template_scopes(surface, by_id, child_id, scope, visited)
        elif isinstance(children, dict):
            template_id = children.get("componentId")
            self._assign_template_scopes(surface, by_id, template_id, f"template:{template_id}", visited)

    def _index_binding_sources(self, surface: Any) -> None:
        for record in self._ui_elements.values():
            if record.get("surface") != surface:
                continue
            component = record["component"]
            for property_name in self.ui_registry.value_properties_for(record.get("kind")):
                binding = component.get(property_name)
                if isinstance(binding, dict) and isinstance(binding.get("path"), str):
                    path = binding["path"]
                    self._binding_sources.add((surface, None if path.startswith("/") else record.get("scope"), path))

    def _index_actions(self, surface: Any) -> None:
        for key, record in self._ui_elements.items():
            component = record["component"]
            if record.get("surface") != surface or not isinstance(component.get("action"), dict):
                continue
            event = (component.get("action") or {}).get("event")
            if isinstance(event, dict):
                self._ui_actions.append({**record, "key": key, "event": event, "interaction": component.get("interaction")})

    def _validate_behaviors(self) -> None:
        for function in self.bundle.selected:
            behavior = function.get("behavior")
            position = function.get("position") or {}
            if not behavior:
                if function.get('kind') != 'function':
                    continue
                self._error(
                    "SA120", "函数缺少相邻行为规约", self._file_path(function["relative_path"]), function.get("identity"),
                    "每个目标 API 都必须有紧邻函数声明的行为块。",
                    "添加一段同时包含非空自然语言和 @behavior clauses 的函数头注释。",
                    position.get("line"), position.get("column"),
                )
                continue
            if not behavior.get("has_natural_marker") or not behavior.get("has_behavior_marker") or not behavior.get("ordered"):
                self._error(
                    "SA124", "合并行为规约格式无效", self._file_path(function["relative_path"]), function.get("identity"),
                    "声明的行为注释必须先包含 行为规约:，再包含 @behavior。",
                    "把自然语言与 clauses 合并到同一注释，保持自然语言在前。", behavior.get("line"),
                )
                continue
            if not str(behavior.get("natural_language", "")).strip():
                self._error(
                    "SA124", "自然语言行为说明为空", self._file_path(function["relative_path"]), function.get("identity"),
                    "行为规约: 与 @behavior 之间必须有非空说明。", "补充面向人的自然语言行为说明。", behavior.get("line"),
                )
            self._validate_source_reference(function, behavior)
            clauses = list(behavior.get("clauses") or [])
            if not clauses and function.get('kind') == 'function':
                self._error(
                    "SA124", "空 @behavior", self._file_path(function["relative_path"]), function.get("identity"),
                    "@behavior 没有 clause。", "增加准确的 requires/ensures/effects 等 clause。", behavior.get("line"),
                )
            for clause in clauses:
                self._validate_clause(function, clause)

    def _validate_source_reference(self, function: dict, behavior: dict) -> None:
        entries = list(behavior.get("src_entries") or [])
        file = self._file_path(function["relative_path"])
        if not entries:
            self._error(
                "SA121", "行为规约缺少 @src", file, function.get("identity"),
                "每个行为规约都必须声明其上游需求点或使用场景来源。",
                "在 @behavior 后添加唯一的非空 @src；上游有明确 ID 时只填写准确 ID，否则填写 source_file#locator。",
                behavior.get("line"), 1, function.get("identity"),
            )
            return
        if len(entries) > 1:
            duplicate = entries[1]
            self._error(
                "SA121", "行为规约包含重复 @src", file, duplicate.get("value"),
                "每个目标声明只能有一个来源字段。", "合并或删除重复项，仅保留一个准确的 @src。",
                duplicate.get("line"), duplicate.get("column"), function.get("identity"),
            )
        empty = next((entry for entry in entries if not str(entry.get("value", "")).strip()), None)
        if empty:
            self._error(
                "SA121", "行为规约的 @src 为空", file, "@src",
                "@src 必须定位到实际使用的上游需求点、用例或使用场景。",
                "上游有明确 ID 时只填写准确 ID，否则填写 source_file#locator。",
                empty.get("line"), empty.get("column"), function.get("identity"),
            )

    def _validate_clause(self, function: dict, clause: dict) -> None:
        expression = str(clause.get("expression", "")).strip()
        file = self._file_path(function["relative_path"])
        if not expression or re.match(r"(?:TODO|TBD)\b", expression, re.IGNORECASE):
            self._error(
                "SA125", "空洞行为 clause", file, repr(expression), "clause 不能为空或使用占位文本。",
                "写出可解析且有约束力的表达式。", clause.get("line"), clause.get("column"), function.get("identity"),
            )
            return
        directive = clause.get("directive")
        identity_match = re.fullmatch(r"(.+)\s*==\s*\1", expression)
        if directive in {"ensures", "updates", "effects", "invariants"} and (
            expression == "true" or identity_match or expression.endswith("~> true")
        ):
            self._error(
                "SA126", "恒真行为 clause", file, expression, "该表达式不能约束任何实现行为。",
                "写出需求实际要求的状态、效果或并发保证。", clause.get("line"), clause.get("column"), function.get("identity"),
            )
            return
        if directive in {"follows", "updates"}:
            self._validate_ui_clause(function, clause)
            return
        expression_ir = self._parse_expression(expression, file, clause.get("line") or 1)
        if expression_ir:
            self._validate_predicate_calls(function, clause, expression_ir)
            self._validate_expression_scope(function, clause, expression_ir)

    def _validate_ui_clause(self, function: dict, clause: dict) -> None:
        expression = str(clause.get("expression", ""))
        ui_expression = expression
        if "~>" in expression:
            condition, _, ui_expression = expression.rpartition("~>")
            condition_ir = self._parse_expression(condition.strip(), self._file_path(function["relative_path"]), clause.get("line") or 1)
            if condition_ir:
                self._validate_predicate_calls(function, clause, condition_ir)
                self._validate_expression_scope(function, clause, condition_ir)
        matches = list(UI_CALL.finditer(ui_expression))
        if not matches or UI_CALL.sub("", ui_expression).strip():
            self._error(
                "SA084", "UI 行为语法无效", self._file_path(function["relative_path"]), ui_expression,
                "UI 行为必须使用 Kind(id=surfaceId.UI-ID).operation(...)。",
                "检查 UI selector、ID、operation 和条件化 ~> 形式。",
                clause.get("line"), clause.get("column"), function.get("identity"),
            )
            return
        for match in matches:
            self._validate_ui_call(function, clause, match["kind"], match["surface"], match["id"], match["operation"])

    def _validate_ui_call(self, function: dict, clause: dict, kind: str, surface: str,
                          component_id: str, operation: str) -> None:
        key = f"{surface}.{component_id}"
        element = self._ui_elements.get(key)
        common = (clause.get("line"), clause.get("column"), function.get("identity"))
        if not element:
            self._error("SA085", "UI ID 未声明", self._file_path(function["relative_path"]), key, "行为引用必须解析到 A2UI surface 内的组件。", "在 layout 中声明该 surface/component，或修正引用。", *common)
            return
        if element.get("kind") != kind:
            self._error("SA086", "UI kind 与 layout 不一致", self._file_path(function["relative_path"]), f"{kind}(id={key})", f"layout 中该 ID 的 kind 是 {element.get('kind')}。", f"改用 {element.get('kind')}(id={key})。", *common)
        operations = self.ui_registry.operations(kind)
        if not operations or operation not in operations:
            self._error("SA087", "UI operation 未注册", self._file_path(function["relative_path"]), f"{kind}.{operation}", "operation 必须绑定到对应 registry kind。", "从 kinds-catalog.yaml 选择合法 operation。", *common)
        if clause.get("directive") == "follows":
            self._validate_follows_action(function, clause, element, key, operation)
        elif (element.get("component") or {}).get("action") and (element.get("component") or {}).get("interaction") == operation:
            self._error(
                "SA168", "@updates 误用了主要 action", self._file_path(function["relative_path"]), f"{key}.{operation}",
                "@updates 表达用户可观察响应；主要 action 只与 @follows 对应。",
                "将触发行为写入 @follows，或在 @updates 中引用响应 operation。", *common,
            )

    def _validate_follows_action(self, function: dict, clause: dict, element: dict,
                                 key: str, operation: str) -> None:
        component = element.get("component") or {}
        event = (component.get("action") or {}).get("event")
        common = (clause.get("line"), clause.get("column"), function.get("identity"))
        if not isinstance(event, dict):
            self._error("SA161", "@follows 缺少主要 action", self._file_path(function["relative_path"]), key, "被 @follows 引用的组件必须声明 event action。", "在 A2UI 组件上增加与 interaction 成对的 action.event。", *common)
            return
        if component.get("interaction") != operation:
            self._error("SA162", "action interaction 不匹配", self._file_path(function["relative_path"]), f"layout={component.get('interaction')}, follows={operation}", "@follows operation 必须等于该组件选择的主要 interaction。", "统一 interaction 与 @follows operation。", *common)
        if not str(function.get("owner", "")):
            self._error("SA163", "@follows 目标不是 API", self._file_path(function["relative_path"]), function.get("identity"), "A2UI action 必须触发 class 成员 API。", "把 @follows 写在对应 API 的行为规约中。", clause.get("line"), clause.get("column"))
        elif self.bundle.resolve(event.get("name")) is not function:
            self._error("SA164", "action API 不匹配", self._file_path(function["relative_path"]), event.get("name"), f"action event name 必须精确等于 {function.get('identity')}。", "修正 action.event.name 或将 @follows 移到目标 API。", *common)
        self._validate_action_context(function, clause, element, event)
        if self.bundle.resolve(event.get("name")) is function and component.get("interaction") == operation:
            self._matched_actions[key] += 1

    def _validate_action_context(self, function: dict, clause: dict, element: dict, event: dict) -> None:
        context = event.get("context") if isinstance(event.get("context"), dict) else {}
        expected = {parameter.get("name") for parameter in function.get("parameters") or []}
        actual = set(context)
        common = (clause.get("line"), clause.get("column"), function.get("identity"))
        if expected != actual:
            self._error(
                "SA165", "action context 参数不匹配", self._file_path(function["relative_path"]),
                f"expected={json.dumps(sorted(expected), ensure_ascii=False)}, "
                f"actual={json.dumps(sorted(actual), ensure_ascii=False)}",
                "action context 的字段名必须与 API 形参名完全一致。",
                "补齐缺失参数并删除多余参数；无参数 API 省略 context 或使用空 object。", *common,
            )
        for name, value in context.items():
            if not isinstance(value, dict) or not isinstance(value.get("path"), str):
                continue
            path = value["path"]
            if not path.startswith("/") and element.get("scope") is None:
                self._error("SA166", "非模板 action 使用相对 binding path", self._file_path(function["relative_path"]), f"{name}={path}", "相对 path 只在 children template 作用域内有确定来源。", "普通组件使用同一 surface 的绝对 path，或将 action 与值来源放入同一模板。", *common)
                continue
            scope = None if path.startswith("/") else element.get("scope")
            if (element.get("surface"), scope, path) not in self._binding_sources:
                self._error("SA166", "action binding path 无 UI 来源", self._file_path(function["relative_path"]), f"{name}={path}", "动态参数 path 必须来自同一 surface，且相对 path 必须来自同一模板作用域内的组件值属性。", "为输入/选择组件的预制 value 属性声明相同 binding path，或改用 literal。", *common)

    def _validate_orphan_actions(self) -> None:
        apis = {function.get("identity"): function for function in self.bundle.functions}
        for action in getattr(self, "_ui_actions", []):
            name = (action.get("event") or {}).get("name")
            target = self.bundle.resolve(name)
            if not target:
                self._error("SA167", "action 引用了未知 API", self.bundle.ui_layout_path, name, "action.event.name 必须解析到 bundle 内唯一的 class 成员 API。", "使用完整 ClassName.funcName，或声明对应 API。")
                continue
            count = self._matched_actions[action["key"]]
            if count != 1:
                self._error("SA167", "主要 action 与 @follows 未双向对应", self.bundle.ui_layout_path, f"{action['key']} -> {name}, matches={count}", "每个主要 action 必须恰好对应目标 API 的一条 @follows。", "增加或修正唯一的 @follows selector；删除重复引用。")

    def _validate_predicate_calls(self, function: dict, clause: dict, expression_ir: dict) -> None:
        for call in expression_ir.get("calls") or []:
            name = str(call.get("name", ""))
            if not re.fullmatch(r"[A-Z][A-Z0-9_]*", name):
                continue
            signature = self.predicates[name]
            if not signature:
                self._error(
                    "SA127", "未知谓词", self._file_path(function["relative_path"]), name,
                    "大写函数式谓词必须在独立谓词 skill 中登记。",
                    "选择已有谓词，或按扩充流程登记签名并增加测试。",
                    clause.get("line"), clause.get("column"), function.get("identity"),
                )
                continue
            count = int(call.get("argument_count") or 0)
            valid_arity = count >= signature.minimum and (signature.maximum is None or count <= signature.maximum)
            if not valid_arity:
                expected = f"{signature.minimum}+" if signature.maximum is None else str(signature.minimum)
                if signature.maximum is not None and signature.minimum != signature.maximum:
                    expected = f"{signature.minimum}..{signature.maximum}"
                self._error(
                    "SA128", "谓词参数数量错误", self._file_path(function["relative_path"]), f"{name} 收到 {count} 个参数",
                    f"签名要求 {expected} 个参数。", f"按 `{name}({', '.join(signature.parameters)})` 修正。",
                    clause.get("line"), clause.get("column"), function.get("identity"),
                )
            if name == "CALL":
                arguments = list(call.get("arguments") or [])
                first = str(arguments[0] if arguments else "").strip()
                if self.predicates[first] and first != "CALL":
                    self._error(
                        "SA129", "CALL 隐藏了具体副作用", self._file_path(function["relative_path"]), call.get("source"),
                        f"{first} 已有具体谓词。", f"直接使用 {first}(...)。",
                        clause.get("line"), clause.get("column"), function.get("identity"),
                    )

    def _validate_expression_scope(self, function: dict, clause: dict, expression_ir: dict) -> None:
        self._active_file = function['relative_path']
        file = self._file_path(function["relative_path"])
        owner = function.get("owner")
        fields = self._class_members(owner, "field")
        params = {item.get("name"): item.get("type") for item in function.get("parameters") or []}
        if self.bundle.language == 'go' and function.get('receiver', {}).get('name'):
            receiver = function['receiver']
            params[receiver['name']] = receiver['type']
        local_records = list(function.get("locals") or [])
        locals_ = {item.get("name") for item in local_records}
        local_types = {item.get("name"): item.get("type") for item in local_records}
        common = (clause.get("line"), clause.get("column"), function.get("identity"))
        for access in expression_ir.get("member_accesses") or []:
            base, member = str(access.get("base", "")), access.get("member")
            source = access.get("source")
            if self.bundle.language == 'go' and (base == 'result' or base.startswith('result.')):
                self._validate_go_result_access(function, base, member, file, source, common)
            elif base == "this" and member not in fields:
                self._error("SA140", "this 成员不存在", file, source, f"{owner} 没有该成员。", "修正成员名或补充 class 状态声明。", *common)
            elif base == "result" and self._unit_type(function.get("return_type")):
                self._error("SA141", "Unit 函数引用 result", file, source, "只有非 Unit 函数提供隐式 result。", "删除 result 引用或声明实际返回类型。", *common)
            elif base == "result":
                members = self._members_for_type(function.get("return_type"))
                if members and member not in members:
                    self._error("SA145", "返回类型成员不存在", file, source, f"{function.get('return_type')} 没有 {member}。", "修正 result 成员，或在 struct/Result 适配器中声明它。", *common)
            elif base in params:
                known = self._type_members(params[base], None)
                if known and member not in known:
                    self._error("SA142", "参数类型成员不存在", file, source, f"{params[base]} 没有 {member}。", "修正成员名或参数类型。", *common)
            elif local_types.get(base):
                known = self._type_members(local_types[base], None)
                if known and member not in known:
                    self._error("SA146", "局部变量类型成员不存在", file, source, f"{local_types[base]} 没有 {member}。", "修正成员名或局部变量显式类型。", *common)
            elif base in self._type_names():
                known = self._type_members(base, None)
                if member not in known:
                    self._error("SA143", "类型成员不存在", file, source, f"{base} 没有 {member}。", "修正 ClassName.member 或 StructName.member 引用。", *common)
        if self._unit_type(function.get("return_type")) and any(item.get("name") == "result" for item in expression_ir.get("references") or []):
            self._error("SA141", "Unit 函数引用 result", file, "result", "只有非 Unit 函数提供隐式 result。", "删除 result 引用或声明实际返回类型。", *common)
        for call in expression_ir.get("calls") or []:
            if call.get("name") != "OLD":
                continue
            arguments = list(call.get("arguments") or [])
            argument = str(arguments[0] if arguments else "").strip()
            if argument.startswith("result") or any(argument == local or argument.startswith(f"{local}.") for local in locals_):
                self._error("SA144", "OLD 引用了入口不可见值", file, call.get("source"), "OLD 只能读取函数入口可见的参数或状态。", "改为入口参数、this 状态或 ClassName 状态。", *common)
            else:
                self._validate_old_scope(function, clause, argument, set(params), set(fields))

    def _validate_go_result_access(self, function, base, member, file, source, common):
        values = function.get('return_values', [])
        if not values:
            self._error('SA141', '无返回值函数引用 result', file, source,
                        'Go 声明没有返回值。', '删除 result 引用。', *common)
            return
        path = base.split('.')[1:] + [member]
        if len(values) > 1:
            slots = {f'item{i + 1}': value['type'] for i, value in enumerate(values)}
            first = path.pop(0)
            if first not in slots:
                self._error('SA145', '返回值位置不存在', file, source,
                            f'有效位置为 {", ".join(slots)}。', '按 Go 声明顺序引用 result.itemN。', *common)
                return
            type_name = slots[first]
        else:
            type_name = values[0]['type']
        for name in path:
            known = self._type_members(type_name, None)
            if not known:
                # As with other source adapters, unavailable type definitions are
                # not evidence that a member exists; the independent review remains necessary.
                return
            if name not in known:
                self._error('SA145', '返回类型成员不存在', file, source,
                            f'{type_name} 没有 {name}。', '修正规约中的成员名。', *common)
                return
            type_name = known[name].get('type', '')

    def _validate_old_scope(self, function: dict, clause: dict, argument: str,
                            params: set[str], fields: set[str]) -> None:
        ir = self._parse_expression(argument, self._file_path(function["relative_path"]), clause.get("line") or 1)
        if not ir:
            return
        allowed = params | fields | self._type_names() | {"this"}
        unknown = sorted({
            item.get("name") for item in ir.get("references") or []
            if item.get("name") not in allowed and not re.fullmatch(r"[A-Z][A-Z0-9_]*", str(item.get("name", "")))
        })
        if unknown:
            self._error(
                "SA144", "OLD 引用了入口不可见值", self._file_path(function["relative_path"]), ", ".join(unknown),
                "OLD 只能读取函数入口可见的参数或状态。", "改为入口参数、this 状态或 ClassName 状态。",
                clause.get("line"), clause.get("column"), function.get("identity"),
            )

    def _validate_traces(self) -> None:
        for section in ("pm_to_spec_trace", "spec_to_test_trace"):
            seen = set()
            for entry in self.bundle.traces.get(section) or []:
                parts = self._split_trace(entry)
                if not parts:
                    self._error("SA090", "trace 格式无效", self._manifest_path(), entry, "trace 必须是 left -> right。", "修正来源或目标。")
                    continue
                left, right = parts
                target = right if section == "pm_to_spec_trace" else left
                if not self.bundle.resolve(target):
                    self._error("SA091", "trace 目标未知或歧义", self._manifest_path(), target, "目标必须是当前 API。", "使用脚本输出的 identity。")
                if section == "spec_to_test_trace" and unsafe_relative(right):
                    self._error("SA094", "测试路径越界", self._manifest_path(), right, "必须使用项目相对路径。", "修正路径。")
                if entry in seen:
                    self._error("SA093", "trace 重复", self._manifest_path(), entry, "同一关系只能记录一次。", "删除重复条目。")
                seen.add(entry)

    def _parse_expression(self, expression: str, file: str, line: int) -> dict | None:
        try:
            return self.helper.parse_expression(expression, file=file, line=line)
        except HelperError as error:
            self.diagnostics.append(error.diagnostic)
            return None

    def _type_names(self) -> set[str]:
        if self._type_names_cache is None:
            self._type_names_cache = {
                declaration.get("name") for file in self.bundle.files.values()
                for declaration in file.get("declarations") or [] if declaration.get("kind") in {"class", "struct", "interface"}
            }
        return self._type_names_cache

    def _class_names(self) -> set[str]:
        if self._class_names_cache is None:
            self._class_names_cache = {
                declaration.get("name") for file in self.bundle.files.values()
                for declaration in file.get("declarations") or [] if declaration.get("kind") == "class"
            }
        return self._class_names_cache

    def _class_members(self, name: object, kind: str) -> dict[str, dict]:
        return self._type_members(name, kind, allowed_kinds={"class", "struct", "interface"})

    def _type_members(self, name: object, kind: str | None,
                      allowed_kinds: set[str] | None = None) -> dict[str, dict]:
        allowed_kinds = allowed_kinds or {"class", "struct", "interface"}
        if name is None or not str(name):
            return {}
        nominal = self._nominal_type(name)
        matches = [
            item for file in self.bundle.files.values() for item in file.get("declarations") or []
            if item.get("kind") in allowed_kinds and item.get("name") == nominal
        ]
        if self.bundle.language == 'go':
            active = getattr(self, '_active_file', '')
            # Identical type names in different Go package directories are unrelated.
            matches = [item for item in matches
                       if Path(item.get('relative_path', '')).parent == Path(active).parent]
        local = [item for item in matches if item.get('relative_path') == getattr(self, '_active_file', None)]
        candidates = local or matches
        declaration = candidates[0] if len(candidates) == 1 else None
        return {
            member.get("name"): member for member in (declaration or {}).get("members") or []
            if kind is None or member.get("kind") == kind
        }

    def _members_for_type(self, name: object) -> set[str]:
        declared = self._type_members(name, None)
        return set(declared) if declared else RESULT_ADAPTER_MEMBERS.get(self._nominal_type(name), set())

    def _nominal_type(self, name: object) -> str:
        assert self.bundle.adapter
        return self.bundle.adapter.normalize_type(name)

    def _unit_type(self, name: object) -> bool:
        assert self.bundle.adapter
        return self.bundle.adapter.unit_type(name)

    @staticmethod
    def _find_cycles(graph: dict[Any, set[Any]]) -> list[list[Any]]:
        cycles: list[list[Any]] = []
        visiting: list[Any] = []
        visited: set[Any] = set()

        def walk(node: Any) -> None:
            if node in visiting:
                index = visiting.index(node)
                cycle = visiting[index:] + [node]
                if cycle not in cycles:
                    cycles.append(cycle)
                return
            if node in visited:
                return
            visiting.append(node)
            for target in sorted(graph.get(node, set()), key=str):
                walk(target)
            visiting.pop()
            visited.add(node)

        for node in sorted(graph, key=str):
            walk(node)
        return cycles






    @staticmethod
    def _split_trace(entry: object) -> tuple[str, str] | None:
        if not isinstance(entry, str) or "->" not in entry:
            return None
        parts = [item.strip() for item in entry.split("->", 1)]
        if len(parts) != 2 or not all(parts):
            return None
        return parts[0], logical(parts[1])

    def _manifest_path(self) -> str:
        return str(Path(self.bundle.path) / "specart.yaml")

    def _file_path(self, relative_path: str) -> str:
        return str(self.bundle.project_root / relative_path)

    def _error(self, code: str, title: str, file: str | None, found: object, reason: object,
               suggestion: object, line: int | None = 1, column: int | None = 1,
               related: object = None) -> None:
        related_items = [] if related is None else (list(related) if isinstance(related, (list, tuple, set)) else [related])
        self.diagnostics.append(Diagnostic(
            code=code, title=title, file=file, line=line or 1, column=column or 1,
            found=found, reason=reason, suggestion=suggestion, related=related_items,
        ))
