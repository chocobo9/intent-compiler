"""Freeze a new SWE issue and local intent changes before any model call."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

root = Path(r'D:\huawei\intent-new-case-001')
project = Path(r'D:\huawei\intent')
source = json.loads((root / 'source/task.json').read_text(encoding='utf-8'))
turns = [source['problem_statement'],
    "For now, narrow this to adding a regression test reproducing the HIERARCH card comment truncation. Do not change the float formatter in this change; defer that fix. Keep the exact numeric value and the full comment from the example in the test, and do not add dependencies.",
    "Actually, withdraw that test-only restriction and include the formatter fix in this change as well. Keep the regression test, preserve the numeric value and full comment, and keep the no-new-dependencies constraint. The earlier str(value) suggestion is only a possible approach, not a required implementation; choose a FITS-compatible approach without rounding the input to make the example fit."]
def save(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(content if isinstance(content, str) else json.dumps(content, ensure_ascii=False, indent=2))
for index, text in enumerate(turns, 1):
    save(root / f'inputs/user-{index}.txt', text)
save(root / 'inputs/harness.txt', (Path(r'D:\huawei\intent-single-coding-001') / 'inputs/harness.txt').read_text())
save(root / 'evaluator/expected.json', {'written_before_model_run': True, 'turns': [
    {'turn': 1, 'must_preserve': ['io.fits.Card should support valid FITS cards without unnecessary float expansion truncating comments', '0.009125 and full HIERARCH example comment', 'str(value) before .16G with 20-character threshold is a tentative suggestion with possible side effects, not an unconditional user mandate'], 'must_not_invent': ['environment version list as a requirement to install those versions', 'round the numeric input to fit']},
    {'turn': 2, 'must_preserve': ['same task', 'current scope only regression test for example', 'formatter change deferred', 'exact numeric value and full comment in test', 'no new dependencies']},
    {'turn': 3, 'must_preserve': ['same task', 'formatter fix included in current change', 'regression test retained', 'numeric value and full comment preserved', 'no new dependencies', 'FITS compatibility', 'str(value) optional implementation approach', 'no rounding input to force fit'], 'must_invalidate': ['test-only restriction', 'formatter deferral']}
]})
config = json.loads(Path(r'D:\huawei\intent-single-coding-fix-002\compiler-model\opencode.json').read_text())
save(root / 'compiler-model/opencode.json', config)
save(root / 'workspace/opencode.json', {**config, 'plugin': [(project / '.opencode/plugins/experiment-runtime.js').as_uri()]})
save(root / 'manifest.json', {'run_id': 'new-case-001', 'created_at': datetime.now(timezone.utc).isoformat(),
    'task': source['instance_id'], 'source_repo': source['repo'], 'base_commit': source['base_commit'],
    'dataset': 'princeton-nlp/SWE-bench_Verified',
    'retrieval': 'datasets-server rows default/test offset=0 length=15; original_id astropy__astropy-14508 selected from official Evolving Intent SWE ID list; gold patches/tests not saved or exposed',
    'trajectory_origin': 'Original SWE issue verbatim; turns 2 and 3 locally authored and frozen before execution. NOT an official Evolving Intent generated trajectory.',
    'scope': 'New development case not used in prior repair; no-tools intent validation, not coding execution or statistical held-out benchmark',
    'compiler_model': 'openai/gpt-5.6-luna-fast', 'effort': 'max resolved config and executor variant; not provider-wire capture',
    'executor_history': 'same session across three turns',
    'turn_sha256': [hashlib.sha256(t.encode()).hexdigest() for t in turns],
    'compiler_source_sha256': {str(p.relative_to(project)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((project / 'src').rglob('*.ts'))}})
print('Frozen three turns and separate expected semantics for ' + source['instance_id'])
