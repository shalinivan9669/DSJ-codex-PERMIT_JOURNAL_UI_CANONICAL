"""Verify text, issuer bands and grade cells on the registered v20 PS card."""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from test_archive_forms import snapshot
from renderer import convert_pdf, render_docx


@unittest.skipUnless(os.environ.get('DEMO_SOFFICE'), 'pinned LibreOffice required')
class ManagedProfessionCardTests(unittest.TestCase):
    def test_preview_and_numbered_bilingual_card_fit_both_panels(self):
        import pymupdf

        name = 'Образцовый Арман Тестович'
        for number, kazakh in [('ПРЕДПРОСМОТР', name), ('PS-CARD-888888888888', 'Үлгілі Арман Сынақұлы')]:
            with self.subTest(number=number), TemporaryDirectory() as tmp:
                data = snapshot('ps-card')
                data.update(templateVersion='20', demoMode=True)
                issuer = data['issuer']
                issuer.update(nameRu='ТОО Учебный центр ДЕМО', nameKz='ДЕМО оқу орталығы ЖШС')
                item = data['items'][0]
                item.update(number=number, fullNameRu=name, fullNameKz=kazakh,
                            protocolNumber='' if kazakh == name else 'PS-PROTOCOL-888888888888')
                item['assignment'].update(professionRu='Слесарь', professionKz='Слесарь',
                    psGeneralSubjectRu='Материаловедение', psGeneralSubjectKz='Материалтану',
                    psSpecialSubjectRu='Слесарное дело', psSpecialSubjectKz='Слесарь ісі',
                    outcome={'status': 'PASSED'}, result='Сдал', resultKz='Тапсырды')
                docx = Path(tmp) / 'ps.docx'
                render_docx(data, docx)
                pdf = docx.with_suffix('.pdf')
                convert_pdf(docx, pdf)
                with pymupdf.open(pdf) as doc:
                    self.assertEqual(len(doc), 2)
                    for page in doc:
                        frames = [d['rect'] for d in page.get_drawings()
                                  if d['rect'].width > 500 and 150 < d['rect'].height < 190]
                        self.assertEqual(len(frames), 2)
                        label = issuer['nameRu'] + ' / ' + issuer['nameKz']
                        bands = page.search_for(label)
                        self.assertEqual(len(bands), 4)
                        for frame in frames:
                            row = sorted((r for r in bands if frame.contains(r)), key=lambda r: r.x0)
                            self.assertEqual(len(row), 2)
                            fold = (frame.x0 + frame.x1) / 2
                            self.assertLess(row[0].x1, fold)
                            self.assertGreater(row[1].x0, fold)

                    page = doc[0]
                    left = pymupdf.Rect(35, 70, 299, 235)
                    face = ' '.join(page.get_textbox(left).split())
                    for value in {name, kazakh, number}:
                        self.assertEqual(face.count(value), 1)
                    if item['protocolNumber']:
                        self.assertIn(item['protocolNumber'], face)
                    lines = [d['rect'] for d in page.get_drawings()]
                    rows = sorted(r.y0 for r in lines if 220 < r.width < 240 and r.height < 1)
                    cols = sorted(r.x0 for r in lines if r.width < 1 and 80 < r.height < 120 and r.x0 > 300)
                    self.assertEqual((len(rows), len(cols)), (6, 4))
                    captions = page.search_for('(баға/оценка)')
                    self.assertEqual(len(captions), 2)
                    self.assertGreater(rows[0] - max(r.y1 for r in captions), 2)
                    for i, subject in enumerate(('Материаловедение', 'Слесарное дело'), 1):
                        subject_cell = pymupdf.Rect(cols[1], rows[i], cols[2], rows[i+1])
                        grade_cell = pymupdf.Rect(cols[2], rows[i], cols[3], rows[i+1])
                        self.assertIn(subject, page.get_textbox(subject_cell))
                        self.assertIn('Тапсырды / Сдал', page.get_textbox(grade_cell))
