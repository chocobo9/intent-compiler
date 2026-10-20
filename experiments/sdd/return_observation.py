"""v8 items 6 and 7, record only (they change no delivery): after a round, what the returned products show.

Item 6, landing: every change of this round and every earlier revision still open, against the executable examples of
this round's delivery run on the adopted code (the bridge ran them when it collected the run). An example belongs to a
change when it rests on one of the change's items and its text names the change (a subject, or for a revision a value
it set). Landed: all such examples passed; not landed: one failed; unknown: none ran.

Item 7, return leg: SDD's PRD and change document read as observations, never as requirements. The PRD: which names
this delivery gave (field-dictionary names, change subjects and parameters) it does not write, and which values a
revision of this round replaced it still writes. The change document: which of this round's changes (and earlier
changes put back as not landed) it names, and which it leaves out.
"""
import json
import re
from pathlib import Path

import run_r1


def norm(value):
    return re.sub(r'[^a-z0-9]', '', value.lower())


def words(text):
    return {norm(w) for w in re.findall(r'[A-Za-z_][A-Za-z0-9_-]*', text)} - {''}


def change_names(change):
    names = set(change.get('subjects', [])) | {p.lstrip('-') for p in change.get('parameters', [])}
    names |= {w for w in re.findall(r'[A-Za-z_][A-Za-z0-9_-]*', change.get('subject', '')) if len(w) >= 3}
    return {norm(n) for n in names if len(norm(n)) >= 3}


def example_text(e):
    run = e.get('run') or {}
    return '\n'.join([e.get('subject', ''), e.get('given', ''), e.get('expect', ''), *run.get('args', []), *[f.get('content', '') for f in run.get('files', [])]])


def landing(store, event_id):
    """Item 6: three-state landing of this round's changes and the earlier revisions still open."""
    batch = next(b for b in store['batches'] if b['event_id'] == event_id)
    delivery = batch.get('delivery') or {}
    contract = delivery.get('contract') or {}
    run = next((r for r in reversed(store['runs']) if r['event_id'] == event_id and r.get('result') and not r.get('superseded')), None)
    results = {r['id']: r['passed'] for r in ((run or {}).get('result') or {}).get('example_results', [])}
    examples = contract.get('executable', [])
    subjects = [dict(c, origin=event_id) for c in delivery.get('changes', [])]
    subjects += [dict(r, origin=r['event_id']) for r in contract.get('revisions', []) if r.get('state') == 'open' and r.get('event_id') != event_id]
    out = []
    for c in subjects:
        # A revision with values it set is observed by an example that states one of them; otherwise by its names.
        values = [norm(v) for v in c.get('new_values', []) if norm(v)] if c.get('kind') == 'revised' else []
        names = change_names(c)
        about = (lambda e: any(v in norm(example_text(e)) for v in values)) if values else (lambda e: bool(words(example_text(e)) & names))
        mine = [e for e in examples if set(e.get('items', [])) & set(c.get('items', [])) and about(e)]
        ran = [results[e['id']] for e in mine if e['id'] in results]
        state = 'unknown' if not ran else 'landed' if all(ran) else 'not_landed'
        out.append({'update': c['origin'], 'subject': c['subject'], 'kind': c.get('kind'), 'state': state,
                    'examples': [{'id': e['id'], 'tier': e.get('tier'), 'passed': results.get(e['id'])} for e in mine]})
    return out


def returned(store, event_id, trial):
    """Item 7: what SDD's PRD and change document show about this delivery."""
    batch = next(b for b in store['batches'] if b['event_id'] == event_id)
    delivery = batch.get('delivery') or {}
    run = run_r1.run_directory(Path(trial))
    prd_path, change_path = run / 'output/02-澄清后PRD.md', run / 'output/05-变更说明书.md'
    prd = prd_path.read_text(encoding='utf-8') if prd_path.exists() else None
    change = change_path.read_text(encoding='utf-8') if change_path.exists() else None
    fields = [f['field'] for o in (delivery.get('contract') or {}).get('fields', []) if not o.get('carried') for f in o.get('fields', [])]
    changes = delivery.get('changes', [])
    names = sorted({*fields, *(p for c in changes for p in c.get('parameters', [])), *(s for c in changes for s in c.get('subjects', []))})
    record = {'prd': None, 'change_document': None}
    if prd is not None:
        prd_words = words(prd)
        record['prd'] = {'names_delivered': len(names), 'names_missing': [n for n in names if norm(n) not in prd_words],
                         'replaced_values_still_written': sorted({v for c in changes if c.get('kind') == 'revised' for v in c.get('old_values', []) if norm(v) and norm(v) in prd_words})}
    if change is not None:
        change_words = words(change)
        not_landed = [x['subject'] for x in (delivery.get('zones') or {}).get('not_landed', [])]
        planned, missed = [], []
        for c in changes:
            (planned if change_names(c) & change_words else missed).append(c['subject'])
        earlier = [s for s in not_landed if {w for w in words(s) if len(w) >= 3} & change_words]
        record['change_document'] = {'planned': planned, 'missed': missed, 'not_landed_planned': earlier,
                                     'not_landed_missed': [s for s in not_landed if s not in earlier]}
    return record


def observe(root, number, trial):
    store = json.loads((Path(root) / 'store/ci-sdd.json').read_text(encoding='utf-8'))
    event_id = f'r{number}-user-input'
    return {'landing': landing(store, event_id), 'returned': returned(store, event_id, trial)}
