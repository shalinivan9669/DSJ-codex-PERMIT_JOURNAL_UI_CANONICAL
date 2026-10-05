"""Real neutral templates must retain both saved employer language values."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from group_protocol import roster_table, W
from neutral_forms import render_neutral_group, render_neutral_one
from test_group_protocol import group_fixture
from test_render import fixture, MANIFEST

FORMS = ['biot-protocol', 'biot-itr-protocol', 'ptm-protocol', 'pb-protocol']


def text(element):
    return ''.join(node.text or '' for node in element.iter(W + 't')).strip()


def employer(item):
    return item['workplaceRu'] + ' / ' + item['workplaceKz']


class NeutralProtocolValueTests(unittest.TestCase):
    def verify_employers(self, files, snapshot, header):
        document = E.fromstring(files['word/document.xml'])
        roster = roster_table(document)
        body = document.find(W + 'body')
        header_parts = list(body)[:body.index(roster)]
        self.assertIn(employer(header), [text(part) for part in header_parts])
        count = 2 if snapshot['templateId'].startswith('biot-') else 1
        rows = roster.findall(W + 'tr')[count:]
        if snapshot['templateId'] == 'pb-protocol':
            # PB keeps its commission in an explicitly marked, non-member
            # footer row so Word cannot detach it from the last participants.
            footers = [row for row in rows if any(
                mark.get(W + 'name') == '_NeutralProtocolCommission'
                for mark in row.iter(W + 'bookmarkStart'))]
            self.assertEqual(len(footers), 1)
            self.assertIs(rows[-1], footers[0])
            self.assertEqual(len(footers[0].findall(W + 'tc')), 1)
            self.assertEqual(footers[0].find('.//' + W + 'gridSpan').get(W + 'val'), '5')
            self.assertIsNone(footers[0].find(W + 'trPr/' + W + 'tblHeader'))
            self.assertIsNotNone(footers[0].find(W + 'trPr/' + W + 'cantSplit'))
            for member in snapshot['issuer']['commission']:
                self.assertIn(member['name'], text(footers[0]))
            for item in snapshot['items']:
                self.assertNotIn(item['fullNameRu'], text(footers[0]))
            rows = rows[:-1]
        self.assertEqual(len(rows), len(snapshot['items']))
        for row, item in zip(rows, snapshot['items']):
            self.assertIn(item['fullNameRu'], text(row))
            # The retained PB roster has no workplace column. Its employer
            # contract is the header, while BIOT/PTM also print it in each row.
            if snapshot['templateId'] != 'pb-protocol':
                column = 2 if snapshot['templateId'].startswith('biot-') else 3
                self.assertEqual(text(row.findall(W + 'tc')[column]), employer(item))

    def test_individual_distinct_languages_print_complete_without_source_wrappers(self):
        for template_id in FORMS:
            with self.subTest(template=template_id):
                snapshot = fixture(template_id)
                item = snapshot['items'][0]
                item.update(workplaceRu='ТОО «Русский производственный работодатель»',
                            workplaceKz='«Қазақ өндірістік жұмыс берушісі» ЖШС')
                original = deepcopy(snapshot)
                record = next(t for t in MANIFEST['templates'] if t['id'] == template_id)
                files = render_neutral_one(snapshot, item, ROOT / 'assets/templates' / record['file'])
                self.verify_employers(files, snapshot, item)
                self.assertEqual(snapshot, original)

    def test_groups_keep_each_members_distinct_employer_and_legal_words_verbatim(self):
        for template_id in FORMS:
            with self.subTest(template=template_id):
                snapshot = group_fixture(template_id, 2)
                for index, item in enumerate(snapshot['items'], 1):
                    item.update(workplaceRu=f'ТОО ТОО «Фактические слова {index}» ЖШС ЖШС',
                                workplaceKz=f'«Нақты жұмыс беруші {index}» ЖШС')
                original = deepcopy(snapshot)
                record = next(t for t in MANIFEST['groupTemplates'] if t['id'] == template_id)
                files = render_neutral_group(snapshot, ROOT / 'assets/templates' / record['file'])
                self.verify_employers(files, snapshot, snapshot['items'][0])
                self.assertEqual(snapshot, original)

    def test_explicit_group_header_does_not_replace_individual_member_employers(self):
        for template_id in ['biot-protocol', 'biot-itr-protocol', 'pb-protocol']:
            with self.subTest(template=template_id):
                snapshot = group_fixture(template_id, 2)
                header = {'version': 1, 'workplaceRu': 'ТОО «Заказчик общего протокола»',
                          'workplaceKz': '«Жалпы хаттама тапсырысшысы» ЖШС'}
                snapshot['groupHeaderWorkplace'] = header
                for index, item in enumerate(snapshot['items'], 1):
                    item.update(workplaceRu=f'ТОО «Работодатель участника {index}»',
                                workplaceKz=f'«Қатысушының жұмыс берушісі {index}» ЖШС')
                original = deepcopy(snapshot)
                record = next(t for t in MANIFEST['groupTemplates'] if t['id'] == template_id)
                files = render_neutral_group(snapshot, ROOT / 'assets/templates' / record['file'])
                self.verify_employers(files, snapshot, header)
                self.assertEqual(snapshot, original)


if __name__ == '__main__':
    unittest.main()
