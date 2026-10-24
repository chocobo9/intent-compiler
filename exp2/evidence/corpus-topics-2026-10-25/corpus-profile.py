import os,re,sys,json,collections
root=sys.argv[1]
tasks=sorted(d for d in os.listdir(root) if os.path.isdir(os.path.join(root,d,'steps')))
REV=re.compile(r'\b(no longer|instead of|replace[sd]?|previously|deprecat|remove[sd]?|supersede|is now|now (?:must|should|returns|uses|requires|emits|rejects)|rather than|change[sd]? (?:from|the|so)|revert|drop(?:ped|s)? (?:the|support))\b',re.I)
XREF=re.compile(r'\b(same (?:as|rules?|format|semantics|behaviou?r)|as (?:in|with|for) |consistent with|like (?:the|in) |see (?:the|section|above)|identical to|follows? the same|mirrors?|reuse[sd]?|shared? (?:with|by)|applies? to (?:all|every|each)|every command|all commands)\b',re.I)
def heads(t): return re.findall(r'^(#{1,6})\s+(.*)$',t,re.M)
def codeish(h):
    h=h.strip()
    return bool(re.search(r'`[^`]+`',h)) or bool(re.fullmatch(r'[\w./-]+(\s*\([^)]*\))?',h)) or bool(re.match(r'^(new|add|update|extend|the )?\s*`?[a-z][\w-]*`?\s*(command|subcommand|endpoint|mode|flag|option|op|operation)\b',h,re.I))
rows=[]
for t in tasks:
    sd=os.path.join(root,t,'steps'); rounds=sorted((d for d in os.listdir(sd) if d.startswith('round-')),key=lambda x:int(x.split('-')[1]))
    chars=0; nh=0; nhc=0; revs=0; xrefs=0; bullets=0; lines=0; sents=0; words=0; dup_heads=0; seen=set(); per=[]
    hd_levels=collections.Counter()
    for r in rounds:
        p=os.path.join(sd,r,'instruction.md')
        if not os.path.exists(p): continue
        txt=open(p,encoding='utf-8',errors='replace').read()
        chars+=len(txt); hs=heads(txt); nh+=len(hs)
        for lvl,h in hs:
            hd_levels[len(lvl)]+=1
            if codeish(h): nhc+=1
            key=re.sub(r'\W+',' ',h.lower()).strip()
            if key in seen: dup_heads+=1
            seen.add(key)
        rv=len(REV.findall(txt)); xr=len(XREF.findall(txt)); revs+=rv; xrefs+=xr
        ls=[l for l in txt.splitlines() if l.strip()]; lines+=len(ls); bullets+=sum(1 for l in ls if re.match(r'^\s*([-*+]|\d+\.)\s',l))
        s=re.split(r'(?<=[.!?])\s+',re.sub(r'```.*?```','',txt,flags=re.S)); sents+=len(s); words+=sum(len(x.split()) for x in s)
        per.append((r,len(txt),len(hs),rv,xr))
    rows.append(dict(task=t,rounds=len(rounds),chars=chars,heads=nh,heads_codeish=nhc,heads_repeat=dup_heads,levels=dict(hd_levels),rev_cues=revs,xref_cues=xrefs,bullet_ratio=round(bullets/max(lines,1),2),avg_sentence_words=round(words/max(sents,1),1),per_round=per))
json.dump(rows,open(sys.argv[2],'w',encoding='utf-8'),ensure_ascii=False,indent=1)
print(f"{'task':70} rounds chars  heads code% repeat rev xref bullet sent")
for r in rows:
    print(f"{r['task'][:70]:70} {r['rounds']:>3} {r['chars']:>7} {r['heads']:>4} {round(100*r['heads_codeish']/max(r['heads'],1)):>4} {r['heads_repeat']:>4} {r['rev_cues']:>4} {r['xref_cues']:>4} {r['bullet_ratio']:>5} {r['avg_sentence_words']:>5}")
