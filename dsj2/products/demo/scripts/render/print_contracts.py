"""Independent structural DOCX and physical PDF table acceptance assertions."""
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
import pdfplumber

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def text(node):
    return ''.join(n.text or '' for n in node.iter(W+'t'))


def assert_docx_columns(path, template_id, recipients=1):
    with ZipFile(path) as archive: tree = E.fromstring(archive.read('word/document.xml'))
    matches = []
    for table in tree.iter(W+'tbl'):
        rows = table.findall(W+'tr')
        if not rows or 'Примечание' not in text(rows[0]) or '№' not in text(rows[0]): continue
        assert template_id == 'biot-protocol', 'Unexpected numbered-column table'
        cells = rows[1].findall(W+'tc')
        values = [text(c).strip() for c in cells]
        assert values == ['1','2','3','4','5','6'], f'DOCX_COLUMN_VALUES:{values}'
        assert all(c.find(W+'tcPr/'+W+'gridSpan') is None for c in cells), 'DOCX_COLUMN_MERGE'
        assert all(n.get(W+'val') == '0' for c in cells for n in c.iter(W+'numId')), 'DOCX_COLUMN_LIST_NUMBERING'
        assert all(r.find(W+'trPr/'+W+'tblHeader') is not None for r in rows[:2]), 'DOCX_HEADER_NOT_REPEATED'
        assert all(r.find(W+'trPr/'+W+'cantSplit') is not None for r in rows), 'DOCX_SPLIT_TABLE_ROW'
        matches.append(values)
    assert len(matches) == (recipients if template_id == 'biot-protocol' else 0), f'DOCX_TABLE_COUNT:{len(matches)}'
    if template_id.endswith('-protocol'):
        data_tables = [t for t in tree.iter(W+'tbl') if t.findall(W+'tr') and '№' in text(t.findall(W+'tr')[0])]
        assert len(data_tables) == recipients, f'DOCX_RECIPIENT_TABLE_COUNT:{len(data_tables)}'
        for table in data_tables:
            cells = table.findall(W+'tr')[2 if template_id == 'biot-protocol' else 1].findall(W+'tc')
            assert text(cells[0]).strip() == '1', 'DOCX_INDIVIDUAL_ORDINAL'
            if template_id == 'ptm-protocol': assert not text(cells[-1]).strip(), 'DOCX_SIGNATURE_NOT_BLANK'
    return matches


def assert_pdf_columns(path, recipients=1, expected_pages=None):
    """Read bordered cells from PDF vector lines, never a document-wide digit search.

    Coordinates and each cell's extracted value are returned as saved evidence.
    A continued table must repeat its header and the exact 1..6 on that page.
    """
    checks = []
    with pdfplumber.open(Path(path)) as document:
        if expected_pages is not None: assert len(document.pages) == expected_pages, 'PDF_PAGE_COUNT'
        for index, page in enumerate(document.pages):
            tables = [t for t in page.find_tables() if t.extract() and 'Примечание' in ' '.join(v or '' for v in t.extract()[0])]
            assert len(tables) == 1, f'PDF_NUMBERED_TABLE_PAGE:{index+1}:{len(tables)}'
            for table in tables:
                rows = table.extract(); values = rows[1]
                assert values == ['1','2','3','4','5','6'], f'PDF_COLUMN_VALUES:page={index+1}:{values}'
                checks.append({'page':index+1,'tableBox':list(table.bbox),'cells':[{'column':i+1,'box':list(cell),'value':values[i]} for i,cell in enumerate(table.rows[1].cells)]})
    assert len(checks) >= recipients, 'PDF_MISSING_RECIPIENT_TABLE'
    return checks
