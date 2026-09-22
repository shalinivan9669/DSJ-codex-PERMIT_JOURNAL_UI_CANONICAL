"""Reserve 9pt under the PS issuer band consistently in Word and LibreOffice."""
import argparse,hashlib,json
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
from package_xml import normalize_package
from sanitize_templates import deterministic_zip
from upgrade_templates_v10 import W,move_box
ROOT=Path(__file__).resolve().parents[2]


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--probe',action='store_true');args=parser.parse_args()
    directory=ROOT/'assets/templates';archive=ROOT/'docs/evidence/commercial-acceptance/printing/historical-inputs'
    manifest=json.loads((directory/'manifest.json').read_text(encoding='utf8'));template=next(t for t in manifest['templates'] if t['id']=='ps-card')
    source=directory/template['file'];before=hashlib.sha256(source.read_bytes()).hexdigest()
    with ZipFile(source) as z:files={n:z.read(n) for n in z.namelist()}
    tree=E.fromstring(files['word/document.xml']);changed=0
    for box in tree.iter(W+'txbxContent'):
        if '{{FULL_NAME' in ''.join(t.text or '' for t in box.iter(W+'t')):move_box(box,9);changed+=1
    assert changed==2
    files['word/document.xml']=E.tostring(tree,xml_declaration=True,encoding='utf-8')
    output=(ROOT/'docs/evidence/commercial-acceptance/printing/word-probes/v15' if args.probe else directory)/'ps-card.v15.docx';output.parent.mkdir(parents=True,exist_ok=True)
    deterministic_zip(output,normalize_package(files));checksum=hashlib.sha256(output.read_bytes()).hexdigest()
    if args.probe:return
    template.update(version=15,file=output.name,previousTemplateSha256=before,sha256=checksum)
    (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    (directory/'v15-changes.json').write_text(json.dumps({'ps-card':{'topOffsetPt':9,'outerFrames':'unchanged','fontPt':8,'reason':'keep Kazakh title below issuer band in both Word and LibreOffice','previousSha256':before,'sha256':checksum}},indent=2)+'\n',encoding='utf8')
    target=archive/source.name
    if target.exists():assert target.read_bytes()==source.read_bytes();source.unlink()
    else:source.rename(target)


if __name__=='__main__':main()
