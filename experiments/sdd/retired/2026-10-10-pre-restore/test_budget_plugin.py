"""Native OpenCode against a local scripted provider: no remote model calls."""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from budget import Budget, load_policy
from process_scope import ProcessScope
from run_r1 import resolve_opencode


def test_installed_opencode_denies_task_before_subagent_launch(tmp_path):
    requests = []
    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            requests.append(payload)
            args = json.dumps({'description': 'Forbidden repair', 'prompt': 'Do not execute', 'subagent_type': 'specart-implement'})
            tool = {'id': 'call_probe', 'type': 'function', 'function': {'name': 'task', 'arguments': args}}
            base = {'id': 'probe-response', 'object': 'chat.completion.chunk', 'created': 1, 'model': 'mock'}
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            chunks = [base | {'choices': [{'index': 0, 'delta': {'role': 'assistant', 'tool_calls': [dict(tool, index=0)]}, 'finish_reason': None}]},
                      base | {'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls'}], 'usage': {'prompt_tokens': 1, 'completion_tokens': 1}}]
            try:
                for chunk in chunks:
                    self.wfile.write(('data: ' + json.dumps(chunk) + '\n\n').encode())
                self.wfile.write(b'data: [DONE]\n\n')
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    here = Path(__file__).parent.resolve()
    policy_file = tmp_path / 'policy.json'
    policy_file.write_text(json.dumps(load_policy()))
    b = Budget(tmp_path / 'budget.sqlite', load_policy())
    b.initialize(); b.start_stage('final'); b.admit_external('final', 'probe')
    config = {'$schema': 'https://opencode.ai/config.json', 'model': 'probe/mock', 'small_model': 'probe/mock',
              'enabled_providers': ['probe'], 'plugin': [(here / 'budget-plugin.mjs').as_uri()],
              'provider': {'probe': {'npm': '@ai-sdk/openai-compatible', 'name': 'Local scripted test',
                  'options': {'baseURL': f'http://127.0.0.1:{server.server_port}/v1', 'apiKey': 'offline-probe'},
                  'models': {'mock': {'name': 'mock', 'limit': {'context': 32000, 'output': 4000}}}}},
              'agent': {'specart-implement': {'mode': 'subagent', 'model': 'probe/mock'}}, 'share': 'disabled'}
    cfg = tmp_path / 'opencode.json'
    cfg.write_text(json.dumps(config))
    env = {**os.environ, 'OPENCODE_CONFIG': str(cfg), 'OPENCODE_DISABLE_PROJECT_CONFIG': '1',
           'OPENCODE_DISABLE_CLAUDE_CODE': '1', 'OPENCODE_DISABLE_AUTOUPDATE': '1',
           'SDD_BUDGET_DB': str(b.path), 'SDD_BUDGET_POLICY': str(policy_file),
           'SDD_BUDGET_SCRIPT': str(here / 'budget.py'), 'SDD_PYTHON': sys.executable,
           'SDD_STAGE': 'final', 'SDD_EXTERNAL_CALL': 'probe'}
    scope = ProcessScope()
    try:
        with (tmp_path / 'probe.log').open('wb') as log:
            proc = scope.start([str(resolve_opencode()), 'run', '--dir', str(tmp_path), '--model', 'probe/mock',
                                '--format', 'json', '--auto', '--', 'Offline tool admission test.'],
                               cwd=tmp_path, env=env, stdout=log, stderr=subprocess.STDOUT)
            import time
            end = time.monotonic() + 30
            while not b.snapshot()['stop_reason'] and proc.poll() is None and time.monotonic() < end:
                time.sleep(.1)
        state = b.snapshot()
        assert state['stop_reason'] == 'implementation_outside_development_stage', (tmp_path / 'probe.log').read_text(errors='replace')[-6000:]
        assert not any(e['kind'] == 'task' for e in state['events'])
        assert requests
    finally:
        assert scope.close()
        server.shutdown(); server.server_close()
