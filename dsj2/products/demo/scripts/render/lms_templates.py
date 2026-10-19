"""LMS center forms v1. Frozen result provenance only; no regulatory-form claims.

The three packages are new versions and do not modify historic DEMO templates.
Runtime inputs are the immutable per-assignment `lms` snapshot prepared by the
document bridge, never a current learner profile or editable course.
"""
from __future__ import annotations

import hashlib
import json
import re
from io import BytesIO
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from zipfile import ZipFile

from lxml import etree as E
from sanitize_templates import deterministic_zip
from package_xml import normalize_package

ROOT = Path(__file__).resolve().parents[2]
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
POLICY = 'LMS_CENTER_FORMS_V1'
CURRENT_POLICY = 'LMS_CENTER_FORMS_V3'
MODERN_POLICIES = ['LMS_CENTER_FORMS_V2', CURRENT_POLICY]
TEMPLATES = {
    'lms-protocol': ('Протокол результатов обучения', 'Оқу нәтижелерінің хаттамасы'),
    'lms-certificate': ('Сертификат учебного центра', 'Оқу орталығының сертификаты'),
    'lms-credential': ('Удостоверение учебного центра', 'Оқу орталығының куәлігі'),
}


def identify_lms(path, template_id):
    if template_id not in TEMPLATES:
        return False
    with ZipFile(path) as archive:
        if 'demo/lms-form.json' not in archive.namelist():
            return False
        marker = json.loads(archive.read('demo/lms-form.json'))
    return marker.get('policy') in [POLICY, *MODERN_POLICIES] and marker.get('templateId') == template_id


def _text(value):
    return '' if value is None else str(value)


def _both(ru, kz):
    return ' / '.join(dict.fromkeys(filter(None, [_text(ru).strip(), _text(kz).strip()])))


def _date(value):
    if not value:
        return 'Не указана / Көрсетілмеген'
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).strftime('%d.%m.%Y')
    except ValueError:
        raise ValueError('LMS_DOCUMENT_DATE_INVALID')


def lms_fields(snapshot, item):
    assignment = item.get('assignment', {})
    lms = assignment.get('lms') or snapshot.get('lms')
    if not isinstance(lms, dict) or not lms.get('resultId') or not lms.get('profileVersionId'):
        raise ValueError('LMS_DOCUMENT_PROVENANCE_REQUIRED')
    if lms.get('eligible') is not True or lms.get('verdict') != 'PASSED' or lms.get('assessmentKind') not in ['CENTER_EXAM', 'EXTERNAL_AUTHORIZED']:
        raise ValueError('LMS_DOCUMENT_RESULT_INELIGIBLE')
    form = lms.get('legalForm')
    legal = {
        'INFORMATION_CARD': 'Информационная карточка учебного центра / Оқу орталығының ақпараттық карточкасы',
        'PAPER_ORIGINAL': 'Подготовлено для подписания на бумаге / Қағазда қол қою үшін дайындалды',
        'ELECTRONIC_ORIGINAL': 'Подготовленный электронный документ / Дайындалған электрондық құжат',
        'COPY_OF_ORIGINAL': 'Копия исходного документа / Бастапқы құжаттың көшірмесі',
    }
    if form not in legal:
        raise ValueError('LMS_DOCUMENT_LEGAL_FORM_REQUIRED')
    source = lms.get('source') or {}
    if form == 'COPY_OF_ORIGINAL' and not (lms.get('originalReference') or source.get('documentNumber')):
        raise ValueError('LMS_DOCUMENT_ORIGINAL_REQUIRED')
    issuer = snapshot.get('issuer') or {}
    course = lms.get('course') or {}
    external = lms['assessmentKind'] == 'EXTERNAL_AUTHORIZED'
    source_description = (
        _both(source.get('issuer') or lms.get('issuer'), source.get('issuerKz')) +
        (' · № ' + _text(source.get('documentNumber')) if source.get('documentNumber') else '') +
        (' · ' + _date(source.get('documentDate')) if source.get('documentDate') else '')
        if external else _text(lms.get('examiner') or lms.get('issuer'))
    )
    if not source_description:
        raise ValueError('LMS_DOCUMENT_SOURCE_REQUIRED')
    score = lms.get('score')
    maximum = lms.get('maximum')
    result = 'Сдал / Тапсырды'
    if score is not None and maximum is not None:
        result += f' · {score}/{maximum}'
    requirements = list(lms.get('requiredSignatures') or [])
    if form == 'ELECTRONIC_ORIGINAL':
        meaning = 'Действительность электронного оригинала требует проверки обязательных ЭЦП. / Электрондық түпнұсқаның жарамдылығы міндетті ЭЦҚ тексеруін талап етеді.'
    elif form == 'PAPER_ORIGINAL':
        meaning = 'Бумажный оригинал требует предусмотренных подписей. / Қағаз түпнұсқасына көзделген қолдар қажет.'
    elif form == 'COPY_OF_ORIGINAL':
        meaning = 'Копия не подтверждает криптографическую проверку исходных подписей. / Көшірме бастапқы қолдардың криптографиялық тексерілуін растамайды.'
    else:
        meaning = 'Запись реестра учебного центра. / Оқу орталығының тізілім жазбасы.'
    if requirements:
        meaning += ' Подписи / Қолдар: ' + ', '.join(map(str, requirements)) + '.'
    return {
        'ISSUER': _both(issuer.get('nameRu') or lms.get('issuer'), issuer.get('nameKz')),
        'NUMBER': _text(item.get('number') or item.get('protocolNumber') or assignment.get('externalBasisNumber')),
        'DOCUMENT_DATE': _date(assignment.get('documentDate') or lms.get('examAt')),
        'LEARNER': _both(item.get('fullNameRu'), item.get('fullNameKz')),
        'POSITION': _both(item.get('positionRu'), item.get('positionKz')),
        'EMPLOYER': _both(item.get('workplaceRu'), item.get('workplaceKz')),
        'COURSE': _both(course.get('titleRu') or assignment.get('trainingSubject'), course.get('titleKz') or assignment.get('trainingSubjectKz')),
        'HOURS': _text(course.get('hours', assignment.get('hours', ''))),
        'EXAM_DATE': _date(lms.get('examDate') or lms.get('examAt')),
        'RESULT': result,
        'LEGAL_FORM': legal[form],
        'LEGAL_MEANING': meaning,
        'ASSESSMENT': 'Внешний уполномоченный экзамен / Уәкілетті сыртқы емтихан' if external else 'Экзамен учебного центра / Оқу орталығының емтиханы',
        'SOURCE': source_description,
        'REGULATORY': '\n'.join(' · '.join(filter(None, [
            _text(item.get('title')), _text(item.get('number')), _text(item.get('date')),
            _text(item.get('authority')), _text(item.get('revision')),
            ('ст. / бап ' + _text(item.get('article'))) if item.get('article') else '',
            ('п. / т. ' + _text(item.get('paragraph'))) if item.get('paragraph') else '',
            ('пп. / тт. ' + _text(item.get('subparagraph'))) if item.get('subparagraph') else '',
        ])) for item in source.get('regulatorySources', [])),
        'ORIGINAL': _text(lms.get('originalReference') or source.get('documentNumber') or '—'),
        'TRACE': f"Результат / Нәтиже {lms['resultId']} · r{lms.get('resultRevision', 1)}\nВерсия правил / Ереже нұсқасы {lms['profileVersionId']}",
        'SYNTHETIC': 'СИНТЕТИЧЕСКИЙ УЧЕБНЫЙ ПРИМЕР / СИНТЕТИКАЛЫҚ ОҚУ МЫСАЛЫ' if lms.get('synthetic') else '',
    }, lms


def enrich_v2(files, lms, template_id):
    """Add frozen private exam evidence and QR before any signed PDF exists."""
    from docx import Document
    from docx.shared import Mm, Pt
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from verification_qr import verification_qr
    buffer = BytesIO()
    with ZipFile(buffer, 'w') as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    document = Document(buffer)
    url = (lms.get('verification') or {}).get('url')
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    if paragraph.text == 'QR_IMAGE':
                        paragraph.clear()
                        if url:
                            image = BytesIO()
                            verification_qr({'url': url}, image)
                            paragraph.add_run().add_picture(image, width=Mm(29), height=Mm(29))
                            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    elif paragraph.text == 'QR_LINK':
                        paragraph.clear()
                        if url:
                            paragraph.add_run('Проверка записи / Жазбаны тексеру\n').font.size = Pt(7)
                            # The full stable URL is both visible and clickable.
                            from docx.oxml import OxmlElement
                            from docx.oxml.ns import qn
                            from docx.opc.constants import RELATIONSHIP_TYPE
                            hyperlink = OxmlElement('w:hyperlink')
                            hyperlink.set(qn('r:id'), document.part.relate_to(url, RELATIONSHIP_TYPE.HYPERLINK, is_external=True))
                            run = OxmlElement('w:r')
                            props = OxmlElement('w:rPr')
                            size = OxmlElement('w:sz'); size.set(qn('w:val'), '12'); props.append(size)
                            run.append(props)
                            text = OxmlElement('w:t'); text.text = url; run.append(text)
                            hyperlink.append(run); paragraph._p.append(hyperlink)
    protocol = lms.get('protocol')
    if template_id == 'lms-protocol' and protocol:
        def paragraph(text, bold=False, size=10, keep=False):
            p = document.add_paragraph()
            p.paragraph_format.keep_with_next = keep
            run = p.add_run(text); run.bold = bold; run.font.size = Pt(size)
            return p
        p = paragraph('Ведомость итогового экзамена / Қорытынды емтихан ведомосі', bold=True, size=13, keep=True)
        p.paragraph_format.page_break_before = True
        percent = f"{protocol['percent']:.2f}".rstrip('0').rstrip('.')
        comparison = '>' if protocol['comparison'] == 'GT' else '≥'
        paragraph(f"Попытка / Әрекет № {protocol['ordinal']} · {percent}% · Проходной балл / Өту балы {comparison} {protocol['thresholdPercent']}%", bold=True)
        paragraph('Завершена / Аяқталған: ' + _text(protocol['finishedAt']), size=9)
        if protocol.get('commission'):
            paragraph('Комиссия / Комиссия', bold=True, keep=True)
            for member in protocol['commission']:
                paragraph(member['role'] + ' — ' + member['name'])
        for index, question in enumerate(protocol['questions'], 1):
            paragraph(f"{index}. " + _both(question['promptRu'], question['promptKz']), bold=True, keep=True)
            paragraph('Ответ слушателя / Тыңдаушының жауабы: ' + _both(question['responseRu'], question['responseKz']))
            paragraph('Правильный ответ или критерий / Дұрыс жауап немесе критерий: ' + _both(question['correctAnswerRu'], question['correctAnswerKz']))
            paragraph('Баллы / Балдар: ' + _text(question['score']) + ' / 1', size=9)
        paragraph('История попыток / Әрекеттер тарихы', bold=True, keep=True)
        labels = {'PASSED': 'Сдал / Тапсырды', 'FAILED': 'Не сдал / Тапсырмады', 'EXPIRED': 'Время истекло / Уақыт аяқталды', 'FINISHED': 'Завершено / Аяқталған'}
        for attempt in protocol['history']:
            state = labels.get(attempt.get('verdict') or attempt['state'], 'Завершено / Аяқталған')
            points = '' if attempt.get('score') is None else f" · {attempt['score']}/{attempt['maximum']}"
            paragraph(f"№ {attempt['ordinal']} · {state}{points} · {_text(attempt['finishedAt'])}", size=9)
    output = BytesIO(); document.save(output)
    with ZipFile(output) as archive:
        rendered = {name: archive.read(name) for name in archive.namelist()}
    # python-docx discards unreferenced custom metadata. Preserve provenance.
    rendered.update({name: value for name, value in files.items() if name.startswith('demo/')})
    return rendered


def render_lms_one(snapshot, item, path):
    if not identify_lms(path, snapshot.get('templateId')):
        raise ValueError('LMS_TEMPLATE_IDENTITY')
    values, lms = lms_fields(snapshot, item)
    with ZipFile(path) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    marker = json.loads(files['demo/lms-form.json'])
    root = E.fromstring(files['word/document.xml'])
    for node in root.iter(W + 't'):
        text = node.text or ''
        for name, value in values.items():
            text = text.replace('{{' + name + '}}', value)
        if '{{' in text or '}}' in text:
            raise ValueError('LMS_TEMPLATE_UNBOUND_FIELD')
        node.text = text
    # Empty synthetic marker has no residual vertical block.
    for paragraph in list(root.iter(W + 'p')):
        if not ''.join(t.text or '' for t in paragraph.iter(W + 't')).strip() and paragraph.getparent().tag == W + 'body':
            paragraph.getparent().remove(paragraph)
    files['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='utf-8')
    if marker['policy'] in MODERN_POLICIES:
        files = enrich_v2(files, lms, snapshot['templateId'])
    files['demo/lms-result.json'] = json.dumps({
        'policy': marker['policy'], 'resultId': lms['resultId'], 'resultRevision': lms.get('resultRevision', 1),
        'profileVersionId': lms['profileVersionId'], 'legalForm': lms['legalForm'],
        'assessmentKind': lms['assessmentKind'], 'source': lms.get('source'),
        'signatureState': lms.get('signatureState', 'PREPARED'),
    }, ensure_ascii=False, sort_keys=True).encode('utf-8')
    return normalize_package(files)


def render_lms_document(snapshot, out, path):
    items = snapshot.get('items', [])
    if not 1 <= len(items) <= 10000:
        raise ValueError('LMS_DOCUMENT_ROW_LIMIT')
    files = render_lms_one(snapshot, items[0], path)
    policy = json.loads(files['demo/lms-form.json'])['policy']
    root = E.fromstring(files['word/document.xml'])
    body = root.find(W + 'body')
    section = body.find(W + 'sectPr')
    if section is not None:
        body.remove(section)
    for item in items[1:]:
        additional = render_lms_one(snapshot, item, path)
        additional_root = E.fromstring(additional['word/document.xml'])
        # Each participant owns a different QR and hyperlink; remap both when
        # making a multi-recipient derivative, including DrawingML r:embed.
        rel_ns = '{http://schemas.openxmlformats.org/package/2006/relationships}'
        doc_rel = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
        rels = E.fromstring(files['word/_rels/document.xml.rels'])
        other_rels = E.fromstring(additional['word/_rels/document.xml.rels'])
        for relation in other_rels:
            if not relation.get('Type', '').endswith(('/image', '/hyperlink')):
                continue
            old_id = relation.get('Id'); new_id = f'rIdLms{len(rels) + 1}'
            copied = deepcopy(relation); copied.set('Id', new_id)
            if relation.get('Type', '').endswith('/image'):
                old_target = relation.get('Target')
                target = f'media/lms-{len(files)}-{Path(old_target).name}'
                copied.set('Target', target)
                files['word/' + target] = additional['word/' + old_target]
            rels.append(copied)
            for node in additional_root.iter():
                for attribute in ['id', 'embed', 'link']:
                    if node.get(doc_rel + attribute) == old_id:
                        node.set(doc_rel + attribute, new_id)
        files['word/_rels/document.xml.rels'] = E.tostring(rels, xml_declaration=True, encoding='utf-8')
        nodes = [n for n in additional_root.find(W + 'body') if n.tag != W + 'sectPr']
        if nodes:
            first = nodes[0]
            props = first.find(W + 'pPr')
            if props is None:
                props = E.Element(W + 'pPr')
                first.insert(0, props)
            E.SubElement(props, W + 'pageBreakBefore')
        for node in nodes:
            body.append(deepcopy(node))
    if section is not None:
        body.append(section)
    files['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='utf-8')
    deterministic_zip(out, normalize_package(files))
    return {'format': 'DOCX', 'templateId': snapshot['templateId'], 'templateVersion': snapshot.get('templateVersion', 1), 'renderPolicy': policy, 'participants': len(items)}


def build_templates():
    """Author reproducible new immutable packages; no historical asset is touched."""
    from io import BytesIO
    from docx import Document
    from docx.enum.section import WD_ORIENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Mm, Pt, RGBColor

    result = []
    for template_id, titles in TEMPLATES.items():
        document = Document()
        section = document.sections[0]
        section.page_width, section.page_height = Mm(210), Mm(297)
        if template_id == 'lms-certificate':
            section.orientation = WD_ORIENT.LANDSCAPE
            section.page_width, section.page_height = Mm(297), Mm(210)
        if template_id == 'lms-credential':
            section.orientation = WD_ORIENT.LANDSCAPE
            section.page_width, section.page_height = Mm(210), Mm(148)
        margin = 16 if template_id == 'lms-credential' else 20
        section.left_margin = section.right_margin = Mm(margin)
        section.top_margin = section.bottom_margin = Mm(margin)
        normal = document.styles['Normal']
        normal.font.name = 'Liberation Serif'
        normal.font.size = Pt(10 if template_id == 'lms-credential' else 11)
        normal.paragraph_format.space_after = Pt(5)
        normal.paragraph_format.line_spacing = 1.05
        normal.font.color.rgb = RGBColor(0, 0, 0)
        title = document.styles['Title']
        title.font.name = 'Liberation Serif'
        title.font.size = Pt(18 if template_id == 'lms-credential' else 21)
        title.font.bold = True
        title.font.color.rgb = RGBColor(0, 0, 0)
        title.paragraph_format.space_after = Pt(5)
        # Word's stock Title style carries an accent-blue border and theme
        # font overrides. These new center forms use plain black titles.
        for style in [normal, title, document.styles['Title Char']]:
            for border in list(style.element.iter(W + 'pBdr')):
                border.getparent().remove(border)
            for fonts in style.element.iter(W + 'rFonts'):
                for name in list(fonts.attrib):
                    if 'theme' in E.QName(name).localname.lower():
                        del fonts.attrib[name]
                for name in ['ascii', 'hAnsi', 'eastAsia', 'cs']:
                    fonts.set(W + name, 'Liberation Serif')
        document.core_properties.author = 'Учебный центр'
        document.core_properties.last_modified_by = 'Учебный центр'
        document.core_properties.title = titles[0]
        document.core_properties.subject = CURRENT_POLICY
        document.core_properties.created = datetime(2026, 10, 15)
        document.core_properties.modified = datetime(2026, 10, 15)

        def paragraph(text, size=None, bold=False, center=False, style=None):
            p = document.add_paragraph(style=style)
            if center:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run(text)
            if size:
                run.font.size = Pt(size)
            run.bold = bold or style == 'Title'
            run.font.color.rgb = RGBColor(0, 0, 0)
            return p

        paragraph('{{SYNTHETIC}}', size=9, bold=True, center=True)
        paragraph('{{ISSUER}}', size=12, bold=True, center=True)
        paragraph(titles[0], center=True, style='Title')
        paragraph(titles[1], size=12, center=True)
        paragraph('№ {{NUMBER}} · {{DOCUMENT_DATE}}', center=True)
        paragraph('{{LEGAL_FORM}}', size=9, bold=True, center=True)
        if template_id == 'lms-protocol':
            paragraph('Программа / Бағдарлама', size=10, bold=True)
            paragraph('{{COURSE}}')
            paragraph('Объём / Көлемі {{HOURS}} ч. / сағ. · {{ASSESSMENT}}', size=10)
            table = document.add_table(rows=2, cols=3)
            table.autofit = False
            widths = [95, 32, 43]
            for index, column in enumerate(table.columns):
                column.width = Mm(widths[index])
            for row in table.rows:
                for index, cell in enumerate(row.cells):
                    cell.width = Mm(widths[index])
            for cell, text in zip(table.rows[0].cells, ['Слушатель / Тыңдаушы', 'Дата / Күні', 'Результат / Нәтиже']):
                cell.text = text
                for run in cell.paragraphs[0].runs:
                    run.bold = True
            for cell, text in zip(table.rows[1].cells, ['{{LEARNER}}\n{{POSITION}}\n{{EMPLOYER}}', '{{EXAM_DATE}}', '{{RESULT}}']):
                cell.text = text
            for cell in table._tbl.iter(W + 'tc'):
                props = cell.find(W + 'tcPr')
                borders = E.SubElement(props, W + 'tcBorders')
                for edge in ['top', 'left', 'bottom', 'right']:
                    E.SubElement(borders, W + edge, {W + 'val': 'single', W + 'sz': '4', W + 'color': 'D9D9D9'})
            paragraph('Источник результата / Нәтиже көзі', size=10, bold=True)
            paragraph('{{SOURCE}}', size=10)
        else:
            paragraph('{{LEARNER}}', size=14 if template_id == 'lms-credential' else 18, bold=True, center=True)
            if template_id == 'lms-certificate':
                paragraph('{{POSITION}} · {{EMPLOYER}}', size=10, center=True)
            paragraph('{{COURSE}}', size=12, center=True)
            paragraph('{{HOURS}} ч. / сағ. · {{EXAM_DATE}} · {{RESULT}}', size=10, center=True)
            paragraph('{{ASSESSMENT}}', size=10, center=True)
            paragraph('Источник / Дереккөз: {{SOURCE}}', size=9, center=True)
        footer = document.add_table(rows=1, cols=2)
        footer.autofit = False
        usable_width = (section.page_width - section.left_margin - section.right_margin) / 36000
        for cell, width in zip(footer.rows[0].cells, [usable_width - 32, 32]):
            cell.width = Mm(width)
        footer.rows[0].cells[0].text = '{{LEGAL_MEANING}}'
        footer.rows[0].cells[0].add_paragraph('{{REGULATORY}}')
        footer.rows[0].cells[0].add_paragraph('{{TRACE}}')
        footer.rows[0].cells[0].add_paragraph('QR_LINK')
        footer.rows[0].cells[1].text = 'QR_IMAGE'
        for cell in footer.rows[0].cells:
            for p in cell.paragraphs:
                p.paragraph_format.space_after = Pt(2)
                for run in p.runs: run.font.size = Pt(7)
        buffer = BytesIO()
        document.save(buffer)
        with ZipFile(BytesIO(buffer.getvalue())) as archive:
            files = {name: archive.read(name) for name in archive.namelist()}
        files['demo/lms-form.json'] = json.dumps({'policy': CURRENT_POLICY, 'templateId': template_id, 'version': 3, 'legalApproval': 'REQUIRED_BY_ISSUER'}, sort_keys=True).encode()
        path = ROOT / 'assets/templates' / f'{template_id}.v3.docx'
        deterministic_zip(path, normalize_package(files))
        with ZipFile(path) as archive:
            fields = sorted(set(re.findall(r'\{\{([A-Z_]+)\}\}', archive.read('word/document.xml').decode())))
            xml = E.fromstring(archive.read('word/document.xml'))
            sections = [dict(node.attrib) for node in xml.iter(W + 'pgSz')]
        result.append({'id': template_id, 'version': 3, 'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'fields': fields, 'sections': sections, 'languages': ['ru', 'kk'], 'photo': False, 'exports': ['DOCX', 'PDF'], 'ownerKind': 'INDIVIDUAL', 'protocolSemantics': None, 'legalApproval': 'REQUIRED_BY_ISSUER', 'renderPolicy': CURRENT_POLICY, 'formRevision': CURRENT_POLICY, 'verificationStatus': 'ENGINEERING_TEMPLATE_REQUIRES_RENDER_ACCEPTANCE'})
    (ROOT / 'assets/templates/lms-manifest.fragment.json').write_text(json.dumps({'specialTemplates': result}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    import sys
    if sys.argv[1:] == ['--build-templates']:
        print(json.dumps(build_templates(), ensure_ascii=False))
    else:
        raise SystemExit('Use --build-templates only when authoring new template versions')
