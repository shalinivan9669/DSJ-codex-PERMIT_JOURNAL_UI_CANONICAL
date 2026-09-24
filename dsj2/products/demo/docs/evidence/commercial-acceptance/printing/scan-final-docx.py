from pathlib import Path
from zipfile import ZipFile
import json,re,hashlib
ROOT=Path.cwd();OUT=ROOT/'docs/evidence/commercial-acceptance/printing'
results=json.loads((OUT/'all-results.json').read_text(encoding='utf8'));checks=[];errors=[]
pattern=re.compile(r'\{\{[A-Z_][A-Z0-9_]*\}\}|MERGEFIELD|gfxdata=|Стандарт|Солтанова|Флеглер|Баянов|Жакибеков|Есен Д\.')
for row in results:
 p=OUT/(row['name']+'.docx');issues=[];parts=0
 with ZipFile(p) as z:
  for n in z.namelist():
   if n.endswith('.xml') or n.endswith('.rels'):
    parts+=1;text=z.read(n).decode('utf8');matches=pattern.findall(text)
    if matches:issues.append({'part':n,'matches':sorted(set(matches))})
    if n.endswith('.rels') and 'TargetMode="External"' in text:issues.append({'part':n,'error':'EXTERNAL_RELATIONSHIP'})
 checks.append({'case':row['name'],'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'xmlParts':parts,'issues':issues})
 if issues:errors.append({'case':row['name'],'issues':issues})
report={'status':'FAIL' if errors else 'PASS','documents':len(checks),'checks':checks,'errors':errors,'scope':'All XML/rels parts scanned for unresolved fields, known legacy identity names, hidden gfxdata cache and external references. Image bytes/photo ownership and visual review are separately recorded.'}
(OUT/'final-docx-content-scan.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps({'status':report['status'],'documents':len(checks),'errors':errors},ensure_ascii=False));raise SystemExit(bool(errors))
