"""Business data must survive the exact legacy template adapter."""
from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest
from zipfile import ZipFile
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from legacy_snapshot_fields import build_legacy_payload
from test_render import fixture


class LegacySnapshotFieldsTests(unittest.TestCase):
    def rendered_text(self, snapshot):
        from legacy_reference import reference_sources, render_reference_document
        snapshot = deepcopy(snapshot)
        snapshot['demoMode'] = False
        record = next(value for value in reference_sources()['templates'] if value['id'] == snapshot['templateId'])
        with tempfile.TemporaryDirectory(prefix='legacy-frozen-data-') as directory:
            output = Path(directory) / 'result.docx'
            render_reference_document(snapshot, output, ROOT / 'assets/templates' / record['file'])
            with ZipFile(output) as archive:
                trees = [E.fromstring(archive.read(name)) for name in archive.namelist()
                         if name.startswith('word/') and name.endswith('.xml')]
        return '\n'.join(''.join(node.text or '' for node in paragraph.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'))
                         for tree in trees for paragraph in tree.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'))

    def payload(self, template, changes=None):
        snapshot = fixture(template)
        snapshot['items'][0]['assignment'].update(changes or {})
        return snapshot, build_legacy_payload(snapshot, snapshot['items'][0])

    def test_worker_uses_supplied_kazakh_name_without_joining_the_russian_field(self):
        snapshot, result = self.payload('biot-worker-card')
        person = snapshot['items'][0]
        self.assertEqual(result['fields']['Берілді'], person['fullNameKz'])
        self.assertEqual(result['fields']['ФИО'], person['fullNameRu'])
        position = next(scope for scope in result['scopedFieldValues'] if scope['scope'] == 'kazakh-position')
        self.assertEqual(position['fields']['Номер_серии'], person['positionKz'])
        snapshot['items'][0]['issuedTo'] = 'Явно сохранённое имя получателя'
        actual = build_legacy_payload(snapshot, snapshot['items'][0])
        self.assertEqual(actual['fields']['Берілді'], snapshot['items'][0]['issuedTo'])

    def test_itr_has_one_complete_name_and_keeps_the_frozen_issue_date(self):
        snapshot, _ = self.payload('biot-itr-certificate')
        snapshot['items'][0]['fullNameRu'] = 'Синтетический ' * 12
        actual = build_legacy_payload(snapshot, snapshot['items'][0])
        self.assertEqual(actual['fields']['Full_Name'], snapshot['items'][0]['fullNameRu'].strip())
        self.assertNotIn(snapshot['items'][0]['fullNameKz'], actual['fields']['Full_Name'])
        self.assertEqual(actual['textReplacements'][0]['replaceText'], '22 сентября 2026 г.')

    def test_failed_result_is_never_replaced_with_the_legacy_passing_grade(self):
        _, actual = self.payload('ps-card', {'result': 'НЕ СДАЛ / ТАПСЫРМАДЫ'})
        self.assertEqual(actual['fields']['Оценка'], 'НЕ СДАЛ')
        self.assertEqual(actual['fields']['Баға'], 'ТАПСЫРМАДЫ')
        replacements = {value['matchText']: value['replaceText'] for value in actual['sourceLiteralValues']}
        self.assertEqual(replacements['Хорошо'], 'НЕ СДАЛ')
        self.assertEqual(replacements['Жаксы'], 'ТАПСЫРМАДЫ')

    def test_missing_result_does_not_create_a_passing_grade(self):
        _, actual = self.payload('ps-card', {'result': ''})
        self.assertEqual(actual['fields']['Оценка'], '')
        self.assertEqual(actual['fields']['Баға'], '')
        self.assertEqual(next(value['replaceText'] for value in actual['sourceLiteralValues'] if value['matchText'] == 'хорошо'), '')

    def test_ptm_protocol_source_sample_pass_is_replaced_by_actual_failed_result(self):
        from legacy_reference import reference_sources, render_reference_document
        snapshot, _ = self.payload('ptm-protocol', {'result': 'НЕ СДАЛ / ТАПСЫРМАДЫ', 'reason': 'ЯВНО СОХРАНЁННАЯ ПРИЧИНА'})
        snapshot['demoMode'] = False
        record = next(value for value in reference_sources()['templates'] if value['id'] == 'ptm-protocol')
        with tempfile.TemporaryDirectory(prefix='legacy-result-values-') as directory:
            output = Path(directory) / 'result.docx'
            render_reference_document(snapshot, output, ROOT / 'assets/templates' / record['file'])
            with ZipFile(output) as archive:
                tree = E.fromstring(archive.read('word/document.xml'))
        paragraphs = [''.join(node.text or '' for node in paragraph.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'))
                      for paragraph in tree.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p')]
        self.assertIn('НЕ СДАЛ / ТАПСЫРМАДЫ', '\n'.join(paragraphs))
        self.assertNotIn('Прошел/ Өтті', paragraphs)
        self.assertIn('ЯВНО СОХРАНЁННАЯ ПРИЧИНА', '\n'.join(paragraphs))
        self.assertNotIn('периодическая /мерзімді', paragraphs)

    def test_ps_card_source_sample_companies_use_frozen_employer_and_issuer(self):
        from legacy_reference import reference_sources, render_reference_document
        snapshot, _ = self.payload('ps-card')
        snapshot['demoMode'] = False
        snapshot['items'][0]['workplaceRu'] = 'ТОО «Сохранённый работодатель»'
        snapshot['issuer']['nameRu'] = 'Сохранённый учебный центр'
        record = next(value for value in reference_sources()['templates'] if value['id'] == 'ps-card')
        with tempfile.TemporaryDirectory(prefix='legacy-company-values-') as directory:
            output = Path(directory) / 'result.docx'
            render_reference_document(snapshot, output, ROOT / 'assets/templates' / record['file'])
            with ZipFile(output) as archive:
                tree = E.fromstring(archive.read('word/document.xml'))
        text = '\n'.join(node.text or '' for node in tree.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'))
        self.assertIn(snapshot['items'][0]['workplaceRu'], text)
        self.assertIn(snapshot['issuer']['nameRu'], text)
        self.assertNotIn('QNP', text)
        self.assertNotIn('ТОО Аттестац', text)

    def test_issue_protocol_and_expiry_dates_remain_independent(self):
        _, actual = self.payload('ptm-card', {'documentDate': '2026-10-02', 'protocolDate': '2026-09-20', 'validUntil': '2030-12-15'})
        self.assertEqual(actual['fields']['Год'], '2026')
        self.assertEqual(actual['fields']['Месяц'], '02.10')
        self.assertEqual(actual['fields']['Действительно_Год'], '2030')
        scopes = {scope['scope']: scope['fields'] for scope in actual['scopedFieldValues']}
        self.assertEqual(scopes['protocol-date']['Месяц'], '20.09')
        self.assertEqual(scopes['expiry-date']['Месяц'], '15.12')
        self.assertEqual(scopes['expiry-date']['Год'], '2030')

    def test_witness_uses_supplied_training_period_and_separate_decision_date(self):
        _, actual = self.payload('ps-witness', {'documentDate': '2026-10-02', 'protocolDate': '2026-09-20',
                                               'trainingStart': '2026-07-01', 'trainingEnd': '2026-08-07'})
        self.assertEqual(actual['fields']['{{TRAINING_START_DAY}}'], '1')
        self.assertEqual(actual['fields']['{{TRAINING_START_MONTH_RU}}'], 'июля')
        self.assertEqual(actual['fields']['{{TRAINING_END_DAY}}'], '7')
        self.assertEqual(actual['fields']['{{TRAINING_END_MONTH_KZ}}'], 'тамыз')
        self.assertEqual(actual['fields']['{{ISSUE_DAY}}'], '2')
        self.assertEqual(actual['fields']['{{ISSUE_MONTH_RU}}'], 'октября')
        decision = next(scope for scope in actual['scopedFieldValues'] if scope['scope'] == 'witness-protocol-date')
        self.assertEqual(decision['fields']['{{ISSUE_DAY}}'], '20')
        self.assertEqual(decision['fields']['{{ISSUE_MONTH_KZ}}'], 'қыркүйек')

    def test_explicit_hours_and_subject_do_not_gain_an_invented_second_course(self):
        _, actual = self.payload('ps-card', {'hours': 74, 'trainingSubject': 'Управление краном / Кранды басқару'})
        self.assertEqual(actual['fields']['M_1_Наименование_дисциплины'], 'Управление краном')
        self.assertEqual(actual['fields']['M_1_Пәндер_атауы_'], 'Кранды басқару')
        self.assertEqual(actual['fields']['M_2_Наименование_дисциплины'], '')
        self.assertEqual(actual['fields']['M_2_Пәндер_атауы_'], '')
        replacements = {value['matchText']: value['replaceText'] for value in actual['sourceLiteralValues']}
        self.assertEqual(replacements['10-часовой'], '74-часовой')
        self.assertEqual(replacements['10 сағаттық'], '74 сағаттық')

    def test_mapping_does_not_mutate_the_saved_snapshot(self):
        for template in ['biot-worker-card', 'biot-itr-certificate', 'ptm-card', 'pb-card', 'ps-card',
                         'ps-witness', 'biot-protocol', 'biot-itr-protocol', 'ptm-protocol', 'pb-protocol', 'ps-protocol']:
            with self.subTest(template=template):
                snapshot = fixture(template)
                original = deepcopy(snapshot)
                build_legacy_payload(snapshot, snapshot['items'][0])
                self.assertEqual(snapshot, original)

    def test_missing_hours_does_not_keep_the_source_sample_ten_hours(self):
        _, actual = self.payload('ptm-protocol', {'hours': None})
        replacements = {value['matchText']: value['replaceText'] for value in actual['sourceLiteralValues']}
        self.assertEqual(replacements['10-часовой'], '')
        self.assertEqual(replacements['10 сағаттық'], '')

    def test_protocol_headers_and_internal_order_use_actual_frozen_profile_values(self):
        for template in ['biot-protocol', 'biot-itr-protocol', 'ptm-protocol', 'pb-protocol', 'ps-protocol']:
            with self.subTest(template=template):
                snapshot, _ = self.payload(template)
                snapshot['issuer'].update(nameRu='Сохранённый учебный центр', nameKz='Сақталған оқу орталығы',
                                          addressRu='Сохранённый адрес, 17', bin='000000000777',
                                          approvalBasis='Решение директора № СИНТ-77')
                text = self.rendered_text(snapshot)
                for value in ['Сохранённый учебный центр', 'Сохранённый адрес, 17', '000000000777']:
                    self.assertIn(value, text)
                for stale in ['Стандарт', '160440010815', 'Анет баба', '02-П', '03-П', '04-П']:
                    self.assertNotIn(stale, text)
                if template != 'pb-protocol':
                    self.assertIn(snapshot['issuer']['approvalBasis'], text)
                else:
                    self.assertIn('2014', text, 'the source statutory reference must not be replaced by an internal order')

    def test_missing_internal_order_does_not_retain_a_sample_date_or_number(self):
        for template in ['biot-protocol', 'biot-itr-protocol', 'ptm-protocol', 'ps-protocol']:
            with self.subTest(template=template):
                snapshot, _ = self.payload(template)
                snapshot['issuer']['approvalBasis'] = ''
                text = self.rendered_text(snapshot)
                for stale in ['02-П', '03-П', '04-П', 'февраля 2026', 'ақпан']:
                    self.assertNotIn(stale, text)

    def test_source_head_slots_use_head_name_and_witness_uses_frozen_cities(self):
        for template in ['ptm-card', 'ps-witness']:
            with self.subTest(template=template):
                snapshot, _ = self.payload(template)
                snapshot['issuer'].update(headName='Сохранённый Директор', cityRu='Кызылорда', cityKz='Қызылорда')
                text = self.rendered_text(snapshot)
                self.assertIn('Сохранённый Директор', text)
                self.assertNotIn(snapshot['issuer']['commission'][0]['name'], text)
                if template == 'ps-witness':
                    self.assertIn('Қызылорда қаласы', text)
                    self.assertIn('город Кызылорда', text)
                    self.assertNotIn('Астана', text)

    def test_protocol_signature_is_blank_and_certificate_column_uses_credential_only(self):
        from legacy_reference import reference_sources, render_reference_document
        from group_protocol import roster_table, W
        for template in ['biot-protocol', 'biot-itr-protocol', 'ptm-protocol', 'ps-protocol']:
            for credential in ['', 'УД-СОХРАНЕНО-777']:
                with self.subTest(template=template, credential=credential):
                    snapshot, _ = self.payload(template)
                    snapshot['demoMode'] = False
                    snapshot['items'][0].update(number='НОМЕР-ПРОТОКОЛА-999', credentialNumber=credential)
                    snapshot['items'][0]['assignment']['biotNotes'] = 'Сохранённое примечание' if credential else ''
                    record = next(value for value in reference_sources()['templates'] if value['id'] == template)
                    with tempfile.TemporaryDirectory(prefix='legacy-number-slots-') as directory:
                        output = Path(directory) / 'result.docx'
                        render_reference_document(snapshot, output, ROOT / 'assets/templates' / record['file'])
                        with ZipFile(output) as archive:
                            tree = E.fromstring(archive.read('word/document.xml'))
                    rows = roster_table(tree).findall(W + 'tr')
                    heading = ''.join(rows[0].findall(W + 'tc')[-1].itertext())
                    row_index = 2 if template.startswith('biot-') else 1
                    value = ''.join(node.text or '' for node in rows[row_index].findall(W + 'tc')[-1].iter(W + 't')).strip()
                    if template.startswith('biot-'):
                        self.assertIn('Примечание', heading)
                        self.assertEqual(value, snapshot['items'][0]['assignment']['biotNotes'])
                    elif template == 'ptm-protocol':
                        self.assertIn('Подпись', heading)
                        self.assertEqual(value, '')
                    else:
                        self.assertIn('удостоверения', heading)
                        self.assertEqual(value, credential)


if __name__ == '__main__':
    unittest.main()
