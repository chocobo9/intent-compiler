"""Units the requirements name and whether the code dispatches on them (no execution, no data).

A requirement names its variants in its own samples: a JSON key whose string value
differs across samples (for example an operation or step kind) where the value also
heads a section of its own, and the subcommand after the program name in command
synopses. Code that implements a variant dispatches
on its exact name, so a name absent from every dispatch position is not implemented.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

DISCRIMINATOR_MIN_VALUES = 3
IDENT = r'[A-Za-z][A-Za-z0-9_\-]*'


def json_samples(text):
    for block in re.findall(r'```[a-zA-Z]*\n(.*?)```', text, re.S):
        for candidate in re.findall(r'\{[^{}]*\}', block):
            try:
                value = json.loads(candidate)
            except ValueError:
                continue
            if isinstance(value, dict):
                yield value
    for candidate in re.findall(r'`(\{[^`]*\})`', text):
        try:
            value = json.loads(candidate)
        except ValueError:
            continue
        if isinstance(value, dict):
            yield value


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
    for key, names in values.items():
        if len(names) >= DISCRIMINATOR_MIN_VALUES:
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
