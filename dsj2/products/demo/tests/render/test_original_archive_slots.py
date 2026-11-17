"""Coverage of value substitution in the SOL card layouts, without specimen files."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from original_archive_slots import W, ISSUER_STAMP, _replace, _runs, card_blueprint, original_card_fields


class OriginalCardSlotTests(unittest.TestCase):
    def test_strip_retains_repetition_and_does_not_touch_nested_card_or_formatting(self):
        p = E.Element(W+'p')
        def run(parent, text, color):
            r = E.SubElement(parent, W+'r')
            E.SubElement(E.SubElement(r, W+'rPr'), W+'color', {W+'val': color})
            E.SubElement(r, W+'t').text = text
            return r
        left = run(p, '  ТОО Q', '003366')
        E.SubElement(left, W+'tab')
        nested = E.SubElement(E.SubElement(left, W+'txbxContent'), W+'p')
        run(nested, 'ТОО QNP Solutions', '112233')
        run(p, 'NP Solutions     ТОО QNP', '005577')
        run(p, ' Solutions ', '007799')
        original = deepcopy(p)
        self.assertEqual(_replace(_runs(p), ISSUER_STAMP, '{{ISSUER_RU}}'), 2)
        self.assertEqual(''.join(n.text or '' for n in _runs(p)), '  {{ISSUER_RU}}     {{ISSUER_RU}} ')
        self.assertEqual(_runs(nested)[0].text, 'ТОО QNP Solutions')
        # Outside text, even the run/paragraph/table geometry must be identical.
        for tree in (p, original):
            for node in tree.iter(W+'t'):
                node.text = ''
        self.assertEqual(E.tostring(p), E.tostring(original))

    def test_changed_sol_source_does_not_take_another_templates_photo_rectangle(self):
        legacy = {'id': 'ps-card', 'source':'old.docx', 'sourceSha256': 'old',
                  'mergeFields':{}, 'media':[{'kind':'PHOTO'}], 'photoShapes':[{'shapeId':'old'}],
                  'paragraphSlots':[{'xpath':'old'}]}
        sol = card_blueprint('ps-card', legacy)
        self.assertEqual(sol['source'], 'Профессии/1 Профессии - шаблон sol.docx')
        self.assertNotIn('photoShapes', sol)
        self.assertNotIn('paragraphSlots', sol)
        self.assertEqual(sol['media'], [])
        self.assertEqual(legacy['source'], 'old.docx')

    def test_nonpassing_bilingual_biot_does_not_duplicate_course_or_assert_a_pass(self):
        item = {'assignment': {'outcome': {'status': 'ABSENT'}}}
        base = {'SUBJECT_RU': 'Охрана труда', 'SUBJECT_BOTH': 'Охрана труда / Еңбекті қорғау',
                'EXAM_STATEMENT_RU': 'Результат экзамена: Не явился. Программа: Охрана труда',
                'EXAM_STATEMENT_KZ': 'Емтихан нәтижесі: Келмеді. Бағдарлама: Еңбекті қорғау'}
        actual = original_card_fields('biot-worker-card', base, item)
        self.assertEqual(actual['SOURCE_EXAM_LEAD_RU']+' '+actual['SOURCE_EXAM_SUBJECT_RU'], base['EXAM_STATEMENT_RU'])
        self.assertEqual(actual['SOURCE_EXAM_LEAD_KZ'], base['EXAM_STATEMENT_KZ'])

    def test_passed_biot_names_each_subject_on_its_native_row(self):
        base = {'SUBJECT_RU': 'Охрана труда', 'SUBJECT_KZ': 'Еңбекті қорғау',
                'SUBJECT_BOTH': 'Охрана труда / Еңбекті қорғау',
                'EXAM_STATEMENT_RU': 'В том, что он сдал экзамены на знание Охрана труда / Еңбекті қорғау',
                'EXAM_STATEMENT_KZ': 'Бойынша емтихан тапсырғаны туралы берілді.'}
        actual = original_card_fields('biot-worker-card', base, {'assignment': {'outcome': {'status': 'PASSED'}}})
        self.assertEqual(actual['SOURCE_EXAM_SUBJECT_RU'], 'Охрана труда')
        self.assertNotIn('Еңбекті қорғау', actual['SOURCE_EXAM_LEAD_RU'])
        self.assertEqual(actual['SOURCE_EXAM_LEAD_KZ'], 'Еңбекті қорғау бойынша емтихан тапсырғаны туралы берілді.')

    def test_nonpassing_ptm_removes_passed_kazakh_suffix_and_preserves_result(self):
        item = {'assignment': {'outcome': {'status': 'FAILED'}}}
        base = {'SUBJECT_RU':'Курс', 'SUBJECT_KZ':'Курс', 'EXAM_STATEMENT_RU':'Не сдал. Программа: Курс',
                'EXAM_STATEMENT_KZ':'Емтихан нәтижесі: Тапсырмады. Бағдарлама: Курс'}
        actual = original_card_fields('ptm-card', base, item)
        self.assertEqual(actual['SOURCE_EXAM_LEAD_KZ'], base['EXAM_STATEMENT_KZ'])
        self.assertEqual(actual['SOURCE_EXAM_SUBJECT_KZ'] + actual['SOURCE_EXAM_TAIL_KZ'], '')


if __name__ == '__main__':
    unittest.main()
