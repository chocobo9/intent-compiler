"""Read-only, run-bound diagnostics for the two SpecArt Go SA180 subtypes."""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import sys
import datetime as dt
from typing import Any


IGNORED_DIRS = {"__pycache__", ".git"}


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree_sha256(root: Path) -> str:
    root = root.resolve()
    digest = hashlib.sha256()
    if not root.is_dir():
        raise ValueError(f"not a directory: {root}")
    for path in sorted(p for p in root.rglob("*") if p.is_file() and not IGNORED_DIRS.intersection(p.parts)):
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _load_validator(validator_root: Path):
    validator_root = validator_root.resolve()
    python_root = validator_root / "python"
    if not (python_root / "specart" / "cli.py").is_file():
        raise ValueError("validator-root must contain python/specart/cli.py")
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(python_root))
    from specart.cli import CLI  # import the selected run's exact validator
    from specart.source_model import contract_text
    return CLI, contract_text


def _validator_diagnostics(bundle_dir: Path, validator_root: Path) -> dict[str, Any]:
    CLI, _ = _load_validator(validator_root)
    from io import StringIO

    captured: dict[str, Any] = {}

    class CapturingCLI(CLI):
        def _load_and_validate(self, bundle_path):
            bundle, validator = super()._load_and_validate(bundle_path)
            captured["bundle"] = bundle
            captured["validator"] = validator
            return bundle, validator

    stdout, stderr = StringIO(), StringIO()
    exit_code = CapturingCLI.run(["validate", str(bundle_dir), "--format", "json"],
                                 stdout=stdout, stderr=stderr)
    raw_stdout, raw_stderr = stdout.getvalue(), stderr.getvalue()
    try:
        result = json.loads(raw_stdout)
    except json.JSONDecodeError as error:
        return {"execution_status": "invalid_validator_output", "exit_code": exit_code,
                "stdout": raw_stdout, "stderr": raw_stderr,
                "error": f"validator did not return JSON: {error}"}
    if exit_code not in (0, 1) or not isinstance(result, dict) or not isinstance(result.get("diagnostics"), list):
        return {"execution_status": "validator_execution_failed", "exit_code": exit_code,
                "validator_output": result, "stderr": raw_stderr}
    if exit_code == 0 and result.get("valid") is not True:
        return {"execution_status": "inconsistent_validator_result", "exit_code": exit_code,
                "validator_output": result, "stderr": raw_stderr}
    if exit_code == 1 and result.get("valid") is not False:
        return {"execution_status": "inconsistent_validator_result", "exit_code": exit_code,
                "validator_output": result, "stderr": raw_stderr}
    return {"execution_status": "completed", "exit_code": exit_code, "validator_output": result,
            "stderr": raw_stderr, "bundle": captured.get("bundle"),
            "base_validator_success": getattr(captured.get("validator"), "success", None)}


def _is_helper_startup_failure(diagnostic: dict[str, Any]) -> bool:
    if diagnostic.get("code") != "SA103":
        return False
    message = str(diagnostic.get("found", "")).lower()
    return any(marker in message for marker in (
        "winerror 4551", "application control", "code integrity", "permission denied",
        "access is denied", "file not found", "no such file", "not recognized",
        "failed to start", "exec format", "cannot execute", "not permitted",
        "阻止此文件", "找不到指定的文件", "拒绝访问", "无法启动"))


def classify_sa180(bundle, diagnostics: list[dict[str, Any]], contract_text) -> dict[str, Any]:
    """Classify SA180 without changing or filtering the validator's diagnostics."""
    sa180 = [item for item in diagnostics if item.get("code") == "SA180"]
    behavior = []
    type_members = []
    unsupported = []
    selected = getattr(bundle, "selected", []) if bundle is not None else []

    for item in sa180:
        title = str(item.get("title", ""))
        if "规约与源码不一致" in title or "behavior" in title.lower():
            location = item.get("location") or {}
            found = item.get("found")
            matches = [record for record in selected
                       if record.get("source_path") == location.get("file")
                       and (found in (record.get("short_identity"), record.get("identity")))]
            actual = []
            for record in matches:
                summary_entry = record.get("summary_entry")
                if summary_entry is None:
                    continue
                source_text = (record.get("behavior") or {}).get("raw", "")
                summary_text = summary_entry.get("behavior", "")
                if contract_text(str(source_text)) != contract_text(str(summary_text)):
                    diff = difflib.unified_diff(
                        str(source_text).splitlines(), str(summary_text).splitlines(),
                        fromfile="Go source contract", tofile="summary.yaml behavior", lineterm="")
                    actual.append({"identity": record.get("identity"), "source_raw": source_text,
                                   "summary_raw": summary_text, "raw_diff": "\n".join(diff)})
            behavior.append({"validator_diagnostic": item, "normalized_mismatch_records": actual,
                             "classification": "behavior_mismatch" if actual else "unmatched_or_normalized_equal"})
        elif "类型成员" in title or "missing_members" in str(item.get("found", "")):
            type_members.append({"validator_diagnostic": item,
                                 "classification": "type_member_completeness"})
        else:
            unsupported.append({"validator_diagnostic": item, "classification": "unsupported_sa180_subtype"})
    return {"behavior_mismatches": behavior, "type_member_incompleteness": type_members,
            "unsupported_sa180": unsupported}


def _runtime_binding(validator_root: Path) -> dict[str, Any]:
    configured_helper = os.environ.get("SPECART_GO_HELPER")
    configured_manifest = os.environ.get("SPECART_GO_HELPER_MANIFEST")
    configured_go = os.environ.get("SPECART_GO")
    result: dict[str, Any] = {
        "validator_sha256": tree_sha256(validator_root),
        "SPECART_GO_HELPER": configured_helper,
        "SPECART_GO_HELPER_MANIFEST": configured_manifest,
        "SPECART_GO": configured_go,
    }
    if configured_manifest:
        path = Path(configured_manifest).resolve()
        result["helper_manifest_path"] = str(path)
        result["helper_manifest_sha256"] = file_sha256(path) if path.is_file() else None
    if configured_helper:
        path = Path(configured_helper).resolve()
        result["helper_path"] = str(path)
        result["helper_sha256"] = file_sha256(path) if path.is_file() else None
    if configured_go:
        path = Path(configured_go).resolve()
        result["go_toolchain_path"] = str(path)
        result["go_toolchain_sha256"] = file_sha256(path) if path.is_file() else None
    return result


def diagnose(round_id: str, bundle_dir: Path, project_dir: Path, validator_root: Path) -> dict[str, Any]:
    bundle_dir, project_dir, validator_root = [p.resolve() for p in (bundle_dir, project_dir, validator_root)]
    binding = {"round": round_id, "bundle_path": str(bundle_dir), "project_path": str(project_dir),
               "validator_root": str(validator_root), "bundle_sha256": tree_sha256(bundle_dir),
               "project_sha256": tree_sha256(project_dir), **_runtime_binding(validator_root)}
    try:
        run = _validator_diagnostics(bundle_dir, validator_root)
    except Exception as error:
        return {"schema_version": 1, "status": "diagnostic_execution_failed", "binding": binding,
                "error": f"{type(error).__name__}: {error}"}
    if run["execution_status"] != "completed":
        return {"schema_version": 1, "status": run["execution_status"], "binding": binding,
                "validator": {key: value for key, value in run.items() if key not in {"bundle", "validator"}}}
    validator_result = run["validator_output"]
    diagnostics = validator_result["diagnostics"]
    helper_failures = [d for d in diagnostics if _is_helper_startup_failure(d)]
    bundle = run.get("bundle")
    try:
        _, contract_text = _load_validator(validator_root)
        classes = classify_sa180(bundle, diagnostics, contract_text)
    except Exception as error:
        classes = {"behavior_mismatches": [], "type_member_incompleteness": [],
                   "unsupported_sa180": [], "classification_error": f"{type(error).__name__}: {error}"}
    base_success = run.get("base_validator_success")
    status = "helper_environment_blocked" if helper_failures else "diagnosed"
    return {"schema_version": 1, "status": status, "binding": binding,
            "validator": {"exit_code": run["exit_code"], "valid": validator_result.get("valid"),
                          "error_count": validator_result.get("error_count"),
                          "diagnostics": diagnostics, "stderr": run["stderr"],
                          "base_validator_success": base_success,
                          "design_validation_complete": base_success is True,
                          "type_member_sa180_may_be_deferred": base_success is not True,
                          "helper_startup_failures": helper_failures},
            "sa180": classes,
            "interpretation": ("原始校验返回了完整 JSON 诊断；非零退出码代表发现校验问题。"
                               "若基础 validator 未通过，Design.validate 未运行，类型成员 SA180 可能尚未暴露。")}


def parse_go_file(source_path: Path, validator_root: Path) -> dict[str, Any]:
    source_path, validator_root = source_path.resolve(), validator_root.resolve()
    try:
        _load_validator(validator_root)
        from specart.helpers.go import GoHelperClient
        parsed = GoHelperClient(validator_root).parse_file(str(source_path))
        return {"status": "parsed", "source_path": str(source_path),
                "source_sha256": file_sha256(source_path), "declaration_count": len(parsed["declarations"]),
                "declarations": parsed["declarations"], **_runtime_binding(validator_root)}
    except Exception as error:
        return {"status": "parser_failed", "source_path": str(source_path),
                "source_sha256": file_sha256(source_path) if source_path.is_file() else None,
                "error": f"{type(error).__name__}: {error}", **_runtime_binding(validator_root)}


def verify_report(report_path: Path, round_id: str, bundle_dir: Path,
                  project_dir: Path, validator_root: Path) -> dict[str, Any]:
    report_path = report_path.resolve()
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return {"status": "invalid_report", "report_path": str(report_path),
                "error": f"{type(error).__name__}: {error}", "round": round_id}
    current = {"round": round_id, "bundle_path": str(bundle_dir.resolve()),
               "project_path": str(project_dir.resolve()), "validator_root": str(validator_root.resolve()),
               "bundle_sha256": tree_sha256(bundle_dir), "project_sha256": tree_sha256(project_dir),
               **_runtime_binding(validator_root)}
    expected = report.get("binding", {})
    mismatched = [key for key, value in current.items() if expected.get(key) != value]
    result = {"status": "fresh" if not mismatched else "stale", "report_path": str(report_path),
            "report_sha256": file_sha256(report_path), "mismatched_binding_fields": mismatched,
            "report_status": report.get("status"), "round": round_id}
    if result["status"] == "fresh":
        audit = {**result, "verified_at_utc": dt.datetime.now(dt.timezone.utc).isoformat()}
        report_path.with_suffix(report_path.suffix + ".verified.json").write_text(
            json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("diagnose")
    run.add_argument("--round", required=True)
    run.add_argument("--bundle", required=True, type=Path)
    run.add_argument("--project", required=True, type=Path)
    run.add_argument("--validator-root", required=True, type=Path)
    run.add_argument("--report", type=Path)
    check = sub.add_parser("verify-report")
    check.add_argument("--round", required=True)
    check.add_argument("--bundle", required=True, type=Path)
    check.add_argument("--project", required=True, type=Path)
    check.add_argument("--validator-root", required=True, type=Path)
    check.add_argument("--report", required=True, type=Path)
    parse = sub.add_parser("parse-go-file")
    parse.add_argument("--source", required=True, type=Path)
    parse.add_argument("--validator-root", required=True, type=Path)
    args = parser.parse_args(argv)
    if args.command == "diagnose":
        result = diagnose(args.round, args.bundle, args.project, args.validator_root)
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["status"] in {"diagnosed", "helper_environment_blocked"} else 2
    if args.command == "verify-report":
        result = verify_report(args.report, args.round, args.bundle, args.project, args.validator_root)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["status"] == "fresh" else 1
    result = parse_go_file(args.source, args.validator_root)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "parsed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
