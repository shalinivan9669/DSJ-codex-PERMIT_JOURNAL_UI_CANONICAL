"""Independent package audit and mutations of hidden historical identity data."""
import hashlib
import json
from pathlib import Path
import posixpath
import re
import sys
import unittest
from zipfile import ZipFile

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from neutral_identity import sanitize_identity, OLD_IMAGE_HASHES
from legacy_reference import legacy_payload, reference_sources
from test_render import fixture

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
OLD_IDENTITY = re.compile(r'\bстандарт\b|солтанов|флеглер|жакибеков|баянов|есен\s+д\.|анет\s+баба|160440010815|технологии\s+гостеприимства|саратов|QNP\s+Solutions', re.I)


def parts(path):
    with ZipFile(path) as z:
        return {name: z.read(name) for name in z.namelist()}


class NeutralIdentityAuditTests(unittest.TestCase):
    def assert_clean(self, files):
        for name, data in files.items():
            self.assertNotIn(hashlib.sha256(data).hexdigest(), OLD_IMAGE_HASHES, name)
            self.assertFalse(name.startswith(('docProps/', 'customXml/', 'word/embeddings/', 'word/comments', 'word/people')), name)
            if name.endswith(('.xml', '.rels')):
                tree = E.fromstring(data)
                content = ' '.join(tree.itertext()) + ' '.join(value for node in tree.iter() for value in node.attrib.values())
                self.assertIsNone(OLD_IDENTITY.search(content), name)

    def assert_package(self, files):
        types = E.fromstring(files['[Content_Types].xml'])
        defaults = {n.get('Extension') for n in types if n.get('Extension')}
        overrides = {n.get('PartName', '').lstrip('/') for n in types if n.get('PartName')}
        self.assertFalse(overrides - files.keys())
        for name in files.keys() - {'[Content_Types].xml'}:
            self.assertTrue(name in overrides or name.rsplit('.', 1)[-1] in defaults, name)
            if not name.endswith('.rels'):
                continue
            owner = name.split('/_rels/')[0] if '/_rels/' in name else ''
            for rel in E.fromstring(files[name]):
                self.assertNotEqual(rel.get('TargetMode'), 'External', name)
                target = posixpath.normpath(posixpath.join(owner, rel.get('Target', ''))).lstrip('/')
                self.assertIn(target, files, name + ': ' + target)

    def test_all_sixteen_new_template_packages_have_no_old_identity_or_dangling_parts(self):
        manifest = json.loads((ROOT / 'assets/templates/manifest.json').read_text(encoding='utf8'))
        records = manifest['templates'] + manifest['groupTemplates']
        self.assertEqual(len(records), 16)
        for record in records:
            with self.subTest(template=record['file']):
                data = parts(ROOT / 'assets/templates' / record['file'])
                self.assert_clean(data)
                self.assert_package(data)
                self.assertFalse(any(n.startswith('word/media/') for n in data))

    def test_injected_unused_logo_and_hidden_header_identity_are_removed(self):
        snapshot = fixture('biot-worker-card')
        record = next(x for x in reference_sources()['templates'] if x['id'] == snapshot['templateId'])
        files = parts(ROOT / 'assets/templates' / record['file'])
        # A hidden sample identity must be treated exactly like visible text.
        header = E.Element(W + 'hdr', nsmap={'w': W[1:-1]})
        p = E.SubElement(header, W + 'p')
        r = E.SubElement(p, W + 'r', {'title': 'Солтанова Н.Н.'})
        E.SubElement(E.SubElement(r, W + 'rPr'), W + 'vanish')
        E.SubElement(r, W + 't').text = 'ТОО «Аттестационный центр Стандарт»'
        files['word/hidden-header.xml'] = E.tostring(header)
        old = next(x for x in reference_sources()['templates'] if x['id'] == 'biot-itr-certificate')
        images = parts(ROOT / 'assets/templates' / old['file'])
        logo = next(blob for name, blob in images.items() if name.startswith('word/media/'))
        files['word/media/unreferenced-copy.png'] = logo
        files['docProps/thumbnail.jpeg'] = logo
        result = sanitize_identity(files, legacy_payload(snapshot, snapshot['items'][0]))
        self.assert_clean(result)
        self.assertNotIn('word/media/unreferenced-copy.png', result)
        self.assertNotIn('docProps/thumbnail.jpeg', result)
        self.assertIn('{{N_', result['word/hidden-header.xml'].decode())
        self.assertIn('word/media/unreferenced-copy.png', files)


if __name__ == '__main__':
    unittest.main()
