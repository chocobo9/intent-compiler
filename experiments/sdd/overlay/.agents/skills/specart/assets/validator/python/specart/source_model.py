"""Declaration comparison shared by source adapters; never parses executable code."""
from __future__ import annotations

import re
from pathlib import Path

from . import canonical


TOKEN = re.compile(r'"""[\s\S]*?"""|\'(?:\\.|[^\'\\])*\'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|/\*[\s\S]*?\*/|//[^\n]*|\w+|[^\s]', re.UNICODE)


def tokens(value: str) -> list[str]:
    return [m.group() for m in TOKEN.finditer(value)
            if not m.group().startswith(('//', '/*'))]


def signature(record: dict) -> str:
    if 'signature' in record:
        return record['signature'].strip().rstrip(';')
    value = str(record.get('source', '')).strip()
    body = str(record.get('body', '')).strip()
    if record.get('kind') == 'function' and body and value.endswith(body):
        return value[:-len(body)].strip()
    if record.get('members') is not None:
        depth = 0
        for match in TOKEN.finditer(value):
            token = match.group()
            if token in {'(', '['}: depth += 1
            elif token in {')', ']'}: depth -= 1
            elif token == '{' and depth == 0: return value[:match.start()].strip()
    return value.rstrip(';')


def declarations(parsed: dict, owner: str = ''):
    result = []
    def walk(records, owner='', abstract=False):
        for record in records:
            # Go methods are top-level declarations with an explicit receiver owner.
            record['owner'] = owner or (record.get('owner', '') if record.get('receiver') else '')
            record['signature'] = signature(record)
            modifiers = record.get('modifiers', [])
            record['visibility'] = next((m for m in modifiers if m in {'private', 'internal', 'protected', 'public'}), 'default')
            if record.get('kind') == 'function':
                record['abstract'] = bool(record.get('abstract') or abstract or 'abstract' in modifiers)
            result.append(record)
            if 'members' in record:
                scope = '.'.join(p for p in (owner, record.get('name', '')) if p)
                walk(record['members'], scope, record.get('kind') == 'interface')
    walk(parsed.get('declarations') or [], owner)
    yield from result


def identity(file: str, record: dict) -> str:
    key = [file, record.get('owner', ''), record.get('kind'), tokens(signature(record))]
    label = '.'.join(p for p in (record.get('owner'), record.get('name')) if p)
    return f'{file}::{label}#{canonical.hash_object(key)[:16]}'


def contract_text(value: str, *, pending: bool = False) -> list[str]:
    result = []
    for line in value.replace('\r\n', '\n').splitlines():
        line = re.sub(r'^\s*(?:/\*+|\*)\s?', '', line).strip()
        line = re.sub(r'\*/\s*$', '', line).strip()
        if line and (pending or line != '@pendingUpdate'):
            result.append(line)
    return result


def safe_source(root: Path, relative: str) -> Path:
    if not isinstance(relative, str) or not relative or '\\' in relative or Path(relative).is_absolute():
        raise ValueError(f'invalid project-relative source path: {relative!r}')
    if '..' in Path(relative).parts:
        raise ValueError(f'source path escapes project: {relative}')
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError(f'source path escapes project: {relative}')
    return path


def protected(record: dict) -> dict:
    result = {'owner': record.get('owner', ''), 'kind': record.get('kind'), 'signature': tokens(signature(record)),
              'visibility': record.get('visibility', 'default')}
    if 'members' in record:
        result['members'] = [protected(member) for member in record['members']]
    return result


def preserves(expected: dict, actual: dict) -> bool:
    """Additional private helpers and unspecified field initialization are allowed."""
    before, after = expected['signature'], actual['signature']
    matches = before == after
    if actual.get('kind') == 'field' and '=' not in before and after[:len(before)] == before and after[len(before):len(before)+1] == ['=']:
        matches = True
    return (expected['owner'] == actual['owner'] and matches
            and all(any(preserves(member, candidate) for candidate in actual.get('members', []))
                    for member in expected.get('members', [])))


def complete_structure(expected: dict, actual: dict) -> bool:
    """Design summaries must cover all members; implementation may add helpers."""
    if not preserves(expected, actual):
        return False
    remaining = list(actual.get('members', []))
    for member in expected.get('members', []):
        index = next((i for i, candidate in enumerate(remaining) if complete_structure(member, candidate)), None)
        if index is None:
            return False
        remaining.pop(index)
    return not remaining


def missing_members(expected: dict, actual: dict) -> list[dict]:
    """Describe uncovered nested members using the same structural comparison."""
    missing = []
    remaining = list(expected.get('members', []))
    for member in actual.get('members', []):
        index = next((i for i, candidate in enumerate(remaining) if preserves(candidate, member)), None)
        if index is None:
            missing.append({'owner': member['owner'], 'signature': ' '.join(member['signature'])})
        else:
            missing.extend(missing_members(remaining.pop(index), member))
    return missing
