"""Final reference packages keep their XML values while satisfying OPC rules."""
from copy import deepcopy
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from zipfile import ZipFile

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from legacy_reference import (reference_sources, render_reference_document,
                              render_reference_files, freeze_reference_dates,
                              combine_reference_files, reference_opc_package,
                              reference_package_declarations)
from print_contracts import assert_package_contract
from sanitize_templates import deterministic_zip
from test_legacy_reference_photo import semantic_xml
from test_render import fixture


class LegacyReferencePackageTests(unittest.TestCase):
    def test_all_eleven_final_sample_forms_satisfy_package_contract(self):
        with tempfile.TemporaryDirectory(prefix='demo-reference-package-') as directory:
            for record in reference_sources()['templates']:
                with self.subTest(template=record['id']):
                    source = ROOT / 'assets/templates' / record['file']
                    before = hashlib.sha256(source.read_bytes()).hexdigest()
                    snapshot = fixture(record['id'])
                    snapshot.update(demoMode=True, englishAppendix=False)
                    output = Path(directory) / (record['id'] + '.docx')
                    render_reference_document(snapshot, output, source)
                    assert_package_contract(output)
                    self.assertEqual(before, hashlib.sha256(source.read_bytes()).hexdigest())

    def test_two_person_batch_repairs_only_xml_serialization_and_declarations(self):
        snapshot = fixture('biot-worker-card')
        second = deepcopy(snapshot['items'][0])
        second.update(id='second-person', fullNameRu='Второй Получатель', number='ВТ-002')
        snapshot['items'].append(second)
        record = next(entry for entry in reference_sources()['templates'] if entry['id'] == snapshot['templateId'])
        source = ROOT / 'assets/templates' / record['file']
        before = combine_reference_files([
            freeze_reference_dates(render_reference_files(snapshot, item, source, source_values=True), snapshot, item)
            for item in snapshot['items']])
        self.assertIsNotNone(E.fromstring(before['word/_rels/document.xml.rels']).prefix)
        after = reference_package_declarations(reference_opc_package(before), source)
        self.assertEqual(set(before), set(after))
        for name, data in before.items():
            if name.endswith(('.xml', '.rels')):
                self.assertEqual(semantic_xml(E.fromstring(data)), semantic_xml(E.fromstring(after[name])), name)
            else:
                self.assertEqual(data, after[name], name)
        with tempfile.TemporaryDirectory(prefix='demo-batch-package-') as directory:
            output = Path(directory) / 'batch.docx'
            deterministic_zip(output, after)
            assert_package_contract(output)


if __name__ == '__main__':
    unittest.main()
