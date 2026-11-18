"""Original uploads are identified by bytes, then safely filled without refitting the card."""
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import os
import sys
import unittest
from zipfile import ZipFile

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from archive_forms import CT, PKG, R, W
from original_archive import (CARD_IDS, _blueprints, _projection, match_original, original_fields,
                              render_original_document, render_original_one)
from sanitize_templates import deterministic_zip
from template_validation import inspect_package
from test_archive_forms import snapshot
from test_archive_sections import package


def geometry(root, tags):
    return [(node.tag, dict(node.attrib)) for node in root.iter() if node.tag in tags]


class OriginalArchiveCardTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / 'original.docx'
        self.parts = package('STATIC', header=False)
        tree = E.fromstring(self.parts['word/document.xml'])
        para = tree.find(W + 'body/' + W + 'p')
        props = E.Element(W + 'pPr')
        para.insert(0, props)
        E.SubElement(props, W + 'ind', {W + 'firstLine': '-210'})
        field = E.SubElement(para, W + 'fldSimple', {W + 'instr': 'MERGEFIELD Person'})
        run = E.SubElement(field, W + 'r')
        E.SubElement(E.SubElement(run, W + 'rPr'), W + 'sz', {W + 'val': '29'})
        E.SubElement(run, W + 't').text = 'CACHED_SAMPLE'
        self.parts['word/document.xml'] = E.tostring(tree)
        settings = E.Element(W + 'settings')
        E.SubElement(settings, W + 'mailMerge')
        self.parts['word/settings.xml'] = E.tostring(settings)
        rels = E.Element(PKG + 'Relationships')
        E.SubElement(rels, PKG + 'Relationship', Id='rId1', Type=R[1:-1] + '/mailMergeSource',
                     TargetMode='External', Target='file:///old-source.xls')
        self.parts['word/_rels/settings.xml.rels'] = E.tostring(rels)
        self.parts['word/recipientData.xml'] = b'<cached>CACHED_SAMPLE</cached>'
        self.parts['word/styles.xml'] = E.tostring(E.Element(W + 'styles'))
        types = E.fromstring(self.parts['[Content_Types].xml'])
        E.SubElement(types, CT + 'Override', PartName='/word/recipientData.xml', ContentType='application/xml')
        self.parts['[Content_Types].xml'] = E.tostring(types)
        deterministic_zip(self.source, self.parts)
        plan = {'id': 'pb-card', 'source': 'original.docx',
                'sourceSha256': sha256(self.source.read_bytes()).hexdigest(),
                'mergeFields': {'Person': 'FULL_NAME_RU'}}
        plans = {tid: {**plan, 'sourceSha256': '0' * 64} for tid in CARD_IDS}
        plans['pb-card'] = plan
        self.enterContext(patch('original_archive._blueprints', return_value=plans))
        self.enterContext(patch('original_archive_slots.apply_original_card_slots'))
        self.addCleanup(_projection.cache_clear)

    def test_sha_and_type_pin_precede_any_processing(self):
        self.assertTrue(match_original(self.source, 'pb-card'))
        self.assertFalse(match_original(self.source, 'ptm-card'))
        self.assertFalse(match_original(self.source, 'pb-protocol'))
        self.assertEqual(original_fields(self.source, 'pb-card'), ['FULL_NAME_RU'])
        self.source.write_bytes(self.source.read_bytes() + b'changed')
        self.assertFalse(match_original(self.source, 'pb-card'))
        with self.assertRaisesRegex(ValueError, 'ARCHIVE_SOURCE_HASH'):
            original_fields(self.source, 'pb-card')

    def test_fill_preserves_field_style_geometry_and_isolates_two_recipients(self):
        s = snapshot('pb-card', 2)
        data = self.source.read_bytes()
        first = render_original_one(s, s['items'][0], self.source)
        tags = {W + key for key in ('ind', 'rPr', 'sz', 'pgMar', 'pgSz', 'tab')}
        before = E.fromstring(self.parts['word/document.xml'])
        after = E.fromstring(first['word/document.xml'])
        self.assertEqual(geometry(after, tags), geometry(before, tags))
        self.assertEqual(first['word/styles.xml'], self.parts['word/styles.xml'])
        self.assertNotIn('word/recipientData.xml', first)
        self.assertFalse(any(b'CACHED_SAMPLE' in content or b'file:///old' in content
                             for content in first.values()))
        self.assertIsNone(E.fromstring(first['word/settings.xml']).find(W + 'mailMerge'))
        run = next(node for node in after.iter(W + 'r') if node.find(W + 'rPr/' + W + 'sz') is not None)
        self.assertEqual(run.findtext(W + 't'), s['items'][0]['fullNameRu'])
        out = self.source.with_name('both.docx')
        render_original_document(s, out, self.source)
        batch = inspect_package(out)
        root = E.fromstring(batch['word/document.xml'])
        self.assertEqual([n.text for n in root.iter(W + 't') if n.text in
                          [item['fullNameRu'] for item in s['items']]],
                         [item['fullNameRu'] for item in s['items']])
        self.assertEqual(batch['word/styles.xml'], self.parts['word/styles.xml'])
        self.assertFalse(any('ArchiveBlank' in name for name in batch))
        self.assertEqual(self.source.read_bytes(), data)


@unittest.skipUnless(os.environ.get('DEMO_ORIGINAL_ARCHIVE_SOURCE'), 'private original card fixture directory')
class RegisteredOriginalCardTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('DEMO_SOFFICE'), 'pinned converter required')
    def test_profession_grades_start_below_the_exam_labels(self):
        import pymupdf
        from renderer import convert_pdf

        form = 'ps-card'
        source = Path(os.environ['DEMO_ORIGINAL_ARCHIVE_SOURCE']) / _blueprints()[form]['source']
        data = snapshot(form)
        item = data['items'][0]
        item.update(fullNameRu='Примеров Арман', fullNameKz='Примеров Арман')
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / 'card.docx'
            render_original_document(data, path, source)
            convert_pdf(path, path.with_suffix('.pdf'))
            with pymupdf.open(path.with_suffix('.pdf')) as doc:
                page = doc[0]
                practical, = page.search_for('Практическое обучение:')
                self.assertGreater(practical.x0, 298)
                header, = page.search_for('Наименование дисциплины')
                self.assertGreater(header.y0, practical.y1)
                front = pymupdf.Rect(0, 30, 298, 232)
                self.assertEqual(len(page.search_for('Примеров Арман', clip=front)), 1)
                self.assertEqual(len(page.search_for('М.П.', clip=front)), 1)
                for printed_page in doc:
                    stamps = [span for block in printed_page.get_text('dict')['blocks']
                              for line in block.get('lines', []) for span in line['spans']
                              if span['color'] == 0x0070c0 and span['text'].strip()]
                    self.assertEqual(len(stamps), 4)
                    for span in stamps:
                        self.assertLess(8, span['bbox'][0])
                        self.assertLess(span['bbox'][2], printed_page.rect.width - 8)

    def test_all_registered_uploads_preserve_paper_geometry(self):
        root = Path(os.environ['DEMO_ORIGINAL_ARCHIVE_SOURCE'])
        vml = '{urn:schemas-microsoft-com:vml}'
        # Field paragraphs may adapt their typography and padding to real
        # values. The paper, panel and table grid dimensions must remain fixed.
        tags = {W + k for k in ('pgMar', 'pgSz', 'tblGrid', 'gridCol')}
        tags.update(vml + k for k in ('rect', 'line', 'shape', 'textbox'))
        self.assertEqual(set(_blueprints()), CARD_IDS)
        for tid, plan in _blueprints().items():
            with self.subTest(tid=tid):
                path = root / plan['source']
                self.assertTrue(match_original(path, tid))
                self.assertTrue({'FULL_NAME_RU', 'FULL_NAME_BOTH'} & set(original_fields(path, tid)))
                with ZipFile(path) as raw:
                    document = E.fromstring(raw.read('word/document.xml'))
                    styles = raw.read('word/styles.xml')
                s = snapshot(tid)
                files = render_original_one(s, s['items'][0], path)
                tree = E.fromstring(files['word/document.xml'])
                if tid == 'ps-card':
                    # The one two-sheet-wide stamp table is fitted to a single
                    # page. The grade grid and all other paper geometry stay fixed.
                    strip = next(t for t in document.iter(W + 'tbl') if
                                 t.find(W + 'tblPr/' + W + 'tblW').get(W + 'w') == '23750')
                    for col, width in zip(strip.find(W + 'tblGrid'), ('5937', '5938')):
                        col.set(W + 'w', width)
                def paper(tree):
                    return [(tag, {k: v for k, v in attrs.items() if E.QName(k).localname not in
                                   ('gfxdata', 'alt', 'title', 'descr')}) for tag, attrs in geometry(tree, tags)]
                self.assertEqual(paper(tree), paper(document))
                self.assertEqual(files['word/styles.xml'], styles)
                self.assertFalse(any(name.startswith(('word/recipientData', 'customXml/', 'word/embeddings/'))
                                     for name in files))
                self.assertFalse(any('TargetMode="External"' in blob.decode('utf8') for name, blob in files.items()
                                     if name.endswith('.rels')))
                visible = ''.join(n.text or '' for n in tree.iter(W + 't'))
                self.assertIn(s['items'][0]['fullNameRu'], visible)
                self.assertNotIn('{{', visible)


if __name__ == '__main__':
    unittest.main()
