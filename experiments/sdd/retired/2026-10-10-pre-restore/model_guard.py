"""Frozen external call admission. Invoked by a generated native argv wrapper."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

from budget import Budget, BudgetExceeded, load_policy
from run_results import source_hash, verdict


def run_document(native, args, env, budget, role, target):
    """Continue an unfinished document in its session and existing stage budget."""
    artifact = Path(target['path'])
    attempt = 0
    while True:
        proc = subprocess.Popen([native, *args], env=env, stdout=subprocess.PIPE,
                                text=True, encoding='utf-8', errors='replace')
        session = None
        for line in proc.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            try:
                session = json.loads(line).get('sessionID') or session
            except (ValueError, AttributeError):
                pass
        rc = proc.wait()
        evidence = Path(env['SDD_BUDGET_DB']).parent / 'document-attempts' / role
        evidence.mkdir(parents=True, exist_ok=True)
        if artifact.is_file():
            (evidence / f'attempt-{attempt}.md').write_bytes(artifact.read_bytes())
        status = verdict(artifact, target['skill'])
        (evidence / f'attempt-{attempt}.json').write_text(json.dumps(
            {'session': session, 'exit_code': rc, 'artifact': str(artifact), 'result': status}), encoding='utf-8')
        if rc or status['status'] == 'pass':
            return rc
        if not session:
            return 1
        try:
            budget.admit_document_revision(role)
        except BudgetExceeded as error:
            print(str(error), file=sys.stderr, flush=True)
            return 1
        # Preserve the actual session and runtime options. Never reset the
        # ledger, accepted state or prior document to obtain another attempt.
        options = args[:args.index('--')]
        if '--session' in options:
            idx = options.index('--session')
            del options[idx:idx + 2]
        args = [*options, '--session', session, '--',
            f'Continue the same {role} stage. Read {artifact.as_posix()} and its unresolved findings. '
            'Complete the unfinished in-scope work and run the skill completion checks. '
            'Persist a small outline immediately, then fill it with bounded section edits '
            '(roughly 4000 characters per write). Do not emit the entire document in one '
            'large tool argument: an output-length cutoff can discard that whole edit. '
            'All original inputs, authority, artifact paths and stage boundaries still apply. '
            'Do not stop at a draft solely because it needs more writing. Keep a real blocker as FAIL; '
            'do not waive requirements, fabricate PASS, create product code or start a later stage. '
            f'Write the actual final VERDICT for skill {target["skill"]} to the same artifact. [SDD_ROLE:{role}]']
        attempt += 1


def main(native, args, model, variant):
    if not args or args[0] != 'run':
        return subprocess.call([native, *args])
    options = args[:args.index('--')] if '--' in args else args
    for flag, expected in [('--model', model), ('--variant', variant)]:
        if options.count(flag) != 1 or options.index(flag)+1 >= len(options) or options[options.index(flag)+1] != expected:
            raise SystemExit('MODEL_PROFILE_MISMATCH: refusing before OpenCode launch')
    env = dict(os.environ)
    if env.get('SDD_BUDGET_DB'):
        stage = env['SDD_STAGE']
        prompt = args[args.index('--') + 1] if '--' in args else ''
        roles = re.findall(r'\[SDD_ROLE:([a-z-]+)\]', prompt)
        if len(roles) > 1 or (stage == 'prd' and len(roles) != 1):
            raise SystemExit('Ambiguous/missing frozen SDD_ROLE')
        role = roles[0] if roles else ''
        call = str(uuid.uuid4())
        budget = Budget(env['SDD_BUDGET_DB'], load_policy(env['SDD_BUDGET_POLICY']))
        try:
            budget.admit_external(stage, call, role)
        except BudgetExceeded as e:
            raise SystemExit(str(e))
        env['SDD_EXTERNAL_CALL'] = call
        documents = json.loads(env.get('SDD_DOCUMENT_TARGETS', '{}'))
        if stage == 'design' and role in {'prd', 'sd', 'change'} and role in documents:
            return run_document(native, args, env, budget, role, documents[role])
    check_input = None
    if env.get('SDD_BUDGET_DB') and stage == 'prd' and role == 'prd-check-fix':
        check_input = source_hash(Path(env['SDD_PROJECT']))
    result = subprocess.call([native, *args], env=env)
    if check_input is not None:
        target = Path(env['SDD_BUDGET_DB']).parent / 'prd-check-source.json'
        temporary = target.with_suffix('.tmp')
        temporary.write_text(json.dumps({'before': check_input, 'after': source_hash(Path(env['SDD_PROJECT'])),
                                         'exit_code': result}), encoding='utf-8')
        os.replace(temporary, target)
    return result
