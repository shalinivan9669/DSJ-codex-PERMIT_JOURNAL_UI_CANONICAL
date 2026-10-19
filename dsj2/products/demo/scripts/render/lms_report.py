"""Snapshot reports use the existing pinned OOXML -> LibreOffice conversion boundary.

Only one JSONL row and XML table row are retained while authoring. The converter
has the shared worker timeout/output limits. No report acquires an issuance,
number, signature, or authority to download an original document.
"""
import json
import tempfile
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
SUMMARY_LABELS = {
    'participants': ('Участники', 'Қатысушылар'), 'accounts': ('Связанные учебные записи', 'Байланысқан оқу тіркелгілері'),
    'organizations': ('Организации', 'Ұйымдар'), 'activeAssignments': ('Активные назначения', 'Белсенді тағайындаулар'),
    'completedAssignments': ('Завершённые назначения', 'Аяқталған тағайындаулар'), 'attempts': ('Отправленные / завершённые попытки', 'Жіберілген / аяқталған талпыныстар'),
    'passedAttempts': ('Успешные попытки', 'Сәтті талпыныстар'), 'issuedDocuments': ('Выданные документы, включая историю', 'Берілген құжаттар, тарихымен'),
    'validDocuments': ('Действующие документы', 'Жарамды құжаттар'), 'expiringDocuments': ('Истекают в течение 30 дней', '30 күн ішінде аяқталады'),
    'voidedDocuments': ('Аннулированные документы', 'Күші жойылған құжаттар'), 'supersededDocuments': ('Заменённые документы', 'Ауыстырылған құжаттар'),
    'unknownValidity': ('Выданы, срок неизвестен', 'Берілген, мерзімі белгісіз'),
}


def sub(parent, name, **attrs):
    return E.SubElement(parent, '{%s}%s' % (W, name), {'{%s}%s' % (W, k): str(v) for k, v in attrs.items()})


def paragraph(text, bold=False, size=20):
    p = E.Element('{%s}p' % W)
    props = sub(p, 'pPr')
    sub(props, 'spacing', before=0, after=60)
    run = sub(p, 'r')
    style = sub(run, 'rPr')
    sub(style, 'rFonts', ascii='Liberation Sans', hAnsi='Liberation Sans', cs='Liberation Sans')
    sub(style, 'sz', val=size)
    if bold:
        sub(style, 'b')
    t = sub(run, 't')
    t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    t.text = str(text if text is not None else '')
    return p


def table_row(values, widths, header=False):
    tr = E.Element('{%s}tr' % W)
    props = sub(tr, 'trPr')
    sub(props, 'cantSplit')
    if header:
        sub(props, 'tblHeader')
    for value, width in zip(values, widths):
        cell = sub(tr, 'tc')
        cp = sub(cell, 'tcPr')
        sub(cp, 'tcW', w=width, type='dxa')
        sub(cp, 'vAlign', val='top')
        if header:
            sub(cp, 'shd', fill='E0ECEC')
        margins = sub(cp, 'tcMar')
        for side in ['top', 'bottom', 'left', 'right']:
            sub(margins, side, w=70, type='dxa')
        cell.append(paragraph(value, header))
    return tr


def render_lms_report(payload, out, convert_pdf):
    columns = payload['columns']
    if not 1 <= len(columns) <= 12:
        raise ValueError('REPORT_COLUMNS_LIMIT')
    kz = payload.get('language') == 'kz'
    width = 22000
    weights = [float(c.get('width', 1)) for c in columns]
    widths = [int(width * w / sum(weights)) for w in weights]
    widths[-1] += width - sum(widths)
    count = 0
    with tempfile.TemporaryDirectory(prefix='demo-lms-report-ooxml-') as temp:
        xml = Path(temp) / 'document.xml'
        with E.xmlfile(str(xml), encoding='UTF-8') as stream:
            stream.write_declaration(standalone=True)
            with stream.element('{%s}document' % W, nsmap={'w': W, 'r': R}):
                with stream.element('{%s}body' % W):
                    stream.write(paragraph(payload['title'], True, 32))
                    stream.write(paragraph(payload['definition'], size=20))
                    stream.write(paragraph(('Кесінді: ' if kz else 'Срез: ') + payload['snapshotAt'] + ' | ' + payload['timezone']))
                    stream.write(paragraph(('Жолдар: ' if kz else 'Строк: ') + str(payload['totalRows'])))
                    stream.write(paragraph('Есептік кесінді. Заңды құжат немесе қолтаңба емес.' if kz else 'Отчётный срез. Не является юридическим документом или подписью.', size=18))
                    # Separate bounded tables avoid LibreOffice's nonlinear layout of
                    # one large table, while every table still repeats its header.
                    with Path(payload['itemsFile']).open(encoding='utf8') as source:
                        line = source.readline()
                        while line or count == 0:
                            with stream.element('{%s}tbl' % W):
                                props = E.Element('{%s}tblPr' % W)
                                sub(props, 'tblW', w=width, type='dxa')
                                sub(props, 'tblLayout', type='fixed')
                                borders = sub(props, 'tblBorders')
                                for edge in ['top', 'bottom', 'left', 'right', 'insideH', 'insideV']:
                                    sub(borders, edge, val='single', sz=3, color='B4C7CA')
                                stream.write(props)
                                grid = E.Element('{%s}tblGrid' % W)
                                for w in widths:
                                    sub(grid, 'gridCol', w=w)
                                stream.write(grid)
                                stream.write(table_row([c['title'] for c in columns], widths, True))
                                if not line:
                                    stream.write(table_row(['Деректер жоқ' if kz else 'Нет данных'] + [''] * (len(columns) - 1), widths))
                                    break
                                for _ in range(200):
                                    if not line:
                                        break
                                    row = json.loads(line)
                                    stream.write(table_row([row.get(c['field'], '') for c in columns], widths))
                                    count += 1
                                    line = source.readline()
                            if line:
                                stream.write(paragraph('', size=2))
                    if count != payload['totalRows']:
                        raise ValueError('REPORT_SNAPSHOT_INCOMPLETE')
                    stream.write(paragraph('Таңдалған тағайындаулардың жиынтығы' if kz else 'Сводка выбранных назначений', True))
                    for key, value in payload.get('summary', {}).items():
                        if key in SUMMARY_LABELS:
                            stream.write(paragraph(SUMMARY_LABELS[key][1 if kz else 0] + ': ' + str(value), size=18))
                    filter_labels = {'search': ('Поиск', 'Іздеу'), 'bin': ('БИН', 'БСН'), 'city': ('Город', 'Қала'), 'dateFrom': ('Период с', 'Кезеңнің басы'), 'dateTo': ('Период по', 'Кезеңнің соңы'), 'dueFrom': ('Срок с', 'Мерзімнің басы'), 'dueTo': ('Срок по', 'Мерзімнің соңы')}
                    selected = {filter_labels[key][1 if kz else 0]: value for key, value in payload.get('filters', {}).items() if key in filter_labels and value not in ['', None]}
                    if selected:
                        stream.write(paragraph('; '.join(str(key) + ': ' + str(value) for key, value in selected.items()), size=16))
                    # A3 landscape leaves readable 10 pt text even in the nine-column test report.
                    sect = E.Element('{%s}sectPr' % W)
                    footer_ref = sub(sect, 'footerReference', type='default')
                    footer_ref.set('{%s}id' % R, 'rIdFooter')
                    sub(sect, 'pgSz', w=23811, h=16838, orient='landscape')
                    sub(sect, 'pgMar', top=850, bottom=850, left=850, right=850, header=300, footer=300, gutter=0)
                    stream.write(sect)
        docx = Path(temp) / 'report.docx'
        with ZipFile(docx, 'w', ZIP_DEFLATED) as archive:
            archive.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footer.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>')
            archive.writestr('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
            archive.write(xml, 'word/document.xml')
            archive.writestr('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer.xml"/></Relationships>')
            footer = E.Element('{%s}ftr' % W, nsmap={'w': W})
            p = paragraph('Бет ' if kz else 'Страница ', size=18)
            sub(p.find('{%s}pPr' % W), 'jc', val='right')
            field = sub(p, 'fldSimple', instr='PAGE')
            sub(sub(field, 'r'), 't').text = '1'
            footer.append(p)
            archive.writestr('word/footer.xml', E.tostring(footer, xml_declaration=True, encoding='UTF-8', standalone=True))
        result = convert_pdf(docx, out)
    return {**result, 'rows': count, 'purpose': 'REPORT_SNAPSHOT', 'snapshotAt': payload['snapshotAt'], 'columns': [c['title'] for c in columns]}
