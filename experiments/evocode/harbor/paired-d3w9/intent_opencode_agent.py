import json
from datetime import datetime, timezone
from pathlib import Path

from harbor.agents.installed.base import ExecInput
from harbor.agents.installed.opencode import OpenCode


class OpenCodePatched(OpenCode):
    def __init__(
        self,
        *args,
        variant: str = "max",
        dispatch_snapshot_path: str,
        experiment_run_id: str,
        **kwargs,
    ):
        if variant != "max":
            raise ValueError("This frozen run requires executor variant=max")
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
        if self.model_name != "deepseek/deepseek-flash":
            raise ValueError("This frozen run requires deepseek/deepseek-flash")
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
                    f"d3_w9-repro-verify-engine-round-{round_num}"
                ),
                "EXPERIMENT_WORKSPACE_SNAPSHOT_ID": (
                    "d3_w9-r1-empty-workspace" if round_num == 1
                    else f"d3_w9-r{round_num}-workspace-after-round-{round_num - 1}"
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
        await super().run_round(instruction, round_num, environment, context)

    async def run(self, instruction, environment, context) -> None:
        await super().run(instruction, environment, context)
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
        print(
            f"Harbor dispatch gate: round {self._active_round} started "
            f"{len(new_executions)} execution(s)"
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
