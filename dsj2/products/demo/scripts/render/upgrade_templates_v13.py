"""Fix Word-observed clipping without changing card frames or reducing text size."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
from package_xml import normalize_package
from sanitize_templates import deterministic_zip
from upgrade_templates_v10 import W,V,value,put

ROOT=Path(__file__).resolve().parents[2]
WP='{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
A='{http://schemas.openxmlformats.org/drawingml/2006/main}'


def fix(files,tid):
    tree=E.fromstring(files['word/document.xml']);count=0
    for box in tree.iter(W+'txbxContent'):
        content=''.join(t.text or '' for t in box.iter(W+'t'))
        if tid=='biot-itr-certificate' and '{{CHAIR}}' in content:
            shape=next(n for n in box.iterancestors() if E.QName(n).localname in ['shape','anchor'])
            if shape.tag==V+'shape':
                style=shape.get('style');shape.set('style',put(style,'height',value(style,'height')+14))
            else:
                extent=shape.find(WP+'extent');extent.set('cy',str(int(extent.get('cy'))+14*12700))
                extent=shape.find('.//'+A+'xfrm/'+A+'ext');extent.set('cy',str(int(extent.get('cy'))+14*12700))
            count+=1
        if tid=='ps-card' and '{{FULL_NAME' in content:
            first=box.find(W+'p')
            assert not ''.join(t.text or '' for t in first.iter(W+'t')).strip()
            assert first.find('.//'+W+'br') is not None
            box.remove(first);count+=1
        if tid=='ptm-card' and '{{FULL_NAME' in content:
            shape=next(n for n in box.iterancestors() if E.QName(n).localname in ['shape','anchor'])
            if shape.tag==V+'shape':
                style=shape.get('style');style=put(style,'margin-left',value(style,'margin-left')+6)
                shape.set('style',put(style,'width',value(style,'width')-6))
            else:
                offset=shape.find(WP+'positionH/'+WP+'posOffset');offset.text=str(int(offset.text)+6*12700)
                for extent in [shape.find(WP+'extent'),shape.find('.//'+A+'xfrm/'+A+'ext')]:extent.set('cx',str(int(extent.get('cx'))-6*12700))
            count+=1
    assert count==2,(tid,count)
    files['word/document.xml']=E.tostring(tree,xml_declaration=True,encoding='utf-8')
    return normalize_package(files)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--probe',action='store_true');args=parser.parse_args()
    directory=ROOT/'assets/templates';archive=ROOT/'docs/evidence/commercial-acceptance/printing/historical-inputs'
    manifest=json.loads((directory/'manifest.json').read_text(encoding='utf8'));report=[]
    for template in manifest['templates']:
        tid=template['id']
        if tid not in ['biot-itr-certificate','ps-card','ptm-card']:continue
        source=directory/template['file'];before=hashlib.sha256(source.read_bytes()).hexdigest()
        with ZipFile(source) as z:files={n:z.read(n) for n in z.namelist()}
        output=(ROOT/'docs/evidence/commercial-acceptance/printing/word-probes/v13' if args.probe else directory)/(tid+'.v13.docx')
        output.parent.mkdir(parents=True,exist_ok=True);deterministic_zip(output,fix(files,tid))
        checksum=hashlib.sha256(output.read_bytes()).hexdigest()
        report.append({'id':tid,'previousSha256':before,'sha256':checksum,'change':{'biot-itr-certificate':'signature textbox +14pt height','ps-card':'remove inherited leading blank line above first card title','ptm-card':'front textbox left inset +6pt (2.12mm), right edge unchanged'}[tid],'fontSize':'unchanged','outerFrames':'unchanged'})
        if not args.probe:
            template.update(version=13,file=output.name,sha256=checksum,previousTemplateSha256=before)
            target=archive/source.name
            if target.exists():assert target.read_bytes()==source.read_bytes();source.unlink()
            else:source.rename(target)
    if not args.probe:
        (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
        (directory/'v13-changes.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')


if __name__=='__main__':main()
