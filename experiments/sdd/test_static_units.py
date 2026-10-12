from static_units import missing, units

R1 = '''# Tool
Usage: `tool run --input <path>` and `tool show --id <n>` and `tool list --all`.

### `upper`
```json
{"op": "upper", "column": "name", "as": "name_up"}
```
### `lower`
```json
{"op": "lower", "column": "city", "as": "city_low"}
```
'''
R2 = '''## New op `trim`
```json
{"op": "trim", "column": "name", "as": "name_trim"}
```
'''


def test_units_are_headed_discriminator_values_and_subcommands():
    found = units([R1, R2])
    assert {k for k in found if k[0] == 'op'} == {('op', 'upper'), ('op', 'lower'), ('op', 'trim')}
    assert found[('op', 'trim')] == 1
    assert {k for k in found if k[0] == 'command'} == {('command', 'run'), ('command', 'show'), ('command', 'list')}
    assert not any(k[0] in ('column', 'as') for k in found), 'data values in samples are not variants'


def test_a_unit_is_missing_unless_code_dispatches_on_its_exact_name(tmp_path):
    (tmp_path / 'main.go').write_text('switch op {\ncase "upper", "lower":\n}\nvar m = map[string]int{"trim": 1}\n// mentions "show" in a comment\n')
    (tmp_path / 'main_test.go').write_text('case "run":\n')
    got = missing(tmp_path, [('op', 'upper'), ('op', 'lower'), ('op', 'trim'), ('command', 'show'), ('command', 'run')])
    assert got == [('command', 'show'), ('command', 'run')]


def test_nested_samples_and_two_valued_headed_keys_are_units():
    r1 = '### Fill\n```json\n{"op": "fill", "strategy": "forward"}\n```\n'
    r2 = ('### `rollup`\n```json\n{"op": "rollup", "aggregations": [{"column": "sales", "function": "sum", "as": "total"}]}\n```\n'
          '### Fill `linear` strategy\n```json\n{"op": "fill", "strategy": "linear"}\n```\n### `split`\n```json\n{"op": "split"}\n```\n')
    found = units([r1, r2])
    assert ('op', 'rollup') in found and ('strategy', 'linear') in found
    assert ('function', 'sum') not in found, 'a value without its own heading is not a unit'
