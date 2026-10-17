"""Token and stop records per round (M8), read from what the run wrote. Unknown stays unknown, never 0.

SDD stages: every `step_finish` of each stage's stream under runs/<r>/logs. A stage stream records its
root session only; sessions a stage spawns (SpecArt's sub-agents) are not in it, so those stage totals
are marked partial. Acceptance repair: its prd-fix and P2-judge streams. Management: the store's call usage.
"""
import json
import re
from pathlib import Path

import run_r1

STEP = re.compile(r'"type":"step-finish","tokens":(\{"total":[^{}]*(?:\{[^{}]*\}[^{}]*)?\})')
KEYS = ('input', 'output', 'reasoning', 'cache_read', 'cache_write')
# Tool or environment faults a stage's own conclusion names (D4: recorded; only stops before coding are rerun).
TOOL_MARKERS = re.compile(r'no Go proof adapter[^.;\n]*|lacked specart-validate|specart-validate[^.;\n]{0,40}(?:not found|missing|unavailable)|not a git (?:repository|work tree)|未纳入 Git', re.I)
# Stages known to spawn sessions outside their root stream.
PARTIAL = ('specart',)


def stream_tokens(path):
    """Summed tokens of one stream's step_finish records; None when the stream does not exist."""
    path = Path(path)
    if not path.exists():
        return None
    total = dict.fromkeys(KEYS, 0)
    steps = 0
    for match in STEP.finditer(path.read_text(encoding='utf-8', errors='replace')):
        try:
            t = json.loads(match.group(1))
        except ValueError:
            continue
        steps += 1
        total['input'] += t.get('input', 0)
        total['output'] += t.get('output', 0)
        total['reasoning'] += t.get('reasoning', 0)
        total['cache_read'] += (t.get('cache') or {}).get('read', 0)
        total['cache_write'] += (t.get('cache') or {}).get('write', 0)
    return dict(total, steps=steps)


def add(a, b):
    return {k: a.get(k, 0) + b.get(k, 0) for k in (*KEYS, 'steps')}


def sdd_tokens(trial):
    """Per stage stream of the SDD run (stage name = stream file stem), plus the total of what was recorded."""
    logs = run_r1.run_directory(Path(trial)) / 'logs'
    stages = {p.stem: stream_tokens(p) for p in sorted(logs.glob('*.stream'))} if logs.exists() else {}
    total = dict.fromkeys((*KEYS, 'steps'), 0)
    for v in stages.values():
        total = add(total, v)
    partial = sorted(name for name in stages if name.startswith(PARTIAL))
    return {'stages': stages, 'total': total if stages else None,
            'partial': partial, 'partial_reason': 'sub-agent sessions are not in the stage root stream' if partial else None}


def repair_tokens(trial):
    """Acceptance repair: prd-fix passes and the P2 judge (None when no repair ran)."""
    work = Path(trial) / 'acceptance'
    streams = sorted(work.glob('prdfix-pass*.stream')) + sorted(work.glob('prdfix-pass*.continue-failed')) + sorted(work.glob('p2-judge.stream'))
    if not streams:
        return None
    total = dict.fromkeys((*KEYS, 'steps'), 0)
    per = {}
    for p in streams:
        t = stream_tokens(p)
        per[p.name] = t
        total = add(total, t)
    return {'streams': per, 'total': total}


def management_tokens(batch):
    """IC management calls of one user update from its batch record: budgeted calls and the examples stage apart."""
    out = {}
    for group, stages in (('budgeted', ('ir', 'ci', 'check')), ('examples_stage', ('examples', 'derive'))):
        calls = [c for c in batch.get('calls', []) if c.get('stage') in stages]
        usage = [((c.get('call') or {}).get('usage')) for c in calls]
        known = [u for u in usage if u]
        out[group] = {'calls': len(calls), 'calls_without_usage': len(usage) - len(known),
                      **{k: sum(u.get(f'{k}_tokens', 0) for u in known) for k in KEYS}}
    return out


def stop_record(trial, completion, promotion):
    """Where SDD stopped and why, verbatim from its own conclusion; whether code sees a tool or environment fault."""
    failure = (promotion or {}).get('failure')
    if not failure:
        return None
    run = run_r1.run_directory(Path(trial))
    stage = failure.get('stopped_stage')
    results = completion.get('results', {})
    design = results.get('design', {})
    verdict_status = (design.get('specart_verdict') or {}).get('status') if stage == 'specart' else None
    tool = []
    if stage == 'specart' and verdict_status in ('missing', 'missing_verdict'):
        tool.append('SpecArt exited without a verdict')
    if stage in ('prd', 'sd', 'change') and not failure.get('stage_conclusion'):
        tool.append(f'{stage} wrote no conclusion')
    # A tool or environment fault the stage itself names (any stage, coding included).
    for marker in TOOL_MARKERS.findall(failure.get('stage_conclusion') or ''):
        tool.append(f'stage reports: {marker}')
    # The IC watchdog stopped a model request that never returned.
    marker = Path(trial) / 'watchdog.json'
    if marker.exists():
        tool.append('watchdog: ' + json.loads(marker.read_text(encoding='utf-8')).get('reason', 'request hang'))
    # The same hang stopped by the operator before the watchdog existed (v6 pilot R1, user decision).
    operator = Path(trial) / 'operator-stop.json'
    if operator.exists():
        tool.append('operator stop: ' + json.loads(operator.read_text(encoding='utf-8')).get('reason', 'request hang'))
    log = run / 'flow.log'
    text = log.read_text(encoding='utf-8', errors='replace') if log.exists() else ''
    if re.search(r'timed? ?out|timeout|killed|terminated', text, re.I):
        tool.append('flow log reports a timeout or kill')
    return {'stage': stage, 'coding_entered': (run / 'logs/coding-main.stream').exists(), 'reason': (failure.get('stage_conclusion') or '')[-1500:],
            'flow_errors': failure.get('flow_errors'), 'tool_fault': tool,
            # T by code when a tool or environment fault is visible; H or E are judged from the reason, per round, in the report.
            'class': 'T' if tool else 'H/E (judged in the report)'}
