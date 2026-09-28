import json
import base64
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
        if variant != "medium":
            raise ValueError("This frozen run requires executor variant=medium")
        self._run_variant = variant
        self._dispatch_snapshot_path = Path(dispatch_snapshot_path)
        self._experiment_run_id = experiment_run_id
        self._active_round = 1
        super().__init__(*args, **kwargs)

    @property
    def _install_agent_template_path(self) -> Path:
        return Path(__file__).with_name("install-opencode-patched.sh.j2")

    def create_run_agent_commands(self, instruction: str) -> list[ExecInput]:
        if self.model_name != "openai/gpt-5.6-sol":
            raise ValueError("This frozen run requires openai/gpt-5.6-sol")
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
        await super().run_round(instruction, round_num, environment, context)

    async def run(self, instruction, environment, context) -> None:
        await super().run(instruction, environment, context)
        snapshot_path = self._dispatch_snapshot_path
        if not snapshot_path.is_file():
            raise RuntimeError(
                "Compiler snapshot missing; stopping before the official verifier"
            )
        try:
            snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(
                "Compiler snapshot unreadable; stopping before the official verifier"
            ) from exc
        dispatches = snapshot.get("dispatches")
        if not isinstance(dispatches, list) or not dispatches:
            raise RuntimeError(
                "No persisted Compiler dispatch; stopping before the official verifier"
            )
        print(f"Harbor dispatch gate: {len(dispatches)} persisted dispatch(es)")