"""One-time, explicit template migration. No runtime dependency on legacy files.

Invocation requires a source directory; releases consume only resulting assets.
Retains page/section/table/shape geometry. Removes ALL embedded source images,
external relationships and sample values, including hidden alternative content.
"""
import hashlib
import json
import re
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
from lxml import etree as E
from ooxml import replace_fields, extract_merge_field_name

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
NS = {'w': W[1:-1]}
ROOT = Path(__file__).resolve().parents[2]
TEMPLATE_VERSION=4
FIELD_MAP = {
 'Берілді':'FULL_NAME_KZ','ФИО':'FULL_NAME_RU','Full_Name':'FULL_NAME_RU',
 'Выдано_ФИО':'FULL_NAME_BOTH','Должность':'POSITION_RU','Лауазымы':'POSITION_KZ',
 'должность':'POSITION_BOTH','Жұмыс__орны_':'WORKPLACE_KZ','Жұмыс_орны':'WORKPLACE_KZ',
 'Место_работы__':'WORKPLACE_RU','Место_работы':'WORKPLACE_RU','Жұмыс_орны_лауазымы':'WORKPLACE_BOTH',
 'Номер_удостоверения':'NUMBER','"Номер_удостоверения"':'NUMBER','Номер_Уд_1':'NUMBER',
 'Протокол_':'PROTOCOL_NUMBER','ГОД':'PROTOCOL_YEAR','Год':'DOCUMENT_YEAR','День_месяц':'PROTOCOL_DAY_MONTH',
 'В_том_что_он':'SUBJECT','В_том_что':'SUBJECT','Прослушала_курс':'SUBJECT','Емтихан_тапсырды':'SUBJECT',
 'Действительно_Год':'VALID_YEAR','Действительно_Мес':'VALID_DAY_MONTH',
 'Месяц':'DOCUMENT_DAY_MONTH','"Месяц"':'DOCUMENT_MONTH','День':'DOCUMENT_DAY',
 'Номер_серии':'SERIES','Біліктілік_берілгендігі_туралы':'POSITION_KZ',
 'в_том_что_ему_присвоена_квалификация_':'POSITION_RU','Оценка':'RESULT','Баға':'RESULT',
 'M_1__пп':'ONE','M_2__пп':'TWO','M_1_Наименование_дисциплины':'SUBJECT',
 'M_1_Пәндер_атауы_':'SUBJECT','M_2_Наименование_дисциплины':'SUBJECT','M_2_Пәндер_атауы_':'SUBJECT',
}
SOURCES = {
 'biot-worker-card':'biot/biot-card-template.docx','biot-itr-certificate':'biot/biot-itr-certificate-template.docx',
 'biot-protocol':'biot/biot-protocol-template.docx','ptm-card':'ptm/ptm-card-template.docx',
 'ptm-protocol':'ptm/ptm-protocol-template.docx','pb-card':'pb/pb-card-template.docx',
 'pb-protocol':'pb/pb-protocol-template.docx','ps-card':'ps/ps-card-template.docx',
 'ps-protocol':'ps/ps-protocol-template.docx','ps-witness':'ps/ps-witness-certificate-template.docx',
}

def replace_text_nodes(nodes, pattern, replacement):
    """Replace across split runs without collapsing unrelated runs/shape geometry."""
    text = ''.join(n.text or '' for n in nodes)
    for m in list(re.finditer(pattern, text, flags=re.I))[::-1]:
        start, end = m.span(); offset = 0
        for n in nodes:
            s=n.text or ''; a,b=offset,offset+len(s); offset=b
            if b<=start or a>=end: continue
            left=max(0,start-a); right=min(len(s),end-a)
            n.text=s[:left]+(replacement if a<=start<b else '')+s[right:]

def deterministic_zip(path, files):
    with ZipFile(path,'w',ZIP_DEFLATED) as z:
        for name,data in sorted(files.items()):
            info=ZipInfo(name,(2000,1,1,0,0,0)); info.compress_type=ZIP_DEFLATED
            z.writestr(info,data)

def sanitize(source, name):
    with ZipFile(source) as z: files={n:z.read(n) for n in z.namelist() if not n.startswith(('word/media/','customXml/','word/embeddings/','docProps/thumbnail'))}
    for filename,data in list(files.items()):
        if not filename.endswith(('.xml','.rels')): continue
        tree=E.fromstring(data)
        if filename.startswith('docProps/'):
            for n in tree.iter():
                if len(n)==0 and n.text: n.text=''
        if filename.endswith('.rels'):
            for n in list(tree):
                if n.get('TargetMode')=='External' or any(s in n.get('Type','') for s in ['/image','/oleObject','/customXml','/attachedTemplate']): tree.remove(n)
        else:
            for node in list(tree.iter()):
                local=E.QName(node).localname
                if local in ['imagedata','blip','binData','OLEObject','mailMerge','docVars','object']:
                    parent=node.getparent()
                    if parent is not None:
                        # Remove image-only shapes; preserve text-bearing vector shapes.
                        target=parent if E.QName(parent).localname in ['shape','pic','drawing'] and not parent.findall('.//'+W+'t') else node
                        if target.getparent() is not None: target.getparent().remove(target)
            # Fields can span instruction runs. The proven source helper handles this.
            names=set()
            for parent in tree.iter():
                instruction=''; active=False
                for child in parent:
                    if child.tag!=W+'r': continue
                    fc=child.find(W+'fldChar')
                    typ=fc.get(W+'fldCharType') if fc is not None else None
                    if typ=='begin': instruction=''; active=True
                    if active: instruction+=''.join(child.itertext()) if child.find(W+'instrText') is not None else ''
                    if typ in ['separate','end'] and active:
                        field=extract_merge_field_name(' '.join(instruction.split()))
                        if field: names.add(field)
                        active=False
            if names:
                mapping={n:'{{'+FIELD_MAP.get(n,'EMPTY')+'}}' for n in names}
                if name=='pb-card': mapping['Месяц']='{{DOCUMENT_MONTH}}'
                if name in ['ptm-card','pb-card']: mapping['ФИО']='{{FULL_NAME_BOTH}}'
                tree=E.fromstring(replace_fields(E.tostring(tree),mapping))
            for n in list(tree.iter()):
                if E.QName(n).localname in ['fldChar','instrText'] and n.getparent() is not None: n.getparent().remove(n)
            replacements=[
                (r'ТОО\s+Аттестац\b',''),
                (r'(?:ТОО\s*[«"]?\s*)?Аттестационный\s+центр\s+Стандарт[»"]?(?:\s*ЖШС)?','{{ISSUER_RU}}'),
                (r'[CС]олтанова\s*Н\.?\s*Н\.?','{{CHAIR}}'),
                (r'(?:Флеглер\s*А\.?\s*[СТ]\.?|Жакибеков\s*А\.?\s*Т\.?)','{{MEMBER_1}}'),
                (r'(?:Есен\s*Д\.?\s*А\.?|Баянов\s*Ф\.?)','{{MEMBER_2}}'),
                (r'\b(?:хорошо|жақсы|жаксы)\b','{{RESULT}}'),
                (r'(?:Прошел\s*/\s*Өтті|Өтті\s*/\s*прошел)','{{RESULT}}'),
                (r'периодическая\s*/\s*мерзімді','{{REASON}}'),
                (r'Тапсырды\s*/\s*сдал','{{RESULT}}'),
                (r'Жоғары\s*/\s*высшее','{{EDUCATION}}'),
                (r'10-часовой','{{HOURS}}-часовой'),
                (r'10\s+сағаттық','{{HOURS}} сағаттық'),
                (r'ТОО\s+QNP\s+Solutions','{{WORKPLACE_RU}}'),
                (r'Кала/город:\s*Астана','Қала/город: {{CITY_RU}}'),
                (r'(?:город\s+Астана|Астана\s+қаласы)','{{CITY_RU}}'),
                (r'24\s+марта\s+2026\s*г\.','{{DOCUMENT_DATE}}'),
                (r'БТ-СРТ-00001','{{NUMBER}}'),
                (r'Успешно\s+закончил\(а\)\s+программу\s+обучения\s+по\s+курсу','Результат обучения: {{RESULT}}. Курс'),
                (r'курсы бойынша оқу бағдарламасын сәтті аяқтады','курсы. Нәтиже: {{RESULT}}'),
                (r'«18»\s+қараша\s+2025\s+ж\.\s+«18»\s+ноября\s+2025\s+г\.','{{PROTOCOL_DATE}}'),
                (r'«13»\s+қараша\s+2025\s+г\.\s*«13»\s+ноября\s+2025\s+г\.','{{PROTOCOL_DATE}}'),
                (r'«19»\s+(?:ноября|қараша)\s+2025\s+(?:г|ж)\.','{{PROTOCOL_DATE}}'),
                (r'22\.12\.2025\s*г\.','{{PROTOCOL_DATE}}'),
            ]
            for p in tree.iter(W+'p'):
                # Only runs in this paragraph, never nested text boxes in parent paragraph.
                nodes=p.xpath('./w:r/w:t | ./w:hyperlink/w:r/w:t',namespaces=NS)
                if not nodes: continue
                for pattern,replacement in replacements: replace_text_nodes(nodes,pattern,replacement)
                text=''.join(n.text or '' for n in nodes)
                if text.count('{{ISSUER_RU}}')>1:
                    nodes[0].text='{{ISSUER_RU}}'
                    for n in nodes[1:]:n.text=''
                    text='{{ISSUER_RU}}'
                if name=='ptm-card':
                    text=text.replace('{{VALID_DAY_MONTH}}{{DOCUMENT_DAY_MONTH}}','{{VALID_DAY_MONTH}}')
                    if 'дейін жарамды' in text: text=text.replace('{{DOCUMENT_DAY_MONTH}}','{{VALID_DAY_MONTH}}')
                    if 'Основание:' in text or 'Негіздеме:' in text: text=text.replace('{{DOCUMENT_YEAR}}','{{PROTOCOL_YEAR}}').replace('{{DOCUMENT_DAY_MONTH}}','{{PROTOCOL_DAY_MONTH}}')
                    if text!=''.join(n.text or '' for n in nodes):
                        nodes[0].text=text
                        for n in nodes[1:]: n.text=''
                # Every historical commission approval/order paragraph becomes an explicit profile value.
                if re.search(r'02-П|03-П|04-П|приказа|бұйрық|«09»\s+ақпан\s+2026',text,re.I):
                    nodes[0].text='{{APPROVAL_BASIS}}'
                    for n in nodes[1:]: n.text=''
                # Any historic title of a commission member is part of the versioned profile.
                text=''.join(n.text or '' for n in nodes)
                if any(t in text for t in ['{{CHAIR}}','{{MEMBER_1}}','{{MEMBER_2}}']) and any(t in text for t in ['Директор {{ISSUER','директор {{ISSUER','Начальник УМО','Преподаватель {{ISSUER']):
                    placeholder=next(t for t in ['{{CHAIR}}','{{MEMBER_1}}','{{MEMBER_2}}'] if t in text)
                    nodes[0].text=placeholder
                    for n in nodes[1:]: n.text=''
            # Versioned open fonts, not local Microsoft font availability.
            for n in tree.iter():
                if E.QName(n).localname=='rFonts':
                    values=' '.join(n.attrib.values())
                    family='Liberation Serif' if any(s in values for s in ['Times','Cambria','Serif']) else 'Liberation Mono' if 'Courier' in values else 'Liberation Sans'
                    for key in list(n.attrib):
                        if E.QName(key).localname.endswith('Theme'): del n.attrib[key]
                    for key in ['ascii','hAnsi','eastAsia','cs']:n.set(W+key,family)
                for k,v in list(n.attrib.items()):
                    if E.QName(k).localname=='gfxdata':
                        del n.attrib[k];continue
                    if E.QName(k).localname in ['descr','title','author']: n.set(k,'')
                    elif v in ['Times New Roman','TimesNewRomanPSMT']: n.set(k,'Liberation Serif')
                    elif v in ['Arial','Calibri','Aptos']: n.set(k,'Liberation Sans')
                    elif any(x in v for x in ['Стандарт','Солтанова','Флеглер','Есен Д.','Баянов','Жакибеков']): n.set(k,'')
                    elif E.QName(k).localname=='typeface' and v:n.set(k,'Liberation Serif' if 'Cambria' in v else 'Liberation Sans')
            if re.match(r'word/(?:header|footer)\d*\.xml',filename):
                texts=list(tree.iter(W+'t'))
                for n in texts: n.text=''
                if texts: texts[0].text='{{ISSUER_RU}} · {{ADDRESS_RU}}'
            if filename=='word/fontTable.xml':
                tree=E.Element(W+'fonts',nsmap={'w':W[1:-1]})
                for family in ['Liberation Serif','Liberation Sans','Liberation Mono']:E.SubElement(tree,W+'font',{W+'name':family})
        files[filename]=E.tostring(tree,xml_declaration=True,encoding='utf-8')
    output=ROOT/'assets/templates'/f'{name}.v{TEMPLATE_VERSION}.docx'; deterministic_zip(output,files)
    tree=E.fromstring(files['word/document.xml'])
    text=''.join(''.join(E.fromstring(data).itertext()) for filename,data in files.items() if filename.endswith('.xml'))
    forbidden=re.findall(r'Стандарт|Солтанова|Флеглер|Баянов|Жакибеков|Есен Д\.|ТОО\s+Аттестац',text)
    if forbidden: raise ValueError((name,forbidden))
    sections=[dict(n.attrib) for n in tree.iter(W+'pgSz')]
    return {'id':name,'version':TEMPLATE_VERSION,'file':output.name,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'fields':sorted(set(re.findall(r'\{\{([A-Z0-9_]+)\}\}',text))),'sections':sections,'languages':['ru','kk'],'photo':name in ['ptm-card','pb-card','ps-card'],'exports':['DOCX','PDF'],'sample':f'docs/evidence/render/{name}.pdf','protocolSemantics':'individual' if 'protocol' in name else None,'legalApproval':'REQUIRED_BY_ISSUER','sourceImagesRemoved':True}

if __name__=='__main__':
    source=Path(sys.argv[1]).resolve()
    manifest={'version':1,'rendererVersion':'demo-ooxml-1','templates':[sanitize(source/relative,name) for name,relative in SOURCES.items()]}
    (ROOT/'assets/templates/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'templates':len(manifest['templates'])}))
