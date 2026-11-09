"""Archive policy is isolated, preserves source layout and fills frozen factual values."""
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from zipfile import ZipFile
import hashlib
import json
import os
import re
import sys
import unittest

from lxml import etree as E
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
from archive_forms import (POLICY, MARKER, LAYOUT_POLICY, W, R, PKG, CT, archive_fields,
    identify_archive, render_archive_one, render_archive_group, render_archive_document,
    combine_archive_parts)
from sanitize_templates import deterministic_zip


def paragraph(text):
    node = E.Element(W + 'p')
    E.SubElement(E.SubElement(node, W + 'r'), W + 't').text = text
    return node


def visible(data):
    return ' '.join(node.text or '' for node in E.fromstring(data).iter(W + 't'))


def snapshot(tid='pb-card', count=1):
    return {'templateId': tid, 'templateVersion': 'archive-test', 'mode': 'issued-document',
        'issuer': {'nameRu': 'Учебный центр', 'nameKz': 'Оқу орталығы', 'headName': 'Директор Отдельный',
            'commission': [{'name': 'Председатель Иванов', 'position': 'Начальник УМО'},
                           {'name': 'Член Петров', 'position': 'Директор'},
                           {'name': 'Член Сидоров', 'position': 'Преподаватель'}]},
        'items': [{'id': f'p{i}', 'fullNameRu': f'Получатель {i}', 'fullNameKz': f'Тыңдаушы {i}',
            'positionRu': 'Инженер', 'positionKz': 'Маман', 'workplaceRu': f'Работодатель {i}',
            'workplaceKz': f'Жұмыс орны {i}', 'number': f'УД-{i}', 'protocolNumber': 'ПР-7',
            'assignment': {'id': f'a{i}', 'eventId': 'event', 'documentDate': '2026-11-09',
                'protocolDate': '2026-11-08', 'trainingSubject': 'Безопасность', 'trainingSubjectKz': 'Қауіпсіздік',
                'outcome': {'status': 'FAILED'}, 'result': 'Не сдал', 'resultKz': 'Тапсырмады', 'reason': 'Повторная / Қайта'}} for i in range(1, count + 1)],
        'photos': {}}


class ArchiveFormsTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def package(self, tid='pb-card', roster=False, rosters=False, media=False, box=False, layout=False):
        root = E.Element(W + 'document', nsmap={'w': W[1:-1], 'r': R[1:-1], 'v': 'urn:schemas-microsoft-com:vml'})
        body = E.SubElement(root, W + 'body')
        if roster or rosters:
            body.append(paragraph('HEADER {{WORKPLACE_BOTH}} {{CHAIR_NAME}} {{CHAIR_POSITION}} {{HEAD}} {{MEMBER_1_NAME}} {{MEMBERS_FROM_SECOND}}'))
            for language in (['RU', 'KZ'] if rosters else ['RU']):
                table = E.SubElement(body, W + 'tbl')
                for rowtext in ['№ | Name', '{{ROW_NUMBER}} {{FULL_NAME_' + language + '}} {{WORKPLACE_' + language + '}} {{RESULT_' + language + '}}', 'STATIC END']:
                    cell = E.SubElement(E.SubElement(table, W + 'tr'), W + 'tc')
                    cell.append(paragraph(rowtext))
        elif box:
            shape = E.SubElement(E.SubElement(E.SubElement(body, W + 'p'), W + 'r'), '{urn:schemas-microsoft-com:vml}shape', style='position:absolute;width:300pt;height:200pt')
            boxnode = E.SubElement(E.SubElement(shape, '{urn:schemas-microsoft-com:vml}textbox'), W + 'txbxContent')
            p = paragraph('   {{FULL_NAME_RU}} {{CHAIR_NAME}}')
            props = E.Element(W + 'pPr'); p.insert(0, props)
            E.SubElement(props, W + 'ind', {W + 'left': '-300', W + 'firstLine': '-600', W + 'hanging': '500'})
            boxnode.append(p)
        else:
            p = paragraph('Name {{FULL_')
            E.SubElement(E.SubElement(p, W + 'r'), W + 't').text = 'NAME_RU}} / {{FULL_NAME_KZ}}'
            body.append(p)
            body.append(paragraph('{{SUBJECT_RU}} | {{SUBJECT_KZ}} | {{RESULT_RU}} | {{RESULT_KZ}} | {{REASON_BOTH}}'))
            body.append(paragraph('{{CHAIR_NAME}} {{CHAIR_POSITION}} | {{MEMBER_1_NAME}} {{MEMBER_1_POSITION}} | {{HEAD_NAME}}'))
        start = E.Element(W + 'bookmarkStart', {W + 'id': '7', W + 'name': 'Recipient'})
        body[0].insert(0, start); body[0].append(E.Element(W + 'bookmarkEnd', {W + 'id': '7'}))
        if media:
            picture = E.SubElement(E.SubElement(body, W + 'p'), W + 'r')
            shape = E.SubElement(E.SubElement(picture, W + 'pict'), '{urn:schemas-microsoft-com:vml}shape', id='PhotoShape', style='width:60pt;height:80pt')
            E.SubElement(shape, '{urn:schemas-microsoft-com:vml}imagedata', {R + 'id': 'rIdPhoto'})
        section = E.SubElement(body, W + 'sectPr')
        E.SubElement(section, W + 'headerReference', {W + 'type': 'default', R + 'id': 'rIdHeader'})
        E.SubElement(section, W + 'footerReference', {W + 'type': 'default', R + 'id': 'rIdFooter'})
        E.SubElement(section, W + 'pgSz', {W + 'w': '11906', W + 'h': '16838'})
        E.SubElement(section, W + 'pgMar', {W + 'top': '1000', W + 'bottom': '1000', W + 'left': '1000', W + 'right': '1000', W + 'footer': '0'})
        header = E.Element(W + 'hdr', nsmap={'w': W[1:-1]}); header.append(paragraph('HEADER PERSON {{FULL_NAME_RU}}'))
        footer = E.Element(W + 'ftr', nsmap={'w': W[1:-1]}); footer.append(paragraph('ORIGINAL FOOTER'))
        rels = E.Element(PKG + 'Relationships', nsmap={None: PKG[1:-1]})
        for key, kind, target in [('rIdHeader', 'header', 'header1.xml'), ('rIdFooter', 'footer', 'footer1.xml'), ('rIdStyles', 'styles', 'styles.xml')]:
            E.SubElement(rels, PKG + 'Relationship', Id=key, Type=R[1:-1] + '/' + kind, Target=target)
        types = E.Element(CT + 'Types', nsmap={None: CT[1:-1]})
        for name, kind in [('document', 'document.main'), ('header1', 'header'), ('footer1', 'footer'), ('styles', 'styles')]:
            E.SubElement(types, CT + 'Override', PartName='/word/' + name + '.xml', ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.' + kind + '+xml')
        files = {'word/document.xml': E.tostring(root), 'word/header1.xml': E.tostring(header), 'word/footer1.xml': E.tostring(footer),
            'word/_rels/document.xml.rels': E.tostring(rels), '[Content_Types].xml': E.tostring(types),
            'word/styles.xml': f'<w:styles xmlns:w="{W[1:-1]}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:sz w:val="22"/></w:rPr></w:style></w:styles>'.encode(),
            'docProps/custom.xml': b'<custom>unchanged metadata</custom>'}
        marker = {'policy': POLICY, 'templateId': tid, 'sourceSha256': 'a' * 64,
                  'fields': sorted(set(re.findall(r'\{\{([A-Z][A-Z0-9_]*)\}\}', ''.join(''.join(E.fromstring(files[name]).itertext()) for name in ['word/document.xml', 'word/header1.xml']))))}
        if roster: marker['roster'] = {'headerRows': 1, 'tableIndex': 0}
        if rosters: marker['rosters'] = [{'headerRows': 1, 'tableIndex': 0}, {'headerRows': 1, 'tableIndex': 1}]
        if layout: marker['fieldLayoutPolicy'] = LAYOUT_POLICY
        if media:
            image = BytesIO(); Image.new('RGB', (60, 80), 'red').save(image, 'PNG')
            files['word/media/photo.png'] = image.getvalue()
            marker['dynamicMedia'] = [{'part': 'word/media/photo.png', 'kind': 'PHOTO'}]
            E.SubElement(rels, PKG + 'Relationship', Id='rIdPhoto', Type=R[1:-1] + '/image', Target='media/photo.png')
            E.SubElement(types, CT + 'Default', Extension='png', ContentType='image/png')
            files['word/_rels/document.xml.rels'] = E.tostring(rels); files['[Content_Types].xml'] = E.tostring(types)
        files[MARKER] = json.dumps(marker).encode()
        path = self.directory / (str(len(list(self.directory.iterdir()))) + '.docx')
        deterministic_zip(path, files)
        return path, files

    def test_individual_preserves_package_geometry_and_factual_bilingual_values(self):
        path, original = self.package()
        data = snapshot(); before = deepcopy(data)
        result = render_archive_one(data, data['items'][0], path)
        text = visible(result['word/document.xml'])
        for expected in ['Получатель 1', 'Тыңдаушы 1', 'Безопасность', 'Қауіпсіздік', 'Не сдал', 'Тапсырмады', 'Начальник УМО', 'Директор Отдельный']:
            self.assertIn(expected, text)
        self.assertEqual(data, before)
        for name in original:
            if name not in ['word/document.xml', 'word/header1.xml']:
                self.assertEqual(result[name], original[name], name)
        self.assertEqual(E.tostring(E.fromstring(original['word/document.xml']).find('.//' + W + 'sectPr')),
                         E.tostring(E.fromstring(result['word/document.xml']).find('.//' + W + 'sectPr')))
        empty = snapshot(); empty['items'][0]['assignment'].update(result='', resultKz='', outcome={'status': 'PASSED'})
        self.assertEqual(archive_fields(empty, empty['items'][0])['RESULT_BOTH'], '')

    def test_values_are_literal_not_second_pass_tokens_or_xml(self):
        path, _ = self.package()
        data = snapshot(); data['items'][0]['fullNameRu'] = 'Имя <&> {{CHAIR_NAME}}'
        result = render_archive_one(data, data['items'][0], path)
        self.assertIn('Имя <&> {{CHAIR_NAME}}', visible(result['word/document.xml']))

    def test_nonpassed_status_overrides_stale_positive_text_and_keeps_actual_score(self):
        data = snapshot(); item = data['items'][0]
        for status, expected in [('FAILED', 'Не сдал'), ('ABSENT', 'Не явился'), ('UNKNOWN', 'Не подтверждено')]:
            item['assignment'].update(outcome={'status': status}, result='Сдал', resultKz='Тапсырды')
            before = deepcopy(item)
            fields = archive_fields(data, item)
            self.assertEqual(fields['RESULT_RU'], expected)
            self.assertNotIn('Тапсырды', fields['RESULT'])
            self.assertEqual(item, before)
        item['assignment'].update(outcome={'status': 'FAILED'}, result='30/100', resultKz='')
        fields = archive_fields(data, item)
        self.assertEqual(fields['RESULT_RU'], 'Не сдал; 30/100')
        self.assertEqual(fields['RESULT_KZ'], 'Тапсырмады; 30/100')

    def test_numeric_score_is_not_split_as_a_bilingual_label(self):
        data = snapshot('ps-card'); item = data['items'][0]
        item['assignment'].update(outcome={'status': 'PASSED'}, result='85/100', resultKz='')
        fields = archive_fields(data, item)
        for key in ['RESULT', 'RESULT_RU', 'RESULT_KZ', 'RESULT_BOTH']:
            self.assertEqual(fields[key], '85/100')
        item['assignment'].update(resultRu='Отлично', resultKz='Өте жақсы')
        fields = archive_fields(data, item)
        self.assertEqual(fields['RESULT_RU'], 'Отлично'); self.assertEqual(fields['RESULT_KZ'], 'Өте жақсы')

    def test_exam_and_qualification_phrases_require_explicit_passed_outcome(self):
        data = snapshot('ps-card'); item = data['items'][0]
        for status in [None, 'UNKNOWN', 'FAILED', 'ABSENT']:
            if status is None: item['assignment'].pop('outcome', None)
            else: item['assignment']['outcome'] = {'status': status}
            item['assignment'].update(result='Сдал', resultKz='Тапсырды')
            fields = archive_fields(data, item)
            self.assertTrue(fields['EXAM_STATEMENT_RU'].startswith('Результат экзамена'))
            self.assertNotIn('Сдал', fields['EXAM_STATEMENT_RU'])
            self.assertNotIn('Тапсырды', fields['EXAM_STATEMENT_KZ'])
            self.assertEqual(fields['QUALIFICATION_STATUS_RU'], 'Присвоение квалификации не подтверждено')
            self.assertEqual(fields['QUALIFICATION_STATUS_KZ'], 'Біліктілік берілгені расталмаған')
        item['assignment']['outcome'] = {'status': 'PASSED'}
        fields = archive_fields(data, item)
        self.assertEqual(fields['EXAM_STATEMENT_RU'], 'Сдал(а) экзамен по программе: Безопасность')
        self.assertEqual(fields['EXAM_STATEMENT_KZ'], 'Қауіпсіздік бағдарламасы бойынша емтихан тапсырды')
        self.assertEqual(fields['QUALIFICATION_STATUS_RU'], 'в том, что ему присвоена квалификация')
        data['templateId'] = 'biot-worker-card'
        fields = archive_fields(data, item)
        self.assertEqual(fields['EXAM_STATEMENT_RU'], 'В том, что он сдал экзамены на знание Безопасность / Қауіпсіздік')
        self.assertEqual(fields['EXAM_STATEMENT_KZ'], 'Бойынша емтихан тапсырғаны туралы берілді.')
        data['templateId'] = 'ptm-card'
        fields = archive_fields(data, item)
        self.assertEqual(fields['EXAM_STATEMENT_RU'], 'В том, что он (она) сдал (сдала) экзамены на знание Безопасность')
        self.assertEqual(fields['EXAM_STATEMENT_KZ'], 'Ол Қауіпсіздік біліміне емтихан тапсырды')

    def test_marker_unknown_fields_identity_and_external_content_fail_closed(self):
        path, files = self.package()
        self.assertTrue(identify_archive(path, 'pb-card'))
        with self.assertRaisesRegex(ValueError, 'IDENTITY_MISMATCH'): identify_archive(path, 'ptm-card')
        for change, error in [({'fields': ['NOT_A_FIELD']}, 'FIELD_UNKNOWN'), ({'policy': 'unknown'}, 'IDENTITY_MISMATCH'), ({'sourceSha256': '../bad'}, 'SOURCE_HASH_INVALID')]:
            updated = dict(files); updated[MARKER] = json.dumps(json.loads(files[MARKER]) | change).encode()
            deterministic_zip(path, updated)
            with self.assertRaisesRegex(ValueError, error): render_archive_one(snapshot(), snapshot()['items'][0], path)
        unsafe = dict(files); unsafe['word/_rels/evil.xml.rels'] = f'<Relationships xmlns="{PKG[1:-1]}"><Relationship Id="x" TargetMode="External" Target="file:///secret"/></Relationships>'.encode()
        deterministic_zip(path, unsafe)
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_EXTERNAL_REFERENCE'): render_archive_one(snapshot(), snapshot()['items'][0], path)
        del files[MARKER]; deterministic_zip(path, files)
        self.assertFalse(identify_archive(path, 'pb-card'))

    def test_two_language_group_rosters_fill_each_person_and_preserve_common_header(self):
        path, _ = self.package('ps-protocol', rosters=True)
        data = snapshot('ps-protocol', 2); data['groupEvent'] = {'contractVersion': 1}
        data['groupHeaderWorkplace'] = {'version': 1, 'workplaceRu': 'Общий заказчик', 'workplaceKz': 'Ортақ ұйым'}
        result = render_archive_group(data, path)
        tree = E.fromstring(result['word/document.xml']); tables = list(tree.iter(W + 'tbl'))
        self.assertEqual(len(tables), 2)
        self.assertIn('Общий заказчик / Ортақ ұйым', visible(result['word/document.xml']))
        for table, language in zip(tables, ['RU', 'KZ']):
            rows = table.findall(W + 'tr'); self.assertEqual(len(rows), 4)
            self.assertIn('STATIC END', ''.join(rows[-1].itertext()))
            for index, row in enumerate(rows[1:3], 1):
                text = ''.join(row.itertext()); self.assertTrue(text.startswith(str(index)))
                self.assertIn(('Получатель ' if language == 'RU' else 'Тыңдаушы ') + str(index), text)
                self.assertNotIn('Общий заказчик', text)

    def test_group_requires_declared_roster_and_unique_members(self):
        path, _ = self.package('pb-protocol')
        data = snapshot('pb-protocol'); data['groupEvent'] = {'contractVersion': 1}
        with self.assertRaisesRegex(ValueError, 'ROSTER_REQUIRED'): render_archive_group(data, path)
        path, _ = self.package('pb-protocol', roster=True)
        data['items'].append(deepcopy(data['items'][0]))
        with self.assertRaisesRegex(ValueError, 'GROUP_DUPLICATE_MEMBER'): render_archive_group(data, path)

    def test_all_extra_commission_members_print_in_description_without_new_signature_slots(self):
        path, _ = self.package('pb-protocol', roster=True)
        data = snapshot('pb-protocol'); data['groupEvent'] = {'contractVersion': 1}
        data['issuer']['commission'].append({'name': 'Четвертый Участник', 'position': 'Инженер центра'})
        result = render_archive_group(data, path)
        header = E.fromstring(result['word/document.xml']).find(W + 'body/' + W + 'p')
        text = ''.join(header.itertext())
        for person in data['issuer']['commission']:
            self.assertIn(person['name'], text)
        self.assertIn('Четвертый Участник — Инженер центра, Учебный центр', text)
        fields = archive_fields(data, data['items'][0])
        self.assertEqual(fields['MEMBER_2_NAME'], 'Член Сидоров')
        self.assertNotIn('MEMBER_3_NAME', fields)

    def test_photo_replaces_existing_part_and_rejects_unbound_or_corrupt_asset(self):
        path, original = self.package(media=True)
        data = snapshot()
        blank = render_archive_one(data, data['items'][0], path)
        self.assertEqual(Image.open(BytesIO(blank['word/media/photo.png'])).getbbox(), None)
        photo = BytesIO(); Image.new('RGB', (120, 160), 'blue').save(photo, 'PNG'); blob = photo.getvalue()
        key = hashlib.sha256(blob).hexdigest() + '-00000000-0000-4000-8000-000000000001.png'
        (self.directory / key).write_bytes(blob)
        data['items'][0]['photoAssetId'] = 'photo'; data['photos']['photo'] = key
        with patch.dict(os.environ, {'DEMO_ARTIFACT_ROOT': str(self.directory)}):
            filled = render_archive_one(data, data['items'][0], path)
            self.assertEqual(Image.open(BytesIO(filled['word/media/photo.png'])).size, (60, 80))
            self.assertEqual(Image.open(BytesIO(filled['word/media/photo.png'])).getpixel((30, 40)), (0, 0, 255, 255))
            self.assertEqual(filled['word/_rels/document.xml.rels'], original['word/_rels/document.xml.rels'])
            (self.directory / key).write_bytes(b'corrupt')
            with self.assertRaisesRegex(ValueError, 'PHOTO_HASH_MISMATCH'): render_archive_one(data, data['items'][0], path)
            data['photos']['photo'] = '../outside.png'
            with self.assertRaisesRegex(ValueError, 'PHOTO_PATH'): render_archive_one(data, data['items'][0], path)

    def test_batch_preserves_per_person_headers_sections_and_distinct_styles(self):
        path, _ = self.package()
        data = snapshot(count=2)
        first = render_archive_one(data, data['items'][0], path)
        second = render_archive_one(data, data['items'][1], path)
        second['word/styles.xml'] = second['word/styles.xml'].replace(b'val="22"', b'val="36"')
        result = combine_archive_parts([first, second])
        self.assertIn('Получатель 1', visible(result['word/header1.xml']))
        self.assertIn('Получатель 2', visible(result['word/archive-1/header1.xml']))
        self.assertNotIn('Получатель 1', visible(result['word/archive-1/header1.xml']))
        tree = E.fromstring(result['word/document.xml'])
        self.assertEqual(len(list(tree.iter(W + 'sectPr'))), 2)
        ids = [node.get(W + 'id') for node in tree.iter(W + 'bookmarkStart')]
        self.assertEqual(len(ids), len(set(ids)))
        styles = E.fromstring(result['word/styles.xml'])
        self.assertEqual(styles.find("./" + W + "style[@" + W + "styleId='Normal']/" + W + "rPr/" + W + "sz").get(W + 'val'), '22')
        self.assertEqual(styles.find("./" + W + "style[@" + W + "styleId='Archive1_Normal']/" + W + "rPr/" + W + "sz").get(W + 'val'), '36')

    def test_preview_and_demo_marks_preserve_original_header_footer(self):
        path, _ = self.package()
        for mode in ['draft-preview', 'demo']:
            data = snapshot(); data['mode'] = mode; data['demoMode'] = mode == 'demo'
            output = self.directory / (mode + '.docx'); render_archive_document(data, output, path)
            with ZipFile(output) as archive:
                self.assertIn('HEADER PERSON Получатель 1', visible(archive.read('word/header1.xml')))
                footer = visible(archive.read('word/footer1.xml'))
                self.assertIn('ORIGINAL FOOTER', footer)
                self.assertIn('НЕ ЯВЛЯЕТСЯ ВЫДАННЫМ ДОКУМЕНТОМ', footer)

    def test_layout_default_keeps_source_and_opt_in_bounds_negative_indents(self):
        data = snapshot('ps-card')
        path, _ = self.package('ps-card', box=True)
        regular = render_archive_one(data, data['items'][0], path)
        self.assertEqual(E.fromstring(regular['word/document.xml']).find('.//' + W + 'ind').get(W + 'firstLine'), '-600')
        path, _ = self.package('ps-card', box=True, layout=True)
        bounded = render_archive_one(data, data['items'][0], path)
        indent = E.fromstring(bounded['word/document.xml']).find('.//' + W + 'ind')
        self.assertEqual(indent.get(W + 'left'), '0'); self.assertEqual(indent.get(W + 'hanging'), '0')
        self.assertIn('Председатель Иванов', visible(bounded['word/document.xml']))
        self.assertIn(b'width:300pt;height:200pt', bounded['word/document.xml'])

    def test_renderer_entrypoints_use_archive_policy_and_bounded_preflight(self):
        import renderer
        path, _ = self.package()
        data = snapshot(); output = self.directory / 'rendered.docx'
        with patch.object(renderer, 'resolve_template', return_value=({'version': 'test'}, path)):
            metadata = renderer.render_docx(data, output)
            self.assertEqual(metadata['renderPolicy'], POLICY)
            bad = deepcopy(data); bad['items'][0]['fullNameRu'] = 'x' * 81
            result = renderer.preflight({'snapshots': [data, bad]}, self.directory / 'preflight.json')
            self.assertEqual(result['issues'], [{'index': 1, 'code': 'PRINT_LAYOUT_OVERFLOW'}])

    def test_bounded_card_fields_preserve_separators_and_reserve_source_photo_space(self):
        for tid, side, bound in [('pb-card', 'left', 2000), ('ptm-card', 'right', 1520)]:
            path, files = self.package(tid, box=True, layout=True)
            tree = E.fromstring(files['word/document.xml']); box = tree.find('.//' + W + 'txbxContent')
            line = paragraph('Должность')
            E.SubElement(E.SubElement(line, W + 'r'), W + 't').text = '     '
            E.SubElement(E.SubElement(line, W + 'r'), W + 't').text = '{{POSITION_RU}}'
            box.append(line)
            files['word/document.xml'] = E.tostring(tree)
            marker = json.loads(files[MARKER]); marker['fields'].append('POSITION_RU')
            files[MARKER] = json.dumps(marker).encode(); deterministic_zip(path, files)
            data = snapshot(tid); result = render_archive_one(data, data['items'][0], path)
            filled = E.fromstring(result['word/document.xml']).find('.//' + W + 'txbxContent')[-1]
            self.assertEqual(''.join(node.text or '' for node in filled.iter(W + 't')), 'Должность Инженер')
            self.assertEqual(filled.find(W + 'r/' + W + 't').get('{http://www.w3.org/XML/1998/namespace}space'), 'preserve')
            self.assertGreaterEqual(int(filled.find(W + 'pPr/' + W + 'ind').get(W + side)), bound)
            self.assertIn(b'width:300pt;height:200pt', result['word/document.xml'])

    def test_biot_empty_renewal_line_keeps_labels_and_bounds_blank_padding(self):
        path, files = self.package('biot-worker-card', box=True, layout=True)
        tree = E.fromstring(files['word/document.xml']); body = tree.find(W + 'body')
        shape = E.SubElement(E.SubElement(E.SubElement(body, W + 'p'), W + 'r'), '{urn:schemas-microsoft-com:vml}shape', style='margin-left:284pt;width:240pt;height:160pt')
        box = E.SubElement(E.SubElement(shape, '{urn:schemas-microsoft-com:vml}textbox'), W + 'txbxContent')
        line = paragraph('Основание: Протокол № ')
        run = E.SubElement(line, W + 'r'); E.SubElement(run, W + 't').text = ' ' * 100
        E.SubElement(run, W + 'tab')
        E.SubElement(E.SubElement(line, W + 'r'), W + 't').text = 'от 20 г.'
        box.append(line); files['word/document.xml'] = E.tostring(tree); deterministic_zip(path, files)
        data = snapshot('biot-worker-card'); result = render_archive_one(data, data['items'][0], path)
        filled = list(E.fromstring(result['word/document.xml']).iter(W + 'txbxContent'))[-1]
        self.assertEqual(' '.join(''.join(filled.itertext()).split()), 'Основание: Протокол № от 20 г.')
        self.assertEqual(len(list(filled.iter(W + 'tab'))), 0)
        self.assertLess(len(''.join(filled.itertext())), len(''.join(line.itertext())))
        self.assertIn(b'margin-left:284pt;width:240pt;height:160pt', result['word/document.xml'])

    def test_ps_bilingual_name_fallback_is_bounded_and_does_not_drop_text(self):
        path, files = self.package('ps-card', box=True, layout=True)
        tree = E.fromstring(files['word/document.xml']); box = tree.find('.//' + W + 'txbxContent')
        box.getparent().getparent().set('style', 'position:absolute;width:240pt;height:21pt')
        for node in list(box): box.remove(node)
        box.append(paragraph('')); box.append(paragraph('{{FULL_NAME_BOTH}}'))
        files['word/document.xml'] = E.tostring(tree)
        marker = json.loads(files[MARKER]); marker['fields'] = ['FULL_NAME_BOTH', 'FULL_NAME_RU']
        files[MARKER] = json.dumps(marker).encode(); deterministic_zip(path, files)
        data = snapshot('ps-card'); data['items'][0].update(fullNameRu='Тестовый Константин Александрович-Владимирович', fullNameKz='Әділбек Өмірсерік Қанатұлы')
        result = render_archive_one(data, data['items'][0], path)
        filled = E.fromstring(result['word/document.xml']).find('.//' + W + 'txbxContent')
        text = ''.join(filled.itertext())
        self.assertIn(data['items'][0]['fullNameRu'], text); self.assertIn(data['items'][0]['fullNameKz'], text)
        self.assertEqual(filled.find('.//' + W + 'sz').get(W + 'val'), '15')
        data['items'][0]['fullNameRu'] = 'Полное имя ' * 100
        with self.assertRaisesRegex(ValueError, 'PRINT_LAYOUT_OVERFLOW'):
            render_archive_one(data, data['items'][0], path)

    def test_ps_disciplines_preserve_explicit_blanks_and_historical_fallback(self):
        data = snapshot('ps-card'); item = data['items'][0]
        fields = archive_fields(data, item)
        self.assertEqual(fields['PS_GENERAL_SUBJECT_RU'], 'Безопасность')
        self.assertEqual(fields['PS_SPECIAL_SUBJECT_RU'], '')
        self.assertEqual(fields['PS_SPECIAL_NUMBER'], '')
        item['assignment'].update(psGeneralSubjectRu='', psGeneralSubjectKz='',
                                  psSpecialSubjectRu='Сварка', psSpecialSubjectKz='Дәнекерлеу')
        fields = archive_fields(data, item)
        self.assertEqual(fields['PS_GENERAL_SUBJECT_RU'], '')
        self.assertEqual(fields['PS_GENERAL_NUMBER'], '')
        self.assertEqual(fields['PS_SPECIAL_SUBJECT_KZ'], 'Дәнекерлеу')
        self.assertEqual(fields['PS_SPECIAL_NUMBER'], '2')

    def test_ps_qualification_and_credential_require_the_actual_passed_member(self):
        data = snapshot('ps-protocol'); item = data['items'][0]
        data['issuer']['approvalBasis'] = 'приказа №7'
        item['assignment'].update(outcome={'status': 'PASSED'}, psQualificationRu='Электромонтёр', psQualificationKz='Электрмонтер')
        item['number'] = 'ПРОТОКОЛ-123'
        fields = archive_fields(data, item)
        self.assertEqual(fields['CREDENTIAL_NUMBER'], '')
        self.assertEqual(fields['PS_AWARDED_QUALIFICATION_RU'], 'Электромонтёр')
        self.assertEqual(fields['PS_DECISION_RU'], 'На основании приказа №7 комиссия приняла экзамен на присвоение квалификации «Электромонтёр»')
        self.assertEqual(fields['PS_DECISION_KZ'], 'приказа №7 негізінде комиссия емтихан қабылдады және «Электрмонтер» біліктілігін растады')
        item['credentialNumber'] = 'УД-444'
        self.assertEqual(archive_fields(data, item)['CREDENTIAL_NUMBER'], 'УД-444')
        for status in ['FAILED', 'ABSENT', 'UNKNOWN', None]:
            item['assignment']['outcome'] = {'status': status} if status else {}
            fields = archive_fields(data, item)
            self.assertEqual(fields['PS_AWARDED_QUALIFICATION_RU'], '')
            self.assertEqual(fields['PS_AWARDED_QUALIFICATION_KZ'], '')
            self.assertEqual(fields['CREDENTIAL_NUMBER'], '')
            self.assertIn('Электромонтёр', fields['PS_DECISION_RU'])
            self.assertIn('результаты экзаменов', fields['PS_DECISION_RU'])
            self.assertNotIn('растады', fields['PS_DECISION_KZ'])

    def test_ps_group_header_lists_all_qualifications_and_never_awards_failed_members(self):
        path, files = self.package('ps-protocol', roster=True)
        tree = E.fromstring(files['word/document.xml']); body = tree.find(W + 'body')
        body.insert(0, paragraph('{{PS_DECISION_RU}}'))
        body.insert(1, paragraph('{{PS_DECISION_KZ}}'))
        table = body.find(W + 'tbl'); cell = table.findall(W + 'tr')[1].find(W + 'tc')
        cell.append(paragraph('Award: {{PS_AWARDED_QUALIFICATION_RU}} | {{PS_AWARDED_QUALIFICATION_KZ}}; Credential: {{CREDENTIAL_NUMBER}}'))
        files['word/document.xml'] = E.tostring(tree)
        marker = json.loads(files[MARKER]); marker['fields'] += ['PS_DECISION_RU', 'PS_DECISION_KZ', 'PS_AWARDED_QUALIFICATION_RU', 'PS_AWARDED_QUALIFICATION_KZ', 'CREDENTIAL_NUMBER']
        files[MARKER] = json.dumps(marker).encode(); deterministic_zip(path, files)
        data = snapshot('ps-protocol', 3); data['groupEvent'] = {'contractVersion': 1}
        for index, item in enumerate(data['items']):
            item['assignment'].update(outcome={'status': 'PASSED'}, psQualificationRu='Сварщик' if index < 2 else 'Монтажник', psQualificationKz='Дәнекерлеуші' if index < 2 else 'Құрастырушы')
            item['credentialNumber'] = 'УД-' + str(index + 1)
        all_passed = E.fromstring(render_archive_group(data, path)['word/document.xml'])
        header_ru = ''.join(all_passed.find(W + 'body')[0].itertext())
        self.assertIn('квалификаций «Сварщик; Монтажник»', header_ru)
        self.assertEqual(header_ru.count('Сварщик'), 1)
        data['items'][2]['assignment']['outcome']['status'] = 'FAILED'; before = deepcopy(data)
        mixed = E.fromstring(render_archive_group(data, path)['word/document.xml']); body = mixed.find(W + 'body')
        self.assertIn('результаты экзаменов по квалификациям «Сварщик; Монтажник»', ''.join(body[0].itertext()))
        self.assertNotIn('растады', ''.join(body[1].itertext()))
        rows = body.find(W + 'tbl').findall(W + 'tr')
        self.assertIn('Award: Сварщик | Дәнекерлеуші; Credential: УД-1', ''.join(rows[1].itertext()))
        self.assertIn('Award:  | ; Credential: ', ''.join(rows[3].itertext()))
        self.assertNotIn('УД-3', ''.join(rows[3].itertext()))
        self.assertEqual(data, before)

    def test_issuer_name_uses_actual_center_and_logo_never_keeps_sample_art(self):
        path, files = self.package(media=True)
        marker = json.loads(files[MARKER]); marker['dynamicMedia'][0]['kind'] = 'ISSUER_NAME'
        image = BytesIO(); Image.new('RGB', (400, 120), 'red').save(image, 'PNG')
        files['word/media/photo.png'] = image.getvalue(); files[MARKER] = json.dumps(marker).encode()
        deterministic_zip(path, files)
        data = snapshot(); result = render_archive_one(data, data['items'][0], path)
        rendered = Image.open(BytesIO(result['word/media/photo.png']))
        self.assertEqual(rendered.size, (400, 120)); self.assertIsNotNone(rendered.getbbox())
        self.assertEqual(rendered.getpixel((0, 0)), (255, 255, 255, 0))
        changed = deepcopy(data); changed['issuer']['nameRu'] = 'Другой центр'
        self.assertNotEqual(result['word/media/photo.png'], render_archive_one(changed, changed['items'][0], path)['word/media/photo.png'])
        marker['dynamicMedia'][0]['kind'] = 'LOGO'; files[MARKER] = json.dumps(marker).encode(); deterministic_zip(path, files)
        self.assertIsNone(Image.open(BytesIO(render_archive_one(data, data['items'][0], path)['word/media/photo.png'])).getbbox())

    def test_combined_language_package_can_itself_be_filled_and_batched(self):
        path, source = self.package()
        combined = combine_archive_parts([source, source])
        deterministic_zip(path, combined)
        data = snapshot(count=2)
        first = render_archive_one(data, data['items'][0], path)
        second = render_archive_one(data, data['items'][1], path)
        result = combine_archive_parts([first, second])
        header_parts = [name for name in result if name.endswith('header1.xml')]
        self.assertEqual(len(header_parts), 4)
        for index in [1, 2]:
            self.assertEqual(sum(f'Получатель {index}' in visible(result[name]) for name in header_parts), 2)
        self.assertEqual(len(list(E.fromstring(result['word/document.xml']).iter(W + 'sectPr'))), 4)

    def test_english_appendix_is_opt_in_and_factual(self):
        path, _ = self.package()
        data = snapshot(); data['englishAppendix'] = True
        data['issuer'].update(nameEn='Training centre', cityEn='Astana', headNameEn='Separate Director')
        for index, member in enumerate(data['issuer']['commission']):
            member.update(nameEn=f'Member {index}', positionEn='Teacher')
        item = data['items'][0]
        item.update(fullNameEn='Recipient One', positionEn='Engineer', workplaceEn='Employer One')
        item['assignment'].update(trainingSubjectEn='Safety', resultEn='Failed', reasonEn='Repeat')
        output = self.directory / 'english.docx'
        render_archive_document(data, output, path)
        with ZipFile(output) as archive:
            text = visible(archive.read('word/document.xml'))
            self.assertIn('Получатель 1', text); self.assertIn('Recipient One', text)
            self.assertIn('Failed', text)
        item['assignment']['trainingSubjectEn'] = ''
        with self.assertRaisesRegex(ValueError, 'ENGLISH_FIELDS_REQUIRED'):
            render_archive_document(data, output, path)


if __name__ == '__main__':
    unittest.main()
