"""Units the requirements name and whether the code dispatches on them (no execution, no data).

A requirement names its variants in its own samples: a JSON key (in any sample object,
nested ones included) whose string value differs across samples (for example an
operation or step kind or a strategy) where the value also heads a section of its own, and the subcommand after the program name in command
synopses. Code that implements a variant dispatches
on its exact name, so a name absent from every dispatch position is not implemented.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

DISCRIMINATOR_MIN_VALUES = 3
IDENT = r'[A-Za-z][A-Za-z0-9_\-]*'


def _objects(text):
    """Top-level JSON objects in text, nested ones included (balanced braces, strings respected)."""
    depth, start, in_str, esc = 0, None, False, False
    for i, ch in enumerate(text):
        if in_str:
            esc = (ch == '\\') and not esc
            if ch == '"' and not esc:
                in_str = False
            continue
        if ch == '"':
            in_str, esc = True, False
        elif ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}' and depth:
            depth -= 1
            if depth == 0:
                yield text[start:i + 1]


def _dicts(value):
    if isinstance(value, dict):
        yield value
        for v in value.values():
            yield from _dicts(v)
    elif isinstance(value, list):
        for v in value:
            yield from _dicts(v)


def json_samples(text):
    """Every JSON object the text's samples hold, nested objects included."""
    chunks = re.findall(r'```[a-zA-Z]*\n(.*?)```', text, re.S) + re.findall(r'`(\{[^`]*\})`', text)
    for chunk in chunks:
        try:
            yield from _dicts(json.loads(chunk))
            continue
        except ValueError:
            pass
        for candidate in _objects(chunk):
            try:
                yield from _dicts(json.loads(candidate))
            except ValueError:
                continue


def units(texts):
    """{(kind, name): first index into texts} for discriminator values and subcommands."""
    values, first = defaultdict(set), {}
    for i, text in enumerate(texts):
        for sample in json_samples(text):
            for key, value in sample.items():
                if isinstance(value, str) and re.fullmatch(IDENT, value):
                    values[key].add(value)
                    first.setdefault((key, value), i)
    # A variant the requirement defines has its own heading naming it.
    headed = {m for text in texts for line in re.findall(r'(?m)^#{1,6} .*$', text) for m in re.findall(r'`(' + IDENT + r')`', line)}
    found = {}
    # A discriminating key takes at least two values across the samples; a data value has no heading of its own.
    for key, names in values.items():
        if len(names) >= 2:
            for name in names & headed:
                found[(key, name)] = first[(key, name)]
    programs, subs = defaultdict(int), {}
    for i, text in enumerate(texts):
        for m in re.finditer(r'(?m)(?:^|`)(' + IDENT + r') (' + IDENT + r')(?= --| <|`|$)', text):
            programs[m.group(1)] += 1
            subs.setdefault((m.group(1), m.group(2)), i)
    program = max(programs, key=programs.get) if programs else None
    for (prog, sub), i in subs.items():
        if prog == program and programs[prog] >= DISCRIMINATOR_MIN_VALUES:
            found.setdefault(('command', sub), i)
    return found


def dispatches(source, name):
    q = re.escape(f'"{name}"')
    return re.search(r'case\s[^:\n]*' + q + r'|' + q + r'\s*:|==\s*' + q + r'|' + q + r'\s*==', source) is not None


def missing(code_dir, unit_names):
    source = '\n'.join(p.read_text(encoding='utf-8', errors='replace') for p in Path(code_dir).rglob('*.go') if not p.name.endswith('_test.go'))
    return [u for u in unit_names if not dispatches(source, u[1])]
