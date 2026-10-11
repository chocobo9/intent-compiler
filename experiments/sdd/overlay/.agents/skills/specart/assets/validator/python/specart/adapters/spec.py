from __future__ import annotations

import re
from pathlib import PurePosixPath
from typing import Any

from ..helpers.arkts import ArktsHelperClient
from ..helpers.go import GoHelperClient
from ..languages import LanguageCapability


class BaseSpecAdapter:
    INTEGER_TYPES = {"Int8", "Int16", "Int32", "Int64", "UInt8", "UInt16", "UInt32", "UInt64", "IntNative", "UIntNative"}




    def parse_declaration(self, path: str, *, relative_path: str) -> dict:
        return self.parse_file(path, relative_path=relative_path)

    def normalize_type(self, name: object) -> str:
        return re.sub(r"<.*>$", "", re.sub(r"^\?", "", str(name))).strip()

    def unit_type(self, name: object) -> bool:
        return self.normalize_type(name) == self._unit_type()

    def compatible_types(self, actual: str, expected: str) -> bool:
        return actual == expected or (actual in self.INTEGER_TYPES and expected in self.INTEGER_TYPES)


    @staticmethod
    def _constructor_type(source: str) -> str | None:
        match = re.match(r"([A-Z][A-Za-z0-9_]*)\s*\(", source)
        return match.group(1) if match else None

    def _unit_type(self) -> str:
        raise NotImplementedError




class CangjieSpecAdapter(BaseSpecAdapter):
    def __init__(self, helper: Any):
        self.helper = helper

    def parse_file(self, path: str, *, relative_path: str) -> dict:
        return self.helper.parse_file(path)

    def literal_type(self, source: str) -> str | None:
        if re.fullmatch(r'".*"', source, re.DOTALL):
            return "String"
        if re.fullmatch(r"r'.*'", source, re.DOTALL):
            return "Rune"
        if source in {"true", "false"}:
            return "Bool"
        if re.fullmatch(r"[-+]?\d+\.\d+(?:[eE][-+]?\d+)?", source):
            return "Float64"
        if re.fullmatch(r"[-+]?\d+", source):
            return "Int64"
        return self._constructor_type(source)

    def _unit_type(self) -> str:
        return "Unit"




class ArktsSpecAdapter(BaseSpecAdapter):
    TYPE_ALIASES = {
        "String": "string", "Bool": "boolean", "Unit": "void",
        "Int8": "number", "Int16": "number", "Int32": "number", "Int64": "number",
        "UInt8": "number", "UInt16": "number", "UInt32": "number", "UInt64": "number",
        "Float32": "number", "Float64": "number",
    }

    def __init__(self, helper: ArktsHelperClient):
        self.helper = helper

    def parse_file(self, path: str, *, relative_path: str) -> dict:
        parsed = self.helper.parse_file(path)
        parent = str(PurePosixPath(relative_path).parent)
        parsed["package"] = None if parent == "." else parent.replace("/", ".")
        return parsed



    def literal_type(self, source: str) -> str | None:
        if re.fullmatch(r'(?:".*"|\'.*\')', source, re.DOTALL):
            return "string"
        if source in {"true", "false"}:
            return "boolean"
        if re.fullmatch(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", source):
            return "number"
        return self._constructor_type(source)

    def normalize_type(self, name: object) -> str:
        normalized = super().normalize_type(name)
        return self.TYPE_ALIASES.get(normalized, normalized)

    def _unit_type(self) -> str:
        return "void"




class GoSpecAdapter(BaseSpecAdapter):
    def __init__(self, validator_root: str):
        self.helper = GoHelperClient(validator_root)

    def parse_file(self, path: str, *, relative_path: str) -> dict:
        return self.helper.parse_file(path)

    def parse_declaration(self, path: str, *, relative_path: str) -> dict:
        return self.helper.parse_file(path, declaration=True)

    def normalize_type(self, name: object) -> str:
        # Preserve containers and numeric widths; only pointers name their base type.
        return str(name).strip().lstrip('*').strip()

    def _unit_type(self) -> str:
        return ''

    def literal_type(self, source: str) -> str | None:
        return None  # Go untyped constants require context; never infer a concrete width.

    def compatible_types(self, actual: str, expected: str) -> bool:
        return actual == expected


def build_adapter(capability: LanguageCapability, *, cangjie_helper: Any, validator_root: str) -> BaseSpecAdapter:
    if capability.spec_adapter == "go":
        return GoSpecAdapter(validator_root)
    if capability.spec_adapter == "arkts":
        return ArktsSpecAdapter(ArktsHelperClient(validator_root))
    return CangjieSpecAdapter(cangjie_helper)
