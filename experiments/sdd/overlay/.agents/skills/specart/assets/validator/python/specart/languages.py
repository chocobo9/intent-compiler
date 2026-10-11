from __future__ import annotations

from dataclasses import dataclass, replace


@dataclass(frozen=True, slots=True)
class LanguageCapability:
    implementation_language: str
    spec_extension: str
    spec_adapter: str
    implementation_extensions: tuple[str, ...] | None
    proof_adapter: str | None
    proof_adapter_id: str | None
    spec_language: str
    verification_mode: str
    registered: bool = True

    def record(self) -> dict[str, str | None]:
        return {
            "implementation_language": self.implementation_language,
            "spec_language": self.spec_language,
            "spec_adapter": {"cangjie": "cangjie-std.ast", "arkts": "arkts-typescript", "go": "go-ast"}[self.spec_adapter],
            "proof_adapter": self.proof_adapter_id,
            "verification_mode": self.verification_mode,
        }


_REGISTERED = {
    "go": LanguageCapability(
        implementation_language="go", spec_extension=".go", spec_adapter="go",
        implementation_extensions=(".go",), proof_adapter=None, proof_adapter_id=None,
        spec_language="go", verification_mode="llm-only",
    ),
    "cangjie": LanguageCapability(
        implementation_language="cangjie",
        spec_extension=".cj",
        spec_adapter="cangjie",
        implementation_extensions=(".cj",),
        proof_adapter="cangjie",
        proof_adapter_id="cangjie-std.ast",
        spec_language="cangjie",
        verification_mode="formal-when-enabled",
    ),
    "arkts": LanguageCapability(
        implementation_language="arkts",
        spec_extension=".ets",
        spec_adapter="arkts",
        implementation_extensions=(".ets", ".ts"),
        proof_adapter=None,
        proof_adapter_id=None,
        spec_language="arkts",
        verification_mode="llm-only",
    ),
}


def valid_identifier(language: object) -> bool:
    return isinstance(language, str) and bool(language.strip()) and not any(char.isspace() for char in language)


def registered(language: object) -> bool:
    return isinstance(language, str) and language in _REGISTERED


def base_capability(language: str) -> LanguageCapability:
    capability = _REGISTERED.get(language)
    if capability:
        return capability
    raise ValueError(f"unsupported source language: {language}; supported: {', '.join(_REGISTERED)}")


def effective_capability(language: str, formal_proof: bool) -> LanguageCapability:
    capability = base_capability(language)
    if formal_proof or capability.proof_adapter is None:
        return capability
    return replace(capability, proof_adapter=None, proof_adapter_id=None, verification_mode="llm-only")
