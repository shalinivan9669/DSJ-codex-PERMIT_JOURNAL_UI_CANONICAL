"""Special ITR selects its existing paper contract, never the ordinary blank."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import unittest
from zipfile import ZipFile

import pymupdf
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from renderer import render_docx, convert_pdf, resolve_template
from test_render import fixture, EVIDENCE_ROOT, MANIFEST
from test_group_protocol import group_fixture
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


class SpecialProgramForms(unittest.TestCase):
    def test_special_individual_and_group_keep_required_actual_values_in_docx_pdf(self):
        output = EVIDENCE_ROOT / 'special-program'
        output.mkdir(parents=True, exist_ok=True)
        report = []
        for record in MANIFEST['specialTemplates']:
            group = record.get('ownerKind') == 'GROUP'
            snapshot = group_fixture(record['id'], 2) if group else fixture(record['id'])
            snapshot['templateVersion'] = record['version']
            snapshot['demoMode'] = False
            original = deepcopy(snapshot)
            name = record['id'] + ('-group' if group else '')
            path = output / (name + '.docx')
            before = hashlib.sha256((ROOT / 'assets/templates' / record['file']).read_bytes()).hexdigest()
            self.assertEqual(resolve_template(snapshot)[0]['program'], 'SPECIAL')
            render_docx(snapshot, path)
            convert_pdf(path, path.with_suffix('.pdf'))
            with ZipFile(path) as archive:
                text = ' '.join(t.text or '' for t in E.fromstring(archive.read('word/document.xml')).iter(W + 't'))
            with pymupdf.open(path.with_suffix('.pdf')) as pdf:
                pdf_text = ' '.join(page.get_text() for page in pdf)
                pages = len(pdf)
            expected = [item['fullNameRu'] for item in snapshot['items']]
            if record['id'].endswith('certificate'):
                expected += ['промышленной', 'өнеркәсіп', '40', snapshot['issuer']['headName']]
            else:
                expected += ['990240000000', 'Астана, Тестовая 1', 'Астана, Сынақ 1', '90 / 100', 'прошел / өткен', 'СЕРТ-00001']
            compact = lambda value: ''.join(value.split())
            for value in expected:
                self.assertIn(compact(value), compact(text))
                self.assertIn(compact(value), compact(pdf_text))
            self.assertNotIn('{{', text)
            self.assertEqual(snapshot, original)
            self.assertEqual(before, hashlib.sha256((ROOT / 'assets/templates' / record['file']).read_bytes()).hexdigest())
            report.append({'form': name, 'version': record['version'], 'sourceSha256': before, 'pages': pages,
                           'docxSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                           'pdfSha256': hashlib.sha256(path.with_suffix('.pdf').read_bytes()).hexdigest(),
                           'verifiedValues': expected})
        (output / 'readback.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')


if __name__ == '__main__':
    unittest.main()
