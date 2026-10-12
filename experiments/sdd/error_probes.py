"""Error-path probes built by code from the requirement text alone (no model, no invented data).

From each command synopsis (`prog cmd --opt <path> ...`) and the error rules the text
writes with a fixed `ERROR: ...` template, build calls that trigger exactly that rule:

- missing input file: every input path option points at a file that does not exist;
- missing required flag: only where the text names the flag and its message;
- malformed JSON: a JSON input (named by the shared rule, or by a command's own
  "Invalid JSON" rule) holds `{`.

A rule belongs to the command whose section (heading subtree) holds that command's
synopsis; a rule in a section holding no synopsis is shared by every command.
"""
import re
from collections import defaultdict

IDENT = r'[A-Za-z][A-Za-z0-9_\-]*'
CSV = 'id,value\n1,2\n'


def _headings(lines):
    out = []
    for i, line in enumerate(lines):
        m = re.match(r'^(#{1,6})\s', line)
        if m:
            out.append((i, len(m.group(1))))
    return out


def _section(heads, i, level):
    """[start, end) of the section at heading index i of the given level."""
    start = heads[i][0]
    end = next((h for h, l in heads[i + 1:] if l <= level), None)
    return start, end


def parse(texts):
    """Synopses {command: {'round': i, 'options': [(name, value, optional)]}} and rules [dict]."""
    found, rules, programs = {}, [], defaultdict(int)
    syn_re = re.compile(r'(?:^|`)(' + IDENT + r') (' + IDENT + r')((?: \[?--' + IDENT + r'(?: (?:<[^>]+>|[^\s`\]]+))?\]?)+)')
    per_text = []
    for i, text in enumerate(texts):
        lines = text.splitlines()
        syns = []
        for n, line in enumerate(lines):
            for m in syn_re.finditer(line.strip()):
                programs[m.group(1)] += 1
                opts = [(o.group(2), o.group(3), bool(o.group(1))) for o in re.finditer(r'(\[)?--(' + IDENT + r')(?: (<[^>]+>|[^\s`\]]+))?\]?', m.group(3))]
                syns.append((n, m.group(1), m.group(2), opts))
        per_text.append((lines, syns))
    program = max(programs, key=programs.get) if programs else None
    for i, (lines, syns) in enumerate(per_text):
        syns = [s for s in syns if s[1] == program]
        for n, _, cmd, opts in syns:
            found.setdefault(cmd, {'round': i, 'options': opts})
        heads = _headings(lines)
        for n, line in enumerate(lines):
            m = re.search(r'`"?(ERROR: [^`"]+)"?`', line)
            if not m:
                continue
            owner = None
            for k in range(len(heads) - 1, -1, -1):
                h, level = heads[k]
                if h > n:
                    continue
                start, end = _section(heads, k, level)
                inside = {s[2] for s in syns if start <= s[0] < (end if end is not None else len(lines))}
                if end is not None and n >= end:
                    continue
                if len(inside) == 1:
                    owner = next(iter(inside))
                    break
                if len(inside) > 1:
                    break
            nonzero = 'non-zero' in line
            rules.append({'round': i, 'command': owner, 'template': m.group(1), 'line': line.strip(), 'nonzero': nonzero})
    return found, rules


def _template_regex(template, paths):
    parts = re.split(r'(<[^>]+>)', template)
    rx = ''
    for p in parts:
        if p == '<path>':
            rx += '(' + '|'.join(re.escape(x) for x in paths) + ')' if paths else '.+'
        elif p.startswith('<'):
            rx += '.+?'
        else:
            rx += re.escape(p)
    return rx


def _is_path(value):
    return value == '<path>' or bool(re.search(r'\.[A-Za-z]{2,5}$', value or ''))


def _call(cmd, opts, missing=(), drop=None, files_for=None):
    args, files, missing_paths = [cmd], [], []
    for name, value, optional in opts:
        if optional or name == drop:
            continue
        args.append('--' + name)
        if _is_path(value):
            if 'output' in name:
                args.append(f'out-{name}.out')
            elif name in missing:
                p = f'absent-{name}.csv'
                args.append(p)
                missing_paths.append(p)
            else:
                p = f'in-{name}.csv'
                args.append(p)
                files.append({'path': p, 'content': (files_for or {}).get(name, CSV)})
        else:
            args.append('1' if 'uint' in (value or '') or 'number' in (value or '') else 'id')
    return args, files, missing_paths


def probes(texts, upto):
    """Probes for the requirements of texts[:upto]."""
    synopses, rules = parse(texts[:upto])
    shared = [r for r in rules if r['command'] is None]
    out = []
    for cmd, syn in synopses.items():
        opts = syn['options']
        own = [r for r in rules if r['command'] == cmd]
        inputs = [name for name, value, optional in opts if not optional and _is_path(value) and 'output' not in name]
        # missing input file
        nf = [r for r in own + shared if r['template'].startswith('ERROR: file not found:')]
        if nf and inputs:
            args, files, miss = _call(cmd, opts, missing=set(inputs))
            r = nf[0]
            out.append({'id': f'{cmd}:missing-file', 'rule': r['line'], 'run': {'args': args, 'files': files, 'stdin': None},
                        'exit_code': None if r['nonzero'] else 1, 'nonzero': r['nonzero'],
                        'asserts': [{'where': 'stderr', 'mode': 'pattern', 'value': _template_regex(r['template'], miss)}]})
        # missing required flag (only where the text names the flag and its message)
        for r in own:
            m = re.search(r'Missing `--(' + IDENT + r')` flag', r['line'])
            if m and re.fullmatch(r'ERROR: --' + re.escape(m.group(1)) + r' is required', r['template']):
                args, files, _ = _call(cmd, opts, drop=m.group(1))
                out.append({'id': f'{cmd}:missing-flag-{m.group(1)}', 'rule': r['line'], 'run': {'args': args, 'files': files, 'stdin': None},
                            'exit_code': 1, 'asserts': [{'where': 'stderr', 'mode': 'contains', 'value': r['template']}]})
        # malformed JSON: a command's own "Invalid JSON" rule wins over the shared one
        own_json = [r for r in own if re.search(r'(?i)invalid json', r['line'])]
        shared_json = [r for r in shared if re.search(r'(?i)malformed json', r['line'])]
        if own_json:
            # The option the rule names; a rule naming none covers every JSON input of the command.
            rule = own_json[0]
            named = [n for n in inputs if re.search(r'' + re.escape(n) + r'', rule['line'], re.I)]
            targets = named or inputs
        elif shared_json:
            named = re.search(r'(?i)malformed json ([a-z/]+)', shared_json[0]['line'])
            kinds = set(named.group(1).split('/')) if named else set()
            targets, rule = [n for n in inputs if n in kinds], shared_json[0]
        else:
            targets, rule = [], None
        if targets:
            args, files, _ = _call(cmd, opts, files_for={t: '{' for t in targets})
            paths = [f['path'] for f in files if f['content'] == '{']
            out.append({'id': f'{cmd}:malformed-json-' + '-'.join(targets), 'rule': rule['line'], 'run': {'args': args, 'files': files, 'stdin': None},
                        'exit_code': 1, 'asserts': [{'where': 'stderr', 'mode': 'pattern', 'value': _template_regex(rule['template'], paths)}]})
    return out
