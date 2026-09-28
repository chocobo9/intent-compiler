"""Run one frozen evolving-intent case through the current Compiler.

Adapted from `single-coding.py` (2026-09-18) so a case can carry its own
provider/model instead of the hardcoded `openai/gpt-5.6-luna-fast`, and so the
Compiler can go through the transport the project actually uses today
(DashScope strict json_schema for management, OpenCode + DeepSeek for the
executor).  `plan` and `prepare` call no model.

Layout of a case directory (written by `prepare` or by hand, then frozen):
  source/task.json          the real issue (identity + problem_statement)
  inputs/user-N.txt         one user turn per file
  inputs/harness.txt        the executor system prompt (read-only restatement)
  evaluator/expected.json   per-turn expectations, written before any model run
  manifest.json             frozen hashes + provenance + model configuration
  compiler-model/           OpenCode config the Compiler's model directory needs
  workspace/                executor working directory (its opencode.json points
                            at this repository's plugin, which loads dist/)
  compiler-store/ observer-store/ logs/   created by `run`
"""
import argparse
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

REPO_PLUGIN = Path(".opencode/plugins/experiment-runtime.js")


def sha256_path(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def env_file_values(path: Path) -> dict:
    """Read KEY=VALUE lines; the values are never printed."""
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if value:
            values[key.strip()] = value
    return values


def case_turns(root: Path) -> list:
    turns = sorted(root.glob("inputs/user-*.txt"), key=lambda path: int(path.stem.split("-")[1]))
    if not turns:
        raise SystemExit(f"no inputs/user-N.txt under {root}")
    return turns


def prepare(root: Path, project: Path, compiler_provider: str, compiler_model: str,
            compiler_transport: str, executor_model: str) -> None:
    manifest_path = root / "manifest.json"
    if manifest_path.exists():
        raise SystemExit(f"{manifest_path} already exists; frozen cases are not rewritten")
    task = json.loads((root / "source/task.json").read_text(encoding="utf-8"))
    turns = case_turns(root)
    model_config = {
        "$schema": "https://opencode.ai/config.json",
        "model": executor_model,
        "provider": {"deepseek": {"models": {"deepseek-flash": {"options": {"reasoningEffort": "max"}}}}},
        "permission": {"*": "deny"},
    }
    (root / "compiler-model").mkdir(exist_ok=True)
    (root / "workspace").mkdir(exist_ok=True)
    (root / "compiler-model/opencode.json").write_text(
        json.dumps(model_config, indent=2) + "\n", encoding="utf-8", newline="\n")
    (root / "workspace/opencode.json").write_text(
        json.dumps({**model_config, "plugin": [(project / REPO_PLUGIN).as_uri()]}, indent=2) + "\n",
        encoding="utf-8", newline="\n")
    source_hashes = {str(path.relative_to(project)): sha256_path(path)
                     for path in sorted((project / "src").rglob("*.ts"))}
    manifest = {
        "run_id": root.name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "task": task["instance_id"],
        "source_repo": task["repo"],
        "base_commit": task["base_commit"],
        "dataset": task["dataset"],
        "retrieval": task["retrieval"],
        "trajectory_origin": "Turn 1 verbatim official SWE problem_statement. Turns 2..N locally authored and frozen before any model output; NOT an official Evolving Intent generated trajectory.",
        "scope": "one coding topic, no-tool Compiler diagnostic; the executor restates the delivered Compiled Intent and cannot run code. This is not a coding score.",
        "compiler": {"provider": compiler_provider, "model": compiler_model, "transport": compiler_transport},
        "executor": {"model": executor_model},
        "project": str(project),
        "turn_sha256": [sha256_path(path) for path in turns],
        "harness_sha256": sha256_path(root / "inputs/harness.txt"),
        "expected_sha256": sha256_path(root / "evaluator/expected.json"),
        "compiler_source_sha256": source_hashes,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
                             encoding="utf-8", newline="\n")
    print(f"frozen {len(turns)} turns for {task['instance_id']} -> {manifest_path}")


def build_environment(root: Path, project: Path, manifest: dict, turn: int, session, env_file: Path) -> dict:
    env = dict(os.environ)
    env.update(env_file_values(env_file))
    env.update({
        "INTENT_COMPILER_STORE": str(root / "compiler-store"),
        "INTENT_COMPILER_MODEL_DIRECTORY": str(root / "compiler-model"),
        "INTENT_COMPILER_PROVIDER_ID": manifest["compiler"]["provider"],
        "INTENT_COMPILER_MODEL_ID": manifest["compiler"]["model"],
        "INTENT_COMPILER_TRANSPORT": manifest["compiler"]["transport"],
        "INTENT_COMPILER_AGENT": "build",
        "EXPERIMENT_ARM_MODE": "compiler",
        "EXPERIMENT_ARM_ID": "compiler-v2",
        "EXPERIMENT_OBSERVER_STORE": str(root / "observer-store"),
        "EXPERIMENT_RUN_ID": manifest["run_id"],
        "EXPERIMENT_TASK_ID": manifest["task"],
        "EXPERIMENT_TURN_ID": str(turn),
        "EXPERIMENT_INPUT_IDENTITY": f"{manifest['run_id']}-turn-{turn}",
        "EXPERIMENT_USER_INPUT_FILE": str(root / f"inputs/user-{turn}.txt"),
        "EXPERIMENT_HARNESS_SYSTEM_FILE": str(root / "inputs/harness.txt"),
        "EXPERIMENT_EXECUTOR_WORKSPACE": str(root / "workspace"),
        "EXPERIMENT_OBSERVER_AUTO_REGISTER": "1" if session is None else "0",
    })
    return env


def register_command(project: Path, root: Path, manifest: dict, turn: int, session) -> list:
    return ["node", str(project / "dist/cli/observer-cli.js"), "register",
            "--store", str(root / "observer-store"), "--run", manifest["run_id"], "--arm", "compiler-v2",
            "--task", manifest["task"], "--turn", str(turn), "--session", session,
            "--input-identity", f"{manifest['run_id']}-turn-{turn}",
            "--user-input-file", str(root / f"inputs/user-{turn}.txt"),
            "--harness-system-file", str(root / "inputs/harness.txt"),
            "--executor-workspace", str(root / "workspace")]


def plan(root: Path, project: Path, opencode: str) -> None:
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    print(f"run_id   : {manifest['run_id']}")
    print(f"task     : {manifest['task']} ({manifest['source_repo']} @ {manifest['base_commit'][:12]})")
    print(f"compiler : {manifest['compiler']['provider']}/{manifest['compiler']['model']} via {manifest['compiler']['transport']}")
    print(f"executor : {manifest['executor']['model']} (permission '*' = deny, so no tools)")
    print(f"turns    : {len(manifest['turn_sha256'])}")
    print(f"project  : {project}")
    print(f"opencode : {opencode}")
    print(f"stores   : {root / 'compiler-store'} | {root / 'observer-store'} (created by run)")
    print("steps that would spend model calls:")
    step = 0
    for turn in range(1, len(manifest["turn_sha256"]) + 1):
        if turn > 1:
            step += 1
            print(f"  {step}. [register] node dist/cli/observer-cli.js register --turn {turn} --session <previous session> ...")
        step += 1
        print(f"  {step}. [executor] opencode run --model {manifest['executor']['model']} --variant max --format json --title {manifest['run_id']} "
              + ("--session <previous session> " if turn > 1 else "") + "<harness prompt>")
    print("nothing was executed; this is the plan only")


def reconciled(root: Path, run_id: str, turn: int) -> bool:
    """The Observer records the delivery readback as reconciliation.completed.
    Reading the Compiler store for it was wrong twice over: the event lives in
    the Observer store, and the Compiler store is laid out as v2-runs/<id>."""
    path = root / f"observer-store/runs/{run_id}/events.jsonl"
    if not path.exists():
        return False
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if event.get("event_type") == "reconciliation.completed" and str(event.get("turn_id")) == str(turn):
            return True
    return False


def run(root: Path, project: Path, opencode: str, env_file: Path, timeout_sec: int,
        from_turn: int = 1, session: str | None = None) -> None:
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    harness = (root / "inputs/harness.txt").read_text(encoding="utf-8")
    if sha256_path(root / "inputs/harness.txt") != manifest["harness_sha256"]:
        raise SystemExit("frozen harness prompt changed")
    if sha256_path(root / "evaluator/expected.json") != manifest["expected_sha256"]:
        raise SystemExit("frozen expectations changed")
    logdir = root / "logs"
    logdir.mkdir(exist_ok=from_turn > 1)
    for turn in range(from_turn, len(manifest["turn_sha256"]) + 1):
        input_path = root / f"inputs/user-{turn}.txt"
        if sha256_path(input_path) != manifest["turn_sha256"][turn - 1]:
            raise SystemExit(f"frozen input changed: {input_path}")
        env = build_environment(root, project, manifest, turn, session, env_file)
        if session:
            subprocess.run(register_command(project, root, manifest, turn, session), env=env, check=True, capture_output=True)
        command = [opencode, "run", "--model", manifest["executor"]["model"], "--variant", "max",
                   "--format", "json", "--title", manifest["run_id"]]
        if session:
            command += ["--session", session]
        command.append(harness)
        with (logdir / f"turn-{turn}.jsonl").open("xb") as output, (logdir / f"turn-{turn}.stderr.txt").open("xb") as errors:
            result = subprocess.run(command, cwd=root / "workspace", env=env, stdout=output, stderr=errors, timeout=timeout_sec)
        events = [json.loads(line) for line in (logdir / f"turn-{turn}.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
        session = next((event.get("sessionID") for event in events if event.get("sessionID")), session)
        (logdir / f"turn-{turn}.process.json").write_text(
            json.dumps({"exit_code": result.returncode, "session_id": session}, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(json.dumps({"turn": turn, "exit_code": result.returncode, "session_id": session}), flush=True)
        if result.returncode or not session or any(event.get("type") == "error" for event in events):
            print("transport/model failure; stopping for inspection", flush=True)
            break
        if not reconciled(root, manifest["run_id"], turn):
            print("no completed reconciliation for this turn; stopping for inspection", flush=True)
            break


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "plan", "run"))
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--project", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--opencode", default=r"C:\Users\HuaWeiClient\AppData\Roaming\npm\node_modules\opencode-ai\bin\opencode.exe")
    parser.add_argument("--env-file", type=Path, default=Path(__file__).resolve().parents[2] / ".env")
    parser.add_argument("--compiler-provider", default="dashscope")
    parser.add_argument("--compiler-model", default="qwen3.8-flash")
    parser.add_argument("--compiler-transport", default="dashscope")
    parser.add_argument("--executor-model", default="deepseek/deepseek-flash")
    parser.add_argument("--timeout-sec", type=int, default=900)
    parser.add_argument("--from-turn", type=int, default=1)
    parser.add_argument("--session", default=None, help="resume with the session id of the previous turn")
    args = parser.parse_args()
    root = args.root.resolve()
    project = args.project.resolve()
    if args.action == "prepare":
        prepare(root, project, args.compiler_provider, args.compiler_model, args.compiler_transport, args.executor_model)
    elif args.action == "plan":
        plan(root, project, args.opencode)
    else:
        run(root, project, args.opencode, args.env_file, args.timeout_sec, args.from_turn, args.session)
