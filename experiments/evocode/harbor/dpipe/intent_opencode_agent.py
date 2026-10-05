import json
import base64
import shlex
import shutil
from datetime import datetime, timezone
from pathlib import Path

from harbor.agents.installed.base import ExecInput
from harbor.agents.installed.opencode import OpenCode

# A retry is decided in a return batch, after the executor turn that held the
# returned work has ended; the plugin runs it in a host turn of its own, marked
# by this registration source category (HOST_DISPATCH_SOURCE_CATEGORY).
HOST_DISPATCH_CATEGORY = "host_dispatch"
HOST_DISPATCH_INSTRUCTION = "Run the work the Intent Compiler has pending for this task."
# The compiler runs an Atom version at most twice, so one round needs at most
# one host turn per returned retry; the bound only stops a broken loop.
MAX_HOST_DISPATCH_TURNS = 2


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
        self._host_dispatch = False
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
                    HOST_DISPATCH_CATEGORY if getattr(self, "_host_dispatch", False)
                    else "initial_requirement" if round_num == 1 else "incremental_change"
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
            for turn in range(2, 2 + MAX_HOST_DISPATCH_TURNS):
                if not self._pending_retry_dispatches(self._read_snapshot(required=False)):
                    break
                self._keep_turn_logs(round_num, turn - 1)
                self._host_dispatch = True
                try:
                    await super().run_round(HOST_DISPATCH_INSTRUCTION, round_num, environment, context)
                finally:
                    self._host_dispatch = False
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
        snapshot = self._read_snapshot(required=False)
        if snapshot is None:
            print("ROUND-GATE unresolved: compiler snapshot missing")
            return
        dispatches = snapshot.get("dispatches")
        if not isinstance(dispatches, list) or not dispatches:
            print("ROUND-GATE unresolved: no persisted Compiler dispatch")
            return
        new_executions = self._execution_ids(snapshot) - self._executions_before_round
        if not new_executions:
            print(f"ROUND-GATE unresolved: no executor start persisted for round {self._active_round}")
            return
        returned = {item.get("execution_id") for item in snapshot.get("execution_outcomes", [])}
        if not new_executions.issubset(returned):
            print(f"ROUND-GATE unresolved: executor return missing for round {self._active_round}")
            return
        # advance pops the queue before calling the model; an empty queue is not
        # evidence of successful processing (including after a process exit).
        handled = {
            event_id
            for record in snapshot.get("management_log", [])
            if record.get("status") == "accepted"
            for event_id in record.get("trigger_event_ids", [])
        }
        if any(f"{execution_id}:return" not in handled for execution_id in new_executions):
            print(f"ROUND-GATE unresolved: management has not processed the executor return for round {self._active_round}")
            return
        print(
            f"Harbor dispatch gate: round {self._active_round} started "
            f"{len(new_executions)} execution(s)"
        )

    @staticmethod
    def _pending_retry_dispatches(snapshot):
        """Retry dispatches the compiler offered that no execution has started."""
        if snapshot is None:
            return []
        started = {item.get("dispatch_id") for item in snapshot.get("executions", [])}
        return [item for item in snapshot.get("dispatches", [])
                if item.get("retry_of") and item.get("dispatch_id") not in started]

    def _keep_turn_logs(self, round_num, turn):
        """The next host turn reuses the command log paths; keep this turn's copy."""
        target = self.logs_dir / f"round-{int(round_num)}-turn-{int(turn)}"
        target.mkdir(parents=True, exist_ok=True)
        for item in self.logs_dir.iterdir():
            if item.name.startswith("command-") and item.is_dir():
                shutil.copytree(item, target / item.name, dirs_exist_ok=True)
            elif item.is_file():
                shutil.copy2(item, target / item.name)

    def _check_command_results(self):
        for index in range(self._run_command_count):
            path = self.logs_dir / f"command-{index}" / "return-code.txt"
            if not path.is_file():
                print(f"ROUND-GATE unresolved: executor command {index} exit status missing")
                continue
            code = path.read_text(encoding="utf-8").strip()
            if code != "0":
                # Recorded, not fatal: the round still reaches the official
                # verifier, so every round leaves a saved result.
                print(f"ROUND-GATE unresolved: executor command {index} failed with exit code {code}")

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
