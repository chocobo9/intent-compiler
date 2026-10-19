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


STRING = r'"((?:[^"\\\n]|\\.)*)"'
# A site of a kind holds at least this share of the most names any one site of that kind holds (and at least two).
KIND_SITE_SHARE = 0.5


def _block(source, open_at):
    """The text inside the brace block that opens at source[open_at] ('{')."""
    depth = 0
    for j in range(open_at, len(source)):
        if source[j] == '{':
            depth += 1
        elif source[j] == '}':
            depth -= 1
            if depth == 0:
                return source[open_at + 1:j]
    return source[open_at + 1:]


def _top_level(body):
    """The body with every nested brace block blanked: what is left is its own level."""
    out, depth = [], 0
    for ch in body:
        if ch == '{':
            depth += 1
        out.append(ch if depth == 0 or ch == '\n' else ' ')
        if ch == '}':
            depth -= 1
    return ''.join(out)


def _selector(expr):
    """The last name of a selector expression (o.Op -> op, os.Args[1] -> args); None for anything else."""
    m = re.search(r'([A-Za-z_]\w*)\s*(?:\[[^\]\n]*\])?\s*$', expr.strip())
    return m.group(1).lower() if m else None


def dispatch_sites(source):
    """Every place that dispatches on a set of string names, as (selector, names): a switch (its subject's last
    name, its own case labels), a map literal keyed by strings (no selector, its own keys), and the == comparisons
    on one selector (grouped by the selector's last name)."""
    sites = []
    for m in re.finditer(r'\bswitch\b([^{\n]*)\{', source):
        own = _top_level(_block(source, m.end() - 1))
        labels = {s for c in re.findall(r'(?m)^\s*case\s([^:\n]*):', own) for s in re.findall(STRING, c)}
        if labels:
            sites.append((_selector(m.group(1).split(';')[-1]), labels))
    for m in re.finditer(r'map\[string\][^{\n]*\{', source):
        own = _top_level(_block(source, m.end() - 1))
        keys = set(re.findall(r'(?m)^\s*' + STRING + r'\s*:', own)) | set(re.findall(r'[{,]\s*' + STRING + r'\s*:', own))
        if keys:
            sites.append((None, keys))
    compared = defaultdict(set)
    for m in re.finditer(r'([A-Za-z_][\w.]*(?:\[[^\]\n]*\])?)\s*[!=]=\s*' + STRING + r'|' + STRING + r'\s*[!=]=\s*([A-Za-z_][\w.]*)', source):
        selector, value = (m.group(1), m.group(2)) if m.group(1) else (m.group(4), m.group(3))
        compared[_selector(selector)].add(value)
    sites.extend((sel, v) for sel, v in compared.items() if v)
    return sites


def kind_sites(sites, kind, names):
    """The sites that dispatch this kind: those whose subject is named for the kind (o.Op for op), and those
    holding the most of its names. A site holding only a few of them under another subject, such as an
    expression's function table that shares a name, is another kind's. None when no site can be told to be
    this kind's (no named subject and no site holding two of its names)."""
    names = set(names)
    overlap = [len(s & names) for _, s in sites]
    best = max(overlap, default=0)
    floor = max(2, -(-best * KIND_SITE_SHARE // 1))
    # A site under a subject of the kind's name counts only when it holds some of the kind's names: an expression
    # evaluator's `switch op` over "==", "<" is not the operation dispatch (v7 R2).
    named = any(sel == kind.lower() and s & names for sel, s in sites)
    # Where the code names the kind's subject, a site under another subject is another kind's whatever it holds.
    own = [s for (sel, s), n in zip(sites, overlap)
           if (sel == kind.lower() and n) or (best >= 2 and n >= floor and (not named or sel is None))]
    return own or None


def missing(code_dir, unit_names):
    """Units no dispatch site of their own kind names. A kind whose sites cannot be told apart (no site holds two
    of its names) falls back to any dispatch position."""
    source = '\n'.join(p.read_text(encoding='utf-8', errors='replace') for p in Path(code_dir).rglob('*.go') if not p.name.endswith('_test.go'))
    sites = dispatch_sites(source)
    by_kind = defaultdict(set)
    for kind, name in unit_names:
        by_kind[kind].add(name)
    out = []
    for kind, name in unit_names:
        own = kind_sites(sites, kind, by_kind[kind])
        present = any(name in s for s in own) if own is not None else dispatches(source, name)
        if not present:
            out.append((kind, name))
    return out
