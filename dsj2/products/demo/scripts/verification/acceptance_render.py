"""All-form, real LibreOffice specimens and page inventory (mandatory visual QA input)."""
import json
import hashlib
import sys
import os
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import pypdfium2 as pdfium
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tests/render'))
from test_render import fixture,MANIFEST,STORE,render_docx,convert_pdf
from print_contracts import assert_docx_columns,assert_pdf_columns

OUT=ROOT/'docs/evidence/render/acceptance';OUT.mkdir(parents=True,exist_ok=True)
portrait=Image.new('RGB',(480,640),'#366f93');draw=ImageDraw.Draw(portrait)
draw.ellipse((135,80,345,305),fill='#e2c5a7');draw.polygon([(70,600),(120,350),(360,350),(410,600)],fill='#243e54');draw.text((155,610),'SYNTHETIC',fill='white')
portrait.save(STORE/'acceptance-photo.png')
portrait2=portrait.copy();ImageDraw.Draw(portrait2).rectangle((0,0,85,640),fill='#a86235');portrait2.save(STORE/'acceptance-photo-2.png')

def specimen(template,variant):
    tid=template['id'];snap=fixture(tid);item=snap['items'][0]
    if template['photo'] and variant!='blank':
        item['photoAssetId']='qa-photo';snap['photos']['qa-photo']='acceptance-photo.png'
    if variant=='long':
        item.update(fullNameRu='Тестов-Примеров Александр Константинович',fullNameKz='Әғқңөұүһі Өмірсерік Қанатұлы',positionRu='Инженер по промышленной безопасности',positionKz='Өнеркәсіптік қауіпсіздік жөніндегі инженер',workplaceRu='ТОО «Научно-производственная компания Образец»',workplaceKz='«Үлгі ғылыми-өндірістік компаниясы» ЖШС')
    if variant=='blank':
        for key in ['positionRu','positionKz','workplaceRu','workplaceKz','fullNameKz']:item[key]=''
        for key in ['validUntil','hours','trainingStart','trainingEnd']:item['assignment'][key]=''
    if variant=='batch':
        second=deepcopy(item);second['id']='recipient-02';second['number']='ТЕСТ-00002';second['protocolNumber']='ПР-00002';second['registrationNumber']='00124';second['fullNameRu']='Примеров Пётр Александрович';second['fullNameKz']='Екінші Әділбек Қанатұлы'
        if template['photo']:second['photoAssetId']='qa-photo-2';snap['photos']['qa-photo-2']='acceptance-photo-2.png'
        snap['items'].append(second)
    name=tid+'-'+variant;docx=OUT/(name+'.docx');pdf=OUT/(name+'.pdf')
    render_docx(snap,docx)
    assert_docx_columns(docx,tid,len(snap['items']))
    marker=OUT/(name+'.conversion.json');docx_hash=hashlib.sha256(docx.read_bytes()).hexdigest()
    cached=json.loads(marker.read_text()) if marker.exists() else {}
    valid=pdf.exists() and cached.get('docxSha256')==docx_hash and cached.get('pdfSha256')==hashlib.sha256(pdf.read_bytes()).hexdigest() and cached.get('converter')=='26.2.6.3'
    if not valid:
        convert_pdf(docx,pdf)
        marker.write_text(json.dumps({'docxSha256':docx_hash,'pdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'converter':'26.2.6.3'}),encoding='utf8')
    if tid=='biot-protocol':
        checks=assert_pdf_columns(pdf,len(snap['items']))
        (OUT/(name+'.column-cells.json')).write_text(json.dumps(checks,indent=2),encoding='utf8')
    print(name,flush=True)
    return name,snap,docx,pdf

jobs=[(t,v) for t in MANIFEST['templates'] for v in ['short','long','blank','batch']]
with ThreadPoolExecutor(max_workers=min(4,max(1,int(os.environ.get('DEMO_QA_CONCURRENCY','2'))))) as pool:
    specimens=list(pool.map(lambda pair:specimen(*pair),jobs))

inventory=[];tiles=[];problems=[]
for name,snap,docx,pdf in specimens:
    document=pdfium.PdfDocument(str(pdf));pages=[];all_text=''
    for old in OUT.glob(name+'-page-*.png'):
        if int(old.stem.rsplit('-',1)[1])>len(document):old.unlink()
    for index,page in enumerate(document):
        page_path=OUT/f'{name}-page-{index+1}.png';page.render(scale=1.5).to_pil().save(page_path)
        text=page.get_textpage().get_text_range();all_text+=text
        if len(text.strip())<50:problems.append({'document':name,'page':index+1,'error':'EMPTY_PAGE'})
        pages.append({'page':index+1,'widthPt':round(page.get_width(),2),'heightPt':round(page.get_height(),2),'image':page_path.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(page_path.read_bytes()).hexdigest(),'textCharacters':len(text)})
        im=Image.open(page_path).convert('RGB');im.thumbnail((450,625))
        tile=Image.new('RGB',(480,670),'#e6e8e9');tile.paste(im,((480-im.width)//2,30));ImageDraw.Draw(tile).text((8,8),name+' / '+str(index+1),fill='black');tiles.append(tile)
    # PDFium exposes LibreOffice's discretionary line-break hyphen as U+FFFE.
    normalized=''.join(all_text.replace('\ufffe','-').split())
    for item in snap['items']:
        if ''.join(item['fullNameRu'].split()) not in normalized:problems.append({'document':name,'error':'NAME_NOT_VISIBLE','name':item['fullNameRu']})
        template=next(t for t in MANIFEST['templates'] if t['id']==snap['templateId'])
        if item.get('fullNameKz') and ''.join(item['fullNameKz'].split()) not in normalized:problems.append({'document':name,'error':'KZ_NAME_NOT_VISIBLE'})
        for group,prefix in [('POSITION','position'),('WORKPLACE','workplace')]:
            slots=[group+'_RU',group+'_KZ',group+'_BOTH']+(['PROFESSION_RU','PROFESSION_KZ'] if group=='POSITION' else [])
            if any(field in template['fields'] for field in slots):
                for lang in ['Ru','Kz']:
                    value=item.get(prefix+lang)
                    if value and ''.join(value.split()) not in normalized:problems.append({'document':name,'error':'BILINGUAL_FIELD_NOT_VISIBLE','field':prefix+lang})
    for word in ['Стандарт','Солтанова','Флеглер','Баянов','Жакибеков','{{','MERGEFIELD']:
        if word in all_text:problems.append({'document':name,'error':'FORBIDDEN_TEXT','text':word})
    inventory.append({'name':name,'docx':docx.relative_to(ROOT).as_posix(),'pdf':pdf.relative_to(ROOT).as_posix(),'docxSha256':hashlib.sha256(docx.read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'pages':pages})
for offset in range(0,len(tiles),8):
    contact=Image.new('RGB',(1920,1340),'white')
    for i,tile in enumerate(tiles[offset:offset+8]):contact.paste(tile,((i%4)*480,(i//4)*670))
    contact.save(OUT/f'contact-{offset//8+1:02}.png')
for t in MANIFEST['templates']:
    normal=next(x for x in inventory if x['name']==t['id']+'-short');batch=next(x for x in inventory if x['name']==t['id']+'-batch')
    if len(batch['pages'])!=len(normal['pages'])*2:problems.append({'document':batch['name'],'error':'BATCH_PAGE_COUNT','expected':len(normal['pages'])*2,'actual':len(batch['pages'])})
report={'documents':len(inventory),'pages':sum(len(r['pages']) for r in inventory),'variants':['short','long','blank optional','batch two'],'problems':problems,'files':inventory}
(OUT/'inventory.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({k:report[k] for k in ['documents','pages','problems']},ensure_ascii=False),flush=True)
if problems:sys.exit(1)
