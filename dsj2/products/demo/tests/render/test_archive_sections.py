"""Joined language forms retain first-page headers and marks on every page role."""
from copy import deepcopy
from pathlib import Path
from posixpath import normpath
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from archive_forms import combine_archive_parts, render_archive_document, W, R, PKG, CT
from source_fidelity import add_floating_mark


def package(label, top='2835', header=True):
    document = E.Element(W + 'document', nsmap={'w': W[1:-1], 'r': R[1:-1]})
    body = E.SubElement(document, W + 'body')
    E.SubElement(E.SubElement(E.SubElement(body, W + 'p'), W + 'r'), W + 't').text = label + ' BODY'
    section = E.SubElement(body, W + 'sectPr')
    if header:
        E.SubElement(section, W + 'headerReference', {W + 'type': 'first', R + 'id': 'rIdHeader'})
    E.SubElement(section, W + 'pgSz', {W + 'w': '16838', W + 'h': '11906', W + 'orient': 'landscape'})
    E.SubElement(section, W + 'pgMar', {W + 'top': top, W + 'bottom': '567', W + 'header': '709', W + 'footer': '709'})
    E.SubElement(section, W + 'titlePg')
    rels = E.Element(PKG + 'Relationships', nsmap={None: PKG[1:-1]})
    types = E.Element(CT + 'Types', nsmap={None: CT[1:-1]})
    E.SubElement(types, CT + 'Override', PartName='/word/document.xml',
                 ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')
    files = {}
    if header:
        E.SubElement(rels, PKG + 'Relationship', Id='rIdHeader',
                     Type=R[1:-1] + '/header', Target='header1.xml')
        E.SubElement(types, CT + 'Override', PartName='/word/header1.xml',
                     ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml')
        story = E.Element(W + 'hdr', nsmap={'w': W[1:-1]})
        E.SubElement(E.SubElement(E.SubElement(story, W + 'p'), W + 'r'), W + 't').text = label + ' HEADER'
        files['word/header1.xml'] = E.tostring(story)
    files.update({'word/document.xml': E.tostring(document),
                  'word/_rels/document.xml.rels': E.tostring(rels),
                  '[Content_Types].xml': E.tostring(types)})
    return files


def sections(files):
    return list(E.fromstring(files['word/document.xml']).iter(W + 'sectPr'))


def story(files, section, kind, role):
    reference = next(node for node in section.findall(W + kind + 'Reference') if node.get(W + 'type') == role)
    rels = E.fromstring(files['word/_rels/document.xml.rels'])
    target = next(node.get('Target') for node in rels if node.get('Id') == reference.get(R + 'id'))
    part = target.lstrip('/') if target.startswith('/') else normpath('word/' + target)
    root = E.fromstring(files[part])
    return part, ''.join(node.text or '' for node in root.iter(W + 't'))


class ArchiveSectionTests(unittest.TestCase):
    def test_first_page_language_headers_have_schema_order_and_keep_source_page_geometry(self):
        sources = [package('RU'), package('KZ', top='3403')]
        before = deepcopy(sources)
        combined = combine_archive_parts(sources)
        self.assertEqual(sources, before)
        actual = sections(combined)
        self.assertEqual(len(actual), 2)
        for index, section in enumerate(actual):
            original = sections(sources[index])[0]
            for tag in ('pgSz', 'pgMar'):
                self.assertEqual(section.find(W + tag).attrib, original.find(W + tag).attrib)
            self.assertIsNotNone(section.find(W + 'titlePg'))
            refs = [node.tag for node in section if node.tag in (W + 'headerReference', W + 'footerReference')]
            self.assertEqual(refs, [W + 'headerReference'] * 3 + [W + 'footerReference'] * 3)
            self.assertEqual([node.tag for node in section[:6]], refs)
            self.assertEqual(story(combined, section, 'header', 'first')[1], ['RU HEADER', 'KZ HEADER'][index])
            for role in ('default', 'even'):
                self.assertEqual(story(combined, section, 'header', role)[1], '')

    def test_mark_reaches_every_page_role_of_both_language_sections_without_replacing_headers(self):
        combined = combine_archive_parts([package('RU'), package('KZ')])
        actual = sections(combined)
        footer_parts = []
        for section in actual:
            footer_parts.append({story(combined, section, 'footer', role)[0]
                                 for role in ('first', 'default', 'even')})
        self.assertTrue(footer_parts[0].isdisjoint(footer_parts[1]))
        add_floating_mark(combined, 'SYNTHETIC PREVIEW MARK')
        for index, section in enumerate(sections(combined)):
            self.assertEqual(story(combined, section, 'header', 'first')[1], ['RU HEADER', 'KZ HEADER'][index])
            for role in ('first', 'default', 'even'):
                self.assertEqual(story(combined, section, 'footer', role)[1].count('SYNTHETIC PREVIEW MARK'), 1)

    def test_missing_next_source_header_is_blank_instead_of_inheriting_previous_identity(self):
        combined = combine_archive_parts([package('FIRST PERSON'), package('SECOND PERSON', header=False)])
        first, second = sections(combined)
        self.assertEqual(story(combined, first, 'header', 'first')[1], 'FIRST PERSON HEADER')
        for role in ('first', 'default', 'even'):
            self.assertEqual(story(combined, second, 'header', role)[1], '')

    def test_single_archive_preview_materializes_all_footer_roles_before_marking(self):
        source = package('SINGLE')
        with TemporaryDirectory() as temporary:
            output = Path(temporary) / 'preview.docx'
            with patch('archive_forms.render_archive_one', return_value=source):
                render_archive_document({'mode': 'draft-preview', 'items': [{}]}, output, Path('unused'))
            with ZipFile(output) as zipped:
                result = {name: zipped.read(name) for name in zipped.namelist()}
        section = sections(result)[0]
        self.assertEqual(story(result, section, 'header', 'first')[1], 'SINGLE HEADER')
        for role in ('first', 'default', 'even'):
            self.assertIn('ПРЕДПРОСМОТР', story(result, section, 'footer', role)[1])
        self.assertEqual(source, package('SINGLE'))

    def test_batched_bilingual_packages_keep_four_independent_headers_and_all_marked_page_roles(self):
        first = combine_archive_parts([package('FIRST RU'), package('FIRST KZ')])
        second = combine_archive_parts([package('SECOND RU'), package('SECOND KZ')])
        combined = combine_archive_parts([first, second])
        add_floating_mark(combined, 'SYNTHETIC PREVIEW MARK')
        actual = sections(combined)
        self.assertEqual(len(actual), 4)
        expected = ['FIRST RU HEADER', 'FIRST KZ HEADER', 'SECOND RU HEADER', 'SECOND KZ HEADER']
        first_headers = [story(combined, section, 'header', 'first') for section in actual]
        self.assertEqual([text for _, text in first_headers], expected)
        self.assertEqual(len({part for part, _ in first_headers}), 4)
        for section in actual:
            for role in ('first', 'default', 'even'):
                self.assertIn('SYNTHETIC PREVIEW MARK', story(combined, section, 'footer', role)[1])


if __name__ == '__main__':
    unittest.main()
