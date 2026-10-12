from error_probes import parse, probes

TEXT = '''# Tool
### Reading
`tool read --input <path> --spec <path> --output <path>`

### Joining
`tool join --left <path> --right <path> --key <col> --output <path>`

#### Error handling
- Missing `--key` flag: exit code 1, stderr `ERROR: --key is required`.

### Loading
`tool load --config <path> --output <path>`

#### Errors
- Invalid JSON: exit 1, `ERROR: invalid load config: <path>`.

### Error handling
- Missing input files: exit code 1, stderr `ERROR: file not found: <path>`.
- Malformed JSON config/spec: exit code 1, stderr `ERROR: malformed JSON: <path>`.
'''


def test_rules_belong_to_the_section_holding_one_synopsis_or_are_shared():
    synopses, rules = parse([TEXT])
    assert set(synopses) == {'read', 'join', 'load'}
    owners = {r['template']: r['command'] for r in rules}
    assert owners['ERROR: --key is required'] == 'join'
    assert owners['ERROR: invalid load config: <path>'] == 'load'
    assert owners['ERROR: file not found: <path>'] is None


def test_probes_trigger_exactly_the_written_rule():
    got = {p['id']: p for p in probes([TEXT], 1)}
    assert set(got) == {'read:missing-file', 'read:malformed-json-spec', 'join:missing-file', 'join:missing-flag-key',
                        'load:missing-file', 'load:malformed-json-config'}
    assert '--key' not in got['join:missing-flag-key']['run']['args']
    assert got['load:malformed-json-config']['asserts'][0]['value'].startswith('ERROR:\\ invalid\\ load\\ config:')
    files = {f['path']: f['content'] for f in got['read:malformed-json-spec']['run']['files']}
    assert files['in-spec.csv'] == '{' and files['in-input.csv'].startswith('id,')
    assert not got['read:missing-file']['run']['files'], 'every input path is absent'
