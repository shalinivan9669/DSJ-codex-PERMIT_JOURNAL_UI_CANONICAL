"""Word-native issuer bands and removal of orphaned legacy picture containers."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
from zipfile import ZipFile
from lxml import etree as E
from package_xml import normalize_package
from sanitize_templates import deterministic_zip
from upgrade_templates_v10 import W,V,value,put,move_box

ROOT=Path(__file__).resolve().parents[2]
MC='{http://schemas.openxmlformats.org/markup-compatibility/2006}'
A='{http://schemas.openxmlformats.org/drawingml/2006/main}'
WP='{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
WPS='{http://schemas.microsoft.com/office/word/2010/wordprocessingShape}'


def text_body():
    body=E.Element(W+'txbxContent');p=E.SubElement(body,W+'p');pr=E.SubElement(p,W+'pPr')
    E.SubElement(pr,W+'spacing',{W+'before':'0',W+'after':'0',W+'line':'180',W+'lineRule':'exact'});E.SubElement(pr,W+'jc',{W+'val':'center'})
    r=E.SubElement(p,W+'r');rp=E.SubElement(r,W+'rPr');E.SubElement(rp,W+'rFonts',{W+'ascii':'Liberation Serif',W+'hAnsi':'Liberation Serif',W+'cs':'Liberation Serif'});E.SubElement(rp,W+'sz',{W+'val':'16'});E.SubElement(r,W+'t').text='{{ISSUER_BOTH}}'
    return body


def band(frame,index):
    alternate=next(n for n in frame.iterancestors() if n.tag==MC+'AlternateContent')
    clone=deepcopy(alternate)
    anchor=next(clone.iter(WP+'anchor'));anchor.set('relativeHeight',str(251710500+index));anchor.set('behindDoc','0')
    for axis in ['H','V']:
        offset=anchor.find(WP+'position'+axis+'/'+WP+'posOffset');offset.text=str(int(offset.text)+6350)
    extent=anchor.find(WP+'extent');extent.set('cx',str(int(extent.get('cx'))-12700));extent.set('cy',str(13*12700))
    props=anchor.find(WP+'docPr');props.set('id',str(900000000+index));props.set('name',f'IssuerStrip_{index}')
    for node in anchor.iter():
        if E.QName(node).localname in ['anchorId','editId']:continue
        for key in list(node.attrib):
            if E.QName(key).localname in ['anchorId','editId']:node.set(key,hashlib.sha256(f'issuer:{index}:{node.get(key)}'.encode()).hexdigest()[:8].upper())
    shape=next(anchor.iter(WPS+'wsp'));shape.find(WPS+'cNvSpPr').set('txBox','1')
    sp=shape.find(WPS+'spPr');transform=sp.find(A+'xfrm/'+A+'ext');transform.set('cx',extent.get('cx'));transform.set('cy',extent.get('cy'))
    for node in list(sp):
        if node.tag in [A+'noFill',A+'solidFill',A+'ln',A+'extLst']:sp.remove(node)
    fill=E.SubElement(sp,A+'solidFill');E.SubElement(fill,A+'srgbClr',val='D8D8D8');E.SubElement(E.SubElement(sp,A+'ln'),A+'noFill')
    bodypr=shape.find(WPS+'bodyPr');bodypr.set('lIns','63500');bodypr.set('rIns','63500');bodypr.set('tIns','12700');bodypr.set('bIns','12700')
    textbox=E.Element(WPS+'txbx');textbox.append(text_body());shape.insert(shape.index(bodypr),textbox)
    rect=next(clone.iter(V+'rect'));style=rect.get('style','')
    style=put(style,'margin-left',value(style,'margin-left')+.5);style=put(style,'margin-top',value(style,'margin-top')+.5);style=put(style,'width',value(style,'width')-1);style=put(style,'height',13)
    style=re.sub(r'z-index:-?\d+',f'z-index:{251710500+index}',style)
    rect.set('style',style);rect.set('id',f'IssuerStrip_{index}');rect.set('filled','t');rect.set('stroked','f');rect.set('fillcolor','#d8d8d8')
    for node in list(rect):rect.remove(node)
    E.SubElement(rect,V+'textbox',inset='5pt,1pt,5pt,1pt').append(text_body())
    alternate.addnext(clone)


def main():
    directory=ROOT/'assets/templates';archive=ROOT/'docs/evidence/commercial-acceptance/printing/historical-inputs'
    manifest=json.loads((directory/'manifest.json').read_text(encoding='utf8'));report=[]
    cards=['biot-worker-card','ptm-card','pb-card','ps-card']
    for template in manifest['templates']:
        tid=template['id']
        if tid not in cards+['biot-itr-certificate','ps-witness']:continue
        previous=directory/template['file'];before=hashlib.sha256(previous.read_bytes()).hexdigest()
        source=archive/(tid+'.v9.docx') if tid in cards else previous
        with ZipFile(source) as z:files={n:z.read(n) for n in z.namelist()}
        tree=E.fromstring(files['word/document.xml']);frames=[]
        if tid in cards:
            for box in list(tree.iter(W+'txbxContent')):
                content=''.join(box.itertext())
                for paragraph in list(box.findall(W+'p')):
                    text=''.join(n.text or '' for n in paragraph.iter(W+'t')).strip()
                    if text!='{{ISSUER_RU}}':continue
                    if tid=='pb-card' and '{{FULL_NAME' not in content:continue
                    if tid=='pb-card':box.remove(paragraph)
                    else:
                        for child in list(paragraph):
                            if child.tag!=W+'pPr':paragraph.remove(child)
                        E.SubElement(E.SubElement(paragraph,W+'r'),W+'br')
                if tid=='pb-card' and '{{FULL_NAME' in content:move_box(box,8)
                if tid=='ps-card' and 'Повторная проверка' in content:move_box(box,9)
                if tid in ['biot-worker-card','ps-card'] and '{{SUBJECT}}' in content and '{{FULL_NAME' not in content:move_box(box,8)
            for node in tree.iter(W+'t'):
                if node.text:node.text=node.text.replace('КУƏЛІГІ','КУӘЛІГІ')
            for frame in list(tree.iter(V+'rect')):
                style=frame.get('style','')
                if value(style,'width')>400 and value(style,'height')>100 and not frame.get('fillcolor'):frames.append(frame)
            for index,frame in enumerate(frames):band(frame,index)
        files['word/document.xml']=E.tostring(tree,xml_declaration=True,encoding='utf-8')
        output=directory/(tid+'.v11.docx');deterministic_zip(output,normalize_package(files))
        template.update(version=11,file=output.name,sha256=hashlib.sha256(output.read_bytes()).hexdigest(),previousTemplateSha256=before)
        with ZipFile(output) as z:alltext=''.join(''.join(E.fromstring(z.read(n)).itertext()) for n in z.namelist() if n.endswith('.xml'))
        template['fields']=sorted(set(re.findall(r'\{\{([A-Z0-9_]+)\}\}',alltext)))
        report.append({'template':tid,'issuerBands':len(frames),'fontPt':8 if frames else None,'outerFrameGeometry':'unchanged','previousSha256':before,'sha256':template['sha256'],'package':'orphaned source pictures removed'})
        target=archive/previous.name
        if target.exists():assert target.read_bytes()==previous.read_bytes();previous.unlink()
        else:previous.rename(target)
    (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    (directory/'v11-changes.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')


if __name__=='__main__':main()
