"""V2: reconcile each class of IC check with the official result of the same code.

The official verifier is used here to calibrate IC's own checkers, never to derive or
rewrite requirements or examples: the verdict only decides whether a class of checks
is trustworthy enough to be sent back to SDD (a class with any IC false positive is not).

Each IC check item is matched to official cases by code:
- a unit (`op:clip`, `command:compare`, `type:drift`) to the cases whose requirement_ref
  names it (`transform.clip`, `compare`, ...);
- an error probe (`<command>:<kind>`) to the cases whose intent or scenario names the
  same error kind (missing file, malformed JSON, missing flag) and the command, or, when
  no case names the command, to the generic `error-handling` cases of that kind;
- an executable example or a P1/P2 call to the cases whose requirement_ref names its
  command or operation.

Item verdicts: consistent (both pass, or IC fails and a matched case fails), ic_false_positive
(IC fails, every matched case passes), ic_missed (IC passes, a matched case of the same
kind fails; only for kind-matched classes), unmatched (no official case).
"""
import re
from collections import Counter, defaultdict
from pathlib import Path

CASE = re.compile(r'CASE_RESULT case_id=(\S+) origin_step=(\S+) requirement_ref=(\S+) case_type=(\S+) status=(\S+) intent="([^"]*)" scenario="([^"]*)"')
KINDS = {
    'missing-file': re.compile(r'missing (input )?file|file not found|nonexistent file|does not exist', re.I),
    'malformed-json': re.compile(r'malformed json|invalid json', re.I),
    'missing-flag': re.compile(r'missing (required )?(flag|option|--)|is required', re.I),
}


def official_cases(log):
    return [{'id': m.group(1), 'step': m.group(2), 'ref': m.group(3), 'passed': m.group(5) == 'success', 'intent': m.group(6), 'scenario': m.group(7)}
            for m in CASE.finditer(Path(log).read_text(encoding='utf-8', errors='replace'))]


def _ref_names(ref):
    return set(re.split(r'[.\-]', ref.lower()))


def match_unit(name, cases):
    n = name.lower()
    return [c for c in cases if n in _ref_names(c['ref']) or c['ref'].lower() == n]


def probe_kind(probe_id):
    kind = probe_id.split(':', 1)[1]
    return next((k for k in KINDS if kind.startswith(k)), kind)


def match_probe(probe_id, cases):
    """(matched cases, how): the command's own cases of this error kind, else the generic error-handling ones."""
    command, kind = probe_id.split(':', 1)[0].lower(), probe_kind(probe_id)
    rx = KINDS.get(kind)
    if rx is None:
        return [], 'kind unknown'
    of_kind = [c for c in cases if rx.search(c['intent'] + ' ' + c['scenario'])]
    own = [c for c in of_kind if command in _ref_names(c['ref']) or re.search(r'\b' + re.escape(command) + r'\b', (c['intent'] + ' ' + c['scenario']).lower())]
    if own:
        return own, 'command and kind'
    generic = [c for c in of_kind if c['ref'] == 'error-handling' and not re.search(r'\b(command|step)\b', c['intent'].lower())]
    return generic, 'generic kind' if generic else 'none'


def verdict(ic_failed, matched, kind_matched):
    if not matched:
        return 'unmatched'
    official_failed = any(not c['passed'] for c in matched)
    if ic_failed:
        return 'consistent' if official_failed else 'ic_false_positive'
    return 'ic_missed' if official_failed and kind_matched else 'consistent'


def reconcile(items, log):
    """items: [{class, id, failed, match: 'unit'|'probe'|'name', name?}] -> {rows, summary, gate}."""
    cases = official_cases(log)
    rows = []
    for it in items:
        if it['match'] == 'probe':
            matched, how = match_probe(it['id'], cases)
            kind_matched = True
        else:
            matched, how = match_unit(it['name'], cases), 'name'
            kind_matched = it['match'] == 'unit_kind'
        rows.append({**{k: it[k] for k in ('class', 'id', 'failed')}, 'how': how, 'official': [f"{c['id']}:{'pass' if c['passed'] else 'fail'}" for c in matched][:8],
                     'official_failed': sum(not c['passed'] for c in matched), 'official_total': len(matched),
                     'verdict': verdict(it['failed'], matched, kind_matched)})
    summary = defaultdict(Counter)
    for r in rows:
        summary[r['class']][r['verdict']] += 1
    gate = {cls: ('closed' if counts['ic_false_positive'] else 'open') for cls, counts in summary.items()}
    return {'rows': rows, 'summary': {k: dict(v) for k, v in summary.items()}, 'gate': gate}


def table(result):
    lines = ['| 检查类 | 一致 | IC 误报 | IC 漏报 | 无法对应 | 闸门 |', '|---|---|---|---|---|---|']
    for cls, c in result['summary'].items():
        lines.append(f"| {cls} | {c.get('consistent', 0)} | {c.get('ic_false_positive', 0)} | {c.get('ic_missed', 0)} | {c.get('unmatched', 0)} | {result['gate'][cls]} |")
    return '\n'.join(lines)
