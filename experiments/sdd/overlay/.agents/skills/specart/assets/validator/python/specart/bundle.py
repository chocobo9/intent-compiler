from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

from .adapters import BaseSpecAdapter, build_adapter
from .canonical import sha256, hash_object
from .source_model import declarations, identity, signature, tokens, contract_text, safe_source, protected, preserves
from .diagnostics import Diagnostic
from .helpers.cangjie import CangjieHelperClient, HelperError
from .languages import LanguageCapability, base_capability, effective_capability, valid_identifier, registered
from .paths import files as path_files
from .paths import logical, relative, unsafe_relative


class Bundle:
    SOURCE_ROOT = ""
    DIRECTIVES = ("requires", "ensures", "follows", "updates", "effects", "invariants")
    BEHAVIOR_FIELDS = ("src",)
    SPEC_METADATA_FILES = {"thumbs.db", "desktop.ini"}

    def __init__(self, *, path: str, helper: CangjieHelperClient, validator_root: str | None = None):
        self.path = str(Path(path).resolve())
        self.project_root = Path(self.path).parent
        self.summary = {}
        self.selected = []
        self.helper = helper
        self.validator_root = str(Path(validator_root).resolve()) if validator_root else str(Path(__file__).resolve().parents[2])
        self.manifest: dict[str, Any] = {}
        self.source_files: dict[str, dict] = {}
        self.diagnostics: list[Diagnostic] = []
        self.ui_messages: list[dict] = []
        self.ui_layout_path: str | None = None
        self.adapter: BaseSpecAdapter | None = None
        self._load_manifest()
        root_value = self.manifest.get("project_root", "..")
        if isinstance(root_value, str):
            self.project_root = (Path(self.path) / root_value).resolve()
        self._load_ui_layout()
        self._load_sources()
        self._bind_behaviors()
        self._match_summary()

    @property
    def valid_source_root(self) -> bool:
        return Path(self.path).is_dir() and Path(self.path).name.endswith(".specart")

    @property
    def language(self) -> str:
        value = self.manifest.get("language", "")
        return "" if value is None else str(value)

    @property
    def formal_proof(self) -> bool:
        return self.manifest.get("formal_proof") is True

    @property
    def formal_proof_disabled(self) -> bool:
        base = base_capability(self.language)
        return not self.formal_proof and base.registered and base.proof_adapter is not None

    @property
    def capability(self) -> LanguageCapability:
        return effective_capability(self.language, self.formal_proof)

    @property
    def capability_record(self) -> dict[str, str | None]:
        return self.capability.record()

    @property
    def ir(self) -> dict[str, Any]:
        return {
            **self.capability_record,
            "manifest": self.manifest,
            "files": self.files,
            "content_hash": self.content_hash,
        }

    @property
    def files(self) -> dict[str, dict]:
        return self.source_files

    @property
    def functions(self) -> list[dict]:
        functions = [record for record in self.selected if record.get("kind") == "function"]
        return sorted(functions, key=lambda item: (
            item.get("relative_path", ""),
            int((item.get("position") or {}).get("line") or 0),
            item.get("identity", ""),
        ))

    @property
    def packages(self) -> list[str]:
        return sorted({file.get("package") for file in self.files.values() if file.get("package") is not None})

    @property
    def ui_layout(self) -> Any:
        return self.manifest.get("ui_layout")

    @property
    def traces(self) -> dict:
        value = self.manifest.get("traceability_and_validation", {})
        return value if isinstance(value, dict) else {}

    @property
    def content_hash(self) -> str:
        return hash_object({
            "manifest": self.manifest,
            "summary": [{**entry, "behavior": contract_text(entry.get("behavior", ""))}
                        for entry in self.summary.get("declarations", [])],
            "task_id": self.summary.get("task_id"),
            "ui": self.ui_messages,
        })

    def resolve(self, value: str) -> dict | None:
        if not isinstance(value, str):
            return None
        candidates = [f for f in self.functions if value in {f["identity"], f.get("short_identity")}]
        return candidates[0] if len(candidates) == 1 else None

    def _load_manifest(self) -> None:
        manifest_path = Path(self.path) / "specart.yaml"
        try:
            loaded = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                self.manifest = loaded
                return
            self._error(
                "SA001", "manifest 根节点无效", str(manifest_path),
                "specart.yaml 根节点不是 mapping。", "SpecArt manifest 必须是映射。",
                "按 format-reference.md 重写 specart.yaml。",
            )
            self.manifest = {}
        except FileNotFoundError as error:
            self._error(
                "SA001", "缺少 specart.yaml", str(manifest_path), f"No such file or directory @ rb_sysopen - {manifest_path}",
                "每个 .specart bundle 必须有共享 manifest。", "在 bundle 根目录创建 specart.yaml。",
            )
        except yaml.YAMLError as error:
            mark = getattr(error, "problem_mark", None)
            self._error(
                "SA002", "manifest YAML 无法解析", str(manifest_path), str(error),
                "共享 manifest 必须是有效 YAML。", "修复 YAML 语法。",
                (mark.line + 1) if mark else 1, (mark.column + 1) if mark else 1,
            )

    def _load_ui_layout(self) -> None:
        value = self.manifest.get("ui_layout")
        if value is None:
            return
        if not isinstance(value, str) or not value.strip() or unsafe_relative(value):
            self._error(
                "SA080", "ui_layout 路径无效", str(Path(self.path) / "specart.yaml"), repr(value),
                "ui_layout 必须是 bundle 内单个 JSONL 文件的相对路径。",
                "使用类似 `ui/layout.a2ui.jsonl` 的安全相对路径。",
            )
            return
        candidate = (Path(self.path) / logical(value)).resolve()
        self.ui_layout_path = str(candidate)
        try:
            candidate.relative_to(Path(self.path))
            in_bundle = True
        except ValueError:
            in_bundle = False
        if not in_bundle or not candidate.is_file():
            self._error(
                "SA080", "ui_layout 文件不存在", str(candidate), value,
                "manifest 引用的 A2UI JSONL 文件必须存在于 bundle 内。",
                "创建该文件或修正 ui_layout 路径。",
            )
            return
        for line_number, raw in enumerate(candidate.read_text(encoding="utf-8").splitlines(), 1):
            if not raw.strip():
                continue
            try:
                message = json.loads(raw)
            except json.JSONDecodeError as error:
                self._error(
                    "SA080", "A2UI JSONL 无法解析", str(candidate), str(error),
                    "JSONL 每个非空行必须是完整 JSON object。", "修复该行 JSON 语法。",
                    line_number, 1,
                )
                continue
            if not isinstance(message, dict):
                self._error(
                    "SA080", "A2UI 消息无效", str(candidate), type(message).__name__,
                    "JSONL 每个非空行必须是一个 A2UI message object。", "将该行改为 JSON object。",
                    line_number, 1,
                )
                continue
            message["__specart_line"] = line_number
            self.ui_messages.append(message)

    def _load_sources(self) -> None:
        summary_path = Path(self.path) / "summary.yaml"
        try:
            self.summary = yaml.safe_load(summary_path.read_text(encoding="utf-8"))
            if not isinstance(self.summary, dict) or set(self.summary) != {"task_id", "declarations"}:
                raise ValueError("summary requires task_id and declarations")
            if not isinstance(self.summary["task_id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]+", self.summary["task_id"]):
                raise ValueError("invalid task_id")
            entries = self.summary["declarations"]
            if not isinstance(entries, list) or not entries:
                raise ValueError("summary declarations must be a nonempty list")
            for entry in entries:
                if not isinstance(entry, dict) or not {"file", "signature"} <= set(entry):
                    raise ValueError("each declaration requires file and signature; behavior is required when the source has a contract")
                if set(entry) - {"file", "signature", "behavior", "owner", "previous_signature"} or not all(isinstance(v, str) for v in entry.values()):
                    raise ValueError("invalid summary declaration fields")
            if not self.project_root.is_dir():
                raise ValueError("project directory does not exist")
            if not registered(self.language):
                raise ValueError(f"unsupported source language: {self.language}")
            self.adapter = build_adapter(self.capability, cangjie_helper=self.helper, validator_root=self.validator_root)
            for name in sorted({entry["file"] for entry in entries}):
                source = safe_source(self.project_root, name)
                if source.suffix not in self.capability.implementation_extensions:
                    raise ValueError(f"wrong source extension: {name}")
                parsed = self.adapter.parse_file(str(source), relative_path=name)
                parsed["relative_path"] = name
                parsed["source"] = source.read_text(encoding="utf-8")
                for record in declarations(parsed):
                    record["relative_path"] = name
                    record["source_path"] = str(source)
                    record["short_identity"] = ".".join(p for p in (record.get("owner"), record.get("name")) if p)
                    record["identity"] = identity(name, record)
                    record["package"] = parsed.get("package")
                parsed["functions"] = [d for d in declarations(parsed) if d.get("kind") == "function"]
                self.source_files[name] = parsed
        except HelperError as error:
            self.diagnostics.append(error.diagnostic)
        except (OSError, ValueError, TypeError, yaml.YAMLError) as error:
            self._error("SA003", "源码规格无法读取", str(summary_path), str(error),
                        "需要有效 summary、项目目录及显式支持的源码语言。", "修正具体错误；不回退到其他语言。")

    def _match_summary(self) -> None:
        seen = set()
        seen_declarations = set()
        entries = self.summary.get("declarations", []) if isinstance(self.summary, dict) else []
        for entry in entries if isinstance(entries, list) else []:
            if not isinstance(entry, dict) or not isinstance(entry.get("signature"), str):
                continue
            file = self.files.get(entry.get("file"), {})
            type_signature = None
            if self.adapter and ('{' in entry['signature'] or self.language == 'go'):
                try:
                    with tempfile.TemporaryDirectory(prefix='specart-signature-') as directory:
                        path = Path(directory) / Path(entry['file']).name
                        path.write_text(entry['signature'], encoding='utf-8')
                        parsed = self.adapter.parse_declaration(str(path), relative_path=entry['file'])
                        roots = parsed.get('declarations') or []
                        if len(roots) == 1 and ('members' in roots[0] or (self.language == 'go' and roots[0].get('kind') == 'function')):
                            type_signature = roots[0]
                            list(declarations(parsed, owner=entry.get('owner', '')))
                            type_signature['owner'] = entry.get('owner', '')
                except (OSError, HelperError):
                    pass  # Normal unique-match diagnostic below includes the requested signature.
            matches = [d for d in declarations(file)
                       if d.get("owner", "") == entry.get("owner", "")
                       and ((type_signature is not None and preserves(protected(type_signature), protected(d)))
                            or (not d.get('members') and tokens(signature(d)) == tokens(entry["signature"]))
                            or (d.get("kind") == "field" and preserves(
                                {"owner": d.get("owner", ""), "signature": tokens(entry["signature"])}, protected(d))))]
            if len(matches) != 1:
                header = signature(type_signature) if type_signature is not None else entry['signature']
                types = [d for d in declarations(file) if 'members' in d
                         and d.get('owner', '') == entry.get('owner', '')
                         and tokens(signature(d)) == tokens(header)]
                if len(types) == 1:
                    self._error('SA050', 'summary 类型结构无法匹配', entry['file'], entry['signature'],
                                '已定位到类型，但 signature 未提供匹配的完整成员结构。',
                                '填写完整类型声明及设计成员（含嵌套成员），排除成员函数实现体；不能只填写类头。')
                    continue
                self._error("SA050", "summary 声明无法唯一定位", entry.get("file", ""),
                            entry["signature"], f"matches={len(matches)}", "修正文件、所属作用域和完整签名；类型须包含设计成员结构，排除成员函数实现体。")
                continue
            record = matches[0]
            if id(record) in seen_declarations:
                self._error("SA050", "summary 声明重复", record["source_path"], record["identity"], "每个声明只能列一次。", "删除重复条目。")
                continue
            seen_declarations.add(id(record))
            if record.get('kind') == 'field':
                record['identity'] = identity(entry['file'], {**record, 'signature':entry['signature']})
            seen.add(record["identity"])
            behavior = record.get("behavior") or {}
            if contract_text(entry.get("behavior", "")) != contract_text(behavior.get("raw", "")):
                self._error("SA180", "summary 规约与源码不一致", record["source_path"], record["short_identity"], "汇总必须记录源码完整规约块。", "由设计角色修正 summary 或源码。")
            metadata = record.get('task_metadata', {})
            if metadata.get("changedBy") != self.summary.get("task_id"):
                self._error("SA181", "声明任务归属不匹配", record["source_path"], metadata.get("changedBy"), "声明注释中的 changedBy 必须等于 summary task_id，不要求为此增加行为块。", "由设计角色修正任务标记。")
            record["summary_entry"] = entry
            if type_signature is not None:
                record['summary_structure'] = protected(type_signature)
            self.selected.append(record)
        for file in self.files.values():
            for record in declarations(file):
                if record.get('task_metadata', {}).get("changedBy") == self.summary.get("task_id") and record["identity"] not in seen:
                    self._error("SA182", "本任务声明未收录", record["source_path"], record["short_identity"],
                                "当前任务规约必须与 summary 双向对应。", "由设计 agent 补齐 summary。")

    def _bind_behaviors(self) -> None:
        for file in self.files.values():
            lines = str(file.get("source", "")).splitlines(keepends=True)
            for record in declarations(file):
                comment = self._nearest_behavior_comment(file, record, lines)
                associated = self._associated_comments(file, record, lines)
                contracts = [c for c in associated if '@behavior' in c.get('value', '')]
                if len(contracts) > 1 or (contracts and associated[0] is not contracts[0]):
                    self._error('SA124', '规约注释块必须唯一且在最前', record['source_path'], record['short_identity'],
                                '关联注释最前面只能有一个完整有效规约块。', '由设计角色合并规约；普通注释放在后面。')
                record["behavior"] = self._parse_behavior(comment, record) if comment else None
                record['task_metadata'] = self._declaration_metadata(associated, record)
                record["branches"] = []

    def _declaration_metadata(self, comments: list[dict], record: dict) -> dict:
        metadata = {}
        for comment in comments:
            for offset, line in enumerate(str(comment.get('value', '')).splitlines()):
                match = re.fullmatch(r'@(changedBy|pendingUpdate)(?:\s+(.*))?', self._clean_comment_line(line))
                if not match:
                    continue
                key, value = match.group(1), (match.group(2) or '').strip()
                if key in metadata or (key == 'changedBy' and not re.fullmatch(r'[A-Za-z0-9_-]+', value)) or (key == 'pendingUpdate' and value):
                    self._error('SA181', '声明任务标记重复或无效', record.get('source_path', self.path), key,
                                'changedBy 只接受一个任务 ID；pendingUpdate 不带参数；各标记只能出现一次。',
                                '修正声明关联注释中的任务标记。', int(comment.get('line') or 1) + offset)
                metadata[key] = value if key == 'changedBy' else True
        return metadata

    @staticmethod
    def _nearest_behavior_comment(file: dict, function: dict, source_lines: list[str]) -> dict | None:
        candidates = [c for c in Bundle._associated_comments(file, function, source_lines) if '@behavior' in c.get('value', '')]
        return candidates[-1] if candidates else None

    @staticmethod
    def _associated_comments(file: dict, function: dict, source_lines: list[str]) -> list[dict]:
        line = int((function.get("position") or {}).get("line") or 0)
        candidates = []
        for comment in file.get("comments", []):
            value = comment.get("value", "")
            end = int(comment["line"]) + value.count("\n")
            if end >= line:
                continue
            column = int((function.get('position') or {}).get('column') or 1)
            prefix = source_lines[line - 1][:column - 1] if 0 < line <= len(source_lines) else ''
            between = "".join(source_lines[end:line - 1]) + prefix
            # Ordinary comments and declaration annotations may follow the contract.
            between = re.sub(r"/\*[\s\S]*?\*/|//[^\n]*", "", between)
            between = re.sub(r"(?m)^\s*@[\w.]+(?:\([^\n]*\))?\s*$", "", between)
            if not between.strip():
                candidates.append(comment)
        return sorted(candidates, key=lambda c: (c['line'], c.get('column', 0)))


    def _parse_behavior(self, comment: dict, function: dict) -> dict:
        raw = str(comment.get("value", ""))
        natural_index = raw.find("行为规约:")
        behavior_index = raw.find("@behavior")
        has_natural = natural_index >= 0
        has_behavior = behavior_index >= 0
        ordered = has_natural and has_behavior and natural_index < behavior_index
        natural = ""
        if ordered:
            natural = "\n".join(
                self._clean_comment_line(line)
                for line in raw[natural_index + len("行为规约:"):behavior_index].splitlines()
            ).strip()
        clauses: list[dict] = []
        src_entries: list[dict] = []
        current: dict | None = None
        in_behavior = False
        for index, line in enumerate(raw.splitlines()):
            stripped = self._clean_comment_line(line)
            if stripped == "@behavior":
                in_behavior = True
                continue
            if not in_behavior or not stripped:
                continue
            match = re.fullmatch(r"@([A-Za-z_]+)(?:\s+(.*))?", stripped)
            if match:
                if current:
                    clauses.append(current)
                current = None
                entry = {
                    "value": (match.group(2) or "").strip(),
                    "line": int(comment.get("line") or 0) + index,
                    "column": line.find("@") + 1,
                }
                directive = match.group(1)
                if directive in {"changedBy", "pendingUpdate"}:
                    continue
                if directive == "src":
                    src_entries.append(entry)
                else:
                    current = {
                        "line": entry["line"], "column": entry["column"],
                        "directive": directive, "expression": entry["value"],
                    }
                if directive not in self.DIRECTIVES + self.BEHAVIOR_FIELDS:
                    self._error(
                        "SA122", "未知行为 directive", function["source_path"], f"@{directive}",
                        "行为规约只允许 SpecArt 1.1 directive。",
                        f"使用 {', '.join('@' + item for item in self.BEHAVIOR_FIELDS + self.DIRECTIVES)}。",
                        entry["line"], entry["column"], function.get("identity"),
                    )
            elif current:
                current["expression"] = " ".join(item for item in (current["expression"], stripped) if item)
            else:
                self._error(
                    "SA123", "结构化行为区包含自由文本", function["source_path"], stripped,
                    "@behavior 之后只能包含 directive clause。", "将自然语言移到 @behavior 之前。",
                    int(comment.get("line") or 0) + index, 1, function.get("identity"),
                )
        if current:
            clauses.append(current)
        return {
            "raw": raw,
            "line": comment.get("line"),
            "natural_language": natural,
            "has_natural_marker": has_natural,
            "has_behavior_marker": has_behavior,
            "ordered": bool(ordered),
            "src": src_entries[0]["value"] if src_entries else None,
            "src_entries": src_entries,
            "clauses": clauses,
        }

    @staticmethod
    def _clean_comment_line(line: str) -> str:
        value = line.strip()
        value = re.sub(r"^//+\s?", "", value)
        value = re.sub(r"^/\*+", "", value)
        value = re.sub(r"\*/$", "", value)
        value = re.sub(r"^\*\s?", "", value)
        return value.strip()

    def _error(self, code: str, title: str, file: str, found: object, reason: str,
               suggestion: str, line: int = 1, column: int = 1, related: object = None) -> None:
        self.diagnostics.append(Diagnostic(
            code=code, title=title, file=file, line=line or 1, column=column or 1,
            found=found, reason=reason, suggestion=suggestion,
            related=[] if related is None else [related],
        ))
