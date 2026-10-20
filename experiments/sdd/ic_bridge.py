"""CI-only entry into a pinned common SDD adapter. Never reads raw IC history."""
import contextlib
import hashlib
import importlib
import json
from pathlib import Path
import sys


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


ADAPTER_FILES = ('*.py', '*.go', '*.sh', 'execution-context.md')


def adapter_digest(adapter):
    """Identity of the pinned common adapter: every runtime file it ships."""
    adapter = Path(adapter).resolve()
    files = sorted({p for pattern in ADAPTER_FILES for p in adapter.glob(pattern) if not p.name.startswith('test_')}
                   | {p for p in (adapter / 'skills').rglob('*') if p.is_file() and '__pycache__' not in p.parts})
    listing = {p.relative_to(adapter).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    return hashlib.sha256(json.dumps(listing, sort_keys=True).encode()).hexdigest()


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
        if adapter_digest(data['adapter']) != claim['config_digest']:
            raise ValueError('Pinned adapter digest differs')
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
    stages = {key: result.get('status', 'unknown') for key, result in value['results'].items() if key in {'design', 'coding', 'prd'}}
    run = runner.run_directory(root)
    # The PRD is returned so IC can hand it back as the next round's requirement baseline.
    artifacts = [run / 'repos/main/.verdict.md', run / 'output/06-Spec骨架/verdict.md', run / 'output/08-验证结果.md', run / 'output/02-澄清后PRD.md']
    return {'event_id': 'return-' + claim['run_id'], 'run_id': claim['run_id'], 'ci_ref': claim['ci_ref'],
            'status': 'finished', 'sdd_status': value['sdd_status'], 'stages': stages,
            'artifacts': [{'path': str(p), 'digest': runner.sha(p), 'text': p.read_text(encoding='utf-8')} for p in artifacts if p.exists()],
            'source_digest': results.source_hash(runner.run_directory(root) / 'repos/main'),
            # SDD's own PRD consistency check is the requirement-level feedback.
            'prd_check': results.prd_check_summary(run),
            'example_results': example_results(delivery, run / 'repos/main'),
            **({'acceptance': acceptance_result(value)} if value.get('acceptance_repair') else {}),
            'reason': 'Original SDD completion, stage evidence and its PRD check; no separate IC assessment.'}



def acceptance_result(value):
    """What IC's in-round acceptance left failing in the code this run returns (its repaired code when adopted)."""
    a = value.get('acceptance_repair')
    if not a:
        return None
    if a['outcome'] == 'nothing_to_repair' and not a.get('excluded_p2'):
        open_ids = []
    elif 'failing_final' in a:
        open_ids = a['failing_final']
    elif a['outcome'] in ('adopted', 'adopted_with_regressions'):
        open_ids = a['passes'][-1].get('failing_after', [])
    else:
        open_ids = a['failing_before']
    info = a.get('details', {})
    # Recorded, never fed back: P1/P2 failures of classes the gate keeps closed, P3 suspected regressions, P4 summary gaps.
    last = a['passes'][-1].get('recorded_after') if a.get('passes') and a['outcome'] in ('adopted', 'adopted_with_regressions') else None
    post = last if last is not None else a.get('recorded_before', [])
    closed = {c for c, state in (a.get('gate') or {}).items() if state != 'open'}
    recorded = [{'id': it['id'], 'subject': f"{it['class']}: {it['name']}", 'observed': '; '.join(it.get('problems') or []) or (it.get('static') or it.get('run_state') or '')}
                for it in post if it.get('failed') and it['class'] in closed]
    recorded += [{'id': it['id'], 'subject': f"p3_regression: {it['name']}", 'observed': '; '.join(it.get('diffs', []))} for it in (a.get('recorded_p3') or {}).get('items', []) if it.get('failed')]
    recorded += [{'id': it['id'], 'subject': f"p4_summary: {it['name']}", 'observed': 'named by the PRD, not by the SpecArt summary'} for it in (a.get('recorded_p4') or {}).get('items', []) if it.get('failed')]
    # C2: what a revision may be confirmed by: P1/P2 checks the gate opens that pass on the code this run returns.
    # Two mechanical fixes (2026-10-20, v7 R13): a per-command gate entry (p2_structure:profile) opens its check even when
    # the class is closed, as acceptance_repair.gate_state reads it; and a record whose state is null (P1) counts as
    # compared, as a missing one does. Before, both filtered every record out and verified was always empty.
    gate = a.get('gate') or {}
    opened = lambda it: gate.get(f"{it['class']}:{it['name']}", gate.get(it['class'], 'open')) == 'open'
    verified = [{'class': it['class'], 'name': it['name'], 'output_keys': it.get('output_keys') or []} for it in post
                if not it.get('failed') and it['class'] in ('p1_stub', 'p2_structure') and opened(it) and (it.get('state') or 'compared') == 'compared']
    return {'outcome': a['outcome'], 'checks': a['checks'], **({'verified': verified} if verified else {}),
            'open': [{'id': i, 'subject': info.get(i, {}).get('subject', i), 'observed': info.get(i, {}).get('observed', '')} for i in open_ids],
            **({'recorded': recorded} if recorded else {})}


def check_unit(check_id):
    """The unit a check id names: unit:<kind>:<name>, p1:<name>, p2:<name>, probe:<command>:<case>."""
    parts = check_id.split(':')
    if parts[0] == 'unit' and len(parts) >= 3:
        return ':'.join(parts[2:])
    if parts[0] in ('p1', 'p2', 'probe') and len(parts) >= 2:
        return parts[1]
    return None


def run_observation(run_id, completion):
    """v8 zoning input, read back from one returned run (an observation, never a requirement): whether SDD's coding
    stage ran, the units of the checks IC's repair fixed in its code, and those that passed on its final code."""
    a = completion.get('acceptance_repair') or {}
    coding = (completion.get('results', {}).get('coding') or {}).get('status')
    fixed = [] if a.get('outcome') in (None, 'nothing_to_repair', 'reverted') else a.get('fixed', [])
    last = a['passes'][-1].get('recorded_after') if a.get('passes') and a.get('outcome') in ('adopted', 'adopted_with_regressions') else None
    records = last if last is not None else a.get('recorded_before', [])
    passed = [r['name'] for r in records or [] if not r.get('failed') and r.get('class') in ('p1_stub', 'p2_structure') and (r.get('state') or 'compared') == 'compared']
    structures = [{'name': r['name'], 'output_keys': r.get('output_keys') or []} for r in records or []
                  if not r.get('failed') and r.get('class') == 'p2_structure' and (r.get('state') or 'compared') == 'compared']
    units = lambda ids: sorted({u for u in (check_unit(i) for i in ids) if u})
    return {'run_id': run_id, 'entered_coding': coding not in (None, 'not_reached'), 'fixed_units': units(fixed), 'passed_units': sorted(set(passed)),
            'passed_structures': structures}


def landing_observations(store):
    """Observations of every returned run the store counts (not voided, not superseded) that has a directory."""
    out = []
    for run in read(store).get('runs', []):
        if not run.get('result') or run.get('voided') or run.get('superseded') or not run.get('directory'):
            continue
        completion = Path(run['directory']) / 'completion.json'
        if completion.exists():
            out.append(run_observation(run['run_id'], read(completion)))
    return out


def example_results(delivery, code):
    """The delivery's checkable acceptance examples run against this run's code (docker, no network)."""
    examples = [{'id': f"{a['subject']}#{i + 1}", 'run': e['run'], 'check': e['check'], 'exit_code': e.get('exit_code'), 'asserts': e.get('asserts', [])}
                for a in (delivery.get('contract') or {}).get('acceptance', []) for i, e in enumerate(a['examples']) if e.get('checkable')]
    examples += [{'id': e['id'], 'run': e['run'], 'check': e['check'], 'exit_code': e.get('exit_code'), 'asserts': e.get('asserts', [])}
                 for e in (delivery.get('contract') or {}).get('executable', []) if e.get('checkable')]
    if not examples or not Path(code).exists():
        return []
    from example_runner import run_examples
    ran = run_examples(code, examples)
    return [{'id': r['id'], 'passed': r['passed'], 'failures': r['failures']} for r in ran['results']]


def adopted_result(trial, claim, adapter, delivery=None):
    """The SDD result of an already completed trial adopted for this claim (read as collect reads it; the trial is not modified)."""
    sys.path.insert(0, str(Path(adapter).resolve()))
    runner = importlib.import_module('run_r1')
    results = importlib.import_module('run_results')
    root = Path(trial).resolve()
    value = read(root / 'completion.json')
    run = runner.run_directory(root)
    stages = {key: results.stage_result(run, key).get('status', 'unknown') for key in ('design', 'coding', 'prd')}
    artifacts = [run / 'repos/main/.verdict.md', run / 'output/06-Spec骨架/verdict.md', run / 'output/08-验证结果.md', run / 'output/02-澄清后PRD.md']
    return {'event_id': 'return-' + claim['run_id'], 'run_id': claim['run_id'], 'ci_ref': claim['ci_ref'],
            'status': 'finished', 'sdd_status': value['sdd_status'], 'stages': stages,
            'artifacts': [{'path': str(p), 'digest': runner.sha(p), 'text': p.read_text(encoding='utf-8')} for p in artifacts if p.exists()],
            'source_digest': results.source_hash(run / 'repos/main'),
            'prd_check': results.prd_check_summary(run),
            'example_results': example_results(delivery or {}, run / 'repos/main'),
            **({'acceptance': acceptance_result(value)} if value.get('acceptance_repair') else {}),
            'reason': f'Adopted completed SDD run {root.name}; its node 1 was an earlier CI of this user update.'}

if __name__ == '__main__':
    if sys.argv[1] == 'digest':
        print(adapter_digest(sys.argv[2]))
    else:
        print(json.dumps(operate(sys.argv[1], sys.argv[2]), ensure_ascii=False))
