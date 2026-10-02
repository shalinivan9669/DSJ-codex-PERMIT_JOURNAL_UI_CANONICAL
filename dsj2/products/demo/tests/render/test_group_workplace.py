"""New frozen group headers must never imply the first employer owns a mixed roster."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile
from lxml import etree as E
import pymupdf
from test_group_protocol import group_fixture, historical_v1_group_fixture, MANIFEST
from test_render import EVIDENCE_ROOT
from renderer import render_docx, convert_pdf
from group_protocol import roster_table, W

FORMS=['biot-protocol','biot-itr-protocol','pb-protocol']

def fixture(template):
    snapshot=group_fixture(template,3)
    names=[('ТОО «Первый завод»','«Бірінші зауыт» ЖШС'),('ИП Второй подрядчик','Екінші мердігер ЖК'),('ТОО «Третий комплекс»','«Үшінші кешен» ЖШС')]
    for item,(ru,kz) in zip(snapshot['items'],names):
        item.update(workplaceRu=ru,workplaceKz=kz)
    return snapshot

def header(snapshot):
    return {'version':1,**{key:'; '.join(dict.fromkeys(item[key] for item in snapshot['items'])) for key in ['workplaceRu','workplaceKz']}}

def raw_reference(template):
    return next(value for value in MANIFEST['groupTemplates'] if value['id']==template).get('restoration',{}).get('layoutPolicy')=='LEGACY_REFERENCE_90D5'

def source_header_fields(template):
    # The exact source BIOT header is its KK field; its roster is RU. PB has
    # one source company-label field (the reference fixture selects RU).
    if raw_reference(template):return ['workplaceKz'] if template.startswith('biot') else ['workplaceRu']
    return ['workplaceRu','workplaceKz']

class GroupWorkplaceTests(unittest.TestCase):
    def test_mixed_headers_list_all_actual_employers_but_roster_cells_stay_individual(self):
        output=EVIDENCE_ROOT/'group-workplace';output.mkdir(parents=True,exist_ok=True)
        for template in FORMS:
            with self.subTest(template=template):
                snapshot=fixture(template);snapshot['groupHeaderWorkplace']=header(snapshot)
                path=output/(template+'-mixed.docx');render_docx(snapshot,path)
                with ZipFile(path) as z:root=E.fromstring(z.read('word/document.xml'))
                table=roster_table(root);rows=table.findall(W+'tr')[2 if template.startswith('biot') else 1:]
                for row,item in zip(rows,snapshot['items']):
                    text=' '.join(row.itertext())
                    self.assertIn(item['fullNameRu'],text)
                    if template.startswith('biot'):
                        self.assertIn(item['workplaceRu'],text)
                        if not raw_reference(template):self.assertIn(item['workplaceKz'],text)
                    for other in snapshot['items']:
                        if other is not item:self.assertNotIn(other['workplaceRu'],text)
                table.getparent().remove(table);common=' '.join(root.itertext())
                for item in snapshot['items']:
                    for key in source_header_fields(template):self.assertIn(item[key],common)
                pdf=path.with_suffix('.pdf');convert_pdf(path,pdf)
                document=pymupdf.open(pdf)
                first=' '.join(document[0].get_text().split())
                for item in snapshot['items']:
                    for key in source_header_fields(template):self.assertIn(item[key],first)
                for page in document:
                    self.assertTrue(all(w[0]>=-1 and w[1]>=-1 and w[2]<=page.rect.width+1 and w[3]<=page.rect.height+1 for w in page.get_text('words')))

    def test_same_employer_output_is_byte_identical_and_old_mixed_snapshot_keeps_legacy_header(self):
        with tempfile.TemporaryDirectory(prefix='demo-group-header-') as temp:
            for template in FORMS:
                same=group_fixture(template,3);old=Path(temp)/'old.docx';new=Path(temp)/'new.docx'
                render_docx(same,old);opted=deepcopy(same);opted['groupHeaderWorkplace']=header(opted);render_docx(opted,new)
                self.assertEqual(old.read_bytes(),new.read_bytes())
                mixed=fixture(template);render_docx(mixed,old)
                with ZipFile(old) as z:root=E.fromstring(z.read('word/document.xml'))
                table=roster_table(root);table.getparent().remove(table);common=' '.join(root.itertext())
                keys=['workplaceKz'] if raw_reference(template) and template=='pb-protocol' else source_header_fields(template)
                for key in keys:
                    self.assertIn(mixed['items'][0][key],common)
                    self.assertNotIn(mixed['items'][1][key],common)

    def test_historical_v1_joined_headers_keep_both_saved_languages(self):
        with tempfile.TemporaryDirectory(prefix='demo-v1-group-header-') as temp:
            for template in FORMS:
                snapshot=historical_v1_group_fixture(template,3)
                snapshot['items']=fixture(template)['items']
                snapshot['groupHeaderWorkplace']=header(snapshot)
                path=Path(temp)/(template+'.docx');render_docx(snapshot,path)
                with ZipFile(path) as archive:root=E.fromstring(archive.read('word/document.xml'))
                table=roster_table(root);table.getparent().remove(table);common=' '.join(root.itertext())
                for item in snapshot['items']:
                    self.assertIn(item['workplaceRu'],common);self.assertIn(item['workplaceKz'],common)

    def test_unknown_header_contract_fails_without_output(self):
        with tempfile.TemporaryDirectory(prefix='demo-group-header-') as temp:
            snapshot=fixture('biot-protocol');snapshot['groupHeaderWorkplace']={**header(snapshot),'version':2}
            path=Path(temp)/'invalid.docx'
            with self.assertRaisesRegex(ValueError,'GROUP_HEADER_WORKPLACE_CONTRACT'):render_docx(snapshot,path)
            self.assertFalse(path.exists())

if __name__=='__main__':unittest.main()
