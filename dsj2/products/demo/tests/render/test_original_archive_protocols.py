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

    def test_pb_roster_and_signatures_follow_document_flow(self):
        plan = next(p for (tid, _), (p, lang) in protocols.registry().items() if tid == 'pb-protocol' and not lang)
        for count in (1, 2, 3, 25):
            with self.subTest(count=count):
                s = snapshot('pb-protocol', count)
                s['groupEvent'] = {'contractVersion': 1}
                render_original_document(s, self.out, self.root / plan['source'])
                document = E.fromstring(inspect_package(self.out)['word/document.xml'])
                body = document.find(W + 'body')
                tables = body.findall(W + 'tbl')
                self.assertEqual(len(tables), 2)
                for table in tables:
                    self.assertIsNone(table.find(W + 'tblPr/' + W + 'tblpPr'))
                # Word merges adjacent in-flow tables; retain a separating paragraph.
                self.assertEqual(tables[0].getnext().tag, W + 'p')
                self.assertEqual(len(tables[0].findall(W + 'tr')), count + 1)

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
                    if tid != 'ps-protocol':
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

    def test_ps_assessment_columns_are_independent_in_both_languages(self):
        plan = next(p for (tid, _), (p, lang) in protocols.registry().items() if tid == 'ps-protocol' and not lang)
        extra = plan['appendSources'][0]
        s = snapshot('ps-protocol', 2)
        s['groupEvent'] = {'contractVersion': 1}
        s['originalKazakhSource'] = {'storageKey': extra['source'], 'sha256': extra['sourceSha256']}
        s['items'][0]['assignment'].update(result='85', psTheoryResult='91', psPracticalKnowledgeResult='0', psPracticalSkillsResult='78')
        s['items'][1]['assignment'].update(result='85', psTheoryResult='67', psPracticalKnowledgeResult='72', psPracticalSkillsResult='88')
        for expected in ([['91', '0', '78'], ['67', '72', '88']], [['67', '72', '88'], ['91', '0', '78']]):
            render_original_document(s, self.out, self.root / plan['source'])
            with ZipFile(self.out) as doc:
                tree = E.fromstring(doc.read('word/document.xml'))
            tables = [table for table in tree.iter(W + 'tbl') if any('Получатель 1' in ''.join(row.itertext()) or 'Тыңдаушы 1' in ''.join(row.itertext()) for row in table.findall(W + 'tr'))]
            self.assertEqual(len(tables), 2)
            for table in tables:
                rows = table.findall(W + 'tr')[1:]
                cells = [[''.join(cell.itertext()).strip() for cell in row.findall(W + 'tc')] for row in rows]
                self.assertEqual([row[2:5] for row in cells], expected)
            s['items'].reverse()
        s['items'][1]['assignment'].update(psTheoryResult='', psPracticalKnowledgeResult='64', psPracticalSkillsResult='')
        render_original_document(s, self.out, self.root / plan['source'])
        with ZipFile(self.out) as doc:
            tree = E.fromstring(doc.read('word/document.xml'))
        for table in [t for t in tree.iter(W + 'tbl') if any('Получатель 1' in ''.join(r.itertext()) or 'Тыңдаушы 1' in ''.join(r.itertext()) for r in t.findall(W + 'tr'))]:
            self.assertEqual([''.join(c.itertext()).strip() for c in table.findall(W + 'tr')[2].findall(W + 'tc')[2:5]], ['', '64', ''])
        # A legacy total is not evidence for any of the three columns.
        for item in s['items']:
            for key in ('psTheoryResult', 'psPracticalKnowledgeResult', 'psPracticalSkillsResult'):
                item['assignment'].pop(key, None)
        render_original_document(s, self.out, self.root / plan['source'])
        with ZipFile(self.out) as doc:
            tree = E.fromstring(doc.read('word/document.xml'))
        for table in [t for t in tree.iter(W + 'tbl') if any('Получатель 1' in ''.join(r.itertext()) or 'Тыңдаушы 1' in ''.join(r.itertext()) for r in t.findall(W + 'tr'))]:
            for row in table.findall(W + 'tr')[1:]:
                self.assertEqual([''.join(c.itertext()).strip() for c in row.findall(W + 'tc')[2:5]], ['', '', ''])

    def test_ps_standard_and_explicit_bilingual_results(self):
        plan = next(p for (tid, _), (p, lang) in protocols.registry().items() if tid == 'ps-protocol' and not lang)
        extra = plan['appendSources'][0]
        s = snapshot('ps-protocol')
        s['originalKazakhSource'] = {'storageKey': extra['source'], 'sha256': extra['sourceSha256']}
        s['items'][0]['assignment'].update(psTheoryResult='хорошо', psPracticalKnowledgeResult='Зачтено / Есептелді', psPracticalSkillsResult='85 / 100')
        render_original_document(s, self.out, self.root / plan['source'])
        with ZipFile(self.out) as doc:
            tree = E.fromstring(doc.read('word/document.xml'))
        tables = [table for table in tree.iter(W + 'tbl') if any('Получатель 1' in ''.join(row.itertext()) or 'Тыңдаушы 1' in ''.join(row.itertext()) for row in table.findall(W + 'tr'))]
        self.assertEqual(len(tables), 2)
        cells = [[ ''.join(cell.itertext()).strip() for cell in table.findall(W + 'tr')[1].findall(W + 'tc')][2:5] for table in tables]
        self.assertEqual(cells, [['Хорошо', 'Зачтено', '85 / 100'], ['Жақсы', 'Есептелді', '85 / 100']])


if __name__ == '__main__':
    unittest.main()
