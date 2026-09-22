"""Keep the PS examination heading below its restored issuer band."""
import hashlib,json,re
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
from package_xml import normalize_package
from sanitize_templates import deterministic_zip
from upgrade_templates_v10 import W,move_box
ROOT=Path(__file__).resolve().parents[2]


def main():
    directory=ROOT/'assets/templates';archive=ROOT/'docs/evidence/commercial-acceptance/printing/historical-inputs'
    manifest=json.loads((directory/'manifest.json').read_text(encoding='utf8'));template=next(t for t in manifest['templates'] if t['id']=='ps-card')
    source=directory/'ps-card.v11.docx'
    if not source.exists():source=archive/source.name
    with ZipFile(source) as z:files={n:z.read(n) for n in z.namelist()}
    tree=E.fromstring(files['word/document.xml']);changed=0
    for box in tree.iter(W+'txbxContent'):
        content=''.join(box.itertext())
        if 'Тапсырылған емтихандар' not in content:continue
        move_box(box,8)
        captions=[p for p in box.findall(W+'p') if ''.join(n.text or '' for n in p.iter(W+'t')).strip()=='(баға/оценка)']
        if len(captions)>1:box.remove(captions[-1])
        changed+=1
    assert changed==2
    files['word/document.xml']=E.tostring(tree,xml_declaration=True,encoding='utf-8')
    output=directory/'ps-card.v12.docx';deterministic_zip(output,normalize_package(files));before=hashlib.sha256(source.read_bytes()).hexdigest()
    template.update(version=12,file=output.name,sha256=hashlib.sha256(output.read_bytes()).hexdigest(),previousTemplateSha256=before)
    (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    (directory/'v12-changes.json').write_text(json.dumps({'ps-card':{'headingOffsetPt':8,'removedCaption':'second unused duplicate grade caption','outerFrameGeometry':'unchanged','previousSha256':before,'sha256':template['sha256']}},indent=2)+'\n',encoding='utf8')
    target=archive/source.name
    if source.parent==directory:
        if target.exists():assert target.read_bytes()==source.read_bytes();source.unlink()
        else:source.rename(target)


if __name__=='__main__':main()
