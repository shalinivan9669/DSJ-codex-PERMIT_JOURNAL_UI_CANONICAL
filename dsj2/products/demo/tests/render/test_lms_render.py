"""Fresh LMS DOCX, application PDF and image evidence. No real personal data."""
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
from lxml import etree as E
from renderer import render_docx, convert_pdf, preflight
from lms_templates import TEMPLATES, POLICY
from print_contracts import assert_package_contract

OUT = Path(os.environ.get('DEMO_RENDER_EVIDENCE_ROOT', str(ROOT / 'docs/evidence/lms-one-run-20261015'))) / 'lms-render'
OUT.mkdir(parents=True, exist_ok=True)
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def fixture(template_id, legal_form='INFORMATION_CARD'):
    return {
        'mode': 'issued-document', 'demoMode': True,
        'templateId': template_id, 'templateVersion': 1,
        'issuer': {'nameRu': 'Синтетический учебный центр', 'nameKz': 'Синтетикалық оқу орталығы'},
        'items': [{
            'id': 'synthetic-learner', 'number': 'LMS-2026-00001',
            'fullNameRu': 'Тестов Иван Петрович', 'fullNameKz': 'Әділбек Өмірсерік Қанатұлы',
            'positionRu': 'Специалист', 'positionKz': 'Маман',
            'workplaceRu': 'ТОО «Синтетический заказчик»', 'workplaceKz': '«Синтетикалық тапсырыс беруші» ЖШС',
            'assignment': {
                'documentDate': '2026-10-15', 'trainingSubject': 'Синтетическая программа обучения', 'hours': 8,
                'lms': {
                    'resultId': '00000000-0000-4000-8000-000000000001', 'resultRevision': 1,
                    'profileVersionId': '00000000-0000-4000-8000-000000000002',
                    'assessmentKind': 'CENTER_EXAM', 'legalForm': legal_form,
                    'signatureState': 'PREPARED', 'eligible': True, 'synthetic': True,
                    'course': {'titleRu': 'Синтетическая программа обучения', 'titleKz': 'Синтетикалық оқу бағдарламасы', 'hours': 8},
                    'issuer': 'Синтетический учебный центр', 'examiner': 'Синтетическая экзаменационная комиссия',
                    'examAt': '2026-10-15T09:00:00Z', 'verdict': 'PASSED', 'score': 9, 'maximum': 10,
                    'source': {}, 'requiredSignatures': [],
                },
            },
        }], 'photos': {},
    }


def text(path):
    with ZipFile(path) as archive:
        return '\n'.join(node.text or '' for node in E.fromstring(archive.read('word/document.xml')).iter(W + 't'))


class LmsRenderTests(unittest.TestCase):
    def test_01_three_new_forms_real_docx_pdf_and_png(self):
        import pymupdf
        evidence = []
        for template_id in TEMPLATES:
            with self.subTest(template_id=template_id):
                snapshot = fixture(template_id)
                docx = OUT / (template_id + '.docx')
                metadata = render_docx(snapshot, docx)
                self.assertEqual(metadata['renderPolicy'], POLICY)
                assert_package_contract(docx)
                with ZipFile(docx) as package:
                    styles = E.fromstring(package.read('word/styles.xml'))
                    title = next(style for style in styles if style.get(W + 'styleId') == 'Title')
                    self.assertFalse(list(title.iter(W + 'pBdr')))
                document_text = text(docx)
                self.assertIn('Тестов Иван Петрович', document_text)
                self.assertIn('Әділбек Өмірсерік Қанатұлы', document_text)
                self.assertIn('Информационная карточка', document_text)
                self.assertIn('9/10', document_text)
                self.assertNotIn('{{', document_text)
                self.assertNotIn('correctOptionIds', document_text)
                pdf = docx.with_suffix('.pdf')
                convert_pdf(docx, pdf)
                with pymupdf.open(pdf) as pages:
                    self.assertEqual(len(pages), 1, template_id + ': normal form must fit one page')
                    pdf_text = '\n'.join(page.get_text() for page in pages)
                    self.assertIn('Тестов Иван Петрович', pdf_text)
                    self.assertIn('Әділбек Өмірсерік Қанатұлы', pdf_text)
                    for index, page in enumerate(pages):
                        page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(OUT / f'{template_id}-page-{index + 1}.png')
                    evidence.append({'templateId': template_id, 'pages': len(pages), 'docxSha256': hashlib.sha256(docx.read_bytes()).hexdigest(), 'pdfSha256': hashlib.sha256(pdf.read_bytes()).hexdigest()})
        (OUT / 'FILES.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')

    def test_02_missing_provenance_practice_and_unverified_results_fail_closed(self):
        for mutation in ['missing', 'practice', 'ineligible']:
            snapshot = fixture('lms-certificate')
            if mutation == 'missing': snapshot['items'][0]['assignment'].pop('lms')
            elif mutation == 'practice': snapshot['items'][0]['assignment']['lms']['assessmentKind'] = 'PRACTICE'
            else: snapshot['items'][0]['assignment']['lms']['eligible'] = False
            with self.assertRaisesRegex(ValueError, 'LMS_DOCUMENT_'):
                render_docx(snapshot, OUT / f'rejected-{mutation}.docx')

    def test_03_legal_forms_preserve_external_source_and_unsigned_meaning(self):
        expectations = {
            'PAPER_ORIGINAL': 'Подготовлено для подписания на бумаге',
            'ELECTRONIC_ORIGINAL': 'Подготовленный электронный документ',
            'COPY_OF_ORIGINAL': 'Копия исходного документа',
        }
        for form, expected in expectations.items():
            snapshot = fixture('lms-certificate', form)
            data = snapshot['items'][0]['assignment']['lms']
            data.update(assessmentKind='EXTERNAL_AUTHORIZED', score=None, maximum=None,
                        source={'issuer': 'Синтетический внешний эмитент', 'documentNumber': 'EXT-42', 'documentDate': '2026-10-14', 'verification': 'DOCUMENT_REVIEWED'}, originalReference='EXT-42')
            path = OUT / f'lms-certificate-{form.lower()}.docx'
            render_docx(snapshot, path)
            content = text(path)
            self.assertIn(expected, content)
            self.assertIn('Синтетический внешний эмитент', content)
            self.assertIn('EXT-42', content)
            self.assertNotIn('9/10', content)
            self.assertNotIn('MACHINE_VERIFIED', content)
            if form == 'ELECTRONIC_ORIGINAL':
                self.assertIn('требует проверки обязательных ЭЦП', content)
            convert_pdf(path, path.with_suffix('.pdf'))

    def test_04_same_snapshot_has_identical_docx_and_batch_keeps_every_recipient(self):
        snapshot = fixture('lms-protocol')
        paths = [OUT / 'same-first.docx', OUT / 'same-second.docx']
        for path in paths: render_docx(snapshot, path)
        self.assertEqual(paths[0].read_bytes(), paths[1].read_bytes())
        second = copy.deepcopy(snapshot['items'][0])
        second['fullNameRu'] = 'Тестова Мария Ивановна'
        second['fullNameKz'] = 'Сынақ Әйгерім Қанатқызы'
        second['assignment']['lms']['resultId'] = '00000000-0000-4000-8000-000000000003'
        snapshot['items'].append(second)
        path = OUT / 'protocol-batch.docx'
        render_docx(snapshot, path)
        self.assertIn('Тестова Мария Ивановна', text(path))
        self.assertIn('Тестов Иван Петрович', text(path))
        convert_pdf(path, path.with_suffix('.pdf'))

    def test_05_preflight_uses_the_same_lms_provenance_gate(self):
        path = OUT / 'preflight.json'
        result = preflight({'snapshots': [fixture('lms-protocol')]}, path)
        self.assertEqual(result['checked'], 1)
        self.assertEqual(result['issues'], [])

    def test_06_exam_calendar_date_is_frozen_in_profile_timezone(self):
        snapshot = fixture('lms-protocol')
        snapshot['items'][0]['assignment']['lms'].update(examAt='2026-10-14T22:00:00Z', examDate='2026-10-15')
        path = OUT / 'exam-local-date.docx'
        render_docx(snapshot, path)
        self.assertIn('15.10.2026', text(path))
        self.assertNotIn('14.10.2026', text(path))


if __name__ == '__main__':
    unittest.main()
