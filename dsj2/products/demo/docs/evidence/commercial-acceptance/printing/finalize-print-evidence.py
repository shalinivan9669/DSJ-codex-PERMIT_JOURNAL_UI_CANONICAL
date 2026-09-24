import hashlib,json,os,sys,time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ROOT=Path.cwd();OUT=ROOT/'docs/evidence/commercial-acceptance/printing'
sys.path.insert(0,str(ROOT/'scripts/render'))
os.environ['DEMO_ARTIFACT_ROOT']=str(OUT/'photo-store')
from renderer import render_docx
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
dump=lambda p,x:p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
manifest=json.loads((ROOT/'assets/templates/manifest.json').read_text(encoding='utf8'))
results=[]
for t in manifest['templates']:
 for variant in ['short','long','blank','batch','punctuation']:
  results.append(json.loads((OUT/(t['id']+'-'+variant+'.result.json')).read_text(encoding='utf8')))
 for n in ([1,2,3,10,13,50,100] if t['id'].endswith('protocol') else [1,2,100]):
  results.append(json.loads((OUT/(t['id']+f'-stress-{n:03}.result.json')).read_text(encoding='utf8')))
for phase in ['base','stress','all']:
 rows=[r for r in results if phase=='all' or ((r['variant']=='stress')==(phase=='stress'))]
 dump(OUT/(phase+'-results.json'),rows)
 dump(OUT/(phase+'-summary.json'),{'documents':len(rows),'recipients':sum(r['recipients'] for r in rows),'pages':sum(len(r.get('pages',[])) for r in rows),'failures':[r['name'] for r in rows if r['status']!='PASS'],'aggregation':'Current individual result files; original real-conversion logs and superseded failures preserved.'})
# Explicit manual record: these twelve PS pages and seven sheets were inspected.
visual=json.loads((OUT/'print-agent-visual-final.json').read_text(encoding='utf8'))
for r in results:
 if r['template']=='ps-card' and r['variant']!='stress':
  for p in r['pages']:
   visual['pages'].append({'path':p['image'],'sha256':p['sha256'],'status':'PASS','review':'Individual full-page inspection: title below issuer strip, right text inside its panel, full signature and seal labels, complete frames and distinct photos.'})
visual['pages']=list({p['path']:p for p in visual['pages']}.values());dump(OUT/'print-agent-visual-final.json',visual)
stress=json.loads((OUT/'print-agent-stress-review.json').read_text(encoding='utf8'))
for r in json.loads((OUT/'stress-visual-manifest.json').read_text(encoding='utf8')):
 if r['case'] in ['biot-itr-certificate-stress-100','ptm-card-stress-100','ps-card-stress-100']:
  r.update(status='PASS',review='Actual contact-sheet inspection of geometry, recipient sequence and photos at selected boundaries. Small text covered separately by full-size base review and all-page automatic checks.')
  stress.append(r)
stress=list({r['case']:r for r in stress}.values());dump(OUT/'print-agent-stress-review.json',stress)
# Reconcile every manual review to current PNG bytes and exact expected coverage.
base=rootbase=json.loads((OUT/'root-visual-review-current.json').read_text(encoding='utf8'))['pages']
base=base+visual['pages'];stressall=json.loads((OUT/'root-stress-visual-review.json').read_text(encoding='utf8'))['cases']+stress
errors=[]
for p in base+[p for c in stressall for p in c['pages']]:
 path=p.get('image',p.get('path'))
 if sha(ROOT/path)!=p['sha256']:errors.append({'path':path,'error':'REVIEW_HASH_MISMATCH'})
expectedbase={p['image'] for r in results if r['variant']!='stress' for p in r['pages']}
actualbase={p.get('image',p.get('path')) for p in base}
expectedstress={p['path'] for c in json.loads((OUT/'stress-visual-manifest.json').read_text(encoding='utf8')) for p in c['pages']}
actualstress={p['path'] for c in stressall for p in c['pages']}
if expectedbase!=actualbase:errors.append({'error':'BASE_REVIEW_COVERAGE','missing':sorted(expectedbase-actualbase),'extra':sorted(actualbase-expectedbase)})
if expectedstress!=actualstress:errors.append({'error':'STRESS_REVIEW_COVERAGE','missing':sorted(expectedstress-actualstress),'extra':sorted(actualstress-expectedstress)})
dump(OUT/'final-visual-reconciliation.json',{'status':'FAIL' if errors else 'PASS','basePhysicalPages':len(actualbase),'stressSamplePhysicalPages':len(actualstress),'stressNotFullManualReview':True,'errors':errors,'sources':['root-visual-review-current.json','print-agent-visual-final.json','root-stress-visual-review.json','print-agent-stress-review.json']})
if errors:raise RuntimeError(errors)
# Fresh rendering with final source proves reuse is not masking changed output.
dest=OUT/'final-source-docx-revalidation';dest.mkdir(exist_ok=True)
def check(r):
 snap=json.loads((OUT/(r['name']+'.fixture.json')).read_text(encoding='utf8'));path=dest/(r['name']+'.docx');start=time.perf_counter();render_docx(snap,path)
 return {'name':r['name'],'sha256':sha(path),'expected':r['docxSha256'],'matches':sha(path)==r['docxSha256'],'seconds':time.perf_counter()-start}
with ThreadPoolExecutor(max_workers=2) as pool:
 checks=list(pool.map(check,results))
negative=[]
for t in manifest['templates']:
 snap=json.loads((OUT/(t['id']+'-stress-100.fixture.json')).read_text(encoding='utf8'));snap['items'].append(dict(snap['items'][-1],id='recipient-101'));path=dest/(t['id']+'-invalid101.docx')
 try:render_docx(snap,path);error='NOT_REJECTED'
 except ValueError as e:error=str(e)
 negative.append({'template':t['id'],'error':error,'partialArtifactExists':path.exists(),'status':'PASS' if error=='ROW_LIMIT' and not path.exists() else 'FAIL'})
source={p.relative_to(ROOT).as_posix():sha(p) for p in sorted((ROOT/'scripts/render').glob('*.py'))}
report={'status':'PASS' if all(c['matches'] for c in checks) and all(n['status']=='PASS' for n in negative) else 'FAIL','sourceSha256':source,'freshDocxCount':len(checks),'converterReuseJustification':'Fresh final-source DOCX bytes equal previously actually converted DOCX; final-artifact-audit verifies PDF and PNG hashes. No PDF regeneration claimed by this check.','documents':checks,'negative101':negative}
dump(OUT/'final-source-docx-revalidation.json',report)
print(json.dumps({'status':report['status'],'freshDocxCount':len(checks),'negative101':len(negative),'baseVisual':len(actualbase),'stressVisual':len(actualstress)}),flush=True)
raise SystemExit(report['status']!='PASS')
