"""Every IC code check on one code directory, passing items included, for V2 reconciliation.

Classes: unit (static unit dispatch), probe (code-built error paths), and the post-PRD checks
added in v6 (stub, structure). No model is called; inputs come only from the original text.
"""
from pathlib import Path

import error_probes
import example_runner
import static_units


def unit_items(code_dir, texts):
    named = static_units.units(texts)
    missing = set(static_units.missing(code_dir, list(named)))
    return [{'class': 'unit', 'id': f'unit:{k}:{n}', 'name': n, 'failed': (k, n) in missing, 'match': 'unit'} for (k, n) in named]


def probe_items(code_dir, texts, upto):
    ps = error_probes.probes(texts, upto)
    res = example_runner.run_examples(code_dir, ps)
    items = []
    for p, r in zip(ps, res['results']):
        bad = list(r['failures'])
        if p.get('nonzero') and r['observed'] and r['observed']['exit_code'] == 0:
            bad.append('exit code 0 (expected non-zero)')
        items.append({'class': 'probe', 'id': p['id'], 'failed': bool(bad), 'failures': bad, 'match': 'probe'})
    return items, res['build_exit']
