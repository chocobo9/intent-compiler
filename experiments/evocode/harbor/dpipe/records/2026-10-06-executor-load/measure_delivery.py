"""Offline measurement for the design session: how much delivered Atom text each
mainline round re-sends unchanged, and what (i) delta delivery or (ii) a per-change
Atom would remove.  Read only; no source change."""
import json, re, collections

EVO = 'D:/huawei/EvoCodeBench/'
D = EVO + 'harbor_checkpoints/intent-luna-dpipe-online-r11r15-20261005-174552z-536c06a9/round-15/compiler-store/v2-runs/intent-luna-dpipe-full-r1r5-20261002-053740-e6308341'
s = json.load(open(D + '/snapshot.json', encoding='utf-8'))
atoms = {a['revision']: a for a in s['compiled']['t-dpipe']['atoms']}
disp = {x['dispatch_id']: x for x in s['dispatches']}
executed = [disp[e['dispatch_id']]['atom_revision'] for e in s['executions']]  # one per round, R1..R15

# Executor steps and prompt tokens per round: dpipe/README "初版主线 R1-R15 汇总" table.
STEPS = {3: 36, 4: 26, 5: 29, 6: 16, 7: 16, 8: 22, 9: 25, 10: 15, 11: 26, 12: 20, 13: 33, 14: 16, 15: 17}
PROMPT = {3: 219e4, 4: 155e4, 5: 202e4, 6: 100e4, 7: 71e4, 8: 123e4, 9: 175e4, 10: 83e4, 11: 179e4, 12: 111e4, 13: 175e4, 14: 99e4, 15: 126e4}
CHARS_PER_TOKEN = 4.0
STUB = 140  # a one-line reference for an unchanged block: label plus "unchanged; full text on request"

HEAD = re.compile(r'^\[assigned requirement (\S+)@(\d+) (sha256:[0-9a-f]+)\]$', re.M)

def blocks(task):
    marks = list(HEAD.finditer(task))
    head = task[:marks[0].start()] if marks else task
    out = []
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(task)
        body = task[m.start():end]
        out.append({'id': m.group(1), 'rev': int(m.group(2)), 'digest': m.group(3), 'chars': len(body),
                    'inputs': sorted({int(x) for x in re.findall(r'^\[user input (\d+)\]$', body, re.M)})})
    return head, out

rows = []
prev = None
for rnd, rev in enumerate(executed, start=1):
    head, bl = blocks(atoms[rev]['task'])
    total = len(atoms[rev]['task'])
    if prev is not None and rnd >= 3:
        before = {(b['id'], b['digest']) for b in prev}
        before_ids = {b['id'] for b in prev}
        changed = [b for b in bl if (b['id'], b['digest']) not in before]
        unchanged = [b for b in bl if (b['id'], b['digest']) in before]
        revised = [b for b in changed if b['id'] in before_ids]
        created = [b for b in changed if b['id'] not in before_ids]
        size_i = len(head) + sum(b['chars'] for b in changed) + STUB * len(unchanged)
        size_ii = len(head) + sum(b['chars'] for b in changed)
        # Older user inputs inside changed blocks: the corrections executors must see beside the new text.
        old_in_changed = sum(1 for b in changed if any(i < rnd for i in b['inputs']))
        rows.append(dict(round=rnd, atom=f'a-dpipe@{rev}', full=total, head=len(head), blocks=len(bl),
                         unchanged=len(unchanged), unchanged_chars=sum(b['chars'] for b in unchanged),
                         created=[b['id'] for b in created], revised=[b['id'] for b in revised],
                         changed_with_old_text=old_in_changed, size_i=size_i, size_ii=size_ii))
    prev = bl

print(f"{'R':>3} {'atom':12} {'full':>7} {'unch':>5} {'unch_chars':>10} {'(i)':>7} {'(ii)':>7}  created / revised")
tot = collections.Counter()
for r in rows:
    n = r['round']
    steps, prompt = STEPS[n], PROMPT[n]
    for key, size in (('i', r['size_i']), ('ii', r['size_ii'])):
        saved_chars = r['full'] - size
        saved_tokens = saved_chars / CHARS_PER_TOKEN * steps          # the Atom sits in every step's prompt
        uncached = saved_chars / CHARS_PER_TOKEN                      # first step only
        cached = saved_chars / CHARS_PER_TOKEN * (steps - 1)
        r[f'saved_tokens_{key}'] = saved_tokens; r[f'share_{key}'] = saved_tokens / prompt
        tot[f'saved_{key}'] += saved_tokens; tot[f'uncached_{key}'] += uncached; tot[f'cached_{key}'] += cached
    tot['prompt'] += prompt
    print(f"{n:>3} {r['atom']:12} {r['full']:>7} {r['unchanged']:>2}/{r['blocks']:<2} {r['unchanged_chars']:>10} {r['size_i']:>7} {r['size_ii']:>7}  "
          f"{r['created']} / {r['revised']}  old-text-in-changed={r['changed_with_old_text']}  "
          f"saved(i)={r['saved_tokens_i']/1e4:.0f}万 ({r['share_i']:.0%})  saved(ii)={r['saved_tokens_ii']/1e4:.0f}万 ({r['share_ii']:.0%})")
print('\nR3-R15 executor prompt tokens (README):', f"{tot['prompt']/1e4:.0f}万")
for key in ('i', 'ii'):
    print(f"({key}) saved prompt tokens: {tot['saved_'+key]/1e4:.0f}万 = {tot['saved_'+key]/tot['prompt']:.0%} of R3-R15 prompt; "
          f"uncached part {tot['uncached_'+key]/1e4:.1f}万, cached part {tot['cached_'+key]/1e4:.0f}万")
    for ratio in (0.1, 0.25, 0.5):
        eff_saved = tot['uncached_'+key] + tot['cached_'+key] * ratio
        eff_total = tot['prompt'] * (0.05 + 0.95 * ratio)
        print(f"     cache price ratio {ratio}: effective saving {eff_saved/1e4:.0f}万 of {eff_total/1e4:.0f}万 uncached-equivalent = {eff_saved/eff_total:.0%}")
import sys
if len(sys.argv) > 1: json.dump(rows, open(sys.argv[1], 'w'), indent=1)
