"""Flow-layout repairs for the new neutral versions of the four legacy cards.

The source panels, page order, repeat-examination sides and data remain the
authority.  Only their floating containers are replaced by ordinary Word cells.
This pass must run once per filled recipient, before mail-merge assembly.  The
historical reference policy never calls it.
"""
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from datetime import date
import math
import re

from lxml import etree as E
from PIL import ImageFont

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
NS = {'w': W[1:-1], 'mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
      'v': 'urn:schemas-microsoft-com:vml'}
CARDS = {'biot-worker-card', 'ptm-card', 'pb-card', 'ps-card'}
PANEL_WIDTH = 5260
INNER_WIDTH = PANEL_WIDTH - 240
FONT_SIZE = 9
LINE_HEIGHT = 10.5


def _node(parent, name, **attrs):
    return E.SubElement(parent, W + name, {W + k: str(v) for k, v in attrs.items()})


@lru_cache(maxsize=8)
def _font(size, bold=False):
    path = Path(__file__).resolve().parents[2] / 'assets/fonts' / ('LiberationSerif-Bold.ttf' if bold else 'LiberationSerif-Regular.ttf')
    return ImageFont.truetype(str(path), round(size * 10))


def _lines(text, width, size=FONT_SIZE, bold=False):
    """Conservative width guard, including unbroken numbers and Kazakh glyphs."""
    font = _font(size, bold)
    limit = width / 20 * 10 / 1.08
    count, line = 1, ''
    for word in text.split():
        if font.getlength(word) > limit:
            # Word can break long tokens; explicitly account for that width.
            if line:
                count += 1
                line = ''
            count += max(0, math.ceil(font.getlength(word) / limit) - 1)
            line = word[-max(1, int(len(word) * limit / font.getlength(word))):]
        elif line and font.getlength(line + ' ' + word) > limit:
            count += 1
            line = word
        else:
            line = (line + ' ' + word).strip()
    return count


def _paragraph(text='', bold=False, center=False, size=FONT_SIZE, line=False):
    p = E.Element(W + 'p')
    pr = _node(p, 'pPr')
    _node(pr, 'spacing', before=0, after=20, line=210, lineRule='auto')
    _node(pr, 'jc', val='center' if center else 'left')
    _node(pr, 'widowControl', val=0)
    _node(pr, 'keepLines')
    if line:
        borders = _node(pr, 'pBdr')
        _node(borders, 'bottom', val='single', sz=4, color='777777', space=1)
    run = _node(p, 'r')
    rpr = _node(run, 'rPr')
    _node(rpr, 'rFonts', ascii='Liberation Serif', hAnsi='Liberation Serif', eastAsia='Liberation Serif', cs='Liberation Serif')
    if bold:
        _node(rpr, 'b')
    _node(rpr, 'sz', val=round(size * 2))
    _node(rpr, 'szCs', val=round(size * 2))
    _node(rpr, 'lang', val='ru-RU', eastAsia='kk-KZ')
    _node(run, 't').text = text
    return p


def _text(p):
    return re.sub(r'\s+', ' ', ''.join(p.itertext()) if p.tag == W + 't' else ''.join(p.xpath('.//w:t/text()', namespaces=NS))).strip()


def _panel(box):
    """Retain every source paragraph's visible text, without spacing-as-layout."""
    result = []
    for source in box.findall(W + 'p'):
        value = _text(source)
        if not value:
            continue
        if value.startswith('Жұмыс орны Место работы Бойынша'):
            # This legacy reverse-side paragraph used hundreds of spaces to
            # force three visual lines.  Preserve its two writable data slots.
            result.extend([_paragraph('Жұмыс орны', line=True), _paragraph('Место работы', line=True),
                           _paragraph(value[len('Жұмыс орны Место работы '):])])
            continue
        label = len(value) < 110 and (any(x in value for x in ['УДОСТОВЕРЕНИЕ', 'КУӘЛІК', 'КУƏЛІК', 'КУƏЛІГІ', 'Повторная проверка', 'Қайтадаң тексеру', 'Сведения о', 'мәлімет']) or value.startswith('№'))
        # Blank underlined fields remain writable when copied out of text boxes.
        blank_field = bool(source.xpath('.//w:u', namespaces=NS)) and not source.xpath('.//w:instrText', namespaces=NS) and len(value) < 38
        result.append(_paragraph(value, bold=label, center=label, line=blank_field))
    return result


def _table(widths, borders=True):
    table = E.Element(W + 'tbl')
    pr = _node(table, 'tblPr')
    _node(pr, 'tblW', w=sum(widths), type='dxa')
    _node(pr, 'tblLayout', type='fixed')
    edges = _node(pr, 'tblBorders')
    for edge in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']:
        _node(edges, edge, val='single' if borders else 'nil', sz=5, color='000000')
    margins = _node(pr, 'tblCellMar')
    for edge in ['top', 'left', 'bottom', 'right']:
        _node(margins, edge, w=100 if borders else 0, type='dxa')
    grid = _node(table, 'tblGrid')
    for width in widths:
        _node(grid, 'gridCol', w=width)
    return table


def _cell(row, width, content):
    cell = _node(row, 'tc')
    props = _node(cell, 'tcPr')
    _node(props, 'tcW', w=width, type='dxa')
    _node(props, 'vAlign', val='top')
    for child in content:
        cell.append(deepcopy(child))
    if not content or content[-1].tag != W + 'p':
        cell.append(_paragraph())
    return cell


def _height(content, width=INNER_WIDTH):
    total = 0
    for node in content:
        if node.tag == W + 'p':
            size = node.find('.//' + W + 'sz')
            points = int(size.get(W + 'val', '18')) / 2 if size is not None else 9
            total += _lines(_text(node), width, points, bool(node.xpath('.//w:b', namespaces=NS))) * max(LINE_HEIGHT, points * 1.15) + 1
        elif node.tag == W + 'tbl':
            grid = [int(c.get(W + 'w')) for c in node.findall(W + 'tblGrid/' + W + 'gridCol')]
            for row in node.findall(W + 'tr'):
                values = [_height(list(cell)[1:], max(400, grid[min(i, len(grid) - 1)] - 80)) for i, cell in enumerate(row.findall(W + 'tc'))]
                minheight = row.find(W + 'trPr/' + W + 'trHeight')
                total += max([float(minheight.get(W + 'val')) / 20 if minheight is not None else 0, *values]) + 5
    return total


def _photo_content(root, content, tid):
    """Reserve a real column; portrait can never overlap names or employment."""
    photo = root.xpath('//v:shape[starts-with(@id,"DSJPhotoSlot")] | //v:rect[starts-with(@id,"DSJPhotoSlot")]', namespaces=NS)
    split = 4 if tid == 'ps-card' else 3
    if tid == 'ptm-card':
        split = next((i for i, p in enumerate(content) if 'Должность:' in _text(p)), 4)
    elif tid == 'pb-card':
        split = next((i for i, p in enumerate(content) if 'Выдано' in _text(p)), 3) + 1
    leading, fields = content[:split], content[split:]
    table = _table([1220, INNER_WIDTH - 1220], borders=False)
    row = _node(table, 'tr')
    props = _node(row, 'trPr')
    _node(props, 'cantSplit')
    _node(props, 'trHeight', val=1600, hRule='atLeast')
    pp = _paragraph('ФОТО', center=True, size=8)
    if photo:
        pp = _paragraph()
        pp.find(W + 'pPr/' + W + 'spacing').set(W + 'line', '240')
        run = pp.find(W + 'r')
        image = photo[0].find('{urn:schemas-microsoft-com:vml}imagedata')
        if image is None or not image.get(R + 'id'):
            raise ValueError('PHOTO_ASSET_MISSING')
        # VML inline rectangles retain different baseline semantics in Word and
        # Writer.  Use a genuine inline DrawingML picture with the SAME bytes.
        wp = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
        a = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
        pic = '{http://schemas.openxmlformats.org/drawingml/2006/picture}'
        inline = E.SubElement(_node(run, 'drawing'), wp + 'inline', distT='0', distB='0', distL='0', distR='0')
        E.SubElement(inline, wp + 'extent', cx='685800', cy='914400')
        E.SubElement(inline, wp + 'docPr', id='700001', name='Recipient photo')
        graphic = E.SubElement(inline, a + 'graphic')
        graphic_data = E.SubElement(graphic, a + 'graphicData', uri=pic[1:-1])
        picture = E.SubElement(graphic_data, pic + 'pic')
        props = E.SubElement(picture, pic + 'nvPicPr')
        E.SubElement(props, pic + 'cNvPr', id='0', name='Recipient photo')
        E.SubElement(props, pic + 'cNvPicPr')
        fill = E.SubElement(picture, pic + 'blipFill')
        E.SubElement(fill, a + 'blip', {R + 'embed': image.get(R + 'id')})
        E.SubElement(E.SubElement(fill, a + 'stretch'), a + 'fillRect')
        sp = E.SubElement(picture, pic + 'spPr')
        transform = E.SubElement(sp, a + 'xfrm')
        E.SubElement(transform, a + 'off', x='0', y='0')
        E.SubElement(transform, a + 'ext', cx='685800', cy='914400')
        E.SubElement(E.SubElement(sp, a + 'prstGeom', prst='rect'), a + 'avLst')
    # The photo frame itself keeps its 3:4 proportions even if employment data
    # makes the adjacent column taller.  A border on the outer cell would grow.
    photo_table = _table([1120])
    for margin in photo_table.findall(W + 'tblPr/' + W + 'tblCellMar/*'):
        margin.set(W + 'w', '0')
    photo_row = _node(photo_table, 'tr')
    _node(_node(photo_row, 'trPr'), 'trHeight', val=1520, hRule='atLeast')
    photo_cell = _cell(photo_row, 1120, [pp])
    photo_cell.find(W + 'tcPr/' + W + 'vAlign').set(W + 'val', 'center')
    _cell(row, 1220, [photo_table, _paragraph()])
    _cell(row, INNER_WIDTH - 1220, fields)
    if tid == 'ptm-card':
        cells = row.findall(W + 'tc')
        row.remove(cells[0]); row.append(cells[0])
        cols = table.find(W + 'tblGrid')
        cols[0].set(W + 'w', str(INNER_WIDTH - 1220)); cols[1].set(W + 'w', '1220')
    return [*leading, table, _paragraph()]


def _disciplines(root):
    source = next((t for t in root.xpath('/w:document/w:body/w:tbl', namespaces=NS)
                   if 'Пәндер атауы' in _text(t) and not t.xpath('.//w:txbxContent', namespaces=NS)), None)
    if source is None:
        raise ValueError('NEUTRAL_CARD_SOURCE_STRUCTURE')
    table = _table([360, 3080, INNER_WIDTH - 3440])
    for oldrow in source.findall(W + 'tr'):
        row = _node(table, 'tr')
        _node(_node(row, 'trPr'), 'cantSplit')
        for i, cell in enumerate(oldrow.findall(W + 'tc')):
            width = [360, 3080, INNER_WIDTH - 3440][i]
            paragraphs = [_paragraph(_text(p), size=9, center=i != 1) for p in cell.findall(W + 'p')]
            _cell(row, width, paragraphs)
    return table


def repair_card_files(files: dict[str, bytes], snapshot: dict) -> dict[str, bytes]:
    tid = snapshot.get('templateId')
    if tid not in CARDS:
        return files
    if len(snapshot.get('items', [])) != 1:
        raise ValueError('NEUTRAL_CARD_RECIPIENT_CONTRACT')
    root = E.fromstring(files['word/document.xml'])
    boxes = root.xpath('//mc:Choice//w:txbxContent', namespaces=NS)
    expected = {'biot-worker-card': 6, 'pb-card': 8, 'ps-card': 16, 'ptm-card': 3}[tid]
    if len(boxes) != expected:
        raise ValueError('NEUTRAL_CARD_SOURCE_STRUCTURE')
    panels = [_panel(box) for box in boxes]
    if tid == 'pb-card':
        assignment = snapshot['items'][0]['assignment']
        formatted = lambda key: date.fromisoformat(assignment[key]).strftime('%d.%m.%Y')
        # Source DATE components sit in separate runs and language fragments.
        # Reassemble each semantic date from its frozen field, never from layout.
        for index, paragraph in enumerate(panels[1]):
            text = _text(paragraph)
            if text.startswith('Действительно до'):
                panels[1][index] = _paragraph('Действительно до / дейін жарамды: ' + formatted('validUntil'))
            elif re.match(r'^\d{4}\s', text):
                panels[1][index] = _paragraph('Хаттама күні / Дата протокола: ' + formatted('protocolDate' if assignment.get('protocolDate') else 'documentDate'))
        for index, paragraph in enumerate(panels[0]):
            if _text(paragraph).startswith('Ол/он'):
                panels[0][index] = _paragraph('Берілген күні / Дата выдачи: ' + formatted('documentDate'))
    if tid != 'biot-worker-card':
        panels[0] = _photo_content(root, panels[0], tid)
    if tid == 'ps-card':
        insert = next((i for i, p in enumerate(panels[1]) if 'Бітіру емтиханы' in _text(p)), len(panels[1]))
        panels[1].insert(insert, _disciplines(root))
    pages = {'biot-worker-card': [[(0, 1), (0, 1)], [(4, 4)]],
             'pb-card': [[(0, 1), (3, 2)], [(5, 4), (7, 6)]],
             'ps-card': [[(0, 1), (5, 4)], [(10, 9), (15, 14)]],
             'ptm-card': [[(0, 1)]]}[tid]
    for page in pages:
        for left, right in page:
            # Bounded cards fail before issue rather than silently spilling into
            # another printed side.  No text is shortened and fonts never shrink.
            if max(_height(panels[left]), _height(panels[right])) > 290:
                raise ValueError('PRINT_LAYOUT_OVERFLOW')
    body = root.find(W + 'body')
    section = deepcopy(body.find(W + 'sectPr'))
    for child in list(body):
        body.remove(child)
    issuer = snapshot.get('issuer', {})
    band = ' / '.join(dict.fromkeys(str(issuer.get(key) or '').strip() for key in ['nameKz', 'nameRu'] if str(issuer.get(key) or '').strip()))
    item = snapshot['items'][0]
    employer_band = ' / '.join(dict.fromkeys(str(item.get(key) or '').strip() for key in ['workplaceKz', 'workplaceRu'] if str(item.get(key) or '').strip()))
    if _lines(band, PANEL_WIDTH * 2, 8) > 2:
        raise ValueError('PRINT_LAYOUT_OVERFLOW')
    if tid == 'ps-card' and _lines(employer_band, INNER_WIDTH) > 4:
        raise ValueError('PRINT_LAYOUT_OVERFLOW')
    for page_index, page in enumerate(pages):
        if page_index:
            p = _paragraph()
            _node(p.find(W + 'r'), 'br', type='page')
            body.append(p)
        for pair_index, (left, right) in enumerate(page):
            if pair_index:
                body.append(_paragraph())
            table = _table([PANEL_WIDTH, PANEL_WIDTH])
            row = _node(table, 'tr')
            props = _node(row, 'trPr')
            _node(props, 'cantSplit')
            _node(props, 'trHeight', val=3680, hRule='atLeast')
            for index in [left, right]:
                content = ([_paragraph(band, center=True, size=8)] if band else []) + panels[index]
                if tid == 'ps-card' and page_index == 0 and pair_index == 1 and employer_band:
                    # The original oversize strip also held the recipient's
                    # employer (the QNP source slot).  Keep that frozen field on
                    # the same pair of panels, at readable body size.
                    content.insert(0, _paragraph(employer_band, center=True))
                _cell(row, PANEL_WIDTH, content)
            body.append(table)
    body.append(_paragraph())
    for child in list(section):
        if child.tag in [W + 'type', W + 'cols', W + 'docGrid']:
            section.remove(child)
    size = section.find(W + 'pgSz')
    size.set(W + 'w', '11910'); size.set(W + 'h', '16840')
    margin = section.find(W + 'pgMar')
    for key, value in dict(top=567, bottom=567, left=695, right=695, header=0, footer=170, gutter=0).items():
        margin.set(W + key, str(value))
    body.append(section)
    result = dict(files)
    result['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8')
    return result
