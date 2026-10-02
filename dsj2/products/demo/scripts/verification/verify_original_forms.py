"""Reproduce original-form DOCX/PDF evidence with synthetic, filled records.

Uses the product renderer and installed converter; no dependency installation,
source mutation, DB provisioning, template approval or production action.
"""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/evidence/first-live-iteration/templates/final'
os.environ.setdefault('DEMO_RENDER_EVIDENCE_ROOT',str(OUT/'tests'))
sys.path[:0]=[str(ROOT/'scripts/render'),str(ROOT/'tests/render')]
from renderer import render_docx,convert_pdf
from test_original_forms import english_fixture
from test_render import fixture
from test_group_protocol import group_fixture,FORMS
import pymupdf
from PIL import Image,ImageDraw


def make_snapshot(template_id,count,english):
    s=english_fixture(template_id,count) if english else group_fixture(template_id,count) if count>1 else fixture(template_id)
    s['issuer'].update(addressRu='Астана, улица Примерная 1',addressKz='Астана, Үлгі көшесі 1')
    s['businessRuleVersion']='LIVE_V1'
    for item in s['items']:
        item['employeeCategory']='ITR' if template_id.startswith('biot-itr') else 'WORKER'
        if template_id.startswith('ps-'):item['assignment'].update(validityMode='UNLIMITED',validUntil='')
        elif item['employeeCategory']=='ITR':item['assignment']['validUntil']='2029-09-22'
    return s


def verify_case(case):
    template_id,count,english=case
    key=f'{template_id}-{count}-'+('en' if english else 'kzru')
    s=make_snapshot(*case)
    path=OUT/(key+'.docx');render_docx(s,path);convert_pdf(path,path.with_suffix('.pdf'))
    doc=pymupdf.open(path.with_suffix('.pdf'))
    texts=[p.get_text() for p in doc];combined=' '.join(texts)
    forbidden=r'\{\{|MERGEFIELD|Стандарт|Солтанова|Флеглер|Баянов|Жакибеков|QNP|Венцель|Токенов|160440010815|100012|0002-2026'
    if re.search(forbidden,combined):raise ValueError('OLD_SAMPLE_OR_FIELD_LEFTOVER:'+key)
    if not all(any(letter.isalpha() for letter in text.replace('ДЕМО — НЕ ЯВЛЯЕТСЯ ВЫДАННЫМ ДОКУМЕНТОМ','')) for text in texts):
        raise ValueError('BLANK_LEAF:'+key)
    for page in doc:
        if not all(x0>=-1 and y0>=-1 and x1<=page.rect.width+1 and y1<=page.rect.height+1 for x0,y0,x1,y1,*_ in page.get_text('words')):
            raise ValueError('TEXT_OUTSIDE_PAGE:'+key)
    if english:
        marker=next(i for i,text in enumerate(texts) if 'English appendix' in text)
        english_text=' '.join(texts[marker:])
        for item in s['items']:
            if english_text.count(item['fullNameEn'])!=1:raise ValueError('EN_PERSON_MISSING_OR_DUPLICATED:'+key)
        if template_id.startswith('ps-') and 'Unlimited' not in english_text:raise ValueError('PS_EN_VALIDITY_MISSING')
        if count>1:
            for text in texts[marker:]:
                if 'Example Person' in text and not all(label in text for label in ['Full name','Result and record details']):raise ValueError('EN_ROSTER_HEADER_MISSING')
    else:
        if 'English appendix' in combined:raise ValueError('UNREQUESTED_APPENDIX')
    page_records=[]
    for index,page in enumerate(doc,1):
        image_path=OUT/f'{key}-page-{index:03}.png'
        page.get_pixmap(matrix=pymupdf.Matrix(1.2,1.2)).save(image_path)
        page_records.append({'page':index,'characters':len(texts[index-1]),'png':image_path.name})
    record={'case':key,'templateId':template_id,'members':count,'englishAppendix':english,'pages':page_records,
        'docxSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256(path.with_suffix('.pdf').read_bytes()).hexdigest(),
        'allRecipientsEnglishPresentOnce':english,'outsidePageText':False,'oldSamples':False}
    print(key,len(doc),flush=True)
    return record


def contact_sheets(records):
    pages=[(r['case'],p) for r in records for p in r['pages']]
    for batch in range(0,len(pages),12):
        part=pages[batch:batch+12];canvas=Image.new('RGB',(1800,1800),'#eeeeee');draw=ImageDraw.Draw(canvas)
        for i,(key,page) in enumerate(part):
            image=Image.open(OUT/page['png']).convert('RGB');image.thumbnail((430,540))
            x=(i%4)*450+(450-image.width)//2;y=(i//4)*600+30
            canvas.paste(image,(x,y));draw.text(((i%4)*450+8,(i//4)*600+8),key+' p'+str(page['page']),fill='black')
        canvas.save(OUT/f'contact-{batch//12+1:02}.png')


if __name__=='__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((ROOT/'assets/templates/manifest.json').read_text(encoding='utf-8'))
    cases=[(t['id'],1,en) for t in manifest['templates'] for en in [False,True]]
    cases += [(tid,25,True) for tid in FORMS]+[('biot-protocol',250,True)]
    # DOCX generation preserves source field geometry; conversion is independent.
    with ThreadPoolExecutor(max_workers=2) as pool:records=list(pool.map(verify_case,cases))
    contact_sheets(records)
    (OUT/'verification.json').write_text(json.dumps({'rendererVersion':manifest['rendererVersion'],'syntheticDataOnly':True,
        'legalApproval':False,'physicalPrint':False,'visualReview':'PENDING','cases':records},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
