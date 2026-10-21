"""Paired per-case comparison of two arms with the exact McNemar test (DESIGN 13.3), local only.

An arm is either
  sdd                          the frozen SDD-only series (per-round official-verifier.log), or
  <run-root>/official[-diag]   a run scored by bin/score.mjs (round-NN/<commit>/cases.json).
Usage: python paired_mcnemar.py <arm A> <arm B> [--label-a A] [--label-b B]
Per round: cases in both arms, passes, b = A pass & B fail, c = A fail & B pass, two-sided exact p.
Pooled over rounds: the sums of b and c (cases recur across rounds, so read the pooled p as indicative).
"""
import json, math, re, sys
from pathlib import Path

SDD = Path('D:/huawei/EvoCodeBench/harbor_runs/sdd-luna-dpipe-15round-20261011-004124z-b428d7bd/series-results.json')
CASE = re.compile(r'CASE_RESULT case_id=(\S+)[^\r\n]*? status=(success|pass|fail)\b')


def from_log(path):
    text = Path(path).read_text(encoding='utf-8', errors='replace')
    return {k: ('pass' if v in ('success', 'pass') else 'fail') for k, v in CASE.findall(text)}


def arm(spec):
    rounds = {}
    if spec == 'sdd':
        for r in json.loads(SDD.read_text(encoding='utf-8'))['rounds']:
            log = Path(r['root']) / 'official-verifier.log'
            if log.exists():
                rounds[int(r['round'])] = from_log(log)
        return rounds
    for d in sorted(Path(spec).glob('round-*')):
        subs = [s for s in d.iterdir() if s.is_dir() and not s.name.startswith('dir-') and (s / 'cases.json').exists()]
        if subs:
            rounds[int(d.name.split('-')[1])] = json.loads((subs[0] / 'cases.json').read_text(encoding='utf-8'))['cases']
    return rounds


def exact_p(b, c):
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    tail = sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n
    return min(1.0, 2 * tail)


def main(argv):
    la = argv[argv.index('--label-a') + 1] if '--label-a' in argv else 'A'
    lb = argv[argv.index('--label-b') + 1] if '--label-b' in argv else 'B'
    a, b_arm = arm(argv[0]), arm(argv[1])
    print(f'| round | cases | {la} pass | {lb} pass | {la} only | {lb} only | exact p |')
    print('|---|---|---|---|---|---|---|')
    tb = tc = 0
    for r in sorted(set(a) & set(b_arm)):
        ids = set(a[r]) & set(b_arm[r])
        pa = sum(a[r][i] == 'pass' for i in ids)
        pb = sum(b_arm[r][i] == 'pass' for i in ids)
        only_a = sum(a[r][i] == 'pass' and b_arm[r][i] != 'pass' for i in ids)
        only_b = sum(a[r][i] != 'pass' and b_arm[r][i] == 'pass' for i in ids)
        tb += only_a; tc += only_b
        print(f'| R{r} | {len(ids)} | {pa} | {pb} | {only_a} | {only_b} | {exact_p(only_a, only_b):.3g} |')
    print(f'| pooled | | | | {tb} | {tc} | {exact_p(tb, tc):.3g} |')


if __name__ == '__main__':
    main(sys.argv[1:])
