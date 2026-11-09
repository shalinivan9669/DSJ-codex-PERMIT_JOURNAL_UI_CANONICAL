"""Signature names and their captions cannot separate across archive pages."""
from copy import deepcopy
from pathlib import Path
import json
import sys
import unittest

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from archive_forms import W, MARKER, _keep_signature_tables, render_archive_one, render_archive_group
from sanitize_templates import deterministic_zip
import test_archive_forms as fixtures


def signatures():
    table = E.Element(W + 'tbl')
    props = E.SubElement(table, W + 'tblPr')
    E.SubElement(props, W + 'tblW', {W + 'w': '10500', W + 'type': 'dxa'})
    for value in ['{{CHAIR_NAME}}', '(Ф.И.О.)', '{{MEMBER_1_NAME}}', '(Ф.И.О.)', '{{MEMBER_2_NAME}}', '(Ф.И.О.)']:
        row = E.SubElement(table, W + 'tr')
        row_props = E.SubElement(row, W + 'trPr')
        E.SubElement(row_props, W + 'trHeight', {W + 'val': '200'})
        for text in ['', value]:
            paragraph = fixtures.paragraph(text)
            props = E.Element(W + 'pPr'); paragraph.insert(0, props)
            E.SubElement(props, W + 'pStyle', {W + 'val': 'Normal'})
            E.SubElement(props, W + 'keepNext', {W + 'val': '0'})
            E.SubElement(row, W + 'tc').append(paragraph)
    return table


class ArchiveSignatureTests(unittest.TestCase):
    def assert_kept(self, table):
        rows = table.findall(W + 'tr')
        self.assertEqual(len(rows), 6)
        for row in rows:
            props = row.find(W + 'trPr')
            self.assertEqual(props.find(W + 'cantSplit').get(W + 'val'), '1')
            self.assertEqual(props.find(W + 'trHeight').get(W + 'val'), '200')
            self.assertEqual(props[0].tag, W + 'cantSplit')
        paragraphs = list(table.iter(W + 'p'))
        self.assertEqual([p.find(W + 'pPr/' + W + 'keepNext').get(W + 'val') for p in paragraphs],
                         ['1'] * (len(paragraphs) - 1) + ['0'])
        self.assertTrue(all(p.find(W + 'pPr')[0].tag == W + 'pStyle' for p in paragraphs))

    def test_only_signature_block_is_kept_and_chain_ends_at_its_last_paragraph(self):
        root = E.Element(W + 'body')
        roster = deepcopy(signatures())
        roster[1].find(W + 'tc').append(fixtures.paragraph('{{ROW_NUMBER}} {{FULL_NAME_RU}}'))
        root.append(roster); root.append(signatures()); root.append(fixtures.paragraph('NEXT SECTION'))
        before_roster, before_next = E.tostring(roster), E.tostring(root[-1])
        before_text = list(root.itertext())
        _keep_signature_tables(root)
        self.assert_kept(root[1])
        self.assertEqual(E.tostring(roster), before_roster)
        self.assertEqual(E.tostring(root[-1]), before_next)
        self.assertEqual(list(root.itertext()), before_text)

    def test_ps_text_anchored_signature_becomes_inline_with_same_width_grid_and_gap(self):
        table = signatures()
        props = table.find(W + 'tblPr')
        floating = E.Element(W + 'tblpPr', {W + 'vertAnchor': 'text', W + 'horzAnchor': 'margin', W + 'tblpY': '68'})
        props.insert(0, floating)
        width = E.tostring(props.find(W + 'tblW'))
        _keep_signature_tables(table, 'ps-protocol')
        self.assertIsNone(props.find(W + 'tblpPr'))
        self.assertEqual(E.tostring(props.find(W + 'tblW')), width)
        for cell in table.find(W + 'tr').findall(W + 'tc'):
            self.assertEqual(cell.find(W + 'p/' + W + 'pPr/' + W + 'spacing').get(W + 'before'), '68')
        self.assert_kept(table)

    def test_page_anchored_and_other_protocol_signature_positions_are_preserved(self):
        for template_id, anchor in [('ps-protocol', 'page'), ('biot-protocol', 'margin')]:
            with self.subTest(template_id=template_id, anchor=anchor):
                table = signatures()
                props = table.find(W + 'tblPr')
                floating = E.Element(W + 'tblpPr', {W + 'vertAnchor': 'text', W + 'horzAnchor': anchor, W + 'tblpY': '33'})
                props.insert(0, floating)
                before = E.tostring(props)
                _keep_signature_tables(table, template_id)
                self.assertEqual(E.tostring(props), before)
                self.assert_kept(table)

    def package(self, group=False):
        helper = fixtures.ArchiveFormsTests()
        helper.setUp(); self.addCleanup(helper.doCleanups)
        path, files = helper.package(tid='ps-protocol', roster=group)
        root = E.fromstring(files['word/document.xml'])
        body = root.find(W + 'body'); body.insert(len(body) - 1, signatures())
        files['word/document.xml'] = E.tostring(root)
        marker = json.loads(files[MARKER])
        marker['fields'] = sorted(set(marker['fields']) | {'MEMBER_2_NAME'})
        files[MARKER] = json.dumps(marker).encode()
        deterministic_zip(path, files)
        return path

    def test_individual_render_keeps_signature_names_with_captions_before_filling(self):
        data = fixtures.snapshot('ps-protocol')
        result = render_archive_one(data, data['items'][0], self.package())
        root = E.fromstring(result['word/document.xml'])
        table = list(root.iter(W + 'tbl'))[-1]
        self.assert_kept(table)
        self.assertIn('Председатель Иванов', ''.join(table.itertext()))
        self.assertNotRegex(''.join(table.itertext()), r'\{\{[A-Z_]+\}\}')

    def test_group_render_keeps_signatures_but_does_not_chain_recipient_rows(self):
        data = fixtures.snapshot('ps-protocol', count=2)
        data['groupEvent'] = {'contractVersion': 1}
        result = render_archive_group(data, self.package(group=True))
        root = E.fromstring(result['word/document.xml'])
        roster, table = list(root.iter(W + 'tbl'))
        self.assert_kept(table)
        self.assertEqual(len(roster.findall(W + 'tr')), 4)
        self.assertEqual(len(list(roster.iter(W + 'keepNext'))), 0)
        self.assertIn('Получатель 1', ''.join(roster.itertext()))
        self.assertIn('Получатель 2', ''.join(roster.itertext()))


if __name__ == '__main__':
    unittest.main()
