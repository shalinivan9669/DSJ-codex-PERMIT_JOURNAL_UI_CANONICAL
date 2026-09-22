"""Independent structural DOCX and physical PDF table acceptance assertions."""
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
import pdfplumber
import re

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def text(node):
    return ''.join(n.text or '' for n in node.iter(W+'t'))


def assert_biot_card_panels(path,recipients=1,expected_fields=None):
    """A repeated field can remain extractable while its copy clips at a panel edge."""
    checked=[]
    with pdfplumber.open(path) as document:
        assert len(document.pages)==recipients*2,'BIOT_CARD_PAGE_COUNT'
        for page_index in range(0,len(document.pages),2):
            page=document.pages[page_index]
            frames=sorted([s for s in page.curves+page.rects if s.get('stroke') and not s.get('fill') and s['width']>500 and 150<s['height']<190],key=lambda s:s['top'])
            bands=[s for s in page.curves+page.rects if s.get('fill') and s['width']>500 and 10<s['height']<16]
            assert len(frames)==2 and len(bands)==2,'BIOT_CARD_PANEL_GEOMETRY'
            for frame in frames:
                band=next(b for b in bands if abs(b['top']-frame['top'])<2)
                lines=[l for l in page.lines if abs(l['x1']-l['x0'])<1 and abs(l['bottom']-frame['bottom'])<2 and l['height']>150]
                assert len(lines)==1,'BIOT_CARD_DIVIDER_COUNT'
                line=lines[0]
                assert line['top']>=band['bottom']+.3,('BIOT_DIVIDER_THROUGH_ISSUER',page_index+1,line['top'],band['bottom'])
                chars=[c for c in page.chars if c['text'].strip() and c['x0']>line['x1'] and c['top']>=band['bottom']+1 and c['bottom']<=frame['bottom']]
                assert len(chars)>50,'BIOT_CARD_RIGHT_FIELDS_MISSING'
                left=min(c['x0'] for c in chars);right=max(c['x1'] for c in chars)
                assert right<=frame['x1']-2,('BIOT_RIGHT_PANEL_CLIP',page_index+1,right,frame['x1'])
                assert left>=line['x1']+3,('BIOT_RIGHT_PANEL_INSET',page_index+1,left,line['x1'])
                if expected_fields:
                    content=re.sub(r'\s+','',''.join(c['text'] for c in chars))
                    for field,value in expected_fields[page_index//2].items():
                        if value:assert re.sub(r'\s+','',value) in content,('BIOT_RIGHT_PANEL_FIELD_MISSING',page_index+1,field,frame['top'])
                checked.append({'page':page_index+1,'frameBox':list(frame['pts']) if 'pts' in frame else [frame['x0'],frame['top'],frame['x1'],frame['bottom']],'textLeftPt':left,'textRightPt':right,'frameRightPt':frame['x1'],'dividerTopPt':line['top'],'issuerBandBottomPt':band['bottom']})
    return checked


def assert_card_title_visible(path,template_id,recipients):
    """Text extraction alone misses text painted underneath an opaque issuer band."""
    if template_id!='ps-card':return []
    checked=[]
    with pdfplumber.open(path) as document:
        assert len(document.pages)==recipients*2,'PS_CARD_PAGE_COUNT'
        for index in range(recipients):
            page=document.pages[index*2]
            bands=[s for s in [*page.rects,*page.curves] if s.get('fill') and s['width']>400 and 10<=s['height']<=16]
            assert bands,'PS_ISSUER_BAND_MISSING'
            band=min(bands,key=lambda s:s['top'])
            titles=[w for w in page.extract_words() if w['text']=='КУӘЛІК']
            assert len(titles)==1,'PS_KAZAKH_TITLE_MISSING'
            title=titles[0]
            assert title['top']>=band['bottom']+.3,('PS_TITLE_BEHIND_ISSUER_BAND',index+1,title,band['bottom'])
            headings=[w for w in page.extract_words() if w['text']=='Тапсырылған']
            assert len(headings)==1,'PS_EXAM_HEADING_MISSING'
            middle=(band['x0']+band['x1'])/2
            assert headings[0]['x0']>=middle+2,('PS_EXAM_TEXT_CROSSES_DIVIDER',index+1,headings[0]['x0'],middle)
            checked.append({'page':index*2+1,'titleTopPt':title['top'],'issuerBandBottomPt':band['bottom'],'examHeadingLeftPt':headings[0]['x0'],'panelMiddlePt':middle})
    return checked


def assert_package_contract(path):
    with ZipFile(path) as archive:
        names=set(archive.namelist())
        for name in names:
            if not name.endswith(('.xml','.rels')):continue
            data=archive.read(name)
            assert b"encoding='utf8'" not in data and b'encoding="utf8"' not in data,'OOXML_ENCODING_NAME'
            tree=E.fromstring(data)
            for node in tree.iter():
                for attribute,value in node.attrib.items():
                    if E.QName(attribute).localname in ['Ignorable','Requires']:
                        assert all(prefix in node.nsmap for prefix in value.split()),'OOXML_UNDECLARED_MC_PREFIX'
                if E.QName(node).localname=='pic':
                    assert any(E.QName(child).localname=='blip' for child in node.iter()),'OOXML_EMPTY_PICTURE'
            if name.startswith('docProps/'):
                for node in tree.iter():
                    if E.QName(node).localname in ['created','modified','lastPrinted','revision','TotalTime','Pages','Words','i4']:
                        assert (node.text or '').strip(),'OOXML_EMPTY_TYPED_PROPERTY'
            if name=='[Content_Types].xml':
                assert all(not child.get('PartName') or child.get('PartName').lstrip('/') in names for child in tree),'OOXML_MISSING_CONTENT_TYPE_PART'


def assert_docx_columns(path, template_id, recipients=1):
    assert_package_contract(path)
    with ZipFile(path) as archive: tree = E.fromstring(archive.read('word/document.xml'))
    matches = []
    for table in tree.iter(W+'tbl'):
        rows = table.findall(W+'tr')
        if not rows or 'Примечание' not in text(rows[0]) or '№' not in text(rows[0]): continue
        assert template_id in ['biot-protocol','biot-itr-protocol'], 'Unexpected numbered-column table'
        caption=table.find(W+'tblPr/'+W+'tblCaption')
        revision=caption.get(W+'val') if caption is not None else ''
        columns=10 if revision=='BIOT2026_APP12' else 7 if revision=='BIOT2026_APP3' else 6
        cells = rows[1].findall(W+'tc')
        values = [text(c).strip() for c in cells]
        assert values == [str(i) for i in range(1,columns+1)], f'DOCX_COLUMN_VALUES:{values}'
        assert len(rows[0].findall(W+'tc'))==columns,'DOCX_HEADER_COLUMN_COUNT'
        assert len(rows[2].findall(W+'tc'))==columns,'DOCX_DATA_COLUMN_COUNT'
        assert all(c.find(W+'tcPr/'+W+'gridSpan') is None for c in cells), 'DOCX_COLUMN_MERGE'
        assert all(n.get(W+'val') == '0' for c in cells for n in c.iter(W+'numId')), 'DOCX_COLUMN_LIST_NUMBERING'
        assert all(r.find(W+'trPr/'+W+'tblHeader') is not None for r in rows[:2]), 'DOCX_HEADER_NOT_REPEATED'
        assert all(r.find(W+'trPr/'+W+'cantSplit') is not None for r in rows), 'DOCX_SPLIT_TABLE_ROW'
        matches.append(values)
    assert len(matches) == (recipients if template_id in ['biot-protocol','biot-itr-protocol'] else 0), f'DOCX_TABLE_COUNT:{len(matches)}'
    if template_id.endswith('-protocol'):
        data_tables = [t for t in tree.iter(W+'tbl') if t.findall(W+'tr') and '№' in text(t.findall(W+'tr')[0])]
        assert len(data_tables) == recipients, f'DOCX_RECIPIENT_TABLE_COUNT:{len(data_tables)}'
        for table in data_tables:
            cells = table.findall(W+'tr')[2 if template_id in ['biot-protocol','biot-itr-protocol'] else 1].findall(W+'tc')
            assert text(cells[0]).strip() == '1', 'DOCX_INDIVIDUAL_ORDINAL'
            if template_id == 'ptm-protocol': assert not text(cells[-1]).strip(), 'DOCX_SIGNATURE_NOT_BLANK'
    if template_id=='ps-card':
        grades=[t for t in tree.iter(W+'tbl') if 'Пәндер атауы' in text(t)]
        assert len(grades)==recipients,'PS_GRADE_TABLE_COUNT'
        for table in grades:
            cells=table.find(W+'tr').findall(W+'tc')
            assert re.sub(r'\s+','',text(cells[0]))=='№п.п.','PS_ORDINAL_HEADER_CELL'
            assert '№' not in text(cells[2]),'PS_GRADE_HEADER_CELL'
    if template_id=='ps-witness':
        for paragraph in tree.iter(W+'p'):
            if 'Біліктілік комиссиясының' not in text(paragraph):continue
            table=next(n for n in paragraph.iterancestors() if n.tag==W+'tbl')
            cells=table.find(W+'tr').findall(W+'tc')
            assert re.fullmatch(r'\d{2}|',text(cells[4]).strip()),'PS_DECISION_DAY_CELL'
            assert not any(c.isdigit() for c in text(cells[6])),'PS_DECISION_MONTH_CELL'
    return matches


def assert_pdf_columns(path, recipients=1, expected_pages=None, expected_columns=7):
    """Read bordered cells from PDF vector lines, never a document-wide digit search.

    Coordinates and each cell's extracted value are returned as saved evidence.
    A continued table must repeat its header and the pinned form's column numbers.
    Historical six-column PDFs must explicitly request expected_columns=6.
    """
    checks = []
    with pdfplumber.open(Path(path)) as document:
        if expected_pages is not None: assert len(document.pages) == expected_pages, 'PDF_PAGE_COUNT'
        for index, page in enumerate(document.pages):
            tables = [t for t in page.find_tables() if t.extract() and 'Примечание' in ' '.join(v or '' for v in t.extract()[0])]
            assert len(tables) == 1, f'PDF_NUMBERED_TABLE_PAGE:{index+1}:{len(tables)}'
            for table in tables:
                rows = table.extract(); values = rows[1]
                assert values == [str(i) for i in range(1,expected_columns+1)], f'PDF_COLUMN_VALUES:page={index+1}:{values}'
                checks.append({'page':index+1,'tableBox':list(table.bbox),'cells':[{'column':i+1,'box':list(cell),'value':values[i]} for i,cell in enumerate(table.rows[1].cells)]})
    assert len(checks) >= recipients, 'PDF_MISSING_RECIPIENT_TABLE'
    return checks
