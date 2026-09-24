"""Read-only reconciliation of explicit reviews; never creates review decisions."""
from pathlib import Path
import hashlib,json
ROOT=Path.cwd();OUT=ROOT/'docs/evidence/commercial-acceptance/printing'
read=lambda n:json.loads((OUT/n).read_text(encoding='utf8'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
results=read('all-results.json')
base=read('root-visual-review-current.json')['pages']+read('print-agent-visual-final.json')['pages']
root_stress=read('root-stress-visual-review.json')
stress=[dict(c,status=c.get('status',root_stress.get('status'))) for c in root_stress['cases']]+read('print-agent-stress-review.json')
errors=[]
for p in base+[p for case in stress for p in case['pages']]:
 path=p.get('image',p.get('path'))
 if sha(ROOT/path)!=p['sha256']:errors.append({'path':path,'error':'REVIEW_HASH_MISMATCH'})
for p in base:
 if p.get('status')!='PASS':errors.append({'path':p.get('image',p.get('path')),'error':'REVIEW_NOT_PASS'})
for c in stress:
 if c.get('status')!='PASS':errors.append({'case':c['case'],'error':'STRESS_REVIEW_NOT_PASS'})
expectedbase={p['image'] for r in results if r['variant']!='stress' for p in r['pages']}
actualbase={p.get('image',p.get('path')) for p in base}
expectedstress={p['path'] for c in read('stress-visual-manifest.json') for p in c['pages']}
actualstress={p['path'] for c in stress for p in c['pages']}
for label,expected,actual in [('BASE',expectedbase,actualbase),('STRESS',expectedstress,actualstress)]:
 if expected!=actual:errors.append({'error':label+'_REVIEW_COVERAGE','missing':sorted(expected-actual),'extra':sorted(actual-expected)})
sources=['root-visual-review-current.json','print-agent-visual-final.json','root-stress-visual-review.json','print-agent-stress-review.json']
report={'status':'FAIL' if errors else 'PASS','basePhysicalPages':len(actualbase),'stressSamplePhysicalPages':len(actualstress),'stressNotFullManualReview':True,'errors':errors,'sources':sources,'sourceHashes':{n:sha(OUT/n) for n in sources}}
(OUT/'final-visual-reconciliation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(report));raise SystemExit(bool(errors))
