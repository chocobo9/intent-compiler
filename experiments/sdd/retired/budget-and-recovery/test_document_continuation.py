import io
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

import model_guard
from budget import Budget, load_policy


@pytest.mark.parametrize('passes_on', [2, 99])
def test_unfinished_document_continues_same_session_with_finite_budget(tmp_path, monkeypatch, passes_on):
    target = tmp_path / 'change.md'
    policy = load_policy()
    policy['max_document_revisions'] = 2
    policy_file = tmp_path / 'policy.json'
    policy_file.write_text(json.dumps(policy))
    ledger = Budget(tmp_path / 'budget.sqlite', policy)
    ledger.initialize()
    ledger.start_stage('design')
    for key, value in {
        'SDD_STAGE': 'design', 'SDD_BUDGET_DB': str(ledger.path),
        'SDD_BUDGET_POLICY': str(policy_file),
        'SDD_DOCUMENT_TARGETS': json.dumps({'change': {'path': str(target), 'skill': 'change'}}),
    }.items():
        monkeypatch.setenv(key, value)
    calls = []
    def native_call(args, **kwargs):
        calls.append(args)
        target.write_text('Missing required rows\n<!--VERDICT:' + json.dumps(
            {'skill': 'change', 'pass': len(calls) >= passes_on}) + '-->')
        return 0
    class Process:
        def __init__(self, args, **kwargs):
            native_call(args, **kwargs)
            self.stdout = io.StringIO(json.dumps({'type': 'text', 'sessionID': 'ses_same',
                'part': {'text': 'document result'}}) + '\n')
        def wait(self):
            return 0
    monkeypatch.setattr(model_guard.subprocess, 'call', native_call)
    monkeypatch.setattr(model_guard.subprocess, 'Popen', Process)
    result = model_guard.main('native', ['run', '--model', 'm', '--variant', 'v', '--',
        'Write complete document. [SDD_ROLE:change]'], 'm', 'v')
    assert len(calls) == min(passes_on, 3)
    for args in calls[1:]:
        assert args[args.index('--session') + 1] == 'ses_same'
        assert '--model' in args and '--variant' in args
    assert ledger.snapshot()['counts']['document_revisions'] == min(passes_on - 1, 2)
    assert result == (0 if passes_on == 2 else 1)


def test_document_continuation_native_utf8_session_transport(tmp_path):
    target = tmp_path / 'document.md'
    policy_file = tmp_path / 'policy.json'
    policy_file.write_text(json.dumps(load_policy()))
    ledger = Budget(tmp_path / 'budget.sqlite', load_policy())
    ledger.initialize(); ledger.start_stage('design')
    # Python reads a script named 'run', exercising the real guard subprocess
    # boundary without contacting any model/provider.
    (tmp_path / 'run').write_text('''import json, sys
from pathlib import Path
args = sys.argv[1:]
continued = '--session' in args
if continued:
    assert args[args.index('--session') + 1] == 'ses_utf8'
Path('document.md').write_text('中文草稿\\n<!--VERDICT:' + json.dumps({'skill':'change', 'pass':continued}) + '-->', encoding='utf-8')
print(json.dumps({'type':'text', 'sessionID':'ses_utf8', 'part':{'text':'中文完成' if continued else '中文待补齐'}}, ensure_ascii=False), flush=True)
''', encoding='utf-8')
    entry = tmp_path / 'guard.py'
    entry.write_text('import sys\n' + f'sys.path.insert(0, {str(Path(model_guard.__file__).parent)!r})\n'
                     'from model_guard import main\n' +
                     f'sys.exit(main({sys.executable!r}, sys.argv[1:], "m", "v"))\n', encoding='utf-8')
    env = {**os.environ, 'PYTHONUTF8': '1', 'SDD_STAGE': 'design',
           'SDD_BUDGET_DB': str(ledger.path), 'SDD_BUDGET_POLICY': str(policy_file),
           'SDD_DOCUMENT_TARGETS': json.dumps({'change': {'path': str(target), 'skill': 'change'}})}
    result = subprocess.run([sys.executable, str(entry), 'run', '--model', 'm', '--variant', 'v',
        '--', '完成中文文档。\n[SDD_ROLE:change]'], cwd=tmp_path, env=env,
        capture_output=True, encoding='utf-8', timeout=20)
    assert result.returncode == 0, result.stderr
    assert '中文待补齐' in result.stdout and '中文完成' in result.stdout
    assert ledger.snapshot()['counts']['document_revisions'] == 1
    assert 'false' in (tmp_path / 'document-attempts/change/attempt-0.md').read_text(encoding='utf-8')
    assert 'true' in (tmp_path / 'document-attempts/change/attempt-1.md').read_text(encoding='utf-8')
