"""Exercise the actual bridge in a separate process with a non-executing adapter."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from ic_bridge import adapter_digest


def fixture(tmp_path):
    adapter = tmp_path / 'adapter'
    adapter.mkdir()
    (adapter / 'run_results.py').write_text("def source_hash(path): return 'baseline-digest'\n"
        "def prd_check_summary(run): return {'state': 'NEED_MANUAL_DECISION', 'unresolved': 1, 'open_gaps': [{'title': 'GAP-004', 'text': 'seed'}]}\n",
        encoding='utf-8')
    (adapter / 'run_r1.py').write_text('''from pathlib import Path
import json,hashlib,shutil
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write_json(p,d): p.write_text(json.dumps(d),encoding='utf-8')
def run_directory(root): return root/'runs/r4'
def freeze(number,baseline,requirement,sdd):
 root=Path(baseline).parent/'prepared-run'
 root.mkdir()
 shutil.copy2(requirement,root/'requirement.md')
 run=run_directory(root)
 (run/'repos/main').mkdir(parents=True)
 (run/'repos/main/.verdict.md').write_text('internal evidence',encoding='utf-8')
 return root
''', encoding='utf-8')
    baseline = tmp_path / 'baseline'
    baseline.mkdir()
    ref = {'id': 'ci-4', 'revision': 1, 'digest': 'ci-digest'}
    request = tmp_path / 'request.json'
    request.write_text(json.dumps({'adapter': str(adapter), 'sdd_source': str(tmp_path), 'round': 4,
        'run': {'run_id': 'sdd-4', 'event_id': 'input-4', 'ci_ref': ref,
                'baseline': {'path': str(baseline), 'digest': 'baseline-digest'},
                'config_digest': adapter_digest(adapter)},
        'delivery': {'profile': 'ci-sdd-v1', 'event_id': 'input-4', 'ref': ref,
                     'draft': {'decision': 'deliver'}, 'text': 'Selected CI only\n中文\n'}}), encoding='utf-8')
    data = json.loads(request.read_text(encoding='utf-8'))
    body = {k: v for k, v in data['delivery'].items() if k != 'ref'}
    digest = 'sha256:' + hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    data['delivery']['ref']['digest'] = digest
    data['run']['ci_ref']['digest'] = digest
    request.write_text(json.dumps(data), encoding='utf-8')
    return request


def invoke(mode, request):
    return subprocess.run([sys.executable, '-X', 'utf8', str(Path(__file__).with_name('ic_bridge.py')), mode, str(request)], capture_output=True, text=True, encoding='utf-8')


def test_exact_ci_input_binding_and_duplicate_prepare(tmp_path):
    request = fixture(tmp_path)
    outcome = invoke('prepare', request)
    assert outcome.returncode == 0, outcome.stderr
    root = Path(json.loads(outcome.stdout)['directory'])
    assert (root / 'requirement.md').read_text(encoding='utf-8') == 'Selected CI only\n中文\n'
    assert invoke('prepare', request).returncode != 0
    assert json.loads(invoke('collect', request).stdout) is None
    completion = {'sdd_status': 'not_passed', 'results': {'coding': {'status': 'fail'}, 'official': {'status': 'evaluated', 'answer': 'must not reach manager'}}}
    (root / 'completion.json').write_text(json.dumps(completion), encoding='utf-8')
    result = json.loads(invoke('collect', request).stdout)
    assert result['sdd_status'] == 'not_passed'
    assert result['artifacts'][0]['text'] == 'internal evidence'
    assert 'official' not in result['stages']
    assert 'must not reach manager' not in json.dumps(result)
    assert result['prd_check']['open_gaps'] == [{'title': 'GAP-004', 'text': 'seed'}]
    (root / 'requirement.md').write_text('changed', encoding='utf-8')
    assert invoke('collect', request).returncode != 0


def test_reject_changed_baseline_before_freezing(tmp_path):
    request = fixture(tmp_path)
    data = json.loads(request.read_text())
    data['run']['baseline']['digest'] = 'wrong'
    request.write_text(json.dumps(data))
    result = invoke('prepare', request)
    assert result.returncode != 0 and 'Baseline changed' in result.stderr
    assert not (tmp_path / 'prepared-run').exists()


def test_reject_changed_adapter_before_freezing(tmp_path):
    request = fixture(tmp_path)
    data = json.loads(request.read_text())
    (Path(data['adapter']) / 'prepare.py').write_text('# a different adapter', encoding='utf-8')
    result = invoke('prepare', request)
    assert result.returncode != 0 and 'Pinned adapter digest differs' in result.stderr
    assert not (tmp_path / 'prepared-run').exists()
