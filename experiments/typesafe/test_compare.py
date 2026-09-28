import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from compare import evaluate


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.calls = []
        self.responses = []
        self.plugins = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                owner.calls.append(("GET", self.path, None))
                self.reply({"plugin": owner.plugins, "provider": {"openai": {"models": {
                    "gpt-5.6-luna-fast": {"options": {"reasoningEffort": "max"}}
                }, "options": {"apiKey": "DO_NOT_RECORD"}}}})

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                owner.calls.append(("POST", self.path, body))
                if self.path.startswith("/session?"):
                    self.reply({"id": "session-test"})
                elif "/message?" in self.path:
                    response = owner.responses.pop(0)
                    if isinstance(response, str):
                        response = {"info": {"tokens": {"input": 9, "output": 3, "reasoning": 4}},
                                    "parts": [{"type": "text", "text": response}]}
                    self.reply(response)
                else:
                    self.reply(True)

            def reply(self, data):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.case = self.root / "case.json"
        self.case.write_text(json.dumps({"id": "测试", "state": "保留原文：```代码```，不是之前的意思。",
            "questions": {"match": {"type": "noul", "instructions": "Does the text contain code?"}},
            "provenance": {"source": "transport fixture", "preprocessing": "none"}}, ensure_ascii=False), encoding="utf-8")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def run_case(self, **options):
        return evaluate(self.case, self.root / "run", server=f"http://127.0.0.1:{self.server.server_port}",
                        directory=str(self.root), **options)

    def test_real_adapter_http_and_audit(self):
        self.responses = ['{"answers":{"match":0.9}}']
        result = self.run_case()
        self.assertTrue(result["ok"])
        self.assertEqual(result["response"]["answers"]["match"]["noul"], 0.9)
        self.assertEqual((self.root / "run/input.json").read_bytes(), self.case.read_bytes())
        create = next(body for method, path, body in self.calls if method == "POST" and path.startswith("/session?"))
        self.assertEqual(create["permission"][0]["action"], "deny")
        prompt = next(body for _, path, body in self.calls if "/message?" in path)
        self.assertEqual(prompt["variant"], "max")
        self.assertEqual(prompt["tools"], {"*": False})
        self.assertIn("保留原文", prompt["parts"][0]["text"])
        audit = (self.root / "run/events.jsonl").read_text(encoding="utf-8")
        self.assertNotIn("DO_NOT_RECORD", audit)
        self.assertIn('"reasoning": 4', audit)

    def test_retry_keeps_native_session_and_all_attempts(self):
        self.responses = ['not json', '{"answers":{"match":0.7}}']
        result = self.run_case(malformed_retries=1)
        self.assertTrue(result["ok"])
        self.assertEqual(len(result["response"]["debug"]["llm_attempts"]), 2)
        self.assertEqual(result["response"]["usage"]["input_tokens_total"], 18)
        self.assertEqual(sum(path.startswith("/session?") and method == "POST" for method, path, _ in self.calls), 1)
        prompts = [body for _, path, body in self.calls if "/message?" in path]
        self.assertIn("previous response", prompts[1]["parts"][0]["text"])

    def test_terminal_malformed_response_retains_debug(self):
        self.responses = ['not json']
        result = self.run_case()
        self.assertFalse(result["ok"])
        self.assertEqual(len(result["debug"]["llm_attempts"]), 1)
        self.assertTrue((self.root / "run/result.json").exists())

    def test_existing_run_never_overwritten(self):
        self.responses = ['{"answers":{"match":true}}']
        self.assertTrue(self.run_case(mode="discrete")["ok"])
        before = (self.root / "run/result.json").read_bytes()
        calls_before = len(self.calls)
        with self.assertRaises(FileExistsError):
            self.run_case()
        self.assertEqual(len(self.calls), calls_before)
        self.assertEqual((self.root / "run/result.json").read_bytes(), before)

    def test_tool_and_missing_usage_are_not_success(self):
        self.responses = [{"info": {}, "parts": [{"type": "tool"}]}]
        self.assertFalse(self.run_case()["ok"])

    def test_missing_usage_is_not_zero(self):
        self.responses = [{"info": {}, "parts": [{"type": "text", "text": '{"answers":{"match":0.8}}'}]}]
        result = self.run_case()
        self.assertFalse(result["ok"])
        self.assertIn("token count", result["error"])

    def test_plugins_rejected_before_session_creation(self):
        self.plugins = ["executor-plugin"]
        result = self.run_case()
        self.assertFalse(result["ok"])
        self.assertFalse(any(method == "POST" for method, _, _ in self.calls))

    def test_evaluator_answer_not_accepted_in_case(self):
        case = json.loads(self.case.read_text(encoding="utf-8"))
        case["expected"] = True
        self.case.write_text(json.dumps(case), encoding="utf-8")
        with self.assertRaises(ValueError):
            self.run_case()
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
