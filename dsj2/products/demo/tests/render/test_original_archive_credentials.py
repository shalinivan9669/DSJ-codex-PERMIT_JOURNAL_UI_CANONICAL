"""Guard the printed fields and the boundary between the archive cover and its insert."""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from lxml import etree as E
from test_archive_forms import W, snapshot
from original_archive import match_original, render_original_document
from original_archive_credentials import SOURCES
from template_validation import inspect_package


@unittest.skipUnless(os.environ.get('DEMO_ORIGINAL_ARCHIVE_SOURCE'), 'private archive fixtures')
class CredentialTests(unittest.TestCase):
    def test_certificate_overprint_and_witness_cover(self):
        root = Path(os.environ['DEMO_ORIGINAL_ARCHIVE_SOURCE'])
        with TemporaryDirectory() as directory:
            for template_id, (filename, _) in SOURCES.items():
                with self.subTest(template_id=template_id):
                    original = root / filename
                    self.assertTrue(match_original(original, template_id))
                    with ZipFile(original) as source:
                        before = E.fromstring(source.read('word/document.xml'))
                    state = snapshot(template_id)
                    state['issuer']['cityRu'] = 'Алматы'
                    output = Path(directory) / (template_id + '.docx')
                    render_original_document(state, output, original)
                    parts = inspect_package(output)
                    after = E.fromstring(parts['word/document.xml'])
                    self.assertEqual(next(before.iter(W + 'pgSz')).attrib, next(after.iter(W + 'pgSz')).attrib)
                    fields = ''.join(t.text or '' for t in after.iter(W + 't'))
                    self.assertNotIn('{{', fields)
                    for value in ('Получатель 1', 'Алматы', 'УД-1'):
                        self.assertIn(value, fields)
                    if template_id == 'ps-witness':
                        for value in ('КУӘЛІК', 'СВИДЕТЕЛЬСТВО', 'ПР-7'):
                            self.assertIn(value, fields)
                        self.assertEqual(len(list(after.iter(W + 'pgSz'))), 2)
                    else:
                        self.assertEqual(len(list(before.iter(W + 'p'))), len(list(after.iter(W + 'p'))))
                        for value in ('«ҚАУІПСІЗДІК»', '«БЕЗОПАСНОСТЬ»', 'Директор Отдельный', 'ноября'):
                            self.assertIn(value, fields)
