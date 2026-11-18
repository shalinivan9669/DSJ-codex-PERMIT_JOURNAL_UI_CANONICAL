"""Real converter regression for the private original PB group protocol."""
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from original_archive import render_original_document
from archive_forms import render_archive_document
from original_archive_protocols import registry
from renderer import convert_pdf
from test_archive_forms import snapshot


@unittest.skipUnless(os.environ.get('DEMO_SOFFICE'), 'pinned LibreOffice required')
class ManagedPbProtocolTests(unittest.TestCase):
    def test_single_listener_and_three_signatures_fit_on_one_sheet(self):
        import pymupdf

        for grouped, filename in ((False, 'pb-protocol.v14.docx'), (True, 'pb-protocol.group-v6.docx')):
            with self.subTest(grouped=grouped), TemporaryDirectory() as tmp:
                data = snapshot('pb-protocol')
                data.update(demoMode=True)
                if grouped:
                    data['groupEvent'] = {'contractVersion': 1}
                data['issuer'].update(nameRu='Синтетический учебный центр', nameKz='Синтетикалық оқу орталығы')
                item = data['items'][0]
                item.update(fullNameRu='Тестовый Арман Александрович', fullNameKz='Тестовый Арман Александрович',
                            protocolNumber='PB-PROTOCOL-888888888888')
                docx = Path(tmp) / 'issued.docx'
                pdf = docx.with_suffix('.pdf')
                render_archive_document(data, docx, ROOT / 'assets/templates' / filename)
                convert_pdf(docx, pdf)
                with pymupdf.open(pdf) as document:
                    self.assertEqual(len(document), 1)
                    text = ' '.join(document[0].get_text().split())
                    self.assertEqual(text.count(item['fullNameRu']), 1)
                    for member in data['issuer']['commission']:
                        self.assertIn(member['name'], text)
                    self.assertIn('М.П.', text)
                    self.assertEqual(text.count('(подпись) (қолы)'), 3)


@unittest.skipUnless(os.environ.get('DEMO_ORIGINAL_ARCHIVE_SOURCE') and os.environ.get('DEMO_SOFFICE'),
                     'private original and pinned LibreOffice required')
class PbArchivePdfFlowTests(unittest.TestCase):
    def test_roster_and_full_commission_are_ordered_and_unclipped(self):
        import pymupdf

        plan = next(p for (tid, _), (p, lang) in registry().items()
                    if tid == 'pb-protocol' and not lang)
        source = Path(os.environ['DEMO_ORIGINAL_ARCHIVE_SOURCE']) / plan['source']
        with TemporaryDirectory(prefix='pb-physical-regression-') as tmp:
            for count, long_names in ((1, True), (2, True), (3, True), (25, True), (2, False)):
                with self.subTest(count=count, long_names=long_names):
                    s = snapshot('pb-protocol', count)
                    s['groupEvent'] = {'contractVersion': 1}
                    for i, item in enumerate(s['items'], 1):
                        item['fullNameRu'] = f'Участник{i:02d} ' + ('Длиннофамильный Константин Александрович' if long_names else 'Иванов Иван Иванович')
                        item['fullNameKz'] = f'Қатысушы{i:02d} ' + ('Ұзынтегісерік Әділетұлы' if long_names else 'Иванов Иван Иванович')
                    s['issuer']['commission'] = [
                        {'name': 'ТестовыйПредседатель Иванов Константин Александрович', 'position': 'Председатель'},
                        {'name': 'ТестовыйПервый Петров Константин Александрович', 'position': 'Директор'},
                        {'name': 'ТестовыйВторой Сидоров Константин Александрович', 'position': 'Преподаватель'},
                    ]
                    if not long_names:
                        s['issuer']['commission'] = [
                            {'name': 'Председатель Иванов И.И.', 'position': 'Председатель'},
                            {'name': 'Первый Петров П.П.', 'position': 'Директор'},
                            {'name': 'Второй Сидоров С.С.', 'position': 'Преподаватель'},
                        ]
                    docx, pdf = Path(tmp) / f'{count}.docx', Path(tmp) / f'{count}.pdf'
                    render_original_document(s, docx, source)
                    convert_pdf(docx, pdf)
                    with pymupdf.open(pdf) as document:
                        signature = [(i, p.search_for('Председатель комиссии:')[0])
                                     for i, p in enumerate(document) if p.search_for('Председатель комиссии:')]
                        last = [(i, p.search_for(f'Участник{count:02d}')[0])
                                for i, p in enumerate(document) if p.search_for(f'Участник{count:02d}')]
                        self.assertEqual(len(signature), 1)
                        self.assertEqual(len(last), 1)
                        sig_page, sig_rect = signature[0]
                        last_page, last_rect = last[0]
                        self.assertGreaterEqual(sig_page, last_page)
                        if sig_page == last_page:
                            # The bottom border of the last row is below the
                            # last name and must precede the signature heading.
                            borders = [a.y for drawing in document[last_page].get_drawings()
                                       for kind, *points in drawing['items'] if kind == 'l'
                                       for a, b in [points[:2]]
                                       if abs(a.y - b.y) < 1 and abs(a.x - b.x) > 400
                                       and a.y > last_rect.y1]
                            self.assertTrue(borders)
                            self.assertGreater(sig_rect.y0, min(borders))
                        block = document[sig_page].get_text()
                        self.assertIn('М.П.', block)
                        self.assertIn('ТестовыйПервый' if long_names else 'Первый Петров', block)
                        self.assertIn('ТестовыйВторой' if long_names else 'Второй Сидоров', block)
                        # The third caption is outside the source signature
                        # table: it must not be orphaned onto a separate page.
                        self.assertEqual(len(document[sig_page].search_for('(подпись) (қолы)')), 3)
                        self.assertEqual(len(document[sig_page].search_for('(Ф.И.О.) (Т.А.Ә)')), 3)
                        for page in document:
                            for word in page.get_text('words'):
                                self.assertTrue(0 <= word[0] < word[2] <= page.rect.width + 1)
                                self.assertTrue(0 <= word[1] < word[3] <= page.rect.height + 1)
                        for i in range(1, count + 1):
                            self.assertEqual(sum(bool(p.search_for(f'Участник{i:02d}')) for p in document), 1)


if __name__ == '__main__':
    unittest.main()
