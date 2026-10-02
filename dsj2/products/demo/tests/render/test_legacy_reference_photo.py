"""Photo compatibility changes package serialization, never the source layout."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from lxml import etree as E
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from legacy_reference import (freeze_reference_dates, reference_sources,
                              render_reference_files, render_reference_document,
                              reference_opc_package, reference_package_declarations)
from test_render import fixture


def semantic_xml(node):
    return (node.tag, tuple(sorted(node.attrib.items())), node.text, node.tail,
            tuple(semantic_xml(child) for child in node))


class LegacyReferencePhotoTests(unittest.TestCase):
    def test_all_three_photo_forms_change_only_opc_namespace_serialization(self):
        with tempfile.TemporaryDirectory(prefix='demo-reference-photo-') as directory:
            store = Path(directory)
            Image.new('RGB', (300, 400), (50, 110, 160)).save(store / 'photo.png')
            with patch.dict(os.environ, {'DEMO_ARTIFACT_ROOT': str(store)}):
                for tid in ['pb-card', 'ps-card', 'ptm-card']:
                    with self.subTest(template=tid):
                        snapshot = fixture(tid)
                        snapshot.update(demoMode=False, englishAppendix=False)
                        item = snapshot['items'][0]
                        item['photoAssetId'] = 'synthetic-photo'
                        snapshot['photos'] = {'synthetic-photo': 'photo.png'}
                        record = next(entry for entry in reference_sources()['templates'] if entry['id'] == tid)
                        source = ROOT / 'assets/templates' / record['file']
                        before = freeze_reference_dates(
                            render_reference_files(snapshot, item, source, source_values=True), snapshot, item)
                        repaired = reference_opc_package(before)
                        changed = {name for name in before if before[name] != repaired[name]}
                        self.assertEqual(changed, {'[Content_Types].xml', 'word/_rels/document.xml.rels'})
                        for name in changed:
                            old, new = E.fromstring(before[name]), E.fromstring(repaired[name])
                            self.assertEqual(semantic_xml(old), semantic_xml(new))
                            self.assertEqual(new.nsmap.get(None), E.QName(new).namespace)
                        self.assertEqual(before['word/document.xml'], repaired['word/document.xml'])
                        self.assertEqual(repaired['word/media/generated-photo-0.png'], (store / 'photo.png').read_bytes())
                        output = store / (tid + '.docx')
                        render_reference_document(snapshot, output, source)
                        with ZipFile(output) as archive:
                            actual = {name: archive.read(name) for name in archive.namelist()}
                        expected = reference_package_declarations(repaired, source)
                        for name, data in repaired.items():
                            if name.endswith(('.xml', '.rels')):
                                self.assertEqual(semantic_xml(E.fromstring(data)), semantic_xml(E.fromstring(expected[name])))
                            else:
                                self.assertEqual(data, expected[name])
                        self.assertEqual(expected, actual)

    def test_without_an_attached_photo_preserves_every_package_byte(self):
        record = next(entry for entry in reference_sources()['templates'] if entry['id'] == 'pb-card')
        with ZipFile(ROOT / 'assets/templates' / record['file']) as archive:
            files = {name: archive.read(name) for name in archive.namelist()}
        self.assertIs(reference_opc_package(files), files)


if __name__ == '__main__':
    unittest.main()
