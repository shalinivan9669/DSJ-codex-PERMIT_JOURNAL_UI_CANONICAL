"""New-policy assembly keeps recipient pages and distinct frozen data."""
from copy import deepcopy
from pathlib import Path
import os,unittest
from zipfile import ZipFile
from lxml import etree as E
import pymupdf
from test_render import fixture, EVIDENCE_ROOT
from renderer import render_docx,convert_pdf
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

class NeutralBatchTests(unittest.TestCase):
    def test_two_certificates_have_no_blank_interstitial_page(self):
        out=EVIDENCE_ROOT/'neutral-batch';out.mkdir(parents=True,exist_ok=True)
        for tid,pages in [('biot-itr-certificate',2),('ps-witness',4)]:
            with self.subTest(template=tid):
                snap=fixture(tid);second=deepcopy(snap['items'][0])
                second.update(id='second',fullNameRu='Второй Тестовый Получатель',number='ВТОРОЙ-002')
                snap['items'].append(second)
                docx=out/(tid+'-batch2.docx');render_docx(snap,docx)
                pdf=docx.with_suffix('.pdf');convert_pdf(docx,pdf)
                document=pymupdf.open(pdf)
                self.assertEqual(len(document),pages)
                text=' '.join(' '.join(page.get_text() for page in document).split())
                self.assertIn('Второй Тестовый Получатель',text)
                self.assertIn('ВТОРОЙ-002',text)
                self.assertTrue(all(len(page.get_text().strip())>100 for page in document))

if __name__=='__main__':unittest.main()
