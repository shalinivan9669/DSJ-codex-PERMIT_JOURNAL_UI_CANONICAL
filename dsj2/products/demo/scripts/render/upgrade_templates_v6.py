"""Readable static captions in five historical forms; preserve original geometry."""
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
TARGETS={'biot-worker-card':5,'ptm-card':4,'pb-card':5,'ps-card':5,'ps-witness':5}


def rebuild_box(box, lines):
    for node in list(box):box.remove(node)
    for index,line in enumerate(lines):
        p=E.SubElement(box,W+'p');pr=E.SubElement(p,W+'pPr');E.SubElement(pr,W+'spacing',{W+'before':'0',W+'after':'0',W+'line':'180',W+'lineRule':'exact'})
        E.SubElement(pr,W+'ind',{W+'left':'0',W+'right':'0',W+'firstLine':'0'})
        run=E.SubElement(p,W+'r');rp=E.SubElement(run,W+'rPr');E.SubElement(rp,W+'rFonts',{W+'ascii':'Liberation Serif',W+'hAnsi':'Liberation Serif',W+'cs':'Liberation Serif'});E.SubElement(rp,W+'sz',{W+'val':'16'});E.SubElement(rp,W+'szCs',{W+'val':'16'})
        if index==0:E.SubElement(rp,W+'b')
        E.SubElement(run,W+'t').text=line


def main():
    directory=ROOT/'assets/templates';archive=ROOT/'docs/evidence/commercial-acceptance/printing/historical-inputs';archive.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((directory/'manifest.json').read_text(encoding='utf8'));changes={}
    for template in manifest['templates']:
        tid=template['id']
        if tid not in TARGETS:continue
        oldname=f'{tid}.v{TARGETS[tid]}.docx';source=directory/oldname
        if not source.exists():source=archive/oldname
        with ZipFile(source) as z:files={n:z.read(n) for n in z.namelist()}
        tree=E.fromstring(files['word/document.xml']);removed=0;rebuilt=0;resized=0
        for box in list(tree.iter(W+'txbxContent')):
            value=''.join(n.text or '' for n in box.iter(W+'t'))
            if tid=='ps-card' and 'Повторная проверка' in value and '{{' not in value:
                one=['Мамандығы / Профессия, разряд: __________________', 'Хаттама / Протокол № ____ от «___» ______ 20__ г.', 'Комиссия төрағасы / Председатель комиссии', '____________________  Қолы / Подпись', 'Комиссия мүшесі / Член комиссии', '____________________  Қолы / Подпись  М.О. / М.П.']
                rebuild_box(box,['Қайтадан тексеру / Повторная проверка',*one,'',*one]);rebuilt+=1
            elif tid=='biot-worker-card' and 'Сведения о' in value and 'повторной сдаче экзаменов' in value and '{{' not in value:
                rebuild_box(box,['Емтиханды қайта тапсырғаны туралы мәліметтер','Сведения о повторной сдаче экзаменов','Лауазымы / Должность: __________________','Жұмыс орны / Место работы: ______________','Бойынша емтихан тапсырғаны туралы берілді','В том, что он сдал экзамены на знание: __________','Негіздеме / Основание: хаттама / протокол','№ ______ от «___» ______ 20__ г.','Емтихан комиссиясының төрағасы /','Председатель экзаменационной комиссии','__________________  Т.А.Ә. / Ф.И.О.','Комиссия мүшесі / Член комиссии','__________________  Т.А.Ә. / Ф.И.О.   М.О. / М.П.']);rebuilt+=1
        for p in tree.iter(W+'p'):
            nodes=p.xpath('./w:r/w:t',namespaces={'w':W[1:-1]});value=''.join(n.text or '' for n in nodes).strip()
            if value=='{{ISSUER_RU}}' and not any(n.tag==W+'txbxContent' for n in p.iterancestors()):
                # Decorative stripe outside populated panels repeated the same name
                # at 4–5pt. Keep its vector frame; retain the readable panel issuer.
                for node in nodes:node.text=''
                removed+=1;continue
            for run in p.findall(W+'r'):
                if not any((n.text or '').strip() for n in run.findall(W+'t')):continue
                rp=run.find(W+'rPr')
                if rp is None:rp=E.Element(W+'rPr');run.insert(0,rp)
                for key in ['sz','szCs']:
                    size=rp.find(W+key)
                    if size is not None and float(size.get(W+'val','16'))<16:size.set(W+'val','16');resized+=1
        files['word/document.xml']=E.tostring(tree,xml_declaration=True,encoding='utf8')
        output=directory/(tid+'.v6.docx');deterministic_zip(output,files)
        template.update(version=6,file=output.name,sha256=hashlib.sha256(output.read_bytes()).hexdigest(),previousTemplateSha256=hashlib.sha256(source.read_bytes()).hexdigest())
        changes[tid]={'removedDecorativeDuplicateIssuerParagraphs':removed,'rebuiltRepeatPanels':rebuilt,'fontAttributesRaisedTo8pt':resized,'sheetAndFrameGeometry':'preserved'}
        target=archive/oldname
        if source.parent==directory:
            if target.exists():assert target.read_bytes()==source.read_bytes();source.unlink()
            else:source.rename(target)
    (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    (directory/'v6-changes.json').write_text(json.dumps(changes,ensure_ascii=False,indent=2)+'\n',encoding='utf8')


if __name__=='__main__':main()
