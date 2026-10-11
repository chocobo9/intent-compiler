"""Exercise the frozen SpecArt --expr client against one round's Go contracts."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

import yaml


CLAUSE = re.compile(r"^\s*@(requires|ensures|effects|invariants)\s+(.+?)\s*$", re.MULTILINE)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validator-root", required=True, type=Path)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--helper", required=True, type=Path)
    parser.add_argument("--round", required=True)
    args = parser.parse_args()

    validator_root = args.validator_root.resolve()
    bundle = args.bundle.resolve()
    helper = args.helper.resolve()
    summary_path = bundle / "summary.yaml"
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(validator_root / "python"))
    os.environ["SPECART_AST_HELPER"] = str(helper)
    from specart.helpers.cangjie import CangjieHelperClient, HelperError

    summary = yaml.safe_load(summary_path.read_text(encoding="utf-8"))
    expressions: list[tuple[str, str]] = []
    for declaration in summary.get("declarations", []):
        behavior = declaration.get("behavior") or ""
        for match in CLAUSE.finditer(behavior):
            expressions.append((f"{declaration.get('file')}::{declaration.get('signature')}@{match.group(1)}", match.group(2)))

    client = CangjieHelperClient(validator_root)
    calls = 0
    members = 0
    implications = 0
    for label, expression in expressions:
        parsed = client.parse_expression(expression, file=label, line=1)
        if parsed.get("schema_version") != 1 or parsed.get("diagnostics"):
            raise AssertionError(f"invalid helper result for {label}: {parsed}")
        for key in ("normalized", "proof_expression", "position", "calls", "references", "member_accesses"):
            if key not in parsed:
                raise AssertionError(f"helper omitted {key} for {label}")
        calls += len(parsed["calls"])
        members += len(parsed["member_accesses"])
        implications += expression.count("~>")

    # Run the frozen validator CLI on the same bundle with the adapter selected.
    # This confirms the real client and validator can consume the protocol; the
    # original SA180 findings are expected to remain unchanged.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from specart_go_diagnose import _validator_diagnostics

    full_run = _validator_diagnostics(bundle, validator_root)
    if full_run.get("execution_status") != "completed":
        raise AssertionError(f"frozen validator did not complete: {full_run}")
    diagnostics = full_run["validator_output"]["diagnostics"]
    codes: dict[str, int] = {}
    for item in diagnostics:
        code = str(item.get("code", ""))
        codes[code] = codes.get(code, 0) + 1
    helper_errors = {code: codes[code] for code in ("SA101", "SA102", "SA121") if codes.get(code)}
    if helper_errors:
        raise AssertionError(f"adapter/parser diagnostics remain in frozen CLI: {helper_errors}")
    if not codes.get("SA180"):
        raise AssertionError("expected original R6 SA180 findings to remain")

    malformed_rejected = False
    try:
        client.parse_expression("result ==", file="<malformed-probe>", line=1)
    except HelperError as error:
        malformed_rejected = error.diagnostic.code == "SA121"
    if not malformed_rejected:
        raise AssertionError("malformed Go expression was not rejected as SA121")

    fallback_output = {"schema_version": 1, "sentinel": "fallback-preserved"}
    with tempfile.TemporaryDirectory(prefix="specart-helper-fallback-") as temp:
        fallback = Path(temp) / "fallback.sh"
        fallback.write_text(
            "#!/bin/sh\nprintf '%s\\n' '{\"schema_version\":1,\"sentinel\":\"fallback-preserved\"}'\n",
            encoding="utf-8",
        )
        fallback.chmod(0o755)
        environment = {**os.environ, "SPECART_AST_HELPER_FALLBACK": str(fallback)}
        delegated = subprocess.run([str(helper), "sample.cj"], capture_output=True, text=True, env=environment)
        if delegated.returncode != 0 or json.loads(delegated.stdout) != fallback_output:
            raise AssertionError(f"non-expression fallback was not preserved: {delegated}")

    result = {
        "status": "verified",
        "round": args.round,
        "summary_path": str(summary_path),
        "summary_sha256": sha256(summary_path),
        "validator_root": str(validator_root),
        "helper_path": str(helper),
        "helper_sha256": sha256(helper),
        "expression_count": len(expressions),
        "call_count": calls,
        "member_access_count": members,
        "implication_count": implications,
        "malformed_expression_rejected": malformed_rejected,
        "non_expression_fallback_preserved": True,
        "frozen_validator_cli": {
            "execution_status": full_run["execution_status"],
            "exit_code": full_run["exit_code"],
            "error_count": full_run["validator_output"].get("error_count"),
            "diagnostic_counts_by_code": codes,
            "original_sa180_findings_preserved": bool(codes.get("SA180")),
            "helper_parser_diagnostics": helper_errors,
        },
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
