"""Version 1 group table contract. Original pinned forms remain immutable.

One common header/commission and a real flowing participant table. No fake person
and no concatenated individual protocols. Rendering is based on pinned template
bytes already checked by resolve_template; all participant cells use render_one.
"""
from copy import deepcopy
from lxml import etree as E
from request_limits import MAX_REQUEST_ROWS

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def roster_table(root):
    matches = [t for t in root.iter(W+'tbl') if t.findall(W+'tr')
               and '№' in ''.join(t.findall(W+'tr')[0].itertext())]
    if len(matches) != 1:
        raise ValueError('GROUP_TABLE_CONTRACT')
    return matches[0]


def flow_original_signatures(root, roster):
    """Keep the original three-column signatures after a flowing group roster."""
    body=root.find(W+'body')
    tables=[t for t in body.findall(W+'tbl') if t is not roster]
    if len(tables)!=3:return
    names,signs,labels=tables
    signature=E.Element(W+'tbl');pr=E.SubElement(signature,W+'tblPr')
    widths=[2454,2854,2886]
    E.SubElement(pr,W+'tblW',{W+'w':str(sum(widths)),W+'type':'dxa'})
    E.SubElement(pr,W+'tblLayout',{W+'type':'fixed'})
    borders=E.SubElement(pr,W+'tblBorders')
    for side in ['top','left','bottom','right','insideH','insideV']:E.SubElement(borders,W+side,{W+'val':'nil'})
    grid=E.SubElement(signature,W+'tblGrid')
    for width in widths:E.SubElement(grid,W+'gridCol',{W+'w':str(width)})
    for index in range(max(len(t.findall(W+'tr')) for t in tables)):
        row=E.SubElement(signature,W+'tr');E.SubElement(E.SubElement(row,W+'trPr'),W+'cantSplit')
        for source,width in zip([labels,names,signs],widths):
            rows=source.findall(W+'tr')
            cell=deepcopy(rows[index].find(W+'tc')) if index<len(rows) else E.Element(W+'tc')
            cp=cell.find(W+'tcPr')
            if cp is None:cp=E.Element(W+'tcPr');cell.insert(0,cp)
            cw=cp.find(W+'tcW')
            if cw is None:cw=E.SubElement(cp,W+'tcW')
            cw.set(W+'w',str(width));cw.set(W+'type','dxa')
            if not cell.findall(W+'p'):E.SubElement(cell,W+'p')
            row.append(cell)
    position=body.index(tables[0])
    for old in tables:body.remove(old)
    body.insert(position,signature)


def render_group(snapshot, path, render_one):
    event = snapshot.get('groupEvent', {})
    if event.get('contractVersion') != 1 or not snapshot['templateId'].endswith('-protocol'):
        raise ValueError('GROUP_VERSION_UNKNOWN')
    items = snapshot['items']
    if not 1 <= len(items) <= MAX_REQUEST_ROWS:
        raise ValueError('GROUP_ROW_LIMIT')
    if len({(i['id'], i['assignment']['eventId']) for i in items}) != len(items):
        raise ValueError('GROUP_DUPLICATE_MEMBER')
    # Only new snapshots opt into factual common workplace names. Keep the old
    # first-person header for old immutable snapshots and their reconstruction.
    header_item = items[0]
    header = snapshot.get('groupHeaderWorkplace')
    if header is not None:
        if (snapshot['templateId'] not in ['biot-protocol', 'biot-itr-protocol', 'pb-protocol']
                or header.get('version') != 1
                or not isinstance(header.get('workplaceRu'), str)
                or not isinstance(header.get('workplaceKz'), str)):
            raise ValueError('GROUP_HEADER_WORKPLACE_CONTRACT')
        header_item = {**items[0], 'workplaceRu': header['workplaceRu'],
                       'workplaceKz': header['workplaceKz']}
    files = render_one(snapshot, header_item, path)
    root = E.fromstring(files['word/document.xml'])
    table = roster_table(root)
    if 'demo/original-form.json' in files and snapshot['templateId'].startswith('biot-'):
        flow_original_signatures(root,table)
    rows = table.findall(W+'tr')
    header_count = 2 if snapshot['templateId'] in ['biot-protocol', 'biot-itr-protocol'] else 1
    if len(rows) < header_count+1:
        raise ValueError('GROUP_TABLE_ROWS')
    # Group tables must flow over pages instead of using a fixed floating anchor.
    pr = table.find(W+'tblPr')
    if pr is not None:
        for floating in pr.findall(W+'tblpPr'):
            pr.remove(floating)
        if 'demo/original-form.json' in files:
            # The original floating roster is centred and wider than the text
            # margins. Preserve that physical centre when making it flow.
            alignment=pr.find(W+'jc')
            if alignment is None:alignment=E.SubElement(pr,W+'jc')
            alignment.set(W+'val','center')
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
