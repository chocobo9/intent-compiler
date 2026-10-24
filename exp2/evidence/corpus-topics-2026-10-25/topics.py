import os,re,sys,json,collections
root=sys.argv[1]
P={
 'scope_unchanged': re.compile(r'(unchanged behaviou?r|all (?:other |existing )?(?:behaviou?rs?|functionality|commands|endpoints)[^.\n]{0,60}(?:unchanged|as before|continue|remain|still)|not mentioned above|remains? (?:unchanged|the same|as before))',re.I),
 'cross_cut': re.compile(r'(changes? to `[^`]+`|all (?:existing |deployment-related )?commands|every command|across (?:all|multiple) (?:commands|stages|endpoints)|applies to (?:all|every|each)|for (?:all|every) (?:command|stage|endpoint))',re.I),
 'self_ref': re.compile(r'(\(?(?:section|§)\s*\d+(?:\.\d+)?\)?|\bround[- ]\d+\b|\bF\d{1,3}\b|\bv\d(?:-v\d)?\b|specified in round|from (?:round|section) \d+|as defined (?:in|above)|\(conflict with [^)]+\))',re.I),
 'prev_new': re.compile(r'(### ?previous behaviou?r|### ?new behaviou?r|previously[, ]|before this change|was `[^`]+`[^.\n]{0,40}now)',re.I),
 'bugfix': re.compile(r'(known issues?|fix (?:these|the) bugs?|incorrectly|bug|regression|correction)',re.I),
 'cmd_para': re.compile(r'^\s*(?:\*\*`|#{1,4} .*`|\d+\.\s+\*\*)',re.M),
}
res=[]
for t in sorted(os.listdir(root)):
    sd=os.path.join(root,t,'steps')
    if not os.path.isdir(sd): continue
    c=collections.Counter(); rounds=0; rounds_with=collections.Counter()
    for r in sorted(os.listdir(sd),key=lambda x:int(x.split('-')[1])):
        p=os.path.join(sd,r,'instruction.md')
        if not os.path.exists(p): continue
        rounds+=1; txt=open(p,encoding='utf-8',errors='replace').read()
        for k,rx in P.items():
            n=len(rx.findall(txt)); c[k]+=n
            if n: rounds_with[k]+=1
    res.append((t,rounds,c,rounds_with))
with open(sys.argv[2],'w',encoding='utf-8') as f:
    f.write(f"{'task':58} rnds | scope(r) cross(r) selfref(r) prev/new(r) bugfix(r) cmd-paras\n")
    for t,n,c,rw in res:
        f.write(f"{t.replace('theme_','')[:58]:58} {n:>3} | {c['scope_unchanged']:>3}({rw['scope_unchanged']:>2}) {c['cross_cut']:>3}({rw['cross_cut']:>2}) {c['self_ref']:>3}({rw['self_ref']:>2}) {c['prev_new']:>3}({rw['prev_new']:>2}) {c['bugfix']:>3}({rw['bugfix']:>2}) {c['cmd_para']:>4}\n")
    tot=collections.Counter(); tr=collections.Counter()
    for t,n,c,rw in res:
        for k in P: tot[k]+=c[k]; tr[k]+=rw[k]
    f.write(f"\nTOTAL rounds={sum(n for _,n,_,_ in res)} | "+' '.join(f"{k}={tot[k]}(rounds {tr[k]})" for k in P)+"\n")
    f.write("tasks with zero cross_cut: "+', '.join(t.replace('theme_','') for t,n,c,rw in res if c['cross_cut']==0)+"\n")
print(open(sys.argv[2],encoding='utf-8').read().encode('ascii','replace').decode())
