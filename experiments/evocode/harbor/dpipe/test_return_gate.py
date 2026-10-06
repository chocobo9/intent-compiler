"""Offline regression for the real Harbor driver; no model or container required."""
import asyncio
import io
import json
import unittest
import tempfile
import shlex
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from intent_opencode_agent import HOST_DISPATCH_INSTRUCTION, OpenCode, OpenCodePatched
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
        with tempfile.TemporaryDirectory() as directory:
            agent.logs_dir = Path(directory)
            with patch.object(OpenCode, "run_round", failed_run):
                with self.assertRaisesRegex(RuntimeError, "original execution failure"):
                    asyncio.run(agent.run_round("instruction", 1, SimpleNamespace(exec=execute), None))

    def run_round_recording(self, leftover):
        """Run one round against a fake container; return its exec commands, the instruction OpenCode got and the record."""
        agent = object.__new__(OpenCodePatched)
        agent._host_dispatch = False
        agent._read_snapshot = lambda **kwargs: None
        commands, received = [], []
        async def execute(*, command, **kwargs):
            commands.append(command)
            removed = leftover and "rm -f /app/TASK_SPEC.md" in command
            return SimpleNamespace(return_code=0, stdout="removed\n" if removed else "absent\n" if "TASK_SPEC" in command else "")
        async def run_round(self, instruction, round_num, environment, context):
            received.append(instruction)
        instruction = "Round text with 'quotes', $(no-subst) and\nnewlines"
        with tempfile.TemporaryDirectory() as directory:
            agent.logs_dir = Path(directory)
            with patch.object(OpenCode, "run_round", run_round):
                asyncio.run(agent.run_round(instruction, 4, SimpleNamespace(exec=execute), None))
            record = json.loads((agent.logs_dir / "round-4-task-spec-cleanup.json").read_text(encoding="utf-8"))
        return commands, received, instruction, record

    def test_round_never_writes_the_instruction_into_the_workspace(self):
        commands, received, instruction, record = self.run_round_recording(leftover=False)
        spec = [command for command in commands if "TASK_SPEC" in command]
        self.assertEqual(len(spec), 1, "only the cleanup touches the old path")
        self.assertNotIn(">", spec[0].replace("then rm", ""), "nothing is written to it")
        self.assertFalse(any("base64" in command or instruction in command for command in commands))
        self.assertEqual(received, [instruction], "the instruction still reaches opencode run unchanged")
        self.assertEqual(record["outcome"], "absent")

    def test_leftover_copy_from_an_old_image_is_removed_and_recorded(self):
        commands, received, instruction, record = self.run_round_recording(leftover=True)
        self.assertEqual(record, {"round": 4, "path": "/app/TASK_SPEC.md", "outcome": "removed"})
        self.assertLess(commands.index(next(c for c in commands if "TASK_SPEC" in c)),
                        len(commands), "cleanup runs inside the round")
        self.assertEqual(received, [instruction])

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

    def run_host_world(self, world, on_turn):
        """Run one round against a snapshot the fake turns change; return the turns taken and the round record."""
        agent = object.__new__(OpenCodePatched)
        agent._host_dispatch = False
        agent._read_snapshot = lambda **kwargs: json.loads(json.dumps(world))
        turns = []
        async def run_round(self, instruction, round_num, environment, context):
            turns.append((instruction, self._host_dispatch))
            (self.logs_dir / "command-0").mkdir(exist_ok=True)
            (self.logs_dir / "command-0" / "stdout.txt").write_text(f"turn {len(turns)}", encoding="utf-8")
            on_turn(world, self._host_dispatch)
        async def execute(*, command, **kwargs):
            return SimpleNamespace(return_code=0)
        with tempfile.TemporaryDirectory() as directory:
            agent.logs_dir = Path(directory)
            with patch.object(OpenCode, "run_round", run_round):
                asyncio.run(agent.run_round("round input", 3, SimpleNamespace(exec=execute), None))
            record = json.loads((agent.logs_dir / "round-3-host-turns.json").read_text(encoding="utf-8"))
            kept = (agent.logs_dir / "round-3-turn-1" / "command-0" / "stdout.txt").read_text(encoding="utf-8") \
                if (agent.logs_dir / "round-3-turn-1").exists() else None
        self.assertFalse(agent._host_dispatch)
        return turns, record, kept

    @staticmethod
    def chain_world(atoms):
        """A plan whose Atoms run in order: each turn runs every unstarted ready offer and unlocks the next Atom."""
        world = {"dispatches": [], "executions": [],
                 "atom_states": [{"task_id": "t", "atom_id": atom, "atom_revision": 0, "status": "ready"} for atom in atoms]}
        def run_offers(world, host_turn):
            if not host_turn:  # the user turn offers and runs the head of the chain
                world["dispatches"].append({"dispatch_id": "d0", "task_id": "t", "atom_id": atoms[0], "atom_revision": 0})
            started = {e["dispatch_id"] for e in world["executions"]}
            for dispatch in [d for d in world["dispatches"] if d["dispatch_id"] not in started]:
                world["executions"].append({"execution_id": f"e-{dispatch['dispatch_id']}", "dispatch_id": dispatch["dispatch_id"]})
                for state in world["atom_states"]:
                    if state["atom_id"] == dispatch["atom_id"]:
                        state["status"] = "legacy"  # returned, accepted
                index = atoms.index(dispatch["atom_id"])
                if index + 1 < len(atoms):  # the return batch unlocks the successor
                    world["dispatches"].append({"dispatch_id": f"d{index + 1}", "task_id": "t", "atom_id": atoms[index + 1], "atom_revision": 0})
        return world, run_offers

    def test_offers_from_return_batches_run_in_further_turns_of_the_same_round(self):
        atoms = ["a1", "a2", "a3", "a4"]
        world, run_offers = self.chain_world(atoms)
        turns, record, kept = self.run_host_world(world, run_offers)
        self.assertEqual(turns, [("round input", False)] + [(HOST_DISPATCH_INSTRUCTION, True)] * 3)
        self.assertEqual([turn["started"] for turn in record["turns"]], [["e-d1"], ["e-d2"], ["e-d3"]])
        self.assertEqual(record["stopped"], "no pending dispatch")
        self.assertEqual(record["cap"], 6, "two executions per Atom version for the three Atoms not yet accepted")
        self.assertEqual(kept, "turn 1", "the first turn's logs are kept before the next turn reuses the paths")

    def test_the_turn_cap_stops_a_round_that_keeps_offering_work(self):
        world = {"dispatches": [{"dispatch_id": "d0", "task_id": "t", "atom_id": "a1", "atom_revision": 0}], "executions": [],
                 "atom_states": [{"task_id": "t", "atom_id": "a1", "atom_revision": 0, "status": "ready"}]}
        def always_more(world, host_turn):
            started = {e["dispatch_id"] for e in world["executions"]}
            for dispatch in [d for d in world["dispatches"] if d["dispatch_id"] not in started]:
                world["executions"].append({"execution_id": f"e-{dispatch['dispatch_id']}", "dispatch_id": dispatch["dispatch_id"]})
            world["dispatches"].append({"dispatch_id": f"d{len(world['dispatches'])}", "task_id": "t", "atom_id": "a1", "atom_revision": 0})
        turns, record, _ = self.run_host_world(world, always_more)
        self.assertEqual(record["cap"], 2)
        self.assertEqual(len(record["turns"]), 2)
        self.assertEqual(record["stopped"], "turn cap reached")
        self.assertEqual(len(turns), 3)

    def test_a_host_turn_that_starts_nothing_ends_the_loop(self):
        world = {"dispatches": [{"dispatch_id": "d0", "task_id": "t", "atom_id": "a1", "atom_revision": 0}], "executions": [],
                 "atom_states": [{"task_id": "t", "atom_id": "a1", "atom_revision": 0, "status": "ready"}]}
        turns, record, _ = self.run_host_world(world, lambda world, host_turn: None)
        self.assertEqual(record["turns"], [{"pending": ["d0"], "started": []}])
        self.assertEqual(record["stopped"], "host turn started no execution")

    def test_stale_unstarted_offers_of_a_superseded_version_are_not_pending(self):
        world = {"dispatches": [{"dispatch_id": "d-old", "task_id": "t", "atom_id": "a1", "atom_revision": 0}], "executions": [],
                 "atom_states": [{"task_id": "t", "atom_id": "a1", "atom_revision": 0, "status": "legacy"},
                                 {"task_id": "t", "atom_id": "a1", "atom_revision": 1, "status": "executing"}]}
        turns, record, _ = self.run_host_world(world, lambda world, host_turn: None)
        self.assertEqual(turns, [("round input", False)])
        self.assertEqual(record["stopped"], "no pending dispatch")

    def test_host_dispatch_turn_registers_its_source_category(self):
        agent = object.__new__(OpenCodePatched)
        agent.model_name = "openai/gpt-5.6-sol"
        agent._run_variant = "medium"
        agent._active_round = 3
        agent._experiment_run_id = "test"
        agent._host_dispatch = True
        command = "opencode run --format=json -- x | tee /logs/agent/opencode.txt"
        with patch.object(OpenCode, "create_run_agent_commands", return_value=[ExecInput(command=command)]):
            commands = agent.create_run_agent_commands("x")
        self.assertEqual(commands[0].env["EXPERIMENT_INPUT_SOURCE_CATEGORY"], "host_dispatch")

    def run_gate(self, records, outcomes=True, exit_code="0"):
        """The gate records a broken round and lets it reach the verifier (e7c6c58); return what it printed."""
        snapshot = {
            "dispatches": [{}], "executions": [{"execution_id": "e"}],
            "execution_outcomes": [{"execution_id": "e"}] if outcomes else [],
            "pending_event_ids": [], "management_log": records,
        }
        agent = object.__new__(OpenCodePatched)
        agent._active_round = 2
        agent._executions_before_round = set()
        agent._read_snapshot = lambda **kwargs: snapshot
        printed = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            agent.logs_dir = Path(directory)
            agent._run_command_count = 1
            command_dir = agent.logs_dir / "command-0"
            command_dir.mkdir()
            if exit_code is not None:
                (command_dir / "return-code.txt").write_text(exit_code, encoding="utf-8")
            with patch.object(OpenCode, "run", completed_executor), redirect_stdout(printed):
                asyncio.run(agent.run("", None, None))
        return printed.getvalue()

    def assertUnresolved(self, printed, reason):
        self.assertRegex(printed, r"ROUND-GATE unresolved: .*" + reason)
        self.assertNotIn("Harbor dispatch gate", printed)

    def test_popped_return_is_not_processed(self):
        self.assertUnresolved(self.run_gate([]), "not processed")

    def test_unrelated_accepted_batch_is_not_processed(self):
        self.assertUnresolved(self.run_gate([{"status": "accepted", "trigger_event_ids": ["user"]}]), "not processed")

    def test_failed_return_batch_is_not_processed(self):
        self.assertUnresolved(self.run_gate([{"status": "rejected", "trigger_event_ids": ["e:return"]}]), "not processed")

    def test_accepted_return_requires_execution_outcome(self):
        self.assertUnresolved(self.run_gate([{"status": "accepted", "trigger_event_ids": ["e:return"]}], False), "return missing")

    def test_accepted_return_passes(self):
        printed = self.run_gate([{"status": "accepted", "trigger_event_ids": ["e:return"]}])
        self.assertIn("Harbor dispatch gate: round 2 started 1 execution(s)", printed)
        self.assertNotIn("ROUND-GATE unresolved", printed)

    def test_host_failure_is_not_hidden_by_accepted_return(self):
        printed = self.run_gate([{"status": "accepted", "trigger_event_ids": ["e:return"]}], exit_code="1")
        self.assertRegex(printed, r"ROUND-GATE unresolved: executor command 0 failed with exit code 1")

    def test_missing_host_status_is_rejected(self):
        printed = self.run_gate([{"status": "accepted", "trigger_event_ids": ["e:return"]}], exit_code=None)
        self.assertRegex(printed, r"ROUND-GATE unresolved: executor command 0 exit status missing")

if __name__ == "__main__":
    unittest.main()
