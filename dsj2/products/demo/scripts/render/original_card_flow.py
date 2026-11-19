"""Flow the live fields inside the original SOL card frames."""
from copy import deepcopy
import re

from lxml import etree as E

from source_fidelity import W, cached_font, child, measure


def _paragraph(segments, *, inset=0, top=0, align='left', right=4):
    paragraph = E.Element(W + 'p')
    props = E.SubElement(paragraph, W + 'pPr')
    E.SubElement(props, W + 'spacing', {W+'before': str(round(top*20)), W+'after': '0',
                                        W+'line': '240', W+'lineRule': 'auto'})
    E.SubElement(props, W + 'ind', {W+'left': str(round(inset*20)), W+'right': str(round(right*20)),
                                    W+'firstLine': '0'})
    E.SubElement(props, W + 'jc', {W+'val': align})
    runs = []
    for value, size, style in segments:
        run = E.SubElement(paragraph, W+'r')
        run_props = E.SubElement(run, W+'rPr')
        E.SubElement(run_props, W+'rFonts', {W+'ascii': 'Times New Roman', W+'hAnsi': 'Times New Roman'})
        if style == 'bold':
            E.SubElement(run_props, W+'b')
        if style == 'underline':
            E.SubElement(run_props, W+'u', {W+'val': 'single'})
        for tag in ('sz','szCs'):
            E.SubElement(run_props, W+tag, {W+'val': str(round(size*2))})
        node = E.SubElement(run, W+'t', {'{http://www.w3.org/XML/1998/namespace}space':'preserve'})
        node.text = value
        if '{{' in value:
            runs.append((run, size))
    return {'node': paragraph, 'dynamic': [run for run, size in runs], 'sizes': dict(runs)}


def _pb_face(state, fields, photo_beside_name):
    from archive_forms import _fill
    box = state['box']
    workplace = '{{WORKPLACE_RU}}' if fields['WORKPLACE_RU'] == fields['WORKPLACE_KZ'] else '{{WORKPLACE_BOTH}}'
    position = '{{POSITION_RU}}' if fields['POSITION_RU'] == fields['POSITION_KZ'] else '{{POSITION_BOTH}}'
    rows = [
        _paragraph([('КУӘЛІК / УДОСТОВЕРЕНИЕ № {{NUMBER}}', 9, 'bold')], inset=22, top=6, align='center'),
        _paragraph([('Берілді / Выдано: ', 7, ''), ('{{FULL_NAME_RU}}', 10, 'bold')],
                   inset=96 if photo_beside_name else 22, top=3),
        _paragraph([('Жұмыс орны / Место работы', 6.5, '')], inset=96, top=3),
        _paragraph([(workplace, 8.5, '')], inset=96),
        _paragraph([('Лауазымы / Должность', 6.5, '')], inset=96, top=2),
        _paragraph([(position, 8.5, '')], inset=96),
        _paragraph([('Күні / Дата: ', 6.5, ''), ('{{DOCUMENT_DATE}}', 8, '')], inset=96, top=2),
        _paragraph([('Курсын тыңдады / Прослушал(а) курс', 6.5, '')], inset=96, top=2),
        _paragraph([('{{SUBJECT_BOTH}}', 8.5, '')], inset=96),
        _paragraph([('Оқу орталығы / Учебный центр', 6.5, '')], inset=96, top=2),
        _paragraph([('{{ISSUER_BOTH}}', 8.5, '')], inset=96),
    ]
    # A long statutory course title can use the full height beside the photo.
    # Pair short labels and values when the normal column exceeds the actual
    # text box. Preserve the complete course and both translations.
    used = 0
    for row in rows:
        sample = deepcopy(row['node'])
        _fill(sample, fields)
        used += measure(sample, state['width'], state['typography'])[0]
    if used > state['height'] - 10:
        rows = [
            rows[0], rows[1],
            _paragraph([('Жұмыс орны / Место работы: ', 7, ''), (workplace, 8, '')], inset=96, top=1),
            _paragraph([('Лауазымы / Должность: ', 7, ''), (position, 8, '')], inset=96, top=1),
            _paragraph([('Курсын тыңдады / Прослушал(а) курс  ', 6.5, ''),
                        ('{{DOCUMENT_DATE}}', 8, '')], inset=96, top=1),
            _paragraph([('{{SUBJECT_BOTH}}', 8, '')], inset=96),
            _paragraph([('Оқу орталығы / Учебный центр', 6.5, '')], inset=96, top=1),
            _paragraph([('{{ISSUER_BOTH}}', 8, '')], inset=96),
        ]
    for paragraph in box.findall(W+'p'):
        box.remove(paragraph)
    for row in rows:
        box.append(row['node'])
    state['paragraphs'] = rows


def _ptm_head(state):
    paragraphs = state['paragraphs']
    for index, item in enumerate(paragraphs[:-1]):
        original = item['node']
        if '{{HEAD_NAME}}' not in ''.join(original.itertext()):
            continue
        caption = paragraphs[index+1]['node']
        if 'Руководитель учебного центра' not in ''.join(caption.itertext()):
            raise ValueError('ORIGINAL_CARD_SLOT_MISMATCH')
        rows = [
            _paragraph([('Оқу орталығының басшысы / Руководитель учебного центра', 7, '')], inset=3, top=2),
            _paragraph([('Қолы / Подпись: __________', 7, '')], inset=3, top=1),
            _paragraph([('Т.А.Ә. / Ф.И.О.: ', 7, ''), ('{{HEAD_NAME}}', 9, 'bold')], inset=3, top=1),
        ]
        for row in rows:
            original.addprevious(row['node'])
        for node in [original, caption]:
            node.getparent().remove(node)
        paragraphs[index:index+2] = rows
        break


def arrange_card_fields(layout, template_id, fields, *, photo_beside_name=False):
    for state in layout:
        combined = ''.join(state['box'].itertext())
        if template_id == 'pb-card' and '{{FULL_NAME_RU}}' in combined and '{{POSITION_BOTH}}' in combined:
            _pb_face(state, fields, photo_beside_name)
        elif template_id == 'ptm-card' and '{{HEAD_NAME}}' in combined:
            _ptm_head(state)


def fit_biot_worker_issuer_bands(tree, issuer):
    # The two front bands have a space inset. The single reverse band is
    # anchored to the same wide table, but starts left of its own cut line.
    for cell in tree.findall('./' + W+'body/' + W+'tbl/' + W+'tr/' + W+'tc'):
        paragraph = cell.find(W+'p')
        if paragraph is None:
            continue
        tokens = paragraph.findall('./' + W+'r/' + W+'t')
        text = ''.join(token.text or '' for token in tokens)
        if text.strip() != '{{ISSUER_BOTH}}':
            continue
        token = next(token for token in tokens if (token.text or '').strip())
        run = token.getparent()
        if text.startswith(' '):
            available = 209  # From the specimen's inset to the centre fold, less 12 pt.
        else:
            # Insert the inset in the text run, leaving the floating drawing's anchor alone.
            tabs = child(child(paragraph, 'pPr'), 'tabs')
            E.SubElement(tabs, W+'tab', {W+'val': 'left', W+'pos': '360'})
            token.addprevious(E.Element(W+'tab'))
            available = 262
        props = run.find(W+'rPr')
        size = int(props.find(W+'sz').get(W+'val')) / 2
        measured = cached_font('LiberationSerif-Regular.ttf', round(size * 10)).getlength(issuer) / 10
        if measured > available:
            child(props, 'w').set(W+'val', str(max(1, int(100 * available / measured))))


def fit_issuer_bands(tree, issuer, *, bilingual_issuer=None):
    # The specimen's grey rectangle extends past both card borders. Disable
    # its paint in Word and in the VML fallback, preserving all anchor geometry.
    vml = '{urn:schemas-microsoft-com:vml}'
    drawing = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
    alternate = '{http://schemas.openxmlformats.org/markup-compatibility/2006}AlternateContent'
    for shape in tree.iter(vml+'rect'):
        style = dict(re.findall(r'(?:^|;)\s*([^:;]+):([^;]*)', shape.get('style', '')))
        if (not shape.get('fillcolor', '').lower().startswith('#d8d8d8')
                or not re.fullmatch(r'[\d.]+pt', style.get('width', ''))
                or not re.fullmatch(r'[\d.]+pt', style.get('height', ''))
                or not (float(style['width'][:-2]) > 350 and 0 < float(style['height'][:-2]) <= 12)
                or shape.find('.//'+W+'txbxContent') is not None):
            continue
        fill = shape.find(vml+'fill')
        if fill is None:
            fill = E.SubElement(shape, vml+'fill')
        fill.set('on', 'f')
        choice = next(shape.iterancestors(alternate), None)
        if choice is not None:
            for paint in choice.findall('.//{*}spPr/'+drawing+'solidFill'):
                paint.clear()
                paint.tag = drawing+'noFill'
    for paragraph in tree.iter(W+'p'):
        nodes = [node for node in paragraph.iter(W+'t') if next(node.iterancestors(W+'p'), None) is paragraph]
        cell = next(paragraph.iterancestors(W+'tc'), None)
        if cell is None or next(paragraph.iterancestors(W+'txbxContent'), None) is not None:
            continue
        text = ''.join(node.text or '' for node in nodes).strip()
        dual = text == '{{ISSUER_BOTH}}'
        if not dual and text.count('{{ISSUER_RU}}') < 4:
            continue
        width = int(cell.find(W+'tcPr/'+W+'tcW').get(W+'w')) / 20
        available = width/2 - 56
        font = cached_font('LiberationSerif-Regular.ttf', 50)
        for node in nodes:
            node.text = ''
        for tab in list(paragraph.iter(W+'tab')):
            if tab.getparent().tag == W+'r' and next(tab.iterancestors(W+'p'), None) is paragraph:
                tab.getparent().remove(tab)
        props = child(paragraph, 'pPr')
        child(props, 'ind').attrib.update({W+'left': '0', W+'right': '0', W+'firstLine': '0'})
        child(props, 'jc').set(W+'val', 'left')
        stops = child(props,'tabs')
        stops.clear()
        for fraction in (0.25, 0.75):
            E.SubElement(stops,W+'tab',{W+'val':'center',W+'pos':str(round(width*fraction*20))})
        run = E.SubElement(paragraph, W+'r')
        run_props = E.SubElement(run, W+'rPr')
        E.SubElement(run_props, W+'rFonts', {W+'ascii':'Times New Roman',W+'hAnsi':'Times New Roman'})
        E.SubElement(run_props, W+'color', {W+'val':'0070C0'})
        measured = font.getlength((bilingual_issuer or issuer) if dual else issuer)/10
        if measured > available:
            E.SubElement(run_props, W+'w', {W+'val': str(max(1, int(100*available/measured)))})
        E.SubElement(run_props, W+'sz', {W+'val':'10'})
        for _ in range(2):
            E.SubElement(run,W+'tab')
            E.SubElement(run,W+'t').text = '{{ISSUER_BOTH}}' if dual else '{{ISSUER_RU}}'
