"""Both private original protocol sources survive through validation, preflight and print."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from zipfile import ZipFile
import os
import sys
import unittest

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from archive_forms import W
import original_archive_protocols as protocols
from original_archive import match_original, original_fields, render_original_document
from renderer import preflight
from template_validation import inspect_package
from test_archive_forms import snapshot


class RegistryTests(unittest.TestCase):
    def test_only_ru_ps_has_a_companion_hash_and_card_hashes_do_not_match(self):
        plans = protocols.registry()
        self.assertEqual(len(plans), 5)
        self.assertEqual([key[0] for key in plans if plans[key][1] == 'KZ'], ['ps-protocol'])
        for (tid, digest), (plan, _) in plans.items():
            self.assertEqual(len(digest), 64)
            self.assertEqual(plan['sourceSha256'], digest)
            self.assertEqual(plan['id'], tid)
        with TemporaryDirectory() as directory:
            bad = Path(directory) / 'unknown.docx'
            bad.write_bytes(b'unregistered content')
            for tid in protocols.IDS:
                self.assertFalse(match_original(bad, tid))
                with self.assertRaisesRegex(ValueError, 'PRIMARY_HASH'):
                    protocols._sources({'templateId': tid}, bad)


@unittest.skipUnless(os.environ.get('DEMO_ORIGINAL_ARCHIVE_SOURCE'), 'private archive fixtures')
class PrintedProtocolTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(os.environ['DEMO_ORIGINAL_ARCHIVE_SOURCE']).resolve()
        self.enterContext(patch.dict(os.environ, DEMO_ARTIFACT_ROOT=str(self.root)))
        self.out = Path(self.enterContext(TemporaryDirectory())) / 'printed.docx'

    def test_frozen_participants_raw_geometry_and_both_language_pages(self):
        for (tid, digest), (plan, lang) in protocols.registry().items():
            origin = self.root / plan['source']
            self.assertTrue(match_original(origin, tid))
            self.assertIn('PROTOCOL_NUMBER', original_fields(origin, tid))
            if lang:
                continue
            with self.subTest(tid=tid):
                for grouped in [False, True]:
                    s = snapshot(tid, 3 if grouped else 1)
                    s.update(templateStorageKey=plan['source'], templateChecksum=digest)
                    if grouped:
                        s['groupEvent'] = {'contractVersion': 1}
                    if plan.get('appendSources'):
                        extra = plan['appendSources'][0]
                        s['originalKazakhSource'] = {'storageKey': extra['source'], 'sha256': extra['sourceSha256']}
                    self.assertEqual(preflight({'snapshots': [s]}, self.out.with_suffix('.json'))['issues'], [])
                    render_original_document(s, self.out, origin)
                    files = inspect_package(self.out)
                    stories = [E.fromstring(data) for name, data in files.items()
                               if protocols.PART.fullmatch(name)]
                    visible = '\n'.join(''.join(q.itertext()) for q in stories)
                    self.assertNotIn('{{', visible)
                    self.assertNotIn('QNP', visible)
                    self.assertNotIn('2025 г.', visible)
                    self.assertIn('08.11.2026', visible)
                    self.assertIn('Не сдал', visible)
                    for item in s['items']:
                        self.assertIn(item['fullNameRu'], visible)
                        self.assertIn(item['fullNameKz'], visible)
                    with ZipFile(origin) as src:
                        original = E.fromstring(src.read('word/document.xml'))
                        if tid != 'ps-protocol':
                            self.assertEqual(src.read('word/styles.xml'), files['word/styles.xml'])
                    document = E.fromstring(files['word/document.xml'])
                    table = next(document.iter(W + 'tbl'))
                    original_table = next(original.iter(W + 'tbl'))
                    self.assertEqual(len(table.findall(W + 'tr')), plan['roster']['headerRows'] + len(s['items']))
                    # Original page size, margins, grid widths and signature rows remain intact.
                    for key in ('pgSz', 'pgMar', 'gridCol', 'tcW'):
                        a = original if key.startswith('pg') else original_table.find(W + 'tr') if key == 'tcW' else original_table
                        b = document if key.startswith('pg') else table.find(W + 'tr') if key == 'tcW' else table
                        attrs = lambda root: [dict(node.attrib) for node in root.iter(W + key)]
                        expected = attrs(a)
                        self.assertEqual(attrs(b)[:len(expected)], expected)
                    if tid == 'ps-protocol':
                        self.assertIn('Оценка теоретических знаний', visible)
                        self.assertIn('Теориялық білім бағасы', visible)
                        self.assertGreaterEqual(len(list(document.iter(W + 'sectPr'))), 2)
                    self.assertFalse(any(n.startswith(('customXml/', 'word/recipientData', 'word/embeddings/')) for n in files))

    def test_kazakh_side_cannot_replace_the_main_or_be_substituted(self):
        plan = next(p for (tid, _), (p, lang) in protocols.registry().items() if tid == 'ps-protocol' and not lang)
        origin = self.root / plan['source']
        secondary = plan['appendSources'][0]
        s = snapshot('ps-protocol')
        for ref, error in [(None, 'KZ_REQUIRED'),
                           ({'storageKey': plan['source'], 'sha256': plan['sourceSha256']}, 'KZ_REQUIRED'),
                           ({'storageKey': '../outside.docx', 'sha256': secondary['sourceSha256']}, 'KZ_PATH'),
                           ({'storageKey': plan['source'], 'sha256': secondary['sourceSha256']}, 'KZ_HASH')]:
            with self.subTest(ref=ref):
                s['originalKazakhSource'] = ref
                with self.assertRaisesRegex(ValueError, error):
                    render_original_document(s, self.out, origin)
        with self.assertRaisesRegex(ValueError, 'PRIMARY_HASH'):
            render_original_document(s, self.out, self.root / secondary['source'])


if __name__ == '__main__':
    unittest.main()
