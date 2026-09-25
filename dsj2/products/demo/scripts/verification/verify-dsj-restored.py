"""Actual DOCX/PDF acceptance for restored DSJ forms and event rosters."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import sys
from zipfile import ZipFile
from lxml import etree as E
import pymupdf

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT/'scripts/render'), str(ROOT/'tests/render')]
from renderer import render_docx, convert_pdf
from test_render import fixture
from test_group_protocol import group_fixture
from print_contracts import assert_package_contract
from group_protocol import roster_table, W

OUTPUT = ROOT/'docs/evidence/dsj-forms-ux/templates/restored'
MANIFEST = json.loads((ROOT/'assets/templates/manifest.json').read_text(encoding='utf8'))


def normalize(text): return re.sub(r'\s+', '', text).replace('\u00ad','')


def scenario(tid, variant, count=1):
    snap = group_fixture(tid,count) if variant=='group' else fixture(tid)
    if variant=='group':
        for index,item in enumerate(snap['items'],1):
            item.update(fullNameRu=f'Участник-{index:03} Иван Петрович',fullNameKz=f'Қатысушы-{index:03} Әділбек Қанатұлы',
                        number='ПР-77777',protocolNumber='ПР-77777',credentialNumber=f'КР-{index:05}')
    if variant=='long':
        item=snap['items'][0]
        item.update(fullNameRu='Тестов-Примеров Александр Константинович',fullNameKz='Әғқңөұүһі Өмірсерік Қанатұлы',
                    workplaceRu='ТОО «Научно-производственная компания Образец»',workplaceKz='«Үлгі ғылыми-өндірістік компаниясы» ЖШС',
                    positionRu='Инженер по промышленной безопасности',positionKz='Өнеркәсіптік қауіпсіздік жөніндегі инженер')
    return snap


def run(job):
    tid,variant,count=job
    snap=scenario(tid,variant,count);name=f'{tid}-{variant}-{count}'
    docx=OUTPUT/(name+'.docx');pdf=docx.with_suffix('.pdf')
    render_docx(snap,docx);assert_package_contract(docx)
    with ZipFile(docx) as archive:
        tree=E.fromstring(archive.read('word/document.xml'))
        alltext=''.join(''.join(E.fromstring(archive.read(n)).itertext()) for n in archive.namelist() if n.endswith('.xml'))
        assert '{{' not in alltext
        assert not re.search('Солтанова|Флеглер|Баянов|Гормонтажпроект|Аттестационный центр Стандарт',alltext)
        if tid.endswith('protocol'):
            table=roster_table(tree);rows=table.findall(W+'tr')
            assert len(rows)==count+2
            assert [''.join(c.itertext()) for c in rows[1].findall(W+'tc')]==list('123456')
            assert [''.join(row.find(W+'tc').itertext()) for row in rows[2:]]==[str(n) for n in range(1,count+1)]
            assert all(not ''.join(row.findall(W+'tc')[-1].itertext()).strip() for row in rows[2:])
            assert all(item['workplaceKz'] in ''.join(rows[i+2].itertext()) for i,item in enumerate(snap['items']))
            assert all(item['workplaceRu'] in ''.join(rows[i+2].itertext()) for i,item in enumerate(snap['items']))
            assert alltext.count(snap['issuer']['approvalBasis'])==1
            signature=[t for t in tree.iter(W+'tbl') if t is not table]
            assert len(signature)==1
            for row in signature[0].findall(W+'tr')[::2]: assert not ''.join(row.findall(W+'tc')[2].itertext()).strip()
    convert_pdf(docx,pdf)
    document=pymupdf.open(pdf);all_pdf=''.join(page.get_text() for page in document)
    assert 'ДЕМО' in all_pdf
    pages=[]
    for index,page in enumerate(document,1):
        words=page.get_text('words')
        assert all(w[0]>=-.5 and w[1]>=-.5 and w[2]<=page.rect.width+.5 and w[3]<=page.rect.height+.5 for w in words), 'PAGE_OVERFLOW'
        image=OUTPUT/f'{name}-page-{index:03}.png';page.get_pixmap(matrix=pymupdf.Matrix(1.3,1.3)).save(image)
        pages.append({'page':index,'png':image.relative_to(ROOT).as_posix(),'characters':len(page.get_text())})
    for item in snap['items']:
        for key in ['fullNameRu','fullNameKz']:
            assert normalize(item[key]) in normalize(all_pdf), ('PDF_NAME_MISSING',name,key)
        assert normalize(item['protocolNumber'] if tid.endswith('protocol') else item['number']) in normalize(all_pdf), 'PDF_NUMBER_MISSING'
    if tid.endswith('protocol'):
        for index,page in enumerate(document,1):
            if 'Участник-' in page.get_text():
                assert 'Фамилия' in page.get_text(), ('HEADER_MISSING',index)
        positions=[all_pdf.find(item['fullNameRu'].split()[0]) for item in snap['items']]
        assert positions==sorted(positions) and len(set(positions))==len(positions),'ROSTER_ORDER'
        signature_pages=[p for p in document if 'Председатель комиссии:' in p.get_text()]
        assert len(signature_pages)==1, 'SIGNATURE_BLOCK_SPLIT'
        for member in snap['issuer']['commission']: assert member['name'] in signature_pages[0].get_text()
        assert normalize(snap['issuer']['nameRu']) in normalize(all_pdf), 'ISSUER_HIDDEN_BY_MARK'
    record={'templateId':tid,'variant':variant,'participants':count,'docx':docx.relative_to(ROOT).as_posix(),'pdf':pdf.relative_to(ROOT).as_posix(),
            'docxSha256':hashlib.sha256(docx.read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),
            'pages':pages,'assertions':'PASS','visualReview':'PENDING'}
    (OUTPUT/(name+'.json')).write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf8')
    print(name,len(document),'PASS',flush=True)
    return record


def main():
    OUTPUT.mkdir(parents=True,exist_ok=True)
    jobs=[(tid,variant,1) for tid in ['biot-worker-card','biot-itr-certificate','biot-protocol','biot-itr-protocol'] for variant in ['short','long']]
    jobs += [(tid,'group',count) for tid in ['biot-protocol','biot-itr-protocol'] for count in [1,3,100]]
    with ThreadPoolExecutor(max_workers=2) as executor: results=list(executor.map(run,jobs))
    (OUTPUT/'verification.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')


if __name__=='__main__':main()
