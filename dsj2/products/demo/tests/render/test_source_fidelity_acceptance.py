"""Independent acceptance: old pinned releases survive a new layout policy.

Golden deterministic DOCX hashes were generated from commit 8825dfa, before
the source-fidelity renderer change, using the existing synthetic fixtures.
These check complete saved output, including VML/DrawingML and header media.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from copy import deepcopy
from lxml import etree as E
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from renderer import render_docx, render_one
from restore_original_forms import prepare_original, SOURCES, METADATA_PART
from sanitize_templates import deterministic_zip
from test_render import fixture
from test_group_protocol import group_fixture

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def properties(run, exclude_size=False):
    root = run.find(W + 'rPr')
    if root is None:
        return []
    return [(node.tag, sorted(node.attrib.items())) for node in root
            if not exclude_size or node.tag not in [W + 'sz', W + 'szCs']]

PINNED_V1 = [
    ('biot-worker-card', '18', 'biot-worker-card.v18.docx', False, '0f34bb47bd6cf2e0c7126c92650267b453c2d87b3539b56edc8ecd1177553731'),
    ('biot-itr-certificate', '16', 'biot-itr-certificate.v16.docx', False, '2cd5f8f884d1a272d421d243e061651daabc005e11c5933c8cbe20a55acf1be6'),
    ('biot-protocol', '12', 'biot-protocol.v12.docx', False, '251400215d768ecdffa95bd5ff4fd903bd26638fbff6cd459afffff0e78be717'),
    ('ptm-card', '15', 'ptm-card.v15.docx', False, '564622b4673061daf2d5cd9474fa410ad6be310bb5a64097f98a0147367f187e'),
    ('ptm-protocol', '10', 'ptm-protocol.v10.docx', False, 'c91ccd6f32ac5d6eca9e48690e152518ed76253078f25d74e13f9fc7923efb71'),
    ('pb-card', '15', 'pb-card.v15.docx', False, '71d4c32376fd7870804819fe30173c78575ede2cb9cab7e7941b676f7dae1ab6'),
    ('pb-protocol', '10', 'pb-protocol.v10.docx', False, 'e2d9332a1ab9bce8934de44930fc8f60be0bc2436ae53e624dc9f5990ddeb205'),
    ('ps-card', '16', 'ps-card.v16.docx', False, '93461336c3119d4f336539275410b756c9766d128ed4e5fff80d21ac2c0d3977'),
    ('ps-protocol', '10', 'ps-protocol.v10.docx', False, '90785fbdf5bb278b9e71516b12dd5a92a82d3e5da74223b8560415b1ea26b66b'),
    ('ps-witness', '12', 'ps-witness.v12.docx', False, 'e9e92531bcd92629f031456bba218bce74a2cee09e2d30e60640b35289f25832'),
    ('biot-itr-protocol', '3', 'biot-itr-protocol.v3.docx', False, '251400215d768ecdffa95bd5ff4fd903bd26638fbff6cd459afffff0e78be717'),
    ('biot-protocol', '12-group-1', 'biot-protocol.group-v3.docx', True, '739af92e56bee8a156dfd26b86270d00734fe4e3d152eaeabc6c2889a7758210'),
    ('ptm-protocol', '10-group-1', 'ptm-protocol.group-v2.docx', True, '00bf132453ecd223fc92a110041a2eb2b874a390ea6cebad7b79e7cbaf213b79'),
    ('pb-protocol', '10-group-1', 'pb-protocol.group-v2.docx', True, '2d6a73c82fda557b686483849ab74b6f98a056b80176c2a4a945ccddc6dc9ed5'),
    ('ps-protocol', '10-group-1', 'ps-protocol.group-v2.docx', True, 'ed571035565497d89b2078e1419bd4de73af536c17002c80c306e3ba55c23bd4'),
    ('biot-itr-protocol', '3-group-1', 'biot-itr-protocol.group-v3.docx', True, '739af92e56bee8a156dfd26b86270d00734fe4e3d152eaeabc6c2889a7758210'),
]


class SourceFidelityAcceptanceTests(unittest.TestCase):
    def test_all_16_pinned_v1_outputs_keep_the_pre_change_bytes(self):
        with tempfile.TemporaryDirectory(prefix='demo-pinned-layout-') as temp:
            store = Path(temp)
            with patch.dict(os.environ, {'DEMO_ARTIFACT_ROOT': str(store)}):
                for tid, version, filename, group, expected in PINNED_V1:
                    with self.subTest(template=tid, group=group, version=version):
                        source = ROOT / 'assets/templates' / filename
                        content = source.read_bytes()
                        (store / filename).write_bytes(content)
                        snapshot = group_fixture(tid, 3) if group else fixture(tid)
                        snapshot.update(templateVersion=version,
                                        templateStorageKey=filename,
                                        templateChecksum=hashlib.sha256(content).hexdigest())
                        target = store / ('output-' + filename)
                        render_docx(snapshot, target)
                        self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(), expected,
                                         'A new layout release changed reconstruction of an older pinned form')

    def test_v2_reference_artwork_matches_the_frozen_issuer_without_cross_tenant_cache(self):
        tid = 'biot-itr-certificate'
        source = ROOT.parents[1] / 'docs/experimental' / SOURCES[tid]
        files = prepare_original(source, tid, source_fidelity=True)
        metadata = json.loads(files[METADATA_PART])
        self.assertEqual(metadata['version'], 2)
        self.assertEqual(metadata['layoutPolicy'], 'SOURCE_FIDELITY_V2')
        reference = [slot for slot in metadata['dynamicMedia'] if slot['kind'] == 'REFERENCE_BRAND']
        self.assertTrue(reference, 'The test must cover an actual retained source logo')
        with tempfile.TemporaryDirectory(prefix='demo-frozen-brand-') as temp:
            template = Path(temp) / 'source.docx'
            deterministic_zip(template, files)
            snapshot = fixture(tid)
            for match in [True, False, True]:
                snapshot['issuer']['nameRu'] = ('ТОО «Аттестационный центр Стандарт»' if match
                                                else 'Другой синтетический учебный центр')
                actual = render_one(deepcopy(snapshot), deepcopy(snapshot['items'][0]), template)
                for slot in reference:
                    with self.subTest(match=match, part=slot['part']):
                        sha = hashlib.sha256(actual[slot['part']]).hexdigest()
                        if match:
                            self.assertEqual(sha, slot['originalSha256'])
                        else:
                            self.assertNotEqual(sha, slot['originalSha256'], 'A different issuer inherited the reference brand')

    def test_v2_worker_keeps_static_run_sizes_and_original_field_decorations(self):
        tid = 'biot-worker-card'
        source = ROOT.parents[1] / 'docs/experimental' / SOURCES[tid]
        files = prepare_original(source, tid, source_fidelity=True)
        before = E.fromstring(files['word/document.xml'])
        with tempfile.TemporaryDirectory(prefix='demo-source-typography-') as temp:
            template = Path(temp) / 'source.docx'
            deterministic_zip(template, files)
            snapshot = fixture(tid)
            snapshot['demoMode'] = False
            actual = render_one(snapshot, snapshot['items'][0], template)
        after = E.fromstring(actual['word/document.xml'])
        before_boxes = list(before.iter(W + 'txbxContent'))
        after_boxes = list(after.iter(W + 'txbxContent'))
        self.assertEqual(len(before_boxes), len(after_boxes))
        static_checked = decorated_checked = 0
        for old_box, new_box in zip(before_boxes, after_boxes):
            old_runs, new_runs = list(old_box.iter(W + 'r')), list(new_box.iter(W + 'r'))
            self.assertEqual(len(old_runs), len(new_runs), 'Original mixed runs were collapsed')
            for old_run, new_run in zip(old_runs, new_runs):
                value = ''.join(n.text or '' for n in old_run.iter(W + 't'))
                self.assertEqual(properties(old_run, True), properties(new_run, True),
                                 'Original run decoration/font family was replaced')
                decorated_checked += old_run.find(W + 'rPr/' + W + 'u') is not None
                if value.strip() and '{{' not in value:
                    self.assertEqual(properties(old_run), properties(new_run),
                                     'Static source typography was forced to a global font size')
                    static_checked += 1
        self.assertGreater(static_checked, 10)
        self.assertGreater(decorated_checked, 0)
        for tag in ['pgSz', 'pgMar', 'tblGrid']:
            self.assertEqual([E.tostring(n) for n in before.iter(W + tag)],
                             [E.tostring(n) for n in after.iter(W + tag)])

    def test_v2_ps_card_accepts_an_ordinary_bilingual_training_center(self):
        """A real local acceptance fixture failed despite ordinary field lengths."""
        tid = 'ps-card'
        source = ROOT.parents[1] / 'docs/experimental' / SOURCES[tid]
        files = prepare_original(source, tid, source_fidelity=True)
        snapshot = fixture(tid)
        snapshot['issuer'].update(
            nameRu='Синтетический учебный центр',
            nameKz='Синтетикалық оқу орталығы',
            cityRu='Кызылорда', cityKz='Қызылорда',
            commission=[
                {'name': 'Тестовый Председатель', 'position': 'Председатель комиссии'},
                {'name': 'Тестовый Член Первый', 'position': 'Член комиссии'},
                {'name': 'Тестовый Член Второй', 'position': 'Член комиссии'},
            ])
        with tempfile.TemporaryDirectory(prefix='demo-ps-normal-profile-') as temp:
            template = Path(temp) / 'source.docx'
            deterministic_zip(template, files)
            actual = render_one(snapshot, snapshot['items'][0], template)
        root = E.fromstring(actual['word/document.xml'])
        text = ''.join(root.itertext())
        for value in [snapshot['issuer']['nameRu'], snapshot['issuer']['nameKz'],
                      snapshot['items'][0]['fullNameRu'], snapshot['items'][0]['fullNameKz']]:
            self.assertIn(value, text)

    def test_v2_pb_photo_uses_the_existing_source_frame(self):
        tid = 'pb-card'
        source = ROOT.parents[1] / 'docs/experimental' / SOURCES[tid]
        files = prepare_original(source, tid, source_fidelity=True)
        before = E.fromstring(files['word/document.xml'])
        # This retained rectangle is the source document's photo placeholder.
        frame = next(node for node in before.iter() if node.get('id') == 'Прямоугольник 21')
        style = lambda node: dict(part.split(':', 1) for part in node.get('style', '').split(';') if ':' in part)
        expected = style(frame)
        with tempfile.TemporaryDirectory(prefix='demo-pb-photo-frame-') as temp:
            root = Path(temp)
            template = root / 'source.docx'
            deterministic_zip(template, files)
            Image.new('RGB', (300, 400), '#d9e5ee').save(root / 'synthetic.png')
            snapshot = fixture(tid)
            snapshot['items'][0]['photoAssetId'] = 'synthetic-photo'
            snapshot['photos'] = {'synthetic-photo': 'synthetic.png'}
            with patch.dict(os.environ, {'DEMO_ARTIFACT_ROOT': str(root)}):
                actual = render_one(snapshot, snapshot['items'][0], template)
        document = E.fromstring(actual['word/document.xml'])
        photo = next(node for node in document.iter() if node.get('id') == 'DemoPhoto')
        inserted = style(photo)
        for property_name in ['margin-left', 'margin-top', 'width', 'height',
                              'mso-position-horizontal-relative', 'mso-position-vertical-relative']:
            self.assertEqual(inserted[property_name], expected[property_name],
                             'The photo moved outside its original frame and can cover recipient text')


if __name__ == '__main__':
    unittest.main()
