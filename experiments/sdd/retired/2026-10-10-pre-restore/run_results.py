"""Read evidence, not process exit-code claims."""
import hashlib
import json
from pathlib import Path
import re


def verdict(path, skill):
    if not path.is_file():
        return {'status': 'missing'}
    matches = re.findall(r'<!--VERDICT:(.*?)-->', path.read_text(encoding='utf-8'), re.S)
    candidates = []
    for match in matches:
        try:
            data = json.loads(match)
        except ValueError:
            continue
        if data.get('skill') == skill:
            candidates.append(data)
    if not candidates:
        return {'status': 'missing_verdict'}
    last = candidates[-1]
    passed = last.get('pass') is True
    if skill == 'prd-check':
        passed = passed and type(last.get('unresolved')) is int and last['unresolved'] == 0 and last.get('blocked', 0) == 0
    return {'status': 'pass' if passed else 'fail', 'verdict': last}


def stage_result(run, stage):
    run = Path(run)
    if stage == 'coding':
        result = verdict(run / 'repos/main/.verdict.md', 'coding')
        if not (run / 'repos/main/.coding-done').is_file():
            result['status'] = 'missing_coding_gate'
        return result
    if stage == 'prd':
        result = verdict(run / 'output/08-验证结果.md', 'prd-check')
        tsv = run / 'output/result-prdcheck.tsv'
        fields = tsv.read_text(encoding='utf-8').strip().split('\t') if tsv.exists() else []
        if len(fields) != 5 or fields[2] != '1' or fields[4] != 'PASS':
            result['status'] = 'fail_or_missing_prd_gate'
        return result
    if stage == 'design':
        # Individual states avoid equating successful shell termination with
        # accepted stage outputs. The upstream writes lowercase 'passed'.
        states = {}
        for name in ['prd', 'sd', 'change', 'specart']:
            path = run / 'logs' / f'{name}.state.json'
            data = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
            states[name] = data.get('status')
        result = {'status': 'pass' if all(v == 'passed' for v in states.values()) else 'fail_or_missing_design_gate', 'states': states}
        # Upstream falls back to "artifact directory exists" when SpecArt wrote
        # no verdict, so its state alone cannot show that review and
        # accept-design completed. The host additionally runs start-implementation.
        result['specart_verdict'] = verdict(run / 'output/06-Spec骨架/verdict.md', 'specart')
        if result['status'] == 'pass' and result['specart_verdict']['status'] != 'pass':
            result['status'] = 'specart_verdict_' + result['specart_verdict']['status']
        flow_log = run / 'logs/specart.log'
        if flow_log.is_file() and '退出码非 0' in flow_log.read_text(encoding='utf-8', errors='replace'):
            result['specart_process_exit_nonzero'] = True
        return result
    raise ValueError(stage)


def source_hash(project):
    h = hashlib.sha256()
    for p in sorted(Path(project).rglob('*')):
        rel = p.relative_to(project)
        ignored = {'.git', '.specart', '.specart-verify', '.system-design', '.verdict.md', '.coding-done', '.sdd-build'}
        if not p.is_file() or any(x in ignored for x in rel.parts):
            continue
        if p.suffix in {'.exe'} or p.name == 'dpipe':
            continue
        h.update(rel.as_posix().encode()); h.update(b'\0'); h.update(p.read_bytes()); h.update(b'\0')
    return h.hexdigest()


def official_result(log, build_exit):
    text = Path(log).read_text(encoding='utf-8', errors='replace') if Path(log).exists() else ''
    cases = [(identity, 'pass' if status == 'success' else status)
             for identity, status in re.findall(r'^CASE_RESULT case_id=(\S+)[^\r\n]*? status=(success|pass|fail)\b', text, re.M)]
    results = dict(cases)
    summary = re.findall(r'^CASE_SUMMARY total_cases=(\d+) success_count=(\d+) fail_count=(\d+)\s*$', text, re.M)
    counts = (len(results), sum(v == 'pass' for v in results.values()), sum(v == 'fail' for v in results.values()))
    complete = bool(summary) and tuple(map(int, summary[-1])) == counts and len(cases) == len(results) and len(results) > 0
    return {'status': 'missing_build_result' if build_exit is None else 'build_failed' if build_exit != 0 else 'evaluated' if complete else 'incomplete_results',
            'build_exit_code': build_exit, 'passed': sum(v == 'pass' for v in results.values()),
            'total': len(results)}
