"""Pagination of the registered bilingual PTM group protocol in LibreOffice."""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from test_archive_forms import ROOT, snapshot
from archive_forms import render_archive_document
from renderer import convert_pdf


@unittest.skipUnless(os.environ.get('DEMO_SOFFICE'), 'pinned LibreOffice required')
class ManagedPtmProtocolTests(unittest.TestCase):
    def test_last_participant_and_all_signature_captions_share_one_page(self):
        import pymupdf

        for count in (2, 25):
            with self.subTest(count=count), TemporaryDirectory() as tmp:
                data = snapshot('ptm-protocol', count)
                data.update(demoMode=True, groupEvent={'contractVersion': 1})
                data['issuer'].update(nameRu='ТОО Учебный центр ДЕМО', nameKz='ДЕМО оқу орталығы ЖШС',
                                      approvalBasis='Тестовый приказ ДЕМО-001 от 19.11.2026')
                for member, name in zip(data['issuer']['commission'],
                                        ('Образцов Алексей Тестович', 'Учебная Анна Примеровна',
                                         'Проверкин Иван Дмитриевич')):
                    member['name'] = name
                for index, item in enumerate(data['items'], 1):
                    name = f'Образцовый{index:02d} Арман Тестович'
                    item.update(fullNameRu=name, fullNameKz=name, positionRu='Монтажник',
                                positionKz='Монтажшы', workplaceRu='ТОО «Демо Монтаж»',
                                workplaceKz='«Демо Монтаж» ЖШС')
                docx = Path(tmp) / 'group.docx'
                render_archive_document(data, docx, ROOT / 'assets/templates/ptm-protocol.group-v6.docx')
                pdf = docx.with_suffix('.pdf')
                convert_pdf(docx, pdf)
                with pymupdf.open(pdf) as document:
                    pages = [' '.join(page.get_text().split()) for page in document]
                    if count == 2:
                        self.assertEqual(len(pages), 1)
                    else:
                        self.assertGreater(len(pages), 1)
                    for item in data['items']:
                        self.assertEqual(sum(page.count(item['fullNameRu']) for page in pages), 1)
                    self.assertIn(data['items'][-1]['fullNameRu'], pages[-1])
                    self.assertIn('Председатель комиссии:', pages[-1])
                    self.assertEqual(pages[-1].count('(подпись) (қолы)'), 3)
                    self.assertEqual(pages[-1].count('(Ф.И.О.) (Т.А.Ә)'), 3)
