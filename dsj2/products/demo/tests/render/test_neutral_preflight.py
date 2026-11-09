"""Use the API-supported overflow contract before issuing any document."""
import hashlib,json,tempfile,unittest
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
from test_render import ROOT, STORE
from test_group_protocol import FORMS
from neutral_fixture import fixture, group_fixture, MANIFEST
from renderer import preflight, render_docx
from neutral_forms import neutral_source_entry, identify_neutral
from group_protocol import W, roster_table

class NeutralPreflightTests(unittest.TestCase):
    def test_current_group_sources_keep_template_identity_with_shared_bytes(self):
        manifest=MANIFEST
        snapshots=[]
        for template_id in FORMS:
            template=next(t for t in manifest['groupTemplates'] if t['id']==template_id)
            content=(ROOT/'assets/templates'/template['file']).read_bytes()
            key=f'neutral-preflight-{template_id}.docx'
            path=STORE/key
            path.write_bytes(content)
            self.assertEqual(neutral_source_entry(path,template_id)['id'],template_id)
            self.assertTrue(identify_neutral(path,template_id))
            self.assertFalse(identify_neutral(path,'unknown-protocol'))
            snapshot=group_fixture(template_id,2)
            snapshot.update(templateStorageKey=key,templateChecksum=hashlib.sha256(content).hexdigest())
            snapshots.append(snapshot)
        with tempfile.TemporaryDirectory() as temp:
            result=preflight({'snapshots':snapshots},Path(temp)/'preflight.json')
            self.assertEqual(result['checked'],len(FORMS))
            self.assertEqual(result['issues'],[])
            for snapshot in snapshots:
                with self.subTest(template=snapshot['templateId']):
                    output=Path(temp)/(snapshot['templateId']+'.docx')
                    render_docx(snapshot,output)
                    with ZipFile(output) as archive:
                        root=E.fromstring(archive.read('word/document.xml'))
                    text=' '.join(node.text or '' for node in roster_table(root).iter(W+'t'))
                    self.assertIn('Синтетический Слушатель 001',text)
                    self.assertIn('Синтетический Слушатель 002',text)
                    self.assertNotIn('{{N_',text)

    def test_card_and_certificate_overflow_returns_actionable_issues(self):
        snapshots=[]
        for tid in ['biot-worker-card','pb-card','ps-card','ptm-card','biot-itr-certificate','ps-witness']:
            snapshot=fixture(tid)
            snapshot['items'][0]['fullNameRu']='Слишком длинное значение ' * 150
            snapshot['items'][0]['fullNameKz']='Өте ұзақ мән ' * 150
            snapshots.append(snapshot)
        with tempfile.TemporaryDirectory() as temp:
            out=Path(temp)/'preflight.json'
            result=preflight({'snapshots':snapshots},out)
            self.assertEqual(result['checked'],6)
            self.assertEqual(result['issues'],[{'index':i,'code':'PRINT_LAYOUT_OVERFLOW'} for i in range(6)])
            self.assertEqual(json.loads(out.read_text()),result)

if __name__=='__main__':unittest.main()
