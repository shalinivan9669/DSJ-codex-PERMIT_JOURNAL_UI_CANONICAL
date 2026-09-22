"""Read-only final matrix, geometry, photo ownership and source/hash inventory."""
import hashlib
import json
from pathlib import Path
import sys
from zipfile import ZipFile
from lxml import etree as E
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/evidence/commercial-acceptance/printing'
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
manifest=json.loads((ROOT/'assets/templates/manifest.json').read_text(encoding='utf8'))
expected=[];checks=[];errors=[]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for template in manifest['templates']:
    tid=template['id']
    expected.extend((template,f'{tid}-{variant}') for variant in ['short','long','blank','batch','punctuation'])
    expected.extend((template,f'{tid}-stress-{count:03}') for count in ([1,2,3,10,13,50,100] if tid.endswith('protocol') else [1,2,100]))
for template,name in expected:
    result_path=OUT/(name+'.result.json')
    if not result_path.exists():errors.append({'name':name,'error':'NOT_RUN'});continue
    result=json.loads(result_path.read_text(encoding='utf8'));snapshot=json.loads((OUT/(name+'.fixture.json')).read_text(encoding='utf8'))
    docx=OUT/(name+'.docx');pdf=OUT/(name+'.pdf')
    if result.get('status')!='PASS':errors.append({'name':name,'error':'CASE_FAILED'});continue
    if sha(docx)!=result['docxSha256'] or sha(pdf)!=result['pdfSha256']:errors.append({'name':name,'error':'ARTIFACT_HASH_MISMATCH'})
    if snapshot['templateVersion']!=template['version']:errors.append({'name':name,'error':'OBSOLETE_TEMPLATE_VERSION'})
    sizes={(int(s[W+'w'])/20,int(s[W+'h'])/20) for s in template['sections']}
    for page in result['pages']:
        if not any(abs(page['widthPt']-w)<1 and abs(page['heightPt']-h)<1 for w,h in sizes):errors.append({'name':name,'page':page['page'],'error':'PAPER_GEOMETRY'})
        image=ROOT/page['image']
        if sha(image)!=page['sha256']:errors.append({'name':name,'page':page['page'],'error':'PAGE_IMAGE_HASH_MISMATCH'})
    photo_checks=[]
    with ZipFile(docx) as archive:
        tree=E.fromstring(archive.read('word/document.xml'));rels=E.fromstring(archive.read('word/_rels/document.xml.rels'))
        relationships={n.get('Id'):n.get('Target') for n in rels}
        photos=[n.get(R+'id') for n in tree.iter('{urn:schemas-microsoft-com:vml}imagedata')]
        wanted=[item for item in snapshot['items'] if item.get('photoAssetId')]
        if len(photos)!=len(wanted):errors.append({'name':name,'error':'PHOTO_COUNT','expected':len(wanted),'actual':len(photos)})
        for rid,item in zip(photos,wanted):
            embedded=hashlib.sha256(archive.read('word/'+relationships[rid])).hexdigest();source=OUT/'photo-store'/snapshot['photos'][item['photoAssetId']]
            if embedded!=sha(source):errors.append({'name':name,'recipient':item['id'],'error':'PHOTO_OWNERSHIP'})
            photo_checks.append({'recipient':item['id'],'relationship':rid,'sha256':embedded})
        if any(b'TargetMode="External"' in archive.read(n) for n in archive.namelist() if n.endswith('.rels')):errors.append({'name':name,'error':'EXTERNAL_RELATIONSHIP'})
    checks.append({'name':name,'recipients':result['recipients'],'pages':len(result['pages']),'docxSha256':sha(docx),'pdfSha256':sha(pdf),'photoOwnership':photo_checks})
report={'expectedDocuments':len(expected),'checkedDocuments':len(checks),'recipients':sum(c['recipients'] for c in checks),'pages':sum(c['pages'] for c in checks),'errors':errors,'files':checks}
(OUT/'final-artifact-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({k:v for k,v in report.items() if k!='files'},ensure_ascii=False))
raise SystemExit(bool(errors))
