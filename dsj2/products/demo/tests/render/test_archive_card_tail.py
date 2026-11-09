"""PB card padding and its photo column must not consume printable content."""
from pathlib import Path
import json
import sys
import unittest

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from archive_forms import W, R, PKG, MARKER, LAYOUT_POLICY, _prepare_layout, _trim_pb_card_empty_tail, _pin_pb_photo_to_source_frame, render_archive_one
from sanitize_templates import deterministic_zip
import test_archive_forms as fixtures


class ArchiveCardTailTests(unittest.TestCase):
    def document(self):
        root = E.Element(W + 'document')
        body = E.SubElement(root, W + 'body')
        body.append(fixtures.paragraph('Printed content'))
        for _ in range(125):
            body.append(fixtures.paragraph(''))
        section = E.SubElement(body, W + 'sectPr')
        E.SubElement(section, W + 'pgSz', {W + 'w': '11906', W + 'h': '16838'})
        return root, body

    def test_inert_tail_becomes_one_minimal_paragraph_without_changing_content_or_page(self):
        root, body = self.document()
        first, section = E.tostring(body[0]), E.tostring(body[-1])
        _trim_pb_card_empty_tail(root)
        self.assertEqual(len(body), 3)
        self.assertEqual(E.tostring(body[0]), first)
        self.assertEqual(E.tostring(body[-1]), section)
        self.assertEqual(body[1].find(W + 'pPr/' + W + 'spacing').get(W + 'line'), '20')

    def test_explicit_break_bookmark_and_drawing_anchors_are_never_removed(self):
        for kind in ['break', 'bookmark', 'drawing']:
            with self.subTest(kind=kind):
                root, body = self.document()
                protected = fixtures.paragraph('')
                if kind == 'break':
                    E.SubElement(E.SubElement(protected, W + 'r'), W + 'br', {W + 'type': 'page'})
                elif kind == 'bookmark':
                    E.SubElement(protected, W + 'bookmarkStart', {W + 'id': '1', W + 'name': 'Anchor'})
                else:
                    E.SubElement(E.SubElement(protected, W + 'r'), W + 'drawing')
                body.insert(2, protected)
                original = E.tostring(protected)
                _trim_pb_card_empty_tail(root)
                self.assertIs(protected.getparent(), body)
                self.assertEqual(E.tostring(protected), original)
                self.assertEqual(body.index(protected), 2)

    def helper(self):
        helper = fixtures.ArchiveFormsTests()
        helper.setUp(); self.addCleanup(helper.doCleanups)
        return helper

    def test_bilingual_workplace_reserves_photo_column_without_moving_frame(self):
        _, files = self.helper().package(tid='pb-card', box=True, layout=True)
        tree = E.fromstring(files['word/document.xml'])
        box = next(tree.iter(W + 'txbxContent'))
        workplace = fixtures.paragraph('{{WORKPLACE_BOTH}}')
        box.append(workplace)
        shape = box.getparent().getparent()
        shape_before = dict(shape.attrib)
        marker = json.loads(files[MARKER]); marker['fieldLayoutPolicy'] = LAYOUT_POLICY
        states = _prepare_layout(tree, marker, files)
        self.assertTrue(states)
        self.assertEqual(workplace.find(W + 'pPr/' + W + 'ind').get(W + 'left'), '2000')
        self.assertEqual(''.join(workplace.itertext()), '{{WORKPLACE_BOTH}}')
        self.assertEqual(dict(shape.attrib), shape_before)
        name_run = box.find(W + 'p/' + W + 'r')
        self.assertLessEqual(int(name_run.find(W + 'rPr/' + W + 'sz').get(W + 'val')), 20)

    def test_tail_normalization_is_limited_to_pb_render(self):
        for template_id, expected in [('pb-card', 1), ('ptm-card', 125)]:
            with self.subTest(template_id=template_id):
                path, files = self.helper().package(tid=template_id)
                tree = E.fromstring(files['word/document.xml']); body = tree.find(W + 'body')
                for _ in range(125):body.insert(len(body) - 1, fixtures.paragraph(''))
                files['word/document.xml'] = E.tostring(tree); deterministic_zip(path, files)
                snapshot = fixtures.snapshot(template_id)
                result = render_archive_one(snapshot, snapshot['items'][0], path)
                result_body = E.fromstring(result['word/document.xml']).find(W + 'body')
                tail = []
                for node in reversed(list(result_body)[:-1]):
                    if ''.join(node.itertext()).strip():break
                    tail.append(node)
                self.assertEqual(len(tail), expected)

    def test_only_photo_image_is_aligned_inside_existing_fixed_frame(self):
        wp = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
        a = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
        root = E.Element(W + 'document')
        frame = E.SubElement(root, '{urn:schemas-microsoft-com:vml}rect', style='position:absolute;margin-top:121.5pt;width:59.8pt;height:79.65pt;mso-position-vertical-relative:page')
        before = E.tostring(frame)
        anchors = []
        for relationship in ['rIdPhoto', 'rIdLogo']:
            anchor = E.SubElement(root, wp + 'anchor'); anchors.append(anchor)
            E.SubElement(E.SubElement(anchor, wp + 'positionV', relativeFrom='paragraph'), wp + 'posOffset').text = '181610'
            E.SubElement(anchor, wp + 'extent', cx='760095', cy='952500')
            E.SubElement(anchor, a + 'blip', {R + 'embed': relationship})
        other_before = E.tostring(anchors[1])
        rels = E.Element(PKG + 'Relationships')
        E.SubElement(rels, PKG + 'Relationship', Id='rIdPhoto', Target='media/photo.jpeg')
        files = {'word/_rels/document.xml.rels': E.tostring(rels)}
        _pin_pb_photo_to_source_frame(root, {'dynamicMedia': [{'kind': 'PHOTO', 'part': 'word/media/photo.jpeg'}]}, files)
        position = anchors[0].find(wp + 'positionV')
        self.assertEqual(position.get('relativeFrom'), 'page')
        self.assertEqual(int(position.find(wp + 'posOffset').text), round((121.5 + (79.65 - 75) / 2) * 12700))
        self.assertEqual(anchors[0].find(wp + 'extent').attrib, {'cx': '760095', 'cy': '952500'})
        self.assertEqual(E.tostring(frame), before)
        self.assertEqual(E.tostring(anchors[1]), other_before)


if __name__ == '__main__':
    unittest.main()
