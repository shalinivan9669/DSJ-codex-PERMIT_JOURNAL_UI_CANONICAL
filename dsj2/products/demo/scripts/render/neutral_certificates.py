"""Layout repair for new NEUTRAL_FORMS_V1 certificate packages only.

Called on one filled recipient package before batch merging. Historical source
packages and their renderer are deliberately not changed by this module.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from lxml import etree as E
from PIL import ImageFont

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
WP = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
V = '{urn:schemas-microsoft-com:vml}'
ROOT = Path(__file__).resolve().parents[2]


def _child(parent, tag):
    node = parent.find(W + tag)
    if node is None:
        node = E.SubElement(parent, W + tag)
    return node


def _text(node):
    return ''.join(n.text or '' for n in node.iter(W + 't'))


def _p(value='', size=10, bold=False, align='left', before=0, after=3, color='000000'):
    p = E.Element(W + 'p')
    pr = E.SubElement(p, W + 'pPr')
    E.SubElement(pr, W + 'jc', {W + 'val': align})
    E.SubElement(pr, W + 'spacing', {W + 'before': str(round(before * 20)),
                                    W + 'after': str(round(after * 20)),
                                    W + 'line': '240', W + 'lineRule': 'auto'})
    E.SubElement(pr, W + 'ind', {W + 'left': '0', W + 'right': '0', W + 'firstLine': '0'})
    E.SubElement(pr, W + 'keepLines')
    r = E.SubElement(p, W + 'r')
    rp = E.SubElement(r, W + 'rPr')
    E.SubElement(rp, W + 'rFonts', {W + key: 'Liberation Serif' for key in ['ascii', 'hAnsi', 'eastAsia', 'cs']})
    for tag in ['sz', 'szCs']:
        E.SubElement(rp, W + tag, {W + 'val': str(round(size * 2))})
    E.SubElement(rp, W + 'spacing', {W + 'val': '0'})
    E.SubElement(rp, W + 'w', {W + 'val': '100'})
    E.SubElement(rp, W + 'color', {W + 'val': color})
    if bold:
        E.SubElement(rp, W + 'b')
    t = E.SubElement(r, W + 't')
    t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    t.text = str(value or '')
    return p


@lru_cache(maxsize=32)
def _font(size, bold=False):
    return ImageFont.truetype(str(ROOT / 'assets/fonts' / ('LiberationSerif-Bold.ttf' if bold else 'LiberationSerif-Regular.ttf')), round(size * 10))


def _lines(value, width, size, bold=False):
    """Conservative pinned-font bound; never truncate or shrink a field."""
    font = _font(size, bold)
    lines = 1
    line = ''
    for word in str(value or '').split():
        if font.getlength(word) / 10 > width:
            # Word and Writer can wrap a long identifier at character edges.
            for letter in word:
                if font.getlength(line + letter) / 10 > width:
                    lines += 1
                    line = ''
                line += letter
            continue
        candidate = (line + ' ' + word).strip()
        if line and font.getlength(candidate) / 10 > width:
            lines += 1
            line = word
        else:
            line = candidate
    return lines


def _box(box, geometry, paragraphs):
    x, y, width, height = geometry
    shape = next(n for n in box.iterancestors() if E.QName(n).localname in ['shape', 'anchor'])
    if shape.tag == WP + 'anchor':
        for tag, value in [('positionH', x), ('positionV', y)]:
            pos = shape.find(WP + tag)
            pos.set('relativeFrom', 'page')
            for child in list(pos):
                pos.remove(child)
            E.SubElement(pos, WP + 'posOffset').text = str(round(value * 12700))
        shape.find(WP + 'extent').set('cx', str(round(width * 12700)))
        shape.find(WP + 'extent').set('cy', str(round(height * 12700)))
        for extent in shape.iter(A + 'ext'):
            extent.set('cx', str(round(width * 12700)))
            extent.set('cy', str(round(height * 12700)))
        for node in shape.iter():
            if E.QName(node).localname == 'bodyPr':
                for key in ['lIns', 'rIns', 'tIns', 'bIns']:
                    node.set(key, '50800')
                node.set('anchor', 't')
                for child in list(node):
                    if E.QName(child).localname in ['normAutofit', 'spAutoFit']:
                        node.remove(child)
    else:
        style = dict(pair.split(':', 1) for pair in shape.get('style', '').split(';') if ':' in pair)
        style.update({'margin-left': f'{x}pt', 'margin-top': f'{y}pt', 'width': f'{width}pt', 'height': f'{height}pt'})
        shape.set('style', ';'.join(f'{k}:{v}' for k, v in style.items()))
        box.getparent().set('inset', '4pt,4pt,4pt,4pt')
    for child in list(box):
        box.remove(child)
    estimated_height = 8
    for value, size, bold, align in paragraphs:
        estimated_height += _lines(value, width - 12, size, bold) * size * 1.2 + 5
        box.append(_p(value, size, bold, align, after=5, color='595959'))
    if estimated_height > height:
        raise ValueError('NEUTRAL_CERTIFICATE_OVERFLOW:biot-itr-certificate:' + str(round(estimated_height)) + '>' + str(height))


def _itr(root, snapshot, item):
    from legacy_snapshot_fields import bilingual_parts, date_fields, frozen_date
    issuer = snapshot['issuer']
    assignment = item['assignment']
    ru, kz = bilingual_parts(assignment.get('trainingSubject'), assignment.get('trainingSubjectRu'), assignment.get('trainingSubjectKz'))
    name = item.get('issuedTo') or item.get('fullNameRu', '')
    chair = next(iter(issuer.get('commission', [])), {}).get('name', '')
    date = date_fields(frozen_date(assignment.get('documentDate'), 'documentDate'))['ruCertificate']
    counts = {'title': 0, 'name': 0, 'kz': 0, 'ru': 0, 'chair': 0, 'city': 0, 'number': 0}
    for box in root.iter(W + 'txbxContent'):
        text = _text(box)
        if text.strip() == 'Сертификат':
            key, geom, paragraphs = 'title', (150, 84, 650, 64), [('Сертификат', 34, False, 'center')]
        elif 'Настоящим удостоверяет' in text:
            key, geom, paragraphs = 'name', (125, 148, 683, 105), [('Настоящим удостоверяет в том, что', 13, False, 'center'), (name, 27, False, 'center')]
        elif 'курсы бойынша оқу бағдарламасын' in text:
            key, geom, paragraphs = 'kz', (125, 261, 318, 166), [('«' + (kz or ru).strip('«»') + '»', 19, False, 'left'), ('курсы бойынша оқу бағдарламасын сәтті аяқтады', 12, False, 'left')]
        elif 'Успешно закончил' in text:
            key, geom, paragraphs = 'ru', (482, 261, 326, 166), [('Успешно закончил(а) программу обучения по курсу', 12, False, 'left'), ('«' + ru.strip('«»') + '»', 19, False, 'left')]
        elif 'Председатель комиссии' in text:
            key, geom, paragraphs = 'chair', (125, 433, 445, 64), [('Комиссия төрағасы, қолы / Председатель комиссии, подпись', 12, False, 'left'), ('______________  ' + chair, 13, False, 'left')]
        elif 'город:' in text:
            key, geom, paragraphs = 'city', (125, 510, 362, 65), [('Қала / город: ' + str(issuer.get('cityRu', '')), 13, False, 'left'), (date, 13, False, 'left')]
        elif 'Рег. №' in text:
            key, geom, paragraphs = 'number', (515, 510, 293, 65), [('Тіркеу № / Рег. №', 13, False, 'left'), (item.get('number', ''), 13, False, 'left')]
        else:
            continue
        counts[key] += 1
        _box(box, geom, paragraphs)
    if any(n not in [1, 2] for n in counts.values()):
        raise ValueError('NEUTRAL_CERTIFICATE_TEMPLATE_CONTRACT:' + str(counts))
    issuer_label = ' / '.join(dict.fromkeys(str(issuer.get(key, '')).strip() for key in ['nameRu', 'nameKz'] if issuer.get(key)))
    if _lines(issuer_label, 425, 11) * 13.2 + 8 > 58:
        raise ValueError('NEUTRAL_CERTIFICATE_OVERFLOW:biot-itr-certificate:issuer')
    anchor = root.find(W + 'body').find(W + 'p')
    run = E.SubElement(anchor, W + 'r')
    pict = E.SubElement(run, W + 'pict')
    shape = E.SubElement(pict, V + 'rect', id='NeutralCertificateIssuerV1', filled='f', stroked='f',
        style='position:absolute;margin-left:150pt;margin-top:20pt;width:437pt;height:58pt;z-index:251666000;mso-position-horizontal-relative:page;mso-position-vertical-relative:page')
    issuer_box = E.SubElement(E.SubElement(shape, V + 'textbox', inset='4pt,4pt,4pt,4pt'), W + 'txbxContent')
    issuer_box.append(_p(issuer_label, 11, after=0, color='595959'))
    # Sanitizing a source DrawingML picture leaves an inline neutral label.
    # Restore the original logo's upper-right region with editable text.
    for t in list(root.iter(W + 't')):
        if (t.text or '').strip() != 'ЛОГОТИП':
            continue
        run = t.getparent()
        if run.tag != W + 'r' or run.getparent().getparent().tag != W + 'body':
            continue
        for child in list(run):
            run.remove(child)
        pict = E.SubElement(run, W + 'pict')
        shape = E.SubElement(pict, V + 'rect', id='NeutralCertificateLogoV1',
            strokecolor='#999999', strokeweight='0.6pt', fillcolor='#ffffff',
            style='position:absolute;margin-left:602pt;margin-top:24pt;width:180pt;height:43pt;z-index:251666000;mso-position-horizontal-relative:page;mso-position-vertical-relative:page')
        box = E.SubElement(E.SubElement(shape, V + 'textbox', inset='4pt,12pt,4pt,4pt'), W + 'txbxContent')
        box.append(_p('ЛОГОТИП', 11, align='center', after=0, color='69737D'))


def _stamp():
    """Inline neutral placeholder, with no image, seal imitation or signature."""
    table = E.Element(W + 'tbl')
    pr = E.SubElement(table, W + 'tblPr')
    E.SubElement(pr, W + 'tblW', {W + 'w': '1660', W + 'type': 'dxa'})
    E.SubElement(pr, W + 'tblLayout', {W + 'type': 'fixed'})
    borders = E.SubElement(pr, W + 'tblBorders')
    for side in ['top', 'left', 'bottom', 'right']:
        E.SubElement(borders, W + side, {W + 'val': 'single', W + 'sz': '5', W + 'color': 'A0A7AD'})
    grid = E.SubElement(table, W + 'tblGrid')
    E.SubElement(grid, W + 'gridCol', {W + 'w': '1660'})
    row = E.SubElement(table, W + 'tr')
    rp = E.SubElement(row, W + 'trPr')
    E.SubElement(rp, W + 'cantSplit')
    E.SubElement(rp, W + 'trHeight', {W + 'val': '850', W + 'hRule': 'atLeast'})
    cell = E.SubElement(row, W + 'tc')
    cp = E.SubElement(cell, W + 'tcPr')
    E.SubElement(cp, W + 'tcW', {W + 'w': '1660', W + 'type': 'dxa'})
    E.SubElement(cp, W + 'vAlign', {W + 'val': 'center'})
    cell.append(_p('МЕСТО ДЛЯ ПЕЧАТИ', 8, align='center', after=0, color='69737D'))
    return table


def _results(kz, result):
    table = E.Element(W + 'tbl')
    pr = E.SubElement(table, W + 'tblPr')
    E.SubElement(pr, W + 'tblW', {W + 'w': '5100', W + 'type': 'dxa'})
    E.SubElement(pr, W + 'tblLayout', {W + 'type': 'fixed'})
    grid = E.SubElement(table, W + 'tblGrid')
    for width in [3440, 1660]:
        E.SubElement(grid, W + 'gridCol', {W + 'w': str(width)})
    labels = ['Пәндердің атауы', 'Жалпы кәсіби', 'Арнайы мамандырылған', 'Емтихан'] if kz else ['Наименование дисциплин', 'Общепрофессиональные', 'Специальные', 'Экзамен']
    for i, label in enumerate(labels):
        row = E.SubElement(table, W + 'tr')
        E.SubElement(E.SubElement(row, W + 'trPr'), W + 'cantSplit')
        for value, width in [(label, 3440), (('Бағалары' if kz else 'Оценка') if i == 0 else result, 1660)]:
            cell = E.SubElement(row, W + 'tc')
            cp = E.SubElement(cell, W + 'tcPr')
            E.SubElement(cp, W + 'tcW', {W + 'w': str(width), W + 'type': 'dxa'})
            borders = E.SubElement(cp, W + 'tcBorders')
            E.SubElement(borders, W + 'bottom', {W + 'val': 'single', W + 'sz': '4', W + 'color': '909090'})
            cell.append(_p(value, 9 if i == 0 else 10, bold=i > 0 and width == 1660, after=2))
    return table


def _witness(root, snapshot, item):
    from legacy_snapshot_fields import build_legacy_payload, date_fields, frozen_date, training_date_fields
    assignment = item['assignment']
    issuer = snapshot['issuer']
    dates = {key: date_fields(frozen_date(assignment.get(key, assignment.get('documentDate')) if key == 'protocolDate' else assignment.get(key), key))
             for key in ['documentDate', 'protocolDate']}
    dates.update({key: training_date_fields(assignment.get(key), key)
                  for key in ['trainingStart', 'trainingEnd']})
    # Reuse the existing outcome authority: FAILED/ABSENT/UNKNOWN must never
    # regain an imported positive label when geometry is rebuilt.
    payload = build_legacy_payload(snapshot, item)
    source_values = {r['matchText']: r['replaceText'] for r in payload['sourceLiteralValues']}
    results = source_values.get('Хорошо', 'Хорошо'), source_values.get('Жақсы', 'Жақсы')
    profession_ru = assignment.get('psQualificationRu') or assignment.get('psQualificationKz') or assignment.get('professionRu') or assignment.get('professionKz') or item.get('positionRu', '')
    profession_kz = assignment.get('psQualificationKz') or assignment.get('psQualificationRu') or assignment.get('professionKz') or assignment.get('professionRu') or item.get('positionKz') or profession_ru
    candidates = [t for t in root.find(W + 'body').findall(W + 'tbl') if 'Кәсіптік білім даярлау туралы' in _text(t)]
    if len(candidates) != 1:
        raise ValueError('NEUTRAL_WITNESS_TEMPLATE_CONTRACT')
    table = candidates[0]
    cells = table.find(W + 'tr').findall(W + 'tc')
    if len(cells) != 2:
        raise ValueError('NEUTRAL_WITNESS_COLUMNS_CONTRACT')
    _child(table.find(W + 'tr'), 'trPr').append(E.Element(W + 'cantSplit'))
    for idx, cell in enumerate(cells):
        kz = idx == 0
        for child in list(cell):
            if child.tag != W + 'tcPr':
                cell.remove(child)
        cp = _child(cell, 'tcPr')
        _child(cp, 'vAlign').set(W + 'val', 'top')
        for tag in ['tcFitText', 'noWrap']:
            for node in cp.findall(W + tag):
                cp.remove(node)
        profession = profession_kz if kz else profession_ru
        name = item.get('fullNameKz') or item.get('fullNameRu', '') if kz else item.get('fullNameRu', '')
        org = issuer.get('nameKz') or issuer.get('nameRu', '') if kz else issuer.get('nameRu', '')
        protocol = item.get('protocolNumber') or item.get('numbers', {}).get('protocol') or assignment.get('externalBasisNumber', '')
        fmt = lambda key: (dates[key]['day'] + ' ' + dates[key]['monthKz' if kz else 'monthRu'] + ' ' + dates[key]['year'] + (' ж.' if kz else ' г.')) if dates[key]['year'] else ''
        content = [
            ('Кәсіптік білім даярлау туралы\nКУӘЛІК' if kz else 'СВИДЕТЕЛЬСТВО\nо профессиональной подготовке', 12, True, 'center', 6),
            ('КБ № ' + item.get('number', ''), 11, True, 'center', 12),
            (('Осы куәлік: ' if kz else 'Настоящее свидетельство выдано: ') + name, 10, False, 'left', 3),
            ('тегі, аты, әкесінің аты (болған жағдайда)' if kz else 'фамилия, имя, отчество (при его наличии)', 8, False, 'center', 7),
            ((fmt('trainingStart') + ' бастап ' + fmt('trainingEnd') + ' дейін оқып,') if kz else ('в том, что он(-а) обучался(-ась) с ' + fmt('trainingStart') + ' по ' + fmt('trainingEnd')), 10, False, 'left', 4),
            (org, 10, False, 'center', 3),
            ('(білім беру ұйымының толық атауы)' if kz else '(полное наименование организации образования)', 8, False, 'center', 6),
            ((dates['trainingEnd']['year'] + ' жылы ' + profession + ' кәсібі бойынша толық курсын бітіріп шықты және кәсіптік оқудың толық курсын бітіргеннен кейін мынадай білімін көрсетті:') if kz else ('и в ' + dates['trainingEnd']['year'] + ' году окончил(-а) полный курс по профессии ' + profession + ' и по окончании полного курса профессионального обучения показал(-а) следующие знания:'), 10, False, 'left', 6),
        ]
        estimated = 0
        for value, size, bold, align, after in content:
            # Explicit line breaks retain source two-line headings.
            p = _p('', size, bold, align, after=after)
            run = p.find(W + 'r')
            run.remove(run.find(W + 't'))
            for i, line in enumerate(value.split('\n')):
                if i:
                    E.SubElement(run, W + 'br')
                E.SubElement(run, W + 't').text = line
                estimated += _lines(line, 253, size, bold) * size * 1.2
            estimated += after
            cell.append(p)
        result = results[1] if kz else results[0]
        cell.append(_results(kz, result))
        estimated += 4 * max(12, _lines(result, 75, 10, True) * 12) + 14
        qualification = ('Біліктілік комиссиясының ' + fmt('protocolDate') + ' № ' + protocol + ' хаттама шешімімен оған ' + profession + ' біліктілігі берілді.') if kz else ('Решением квалификационной комиссии от ' + fmt('protocolDate') + ' № протокола ' + protocol + ' ему (ей) присвоена квалификация ' + profession + '.')
        bottom = [
            (qualification, 6, 10),
            ('Директор  _______________  ' + str(issuer.get('headName', '')), 9, 9),
            ((str(issuer.get('cityKz', '')) + ' қаласы') if kz else ('город ' + str(issuer.get('cityRu', ''))), 0, 5),
            (fmt('documentDate'), 0, 5),
            (('Тіркеу нөмірі № ' if kz else 'Регистрационный номер № ') + str(item.get('registrationNumber', '')), 0, 9),
        ]
        for value, before, after in bottom:
            cell.append(_p(value, 10, before=before, after=after))
            estimated += _lines(value, 253, 10) * 12 + before + after
        cell.append(_stamp())
        cell.append(_p('', 1, after=0))
        estimated += 48
        if estimated > 720:
            raise ValueError('NEUTRAL_CERTIFICATE_OVERFLOW:ps-witness:' + ('KZ' if kz else 'RU'))


def repair_certificate_files(files: dict[str, bytes], snapshot: dict) -> dict[str, bytes]:
    template_id = snapshot.get('templateId')
    if template_id not in ['biot-itr-certificate', 'ps-witness']:
        return files
    if len(snapshot.get('items', [])) != 1:
        raise ValueError('NEUTRAL_CERTIFICATE_SINGLE_RECIPIENT_REQUIRED')
    result = dict(files)
    root = E.fromstring(files['word/document.xml'])
    (_itr if template_id == 'biot-itr-certificate' else _witness)(root, snapshot, snapshot['items'][0])
    result['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='utf-8')
    return result
