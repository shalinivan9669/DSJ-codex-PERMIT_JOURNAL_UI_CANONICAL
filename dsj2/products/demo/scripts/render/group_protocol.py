"""Version 1 group table contract. Original pinned forms remain immutable.

One common header/commission and a real flowing participant table. No fake person
and no concatenated individual protocols. Rendering is based on pinned template
bytes already checked by resolve_template; all participant cells use render_one.
"""
from copy import deepcopy
from lxml import etree as E

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def roster_table(root):
    matches = [t for t in root.iter(W+'tbl') if t.findall(W+'tr')
               and '№' in ''.join(t.findall(W+'tr')[0].itertext())]
    if len(matches) != 1:
        raise ValueError('GROUP_TABLE_CONTRACT')
    return matches[0]


def render_group(snapshot, path, render_one):
    event = snapshot.get('groupEvent', {})
    if event.get('contractVersion') != 1 or not snapshot['templateId'].endswith('-protocol'):
        raise ValueError('GROUP_VERSION_UNKNOWN')
    items = snapshot['items']
    if not 1 <= len(items) <= 100:
        raise ValueError('GROUP_ROW_LIMIT')
    if len({(i['id'], i['assignment']['eventId']) for i in items}) != len(items):
        raise ValueError('GROUP_DUPLICATE_MEMBER')
    files = render_one(snapshot, items[0], path)
    root = E.fromstring(files['word/document.xml'])
    table = roster_table(root)
    rows = table.findall(W+'tr')
    header_count = 2 if snapshot['templateId'] in ['biot-protocol', 'biot-itr-protocol'] else 1
    if len(rows) < header_count+1:
        raise ValueError('GROUP_TABLE_ROWS')
    # Group tables must flow over pages instead of using a fixed floating anchor.
    pr = table.find(W+'tblPr')
    if pr is not None:
        for floating in pr.findall(W+'tblpPr'):
            pr.remove(floating)
    for old in rows[header_count:]:
        table.remove(old)
    for index, item in enumerate(items, 1):
        rendered = E.fromstring(render_one(snapshot, item, path)['word/document.xml'])
        row = deepcopy(roster_table(rendered).findall(W+'tr')[header_count])
        ordinal = row.findall(W+'tc')[0]
        texts = list(ordinal.iter(W+'t'))
        if not texts:
            raise ValueError('GROUP_ORDINAL_MISSING')
        texts[0].text = str(index)
        for text in texts[1:]:
            text.text = ''
        row_pr = row.find(W+'trPr')
        if row_pr is None:
            row_pr = E.Element(W+'trPr'); row.insert(0, row_pr)
        for height in row_pr.findall(W+'trHeight'):
            row_pr.remove(height)
        # PTM's legacy example row is itself marked as a header. Cloning that
        # flag marks the whole roster as one huge repeating header, which
        # LibreOffice cannot repeat. Only the real column-heading rows repeat.
        for heading in row_pr.findall(W+'tblHeader'):
            row_pr.remove(heading)
        if row_pr.find(W+'cantSplit') is None:
            E.SubElement(row_pr, W+'cantSplit')
        for paragraph in row.iter(W+'p'):
            ppr = paragraph.find(W+'pPr')
            if ppr is not None:
                for keep in ppr.findall(W+'keepNext'):
                    ppr.remove(keep)
        table.append(row)
    if table.find(W+'tblGrid') is not None:
        # Legacy one-person ordinal cells are too narrow for 100: PTM also
        # inherited a hanging indent. Keep the overall table width while
        # reserving enough room for all three digits in every group form.
        grid = table.find(W+'tblGrid').findall(W+'gridCol')
        widths = [int(column.get(W+'w')) for column in grid]
        extra = max(0, 620-widths[0])
        donor = max(range(1, len(widths)), key=lambda n: widths[n])
        widths[0] += extra; widths[donor] -= extra
        for column,width in zip(grid,widths): column.set(W+'w',str(width))
        for row in table.findall(W+'tr'):
            for cell,width in zip(row.findall(W+'tc'),widths):
                cell.find(W+'tcPr').find(W+'tcW').set(W+'w',str(width))
            ordinal=row.findall(W+'tc')[0];props=ordinal.find(W+'tcPr')
            margins=props.find(W+'tcMar')
            if margins is None: margins=E.SubElement(props,W+'tcMar')
            for side in ['left','right']:
                margin=margins.find(W+side)
                if margin is None: margin=E.SubElement(margins,W+side)
                margin.set(W+'w','40');margin.set(W+'type','dxa')
            for paragraph in ordinal.iter(W+'p'):
                ppr=paragraph.find(W+'pPr')
                if ppr is None: ppr=E.Element(W+'pPr');paragraph.insert(0,ppr)
                for indent in ppr.findall(W+'ind'): ppr.remove(indent)
                for number in ppr.findall(W+'numPr'): ppr.remove(number)
                E.SubElement(ppr,W+'ind',{W+'left':'0',W+'right':'0',W+'firstLine':'0'})
    for row in table.findall(W+'tr')[:header_count]:
        pr = row.find(W+'trPr')
        if pr is None:
            pr = E.Element(W+'trPr'); row.insert(0, pr)
        if pr.find(W+'tblHeader') is None:
            E.SubElement(pr, W+'tblHeader')
    # A flowing roster can end close to the page boundary. Keep the following
    # commission signature block together so a name never loses its signature
    # line or caption on the next page. The roster itself remains free to flow.
    body = table.getparent()
    following = list(body)[list(body).index(table) + 1:]
    signature_paragraphs = [p for element in following
                            if element.tag != W+'sectPr'
                            for p in element.iter(W+'p')]
    for paragraph in signature_paragraphs:
        props = paragraph.find(W+'pPr')
        if props is None:
            props = E.Element(W+'pPr'); paragraph.insert(0, props)
        if props.find(W+'keepLines') is None:
            E.SubElement(props, W+'keepLines')
        for keep in props.findall(W+'keepNext'):
            props.remove(keep)
        if paragraph is not signature_paragraphs[-1]:
            E.SubElement(props, W+'keepNext')
    for element in following:
        for signature_table in element.iter(W+'tbl'):
            props = signature_table.find(W+'tblPr')
            if props is not None:
                for floating in props.findall(W+'tblpPr'):
                    props.remove(floating)
        for row in element.iter(W+'tr'):
            props = row.find(W+'trPr')
            if props is None:
                props = E.Element(W+'trPr'); row.insert(0, props)
            if props.find(W+'cantSplit') is None:
                E.SubElement(props, W+'cantSplit')
    files['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='utf-8')
    return files
