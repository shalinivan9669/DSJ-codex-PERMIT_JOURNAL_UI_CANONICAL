"""Untrusted form packages must fail before invoking the office converter."""
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from template_validation import inspect_package, validate_template


class TemplateUploadBoundary(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.source = ROOT / 'assets/templates/lms-certificate.v3.docx'
        with ZipFile(self.source) as archive:
            self.files = {name: archive.read(name) for name in archive.namelist()}

    def package(self, changes):
        path = self.folder / 'input.docx'
        with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
            for name, data in (self.files | changes).items():
                archive.writestr(name, data)
        return path

    def test_active_content_rejected(self):
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_ACTIVE_CONTENT'):
            inspect_package(self.package({'word/vbaProject.bin': b'blocked'}))

    def test_external_relationship_rejected(self):
        external = b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="external" Type="image" TargetMode="External" Target="file:///private/image.png"/></Relationships>'
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_EXTERNAL_REFERENCE'):
            inspect_package(self.package({'word/_rels/header1.xml.rels': external}))

    def test_required_field_cannot_be_deleted(self):
        source = self.files['word/document.xml']
        self.assertIn(b'{{LEARNER}}', source)
        edited = self.package({'word/document.xml': source.replace(b'{{LEARNER}}', b'fixed text')})
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_FIELDS_CHANGED'):
            validate_template({'inputPath': str(edited), 'sourceFile': self.source.name, 'sourceChecksum': hashlib.sha256(self.source.read_bytes()).hexdigest(), 'templateId': 'lms-certificate'}, self.folder / 'output.docx')

    def test_path_escape_rejected(self):
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_PACKAGE_UNSAFE'):
            inspect_package(self.package({'../escaped.xml': b'<doc/>'}))


if __name__ == '__main__':
    unittest.main()
