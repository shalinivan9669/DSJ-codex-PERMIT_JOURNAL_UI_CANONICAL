"""Verify current evidence references and seal hashes for the parent acceptance report."""
from pathlib import Path
import hashlib,json
ROOT=Path.cwd();OUT=ROOT/'docs/evidence/commercial-acceptance/printing'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda p:json.loads(p.read_text(encoding='utf8'))
errors=[]
for name in ['final-source-docx-revalidation.json','final-visual-reconciliation.json','final-docx-content-scan.json','control-print-set-verification.json']:
 if read(OUT/name)['status']!='PASS':errors.append({'file':name,'error':'NOT_PASS'})
audit=read(OUT/'final-artifact-audit.json');summary=read(OUT/'all-summary.json')
assert audit['checkedDocuments']==summary['documents']==96 and audit['pages']==summary['pages']==1830
errors+=audit['errors']+summary['failures']
word=read(OUT/'../word/final-active.json');manifest=read(OUT/'word-final-biot-v15/manifest.json')
assert word['status']=='PASS' and word['passedDocuments']==20 and word['pages']==28
assert word['sourceManifestSha256']==sha(OUT/'word-final-biot-v15/manifest.json')
for row in manifest['files']:
 case=row['template']+'-'+row['variant']
 assert sha(OUT/(case+'.docx'))==row['docxSha256'] and sha(OUT/(case+'.pdf'))==row['pdfSha256']
zip_report=read(OUT/'control-print-set-verification.json')
assert zip_report['sha256']==sha(OUT/'control-print-set.zip')
date=read(OUT/'date-roundtrip/date-roundtrip-proof.json')
assert date['status']=='PASS'
files=['final-source-docx-revalidation.json','final-artifact-audit.json','final-visual-reconciliation.json','final-docx-content-scan.json','control-print-set-verification.json','all-summary.json','environment.json','final-render-tests-biot-v15.log','matrix-updates.json','PRINTING_REPORT_RU.md','biot-panel-regression-result.json','template-structure-field-map.json','word-final-biot-v15/manifest.json']
report={'status':'FAIL' if errors else 'PASS','errors':errors,'rendererVersion':'demo-ooxml-5/libreoffice-26.2.6.3','files':{n:sha(OUT/n) for n in files},'wordReport':{'path':'../word/final-active.json','sha256':sha(OUT/'../word/final-active.json')},'controlZip':{'path':'control-print-set.zip','sha256':sha(OUT/'control-print-set.zip')},'dateRoundtrip':{'proofSha256':sha(OUT/'date-roundtrip/date-roundtrip-proof.json'),'visualSha256':sha(OUT/'date-roundtrip/visual-review.json'),'cases':4,'pages':8,'status':'PASS'},'limitations':['Engineering PASS for exact historical forms does not establish legal validity. Known BIOT N6-versus-current-N7 mismatch remains FAIL.','No physical printer proof; physical acceptance remains BLOCKED.','Eight BIOT conversions produced all PASS records but the original external shell reported exit1; cause unresolved. Independent later artifact audit, fresh DOCX and regression processes exited0.']}
(OUT/'printing-handoff-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'status':report['status'],'documents':96,'pages':1830,'wordDocuments':20,'controlZipSha256':report['controlZip']['sha256'],'manifestSha256':sha(OUT/'printing-handoff-manifest.json')}));raise SystemExit(bool(errors))
