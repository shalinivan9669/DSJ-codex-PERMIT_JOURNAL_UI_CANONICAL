"""Reconcile the BIOT-only reprint with immutable evidence for the other 88 cases."""
import hashlib,json,os,sys,time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ROOT=Path.cwd();OUT=ROOT/'docs/evidence/commercial-acceptance/printing'
OLD=OUT/'exploratory/pre-biot-v15-final'
sys.path.insert(0,str(ROOT/'scripts/render'))
os.environ['DEMO_ARTIFACT_ROOT']=str(OUT/'photo-store')
from renderer import render_docx
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda p:json.loads(p.read_text(encoding='utf8'))
def dump(p,value):p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
manifest=read(ROOT/'assets/templates/manifest.json')
results=[]
for template in manifest['templates']:
 tid=template['id']
 names=[tid+'-'+v for v in ['short','long','blank','batch','punctuation']]
 names += [tid+f'-stress-{n:03}' for n in ([1,2,3,10,13,50,100] if tid.endswith('protocol') else [1,2,100])]
 results += [read(OUT/(name+'.result.json')) for name in names]
assert len(results)==96 and all(r['status']=='PASS' for r in results)
for phase in ['base','stress','all']:
 rows=[r for r in results if phase=='all' or ((r['variant']=='stress')==(phase=='stress'))]
 dump(OUT/(phase+'-results.json'),rows)
 dump(OUT/(phase+'-summary.json'),{'documents':len(rows),'recipients':sum(r['recipients'] for r in rows),'pages':sum(len(r['pages']) for r in rows),'failures':[],'aggregation':'Current individual results. BIOT v15 eight cases freshly converted; other 88 preserved with exact SHA and prior fresh-DOCX evidence. Original failures and historical results retained.'})
prior=read(OLD/'final-source-docx-revalidation.json')
prior_checks={r['name']:r for r in prior['documents']}
prior_results={r['name']:r for r in read(OLD/'all-results.json')}
source={p.relative_to(ROOT).as_posix():sha(p) for p in sorted((ROOT/'scripts/render').glob('*.py'))}
runtime_modules=['entry.py','renderer.py','ooxml.py','package_xml.py','sanitize_templates.py','xml_input.py']
runtime=[{'path':'scripts/render/'+name,'sha256':source['scripts/render/'+name],'previous':prior['sourceSha256']['scripts/render/'+name],'matches':source['scripts/render/'+name]==prior['sourceSha256']['scripts/render/'+name]} for name in runtime_modules]
assert all(r['matches'] for r in runtime),'RUNTIME_CHANGED_REQUIRES_FRESH_RENDER'
old_env=read(OLD/'environment.json');env=read(OUT/'environment.json')
assert env['converter']==old_env['converter'] and env['rendererVersion']==old_env['rendererVersion'] and env['fonts']==old_env['fonts']
dest=OUT/'final-source-docx-revalidation-biot-v15';dest.mkdir(exist_ok=True)
def check(r):
 actual=sha(OUT/(r['name']+'.docx'));pdf_sha=sha(OUT/(r['name']+'.pdf'))
 if r['template']=='biot-worker-card':
  path=dest/(r['name']+'.docx');start=time.perf_counter();render_docx(read(OUT/(r['name']+'.fixture.json')),path)
  return {'name':r['name'],'mode':'FRESH_BIOT_V15_DOCX','sha256':sha(path),'expected':r['docxSha256'],'pdfSha256':pdf_sha,'matches':sha(path)==actual==r['docxSha256'] and pdf_sha==r['pdfSha256'],'seconds':time.perf_counter()-start}
 old=prior_results[r['name']];previous=prior_checks[r['name']]
 return {'name':r['name'],'mode':'EXACT_REUSE_OF_PREVIOUS_FRESH_DOCX_PROOF','sha256':actual,'expected':r['docxSha256'],'pdfSha256':pdf_sha,'previousFreshSha256':previous['sha256'],'matches':actual==r['docxSha256']==old['docxSha256']==previous['sha256'] and pdf_sha==r['pdfSha256']==old['pdfSha256'] and previous['matches']}
with ThreadPoolExecutor(max_workers=2) as pool:checks=list(pool.map(check,results))
negative=[]
for t in manifest['templates']:
 snap=read(OUT/(t['id']+'-stress-100.fixture.json'));snap['items'].append(dict(snap['items'][-1],id='recipient-101'));path=dest/(t['id']+'-invalid101.docx')
 try:render_docx(snap,path);error='NOT_REJECTED'
 except ValueError as e:error=str(e)
 negative.append({'template':t['id'],'templateVersion':t['version'],'error':error,'partialArtifactExists':path.exists(),'status':'PASS' if error=='ROW_LIMIT' and not path.exists() else 'FAIL'})
report={'status':'PASS' if all(c['matches'] for c in checks) and all(n['status']=='PASS' for n in negative) else 'FAIL','sourceSha256':source,'freshDocxCount':8,'exactReuseCount':88,'previousFreshDocxEvidence':{'path':str((OLD/'final-source-docx-revalidation.json').relative_to(ROOT)),'sha256':sha(OLD/'final-source-docx-revalidation.json')},'unchangedRuntimeModules':runtime,'converterReuseJustification':'Eight BIOT v15 cases were freshly converted and their DOCX regenerated with final Linux source. Other 88 cases keep exact DOCX/PDF hashes plus previous fresh-DOCX proof; all output-affecting runtime modules, converter and fonts are unchanged. The modified print_contracts.py adds validation; upgrade_biot_worker_v15.py only generates the new BIOT asset. No extra PDF regeneration is claimed.','documents':checks,'negative101':negative}
dump(OUT/'final-source-docx-revalidation.json',report)
print(json.dumps({'status':report['status'],'freshDocxCount':8,'exactReuseCount':88,'negative101':len(negative)}),flush=True)
raise SystemExit(report['status']!='PASS')
