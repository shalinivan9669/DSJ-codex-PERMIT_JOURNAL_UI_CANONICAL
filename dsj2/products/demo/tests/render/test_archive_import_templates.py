"""The shipped course handouts retain archive column identities, and only their header data."""
import hashlib
import json
import unittest
from pathlib import Path
from xml.etree import ElementTree
from zipfile import ZipFile

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[2] / 'assets' / 'import-templates'
# SHA-256 of the entire original first row, including gaps and spaces in labels.
HEADERS = {
    'biot': '3997a21c38f4140b01245a6033195e9c99ff4c8b66006e031cafdc962b8ad250',
    'pb': 'd3a3bcb6b0bb732e04ecca9f173873b58a8e0724bb99f9e342621ec06e99ec5b',
    'ptm': '23a55750c36787debb2435512fc2ea16402e52a281c5548f429010750a68ea09',
    'ps': '00ac5fea74d94f7b473046bd3b3fe4524f22cb1a9a3976e633c3905f1522b344',
}
PARTS = {
    '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
    'xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml', 'xl/styles.xml', 'xl/theme/theme1.xml',
}


class TestArchiveImportTemplates(unittest.TestCase):
    def test_headers_match_archived_courses_and_all_input_rows_are_blank(self):
        for course, digest in HEADERS.items():
            with self.subTest(course=course):
                path = ROOT / (course + '.xlsx')
                book = load_workbook(path)
                try:
                    self.assertEqual(book.sheetnames, ['Лист1'])
                    sheet = book.active
                    rows = sheet.values
                    header = next(rows)
                    self.assertEqual(hashlib.sha256(json.dumps(header, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest(), digest)
                    self.assertTrue(all(value is None for row in rows for value in row))
                    self.assertEqual(sheet.freeze_panes, 'A2')
                    self.assertTrue(sheet.page_setup.orientation)
                finally:
                    book.close()
                with ZipFile(path) as archive:
                    self.assertEqual(set(archive.namelist()), PARTS)
                    for name in PARTS:
                        xml = ElementTree.fromstring(archive.read(name))
                        self.assertFalse(any(node.attrib.get('TargetMode') == 'External' for node in xml.iter()))
                        self.assertIsNone(xml.find('.//{*}definedName'))
                    ss = ElementTree.fromstring(archive.read('xl/sharedStrings.xml'))
                    self.assertTrue(set(ss.itertext()).issubset(set(header) | {None}))


if __name__ == '__main__':
    unittest.main()
