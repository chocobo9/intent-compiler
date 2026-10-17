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


HANDOFF = r'(?<![A-Za-z_])(SPEC_GAP|BLOCKED)(?![A-Za-z_])'


def reports_spec_gap(path, result):
    """A failed verdict reporting SpecArt's SPEC_GAP or BLOCKED status, which SpecArt hands to the user."""
    if result.get('status') != 'fail' or not path.is_file():
        return False
    # CAPABILITY_BLOCKED is a proof-capability result, not a hand-off.
    return re.search(HANDOFF, path.read_text(encoding='utf-8', errors='replace')) is not None


def state(run, stage_id):
    path = Path(run) / 'logs' / f'{stage_id}.state.json'
    return json.loads(path.read_text(encoding='utf-8')).get('status') if path.exists() else None


def coding_verdict_path(run):
    """Where SDD's own coding verdict is. A PRD fix rewrites repos/main/.verdict.md with its own
    verdict: upstream backs coding's output up to main.bak before its first fix, and IC's in-round
    acceptance archives the code SDD returned under the trial's acceptance/sdd-main before its own."""
    run = Path(run)
    for candidate in (run / 'repos/main.bak/.verdict.md', run.parent.parent / 'acceptance/sdd-main/.verdict.md'):
        if candidate.is_file():
            return candidate
    return run / 'repos/main/.verdict.md'


def stage_result(run, stage):
    """Upstream gate outcome of one stage, read from the run's own records."""
    run = Path(run)
    if stage == 'coding':
        source = coding_verdict_path(run)
        result = verdict(source, 'coding')
        result['spec_gap'] = reports_spec_gap(source, result)
        result['state'] = state(run, 'main-coding')
        # Upstream writes no state for a failed stage; a written verdict shows coding ran.
        if result['state'] is None and result['status'] in {'missing', 'missing_verdict'}:
            result['status'] = 'not_reached'
        elif result['state'] is None:
            # Coding ran but upstream never recorded it as passed (e.g. its compile gate
            # failed); the model's own verdict does not make it a pass.
            result['status'] = 'fail' if result['status'] == 'fail' else 'not_completed'
        elif not (run / 'repos/main/.coding-done').is_file():
            result['status'] = 'missing_coding_gate'
        return result
    if stage == 'prd':
        result = verdict(run / 'output/08-验证结果.md', 'prd-check')
        result['state'] = state(run, 'main-prdcheck')
        tsv = run / 'output/result-prdcheck.tsv'
        fields = tsv.read_text(encoding='utf-8').strip().split('	') if tsv.exists() else []
        if result['state'] is None:
            result['status'] = 'not_reached'
        elif len(fields) != 5 or fields[2] != '1' or fields[4] != 'PASS':
            result['status'] = 'fail_or_missing_prd_gate'
        return result
    if stage == 'design':
        # The upstream writes lowercase 'passed'.
        states = {name: state(run, name) for name in ['prd', 'sd', 'change', 'specart']}
        result = {'status': 'pass' if all(v == 'passed' for v in states.values()) else 'fail_or_missing_design_gate',
                  'states': states}
        # Upstream records SpecArt as passed when it wrote no verdict but its
        # artifact directory exists. Report whether review and accept-design
        # actually completed instead of counting that fallback as a pass.
        result['specart_verdict'] = verdict(run / 'output/06-Spec骨架/verdict.md', 'specart')
        result['specart_spec_gap'] = reports_spec_gap(run / 'output/06-Spec骨架/verdict.md', result['specart_verdict'])
        result['accepted_design_records'] = sorted(
            p.relative_to(run).as_posix() for p in (run / 'repos/main/.specart-verify').glob('*/accepted.json'))
        if result['status'] == 'pass':
            if result['specart_verdict']['status'] != 'pass':
                result['status'] = 'specart_verdict_' + result['specart_verdict']['status']
            elif not result['accepted_design_records']:
                result['status'] = 'specart_design_not_accepted'
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
    # A case line can follow program output that lacks a final newline
    # (`PIPELINE OK: 1 steps completedCASE_RESULT ...`), so it is not anchored to a line start.
    cases = [(identity, 'pass' if status == 'success' else status)
             for identity, status in re.findall(r'CASE_RESULT case_id=(\S+)[^\r\n]*? status=(success|pass|fail)\b', text)]
    results = dict(cases)
    summary = re.findall(r'^CASE_SUMMARY total_cases=(\d+) success_count=(\d+) fail_count=(\d+)\s*$', text, re.M)
    counts = (len(results), sum(v == 'pass' for v in results.values()), sum(v == 'fail' for v in results.values()))
    complete = bool(summary) and tuple(map(int, summary[-1])) == counts and len(cases) == len(results) and len(results) > 0
    return {'status': 'missing_build_result' if build_exit is None else 'build_failed' if build_exit != 0 else 'evaluated' if complete else 'incomplete_results',
            'build_exit_code': build_exit, 'passed': sum(v == 'pass' for v in results.values()),
            'total': len(results)}


def open_prd_gaps(run):
    """GAPs still open after the last PRD check round, with their report text.

    Each re-check is appended to the report as a new level-2 section; the last
    section that lists GAP headings holds the differences still open.
    """
    rounds = sorted((Path(run) / 'output/08-验证结果').glob('round-*/验证结果.md'),
                    key=lambda p: int(p.parent.name.split('-')[1]))
    if not rounds:
        return []
    current, section, gap = [], [], None
    for line in rounds[-1].read_text(encoding='utf-8', errors='replace').splitlines():
        heading = line.lstrip('#').strip() if line.startswith('#') else None
        if line.startswith('## '):
            section, gap = [], None
        elif heading is not None and line.startswith('###') and heading.startswith('GAP-'):
            gap = {'title': heading, 'text': ''}
            section.append(gap)
            current = section
        elif heading is not None:
            gap = None
        elif gap is not None:
            gap['text'] += line + '\n'
    for item in current:
        item['text'] = item['text'].strip()
    # PRD check counts only PRD_ONLY and MISMATCH as unresolved; CODE_ONLY is
    # extra code left for human review, not a requirement still open.
    return [item for item in current if not re.search(r'差异类型[^\n]*CODE_ONLY', item['text'])]


def prd_check_summary(run):
    """SDD's own PRD consistency check of a run, as returned to the manager."""
    result = stage_result(run, 'prd')
    verdict_data = result.get('verdict', {})
    return {'state': result.get('state'), 'status': result['status'],
            **{key: verdict_data.get(key) for key in ['unresolved', 'blocked', 'manual_review']},
            'open_gaps': open_prd_gaps(run), 'report': 'output/08-验证结果.md'}
