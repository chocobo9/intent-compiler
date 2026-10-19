"""Relation record, v7 0.2 (record only; read-only on trials and stores; no model call).

Per round of a series, from the adopted code, the store's delivery and SDD's PRD:
- units: Go code units (functions, dispatch branches, literal slots) with the strings they hold (units/main.go, run in
  the SDD preflight Docker image, which has the Go toolchain);
- change record: units added, changed and removed against the previous round's adopted code; "no new code" when the
  code is the same;
- revision landing: for each revision on the ledger, in the units named by its subjects: landed when a new value that is
  a code literal is written there and no old literal is; not landed when no new literal is; unknown when its values are
  not code literals (prose) or no unit names its subjects;
- slot check: a literal slot keyed by a string the original writes (`"ingest"`) whose values share nothing with the
  identifiers the original's line for that key gives, in the section of the command the slot's function implements;
- I1 (before delivery): names and ERROR literals of the current original (minus the passages the delivery cuts) that
  IC's own delivered text (the delivery minus the SDD PRD baseline) does not write;
- I2 (after the run): names and ERROR literals of the whole delivered text that SDD's PRD does not write.

Usage: relations_record.py <label> <series-results.json> <store.json> [<revisions store.json>]
The optional revisions store lends its ledger to a series without one (v4). Output: .scratch/relations/<label>/."""
import hashlib, json, re, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import acceptance_repair, error_probes  # noqa: E402

OUT_ROOT = HERE.parents[2] / '.scratch' / 'relations'
PRD = 'output/02-澄清后PRD.md'
BASELINE_HEAD = '# Requirement baseline: the PRD SDD clarified'
norm = lambda v: re.sub(r'[^a-z0-9]', '', v.lower())
flat = lambda t: re.sub(r'\s+', '', t).lower()


# ---------- code units ----------

def code_hash(code):
    h = hashlib.sha256()
    for p in sorted(Path(code).rglob('*.go')):
        if not p.name.endswith('_test.go'):
            h.update(p.relative_to(code).as_posix().encode() + b'\0' + p.read_bytes())
    return h.hexdigest()[:16]


def extract_units(codes, cache):
    """{round: [unit]} for {round: code dir}, one Docker run for the rounds not cached yet."""
    todo = {n: c for n, c in codes.items() if not (cache / f'units-r{n:02d}.json').exists() and Path(c).exists()}
    if todo:
        mounts = sum((['-v', f'{Path(c).resolve()}:/code/r{n:02d}:ro'] for n, c in todo.items()), [])
        script = 'cd /tool && GOCACHE=/tmp/gc GOFLAGS=-buildvcs=false go build -o /tmp/units . && ' + ' && '.join(
            f'/tmp/units /code/r{n:02d} > /out/units-r{n:02d}.json' for n in todo)
        subprocess.run(['docker', 'run', '--rm', '--network', 'none', '-v', f'{HERE / "units"}:/tool:ro', '-v', f'{cache}:/out', *mounts,
                        '--entrypoint', '/bin/bash', 'sdd-unattended-preflight:latest', '-lc', script], check=True,
                       env={**__import__('os').environ, 'MSYS_NO_PATHCONV': '1'})
    out = {}
    for n in codes:
        p = cache / f'units-r{n:02d}.json'
        if p.exists():
            units, seen = json.loads(p.read_text(encoding='utf-8')), {}
            for u in units:
                # The same branch value can open several clauses in one function (nested switches): number them.
                seen[u['id']] = seen.get(u['id'], 0) + 1
                if seen[u['id']] > 1:
                    u['id'] = f"{u['id']}#{seen[u['id']]}"
            out[n] = units
    return out


def change_record(prev, cur, same_code):
    if same_code:
        return {'no_new_code': True, 'added': [], 'changed': [], 'removed': []}
    a = {u['id']: u['hash'] for u in prev or []}
    b = {u['id']: u['hash'] for u in cur}
    return {'no_new_code': False, 'added': sorted(set(b) - set(a)), 'removed': sorted(set(a) - set(b)),
            'changed': sorted(i for i in set(a) & set(b) if a[i] != b[i])}


# ---------- revisions ----------

CODE_LITERAL = re.compile(r'^"?[\w.\-+/:]+"?$')


def code_literal(v, quoted):
    """A value the original writes as a literal (in backticks or quotes in the revision's passages), one token long:
    a name, key or number code can hold. A value the original writes as prose ("**BLAKE2b-256**") is not."""
    v = v.strip().strip('`').strip('"')
    return bool(v) and len(norm(v)) >= 2 and ' ' not in v and bool(CODE_LITERAL.match(v)) and (f'`{v}`' in quoted or f'"{v}"' in quoted)


def landing(rev, units):
    subjects = {norm(s) for s in rev.get('subjects', []) if norm(s)}
    named = [u for u in units if any(s and (s == norm(u['id'].split(':')[-1].split('[')[0].split('#')[0]) or s in norm(u['func'])
                                             or any(s == norm(k) for k in re.findall(r'\["([^"]+)"\]', u['id']))) for s in subjects)]
    quoted = '\n'.join(q.get('text', '') for q in rev.get('now', []) + rev.get('before', []))
    new = [v.strip().strip('`').strip('"') for v in rev.get('new_values', []) if code_literal(v, quoted)]
    old = [v.strip().strip('`').strip('"') for v in rev.get('old_values', []) if code_literal(v, quoted)]
    if not new and not old:
        return {'state': 'unknown', 'why': 'the original writes its values as prose, not literals' if rev.get('new_values') or rev.get('old_values') else 'it names no values'}
    if not named:
        return {'state': 'unknown', 'why': 'no code unit names its subjects'}
    holds = lambda v: [u for u in named if v in u['strings'] or flat(f'"{v}"') in u['src'].lower().replace(' ', '')]
    new_at = {v: holds(v) for v in new}
    old_at = {v: holds(v) for v in old}
    old_left = [(v, f"{u['file']}:{u['line']}") for v, us in old_at.items() for u in us]
    if new and all(new_at[v] for v in new) and not old_left:
        return {'state': 'landed', 'at': sorted({f"{u['file']}:{u['line']}" for us in new_at.values() for u in us})[:6]}
    return {'state': 'not landed', 'missing_new': [v for v in new if not new_at[v]], 'old_still_at': old_left[:6]}


# ---------- slot check ----------

def sections(texts):
    """(heading path, line) for every line of the original updates."""
    out = []
    for text in texts:
        path = []
        for line in text.splitlines():
            m = re.match(r'^(#{1,6})\s+(.*)$', line)
            if m:
                path = [p for p in path if p[0] < len(m.group(1))] + [(len(m.group(1)), m.group(2))]
                continue
            out.append(([t for _, t in path], line))
    return out


def slot_mismatches(units, texts, commands):
    lines = sections(texts)
    out = []
    for u in units:
        # A map literal slot (lit:generateLineage:inputFields["ingest"]) or a dispatch branch (case:lineageMapping:ingest).
        m = re.match(r'^lit:([^:]+):\w+\["(.+)"\]$', u['id']) or re.match(r'^case:([^:]+):([^#]+)$', u['id'])
        if not m:
            continue
        fn, key = m.group(1), m.group(2)
        owners = [c for c in commands if norm(c) and norm(c) in norm(fn)]
        values = [s for s in u['strings'] if s != key]
        for c in owners:
            for path, line in lines:
                # A list line giving the key's values ("- `"ingest"`: input = `file`, output = `output`").
                if not any(re.search(r'\b' + re.escape(c) + r'\b', h, re.I) for h in path) or not re.match(r'^\s*[-*]\s*`"' + re.escape(key) + r'"`\s*:', line):
                    continue
                said = [w for w in re.findall(r'`([A-Za-z_][\w-]*)`', line.split(':', 1)[1]) if w != key and w not in commands]
                if said and values and not set(said) & set(values):
                    out.append({'slot': u['id'], 'at': f"{u['file']}:{u['line']}", 'code': values, 'original': said, 'line': line.strip()[:200]})
    return out


# ---------- invariants ----------

NAME = re.compile(r'`(--[a-z][\w-]*|[A-Za-z_][\w.-]*)`|"([A-Za-z_]\w*)"\s*:')
ERROR = re.compile(r'`(ERROR:[^`]+)`')


def obligations(text):
    names = {a or b for a, b in NAME.findall(text)}
    errors = set(ERROR.findall(text))
    return {n for n in names if len(n) >= 2}, errors


def fragment(error):
    """The longest fixed part of an ERROR literal (placeholders <...> are not written as such)."""
    parts = [p.strip(' :') for p in re.split(r'<[^>]*>', error.replace('ERROR:', ''))]
    return max(parts, key=len) if parts else error


def writes(text, name):
    """Written as a name: in backticks or quotes (a field-dictionary row is `name`), or as a dashed option. A bare word
    in prose ("rows") does not count."""
    return f'`{name}`' in text or f'"{name}"' in text or (name.startswith('--') and re.search(re.escape(name) + r'(?![\w-])', text) is not None)


def ic_owned(text):
    """The delivered text minus the SDD PRD baseline (from its heading to the first original update after it)."""
    i = text.find(BASELINE_HEAD)
    if i < 0:
        return text
    j = text.find('## Original user update', i)
    return text[:i] + (text[j:] if j >= 0 else '')


def current_original(texts, removed):
    joined = '\n\n'.join(texts)
    for r in removed or []:
        if r.get('text'):
            joined = joined.replace(r['text'], '')
    return joined


def i1(texts, delivery):
    current = current_original(texts, delivery.get('removed'))
    names, errors = obligations(current)
    own = ic_owned(delivery.get('text', ''))
    # Names only the passages this delivery cuts write: IC's own cut takes them out of the obligations above, so
    # whether the cut was right is for review (R10 cuts R1's manifest sample, the only passage writing `rows`).
    cut, _ = obligations('\n'.join(r.get('text', '') for r in delivery.get('removed') or []))
    return {'names_missing': sorted(n for n in names if not writes(own, n)), 'errors_missing': sorted(e for e in errors if fragment(e) not in own),
            'names_only_in_cut': sorted(n for n in cut if not writes(current, n) and not writes(own, n)),
            'names': len(names), 'errors': len(errors)}


def i2(delivery, prd):
    names, errors = obligations(delivery.get('text', ''))
    return {'names_missing': sorted(n for n in names if not writes(prd, n)), 'errors_missing': sorted(e for e in errors if fragment(e) not in prd),
            'names': len(names), 'errors': len(errors)}


# ---------- series ----------

def prd_of(trial):
    found = sorted(Path(trial).glob('runs/*/' + PRD))
    return found[0].read_text(encoding='utf-8', errors='replace') if found else None


def record(label, results, store, ledger_store=None):
    out = OUT_ROOT / label
    out.mkdir(parents=True, exist_ok=True)
    rounds = json.loads(Path(results).read_text(encoding='utf-8'))['rounds']
    s = json.loads(Path(store).read_text(encoding='utf-8'))
    batches = {b['event_id']: b for b in s['batches'] if b['state'] == 'accepted' and b.get('delivery')}
    lent = None
    if ledger_store:
        ls = json.loads(Path(ledger_store).read_text(encoding='utf-8'))
        lent = [b for b in ls['batches'] if b['state'] == 'accepted' and b.get('delivery')]
    codes = {r['round']: str(Path(r['root']) / 'official-app') for r in rounds if r.get('root')}
    units = extract_units(codes, out)
    report, prev_units, prev_hash = [], None, None
    for r in rounds:
        n = r['round']
        if n not in units:
            continue
        texts = acceptance_repair.texts_upto(n)
        commands = list(error_probes.parse(texts)[0])
        h = code_hash(codes[n])
        d = (batches.get(f'r{n}-user-input') or {}).get('delivery') or {}
        if lent is not None:
            upto = [b for b in lent if int(b['event_id'][1:].split('-')[0]) <= n]
            ledger = (upto[-1]['delivery'].get('contract') or {}).get('revisions') or [] if upto else []
        else:
            ledger = (d.get('contract') or {}).get('revisions') or []
        prd = prd_of(r['root'])
        row = {'round': n, 'code_hash': h, 'units': len(units[n]),
               'change': change_record(prev_units, units[n], h == prev_hash),
               'revisions': [{'id': x['id'], 'subject': x['subject'], 'state_on_ledger': x['state'], 'landing': landing(x, units[n])} for x in ledger],
               'slot_mismatches': slot_mismatches(units[n], texts, commands),
               'i1': i1(texts, d) if d else None,
               'i2': i2(d, prd) if d and prd is not None else None}
        report.append(row)
        prev_units, prev_hash = units[n], h
        print(f"{label} R{n}: units {len(units[n])}, change +{len(row['change']['added'])}/~{len(row['change']['changed'])}/-{len(row['change']['removed'])}"
              f"{' (no new code)' if row['change']['no_new_code'] else ''}, slot mismatches {len(row['slot_mismatches'])}, "
              f"I1 missing {len(row['i1']['names_missing']) if row['i1'] else '-'}/{len(row['i1']['errors_missing']) if row['i1'] else '-'}, "
              f"I2 missing {len(row['i2']['names_missing']) if row['i2'] else '-'}/{len(row['i2']['errors_missing']) if row['i2'] else '-'}", flush=True)
    (out / 'record.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
    return report


if __name__ == '__main__':
    record(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else None)
