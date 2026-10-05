"""Empty optional values must not revive sample data or leave neutral markers."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from zipfile import ZipFile

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from renderer import render_docx
from test_render import fixture
import test_neutral_identity_audit as identity_audit


class NeutralOptionalFieldTests(unittest.TestCase):
    def test_all_eleven_individual_forms_accept_empty_optional_values(self):
        manifest = json.loads((ROOT / 'assets/templates/manifest.json').read_text(encoding='utf8'))
        self.assertEqual(len(manifest['templates']), 11)
        with tempfile.TemporaryDirectory(prefix='demo-neutral-optional-') as directory:
            for template in manifest['templates']:
                with self.subTest(template=template['id']):
                    snapshot = fixture(template['id'])
                    snapshot.update(demoMode=False, englishAppendix=False)
                    item = snapshot['items'][0]
                    item.update(registrationNumber='', seriesNumber='', series='', departmentRu='', departmentKz='',
                                personnelNumber='', externalId='', education='', employmentPeriod='')
                    item.pop('photoAssetId', None)
                    snapshot['photos'] = {}
                    item['assignment'].update(reason='', reasonRu='', reasonKz='', education='', educationRu='', educationKz='',
                                              biotUniqueNumber='', biotNotes='', biotNotesRu='', biotNotesKz='')
                    # Required name, issuer, program, result and all frozen dates
                    # deliberately stay populated: this exercises optional data.
                    output = Path(directory) / (template['id'] + '.docx')
                    result = render_docx(snapshot, output)
                    self.assertEqual(result['renderPolicy'], 'NEUTRAL_FORMS_V1')
                    with ZipFile(output) as archive:
                        files = {name: archive.read(name) for name in archive.namelist()}
                    audit = identity_audit.NeutralIdentityAuditTests()
                    audit.assert_clean(files)
                    audit.assert_package(files)
                    word_trees = [E.fromstring(data) for name, data in files.items()
                                  if name.startswith('word/') and name.endswith('.xml')]
                    all_content = ' '.join(' '.join(tree.itertext()) + ' '.join(value for node in tree.iter() for value in node.attrib.values())
                                           for tree in word_trees)
                    self.assertNotRegex(all_content, r'\{\{N_[a-f0-9]{16}\}\}|\{\{[A-Z][A-Z0-9_]*\}\}')
                    self.assertIsNone(identity_audit.OLD_IDENTITY.search(all_content))
                    self.assertIn(item['fullNameRu'], all_content)
                    self.assertIn(snapshot['issuer']['nameRu'], all_content)
                    self.assertIn('2026', all_content)
                    self.assertFalse(any(name.startswith('word/media/') for name in files))


if __name__ == '__main__':
    unittest.main()
