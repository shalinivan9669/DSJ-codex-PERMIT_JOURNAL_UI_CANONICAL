"""Archive preparation is fail-closed and preserves immutable source geometry.

All packages are synthetic. No archived personal data or real source DOCX is
needed to check conversion, privacy boundaries, or source immutability.
"""
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import hashlib
import json
import sys
import unittest
from zipfile import ZipFile, ZIP_DEFLATED

from lxml import etree as E
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from build_archive_templates import prepare, W, R, PKG, CT, MARKER, POLICY

V = '{urn:schemas-microsoft-com:vml}'
O = '{urn:schemas-microsoft-com:office:office}'


def xml(root):
    return E.tostring(root, encoding='utf-8', xml_declaration=True)


def paragraph(text=''):
    node = E.Element(W + 'p')
    E.SubElement(E.SubElement(node, W + 'r'), W + 't').text = text
    return node


def field_nodes(name='Recipient', simple=False):
    if simple:
        field = E.Element(W + 'fldSimple', {W + 'instr': ' MERGEFIELD "' + name + '" '})
        E.SubElement(E.SubElement(field, W + 'r'), W + 't').text = 'SYNTHETIC_CACHED_RECIPIENT'
        return [field]
    result = []
    for tag, value in [('fldChar', 'begin'), ('instrText', ' MERGE'),
                       ('instrText', 'FIELD "' + name + '" \\* MERGEFORMAT '),
                       ('fldChar', 'separate'), ('t', 'SYNTHETIC_CACHED_'),
                       ('t', 'RECIPIENT'), ('fldChar', 'end')]:
        run = E.Element(W + 'r')
        node = E.SubElement(run, W + tag)
        if tag == 'fldChar':
            node.set(W + 'fldCharType', value)
        else:
            node.text = value
        result.append(run)
    return result


class ArchiveTemplateBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.document = E.Element(W + 'document', nsmap={'w': W[1:-1], 'r': R[1:-1]})
        self.body = E.SubElement(self.document, W + 'body')
        self.body.append(paragraph('Public fixed legal wording'))
        section = E.SubElement(self.body, W + 'sectPr')
        E.SubElement(section, W + 'pgSz', {W + 'w': '16838', W + 'h': '11906', W + 'orient': 'landscape'})
        E.SubElement(section, W + 'pgMar', {W + 'top': '340', W + 'bottom': '400', W + 'left': '500', W + 'right': '600'})
        self.types = E.Element(CT + 'Types', nsmap={None: CT[1:-1]})
        E.SubElement(self.types, CT + 'Default', Extension='xml', ContentType='application/xml')
        E.SubElement(self.types, CT + 'Default', Extension='rels', ContentType='application/vnd.openxmlformats-package.relationships+xml')
        self.relationships = E.Element(PKG + 'Relationships', nsmap={None: PKG[1:-1]})
        self.parts = {
            'word/styles.xml': b'<?xml version="1.0"?><w:styles xmlns:w="' + W[1:-1].encode() + b'"><w:style w:styleId="ArchiveFont"/></w:styles>',
            'word/numbering.xml': b'<w:numbering xmlns:w="' + W[1:-1].encode() + b'"/>',
            'word/fontTable.xml': b'<w:fonts xmlns:w="' + W[1:-1].encode() + b'"><w:font w:name="Times New Roman"/></w:fonts>',
            'word/theme/theme1.xml': b'<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Synthetic layout"/>',
            'word/printerSettings/printerSettings1.bin': b'\x00SYNTHETIC_LAYOUT_BYTES\xff',
            'word/header1.xml': xml(E.Element(W + 'hdr', nsmap={'w': W[1:-1]})),
        }

    def add(self, node):
        self.body.insert(len(self.body) - 1, node)
        return node

    def write(self, **overrides):
        parts = dict(self.parts)
        parts.update({'[Content_Types].xml': xml(self.types),
                      'word/document.xml': xml(self.document),
                      'word/_rels/document.xml.rels': xml(self.relationships)})
        source = self.root / 'source.docx'
        with ZipFile(source, 'w', ZIP_DEFLATED) as archive:
            for part, value in parts.items():
                archive.writestr(part, value)
        blueprint = {'id': 'pb-card', 'source': source.name,
                     'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                     'mergeFields': {'Recipient': 'FULL_NAME_RU'}, 'media': []}
        blueprint.update(overrides)
        return source, parts, blueprint

    def run_prepare(self, **overrides):
        source, before, blueprint = self.write(**overrides)
        source_bytes = source.read_bytes()
        blueprint_before = deepcopy(blueprint)
        result, report = prepare(self.root, blueprint)
        self.assertEqual(source.read_bytes(), source_bytes, 'source archive must be immutable')
        self.assertEqual(blueprint, blueprint_before, 'caller blueprint must be immutable')
        return result, report, before

    def test_package_preserves_unmodified_layout_parts_and_source_bytes(self):
        files, report, original = self.run_prepare()
        self.assertEqual(set(files), set(original) | {MARKER})
        for part, content in original.items():
            if part == '[Content_Types].xml':
                continue
            self.assertEqual(files[part], content, part)
            self.assertEqual(report['preservedParts'][part], hashlib.sha256(content).hexdigest())
        marker = json.loads(files[MARKER])
        self.assertEqual(marker['policy'], POLICY)
        self.assertEqual(marker['templateId'], 'pb-card')
        self.assertEqual(marker['fields'], [])
        self.assertEqual(report['removedParts'], [])

    def test_simple_and_split_complex_fields_in_body_header_and_footer(self):
        for simple in (False, True):
            p = self.add(E.Element(W + 'p'))
            p.extend(field_nodes(simple=simple))
        for part, tag in [('word/header1.xml', 'hdr'), ('word/footer2.xml', 'ftr')]:
            root = E.Element(W + tag, nsmap={'w': W[1:-1]})
            p = E.SubElement(root, W + 'p')
            p.extend(field_nodes(simple=True))
            self.parts[part] = xml(root)
        files, _, _ = self.run_prepare()
        for part, count in [('word/document.xml', 2), ('word/header1.xml', 1), ('word/footer2.xml', 1)]:
            tree = E.fromstring(files[part])
            text = ''.join(tree.itertext())
            self.assertEqual(text.count('{{FULL_NAME_RU}}'), count)
            self.assertNotIn('SYNTHETIC_CACHED', text)
            self.assertFalse(list(tree.iter(W + 'fldChar')))
            self.assertFalse(list(tree.iter(W + 'instrText')))
            self.assertFalse(list(tree.iter(W + 'fldSimple')))

    def test_unknown_mergefields_fail_without_mutating_source(self):
        for simple in (False, True):
            with self.subTest(simple=simple):
                p = self.add(E.Element(W + 'p'))
                p.extend(field_nodes('Unmapped', simple))
                source, _, blueprint = self.write()
                before = source.read_bytes()
                with self.assertRaisesRegex(ValueError, 'ARCHIVE_UNMAPPED'):
                    prepare(self.root, blueprint)
                self.assertEqual(source.read_bytes(), before)
                self.body.remove(p)

    def test_field_crossing_paragraphs_cannot_consume_textbox_story(self):
        runs = field_nodes()
        opening = self.add(E.Element(W + 'p'))
        opening.extend(runs[:5])
        drawing = self.add(E.Element(W + 'p'))
        shape = E.SubElement(E.SubElement(E.SubElement(drawing, W + 'r'), W + 'pict'), V + 'shape',
                             nsmap={'v': V[1:-1]}, id='IndependentStory')
        box = E.SubElement(E.SubElement(shape, V + 'textbox'), W + 'txbxContent')
        p = E.SubElement(box, W + 'p')
        p.extend(field_nodes('Issuer'))
        closing = self.add(E.Element(W + 'p'))
        closing.extend(runs[5:])
        files, _, _ = self.run_prepare(mergeFields={'Recipient': 'FULL_NAME_RU', 'Issuer': 'ISSUER_RU'})
        tree = E.fromstring(files['word/document.xml'])
        visible = ''.join(node.text or '' for node in tree.iter(W + 't'))
        self.assertEqual(visible.count('{{FULL_NAME_RU}}'), 1)
        self.assertEqual(visible.count('{{ISSUER_RU}}'), 1)
        self.assertNotIn('SYNTHETIC_CACHED_', visible)
        self.assertEqual(''.join(next(tree.iter(W + 'txbxContent')).itertext()), '{{ISSUER_RU}}')
        self.assertFalse(list(tree.iter(W + 'fldChar')))

    def test_date_aliases_use_context_and_scoped_protocol_override(self):
        for label in ('Дата выдачи: ', 'Действительно до ', 'Основание: Протокол № '):
            p = self.add(paragraph(label))
            p.extend(field_nodes('Year'))
        separate = self.add(paragraph('Протокол № {{PROTOCOL_NUMBER}}'))
        date = self.add(E.Element(W + 'p'))
        date.extend(field_nodes('Year'))
        files, _, _ = self.run_prepare(mergeFields={'Year': 'DOCUMENT_YEAR'}, paragraphSlots=[{
            'part': 'word/document.xml', 'xpath': E.ElementTree(self.document).getpath(date),
            'value': '{{PROTOCOL_YEAR}}'}])
        tree = E.fromstring(files['word/document.xml'])
        paragraphs = [''.join(node.text or '' for node in p.iter(W + 't')) for p in tree.iter(W + 'p')]
        self.assertIn('Дата выдачи: {{DOCUMENT_YEAR}}', paragraphs)
        self.assertIn('Действительно до {{VALID_YEAR}}', paragraphs)
        self.assertIn('Основание: Протокол № {{PROTOCOL_YEAR}}', paragraphs)
        index = paragraphs.index(''.join(separate.itertext()))
        self.assertEqual(paragraphs[index + 1], '{{PROTOCOL_YEAR}}')

    def test_unknown_fields_nested_in_inline_containers_fail_closed(self):
        # Word can wrap a field's runs in a hyperlink or structured document tag.
        # Such an unknown field must not survive as a refreshable cached name.
        for container in ('hyperlink', 'sdtContent'):
            for simple in (False, True):
                with self.subTest(container=container, simple=simple):
                    p = self.add(E.Element(W + 'p'))
                    parent = E.SubElement(p, W + container)
                    parent.extend(field_nodes('UnmappedPrivateRecipient', simple))
                    _, _, blueprint = self.write()
                    with self.assertRaisesRegex(ValueError, 'ARCHIVE_'):
                        prepare(self.root, blueprint)
                    self.body.remove(p)

    def test_hash_mismatch_and_outside_source_root_fail_closed(self):
        source, _, blueprint = self.write()
        before = source.read_bytes()
        blueprint['sourceSha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'ARCHIVE_SOURCE_HASH'):
            prepare(self.root, blueprint)
        self.assertEqual(source.read_bytes(), before)
        blueprint['source'] = '../outside.docx'
        with self.assertRaisesRegex(ValueError, 'ARCHIVE_SOURCE_PATH'):
            prepare(self.root, blueprint)

    def test_scoped_text_and_paragraph_patches_preserve_nested_drawings(self):
        outer = self.add(paragraph('SYNTHETIC_OUTER_IDENTITY'))
        pict = E.SubElement(E.SubElement(outer, W + 'r'), W + 'pict')
        # Real legacy documents declare v/wps on the drawing, not the document root.
        shape = E.SubElement(pict, V + 'shape', nsmap={'v': V[1:-1]},
                             id='StableShape', style='position:absolute;width:240pt;height:72pt')
        box = E.SubElement(E.SubElement(shape, V + 'textbox'), W + 'txbxContent')
        nested = paragraph('SYNTHETIC_INNER_IDENTITY')
        box.append(nested)
        props = E.Element(W + 'pPr')
        E.SubElement(props, W + 'spacing', {W + 'before': '60', W + 'after': '80'})
        nested.insert(0, props)
        original_geometry = dict(shape.attrib)
        paths = E.ElementTree(self.document)
        files, _, _ = self.run_prepare(
            textSlots=[{'part': 'word/document.xml', 'xpath': paths.getpath(outer.find('./' + W + 'r/' + W + 't')), 'value': '{{ISSUER_RU}}'}],
            paragraphSlots=[{'part': 'word/document.xml', 'xpath': paths.getpath(nested), 'value': '{{CHAIR_NAME}}'}])
        tree = E.fromstring(files['word/document.xml'])
        current_shape = next(tree.iter(V + 'shape'))
        self.assertEqual(dict(current_shape.attrib), original_geometry)
        self.assertEqual(xml(next(tree.iter(W + 'pPr'))), xml(props))
        self.assertEqual(len(list(tree.iter(V + 'textbox'))), 1)
        self.assertEqual(len(list(tree.iter(W + 'sectPr'))), 1)
        self.assertIn('{{ISSUER_RU}}', ''.join(tree.itertext()))
        self.assertIn('{{CHAIR_NAME}}', ''.join(tree.itertext()))
        self.assertNotIn('SYNTHETIC_', ''.join(tree.itertext()))

    def test_whole_paragraph_patch_refuses_nested_textbox(self):
        p = self.add(paragraph('outer'))
        box = E.SubElement(E.SubElement(p, W + 'r'), W + 'txbxContent')
        box.append(paragraph('inner'))
        _, _, blueprint = self.write(paragraphSlots=[{'part': 'word/document.xml',
            'xpath': E.ElementTree(self.document).getpath(p), 'value': '{{ISSUER_RU}}'}])
        with self.assertRaisesRegex(ValueError, 'ARCHIVE_PARAGRAPH_CONTAINS_DRAWING_TEXT'):
            prepare(self.root, blueprint)

    def test_privacy_removes_connections_hidden_recipients_ole_and_external_links(self):
        settings = E.Element(W + 'settings', nsmap={'w': W[1:-1], 'r': R[1:-1]})
        merge = E.SubElement(settings, W + 'mailMerge')
        E.SubElement(merge, W + 'dataSource', {R + 'id': 'rIdMail'})
        variables = E.SubElement(settings, W + 'docVars')
        E.SubElement(variables, W + 'docVar', {W + 'name': 'OldName', W + 'val': 'SYNTHETIC_PRIVATE_NAME'})
        self.parts['word/settings.xml'] = xml(settings)
        hidden = ['customXml/item1.xml', 'customXml/_rels/item1.xml.rels',
                  'word/recipientData.xml', 'word/comments.xml', 'word/people.xml']
        for part in hidden:
            self.parts[part] = b'<private>SYNTHETIC_PRIVATE_NAME</private>'
        self.parts['word/embeddings/oleObject1.bin'] = b'SYNTHETIC_PRIVATE_NAME'
        self.parts['docProps/thumbnail.jpeg'] = b'SYNTHETIC_OLD_PHOTO'
        self.parts['docProps/core.xml'] = b'<p:coreProperties xmlns:p="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"><p:creator>SYNTHETIC_PRIVATE_NAME</p:creator></p:coreProperties>'
        for part in hidden + ['word/embeddings/oleObject1.bin', 'docProps/thumbnail.jpeg']:
            E.SubElement(self.types, CT + 'Override', PartName='/' + part, ContentType='application/octet-stream')
        for index, kind in enumerate(['oleObject', 'customXml', 'recipientData', 'comments', 'people', 'thumbnail', 'attachedTemplate']):
            E.SubElement(self.relationships, PKG + 'Relationship', Id='remove' + str(index),
                         Type=R[1:-1] + '/' + kind, Target='SYNTHETIC_PRIVATE_NAME')
        E.SubElement(self.relationships, PKG + 'Relationship', Id='external', Type=R[1:-1] + '/hyperlink',
                     Target='https://example.test/SYNTHETIC_PRIVATE_NAME', TargetMode='External')
        E.SubElement(self.relationships, PKG + 'Relationship', Id='keep', Type=R[1:-1] + '/styles', Target='styles.xml')
        p = self.add(paragraph('Retain ordinary text and signature line: __________'))
        obj = E.SubElement(E.SubElement(p, W + 'r'), W + 'object')
        E.SubElement(obj, O + 'OLEObject', {R + 'id': 'remove0'})
        E.SubElement(p, W + 'commentReference', {W + 'id': '3'})
        drawing = E.SubElement(E.SubElement(p, W + 'r'), W + 'drawing')
        E.SubElement(drawing, '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}docPr',
                     id='1', name='Stable drawing', descr='SYNTHETIC_PRIVATE_NAME', title='SYNTHETIC_PRIVATE_NAME')
        files, report, _ = self.run_prepare()
        for part in hidden + ['word/embeddings/oleObject1.bin', 'docProps/thumbnail.jpeg']:
            self.assertNotIn(part, files)
            self.assertIn(part, report['removedParts'])
        self.assertNotIn(b'SYNTHETIC_PRIVATE_NAME', b''.join(files.values()))
        self.assertNotIn(b'SYNTHETIC_OLD_PHOTO', b''.join(files.values()))
        settings_after = E.fromstring(files['word/settings.xml'])
        self.assertFalse(list(settings_after.iter(W + 'mailMerge')))
        self.assertFalse(list(settings_after.iter(W + 'docVars')))
        rels = E.fromstring(files['word/_rels/document.xml.rels'])
        self.assertEqual([node.get('Id') for node in rels], ['keep'])
        types = E.fromstring(files['[Content_Types].xml'])
        self.assertFalse(set(hidden) & {n.get('PartName', '').lstrip('/') for n in types})
        document = E.fromstring(files['word/document.xml'])
        self.assertFalse(list(document.iter(W + 'object')))
        self.assertFalse(list(document.iter(O + 'OLEObject')))
        self.assertEqual(len(list(document.iter(W + 'drawing'))), 1)
        self.assertIn('signature line: __________', ''.join(document.itertext()))

    def test_source_images_blank_and_dynamic_slots_use_photo_or_current_issuer(self):
        media = []
        for index, (kind, fmt) in enumerate([('PHOTO', 'JPEG'), ('BLANK', 'PNG'), ('LOGO', 'PNG')]):
            part = 'word/media/image' + str(index) + ('.jpeg' if fmt == 'JPEG' else '.png')
            stream = BytesIO()
            Image.new('RGB', (17 + index, 23 + index), (60, 20, 140)).save(stream, fmt)
            self.parts[part] = stream.getvalue()
            media.append({'part': part, 'kind': kind})
        files, _, before = self.run_prepare(media=media)
        for index, item in enumerate(media):
            part = item['part']
            self.assertNotEqual(files[part], before[part])
            with Image.open(BytesIO(files[part])) as image:
                self.assertEqual(image.size, (17 + index, 23 + index))
                if image.format == 'JPEG':
                    self.assertEqual(image.convert('RGB').getextrema(), ((255, 255),) * 3)
                else:
                    self.assertEqual(image.getchannel('A').getextrema(), (0, 0))
        self.assertEqual(json.loads(files[MARKER])['dynamicMedia'], [
            media[0], {'part': media[2]['part'], 'kind': 'ISSUER_NAME'}])

    def test_unclassified_media_fails_closed(self):
        stream = BytesIO()
        Image.new('RGB', (10, 10), (1, 2, 3)).save(stream, 'PNG')
        self.parts['word/media/forgotten.png'] = stream.getvalue()
        source, _, blueprint = self.write()
        before = source.read_bytes()
        with self.assertRaisesRegex(ValueError, 'ARCHIVE_UNCLASSIFIED_IMAGE'):
            prepare(self.root, blueprint)
        self.assertEqual(source.read_bytes(), before)

    def test_photo_placeholder_keeps_geometry_and_adds_local_image_relationship(self):
        p = self.add(E.Element(W + 'p'))
        shape = E.SubElement(E.SubElement(E.SubElement(p, W + 'r'), W + 'pict'), V + 'rect',
                             nsmap={'v': V[1:-1]}, id='BlankPhoto', style='width:60pt;height:80pt')
        files, _, _ = self.run_prepare(photoShapes=[{'part': 'word/document.xml', 'shapeId': 'BlankPhoto'}])
        document = E.fromstring(files['word/document.xml'])
        current = next(document.iter(V + 'rect'))
        self.assertEqual(dict(current.attrib), dict(shape.attrib))
        image = current.find(V + 'imagedata')
        self.assertEqual(image.get(R + 'id'), 'rIdArchivePhoto0')
        relations = E.fromstring(files['word/_rels/document.xml.rels'])
        self.assertEqual(len(relations), 1)
        self.assertEqual(relations[0].get('Target'), 'media/archive-photo-0.png')
        self.assertIsNone(relations[0].get('TargetMode'))
        with Image.open(BytesIO(files['word/media/archive-photo-0.png'])) as picture:
            self.assertEqual(picture.size, (360, 480))
            self.assertEqual(picture.getchannel('A').getextrema(), (0, 0))
        self.assertEqual(json.loads(files[MARKER])['dynamicMedia'], [{'part': 'word/media/archive-photo-0.png', 'kind': 'PHOTO'}])

    def test_roster_prunes_sample_people_and_keeps_header_and_signature_table(self):
        table = self.add(E.Element(W + 'tbl'))
        props = E.SubElement(table, W + 'tblPr')
        E.SubElement(props, W + 'tblW', {W + 'w': '12000', W + 'type': 'dxa'})
        for values in [('No', 'Name'), ('1', 'SYNTHETIC_PERSON_A'), ('2', 'SYNTHETIC_PERSON_B')]:
            row = E.SubElement(table, W + 'tr')
            E.SubElement(E.SubElement(row, W + 'trPr'), W + 'tblHeader')
            for value in values:
                cell = E.SubElement(row, W + 'tc')
                cell.append(paragraph(value))
                E.SubElement(E.SubElement(cell[0], W + 'pPr'), W + 'ind', {
                    W+'left':'357', W+'hanging':'357'})
        signatures = self.add(E.Element(W + 'tbl'))
        cell = E.SubElement(E.SubElement(signatures, W + 'tr'), W + 'tc')
        cell.append(paragraph('Chair signature: __________'))
        original_signature = xml(signatures)
        files, _, _ = self.run_prepare(roster={'tableIndex': 0, 'headerRows': 1,
            'rowValues': ['{{ROW_NUMBER}}', '{{FULL_NAME_BOTH}}']})
        document = E.fromstring(files['word/document.xml'])
        current, signature = list(document.iter(W + 'tbl'))
        self.assertEqual(len(current.findall(W + 'tr')), 2)
        self.assertIsNotNone(current.find('./' + W + 'tr/' + W + 'trPr/' + W + 'tblHeader'))
        data = current.findall(W + 'tr')[1]
        self.assertIsNone(data.find('./' + W + 'trPr/' + W + 'tblHeader'))
        ordinal, name = data.findall(W + 'tc')
        self.assertEqual(ordinal.find('./' + W+'p/'+W+'pPr/'+W+'ind').get(W+'left'), '0')
        self.assertIsNone(ordinal.find('./' + W+'p/'+W+'pPr/'+W+'ind').get(W+'hanging'))
        self.assertEqual(name.find('./' + W+'p/'+W+'pPr/'+W+'ind').get(W+'left'), '357')
        self.assertEqual(xml(signature), original_signature)
        self.assertEqual(xml(current.find(W + 'tblPr')), xml(props))
        self.assertNotIn('SYNTHETIC_PERSON_', ''.join(document.itertext()))
        marker = json.loads(files[MARKER])
        self.assertEqual(marker['roster'], {'tableIndex': 0, 'headerRows': 1})
        self.assertEqual(marker['fields'], ['FULL_NAME_BOTH', 'ROW_NUMBER'])


if __name__ == '__main__':
    unittest.main()
