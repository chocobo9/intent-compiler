"""Where each requirement unit was lost or went astray inside SDD, read from a returned trial.

Labels per unit (the static units of static_units.py); code reads SDD's own artifacts,
nothing is added inside SDD:
  P1  the PRD never names the unit
  P2  a PRD assumption on the unit contradicts what the requirement fixes
      (code locates the assumption lines; one model call judges them)
  C1  the change specification never names a unit this round introduced
  S1  the SpecArt summary never names it, or only inside a line listing several units
  K1  not implemented (no dispatch) in the code SDD returned
  K2  a code-built error probe of the unit fails on the code SDD returned
  K3  the unit passed in the previous round's kept code and fails now
  G1  K1/K2 holds and SDD's own PRD check left no GAP naming the unit
  V1  SDD's coding verdict reports SPEC_GAP/REPAIR_REQUIRED/BLOCKED although the build passed
"""
import json
import re
import subprocess
from pathlib import Path

import run_r1

PRD = 'output/02-澄清后PRD.md'
CHANGE = 'output/05-变更说明书.md'
SUMMARY = 'output/06-Spec骨架/.specart/summary.yaml'
SDD_REPORT = 'output/08-验证结果.md'


def _read(path):
    return Path(path).read_text(encoding='utf-8', errors='replace') if Path(path).exists() else ''


def names(text, name):
    return re.search(r'(?<![A-Za-z0-9_])' + re.escape(name) + r'(?![A-Za-z0-9_])', text) is not None


def assumption_lines(prd, name):
    return [line.strip() for line in prd.splitlines() if '【假设】' in line and names(line, name)]


def labels(trial, round_number, unit_rounds, acceptance, previous_failing=None, all_names=None):
    """unit_rounds: {(kind, name): first round (1-based)}; acceptance: the trial's acceptance_repair record."""
    trial = Path(trial)
    run = run_r1.run_directory(trial)
    archived = trial / 'acceptance'
    prd = _read(run / PRD)
    change = _read(run / CHANGE)
    summary = _read(run / SUMMARY)
    sdd_report = _read(archived / '08-sdd-report.md') or _read(run / SDD_REPORT)
    verdict = _read(archived / 'sdd-main' / '.verdict.md') or _read(run / 'repos/main.bak/.verdict.md') or _read(run / 'repos/main/.verdict.md')
    build_ok = json.loads(_read(trial / 'completion.json') or '{}').get('results', {}).get('official', {}).get('requested_build_exit_code') == 0
    failing = set((acceptance or {}).get('failing_before', []))
    every = all_names or {n for _, n in unit_rounds}
    out = {}
    for (kind, name), first in unit_rounds.items():
        if first > round_number:
            continue
        tags = []
        if not names(prd, name):
            tags.append('P1')
        new = first == round_number
        if new and change and not names(change, name):
            tags.append('C1')
        if new and summary:
            lines = [l for l in summary.splitlines() if names(l, name)]
            if not lines or all(sum(names(l, other) for other in every if other != name) >= 2 for l in lines):
                tags.append('S1')
        k1 = f'unit:{kind}:{name}' in failing
        k2 = any(f.startswith(f'probe:{name}:') for f in failing)
        if k1:
            tags.append('K1')
        if k2:
            tags.append('K2')
        if previous_failing is not None and (k1 or k2) and not any(f in previous_failing for f in failing if f == f'unit:{kind}:{name}' or f.startswith(f'probe:{name}:')):
            if first < round_number:
                tags.append('K3')
        if (k1 or k2) and not names(sdd_report, name):
            tags.append('G1')
        if tags:
            out[f'{kind}:{name}'] = tags
    if re.search(r'SPEC_GAP|REPAIR_REQUIRED|BLOCKED', verdict) and re.search(r'"pass"\s*:\s*false', verdict) and build_ok:
        out['round'] = ['V1']
    return out


def p2_candidates(trial, failures):
    """Failing checks whose unit has PRD assumption lines: {check id: {unit, assumptions}}."""
    prd = _read(run_r1.run_directory(Path(trial)) / PRD)
    out = {}
    for cid, f in failures.items():
        name = f['unit'][1] if f['kind'] == 'unit' else f['probe']['id'].split(':')[0]
        lines = assumption_lines(prd, name)
        if lines:
            out[cid] = {'unit': name, 'assumptions': lines[:5], 'rule': f.get('probe', {}).get('rule') if f['kind'] == 'probe' else None}
    return out


P2_PROMPT = """You judge only whether PRD assumptions contradict the original requirement. Do not edit any file, run any command or use any tool.
For each case below, the original requirement fixes a behaviour, and the PRD contains assumption lines (marked 【假设】) about the same unit.
Answer "contradicts": true only when following the assumption would produce behaviour the original requirement's text rules out.
Reply with exactly one JSON object and nothing else: {"cases": [{"id": "<case id>", "contradicts": true|false, "reason": "<one sentence>"}]}

CASES:
"""


def judge_p2(trial, env, candidates, texts, log):
    """One model call for all candidates of the round; {check id: {'contradicts': bool, 'reason': str}}."""
    if not candidates:
        return {}
    cases = []
    for cid, c in candidates.items():
        original = c['rule'] or next((t[t.find(f'`{c["unit"]}`') - 200: t.find(f'`{c["unit"]}`') + 1500] for t in texts if f'`{c["unit"]}`' in t), '')
        cases.append(f"## {cid}\nOriginal requirement (verbatim excerpt):\n{original.strip()}\nPRD assumption lines:\n" + '\n'.join(c['assumptions']))
    run = run_r1.run_directory(Path(trial))
    # The read-only plan agent: the judgement needs no tool and may change nothing.
    args = ['C:/Program Files/Git/usr/bin/sh.exe', env['OPENCODE_BIN'], 'run', '--agent', 'plan', '--dir', str(run).replace('\\', '/'),
            '--format', 'json', '--auto', '--model', run_r1.MODEL, '--variant', run_r1.VARIANT, '--', P2_PROMPT + '\n\n'.join(cases)]
    with open(log, 'w', encoding='utf-8') as out:
        subprocess.call(args, stdout=out, stderr=subprocess.STDOUT, env=env, cwd=str(run), timeout=1200)
    text = ''
    for line in Path(log).read_text(encoding='utf-8', errors='replace').splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if event.get('type') == 'text':
            text += event.get('part', {}).get('text', '')
    m = re.search(r'\{.*"cases".*\}', text, re.S)
    try:
        answer = json.loads(m.group(0)) if m else {}
    except ValueError:
        answer = {}
    return {c['id']: {'contradicts': bool(c.get('contradicts')), 'reason': c.get('reason', '')} for c in answer.get('cases', []) if c.get('id') in candidates}
