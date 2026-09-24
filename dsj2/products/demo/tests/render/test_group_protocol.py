"""Real group DOCX structure and one PDF regression for multi-digit ordinals."""
from copy import deepcopy
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from renderer import render_docx, convert_pdf
from group_protocol import roster_table, W
from lxml import etree as E
from test_render import fixture

MANIFEST = json.loads((ROOT / 'assets/templates/manifest.json').read_text(encoding='utf8'))
FORMS = ['pb-protocol', 'ptm-protocol', 'biot-protocol', 'biot-itr-protocol', 'ps-protocol']

def group_fixture(template_id, count):
    snapshot = fixture(template_id)
    snapshot['templateVersion'] = next(t['version'] for t in MANIFEST['groupTemplates'] if t['id'] == template_id)
    snapshot['groupEvent'] = {'id': 'group-regression', 'contractVersion': 1}
    prototype = deepcopy(snapshot['items'][0])
    snapshot['items'] = [{**deepcopy(prototype), 'id': 'person-%03d' % n,
                         'fullNameRu': 'Синтетический Слушатель %03d' % n,
                         'assignment': {**prototype['assignment'], 'eventId': 'group-regression'}}
                        for n in range(1, count + 1)]
    return snapshot

class GroupProtocolTests(unittest.TestCase):
    def test_real_1_2_25_100_rows_in_one_table_all_five_protocols(self):
        with tempfile.TemporaryDirectory(prefix='demo-group-regression-') as temp:
            for template_id in FORMS:
                for count in [1, 2, 25, 100]:
                    with self.subTest(template=template_id, count=count):
                        path = Path(temp) / (template_id + '.docx')
                        render_docx(group_fixture(template_id, count), path)
                        with ZipFile(path) as archive:
                            root = E.fromstring(archive.read('word/document.xml'))
                        table = roster_table(root)
                        rows = table.findall(W + 'tr')
                        headings = 2 if template_id.startswith('biot') else 1
                        self.assertEqual(len(rows), count + headings)
                        self.assertEqual([''.join(row.findall(W + 'tc')[0].itertext()) for row in rows[headings:]], [str(n) for n in range(1, count + 1)])
                        self.assertEqual(len(list(table.iter(W + 'tblHeader'))), headings, 'body rows cannot inherit a header flag')
                        self.assertFalse(list(table.iter(W + 'tblpPr')))
                        names = ''.join(table.itertext())
                        for n in range(1, count + 1): self.assertIn('Синтетический Слушатель %03d' % n, names)
                        for row in rows[headings:]: self.assertIsNotNone(row.find(W + 'trPr').find(W + 'cantSplit'))
                        widths = [int(column.get(W + 'w')) for column in table.find(W + 'tblGrid')]
                        self.assertGreaterEqual(widths[0], 620)
                        if template_id == 'ptm-protocol':
                            self.assertEqual(sum(widths), 9464)
                            self.assertFalse(list(rows[headings].findall(W + 'tc')[0].iter(W + 'numPr')))

    def test_ptm_100_actual_pdf_keeps_all_ordinals_and_repeats_headings(self):
        import pymupdf
        output = ROOT / 'docs/evidence/operator-value/group-layout'
        output.mkdir(parents=True, exist_ok=True)
        docx = output / 'ptm-protocol-100.docx'
        pdf = docx.with_suffix('.pdf')
        render_docx(group_fixture('ptm-protocol', 100), docx)
        convert_pdf(docx, pdf)
        document = pymupdf.open(pdf)
        ordinals = []
        per_page = []
        for index, page in enumerate(document):
            words = page.get_text('words')
            text = ' '.join(page.get_text().split())
            participants = re.findall(r'Слушатель\s+(\d{3})', text)
            if participants:
                self.assertIn('Фамилия', text, 'roster continuation must show column headings')
                ordinals.extend(int(word[4]) for word in words if 70 < word[0] < 115 and word[4].isdigit() and 1 <= int(word[4]) <= 100)
            self.assertTrue(all(word[0] >= 0 and word[1] >= 0 and word[2] <= page.rect.width + 1 and word[3] <= page.rect.height + 1 for word in words))
            per_page.append({'page': index + 1, 'participants': participants, 'columnHeadings': 'Фамилия' in text})
            page.get_pixmap(matrix=pymupdf.Matrix(1, 1)).save(output / ('ptm-protocol-100-page-%d.png' % (index + 1)))
        self.assertEqual(ordinals, list(range(1, 101)), 'actual PDF must show 10..100 completely, not only their first digit')
        text = ' '.join(' '.join(page.get_text().split()) for page in document)
        for n in range(1, 101): self.assertIn('Синтетический Слушатель %03d' % n, text)
        self.assertIn('Председатель комиссии', text)
        signature_pages = [page for page in document if 'Председатель комиссии:' in page.get_text()]
        self.assertEqual(len(signature_pages), 1)
        self.assertIn('Үлгі', signature_pages[0].get_text(), 'the last commission member and the chair must remain in one signature block')
        (output / 'ptm-protocol-100-verification.json').write_text(json.dumps({'pages': per_page, 'ordinals': ordinals, 'all100Names': True}, indent=2), encoding='utf8')

if __name__ == '__main__':
    unittest.main()
