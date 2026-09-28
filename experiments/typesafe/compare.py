"""Record an official System One adapter evaluation; never mutate Compiler state."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from importlib.metadata import distribution, version
from pathlib import Path

from system_one_adapter import SystemOneAdapterClient
from opencode_provider import OpenCodeProvider

ADAPTER_COMMIT = "adffc2eab300a4fa3c0e92252d4ffd6ceaa53700"


def dump_new(path: Path, value: object) -> None:
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def evaluate(case_file: Path, run_dir: Path, *, server: str, directory: str,
             mode: str = "probabilities", malformed_retries: int = 0,
             normalize: bool = False, provider_factory=OpenCodeProvider) -> dict:
    raw = case_file.read_bytes()
    case = json.loads(raw.decode("utf-8-sig"))
    if not isinstance(case, dict) or set(case) != {"id", "state", "questions", "provenance"}:
        raise ValueError("Case must have exactly id, state, questions, provenance; keep expected answers in a separate evaluator file")
    if not isinstance(case["id"], str) or not case["id"].strip():
        raise ValueError("Case id must be non-empty")
    if not isinstance(case["provenance"], dict) or not case["provenance"]:
        raise ValueError("Record input origin and any preprocessing in provenance")
    if mode not in ("discrete", "probabilities") or malformed_retries not in (0, 1):
        raise ValueError("Use discrete/probabilities and at most one malformed-output retry")
    run_dir.mkdir(parents=True, exist_ok=False)
    (run_dir / "input.json").write_bytes(raw)
    config = {"case_id": case["id"], "input_sha256": hashlib.sha256(raw).hexdigest(),
              "adapter_version": version("system-one-adapter"), "adapter_expected_source_commit": ADAPTER_COMMIT,
              "adapter_install_source": json.loads(distribution("system-one-adapter").read_text("direct_url.json") or "null"),
              "sdk_version": version("typesafe-sdk"), "structured_outputs": False,
              "llm_answer_mode": mode, "normalize_probabilities": normalize,
              "n_retry_malformed_structure": malformed_retries, "transient_retries": 0,
              "purpose": "model comparison only; not a Compiler proposal or Compiled Intent"}
    dump_new(run_dir / "manifest.json", config)
    started = time.perf_counter()
    with (run_dir / "events.jsonl").open("x", encoding="utf-8") as audit:
        def emit(event: dict) -> None:
            audit.write(json.dumps({"elapsed_seconds": time.perf_counter() - started, **event}, ensure_ascii=False) + "\n")
            audit.flush()
            os.fsync(audit.fileno())

        try:
            provider = provider_factory(server=server, directory=directory, emit=emit)
            provider.preflight()
            with SystemOneAdapterClient(structured_outputs=False, llm_answer_mode=mode,
                                        normalize_probabilities=normalize,
                                        n_retry_malformed_structure=malformed_retries) as client:
                response = client.system_one(state=case["state"], questions=case["questions"], model=provider)
            result = {"ok": True, "response": response.model_dump(mode="json")}
        except Exception as error:
            result = {"ok": False, "error_type": type(error).__name__, "error": str(error),
                      "debug": getattr(error, "debug", None)}
        result["wall_seconds"] = time.perf_counter() - started
        emit({"event": "comparison.finished", "ok": result["ok"]})
        dump_new(run_dir / "result.json", result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--server", required=True)
    parser.add_argument("--model-directory", required=True)
    parser.add_argument("--mode", choices=("probabilities", "discrete"), default="probabilities")
    parser.add_argument("--malformed-retries", type=int, choices=(0, 1), default=0)
    parser.add_argument("--normalize-probabilities", action="store_true")
    args = parser.parse_args()
    try:
        result = evaluate(args.case, args.run_dir, server=args.server, directory=args.model_directory,
                          mode=args.mode, malformed_retries=args.malformed_retries,
                          normalize=args.normalize_probabilities)
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 2
    print(json.dumps({"ok": result["ok"], "run_dir": str(args.run_dir)}, ensure_ascii=False))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
