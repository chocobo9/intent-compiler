"""One frozen, sequential 15-round SDD-only experiment; no hidden reruns."""
import argparse
import datetime as dt
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

import run_r1
from process_scope import ProcessScope
from run_results import HANDOFF, official_result, open_prd_gaps, source_hash


PROMOTION_GATES = ('design', 'coding', 'prd')
# Upstream ends the PRD check/fix loop in this state when it hands the remaining
# differences to a human. The unattended series answers with one fixed,
# pre-registered rule instead of a person: keep the current code and continue.
HUMAN_DECISION_STATE = 'NEED_MANUAL_DECISION'


VOID = 'auto_void_round'
KEEP = 'auto_keep_build_pass'


def promotion_decision(completion):
    """Return (mode, blockers) under the fixed unattended rule (user, 2026-10-10).

    sdd_pass: SDD passed every gate. auto_manual_decision: PRD check stopped at
    NEED_MANUAL_DECISION and the code builds; the current code is kept.
    auto_keep_build_pass: SDD stopped at another gate but the code passes the
    requested build and tests; the current code is kept (user, 2026-10-11).
    auto_void_round: any other outcome; the round is voided and the next round
    starts from this round's baseline. Only an unconfirmed cleanup or a missing
    result stops the series.
    """
    results = completion.get('results', {})
    prd = results.get('prd', {})
    official = results.get('official', {})
    flow = next((p for p in completion.get('phases', []) if p.get('phase', '').startswith('sdd-flow')), {})
    gates_pass = all(results.get(stage, {}).get('status') == 'pass' for stage in ('design', 'coding'))
    builds = official.get('build_exit_code') == 0 and official.get('requested_build_exit_code') == 0
    if gates_pass and prd.get('status') == 'pass' and completion.get('sdd_status') == 'pass' and official.get('status') == 'evaluated':
        mode = 'sdd_pass'
    elif gates_pass and prd.get('state') == HUMAN_DECISION_STATE and flow.get('exit_code') == 0 and builds and official.get('status') == 'evaluated':
        mode = 'auto_manual_decision'
    elif builds and official.get('status') == 'evaluated':
        # User, 2026-10-11: the experiment is scored by the verifier on the delivered
        # code; SDD's own gates (SpecArt verification, PRD check) are recorded but no
        # longer discard code that builds and passes the requested `go build && go test`.
        mode = KEEP
    else:
        mode = VOID
    blockers = []
    phases = completion.get('phases', [])
    if not phases or any(not phase.get('cleanup_confirmed') for phase in phases):
        blockers.append('process_cleanup')
    if results.get('container_cleanup', {}).get('status') == 'unconfirmed':
        blockers.append('container_cleanup')
    if results.get('runner', {}).get('status') == 'error':
        blockers.append('runner_error')
    return mode, blockers


def next_baseline(trial, completion):
    """The code the next round starts from: this round's, or for a voided round its own baseline."""
    trial = Path(trial)
    if promotion_decision(completion)[0] == VOID:
        return trial / 'baseline'
    return run_r1.run_directory(trial) / 'repos/main'


STAGE_ARTIFACTS = {'prd': 'output/02-澄清后PRD.md', 'sd': 'output/04-SystemDesign/MAP.md', 'change': 'output/05-变更说明书.md',
                   'specart': 'output/06-Spec骨架/verdict.md', 'coding': 'repos/main/.verdict.md', 'prdcheck': 'output/08-验证结果.md'}


def failure_summary(trial, completion):
    """Where and why SDD stopped: the first stage that did not pass, the flow's errors and that stage's own conclusion."""
    run = run_r1.run_directory(Path(trial))
    results = completion.get('results', {})
    states = results.get('design', {}).get('states', {})
    stage = next((name for name in ['prd', 'sd', 'change', 'specart'] if states.get(name) != 'passed'), None)
    if stage is None and results.get('design', {}).get('status') != 'pass':
        stage = 'specart'
    if stage is None:
        stage = 'coding' if results.get('coding', {}).get('status') != 'pass' else 'prdcheck'
    flow_log = run / 'flow.log'
    errors = [line for line in flow_log.read_text(encoding='utf-8', errors='replace').splitlines() if 'ERROR' in line] if flow_log.exists() else []
    from run_results import coding_verdict_path
    artifact = coding_verdict_path(run) if stage == 'coding' else run / STAGE_ARTIFACTS[stage]
    conclusion = artifact.read_text(encoding='utf-8', errors='replace')[-1500:] if artifact.is_file() else ''
    return {'stopped_stage': stage, 'flow_errors': errors[-3:], 'stage_artifact': str(artifact), 'stage_conclusion': conclusion,
            'prd_state': results.get('prd', {}).get('state'), 'official': {k: results.get('official', {}).get(k) for k in ['status', 'passed', 'total']}}


def promotion_blockers(completion):
    """Return every reason this round cannot become the next round's baseline."""
    return promotion_decision(completion)[1]


def unresolved_gaps(run):
    """GAP titles still open after the last PRD check round."""
    return [gap['title'] for gap in open_prd_gaps(run)]


def promotion_record(trial, completion):
    mode, _ = promotion_decision(completion)
    record = {'mode': mode}
    if mode == VOID:
        record['rule'] = 'SDD did not complete this round: void it and continue from the code it started from (fixed unattended rule)'
        record['failure'] = failure_summary(trial, completion)
    if mode == KEEP:
        record['rule'] = 'SDD stopped at its own gate but the code builds and passes the requested build and tests: keep it and continue (user rule, 2026-10-11)'
        record['failure'] = failure_summary(trial, completion)
    if mode == 'auto_manual_decision':
        record['rule'] = 'NEED_MANUAL_DECISION: keep current code and continue (fixed unattended rule)'
        record['unresolved'] = completion['results']['prd'].get('verdict', {}).get('unresolved')
        run = run_r1.run_directory(Path(trial))
        record['unresolved_gaps'] = unresolved_gaps(run)
        record['report'] = str(run / 'output/08-验证结果.md')
    return record


def adopt_first_round(trial):
    """Use an already completed standalone R1 as round 1, re-reading its records."""
    from run_results import stage_result
    trial = Path(trial).resolve()
    original = trial / 'completion.json'
    completion = json.loads(original.read_text(encoding='utf-8'))
    if completion.get('round') != 1 or completion['model'] != run_r1.MODEL or completion['variant'] != run_r1.VARIANT:
        raise ValueError('Adopted trial must be round 1 with the frozen model profile')
    run = run_r1.run_directory(trial)
    for stage in PROMOTION_GATES:
        completion['results'][stage] = stage_result(run, stage)
    blockers = promotion_blockers(completion)
    if blockers:
        raise ValueError('Adopted round is not eligible for promotion: ' + ', '.join(blockers))
    project = run / 'repos/main'
    digest = source_hash(project)
    if digest != source_hash(trial / 'official-app'):
        raise ValueError('Adopted baseline differs from evaluated code')
    record = {'round': 1, 'root': str(trial), 'completion': completion, 'adopted': True,
              'evaluation_reparsed': True, 'original_completion': str(original), 'baseline_sha256': digest,
              'promotion': promotion_record(trial, completion)}
    evidence = {str(path): run_r1.sha(path) for path in
                [original, trial / 'official-verifier.log', trial / 'official-verifier/build-exit-code.txt']}
    return {'parent': None, 'adopted_first_round': str(trial), 'records': [record], 'evidence_sha256': evidence}


def continuation_records(parent, retry_last=None, retry_from=None, reason=None):
    """Reinterpret saved evaluation only; never rerun or alter prior development.

    retry_last (a reason) drops a failed final round so the series reruns that
    round from the same baseline after an adapter fix; the dropped attempt is
    recorded, never deleted.
    """
    parent = Path(parent).resolve()
    state = json.loads((parent / 'series-results.json').read_text(encoding='utf-8'))
    # A series stopped by the operator still says 'running'; continuing it needs an explicit retry reason.
    if state['status'] not in {'runner_blocked', 'completed'} and not (state['status'] == 'running' and (retry_last or reason)):
        raise ValueError('Continuation requires a stopped parent series')
    records = state['rounds']
    superseded = []
    if retry_from:
        # Rerun from this round after an adapter fix; the dropped rounds stay recorded.
        if not reason or not any(r['round'] == retry_from for r in records):
            raise ValueError('retry-from needs a reason and a round the parent series has')
        superseded = [{'round': r['round'], 'root': r['root'], 'reason': reason} for r in records if r['round'] >= retry_from]
        records = [r for r in records if r['round'] < retry_from]
    if retry_last:
        last = records[-1]
        if not promotion_decision(last['completion'])[1]:
            raise ValueError('The last parent round is eligible; there is nothing to retry')
        superseded.append({'round': last['round'], 'root': last['root'], 'reason': retry_last})
        records = records[:-1]
    if not records or len(records) >= 15:
        raise ValueError('Continuation needs 1..14 completed round records')
    evidence = {str(parent / 'series-results.json'): run_r1.sha(parent / 'series-results.json')}
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
        # Gate records are re-read with this adapter version's reader.
        from run_results import stage_result
        for stage in PROMOTION_GATES:
            completion['results'][stage] = stage_result(run_r1.run_directory(trial), stage)
        blockers = promotion_blockers(completion)
        if blockers:
            raise ValueError('Parent round is not eligible for promotion: ' + ', '.join(blockers))
        project = run_r1.run_directory(trial) / 'repos/main'
        if not project.is_dir() or not (trial / 'official-app').is_dir():
            raise ValueError('Parent code snapshot missing')
        if source_hash(project) != source_hash(trial / 'official-app'):
            raise ValueError('Parent baseline differs from evaluated code')
        digest = source_hash(next_baseline(trial, completion))
        record.update(completion=completion, inherited_from=str(parent), baseline_sha256=digest,
                      evaluation_reparsed=True, original_completion=str(original),
                      promotion=promotion_record(trial, completion))
        for file in [original, log, build]:
            evidence[str(file)] = run_r1.sha(file)
    return {'parent': str(parent), 'records': records, 'evidence_sha256': evidence, 'superseded_attempts': superseded}


def cumulative_requirement(source, number):
    parts = ['# Accumulated original user requirements\n'
             'Apply each update in order. Later explicit revisions replace only the affected earlier requirements.\n']
    for n in range(1, number + 1):
        text = (source / f'steps/round-{n}/instruction.md').read_text(encoding='utf-8')
        parts.append(f'\n## Original user update {n}\n\n{text}\n')
    return '\n'.join(parts)


def freeze_series(continue_from=None, adopt_r1=None, retry_last=None, retry_from=None, reason=None):
    if continue_from and adopt_r1:
        raise ValueError('Choose either a parent series or an adopted R1')
    if retry_last and not continue_from:
        raise ValueError('retry-last needs a parent series')
    continuation = (continuation_records(continue_from, retry_last, retry_from, reason) if continue_from
                    else adopt_first_round(adopt_r1) if adopt_r1 else None)
    root = run_r1.BASE / 'harbor_runs' / ('sdd-luna-dpipe-15round-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%Sz-') + uuid.uuid4().hex[:8])
    root.mkdir(parents=True)
    bundle = root / 'adapter'
    bundle.mkdir()
    source = Path(__file__).parent
    for pattern in ['*.py', '*.go', '*.json', '*.sh', 'execution-context.md']:
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
        'model': run_r1.MODEL, 'variant': run_r1.VARIANT, 'max_seconds_per_round': None,
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
             '| Round | SDD | Promotion | Unresolved PRD gaps / stop | Official status | Passed / total | Seconds |',
             '|---|---|---|---|---|---|---|']
    if any(r.get('adopted') for r in records):
        lines.insert(4, 'R1 is an adopted standalone trial run with the same upstream workflow; its records were re-read by this adapter version.\n')
    lines.insert(4, "Promotion 'auto_manual_decision' means SDD stopped at NEED_MANUAL_DECISION and the fixed unattended rule kept the current code.\n")
    if any(r.get('inherited_from') for r in records):
        lines.insert(4, 'Earlier rounds are inherited with recorded adapter lineage; see series.json continuation. This is not an uninterrupted single-version run.\n')
    for r in records:
        c = r['completion']; official = c.get('results', {}).get('official', {})
        promotion = r.get('promotion') or {}
        gaps = '; '.join(promotion.get('unresolved_gaps') or []) or (f"stopped at {promotion['failure']['stopped_stage']}" if promotion.get('failure') else '-')
        lines.append(f"| {r['round']} | {c.get('sdd_status', 'runner_error')} | {promotion.get('mode') or 'blocked'} | {gaps} | {official.get('status', 'missing')} | {official.get('passed', 0)} / {official.get('total', 0)} | {c.get('elapsed_seconds', 0):.1f} |")
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
            if source_hash(next_baseline(record['root'], record['completion'])) != record['baseline_sha256']:
                raise ValueError('Parent baseline changed')
        previous = next_baseline(records[-1]['root'], records[-1]['completion'])
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
            records.append({'round': number, 'root': str(trial), 'completion': result,
                            'promotion': promotion_record(trial, result)})
            publish(root, records, 'running')
            log(f'R{number} finished: SDD={result["sdd_status"]}, official={result["results"]["official"]}')
            blockers = promotion_blockers(result)
            if blockers:
                raise RuntimeError(f'R{number} is not eligible for promotion; refusing next round: ' + ', '.join(blockers))
            previous = next_baseline(trial, result)
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
    parser.add_argument('--adopt-r1', help='completed standalone R1 trial to use as round 1')
    parser.add_argument('--retry-last', help='reason: drop the failed final parent round and rerun it')
    parser.add_argument('--retry-from', type=int, help='drop the parent rounds from this number on and rerun them')
    parser.add_argument('--reason', help='reason for --retry-from')
    args = parser.parse_args()
    if args.launch:
        runner = Path(args.launch).resolve() / 'adapter/run_series.py'
        if runner != Path(__file__).resolve():
            raise SystemExit(subprocess.call([sys.executable, str(runner), '--launch', str(Path(args.launch).resolve())]))
        execute_series(args.launch)
    else:
        freeze_series(args.continue_from, args.adopt_r1, args.retry_last, args.retry_from, args.reason)
