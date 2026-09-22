"""Fresh, synthetic commercial print matrix. No reuse of former acceptance PASS/PDFs."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import time
from zipfile import ZipFile
from lxml import etree as E
from PIL import Image, ImageDraw
import pdfplumber
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'docs/evidence/commercial-acceptance/printing'
OUT.mkdir(parents=True, exist_ok=True)
os.environ['DEMO_ARTIFACT_ROOT'] = str(OUT/'photo-store')
sys.path[:0] = [str(ROOT/'tests/render'),str(ROOT/'scripts/render')]
from test_render import fixture, MANIFEST, render_docx, convert_pdf, STORE
from renderer import fields_for, RENDERER_VERSION
from print_contracts import assert_docx_columns, assert_pdf_columns, W, text


def dump(path, value): path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def normalize(value): return re.sub(r'\s+','',value.replace('\ufffe','-').replace('\u00ad',''))


def snapshot(template, variant, count):
    snap = fixture(template['id']); original = snap['items'][0]; snap['items'] = []
    for i in range(1,count+1):
        item = deepcopy(original)
        item.update(id=f'recipient-{i:03}', fullNameRu=f'Тестов-{i:03} Иван Петрович',fullNameKz=f'Әділбек-{i:03} Өмірсерік Қанатұлы',number=f'ТЕСТ-{i:05}',credentialNumber=f'КР-{i:05}',protocolNumber=f'ПР-{i:05}',registrationNumber=f'{i:05}')
        if variant == 'long':
            item.update(fullNameRu=f'Тестов-Примеров-{i:03} Александр Константинович',fullNameKz=f'Әғқңөұүһі-{i:03} Өмірсерік Қанатұлы',positionRu='Инженер по промышленной безопасности',positionKz='Өнеркәсіптік қауіпсіздік жөніндегі инженер',workplaceRu='ТОО «Научно-производственная компания Образец»',workplaceKz='«Үлгі ғылыми-өндірістік компаниясы» ЖШС')
        if variant == 'punctuation':
            item.update(fullNameRu=f"Тестов-{i:03} О'Нил\nИван",fullNameKz=f'Ә Ғ Қ Ң Ө Ұ Ү Һ І-{i:03}',positionRu='Инженер\nсмены',positionKz='Ауысым-инженері')
        if variant == 'blank':
            for key in ['positionRu','positionKz','workplaceRu','workplaceKz','fullNameKz']: item[key] = ''
            for key in ['validUntil','hours','trainingStart','trainingEnd']: item['assignment'][key] = ''
        if template['photo'] and variant != 'blank':
            image = Image.new('RGB',(480,640),((i*37)%200,(i*53)%200,(i*97)%200)); draw=ImageDraw.Draw(image)
            draw.ellipse((135,80,345,305),fill='#e2c5a7');draw.polygon([(70,600),(120,350),(360,350),(410,600)],fill='#243e54');draw.text((100,615),f'SYNTHETIC RECIPIENT {i:03}',fill='white')
            image.save(STORE/f'photo-{i:03}.png'); item['photoAssetId']=f'photo-{i:03}'; snap['photos'][f'photo-{i:03}']=f'photo-{i:03}.png'
        snap['items'].append(item)
    return snap


def audit_template_maps():
    maps = []
    for template in MANIFEST['templates']:
        result = {'id':template['id'],'file':template['file'],'sha256':template['sha256'],'columnNumbers':{'table':0,'row':1,'values':[1,2,3,4,5,6]} if template['id']=='biot-protocol' else None,'protocolSemantics':template['protocolSemantics'],'tables':[],'fieldLocations':[]}
        with ZipFile(ROOT/'assets/templates'/template['file']) as archive:
            tree = E.fromstring(archive.read('word/document.xml'))
            result['sections'] = [{E.QName(k).localname:v for k,v in node.attrib.items()} for node in tree.iter(W+'pgSz')]
            result['margins'] = [{E.QName(k).localname:v for k,v in node.attrib.items()} for node in tree.iter(W+'pgMar')]
            for ti, table in enumerate(tree.iter(W+'tbl')):
                result['tables'].append({'table':ti,'gridWidthsTwips':[int(n.get(W+'w')) for n in table.findall(W+'tblGrid/'+W+'gridCol')],'rows':[{'row':ri,'repeatHeader':row.find(W+'trPr/'+W+'tblHeader') is not None,'cantSplit':row.find(W+'trPr/'+W+'cantSplit') is not None,'cells':[{'cell':ci,'text':text(cell),'gridSpan':int(cell.find(W+'tcPr/'+W+'gridSpan').get(W+'val')) if cell.find(W+'tcPr/'+W+'gridSpan') is not None else 1,'vMerge':cell.find(W+'tcPr/'+W+'vMerge').get(W+'val','continue') if cell.find(W+'tcPr/'+W+'vMerge') is not None else None} for ci,cell in enumerate(row.findall(W+'tc'))]} for ri,row in enumerate(table.findall(W+'tr'))]})
            for filename in archive.namelist():
                if not filename.endswith('.xml'): continue
                part=E.fromstring(archive.read(filename))
                for paragraph in part.iter(W+'p'):
                    values=paragraph.xpath('./w:r/w:t | ./w:hyperlink/w:r/w:t',namespaces={'w':W[1:-1]})
                    label=''.join(v.text or '' for v in values)
                    for field in re.findall(r'\{\{([A-Z0-9_]+)\}\}',label): result['fieldLocations'].append({'field':field,'part':filename,'xpath':part.getroottree().getpath(paragraph),'block':label})
        maps.append(result)
    dump(OUT/'template-structure-field-map.json',maps)


def verify_pdf(name, snap, pdf, baseline_pages=None):
    tid=snap['templateId']; count=len(snap['items']); problems=[]; pages=[]; coordinates=[]
    doc=pdfium.PdfDocument(str(pdf))
    if baseline_pages is not None and len(doc)!=baseline_pages*count: problems.append({'code':'PAGE_COUNT','expected':baseline_pages*count,'actual':len(doc)})
    text_pages=[]
    for index,page in enumerate(doc):
        content=page.get_textpage().get_text_range();text_pages.append(content)
        target=OUT/'pages'/f'{name}-page-{index+1:03}.png';target.parent.mkdir(exist_ok=True);page.render(scale=1.34).to_pil().save(target)
        if len(content.strip())<50: problems.append({'code':'EMPTY_PAGE','page':index+1})
        pages.append({'page':index+1,'widthPt':page.get_width(),'heightPt':page.get_height(),'image':target.relative_to(ROOT).as_posix(),'sha256':sha(target)})
    per=len(doc)//count if len(doc)%count==0 else None
    if per:
        for i,item in enumerate(snap['items']):
            own=normalize(''.join(text_pages[i*per:(i+1)*per]))
            for field in ['fullNameRu','fullNameKz']:
                value=item.get(field,'')
                if value and normalize(value) not in own: problems.append({'code':'RECIPIENT_FIELD_MISSING','recipient':i+1,'field':field})
            for other in snap['items']:
                if other['id'] != item['id'] and normalize(other['fullNameRu']) in own: problems.append({'code':'RECIPIENT_DATA_MIXED','recipient':i+1,'foreign':other['id']})
            number=item['protocolNumber'] if tid.endswith('protocol') else item['number']
            if normalize(number) not in own: problems.append({'code':'DOCUMENT_NUMBER_MISSING','recipient':i+1,'number':number})
    if tid=='biot-protocol': coordinates=assert_pdf_columns(pdf,count,baseline_pages*count if baseline_pages else None)
    # Physical-page coordinates of every unique supplied field value in the base samples.
    if count<=2:
        with pdfplumber.open(pdf) as document:
            field_positions=[]
            for index,page in enumerate(document.pages):
                stream=[];chars=[]
                for char in page.chars:
                    for letter in normalize(char['text']): stream.append(letter);chars.append(char)
                flat=''.join(stream)
                for key,value in fields_for(snap,snap['items'][index//per if per else 0]).items():
                    needle=normalize(str(value))
                    if not needle: continue
                    start=0
                    while (position:=flat.find(needle,start))>=0:
                        found=chars[position:position+len(needle)]
                        field_positions.append({'field':key,'page':index+1,'value':value,'box':[min(c['x0'] for c in found),min(c['top'] for c in found),max(c['x1'] for c in found),max(c['bottom'] for c in found)]});start=position+len(needle)
            dump(OUT/(name+'.field-coordinates.json'),field_positions)
    return pages,problems,coordinates


def run_one(template, variant, count, baseline_pages=None):
    name=f"{template['id']}-{variant}"+(f'-{count:03}' if variant=='stress' else '')
    snap=snapshot(template,variant,count);dump(OUT/(name+'.fixture.json'),snap)
    docx=OUT/(name+'.docx');pdf=OUT/(name+'.pdf');started=time.perf_counter()
    try:
        render_docx(snap,docx);docx_seconds=time.perf_counter()-started
        assert_docx_columns(docx,template['id'],count)
        convert_pdf(docx,pdf);render_seconds=time.perf_counter()-started
        pages,problems,coordinates=verify_pdf(name,snap,pdf,baseline_pages)
        result={'name':name,'status':'FAIL' if problems else 'PASS','template':template['id'],'variant':variant,'recipients':count,'docxSha256':sha(docx),'pdfSha256':sha(pdf),'docxSeconds':docx_seconds,'renderSeconds':render_seconds,'pages':pages,'columnChecks':coordinates,'problems':problems}
    except Exception as error: result={'name':name,'status':'FAIL','template':template['id'],'variant':variant,'recipients':count,'error':str(error)}
    dump(OUT/(name+'.result.json'),result);print(json.dumps({k:result[k] for k in ['name','status','error','renderSeconds'] if k in result}),flush=True)
    return result


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--phase',choices=['base','stress','all'],default='all');parser.add_argument('--concurrency',type=int,default=2);args=parser.parse_args()
    audit_template_maps();dump(OUT/'environment.json',{'python':sys.version,'platform':platform.platform(),'converter':subprocess.check_output([os.environ['DEMO_SOFFICE'],'--version'],text=True).strip(),'rendererVersion':RENDERER_VERSION,'sourceSha256':{p.relative_to(ROOT).as_posix():sha(p) for p in [*sorted((ROOT/'scripts/render').glob('*.py')),*sorted((ROOT/'scripts/verification').glob('*print*.py'))]},'fonts':json.loads((ROOT/'assets/fonts/manifest.json').read_text()),'templates':MANIFEST})
    results=[]
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        if args.phase in ['base','all']:
            jobs=[(template,variant,2 if variant=='batch' else 1) for template in MANIFEST['templates'] for variant in ['short','long','blank','batch','punctuation']]
            results.extend(pool.map(lambda args:run_one(*args),jobs))
        if args.phase in ['stress','all']:
            jobs=[]
            for template in MANIFEST['templates']:
                baseline=json.loads((OUT/(template['id']+'-short.result.json')).read_text(encoding='utf8'));per=len(baseline.get('pages',[]))
                if not per: continue
                for count in ([1,2,3,10,13,50,100] if template['id'].endswith('protocol') else [1,2,100]): jobs.append((template,'stress',count,per))
            results.extend(pool.map(lambda args:run_one(*args),jobs))
    dump(OUT/(args.phase+'-results.json'),results)
    summary={'documents':len(results),'recipients':sum(r['recipients'] for r in results),'pages':sum(len(r.get('pages',[])) for r in results),'failures':[r['name'] for r in results if r['status']!='PASS']};dump(OUT/(args.phase+'-summary.json'),summary);print(json.dumps(summary),flush=True)
    return bool(summary['failures'])


if __name__=='__main__': raise SystemExit(main())
