"""One official adapter evaluation uses one isolated, no-tool OpenCode session."""
from __future__ import annotations

import base64
import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen

from system_one_adapter.providers import Message, ProviderResult
from typesafe_sdk import TypeSafeError


class OpenCodeProvider:
    def __init__(self, *, server: str, directory: str, emit: Callable[[dict], None],
                 provider_id: str = "openai", model_id: str = "gpt-5.6-luna-fast",
                 variant: str = "max", timeout: float = 180):
        parsed = urlsplit(server)
        if (parsed.scheme != "http" or parsed.hostname not in ("localhost", "127.0.0.1", "::1")
                or parsed.username or parsed.password or parsed.path not in ("", "/")
                or parsed.query or parsed.fragment):
            raise ValueError("Use a local OpenCode HTTP server without URL credentials/path")
        if not Path(directory).is_absolute() or not Path(directory).is_dir():
            raise ValueError("directory must be an existing absolute isolated model directory")
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        self.server = server.rstrip("/")
        self.directory = str(Path(directory).resolve())
        self.provider_id, self.model_id, self.variant = provider_id, model_id, variant
        self.model_name = f"{provider_id}/{model_id}"
        self.timeout, self.emit = timeout, emit
        self.session_id: str | None = None
        self.history: list[Message] = []

    def _http(self, method: str, path: str, body: Any = None) -> Any:
        url = f"{self.server}{path}?{urlencode({'directory': self.directory})}"
        headers = {"Content-Type": "application/json"}
        password = os.environ.get("OPENCODE_SERVER_PASSWORD")
        if password:
            user = os.environ.get("OPENCODE_SERVER_USERNAME", "opencode")
            headers["Authorization"] = "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()
        self.emit({"event": "opencode.request", "method": method, "url": url, "body": body})
        request = Request(url, data=None if body is None else json.dumps(body, ensure_ascii=False).encode(),
                          headers=headers, method=method)
        with urlopen(request, timeout=self.timeout) as response:
            result = json.load(response)
        self.emit({"event": "opencode.response", "method": method, "path": path, "body": result})
        return result

    def preflight(self) -> dict:
        # Retain only relevant configuration, not credentials from provider configuration.
        config = self._get_config()
        if config.get("plugin"):
            raise ValueError("Comparison model directory must not load experiment/executor plugins; use --pure")
        options = config.get("provider", {}).get(self.provider_id, {}).get("models", {}).get(self.model_id, {}).get("options", {})
        if self.variant == "max" and options.get("reasoningEffort") != "max":
            raise ValueError("Set reasoningEffort=max for the selected model in the isolated directory")
        summary = {"directory": self.directory, "model": self.model_name, "variant": self.variant,
                   "reasoningEffort": options.get("reasoningEffort"), "plugins": config.get("plugin", [])}
        self.emit({"event": "opencode.configuration", **summary})
        return summary

    def _get_config(self) -> dict:
        # /config may contain API credentials: never write its unfiltered payload to audit.
        url = f"{self.server}/config?{urlencode({'directory': self.directory})}"
        headers = {}
        password = os.environ.get("OPENCODE_SERVER_PASSWORD")
        if password:
            user = os.environ.get("OPENCODE_SERVER_USERNAME", "opencode")
            headers["Authorization"] = "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()
        with urlopen(Request(url, headers=headers), timeout=self.timeout) as response:
            return json.load(response)

    def request(self, messages: list[Message], *, schema: dict, structured: bool) -> ProviderResult:
        if structured:
            raise ValueError("This provider uses prompted JSON, not provider-native structured output")
        if not messages or messages[0].role != "system":
            raise ValueError("Expected the adapter system message")
        self.emit({"event": "adapter.provider_request", "messages": [asdict(m) for m in messages],
                   "schema": schema, "structured": structured})
        if self.session_id is None:
            if any(m.role != "user" for m in messages[1:]):
                raise ValueError("Initial request must contain system followed by user content")
            session = self._http("POST", "/session", {
                "title": "Intent model comparison", "permission": [{"permission": "*", "pattern": "*", "action": "deny"}]})
            self.session_id = session["id"]
            content = "\n\n".join(m.content for m in messages[1:])
        else:
            # Reuse only the same evaluation's exact malformed-output correction history.
            if messages[:-1] != self.history or messages[-1].role != "user":
                raise ValueError("Provider instances cannot be reused across evaluations")
            content = messages[-1].content
        body = {"model": {"providerID": self.provider_id, "modelID": self.model_id},
                "agent": "build", "variant": self.variant, "system": messages[0].content,
                "tools": {"*": False}, "parts": [{"type": "text", "text": content}]}
        session_path = f"/session/{quote(self.session_id, safe='')}"
        try:
            response = self._http("POST", session_path + "/message", body)
        except Exception:
            # A timed-out request may still be executing. Do not silently leave it running.
            try:
                self._http("POST", session_path + "/abort", {})
            except Exception as abort_error:
                self.emit({"event": "opencode.abort_failed", "error": str(abort_error)})
            raise
        if response.get("info", {}).get("error"):
            raise ValueError(f"OpenCode model error: {response['info']['error']}")
        parts = response.get("parts", [])
        if any(part.get("type") in ("tool", "subtask") for part in parts):
            raise ValueError("Comparison response contained a tool/subtask part")
        text = "".join(part.get("text", "") for part in parts if part.get("type") == "text")
        if not text:
            raise ValueError("OpenCode returned no text")
        tokens = response.get("info", {}).get("tokens", {})
        for field in ("input", "output"):
            if type(tokens.get(field)) is not int or tokens[field] < 0:
                raise ValueError(f"Missing/invalid OpenCode token count: {field}")
        self.history = list(messages) + [Message(role="assistant", content=text)]
        return ProviderResult(text=text, input_tokens=tokens["input"], output_tokens=tokens["output"])

    def translate_error(self, error: Exception) -> TypeSafeError:
        return TypeSafeError(str(error))
