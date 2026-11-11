"""Signature delivery copies preserve originals and never turn names into evidence."""
import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from signature_copy import signature_copy, paragraph, W, R, PKG, CT, MARKER
from sanitize_templates import deterministic_zip
from print_contracts import assert_package_contract

V = '{urn:schemas-microsoft-com:vml}'
MC = '{http://schemas.openxmlformats.org/markup-compatibility/2006}'


class SignatureCopyTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.source = self.root / 'original.docx'; self.output = self.root / 'copy.docx'
        self.payload = {'inputPath': str(self.source), 'format': 'DOCX',
            'templateId': 'biot-worker-card', 'documentNumber': 'УД-00001',
            'sourcePdfSha256': 'a' * 64, 'sourcePdfArtifactId': 'original-pdf',
            'localTest': True, 'signers': [{'role': 'DIRECTOR', 'displayName': 'Иванов Иван Иванович',
                'receivedAt': '11.11.2026 10:42 UTC+5', 'identityNote': 'Имя прочитано из сертификата; НУЦ не проверен.'}],
            'pendingRoles': ['CHAIR', 'TEACHER'],
            'verificationUrl': 'http://localhost:3170/signature-evidence/original-pdf'}

    def package(self, alternatives=False, height=180, flow=False):
        document = E.Element(W + 'document', nsmap={'w': W[1:-1], 'r': R[1:-1], 'v': V[1:-1], 'mc': MC[1:-1]})
        body = E.SubElement(document, W + 'body')
        body.append(paragraph('Получатель Петров. Исходный председатель Сидоров.', 10))
        if not flow:
            for index in range(3):
                host = E.SubElement(E.SubElement(body, W + 'p'), W + 'r')
                parents = [host]
                if alternatives:
                    alternate = E.SubElement(host, MC + 'AlternateContent')
                    parents = [E.SubElement(alternate, MC + kind) for kind in ['Choice', 'Fallback']]
                for parent in parents:
                    shape = E.SubElement(E.SubElement(parent, W + 'pict'), V + 'shape', id='card' + str(index),
                                         style=f'position:absolute;width:260pt;height:{height}pt')
                    box = E.SubElement(E.SubElement(shape, V + 'textbox'), W + 'txbxContent')
                    box.append(paragraph('Председатель комиссии Сидоров С. С.', 10))
                    box.append(paragraph('Протокол № ' + ('ПР-00001 от 10.11.2026' if index < 2 else '_____ от __.__.20__'), 9))
        section = E.SubElement(body, W + 'sectPr')
        E.SubElement(section, W + 'pgSz', {W + 'w': '16838', W + 'h': '11906', W + 'orient': 'landscape'})
        E.SubElement(section, W + 'pgMar', {W + 'top': '0', W + 'left': '0', W + 'right': '0', W + 'bottom': '0'})
        styles = E.Element(W + 'styles', nsmap={'w': W[1:-1]})
        files = {'word/document.xml': E.tostring(document), 'word/styles.xml': E.tostring(styles),
            'word/_rels/document.xml.rels': E.tostring(E.Element(PKG + 'Relationships', nsmap={None: PKG[1:-1]})),
            '[Content_Types].xml': E.tostring(E.Element(CT + 'Types', nsmap={None: CT[1:-1]})),
            'word/media/original-photo.png': b'original bytes kept untouched'}
        deterministic_zip(self.source, files)
        return files

    def read(self):
        assert_package_contract(self.output)
        with ZipFile(self.output) as archive:
            return {name: archive.read(name) for name in archive.namelist()}

    def test_both_printed_cards_marked_but_blank_renewal_and_source_names_unchanged(self):
        files = self.package(); before = self.source.read_bytes()
        result = signature_copy(self.payload, self.output, None); copied = self.read()
        root = E.fromstring(copied['word/document.xml']); boxes = list(root.iter(W + 'txbxContent'))
        self.assertEqual(result['markedPanels'], 2)
        self.assertEqual([sum('Подписано ЭЦП' in (n.text or '') for n in box.iter(W + 't')) for box in boxes], [1, 1, 0])
        for old, new in zip(E.fromstring(files['word/document.xml']).iter(W + 'txbxContent'), boxes):
            original_text = [n.text for n in old.iter(W + 't')]
            self.assertEqual([n.text for n in new.iter(W + 't')][:len(original_text)], original_text)
        self.assertEqual(self.source.read_bytes(), before)
        self.assertEqual(copied['word/media/original-photo.png'], files['word/media/original-photo.png'])
        evidence = json.loads(copied[MARKER])
        self.assertEqual(evidence['originalDocxSha256'], hashlib.sha256(before).hexdigest())
        self.assertEqual(evidence['detachedSignatureTarget'], 'ORIGINAL_PDF')

    def test_drawingml_and_vml_alternatives_get_matching_marks(self):
        self.package(alternatives=True)
        result = signature_copy(self.payload, self.output, None)
        self.assertEqual(result['markedPanels'], 4)
        root = E.fromstring(self.read()['word/document.xml'])
        for alternate in root.iter(MC + 'AlternateContent'):
            choice, fallback = list(alternate)
            self.assertEqual(list(choice.itertext()), list(fallback.itertext()))

    def test_ps_marks_signature_panel_not_exam_panel_with_independent_floating_table(self):
        files = self.package(); root = E.fromstring(files['word/document.xml'])
        boxes = list(root.iter(W + 'txbxContent'))
        for node in list(boxes[1]):
            boxes[1].remove(node)
        boxes[1].append(paragraph('Выпускной экзамен. Практическое обучение. Оценки.', 8))
        exam_before = E.tostring(boxes[1])
        files['word/document.xml'] = E.tostring(root); deterministic_zip(self.source, files)
        self.payload['templateId'] = 'ps-card'
        result = signature_copy(self.payload, self.output, None)
        copied_boxes = list(E.fromstring(self.read()['word/document.xml']).iter(W + 'txbxContent'))
        self.assertEqual(result['markedPanels'], 1)
        self.assertEqual(E.tostring(copied_boxes[1]), exam_before)

    def test_evidence_sheet_is_new_portrait_section_with_qr_and_explicit_partial_test_status(self):
        self.package(); signature_copy(self.payload, self.output, None)
        files = self.read(); root = E.fromstring(files['word/document.xml']); sections = list(root.iter(W + 'sectPr'))
        self.assertEqual(len(sections), 2)
        self.assertEqual(sections[0].find(W + 'pgSz').get(W + 'orient'), 'landscape')
        self.assertEqual(sections[1].find(W + 'pgSz').get(W + 'w'), '11906')
        visible = ' '.join(n.text or '' for n in root.iter(W + 't'))
        for value in ['ТЕСТ ЭЦП', 'НУЦ не проверены', 'Иванов Иван Иванович', 'Частично.',
                      'ПОДПИСАНО ЧАСТИЧНО', 'Председатель комиссии, Преподаватель',
                      '11.11.2026 10:42 UTC+5', 'не к файлу с этими отметками',
                      self.payload['verificationUrl'], 'a' * 32]:
            self.assertIn(value, visible)
        self.assertTrue(files['word/media/signature-copy-qr.png'].startswith(b'\x89PNG\r\n\x1a\n'))
        self.assertNotIn('Сидоров', files[MARKER].decode('utf8'))

    def test_no_signature_does_not_infer_evidence_from_original_commission_names(self):
        self.package(); self.payload['signers'] = []; self.payload.pop('verificationUrl')
        signature_copy(self.payload, self.output, None)
        self.assertEqual(self.output.read_bytes(), self.source.read_bytes())
        self.assertNotIn(MARKER, self.read())

    def test_hosted_test_copy_keeps_test_marks_and_authenticated_https_qr(self):
        self.package()
        self.payload.update(mockMode='HOSTED_TEST_MOCK', testMode=True,
            verificationUrl='https://training.example.test/signature-evidence/original-pdf')
        original = self.source.read_bytes()
        signature_copy(self.payload, self.output, None)
        files = self.read()
        visible = ' '.join(E.fromstring(files['word/document.xml']).itertext())
        self.assertIn('ТЕСТ ЭЦП — проверка НУЦ не выполнялась', visible)
        self.assertIn('Тестовый режим.', visible)
        self.assertIn('Это не публичная проверка НУЦ.', visible)
        self.assertIn(self.payload['verificationUrl'], visible)
        self.assertNotIn('Локальный тест', visible)
        self.assertNotIn('в локальном приложении', visible)
        self.assertEqual(self.source.read_bytes(), original)

    def test_pdf_converter_receives_decorated_docx_and_original_stays_untouched(self):
        self.package(flow=True); before = self.source.read_bytes()
        self.payload.update(format='PDF', templateId='biot-protocol', localTest=False, pendingRoles=[])
        seen = []
        def convert(source, target):
            with ZipFile(source) as archive:
                seen.append(archive.read('word/document.xml'))
            Path(target).write_bytes(b'%PDF-test')
        result = signature_copy(self.payload, self.output, convert)
        visible = ' '.join(E.fromstring(seen[0]).itertext())
        self.assertIn('Копия с отметками ЭЦП', visible)
        self.assertNotIn('ТЕСТ ЭЦП', visible)
        self.assertEqual(self.output.read_bytes(), b'%PDF-test')
        self.assertEqual(self.source.read_bytes(), before)
        self.assertEqual(result['markedPanels'], 0)

    def test_refuses_clipping_unknown_card_and_redecorating_a_delivery_copy(self):
        self.package(height=10)
        with self.assertRaisesRegex(ValueError, 'MARK_DOES_NOT_FIT'):
            signature_copy(self.payload, self.output, None)
        self.package(flow=True)
        with self.assertRaisesRegex(ValueError, 'ACTIVE_PANEL_NOT_FOUND'):
            signature_copy(self.payload, self.output, None)
        self.package(); signature_copy(self.payload, self.output, None)
        self.payload['inputPath'] = str(self.output)
        with self.assertRaisesRegex(ValueError, 'REQUIRES_ORIGINAL'):
            signature_copy(self.payload, self.root / 'second.docx', None)

    def test_rejects_untrusted_links_and_malformed_evidence(self):
        self.package()
        for update in [{'verificationUrl': 'https://example.test/signature-evidence/id?token=secret'},
                       {'verificationUrl': 'javascript:alert(1)'}, {'sourcePdfSha256': 'bad'},
                       {'localTest': 'false'}, {'signers': [{'role': 'DIRECTOR'}]}]:
            with self.subTest(update=update), self.assertRaises(ValueError):
                signature_copy({**self.payload, **update}, self.output, None)

    def test_unknown_certificate_owner_is_not_turned_into_a_surname_and_many_flow_signers_are_allowed(self):
        self.package(flow=True)
        self.payload['templateId'] = 'biot-protocol'
        self.payload['signers'][0]['displayName'] = 'Имя владельца сертификата не определено'
        self.payload['signers'] *= 30
        signature_copy(self.payload, self.output, None)
        visible = ' '.join(E.fromstring(self.read()['word/document.xml']).itertext())
        self.assertIn('Подписано ЭЦП: имя владельца не определено', visible)
        self.assertNotIn('Имя в. с. н. о.', visible)
        self.assertEqual(visible.count('Директор: Имя владельца сертификата не определено'), 30)

    def test_output_can_never_overwrite_original(self):
        self.package(); before = self.source.read_bytes()
        with self.assertRaisesRegex(ValueError, 'OUTPUT_MUST_DIFFER'):
            signature_copy(self.payload, self.source, None)
        self.assertEqual(self.source.read_bytes(), before)

    def test_source_continuous_section_stays_continuous_to_avoid_blank_page_before_evidence(self):
        files = self.package()
        root = E.fromstring(files['word/document.xml'])
        section = root.find(W + 'body/' + W + 'sectPr')
        section.insert(0, E.Element(W + 'type', {W + 'val': 'continuous'}))
        files['word/document.xml'] = E.tostring(root); deterministic_zip(self.source, files)
        signature_copy(self.payload, self.output, None)
        sections = list(E.fromstring(self.read()['word/document.xml']).iter(W + 'sectPr'))
        self.assertEqual(sections[0].find(W + 'type').get(W + 'val'), 'continuous')
        self.assertEqual(sections[1].find(W + 'type').get(W + 'val'), 'nextPage')


if __name__ == '__main__':
    unittest.main()
