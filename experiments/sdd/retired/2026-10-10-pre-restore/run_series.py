"""One frozen, sequential 15-round SDD-only experiment; no hidden reruns."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

import run_r1
from process_scope import ProcessScope
from run_results import official_result, source_hash


PROMOTION_GATES = ('design', 'coding', 'prd', 'final')


def promotion_blockers(completion):
    """Return every reason this round cannot become the next round's baseline."""
    blockers = []
    if completion.get('sdd_status') != 'pass':
        blockers.append('sdd_status')
    results = completion.get('results', {})
    for stage in PROMOTION_GATES:
        if results.get(stage, {}).get('status') != 'pass':
            blockers.append(stage)
    phases = completion.get('phases', [])
    if not phases or any(not phase.get('cleanup_confirmed') for phase in phases):
        blockers.append('process_cleanup')
    if results.get('container_cleanup', {}).get('status') == 'unconfirmed':
        blockers.append('container_cleanup')
    if results.get('official', {}).get('status') != 'evaluated':
        blockers.append('official_evaluation')
    return blockers


def recovered_record(record, recovered, evidence):
    """Bind a completed recovery to exactly the failed final round it continues."""
    recovered = Path(recovered).resolve()
    original = Path(record['root']).resolve()
    current = recovered
    lineage = []
    while current != original:
        if str(current) in lineage or len(lineage) >= 4:
            raise ValueError('Invalid recovery lineage')
        lineage.append(str(current))
        manifest = current / 'design-recovery.json'
        if not manifest.exists():
            manifest = current / 'document-recovery.json'
        data = json.loads(manifest.read_text(encoding='utf-8'))
        evidence[str(manifest)] = run_r1.sha(manifest)
        for name, digest in data['parent_evidence'].items():
            if run_r1.sha(Path(name)) != digest:
                raise ValueError('Recovery parent evidence changed')
            evidence[name] = digest
        parent = Path(data['parent']).resolve()
        for name in ['requirement.md']:
            if run_r1.sha(current / name) != run_r1.sha(parent / name):
                raise ValueError('Recovery changed requirement or policy')
        old_policy = json.loads((parent / 'budget-policy.json').read_text(encoding='utf-8'))
        new_policy = json.loads((current / 'budget-policy.json').read_text(encoding='utf-8'))
        if new_policy != old_policy:
            from recover_design import amendment_policy
            if not data.get('design_amendment') or new_policy != amendment_policy(old_policy) or data.get('policy_adjustment') != {'before': old_policy, 'after': new_policy}:
                raise ValueError('Unrecorded recovery policy change')
        result = json.loads((current / 'completion.json').read_text(encoding='utf-8'))
        previous = json.loads((parent / 'completion.json').read_text(encoding='utf-8'))
        if result['round'] != record['round'] or result['budget']['started'] != previous['budget']['started']:
            raise ValueError('Recovery round or original budget identity changed')
        for name, count in previous['budget']['counts'].items():
            if result['budget']['counts'].get(name, 0) < count:
                raise ValueError('Recovery reset a counter')
        evidence[str(current / 'completion.json')] = run_r1.sha(current / 'completion.json')
        current = parent
    if not lineage:
        raise ValueError('Expected a distinct recovery record')
    return {'round': record['round'], 'root': str(recovered),
            'superseded_attempt': record, 'recovery_lineage': lineage}


def continuation_records(parent, recovered_round=None):
    """Reinterpret saved evaluation only; never rerun or alter prior development."""
    parent = Path(parent).resolve()
    state = json.loads((parent / 'series-results.json').read_text(encoding='utf-8'))
    if state['status'] not in {'runner_blocked', 'completed'}:
        raise ValueError('Continuation requires a stopped parent series')
    records = state['rounds']
    if not records or len(records) >= 15:
        raise ValueError('Continuation needs 1..14 completed round records')
    evidence = {str(parent / 'series-results.json'): run_r1.sha(parent / 'series-results.json')}
    if recovered_round:
        if records[-1]['completion']['results']['design']['status'] == 'pass':
            raise ValueError('Only a failed final design can be replaced by its recovery')
        records[-1] = recovered_record(records[-1], recovered_round, evidence)
    for number, record in enumerate(records, 1):
        if record['round'] != number:
            raise ValueError('Non-contiguous parent rounds')
        trial = Path(record['root'])
        original = trial / 'completion.json'
        completion = json.loads(original.read_text(encoding='utf-8'))
        if completion['model'] != run_r1.MODEL or completion['variant'] != run_r1.VARIANT:
            raise ValueError('Parent model profile differs')
        log = trial / 'official-verifier.log'
        build = trial / 'official-verifier/build-exit-code.txt'
        corrected = official_result(log, int(build.read_text().strip()))
        completion.setdefault('results', {}).setdefault('official', {}).update(corrected)
        blockers = promotion_blockers(completion)
        if blockers:
            raise ValueError('Parent round is not eligible for promotion: ' + ', '.join(blockers))
        project = run_r1.run_directory(trial) / 'repos/main'
        if not project.is_dir() or not (trial / 'official-app').is_dir():
            raise ValueError('Parent code snapshot missing')
        digest = source_hash(project)
        if digest != source_hash(trial / 'official-app'):
            raise ValueError('Parent baseline differs from evaluated code')
        record.update(completion=completion, inherited_from=str(parent), baseline_sha256=digest,
                      evaluation_reparsed=True, original_completion=str(original))
        for file in [original, log, build]:
            evidence[str(file)] = run_r1.sha(file)
    return {'parent': str(parent), 'records': records, 'evidence_sha256': evidence}


def cumulative_requirement(source, number):
    parts = ['# Accumulated original user requirements\n'
             'Apply each update in order. Later explicit revisions replace only the affected earlier requirements.\n']
    for n in range(1, number + 1):
        text = (source / f'steps/round-{n}/instruction.md').read_text(encoding='utf-8')
        parts.append(f'\n## Original user update {n}\n\n{text}\n')
    return '\n'.join(parts)


def freeze_series(continue_from=None, recovered_round=None):
    if recovered_round and not continue_from:
        raise ValueError('Recovered round requires its parent series')
    continuation = continuation_records(continue_from, recovered_round) if continue_from else None
    root = run_r1.BASE / 'harbor_runs' / ('sdd-luna-dpipe-15round-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%Sz-') + uuid.uuid4().hex[:8])
    root.mkdir(parents=True)
    bundle = root / 'adapter'
    bundle.mkdir()
    source = Path(__file__).parent
    for pattern in ['*.py', '*.mjs', '*.json', '*.sh', 'execution-context.md']:
        for file in source.glob(pattern):
            if not file.name.startswith('test_') and file.name not in {'overlay-manifest.json'}:
                shutil.copy2(file, bundle / file.name)
    shutil.copytree(source / 'skills', bundle / 'skills')
    upstream = root / 'sdd-source'
    (upstream / 'workflow').mkdir(parents=True)
    for name in ['speclang-flow.sh', 'workflow.json']:
        shutil.copy2(Path('D:/sdd/prdcheck/workflow') / name, upstream / 'workflow' / name)
    shutil.copytree('D:/sdd/prdcheck/.agents/skills', upstream / '.agents/skills',
                    ignore=shutil.ignore_patterns('node_modules', '__pycache__'))
    hashes = {p.relative_to(root).as_posix(): run_r1.sha(p) for folder in [bundle, upstream]
              for p in folder.rglob('*') if p.is_file()}
    approved_go_helper = os.environ.get('SPECART_GO_HELPER') or None
    approved_go_helper_manifest = os.environ.get('SPECART_GO_HELPER_MANIFEST') or None
    external_runtime_files = {}
    if approved_go_helper:
        helper_path = Path(approved_go_helper).resolve()
        if not approved_go_helper_manifest:
            raise ValueError('SPECART_GO_HELPER requires SPECART_GO_HELPER_MANIFEST')
        manifest_path = Path(approved_go_helper_manifest).resolve()
        validator_source = upstream / '.agents/skills/specart/assets/validator/go/main.go'
        external_runtime_files.update(run_r1.validate_approved_go_helper(helper_path, manifest_path, validator_source))
        approved_go_helper = str(helper_path)
        approved_go_helper_manifest = str(manifest_path)
    elif approved_go_helper_manifest:
        raise ValueError('SPECART_GO_HELPER_MANIFEST requires SPECART_GO_HELPER')
    run_r1.write_json(root / 'series.json', {'status': 'prepared', 'rounds': 15,
        'model': run_r1.MODEL, 'variant': run_r1.VARIANT, 'max_seconds_per_round': run_r1.load_policy()['round_deadline_seconds'],
        'max_development_launches': 15 - len(continuation['records']) if continuation else 15,
        'continuation': continuation, 'adapter_files': hashes,
        'specart_go_helper': approved_go_helper, 'specart_go_helper_manifest': approved_go_helper_manifest,
        'external_runtime_files': external_runtime_files,
        'original_instructions': {str(n): run_r1.sha(run_r1.OFFICIAL / f'steps/round-{n}/instruction.md') for n in range(1, 16)}})
    print(root, flush=True)
    return root


def publish(root, records, status):
    run_r1.write_json(root / 'series-results.json', {'status': status, 'completed_rounds': len(records), 'rounds': records})
    lines = ['# SDD-only dpipe 15-round results', '', f'Status: {status}', '',
             '| Round | SDD | Official status | Passed / total | Seconds |', '|---|---|---|---|---|']
    if any(r.get('inherited_from') for r in records):
        lines.insert(4, 'Earlier rounds are inherited with recorded adapter lineage; see series.json continuation. This is not an uninterrupted single-version run.\n')
    for r in records:
        c = r['completion']; official = c.get('results', {}).get('official', {})
        lines.append(f"| {r['round']} | {c.get('sdd_status', 'runner_error')} | {official.get('status', 'missing')} | {official.get('passed', 0)} / {official.get('total', 0)} | {c.get('elapsed_seconds', 0):.1f} |")
    for r in records:
        if r.get('recovery_lineage'):
            lines.extend(['', f"R{r['round']} recovery lineage (earlier attempts remain recorded):",
                          r['superseded_attempt']['root'], *reversed(r['recovery_lineage'])])
    (root / 'series-report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')


def execute_series(root):
    root = Path(root).resolve()
    config = json.loads((root / 'series.json').read_text(encoding='utf-8'))
    for path, digest in config['adapter_files'].items():
        if run_r1.sha(root / path) != digest:
            raise ValueError('Series frozen source changed: ' + path)
    for n, digest in config['original_instructions'].items():
        if run_r1.sha(run_r1.OFFICIAL / f'steps/round-{n}/instruction.md') != digest:
            raise ValueError('Original instruction changed: ' + n)
    for path, digest in config.get('external_runtime_files', {}).items():
        if run_r1.sha(Path(path)) != digest:
            raise ValueError('Series external runtime changed: ' + path)
    with (root / 'series-launch.lock').open('x') as lock:
        lock.write(dt.datetime.now(dt.timezone.utc).isoformat())
    # Keep trials alongside the series: nesting long upstream template names
    # below both series and trial IDs exceeds Windows MAX_PATH.
    continuation = config.get('continuation')
    records = continuation['records'] if continuation else []
    previous = None
    if continuation:
        for path, digest in continuation['evidence_sha256'].items():
            if run_r1.sha(Path(path)) != digest:
                raise ValueError('Parent evidence changed: ' + path)
        for record in records:
            project = run_r1.run_directory(Path(record['root'])) / 'repos/main'
            if source_hash(project) != record['baseline_sha256']:
                raise ValueError('Parent baseline changed')
        previous = run_r1.run_directory(Path(records[-1]['root'])) / 'repos/main'
    publish(root, records, 'running')
    def log(message):
        with (root / 'series.log').open('a', encoding='utf-8') as output:
            output.write(f'[{dt.datetime.now().astimezone().isoformat(timespec="seconds")}] {message}\n')
    try:
        for number in range(len(records) + 1, config['rounds'] + 1):
            requirement = root / f'requirements-through-r{number}.md'
            requirement.write_text(cumulative_requirement(run_r1.OFFICIAL, number), encoding='utf-8')
            trial = run_r1.freeze(number, previous, requirement, root / 'sdd-source')
            run_r1.write_json(root / 'active-round.json', {'round': number, 'root': str(trial), 'status': 'running'})
            log(f'R{number} started: {trial}; monitor={trial / "sdd-flow.log"}')
            scope = ProcessScope()
            try:
                with (trial / 'launcher.log').open('wb') as output:
                    launch_env = {**os.environ, 'PYTHONUTF8': '1',
                                  'SPECART_GO_HELPER': config.get('specart_go_helper') or '',
                                  'SPECART_GO_HELPER_MANIFEST': config.get('specart_go_helper_manifest') or ''}
                    proc = scope.start([str(run_r1.PYTHON), str(trial / 'run_r1.py'), '--launch', str(trial)],
                        stdout=output, stderr=subprocess.STDOUT, env=launch_env)
                    limit = config['max_seconds_per_round']
                    proc.wait(timeout=limit + 60 if limit is not None else None)
            finally:
                if not scope.close():
                    raise RuntimeError('Trial process cleanup unconfirmed')
            completion = trial / 'completion.json'
            if not completion.exists():
                raise RuntimeError(f'R{number} runner exited {proc.returncode} without completion; inspect {trial}')
            result = json.loads(completion.read_text(encoding='utf-8'))
            records.append({'round': number, 'root': str(trial), 'completion': result})
            publish(root, records, 'running')
            log(f'R{number} finished: SDD={result["sdd_status"]}, official={result["results"]["official"]}')
            blockers = promotion_blockers(result)
            if blockers:
                raise RuntimeError(f'R{number} is not eligible for promotion; refusing next round: ' + ', '.join(blockers))
            previous = run_r1.run_directory(trial) / 'repos/main'
        publish(root, records, 'completed')
        run_r1.write_json(root / 'active-round.json', {'round': 15, 'status': 'completed'})
        log('SERIES FINISHED: all 15 round records saved; see series-report.md and series-results.json')
    except Exception as error:
        publish(root, records, 'runner_blocked')
        active = root / 'active-round.json'
        state = json.loads(active.read_text(encoding='utf-8')) if active.exists() else {}
        run_r1.write_json(active, {**state, 'status': 'runner_blocked', 'reason': str(error)})
        log('SERIES BLOCKED: ' + str(error))
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--launch')
    parser.add_argument('--continue-from')
    parser.add_argument('--recovered-round')
    args = parser.parse_args()
    if args.launch:
        runner = Path(args.launch).resolve() / 'adapter/run_series.py'
        if runner != Path(__file__).resolve():
            raise SystemExit(subprocess.call([sys.executable, str(runner), '--launch', str(Path(args.launch).resolve())]))
        execute_series(args.launch)
    else:
        freeze_series(args.continue_from, args.recovered_round)
