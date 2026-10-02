"""Frozen business values survive exact source filling for every recipient."""
from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest
from zipfile import ZipFile
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from legacy_reference import reference_sources, render_reference_document
from test_render import fixture

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


class LegacyReferenceDataTests(unittest.TestCase):
    def render(self, snapshot):
        record = next(entry for entry in reference_sources()['templates'] if entry['id'] == snapshot['templateId'])
        snapshot['demoMode'] = False; snapshot['englishAppendix'] = False
        with tempfile.TemporaryDirectory(prefix='demo-reference-values-') as directory:
            output = Path(directory) / 'result.docx'
            render_reference_document(snapshot, output, ROOT / 'assets/templates' / record['file'])
            with ZipFile(output) as archive:
                return E.fromstring(archive.read('word/document.xml'))

    def text(self, tree):
        return '\n'.join(''.join(node.text or '' for node in paragraph.xpath('./w:r/w:t', namespaces={'w': W[1:-1]}))
                         for paragraph in tree.iter(W + 'p'))

    def test_two_worker_recipients_keep_their_own_protocol_and_kazakh_position(self):
        snapshot = fixture('biot-worker-card')
        first = snapshot['items'][0]
        first.update(positionKz='Бірінші маман', fullNameRu='Первый Получатель')
        first['assignment'].update(documentDate='2030-01-01', protocolDate='2030-02-03', result='ТЕСТ: хорошо / ТЕСТ: жақсы')
        second = deepcopy(first)
        second.update(id='second', fullNameRu='Второй Получатель', positionKz='Екінші маман', number='ВТ-002')
        second['assignment'].update(documentDate='2031-04-05', protocolDate='2031-06-07')
        snapshot['items'].append(second)
        text = self.text(self.render(snapshot))
        for expected in ['Первый Получатель', 'Второй Получатель', 'Бірінші маман', 'Екінші маман', '03.02', '07.06', '2030', '2031']:
            self.assertIn(expected, text)
        self.assertNotIn('Солтанова', text)
        self.assertNotIn('ТЕСТ: ТЕСТ:', text)
        self.assertNotIn('01.01', text)
        self.assertNotIn('05.04', text)

    def test_two_itr_recipients_keep_frozen_dates_without_active_date_fields(self):
        snapshot = fixture('biot-itr-certificate')
        first = snapshot['items'][0]; first['assignment']['documentDate'] = '2030-01-12'
        second = deepcopy(first); second.update(id='second', fullNameRu='Второй Получатель', number='ИТР-002')
        second['assignment']['documentDate'] = '2031-03-14'; snapshot['items'].append(second)
        tree = self.render(snapshot); text = self.text(tree)
        self.assertIn('12 января 2030 г.', text)
        self.assertIn('14 марта 2031 г.', text)
        self.assertFalse(any((node.text or '').strip().startswith('DATE') for node in tree.iter(W + 'instrText')))

    def test_two_protocol_recipients_keep_their_actual_outcomes(self):
        snapshot = fixture('ptm-protocol')
        first = snapshot['items'][0]; first['assignment']['result'] = 'ПЕРВЫЙ СДАЛ / БІРІНШІ ТАПСЫРДЫ'
        second = deepcopy(first); second.update(id='second', fullNameRu='Второй Получатель', number='ПТМ-002')
        second['assignment']['result'] = 'ВТОРОЙ НЕ СДАЛ / ЕКІНШІ ТАПСЫРМАДЫ'
        snapshot['items'].append(second)
        text = self.text(self.render(snapshot))
        self.assertIn(first['assignment']['result'], text)
        self.assertIn(second['assignment']['result'], text)
        self.assertNotIn('Прошел', text)

    def test_expiry_fields_are_independent_of_issue_and_protocol_dates(self):
        for tid in ['ptm-card', 'pb-card']:
            with self.subTest(template=tid):
                snapshot = fixture(tid)
                snapshot['items'][0]['assignment'].update(documentDate='2030-01-12', protocolDate='2031-02-13', validUntil='2040-03-14')
                text = self.text(self.render(snapshot))
                self.assertIn('2040', text)
                self.assertIn('2031', text)
                expiry = '\n'.join(line for line in text.splitlines() if 'Действительно' in line or 'дейін' in line)
                self.assertIn('14.03' if tid == 'ptm-card' else '14', expiry)
                self.assertNotIn('12.01', expiry)

    def test_witness_decision_date_does_not_use_training_or_issue_date(self):
        snapshot = fixture('ps-witness')
        snapshot['items'][0]['assignment'].update(documentDate='2030-01-12', protocolDate='2031-02-13', trainingStart='2028-04-05', trainingEnd='2029-06-07')
        tree = self.render(snapshot)
        found = 0
        for table in tree.iter(W + 'tbl'):
            if len(list(table.iter(W + 'tbl'))) != 1:
                continue
            rows = table.findall(W + 'tr'); cells = rows[0].findall(W + 'tc') if rows else []
            if len(cells) == 7 and 'Біліктілік комиссиясының' in ''.join(cells[0].itertext()):
                self.assertEqual(''.join(cells[1].itertext()), '2031')
                self.assertEqual(''.join(cells[4].itertext()), '13')
                self.assertEqual(''.join(cells[6].itertext()), 'ақпан')
                found += 1
        self.assertEqual(found, 1)
        self.assertIn('2028', self.text(tree)); self.assertIn('2029', self.text(tree))


if __name__ == '__main__':
    unittest.main()
