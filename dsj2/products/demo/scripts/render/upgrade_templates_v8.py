"""Correct two PS cell mappings without changing outer paper/frame geometry."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
from zipfile import ZipFile
from lxml import etree as E
from sanitize_templates import deterministic_zip

ROOT=Path(__file__).resolve().parents[2]
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def set_cell_text(cell,value):
    paragraphs=cell.findall(W+'p')
    p=paragraphs[0]
    for extra in paragraphs[1:]:cell.remove(extra)
    run=p.find(W+'r')
    props=deepcopy(run.find(W+'rPr')) if run is not None and run.find(W+'rPr') is not None else E.Element(W+'rPr')
    for node in list(p):
        if node.tag!=W+'pPr':p.remove(node)
    run=E.SubElement(p,W+'r');run.append(props);E.SubElement(run,W+'t').text=value


def main():
    directory=ROOT/'assets/templates';archive=ROOT/'docs/evidence/commercial-acceptance/printing/historical-inputs'
    manifest=json.loads((directory/'manifest.json').read_text(encoding='utf8'));report={}
    for template in manifest['templates']:
        tid=template['id']
        if tid not in ['ps-card','ps-witness']:continue
        source=directory/(tid+('.v7.docx' if tid=='ps-card' else '.v6.docx'))
        if not source.exists():source=archive/source.name
        with ZipFile(source) as z:files={n:z.read(n) for n in z.namelist()}
        tree=E.fromstring(files['word/document.xml'])
        if tid=='ps-card':
            table=next(t for t in tree.iter(W+'tbl') if 'Пәндер атауы' in ''.join(t.itertext()))
            cells=table.find(W+'tr').findall(W+'tc')
            assert len(cells)==3 and '№ п.п.' in ''.join(cells[2].itertext())
            set_cell_text(cells[0],'№ п.п.')
            for node in cells[2].iter(W+'t'):
                if node.text:node.text=node.text.replace('№ п.п.','')
            report[tid]={'table':2,'row':0,'ordinalHeaderCell':0,'gradeHeaderCell':2}
        else:
            paragraph=next(p for p in tree.iter(W+'p') if 'Біліктілік комиссиясының' in ''.join(p.itertext()))
            table=next(n for n in paragraph.iterancestors() if n.tag==W+'tbl')
            cells=table.find(W+'tr').findall(W+'tc')
            assert len(cells)==7 and '{{PROTOCOL_DAY}} {{PROTOCOL_MONTH_KZ}}' in ''.join(cells[4].itertext())
            set_cell_text(cells[4],'{{PROTOCOL_DAY}}')
            set_cell_text(cells[6],'{{PROTOCOL_MONTH_KZ}}')
            report[tid]={'decisionDateRow':0,'yearCell':1,'dayCell':4,'monthCell':6,'reason':'month no longer wraps inside the 28.35pt day cell'}
        files['word/document.xml']=E.tostring(tree,xml_declaration=True,encoding='utf8')
        output=directory/(tid+'.v8.docx');deterministic_zip(output,files)
        template.update(version=8,file=output.name,sha256=hashlib.sha256(output.read_bytes()).hexdigest(),previousTemplateSha256=hashlib.sha256(source.read_bytes()).hexdigest())
        alltext=''.join(''.join(E.fromstring(data).itertext()) for name,data in files.items() if name.endswith('.xml'))
        template['fields']=sorted(set(re.findall(r'\{\{([A-Z0-9_]+)\}\}',alltext)))
        target=archive/source.name
        if source.parent==directory:
            if target.exists():assert target.read_bytes()==source.read_bytes();source.unlink()
            else:source.rename(target)
    (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    (directory/'v8-changes.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')


if __name__=='__main__':main()
