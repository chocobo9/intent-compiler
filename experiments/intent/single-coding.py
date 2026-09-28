"""One sourced coding task with an explicitly local four-turn diagnostic overlay."""
import argparse
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def write_new(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def prepare(root, project):
    source = json.loads((root / "source/task.json").read_text(encoding="utf-8-sig"))
    turns = [
        source["problem_statement"],
        "For this change, keep that automatic conversion in place. Only add the FutureWarning and a regression test for the warning. Defer removing the conversion clause. Do not remove the NdarrayMixin class itself.",
        "Actually, drop the 'only add the warning' restriction: include the originally planned 5.2 behavior change as well. To be clear, remove the automatic-conversion clause in the snippet, not the NdarrayMixin class. Keep the regression test and the warning that tells users to wrap data in Column.",
        "To restate the current request, with no further changes: add the FutureWarning recommending Column(data), include the planned 5.2 change removing the automatic-conversion clause, retain NdarrayMixin itself, and keep the regression test for the warning.",
    ]
    harness = "You are the executor for this turn. Do not call tools, inspect the workspace, or modify any file. Read only the latest Compiled Intent delivered in the user message. Briefly restate its current task and each active requirement, distinguishing current work from deferred work. If content is absent, say so. Do not infer requirements from these instructions or previous turns."
    for index, text in enumerate(turns, 1):
        write_new(root / f"inputs/user-{index}.txt", text)
    write_new(root / "inputs/harness.txt", harness)
    write_new(root / "evaluator/expected.json", {
        "written_before_model_run": True,
        "representation_independent": True,
        "turns": [
            {"turn": 1, "must_preserve": ["Astropy Table structured np.array automatic conversion to NdarrayMixin is the subject", "FutureWarning recommending wrapping data in Column", "planned 5.2 behavior: remove the conversion clause so structured array becomes Column", "5.1 backport is optional, not mandatory"], "must_not_invent": ["delete NdarrayMixin class", "HTML issue-template instructions as coding requirements", "require the old snippet behavior as the desired final behavior"]},
            {"turn": 2, "must_preserve": ["same task", "FutureWarning with Column guidance", "regression test for warning", "keep current automatic conversion", "do not delete NdarrayMixin class"], "must_invalidate_as_current_work": ["removal of conversion clause / applying 5.2 behavior in this change"]},
            {"turn": 3, "must_preserve": ["same task", "FutureWarning with Column guidance", "regression test for warning", "include originally planned 5.2 change removing automatic conversion clause", "retain NdarrayMixin class"], "must_invalidate": ["only warning/test scope", "deferral of conversion removal", "keep automatic conversion as final behavior"]},
            {"turn": 4, "must_preserve": ["same effective requirements as turn 3", "no resurrection of deferred-removal restriction", "no extra product requirement"], "note": "Accept semantically equivalent wording; do not require identical IDs or record count. Record structural churn separately."},
        ]
    })
    config = {"$schema": "https://opencode.ai/config.json", "model": "openai/gpt-5.6-luna-fast",
              "provider": {"openai": {"models": {"gpt-5.6-luna-fast": {"options": {"reasoningEffort": "max"}}}}},
              "permission": {"*": "deny"}}
    write_new(root / "compiler-model/opencode.json", config)
    write_new(root / "workspace/opencode.json", {**config, "plugin": [(project / ".opencode/plugins/experiment-runtime.js").as_uri()]})
    hashes = {str(path.relative_to(project)): hashlib.sha256(path.read_bytes()).hexdigest()
              for path in sorted((project / "src").rglob("*.ts"))}
    write_new(root / "manifest.json", {
        "run_id": "single-coding-001", "created_at": datetime.now(timezone.utc).isoformat(),
        "task": source["instance_id"], "source_repo": source["repo"], "base_commit": source["base_commit"],
        "dataset": "princeton-nlp/SWE-bench_Verified", "dataset_revision_observed": "c104f840cc67f8b6eec6f759ebc8b2693d585d4a",
        "retrieval": "datasets-server /rows default/test offset=0 length=15; selected by instance_id; only problem_statement and identity retained, no gold patch/tests",
        "evolving_intent_source_commit": "993d6be9597ac03854b46362ccd647eb1bfd267a",
        "trajectory_origin": "Turn 1 verbatim official SWE problem_statement. Turns 2-4 locally authored by the assistant before model outputs; NOT an official Evolving Intent generated trajectory or paper replication.",
        "scope": "one coding topic, no-tool Compiler diagnostic; no implementation or coding score",
        "executor_history": "same executor session, explicitly re-registered each turn; earlier Compiled Intent remains in history; direct current artifacts are primary evidence",
        "compiler_model": "openai/gpt-5.6-luna-fast", "effort": "max in model options; executor variant max; not provider-wire capture",
        "turn_sha256": [hashlib.sha256(text.encode()).hexdigest() for text in turns],
        "compiler_source_sha256": hashes,
    })


def run(root, project, opencode):
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    run_id = manifest["run_id"]
    logdir = root / "logs"
    logdir.mkdir(exist_ok=False)
    harness = (root / "inputs/harness.txt").read_text(encoding="utf-8")
    session = None
    env = dict(os.environ)
    env.update({"EXPERIMENT_ARM_MODE": "compiler", "EXPERIMENT_OBSERVER_STORE": str(root / "observer-store"),
        "EXPERIMENT_RUN_ID": run_id, "EXPERIMENT_ARM_ID": "compiler", "EXPERIMENT_TASK_ID": manifest["task"],
        "EXPERIMENT_EXECUTOR_WORKSPACE": str(root / "workspace"), "EXPERIMENT_HARNESS_SYSTEM_FILE": str(root / "inputs/harness.txt"),
        "INTENT_COMPILER_STORE": str(root / "compiler-store"), "INTENT_COMPILER_MODEL_DIRECTORY": str(root / "compiler-model"),
        "INTENT_COMPILER_PROVIDER_ID": "openai", "INTENT_COMPILER_MODEL_ID": "gpt-5.6-luna-fast"})
    for turn in range(1, len(manifest["turn_sha256"]) + 1):
        input_file = root / f"inputs/user-{turn}.txt"
        if hashlib.sha256(input_file.read_bytes()).hexdigest() != manifest["turn_sha256"][turn - 1]:
            raise ValueError("Frozen input changed")
        env.update({"EXPERIMENT_OBSERVER_AUTO_REGISTER": "1" if session is None else "0", "EXPERIMENT_TURN_ID": str(turn),
                    "EXPERIMENT_INPUT_IDENTITY": f"{run_id}-turn-{turn}", "EXPERIMENT_USER_INPUT_FILE": str(input_file)})
        if session:
            subprocess.run(["node", str(project / "dist/cli/observer-cli.js"), "register", "--store", str(root / "observer-store"),
                "--run", run_id, "--arm", "compiler", "--task", manifest["task"], "--turn", str(turn), "--session", session,
                "--input-identity", f"{run_id}-turn-{turn}", "--user-input-file", str(input_file),
                "--harness-system-file", str(root / "inputs/harness.txt"), "--executor-workspace", str(root / "workspace")],
                env=env, check=True, capture_output=True)
        command = [opencode, "run", "--model", "openai/gpt-5.6-luna-fast", "--variant", "max", "--format", "json", "--title", run_id]
        if session:
            command += ["--session", session]
        command += [harness]
        with (logdir / f"turn-{turn}.jsonl").open("xb") as output, (logdir / f"turn-{turn}.stderr.txt").open("xb") as errors:
            result = subprocess.run(command, cwd=root / "workspace", env=env, stdout=output, stderr=errors, timeout=240)
        events = [json.loads(line) for line in (logdir / f"turn-{turn}.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
        session = next((event.get("sessionID") for event in events if event.get("sessionID")), session)
        write_new(logdir / f"turn-{turn}.process.json", {"exit_code": result.returncode, "session_id": session})
        print(json.dumps({"turn": turn, "exit_code": result.returncode, "session_id": session}), flush=True)
        history_file = root / f"compiler-store/runs/{run_id}/history.jsonl"
        history = [json.loads(line) for line in history_file.read_text(encoding="utf-8").splitlines()] if history_file.exists() else []
        # Do not keep going after a transport/model failure or invent delivery confirmation.
        if result.returncode or not session or any(event.get("type") == "error" for event in events):
            break
        if not any(event.get("type") == "delivery.reconciliation"
                   and event.get("data", {}).get("inputIdentity") == f"{run_id}-turn-{turn}"
                   and event.get("data", {}).get("status") == "complete" for event in history):
            print("No completed reconciliation found; stopping for inspection.", flush=True)
            break


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "run"))
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--project", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--opencode", default=r"C:\Program Files\nodejs\node_modules\opencode-ai\bin\opencode.exe")
    args = parser.parse_args()
    if args.action == "prepare":
        prepare(args.root.resolve(), args.project.resolve())
    else:
        run(args.root.resolve(), args.project.resolve(), args.opencode)
