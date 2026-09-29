"""Offline regression for the real Harbor driver; no model or container required."""
import asyncio
import unittest
import tempfile
import shlex
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from intent_opencode_agent import OpenCode, OpenCodePatched
from harbor.agents.installed.base import ExecInput


async def completed_executor(*args, **kwargs):
    pass


class ReturnGateTest(unittest.TestCase):
    def test_capture_failure_preserves_original_execution_error(self):
        agent = object.__new__(OpenCodePatched)
        agent._read_snapshot = lambda **kwargs: None
        async def execute(*, command, **kwargs):
            if "capture-host.py" in command:
                raise OSError("container unavailable")
            return SimpleNamespace(return_code=0)
        async def failed_run(*args, **kwargs):
            raise RuntimeError("original execution failure")
        with patch.object(OpenCode, "run_round", failed_run):
            with self.assertRaisesRegex(RuntimeError, "original execution failure"):
                asyncio.run(agent.run_round("instruction", 1, SimpleNamespace(exec=execute), None))

    def test_command_preserves_quoting_and_enables_pipefail(self):
        agent = object.__new__(OpenCodePatched)
        agent.model_name = "openai/gpt-5.6-sol"
        agent._run_variant = "medium"
        agent._active_round = 1
        agent._experiment_run_id = "test"
        instruction = "literal ' quotes, $(not-a-command), and\nnewlines"
        command = "opencode run --format=json -- " + shlex.quote(instruction) + " | tee /logs/agent/opencode.txt"
        with patch.object(OpenCode, "create_run_agent_commands", return_value=[ExecInput(command=command)]):
            commands = agent.create_run_agent_commands(instruction)
        self.assertEqual(shlex.split(commands[0].command), [
            "bash", "-o", "pipefail", "-c",
            command.replace(" run --format=json -- ", " run --variant=medium --format=json -- "),
        ])
        self.assertEqual(agent._run_command_count, 1)

    def run_gate(self, records, outcomes=True, exit_code="0"):
        snapshot = {
            "dispatches": [{}], "executions": [{"execution_id": "e"}],
            "execution_outcomes": [{"execution_id": "e"}] if outcomes else [],
            "pending_event_ids": [], "management_log": records,
        }
        agent = object.__new__(OpenCodePatched)
        agent._active_round = 2
        agent._executions_before_round = set()
        agent._read_snapshot = lambda **kwargs: snapshot
        with tempfile.TemporaryDirectory() as directory:
            agent.logs_dir = Path(directory)
            agent._run_command_count = 1
            command_dir = agent.logs_dir / "command-0"
            command_dir.mkdir()
            if exit_code is not None:
                (command_dir / "return-code.txt").write_text(exit_code, encoding="utf-8")
            with patch.object(OpenCode, "run", completed_executor):
                asyncio.run(agent.run("", None, None))

    def test_popped_return_is_not_processed(self):
        with self.assertRaisesRegex(RuntimeError, "not processed"):
            self.run_gate([])

    def test_unrelated_accepted_batch_is_not_processed(self):
        with self.assertRaisesRegex(RuntimeError, "not processed"):
            self.run_gate([{"status": "accepted", "trigger_event_ids": ["user"]}])

    def test_failed_return_batch_is_not_processed(self):
        with self.assertRaisesRegex(RuntimeError, "not processed"):
            self.run_gate([{"status": "rejected", "trigger_event_ids": ["e:return"]}])

    def test_accepted_return_requires_execution_outcome(self):
        with self.assertRaisesRegex(RuntimeError, "return missing"):
            self.run_gate([{"status": "accepted", "trigger_event_ids": ["e:return"]}], False)

    def test_accepted_return_passes(self):
        self.run_gate([{"status": "accepted", "trigger_event_ids": ["e:return"]}])

    def test_host_failure_is_not_hidden_by_accepted_return(self):
        with self.assertRaisesRegex(RuntimeError, "failed with exit code 1"):
            self.run_gate([{"status": "accepted", "trigger_event_ids": ["e:return"]}], exit_code="1")

    def test_missing_host_status_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "exit status missing"):
            self.run_gate([{"status": "accepted", "trigger_event_ids": ["e:return"]}], exit_code=None)


if __name__ == "__main__":
    unittest.main()
