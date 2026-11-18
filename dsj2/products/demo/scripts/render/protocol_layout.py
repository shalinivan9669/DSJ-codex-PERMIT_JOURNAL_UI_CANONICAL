"""Page flow for archive commission protocols with a repeating participant table."""
from copy import deepcopy
from lxml import etree as E

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def _property(node, name, first=False):
    child = node.find(W + name)
    if child is None:
        child = E.Element(W + name)
        node.insert(0 if first else len(node), child)
    return child


def _empty(paragraph):
    return not any((text.text or '').strip() for text in paragraph.iter(W + 't')) and not any(
        next(paragraph.iter(W + tag), None) is not None for tag in ('drawing', 'pict', 'sectPr', 'fldSimple', 'fldChar'))


def _small_gap(paragraph, twips=40):
    props = _property(paragraph, 'pPr', first=True)
    spacing = _property(props, 'spacing')
    spacing.attrib.clear()
    spacing.attrib.update({W + 'before': '0', W + 'after': '0', W + 'line': str(twips), W + 'lineRule': 'exact'})


def _inline(table):
    props = _property(table, 'tblPr', first=True)
    for anchor in props.findall(W + 'tblpPr'):
        props.remove(anchor)


def _collapse_header(header):
    for row in header.iter(W + 'tr'):
        paragraphs = list(row.iter(W + 'p'))
        if all(_empty(p) for p in paragraphs):
            table = row.getparent()
            if len(table.findall(W + 'tr')) > 1:
                table.remove(row)
    for paragraph in header.iter(W + 'p'):
        if _empty(paragraph):
            _small_gap(paragraph, 20)


def _signature_unit(roster, signature):
    # Word and Writer can ignore keepNext between two separate tables. A
    # single final row carries the last participant and the signed attestation.
    grid = roster.find(W + 'tblGrid')
    columns = grid.findall(W + 'gridCol')
    width = sum(int(col.get(W + 'w')) for col in columns)
    last = roster.findall(W + 'tr')[-1]
    participant = E.Element(W + 'tbl')
    participant.append(deepcopy(roster.find(W + 'tblPr')))
    participant.append(deepcopy(grid))
    participant.append(last)
    row = E.SubElement(roster, W + 'tr')
    E.SubElement(E.SubElement(row, W + 'trPr'), W + 'cantSplit')
    cell = E.SubElement(row, W + 'tc')
    props = E.SubElement(cell, W + 'tcPr')
    E.SubElement(props, W + 'tcW', {W + 'type': 'dxa', W + 'w': str(width)})
    E.SubElement(props, W + 'gridSpan', {W + 'val': str(len(columns))})
    edges = E.SubElement(props, W + 'tcBorders')
    for side in ('top', 'left', 'bottom', 'right'):
        E.SubElement(edges, W + side, {W + 'val': 'nil'})
    margins = E.SubElement(props, W + 'tcMar')
    for side in ('top', 'left', 'bottom', 'right'):
        E.SubElement(margins, W + side, {W + 'type': 'dxa', W + 'w': '0'})
    cell.append(participant)
    _small_gap(E.SubElement(cell, W + 'p'))
    for gap in list(roster.itersiblings()):
        if gap is signature:
            break
        if gap.tag == W + 'p' and _empty(gap):
            gap.getparent().remove(gap)
    caption = signature.getnext()
    cell.append(signature)
    if caption is not None and caption.tag == W + 'p' and not _empty(caption):
        cell.append(caption)
    else:
        _small_gap(E.SubElement(cell, W + 'p'), 20)
    # Word inserts a default-size paragraph of its own after a terminal table.
    # Near the page bottom that can leave a sheet containing only a letterhead.
    tail = roster.getnext()
    if tail is None or tail.tag == W + 'sectPr':
        tail = E.Element(W + 'p')
        roster.addnext(tail)
    if tail.tag == W + 'p' and _empty(tail):
        _small_gap(tail, 20)
        _property(_property(tail.find(W + 'pPr'), 'rPr'), 'sz').set(W + 'val', '2')


def arrange_protocol(stories, roster, participant_count):
    body = roster.getparent()
    signature = next(node for node in roster.itersiblings() if node.tag == W + 'tbl')
    for table in (roster, signature):
        _inline(table)
    for name, story in stories.items():
        if name.startswith('word/header'):
            _collapse_header(story)
    for section in body.iter(W + 'sectPr'):
        margins = section.find(W + 'pgMar')
        if margins is not None:
            # The archive's letterhead is up to 81 pt high. Floating artwork in
            # a Word header does not reserve that space for the body in Writer.
            header = max(240, int(margins.get(W + 'header', '0')))
            margins.set(W + 'header', str(header))
            margins.set(W + 'top', str(header + 1840))
            margins.set(W + 'bottom', str(min(540, int(margins.get(W + 'bottom')))))
    for paragraph in body.findall(W + 'p'):
        if _empty(paragraph):
            _small_gap(paragraph)
    rows = roster.findall(W + 'tr')
    for index, row in enumerate(rows):
        props = _property(row, 'trPr', first=True)
        _property(props, 'cantSplit')
        for height in props.findall(W + 'trHeight'):
            props.remove(height)
        header = props.find(W + 'tblHeader')
        if index < len(rows) - participant_count:
            _property(props, 'tblHeader').set(W + 'val', '1')
        elif header is not None:
            props.remove(header)
        for cell in row.findall(W + 'tc'):
            paragraphs = cell.findall(W + 'p')
            if len(paragraphs) > 1 and any(not _empty(p) for p in paragraphs):
                for paragraph in paragraphs:
                    if _empty(paragraph):
                        _small_gap(paragraph, 20)
        for paragraph in row.iter(W + 'p'):
            ppr = _property(paragraph, 'pPr', first=True)
            for tag in ('pageBreakBefore', 'keepNext'):
                for prop in ppr.findall(W + tag):
                    ppr.remove(prop)
    _signature_unit(roster, signature)
