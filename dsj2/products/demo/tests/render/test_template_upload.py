"""Untrusted form packages must fail before invoking the office converter."""
import hashlib
from io import BytesIO
import json
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

from lxml import etree as E
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from template_validation import inspect_package, validate_template
from archive_forms import MARKER, POLICY, W, R, PKG, CT, _load


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


class ArchiveTemplateUploadBoundary(unittest.TestCase):
    """Only an edited copy of the pinned archive package can be registered."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        assets = self.folder / 'assets/templates'
        assets.mkdir(parents=True)
        self.source = assets / 'pb-card.v100.docx'
        self.output = self.folder / 'validated.docx'
        self.addCleanup(patch.stopall)
        patch('template_validation.ROOT', self.folder).start()
        self.document = E.Element(W + 'document', nsmap={'w': W[1:-1], 'r': R[1:-1]})
        body = E.SubElement(self.document, W + 'body')
        p = E.SubElement(body, W + 'p')
        props = E.SubElement(p, W + 'pPr')
        E.SubElement(props, W + 'spacing', {W + 'after': '60'})
        E.SubElement(E.SubElement(p, W + 'r'), W + 't').text = '{{FULL_NAME_RU}}'
        picture = E.SubElement(E.SubElement(body, W + 'p'), W + 'r')
        shape = E.SubElement(E.SubElement(picture, W + 'pict'), '{urn:schemas-microsoft-com:vml}shape',
                             id='Photo', style='width:60pt;height:80pt')
        E.SubElement(shape, '{urn:schemas-microsoft-com:vml}imagedata', {R + 'id': 'photo'})
        section = E.SubElement(body, W + 'sectPr')
        E.SubElement(section, W + 'headerReference', {W + 'type': 'default', R + 'id': 'header'})
        E.SubElement(section, W + 'footerReference', {W + 'type': 'default', R + 'id': 'footer'})
        E.SubElement(section, W + 'pgSz', {W + 'w': '11906', W + 'h': '16838'})
        self.marker = {'policy': POLICY, 'templateId': 'pb-card', 'sourceSha256': '1' * 64,
                       'fields': ['FULL_NAME_RU', 'ISSUER_BOTH', 'NUMBER'],
                       'dynamicMedia': [{'part': 'word/media/photo.png', 'kind': 'PHOTO'}]}
        image = BytesIO()
        Image.new('RGBA', (36, 48), (255, 255, 255, 0)).save(image, 'PNG')
        types = E.Element(CT + 'Types', nsmap={None: CT[1:-1]})
        for extension, content in [('xml', 'application/xml'), ('png', 'image/png'), ('json', 'application/json')]:
            E.SubElement(types, CT + 'Default', Extension=extension, ContentType=content)
        self.files = {
            '[Content_Types].xml': E.tostring(types),
            'word/document.xml': E.tostring(self.document),
            'word/header1.xml': self.story('hdr', '{{ISSUER_BOTH}}'),
            'word/footer1.xml': self.story('ftr', '{{NUMBER}}'),
            'word/styles.xml': ('<w:styles xmlns:w="' + W[1:-1] + '"/>').encode(),
            'word/media/photo.png': image.getvalue(),
            '_rels/.rels': self.rels([('document', 'officeDocument', 'word/document.xml')]),
            'word/_rels/document.xml.rels': self.rels([
                ('photo', 'image', 'media/photo.png'), ('header', 'header', 'header1.xml'), ('footer', 'footer', 'footer1.xml')]),
            MARKER: json.dumps(self.marker).encode(),
        }
        self.write(self.source, self.files)

    @staticmethod
    def story(tag, value):
        tree = E.Element(W + tag, nsmap={'w': W[1:-1]})
        E.SubElement(E.SubElement(E.SubElement(tree, W + 'p'), W + 'r'), W + 't').text = value
        return E.tostring(tree)

    @staticmethod
    def rels(entries):
        tree = E.Element(PKG + 'Relationships', nsmap={None: PKG[1:-1]})
        for key, kind, target in entries:
            E.SubElement(tree, PKG + 'Relationship', Id=key, Type=R[1:-1] + '/' + kind, Target=target)
        return E.tostring(tree)

    @staticmethod
    def write(path, files):
        with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
            for name, data in files.items():
                archive.writestr(name, data)

    def validate(self, changes=None, removed=()):
        files = self.files | (changes or {})
        for name in removed:
            files.pop(name)
        upload = self.folder / 'upload.docx'
        self.write(upload, files)
        source_before = self.source.read_bytes()
        upload_before = upload.read_bytes()
        result = validate_template({'inputPath': str(upload), 'sourceFile': self.source.name,
            'sourceChecksum': hashlib.sha256(source_before).hexdigest(), 'templateId': self.marker['templateId']}, self.output)
        self.assertEqual(self.source.read_bytes(), source_before)
        self.assertEqual(upload.read_bytes(), upload_before)
        return result

    def test_formatting_and_split_field_copy_validates_and_still_loads_as_archive(self):
        tree = E.fromstring(self.files['word/document.xml'])
        p = tree.find('./' + W + 'body/' + W + 'p')
        p.find(W + 'pPr/' + W + 'spacing').set(W + 'after', '140')
        p.find(W + 'r/' + W + 't').text = '{{FULL_'
        E.SubElement(E.SubElement(p, W + 'r'), W + 't').text = 'NAME_RU}}'
        result = self.validate({'word/document.xml': E.tostring(tree)})
        self.assertTrue(result['validated'])
        self.assertEqual(result['fields'], sorted(self.marker['fields']))
        files, marker, _ = _load(self.output, {'templateId': 'pb-card'}, dict.fromkeys(self.marker['fields'], 'sample'))
        self.assertEqual(marker, self.marker)
        self.assertEqual(files['word/media/photo.png'], self.files['word/media/photo.png'])
        self.assertEqual(json.loads(files['demo/template-source.json'])['sourceChecksum'], hashlib.sha256(self.source.read_bytes()).hexdigest())

    def test_relationship_id_renumbering_preserves_the_same_photo_and_header_slots(self):
        tree = E.fromstring(self.files['word/document.xml'])
        for node in tree.iter():
            if node.get(R + 'id'):
                node.set(R + 'id', 'saved-' + node.get(R + 'id'))
        relationships = E.fromstring(self.files['word/_rels/document.xml.rels'])
        for node in relationships:
            node.set('Id', 'saved-' + node.get('Id'))
            node.set('Target', '/word/' + node.get('Target'))
        self.assertTrue(self.validate({'word/document.xml': E.tostring(tree),
            'word/_rels/document.xml.rels': E.tostring(relationships)})['validated'])

    def test_editor_removed_marker_is_restored_only_from_the_checked_source(self):
        self.assertTrue(self.validate(removed=[MARKER])['validated'])
        with ZipFile(self.output) as archive:
            self.assertEqual(archive.read(MARKER), self.files[MARKER])
            types = E.fromstring(archive.read('[Content_Types].xml'))
            self.assertTrue(any(node.get('PartName') == '/' + MARKER for node in types))
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_FIELDS_CHANGED'):
            self.validate({'word/header1.xml': self.story('hdr', 'removed field')}, removed=[MARKER])
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_ACTIVE_CONTENT'):
            self.validate({'customXml/item.xml': b'<private>hidden source</private>'}, removed=[MARKER])

    def test_changed_archive_identity_is_rejected(self):
        for key, value in [('sourceSha256', '2' * 64), ('dynamicMedia', []),
                           ('fieldLayoutPolicy', 'SOURCE_RUN_STYLES_WITH_BOUNDED_ADAPTIVE_FIT'),
                           ('templateId', 'ptm-card')]:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'ARCHIVE_|TEMPLATE_IDENTITY_CHANGED'):
                self.validate({MARKER: json.dumps(self.marker | {key: value}).encode()})

    def test_body_header_and_footer_fields_cannot_be_removed_or_duplicated(self):
        for part, field in [('word/document.xml', 'FULL_NAME_RU'), ('word/header1.xml', 'ISSUER_BOTH'), ('word/footer1.xml', 'NUMBER')]:
            token = ('{{' + field + '}}').encode()
            for replacement in [b'fixed sample', token + token]:
                with self.subTest(part=part, replacement=replacement), self.assertRaisesRegex(ValueError, 'TEMPLATE_FIELDS_CHANGED'):
                    self.validate({part: self.files[part].replace(token, replacement)})

    def test_extra_header_or_field_in_nonrendered_part_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_STRUCTURE_CHANGED'):
            self.validate({'word/header2.xml': self.story('hdr', '{{FULL_NAME_RU}}')})
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_FIELDS_CHANGED'):
            self.validate({'word/styles.xml': self.story('styles', '{{FULL_NAME_RU}}')})

    def test_photo_slot_and_image_bytes_cannot_be_replaced_or_removed(self):
        tree = E.fromstring(self.files['word/document.xml'])
        image = next(tree.iter('{urn:schemas-microsoft-com:vml}imagedata'))
        image.getparent().remove(image)
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_RELATIONSHIPS_CHANGED'):
            self.validate({'word/document.xml': E.tostring(tree)})
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_MEDIA_CHANGED'):
            self.validate({'word/media/photo.png': b'new personal photo'})
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_RELATIONSHIPS_CHANGED|TEMPLATE_MEDIA_CHANGED'):
            self.validate(removed=['word/media/photo.png'])

    def test_hidden_source_packages_and_word_data_connections_are_rejected(self):
        for part in ['customXml/item1.xml', 'word/recipientData.xml', 'word/comments.xml', 'word/people.xml', 'docProps/thumbnail.png']:
            with self.subTest(part=part), self.assertRaisesRegex(ValueError, 'TEMPLATE_ACTIVE_CONTENT'):
                self.validate({part: b'<private>synthetic private source</private>'})
        for tag in ['mailMerge', 'docVars', 'dataBinding', 'binData', 'fldSimple', 'instrText']:
            settings = E.Element(W + 'settings', nsmap={'w': W[1:-1]})
            E.SubElement(settings, W + tag).text = 'synthetic private source'
            with self.subTest(tag=tag), self.assertRaisesRegex(ValueError, 'TEMPLATE_ACTIVE_CONTENT|TEMPLATE_FIELDS_CHANGED'):
                self.validate({'word/settings.xml': E.tostring(settings)})

    def test_extra_local_relationship_and_external_reference_are_rejected(self):
        relationships = E.fromstring(self.files['word/_rels/document.xml.rels'])
        E.SubElement(relationships, PKG + 'Relationship', Id='new', Type=R[1:-1] + '/customXml', Target='styles.xml')
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_RELATIONSHIPS_CHANGED'):
            self.validate({'word/_rels/document.xml.rels': E.tostring(relationships)})
        relationships[-1].set('TargetMode', 'External')
        relationships[-1].set('Target', 'https://example.test/source')
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_EXTERNAL_REFERENCE'):
            self.validate({'word/_rels/document.xml.rels': E.tostring(relationships)})

    def test_reupload_of_validated_derivative_preserves_bundled_source_identity(self):
        self.validate()
        with ZipFile(self.output) as archive:
            self.files = {part: archive.read(part) for part in archive.namelist()}
        result = self.validate()
        self.assertTrue(result['validated'])
        self.assertEqual(result['sourceChecksum'], hashlib.sha256(self.source.read_bytes()).hexdigest())

    def test_roster_fields_cannot_move_out_of_the_prototype_cell(self):
        self.marker.update(templateId='pb-protocol', roster={'tableIndex': 0, 'headerRows': 1})
        self.marker['fields'].append('ONE')
        tree = E.fromstring(self.files['word/document.xml'])
        body = tree.find(W + 'body')
        first_text = next(body.iter(W + 't'))
        first_text.text = 'Protocol'
        table = E.Element(W + 'tbl')
        for values in [('No', 'Name'), ('{{ONE}}', '{{FULL_NAME_RU}}')]:
            row = E.SubElement(table, W + 'tr')
            for value in values:
                cell = E.SubElement(row, W + 'tc')
                paragraph = E.SubElement(cell, W + 'p')
                E.SubElement(E.SubElement(paragraph, W + 'r'), W + 't').text = value
        body.insert(1, table)
        self.files.update({'word/document.xml': E.tostring(tree), MARKER: json.dumps(self.marker).encode()})
        self.write(self.source, self.files)
        self.assertTrue(self.validate()['validated'])
        cells = table.findall(W + 'tr')[1].findall(W + 'tc')
        first_text.text = '{{FULL_NAME_RU}}'
        next(cells[1].iter(W + 't')).text = 'fixed name'
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_FIELDS_CHANGED'):
            self.validate({'word/document.xml': E.tostring(tree)})

    def test_legacy_source_cannot_opt_into_archive_policy(self):
        self.files.pop(MARKER)
        self.write(self.source, self.files)
        self.assertTrue(self.validate()['validated'])
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_IDENTITY_CHANGED'):
            self.validate({MARKER: json.dumps(self.marker).encode()})

    def test_unused_editor_header_copy_is_removed_but_changed_or_active_copy_is_rejected(self):
        document = E.fromstring(self.files['word/document.xml'])
        section = next(document.iter(W + 'sectPr'))
        E.SubElement(section, W + 'headerReference', {W + 'type': 'first', R + 'id': 'copy'})
        rels = E.fromstring(self.files['word/_rels/document.xml.rels'])
        E.SubElement(rels, PKG + 'Relationship', Id='copy', Type=R[1:-1] + '/header', Target='header2.xml')
        changes = {'word/document.xml': E.tostring(document), 'word/_rels/document.xml.rels': E.tostring(rels),
                   'word/header2.xml': self.files['word/header1.xml']}
        self.assertTrue(self.validate(changes, removed=[MARKER])['validated'])
        with ZipFile(self.output) as archive:
            self.assertNotIn('word/header2.xml', archive.namelist())
            tree = E.fromstring(archive.read('word/document.xml'))
            self.assertEqual([node.get(W + 'type') for node in tree.iter(W + 'headerReference')], ['default'])
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_RELATIONSHIPS_CHANGED'):
            self.validate(changes | {'word/header2.xml': self.story('hdr', '{{ISSUER_BOTH}} hidden extra source')})
        E.SubElement(section, W + 'titlePg')
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_STRUCTURE_CHANGED'):
            self.validate(changes | {'word/document.xml': E.tostring(document)})

    def test_section_header_roles_cannot_be_swapped(self):
        document = E.fromstring(self.files['word/document.xml'])
        section = next(document.iter(W + 'sectPr'))
        E.SubElement(section, W + 'headerReference', {W + 'type': 'even', R + 'id': 'even'})
        rels = E.fromstring(self.files['word/_rels/document.xml.rels'])
        E.SubElement(rels, PKG + 'Relationship', Id='even', Type=R[1:-1] + '/header', Target='header2.xml')
        self.files.update({'word/document.xml': E.tostring(document),
            'word/_rels/document.xml.rels': E.tostring(rels), 'word/header2.xml': self.story('hdr', 'Even header')})
        self.write(self.source, self.files)
        for node in section.findall(W + 'headerReference'):
            node.set(R + 'id', 'even' if node.get(W + 'type') == 'default' else 'header')
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_RELATIONSHIPS_CHANGED'):
            self.validate({'word/document.xml': E.tostring(document)})

    def test_only_existing_optional_format_edges_can_disappear(self):
        rels = E.fromstring(self.files['word/_rels/document.xml.rels'])
        E.SubElement(rels, PKG + 'Relationship', Id='web', Type=R[1:-1] + '/webSettings', Target='webSettings.xml')
        E.SubElement(rels, PKG + 'Relationship', Id='notes', Type=R[1:-1] + '/footnotes', Target='footnotes.xml')
        self.files.update({'word/_rels/document.xml.rels': E.tostring(rels),
            'word/webSettings.xml': ('<w:webSettings xmlns:w="' + W[1:-1] + '"/>').encode(),
            'word/footnotes.xml': ('<w:footnotes xmlns:w="' + W[1:-1] + '"/>').encode(),
            'word/_rels/settings.xml.rels': self.rels([])})
        self.write(self.source, self.files)
        rels.remove(rels[-1]); rels.remove(rels[-1])
        self.assertTrue(self.validate({'word/_rels/document.xml.rels': E.tostring(rels)},
            removed=['word/webSettings.xml', 'word/footnotes.xml', 'word/_rels/settings.xml.rels'])['validated'])
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_PACKAGE_CHANGED'):
            self.validate({'word/footnotes.xml': self.story('footnotes', 'hidden new content')})
        E.SubElement(rels, PKG + 'Relationship', Id='forged', Type=R[1:-1] + '/font', Target='styles.xml')
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_RELATIONSHIPS_CHANGED'):
            self.validate({'word/_rels/document.xml.rels': E.tostring(rels)})

    def test_editor_materialized_empty_grid_gap_preserves_signature_cells(self):
        document = E.fromstring(self.files['word/document.xml'])
        body = document.find(W + 'body')
        table = E.Element(W + 'tbl')
        row = E.SubElement(table, W + 'tr')
        props = E.SubElement(row, W + 'trPr')
        E.SubElement(props, W + 'gridAfter', {W + 'val': '1'})
        for value in ['Signature', '__________']:
            cell = E.SubElement(row, W + 'tc')
            E.SubElement(E.SubElement(E.SubElement(cell, W + 'p'), W + 'r'), W + 't').text = value
        body.insert(1, table)
        self.files['word/document.xml'] = E.tostring(document)
        self.write(self.source, self.files)
        props.remove(props[0])
        padding = E.SubElement(row, W + 'tc')
        p = E.SubElement(padding, W + 'p')
        self.assertTrue(self.validate({'word/document.xml': E.tostring(document)})['validated'])
        with ZipFile(self.output) as archive:
            actual = next(E.fromstring(archive.read('word/document.xml')).iter(W + 'tr'))
            self.assertEqual(len(actual.findall(W + 'tc')), 2)
            self.assertEqual(actual.find(W + 'trPr/' + W + 'gridAfter').get(W + 'val'), '1')
        E.SubElement(E.SubElement(p, W + 'r'), W + 't').text = 'Must not silently disappear'
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_STRUCTURE_CHANGED'):
            self.validate({'word/document.xml': E.tostring(document)})

    def test_bookmark_relocation_keeps_identity_and_named_fields(self):
        tree = E.fromstring(self.files['word/header1.xml'])
        paragraph = tree.find(W + 'p')
        first = E.Element(W + 'bookmarkStart', {W + 'name': 'SourceAnchorA', W + 'id': '1'})
        second = E.Element(W + 'bookmarkStart', {W + 'name': 'SourceAnchorB', W + 'id': '2'})
        paragraph.insert(0, first); paragraph.insert(1, second)
        self.files['word/header1.xml'] = E.tostring(tree)
        self.write(self.source, self.files)
        paragraph.remove(first); paragraph.remove(second)
        paragraph.append(second); paragraph.append(first)
        self.assertTrue(self.validate({'word/header1.xml': E.tostring(tree)})['validated'])
        paragraph.remove(first)
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_STRUCTURE_CHANGED'):
            self.validate({'word/header1.xml': E.tostring(tree)})

    def test_only_unused_numbering_definition_can_be_removed(self):
        rels = E.fromstring(self.files['word/_rels/document.xml.rels'])
        E.SubElement(rels, PKG + 'Relationship', Id='numbering', Type=R[1:-1] + '/numbering', Target='numbering.xml')
        self.files.update({'word/_rels/document.xml.rels': E.tostring(rels),
            'word/numbering.xml': ('<w:numbering xmlns:w="' + W[1:-1] + '"/>').encode()})
        self.write(self.source, self.files)
        rels.remove(rels[-1])
        changes = {'word/_rels/document.xml.rels': E.tostring(rels)}
        self.assertTrue(self.validate(changes, removed=['word/numbering.xml'])['validated'])
        document = E.fromstring(self.files['word/document.xml'])
        props = next(document.iter(W + 'pPr'))
        E.SubElement(E.SubElement(props, W + 'numPr'), W + 'numId', {W + 'val': '7'})
        self.files['word/document.xml'] = E.tostring(document)
        self.write(self.source, self.files)
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_RELATIONSHIPS_CHANGED'):
            self.validate(changes, removed=['word/numbering.xml'])


if __name__ == '__main__':
    unittest.main()
