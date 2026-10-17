"""Post-PRD code checks (v6 §6): P1 stub detection, P2 output structure, P3 cross-round regression.

Code only, no model. Inputs follow D2 and its 2026-10-16 supplement: samples (recipes,
configurations, schemas) come from the original text; data files, which the original does not
give, are a minimal CSV built by code: the column names the original sample names, one row of a
placeholder value with no requirement meaning. Such inputs stay inside IC's checks (never sent
to SDD, never written into a CI), every record says 'code-built', and no value is judged:
P1 asks whether the program runs the unit at all, P2 compares keys, nesting and types only.

Calibration (user, 2026-10-17): every run is made twice, with an integer and with a decimal placeholder.
A run that fails the same way both times (same exit code) fails whatever the values are: P1 counts it a
failure, and P2 counts a missing output file the same way. Runs that differ are inconclusive. Error text
is never parsed for this.
"""
import json
import re
from pathlib import Path

import error_probes
import example_runner
from static_units import IDENT, json_samples

PLACEHOLDER = '1'
# Two placeholder sets: an integer and a decimal. A failure that does not depend on the values shows in both.
PLACEHOLDERS = ('1', '1.5')
CODE_BUILT = 'code-built placeholder input (column names from the original sample, one row of a meaningless value)'
# A body that only reports it is not written.
STUB_RX = re.compile(r'not (?:yet )?implemented|unimplemented|implementation (?:is )?unavailable|\bTODO\b|not supported yet', re.I)
DISCRIMINATORS = ('op', 'type')


def is_output_heading(h):
    """An output heading: it names output or a report, or a format that is not an input's (schema, recipe, config, input)."""
    return bool(re.search(r'output|report', h, re.I) or (re.search(r'format', h, re.I) and not re.search(r'schema|recipe|config|input', h, re.I)))


# ---------- the original's samples ----------

def _headed_chunks(text):
    """(heading path, fenced or backticked JSON text) for every sample, with the headings above it."""
    path, out = [], []
    fence = re.compile(r'```[a-zA-Z]*\n(.*?)```', re.S)
    pos = 0
    lines = text.split('\n')
    offsets, acc = [], 0
    for line in lines:
        offsets.append(acc)
        acc += len(line) + 1
    heads = [(offsets[i], len(m.group(1)), m.group(2)) for i, line in enumerate(lines) for m in [re.match(r'^(#{1,6})\s+(.*)$', line)] if m]
    def path_at(at):
        p = []
        for start, level, title in heads:
            if start > at:
                break
            p = [x for x in p if x[0] < level] + [(level, title)]
        return [t for _, t in p]
    for m in fence.finditer(text):
        out.append((path_at(m.start()), m.group(1)))
    for m in re.finditer(r'`(\{[^`]*\})`', text):
        out.append((path_at(m.start()), m.group(1)))
    return out


def unit_samples(texts):
    """{(key, name): [sample]} for every discriminator value the samples take (key with >= 2 values)."""
    found = {}
    for text in texts:
        for sample in json_samples(text):
            for key in DISCRIMINATORS:
                value = sample.get(key)
                if isinstance(value, str) and re.fullmatch(IDENT, value):
                    found.setdefault((key, value), []).append(sample)
    # An operation is any `op` value; a `type` value is a unit only where it names a command (a pipeline step),
    # not a schema field type or a join kind.
    commands, _ = error_probes.parse(texts)
    return {u: s for u, s in found.items() if u[0] == 'op' or u[1] in commands}


def output_samples(texts):
    """{command: sample} for a JSON object shown under an output heading of that command's section."""
    out = {}
    commands, _ = error_probes.parse(texts)
    for text in texts:
        for path, chunk in _headed_chunks(text):
            if not path or not is_output_heading(path[-1]):
                continue
            try:
                value = json.loads(chunk)
            except ValueError:
                continue
            if not isinstance(value, dict) or any(k in value for k in DISCRIMINATORS):
                continue
            owner = next((c for h in reversed(path) for c in commands if re.search(r'`' + re.escape(c) + r'`|\b' + re.escape(c) + r'\b', h)), None)
            if owner and owner not in out:
                out[owner] = value
    return out


def section_input_samples(texts, command):
    """JSON objects shown in the command's own section, not under an output heading (its schema or config samples)."""
    found = []
    for text in texts:
        for path, chunk in _headed_chunks(text):
            if not any(re.search(r'\b' + re.escape(command) + r'\b', h) for h in path) or (path and is_output_heading(path[-1])):
                continue
            try:
                value = json.loads(chunk)
            except ValueError:
                continue
            if isinstance(value, (dict, list)):
                found.append(value)
    return found


def identifiers(value, skip=()):
    """The identifier strings a sample holds (values and list items, nested), in order: the columns it names."""
    out = []
    def walk(v):
        if isinstance(v, dict):
            # A map of columns or fields names its columns by its keys.
            for key in ('columns', 'fields'):
                if isinstance(v.get(key), dict):
                    out.extend(k for k in v[key] if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', k) and k not in out)
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
        elif isinstance(v, str) and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', v) and v not in skip and v not in out:
            out.append(v)
    walk(value)
    return out


def placeholder_csv(columns, value=PLACEHOLDER):
    columns = columns or ['id']
    return ','.join(columns) + '\n' + ','.join(value for _ in columns) + '\n'


def csv_files(value):
    """Relative .csv paths a sample names (files it reads, e.g. a join's right side)."""
    found = []
    def walk(v):
        if isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
        elif isinstance(v, str) and v.lower().endswith('.csv') and not v.startswith(('/', '\\')):
            found.append(v)
    walk(value)
    return found


# ---------- P1 static ----------

def _go_sources(code_dir):
    return {p: p.read_text(encoding='utf-8', errors='replace') for p in Path(code_dir).rglob('*.go') if not p.name.endswith('_test.go')}


def _body(source, start):
    """The text of the brace block opening at or after start."""
    i = source.find('{', start)
    if i < 0:
        return ''
    depth = 0
    for j in range(i, len(source)):
        if source[j] == '{':
            depth += 1
        elif source[j] == '}':
            depth -= 1
            if depth == 0:
                return source[i + 1:j]
    return source[i + 1:]


def _strip_comments(code):
    return re.sub(r'//[^\n]*|/\*.*?\*/', '', code, flags=re.S)


def static_stub(code_dir, name):
    """For a dispatched unit: {'stub': bool|None, 'where': ...}. None when no dispatch site is found."""
    sources = _go_sources(code_dir)
    q = re.escape(f'"{name}"')
    for path, src in sources.items():
        for m in re.finditer(r'case\s+[^:\n]*' + q + r'[^:\n]*:|' + q + r'\s*:\s*([A-Za-z_][\w.]*)', src):
            if m.group(0).startswith('case'):
                nxt = re.search(r'\n\s*(case\b|default\b)|\n\}', src[m.end():])
                branch = src[m.end(): m.end() + (nxt.start() if nxt else 400)]
            else:
                branch = m.group(1) + '('
            if STUB_RX.search(_strip_comments(branch)):
                return {'stub': True, 'where': f'{Path(path).name}: dispatch branch reports it is not implemented'}
            calls = [c for c in re.findall(r'([A-Za-z_][\w]*)\s*\(', branch) if c not in ('return', 'if', 'for', 'len', 'append', 'make')]
            for call in calls:
                for p2, s2 in sources.items():
                    f = re.search(r'\nfunc\s+(?:\([^)]*\)\s*)?' + re.escape(call.split('.')[-1]) + r'\s*\(', s2)
                    if not f:
                        continue
                    body = _strip_comments(_body(s2, f.end()))
                    statements = [l for l in body.split('\n') if l.strip()]
                    if STUB_RX.search(body) and len(statements) <= 3:
                        return {'stub': True, 'where': f'{Path(p2).name}: func {call} only reports it is not implemented'}
            return {'stub': False, 'where': f'{Path(path).name}: dispatched'}
    return {'stub': None, 'where': 'no dispatch site'}


# ---------- runs with placeholder inputs ----------

def _transform_run(sample, synopsis, value=PLACEHOLDER):
    cols = identifiers(sample, skip={sample.get('op')})
    files = [{'path': 'in.csv', 'content': placeholder_csv(cols, value)}, {'path': 'recipe.json', 'content': json.dumps([sample])}]
    files += [{'path': p, 'content': placeholder_csv(cols, value)} for p in csv_files(sample) if p not in ('in.csv',)]
    args = ['transform']
    for opt, value, optional in synopsis['options']:
        if optional:
            continue
        args += [f'--{opt}', {'input': 'in.csv', 'recipe': 'recipe.json', 'output': 'out.csv'}.get(opt, PLACEHOLDER if not error_probes._is_path(value) else f'{opt}.out')]
    return {'args': args, 'files': files, 'stdin': None}


def command_run(command, synopsis, texts, placeholder=PLACEHOLDER):
    """A run of a command with placeholder CSV inputs and its section's own JSON sample for JSON options; None when an option cannot be filled."""
    inputs = section_input_samples(texts, command)
    # The columns its own input samples name first (a schema's columns), then those its output sample names.
    columns = [c for s in inputs for c in identifiers(s)] + identifiers(output_samples(texts).get(command, {}))
    columns = list(dict.fromkeys(columns))[:12]
    args, files = [command], []
    for opt, value, optional in synopsis['options']:
        if optional:
            continue
        if opt == 'output':
            args += ['--output', 'out.json'] if not opt.endswith('dir') else ['--output', 'out']
        elif error_probes._is_path(value) or value == '<path>':
            if re.search(r'schema|config|recipe', opt) or (inputs and re.search(r'json', value, re.I)):
                if not inputs:
                    return None
                files.append({'path': f'{opt}.json', 'content': json.dumps(inputs[0])})
                args += [f'--{opt}', f'{opt}.json']
            elif opt in ('dir',):
                files.append({'path': 'data/a.csv', 'content': placeholder_csv(columns, placeholder)})
                args += ['--dir', 'data']
            else:
                files.append({'path': f'{opt}.csv', 'content': placeholder_csv(columns, placeholder)})
                args += [f'--{opt}', f'{opt}.csv']
        elif value.startswith('<col'):
            args += [f'--{opt}', (columns or ['id'])[0]]
        else:
            args += [f'--{opt}', PLACEHOLDER]
    return {'args': args, 'files': files, 'stdin': None}


def same_failure(observed):
    """The exit code every placeholder run failed with, when they all failed the same way; else None."""
    codes = [(o or {}).get('exit_code') for o in observed]
    return codes[0] if len(codes) == len(PLACEHOLDERS) and all(observed) and codes[0] not in (0, None) and len(set(codes)) == 1 else None


def p1_p2(code_dir, texts):
    """P1 (static and runs) for every unit, P2 for every command with an output sample. Each run is made once per
    placeholder set; which classes are sent back is the acceptance gate's decision."""
    synopses, _ = error_probes.parse(texts)
    units = unit_samples(texts)
    runs, meta = [], []
    for (key, name), samples in units.items():
        static = static_stub(code_dir, name)
        made = [_transform_run(samples[0], synopses['transform'], v) for v in PLACEHOLDERS] if key == 'op' and 'transform' in synopses else None
        meta.append({'kind': 'unit', 'key': key, 'name': name, 'static': static, 'runs': made, 'sample': samples[0]})
        for i, run in enumerate(made or []):
            runs.append({'id': f'p1:{key}:{name}#{i}', 'run': run, 'check': {}, 'asserts': [], 'exit_code': None})
    outputs = output_samples(texts)
    for command, synopsis in synopses.items():
        made = [command_run(command, synopsis, texts, v) for v in PLACEHOLDERS]
        made = made if all(made) else None
        meta.append({'kind': 'command', 'name': command, 'static': static_stub(code_dir, command), 'runs': made, 'expected': outputs.get(command)})
        for i, run in enumerate(made or []):
            runs.append({'id': f'p1:command:{command}#{i}', 'run': run, 'check': {}, 'asserts': [], 'exit_code': None})
    res = example_runner.run_examples(code_dir, runs) if runs else {'results': [], 'build_exit': None}
    observed = {r['id']: r for r in res['results']}
    items = []
    for m in meta:
        rid = f"p1:{m.get('key', 'command')}:{m['name']}"
        rs = [observed.get(f'{rid}#{i}') for i in range(len(PLACEHOLDERS))] if m['runs'] else []
        obs = [(r or {}).get('observed') or {} for r in rs]
        first = obs[0] if obs else {}
        run_stub = any(o and STUB_RX.search((o.get('stderr') or '') + (o.get('stdout') or '')) for o in obs)
        failed_code = same_failure(obs) if obs else None
        if not rs:
            run_state = 'not run'
        elif not all(obs):
            run_state = 'did not run'
        elif run_stub:
            run_state = 'stub'
        elif failed_code is not None:
            run_state = f'exit {failed_code} under both placeholder sets'
        elif all(o.get('exit_code') == 0 for o in obs):
            run_state = 'exit 0'
        else:
            run_state = 'inconclusive (exit ' + ' / '.join(str(o.get('exit_code')) for o in obs) + ')'
        static = m['static']['stub']
        stub = bool(static) or run_stub
        reason = 'stub' if stub else ('sample_fails' if failed_code is not None else None)
        items.append({'class': 'p1_stub', 'id': f"p1:{m['name']}", 'name': m['name'], 'failed': reason is not None, 'reason': reason, 'match': 'unit',
                      'static': m['static'], 'run_state': run_state, 'agree': (static is None or not rs or not all(obs)) or (bool(static) == run_stub),
                      'input': CODE_BUILT if m['runs'] else None, 'stderr': (first.get('stderr') or '')[:200], 'exit_code': failed_code,
                      'sample': m.get('sample'), 'command': 'transform' if m['kind'] == 'unit' else m['name']})
        if m['kind'] == 'command' and m.get('expected') is not None:
            args = m['runs'][0]['args'] if m['runs'] else []
            out_name = next((args[i + 1] for i, a in enumerate(args) if a == '--output'), None)
            items.append(structure_item(m['name'], m['expected'], obs, out_name, rs, m['runs'] is not None))
    return items, res.get('build_exit')


# ---------- P2 structure ----------

def _type(v):
    return 'null' if v is None else 'bool' if isinstance(v, bool) else 'number' if isinstance(v, (int, float)) else 'string' if isinstance(v, str) else 'array' if isinstance(v, list) else 'object'


def shape(value, path='$'):
    """{path: type} for every key path; array elements merged under [] (only those the sample shows)."""
    out = {path: _type(value)}
    if isinstance(value, dict):
        for k, v in value.items():
            out.update(shape(v, f'{path}.{k}'))
    elif isinstance(value, list):
        for v in value:
            for p, t in shape(v, f'{path}[]').items():
                out.setdefault(p, t)
    return out


def value_dependent(expected, path='$'):
    """Key paths the sample shows on some of a set of like entries but not on all: whether such a key appears
    depends on the entry's values (an enum only for a string column), so a placeholder run need not show it.
    Like entries are the objects of a list, or the object values of an object whose values are all objects."""
    out = set()
    if isinstance(expected, dict):
        entries = [(f'{path}.{k}', v) for k, v in expected.items()]
        if len(entries) >= 2 and all(isinstance(v, dict) for _, v in entries):
            common = set.intersection(*(set(v) for _, v in entries))
            out.update(f'{p}.{k}' for p, v in entries for k in v if k not in common)
        for p, v in entries:
            out |= value_dependent(v, p)
    elif isinstance(expected, list):
        objects = [v for v in expected if isinstance(v, dict)]
        if len(objects) >= 2:
            common = set.intersection(*(set(v) for v in objects))
            out.update(f'{path}[].{k}' for v in objects for k in v if k not in common)
        for v in expected:
            out |= value_dependent(v, f'{path}[]')
    return out


def compare_shape(expected, actual):
    """Paths the sample shows that the output lacks or types differently; element paths only where the output has elements;
    value-dependent paths (shown on some like entries only) are not required. Values are never compared."""
    want, got = shape(expected), shape(actual)
    optional = value_dependent(expected)
    problems = []
    for p, t in want.items():
        parent_array = '[]' in p and not any(q.startswith(p.split('[]')[0] + '[]') for q in got)
        if parent_array or any(p == o or p.startswith(o + '.') or p.startswith(o + '[') for o in optional):
            continue
        if p not in got:
            problems.append(f'missing {p} ({t})')
        elif t != 'null' and got[p] != 'null' and got[p] != t:
            problems.append(f'{p} is {got[p]}, the sample shows {t}')
    return problems


def structure_item(command, expected, observed, out_name, results, ran):
    """P2 for one command from its placeholder runs. A structure problem counts when every run shows it; no output
    file from every run, each failing the same way, counts as a failure too (the sample input should succeed)."""
    base = {'class': 'p2_structure', 'id': f'p2:{command}', 'name': command, 'match': 'name', 'input': CODE_BUILT}
    if not ran:
        return {**base, 'failed': False, 'state': 'not run (an option could not be filled from the original)'}
    observed = observed or []
    texts = [((r or {}).get('files_content') or {}).get(out_name) if out_name else None for r in (results or [])]
    written = [t for t in texts if t is not None]
    codes = [(o or {}).get('exit_code') for o in observed]
    if not written:
        if len(texts) == len(PLACEHOLDERS) and all(observed) and len(set(codes)) == 1:
            return {**base, 'failed': True, 'state': f'no output file under both placeholder sets (exit {codes[0]})',
                    'problems': [f'no output file (exit {codes[0]})'], 'exit_code': codes[0], 'stderr': ((observed[0] or {}).get('stderr') or '')[:200]}
        return {**base, 'failed': False, 'state': 'no output file (inconclusive: exit ' + ' / '.join(str(c) for c in codes) + ')'}
    values = []
    for t in written:
        try:
            values.append(json.loads(t))
        except ValueError:
            values.append(None)
    if all(v is None for v in values):
        return {**base, 'failed': True, 'state': 'output is not JSON', 'problems': ['output is not JSON']}
    per_run = [set(compare_shape(expected, v)) for v in values if v is not None]
    complete = len(per_run) == len(PLACEHOLDERS)
    problems = sorted(set.intersection(*per_run)) if complete else []
    actual = next(v for v in values if v is not None)
    # The key names the output holds: what a revision that renames or adds keys is confirmed by (C2).
    keys = sorted({p.rsplit('.', 1)[-1].replace('[]', '') for p in shape(actual) if '.' in p})
    return {**base, 'failed': bool(problems), 'state': 'compared' if complete else 'compared (inconclusive: JSON output from one placeholder set only)',
            'problems': problems, 'output_keys': keys}


# ---------- P3 cross-round regression ----------

TIME_LINE = re.compile(r'current (?:time|date)|timestamp|wall.?clock|\bUTC\b|ISO ?8601|RFC ?3339|time of (?:the )?run|generated', re.I)
ISO_TIME = re.compile(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?')


def nondeterministic_keys(texts):
    """Keys the original says hold a time of the run (named on a line that mentions one)."""
    keys = set()
    for text in texts:
        for line in text.split('\n'):
            if TIME_LINE.search(line):
                keys.update(re.findall(r'[`"]([A-Za-z_][A-Za-z0-9_]*)[`"]', line))
    return keys


def touched_units(round_text, revision_subjects=()):
    """Units this round's own input names (its samples' op/type values, its synopses, backticked names in its headings) and revision subjects."""
    names = set(revision_subjects)
    for sample in json_samples(round_text):
        for key in DISCRIMINATORS:
            if isinstance(sample.get(key), str):
                names.add(sample[key])
    synopses, _ = error_probes.parse([round_text])
    names.update(synopses)
    for line in re.findall(r'(?m)^#{1,6} .*$', round_text):
        names.update(re.findall(r'`([A-Za-z_][A-Za-z0-9_-]*)`', line))
    return names


def _normalize(text, keys):
    try:
        value = json.loads(text)
    except ValueError:
        return ISO_TIME.sub('<time>', text.replace('\r\n', '\n'))
    def walk(v):
        if isinstance(v, dict):
            return {k: ('<nondeterministic>' if k in keys else walk(x)) for k, x in v.items()}
        if isinstance(v, list):
            return [walk(x) for x in v]
        return ISO_TIME.sub('<time>', v) if isinstance(v, str) else v
    return json.dumps(walk(value), sort_keys=True)


def p3(previous_code, current_code, texts, round_text, revision_subjects=()):
    """Every unit and command this round does not touch, run with the same code-built inputs on the previous adopted code and this round's; a difference is a suspected regression. Records only (D3)."""
    synopses, _ = error_probes.parse(texts)
    touched = touched_units(round_text, revision_subjects)
    keys = nondeterministic_keys(texts)
    runs, skipped = [], []
    for (key, name), samples in unit_samples(texts).items():
        if name in touched:
            skipped.append(name)
        elif key == 'op' and 'transform' in synopses:
            runs.append({'id': f'p3:{key}:{name}', 'name': name, 'run': _transform_run(samples[0], synopses['transform']), 'asserts': [], 'exit_code': None})
    for command, synopsis in synopses.items():
        run = command_run(command, synopsis, texts)
        if command in touched:
            skipped.append(command)
        elif run:
            runs.append({'id': f'p3:command:{command}', 'name': command, 'run': run, 'asserts': [], 'exit_code': None})
    before = {r['id']: r for r in example_runner.run_examples(previous_code, runs)['results']} if runs else {}
    after = {r['id']: r for r in example_runner.run_examples(current_code, runs)['results']} if runs else {}
    items = []
    for r in runs:
        a, b = before.get(r['id']) or {}, after.get(r['id']) or {}
        oa, ob = a.get('observed') or {}, b.get('observed') or {}
        diffs = []
        if not oa or not ob:
            diffs = [] if not oa and not ob else ['ran on one side only']
        else:
            if oa.get('exit_code') != ob.get('exit_code'):
                diffs.append(f"exit {oa.get('exit_code')} -> {ob.get('exit_code')}")
            for stream in ('stdout', 'stderr'):
                if _normalize(oa.get(stream) or '', keys) != _normalize(ob.get(stream) or '', keys):
                    diffs.append(f'{stream} differs')
            fa, fb = a.get('files_content') or {}, b.get('files_content') or {}
            for f in sorted(set(fa) | set(fb)):
                if _normalize(fa.get(f, '<absent>'), keys) != _normalize(fb.get(f, '<absent>'), keys):
                    diffs.append(f'{f} differs')
        items.append({'class': 'p3_regression', 'id': r['id'], 'name': r['name'], 'failed': bool(diffs), 'match': 'name', 'input': CODE_BUILT, 'diffs': diffs,
                      'example': {'before': (a.get('files_content') or {}), 'after': (b.get('files_content') or {})} if diffs else None})
    return items, sorted(set(skipped))


# ---------- P4 summary naming ----------

def _hits(text, name):
    """(identifier hits, prose hits): quoted or backticked, a case label, or inside a CamelCase/snake identifier; else prose."""
    ident = re.compile(r'["`]' + re.escape(name) + r'["`]|[A-Za-z0-9]' + re.escape(name.capitalize()) + r'|' + re.escape(name.capitalize()) + r'[A-Z]|\b' + re.escape(name) + r'_|_' + re.escape(name) + r'\b', re.S)
    word = re.compile(r'\b' + re.escape(name) + r'\b', re.I)
    return len(ident.findall(text)), len(word.findall(text))


def p4(run_dir, texts, round_index):
    """Units this round's input adds that the PRD names and SpecArt's summary does not. Recorded, never sent back.
    A summary that names a unit only in prose (a common word such as round or scale) is marked: that hit may be the word, not the unit."""
    run_dir = Path(run_dir)
    prd = run_dir / 'output/02-澄清后PRD.md'
    summary = run_dir / 'output/06-Spec骨架/.specart/summary.yaml'
    if not prd.exists() or not summary.exists():
        return [], 'no PRD' if not prd.exists() else 'no SpecArt summary'
    prd_text, summary_text = prd.read_text(encoding='utf-8', errors='replace'), summary.read_text(encoding='utf-8', errors='replace')
    earlier = set(unit_samples(texts[:round_index])) | {('command', c) for c in error_probes.parse(texts[:round_index])[0]}
    now = set(unit_samples(texts[:round_index + 1])) | {('command', c) for c in error_probes.parse(texts[:round_index + 1])[0]}
    items = []
    for key, name in sorted(now - earlier):
        p_ident, p_any = _hits(prd_text, name)
        s_ident, s_any = _hits(summary_text, name)
        if not p_any:
            continue
        # Named by a word match. A common word (round, scale, ...) may match the word rather than the unit: the hit count is recorded for review.
        state = 'missing' if not s_any else 'named'
        items.append({'class': 'p4_summary', 'id': f'p4:{name}', 'name': name, 'failed': state == 'missing', 'match': 'name', 'state': state, 'summary_word_hits': s_any})
    return items, None
