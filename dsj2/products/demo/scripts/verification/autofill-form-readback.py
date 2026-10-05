"""Fresh 11+5 form snapshots -> actual DOCX/PDF text and complete page inventory."""
import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from zipfile import ZipFile

from lxml import etree as E
from PIL import Image, ImageDraw
import pymupdf

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--out', required=True)
args = parser.parse_args()
output = Path(args.out).resolve()
output.mkdir(parents=True, exist_ok=True)
os.environ['DEMO_RENDER_EVIDENCE_ROOT'] = str(output)
os.environ['DEMO_ARTIFACT_ROOT'] = str(output / 'store')
sys.path.insert(0, str(ROOT / 'tests/render'))
from test_render import fixture, MANIFEST
from test_group_protocol import group_fixture
from renderer import render_docx, convert_pdf

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
sha = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()
compact = lambda value: re.sub(r'\s+', '', value).replace('\u00ad', '')
results = []
pages = []
for group, record in [(False, t) for t in MANIFEST['templates']] + [(True, t) for t in MANIFEST['groupTemplates']]:
    tid = record['id']
    snapshot = group_fixture(tid, 2) if group else fixture(tid)
    snapshot['demoMode'] = False
    snapshot['issuer'].update(bin='990140000000', headName='Тестова А. Б.')
    for item in snapshot['items']:
        a = item['assignment']
        a.update(result='Сдал / Тапсырды', outcome={'status': 'PASSED'})
        if tid.startswith('biot-itr'):
            a.update(biotCategory='ITR_STANDARD', trainingSubject='Безопасность и охрана труда',
                     trainingSubjectKz='Еңбек қауіпсіздігі және еңбекті қорғау')
            for key in ['biotIndustryRu', 'biotIndustryKz', 'biotKnowledgeResult', 'biotProctoringResult']:
                a.pop(key, None)
            for key in ['employerBin', 'employerAddressRu', 'employerAddressKz']:
                item.pop(key, None)
        if tid.startswith('ps-'):
            a.update(professionRu='Машинист', professionKz='Машинист', psQualificationRu='Машинист', psQualificationKz='Машинист',
                     psGeneralSubjectRu='Общепроф. курс', psGeneralSubjectKz='Жалпы кәсіби курс',
                     psSpecialSubjectRu='Спец. Курс', psSpecialSubjectKz='арнайы курс')
    original = deepcopy(snapshot)
    name = tid + ('-group' if group else '')
    docx = output / (name + '.docx')
    pdf = docx.with_suffix('.pdf')
    (output / (name + '.snapshot.json')).write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding='utf8')
    render_docx(snapshot, docx)
    convert_pdf(docx, pdf)
    with ZipFile(docx) as z:
        docx_text = ' '.join(node.text or '' for node in E.fromstring(z.read('word/document.xml')).iter(W + 't'))
        assert not any(b'TargetMode="External"' in z.read(n) for n in z.namelist() if n.endswith('.rels'))
    expected = [i['fullNameRu'] for i in snapshot['items']]
    expected += [snapshot['items'][0]['protocolNumber']] if tid.endswith('-protocol') else [snapshot['items'][0]['number']]
    if tid == 'ps-witness':
        expected += [snapshot['items'][0]['registrationNumber'], '14 сентября 2026', '19 сентября 2026',
                     '14 қыркүйек 2026', '19 қыркүйек 2026']
    if tid in ['biot-worker-card', 'ps-witness']:
        expected += [i['fullNameKz'] for i in snapshot['items']]
    if tid in ['biot-worker-card', 'ptm-card', 'pb-card', 'biot-protocol', 'biot-itr-protocol', 'ptm-protocol', 'pb-protocol']:
        expected += [snapshot['items'][0]['workplaceRu'], snapshot['items'][0]['workplaceKz']]
    if tid == 'biot-itr-certificate':
        expected += [snapshot['items'][0]['assignment']['trainingSubject'], snapshot['items'][0]['assignment']['trainingSubjectKz']]
    if tid == 'ps-card':
        expected += ['Машинист', 'Общепроф. курс', 'Жалпы кәсіби курс', 'Спец. Курс', 'арнайы курс']
    elif tid.startswith('ps-'):
        expected += ['Машинист']
    with pymupdf.open(pdf) as document:
        pdf_text = ' '.join(page.get_text() for page in document)
        images = []
        for index, page in enumerate(document, 1):
            image = output / f'{name}-page-{index}.png'
            page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False).save(image)
            pages.append(image)
            images.append({'page': index, 'image': image.name, 'sha256': sha(image)})
        for value in expected:
            assert compact(value) in compact(docx_text), f'{name}: DOCX missing {value}'
            assert compact(value) in compact(pdf_text), f'{name}: PDF missing {value}'
        forbidden = re.compile(r'\{\{[A-Z_]+\}\}|MERGEFIELD|Солтанова|Флеглер|Баянов|Жакибеков|160440010815')
        assert not forbidden.search(docx_text), name
        assert not forbidden.search(pdf_text), name
        assert snapshot == original
        results.append({'templateId': tid, 'group': group, 'version': record['version'], 'sourceSha256': record['sha256'],
                        'docxSha256': sha(docx), 'pdfSha256': sha(pdf), 'pages': images, 'verifiedValues': expected,
                        'ordinaryItrWithoutSpecialData': tid.startswith('biot-itr')})
    print(name + ' PASS', flush=True)
for offset in range(0, len(pages), 6):
    contact = Image.new('RGB', (1380, 1220), '#dedede')
    for n, path in enumerate(pages[offset:offset + 6]):
        im = Image.open(path).convert('RGB'); im.thumbnail((440, 570))
        x, y = (n % 3) * 460, (n // 3) * 610
        contact.paste(im, (x + (460 - im.width) // 2, y + 30))
        ImageDraw.Draw(contact).text((x + 10, y + 8), path.stem, fill='black')
    contact.save(output / f'contact-{offset // 6 + 1}.png')
(output / 'readback.json').write_text(json.dumps({'forms': len(results), 'pages': len(pages), 'results': results}, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps({'forms': len(results), 'pages': len(pages), 'status': 'PASS'}), flush=True)
