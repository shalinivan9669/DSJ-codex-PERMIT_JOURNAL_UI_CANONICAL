"""Fresh neutral-form acceptance through the application's renderer/converter."""
from pathlib import Path
import os,sys,json,hashlib,re
from copy import deepcopy
from zipfile import ZipFile
from lxml import etree as E
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(os.environ.get('DEMO_NEUTRAL_OUT',str(ROOT/'.runtime/neutral-forms-20261005')))
OUT.mkdir(parents=True,exist_ok=True)
os.environ['DEMO_RENDER_EVIDENCE_ROOT']=str(OUT)
os.environ['DEMO_ARTIFACT_ROOT']=str(OUT/'store')
(OUT/'store').mkdir(exist_ok=True)
sys.path[:0]=[str(ROOT/'scripts/render'),str(ROOT/'tests/render')]
from renderer import render_docx,convert_pdf
from neutral_identity import OLD_IMAGE_HASHES
from test_render import fixture,MANIFEST
from test_group_protocol import group_fixture
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def generate():
    cases=[]
    fixtures=json.loads((ROOT/'docs/evidence/neutral-forms-20261005/template-fixtures.json').read_text(encoding='utf8'))
    for t in MANIFEST['templates']:
        for variant in ['normal','long']+(['photo'] if t['photo'] else []):
            snap=deepcopy(fixtures[t['id']])
            snap['templateVersion']=t['version']
            if variant=='photo':
                Image.new('RGB',(300,400),'#6c9fbd').save(OUT/'store/photo.png')
                snap['items'][0]['photoAssetId']='synthetic-photo'
                snap['photos']['synthetic-photo']='photo.png'
            if variant=='long':
                item=snap['items'][0]
                item.update(fullNameRu='Тестов-Примеров Александр Константинович',fullNameKz='Әділбек Өмірсерік Қанатұлы',
                            positionRu='Ведущий инженер производственного участка',positionKz='Өндірістік учаскенің жетекші инженері',
                            workplaceRu='ТОО «Тестовое промышленное предприятие»',workplaceKz='«Сынақ өнеркәсіптік кәсіпорны» ЖШС')
                item.update(number='ДОК-2026-ОТ-000000012345',protocolNumber='ПР-2026-ОТ-000000012345',registrationNumber='РЕГ-2026-0000012345')
                item['assignment']['trainingSubjectRu']='Безопасность и охрана труда на производстве'
                item['assignment']['trainingSubjectKz']='Өндірістегі еңбек қауіпсіздігі және еңбекті қорғау'
                item['assignment']['trainingSubject']=item['assignment']['trainingSubjectRu']+' / '+item['assignment']['trainingSubjectKz']
            cases.append((t['id']+'-'+variant,snap,t))
    for t in MANIFEST['groupTemplates']:
        cases.append((t['id']+'-group25',group_fixture(t['id'],25),t))
    inventory=[]
    for name,snap,t in cases:
        out=OUT/(name+'.docx')
        meta=render_docx(snap,out)
        (OUT/(name+'.snapshot.json')).write_text(json.dumps(snap,ensure_ascii=False,indent=2),encoding='utf8')
        with ZipFile(out) as z:
            text='\n'.join(''.join(n.text or '' for n in E.fromstring(z.read(part)).iter(W+'t')) for part in z.namelist() if part.startswith('word/') and part.endswith('.xml'))
            media={part:hashlib.sha256(z.read(part)).hexdigest() for part in z.namelist() if part.startswith('word/media/')}
            forbidden=[part for part,digest in media.items() if digest in OLD_IMAGE_HASHES]
            old=re.findall(r'Аттестационный центр|Солтанова|Флеглер|Баянов|Саратов|Технологии гостеприимства|160440010815',text,re.I)
            unfilled=re.findall(r'\{\{[^}]+\}\}',text)
        row={'case':name,'templateId':t['id'],'kind':'group' if snap.get('groupEvent') else 'individual','version':t['version'],'docx':str(out),'docxSha256':sha(out),'render':meta,'oldImages':forbidden,'oldText':old,'unfilled':unfilled,'media':media,'recipients':len(snap['items'])}
        inventory.append(row)
        print(name,'package', 'PASS' if not forbidden+old+unfilled else 'FAIL',flush=True)
    (OUT/'inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2),encoding='utf8')
def convert():
    from concurrent.futures import ThreadPoolExecutor
    inventory=json.loads((OUT/'inventory.json').read_text(encoding='utf8'))
    def one(record):
        target=OUT/(record['case']+'.pdf')
        convert_pdf(record['docx'],target)
        record['applicationPdf']=str(target);record['applicationPdfSha256']=sha(target)
        print(record['case'],'application PDF OK',flush=True)
        return record
    with ThreadPoolExecutor(max_workers=2) as pool:
        inventory=list(pool.map(one,inventory))
        (OUT/'inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2),encoding='utf8')
def analyze():
    import pymupdf
    inventory=json.loads((OUT/'inventory.json').read_text(encoding='utf8'))
    pages=[]
    for row in inventory:
        row['pdfChecks']={}
        for kind,suffix in [('application','.pdf'),('word','.word.pdf')]:
            file=OUT/(row['case']+suffix)
            if not file.exists():continue
            doc=pymupdf.open(file);outside=[];extracted=[]
            for n,p in enumerate(doc,1):
                words=p.get_text('words');extracted.append(p.get_text())
                outside.extend({'page':n,'word':list(w[:5])} for w in words if w[0]<-.1 or w[1]<-.1 or w[2]>p.rect.width+.1 or w[3]>p.rect.height+.1)
                dest=OUT/'pages'/kind/(row['case']+f'-{n}.png');dest.parent.mkdir(parents=True,exist_ok=True)
                p.get_pixmap(matrix=pymupdf.Matrix(1.5,1.5)).save(dest)
                pages.append({'kind':kind,'case':row['case'],'page':n,'path':str(dest)})
            row['pdfChecks'][kind]={'pages':len(doc),'outsidePage':outside,'sha256':sha(file)}
            (OUT/(row['case']+'.'+kind+'.txt')).write_text('\n'.join(extracted),encoding='utf8')
    for kind in ['application','word']:
        entries=[p for p in pages if p['kind']==kind]
        for offset in range(0,len(entries),6):
            board=Image.new('RGB',(1800,1800),'#d0d0d0');draw=ImageDraw.Draw(board)
            for i,e in enumerate(entries[offset:offset+6]):
                im=Image.open(e['path']).convert('RGB');im.thumbnail((590,855));x=i%3*600;y=i//3*900
                board.paste(im,(x,y+32));draw.text((x+4,y+8),e['case']+' / '+str(e['page']),fill='black')
            board.save(OUT/(kind+f'-contact-{offset//6+1:02}.png'))
    (OUT/'inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2),encoding='utf8')
    (OUT/'pages.json').write_text(json.dumps(pages,indent=2),encoding='utf8')
    print('Pages',len(pages))
if __name__=='__main__': {'generate':generate,'convert':convert,'analyze':analyze}[sys.argv[1]]()
