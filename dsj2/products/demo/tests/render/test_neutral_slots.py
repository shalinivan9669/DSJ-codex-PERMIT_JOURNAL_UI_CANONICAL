"""Values equal to former samples are data, not unresolved neutral markers."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from neutral_forms import render_neutral_one, render_neutral_group
from test_render import fixture, MANIFEST
from test_group_protocol import group_fixture

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def visible(files):
    return ' '.join(n.text or '' for n in E.fromstring(files['word/document.xml']).iter(W + 't'))


def former_sample_values(snapshot):
    snapshot['issuer']['commission'][0]['name'] = 'Солтанова Н.Н.'
    snapshot['issuer']['headName'] = 'Солтанова Н.Н.'
    for item in snapshot['items']:
        item['assignment'].update(hours=10, reason='периодическая/мерзімді',
            result='Тапсырды/сдал', education='Жоғары/высшее')
    return snapshot


class NeutralSlotTests(unittest.TestCase):
    def test_all_individual_forms_preserve_user_values_equal_to_former_literals(self):
        for template in MANIFEST['templates']:
            with self.subTest(template=template['id']):
                snapshot = former_sample_values(fixture(template['id']))
                before = deepcopy(snapshot)
                files = render_neutral_one(snapshot, snapshot['items'][0], ROOT / 'assets/templates' / template['file'])
                content = visible(files)
                self.assertNotIn('{{N_', content)
                # The source PS card has blank signature lines, not names.
                if template['id'] != 'ps-card':
                    self.assertIn('Солтанова Н.Н.', content)
                if template['id'] == 'pb-protocol':
                    self.assertIn('10-часовой', content)
                    self.assertIn('10 сағаттық', content)
                    self.assertIn('Жоғары/высшее', content)
                self.assertEqual(snapshot, before)

    def test_all_group_forms_resolve_equal_values_without_losing_member_data(self):
        for template in MANIFEST['groupTemplates']:
            with self.subTest(template=template['id']):
                snapshot = former_sample_values(group_fixture(template['id'], 2))
                files = render_neutral_group(snapshot, ROOT / 'assets/templates' / template['file'])
                content = visible(files)
                self.assertNotIn('{{N_', content)
                self.assertIn('Солтанова Н.Н.', content)
                for item in snapshot['items']:
                    self.assertIn(item['fullNameRu'], content)

    def test_user_issuer_employer_and_names_are_never_processed_as_sample_literals(self):
        template = next(t for t in MANIFEST['templates'] if t['id'] == 'pb-protocol')
        snapshot = fixture(template['id'])
        snapshot['issuer']['nameRu'] = 'Учебный центр «Хорошо и Жақсы»'
        item = snapshot['items'][0]
        item.update(fullNameRu='Тестов Хорошо Жақсы', workplaceRu='ТОО «Хорошо и Жақсы»', workplaceKz='ТОО «Хорошо и Жақсы»')
        item['assignment'].update(result='Не сдал / Тапсырмады', outcome={'status': 'FAILED'})
        content = visible(render_neutral_one(snapshot, item, ROOT / 'assets/templates' / template['file']))
        self.assertIn(snapshot['issuer']['nameRu'], content)
        self.assertIn(item['fullNameRu'], content)
        self.assertIn(item['workplaceRu'], content)
        self.assertNotIn('{{N_', content)


if __name__ == '__main__':
    unittest.main()
