"""Align repeated BIOT data panel and start dividers below the issuer bands."""
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


def fix(files):
    tree=E.fromstring(files['word/document.xml']);boxes=0;dividers=0
    for box in tree.iter(W+'txbxContent'):
        if '{{CHAIR}}' not in ''.join(t.text or '' for t in box.iter(W+'t')):continue
        shape=next(n for n in box.iterancestors() if E.QName(n).localname in ['shape','anchor'])
        if shape.tag==V+'shape':
            style=shape.get('style')
            if abs(value(style,'width')-259.5)>.01:continue
            shape.set('style',put(put(style,'margin-left',288.15),'width',246))
        else:
            extent=shape.find(WP+'extent')
            if int(extent.get('cx'))!=3295650:continue
            shape.find(WP+'positionH/'+WP+'posOffset').text='3659505'
            extent.set('cx','3124200');shape.find('.//'+A+'xfrm/'+A+'ext').set('cx','3124200')
        boxes+=1
    for anchor in tree.iter(WP+'anchor'):
        extent=anchor.find(WP+'extent')
        if int(extent.get('cx','0'))!=4445 or int(extent.get('cy','0'))!=2187575:continue
        offset=anchor.find(WP+'positionV/'+WP+'posOffset');offset.text=str(int(offset.text)+14*12700)
        extent.set('cy',str(int(extent.get('cy'))-14*12700))
        extent=anchor.find('.//'+A+'xfrm/'+A+'ext');extent.set('cy',str(int(extent.get('cy'))-14*12700));dividers+=1
    for shape in tree.iter(V+'shape'):
        style=shape.get('style','')
        if abs(value(style,'width')-.35)>.001 or abs(value(style,'height')-172.25)>.001:continue
        shape.set('style',put(put(style,'margin-top',value(style,'margin-top')+14),'height',value(style,'height')-14));dividers+=1
    assert boxes==2 and dividers==4,(boxes,dividers)
    files['word/document.xml']=E.tostring(tree,xml_declaration=True,encoding='utf-8')
    return normalize_package(files)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--probe',action='store_true');args=parser.parse_args()
    directory=ROOT/'assets/templates';archive=ROOT/'docs/evidence/commercial-acceptance/printing/historical-inputs'
    manifest=json.loads((directory/'manifest.json').read_text(encoding='utf8'));template=next(t for t in manifest['templates'] if t['id']=='biot-worker-card')
    assert template['version']==14
    source=directory/template['file'];before=hashlib.sha256(source.read_bytes()).hexdigest()
    with ZipFile(source) as z:files={n:z.read(n) for n in z.namelist()}
    output=(ROOT/'docs/evidence/commercial-acceptance/printing/biot-chair-v15' if args.probe else directory)/'biot-worker-card.v15.docx'
    output.parent.mkdir(parents=True,exist_ok=True);deterministic_zip(output,fix(files));checksum=hashlib.sha256(output.read_bytes()).hexdigest()
    if args.probe:return
    template.update(version=15,file=output.name,previousTemplateSha256=before,sha256=checksum)
    (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    (directory/'biot-worker-v15-changes.json').write_text(json.dumps({'previousSha256':before,'sha256':checksum,'lowerRightTextbox':{'leftPt':288.15,'widthPt':246,'matchesUpper':True},'dividers':'start +14pt, height -14pt; unchanged bottom endpoints','font':'unchanged 8pt','outerFrames':'unchanged'},indent=2)+'\n',encoding='utf8')
    target=archive/source.name
    if target.exists():assert target.read_bytes()==source.read_bytes();source.unlink()
    else:source.rename(target)


if __name__=='__main__':main()
