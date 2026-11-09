"""Prepare immutable form versions from the user's November 2026 archive.

The source archive stays outside the shipped product. Blueprints identify its
exact bytes and editable slots; no source recipients, photos or signatures are
retained. Activation is a separate step after document/render acceptance.
"""
from __future__ import annotations

import argparse
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
from zipfile import ZipFile

from lxml import etree as E
from PIL import Image

from sanitize_templates import deterministic_zip

ROOT = Path(__file__).resolve().parents[2]
POLICY = 'USER_ARCHIVE_20261109_V1'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
NS = {'w': W[1:-1]}
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
PKG = '{http://schemas.openxmlformats.org/package/2006/relationships}'
CT = '{http://schemas.openxmlformats.org/package/2006/content-types}'
MARKER = 'demo/archive-form.json'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def paragraph_text(paragraph):
    return ''.join(paragraph.xpath('./w:r/w:t/text() | ./w:hyperlink/w:r/w:t/text()', namespaces=NS))


def namespaces(root):
    result = dict(NS)
    for node in root.iter():
        for prefix, uri in node.nsmap.items():
            if prefix:
                if prefix in result and result[prefix] != uri:
                    raise ValueError('ARCHIVE_NAMESPACE_REBOUND:'+prefix)
                result[prefix] = uri
    return result


def put_text(paragraph, value):
    """Keep paragraph/run formatting and the original container's geometry."""
    if paragraph.findall('.//'+W+'p'):
        raise ValueError('ARCHIVE_PARAGRAPH_CONTAINS_DRAWING_TEXT')
    nodes = paragraph.xpath('./w:r/w:t | ./w:hyperlink/w:r/w:t | ./w:fldSimple/w:r/w:t', namespaces=NS)
    if not nodes:
        nodes = [E.SubElement(E.SubElement(paragraph, W+'r'), W+'t')]
    nodes[0].text = value
    nodes[0].set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    for node in nodes[1:]:
        node.text = ''
    # A replaced slot must never refresh to the former mail-merge recipient.
    for node in list(paragraph):
        if node.tag == W+'fldSimple':
            index = paragraph.index(node)
            for run in list(node):
                paragraph.insert(index, run)
                index += 1
            paragraph.remove(node)
    for node in list(paragraph.iter()):
        if node.tag in (W+'instrText', W+'fldChar') and node.getparent() is not None:
            node.getparent().remove(node)


def map_field(name, label, blueprint):
    name = name.strip('"')
    mapping = blueprint['mergeFields']
    if name not in mapping:
        raise ValueError('ARCHIVE_UNMAPPED_FIELD:'+blueprint['id']+':'+name)
    key = mapping[name]
    # Source aliases incorrectly reuse issue dates in protocol/expiry bands.
    if 'Лауазымы' in label and name == 'Номер_серии':
        key = 'POSITION_KZ'
    if key.startswith(('DOCUMENT_', 'ISSUE_')):
        if any(word in label for word in ('дейін жарамды', 'Действительно до')):
            key = re.sub(r'^(DOCUMENT|ISSUE)_', 'VALID_', key)
        elif any(word in label for word in ('Основание:', 'Негіздеме:', 'хаттама', 'Протокол №')):
            key = re.sub(r'^(DOCUMENT|ISSUE)_', 'PROTOCOL_', key)
    return '{{'+key+'}}'


def fill_merge_slots(tree, blueprint):
    # Word may put a paragraph break inside a merge result. Process each story
    # independently, so a field can span adjacent paragraphs without consuming
    # fields in an anchored text box or its alternate representation.
    for field in list(tree.iter(W+'fldSimple')):
        instruction = field.get(W+'instr', '').strip()
        match = re.match(r'MERGEFIELD\s+("[^"]+"|[^\s\\]+)', instruction, re.I)
        if not match:
            if instruction.upper().startswith('NEXT'):
                field.getparent().remove(field)
                continue
            raise ValueError('ARCHIVE_UNMAPPED_SIMPLE_FIELD:'+instruction)
        paragraph = next(field.iterancestors(W+'p'))
        texts = list(field.iter(W+'t'))
        if not texts:
            texts = [E.SubElement(E.SubElement(field, W+'r'), W+'t')]
        texts[0].text = map_field(match[1], paragraph_text(paragraph), blueprint)
        for node in texts[1:]:
            node.text = ''
        parent = field.getparent()
        index = parent.index(field)
        for run in list(field):
            parent.insert(index, run)
            index += 1
        parent.remove(field)
    stories = [tree, *list(tree.iter(W+'txbxContent'))]
    for story in stories:
        runs = [run for run in story.iter(W+'r')
                if next(run.iterancestors(W+'txbxContent'), tree) is story]
        active = None
        for run in runs:
            for node in list(run):
                if node.tag == W+'fldChar':
                    kind = node.get(W+'fldCharType')
                    if kind == 'begin':
                        if active is not None:
                            raise ValueError('ARCHIVE_NESTED_FIELD')
                        paragraph = next(run.iterancestors(W+'p'))
                        active = {'instruction':'', 'nodes':[], 'controls':[node],
                                  'separate':False, 'label':paragraph_text(paragraph)}
                    elif active is not None:
                        active['controls'].append(node)
                        if kind == 'separate':
                            active['separate'] = True
                        elif kind == 'end':
                            instruction = active['instruction'].strip()
                            match = re.match(r'MERGEFIELD\s+("[^"]+"|[^\s\\]+)', instruction, re.I)
                            if match:
                                if not active['nodes']:
                                    active['nodes'] = [E.SubElement(run, W+'t')]
                                active['nodes'][0].text = map_field(match[1], active['label'], blueprint)
                                for text in active['nodes'][1:]:
                                    text.text = ''
                            elif not instruction.upper().startswith('NEXT'):
                                raise ValueError('ARCHIVE_UNMAPPED_FIELD_CODE:'+instruction)
                            for control in active['controls']:
                                control.getparent().remove(control)
                            active = None
                    else:
                        raise ValueError('ARCHIVE_ORPHAN_FIELD_CONTROL')
                elif node.tag == W+'instrText':
                    if active is None:
                        raise ValueError('ARCHIVE_ORPHAN_FIELD_INSTRUCTION')
                    active['instruction'] += node.text or ''
                    active['controls'].append(node)
                elif node.tag == W+'t' and active is not None and active['separate']:
                    active['nodes'].append(node)
        if active is not None:
            raise ValueError('ARCHIVE_UNTERMINATED_FIELD:'+blueprint['id']+':'+active['instruction'])


def prepare(source_root, blueprint):
    source_root = Path(source_root).resolve()
    source = (source_root/blueprint['source']).resolve()
    if not source.is_relative_to(source_root):
        raise ValueError('ARCHIVE_SOURCE_PATH')
    data = source.read_bytes()
    if digest(data) != blueprint['sourceSha256']:
        raise ValueError('ARCHIVE_SOURCE_HASH:'+blueprint['id'])
    with ZipFile(BytesIO(data)) as archive:
        files = {name:archive.read(name) for name in archive.namelist()}
    original = dict(files)
    trees = {}
    def tree(part):
        if part not in trees:
            trees[part] = E.fromstring(files[part])
        return trees[part]
    for part in files:
        if re.fullmatch(r'word/(?:document|header\d*|footer\d*)\.xml', part):
            fill_merge_slots(tree(part), blueprint)
    for patch in blueprint.get('textSlots', []):
        root = tree(patch['part'])
        nodes = root.xpath(patch['xpath'], namespaces=namespaces(root))
        if len(nodes) != 1 or nodes[0].tag != W+'t':
            raise ValueError('ARCHIVE_TEXT_SLOT_NOT_UNIQUE:'+patch['xpath'])
        nodes[0].text = patch['value']
    for patch in blueprint.get('paragraphSlots', []):
        root = tree(patch['part'])
        nodes = root.xpath(patch['xpath'], namespaces=namespaces(root))
        if len(nodes) != 1 or nodes[0].tag != W+'p':
            raise ValueError('ARCHIVE_SLOT_NOT_UNIQUE:'+patch['xpath'])
        put_text(nodes[0], patch['value'])
    rosters = blueprint.get('rosters', [blueprint['roster']] if blueprint.get('roster') else [])
    for roster in rosters:
        tables = list(tree('word/document.xml').iter(W+'tbl'))
        table = tables[roster['tableIndex']]
        rows = table.findall(W+'tr')
        row = rows[roster['headerRows']]
        row_props = row.find(W+'trPr')
        if row_props is None:
            row_props = E.Element(W+'trPr')
            row.insert(0, row_props)
        # Some supplied forms mark the specimen row as another repeating header.
        # Only the real caption rows may repeat after participant rows are cloned.
        for repeat in row_props.findall(W+'tblHeader'):
            row_props.remove(repeat)
        no_split = row_props.find(W+'cantSplit')
        if no_split is None:
            no_split = E.SubElement(row_props, W+'cantSplit')
        no_split.set(W+'val', '1')
        for height in row_props.findall(W+'trHeight'):
            height.set(W+'hRule', 'atLeast')
        cells = row.findall(W+'tc')
        if len(cells) != len(roster['rowValues']):
            raise ValueError('ARCHIVE_ROSTER_COLUMNS')
        for cell, value in zip(cells, roster['rowValues']):
            if value == '{{ROW_NUMBER}}':
                cell_props = cell.find(W+'tcPr')
                if cell_props is None:
                    cell_props = E.Element(W+'tcPr')
                    cell.insert(0, cell_props)
                margins = cell_props.find(W+'tcMar')
                if margins is None:
                    margins = E.SubElement(cell_props, W+'tcMar')
                for side in ['left', 'right', 'start', 'end']:
                    margin = margins.find(W+side)
                    if margin is None:
                        margin = E.SubElement(margins, W+side)
                    margin.set(W+'w', '0')
                    margin.set(W+'type', 'dxa')
            paragraphs = cell.findall(W+'p')
            if not paragraphs:
                paragraphs = [E.SubElement(cell, W+'p')]
            put_text(paragraphs[0], value)
            for paragraph in paragraphs[1:]:
                put_text(paragraph, '')
            for paragraph in paragraphs:
                props = paragraph.find(W+'pPr')
                if props is None:
                    props = E.Element(W+'pPr')
                    paragraph.insert(0, props)
                for numbering in props.findall(W+'numPr'):
                    props.remove(numbering)
                # Roster ordinal is supplied from the frozen participant order;
                # a source list style must not print a second "1." beside it.
                numbering = E.SubElement(props, W+'numPr')
                E.SubElement(numbering, W+'numId', {W+'val':'0'})
                if value == '{{ROW_NUMBER}}':
                    # Remove the source list's hanging indent from the narrow
                    # ordinal column, so 10 and higher remain fully visible.
                    for indent in props.findall(W+'ind'):
                        props.remove(indent)
                    E.SubElement(props, W+'ind', {
                        W+'left':'0', W+'right':'0', W+'firstLine':'0',
                        W+'leftChars':'0', W+'rightChars':'0', W+'firstLineChars':'0'})
        for old in rows[roster['headerRows']+1:]:
            table.remove(old)
        for header in rows[:roster['headerRows']]:
            props = header.find(W+'trPr')
            if props is None:
                props = E.Element(W+'trPr')
                header.insert(0, props)
            repeat = props.find(W+'tblHeader')
            if repeat is None:
                repeat = E.SubElement(props, W+'tblHeader')
            repeat.set(W+'val', '1')
    media = {entry['part']:entry for entry in blueprint.get('media', [])}
    for part, blob in list(files.items()):
        if not part.startswith('word/media/'):
            continue
        if part not in media:
            raise ValueError('ARCHIVE_UNCLASSIFIED_IMAGE:'+part)
        with Image.open(BytesIO(blob)) as picture:
            size = picture.size
            fmt = picture.format
        if fmt not in ('PNG', 'JPEG'):
            raise ValueError('ARCHIVE_IMAGE_FORMAT:'+part)
        blank = Image.new('RGB' if fmt=='JPEG' else 'RGBA', size,
                          (255,255,255) if fmt=='JPEG' else (255,255,255,0))
        stream = BytesIO()
        blank.save(stream, fmt)
        files[part] = stream.getvalue()
    for index, shape_slot in enumerate(blueprint.get('photoShapes', [])):
        part = shape_slot['part']
        root = tree(part)
        shapes = root.xpath('//*[local-name()="rect" or local-name()="shape"][@id=$shapeId]', shapeId=shape_slot['shapeId'])
        if len(shapes) != 1 or shapes[0].find('{urn:schemas-microsoft-com:vml}imagedata') is not None:
            raise ValueError('ARCHIVE_PHOTO_SHAPE')
        image_part = f'word/media/archive-photo-{index}.png'
        image = Image.new('RGBA', (360,480), (255,255,255,0))
        stream = BytesIO()
        image.save(stream, 'PNG')
        files[image_part] = stream.getvalue()
        media[image_part] = {'part':image_part, 'kind':'PHOTO'}
        relpart = str(Path(part).parent/'_rels'/(Path(part).name+'.rels')).replace('\\','/')
        if relpart not in files:
            files[relpart] = E.tostring(E.Element(PKG+'Relationships', nsmap={None:PKG[1:-1]}))
        rels = tree(relpart)
        rid = f'rIdArchivePhoto{index}'
        if any(rel.get('Id')==rid for rel in rels):
            raise ValueError('ARCHIVE_PHOTO_RELATION_COLLISION')
        E.SubElement(rels, PKG+'Relationship', Id=rid, Type=R[1:-1]+'/image', Target=f'media/archive-photo-{index}.png')
        E.SubElement(shapes[0], '{urn:schemas-microsoft-com:vml}imagedata', {R+'id':rid})
        content_types = tree('[Content_Types].xml')
        if not any(entry.get('Extension')=='png' for entry in content_types):
            E.SubElement(content_types, CT+'Default', Extension='png', ContentType='image/png')
    # Remove data connections and hidden copies of source recipients/photos.
    removed = {part for part in files if part.startswith(('customXml/', 'word/embeddings/', 'docProps/thumbnail', 'word/recipientData', 'word/comments', 'word/people'))}
    for part in removed:
        files.pop(part, None)
        trees.pop(part, None)
    for part, blob in list(files.items()):
        if not part.endswith(('.xml', '.rels')):
            continue
        root = tree(part)
        if part.endswith('.rels'):
            for rel in list(root):
                kind = rel.get('Type','').rsplit('/',1)[-1]
                if rel.get('TargetMode')=='External' or kind in ('oleObject','customXml','recipientData','comments','people','thumbnail','attachedTemplate'):
                    root.remove(rel)
        elif part == '[Content_Types].xml':
            for entry in list(root):
                if entry.get('PartName','').lstrip('/') in removed:
                    root.remove(entry)
            E.SubElement(root, CT+'Override', PartName='/'+MARKER, ContentType='application/json')
        elif part.startswith('docProps/'):
            for node in root.iter():
                if len(node)==0 and node.text:
                    node.text = ''
        elif part.startswith('word/'):
            for node in list(root.iter()):
                if not isinstance(node.tag,str):
                    continue
                local = E.QName(node).localname
                if local in ('mailMerge','docVars','binData','OLEObject','object','commentRangeStart','commentRangeEnd','commentReference'):
                    if node.getparent() is not None:
                        node.getparent().remove(node)
                    continue
                for attribute in list(node.attrib):
                    if E.QName(attribute).localname in ('gfxdata','descr','title','alt','author','lastModifiedBy'):
                        del node.attrib[attribute]
    for part, root in trees.items():
        rendered = E.tostring(root, encoding='utf-8', xml_declaration=True)
        # Retain exact bytes for every part whose parsed content did not change.
        initial = E.tostring(E.fromstring(original[part]), encoding='utf-8', xml_declaration=True) if part in original else None
        if rendered != initial:
            files[part] = rendered
    fields = sorted({field for part, blob in files.items() if part.startswith('word/') and part.endswith('.xml')
                     for field in re.findall(r'\{\{([A-Z0-9_]+)\}\}', ''.join(E.fromstring(blob).itertext()))})
    marker = {'policy':POLICY, 'templateId':blueprint['id'], 'sourceSha256':blueprint['sourceSha256'],
              'fields':fields, 'dynamicMedia':[{'part':item['part'], 'kind':'ISSUER_NAME' if item['kind']=='LOGO' else item['kind']}
                                              for item in media.values() if item['kind'] in ('PHOTO','LOGO','ISSUER_NAME')]}
    if rosters:
        entries = [{key:item[key] for key in ('tableIndex','headerRows')} for item in rosters]
        if len(rosters)==1:
            marker['roster'] = entries[0]
        else:
            marker['rosters'] = entries
    if blueprint.get('fieldLayoutPolicy'):
        marker['fieldLayoutPolicy'] = blueprint['fieldLayoutPolicy']
    files[MARKER] = json.dumps(marker, ensure_ascii=False, sort_keys=True).encode('utf8')
    return files, {'id':blueprint['id'], 'source':blueprint['source'], 'sourceSha256':blueprint['sourceSha256'],
                   'fields':fields, 'changedParts':sorted(k for k,v in files.items() if original.get(k)!=v),
                   'removedParts':sorted(removed),
                   'preservedParts':{k:digest(v) for k,v in files.items() if original.get(k)==v}}


def prepare_form(source_root, blueprint):
    files, record = prepare(source_root, blueprint)
    if not blueprint.get('appendSources'):
        return files, record
    from archive_forms import combine_archive_parts
    documents = [files]
    sources = [record]
    markers = [json.loads(files[MARKER])]
    for source in blueprint['appendSources']:
        extra, report = prepare(source_root, {**source, 'id':blueprint['id']})
        documents.append(extra)
        markers.append(json.loads(extra[MARKER]))
        sources.append(report)
    files = combine_archive_parts(documents)
    marker = dict(markers[0])
    marker.pop('roster', None)
    marker.pop('rosters', None)
    marker['fields'] = sorted({key for part in markers for key in part['fields']})
    marker['dynamicMedia'] = []
    rosters = []
    offset = 0
    for index, (document, part) in enumerate(zip(documents, markers)):
        entries = part.get('rosters', [part['roster']] if part.get('roster') else [])
        rosters.extend({**entry, 'tableIndex':entry['tableIndex']+offset} for entry in entries)
        offset += len(list(E.fromstring(document['word/document.xml']).iter(W+'tbl')))
        marker['dynamicMedia'].extend({**entry, 'part':entry['part'] if index==0 else f'word/archive-{index}/'+entry['part'].removeprefix('word/')}
                                     for entry in part.get('dynamicMedia', []))
    if rosters:
        marker['rosters'] = rosters
    files[MARKER] = json.dumps(marker, ensure_ascii=False, sort_keys=True).encode('utf8')
    record = {'id':blueprint['id'], 'source':blueprint['source'], 'sourceSha256':blueprint['sourceSha256'],
              'fields':marker['fields'], 'assembledSources':sources,
              'assemblyPolicy':'PRESERVE_SOURCE_SECTIONS_WITH_REMAPPED_RELATIONSHIPS'}
    return files, record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--blueprints', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--template', action='append', default=[])
    args = parser.parse_args()
    blueprints = json.loads(args.blueprints.read_text(encoding='utf8'))
    args.out.mkdir(parents=True, exist_ok=True)
    report = []
    for blueprint in blueprints:
        if args.template and blueprint['id'] not in args.template:
            continue
        files, record = prepare_form(args.source_root, blueprint)
        target = args.out/(blueprint['id']+'.docx')
        deterministic_zip(target, files)
        record.update(file=target.name, sha256=digest(target.read_bytes()))
        report.append(record)
    (args.out/'build-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps([{'id':r['id'],'fields':len(r['fields']),'sha256':r['sha256']} for r in report]))


if __name__ == '__main__':
    main()
