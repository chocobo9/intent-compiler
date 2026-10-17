"""One frozen, sequential 15-round IC+SDD experiment (arm 2); no hidden reruns.

Each round's original user update goes to IC as a new user input; IC keeps the
requirement across rounds in its IR and hands SDD one CI. SDD runs the same
upstream workflow through the same common adapter as the SDD-only arm, and a
round is promoted by the same rule (run_series.promotion_decision).
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import uuid

import costs
import run_r1
from run_results import source_hash
from run_series import VOID, next_baseline, promotion_decision, promotion_record
from ic_bridge import adapter_digest

PROJECT = Path(__file__).resolve().parents[2]
NODE = 'C:/Program Files/nodejs/node.exe'
TRIAL_PREFIX = 'ic5-sdd-dpipe'
# The management host: OpenCode built with OpenAI strict structured output (D3, user 2026-10-16).
STRICT_HOST = Path('D:/huawei/opencode-v1.18.31-strict/bin/opencode.cmd')
# Extra management calls a round may receive once, recorded (D5: as agreed for v4, user 2026-10-16).
REOPEN_CALLS = 10
# Calls per round; when they run out the series stops (BLOCKED). Extra calls only by an
# explicit --reopen N after the user approves (user, 2026-10-11).
MANAGEMENT_BUDGET = 15
ROUND_WAIT_SECONDS = 8 * 3600
# Rerun policy (user, 2026-10-11, superseding "up to 3 attempts"). A round has at most
# MAX_ATTEMPTS attempts. A voided attempt that still passes PASS_FLOOR of the official
# cases was a small random slip: it is run once more with the same CI from the same
# baseline and the better attempt is kept. Below PASS_FLOOR something is wrong: the
# series pauses for diagnosis instead of rerunning on luck. After a fix the operator
# resumes with --retry-paused; a round already fixed once is promoted by the fixed rule.
MAX_ATTEMPTS = 2
PASS_FLOOR = 0.9


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def check_gate():
    """The V2 gate this series freezes: the acceptance default, overridden by an explicit, user-approved IC_CHECK_GATE (JSON)."""
    import acceptance_repair
    return {**acceptance_repair.DEFAULT_GATE, **json.loads(os.environ.get('IC_CHECK_GATE') or '{}')}


def host_identity(native):
    """The management host launcher, and for one run from patched OpenCode source its revision and patch."""
    native = Path(native).resolve()
    if not native.is_file():
        raise ValueError('Management host launcher missing: ' + str(native))
    identity = {'path': str(native), 'launcher_sha256': run_r1.sha(native)}
    repo = native.parent.parent
    if (repo / '.git').exists():
        git = lambda *a: subprocess.check_output(['git', '-C', str(repo), *a])
        identity.update(source_head=git('rev-parse', 'HEAD').decode().strip(), source_diff_sha256=hashlib.sha256(git('diff', '--binary')).hexdigest())
    return identity


def freeze_ic_series(adopt_r1=None, trial_prefix=TRIAL_PREFIX, ledger_from_round=1, acceptance_repair=False, pause_below_floor=True, native=None):
    root = run_r1.BASE / 'harbor_runs' / (f'{trial_prefix}-15round-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%Sz-') + uuid.uuid4().hex[:8])
    root.mkdir(parents=True)
    source = Path(__file__).parent
    adapter = root / 'adapter'
    adapter.mkdir()
    for pattern in ['*.py', '*.go', '*.json', '*.sh', 'execution-context.md']:
        for file in source.glob(pattern):
            if not file.name.startswith('test_') and file.name != 'overlay-manifest.json':
                shutil.copy2(file, adapter / file.name)
    shutil.copytree(source / 'skills', adapter / 'skills')
    upstream = root / 'sdd-source'
    (upstream / 'workflow').mkdir(parents=True)
    for name in ['speclang-flow.sh', 'workflow.json']:
        shutil.copy2(Path('D:/sdd/prdcheck/workflow') / name, upstream / 'workflow' / name)
    shutil.copytree('D:/sdd/prdcheck/.agents/skills', upstream / '.agents/skills', ignore=shutil.ignore_patterns('node_modules', '__pycache__'))
    # The compiled IC lives inside the project so it resolves the project's node_modules.
    dist = PROJECT / '.scratch' / root.name / 'dist'
    built = subprocess.run([NODE, str(PROJECT / 'node_modules/typescript/bin/tsc'), '-p', str(PROJECT / 'tsconfig.build.json'), '--outDir', str(dist)],
                           cwd=PROJECT, capture_output=True, text=True)
    if built.returncode:
        raise RuntimeError('IC build failed: ' + built.stdout[-3000:] + built.stderr[-3000:])
    head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=PROJECT, capture_output=True, text=True).stdout.strip()
    dirty = subprocess.run(['git', 'status', '--short', 'src'], cwd=PROJECT, capture_output=True, text=True).stdout.splitlines()
    (root / 'management').mkdir()
    (root / 'requests').mkdir()
    (root / 'baseline-r0').mkdir()
    run_r1.write_json(root / 'management-config.json', {
        '$schema': 'https://opencode.ai/config.json', 'model': run_r1.MODEL, 'small_model': run_r1.MODEL,
        'plugin': [], 'instructions': [], 'mcp': {}, 'share': 'disabled', 'agent': {},
        'provider': {'openai': {'models': {'gpt-6-luna-fast': {
            'options': {'reasoningEffort': 'high', 'serviceTier': 'priority'},
            'variants': {run_r1.VARIANT: {'reasoningEffort': 'high', 'serviceTier': 'priority'}}}}}}})
    frozen = {p.relative_to(root).as_posix(): run_r1.sha(p) for folder in [adapter, upstream] for p in folder.rglob('*') if p.is_file()}
    ic_files = {p.relative_to(dist).as_posix(): run_r1.sha(p) for p in dist.rglob('*') if p.is_file()}
    run_r1.write_json(root / 'series.json', {
        'status': 'prepared', 'rounds': 15, 'arm': 'ic+sdd', 'model': run_r1.MODEL, 'variant': run_r1.VARIANT,
        'trial_prefix': trial_prefix, 'ledger_from_round': ledger_from_round, 'acceptance_repair': acceptance_repair, 'pause_below_floor': pause_below_floor, 'management_budget': MANAGEMENT_BUDGET, 'request_timeout_ms': 2147483647,
        'native': str(Path(native).resolve()) if native else str(run_r1.resolve_opencode()), **({'native_frozen': host_identity(native)} if native else {}), 'reopen_calls': REOPEN_CALLS, 'check_gate': check_gate(), 'node': NODE, 'python': str(run_r1.PYTHON), 'port': free_port(),
        'adapter_digest': adapter_digest(adapter), 'frozen_files': frozen,
        'ic': {'dist': str(dist), 'files': ic_files, 'source_head': head, 'source_uncommitted': dirty},
        'original_instructions': {str(n): run_r1.sha(run_r1.OFFICIAL / f'steps/round-{n}/instruction.md') for n in range(1, 16)},
        **({'adopt_r1': adopted_trial(adopt_r1)} if adopt_r1 else {})})
    print(root, flush=True)
    return root


def adopted_trial(trial):
    """A completed R1 SDD trial this series adopts instead of running R1's SDD again (user, 2026-10-11)."""
    trial = Path(trial).resolve()
    completion = json.loads((trial / 'completion.json').read_text(encoding='utf-8'))
    if completion.get('round') != 1 or completion['model'] != run_r1.MODEL or completion['variant'] != run_r1.VARIANT:
        raise ValueError('Adopted trial must be round 1 with the frozen model profile')
    if source_hash(run_r1.run_directory(trial) / 'repos/main') != source_hash(trial / 'official-app'):
        raise ValueError('Adopted code differs from the evaluated code')
    return {'trial': str(trial), 'requirement_sha256': run_r1.sha(trial / 'requirement.md'),
            'completion_sha256': run_r1.sha(trial / 'completion.json')}


def pass_rate(completion):
    official = completion.get('results', {}).get('official', {}) or {}
    total = official.get('total') or 0
    return (official.get('passed') or 0) / total if total else 0.0


def upstream_spec_gap(promotion):
    """SDD's upstream validator stopped the design (SpecArt SPEC_GAP, e.g. SA183): not a fault of the CI."""
    failure = (promotion or {}).get('failure') or {}
    return failure.get('stopped_stage') in ('specart', 'design') and 'SPEC_GAP' in (failure.get('stage_conclusion') or '')


def accept_returned(trial, number, prior_completion, log, gate=None):
    """IC's in-round acceptance and targeted repair of a returned trial, before IC reads its code (once per trial)."""
    if json.loads((trial / 'completion.json').read_text(encoding='utf-8')).get('acceptance_repair'):
        return None
    import acceptance_repair
    from ic_bridge import acceptance_result
    log(f'R{number} acceptance started')
    prior = acceptance_result(prior_completion) if prior_completion else None
    accepted = acceptance_repair.apply(trial, number, {o['id'] for o in prior['open']} if prior else None, gate)
    # The checks the adopted code fixes (a later pass that did not hold returns to an earlier one).
    fixed = accepted.get('fixed', accepted['passes'][-1].get('fixed', []) if accepted.get('passes') else [])
    now = json.loads((trial / 'completion.json').read_text(encoding='utf-8'))['results']['official'].get('passed')
    log(f"R{number} acceptance: {accepted['outcome']}; failing before {len(accepted['failing_before'])}, fixed {len(fixed)}, excluded as P2 {len(accepted.get('excluded_p2', []))}"
        + (f"; official {accepted['sdd_official'].get('passed')} -> {now}" if accepted.get('sdd_official') else ''))
    return accepted


def round_action(mode, rate, attempts_done, fix_retried=False, upstream_gap=False, pause_below_floor=True):
    """'pause' (diagnose first), 'retry' (same CI, same baseline) or 'promote' (fixed rule).

    A round voided by SDD's upstream validator is rerun once with the same CI whatever
    its score (no IC call); other rounds below PASS_FLOOR pause for diagnosis. With
    pause_below_floor off (unattended nights, user 2026-10-11), they go on: a voided
    one is rerun once, any other is promoted, and the record notes the low score.
    """
    if mode == VOID and upstream_gap and attempts_done < MAX_ATTEMPTS:
        return 'retry'
    if not pause_below_floor and rate < PASS_FLOOR:
        return 'retry' if mode == VOID and attempts_done < MAX_ATTEMPTS else 'promote'
    if rate < PASS_FLOOR and not fix_retried:
        return 'pause'
    if mode == VOID and rate >= PASS_FLOOR and attempts_done < MAX_ATTEMPTS:
        return 'retry'
    return 'promote'


def attempt_summary(record):
    """One finished attempt of a round, kept in that round's record once another attempt replaces it."""
    completion, promotion = record['completion'], record['promotion']
    return {'attempt': len(record.get('attempts', [])) + 1, 'trial': record['root'], 'execution_id': record['execution_id'],
            'mode': promotion.get('mode'), 'rule': promotion.get('rule'), 'failure': promotion.get('failure'),
            'sdd_status': completion.get('sdd_status'), 'official': completion.get('results', {}).get('official'),
            'elapsed_seconds': completion.get('elapsed_seconds'), 'superseded_by': None,
            'completion': completion, 'promotion': promotion}


def keep_better(record):
    """Report the better attempt: a promoted one before a voided one, then more official cases passed."""
    rank = lambda mode, completion: (mode != VOID, (completion.get('results', {}).get('official', {}) or {}).get('passed') or 0)
    best = max(record['attempts'], key=lambda a: rank(a['mode'], a['completion']), default=None)
    if best and rank(best['mode'], best['completion']) > rank(record['promotion'].get('mode'), record['completion']):
        current = attempt_summary(record)
        current['attempt'] = len(record['attempts']) + 1
        record['attempts'] = [a for a in record['attempts'] if a is not best] + [current]
        record.update(root=best['trial'], execution_id=best['execution_id'], completion=best['completion'], promotion=best['promotion'],
                      kept_attempt=best['attempt'])
    return record


def split_resumed(previous, retry_paused=False, pause_below_floor=True):
    """Rounds a resumed series keeps, and the record of the round it re-enters (or None).

    A paused round is re-entered for one fixed rerun with retry_paused, and kept as it
    stands otherwise. A returned round due a retry under the policy is re-entered; its
    finished attempt becomes one of the round's attempts.
    """
    kept = []
    for r in previous:
        if r.get('stage') != 'returned':
            return kept, r
        mode, blockers = promotion_decision(r['completion'])
        if blockers:
            return kept, r
        if r.get('paused'):
            if retry_paused:
                return kept, dict(r, attempts=r.get('attempts', []) + [attempt_summary(r)], fix_retried=True, paused=None)
            kept.append(r)
            continue
        if round_action(mode, pass_rate(r['completion']), len(r.get('attempts', [])) + 1, r.get('fix_retried'), upstream_spec_gap(r.get('promotion')), pause_below_floor) == 'retry':
            return kept, dict(r, attempts=r.get('attempts', []) + [attempt_summary(r)])
        kept.append(r)
    return kept, None


def round_cost(store, event_id, record):
    """M8: management calls and tokens, SDD stage tokens of every attempt, acceptance repair tokens."""
    batch = next(b for b in store['batches'] if b['event_id'] == event_id)
    trials = [a['trial'] for a in record.get('attempts', [])] + [record['root']]
    sdd = [{'trial': t, **costs.sdd_tokens(t)} for t in dict.fromkeys(trials)]
    return {'management': costs.management_tokens(batch), 'management_calls': batch['requests_used'], 'reopened': batch.get('reopened'),
            'sdd': [{k: v for k, v in x.items() if k != 'stages'} | {'stages': {n: (t or {}).get('input') for n, t in x['stages'].items()}} for x in sdd],
            'sdd_total': {k: sum((x['total'] or {}).get(k, 0) for x in sdd) for k in (*costs.KEYS, 'steps')} if all(x['total'] for x in sdd) else 'unknown',
            'repair': costs.repair_tokens(record['root'])}


def write_checkpoint(root, number, event, store, record, baseline):
    """M6: the state at the end of round n, written once; the round after it restarts from exactly this."""
    from run_results import source_hash
    folder = root / 'checkpoints' / f'r{number:02d}'
    folder.mkdir(parents=True, exist_ok=False)
    batch = next(b for b in store['batches'] if b['event_id'] == event['event_id'])
    run = next((r for r in reversed(store['runs']) if r['run_id'] == record['execution_id']), None)
    run_r1.write_json(folder / 'event.json', event)
    run_r1.write_json(folder / 'store.json', store)
    (folder / 'delivered-ci.md').write_text(batch['delivery']['text'], encoding='utf-8')
    contract = batch['delivery'].get('contract') or {}
    run_r1.write_json(folder / 'ledgers.json', {'revisions': contract.get('revisions', []), 'ledger': batch['delivery'].get('ledger', []), 'rewrite_next': contract.get('rewrite_next', [])})
    manifest = {'round': number, 'event_id': event['event_id'], 'store_sha256': run_r1.sha(folder / 'store.json'),
                'ci_ref': batch['delivery']['ref'], 'ci_sha256': run_r1.sha(folder / 'delivered-ci.md'),
                'code': {'path': str(baseline), 'source_hash': source_hash(baseline)},
                'sdd_receipt': (run or {}).get('result'), 'official': (record.get('completion') or {}).get('results', {}).get('official'),
                'promotion': (record.get('promotion') or {}).get('mode'), 'trial': record['root'], 'cost': record.get('cost'),
                'written': dt.datetime.now(dt.timezone.utc).isoformat()}
    run_r1.write_json(folder / 'manifest.json', manifest)
    return {'path': str(folder), 'store_sha256': manifest['store_sha256'], 'code_hash': manifest['code']['source_hash']}


def restore_checkpoint(root, k, reason):
    """Restart at round k from the checkpoint of round k-1: the store and the series records are replaced as they were then;
    what came after is archived, never mixed in."""
    root = Path(root).resolve()
    if k < 2:
        raise ValueError('Round 1 has no earlier checkpoint; start a new series')
    folder = root / 'checkpoints' / f'r{k - 1:02d}'
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    if run_r1.sha(folder / 'store.json') != manifest['store_sha256']:
        raise ValueError('Checkpoint store changed')
    from run_results import source_hash
    if source_hash(Path(manifest['code']['path'])) != manifest['code']['source_hash']:
        raise ValueError('Checkpoint code changed: ' + manifest['code']['path'])
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%Sz')
    archive = root / 'restarts' / f'from-r{k:02d}-{stamp}'
    archive.mkdir(parents=True)
    for name in ['store', 'series-results.json', 'series-report.md']:
        if (root / name).exists():
            shutil.move(str(root / name), str(archive / name))
    for later in sorted((root / 'checkpoints').glob('r*')):
        if int(later.name[1:]) >= k:
            shutil.move(str(later), str(archive / later.name))
    (root / 'store').mkdir()
    shutil.copy2(folder / 'store.json', root / 'store' / 'ci-sdd.json')
    state = json.loads((archive / 'series-results.json').read_text(encoding='utf-8'))
    kept = [r for r in state['rounds'] if r['round'] < k]
    publish(root, kept, 'restored')
    config = json.loads((root / 'series.json').read_text(encoding='utf-8'))
    config.setdefault('restores', []).append({'round': k, 'from_checkpoint': str(folder), 'archive': str(archive), 'reason': reason, 'at': stamp})
    run_r1.write_json(root / 'series.json', config)
    return archive


def publish(root, records, status):
    run_r1.write_json(root / 'series-results.json', {'status': status, 'completed_rounds': len(records), 'rounds': records})
    lines = ['# IC+SDD dpipe 15-round results', '', f'Status: {status}', '',
             "Promotion 'auto_manual_decision': SDD stopped at NEED_MANUAL_DECISION and the current code was kept. 'auto_void_round': SDD did not complete the round; it was voided and the next round started from its baseline (reason in series-results.json promotion.failure).", '',
             '| Round | Attempts | IC calls | SDD | Promotion | Unresolved PRD gaps / stop | Stop class | Official status | Passed / total | SDD seconds | IC tokens in/out | SDD tokens in/out | Repair tokens in/out |',
             '|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for r in records:
        c = r.get('completion') or {}
        official = c.get('results', {}).get('official', {})
        promotion = r.get('promotion') or {}
        gaps = '; '.join(promotion.get('unresolved_gaps') or []) or (f"stopped at {promotion['failure']['stopped_stage']}" if promotion.get('failure') else '-')
        cost = r.get('cost') or {}
        tok = lambda t: f"{t['input']}/{t['output']}" if isinstance(t, dict) else 'unknown'
        ic = cost.get('management', {}).get('budgeted') if cost else None
        lines.append(f"| {r['round']} | {len(r.get('attempts', [])) + 1} | {r.get('management_calls', '-')} | {c.get('sdd_status', r.get('stage', '-'))} | {promotion.get('mode') or 'blocked'} | {gaps} | {(r.get('stop') or {}).get('class', '-')} | "
                     f"{official.get('status', 'missing')} | {official.get('passed', 0)} / {official.get('total', 0)} | {c.get('elapsed_seconds', 0):.1f} | "
                     f"{tok(ic) if ic else 'unknown'} | {tok(cost.get('sdd_total')) if cost else 'unknown'} | {tok((cost.get('repair') or {}).get('total')) if cost and cost.get('repair') else ('none' if cost else 'unknown')} |")
    (root / 'series-report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')


def execute_ic_series(root, resume=None, retry_paused=False, retry_round=None):
    root = Path(root).resolve()
    config = json.loads((root / 'series.json').read_text(encoding='utf-8'))
    for path, digest in config['frozen_files'].items():
        if run_r1.sha(root / path) != digest:
            raise ValueError('Series frozen source changed: ' + path)
    dist = Path(config['ic']['dist'])
    for path, digest in config['ic']['files'].items():
        if run_r1.sha(dist / path) != digest:
            raise ValueError('Frozen IC build changed: ' + path)
    for n, digest in config['original_instructions'].items():
        if run_r1.sha(run_r1.OFFICIAL / f'steps/round-{n}/instruction.md') != digest:
            raise ValueError('Original instruction changed: ' + n)
    with (root / (f'series-resume-{resume}.lock' if resume else 'series-launch.lock')).open('x') as lock:
        lock.write(dt.datetime.now(dt.timezone.utc).isoformat())

    def log(message):
        with (root / 'series.log').open('a', encoding='utf-8') as output:
            output.write(f'[{dt.datetime.now().astimezone().isoformat(timespec="seconds")}] {message}\n')

    env = dict(os.environ, PYTHONUTF8='1', SDD_TRIAL_PREFIX=config['trial_prefix'])

    def command(name, value):
        path = root / 'requests' / f'{name}.json'
        run_r1.write_json(path, value)
        with (root / 'requests' / f'{name}.out').open('a', encoding='utf-8') as out:
            done = subprocess.run([config['node'], str(dist / 'cli/sdd.js'), str(path)], stdout=out, stderr=out, env=env,
                                  creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if done.returncode:
            raise RuntimeError(f'{name} failed; see {path.with_suffix(".out")}')

    def snapshot():
        return json.loads((root / 'store/ci-sdd.json').read_text(encoding='utf-8'))

    records, server, reentered = [], None, None
    if resume:
        # Promoted rounds are kept; the series continues at the round that stopped it.
        previous = json.loads((root / 'series-results.json').read_text(encoding='utf-8'))['rounds']
        from run_results import stage_result
        for r in previous:
            if r.get('stage') == 'returned':
                # Gates are re-read with the current reader and rules.
                for stage in ('design', 'coding', 'prd'):
                    r['completion']['results'][stage] = stage_result(run_r1.run_directory(Path(r['root'])), stage)
                r['promotion'] = promotion_record(r['root'], r['completion'])
            # Finished attempts are judged again under the current rule too, so keeping the better one compares like with like.
            for a in r.get('attempts', []):
                a['promotion'] = promotion_record(a['trial'], a['completion'])
                a['mode'] = a['promotion'].get('mode')
        records, reentered = split_resumed(previous, retry_paused, config.get('pause_below_floor', True))
        if retry_round:
            # Operator rerun of a promoted round (user decision, recorded in series.json): its finished
            # attempt is kept as an attempt; the same delivery runs again from the same baseline and the
            # better attempt is kept.
            last = records[-1] if records else None
            if not last or last['round'] != retry_round:
                raise ValueError(f'--retry-round {retry_round} must be the last kept round')
            reason = (config.get('resumes') or [{}])[-1].get('reason', 'operator rerun')
            records = records[:-1]
            reentered = dict(last, attempts=last.get('attempts', []) + [dict(attempt_summary(last), rule=f'operator rerun: {reason}')], operator_retry=reason)
    publish(root, records, 'running')
    try:
        server_env = dict(env, OPENCODE_CONFIG=str(root / 'management-config.json'), OPENCODE_DISABLE_PROJECT_CONFIG='1',
                          OPENCODE_DISABLE_CLAUDE_CODE='1', OPENCODE_DISABLE_AUTOUPDATE='1')
        with (root / 'management-server.log').open('ab') as out:
            server = subprocess.Popen([config['native'], 'serve', '--hostname', '127.0.0.1', '--port', str(config['port'])],
                                      cwd=root / 'management', env=server_env, stdout=out, stderr=out,
                                      creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        url = f"http://127.0.0.1:{config['port']}"
        for _ in range(180):
            if server.poll() is not None:
                raise RuntimeError('Management server exited')
            try:
                with urllib.request.urlopen(url + '/global/health', timeout=2) as response:
                    if response.status == 200:
                        break
            except Exception:
                time.sleep(1)
        else:
            raise RuntimeError('Management server did not become ready')
        common = dict(store=str(root / 'store'), run_id=root.name,
                      management=dict(server_url=url, directory=str(root / 'management'), provider_id='openai',
                                      model_id='gpt-6-luna-fast', variant=run_r1.VARIANT, request_timeout_ms=config['request_timeout_ms']))
        host = dict(python=config['python'], bridge=str(root / 'adapter/ic_bridge.py'), adapter=str(root / 'adapter'),
                    sddSource=str(root / 'sdd-source'), directory=str(root / 'requests/host'))
        baseline = next_baseline(records[-1]['root'], records[-1]['completion']) if records else root / 'baseline-r0'
        for number in range(len(records) + 1, config['rounds'] + 1):
            record = {'round': number, 'stage': 'ic_compile', 'attempts': list((reentered or {}).get('attempts', []))}
            if (reentered or {}).get('operator_retry'):
                record['operator_retry'] = reentered['operator_retry']
            if (reentered or {}).get('fix_retried'):
                record['fix_retried'] = True
            reentered = None
            records.append(record)
            event = dict(schema_version=2, run_id=root.name, event_id=f'r{number}-user-input', kind='user_input',
                         source=dict(channel='user', producer_id='authorized-dpipe-experiment'),
                         payload=dict(text=(run_r1.OFFICIAL / f'steps/round-{number}/instruction.md').read_text(encoding='utf-8')))
            store = root / 'store/ci-sdd.json'
            batch = next((b for b in json.loads(store.read_text(encoding='utf-8'))['batches'] if b['event_id'] == event['event_id']), None) if store.exists() else None
            if batch and batch['state'] == 'rejected':
                extra = (config.get('resumes') or [{}])[-1].get('reopen') if resume else None
                if not extra:
                    raise RuntimeError(f"R{number}: IC batch rejected ({batch.get('error', '')[:300]}); extra calls need an explicit --reopen N after user approval")
                command(f'r{number}-reopen-{resume}', dict(common, command='reopen', event_id=event['event_id'],
                                                           extra_requests=extra, reason=config['resumes'][-1]['reason']))
                log(f'R{number} rejected batch reopened with {extra} extra management calls (explicit --reopen)')
            log(f'R{number} IC compile started')
            command(f'r{number}-compile', dict(common, command='compile', event=event, max_requests=config['management_budget']))
            batch = snapshot()['batches'][-1]
            if batch['state'] == 'rejected' and not batch.get('reopened') and config.get('reopen_calls'):
                # D5: one extra allotment per round, recorded in the store and the log.
                log(f"R{number} IC batch rejected after {batch['requests_used']} calls ({(batch.get('error') or '')[:300]}); reopening once with {config['reopen_calls']} calls")
                command(f'r{number}-reopen', dict(common, command='reopen', event_id=event['event_id'], extra_requests=config['reopen_calls'],
                                                  reason='one extra allotment per round (D5, as agreed for v4)'))
                command(f'r{number}-compile-reopened', dict(common, command='compile', event_id=event['event_id'], max_requests=config['management_budget']))
                batch = snapshot()['batches'][-1]
            record['management_calls'] = batch['requests_used']
            if batch['state'] != 'accepted' or batch['delivery']['draft']['decision'] != 'deliver':
                raise RuntimeError(f"R{number}: IC did not approve a delivery: {batch.get('error', batch['state'])}")
            (root / f'delivered-ci-r{number}.md').write_text(batch['delivery']['text'], encoding='utf-8')
            # What code cut from the original text and the IR judgement behind it; recorded, never sent to SDD.
            run_r1.write_json(root / f'delivered-ci-r{number}.removed.json', batch['delivery']['removed'])
            record.update(stage='sdd_start', ci_ref=batch['delivery']['ref'], ci_chars=len(batch['delivery']['text']))
            publish(root, records, 'running')
            voided = records[:-1] and promotion_decision(records[-2]['completion'])[0] == VOID
            adopt = config.get('adopt_r1') if number == 1 else None
            if adopt and not any(r['event_id'] == event['event_id'] for r in snapshot()['runs']):
                # R1's SDD run is adopted, not run again: its node 1 was an earlier CI of this same user input.
                trial = Path(adopt['trial'])
                if run_r1.sha(trial / 'completion.json') != adopt['completion_sha256']:
                    raise ValueError('Adopted R1 trial changed')
                command('r1-claim-adopted', dict(common, command='claim-adopted', event_id=event['event_id'], directory=str(trial),
                                                 baseline=dict(path=str(baseline), digest=source_hash(baseline)), config_digest=config['adapter_digest']))
                run = snapshot()['runs'][-1]
                from ic_bridge import adopted_result
                command('r1-receive-adopted', dict(common, command='receive', result=adopted_result(trial, run, root / 'adapter', batch['delivery'] if config.get('ledger_from_round', 1) <= 1 else None)))
                log(f'R1 SDD run adopted: {trial} (its node 1 sha256 {adopt["requirement_sha256"]}; this series\' R1 CI chars={len(batch["delivery"]["text"])})')
            if adopt:
                trial = Path(adopt['trial'])
                from run_results import stage_result
                completion = json.loads((trial / 'completion.json').read_text(encoding='utf-8'))
                for stage in ('design', 'coding', 'prd'):
                    completion['results'][stage] = stage_result(run_r1.run_directory(trial), stage)
                record.update(stage='returned', root=str(trial), execution_id=snapshot()['runs'][-1]['run_id'], adopted=True,
                              adopted_node1_sha256=adopt['requirement_sha256'], completion=completion, promotion=promotion_record(trial, completion))
                publish(root, records, 'running')
                log(f"R1 adopted: SDD={completion['sdd_status']}, official={completion['results'].get('official')}")
            while not adopt:
                runs = [r for r in snapshot()['runs'] if r['event_id'] == event['event_id']]
                accounted = {a['execution_id'] for a in record['attempts']}
                suffix = f'-attempt{len(record["attempts"]) + 1}' if record['attempts'] else ''
                if runs and runs[-1]['run_id'] not in accounted:
                    # Already claimed (a resumed series): never start a second SDD run for this attempt.
                    run = runs[-1]
                    log(f'R{number} SDD run already claimed; waiting for it: {run.get("directory")}')
                else:
                    start = dict(common, command='start', event_id=event['event_id'], host=dict(host, round=number),
                                 baseline=dict(path=str(baseline), digest=source_hash(baseline)), config_digest=config['adapter_digest'])
                    if runs:
                        start['retry_voided'] = record['attempts'][-1]['rule'] or 'rerun of the same delivery'
                    elif voided:
                        start['previous_voided'] = records[-2]['promotion']['rule']
                    command(f'r{number}-start{suffix}', start)
                    run = snapshot()['runs'][-1]
                    if record['attempts']:
                        record['attempts'][-1]['superseded_by'] = run['run_id']
                trial = Path(run['directory'])
                record.update(stage='sdd_running', root=str(trial), execution_id=run['run_id'])
                publish(root, records, 'running')
                log(f'R{number} SDD started{" (attempt " + str(len(record["attempts"]) + 1) + ", same CI and baseline)" if record["attempts"] else ""}: {trial}; IC calls={batch["requests_used"]}; CI chars={len(batch["delivery"]["text"])}')
                deadline = time.monotonic() + ROUND_WAIT_SECONDS
                while not (trial / 'completion.json').exists():
                    if time.monotonic() > deadline:
                        raise RuntimeError(f'R{number}: no completion within {ROUND_WAIT_SECONDS}s; inspect {trial}')
                    time.sleep(30)
                returned = json.loads((trial / 'completion.json').read_text(encoding='utf-8'))
                stop = costs.stop_record(trial, returned, promotion_record(trial, returned))
                if stop and not stop['coding_entered'] and stop['class'] == 'T' and not record.get('t_rerun'):
                    # D1 (user, 2026-10-16): only a tool or environment stop before coding is rerun, once, same CI and baseline.
                    command(f'r{number}-reconcile{suffix}', dict(common, command='reconcile', execution_id=run['run_id'], host=dict(host, round=number)))
                    record.update(stage='returned', completion=returned, promotion=promotion_record(trial, returned), t_rerun=stop)
                    record['attempts'].append(attempt_summary(record))
                    record['attempts'][-1]['rule'] = 'T stop before coding (' + '; '.join(stop['tool_fault']) + '): rerun once with the same CI from the same baseline (D1)'
                    record['attempts'][-1]['promotion'] = dict(record['attempts'][-1]['promotion'] or {}, rule=record['attempts'][-1]['rule'])
                    publish(root, records, 'running')
                    log(f"R{number}: SDD stopped before coding at {stop['stage']} with a tool/environment fault ({'; '.join(stop['tool_fault'])}); rerunning once (D1)")
                    continue
                if config.get('acceptance_repair'):
                    accept_returned(trial, number, records[-2].get('completion') if len(records) > 1 else None, log, config.get('check_gate'))
                command(f'r{number}-reconcile{suffix}', dict(common, command='reconcile', execution_id=run['run_id'], host=dict(host, round=number)))
                completion = json.loads((trial / 'completion.json').read_text(encoding='utf-8'))
                record.update(stage='returned', completion=completion, promotion=promotion_record(trial, completion))
                publish(root, records, 'running')
                log(f"R{number} finished{' (attempt ' + str(len(record['attempts']) + 1) + ')' if record['attempts'] else ''}: SDD={completion['sdd_status']}, official={completion['results'].get('official')}")
                mode, blockers = promotion_decision(completion)
                if blockers:
                    raise RuntimeError(f'R{number} is not eligible for promotion; refusing next round: ' + ', '.join(blockers))
                rate = pass_rate(completion)
                action = round_action(mode, rate, len(record['attempts']) + 1, record.get('fix_retried'), upstream_spec_gap(record['promotion']), config.get('pause_below_floor', True))
                if rate < PASS_FLOOR and action != 'pause':
                    # Not paused (pause_below_floor off): noted for next-day attribution.
                    record['below_floor'] = {'pass_rate': rate, 'attempt': len(record['attempts']) + 1}
                    log(f'R{number}: official pass rate {rate:.1%} is below {PASS_FLOOR:.0%}; not paused (pause_below_floor off), {action}')
                if action == 'pause':
                    record['paused'] = {'pass_rate': rate, 'reason': f'official pass rate {rate:.1%} below {PASS_FLOOR:.0%}: diagnose before continuing'}
                    publish(root, records, 'paused_low_score')
                    log(f'SERIES PAUSED: R{number} official pass rate {rate:.1%} is below {PASS_FLOOR:.0%}; diagnose, then resume (--retry-paused after a fix)')
                    return
                if action == 'promote':
                    keep_better(record)
                    if record.get('kept_attempt') and record['execution_id'] != snapshot()['runs'][-1]['run_id']:
                        # The IC store counts the kept attempt's run, so the next CI's feedback is about the code the next round starts from.
                        command(f'r{number}-adopt-attempt{record["kept_attempt"]}', dict(common, command='adopt', execution_id=record['execution_id'],
                                                                                         reason=f'better attempt kept: attempt {record["kept_attempt"]}'))
                        log(f'R{number}: attempt {record["kept_attempt"]} kept (more official cases passed); the IC store counts its run')
                    break
                record['attempts'].append(attempt_summary(record))
                failure = record['promotion'].get('failure') or {}
                log(f"R{number} attempt {len(record['attempts'])} voided at {rate:.1%} (stopped at {failure.get('stopped_stage')}); rerunning the same CI from the same baseline")
            baseline = next_baseline(Path(record['root']), record['completion'])
            record['cost'] = round_cost(snapshot(), event['event_id'], record)
            record['stop'] = costs.stop_record(Path(record['root']), record['completion'], record['promotion'])
            # V2: every IC check class against the official result of the same code (calibration only).
            try:
                import round_reconcile
                record['reconcile'] = round_reconcile.reconcile_round(Path(record['root']), number)
                log(f"R{number} reconcile: {json.dumps(record['reconcile'], ensure_ascii=False)[:600]}")
            except Exception as error:
                record['reconcile'] = {'error': repr(error)[:400]}
                log(f'R{number} reconcile failed: {error!r}'[:400])
            record['checkpoint'] = write_checkpoint(root, number, event, snapshot(), record, baseline)
            publish(root, records, 'running')
            log(f"R{number} checkpoint written: {record['checkpoint']['path']}")
        publish(root, records, 'completed')
        log('SERIES FINISHED: all 15 round records saved; see series-report.md and series-results.json')
    except Exception as error:
        publish(root, records, 'runner_blocked')
        log('SERIES BLOCKED: ' + str(error))
        raise
    finally:
        if server and server.poll() is None:
            subprocess.run(['taskkill', '/PID', str(server.pid), '/T', '/F'], capture_output=True)


def resume_ic_series(root, reason, reopen=None, keep_ic=False, no_pause=False):
    """Continue a blocked series with the current IC build and promotion rules; recorded in series.json."""
    root = Path(root).resolve()
    state = json.loads((root / 'series-results.json').read_text(encoding='utf-8'))
    if state['status'] == 'completed':
        raise ValueError('A completed series cannot be resumed')
    config = json.loads((root / 'series.json').read_text(encoding='utf-8'))
    number = len(config.get('resumes', [])) + 1
    dist = Path(config['ic']['dist']) if keep_ic else PROJECT / '.scratch' / f'{root.name}-resume{number}' / 'dist'
    built = subprocess.CompletedProcess([], 0, '', '') if keep_ic else subprocess.run([NODE, str(PROJECT / 'node_modules/typescript/bin/tsc'), '-p', str(PROJECT / 'tsconfig.build.json'), '--outDir', str(dist)],
                           cwd=PROJECT, capture_output=True, text=True)
    if built.returncode:
        raise RuntimeError('IC build failed: ' + built.stdout[-3000:] + built.stderr[-3000:])
    source = Path(__file__).parent
    replaced = {}
    # The host bridge and the example runner go with the IC build: the examples and ledger the new IC records are run by them.
    # Keeping the IC build keeps the bridge and example runner that go with it.
    # The in-round acceptance is harness too: its checks are replaced with the other harness files.
    harness = ['run_series.py', 'run_results.py', 'run_ic_series.py', 'run_r1.py', 'execution-context.md',
               'acceptance_repair.py', 'static_units.py', 'error_probes.py', 'drift_labels.py',
               # v6: post-PRD checks, V2 reconciliation and cost records go with the other harness files.
               'post_prd.py', 'check_reconcile.py', 'ic_checks.py', 'round_reconcile.py', 'costs.py']
    for name in harness + ([] if keep_ic else ['ic_bridge.py', 'example_runner.py']):
        before = run_r1.sha(root / 'adapter' / name) if (root / 'adapter' / name).exists() else None
        shutil.copy2(source / name, root / 'adapter' / name)
        if run_r1.sha(root / 'adapter' / name) != before:
            replaced[name] = {'before': before, 'after': run_r1.sha(root / 'adapter' / name)}
    previous_budget = config['management_budget']
    config['management_budget'] = MANAGEMENT_BUDGET
    config.setdefault('resumes', []).append({
        'reason': reason, 'reopen': reopen, 'ic_kept': keep_ic, 'pause_below_floor': not no_pause and config.get('pause_below_floor', True), 'management_budget': {'before': previous_budget, 'after': MANAGEMENT_BUDGET}, 'at': dt.datetime.now(dt.timezone.utc).isoformat(), 'replaced_adapter_files': replaced,
        'previous_adapter_digest': config['adapter_digest'], 'previous_ic': config['ic']})
    if no_pause:
        config['pause_below_floor'] = False
    config['adapter_digest'] = adapter_digest(root / 'adapter')
    config['frozen_files'] = {p.relative_to(root).as_posix(): run_r1.sha(p) for folder in [root / 'adapter', root / 'sdd-source'] for p in folder.rglob('*') if p.is_file()}
    config['ic'] = config['ic'] if keep_ic else {'dist': str(dist), 'files': {p.relative_to(dist).as_posix(): run_r1.sha(p) for p in dist.rglob('*') if p.is_file()},
                    'source_head': subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=PROJECT, capture_output=True, text=True).stdout.strip(),
                    'source_uncommitted': subprocess.run(['git', 'status', '--short', 'src'], cwd=PROJECT, capture_output=True, text=True).stdout.splitlines()}
    run_r1.write_json(root / 'series.json', config)
    return number


if __name__ == '__main__':
    if len(sys.argv) in (4, 5, 6) and sys.argv[1] == '--continue':
        # Internal: run the resumed series with the adapter copy that resume just updated.
        rest = sys.argv[4:]
        execute_ic_series(sys.argv[2], int(sys.argv[3]), '--retry-paused' in rest,
                          int(rest[rest.index('--retry-round') + 1]) if '--retry-round' in rest else None)
        raise SystemExit(0)
    parser = argparse.ArgumentParser()
    parser.add_argument('--launch')
    parser.add_argument('--adopt-r1', help='freeze a series that adopts this completed R1 SDD trial')
    parser.add_argument('--resume')
    parser.add_argument('--reason')
    parser.add_argument('--retry-paused', action='store_true', help='rerun the paused round once after a fix')
    parser.add_argument('--retry-round', type=int, help='with --resume: rerun this promoted round once (operator decision; the store and records return to its checkpoint)')
    parser.add_argument('--trial-prefix', default=TRIAL_PREFIX, help='names this series and its trials (a new IC version gets its own)')
    parser.add_argument('--ledger-from-round', type=int, default=1, help='first round whose returned code is run against the examples (an adopted R1 before it is not)')
    parser.add_argument('--keep-ic', action='store_true', help='resume with the frozen IC build and bridge of the series (only the harness files are replaced)')
    parser.add_argument('--no-pause', action='store_true', help='rounds below the pass floor go on instead of pausing (recorded as below_floor)')
    parser.add_argument('--reopen', type=int, help='extra management calls for a rejected batch (only after user approval)')
    parser.add_argument('--acceptance-repair', action='store_true', help='freeze: after SDD returns, IC accepts the code and has SDD prd-fix what failed (acceptance_repair.py)')
    parser.add_argument('--native', help='freeze: the management host launcher (v5: the strict OpenCode build)')
    parser.add_argument('--from-checkpoint', type=int, help='with --resume: restart at this round from the checkpoint of the round before')
    args = parser.parse_args()
    if args.resume and args.from_checkpoint:
        restore_checkpoint(Path(args.resume), args.from_checkpoint, args.reason or 'unspecified')
    if args.resume and args.retry_round:
        # Back to the end of that round (whatever started after it is archived), then its checkpoint is archived too: it is rewritten after the rerun.
        archive = restore_checkpoint(Path(args.resume), args.retry_round + 1, args.reason or 'unspecified')
        shutil.move(str(Path(args.resume) / 'checkpoints' / f'r{args.retry_round:02d}'), str(archive / f'r{args.retry_round:02d}'))
    if args.resume:
        root = Path(args.resume).resolve()
        number = resume_ic_series(root, args.reason or 'unspecified', args.reopen, args.keep_ic, args.no_pause)
        raise SystemExit(subprocess.call([sys.executable, str(root / 'adapter/run_ic_series.py'), '--continue', str(root), str(number)]
                                         + (['--retry-paused'] if args.retry_paused else []) + (['--retry-round', str(args.retry_round)] if args.retry_round else [])))
    if args.launch:
        runner = Path(args.launch).resolve() / 'adapter/run_ic_series.py'
        if runner != Path(__file__).resolve():
            raise SystemExit(subprocess.call([sys.executable, str(runner), '--launch', str(Path(args.launch).resolve())]))
        execute_ic_series(args.launch)
    else:
        freeze_ic_series(args.adopt_r1, args.trial_prefix, args.ledger_from_round, args.acceptance_repair, not args.no_pause, args.native)
