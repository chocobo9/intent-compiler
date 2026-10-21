"""Cross-round tracking of official cases by a stable key, local only.

Official case ids are renumbered every round (c092 is a manifest size check in R4 and a BLAKE2b check in R5), so a
case is followed by (requirement_ref, intent, scenario) instead. For each round: failures, failures new this round,
of which the case existed and passed in the previous round (a regression), and failures that were fixed.
Usage: python case_tracking.py <run-root>/official[-diag]
"""
import re, sys
from pathlib import Path

LINE = re.compile(r'CASE_RESULT case_id=(\S+)[^\r\n]*?requirement_ref=(\S+)[^\r\n]*? status=(success|pass|fail)\b[^\r\n]*?intent="([^"]*)" scenario="([^"]*)"')


def load(round_dir):
    subs = [s for s in round_dir.iterdir() if s.is_dir() and not s.name.startswith('dir-') and (s / 'verifier.log').exists()]
    text = (subs[0] / 'verifier.log').read_text(encoding='utf-8', errors='replace')
    out = {}
    for cid, req, status, intent, scenario in LINE.findall(text):
        out[(req, intent, scenario)] = ('pass' if status in ('success', 'pass') else 'fail', cid)
    return out


def main(root):
    prev = None
    print('| round | cases | fail | new fail | of which regressions (passed last round) | fixed |')
    print('|---|---|---|---|---|---|')
    details = []
    for d in sorted(Path(root).glob('round-*')):
        cur = load(d)
        fails = {k for k, v in cur.items() if v[0] == 'fail'}
        if prev is None:
            new, reg, fixed = fails, set(), set()
        else:
            prev_fail = {k for k, v in prev.items() if v[0] == 'fail'}
            new = fails - prev_fail
            reg = {k for k in new if k in prev and prev[k][0] == 'pass'}
            fixed = {k for k in prev_fail if k in cur and cur[k][0] == 'pass'}
        print(f'| {d.name} | {len(cur)} | {len(fails)} | {len(new)} | {len(reg)} | {len(fixed)} |')
        for k in sorted(reg):
            details.append(f'{d.name} regression {cur[k][1]}: {k[0]} | {k[1]} | {k[2]}')
        prev = cur
    if details:
        print('\nRegressions:')
        for line in details:
            print('- ' + line)


if __name__ == '__main__':
    main(sys.argv[1])
