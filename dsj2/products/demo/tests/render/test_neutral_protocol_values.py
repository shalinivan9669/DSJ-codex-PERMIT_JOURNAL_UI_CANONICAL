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
from neutral_fixture import fixture, group_fixture, MANIFEST

FORMS = ['biot-protocol', 'biot-itr-protocol', 'ptm-protocol', 'pb-protocol']


def text(element):
    return ''.join(node.text or '' for node in element.iter(W + 't')).strip()


def employer(item):
    return item['workplaceRu'] + ' / ' + item['workplaceKz']


class NeutralProtocolValueTests(unittest.TestCase):
    def test_additional_commission_members_are_visible_without_adding_signature_requirements(self):
        for template_id in [*FORMS, 'ps-protocol']:
            for grouped in [False, True]:
                for count in [4, 12]:
                    with self.subTest(template=template_id, group=grouped, count=count):
                        snapshot = group_fixture(template_id, 2) if grouped else fixture(template_id)
                        snapshot['issuer']['commission'] = [
                            {'name': f'Участник состава {index + 1}', 'position': f'Должность {index + 1}'}
                            for index in range(count)
                        ]
                        # Saved order and matching jobs remain authoritative,
                        # including roles with coincident names.
                        snapshot['issuer']['commission'][1], snapshot['issuer']['commission'][3] = (
                            snapshot['issuer']['commission'][3], snapshot['issuer']['commission'][1])
                        snapshot['issuer']['commission'][2]['name'] = snapshot['issuer']['commission'][0]['name']
                        original = deepcopy(snapshot)
                        records = MANIFEST['groupTemplates' if grouped else 'templates']
                        record = next(t for t in records if t['id'] == template_id)
                        path = ROOT / 'assets/templates' / record['file']
                        def render(value):
                            files = (render_neutral_group(value, path) if grouped else
                                     render_neutral_one(value, value['items'][0], path))
                            return E.fromstring(files['word/document.xml'])
                        document = render(snapshot)
                        roster = roster_table(document)
                        body = document.find(W + 'body')
                        header = [text(node) for node in list(body)[:body.index(roster)]]
                        self.assertEqual([line for line in header if 'Участник состава' in line], [
                            person['name'] + ' — ' + person['position'] + ', ' + snapshot['issuer']['nameRu']
                            for person in snapshot['issuer']['commission']
                        ])
                        baseline = deepcopy(snapshot)
                        baseline['issuer']['commission'] = baseline['issuer']['commission'][:3]
                        old = render(baseline)
                        def footer(root):
                            table = roster_table(root)
                            parent = root.find(W + 'body')
                            if template_id == 'pb-protocol':
                                return text(table.findall(W + 'tr')[-1])
                            return ''.join(text(node) for node in list(parent)[parent.index(table) + 1:])
                        self.assertEqual(footer(document), footer(old))
                        self.assertEqual(snapshot, original)

    def test_commission_jobs_follow_frozen_people_in_individual_and_group_headers(self):
        jobs = [
            ['Начальник УМО', 'Директор', 'Преподаватель'],
            ['Председатель правления', 'Инженер по охране труда', 'Внешний эксперт'],
            ['', '', ''],
        ]
        for template_id in [*FORMS, 'ps-protocol']:
            for grouped in [False, True]:
                for positions in jobs:
                    with self.subTest(template=template_id, group=grouped, positions=positions):
                        snapshot = group_fixture(template_id, 2) if grouped else fixture(template_id)
                        snapshot['issuer'].update(
                            nameRu='ТОО «Независимый учебный центр»',
                            headName='Независимый руководитель центра',
                            commission=[
                                {'name': f'Сохранённый участник {index + 1}', 'position': position,
                                 'nameEn': f'Frozen person {index + 1}', 'positionEn': f'Frozen job {index + 1}'}
                                for index, position in enumerate(positions)
                            ],
                        )
                        original = deepcopy(snapshot)
                        records = MANIFEST['groupTemplates' if grouped else 'templates']
                        record = next(t for t in records if t['id'] == template_id)
                        path = ROOT / 'assets/templates' / record['file']
                        files = (render_neutral_group(snapshot, path) if grouped else
                                 render_neutral_one(snapshot, snapshot['items'][0], path))
                        document = E.fromstring(files['word/document.xml'])
                        body = document.find(W + 'body')
                        roster = roster_table(document)
                        header = [text(node) for node in list(body)[:body.index(roster)]]
                        actual = [line for line in header if 'Сохранённый участник' in line]
                        expected = [
                            person['name'] + ' — ' + (person['position'] or
                                ('Председатель комиссии' if index == 0 else 'Член комиссии')) +
                                ', ' + snapshot['issuer']['nameRu']
                            for index, person in enumerate(snapshot['issuer']['commission'])
                        ]
                        self.assertEqual(actual, expected)
                        for line in actual:
                            self.assertIn(snapshot['issuer']['nameRu'], line)
                            self.assertNotIn(snapshot['items'][0]['workplaceRu'], line)
                        self.assertNotIn(snapshot['issuer']['headName'], text(document))
                        for person in snapshot['issuer']['commission']:
                            self.assertIn(person['name'], text(document))
                        self.assertEqual(snapshot, original)

    def test_commission_headings_are_not_inferred_from_company_or_person_names(self):
        snapshot = fixture('biot-protocol')
        snapshot['items'][0].update(workplaceRu='Председатель', workplaceKz='Члены комиссии')
        snapshot['issuer'].update(nameRu='Председатель комиссии', commission=[
            {'name': 'Председатель', 'position': 'Директор'},
            {'name': 'Члены комиссии', 'position': 'Начальник УМО'},
            {'name': 'Директор', 'position': 'Преподаватель'},
        ])
        original = deepcopy(snapshot)
        record = next(t for t in MANIFEST['templates'] if t['id'] == 'biot-protocol')
        files = render_neutral_one(snapshot, snapshot['items'][0], ROOT / 'assets/templates' / record['file'])
        document = E.fromstring(files['word/document.xml'])
        paragraphs = [text(paragraph) for paragraph in document.iter(W + 'p')]
        self.assertIn('Председатель / Члены комиссии', paragraphs)
        for person in snapshot['issuer']['commission']:
            self.assertIn(person['name'] + ' — ' + person['position'] + ', Председатель комиссии', paragraphs)
        self.assertEqual(snapshot, original)

    def test_commission_repair_preserves_legacy_renderer_and_separate_director_slot(self):
        from legacy_reference import reference_sources, render_reference_group_files
        snapshot = group_fixture('biot-protocol', 2)
        snapshot['issuer']['commission'] = [
            {'name': f'Исторический участник {index + 1}', 'position': position}
            for index, position in enumerate(['Начальник УМО', 'Директор', 'Преподаватель'])
        ]
        record = next(t for t in reference_sources()['templates'] if t['id'] == 'biot-protocol')
        path = ROOT / 'assets/templates' / record['file']
        historical = render_reference_group_files(snapshot, path)
        text_before = text(E.fromstring(historical['word/document.xml']))
        self.assertIn('Директор', text_before)
        self.assertNotIn('Исторический участник 1 — Начальник УМО', text_before)
        self.assertEqual(render_reference_group_files(snapshot, path), historical)

        witness = fixture('ps-witness')
        witness['issuer'].update(headName='Отдельный директор', commission=deepcopy(snapshot['issuer']['commission']))
        record = next(t for t in MANIFEST['templates'] if t['id'] == 'ps-witness')
        files = render_neutral_one(witness, witness['items'][0], ROOT / 'assets/templates' / record['file'])
        actual = text(E.fromstring(files['word/document.xml']))
        self.assertIn('Отдельный директор', actual)
        self.assertNotIn('Исторический участник 1', actual)

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
