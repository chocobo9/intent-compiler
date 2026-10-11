"""Language-specific import ownership; shared comparison only sees package edges."""
from __future__ import annotations

import json
import ast
import re
import tomllib
from pathlib import Path


def relationships(records: list[dict]) -> set[tuple[str, str]]:
    return {(r['from'], r['to']) for r in records if not r.get('unresolved') and r['from'] != r['to']}


def changes(before: list[dict], after: list[dict]) -> dict:
    # Partial extraction must not turn a previously known edge into a spurious
    # deletion (or an unknown baseline into a spurious addition).
    incomplete = {r['file'] for r in before + after if r.get('unresolved')}
    old = relationships([r for r in before if r.get('file') not in incomplete])
    new = relationships([r for r in after if r.get('file') not in incomplete])
    return {'added': sorted(new - old), 'removed': sorted(old - new)}


def json_config(path: Path) -> dict:
    # JSON5 package configs: quoted/unquoted keys, comments and trailing commas.
    raw = path.read_text(encoding='utf-8')
    raw = re.sub(r'''"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|//[^\n]*|/\*[\s\S]*?\*/''',
                 lambda m: json.dumps(ast.literal_eval(m.group())) if m.group().startswith("'")
                 else m.group() if m.group().startswith('"') else '', raw)
    raw = re.sub(r'"(?:\\.|[^"\\])*"|([A-Za-z_$][\w$]*)\s*:',
                 lambda m: json.dumps(m[1])+':' if m[1] else m.group(), raw)
    value = json.loads(re.sub(r',\s*([}\]])', r'\1', raw))
    if not isinstance(value, dict):
        raise ValueError(f'{path}: configuration root must be an object')
    return value


def nearest(path: Path, root: Path, names: tuple[str, ...]) -> Path | None:
    for directory in (path, *path.parents):
        if not directory.is_relative_to(root):
            break
        for name in names:
            candidate = directory / name
            if candidate.is_file():
                return candidate
    return None


class ArktsImports:
    def __init__(self, root: Path):
        self.root = root

    def package(self, directory: Path) -> tuple[str, Path, dict]:
        config = nearest(directory, self.root, ('oh-package.json5', 'package.json'))
        if config:
            data = json_config(config)
            return str(data.get('name') or config.parent.relative_to(self.root)), config.parent, data
        return '.', self.root, {}

    def extract(self, file: dict) -> list[dict]:
        path = self.root / file['relative_path']
        owner, directory, config = self.package(path.parent)
        deps = {**config.get('dependencies', {}), **config.get('devDependencies', {})}
        result = []
        for imported in file.get('imports', []):
            target = imported['package']
            target_path = None
            external = False
            if target.startswith('.'):
                target_path = (path.parent / target).resolve()
            else:
                if target == owner or target.startswith(owner + '/'):
                    target_path = (directory / target[len(owner):].lstrip('/')).resolve()
                elif (self.root / target.split('/')[0]).is_dir():
                    target_path = (self.root / target).resolve()
                aliases = nearest(path.parent, self.root, ('tsconfig.json',))
                if aliases:
                    options = json_config(aliases).get('compilerOptions', {})
                    for alias, values in options.get('paths', {}).items():
                        prefix = alias.removesuffix('*')
                        if target == alias or (alias.endswith('*') and target.startswith(prefix)):
                            if len(values) != 1:
                                raise ValueError(f"{path}: ambiguous import alias {target}")
                            suffix = target[len(prefix):] if alias.endswith('*') else ''
                            target_path = (aliases.parent / options.get('baseUrl', '.') / values[0].replace('*', suffix)).resolve()
                for name, version in deps.items():
                    if target == name or target.startswith(name + '/'):
                        if isinstance(version, str) and version.startswith('file:'):
                            target_path = (directory / version[5:]).resolve()
                        elif isinstance(version, str) and version.startswith('workspace:'):
                            raise ValueError(f'{path}: workspace import {target} needs a direct local path')
                        elif isinstance(version, str):
                            external = True
            if target_path is None:
                if external:
                    continue
                raise ValueError(f'{path}: unresolved import {target}')
            if not target_path.is_relative_to(self.root):
                raise ValueError(f'{path}: local import outside project boundary: {target}')
            target_owner, _, _ = self.package(target_path if target_path.is_dir() else target_path.parent)
            if owner != target_owner:
                result.append({'from': owner, 'to': target_owner, 'file': file['relative_path'], 'position': imported.get('position', {})})
        return result


class CangjieImports:
    def __init__(self, root: Path, files: dict):
        self.root = root
        self.prefixes = {str(f.get('package', '')).split('.')[0] for f in files.values() if f.get('package')}
        config = root / 'cjpm.toml'
        if config.is_file():
            data = tomllib.loads(config.read_text(encoding='utf-8'))
            name = data.get('package', {}).get('name')
            if name:
                self.prefixes.add(name)

    def extract(self, file: dict) -> list[dict]:
        owner = str(file.get('package') or '')
        if not owner:
            raise ValueError(f"{file['relative_path']}: missing Cangjie package")
        result = []
        for imported in file.get('imports', []):
            packages = imported.get('packages')
            if not isinstance(packages, list) or not packages:
                raise ValueError(f"{file['relative_path']}: import AST does not provide package paths")
            for target in packages:
                if target.split('.')[0] in self.prefixes and target != owner:
                    result.append({'from': owner, 'to': target, 'file': file['relative_path'], 'position': imported.get('position', {})})
        return result


class GoImports:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.modules = {}
        for manifest in self.root.rglob('go.mod'):
            if any(part.startswith('.') or part == 'vendor'
                   for part in manifest.relative_to(self.root).parts[:-1]):
                continue
            directory = manifest.parent.resolve()
            if not directory.is_relative_to(self.root):
                raise ValueError('Go module outside project boundary')
            text = manifest.read_text(encoding='utf-8')
            match = re.search(r'^\s*module\s+("[^"\n]+"|[^\s/][^\s]*)', text, re.M)
            if not match:
                raise ValueError('go.mod has no module declaration')
            module = match.group(1).strip('"')
            if module in self.modules and self.modules[module] != directory:
                raise ValueError(f'ambiguous local Go module: {module}')
            self.modules[module] = directory
            # Replacements can redirect an apparently external import into the
            # project. Preserve an extraction gap until that mapping is supported.
            if re.search(r'^\s*replace\b', text, re.M):
                raise ValueError('Go replace directives require explicit dependency resolution')

    def package(self, directory: Path) -> str:
        relative = directory.relative_to(self.root).as_posix()
        return 'project' + ('' if relative == '.' else '/' + relative)

    def extract(self, file: dict) -> list[dict]:
        directory = (self.root / file['relative_path']).parent.resolve()
        owner = self.package(directory)
        if not file.get('package'):
            raise ValueError('Go package declaration missing')
        imports = file.get('imports', [])
        if imports and nearest(directory, self.root, ('go.mod',)) is None:
            raise ValueError('Go imports without go.mod have unknown project ownership')
        result = []
        for imported in imports:
            target = imported['package']
            for module in sorted(self.modules, key=len, reverse=True):
                if target != module and not target.startswith(module + '/'):
                    continue
                target_path = (self.modules[module] / target[len(module):].lstrip('/')).resolve()
                if not target_path.is_relative_to(self.root):
                    raise ValueError(f'Go import outside project boundary: {target}')
                target_owner = self.package(target_path)
                if owner != target_owner:
                    result.append({'from': owner, 'to': target_owner, 'file': file['relative_path'],
                                   'position': imported.get('position', {})})
                break
            # Standard-library and third-party imports are not internal edges.
        return result


def extract(root: Path, language: str, files: dict) -> list[dict]:
    if language not in {'cangjie', 'arkts', 'go'}:
        raise ValueError(f'unsupported import language: {language}')
    failures = (ValueError, OSError, TypeError, KeyError, AttributeError, SyntaxError)
    try:
        adapter = GoImports(root) if language == 'go' else CangjieImports(root, files) if language == 'cangjie' else ArktsImports(root)
    except failures as error:
        return [{'file': file['relative_path'], 'unresolved': str(error)} for file in files.values()]
    result = []
    for file in files.values():
        # Keep extraction gaps as nonblocking facts, not exceptions or empty
        # graphs. Other summary files remain eligible for normal comparison.
        try:
            result.extend(adapter.extract(file))
        except failures as error:
            result.append({'file': file['relative_path'], 'unresolved': str(error)})
    return result
