"""Group optimization must preserve the full legacy document XML exactly."""
from pathlib import Path
import sys
import unittest
from zipfile import ZipFile
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from legacy_reference import (freeze_reference_dates, reference_sources,
                              render_reference_files, render_reference_group_row_xml,
                              reference_group_item, render_reference_group_files, W)
from group_protocol import roster_table
from test_group_protocol import group_fixture


class LegacyReferenceGroupTests(unittest.TestCase):
    def test_document_only_rows_equal_full_legacy_packages_for_all_protocols_and_results(self):
        forms = ['biot-protocol', 'biot-itr-protocol', 'ptm-protocol', 'pb-protocol', 'ps-protocol']
        for tid in forms:
            snapshot = group_fixture(tid, 2)
            record = next(entry for entry in reference_sources()['templates'] if entry['id'] == tid)
            path = ROOT / 'assets/templates' / record['file']
            with ZipFile(path) as archive:
                source_xml = archive.read('word/document.xml')
            for index, item in enumerate(snapshot['items']):
                with self.subTest(template=tid, outcome=['PASSED', 'FAILED'][index]):
                    item['assignment'].update(
                        result=['Сдал / Тапсырды', 'Не сдал / Тапсырмады'][index],
                        outcome={'status': ['PASSED', 'FAILED'][index], 'source': 'Synthetic evidence'},
                        documentDate='2030-01-12', protocolDate='2031-02-13')
                    item['credentialNumber'] = 'CREDENTIAL-%02d' % index
                    item = reference_group_item(item)
                    full = freeze_reference_dates(
                        render_reference_files(snapshot, item, path, source_values=True), snapshot, item)
                    optimized = render_reference_group_row_xml(snapshot, item, source_xml)
                    self.assertEqual(full['word/document.xml'], optimized)

    def test_mixed_outcomes_never_print_a_good_grade_or_protocol_number_for_failed_members(self):
        for tid in ['biot-protocol', 'biot-itr-protocol', 'ptm-protocol', 'pb-protocol', 'ps-protocol']:
            with self.subTest(template=tid):
                snapshot = group_fixture(tid, 4)
                for index, item in enumerate(snapshot['items']):
                    item.update(number='GROUP-PROTOCOL-900', protocolNumber='GROUP-PROTOCOL-900',
                                credentialNumber='CREDENTIAL-001' if index == 0 else '')
                    item['assignment'].update(result='Хорошо / Жақсы', resultRu='Хорошо', resultKz='Жақсы',
                                              outcome={'status': ['PASSED', 'FAILED', 'ABSENT', 'UNKNOWN'][index]})
                record = next(entry for entry in reference_sources()['templates'] if entry['id'] == tid)
                files = render_reference_group_files(snapshot, ROOT / 'assets/templates' / record['file'])
                rows = roster_table(E.fromstring(files['word/document.xml'])).findall(W + 'tr')
                rows = rows[2 if tid.startswith('biot-') else 1:]
                self.assertEqual(len(rows), 4)
                for index, row in enumerate(rows):
                    text = ''.join(node.text or '' for node in row.iter(W + 't'))
                    self.assertIn(['Хорошо', 'Не сдал', 'Не явился', 'Не подтверждено'][index], text)
                    self.assertNotIn('GROUP-PROTOCOL-900', text)
                    if index:
                        self.assertNotIn('Хорошо', text)
                        self.assertNotIn('Жақсы', text)
                        self.assertNotIn('CREDENTIAL-001', text)
                    elif tid == 'ps-protocol':
                        # Only PS has a credential column. The other raw source
                        # aliases are note/signature slots, despite their names.
                        self.assertIn('CREDENTIAL-001', text)

    def test_passed_fallback_and_legacy_missing_outcome_leave_the_input_immutable(self):
        item = group_fixture('ptm-protocol', 1)['items'][0]
        original_result = item['assignment']['result']
        self.assertEqual(reference_group_item(item)['assignment']['result'], original_result)
        item['assignment'].update(result='', outcome={'status': 'PASSED'})
        normalized = reference_group_item(item)
        self.assertEqual(normalized['assignment']['result'], 'Прошел/ Өтті')
        self.assertEqual(normalized['number'], '')
        self.assertEqual(item['assignment']['result'], '')
        self.assertEqual(normalized['protocolNumber'], item['protocolNumber'])


if __name__ == '__main__':
    unittest.main()
