from pathlib import Path
from zipfile import ZipFile
import json,re,hashlib
from lxml import etree as E
import pdfplumber
import pypdfium2 as pdfium
ROOT=Path.cwd();OUT=ROOT/'docs/evidence/commercial-acceptance/printing/date-roundtrip'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';NS={'w':W};sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();norm=lambda s:re.sub(r'\s+','',s)
manifest=json.loads((ROOT/'assets/templates/manifest.json').read_text(encoding='utf8'));template=next(t for t in manifest['templates'] if t['id']=='ps-witness')
fieldmap=json.loads((ROOT/'docs/evidence/commercial-acceptance/printing/template-structure-field-map.json').read_text(encoding='utf8'));locs=next(t for t in fieldmap if t['id']=='ps-witness')['fieldLocations']
results=[]
for case in sorted(OUT.glob('date-*')):
 if not (case/'result.json').exists():continue
 info=json.loads((case/'result.json').read_text(encoding='utf8'));spec=info['expected'];proto={'leap':{'DAY':'28','MONTH_RU':'февраля','MONTH_KZ':'ақпан','YEAR':'2028'},'year':{'DAY':'31','MONTH_RU':'декабря','MONTH_KZ':'желтоқсан','YEAR':'2026'}}[spec['kind']];issued={'leap':{'DAY':'29','MONTH_RU':'февраля','MONTH_KZ':'ақпан','YEAR_SHORT':'28','YEAR':'2028'},'year':{'DAY':'01','MONTH_RU':'января','MONTH_KZ':'қаңтар','YEAR_SHORT':'27','YEAR':'2027'}}[spec['kind']]
 before=json.loads((case/'before-issue.json').read_text(encoding='utf8'));response=json.loads((case/'issued-response.json').read_text(encoding='utf8'))
 for source in [info['ui'],before['draft']['items'][0]['assignments'][0],response['draft']['items'][0]['assignments'][0],response['issuances'][0]['snapshot']['draft']['items'][0]['assignments'][0]]:
  assert source['documentDate']==spec['documentDate'] and source['protocolDate']==spec['protocolDate']
 assert info['ui']['browser']['zone']==info['timezoneId']
 assert info['templates'][0]['checksum']==template['sha256']
 docx=case/next(a['file'] for a in info['artifacts'] if a['format']=='DOCX');pdf=case/next(a['file'] for a in info['artifacts'] if a['format']=='PDF')
 with ZipFile(docx) as z:tree=E.fromstring(z.read('word/document.xml'))
 docchecks=[]
 for entry in locs:
  field=entry['field'];prefix,_,key=field.partition('_')
  if prefix=='ISSUE':expected=issued[key]
  elif prefix=='PROTOCOL' and key in proto:expected=proto[key]
  else:continue
  found=tree.xpath(entry['xpath'],namespaces=NS);assert len(found)==1,(field,entry['xpath'])
  text=''.join(found[0].itertext());assert expected in text,(field,expected,text)
  if entry['block']=='{{'+field+'}}':assert text==expected,(field,expected,text)
  docchecks.append({'field':field,'xpath':entry['xpath'],'expected':expected,'actual':text})
 regions=[('PROTOCOL_KZ',(125,330,292,415),proto['YEAR']+'жылғы«'+proto['DAY']+'»'+proto['MONTH_KZ']),('PROTOCOL_RU',(300,330,580,410),'«'+proto['DAY']+'»'+proto['MONTH_RU']+proto['YEAR']),('ISSUE_KZ',(150,450,292,550),'«'+issued['DAY']+'»'+issued['MONTH_KZ']+issued['YEAR']),('ISSUE_RU',(415,425,550,510),'«'+issued['DAY']+'»'+issued['MONTH_RU']+issued['YEAR'])]
 pdfchecks=[]
 with pdfplumber.open(pdf) as document:
  assert len(document.pages)==2
  page=document.pages[1]
  for label,box,expected in regions:
   chars=[c for c in page.chars if c['x0']>=box[0] and c['x1']<=box[2] and c['top']>=box[1] and c['bottom']<=box[3]]
   flattened=[];sourcechars=[]
   for c in chars:
    for ch in norm(c['text']):flattened.append(ch);sourcechars.append(c)
   text=''.join(flattened);start=text.find(expected);assert start>=0,(label,expected,text)
   match=sourcechars[start:start+len(expected)];coords=[min(c['x0'] for c in match),min(c['top'] for c in match),max(c['x1'] for c in match),max(c['bottom'] for c in match)]
   negative='«'+proto['DAY']+'»'+proto['MONTH_RU' if label.endswith('RU') else 'MONTH_KZ']+proto['YEAR']
   if label.startswith('ISSUE'):assert negative not in text,'SWAPPED_DATE_SHOULD_FAIL'
   pdfchecks.append({'field':label,'page':2,'searchRegion':box,'expectedNormalized':expected,'matchedBox':coords,'regionText':text,'swappedProtocolDateRejected':label.startswith('ISSUE')})
 pdfdoc=pdfium.PdfDocument(str(pdf));pages=[]
 for i,p in enumerate(pdfdoc):
  target=case/f'page-{i+1}.png';p.render(scale=1.34).to_pil().save(target);pages.append({'file':target.name,'sha256':sha(target)})
 result={**info,'status':'PASS','docxSha256':sha(docx),'pdfSha256':sha(pdf),'beforeDraftSha256':sha(case/'before-issue.json'),'issuedSnapshotSha256':sha(case/'issued-response.json'),'docxDateChecks':docchecks,'pdfDateChecks':pdfchecks,'pages':pages,'scope':'Actual UI input/reload -> saved draft -> immutable issuance snapshot -> actual server DOCX/PDF; documentDate is the printed date, issuance event timestamp is intentionally independent.'}
 (case/'date-proof.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8');results.append(result)
summary={'status':'PASS' if len(results)==4 else 'INCOMPLETE','cases':len(results),'timezones':sorted(set(r['timezoneId'] for r in results)),'documents':len(results),'pages':2*len(results),'docxFieldAssertions':sum(len(r['docxDateChecks']) for r in results),'pdfRegionAssertions':sum(len(r['pdfDateChecks']) for r in results),'results':results}
(OUT/'date-roundtrip-proof.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps({k:v for k,v in summary.items() if k!='results'},ensure_ascii=False));raise SystemExit(summary['status']!='PASS')
