"""Versioned neutral forms. Historical LEGACY_REFERENCE_90D5 stays unchanged."""
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile
from io import BytesIO
from copy import deepcopy
from functools import wraps
from xml.etree import ElementTree as ET
import hashlib,json,re
from lxml import etree as E
from legacy_reference import (legacy_payload, prepare_reference_source, freeze_reference_dates,
    reference_group_item, combine_reference_files, reference_opc_package, reference_package_declarations)
from neutral_identity import slot_replacements,slot
from sanitize_templates import deterministic_zip
POLICY='NEUTRAL_FORMS_V1'
ROOT=Path(__file__).resolve().parent
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'

def isolated_namespaces(function):
    """Keep new form bytes independent of earlier jobs in the same process.

    The pinned helpers use ElementTree's process-wide prefix registry. New
    photo relationships need a stable prefix even when a sanitized source has
    no relationships left. Restore the registry so old render paths retain
    their previous behaviour; never patch the historical helper itself.
    """
    @wraps(function)
    def wrapped(*args, **kwargs):
        previous = ET._namespace_map.copy()
        try:
            ET.register_namespace('r', R[1:-1])
            return function(*args, **kwargs)
        finally:
            ET._namespace_map.clear()
            ET._namespace_map.update(previous)
    return wrapped

def fill_slots(files,payload,path):
    from legacy_reference import source_literal_values
    digest=hashlib.sha256(Path(path).read_bytes()).hexdigest()
    entries=json.loads((ROOT/'neutral_forms_sources.json').read_text(encoding='utf8'))['templates']
    entry=next(t for t in entries if t['sha256']==digest)
    values={r['matchText']:r['replaceText'] for r in slot_replacements(payload)}
    # The pinned mapper omits old==new literal replacements. The complete
    # versioned slot schema preserves those legitimate user-entered values.
    replacements=[{'matchText':slot(r),'replaceText':values.get(slot(r),r['matchText'])} for r in entry['slots']]
    return source_literal_values(files,replacements)

def combine_neutral_files(documents,snapshot=None):
    # The legacy assembler understands VML r:id. Temporarily alias DrawingML
    # embeds through that same remapper, restoring valid r:embed afterwards.
    prepared=[]
    bookmark_id=0
    bookmark_names=set()
    for document_index,files in enumerate(documents,1):
        files=dict(files);tree=E.fromstring(files['word/document.xml'])
        # Each recipient retains source bookmarks and the PB commission mark.
        # Their IDs and names must be unique in the assembled document. Remap
        # within this recipient before assembly so internal references follow
        # its own bookmark, without touching individual or group render paths.
        id_map={};name_map={}
        for node in tree.iter(W+'bookmarkStart'):
            old_id=node.get(W+'id');id_map[old_id]=str(bookmark_id)
            node.set(W+'id',str(bookmark_id));bookmark_id+=1
            old_name=node.get(W+'name')
            if old_name:
                new_name=old_name;collision=0
                while new_name in bookmark_names:
                    collision+=1
                    suffix=f'_b{document_index}_{collision}'
                    new_name=old_name[:40-len(suffix)]+suffix
                bookmark_names.add(new_name);name_map[old_name]=new_name
                node.set(W+'name',new_name)
        for node in tree.iter(W+'bookmarkEnd'):
            if node.get(W+'id') in id_map:
                node.set(W+'id',id_map[node.get(W+'id')])
        for node in tree.iter():
            if node.tag==W+'hyperlink' and node.get(W+'anchor') in name_map:
                node.set(W+'anchor',name_map[node.get(W+'anchor')])
            if node.tag==W+'instrText' and re.search(r'\b(?:REF|PAGEREF|NOTEREF)\s',node.text or '',re.I):
                for old_name,new_name in name_map.items():
                    if old_name!=new_name:
                        node.text=re.sub(r'(?<!\w)'+re.escape(old_name)+r'(?!\w)',new_name,node.text)
        if (snapshot or {}).get('templateId')=='ps-witness':
            # The retained witness ends in a redundant next-page section.
            # At document end it is invisible; in a batch it creates a blank
            # page before the assembler's explicit recipient page break.
            body=tree.find(W+'body')
            for child in reversed(list(body)):
                if child.tag==W+'sectPr': continue
                if any((n.text or '').strip() for n in child.iter(W+'t')) or list(child.iter(W+'tbl')): break
                for section in child.iter(W+'sectPr'):
                    kind=section.find(W+'type')
                    if kind is None:kind=E.SubElement(section,W+'type')
                    kind.set(W+'val','continuous')
        for node in tree.iter():
            if node.get(R+'embed'):
                node.set(R+'id',node.attrib.pop(R+'embed'))
        files['word/document.xml']=E.tostring(tree,encoding='utf-8',xml_declaration=True)
        prepared.append(files)
    files=combine_reference_files(prepared)
    tree=E.fromstring(files['word/document.xml'])
    drawing_id=1
    for node in tree.iter():
        if E.QName(node).localname in ['docPr','cNvPr'] and node.get('id'):
            node.set('id',str(drawing_id));drawing_id+=1
        if E.QName(node).localname=='blip' and node.get(R+'id'):
            node.set(R+'embed',node.attrib.pop(R+'id'))
    files['word/document.xml']=E.tostring(tree,encoding='utf-8',xml_declaration=True)
    return files

def identify_neutral(path, template_id):
    registry=ROOT/'neutral_forms_sources.json'
    if not registry.exists(): return False
    digest=hashlib.sha256(Path(path).read_bytes()).hexdigest()
    return any(t['id']==template_id and t['sha256']==digest for t in json.loads(registry.read_text(encoding='utf8'))['templates'])

def neutral_payload(snapshot,item):
    # Every new ITR form prints the frozen selected course, including snapshots
    # which predate explicit language fields. No changes to old snapshot code.
    if snapshot['templateId']=='biot-itr-certificate':
        from legacy_snapshot_fields import bilingual_parts
        a=item['assignment']; ru,kz=bilingual_parts(a.get('trainingSubject'),a.get('trainingSubjectRu'),a.get('trainingSubjectKz'))
        item={**item,'assignment':{**a,'trainingSubject':ru,'trainingSubjectKz':kz}}
    payload=legacy_payload(snapshot,item)
    if snapshot['templateId'] in ['biot-protocol','biot-itr-protocol','pb-protocol','ptm-protocol']:
        workplace=' / '.join(dict.fromkeys(str(item.get(k) or '').strip() for k in ['workplaceRu','workplaceKz'] if str(item.get(k) or '').strip()))
        if snapshot['templateId'].startswith('biot-'):
            payload['fields']['Место_работы__']=workplace
            payload['fields']['Жұмыс__орны_']=workplace
        elif snapshot['templateId']=='pb-protocol':
            payload['fields']['Жұмыс_орны_лауазымы']=workplace
        else:
            payload['fields']['Место_работы']=workplace
            for replacement in payload.get('textReplacements',[]):
                if replacement['matchText']=='ТОО «Аттестационный центр Стандарт» ЖШС':
                    replacement['replaceText']=workplace
    return payload

def fill_files(snapshot,item,path):
    from legacy_reference import source_literal_values
    payload=neutral_payload(snapshot,item)
    with ZipFile(path) as z: files={n:z.read(n) for n in z.namelist()}
    files=fill_slots(files,payload,path)
    # Special witness date slots are corrected before their placeholders fill.
    files=prepare_reference_source(files,snapshot,item,{**payload,'sourceLiteralValues':[]})
    with TemporaryDirectory(prefix='demo-neutral-') as directory:
        source=Path(directory)/'template.docx'; deterministic_zip(source,files)
        if snapshot['templateId']=='ps-witness':
            from generate_ps_witness_certificate import render_document_bytes
            content=render_document_bytes(source,payload['fields'])
        else:
            from generate_biot_card import render
            target=Path(directory)/'filled.docx'
            render(source,target,payload['fields'],payload['photo'],[],payload.get('fieldStyleOverrides',{}))
            content=target.read_bytes()
    with ZipFile(BytesIO(content)) as z: files={n:z.read(n) for n in z.namelist()}
    return freeze_reference_dates(files,snapshot,item)

def repair(files,snapshot):
    from neutral_cards import repair_card_files
    from neutral_certificates import repair_certificate_files
    from neutral_protocols import repair_protocol_files
    try:
        return repair_protocol_files(repair_certificate_files(repair_card_files(files,snapshot),snapshot),snapshot)
    except ValueError as error:
        if str(error).startswith('NEUTRAL_CERTIFICATE_OVERFLOW:'):
            raise ValueError('PRINT_LAYOUT_OVERFLOW') from error
        raise

@isolated_namespaces
def render_neutral_one(snapshot,item,path):
    if not identify_neutral(path,snapshot['templateId']): raise ValueError('NEUTRAL_TEMPLATE_HASH_MISMATCH')
    return repair(fill_files(snapshot,item,path),{**snapshot,'items':[item]})

@isolated_namespaces
def render_neutral_group(snapshot,path):
    from group_protocol import roster_table
    from request_limits import MAX_REQUEST_ROWS
    from generate_biot_card import replace_fields,replace_literal_paragraphs,replace_literal_text_nodes
    from legacy_reference import source_literal_values
    if snapshot.get('groupEvent',{}).get('contractVersion')!=1 or not snapshot['templateId'].endswith('-protocol'): raise ValueError('GROUP_VERSION_UNKNOWN')
    if not 1<=len(snapshot['items'])<=MAX_REQUEST_ROWS: raise ValueError('GROUP_ROW_LIMIT')
    if len({(i['id'],i['assignment']['eventId']) for i in snapshot['items']})!=len(snapshot['items']): raise ValueError('GROUP_DUPLICATE_MEMBER')
    items=[reference_group_item(i) for i in snapshot['items']]; header=items[0]
    workplace=snapshot.get('groupHeaderWorkplace')
    if workplace is not None:
        if snapshot['templateId'] not in ['biot-protocol','biot-itr-protocol','pb-protocol'] or workplace.get('version')!=1 or not all(isinstance(workplace.get(k),str) for k in ['workplaceRu','workplaceKz']): raise ValueError('GROUP_HEADER_WORKPLACE_CONTRACT')
        header={**header,'workplaceRu':workplace['workplaceRu'],'workplaceKz':workplace['workplaceKz']}
    files=fill_files(snapshot,header,path)
    root=E.fromstring(files['word/document.xml']); roster=roster_table(root)
    count=2 if snapshot['templateId'].startswith('biot-') else 1
    for row in roster.findall(W+'tr')[count:]: roster.remove(row)
    with ZipFile(path) as z: source=z.read('word/document.xml')
    for item in items:
        payload=neutral_payload(snapshot,item)
        prepared=fill_slots({'word/document.xml':source},payload,path)['word/document.xml']
        filled=replace_fields(prepared,payload['fields'],payload.get('fieldStyleOverrides',{}))
        filled=freeze_reference_dates({'word/document.xml':filled},snapshot,item)['word/document.xml']
        table=roster_table(E.fromstring(filled)); roster.append(deepcopy(table.findall(W+'tr')[count]))
    files['word/document.xml']=E.tostring(root,encoding='utf-8',xml_declaration=True)
    return repair(files,snapshot)

@isolated_namespaces
def render_neutral_document(snapshot,output,path):
    from request_limits import MAX_REQUEST_ROWS
    if not identify_neutral(path,snapshot['templateId']): raise ValueError('NEUTRAL_TEMPLATE_HASH_MISMATCH')
    if not 1<=len(snapshot['items'])<=MAX_REQUEST_ROWS: raise ValueError('ROW_LIMIT')
    if snapshot.get('groupEvent'): files=render_neutral_group(snapshot,path)
    else:
        documents=[render_neutral_one(snapshot,item,path) for item in snapshot['items']]
        files=documents[0] if len(documents)==1 else combine_neutral_files(documents,snapshot)
    for name,data in files.items():
        if name.startswith('word/') and name.endswith('.xml') and re.search(rb'\{\{N_[a-f0-9]{16}\}\}',data):
            raise ValueError('NEUTRAL_TEMPLATE_SLOT_UNRESOLVED')
    if snapshot.get('demoMode') or snapshot.get('mode')=='draft-preview':
        from source_fidelity import add_floating_mark
        add_floating_mark(files,'ДЕМО — НЕ ЯВЛЯЕТСЯ ВЫДАННЫМ ДОКУМЕНТОМ' if snapshot.get('demoMode') else 'ПРЕДПРОСМОТР — НЕ ЯВЛЯЕТСЯ ВЫДАННЫМ ДОКУМЕНТОМ')
    if snapshot.get('englishAppendix'):
        from english_appendix import append_english_pages
        files=append_english_pages(files,snapshot)
    deterministic_zip(output,reference_package_declarations(reference_opc_package(files),path))
