"""Frozen values and overflow guards for the versioned certificate repair."""
from copy import deepcopy
import hashlib
from pathlib import Path
import sys
import unittest

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from legacy_reference import reference_sources, render_reference_files, freeze_reference_dates
from neutral_certificates import repair_certificate_files, W
from test_render import fixture


def source(snapshot):
    template = next(t for t in reference_sources()['templates'] if t['id'] == snapshot['templateId'])
    path = ROOT / 'assets/templates' / template['file']
    files = render_reference_files(snapshot, snapshot['items'][0], path, source_values=True)
    return freeze_reference_dates(files, snapshot, snapshot['items'][0]), path


def text(files):
    return ' '.join(n.text or '' for n in E.fromstring(files['word/document.xml']).iter(W + 't'))


class NeutralCertificateTests(unittest.TestCase):
    def test_itr_preserves_full_course_name_date_chair_and_long_number(self):
        snapshot = fixture('biot-itr-certificate')
        snapshot['issuer'].update(nameRu='Товарищество с ограниченной ответственностью «Синтетический учебный центр промышленной безопасности»',
                                 nameKz='«Өнеркәсіптік қауіпсіздік синтетикалық оқу орталығы» жауапкершілігі шектеулі серіктестігі')
        item = snapshot['items'][0]
        item.update(fullNameRu='Тестов-Примеров Александр Константинович Александров', number='СЕРТ-2026-09-22-ПОЛНЫЙ-НОМЕР-00001')
        item['assignment'].update(trainingSubject='Безопасность и охрана труда руководителей и ответственных специалистов промышленных предприятий',
            trainingSubjectKz='Өнеркәсіптік кәсіпорындар басшылары мен жауапты мамандарының еңбек қауіпсіздігі және еңбекті қорғау', documentDate='2031-12-25')
        original = deepcopy(snapshot)
        files, path = source(snapshot)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        original_xml = files['word/document.xml']
        repaired = repair_certificate_files(files, snapshot)
        content = text(repaired)
        for expected in [item['fullNameRu'], item['number'], item['assignment']['trainingSubject'], item['assignment']['trainingSubjectKz'],
                         'Сертификат', '25 декабря 2031 г.', snapshot['issuer']['commission'][0]['name'], snapshot['issuer']['nameRu'], snapshot['issuer']['nameKz']]:
            self.assertIn(expected, content)
        self.assertEqual(snapshot, original)
        self.assertEqual(files['word/document.xml'], original_xml)
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)

    def test_witness_full_bilingual_values_and_nonpassed_outcome_survive_layout(self):
        snapshot = fixture('ps-witness')
        snapshot['issuer']['headName'] = 'Директор Тестовый Д. Д.'
        item = snapshot['items'][0]
        item.update(protocolNumber='ПРОТОКОЛ-2026-09-20-ОЧЕНЬ-ДЛИННЫЙ-НОМЕР-00001', registrationNumber='РЕГИСТРАЦИЯ-2026-ОЧЕНЬ-ДЛИННЫЙ-НОМЕР-00001')
        item['assignment'].update(psQualificationRu='Машинист подъёмного сооружения', psQualificationKz='Көтергіш құрылыстың машинисі',
                                  result='Хорошо / Жақсы', outcome={'status': 'FAILED'}, documentDate='2031-12-25', protocolDate='2031-12-23')
        files, _ = source(snapshot)
        repaired = repair_certificate_files(files, snapshot)
        content = text(repaired)
        for expected in [item['fullNameRu'], item['fullNameKz'], item['protocolNumber'], item['registrationNumber'],
                         'Машинист подъёмного сооружения', 'Көтергіш құрылыстың машинисі', 'Не сдал', 'Тапсырмады',
                         '25 декабря 2031 г.', '25 желтоқсан 2031 ж.', '23 декабря 2031 г.', '23 желтоқсан 2031 ж.',
                         snapshot['issuer']['headName']]:
            self.assertIn(expected, content)
        self.assertNotIn('Хорошо', content)
        self.assertNotIn('Жақсы', content)
        self.assertEqual(content.count('МЕСТО ДЛЯ ПЕЧАТИ'), 2)

    def test_unbounded_values_fail_before_emitting_cropped_certificate(self):
        for tid in ['biot-itr-certificate', 'ps-witness']:
            with self.subTest(template=tid):
                snapshot = fixture(tid)
                snapshot['items'][0]['fullNameRu'] = 'Оченьдлинное Имя ' * 250
                files, _ = source(snapshot)
                with self.assertRaisesRegex(ValueError, 'NEUTRAL_CERTIFICATE_OVERFLOW'):
                    repair_certificate_files(files, snapshot)


if __name__ == '__main__':
    unittest.main()
