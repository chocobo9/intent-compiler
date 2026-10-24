import os,re,sys,json,collections
root=sys.argv[1]; tasks=sys.argv[2:]
# cue patterns (code-side only). Each hit = one candidate change-unit anchor.
P={
 'changes_to': re.compile(r'^\s*(?:\*\*|#{1,4}\s*)?changes? to `?([^`*\n]+)`?',re.I|re.M),
 'cross_list': re.compile(r'\b(?:across|affects?|applies to|for)\s+(?:all|every|each|multiple)\s+(?:commands?|stages?|endpoints?)|\ball (?:existing |deployment-related )?commands\b',re.I),
 'prev_new': re.compile(r'(?:###?\s*previous behaviou?r|###?\s*new behaviou?r|\bpreviously\b[^.\n]{0,120}\b(?:now|corrected|instead)\b|\binstead of\b|\bno longer\b|\brather than\b|\bis now replaced\b|\bnow (?:defaults?|uses|maps|returns|emits|requires|must)\b)',re.I),
 'scope_unchanged': re.compile(r'(?:unchanged behaviou?r|all (?:other |existing )?(?:behaviou?rs?|functionality|commands|endpoints)[^.\n]{0,80}(?:unchanged|as before|continue|remain|still hold)|not mentioned above|continues? to hold|remains? (?:unchanged|the same|as before))',re.I),
 'author_id': re.compile(r'\b(?:F\d{1,3}|Section \d+(?:\.\d+)?|§\s?\d+|round[- ]\d+|v\d(?:-v\d)?)\b',re.I),
 'explicit_ref_to_cmd_in_revision': re.compile(r'(?:`([a-z][\w.-]{2,})`[^.\n]{0,80}\b(?:now|no longer|instead|unchanged|still)\b)|(?:\b(?:now|no longer|instead)\b[^.\n]{0,80}`([a-z][\w.-]{2,})`)',re.I),
}
for t in tasks:
    sd=os.path.join(root,t,'steps'); rounds=sorted((d for d in os.listdir(sd) if d.startswith('round-')),key=lambda x:int(x.split('-')[1]))
    print(f"\n== {t}")
    print(f"{'round':8}{'chars':>7}{'chg_to':>8}{'cross':>7}{'prevnew':>9}{'scope':>7}{'authid':>8}{'cmd-in-rev':>11}  changes_to targets / cmds named in revisions")
    tot=collections.Counter()
    for r in rounds:
        txt=open(os.path.join(sd,r,'instruction.md'),encoding='utf-8',errors='replace').read()
        c={k:len(rx.findall(txt)) for k,rx in P.items()}
        for k,v in c.items(): tot[k]+=v
        targets=[m.strip() for m in P['changes_to'].findall(txt)][:6]
        cmds=sorted({(a or b).lower() for a,b in P['explicit_ref_to_cmd_in_revision'].findall(txt)})[:8]
        print(f"{r:8}{len(txt):>7}{c['changes_to']:>8}{c['cross_list']:>7}{c['prev_new']:>9}{c['scope_unchanged']:>7}{c['author_id']:>8}{c['explicit_ref_to_cmd_in_revision']:>11}  {targets} / {cmds}")
    print('  total',dict(tot))
