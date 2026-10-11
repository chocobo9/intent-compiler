"""Shared admission ledger. No model calls; SQLite serializes all processes."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import time


class BudgetExceeded(RuntimeError):
    pass


class RoleDenied(RuntimeError):
    """Refuses one delegation without stopping the stage; nothing is charged."""


def load_policy(path=None):
    p = json.loads(Path(path or Path(__file__).with_name('budget-policy.json')).read_text(encoding='utf-8'))
    times = [p['round_deadline_seconds'], *p['stage_max_seconds'].values()]
    if any(n is not None and (type(n) is not int or n < 0) for n in times):
        raise ValueError('Time limits must be nonnegative integers or null')
    numbers = [p['cleanup_reserve_seconds'], p['verification_reserve_seconds'],
               p['max_total_repairs'], p['max_design_revisions'], p['max_document_revisions'], p['max_auxiliary_delegations'],
               *p['stage_repair_limits'].values()]
    if any(type(n) is not int or n < 0 for n in numbers):
        raise ValueError('Budget values must be nonnegative integers')
    if set(p['stage_max_seconds']) != {'design', 'coding', 'prd', 'final', 'official'}:
        raise ValueError('All required stages must have explicit budgets')
    if p['round_deadline_seconds'] is not None and all(n is not None for n in p['stage_max_seconds'].values()) and sum(p['stage_max_seconds'].values()) + p['cleanup_reserve_seconds'] > p['round_deadline_seconds']:
        raise ValueError('Stage allocations exceed round budget')
    return p


class Budget:
    def __init__(self, path, policy):
        self.path, self.policy = Path(path), policy
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.path) as db:
            db.execute('CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')

    def _change(self, fn):
        with sqlite3.connect(self.path, timeout=10) as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT body FROM ledger WHERE id=1').fetchone()
            state = json.loads(row[0]) if row else {}
            error = None
            try:
                result = fn(state)
            except BudgetExceeded as e:
                state['stop_reason'] = str(e)
                error = e
            db.execute('INSERT OR REPLACE INTO ledger VALUES (1, ?)', (json.dumps(state),))
        if error:
            raise error
        return result

    def initialize(self, now=None):
        now = time.time() if now is None else now
        identity = hashlib.sha256(json.dumps(self.policy, sort_keys=True).encode()).hexdigest()
        def init(s):
            if s:
                if s['policy_hash'] != identity:
                    raise ValueError('Frozen budget policy changed')
                return
            limit = self.policy['round_deadline_seconds']
            s.update(started=now, deadline=now + limit if limit is not None else None, policy_hash=identity,
                     stages={}, counts={}, admitted={}, stop_reason=None, events=[])
        self._change(init)

    def snapshot(self):
        with sqlite3.connect(self.path) as db:
            row = db.execute('SELECT body FROM ledger WHERE id=1').fetchone()
        return json.loads(row[0]) if row else {}

    def start_stage(self, stage, now=None):
        now = time.time() if now is None else now
        def start(s):
            if stage in s['stages']:
                return
            # Fixed stage caps preserve later allocations. Unused time is not
            # silently borrowed by a stage, making paired runs comparable.
            limit = self.policy['stage_max_seconds'][stage]
            deadlines = []
            if limit is not None:
                deadlines.append(now + limit)
            if s['deadline'] is not None:
                deadlines.append(s['deadline'] - self.policy['cleanup_reserve_seconds'])
            s['stages'][stage] = {'started': now, 'deadline': min(deadlines) if deadlines else None}
        self._change(start)

    def _check(self, s, stage, now):
        if not s or stage not in s.get('stages', {}):
            raise BudgetExceeded('budget_not_initialized')
        if s['stop_reason']:
            raise BudgetExceeded(s['stop_reason'])
        expected = hashlib.sha256(json.dumps(self.policy, sort_keys=True).encode()).hexdigest()
        if s['policy_hash'] != expected:
            raise BudgetExceeded('budget_policy_changed')
        if s['stages'][stage]['deadline'] is not None and now >= s['stages'][stage]['deadline']:
            raise BudgetExceeded('stage_timeout:' + stage)

    def check(self, stage, now=None):
        now = time.time() if now is None else now
        self._change(lambda s: self._check(s, stage, now))

    def _repair(self, s, stage, now):
        count = s['counts'].get('repairs:' + stage, 0)
        total = s['counts'].get('repairs:total', 0)
        if count >= self.policy['stage_repair_limits'].get(stage, 0) or total >= self.policy['max_total_repairs']:
            raise BudgetExceeded('repair_limit_reached:' + stage)
        if s['stages'][stage]['deadline'] is not None and s['stages'][stage]['deadline'] - now <= self.policy['verification_reserve_seconds']:
            raise BudgetExceeded('insufficient_reverification_budget:' + stage)
        s['counts']['repairs:' + stage] = count + 1
        s['counts']['repairs:total'] = total + 1

    def admit_external(self, stage, call, role='', now=None):
        now = time.time() if now is None else now
        def admit(s):
            self._check(s, stage, now)
            key = 'external:' + call
            if key in s['admitted']:
                return s['admitted'][key]
            count_key = 'external:' + stage
            count = s['counts'].get(count_key, 0)
            repair = (stage == 'coding' and count > 0) or (stage == 'prd' and role == 'prd-fix')
            if stage == 'prd' and role not in {'prd-check-fix', 'prd-fix'}:
                raise BudgetExceeded('unknown_prd_role')
            if repair:
                self._repair(s, stage, now)
            if stage == 'design' and role in {'prd', 'sd', 'change'}:
                document_key = 'external:design:' + role
                previous = s['counts'].get(document_key, 0)
                prepaid = s.get('document_recovery_admission', {})
                if prepaid.get('role') == role and prepaid.get('prepaid') is True:
                    prepaid['prepaid'] = False
                    prepaid['external_call'] = call
                elif previous:
                    revisions = s['counts'].get('document_revisions', 0)
                    if revisions >= self.policy['max_document_revisions']:
                        raise BudgetExceeded('document_revision_limit_reached')
                    s['counts']['document_revisions'] = revisions + 1
                    s['events'].append({'kind': 'document_revision', 'role': role,
                                        'stage': stage, 'reason': 'external_step_retry', 'time': now})
                s['counts'][document_key] = previous + 1
            s['counts'][count_key] = count + 1
            s['admitted'][key] = {'repair': repair, 'stage': stage}
            s['events'].append({'kind': 'external', 'id': call, 'stage': stage, 'repair': repair, 'time': now})
            return s['admitted'][key]
        return self._change(admit)

    def admit_document_revision(self, role, now=None):
        now = time.time() if now is None else now
        def admit(s):
            self._check(s, 'design', now)
            if role not in {'prd', 'sd', 'change'}:
                raise BudgetExceeded('unknown_document_role')
            count = s['counts'].get('document_revisions', 0)
            if count >= self.policy['max_document_revisions']:
                raise BudgetExceeded('document_revision_limit_reached')
            if s['stages']['design']['deadline'] is not None and s['stages']['design']['deadline'] - now <= self.policy['verification_reserve_seconds']:
                raise BudgetExceeded('insufficient_reverification_budget:design')
            s['counts']['document_revisions'] = count + 1
            s['events'].append({'kind': 'document_revision', 'role': role, 'stage': 'design', 'time': now})
        self._change(admit)

    def admit_task(self, stage, call, role, external, now=None):
        now = time.time() if now is None else now
        def admit(s):
            self._check(s, stage, now)
            key = 'task:' + call
            if key in s['admitted']:
                return
            parent = s['admitted'].get('external:' + external)
            if not parent or parent['stage'] != stage:
                raise BudgetExceeded('unknown_external_call')
            counter = 'role:' + stage + ':' + role
            count = s['counts'].get(counter, 0)
            if role == 'specart-implement':
                if stage not in {'coding', 'prd'}:
                    raise BudgetExceeded('implementation_outside_development_stage')
                if parent['repair'] and not parent.get('implementation_started'):
                    parent['implementation_started'] = True  # Already charged externally.
                elif stage == 'coding' and count == 0 and not parent['repair']:
                    pass  # Initial implementation.
                else:
                    self._repair(s, stage, now)
            elif role == 'specart-author':
                if stage != 'design' or count >= 1 + self.policy['max_design_revisions']:
                    raise BudgetExceeded('design_revision_limit_reached')
            elif role == 'specart-spec-review':
                if stage != 'design' or count >= 1 + self.policy['max_design_revisions']:
                    raise BudgetExceeded('design_review_limit_reached')
            elif role == 'specart-verify':
                maximum = 1 + self.policy['stage_repair_limits'].get(stage, 0)
                if stage not in {'coding', 'prd', 'final'} or count >= maximum:
                    raise BudgetExceeded('verification_limit_reached:' + stage)
            elif role in {'specart-slice', 'specart-fallback-review'}:
                if count >= self.policy['max_auxiliary_delegations']:
                    raise BudgetExceeded('auxiliary_delegation_limit_reached')
            else:
                raise RoleDenied(f'unknown_delegation_role:{role}; delegate only configured SDD roles '
                                 '(specart-author, specart-spec-review, specart-implement, specart-verify, '
                                 'specart-slice, specart-fallback-review) or do this work in the current session')
            s['counts'][counter] = count + 1
            s['admitted'][key] = {'stage': stage, 'role': role}
            s['events'].append({'kind': 'task', 'id': call, 'stage': stage, 'role': role, 'time': now})
        self._change(admit)

    def finish_task(self, call):
        def finish(s):
            task = s.get('admitted', {}).get('task:' + call)
            if task and not task.get('finished'):
                task['finished'] = True
                s['events'].append({'kind': 'task_finished', 'id': call, 'stage': task['stage'],
                                    'role': task['role'], 'time': time.time()})
        self._change(finish)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('ledger'); p.add_argument('policy'); p.add_argument('stage'); p.add_argument('request')
    a = p.parse_args()
    b = Budget(a.ledger, load_policy(a.policy))
    request = json.loads(a.request)
    try:
        if request.get('action') == 'finished':
            b.finish_task(request['call'])
        elif request['tool'] == 'task':
            if request.get('background'):
                raise BudgetExceeded('background_delegation_disabled')
            b.admit_task(a.stage, request['call'], request['role'], request['external'])
        else:
            b.check(a.stage)
    except RoleDenied as e:
        raise SystemExit(str(e))
    except BudgetExceeded as e:
        # Persist all denial paths, including invalid background dispatch.
        b._change(lambda s: s.update(stop_reason=str(e)))
        raise SystemExit(str(e))


if __name__ == '__main__':
    main()
