"""Archive releases stage new versions without mutating bundled history."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from archive_forms import MARKER, POLICY, W
from release_archive_templates import stage
from sanitize_templates import deterministic_zip


RELEASED_IDS = (
    'biot-worker-card', 'biot-protocol', 'biot-itr-protocol', 'ptm-card',
    'ptm-protocol', 'pb-card', 'pb-protocol', 'ps-card', 'ps-protocol',
)
RETAINED_IDS = ('biot-itr-certificate', 'ps-witness')
GROUP_IDS = ('biot-protocol', 'biot-itr-protocol', 'ptm-protocol', 'pb-protocol', 'ps-protocol')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_bytes(directory):
    return {path.relative_to(directory).as_posix(): path.read_bytes()
            for path in directory.rglob('*') if path.is_file()}


def identity(record):
    return record['id'], str(record['version']), record.get('ownerKind', 'INDIVIDUAL')


class ArchiveTemplateReleaseTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.bundled = self.directory / 'synthetic-assets'
        self.candidates = self.directory / 'synthetic-candidates'
        self.output = self.directory / 'staged'
        self.bundled.mkdir()
        self.candidates.mkdir()
        self.manifest_path = self.bundled / 'manifest.json'

        records = [self.old_record(tid, index + 7)
                   for index, tid in enumerate((*RELEASED_IDS, *RETAINED_IDS))]
        by_id = {record['id']: record for record in records}
        groups = [self.old_record(tid, by_id[tid]['version'], group_number=index + 3)
                  for index, tid in enumerate(GROUP_IDS)]
        history = [self.old_record('biot-protocol', 1),
                   self.old_record('biot-protocol', 2, group_number=1)]
        self.manifest = {
            'version': 1, 'rendererVersion': 'synthetic-existing-renderer',
            'templates': records, 'groupTemplates': groups,
            'archivedTemplates': history,
            'specialTemplates': [{'id': 'synthetic-unrelated', 'keep': ['unchanged']}],
        }
        self.save_manifest()
        for tid in RELEASED_IDS:
            if tid != 'biot-itr-protocol':
                self.write_candidate(tid)

    def old_record(self, tid, version, group_number=None):
        filename = (f'{tid}.group-v{group_number}.docx' if group_number is not None
                    else f'{tid}.v{version}.docx')
        content = f'Synthetic immutable package: {filename}\n'.encode()
        (self.bundled / filename).write_bytes(content)
        record = {
            'id': tid, 'version': f'{version}-group-2' if group_number is not None else version,
            'file': filename, 'sha256': sha(content), 'fields': ['OLD_FIELD'],
            'languages': ['ru', 'kk'], 'renderPolicy': 'SYNTHETIC_OLD_POLICY',
            'restoration': {'nested': {'keep': ['original', version]}},
            'sourceIdentityImagesReplaced': True,
            'sourceImagesRemoved': True,
        }
        if group_number is not None:
            record.update(ownerKind='GROUP', groupContractVersion=1,
                          protocolSemantics='GROUP', groupRenderer='synthetic-old-renderer')
        return record

    def save_manifest(self):
        self.manifest_path.write_text(json.dumps(self.manifest, indent=2) + '\n', encoding='utf8')

    def write_candidate(self, tid):
        document = E.Element(W + 'document', nsmap={'w': W[1:-1]})
        body = E.SubElement(document, W + 'body')
        paragraph = E.SubElement(body, W + 'p')
        E.SubElement(E.SubElement(paragraph, W + 'r'), W + 't').text = '{{FULL_NAME_RU}}'
        section = E.SubElement(body, W + 'sectPr')
        E.SubElement(section, W + 'pgSz', {W + 'w': '11906', W + 'h': '16838'})
        marker = {
            'policy': POLICY, 'templateId': tid, 'sourceSha256': sha(('synthetic-source:' + tid).encode()),
            'fields': ['FULL_NAME_RU'],
        }
        files = {
            'word/document.xml': E.tostring(document),
            '[Content_Types].xml': b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
            MARKER: json.dumps(marker, sort_keys=True).encode(),
        }
        deterministic_zip(self.candidates / (tid + '.docx'), files)

    def release(self):
        report = stage(self.candidates, self.output, self.manifest_path)
        return report, json.loads((self.output / 'manifest.json').read_text(encoding='utf8'))

    def test_archives_exact_old_records_and_leaves_retained_forms_and_all_source_bytes_unchanged(self):
        bundled_before, candidates_before = file_bytes(self.bundled), file_bytes(self.candidates)
        before = deepcopy(self.manifest)
        report, released = self.release()

        self.assertEqual(file_bytes(self.bundled), bundled_before)
        self.assertEqual(file_bytes(self.candidates), candidates_before)
        self.assertEqual(released['archivedTemplates'][:len(before['archivedTemplates'])],
                         before['archivedTemplates'])
        history = {identity(record): record for record in released['archivedTemplates']}
        old_released = [record for kind in ('templates', 'groupTemplates')
                        for record in before[kind] if record['id'] in RELEASED_IDS]
        self.assertEqual(len(released['archivedTemplates']), len(before['archivedTemplates']) + 14)
        for old in old_released:
            self.assertEqual(history[identity(old)], old)
        for tid in RETAINED_IDS:
            old = next(record for record in before['templates'] if record['id'] == tid)
            self.assertEqual(next(record for record in released['templates'] if record['id'] == tid), old)
            self.assertNotIn(identity(old), history)
            self.assertFalse((self.output / old['file']).exists())
        self.assertEqual(released['specialTemplates'], before['specialTemplates'])
        self.assertEqual(report['unchangedTemplates'], list(RETAINED_IDS))
        self.assertFalse(report['tenantRegistrationApplied'])

    def test_five_group_versions_are_separate_and_itr_alias_changes_only_marker_identity(self):
        _, released = self.release()
        individuals = {record['id']: record for record in released['templates']}
        groups = {record['id']: record for record in released['groupTemplates']}
        self.assertEqual(set(groups), set(GROUP_IDS))
        all_new = [record for kind in ('templates', 'groupTemplates')
                   for record in released[kind] if record['id'] in RELEASED_IDS]
        self.assertEqual(len({record['file'] for record in all_new}), 14)
        self.assertEqual(len({identity(record) for record in all_new}), 14)
        for index, tid in enumerate(GROUP_IDS):
            group = groups[tid]
            self.assertNotEqual(str(group['version']), str(individuals[tid]['version']))
            self.assertEqual(group['version'], f"{individuals[tid]['version']}-group-1")
            self.assertEqual(group['file'], f'{tid}.group-v{index + 4}.docx')
            self.assertEqual(group['groupRenderer'], 'archive_forms.py:render_archive_group')
            self.assertEqual(group['ownerKind'], 'GROUP')
            self.assertEqual(group['groupContractVersion'], 1)
        with ZipFile(self.candidates / 'biot-protocol.docx') as source:
            original = {name: source.read(name) for name in source.namelist()}
        self.assertEqual(json.loads(original[MARKER])['templateId'], 'biot-protocol')
        for record in (individuals['biot-itr-protocol'], groups['biot-itr-protocol']):
            with ZipFile(self.output / record['file']) as target:
                actual = {name: target.read(name) for name in target.namelist()}
            marker = json.loads(actual.pop(MARKER))
            expected_marker = {**json.loads(original[MARKER]), 'templateId': 'biot-itr-protocol'}
            self.assertEqual(marker, expected_marker)
            self.assertEqual(actual, {name: data for name, data in original.items() if name != MARKER})

    def test_every_staged_hash_geometry_and_previous_hash_matches_its_real_bytes(self):
        original_bytes = self.manifest_path.read_bytes()
        report, released = self.release()
        self.assertEqual(len(report['released']), 14)
        self.assertEqual(report['previousManifestSha256'], sha(original_bytes))
        self.assertEqual(report['manifestSha256'], sha((self.output / 'manifest.json').read_bytes()))
        for kind in ('templates', 'groupTemplates'):
            old_by_id = {record['id']: record for record in self.manifest[kind]}
            for record in released[kind]:
                if record['id'] not in RELEASED_IDS:
                    continue
                data = (self.output / record['file']).read_bytes()
                self.assertEqual(record['sha256'], sha(data))
                self.assertEqual(record['previousTemplateSha256'], old_by_id[record['id']]['sha256'])
                self.assertEqual(record['renderPolicy'], POLICY)
                self.assertEqual(record['sections'], [{W + 'w': '11906', W + 'h': '16838'}])
                self.assertNotIn('restoration', record)
                self.assertNotIn('sourceImagesRemoved', record)
                self.assertNotIn('sourceIdentityImagesReplaced', record)
                with ZipFile(self.output / record['file']) as package:
                    marker = json.loads(package.read(MARKER))
                self.assertEqual(marker['templateId'], record['id'])
                self.assertEqual(marker['sourceSha256'], record['sourceSha256'])
                self.assertEqual(marker['fields'], record['fields'])
        for entry in report['released']:
            self.assertEqual(entry['sha256'], sha((self.output / entry['file']).read_bytes()))

    def test_staging_in_bundled_assets_is_rejected_before_reading_candidates_or_any_mutation(self):
        before = file_bytes(self.directory)
        for output in (self.bundled, self.bundled / 'new-child', self.bundled / '..' / 'synthetic-assets'):
            with self.subTest(output=output):
                with patch('release_archive_templates.identify_archive') as identify, \
                        patch('release_archive_templates.deterministic_zip') as write_zip:
                    with self.assertRaisesRegex(ValueError, '^RELEASE_STAGE_INSIDE_BUNDLED_ASSETS$'):
                        stage(self.candidates, output, self.manifest_path)
                identify.assert_not_called()
                write_zip.assert_not_called()
                self.assertEqual(file_bytes(self.directory), before)
                self.assertFalse((self.bundled / 'new-child').exists())

    def test_missing_last_candidate_fails_without_mutating_manifest_history_or_staging_partial_release(self):
        (self.candidates / 'ps-protocol.docx').unlink()
        bundled_before, candidates_before = file_bytes(self.bundled), file_bytes(self.candidates)
        with self.assertRaises(FileNotFoundError):
            stage(self.candidates, self.output, self.manifest_path)
        self.assertEqual(file_bytes(self.bundled), bundled_before)
        self.assertEqual(file_bytes(self.candidates), candidates_before)
        self.assertEqual(file_bytes(self.output), {})

    def test_existing_identical_history_record_is_preserved_without_duplicate_version(self):
        already_archived = deepcopy(self.manifest['groupTemplates'][0])
        self.manifest['archivedTemplates'].append(already_archived)
        self.save_manifest()
        before = file_bytes(self.bundled)
        _, released = self.release()
        matches = [entry for entry in released['archivedTemplates']
                   if identity(entry) == identity(already_archived)]
        self.assertEqual(matches, [already_archived])
        self.assertEqual(file_bytes(self.bundled), before)


if __name__ == '__main__':
    unittest.main()
