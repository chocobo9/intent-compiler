"""CI-only entry into a pinned common SDD adapter. Never reads raw IC history."""
import contextlib
import hashlib
import importlib
import json
from pathlib import Path
import sys


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def operate(mode, request):
    request = Path(request).resolve()
    data = read(request)
    # The host pins the shared adapter used by the comparison, not a live IC plugin.
    sys.path.insert(0, str(Path(data['adapter']).resolve()))
    runner = importlib.import_module('run_r1')
    results = importlib.import_module('run_results')
    claim, delivery = data['run'], data['delivery']
    if claim['ci_ref'] != delivery['ref'] or claim['event_id'] != delivery['event_id']:
        raise ValueError('CI identity differs')
    if delivery['profile'] != 'ci-sdd-v1' or delivery['draft']['decision'] != 'deliver':
        raise ValueError('Not an approved CI delivery')
    body = {k: v for k, v in delivery.items() if k != 'ref'}
    digest = 'sha256:' + hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if digest != delivery['ref']['digest']:
        raise ValueError('CI content digest differs')
    manifest = Path(str(request) + '.prepared')
    if mode == 'prepare':
        if manifest.exists():
            raise ValueError('Already prepared; reconcile the existing run')
        baseline = Path(claim['baseline']['path']).resolve()
        if results.source_hash(baseline) != claim['baseline']['digest']:
            raise ValueError('Baseline changed')
        policy = Path(data['adapter']) / 'budget-policy.json'
        if hashlib.sha256(policy.read_bytes()).hexdigest() != claim['config_digest']:
            raise ValueError('Pinned policy digest differs')
        # A failed/ambiguous preparation never overwrites the original input.
        requirement = Path(str(request) + '.requirement.md')
        with requirement.open('x', encoding='utf-8') as out:
            out.write(delivery['text'])
        with contextlib.redirect_stdout(sys.stderr):
            root = runner.freeze(data['round'], baseline, requirement, Path(data['sdd_source']))
        actual = (root / 'requirement.md').read_text(encoding='utf-8')
        if actual != delivery['text']:
            raise ValueError('SDD did not receive the exact CI body')
        binding = {'directory': str(root.resolve()), 'ci_ref': claim['ci_ref'], 'run_id': claim['run_id'],
                   'requirement_sha256': runner.sha(root / 'requirement.md'), 'baseline_digest': claim['baseline']['digest']}
        runner.write_json(root / 'ic-binding.json', binding)
        with manifest.open('x', encoding='utf-8') as out:
            json.dump(binding, out, ensure_ascii=False)
        return binding
    if mode != 'collect':
        raise ValueError('Unsupported operation')
    binding = read(manifest)
    root = Path(binding['directory'])
    if binding['ci_ref'] != claim['ci_ref'] or binding['run_id'] != claim['run_id'] or read(root / 'ic-binding.json') != binding:
        raise ValueError('Run binding changed')
    if runner.sha(root / 'requirement.md') != binding['requirement_sha256']:
        raise ValueError('Frozen input changed')
    completion = root / 'completion.json'
    if not completion.exists():
        return None
    value = read(completion)
    # Official scoring stays in the experiment evidence, not management feedback.
    stages = {key: result.get('status', 'unknown') for key, result in value['results'].items() if key in {'design', 'coding', 'prd', 'final'}}
    run = runner.run_directory(root)
    artifacts = [run / 'repos/main/.verdict.md', run / 'output/06-Spec骨架/verdict.md', run / 'output/08-验证结果.md']
    return {'event_id': 'return-' + claim['run_id'], 'run_id': claim['run_id'], 'ci_ref': claim['ci_ref'],
            'status': 'finished', 'sdd_status': value['sdd_status'], 'stages': stages,
            'artifacts': [{'path': str(p), 'digest': runner.sha(p), 'text': p.read_text(encoding='utf-8')} for p in artifacts if p.exists()],
            'source_digest': results.source_hash(runner.run_directory(root) / 'repos/main'),
            'reason': 'Original SDD completion and stage evidence; no requirement-satisfaction inference.'}


if __name__ == '__main__':
    print(json.dumps(operate(sys.argv[1], sys.argv[2]), ensure_ascii=False))
