"""Per-round pilot report, by code (overnight mode, user 2026-10-17): the score, the stop, the V2 reconciliation
tables (acceptance/reconcile.md) and the state of each v6 mechanism (起作用 / 空转 / 未触发), appended to the
pilot results document. The official result is only reported here; it never steers anything IC does.
"""
import datetime as dt
import json
from pathlib import Path


def _read(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def mechanisms(record, batch, delivery, trial, attempts_trials):
    """[(mechanism, state, evidence)] from what the round recorded."""
    rows = []
    calls = batch.get('calls', [])
    shape = sum(len((c.get('call') or {}).get('structured_schema_errors') or []) for c in calls)
    rows.append(('strict 输出（M4/D3）', '起作用' if not shape else f'有形状错误 {shape} 处', f"{batch.get('requests_used')} 次预算内调用"))
    unknown = [c for c in calls if 'source_unknown' in (c.get('error') or '') or 'unknown item' in (c.get('error') or '').lower()]
    rows.append(('动态枚举（M1）', '起作用' if not unknown else f'仍有编号错误 {len(unknown)} 次', f"{sum(1 for c in calls if c.get('error'))} 次被拒收"))
    rows.append(('追加额度（D5）', '触发' if batch.get('reopened') else '未触发', json.dumps(batch.get('reopened'), ensure_ascii=False)[:120] if batch.get('reopened') else '—'))
    rows.append(('编码前 T 类重跑（D1）', '触发' if record.get('t_rerun') else '未触发', '; '.join((record.get('t_rerun') or {}).get('tool_fault', [])) or '—'))
    fired = [t for t in attempts_trials if (Path(t) / 'watchdog.json').exists()]
    rows.append(('看门狗', '触发' if fired else '未触发', ', '.join(Path(t).name for t in fired) or '—'))
    acc = ((record.get('completion') or {}).get('acceptance_repair')) or {}
    rows.append(('未进编码时从基线修（M3）', '触发' if acc.get('start') == 'origin' else '未触发', acc.get('start', '—')))
    if not acc:
        state = '未触发'
    elif acc.get('outcome') == 'nothing_to_repair':
        state = '未触发（无失败项）'
    else:
        state = '起作用' if acc.get('fixed') else '空转'
    rows.append(('验收修复（回送 unit/probe）', state, f"{acc.get('outcome')}；修复前失败 {len(acc.get('failing_before') or [])}，修好 {acc.get('fixed') or []}，最终仍失败 {len(acc.get('failing_final') or [])}"))
    recorded = acc.get('recorded_before') or []
    p1 = [r for r in recorded if r.get('class') == 'p1_stub']
    p2 = [r for r in recorded if r.get('class') == 'p2_structure']
    rows.append(('P1 桩识别（只记录）', '起作用' if any(r.get('failed') for r in p1) else ('未触发' if p1 else '未运行'),
                 f"{len(p1)} 项，失败 {sum(1 for r in p1 if r.get('failed'))}，静态与运行不一致 {sum(1 for r in p1 if r.get('agree') is False)}"))
    rows.append(('P2 输出结构（只记录）', '起作用' if any(r.get('failed') for r in p2) else ('未触发' if p2 else '未运行'),
                 f"{len(p2)} 项，失败 {[r.get('name') for r in p2 if r.get('failed')]}"))
    p3 = (acc.get('recorded_p3') or {}).get('items', [])
    rows.append(('P3 跨轮差分（只记录）', '起作用' if any(i.get('failed') for i in p3) else ('未触发' if p3 else '未运行'), f"{len(p3)} 项，差异 {[i.get('name') for i in p3 if i.get('failed')]}"))
    p4 = (acc.get('recorded_p4') or {}).get('items', [])
    rows.append(('P4 summary 点名（只记录）', '起作用' if any(i.get('failed') for i in p4) else ('未触发' if p4 else f"未运行（{(acc.get('recorded_p4') or {}).get('not_checked')}）"),
                 f"缺点名 {[i.get('name') for i in p4 if i.get('failed')]}"))
    revisions = (delivery.get('contract') or {}).get('revisions') or []
    mine = [r for r in revisions if r.get('event_id') == batch.get('event_id')]
    closed_now = [r for r in revisions if (r.get('closed') or {}).get('event_id') == batch.get('event_id')]
    rows.append(('修订台账（M5a）', '起作用' if revisions else '未触发', f"本轮新开 {len(mine)}，在册未关闭 {sum(1 for r in revisions if r['state'] == 'open')}，本轮关闭 {[(r['id'], r['state']) for r in closed_now]}"))
    rows.append(('before 由代码取（M3）', '触发' if any(r.get('before_by_code') for r in mine) else '未触发', f"缺项 {[(r['subject'][:30], r.get('missing')) for r in mine if r.get('missing')]}"))
    rows.append(('修订确认（C2）', '起作用' if any(r['state'] == 'confirmed' for r in closed_now) else '未触发', '—'))
    rows.append(('原文只交一遍（C1）', f"CI {len(delivery.get('text', ''))} 字符", f"基线 PRD：第 {(delivery.get('baseline_prd') or {}).get('input', '—')} 轮"))
    return rows


def round_section(root, record, store, number):
    root = Path(root)
    config = _read(root / 'series.json') or {}
    batch = next((b for b in store['batches'] if b['event_id'] == f'r{number}-user-input' and b['state'] == 'accepted'), {})
    delivery = batch.get('delivery') or {}
    trial = Path(record['root'])
    completion = record.get('completion') or {}
    acc = completion.get('acceptance_repair') or {}
    official = completion.get('results', {}).get('official', {}) or {}
    sdd_official = acc.get('sdd_official') or official
    stop = record.get('stop') or {}
    cost = record.get('cost') or {}
    mg = (cost.get('management') or {}).get('budgeted') or {}
    resumes = config.get('resumes') or []
    build = config['ic']['source_head'][:7] + (f" + harness 刷新 {len(resumes)} 次（最近：{resumes[-1].get('at', '')[:16]}）" if resumes else '')
    lines = [f'## R{number}（代码生成，{dt.datetime.now().astimezone().isoformat(timespec="minutes")}）', '',
             f"- IC 构建：`{build}`",
             f"- 官方：SDD 交回 {sdd_official.get('passed')}/{sdd_official.get('total')} → 采用 {official.get('passed')}/{official.get('total')}；晋级 {(record.get('promotion') or {}).get('mode')}",
             f"- SDD 停在：{stop.get('stage') or '未停（全流程）'}；分类 {stop.get('class', '—')}；{'；'.join(stop.get('tool_fault') or []) or ''}",
             f"- 停顿理由（原文末尾）：{(stop.get('reason') or '').strip().replace(chr(10), ' ')[-300:] or '—'}",
             f"- 尝试：{len(record.get('attempts', [])) + 1}（{'；'.join(str(a.get('rule'))[:80] for a in record.get('attempts', [])) or '一次'}）",
             f"- 成本：IC 管理 输入 {mg.get('input')} / 输出 {mg.get('output')} / 缓存命中 {mg.get('cache_read')}；SDD（根 stream）{(cost.get('sdd_total') or {}).get('input') if isinstance(cost.get('sdd_total'), dict) else cost.get('sdd_total')}；修复 {((cost.get('repair') or {}).get('total') or {}).get('input')}",
             '', '### 对账表', '']
    rec = trial / 'acceptance/reconcile.md'
    if rec.exists():
        body = rec.read_text(encoding='utf-8').split('\n', 3)[-1]
        lines += [l.replace('## ', '#### ', 1) if l.startswith('## ') else l for l in body.splitlines()]
    else:
        lines.append(f"（未生成：{json.dumps(record.get('reconcile'), ensure_ascii=False)[:200]}）")
    lines += ['', '### 机制状态', '', '| 机制 | 状态 | 依据 |', '|---|---|---|']
    attempts_trials = [a.get('trial') for a in record.get('attempts', []) if a.get('trial')] + [record['root']]
    lines += [f'| {m} | {s} | {e} |' for m, s, e in mechanisms(record, batch, delivery, trial, attempts_trials)]
    return '\n'.join(lines) + '\n\n'


def append(root, record, store, number, document):
    text = round_section(root, record, store, number)
    with Path(document).open('a', encoding='utf-8') as out:
        out.write('\n' + text)
    return text
