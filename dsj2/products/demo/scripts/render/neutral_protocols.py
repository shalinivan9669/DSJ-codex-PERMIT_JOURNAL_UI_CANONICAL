"""Flowing protocol layout for NEUTRAL_FORMS_V1 only.

Run after the frozen source's data fill.  Historical rendering never imports
this policy: its floating tables, numbering and package bytes stay pinned.
"""
from functools import lru_cache
from pathlib import Path
import math

from lxml import etree as E
from PIL import ImageFont

from group_protocol import W, flow_original_signatures, roster_table


PROTOCOL_IDS = frozenset({
    'biot-protocol', 'biot-itr-protocol', 'ptm-protocol',
    'pb-protocol', 'ps-protocol',
})
COMMISSION_BOOKMARK = '_NeutralProtocolCommission'

PROPERTY_ORDER = {
    'tblPr': 'tblStyle tblpPr tblOverlap bidiVisual tblStyleRowBandSize tblStyleColBandSize tblW jc tblCellSpacing tblInd tblBorders shd tblLayout tblCellMar tblLook tblCaption tblDescription tblPrChange',
    'trPr': 'cnfStyle divId gridBefore gridAfter wBefore wAfter cantSplit trHeight tblHeader tblCellSpacing jc hidden ins del trPrChange',
    'tcPr': 'cnfStyle tcW gridSpan hMerge vMerge tcBorders shd noWrap tcMar textDirection tcFitText vAlign hideMark headers cellIns cellDel cellMerge tcPrChange',
    'pPr': 'pStyle keepNext keepLines pageBreakBefore framePr widowControl numPr suppressLineNumbers pBdr shd tabs suppressAutoHyphens kinsoku wordWrap overflowPunct topLinePunct autoSpaceDE autoSpaceDN bidi adjustRightInd snapToGrid spacing ind contextualSpacing mirrorIndents suppressOverlap jc textDirection textAlignment textboxTightWrap outlineLvl divId cnfStyle rPr sectPr pPrChange',
}


def _order_properties(root):
    """Respect schema order; Word tolerates late flags that Writer does not."""
    for name, sequence in PROPERTY_ORDER.items():
        ranks = {W + tag: index for index, tag in enumerate(sequence.split())}
        for props in root.iter(W + name):
            props[:] = sorted(props, key=lambda child: ranks.get(child.tag, len(ranks)))


def _props(element, name):
    value = element.find(W + name)
    if value is None:
        value = E.Element(W + name)
        element.insert(0, value)
    return value


def _remove(parent, name):
    for child in parent.findall(W + name):
        parent.remove(child)


def _flag(parent, name, enabled=True):
    _remove(parent, name)
    if enabled:
        E.SubElement(parent, W + name)


def _flow_table(table):
    props = _props(table, 'tblPr')
    _remove(props, 'tblpPr')
    _remove(props, 'tblInd')
    alignment = props.find(W + 'jc')
    if alignment is None:
        alignment = E.SubElement(props, W + 'jc')
    alignment.set(W + 'val', 'center')


def _row_layout(row, heading=False):
    props = _props(row, 'trPr')
    _remove(props, 'trHeight')
    _flag(props, 'tblHeader', heading)
    _flag(props, 'cantSplit')
    for cell in row.findall(W + 'tc'):
        cell_props = _props(cell, 'tcPr')
        _remove(cell_props, 'noWrap')
        _remove(cell_props, 'tcFitText')
        for paragraph in cell.iter(W + 'p'):
            paragraph_props = _props(paragraph, 'pPr')
            _flag(paragraph_props, 'keepNext', False)
            _flag(paragraph_props, 'keepLines')


def _ordinal_column(table, header_count):
    """Use real text for ordinals, independent of Word's list continuation."""
    grid = table.find(W + 'tblGrid')
    if grid is None:
        raise ValueError('NEUTRAL_PROTOCOL_GRID')
    columns = grid.findall(W + 'gridCol')
    widths = [int(column.get(W + 'w')) for column in columns]
    if len(widths) < 2:
        raise ValueError('NEUTRAL_PROTOCOL_GRID')
    extra = max(0, 620 - widths[0])
    donor = max(range(1, len(widths)), key=widths.__getitem__)
    widths[0] += extra
    widths[donor] -= extra
    for column, width in zip(columns, widths):
        column.set(W + 'w', str(width))
    for index, row in enumerate(table.findall(W + 'tr')):
        cells = row.findall(W + 'tc')
        if len(cells) != len(widths):
            raise ValueError('NEUTRAL_PROTOCOL_COLUMNS')
        for cell, width in zip(cells, widths):
            cp = _props(cell, 'tcPr')
            cw = cp.find(W + 'tcW')
            if cw is None:
                cw = E.SubElement(cp, W + 'tcW')
            cw.set(W + 'w', str(width))
            cw.set(W + 'type', 'dxa')
        ordinal = cells[0]
        margins = _props(ordinal, 'tcPr').find(W + 'tcMar')
        if margins is None:
            margins = E.SubElement(_props(ordinal, 'tcPr'), W + 'tcMar')
        for side in ('left', 'right'):
            margin = margins.find(W + side)
            if margin is None:
                margin = E.SubElement(margins, W + side)
            margin.set(W + 'w', '40')
            margin.set(W + 'type', 'dxa')
        if index < header_count:
            continue
        paragraphs = list(ordinal.iter(W + 'p'))
        if not paragraphs:
            paragraphs = [E.SubElement(ordinal, W + 'p')]
        for paragraph in paragraphs:
            pp = _props(paragraph, 'pPr')
            _remove(pp, 'ind')
            _remove(pp, 'numPr')
            E.SubElement(pp, W + 'ind', {W + 'left': '0', W + 'right': '0', W + 'firstLine': '0'})
            alignment = pp.find(W + 'jc')
            if alignment is None:
                alignment = E.SubElement(pp, W + 'jc')
            alignment.set(W + 'val', 'center')
        texts = list(ordinal.iter(W + 't'))
        if not texts:
            texts = [E.SubElement(E.SubElement(paragraphs[0], W + 'r'), W + 't')]
        texts[0].text = str(index - header_count + 1)
        for text in texts[1:]:
            text.text = ''


def _signature_block(root, roster, template_id):
    body = root.find(W + 'body')
    if template_id.startswith('biot-'):
        # The source places labels, names and signature lines in three
        # independently floating tables. Join their existing cells horizontally.
        flow_original_signatures(root, roster)
    following = list(body)[body.index(roster) + 1:]
    # Floating-table anchor spacers cease to have a purpose after conversion to
    # flow. Keeping them would waste two full lines before the commission.
    for element in following:
        if (element.tag == W + 'p' and not ''.join(element.itertext()).strip()
                and not list(element.iter(W + 'drawing'))
                and not list(element.iter(W + 'pict'))
                and element.find('.//' + W + 'sectPr') is None):
            body.remove(element)
    # Writer merges adjacent tables with no intervening paragraph. In these
    # forms that would apply the borderless commission's width and borders to
    # the roster, narrowing every member column and hiding the grid. Retain a
    # minimal real separator, kept with the commission rather than the roster.
    spacer = E.Element(W + 'p')
    spacer_props = E.SubElement(spacer, W + 'pPr')
    E.SubElement(spacer_props, W + 'spacing', {
        W + 'before': '0', W + 'after': '0', W + 'line': '80', W + 'lineRule': 'exact'})
    body.insert(body.index(roster) + 1, spacer)
    following = list(body)[body.index(roster) + 1:]
    paragraphs = []
    for element in following:
        if element.tag == W + 'sectPr':
            continue
        for table in element.iter(W + 'tbl'):
            _flow_table(table)
        for row in element.iter(W + 'tr'):
            _row_layout(row)
        paragraphs.extend(element.iter(W + 'p'))
    for index, paragraph in enumerate(paragraphs):
        props = _props(paragraph, 'pPr')
        _flag(props, 'keepLines')
        _flag(props, 'keepNext', index < len(paragraphs) - 1)
        _remove(props, 'pageBreakBefore')
    # Keep the final small set of participants with the commission if it moves. This
    # prevents a page containing only separated signature captions, while all
    # earlier rows continue to paginate independently.
    if paragraphs:
        header_count = 2 if template_id.startswith('biot-') else 1
        for row in roster.findall(W + 'tr')[header_count:][-3:]:
            for paragraph in row.iter(W + 'p'):
                _flag(_props(paragraph, 'pPr'), 'keepNext')


def _compact_letterhead(files, root):
    """The removed source logo no longer needs a 70–120pt header row.

    Word treats those old minimum row heights as reserved space even when the
    replacement logo is only a text label.  Reclaim that space on every page
    without changing the issuer text, logo slot, page size or table columns.
    """
    result = dict(files)
    for name, content in files.items():
        if not (name.startswith('word/header') and name.endswith('.xml')):
            continue
        header = E.fromstring(content)
        for row in header.iter(W + 'tr'):
            _remove(_props(row, 'trPr'), 'trHeight')
        for paragraph in header.iter(W + 'p'):
            props = _props(paragraph, 'pPr')
            spacing = props.find(W + 'spacing')
            if spacing is None:
                spacing = E.SubElement(props, W + 'spacing')
            spacing.set(W + 'before', '0')
            spacing.set(W + 'after', '0')
            if not ''.join(node.text or '' for node in paragraph.iter(W + 't')).strip():
                spacing.set(W + 'line', '20')
                spacing.set(W + 'lineRule', 'exact')
        _order_properties(header)
        result[name] = E.tostring(header, encoding='utf-8', xml_declaration=True)
    for section in root.iter(W + 'sectPr'):
        margins = section.find(W + 'pgMar')
        if margins is not None:
            margins.set(W + 'top', '1600')
            margins.set(W + 'header', '400')
    return result


def _pb_commission_row(root, roster):
    """Keep the PB commission and its external caption in one physical row.

    Word can break the source's multirow commission table despite paragraph
    keepNext. A single spanning roster row is atomic, and keeping the final
    participant rows with it works within the same table in Word and Writer.
    The bookmark distinguishes this layout row from actual participant rows.
    """
    body = root.find(W + 'body')
    parts = [part for part in list(body)[body.index(roster) + 1:]
             if part.tag != W + 'sectPr']
    grid = roster.find(W + 'tblGrid')
    width = sum(int(column.get(W + 'w')) for column in grid)
    row = E.SubElement(roster, W + 'tr')
    E.SubElement(E.SubElement(row, W + 'trPr'), W + 'cantSplit')
    cell = E.SubElement(row, W + 'tc')
    props = E.SubElement(cell, W + 'tcPr')
    E.SubElement(props, W + 'tcW', {W + 'w': str(width), W + 'type': 'dxa'})
    E.SubElement(props, W + 'gridSpan', {W + 'val': str(len(grid))})
    borders = E.SubElement(props, W + 'tcBorders')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        E.SubElement(borders, W + edge, {W + 'val': 'nil'})
    margins = E.SubElement(props, W + 'tcMar')
    for edge in ('top', 'left', 'bottom', 'right'):
        E.SubElement(margins, W + edge, {W + 'w': '0', W + 'type': 'dxa'})
    for part in parts:
        cell.append(part)
    paragraph = cell.find(W + 'p')
    bookmark_id = str(1 + max((int(node.get(W + 'id'))
                              for node in root.iter(W + 'bookmarkStart')), default=0))
    E.SubElement(paragraph, W + 'bookmarkStart', {
        W + 'id': bookmark_id, W + 'name': COMMISSION_BOOKMARK})
    E.SubElement(paragraph, W + 'bookmarkEnd', {W + 'id': bookmark_id})


def _compact_body_spacers(root, roster):
    body = root.find(W + 'body')
    for paragraph in list(body)[:body.index(roster)]:
        if (paragraph.tag != W + 'p'
                or ''.join(node.text or '' for node in paragraph.iter(W + 't')).strip()
                or list(paragraph.iter(W + 'drawing')) or list(paragraph.iter(W + 'pict'))):
            continue
        props = _props(paragraph, 'pPr')
        spacing = props.find(W + 'spacing')
        if spacing is None:
            spacing = E.SubElement(props, W + 'spacing')
        for key, value in {'before': '0', 'after': '0', 'line': '80', 'lineRule': 'exact'}.items():
            spacing.set(W + key, value)


def _remove_source_company_wrappers(root, template_id):
    """Remove only static legal-form runs surrounding the two source fields.

    The saved workplace value already contains its real legal form. The old
    form hardcodes a ТОО prefix in the header and a ЖШС suffix in the roster.
    Field depth distinguishes those source runs from identical words entered
    by a user inside the cached field value; user text is never normalized.
    """
    if not template_id.startswith('biot-') and template_id != 'ptm-protocol':
        return
    for paragraph in root.iter(W + 'p'):
        instruction = ''.join(node.text or '' for node in paragraph.iter(W + 'instrText')).replace(' ', '')
        removable = ({'ТОО'} if 'MERGEFIELDЖұмыс__орны_' in instruction else
                     {'ЖШС'} if 'MERGEFIELDМесто_работы' in instruction else set())
        if not removable:
            continue
        depth = 0
        for node in paragraph.iter():
            if node.tag == W + 'fldChar':
                kind = node.get(W + 'fldCharType')
                if kind == 'begin':
                    depth += 1
                elif kind == 'end':
                    depth = max(0, depth - 1)
            elif node.tag == W + 't' and depth == 0 and (node.text or '').strip() in removable:
                node.text = ''


@lru_cache(maxsize=32)
def _measure_font(size):
    path = Path(__file__).resolve().parents[2] / 'assets/fonts/LiberationSerif-Regular.ttf'
    return ImageFont.truetype(str(path), round(size * 10))


def _row_height(row):
    """Conservative measured height used only to reject unprintable rows."""
    heights = []
    for cell in row.findall(W + 'tc'):
        width = int(cell.find(W + 'tcPr/' + W + 'tcW').get(W + 'w')) / 20 - 12
        height = 0
        for paragraph in cell.iter(W + 'p'):
            sizes = [int(node.get(W + 'val')) / 2 for node in paragraph.iter(W + 'sz')]
            size = max(sizes, default=11)
            font = _measure_font(size)
            lines, current = 1, ''
            for word in ''.join(node.text or '' for node in paragraph.iter(W + 't')).split():
                word_width = font.getlength(word) / 10
                candidate = (current + ' ' + word).strip()
                if word_width > width:
                    lines += int(bool(current)) + max(0, math.ceil(word_width / width) - 1)
                    current = ''
                elif current and font.getlength(candidate) / 10 > width:
                    lines += 1
                    current = word
                else:
                    current = candidate
            lines += len(list(paragraph.iter(W + 'br')))
            height += lines * size * 1.3
        heights.append(height + 4)
    return max(heights, default=0)


def _check_row_capacity(root, roster, header_count):
    section = root.find('.//' + W + 'sectPr')
    page, margins = section.find(W + 'pgSz'), section.find(W + 'pgMar')
    available = (int(page.get(W + 'h')) - int(margins.get(W + 'top')) - int(margins.get(W + 'bottom'))) / 20
    rows = roster.findall(W + 'tr')
    heading_height = sum(_row_height(row) for row in rows[:header_count])
    for row in rows[header_count:]:
        if _row_height(row) + heading_height > available - 12:
            raise ValueError('PRINT_LAYOUT_OVERFLOW')


def repair_protocol_files(files: dict[str, bytes], snapshot: dict) -> dict[str, bytes]:
    """Repair only the new policy's already filled protocol document part."""
    template_id = snapshot.get('templateId')
    if template_id not in PROTOCOL_IDS:
        return files
    root = E.fromstring(files['word/document.xml'])
    _remove_source_company_wrappers(root, template_id)
    roster = roster_table(root)
    header_count = 2 if template_id.startswith('biot-') else 1
    rows = roster.findall(W + 'tr')
    expected = len(snapshot['items']) if snapshot.get('groupEvent') else 1
    if len(rows) != header_count + expected:
        raise ValueError('NEUTRAL_PROTOCOL_MEMBER_COUNT')
    _flow_table(roster)
    for index, row in enumerate(rows):
        _row_layout(row, heading=index < header_count)
    _ordinal_column(roster, header_count)
    _compact_body_spacers(root, roster)
    _signature_block(root, roster, template_id)
    result = _compact_letterhead(files, root)
    _check_row_capacity(root, roster, header_count)
    if template_id == 'pb-protocol':
        _pb_commission_row(root, roster)
    _order_properties(root)
    result['word/document.xml'] = E.tostring(root, encoding='utf-8', xml_declaration=True)
    return result
