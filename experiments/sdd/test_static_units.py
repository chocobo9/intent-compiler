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


def test_a_unit_is_missing_unless_a_dispatch_of_its_own_kind_names_it(tmp_path):
    (tmp_path / 'main.go').write_text('switch o.Op {\ncase "upper", "lower":\n}\nif o.Op == "trim" {\n}\n'
                                      'switch fn {\ncase "abs", "round":\n}\nvar m = map[string]int{"pad": 1}\n// mentions "show" in a comment\n')
    (tmp_path / 'main_test.go').write_text('case "run":\n')
    got = missing(tmp_path, [('op', 'upper'), ('op', 'lower'), ('op', 'trim'), ('op', 'round'), ('op', 'pad'), ('command', 'show'), ('command', 'run')])
    # round only names an expression function and pad only a map that dispatches no op: neither is an op dispatch.
    assert got == [('op', 'round'), ('op', 'pad'), ('command', 'show'), ('command', 'run')]


def test_an_op_switch_is_told_apart_from_a_function_table_by_the_names_it_holds(tmp_path):
    ops = ', '.join(f'"{n}"' for n in ('filter', 'sort', 'drop', 'fill', 'derive', 'coalesce'))
    (tmp_path / 'main.go').write_text(f'switch step.Kind {{\ncase {ops}:\n}}\nswitch name {{\ncase "abs", "round", "coalesce":\n}}\n')
    names = [('op', n) for n in ('filter', 'sort', 'drop', 'fill', 'derive', 'coalesce', 'round')]
    assert missing(tmp_path, names) == [('op', 'round')]


def test_nested_samples_and_two_valued_headed_keys_are_units():
    r1 = '### Fill\n```json\n{"op": "fill", "strategy": "forward"}\n```\n'
    r2 = ('### `rollup`\n```json\n{"op": "rollup", "aggregations": [{"column": "sales", "function": "sum", "as": "total"}]}\n```\n'
          '### Fill `linear` strategy\n```json\n{"op": "fill", "strategy": "linear"}\n```\n### `split`\n```json\n{"op": "split"}\n```\n')
    found = units([r1, r2])
    assert ('op', 'rollup') in found and ('strategy', 'linear') in found
    assert ('function', 'sum') not in found, 'a value without its own heading is not a unit'
