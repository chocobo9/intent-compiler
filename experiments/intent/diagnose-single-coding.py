"""Bounded replay of single-coding-001 turn 3; diagnostic variants, not Compiler fixes."""
import argparse
import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SOURCE = Path(r'D:\huawei\intent-single-coding-001')
ROOT = Path(r'D:\huawei\intent-single-coding-diagnostic-001')
EXE = r'C:\Program Files\nodejs\node_modules\opencode-ai\bin\opencode.exe'


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2))


def symptom(text):
    # A narrow negative detector, not an automatic semantic pass criterion.
    return bool(re.search(r'keep the automatic conversion in place for now|keep the existing structured-ndarray-to-[^\n]*conversion', text, re.I))


def original():
    events = [json.loads(line) for line in (SOURCE / 'compiler-store/runs/single-coding-001/history.jsonl').read_text().splitlines()]
    commit = next(e['data'] for e in events if e['type'] == 'commit.complete' and e['data'].get('inputIdentity') == 'single-coding-001-turn-3')
    return commit['renderedText'], commit['compiledIntent']


def check_record():
    events = [json.loads(line) for line in (SOURCE / 'logs/turn-3.jsonl').read_text().splitlines()]
    text = '\n'.join(e['part']['text'] for e in events if e['type'] == 'text')
    print(json.dumps({'source': 'original turn 3', 'known_wrong_keep_now': symptom(text)}))
    return 1 if symptom(text) else 0


def run(cases):
    rendered, artifact = original()
    ROOT.mkdir(exist_ok=True)
    modeldir = ROOT / 'model'
    if not modeldir.exists():
        save(modeldir / 'opencode.json', json.loads((SOURCE / 'compiler-model/opencode.json').read_text()))
    harness = (SOURCE / 'inputs/harness.txt').read_text()
    # Preserve formatting, wrapper and every unchanged byte. Derived payloads are
    # counterfactual diagnostic messages: old digest fields are not valid commitments.
    start = rendered.index('  "inactive_requirements": [')
    end = rendered.index('  "open_unresolved":', start)
    no_inactive = rendered[:start] + '  "inactive_requirements": [],\n' + rendered[end:]
    old = artifact['active_requirements'][-1]['text']
    new = '[LLM-PROTOTYPE] Include the originally planned 5.2 behavior change in this change: remove the existing structured-ndarray-to-NdarrayMixin transformation clause so the structured array is added as a Column.'
    assert rendered.count(old) == 2
    variants = {'original': rendered, 'original-repeat': rendered,
                'no-inactive': no_inactive, 'explicit-scope': rendered.replace(old, new, 1)}
    env = {k: v for k, v in os.environ.items() if not k.startswith(('EXPERIMENT_', 'INTENT_COMPILER_'))}
    # Reuse login, but never emit authentication headers or unfiltered config.
    import base64
    headers = {'Content-Type': 'application/json'}
    if env.get('OPENCODE_SERVER_PASSWORD'):
        credential = env.get('OPENCODE_SERVER_USERNAME', 'opencode') + ':' + env['OPENCODE_SERVER_PASSWORD']
        headers['Authorization'] = 'Basic ' + base64.b64encode(credential.encode()).decode()
    suffix = '?' + urlencode({'directory': str(modeldir)})

    def http(method, path, body=None):
        req = Request('http://127.0.0.1:4198' + path + suffix,
                      data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
        with urlopen(req, timeout=180) as response:
            return json.load(response)

    logid = '-'.join(cases)
    with (ROOT / (logid + '.server.log')).open('xb') as logfile:
        process = subprocess.Popen([EXE, 'serve', '--hostname', '127.0.0.1', '--port', '4198'], cwd=modeldir,
                                   env=env, stdout=logfile, stderr=logfile, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            for _ in range(40):
                if process.poll() is not None:
                    raise RuntimeError('Diagnostic server exited')
                try:
                    config = http('GET', '/config')
                    break
                except OSError:
                    time.sleep(.25)
            else:
                raise RuntimeError('Diagnostic server did not become ready')
            options = config.get('provider', {}).get('openai', {}).get('models', {}).get('gpt-5.6-luna-fast', {}).get('options', {})
            assert options.get('reasoningEffort') == 'max'
            assert not config.get('plugin'), 'Replay must not load Compiler plugins'
            for name in cases:
                case = ROOT / name
                case.mkdir(exist_ok=False)
                text = variants[name]
                save(case / 'input.txt', text)
                save(case / 'system.txt', harness)
                save(case / 'manifest.json', {'origin': str(SOURCE), 'condition': name,
                    'model': 'openai/gpt-5.6-luna-fast', 'variant': 'max', 'resolved_effort': options['reasoningEffort'],
                    'fresh_session': True, 'transport': 'OpenCode HTTP build agent; no Compiler/plugin execution',
                    'input_sha256': hashlib.sha256(text.encode()).hexdigest(),
                    'derived_payload': name not in ('original', 'original-repeat'),
                    'warning': 'Derived payload digest fields are unchanged historical metadata, not valid Compiler commitments. No modified payload is committed.'})
                session = http('POST', '/session', {'title': 'single-coding diagnostic ' + name,
                    'permission': [{'permission': '*', 'pattern': '*', 'action': 'deny'}]})
                save(case / 'session.json', session)
                request = {'model': {'providerID': 'openai', 'modelID': 'gpt-5.6-luna-fast'},
                           'agent': 'build', 'variant': 'max', 'system': harness,
                           'tools': {'*': False}, 'parts': [{'type': 'text', 'text': text}]}
                save(case / 'request.json', request)
                response = http('POST', '/session/' + session['id'] + '/message', request)
                save(case / 'response.json', response)
                if response.get('info', {}).get('error'):
                    raise RuntimeError(str(response['info']['error']))
                assert not any(p['type'] in ('tool', 'subtask') for p in response['parts'])
                answer = '\n'.join(p['text'] for p in response['parts'] if p['type'] == 'text')
                save(case / 'answer.txt', answer)
                print(json.dumps({'condition': name, 'known_wrong_keep_now': symptom(answer), 'answer': answer}), flush=True)
        finally:
            process.terminate()
            process.wait(timeout=15)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cases', nargs='+', choices=['check-record', 'original', 'original-repeat', 'no-inactive', 'explicit-scope'])
    args = parser.parse_args()
    if args.cases == ['check-record']:
        raise SystemExit(check_record())
    run(args.cases)
