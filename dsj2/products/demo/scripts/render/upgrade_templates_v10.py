"""Restore the issuer bands as readable dynamic fields inside physical frames."""
import hashlib
import json
from pathlib import Path
import re
from zipfile import ZipFile
from lxml import etree as E
from package_xml import normalize_package
from sanitize_templates import deterministic_zip

ROOT=Path(__file__).resolve().parents[2]
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
V='{urn:schemas-microsoft-com:vml}'


def value(style,key):
    match=re.search(r'(?:^|;)'+re.escape(key)+r':(-?[\d.]+)pt',style)
    return float(match[1]) if match else 0


def put(style,key,number):
    return re.sub(r'(^|;)'+re.escape(key)+r':-?[\d.]+pt',lambda match:match[1]+key+':'+str(number)+'pt',style)


def move_box(box,offset):
    shape=next((n for n in box.iterancestors() if E.QName(n).localname in ['shape','anchor']),None)
    if shape is None:return
    if E.QName(shape).localname=='shape':
        style=shape.get('style','');style=put(style,'margin-top',value(style,'margin-top')+offset)
        shape.set('style',put(style,'height',value(style,'height')-offset))
    else:
        for position in shape.iter():
            if E.QName(position).localname=='positionV':
                child=next((n for n in position if E.QName(n).localname=='posOffset'),None)
                if child is not None:child.text=str(int(child.text or '0')+round(offset*12700))
        extent=next((n for n in shape if E.QName(n).localname=='extent'),None)
        if extent is not None:extent.set('cy',str(int(extent.get('cy'))-round(offset*12700)))


def main():
    directory=ROOT/'assets/templates';archive=ROOT/'docs/evidence/commercial-acceptance/printing/historical-inputs'
    manifest=json.loads((directory/'manifest.json').read_text(encoding='utf8'));report=[]
    for template in manifest['templates']:
        tid=template['id']
        if tid not in ['biot-worker-card','ptm-card','pb-card','ps-card']:continue
        source=directory/(tid+'.v9.docx')
        if not source.exists():source=archive/source.name
        with ZipFile(source) as z:files={n:z.read(n) for n in z.namelist()}
        tree=E.fromstring(files['word/document.xml'])
        for box in list(tree.iter(W+'txbxContent')):
            content=''.join(box.itertext())
            for paragraph in list(box.findall(W+'p')):
                text=''.join(n.text or '' for n in paragraph.iter(W+'t')).strip()
                if text!='{{ISSUER_RU}}':continue
                if tid=='pb-card':box.remove(paragraph)
                else:
                    for child in list(paragraph):
                        if child.tag!=W+'pPr':paragraph.remove(child)
                    E.SubElement(E.SubElement(paragraph,W+'r'),W+'br')
            if tid=='pb-card' and '{{FULL_NAME' in content:move_box(box,8)
            if tid=='ps-card' and 'Повторная проверка' in content:move_box(box,6)
        frames=[]
        for frame in list(tree.iter(V+'rect')):
            style=frame.get('style','')
            if value(style,'width')<400 or value(style,'height')<100:continue
            if frame.get('fillcolor'):continue
            frames.append(frame)
        for index,frame in enumerate(frames):
            style=frame.get('style','')
            style=put(style,'margin-left',value(style,'margin-left')+.5)
            style=put(style,'margin-top',value(style,'margin-top')+.5)
            style=put(style,'width',value(style,'width')-1)
            style=put(style,'height',13)
            style=re.sub(r'z-index:-?\d+','z-index:251710500',style)
            paragraph=next(n for n in frame.iterancestors() if n.tag==W+'p')
            rect=E.SubElement(E.SubElement(E.SubElement(paragraph,W+'r'),W+'pict'),V+'rect',id=f'IssuerStrip_{index}',style=style,filled='t',stroked='f',fillcolor='#d8d8d8')
            textbox=E.SubElement(rect,V+'textbox',inset='5pt,1pt,5pt,1pt')
            body=E.SubElement(textbox,W+'txbxContent');p=E.SubElement(body,W+'p');pr=E.SubElement(p,W+'pPr')
            E.SubElement(pr,W+'spacing',{W+'before':'0',W+'after':'0',W+'line':'180',W+'lineRule':'exact'});E.SubElement(pr,W+'jc',{W+'val':'center'})
            r=E.SubElement(p,W+'r');rp=E.SubElement(r,W+'rPr');E.SubElement(rp,W+'rFonts',{W+'ascii':'Liberation Serif',W+'hAnsi':'Liberation Serif',W+'cs':'Liberation Serif'});E.SubElement(rp,W+'sz',{W+'val':'16'});E.SubElement(r,W+'t').text='{{ISSUER_BOTH}}'
        assert frames,'ISSUER_BAND_FRAME_MISSING'
        files['word/document.xml']=E.tostring(tree,xml_declaration=True,encoding='utf-8')
        output=directory/(tid+'.v10.docx');deterministic_zip(output,normalize_package(files));before=hashlib.sha256(source.read_bytes()).hexdigest()
        template.update(version=10,file=output.name,sha256=hashlib.sha256(output.read_bytes()).hexdigest(),previousTemplateSha256=before)
        template['fields']=sorted(set(template['fields'])|{'ISSUER_BOTH'})
        report.append({'template':tid,'issuerBands':len(frames),'fontPt':8,'heightPt':13,'content':'issuer.nameRu / issuer.nameKz','bounds':'inside original black frame','outerFrameGeometry':'unchanged','previousSha256':before,'sha256':template['sha256']})
        target=archive/source.name
        if source.parent==directory:
            if target.exists():assert target.read_bytes()==source.read_bytes();source.unlink()
            else:source.rename(target)
    (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    (directory/'v10-changes.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')


if __name__=='__main__':main()
