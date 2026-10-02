"""Build new DEMO versions from the retained March 2026 DSJ originals.

Source bytes and older releases are never rewritten.  This is a build tool,
not a runtime dependency on the frozen DSJ workspace.  The template package
records every deliberate deviation: dynamic fields, equivalent bundled fonts,
and former issuer artwork replaced inside its original image coordinates.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
import hashlib
import io
import json
from pathlib import Path
import re
from zipfile import ZipFile

from lxml import etree as E
from PIL import Image
from package_xml import normalize_package
from sanitize_templates import FIELD_MAP, SOURCES, deterministic_zip, replace_text_nodes

ROOT = Path(__file__).resolve().parents[2]
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
NS = {'w': W[1:-1]}
METADATA_PART = 'demo/original-form.json'
EXTRA_FIELDS = {
    'ФИО_1': 'FULL_NAME_BOTH', 'ФИО_РУС_1': 'FULL_NAME_BOTH',
    'Наименование_организации_1': 'WORKPLACE_BOTH', 'Организация_РУС_1': 'WORKPLACE_BOTH',
    'Должность_1': 'POSITION_BOTH', 'ДОЛЖНОСТЬ_РУС_1': 'POSITION_BOTH',
    'Должность_РУС_1': 'POSITION_BOTH', 'Образование_РУС_1': 'EDUCATION',
    'Примечание_1': 'BIOT_NOTES',
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def plain_text(element):
    return ''.join(n.text or '' for n in element.iter(W+'t'))


def set_paragraph(paragraph, value):
    nodes = paragraph.xpath('./w:r/w:t | ./w:hyperlink/w:r/w:t', namespaces=NS)
    if not nodes:
        nodes = [E.SubElement(E.SubElement(paragraph, W+'r'), W+'t')]
    nodes[0].text = value
    for node in nodes[1:]: node.text = ''


def replace_merge_fields(tree, template_id):
    """Replace cached merge values in place; retain source runs and geometry."""
    mapping = {**FIELD_MAP, **EXTRA_FIELDS}
    for field in list(tree.iter(W+'fldSimple')):
        match=re.match(r'\s*MERGEFIELD\s+("[^"]+"|[^\s\\]+)',field.get(W+'instr',''))
        if match:
            key=mapping.get(match[1].strip('"'))
            if key is None:raise ValueError('SOURCE_FIELD_UNMAPPED:'+match[1])
            texts=list(field.iter(W+'t'))
            if texts:
                texts[0].text='{{'+key+'}}'
                for text in texts[1:]:text.text=''
            parent=field.getparent();index=parent.index(field)
            for child in list(field):parent.insert(index,child);index+=1
            parent.remove(field)
    for parent in list(tree.iter()):
        children = list(parent)
        index = 0
        while index < len(children):
            child = children[index]
            marker = child.find(W+'fldChar') if child.tag == W+'r' else None
            if marker is None or marker.get(W+'fldCharType') != 'begin':
                index += 1; continue
            end = separate = None
            instruction = ''
            for cursor in range(index+1, len(children)):
                run = children[cursor]
                instruction += ''.join(n.text or '' for n in run.iter(W+'instrText'))
                field = run.find(W+'fldChar')
                if field is not None:
                    kind = field.get(W+'fldCharType')
                    if kind == 'separate': separate = cursor
                    if kind == 'end': end = cursor; break
            if end is None: raise ValueError('SOURCE_FIELD_UNTERMINATED')
            match = re.match(r'\s*MERGEFIELD\s+("[^"]+"|[^\s\\]+)', instruction)
            if match:
                field_name = match[1].strip('"')
                key = mapping.get(field_name)
                if key is None: raise ValueError('SOURCE_FIELD_UNMAPPED:'+field_name)
                if template_id == 'pb-card' and field_name == 'Месяц': key = 'DOCUMENT_MONTH'
                result = children[(separate+1 if separate is not None else index):end]
                texts = [n for run in result for n in run.iter(W+'t')]
                if not texts:
                    run = children[end]
                    texts = [E.SubElement(run, W+'t')]
                texts[0].text = '{{'+key+'}}'
                for node in texts[1:]: node.text = ''
                for run in children[index:end+1]:
                    for node in list(run):
                        if node.tag in [W+'fldChar', W+'instrText']: run.remove(node)
            index = end+1


def roster_slots(tree, template_id):
    if not template_id.endswith('-protocol'): return
    tables = [t for t in tree.iter(W+'tbl') if t.findall(W+'tr')
              and '№' in plain_text(t.findall(W+'tr')[0])]
    if len(tables) != 1: raise ValueError('SOURCE_ROSTER_NOT_UNIQUE')
    table = tables[0]
    count = 2 if template_id.startswith('biot-') else 1
    rows = table.findall(W+'tr')
    slots = {
        'biot-protocol': ['1','{{FULL_NAME_BOTH}}','{{WORKPLACE_BOTH}}','{{POSITION_BOTH}}','{{RESULT}}','{{BIOT_NOTES}}'],
        'biot-itr-protocol': ['1','{{FULL_NAME_BOTH}}','{{WORKPLACE_BOTH}}','{{POSITION_BOTH}}','{{RESULT}}','{{BIOT_NOTES}}'],
        'ptm-protocol': ['1','{{FULL_NAME_BOTH}}','{{POSITION_BOTH}}','{{WORKPLACE_BOTH}}','{{REASON}}','{{RESULT}}',''],
        'pb-protocol': ['1','{{FULL_NAME_BOTH}}','{{POSITION_BOTH}}','{{EDUCATION}}','{{RESULT}}'],
        'ps-protocol': ['1','{{FULL_NAME_BOTH}}','{{RESULT}}','{{RESULT}}','{{RESULT}}','{{POSITION_BOTH}}','{{CREDENTIAL_NUMBER}}'],
    }[template_id]
    cells = rows[count].findall(W+'tc')
    if len(cells) != len(slots): raise ValueError('SOURCE_ROSTER_COLUMNS_CHANGED')
    for cell, value in zip(cells, slots):
        paragraphs = cell.findall(W+'p')
        set_paragraph(paragraphs[0], value)
        for paragraph in paragraphs[1:]: set_paragraph(paragraph, '')
    if count == 2:
        for index,cell in enumerate(rows[1].findall(W+'tc'),1):
            set_paragraph(cell.findall(W+'p')[0],str(index))
    # Sample numbering is not Word automatic list numbering for live rows.
    for row in rows:
        for numbering in row.iter(W+'numId'): numbering.set(W+'val','0')
    for row in rows[:count]:
        props = row.find(W+'trPr')
        if props is None: props = E.Element(W+'trPr'); row.insert(0, props)
        if props.find(W+'tblHeader') is None: E.SubElement(props,W+'tblHeader')


def prepare_original(source, template_id):
    with ZipFile(source) as archive: files = {n:archive.read(n) for n in archive.namelist()}
    dynamic_media = []
    # All nine retained source images were visually inspected. They are former
    # issuer logos, foreign contact details, a stamp and a handwritten signature.
    # Keep each image relationship/anchor and dimensions; never reuse old identity.
    for name, data in list(files.items()):
        if not name.startswith('word/media/'): continue
        with Image.open(io.BytesIO(data)) as image:
            placeholder = Image.new('RGBA', image.size, (255,255,255,0))
            output = io.BytesIO(); placeholder.save(output,'PNG'); files[name] = output.getvalue()
        kind = ('BLANK_SIGNATURE' if template_id == 'ps-witness' else
                'ISSUER_ADDRESS' if template_id in ['pb-protocol','ptm-protocol'] and name.endswith('image1.png') else 'ISSUER')
        dynamic_media.append({'part':name,'kind':kind,'originalSha256':hashlib.sha256(data).hexdigest()})
    replacements = [
        (r'(?:ТОО\s*[«"]?\s*)?Аттестационный\s+центр\s+Стандарт[»"]?(?:\s*ЖШС)?','{{ISSUER_BOTH}}'),
        (r'ТОО\s+Аттестац\b','{{ISSUER_BOTH}}'),
        (r'[CС]олтанова\s*Н\.?\s*Н\.?','{{CHAIR_NAME}}'),
        (r'(?:Флеглер\s*А\.?\s*[СТ]\.?|Жакибеков\s*А\.?\s*Т\.?)','{{MEMBER_1_NAME}}'),
        (r'(?:Есен\s*Д\.?\s*А\.?|Баянов\s*Ф\.?)','{{MEMBER_2_NAME}}'),
        (r'\b(?:хорошо|жақсы|жаксы)\b','{{RESULT}}'),
        (r'(?:Прошел\s*/\s*Өтті|Өтті\s*/\s*прошел|Тапсырды\s*/\s*сдал)','{{RESULT}}'),
        (r'периодическая\s*/\s*мерзімді','{{REASON}}'),
        (r'Жоғары\s*/\s*высшее','{{EDUCATION}}'),
        (r'10-часовой','{{HOURS}}-часовой'), (r'10\s+сағаттық','{{HOURS}} сағаттық'),
        (r'ТОО\s+QNP\s+Solutions','{{WORKPLACE_BOTH}}'),
        (r'Кала/город:\s*Астана','Қала/город: {{CITY_RU}}'),
        (r'24\s+марта\s+2026\s*г\.','{{DOCUMENT_DATE}}'),
        (r'БТ-СРТ-00001','{{NUMBER}}'),
        (r'«18»\s+қараша\s+2025\s+ж\.\s*«18»\s+ноября\s+2025\s+г\.','{{PROTOCOL_DATE}}'),
        (r'«13»\s+қараша\s+2025\s+г\.\s*«13»\s+ноября\s+2025\s+г\.','{{PROTOCOL_DATE}}'),
        (r'«19»\s+(?:ноября|қараша)\s+2025\s+(?:г|ж)\.','{{PROTOCOL_DATE}}'),
        (r'22\.12\.2025\s*г\.','{{PROTOCOL_DATE}}'),
    ]
    for name, data in list(files.items()):
        if not name.endswith(('.xml','.rels')): continue
        tree = E.fromstring(data)
        if name.endswith('.rels'):
            for node in list(tree):
                if node.get('TargetMode') == 'External': tree.remove(node)
        elif name.startswith('word/'):
            replace_merge_fields(tree, template_id)
            for node in list(tree.iter()):
                if E.QName(node).localname in ['mailMerge','docVars'] and node.getparent() is not None:
                    node.getparent().remove(node)
                for key in list(node.attrib):
                    if E.QName(key).localname == 'gfxdata': del node.attrib[key]
            for paragraph in tree.iter(W+'p'):
                nodes = paragraph.xpath('./w:r/w:t | ./w:hyperlink/w:r/w:t',namespaces=NS)
                if not nodes: continue
                for pattern, value in replacements: replace_text_nodes(nodes,pattern,value)
                text = ''.join(n.text or '' for n in nodes)
                if text.count('{{ISSUER_BOTH}}') > 1: set_paragraph(paragraph,'{{ISSUER_BOTH}}')
                if re.search(r'02-П|03-П|04-П|приказа|бұйрық|«09»\s+ақпан\s+2026',text,re.I):
                    set_paragraph(paragraph,'{{APPROVAL_BASIS}}')
                if '{{CHAIR_NAME}}' in text and ('Директор' in text or 'директор' in text):
                    set_paragraph(paragraph,'{{CHAIR}}')
                for member in ['MEMBER_1','MEMBER_2']:
                    if '{{'+member+'_NAME}}' in text and any(s in text for s in ['Начальник','Преподаватель','преподаватель','начальник']):
                        set_paragraph(paragraph,'{{'+member+'}}')
                if template_id.startswith('biot-') and template_id.endswith('-protocol'):
                    if 'Білімін тексеру түрі' in text:set_paragraph(paragraph,'Білімін тексеру түрі: {{BIOT_CHECK_TYPE_KZ}}')
                    elif 'Вид проверки знаний' in text:set_paragraph(paragraph,'Вид проверки знаний: {{BIOT_CHECK_TYPE_RU}}')
                if template_id == 'ps-card':
                    if text.strip() == 'Председатель экзаменационной комиссии':
                        set_paragraph(paragraph,'Председатель экзаменационной комиссии {{CHAIR_NAME}}')
                    elif text.strip().startswith('Члены комиссии'):
                        set_paragraph(paragraph,'Члены комиссии: {{MEMBER_1_NAME}} (Қолы / Подпись)')
                        siblings=list(paragraph.getparent())
                        cursor=siblings.index(paragraph)
                        following=next((p for p in siblings[cursor+1:] if p.tag==W+'p' and 'Қолы / Подпись' in plain_text(p)),None)
                        if following is not None:set_paragraph(following,'{{MEMBER_2_NAME}} (Қолы / Подпись)')
                if re.match(r'word/(?:header|footer)\d*\.xml',name):
                    if 'БИН' in text:set_paragraph(paragraph,'БИН: {{ISSUER_BIN}}')
                    elif any(s in text for s in ['Республика','Қазақстан','Астана ул.','Апет','Пет','офис','100012']):
                        set_paragraph(paragraph,'{{ADDRESS_RU}} / {{ADDRESS_KZ}}')
            # Frozen DATE/NEXT field codes must not refresh a saved issuance date
            # or substitute a former sample row when Word/LibreOffice opens it.
            for node in list(tree.iter()):
                if node.tag in [W+'fldChar',W+'instrText'] and node.getparent() is not None:
                    node.getparent().remove(node)
            for font in tree.iter(W+'rFonts'):
                values = ' '.join(font.attrib.values())
                family = 'Liberation Serif' if any(n in values for n in ['Times','Cambria','Serif']) else 'Liberation Mono' if 'Courier' in values else 'Liberation Sans'
                for key in list(font.attrib):
                    if E.QName(key).localname.endswith('Theme'): del font.attrib[key]
                for key in ['ascii','hAnsi','eastAsia','cs']:font.set(W+key,family)
            if name == 'word/document.xml': roster_slots(tree,template_id)
        elif name.startswith('docProps/'):
            for node in tree.iter():
                if E.QName(node).localname in ['creator','lastModifiedBy','company']: node.text = ''
        files[name] = E.tostring(tree,xml_declaration=True,encoding='utf-8')
    metadata = {'version':1,'sourceSha256':sha(source),'sourceFile':source.name,
                'dynamicMedia':dynamic_media,'layout':'MARCH_2026_ORIGINAL','englishAppendixVersion':1}
    files[METADATA_PART] = json.dumps(metadata,ensure_ascii=False,sort_keys=True).encode('utf-8')
    return normalize_package(files)


def build(source_root, replace_unpublished=False):
    directory = ROOT/'assets/templates'
    manifest_path = directory/'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    source_map = {**SOURCES,'biot-itr-protocol':SOURCES['biot-protocol']}
    report = []
    previous_report = json.loads((directory/'original-form-restoration.json').read_text(encoding='utf-8')) if replace_unpublished else []
    for tid, relative in source_map.items():
        source = source_root/relative; original_hash = sha(source)
        old = next(t for t in manifest['templates'] if t['id']==tid)
        if old['sourceSha256'] != original_hash: raise ValueError('ORIGINAL_HASH_CHANGED:'+tid)
        files = prepare_original(source,tid)
        text = ''.join(''.join(E.fromstring(v).itertext()) for n,v in files.items() if n.endswith('.xml'))
        if re.search(r'Стандарт|Солтанова|Флеглер|Баянов|Жакибеков|QNP|Венцель|Токенов',text):
            raise ValueError('SOURCE_SAMPLE_LEFTOVER:'+tid)
        prior = next((r for r in previous_report if r['id']==tid),None)
        if replace_unpublished and (old.get('formRevision')!='DSJ_MARCH_2026_ORIGINAL' or prior is None):
            raise ValueError('UNPUBLISHED_REBUILD_REQUIRES_OWN_GENERATION')
        version = int(old['version']) if replace_unpublished else int(old['version'])+1
        target = directory/f'{tid}.v{version}.docx'
        if target.exists() and not replace_unpublished: raise ValueError('NEW_VERSION_ALREADY_EXISTS:'+target.name)
        deterministic_zip(target,files)
        updated = deepcopy(old)
        updated.update(version=version,file=target.name,sha256=sha(target),
                       previousTemplateSha256=old['previousTemplateSha256'] if replace_unpublished else old['sha256'],formRevision='DSJ_MARCH_2026_ORIGINAL',
                       fields=sorted(set(re.findall(r'\{\{([A-Z0-9_]+)\}\}',text))),
                       sourceImagesRemoved=False,sourceIdentityImagesReplaced=True,
                       verificationStatus='PENDING_CURRENT_RENDER_REVIEW',
                       restoration={'sourceFile':relative,'sourceSha256':original_hash,
                                    'sourceCommit':'f5c2aab','englishAppendixVersion':1})
        for stale in ['sample','verification','regulatoryReview','historicalTemplate','historicalTemplateSha256']:
            updated.pop(stale,None)
        manifest['templates'][manifest['templates'].index(old)] = updated
        if tid.endswith('-protocol'):
            previous = next(t for t in manifest['groupTemplates'] if t['id']==tid)
            group_version = int(re.search(r'group-v(\d+)',previous['file'])[1])+(0 if replace_unpublished else 1)
            group_target = directory/f'{tid}.group-v{group_version}.docx'
            if group_target.exists() and not replace_unpublished: raise ValueError('NEW_GROUP_VERSION_ALREADY_EXISTS')
            group_target.write_bytes(target.read_bytes())
            group = deepcopy(updated)
            group.update(version=f'{version}-group-1',file=group_target.name,
                         protocolSemantics='GROUP',ownerKind='GROUP',groupContractVersion=1,
                         groupRenderer='group_protocol.py:v1',previousTemplateSha256=previous['previousTemplateSha256'] if replace_unpublished else previous['sha256'])
            manifest['groupTemplates'][manifest['groupTemplates'].index(previous)] = group
        assert sha(source)==original_hash
        report.append({'id':tid,'source':relative,'sourceSha256':original_hash,'previous':prior['previous'] if prior else old['file'],
                       'file':target.name,'sha256':sha(target),'intentionalChanges':[
                           'cached sample values replaced in original field slots',
                           'former issuer logo and contact slots filled at render time',
                           'former handwritten signature and stamp left blank',
                           'equivalent bundled Liberation fonts',
                           'protocol sample row filled and headings repeat for group pagination']})
    manifest['rendererVersion'] = 'demo-ooxml-8/libreoffice-26.2.6.3'
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (directory/'original-form-restoration.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--replace-unpublished',action='store_true',help='Only this build output before provisioning, approval or issuance')
    args=parser.parse_args()
    print(json.dumps(build(args.source,args.replace_unpublished),ensure_ascii=False,indent=2))
