"""Regression checks for the Harbor adapters' per-round execution gate."""

import asyncio
import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


HERE = Path(__file__).parent


class FakeOpenCode:
    def __init__(self, *args, model_name, **kwargs):
        self.model_name = model_name
        self.on_run = lambda: None

    async def run_round(self, instruction, round_num, environment, context):
        await self.run(instruction, environment, context)

    async def run(self, instruction, environment, context):
        self.on_run()


class FakeEnvironment:
    async def exec(self, **kwargs):
        return SimpleNamespace(return_code=0)


def load_adapter(directory):
    base = types.ModuleType("harbor.agents.installed.base")
    base.ExecInput = type("ExecInput", (), {})
    opencode = types.ModuleType("harbor.agents.installed.opencode")
    opencode.OpenCode = FakeOpenCode
    modules = {
        "harbor": types.ModuleType("harbor"),
        "harbor.agents": types.ModuleType("harbor.agents"),
        "harbor.agents.installed": types.ModuleType("harbor.agents.installed"),
        "harbor.agents.installed.base": base,
        "harbor.agents.installed.opencode": opencode,
    }
    path = HERE / directory / "intent_opencode_agent.py"
    spec = importlib.util.spec_from_file_location(f"test_{directory}_adapter", path)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(module)
    return module.OpenCodePatched


class DispatchGateTest(unittest.TestCase):
    def test_history_does_not_qualify_a_failed_round(self):
        for directory, model, variant in (
            ("dpipe", "openai/gpt-5.6-sol", "medium"),
            ("paired-d3w9", "deepseek/deepseek-flash", "max"),
        ):
            with self.subTest(directory=directory), tempfile.TemporaryDirectory() as tmp:
                snapshot = Path(tmp) / "snapshot.json"
                snapshot.write_text(
                    json.dumps({
                        "dispatches": [{"dispatch_id": "dispatch-1"}],
                        "executions": [{"execution_id": "execution-1"}],
                    }),
                    encoding="utf-8",
                )
                adapter = load_adapter(directory)(
                    model_name=model,
                    variant=variant,
                    dispatch_snapshot_path=str(snapshot),
                    experiment_run_id="test-run",
                )
                with self.assertRaisesRegex(RuntimeError, "round 2"):
                    asyncio.run(adapter.run_round("instruction", 2, FakeEnvironment(), None))

    def test_dispatch_without_executor_start_does_not_qualify(self):
        for directory, model, variant in (
            ("dpipe", "openai/gpt-5.6-sol", "medium"),
            ("paired-d3w9", "deepseek/deepseek-flash", "max"),
        ):
            with self.subTest(directory=directory), tempfile.TemporaryDirectory() as tmp:
                snapshot = Path(tmp) / "snapshot.json"
                adapter = load_adapter(directory)(
                    model_name=model,
                    variant=variant,
                    dispatch_snapshot_path=str(snapshot),
                    experiment_run_id="test-run",
                )

                def dispatch_without_start():
                    snapshot.write_text(
                        json.dumps({
                            "dispatches": [{"dispatch_id": "dispatch-1"}],
                            "executions": [],
                        }),
                        encoding="utf-8",
                    )

                adapter.on_run = dispatch_without_start
                with self.assertRaisesRegex(RuntimeError, "round 1"):
                    asyncio.run(adapter.run_round("instruction", 1, FakeEnvironment(), None))

    def test_reusing_a_dispatch_with_a_new_execution_qualifies(self):
        for directory, model, variant in (
            ("dpipe", "openai/gpt-5.6-sol", "medium"),
            ("paired-d3w9", "deepseek/deepseek-flash", "max"),
        ):
            with self.subTest(directory=directory), tempfile.TemporaryDirectory() as tmp:
                snapshot = Path(tmp) / "snapshot.json"
                state = {
                    "dispatches": [{"dispatch_id": "dispatch-1"}],
                    "executions": [{"execution_id": "execution-1"}],
                }
                snapshot.write_text(json.dumps(state), encoding="utf-8")
                adapter = load_adapter(directory)(
                    model_name=model,
                    variant=variant,
                    dispatch_snapshot_path=str(snapshot),
                    experiment_run_id="test-run",
                )

                def start_execution():
                    state["executions"].append({"execution_id": "execution-2"})
                    snapshot.write_text(json.dumps(state), encoding="utf-8")

                adapter.on_run = start_execution
                asyncio.run(adapter.run_round("instruction", 2, FakeEnvironment(), None))


if __name__ == "__main__":
    unittest.main()
