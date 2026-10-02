"""Source fidelity, pinned reconstruction and English appendix regressions."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from zipfile import ZipFile

from lxml import etree as E

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/render'))
from english_appendix import append_english_pages, validate_english
from renderer import render_docx, render_one, COLUMNS
from sanitize_templates import deterministic_zip
from restore_original_forms import prepare_original, SOURCES, METADATA_PART
from test_render import fixture
from test_group_protocol import group_fixture
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def english_fixture(template_id,count=1):
    snapshot=group_fixture(template_id,count) if count>1 else fixture(template_id)
    snapshot['englishAppendix']=True
    snapshot['issuer'].update(nameEn='Sample Training Centre',cityEn='Astana',addressEn='1 Example Street')
    snapshot['issuer'].update(approvalBasisEn='Training centre order 1 of 1 September 2026',headNameEn='Example Centre Head')
    for index,member in enumerate(snapshot['issuer'].get('commission',[]),1):member.update(nameEn=f'Example Commissioner {index}',positionEn='Commission chair' if index==1 else 'Commission member')
    for index,item in enumerate(snapshot['items'],1):
        item.update(fullNameEn=f'Example Person {index:03}',positionEn='Engineer',workplaceEn='Example Employer LLP')
        item.update(employerAddressEn='1 Example Street, Astana',departmentEn='Test Department')
        item['assignment'].update(trainingSubjectEn='Occupational safety training',resultEn='Passed',reasonEn='Initial training',educationEn='Higher education')
        item['assignment'].update(biotIndustryEn='Manufacturing',biotKnowledgeResultEn='Passed',biotProctoringResultEn='Verified',biotNotesEn='Initial assessment')
    return snapshot


class OriginalFormTests(unittest.TestCase):
    def test_original_geometry_and_image_slots_survive_all_forms(self):
        sources={**SOURCES,'biot-itr-protocol':SOURCES['biot-protocol']}
        for tid,relative in sources.items():
            with self.subTest(template=tid):
                source=ROOT.parents[1]/'docs/experimental'/relative
                before=hashlib.sha256(source.read_bytes()).hexdigest()
                files=prepare_original(source,tid)
                with ZipFile(source) as archive:
                    original=E.fromstring(archive.read('word/document.xml'))
                    restored=E.fromstring(files['word/document.xml'])
                    self.assertEqual(len(list(original.iter(W+'tbl'))),len(list(restored.iter(W+'tbl'))))
                    for tag in ['pgSz','pgMar','tblGrid']:
                        self.assertEqual([E.tostring(n) if tag=='tblGrid' else dict(n.attrib) for n in original.iter(W+tag)],
                                         [E.tostring(n) if tag=='tblGrid' else dict(n.attrib) for n in restored.iter(W+tag)])
                    self.assertEqual({n for n in archive.namelist() if n.startswith('word/media/')},
                                     {n for n in files if n.startswith('word/media/')})
                self.assertEqual(before,hashlib.sha256(source.read_bytes()).hexdigest())
                self.assertIn(METADATA_PART,files)
                self.assertFalse(list(restored.iter(W+'instrText')))

    def test_appendix_disabled_leaves_original_bytes_in_place(self):
        snapshot=fixture('biot-worker-card');template=next(t for t in json.loads((ROOT/'assets/templates/manifest.json').read_text(encoding='utf-8'))['templates'] if t['id']=='biot-worker-card')
        files=render_one(snapshot,snapshot['items'][0],ROOT/'assets/templates'/template['file'])
        before=deepcopy(files)
        self.assertEqual(before,append_english_pages(files,snapshot))

    def test_english_requires_actual_translated_fields_and_preserves_source_nodes(self):
        snapshot=english_fixture('ps-witness')
        snapshot['items'][0]['fullNameEn']=''
        with self.assertRaisesRegex(ValueError,'fullNameEn'):validate_english(snapshot)
        snapshot=english_fixture('ps-witness')
        template=next(t for t in json.loads((ROOT/'assets/templates/manifest.json').read_text(encoding='utf-8'))['templates'] if t['id']=='ps-witness')
        files=render_one(snapshot,snapshot['items'][0],ROOT/'assets/templates'/template['file'])
        body=E.fromstring(files['word/document.xml']).find(W+'body')
        prior=[E.tostring(n) for n in body if n.tag!=W+'sectPr']
        result=append_english_pages(deepcopy(files),snapshot)
        newbody=E.fromstring(result['word/document.xml']).find(W+'body')
        self.assertEqual(prior,[E.tostring(n) for n in list(newbody)[:len(prior)]])
        text=''.join(newbody.itertext())
        self.assertIn('English appendix',text);self.assertIn('Example Person 001',text)
        self.assertIn('Examination protocol: ПР-00001',text);self.assertIn('Registration number: 00123',text)
        self.assertIn('Certificate number: ТЕСТ-00001',text)

    def test_large_group_english_roster_contains_every_person_once_and_repeats_header(self):
        with tempfile.TemporaryDirectory() as temp:
            snapshot=english_fixture('biot-protocol',250)
            path=Path(temp)/'group.docx';render_docx(snapshot,path)
            with ZipFile(path) as archive:root=E.fromstring(archive.read('word/document.xml'))
            tables=[t for t in root.iter(W+'tbl') if 'Result and record details' in ''.join(t.itertext())]
            self.assertEqual(1,len(tables));rows=tables[0].findall(W+'tr')
            self.assertEqual(251,len(rows));self.assertIsNotNone(rows[0].find(W+'trPr/'+W+'tblHeader'))
            for index,item in enumerate(snapshot['items'],1):
                self.assertEqual(1,''.join(tables[0].itertext()).count(item['fullNameEn']))
            self.assertNotIn('{{',''.join(root.itertext()))

    def test_import_and_registry_keep_category_and_english_values(self):
        for key in ['employeeCategory','fullNameEn','positionEn','workplaceEn','trainingSubjectEn','resultEn','reasonEn','educationEn']:
            self.assertIn(key,COLUMNS)

    def test_original_card_protocol_and_expiry_dates_are_independent_of_issue(self):
        manifest=json.loads((ROOT/'assets/templates/manifest.json').read_text(encoding='utf-8'))
        for tid in ['ptm-card','pb-card','ps-card','biot-worker-card']:
            with self.subTest(template=tid):
                snapshot=fixture(tid);snapshot['items'][0]['assignment'].update(documentDate='2026-10-01',protocolDate='2026-09-30',validUntil='2029-12-15')
                template=next(t for t in manifest['templates'] if t['id']==tid)
                files=render_one(snapshot,snapshot['items'][0],ROOT/'assets/templates'/template['file'])
                root=E.fromstring(files['word/document.xml'])
                protocol_blocks=[b for b in root.iter(W+'txbxContent') if 'ПР-00001' in ''.join(b.itertext())]
                self.assertTrue(protocol_blocks)
                for box in protocol_blocks:
                    text=' '.join(''.join(box.itertext()).split())
                    self.assertIn('30',text);self.assertIn('2026',text)
                    self.assertNotIn('01.10',text)
                    if tid in ['ptm-card','pb-card']:self.assertIn('2029',text);self.assertIn('15',text)

    def test_ptm_expiry_prints_exactly_once_with_adjacent_and_split_merge_runs(self):
        manifest=json.loads((ROOT/'assets/templates/manifest.json').read_text(encoding='utf-8'))
        template=next(t for t in manifest['templates'] if t['id']=='ptm-card')
        source=ROOT/'assets/templates'/template['file']
        with ZipFile(source) as archive:package={n:archive.read(n) for n in archive.namelist()}
        tree=E.fromstring(package['word/document.xml'])
        # Keep the retained form, including both DrawingML/VML alternatives,
        # but split the duplicate merge keys as Word does when formatting them.
        split_count=0
        for paragraph in tree.iter(W+'p'):
            nodes=paragraph.xpath('./w:r/w:t | ./w:hyperlink/w:r/w:t',namespaces={'w':W[1:-1]})
            if 'Действительно до' not in ''.join(n.text or '' for n in nodes):continue
            for node in nodes:
                token=node.text or ''
                if token not in ['{{VALID_DAY_MONTH}}','{{DOCUMENT_DAY_MONTH}}']:continue
                run=node.getparent();extra=deepcopy(run)
                node.text=token[:6];extra.find(W+'t').text=token[6:]
                run.addnext(extra);split_count+=1
        self.assertGreater(split_count,0)
        package['word/document.xml']=E.tostring(tree,xml_declaration=True,encoding='utf-8')
        with tempfile.TemporaryDirectory() as temp:
            split_template=Path(temp)/'split-ptm.docx';deterministic_zip(split_template,package)
            for path in [source,split_template]:
                for valid_date,printed in [('2029-10-01','01.10.2029'),('2029-12-15','15.12.2029')]:
                    with self.subTest(template=path.name,validUntil=valid_date):
                        snapshot=fixture('ptm-card')
                        snapshot['items'][0]['assignment'].update(documentDate='2026-10-01',protocolDate='2026-09-30',validUntil=valid_date)
                        files=render_one(snapshot,snapshot['items'][0],path)
                        rendered=E.fromstring(files['word/document.xml'])
                        lines=[''.join(n.text or '' for n in p.xpath('./w:r/w:t | ./w:hyperlink/w:r/w:t',namespaces={'w':W[1:-1]})) for p in rendered.iter(W+'p')]
                        expiry=[' '.join(line.split()) for line in lines if 'Действительно до' in line]
                        self.assertTrue(expiry)
                        for line in expiry:
                            self.assertEqual(f'Действительно до {printed} г.',line)
                            self.assertEqual(1,line.count(printed))

if __name__=='__main__':unittest.main(verbosity=2)
