"""Auditable v4 -> v5 corrections; never overwrites a previous template version."""
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
from sanitize_templates import deterministic_zip, replace_text_nodes

ROOT = Path(__file__).resolve().parents[2]
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
NS = {'w': W[1:-1]}


def set_text(cell, text):
    paragraphs = cell.findall(W+'p')
    paragraph = paragraphs[0]
    for node in list(paragraph):
        if node.tag != W+'pPr': paragraph.remove(node)
    for extra in paragraphs[1:]: cell.remove(extra)
    props = paragraph.find(W+'pPr')
    if props is None: props = E.SubElement(paragraph, W+'pPr')
    for node in props.findall(W+'numPr') + props.findall(W+'pStyle'): props.remove(node)
    # Explicitly disable any numbering inherited from styles in Word or LibreOffice.
    num = E.SubElement(props, W+'numPr'); E.SubElement(num, W+'numId', {W+'val':'0'})
    run = E.SubElement(paragraph, W+'r'); E.SubElement(run, W+'t').text = text


def upgrade():
    directory = ROOT/'assets/templates'
    manifest = json.loads((directory/'manifest.json').read_text(encoding='utf8'))
    changes = {}
    for template in manifest['templates']:
        tid = template['id']
        if tid.startswith('biot-'):
            template['regulatoryReview']={'status':'REQUIRES_CURRENT_FORM','effectiveFrom':'2026-07-12','source':'https://old.adilet.zan.kz/rus/docs/V1500012665','notice':'Исторический макет требует сверки с действующей формой и утверждения эмитентом. '+('В этом макете 6 колонок; в текущем приложении 3 предусмотрено 7.' if tid=='biot-protocol' else 'Юридическая пригодность текущей редакции не подтверждена.')}
        if tid not in ['biot-worker-card','biot-protocol','ptm-protocol','pb-card','pb-protocol','ps-card','ps-protocol','ps-witness']: continue
        source = directory/(tid+'.v4.docx')
        if not source.exists(): source=ROOT/'docs/evidence/commercial-acceptance/printing/historical-inputs'/(tid+'.v4.docx')
        with ZipFile(source) as archive: files = {n:archive.read(n) for n in archive.namelist()}
        tree = E.fromstring(files['word/document.xml'])
        notes = []
        if 'protocol' in tid:
            table = next(tree.iter(W+'tbl')); rows = table.findall(W+'tr')
            data = rows[2 if tid == 'biot-protocol' else 1]
            set_text(data.findall(W+'tc')[0], '1')
            notes.append('individual recipient ordinal is explicit 1, independent from document numbers')
            for index, row in enumerate(rows):
                props = row.find(W+'trPr')
                if props is None: props = E.SubElement(row, W+'trPr')
                if props.find(W+'cantSplit') is None: E.SubElement(props, W+'cantSplit')
                if index < (2 if tid == 'biot-protocol' else 1) and props.find(W+'tblHeader') is None: E.SubElement(props, W+'tblHeader')
            if tid == 'biot-protocol':
                for i,cell in enumerate(rows[1].findall(W+'tc'),1): set_text(cell,str(i))
                set_text(data.findall(W+'tc')[-1], '')
                notes.append('six column labels use literal cells 1..6 and repeat with table header')
                notes.append('notes cell is blank; protocol number is not a recipient note')
            if tid == 'ptm-protocol':
                set_text(data.findall(W+'tc')[-1], '')
                notes.append('manual signature cell is blank, never a document number')
            if tid == 'ps-protocol':
                set_text(data.findall(W+'tc')[-1], '{{NUMBER}}')
                notes.append('certificate number appears once in its cell')
        seen_basis = False
        for paragraph in list(tree.iter(W+'p')):
            nodes = paragraph.xpath('./w:r/w:t | ./w:hyperlink/w:r/w:t', namespaces=NS)
            text = ''.join(n.text or '' for n in nodes)
            if '{{APPROVAL_BASIS}}' in text:
                if seen_basis:
                    for node in nodes: node.text = ''
                    notes.append('removed repeated approval basis caused by generic source sanitizer')
                else: seen_basis = True
            if tid == 'biot-worker-card' and 'Лауазымы' in text:
                replace_text_nodes(nodes, r'\{\{SERIES\}\}', '{{POSITION_KZ}}')
                notes.append('Kazakh position maps to POSITION_KZ')
            if tid in ['biot-protocol','ptm-protocol'] and '{{WORKPLACE_' in text:
                replace_text_nodes(nodes, r'ТОО\s*(?=\{\{WORKPLACE_)', '')
                replace_text_nodes(nodes, r'(?<=\}\})\s*ЖШС', '')
            if tid=='pb-card':
                if '{{VALID_YEAR}}' in text:
                    replace_text_nodes(nodes,r'\{\{DOCUMENT_DAY\}\}','{{VALID_DAY}}')
                    replace_text_nodes(nodes,r'\{\{DOCUMENT_MONTH\}\}','{{VALID_MONTH}}')
                    notes.append('expiry uses independent validUntil day and month')
                elif '{{DOCUMENT_YEAR}}' in text:
                    box=next((n for n in paragraph.iterancestors() if n.tag==W+'txbxContent'),None)
                    if box is not None and '{{PROTOCOL_NUMBER}}' in ''.join(box.itertext()):
                        for a,b in [('DOCUMENT_YEAR','PROTOCOL_YEAR'),('DOCUMENT_DAY','PROTOCOL_DAY'),('DOCUMENT_MONTH','PROTOCOL_MONTH')]:replace_text_nodes(nodes,re.escape('{{'+a+'}}'),'{{'+b+'}}')
                        notes.append('protocol basis uses independent protocolDate')
                # Put captions beside their fields, making room for full bilingual
                # values at 8pt without changing the physical panel dimensions.
                box=next((n for n in paragraph.iterancestors() if n.tag==W+'txbxContent'),None)
                if box is not None and '{{FULL_NAME_BOTH}}' in ''.join(box.itertext()):
                    if '{{FULL_NAME_BOTH}}' in text: replace_text_nodes(nodes,r'Берілді\s*','Берілді / Выдано: ')
                    elif '{{WORKPLACE_BOTH}}' in text:replace_text_nodes(nodes,r'\{\{WORKPLACE_BOTH\}\}','Жұмыс орны / Место работы: {{WORKPLACE_BOTH}}')
                    elif '{{POSITION_BOTH}}' in text:replace_text_nodes(nodes,r'\{\{POSITION_BOTH\}\}','Лауазымы / Должность: {{POSITION_BOTH}}')
                    elif any(label in text for label in ['(Т.А.Ә','(жұмыс орны','(оқыту ұйымы','учебной организации/центра)']):
                        for node in nodes:node.text=''
                        notes.append('redundant caption paragraphs replaced by inline bilingual field labels')
            if tid=='ps-card':
                box=next((n for n in paragraph.iterancestors() if n.tag==W+'txbxContent'),None)
                if box is not None and '{{FULL_NAME_BOTH}}' in ''.join(box.itertext()):
                    if '{{FULL_NAME_BOTH}}' in text:replace_text_nodes(nodes,r'Берілді\s*','Берілді / Выдано: ')
                    elif 'біліктілік берілгендігі туралы' in text:
                        nodes[0].text='Біліктілік / Квалификация:'
                        for node in nodes[1:]:node.text=''
                    elif any(label in text for label in ['Выдано','в том, что ему','(мамандығы, разряды']):
                        for node in nodes:node.text=''
                    notes.append('compact bilingual field labels preserve photo clearance at 8pt')
            if tid == 'ps-witness':
                if 'Біліктілік комиссиясының' in text:
                    # This is the first cell of the decision-date table.
                    table = next(n for n in paragraph.iterancestors() if n.tag == W+'tbl')
                    for node in table.iter(W+'t'):
                        if node.text:
                            node.text = node.text.replace('{{TRAINING_END_YEAR_FULL}}','{{PROTOCOL_YEAR}}').replace('{{TRAINING_END_MONTH_KZ}}','{{PROTOCOL_DAY}} {{PROTOCOL_MONTH_KZ}}')
                if 'Решением квалификационной комиссии' in text:
                    for a,b in [('ISSUE_DAY','PROTOCOL_DAY'),('ISSUE_MONTH_RU','PROTOCOL_MONTH_RU'),('TRAINING_END_YEAR_FULL','PROTOCOL_YEAR')]: replace_text_nodes(nodes,re.escape('{{'+a+'}}'),'{{'+b+'}}')
                    notes.append('commission decision date uses protocolDate, independently of issue/training dates')
                if 'Тіркеу' in text: replace_text_nodes(nodes,r'\{\{CITY_RU\}\}','{{CITY_KZ}}')
        files['word/document.xml'] = E.tostring(tree,xml_declaration=True,encoding='utf8')
        out = directory/(tid+'.v5.docx'); deterministic_zip(out,files)
        template.update(version=5,file=out.name,sha256=hashlib.sha256(out.read_bytes()).hexdigest(),previousTemplateSha256=hashlib.sha256(source.read_bytes()).hexdigest())
        text = ''.join(''.join(E.fromstring(data).itertext()) for name,data in files.items() if name.endswith('.xml'))
        template['fields'] = sorted(set(re.findall(r'\{\{([A-Z0-9_]+)\}\}',text)))
        changes[tid] = list(dict.fromkeys(notes))
    manifest['rendererVersion'] = 'demo-ooxml-3'
    (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    (directory/'v5-changes.json').write_text(json.dumps(changes,ensure_ascii=False,indent=2)+'\n',encoding='utf8')


if __name__ == '__main__': upgrade()
