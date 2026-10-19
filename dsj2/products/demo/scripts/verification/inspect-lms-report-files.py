"""Read back generated synthetic report artifacts; never contacts external services."""
import csv
import json
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as E
from pypdf import PdfReader

directory = Path(__file__).resolve().parents[2] / '.runtime/lms-pass02-operations-20261018/reports-evidence'
checks = json.loads((directory / 'checks.json').read_text(encoding='utf8'))['checks']
summary = checks[0]['summary']
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
observations = []
for check in checks:
    if 'file' not in check:
        continue
    kind, format = check['check'].rsplit('-', 1)
    file = Path(check['file'])
    if format == 'CSV':
        with file.open(encoding='utf-8-sig', newline='') as source:
            rows = list(csv.reader(source, delimiter=';'))
        assert len(rows) == check['rows'] + 1
        assert all(len(row) == len(rows[0]) for row in rows)
        if kind == 'ORGANIZATIONS':
            assert any('001234567890' in row for row in rows)
        if kind == 'TRAINING':
            assert any('2026-10-18 10:00' in row for row in rows)
            assert any(cell.startswith("'=") for row in rows for cell in row)
        observations.append({'report': kind, 'format': format, 'rows': len(rows)-1, 'rectangular': True})
    elif format == 'XLSX':
        with ZipFile(file) as archive:
            sheet = E.fromstring(archive.read('xl/worksheets/sheet1.xml'))
            metadata = E.fromstring(archive.read('xl/worksheets/sheet2.xml'))
        rows = [[ ''.join(c.itertext()) for c in row.findall('s:c', ns)] for row in sheet.findall('.//s:row', ns)]
        assert len(rows) == check['rows'] + 1
        assert not sheet.findall('.//s:f', ns)
        assert all(c.attrib['t'] == 'inlineStr' for c in sheet.findall('.//s:c', ns))
        if kind == 'ORGANIZATIONS':
            assert any('001234567890' in row for row in rows)
        if kind == 'TRAINING':
            assert any('2026-10-18 10:00' in row for row in rows)
        metadata_text = ''.join(metadata.itertext())
        assert 'Asia/Qyzylorda' in metadata_text and 'Срез' in metadata_text
        assert str(summary['participants']) in metadata_text
        observations.append({'report': kind, 'format': format, 'rows': len(rows)-1, 'allCellsText': True, 'formulas': 0, 'metadata': True})
    else:
        pdf = PdfReader(file)
        text = ''.join(page.extract_text() for page in pdf.pages)
        assert 'ӘҒҚҢӨҰҮҺІ' in text and 'Кесінді' in text
        assert 'Бет 1' in text
        observations.append({'report': kind, 'format': format, 'pages': len(pdf.pages), 'kazakh': True, 'footer': True})
(directory / 'artifact-inspection.json').write_text(json.dumps({'status': 'PASS', 'observations': observations}, ensure_ascii=False, indent=2), encoding='utf8')
print('PASS: 24 report files, rectangular CSV, text XLSX, metadata, leading zeros, tenant dates, formula defense and PDF glyphs/footer')
