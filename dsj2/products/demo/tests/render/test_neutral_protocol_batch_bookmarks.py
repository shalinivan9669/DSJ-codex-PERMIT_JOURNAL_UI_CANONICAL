"""PB recipients keep distinct bookmark ranges when assembled into a batch."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from lxml import etree as E

from test_render import fixture
from renderer import render_docx

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


class NeutralProtocolBatchBookmarkTests(unittest.TestCase):
    def test_two_pb_protocols_keep_unique_paired_bookmarks_and_both_recipients(self):
        snapshot = fixture('pb-protocol')
        second = deepcopy(snapshot['items'][0])
        second.update(id='second', fullNameRu='Примеров Сергей Викторович',
                      number='ТЕСТ-00002', protocolNumber='ПР-00002')
        snapshot['items'].append(second)
        original = deepcopy(snapshot)
        with tempfile.TemporaryDirectory(prefix='neutral-pb-bookmarks-') as directory:
            path = Path(directory) / 'two.docx'
            render_docx(snapshot, path)
            with ZipFile(path) as archive:
                root = E.fromstring(archive.read('word/document.xml'))
        starts = list(root.iter(W + 'bookmarkStart'))
        ids = [node.get(W + 'id') for node in starts]
        names = [node.get(W + 'name') for node in starts]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(names), len(set(names)))
        self.assertCountEqual(ids, [node.get(W + 'id') for node in root.iter(W + 'bookmarkEnd')])
        self.assertEqual(sum(name.startswith('_NeutralProtocolCommission') for name in names), 2)
        visible = ''.join(node.text or '' for node in root.iter(W + 't'))
        for item in snapshot['items']:
            self.assertEqual(visible.count(item['fullNameRu']), 1)
        self.assertEqual(snapshot, original)


if __name__ == '__main__':
    unittest.main()
