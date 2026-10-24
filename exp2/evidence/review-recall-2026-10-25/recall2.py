import json,sys,os,re,collections
runs=sys.argv[1:]
STOP=set('a an the of in on to for and or with is are be by at as from into not no check basic output file exists count row rows value values data when after before transform then chain edge case cases function operator operators expression multiple all same empty missing error first last invalid'.split())
def cases(path):
    out={}
    for line in open(path,encoding='utf-8',errors='replace'):
        if not line.startswith('CASE_RESULT'): continue
        d=dict(re.findall(r'(\w+)=("[^"]*"|\S+)',line[len('CASE_RESULT '):])); d={k:v.strip('"') for k,v in d.items()}
        out[d['case_id']]=d
    return out
def words(t): return {w for w in re.findall(r'[a-z][a-z0-9_-]+',t.lower()) if w not in STOP and len(w)>2}
rows=[]; cases_out=[]; unment=collections.Counter(); unment_rounds=collections.defaultdict(set)
for R in runs:
    lab=R.split('-')[5]
    s=json.load(open(f'{R}/state/exp2-state.json',encoding='utf-8'))
    for e in s['executions']:
        rd=e['round']; d=f'{R}/official/round-{rd:02d}'
        first=e['first_delivery']['commit'][:12]; head=e['head'][:12]
        if not os.path.isdir(f'{d}/{first}'): continue
        cf=cases(f'{d}/{first}/verifier.log'); cl=cases(f'{d}/{head}/verifier.log') if os.path.isdir(f'{d}/{head}') else cf
        items=[i for i in e['review_items'] if i['round']==rd]
        itext=' '.join(i['text'] for i in items).lower(); iwords=words(itext)
        fail=[c for c in cf.values() if c['status']!='success']
        byop=collections.defaultdict(list)
        for c in fail: byop[c['requirement_ref'].split('.')[-1]].append(c)
        op_tot=len(byop); op_ment=0; beh=0; ff=0; ff_un=0; ff_opun=0
        for op,cs in byop.items():
            opm=bool(re.search(r'\b'+re.escape(op)+r'\b',itext)) or (op=='rename-drop' and ('rename' in itext or 'drop' in itext))
            if opm: op_ment+=1
            for c in cs:
                iw=words(c['intent'])-{op}; bm=bool(iw & iwords)
                if bm: beh+=1
                still=cl.get(c['case_id'],{}).get('status')!='success'
                if still:
                    ff+=1
                    if not bm: ff_un+=1
                    if not opm: ff_opun+=1; unment[(lab,op)]+=1; unment_rounds[(lab,op)].add(rd)
                cases_out.append(dict(run=lab,round=rd,case=c['case_id'],op=op,intent=c['intent'],op_mentioned=opm,behaviour_mentioned=bm,still_failing=still))
        rows.append((lab,rd,len(fail),op_tot,op_ment,beh,len(items),ff,ff_un,ff_opun))
print(f"{'run':6}{'R':>2} {'首次挂':>7} {'涉及op':>7} {'op被提到':>9} {'行为被提到':>10} {'发现数':>7} {'轮末仍挂':>9} {'仍挂且行为未提':>14} {'仍挂且op未提':>13}")
for r in rows: print(f"{r[0]:6}{r[1]:>2} {r[2]:>8} {r[3]:>8} {r[4]:>10} {r[5]:>12} {r[6]:>8} {r[7]:>11} {r[8]:>17} {r[9]:>16}")
print('\n轮末仍挂且 op 未被任何发现提到（run, op: 用例数, 轮次）:')
for (lab,op),n in sorted(unment.items()): print(f'  {lab} {op}: {n}  rounds {sorted(unment_rounds[(lab,op)])}')
json.dump(dict(rows=rows,cases=cases_out),open(os.environ['OUT']+'/recall2.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
