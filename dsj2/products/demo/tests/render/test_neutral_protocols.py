"""Regression coverage for new protocol pagination without touching old policy."""
from copy import deepcopy
import hashlib
from pathlib import Path
import sys
import unittest

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from group_protocol import W, roster_table
from legacy_reference import reference_sources, render_reference_group_files
from neutral_protocols import COMMISSION_BOOKMARK, PROTOCOL_IDS, repair_protocol_files
from test_group_protocol import group_fixture


def text(element):
    return ''.join(node.text or '' for node in element.iter(W + 't'))


def cells_except_ordinal(row):
    return [text(cell) for cell in row.findall(W + 'tc')[1:]]


def is_commission_row(row):
    return any(node.get(W + 'name') == COMMISSION_BOOKMARK
               for node in row.iter(W + 'bookmarkStart'))


class NeutralProtocolTests(unittest.TestCase):
    def test_all_five_forms_all_six_sizes_preserve_every_member_and_factual_value(self):
        """Exercises actual legacy fill, including outcome sanitation, at 400."""
        for template_id in sorted(PROTOCOL_IDS):
            record = next(t for t in reference_sources()['templates'] if t['id'] == template_id)
            path = ROOT / 'assets/templates' / record['file']
            original_hash = hashlib.sha256(path.read_bytes()).hexdigest()
            for count in [1, 2, 25, 100, 250, 400]:
                with self.subTest(template=template_id, count=count):
                    snapshot = group_fixture(template_id, count)
                    for index, item in enumerate(snapshot['items']):
                        item['credentialNumber'] = 'CREDENTIAL-%04d' % (index + 1)
                        item['assignment'].update(result='Хорошо / Жақсы',
                            outcome={'status': ['PASSED', 'FAILED', 'ABSENT', 'UNKNOWN'][index % 4]})
                    original = deepcopy(snapshot)
                    filled = render_reference_group_files(snapshot, path)
                    input_xml = filled['word/document.xml']
                    before = roster_table(E.fromstring(input_xml)).findall(W + 'tr')
                    repaired = repair_protocol_files(filled, snapshot)
                    root = E.fromstring(repaired['word/document.xml'])
                    roster = roster_table(root)
                    rows = [row for row in roster.findall(W + 'tr') if not is_commission_row(row)]
                    headings = 2 if template_id.startswith('biot-') else 1
                    self.assertEqual(len(rows), count + headings)
                    for index, (previous, current) in enumerate(zip(before, rows)):
                        expected_cells = cells_except_ordinal(previous)
                        if index >= headings and (template_id.startswith('biot-') or template_id == 'ptm-protocol'):
                            company_column = 1 if template_id.startswith('biot-') else 2
                            # This is the source's literal suffix outside the
                            # Word field, not the saved workplace field value.
                            self.assertTrue(expected_cells[company_column].rstrip().endswith('ЖШС'))
                            expected_cells[company_column] = expected_cells[company_column].rstrip()[:-3]
                        self.assertEqual([value.rstrip() for value in expected_cells],
                                         [value.rstrip() for value in cells_except_ordinal(current)])
                    self.assertEqual([text(row.findall(W + 'tc')[0]) for row in rows[headings:]],
                                     [str(index) for index in range(1, count + 1)])
                    for index, row in enumerate(rows):
                        props = row.find(W + 'trPr')
                        self.assertEqual(props.find(W + 'tblHeader') is not None, index < headings)
                        self.assertIsNotNone(props.find(W + 'cantSplit'))
                        self.assertFalse(list(row.iter(W + 'noWrap')))
                    self.assertFalse(list(root.iter(W + 'tblpPr')))
                    self.assertGreaterEqual(int(roster.find(W + 'tblGrid')[0].get(W + 'w')), 620)
                    for index, row in enumerate(rows[headings:]):
                        content = text(row)
                        self.assertIn('Синтетический Слушатель %03d' % (index + 1), content)
                        self.assertIn(['Хорошо', 'Не сдал', 'Не явился', 'Не подтверждено'][index % 4], content)
                        self.assertFalse(list(row.findall(W + 'tc')[0].iter(W + 'numPr')))
                        if index < count - 3:
                            self.assertFalse(list(row.iter(W + 'keepNext')))
                    signature_parts = ([row for row in roster.findall(W + 'tr') if is_commission_row(row)]
                                       if template_id == 'pb-protocol' else
                                       list(root.find(W + 'body'))[root.find(W + 'body').index(roster) + 1:])
                    signature_paragraphs = [p for part in signature_parts for p in part.iter(W + 'p')]
                    self.assertTrue(signature_paragraphs)
                    for paragraph in signature_paragraphs[:-1]:
                        self.assertIsNotNone(paragraph.find(W + 'pPr').find(W + 'keepNext'))
                    for member in snapshot['issuer']['commission']:
                        self.assertIn(member['name'], ' '.join(text(part) for part in signature_parts))
                    self.assertEqual(snapshot, original)
                    self.assertEqual(filled['word/document.xml'], input_xml)
                    for name, content in filled.items():
                        if name.startswith('word/header') and name.endswith('.xml'):
                            self.assertEqual(text(E.fromstring(content)), text(E.fromstring(repaired[name])))
                            self.assertFalse(list(E.fromstring(repaired[name]).iter(W + 'trHeight')))
                        elif name != 'word/document.xml':
                            self.assertEqual(content, repaired[name])
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), original_hash)

    def test_missing_member_is_rejected_instead_of_silently_printing_a_partial_roster(self):
        snapshot = group_fixture('pb-protocol', 2)
        record = next(t for t in reference_sources()['templates'] if t['id'] == 'pb-protocol')
        files = render_reference_group_files(snapshot, ROOT / 'assets/templates' / record['file'])
        root = E.fromstring(files['word/document.xml'])
        roster = roster_table(root)
        roster.remove(roster.findall(W + 'tr')[-1])
        files['word/document.xml'] = E.tostring(root)
        with self.assertRaisesRegex(ValueError, 'NEUTRAL_PROTOCOL_MEMBER_COUNT'):
            repair_protocol_files(files, snapshot)

    def test_other_forms_are_unchanged(self):
        files = {'word/document.xml': b'not protocol XML'}
        self.assertIs(repair_protocol_files(files, {'templateId': 'pb-card'}), files)

    def test_a_row_taller_than_a_page_fails_before_a_clipped_document_is_emitted(self):
        snapshot = group_fixture('pb-protocol', 1)
        snapshot['items'][0]['fullNameRu'] = 'Длинное имя участника ' * 500
        record = next(t for t in reference_sources()['templates'] if t['id'] == 'pb-protocol')
        files = render_reference_group_files(snapshot, ROOT / 'assets/templates' / record['file'])
        with self.assertRaisesRegex(ValueError, '^PRINT_LAYOUT_OVERFLOW$'):
            repair_protocol_files(files, snapshot)

    def test_flowing_roster_and_borderless_commission_have_a_real_separator(self):
        # Writer otherwise merges the adjacent tables, dropping the roster grid
        # and applying the narrower commission width to every member column.
        for template_id in sorted(PROTOCOL_IDS):
            with self.subTest(template=template_id):
                snapshot = group_fixture(template_id, 2)
                record = next(t for t in reference_sources()['templates'] if t['id'] == template_id)
                files = render_reference_group_files(snapshot, ROOT / 'assets/templates' / record['file'])
                output = repair_protocol_files(files, snapshot)
                root = E.fromstring(output['word/document.xml'])
                table = roster_table(root)
                body = root.find(W + 'body')
                if template_id == 'pb-protocol':
                    footer = next(row for row in table.findall(W + 'tr') if is_commission_row(row))
                    separator = footer.find(W + 'tc/' + W + 'p')
                else:
                    separator = body[body.index(table) + 1]
                self.assertEqual(separator.tag, W + 'p')
                self.assertEqual(text(separator), '')
                self.assertIsNotNone(separator.find(W + 'pPr/' + W + 'keepNext'))
                self.assertEqual(separator.find(W + 'pPr/' + W + 'spacing').get(W + 'line'), '80')

    def test_pb_commission_is_one_marked_spanning_row_kept_with_last_participants(self):
        snapshot = group_fixture('pb-protocol', 25)
        record = next(t for t in reference_sources()['templates'] if t['id'] == 'pb-protocol')
        files = render_reference_group_files(snapshot, ROOT / 'assets/templates' / record['file'])
        root = E.fromstring(repair_protocol_files(files, snapshot)['word/document.xml'])
        table = roster_table(root)
        rows = table.findall(W + 'tr')
        self.assertEqual(len(rows), 1 + 25 + 1)
        self.assertEqual([is_commission_row(row) for row in rows], [False] * 26 + [True])
        footer = rows[-1]
        self.assertIsNotNone(footer.find(W + 'trPr/' + W + 'cantSplit'))
        self.assertIsNone(footer.find(W + 'trPr/' + W + 'tblHeader'))
        self.assertEqual(len(footer.findall(W + 'tc')), 1)
        self.assertEqual(footer.find(W + 'tc/' + W + 'tcPr/' + W + 'gridSpan').get(W + 'val'),
                         str(len(table.find(W + 'tblGrid'))))
        for row in rows[-4:-1]:
            self.assertTrue(all(p.find(W + 'pPr/' + W + 'keepNext') is not None for p in row.iter(W + 'p')))
        for member in snapshot['issuer']['commission']:
            self.assertIn(member['name'], text(footer))
        self.assertIn('(подпись)', text(footer))
        self.assertIn('(Ф.И.О.)', text(footer))

    def test_workplace_source_wrappers_do_not_duplicate_or_remove_real_legal_form_words(self):
        import tempfile
        from zipfile import ZipFile
        from renderer import render_docx
        with tempfile.TemporaryDirectory(prefix='demo-neutral-workplace-') as directory:
            for template_id in ['biot-protocol', 'biot-itr-protocol', 'ptm-protocol']:
                with self.subTest(template=template_id):
                    snapshot = group_fixture(template_id, 2)
                    for item in snapshot['items']:
                        item.update(workplaceRu='ТОО ТОО «Реальные слова» ЖШС ЖШС',
                                    workplaceKz='«Нақты сөздер» ЖШС')
                    path = Path(directory) / (template_id + '.docx')
                    render_docx(snapshot, path)
                    with ZipFile(path) as archive:
                        root = E.fromstring(archive.read('word/document.xml'))
                    expected = 'ТОО ТОО «Реальные слова» ЖШС ЖШС / «Нақты сөздер» ЖШС'
                    table = roster_table(root)
                    headings = 2 if template_id.startswith('biot-') else 1
                    column = 2 if template_id.startswith('biot-') else 3
                    for row in table.findall(W + 'tr')[headings:]:
                        self.assertEqual(text(row.findall(W + 'tc')[column]).strip(), expected)
                    header = list(root.find(W + 'body'))[:root.find(W + 'body').index(table)]
                    self.assertTrue(any(text(element).strip() == expected for element in header))


if __name__ == '__main__':
    unittest.main()
