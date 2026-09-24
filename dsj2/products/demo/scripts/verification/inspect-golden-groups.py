"""Inspect already saved group PDFs/DOCX and create all-page visual evidence."""
import json
from pathlib import Path
import re
import sys
from zipfile import ZipFile
from lxml import etree as E
import pymupdf
from PIL import Image, ImageDraw

root = Path(sys.argv[1]).resolve()
sources = json.loads((root / 'source.json').read_text(encoding='utf8'))
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
normalize = lambda value: re.sub(r'\s+', '', value).replace('-', '')
reports = []
for source in sources:
    template = source['templateId']
    pdf = root / (template + '.pdf')
    if not pdf.exists():
        continue
    with ZipFile(root / (template + '.docx')) as archive:
        xml = E.fromstring(archive.read('word/document.xml'))
    tables = [table for table in xml.iter(W+'tbl') if table.findall(W+'tr') and '№' in ''.join(table.findall(W+'tr')[0].itertext())]
    assert len(tables) == 1
    heading_count = 2 if template.startswith('biot') else 1
    rows = tables[0].findall(W+'tr')[heading_count:]
    assert len(rows) == len(source['items'])
    assert [''.join(row.findall(W+'tc')[0].itertext()) for row in rows] == [str(n) for n in range(1, len(rows)+1)]
    document = pymupdf.open(pdf)
    text = normalize(''.join(page.get_text() for page in document))
    missing_names = [item['fullNameRu'] for item in source['items'] if normalize(item['fullNameRu']) not in text]
    assert not missing_names, missing_names
    page_checks = []
    cards = []
    signature_pages = []
    for index, page in enumerate(document):
        words = page.get_text('words')
        assert all(word[0] >= 0 and word[1] >= 0 and word[2] <= page.rect.width+1 and word[3] <= page.rect.height+1 for word in words)
        page_text = normalize(page.get_text())
        # Equal names are distinct people in the fixtures. Count visible
        # occurrences instead of counting each source name against each page.
        names = sum(page_text.count(name) for name in {normalize(item['fullNameRu']) for item in source['items']})
        heading = any(label in page.get_text() for label in ['Фамилия', 'Ф.И.О.'])
        if names:
            assert heading, 'Missing continuation heading'
        if 'Председателькомиссии:' in page_text:
            signature_pages.append(index+1)
        page_checks.append({'page': index+1, 'names': names, 'rosterHeading': heading, 'textWithinPage': True})
        image_path = root / (template + '-page-%d.png' % (index+1))
        page.get_pixmap(matrix=pymupdf.Matrix(1, 1)).save(image_path)
        image = Image.open(image_path).convert('RGB'); image.thumbnail((440, 1000))
        card = Image.new('RGB', (440, image.height+25), '#eeeeee'); card.paste(image, (0, 25))
        ImageDraw.Draw(card).text((5, 5), '%s page%d' % (template, index+1), fill='black'); cards.append(card)
    assert sum(check['names'] for check in page_checks) == len(source['items'])
    height = max(card.height for card in cards)
    contact = Image.new('RGB', (1320, ((len(cards)+2)//3)*height), '#aaaaaa')
    for index, card in enumerate(cards): contact.paste(card, ((index%3)*440, (index//3)*height))
    contact.save(root / (template + '-contact.png'))
    reports.append({'templateId': template, 'documentId': source['documentId'], 'pages': len(document), 'rows': len(rows), 'allNames': True, 'docxOrdinals': True, 'pageChecks': page_checks, 'signaturePages': signature_pages})
(root / 'group-qa.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(reports))
