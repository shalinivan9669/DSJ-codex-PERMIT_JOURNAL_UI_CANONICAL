"""The one-time source upgrade must never rewrite an existing version."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]


class NeutralUpgradeTests(unittest.TestCase):
    def test_existing_versions_cannot_be_rebuilt_even_with_an_obsolete_flag(self):
        manifest = json.loads((ROOT / 'assets/templates/manifest.json').read_text(encoding='utf8'))
        paths = [ROOT / 'assets/templates' / item['file']
                 for item in manifest['templates'] + manifest['groupTemplates']]
        paths += [ROOT / 'assets/templates/manifest.json',
                  ROOT / 'scripts/render/neutral_forms_sources.json']
        before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
        result = subprocess.run([sys.executable, '-X', 'utf8',
                                 str(ROOT / 'scripts/render/upgrade_neutral_forms.py'),
                                 '--rebuild-unregistered'], cwd=ROOT, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'NEW_VERSION_ALREADY_EXISTS:', result.stderr)
        self.assertEqual(before, {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths})


if __name__ == '__main__':
    unittest.main()
