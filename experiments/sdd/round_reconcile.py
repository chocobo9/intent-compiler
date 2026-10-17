"""V2 per round: every IC check class against the official result of the same code, written into the trial.

For the code SDD returned (archived by acceptance when it repaired) and for the code the round ends with.
The official result only calibrates IC's checkers here; it never feeds the round's repair or a CI.
"""
import json
import shutil
import tempfile
from pathlib import Path

import acceptance_repair
import check_reconcile
import ic_checks
import post_prd


def _reconcile_code(code, log, texts, upto, extra=()):
    with tempfile.TemporaryDirectory(prefix='ic-reconcile-') as tmp:
        copy = Path(tmp) / 'code'
        shutil.copytree(code, copy)
        probes, build = ic_checks.probe_items(copy, texts, upto)
        post, _ = post_prd.p1_p2(copy, texts)
        items = ic_checks.unit_items(copy, texts) + probes + post + list(extra)
        result = check_reconcile.reconcile(items, log)
        result['build_exit'] = build
        return result


def reconcile_round(trial, round_number):
    trial = Path(trial)
    texts = acceptance_repair.texts_upto(round_number)
    completion = json.loads((trial / 'completion.json').read_text(encoding='utf-8'))
    record = completion.get('acceptance_repair') or {}
    extra = [dict(it, **{'match': 'name'}) for it in (record.get('recorded_p3') or {}).get('items', [])]
    extra += [dict(it, **{'match': 'name'}) for it in (record.get('recorded_p4') or {}).get('items', [])]
    out = {}
    sdd_code, sdd_log = trial / 'acceptance/sdd-official/official-app', trial / 'acceptance/sdd-official/official-verifier.log'
    if sdd_code.exists() and sdd_log.exists():
        out['sdd_code'] = _reconcile_code(sdd_code, sdd_log, texts, round_number)
    if (trial / 'official-app').exists() and (trial / 'official-verifier.log').exists():
        out['final_code'] = _reconcile_code(trial / 'official-app', trial / 'official-verifier.log', texts, round_number, extra)
    lines = [f'# R{round_number} IC 检查与官方结果对账', '', '对账只用于判定检查器是否可信，不用于改写需求或示例。', '']
    for label, r in out.items():
        lines += [f"## {'SDD 交回的代码' if label == 'sdd_code' else '本轮最终代码'}（构建 {r['build_exit']}）", '', check_reconcile.table(r), '']
        lines += ['| 检查项 | IC | 官方失败/匹配 | 结论 |', '|---|---|---|---|']
        lines += [f"| {x['id']} | {'失败' if x['failed'] else '通过'} | {x['official_failed']}/{x['official_total']} | {x['verdict']} |" for x in r['rows'] if x['failed'] or x['verdict'] != 'consistent']
        lines.append('')
    (trial / 'acceptance').mkdir(exist_ok=True)
    (trial / 'acceptance/reconcile.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    (trial / 'acceptance/reconcile.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return {label: {'summary': r['summary'], 'gate': r['gate']} for label, r in out.items()}
