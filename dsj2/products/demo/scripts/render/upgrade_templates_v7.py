"""Remove source gray rectangles wider than A4, preserving black physical frames."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
from sanitize_templates import deterministic_zip
ROOT=Path(__file__).resolve().parents[2]
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
MC='{http://schemas.openxmlformats.org/markup-compatibility/2006}'


def main():
    directory=ROOT/'assets/templates';archive=ROOT/'docs/evidence/commercial-acceptance/printing/historical-inputs'
    manifest=json.loads((directory/'manifest.json').read_text(encoding='utf8'));report={}
    for template in manifest['templates']:
        tid=template['id']
        if tid not in ['biot-worker-card','ptm-card','pb-card','ps-card']:continue
        source=directory/(tid+'.v6.docx')
        if not source.exists():source=archive/(tid+'.v6.docx')
        with ZipFile(source) as z:files={n:z.read(n) for n in z.namelist()}
        tree=E.fromstring(files['word/document.xml']);removed=[]
        for node in list(tree.iter('{urn:schemas-microsoft-com:vml}rect')):
            if not node.get('fillcolor','').lower().startswith('#d8d8d8') or node.get('stroked')!='f':continue
            alternate=next((n for n in node.iterancestors() if n.tag==MC+'AlternateContent'),None)
            target=alternate if alternate is not None else node
            if any((n.text or '').strip() for n in target.iter(W+'t')):raise ValueError('DECORATION_HAS_TEXT')
            removed.append({'id':node.get('id'),'fill':node.get('fillcolor'),'style':node.get('style')});target.getparent().remove(target)
        files['word/document.xml']=E.tostring(tree,xml_declaration=True,encoding='utf8');output=directory/(tid+'.v7.docx');deterministic_zip(output,files)
        template.update(version=7,file=output.name,sha256=hashlib.sha256(output.read_bytes()).hexdigest(),previousTemplateSha256=hashlib.sha256(source.read_bytes()).hexdigest())
        report[tid]={'removedDecorativeRectangles':removed,'blackFrames':'unchanged','geometry':'unchanged'}
        target=archive/source.name
        if source.parent==directory:
            if target.exists():assert target.read_bytes()==source.read_bytes();source.unlink()
            else:source.rename(target)
    (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    (directory/'v7-changes.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')


if __name__=='__main__':main()
