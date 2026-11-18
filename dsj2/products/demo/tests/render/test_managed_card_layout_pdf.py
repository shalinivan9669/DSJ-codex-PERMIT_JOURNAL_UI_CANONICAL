"""Physical bounds of the live PB and PTM managed cards."""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from test_archive_forms import snapshot
from renderer import render_docx, convert_pdf


@unittest.skipUnless(os.environ.get('DEMO_SOFFICE'), 'pinned converter required')
class ManagedCardLayoutTests(unittest.TestCase):
    def setUp(self):
        self.workspace = TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)

    def open_pdf(self, data):
        import pymupdf
        data['templateVersion'] = '19'
        base = Path(self.workspace.name) / data['templateId']
        render_docx(data, base.with_suffix('.docx'))
        convert_pdf(base.with_suffix('.docx'), base.with_suffix('.pdf'))
        return self.enterContext(pymupdf.open(base.with_suffix('.pdf')))

    def test_pb_long_course_leaves_photo_clear(self):
        import pymupdf
        data = snapshot('pb-card')
        item = data['items'][0]
        item.update(number='PB-CARD-00001', fullNameRu='Тестовый Арман Александрович',
                    workplaceRu='ТОО «Учебный пример»', workplaceKz='ТОО «Учебный пример»',
                    positionRu='Синтетический оператор', positionKz='Синтетический оператор')
        item['assignment']['trainingSubject'] = (
            'ПОПБ на ОПО согласно Закону РК от 2014 года №188-V "О гражданской защите"'
            '/Қауіпті өндірістік объектілердегі өнеркәсіптік қауіпсіздік '
            '"азаматтық қорғау туралы"ҚР 2014 жылғы №188-V Заңына сәйкес')
        item['assignment'].pop('trainingSubjectKz')
        doc = self.open_pdf(data)
        page = doc[0]
        frame, = [drawing['rect'] for drawing in page.get_drawings()
                  if 58 < drawing['rect'].width < 62 and 77 < drawing['rect'].height < 82
                  and drawing['rect'].x1 < 100 and drawing['rect'].y1 < 250]
        overlap = [word[4] for word in page.get_text('words') if frame.intersects(pymupdf.Rect(word[:4]))]
        self.assertEqual(overlap, [])
        face = page.get_textbox(pymupdf.Rect(12, 75, 298, 260))
        normalized = ' '.join(face.split())
        for content in ('Тестовый Арман Александрович', 'ПОПБ на ОПО', 'Заңына сәйкес'):
            self.assertIn(content, normalized)

    def test_ptm_full_director_name_below_signature(self):
        import pymupdf
        data = snapshot('ptm-card')
        data['issuer']['headName'] = 'Абдрахманова Александра Константиновна-Сергеевна'
        page = self.open_pdf(data)[0]
        panel = pymupdf.Rect(300, 30, 567, 218)
        text = ' '.join(page.get_textbox(panel).split()).replace('- ', '-')
        self.assertIn(data['issuer']['headName'], text)
        signature, = page.search_for('Қолы / Подпись:', clip=panel)
        surname, = page.search_for('Абдрахманова', clip=panel)
        self.assertGreater(surname.y0, signature.y1)
