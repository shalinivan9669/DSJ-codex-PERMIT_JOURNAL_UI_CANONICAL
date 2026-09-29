"""Real parser and OOXML boundary coverage for expanded operator requests."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from lxml import etree as E
from openpyxl import Workbook
from test_render import fixture
from renderer import import_table, render_docx


class RequestCapacityTests(unittest.TestCase):
    def test_xlsx_and_tsv_preserve_250_and_account_for_251(self):
        with tempfile.TemporaryDirectory(prefix='demo-capacity-import-') as temp:
            root = Path(temp)
            for count in [250, 251]:
                values = [['fullNameRu', 'fullNameKz', 'personnelNumber']]
                values.extend([[f'Слушатель {n}', f'Қатысушы {n}', f'{n:06d}'] for n in range(1, count + 1)])
                workbook = Workbook()
                for row in values:
                    workbook.active.append(row)
                workbook.save(root / f'{count}.xlsx')
                workbook.close()
                (root / f'{count}.tsv').write_text('\n'.join('\t'.join(row) for row in values), encoding='utf8')
                for extension in ['xlsx', 'tsv']:
                    with self.subTest(count=count, format=extension):
                        result = import_table({'inputPath': str(root / f'{count}.{extension}'), 'format': extension}, root / 'output.json')
                        self.assertEqual(result['count'], count)
                        self.assertEqual(len(result['rawRows']), count)
                        self.assertEqual(result['canApply'], count == 250)
                        self.assertEqual(result['rawRows'][-1]['values'], values[-1])
                        if count == 251:
                            self.assertIn({'code': 'ROW_LIMIT', 'count': 251, 'limit': 250}, result['errors'])

    def test_individual_docx_preserves_all_250_people_and_rejects_251(self):
        with tempfile.TemporaryDirectory(prefix='demo-capacity-docx-') as temp:
            snapshot = fixture('ptm-protocol')
            prototype = snapshot['items'][0]
            snapshot['items'] = [{**deepcopy(prototype), 'id': f'person-{n}', 'fullNameRu': f'Участник-{n:03d}', 'number': f'TEST-{n:06d}'} for n in range(1, 251)]
            path = Path(temp) / 'individuals-250.docx'
            render_docx(snapshot, path)
            with ZipFile(path) as archive:
                root = E.fromstring(archive.read('word/document.xml'))
                text = ''.join(root.itertext())
            positions = [text.index(f'Участник-{n:03d}') for n in range(1, 251)]
            self.assertEqual(positions, sorted(positions), 'original source order must survive rendering')
            for n in range(1, 251):
                self.assertEqual(text.count(f'Участник-{n:03d}'), 1)
            snapshot['items'].append(deepcopy(prototype))
            rejected = Path(temp) / 'rejected-251.docx'
            with self.assertRaisesRegex(ValueError, 'ROW_LIMIT'):
                render_docx(snapshot, rejected)
            self.assertFalse(rejected.exists())


if __name__ == '__main__':
    unittest.main()
