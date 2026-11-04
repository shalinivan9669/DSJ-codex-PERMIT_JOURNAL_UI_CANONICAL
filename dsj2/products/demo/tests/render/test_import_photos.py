import base64
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile, ZIP_DEFLATED

from lxml import etree as E
from openpyxl import Workbook, load_workbook
from openpyxl.drawing.image import Image as ExcelImage
from openpyxl.drawing.spreadsheet_drawing import TwoCellAnchor, AnchorMarker
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/render'))
from renderer import import_table
from import_photos import import_template


def workbook(path, anchors=('C2', 'C3'), two_cell=False):
    book = Workbook()
    sheet = book.active
    sheet.title = 'Данные'
    sheet.append(['fullNameRu', 'personnelNumber', 'Фото'])
    sheet.append(['Первый Сотрудник', '00001', ''])
    sheet.append(['Второй Сотрудник', '00002', ''])
    for index, anchor in enumerate(anchors):
        image = io.BytesIO()
        Image.new('RGB', (48, 64), ('red', 'blue')[index % 2]).save(image, 'PNG')
        image.seek(0)
        photo = ExcelImage(image)
        if two_cell:
            photo.anchor = TwoCellAnchor(_from=AnchorMarker(col=2, row=index + 1), to=AnchorMarker(col=3, row=index + 2))
            sheet.add_image(photo)
        else:
            sheet.add_image(photo, anchor)
    book.save(path)
    book.close()


def rewrite(path, part, transform):
    with ZipFile(path) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    files[part] = transform(files[part])
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)


class ImportPhotoTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='demo-import-photo-')
        self.path = Path(self.temp.name) / 'people.xlsx'

    def tearDown(self):
        self.temp.cleanup()

    def parse(self):
        return import_table({'inputPath': str(self.path), 'format': 'xlsx', 'sheet': 'Данные'}, self.path.with_suffix('.json'))

    def test_real_workbook_two_distinct_photos_follow_source_rows(self):
        for two_cell in [False, True]:
            with self.subTest(two_cell=two_cell):
                workbook(self.path, two_cell=two_cell)
                result = self.parse()
                self.assertEqual([p['sourceRow'] for p in result['photos']], [2, 3])
                self.assertEqual(result['errors'], [])
                self.assertTrue(result['canApply'])
                self.assertEqual(result['rawRows'][0]['values'][1], '00001')
                pixels = []
                for photo in result['photos']:
                    with Image.open(io.BytesIO(base64.b64decode(photo['base64']))) as image:
                        pixels.append(image.getpixel((0, 0)))
                self.assertEqual(pixels, [(255, 0, 0), (0, 0, 255)])

    def test_duplicate_row_anchor_does_not_choose_a_persons_photo_arbitrarily(self):
        workbook(self.path, ('C2', 'C2'))
        result = self.parse()
        self.assertEqual(result['photos'], [])
        self.assertIn('PHOTO_AMBIGUOUS', result['rawRows'][0]['errors'])
        self.assertFalse(result['canApply'])

    def test_wrong_column_and_empty_row_have_actionable_errors(self):
        for anchor, code in [('B2', 'PHOTO_COLUMN_REQUIRED'), ('C9', 'PHOTO_ROW_MISSING')]:
            with self.subTest(anchor=anchor):
                workbook(self.path, (anchor,))
                result = self.parse()
                self.assertEqual(result['photos'], [])
                self.assertIn(code, [e['code'] for e in result['errors']])

    def test_external_image_target_is_not_read(self):
        workbook(self.path, ('C2',))
        def external(raw):
            root = E.fromstring(raw)
            root[0].set('TargetMode', 'External')
            root[0].set('Target', 'https://example.invalid/private-photo.png')
            return E.tostring(root)
        rewrite(self.path, 'xl/drawings/_rels/drawing1.xml.rels', external)
        result = self.parse()
        self.assertEqual(result['photos'], [])
        self.assertIn('PHOTO_RELATION_INVALID', result['rawRows'][0]['errors'])

    def test_invalid_image_bytes_and_size_budgets_fail_closed(self):
        workbook(self.path, ('C2',))
        rewrite(self.path, 'xl/media/image1.png', lambda _: b'<svg></svg>')
        result = self.parse()
        self.assertIn('PHOTO_TYPE', result['rawRows'][0]['errors'])
        workbook(self.path)
        with patch('import_photos.MAX_PHOTO_BYTES', 20):
            result = self.parse()
            self.assertEqual(result['photos'], [])
            self.assertIn('PHOTO_TOO_LARGE', result['rawRows'][0]['errors'])
        with patch('import_photos.MAX_PHOTOS', 1):
            with self.assertRaisesRegex(ValueError, 'PHOTO_COUNT_LIMIT'):
                self.parse()
        with patch('import_photos.MAX_TOTAL_BYTES', 20):
            with self.assertRaisesRegex(ValueError, 'PHOTO_TOTAL_LIMIT'):
                self.parse()

    def test_in_cell_image_metadata_is_reported_instead_of_silently_lost(self):
        workbook(self.path, ())
        def metadata(raw):
            root = E.fromstring(raw)
            cell = root.find('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c')
            cell.set('vm', '1')
            return E.tostring(root)
        rewrite(self.path, 'xl/worksheets/sheet1.xml', metadata)
        result = self.parse()
        self.assertFalse(result['canApply'])
        self.assertIn('PHOTO_UNSUPPORTED', [e['code'] for e in result['errors']])

    def test_selected_sheet_has_only_its_own_photos(self):
        workbook(self.path)
        book = load_workbook(self.path)
        book.create_sheet('Другая').append(['fullNameRu'])
        book['Другая'].append(['Другой Сотрудник'])
        book.save(self.path)
        book.close()
        result = import_table({'inputPath': str(self.path), 'format': 'xlsx', 'sheet': 'Другая'}, self.path.with_suffix('.json'))
        self.assertEqual(result['photos'], [])
        self.assertEqual(result['rawRows'][0]['values'], ['Другой Сотрудник'])

    def test_downloadable_template_is_empty_and_contains_photo_instructions(self):
        import_template(self.path)
        book = load_workbook(self.path)
        self.assertEqual(book.sheetnames, ['Данные', 'Инструкция'])
        self.assertIn('Фото', [c.value for c in book['Данные'][1]])
        self.assertFalse(any(c.value for row in book['Данные'].iter_rows(min_row=2) for c in row))
        self.assertIn('Верхний левый угол', '\n'.join(c.value or '' for row in book['Инструкция'] for c in row))
        book.close()
        self.assertEqual(self.parse()['rawRows'], [])


if __name__ == '__main__':
    unittest.main()
