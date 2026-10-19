"""New immutable LMS v3 forms: private exam appendix, actual QR, old v1 preserved."""
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from test_lms_render import fixture, text
from renderer import render_docx, convert_pdf
from print_contracts import assert_package_contract

OUT = Path(os.environ.get('DEMO_RENDER_EVIDENCE_ROOT', str(ROOT / 'docs/evidence/mvp-all-roles-20261019/run-01/documents'))) / 'lms-v3'
OUT.mkdir(parents=True, exist_ok=True)


def snapshot(template_id):
    value = fixture(template_id, 'PAPER_ORIGINAL')
    value['templateVersion'] = 3
    lms = value['items'][0]['assignment']['lms']
    lms['verification'] = {'url': 'http://localhost:3349/verify/' + 'a' * 64}
    lms['source']['regulatorySources'] = [{'title': 'Синтетическое нормативное основание', 'number': 'TEST-21', 'date': '2026-10-19', 'revision': '1'}]
    lms['protocol'] = {
        'version': 1, 'attemptId': '00000000-0000-4000-8000-000000000003',
        'ordinal': 2, 'finishedAt': '2026-10-19T11:00:00Z', 'thresholdPercent': 80, 'comparison': 'GTE', 'percent': 90,
        'commission': [{'name': 'Синтетический председатель', 'role': 'Председатель / Төраға'}],
        'questions': [{'id': 'q1', 'promptRu': 'Как проверить готовность рабочего места?', 'promptKz': 'Жұмыс орнының дайындығын қалай тексеруге болады?',
                       'correctAnswerRu': 'По утверждённому контрольному перечню', 'correctAnswerKz': 'Бекітілген бақылау тізімі бойынша',
                       'responseRu': 'По утверждённому контрольному перечню', 'responseKz': 'Бекітілген бақылау тізімі бойынша', 'score': 1}],
        'history': [{'ordinal': 1, 'state': 'FINISHED', 'score': 7, 'maximum': 10, 'verdict': 'FAILED', 'finishedAt': '2026-10-18T11:00:00Z'},
                    {'ordinal': 2, 'state': 'FINISHED', 'score': 9, 'maximum': 10, 'verdict': 'PASSED', 'finishedAt': '2026-10-19T11:00:00Z'}],
    }
    return value


class LmsQrProtocolTests(unittest.TestCase):
    def test_real_docx_pdf_qr_and_private_protocol_appendix(self):
        import pymupdf
        evidence = []
        for template in ['lms-protocol', 'lms-certificate', 'lms-credential']:
            with self.subTest(template=template):
                value = snapshot(template)
                docx = OUT / (template + '.docx')
                render_docx(value, docx)
                assert_package_contract(docx)
                content = text(docx)
                self.assertIn(value['items'][0]['assignment']['lms']['verification']['url'], content)
                self.assertNotIn('QR_IMAGE', content)
                self.assertNotIn('QR_LINK', content)
                self.assertIn('Бумажный оригинал требует', content)
                with ZipFile(docx) as package:
                    images = [name for name in package.namelist() if name.startswith('word/media/')]
                    self.assertEqual(len(images), 1)
                    (OUT / (template + '-qr.png')).write_bytes(package.read(images[0]))
                if template == 'lms-protocol':
                    for expected in ['90%', '80%', 'Правильный ответ', 'Ответ слушателя', 'Синтетический председатель', 'Не сдал', 'контрольному перечню']:
                        self.assertIn(expected, content)
                else:
                    self.assertNotIn('контрольному перечню', content)
                pdf = docx.with_suffix('.pdf')
                convert_pdf(docx, pdf)
                with pymupdf.open(pdf) as pages:
                    self.assertEqual(len(pages), 2 if template == 'lms-protocol' else 1)
                    for index, page in enumerate(pages):
                        page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(OUT / f'{template}-page-{index + 1}.png')
                    evidence.append({'templateId': template, 'pages': len(pages), 'docxSha256': hashlib.sha256(docx.read_bytes()).hexdigest(), 'pdfSha256': hashlib.sha256(pdf.read_bytes()).hexdigest()})
        (OUT / 'FILES.json').write_text(json.dumps(evidence, indent=2), encoding='utf8')

    def test_batch_keeps_separate_qr_media_and_hyperlinks_and_is_deterministic(self):
        value = snapshot('lms-certificate')
        second = copy.deepcopy(value['items'][0])
        second['assignment']['lms']['verification']['url'] = 'http://localhost:3349/verify/' + 'b' * 64
        value['items'].append(second)
        first, again = OUT / 'batch.docx', OUT / 'batch-again.docx'
        render_docx(value, first); render_docx(value, again)
        self.assertEqual(first.read_bytes(), again.read_bytes())
        with ZipFile(first) as package:
            images = [package.read(name) for name in package.namelist() if name.startswith('word/media/')]
            self.assertEqual(len(images), 2)
            self.assertNotEqual(images[0], images[1])
            rels = package.read('word/_rels/document.xml.rels').decode()
            self.assertIn('a' * 64, rels)
            self.assertIn('b' * 64, rels)
        assert_package_contract(first)

    def test_v1_historical_form_still_uses_v1_bytes(self):
        value = fixture('lms-protocol')
        docx = OUT / 'historic-v1.docx'
        self.assertEqual(render_docx(value, docx)['renderPolicy'], 'LMS_CENTER_FORMS_V1')
        self.assertNotIn('Правильный ответ', text(docx))


if __name__ == '__main__':
    unittest.main()
