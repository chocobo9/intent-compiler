"""Defect corpus from official per-case results of many products of the same round, local only.

Input: a tab-separated list of products (name, official round directory with <commit>/verifier.log) and the round.
Output (markdown + json): every case that fails on at least one product, keyed by scenario (stable across rounds),
with its requirement, intent, case type, how many and which products fail it, what each failing product produced,
and the lines of the official test that set it up (read after the fact, never given to the system).
Usage: python defect_corpus.py <products.tsv> <round> <out-prefix>
"""
import json, re, sys
from pathlib import Path

TESTS = Path('D:/huawei/EvoCodeBench/data/evocodebench_wotraj/theme_d5_w9_data_engineering_reproducibility_verification/steps')
LINE = re.compile(r'CASE_RESULT case_id=(\S+)[^\r\n]*?requirement_ref=(\S+) case_type=(\S+) status=(success|pass|fail)\b[^\r\n]*?intent="([^"]*)" scenario="([^"]*)"[^\r\n]*?actual="([^"]*)"')


def product_cases(round_dir):
    subs = [s for s in Path(round_dir).iterdir() if s.is_dir() and not s.name.startswith('dir-') and (s / 'verifier.log').exists()]
    text = (subs[0] / 'verifier.log').read_text(encoding='utf-8', errors='replace')
    return {scen: dict(req=req, type=ctype, intent=intent, ok=st in ('success', 'pass'), actual=actual)
            for _cid, req, ctype, st, intent, scen, actual in LINE.findall(text)}


def test_setup(test_sh, scenario, before=24):
    lines = test_sh.splitlines()
    for i, l in enumerate(lines):
        if re.search(r'^\s*check\w*\s+"' + re.escape(scenario) + '"', l):
            return '\n'.join(lines[max(0, i - before):i + 1])
    return ''


def main(products_tsv, rnd, out):
    products = [l.split('\t') for l in Path(products_tsv).read_text(encoding='utf-8').splitlines() if l.strip() and not l.startswith('#')]
    data = {name.strip(): product_cases(d.strip()) for name, d in products}
    test_sh = (TESTS / f'round-{rnd}' / 'tests' / 'test.sh').read_text(encoding='utf-8', errors='replace')
    scenarios = sorted({s for cases in data.values() for s, c in cases.items() if not c['ok']})
    corpus = []
    for s in scenarios:
        meta = next(c for cases in data.values() for k, c in cases.items() if k == s)
        fails = {n: cases[s]['actual'] for n, cases in data.items() if s in cases and not cases[s]['ok']}
        corpus.append(dict(scenario=s, requirement=meta['req'], intent=meta['intent'], type=meta['type'],
                           fails=len(fails), of=sum(s in c for c in data.values()), failing=fails, setup=test_setup(test_sh, s)))
    corpus.sort(key=lambda d: (-d['fails'], d['requirement'], d['scenario']))
    Path(out + '.json').write_text(json.dumps(corpus, ensure_ascii=False, indent=1), encoding='utf-8')
    md = [f'# Defect corpus, round {rnd}: {len(corpus)} failing cases over {len(data)} products', '',
          '| failing products | requirement | intent | scenario | type |', '|---|---|---|---|---|']
    md += [f"| {d['fails']}/{d['of']} | {d['requirement']} | {d['intent']} | {d['scenario']} | {d['type']} |" for d in corpus]
    Path(out + '.md').write_text('\n'.join(md) + '\n', encoding='utf-8')
    print('\n'.join(md[:3]))
    print(f'{len(corpus)} defects; by number of failing products:', {k: sum(d["fails"] == k for d in corpus) for k in sorted({d["fails"] for d in corpus})})


if __name__ == '__main__':
    main(*sys.argv[1:4])
