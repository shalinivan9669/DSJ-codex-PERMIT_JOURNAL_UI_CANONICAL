"""Same-input equivalence to the verified 90d5 reference implementation.

The control helpers are pinned by independently checked source hashes. This
test deliberately shares the adapter's payload: it proves rendering parity,
not correctness of the separate DEMO-to-legacy field mapping. No production
recipient documents are used. ZIP timestamps are not document semantics.
"""
from copy import deepcopy
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from lxml import etree as E
import pdfplumber

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'scripts/render'
sys.path.insert(0, str(SCRIPTS))
from legacy_reference import (freeze_reference_dates, identify_reference, legacy_payload,
                              prepare_reference_source, reference_opc_package,
                              reference_package_declarations, render_reference_files)
from renderer import convert_pdf, render_docx
from sanitize_templates import deterministic_zip
from test_render import fixture

SOURCE_COMMIT = '90d5b5e72dba0ac38c89f42fa37925a0b3468561'
HELPERS = {
    'generate_biot_card.py': 'ea6c8c06ee41d5954fdab5734ca75d61d84fe9ec9f8a74bdfbc419eb1bbb8b17',
    'generate_biot_mail_merge_bundle.py': '1e1c32706d288aec3999588c76d0407ed24b988c479e39edc2fd0d9a0c9b3e15',
    'generate_ps_witness_certificate.py': 'af72244318a96f2e73c2e7bd2e84c082c76f5755c202d7c9ed405a6e267a8dc0',
}
SOURCE_HASHES = {
    'biot-worker-card': '6dcadf33f59c8d50cac3c2c079c35482c3a83c3804c99a9e03912812f8ec8a41',
    'biot-itr-certificate': 'd817d041ab6153508c851d1f6318561afd7988331619aac7f144f8c688c8d135',
    'biot-protocol': '31309ce6db0990d98c235fc80364ba21ccd0ae9c0fc262917be3601a0268047b',
    'ptm-card': '51b4f7bcc6bf615e33165fc7c94cdd357600ffa246e7f2ac537be62e699d5993',
    'ptm-protocol': '3a00ea89bd065f9028b0c7160fbbdd6fd0938bff9d4e57af9d33212549fd463d',
    'pb-card': 'c7ef42764a704361f4d1b25f38eac80e37085d469faa606102ec9641c984b286',
    'pb-protocol': '97efee62080313e92c189d7c773512edc12823a6a0a8619262c5c422e1272cb9',
    'ps-card': '5b15ccfcd0060e40fbb8802f1b043bbeabf8995768c352adbca0beafe86c8de4',
    'ps-protocol': '27991f16de5cda63ab96d9739d7b0a43e48bbb9e89fc2f9dd8e78a06e1afbbc8',
    'ps-witness': '3bdded624486820c538362bcef9c10dabfd2a63570d26d8aa3e827bbea2b11b1',
    'biot-itr-protocol': '31309ce6db0990d98c235fc80364ba21ccd0ae9c0fc262917be3601a0268047b',
}
OUT = Path(os.environ.get('DEMO_RENDER_EVIDENCE_ROOT', str(ROOT / '.runtime'))) / 'legacy-reference-equivalence'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
XML_SPACE = '{http://www.w3.org/XML/1998/namespace}space'
NS = {'w': W[1:-1]}
OPC_PARTS = {'[Content_Types].xml', 'word/_rels/document.xml.rels'}


def registry():
    return json.loads((SCRIPTS / 'legacy_reference_sources.json').read_text(encoding='utf8'))


def package_parts(source):
    with ZipFile(BytesIO(source) if isinstance(source, bytes) else source) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def comparable_part(name, data):
    if name == 'docProps/core.xml':
        # python-docx may update only the modified timestamp when saving PS.
        root = E.fromstring(data)
        for node in root.findall('{http://purl.org/dc/terms/}modified'):
            node.text = 'TIMESTAMP'
        return E.tostring(root, method='c14n')
    return data


def xml_values(node):
    """Expanded names ignore prefixes, but retain every value and child position."""
    return (node.tag, tuple(sorted(node.attrib.items())), node.text, node.tail,
            tuple(xml_values(child) for child in node))


def missing_compatibility_aliases(root):
    return {prefix for node in root.iter() for name, value in node.attrib.items()
            if E.QName(name).localname in {'Ignorable', 'Requires'}
            for prefix in value.split() if prefix not in node.nsmap}


def geometry(document_xml):
    names = {'pgSz', 'pgMar', 'gridCol', 'tblW', 'trHeight', 'tcW',
             'shape', 'rect', 'group', 'extent', 'positionH', 'positionV', 'posOffset'}
    return [(node.tag, sorted(node.attrib.items()), node.text if E.QName(node).localname == 'posOffset' else None)
            for node in E.fromstring(document_xml).iter() if E.QName(node).localname in names]


def data_only_structure(data):
    """Independent whitelist: values and active DATE markers, never formatting.

    Retains every run, paragraph, table, shape and other element/attribute.
    Text-node count is retained; only its value and xml:space may differ.
    Active DATE fields are identified here without using adapter field parsing.
    """
    root = E.fromstring(data)
    for paragraph in root.iter(W + 'p'):
        stack = []
        for node in list(paragraph.iter()):
            if node.tag == W + 'fldChar' and node.get(W + 'fldCharType') == 'begin':
                stack.append({'nodes': [node], 'instruction': []})
            elif node.tag == W + 'instrText' and stack:
                stack[-1]['nodes'].append(node)
                stack[-1]['instruction'].append(node.text or '')
            elif node.tag == W + 'fldChar' and stack:
                stack[-1]['nodes'].append(node)
                if node.get(W + 'fldCharType') == 'end':
                    field = stack.pop()
                    if re.match(r'^\s*DATE(?:\s|$)', ''.join(field['instruction']), re.I):
                        for marker in field['nodes']:
                            marker.getparent().remove(marker)

    def signature(node):
        attributes = dict(node.attrib)
        value = node.text
        if node.tag == W + 't':
            value = 'VALUE'
            attributes.pop(XML_SPACE, None)
        return (node.tag, tuple(sorted(attributes.items())), value, node.tail,
                tuple(signature(child) for child in node))
    return signature(root)


def direct_control(template, snapshot, payload, output):
    if snapshot['templateId'] == 'ps-witness':
        from generate_ps_witness_certificate import render_document_bytes
        output.write_bytes(render_document_bytes(template, deepcopy(payload['fields'])))
    else:
        from generate_biot_card import render
        render(template, output, deepcopy(payload['fields']), deepcopy(payload['photo']),
               deepcopy(payload.get('textReplacements', [])),
               deepcopy(payload.get('fieldStyleOverrides', {})))
    return package_parts(output)


def production_control(template, snapshot, payload, output):
    """Reference fill plus the explicitly declared data-only production steps."""
    with tempfile.TemporaryDirectory(prefix='demo-reference-data-control-') as temp:
        prepared = Path(temp) / 'source.docx'
        deterministic_zip(prepared, prepare_reference_source(
            package_parts(template), snapshot, snapshot['items'][0], payload))
        core = direct_control(prepared, snapshot, payload, output)
        result = freeze_reference_dates(core, snapshot, snapshot['items'][0])
        deterministic_zip(output, result)
        return result


def physical_geometry(page):
    glyphs = sorted((char['text'], char['fontname'].split('+')[-1],
                     *(round(float(char[key]), 4) for key in ('x0', 'top', 'x1', 'bottom', 'size')))
                    for char in page.chars)
    drawings = sorted((kind, *(round(float(item[key]), 4) for key in ('x0', 'top', 'x1', 'bottom')))
                      for kind, items in [('image', page.images), ('line', page.lines), ('rect', page.rects)]
                      for item in items)
    return (page.width, page.height, glyphs, drawings)


class LegacyReferenceEquivalenceTests(unittest.TestCase):
    def assert_package_equal(self, control, candidate):
        self.assertEqual(set(control), set(candidate), 'The adapter changed the package part inventory')
        for name in control:
            self.assertEqual(comparable_part(name, control[name]), comparable_part(name, candidate[name]),
                             f'The adapter transformed a legacy output part: {name}')
        self.assertEqual(geometry(control['word/document.xml']), geometry(candidate['word/document.xml']))

    def assert_production_package_equal(self, control, candidate, template):
        """Only declared container repairs may differ from the data-only control.

        This comparator does not call production repair functions. Namespace
        additions must resolve a previously unbound compatibility prefix from
        the pinned raw package. All expanded XML names/values and media remain
        exact; other namespace maps must retain their existing bindings.
        """
        source = package_parts(template)
        source_trees = {name: E.fromstring(data) for name, data in source.items()
                        if name.endswith(('.xml', '.rels'))}
        self.assertEqual(set(control), set(candidate))
        for name, data in control.items():
            actual = candidate[name]
            if not name.endswith(('.xml', '.rels')):
                self.assertEqual(data, actual, name)
                continue
            before = E.fromstring(comparable_part(name, data))
            after = E.fromstring(comparable_part(name, actual))
            self.assertEqual(xml_values(before), xml_values(after), name)
            self.assertEqual(after.getroottree().docinfo.encoding.upper().replace('-', ''), 'UTF8', name)
            missing = missing_compatibility_aliases(before)
            self.assertEqual(missing_compatibility_aliases(after), set(), name)
            if name in OPC_PARTS:
                self.assertEqual(after.nsmap.get(None), E.QName(after).namespace, name)
                continue
            allowed = {}
            for prefix in missing:
                self.assertIn(name, source_trees, name)
                local = {node.nsmap[prefix] for node in source_trees[name].iter() if prefix in node.nsmap}
                values = local or {node.nsmap[prefix] for tree in source_trees.values()
                                   for node in tree.iter() if prefix in node.nsmap}
                self.assertEqual(len(values), 1, f'No unique pinned namespace provenance: {name}:{prefix}')
                allowed[prefix] = next(iter(values))
                self.assertEqual(after.nsmap.get(prefix), allowed[prefix], name)
            for old_node, new_node in zip(before.iter(), after.iter()):
                expected_nsmap = {**allowed, **old_node.nsmap}
                self.assertEqual(new_node.nsmap, expected_nsmap, name)
        self.assertEqual(geometry(control['word/document.xml']), geometry(candidate['word/document.xml']))

    def assert_data_only_changes(self, control, candidate, snapshot):
        self.assertEqual(set(control), set(candidate))
        for name, data in control.items():
            updated = candidate[name]
            if snapshot['templateId'] == 'ps-witness' and name == 'word/document.xml':
                # The raw source omitted its Kazakh decision month placeholder.
                # Permit exactly one unformatted r/t in that one existing p.
                before, after = E.fromstring(data), E.fromstring(updated)
                path = './/w:p[@w14:paraId="3CDF95A7"]'
                namespaces = {**NS, 'w14': 'http://schemas.microsoft.com/office/word/2010/wordml'}
                previous = before.findall(path, namespaces)
                current = after.findall(path, namespaces)
                self.assertEqual(len(previous), 1)
                self.assertEqual(len(current), 1)
                self.assertEqual(previous[0].findall(W + 'r'), [])
                cell = current[0].getparent()
                row = cell.getparent()
                cells = row.findall(W + 'tc')
                self.assertEqual(len(cells), 7)
                self.assertIs(cells[6], cell)
                self.assertIn('Біліктілік комиссиясының', ''.join(cells[0].itertext()))
                runs = current[0].findall(W + 'r')
                self.assertEqual(len(runs), 1)
                run = runs[0]
                self.assertEqual(dict(run.attrib), {})
                self.assertEqual([node.tag for node in run], [W + 't'])
                self.assertEqual(dict(run[0].attrib), {})
                months = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым',
                          'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан']
                month = int(snapshot['items'][0]['assignment']['protocolDate'].split('-')[1])
                self.assertEqual(run[0].text, months[month - 1])
                current[0].remove(run)
                updated = E.tostring(after)
            if name.startswith('word/') and name.endswith('.xml'):
                self.assertEqual(data_only_structure(data), data_only_structure(updated),
                                 f'Data adaptation changed source formatting or structure: {name}')
            else:
                self.assertEqual(comparable_part(name, data), comparable_part(name, updated), name)

    def test_01_helpers_and_all_raw_templates_are_the_verified_90d5_bytes(self):
        source = registry()
        self.assertEqual(source['sourceCommit'], SOURCE_COMMIT)
        self.assertEqual({item['path']: item['sha256'] for item in source['helpers']}, HELPERS)
        for filename, expected in HELPERS.items():
            actual = (SCRIPTS / filename).read_bytes()
            self.assertEqual(hashlib.sha256(actual).hexdigest(), expected, filename)
        self.assertEqual({item['id']: item['sha256'] for item in source['templates']}, SOURCE_HASHES)
        for item in source['templates']:
            path = ROOT / 'assets/templates' / item['file']
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), SOURCE_HASHES[item['id']])
            self.assertTrue(identify_reference(path, item['id']))

    def prepare_case(self, tid, store):
        entry = next(item for item in registry()['templates'] if item['id'] == tid)
        template = ROOT / 'assets/templates' / entry['file']
        (store / entry['file']).write_bytes(template.read_bytes())
        snapshot = fixture(tid)
        snapshot.update(mode='issued-document', demoMode=False, templateVersion=entry['version'],
                        templateStorageKey=entry['file'], templateChecksum=entry['sha256'])
        return template, snapshot, legacy_payload(snapshot, snapshot['items'][0])

    def test_02_all_individual_cores_match_direct_legacy_fill(self):
        self.test_01_helpers_and_all_raw_templates_are_the_verified_90d5_bytes()
        OUT.mkdir(parents=True, exist_ok=True)
        evidence = []
        with tempfile.TemporaryDirectory(prefix='demo-legacy-control-') as temp:
            store = Path(temp)
            with patch.dict(os.environ, {'DEMO_ARTIFACT_ROOT': str(store)}):
                for tid in SOURCE_HASHES:
                    with self.subTest(template=tid):
                        template, snapshot, payload = self.prepare_case(tid, store)
                        control = direct_control(template, snapshot, payload, OUT / f'{tid}-control.docx')
                        adapter = render_reference_files(snapshot, snapshot['items'][0], template)
                        self.assert_package_equal(control, adapter)
                        evidence.append({'templateId': tid, 'sourceSha256': SOURCE_HASHES[tid],
                                         'documentXmlSha256': hashlib.sha256(control['word/document.xml']).hexdigest(),
                                         'mediaSha256': {name: hashlib.sha256(data).hexdigest()
                                                         for name, data in control.items() if name.startswith('word/media/')}})
        self.assertEqual(len(evidence), len(SOURCE_HASHES))
        (OUT / 'package-equivalence.json').write_text(
            json.dumps({'status': 'PASS', 'sourceCommit': SOURCE_COMMIT, 'forms': evidence},
                       ensure_ascii=False, indent=2) + '\n', encoding='utf8')

    def test_03_all_individual_production_outputs_only_apply_declared_data_changes(self):
        self.test_01_helpers_and_all_raw_templates_are_the_verified_90d5_bytes()
        OUT.mkdir(parents=True, exist_ok=True)
        evidence = []
        with tempfile.TemporaryDirectory(prefix='demo-legacy-production-') as temp:
            store = Path(temp)
            with patch.dict(os.environ, {'DEMO_ARTIFACT_ROOT': str(store)}):
                for tid in SOURCE_HASHES:
                    with self.subTest(template=tid):
                        template, snapshot, payload = self.prepare_case(tid, store)
                        core = direct_control(template, snapshot, payload, OUT / f'{tid}-production-core.docx')
                        expected = production_control(template, snapshot, payload,
                                                      OUT / f'{tid}-data-control.docx')
                        self.assert_data_only_changes(core, expected, snapshot)
                        output = OUT / f'{tid}-adapter.docx'
                        render_docx(snapshot, output)
                        actual = package_parts(output)
                        self.assert_production_package_equal(expected, actual, template)
                        if tid == 'biot-itr-certificate':
                            document = E.fromstring(actual['word/document.xml'])
                            self.assertIn('22 сентября 2026 г.', ''.join(document.itertext()))
                            self.assertFalse(any(re.match(r'^\s*DATE(?:\s|$)', node.text or '', re.I)
                                                 for node in document.iter(W + 'instrText')),
                                             'The source DATE field can refresh away from the frozen issue date')
                        exceptions = {'biot-itr-certificate': ['Remove active DATE instructions and markers'],
                                      'ps-witness': ['Add one unformatted r/t to the originally empty decision month slot']}
                        evidence.append({'templateId': tid, 'preservedOriginalRunsParagraphsStylesGeometryMedia': True,
                                         'packageRepairs': 'Expanded XML values exact; only OPC namespace serialization, UTF-8 declaration and pinned compatibility aliases',
                                         'declaredStructureExceptions': exceptions.get(tid, []),
                                         'documentXmlSha256': hashlib.sha256(actual['word/document.xml']).hexdigest()})
        self.assertEqual(len(evidence), len(SOURCE_HASHES))
        (OUT / 'production-data-equivalence.json').write_text(
            json.dumps({'status': 'PASS', 'sourceCommit': SOURCE_COMMIT, 'forms': evidence}, indent=2) + '\n',
            encoding='utf8')

    def test_04_worker_and_itr_physical_pdf_geometry_matches_legacy_control(self):
        self.test_01_helpers_and_all_raw_templates_are_the_verified_90d5_bytes()
        OUT.mkdir(parents=True, exist_ok=True)
        evidence = []
        with tempfile.TemporaryDirectory(prefix='demo-legacy-pdf-') as temp:
            store = Path(temp)
            with patch.dict(os.environ, {'DEMO_ARTIFACT_ROOT': str(store)}):
                for tid in ['biot-worker-card', 'biot-itr-certificate']:
                    with self.subTest(template=tid):
                        template, snapshot, payload = self.prepare_case(tid, store)
                        control = OUT / f'{tid}-physical-control.docx'
                        adapter = OUT / f'{tid}-physical-adapter.docx'
                        raw = direct_control(template, snapshot, payload,
                                             OUT / f'{tid}-physical-core.docx')
                        expected = production_control(template, snapshot, payload, control)
                        self.assert_data_only_changes(raw, expected, snapshot)
                        render_docx(snapshot, adapter)
                        self.assert_production_package_equal(expected, package_parts(adapter), template)
                        # Repair the control container only after the independent
                        # comparator above has proved that no XML value changed.
                        deterministic_zip(control, reference_package_declarations(
                            reference_opc_package(expected), template))
                        for path in [control, adapter]:
                            convert_pdf(path, path.with_suffix('.pdf'))
                        with pdfplumber.open(control.with_suffix('.pdf')) as before, pdfplumber.open(adapter.with_suffix('.pdf')) as after:
                            self.assertEqual(len(before.pages), len(after.pages))
                            for first, second in zip(before.pages, after.pages):
                                self.assertEqual(physical_geometry(first), physical_geometry(second))
                            evidence.append({'templateId': tid, 'pages': len(before.pages),
                                             'sameGeometryAtPointPrecision': 0.0001})
        self.assertEqual(len(evidence), 2)
        (OUT / 'physical-equivalence.json').write_text(
            json.dumps({'status': 'PASS', 'sourceCommit': SOURCE_COMMIT, 'forms': evidence}, indent=2) + '\n',
            encoding='utf8')


if __name__ == '__main__':
    unittest.main()
