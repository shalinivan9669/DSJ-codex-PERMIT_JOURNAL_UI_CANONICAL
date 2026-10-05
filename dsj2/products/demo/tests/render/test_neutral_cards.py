"""Filled card values, identical copies, photos and release overflow guard."""
from copy import deepcopy
import os
import json
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
from legacy_reference import reference_sources, render_reference_files, freeze_reference_dates
from neutral_cards import repair_card_files, NS, W
from test_render import fixture


class NeutralCardTests(unittest.TestCase):
    def filled(self, snapshot):
        record = next(t for t in reference_sources()['templates'] if t['id'] == snapshot['templateId'])
        return freeze_reference_dates(render_reference_files(snapshot, snapshot['items'][0],
                                      ROOT / 'assets/templates' / record['file'], source_values=True),
                                      snapshot, snapshot['items'][0])

    def test_worker_duplicate_copies_share_content_and_geometry(self):
        snapshot = fixture('biot-worker-card')
        snapshot['items'][0].update(fullNameRu='Тестов-Примеров Александр Константинович',
                                    fullNameKz='Әділбек Өмірсерік Қанатұлы',
                                    workplaceRu='ТОО «Тестовое промышленное предприятие»')
        files = self.filled(snapshot)
        before = dict(files)
        repaired = repair_card_files(files, snapshot)
        self.assertEqual(files, before)
        tree = E.fromstring(repaired['word/document.xml'])
        tables = tree.xpath('/w:document/w:body/w:tbl', namespaces=NS)
        self.assertEqual(E.tostring(tables[0]), E.tostring(tables[1]))
        text = ''.join(tree.xpath('//w:t/text()', namespaces=NS))
        for field in ['fullNameRu', 'fullNameKz', 'workplaceRu']:
            self.assertEqual(text.count(snapshot['items'][0][field]), 2)
        self.assertFalse(tree.xpath('//w:txbxContent', namespaces=NS))
        self.assertEqual(len(tree.xpath('//w:br[@w:type="page"]', namespaces=NS)), 1)

    def test_three_photo_cards_preserve_photo_bytes_inside_reserved_column(self):
        with tempfile.TemporaryDirectory() as folder:
            photo = Path(folder) / 'photo.png'
            Image.new('RGB', (300, 400), (20, 130, 180)).save(photo)
            with patch.dict(os.environ, {'DEMO_ARTIFACT_ROOT': folder}):
                for tid in ['pb-card', 'ps-card', 'ptm-card']:
                    with self.subTest(template=tid):
                        snapshot = fixture(tid)
                        snapshot['items'][0]['photoAssetId'] = 'photo'
                        snapshot['photos'] = {'photo': 'photo.png'}
                        before = self.filled(snapshot)
                        after = repair_card_files(before, snapshot)
                        self.assertEqual(after['word/media/generated-photo-0.png'], photo.read_bytes())
                        tree = E.fromstring(after['word/document.xml'])
                        pictures = tree.xpath('//*[local-name()="inline"]')
                        self.assertEqual(len(pictures), 1)
                        self.assertTrue(any(p.tag == W + 'tc' for p in pictures[0].iterancestors()))
                        self.assertEqual(len(tree.xpath('//w:br[@w:type="page"]', namespaces=NS)), 0 if tid == 'ptm-card' else 1)

    def test_ps_preserves_disciplines_and_final_rules(self):
        snapshot = fixture('ps-card')
        snapshot['items'][0]['assignment'].update(psGeneralSubjectRu='Общая безопасность', psGeneralSubjectKz='Жалпы қауіпсіздік',
                                                  psSpecialSubjectRu='Специальная дисциплина', psSpecialSubjectKz='Арнайы пән')
        repaired = repair_card_files(self.filled(snapshot), snapshot)
        tree = E.fromstring(repaired['word/document.xml'])
        text = ''.join(tree.xpath('//w:t/text()', namespaces=NS))
        for value in ['Общая безопасность', 'Жалпы қауіпсіздік', 'Специальная дисциплина', 'Арнайы пән', 'не моложе 18 лет',
                      snapshot['items'][0]['workplaceRu'], snapshot['items'][0]['workplaceKz']]:
            self.assertIn(value, text)
        self.assertEqual(len(tree.xpath('/w:document/w:body/w:tbl', namespaces=NS)), 4)

    def test_unfittable_value_fails_instead_of_truncating_or_shrinking(self):
        snapshot = fixture('pb-card')
        snapshot['items'][0]['workplaceRu'] = 'Очень длинное название предприятия ' * 100
        with self.assertRaisesRegex(ValueError, '^PRINT_LAYOUT_OVERFLOW$'):
            repair_card_files(self.filled(snapshot), snapshot)

    def test_pb_three_dates_and_bilingual_issuer_survive_as_complete_values(self):
        snapshot = fixture('pb-card')
        snapshot['items'][0]['assignment'].update(documentDate='2030-03-04', protocolDate='2030-02-01', validUntil='2032-06-07')
        snapshot['issuer'].update(nameRu='Учебный центр', nameKz='Оқу орталығы')
        repaired = repair_card_files(self.filled(snapshot), snapshot)
        tree = E.fromstring(repaired['word/document.xml'])
        text = ''.join(tree.xpath('//w:t/text()', namespaces=NS))
        for expected in ['04.03.2030', '01.02.2030', '07.06.2032', 'Оқу орталығы / Учебный центр']:
            self.assertIn(expected, text)

    def test_neutral_batch_keeps_each_recipient_photo_relationship(self):
        from neutral_forms import render_neutral_document
        manifest = json.loads((ROOT / 'assets/templates/manifest.json').read_text(encoding='utf8'))
        template = next(x for x in manifest['templates'] if x['id'] == 'pb-card')
        snapshot = fixture('pb-card')
        snapshot.update(demoMode=False, englishAppendix=False)
        second = deepcopy(snapshot['items'][0])
        second.update(id='second-person', fullNameRu='Другой Получатель', number='ПБ-002')
        snapshot['items'].append(second)
        with tempfile.TemporaryDirectory() as folder:
            photo_bytes = []
            snapshot['photos'] = {}
            for index, color in enumerate([(200, 10, 10), (10, 10, 200)]):
                path = Path(folder) / (str(index) + '.png')
                Image.new('RGB', (300, 400), color).save(path)
                photo_bytes.append(path.read_bytes())
                snapshot['items'][index]['photoAssetId'] = str(index)
                snapshot['photos'][str(index)] = path.name
            output = Path(folder) / 'batch.docx'
            with patch.dict(os.environ, {'DEMO_ARTIFACT_ROOT': folder}):
                render_neutral_document(snapshot, output, ROOT / 'assets/templates' / template['file'])
            with ZipFile(output) as archive:
                root = E.fromstring(archive.read('word/document.xml'))
                rels = {r.get('Id'): r.get('Target') for r in E.fromstring(archive.read('word/_rels/document.xml.rels'))}
                blips = root.xpath('//*[local-name()="blip"]')
                self.assertEqual(len(blips), 2)
                relation = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed'
                self.assertNotEqual(blips[0].get(relation), blips[1].get(relation))
                self.assertEqual([archive.read('word/' + rels[b.get(relation)]) for b in blips], photo_bytes)
                drawing_ids = [p.get('id') for p in root.xpath('//*[local-name()="docPr"]')]
                self.assertEqual(len(drawing_ids), 2)
                self.assertEqual(len(drawing_ids), len(set(drawing_ids)))
                picture_ids = [p.get('id') for p in root.xpath('//*[local-name()="cNvPr"]')]
                self.assertEqual(len(picture_ids), len(set(picture_ids)))
                text = ''.join(root.xpath('//w:t/text()', namespaces=NS))
                self.assertLess(text.index(snapshot['items'][0]['fullNameRu']), text.index(second['fullNameRu']))

    def test_other_forms_are_untouched(self):
        files = {'word/document.xml': b'not needed'}
        self.assertIs(repair_card_files(files, {'templateId': 'pb-protocol'}), files)

    def test_ps_photo_bytes_do_not_depend_on_previous_namespace_registration(self):
        import xml.etree.ElementTree as ET
        from renderer import render_docx
        snapshot = fixture('ps-card')
        relationship_uri = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
        registry_before = dict(ET._namespace_map)
        try:
            with tempfile.TemporaryDirectory() as folder:
                photo = Path(folder) / 'photo.png'
                Image.new('RGB', (300, 400), (20, 130, 180)).save(photo)
                snapshot['items'][0]['photoAssetId'] = 'photo'
                snapshot['photos'] = {'photo': photo.name}
                with patch.dict(os.environ, {'DEMO_ARTIFACT_ROOT': folder}):
                    ET._namespace_map.pop(relationship_uri, None)
                    cold_registry = dict(ET._namespace_map)
                    cold = Path(folder) / 'cold.docx'
                    render_docx(snapshot, cold)
                    self.assertEqual(dict(ET._namespace_map), cold_registry)

                    # The retained historical helper registers source prefixes
                    # process-wide. This was the actual triggering sequence.
                    self.filled(fixture('biot-worker-card'))
                    ET.register_namespace('r', relationship_uri)
                    warm_registry = dict(ET._namespace_map)
                    warm = Path(folder) / 'warm.docx'
                    render_docx(snapshot, warm)
                    self.assertEqual(dict(ET._namespace_map), warm_registry)
                    self.assertEqual(cold.read_bytes(), warm.read_bytes())

                    with patch('generate_biot_card.render', side_effect=ValueError('synthetic failure')):
                        with self.assertRaisesRegex(ValueError, 'synthetic failure'):
                            render_docx(snapshot, Path(folder) / 'failed.docx')
                    self.assertEqual(dict(ET._namespace_map), warm_registry)
        finally:
            ET._namespace_map.clear()
            ET._namespace_map.update(registry_before)


if __name__ == '__main__':
    unittest.main()
