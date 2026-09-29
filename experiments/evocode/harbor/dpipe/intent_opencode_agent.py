import json
import base64
import shlex
from datetime import datetime, timezone
from pathlib import Path

from harbor.agents.installed.base import ExecInput
from harbor.agents.installed.opencode import OpenCode


class OpenCodePatched(OpenCode):
    def __init__(
        self,
        *args,
        variant: str = "medium",
        dispatch_snapshot_path: str,
        experiment_run_id: str,
        **kwargs,
    ):
        if variant not in ("medium", "high", "high-fast", "max"):
            raise ValueError("Unsupported frozen executor variant")
        self._run_variant = variant
        self._dispatch_snapshot_path = Path(dispatch_snapshot_path)
        self._experiment_run_id = experiment_run_id
        self._active_round = 1
        self._executions_before_round = set()
        super().__init__(*args, **kwargs)

    @property
    def _install_agent_template_path(self) -> Path:
        return Path(__file__).with_name("install-opencode-patched.sh.j2")

    def create_run_agent_commands(self, instruction: str) -> list[ExecInput]:
        expected={"openai/gpt-5.6-sol":"medium", "openai/gpt-6-luna-fast":"high-fast", "deepseek/deepseek-flash":"max"}
        if expected.get(self.model_name) != self._run_variant:
            raise ValueError("Executor model/variant does not match a supported frozen profile")
        commands = super().create_run_agent_commands(instruction)
        if not commands:
            raise RuntimeError("OpenCode produced no run command")
        command = commands[-1].command
        marker = " run --format=json -- "
        if marker not in command:
            raise RuntimeError("OpenCode command no longer matches the preflighted CLI shape")
        commands[-1].command = command.replace(
            marker,
            f" run --variant={self._run_variant} --format=json -- ",
            1,
        )
        # The upstream command pipes OpenCode into tee. Preserve the process
        # failure instead of returning tee's successful exit code.
        commands[-1].command = "bash -o pipefail -c " + shlex.quote(commands[-1].command)
        self._run_command_count = len(commands)
        round_num = self._active_round
        produced_at = datetime.now(timezone.utc).isoformat()
        for item in commands:
            env = dict(item.env or {})
            env.update({
                "EXPERIMENT_ROUND": str(round_num),
                "EXPERIMENT_TURN_ID": str(round_num),
                "EXPERIMENT_INPUT_IDENTITY": f"{self._experiment_run_id}:round-{round_num}",
                "EXPERIMENT_INPUT_SOURCE_CATEGORY": (
                    "initial_requirement" if round_num == 1 else "incremental_change"
                ),
                "EXPERIMENT_TASK_OCCURRENCE_ID": (
                    f"d5_w9-dpipe-round-{round_num}"
                ),
                "EXPERIMENT_WORKSPACE_SNAPSHOT_ID": (
                    "d5_w9-r1-empty-workspace" if round_num == 1
                    else f"d5_w9-r{round_num}-workspace-after-round-{round_num - 1}"
                ),
                "EXPERIMENT_INPUT_PRODUCED_AT": produced_at,
            })
            item.env = env
        return commands

    async def run_round(self, instruction, round_num, environment, context) -> None:
        self._active_round = round_num
        self._executions_before_round = self._execution_ids(
            self._read_snapshot(required=False)
        )
        encoded = base64.b64encode(instruction.encode("utf-8")).decode("ascii")
        staged = await environment.exec(command=": > /app/TASK_SPEC.md", cwd="/app")
        if staged.return_code != 0:
            raise RuntimeError(f"Could not initialize current round source: {staged.return_code}")
        for offset in range(0, len(encoded), 6000):
            chunk = encoded[offset:offset + 6000]
            staged = await environment.exec(
                command=f"printf %s {chunk} | base64 -d >> /app/TASK_SPEC.md",
                cwd="/app",
            )
            if staged.return_code != 0:
                raise RuntimeError(f"Could not stage current round source chunk: {staged.return_code}")
        try:
            await super().run_round(instruction, round_num, environment, context)
        finally:
            try:
                captured = await environment.exec(
                    command=f"python3 /opt/intent-data/audit/capture-host.py --round {int(round_num)}",
                    cwd="/app",
                )
                if captured.return_code != 0:
                    print(f"Round {round_num} evidence capture failed: {captured.return_code}")
            except Exception as exc:
                # Container/transport failure while capturing must not replace
                # the execution or management exception that caused shutdown.
                print(f"Round {round_num} evidence capture unavailable: {type(exc).__name__}")

    async def run(self, instruction, environment, context) -> None:
        await super().run(instruction, environment, context)
        self._check_command_results()
        snapshot = self._read_snapshot(required=True)
        dispatches = snapshot.get("dispatches")
        if not isinstance(dispatches, list) or not dispatches:
            raise RuntimeError(
                "No persisted Compiler dispatch; stopping before the official verifier"
            )
        new_executions = self._execution_ids(snapshot) - self._executions_before_round
        if not new_executions:
            raise RuntimeError(
                f"No executor start persisted for round {self._active_round}; "
                "stopping before the official verifier"
            )
        returned = {item.get("execution_id") for item in snapshot.get("execution_outcomes", [])}
        if not new_executions.issubset(returned):
            raise RuntimeError(
                f"Executor return missing for round {self._active_round}; "
                "stopping before the official verifier"
            )
        # advance pops the queue before calling the model; an empty queue is not
        # evidence of successful processing (including after a process exit).
        handled = {
            event_id
            for record in snapshot.get("management_log", [])
            if record.get("status") == "accepted"
            for event_id in record.get("trigger_event_ids", [])
        }
        if any(f"{execution_id}:return" not in handled for execution_id in new_executions):
            raise RuntimeError(
                f"Management has not processed the executor return for round {self._active_round}; "
                "stopping before the official verifier"
            )
        print(
            f"Harbor dispatch gate: round {self._active_round} started "
            f"{len(new_executions)} execution(s)"
        )

    def _check_command_results(self):
        for index in range(self._run_command_count):
            path = self.logs_dir / f"command-{index}" / "return-code.txt"
            if not path.is_file():
                raise RuntimeError(f"Executor command {index} exit status missing")
            code = path.read_text(encoding="utf-8").strip()
            if code != "0":
                raise RuntimeError(
                    f"Executor command {index} failed with exit code {code}; "
                    "stopping before the official verifier"
                )

    def _read_snapshot(self, *, required: bool):
        snapshot_path = self._dispatch_snapshot_path
        if not snapshot_path.is_file():
            if required:
                raise RuntimeError(
                    "Compiler snapshot missing; stopping before the official verifier"
                )
            return None
        try:
            snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(
                "Compiler snapshot unreadable; stopping before the official verifier"
            ) from exc
        if not isinstance(snapshot, dict):
            raise RuntimeError(
                "Compiler snapshot invalid; stopping before the official verifier"
            )
        return snapshot

    @staticmethod
    def _execution_ids(snapshot):
        if snapshot is None:
            return set()
        executions = snapshot.get("executions")
        if not isinstance(executions, list) or any(
            not isinstance(item, dict)
            or not isinstance(item.get("execution_id"), str)
            for item in executions
        ):
            raise RuntimeError(
                "Compiler snapshot executions invalid; stopping before the official verifier"
            )
        return {item["execution_id"] for item in executions}
