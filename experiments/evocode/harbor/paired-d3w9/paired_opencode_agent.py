from pathlib import Path
from harbor.agents.installed.base import ExecInput
from harbor.agents.installed.opencode import OpenCode

class OpenCodeBare(OpenCode):
    def __init__(self, *args, variant: str = "max", **kwargs):
        if variant != "max":
            raise ValueError("Paired run requires executor variant=max")
        self._run_variant = variant
        super().__init__(*args, **kwargs)

    @property
    def _install_agent_template_path(self) -> Path:
        return Path(__file__).with_name("install-opencode-bare.sh.j2")

    def create_run_agent_commands(self, instruction: str) -> list[ExecInput]:
        if self.model_name != "deepseek/deepseek-flash":
            raise ValueError("Paired run requires deepseek/deepseek-flash")
        commands = super().create_run_agent_commands(instruction)
        marker = " run --format=json -- "
        if not commands or marker not in commands[-1].command:
            raise RuntimeError("Unexpected OpenCode CLI command shape")
        commands[-1].command = commands[-1].command.replace(
            marker, f" run --variant={self._run_variant} --format=json -- ", 1
        )
        return commands
