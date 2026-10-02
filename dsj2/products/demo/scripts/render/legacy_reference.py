"""Render the unchanged 90d5 reference forms with their original fill helpers.

The source checksums identify the rendering policy from pinned template bytes.
Earlier transformed template versions never enter this path. No font, media,
paragraph, textbox or page-layout normalization is performed here.
"""
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile
from copy import deepcopy
from xml.etree import ElementTree as ET
import base64
import hashlib
import json
import os
import re
from lxml import etree as E


ROOT = Path(__file__).resolve().parent
POLICY = 'LEGACY_REFERENCE_90D5'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
NS = {'w': W[1:-1]}


@lru_cache(maxsize=1)
def reference_sources():
    return json.loads((ROOT / 'legacy_reference_sources.json').read_text(encoding='utf-8'))


def identify_reference(template_path, template_id):
    digest = hashlib.sha256(Path(template_path).read_bytes()).hexdigest()
    return any(entry['id'] == template_id and entry['sha256'] == digest
               for entry in reference_sources()['templates'])


def legacy_payload(snapshot, item):
    from legacy_snapshot_fields import build_legacy_payload
    payload = build_legacy_payload(snapshot, item)
    photo_id = item.get('photoAssetId')
    slot = payload.pop('photoSlot', None)
    payload['photo'] = None
    if photo_id and slot:
        key = snapshot.get('photos', {}).get(photo_id)
        if not key:
            raise ValueError('PHOTO_ASSET_MISSING')
        store = Path(os.environ['DEMO_ARTIFACT_ROOT']).resolve()
        photo = (store / key).resolve()
        if not photo.is_relative_to(store):
            raise ValueError('PHOTO_PATH')
        blob = photo.read_bytes()
        expected = re.search(r'/(\w{64})-[0-9a-f-]{36}\.png$', key)
        if expected and expected[1] != hashlib.sha256(blob).hexdigest():
            raise ValueError('PHOTO_HASH_MISMATCH')
        # Empty filename produces the legacy helper's stable hash('') == 0;
        # source photo geometry and the frozen asset bytes stay unchanged.
        payload['photo'] = {'dataUrl': 'data:image/png;base64,' + base64.b64encode(blob).decode('ascii'),
                            'fileName': '', 'slot': slot}
    return payload


def source_literal_values(files, replacements):
    """Replace source sample data in existing text nodes, without touching style."""
    if not replacements:
        return files
    result = dict(files)
    for name, data in files.items():
        if not name.startswith('word/') or not name.endswith('.xml'):
            continue
        tree = E.fromstring(data)
        changed = False
        for paragraph in tree.iter(W + 'p'):
            nodes = paragraph.xpath('./w:r/w:t | ./w:hyperlink/w:r/w:t', namespaces=NS)
            if not nodes:
                continue
            current = ''.join(node.text or '' for node in nodes)
            edits = []
            for replacement in replacements:
                if replacement.get('paragraphContains') and replacement['paragraphContains'] not in current:
                    continue
                match = replacement['matchText']
                if replacement.get('mode', 'text') == 'paragraph':
                    if ' '.join(current.split()) != ' '.join(match.split()):
                        continue
                    edits = [(0, len(current), replacement['replaceText'])]
                    break
                else:
                    edits.extend((m.start(), m.end(), replacement['replaceText'])
                                 for m in re.finditer(re.escape(match), current))
            # Match only the original sample text. A frozen value containing
            # the word "хорошо" must never be substituted a second time.
            chosen = []
            for edit in sorted(edits, key=lambda value: (-(value[1] - value[0]), value[0])):
                if not any(edit[0] < prior[1] and edit[1] > prior[0] for prior in chosen):
                    chosen.append(edit)
            for start, end, value in sorted(chosen, reverse=True):
                offset = 0
                for node in nodes:
                    old = node.text or ''; left, right = offset, offset + len(old); offset = right
                    if right <= start or left >= end:
                        continue
                    a, b = max(0, start - left), min(len(old), end - left)
                    node.text = old[:a] + (value if left <= start < right else '') + old[b:]
            if chosen:
                for node in nodes:
                    if node.text and (node.text.startswith(' ') or node.text.endswith(' ')):
                        node.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
                changed = True
        if changed:
            result[name] = E.tostring(tree, xml_declaration=True, encoding='utf-8')
    return result


def complex_fields(paragraph):
    children = list(paragraph)
    for index, run in enumerate(children):
        begin = run.find(W + 'fldChar') if run.tag == W + 'r' else None
        if begin is None or begin.get(W + 'fldCharType') != 'begin':
            continue
        instruction = []; separate = None
        for cursor in range(index + 1, len(children)):
            candidate = children[cursor]
            instruction.extend(node.text or '' for node in candidate.findall(W + 'instrText'))
            marker = candidate.find(W + 'fldChar')
            kind = marker.get(W + 'fldCharType') if marker is not None else None
            if kind == 'separate':
                separate = cursor
            if kind == 'end':
                if separate is not None:
                    runs = children[separate + 1:cursor]
                    nodes = [node for result in runs for node in result.iter(W + 't')]
                    yield {'instruction': ''.join(instruction).strip(), 'nodes': nodes,
                           'runs': children[index:cursor + 1]}
                break


def set_cached_value(field, value):
    nodes = field['nodes']
    if not nodes:
        raise ValueError('REFERENCE_FIELD_CACHE_MISSING')
    target = next((node for node in nodes if (node.text or '').strip()), nodes[0])
    target.text = str(value)
    for node in nodes:
        if node is not target:
            node.text = ''


def prepare_reference_source(files, snapshot, item, payload):
    result = source_literal_values(files, payload.get('sourceLiteralValues', []))
    if snapshot['templateId'] != 'ps-witness':
        return result
    from legacy_snapshot_fields import date_fields, frozen_date
    values = next((entry['fields'] for entry in payload.get('scopedFieldValues', [])
                   if entry['scope'] == 'witness-protocol-date'), {})
    date_value = date_fields(frozen_date(item['assignment'].get('protocolDate', item['assignment']['documentDate']), 'protocolDate'))
    tree = E.fromstring(result['word/document.xml'])
    for table in tree.iter(W + 'tbl'):
        if len(list(table.iter(W + 'tbl'))) != 1:
            continue
        rows = table.findall(W + 'tr')
        cells = rows[0].findall(W + 'tc') if rows else []
        if len(cells) != 7 or 'Біліктілік комиссиясының' not in ''.join(cells[0].itertext()):
            continue
        for node in cells[1].iter(W + 't'):
            node.text = (node.text or '').replace('{{TRAINING_END_YEAR_FULL}}', date_value['year'])
        for node in cells[4].iter(W + 't'):
            node.text = (node.text or '').replace('{{TRAINING_END_MONTH_KZ}}', date_value['day'])
        month = next(cells[6].iter(W + 't'), None)
        if month is None:
            paragraph = cells[6].find(W + 'p')
            if paragraph is None:
                raise ValueError('REFERENCE_WITNESS_MONTH_SLOT_MISSING')
            month = E.SubElement(E.SubElement(paragraph, W + 'r'), W + 't')
        month.text = date_value['monthKz']
    for paragraph in tree.iter(W + 'p'):
        nodes = paragraph.xpath('./w:r/w:t', namespaces=NS)
        if 'Решением квалификационной' not in ''.join(node.text or '' for node in nodes):
            continue
        for node in nodes:
            for key, value in values.items():
                node.text = (node.text or '').replace(key, value)
    result['word/document.xml'] = E.tostring(tree, xml_declaration=True, encoding='utf-8')
    return result


def freeze_reference_dates(files, snapshot, item):
    """Freeze resolved dates/aliased field values; never alter run/paragraph style.

    LibreOffice refreshes the source DATE field even though fldLock=1 is already
    present. Retain its cached display runs, removing only that field's active
    instruction/markers. Other merge fields and all source geometry stay intact.
    """
    from legacy_snapshot_fields import build_legacy_payload, date_fields, frozen_date
    payload = build_legacy_payload(snapshot, item)
    scoped = {entry['scope']: entry['fields'] for entry in payload.get('scopedFieldValues', [])}
    frozen = date_fields(frozen_date(item['assignment']['documentDate'], 'documentDate'))
    result = dict(files)
    for name, data in files.items():
        if not name.startswith('word/') or not name.endswith('.xml'):
            continue
        tree = E.fromstring(data); changed = False
        protocol_paragraphs = set(); expiry_paragraphs = set()
        for box in tree.iter(W + 'txbxContent'):
            in_protocol = False
            for paragraph in box.findall(W + 'p'):
                label = ''.join(node.text or '' for node in paragraph.iter(W + 't'))
                instructions = ' '.join(field['instruction'] for field in complex_fields(paragraph))
                expiry = 'Действительно_' in instructions or bool(re.search(r'Действительно|дейін жарамды', label, re.I))
                if expiry:
                    expiry_paragraphs.add(paragraph)
                    in_protocol = False
                elif 'Протокол_' in instructions or re.search(r'основание.*протокол|негіздеме.*хаттама', label, re.I):
                    in_protocol = True
                if in_protocol:
                    protocol_paragraphs.add(paragraph)
        for paragraph in tree.iter(W + 'p'):
            label = ''.join(node.text or '' for node in paragraph.iter(W + 't'))
            for field in list(complex_fields(paragraph)):
                if re.match(r'^DATE(?:\s|$)', field['instruction'], re.I):
                    set_cached_value(field, frozen['ruCertificate'])
                    for run in field['runs']:
                        for node in list(run):
                            if node.tag in [W + 'fldChar', W + 'instrText']:
                                run.remove(node)
                    changed = True
                    continue
                match = re.match(r'^MERGEFIELD\s+("[^"]+"|[^\s\\]+)', field['instruction'])
                if not match:
                    continue
                key = match[1]
                values = scoped.get('protocol-date', {}) if paragraph in protocol_paragraphs else {}
                if paragraph in expiry_paragraphs:
                    values = scoped.get('expiry-date', {})
                if 'Лауазымы' in label:
                    values = {**values, **scoped.get('kazakh-position', {})}
                if key in values or key.strip('"') in values:
                    set_cached_value(field, values.get(key, values.get(key.strip('"'))))
                    changed = True
        if changed:
            result[name] = E.tostring(tree, xml_declaration=True, encoding='utf-8')
    return result


def render_reference_files(snapshot, item, template_path, source_values=False):
    if not identify_reference(template_path, snapshot['templateId']):
        raise ValueError('REFERENCE_TEMPLATE_HASH_MISMATCH')
    payload = legacy_payload(snapshot, item)
    with TemporaryDirectory(prefix='demo-reference-') as directory:
        path = Path(template_path)
        if source_values:
            from sanitize_templates import deterministic_zip
            with ZipFile(path) as archive:
                parts = {name: archive.read(name) for name in archive.namelist()}
            path = Path(directory) / 'source.docx'
            deterministic_zip(path, prepare_reference_source(parts, snapshot, item, payload))
        if snapshot['templateId'] == 'ps-witness':
            from generate_ps_witness_certificate import render_document_bytes
            content = render_document_bytes(path, payload['fields'])
        else:
            from generate_biot_card import render
            output = Path(directory) / 'document.docx'
            render(path, output, payload['fields'], payload['photo'],
                   payload.get('textReplacements', []), payload.get('fieldStyleOverrides', {}))
            content = output.read_bytes()
    with ZipFile(BytesIO(content)) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def combine_reference_files(documents):
    """90d5 mail-merge assembly, with each recipient already filled/frozen.

    Only the filling stage moved before assembly. The legacy page break,
    relationship remap, copied source body and final section are retained.
    """
    import generate_biot_mail_merge_bundle as legacy
    files = dict(documents[0])
    legacy.register_doc_namespaces(legacy.collect_doc_namespaces(files['word/document.xml']))
    root = ET.fromstring(files['word/document.xml']); body = root.find(W + 'body')
    rels = ET.fromstring(files['word/_rels/document.xml.rels'])
    section = None
    if len(body) and body[-1].tag == W + 'sectPr':
        section = deepcopy(body[-1]); body.remove(body[-1])
    for document in documents[1:]:
        other = ET.fromstring(document['word/document.xml']); other_body = other.find(W + 'body')
        other_rels = ET.fromstring(document['word/_rels/document.xml.rels'])
        for relation in other_rels.findall(legacy.REL + 'Relationship'):
            if relation.get('Type') != legacy.IMAGE_REL_TYPE:
                continue
            old_id, target = relation.get('Id'), relation.get('Target')
            if not old_id or not target:
                continue
            media_name = f'preview-{len(files)}-{Path(target).name}'
            new_target = 'media/' + media_name; new_id = legacy.next_relationship_id(rels)
            ET.SubElement(rels, legacy.REL + 'Relationship',
                          {'Id': new_id, 'Type': legacy.IMAGE_REL_TYPE, 'Target': new_target})
            for element in other.iter():
                if element.get(legacy.DOC_REL + 'id') == old_id:
                    element.set(legacy.DOC_REL + 'id', new_id)
            files['word/' + new_target] = document['word/' + target]
            extension = Path(media_name).suffix.lstrip('.').lower()
            if extension in ['jpg', 'jpeg', 'png']:
                files['[Content_Types].xml'] = legacy.ensure_content_type_default(
                    files['[Content_Types].xml'], extension,
                    'image/jpeg' if extension in ['jpg', 'jpeg'] else 'image/png')
        body.append(legacy.build_page_break_paragraph())
        for child in other_body:
            if child.tag != W + 'sectPr':
                body.append(deepcopy(child))
    if section is not None:
        body.append(section)
    files['word/document.xml'] = ET.tostring(root, encoding='utf-8', xml_declaration=True)
    files['word/_rels/document.xml.rels'] = ET.tostring(rels, encoding='utf-8', xml_declaration=True)
    return files


def reference_group_item(item):
    """Use frozen member outcomes/numbers in the original protocol data slots."""
    assignment = dict(item['assignment'])
    outcome = assignment.get('outcome') or {}
    status = outcome.get('status')
    labels = {'FAILED': ('Не сдал', 'Тапсырмады'),
              'ABSENT': ('Не явился', 'Келмеді'),
              'UNKNOWN': ('Не подтверждено', 'Расталмаған')}
    if status in labels:
        ru, kz = labels[status]
        assignment.update(result=ru + ' / ' + kz, resultRu=ru, resultKz=kz)
    elif status == 'PASSED' and not str(assignment.get('result') or '').strip():
        ru = str(assignment.get('resultRu') or '').strip()
        kz = str(assignment.get('resultKz') or '').strip()
        assignment['result'] = ' / '.join(value for value in [ru, kz] if value) or 'Сдал / Тапсырды'
    return {**item, 'number': item.get('credentialNumber') or '', 'assignment': assignment}


def render_reference_group_row_xml(snapshot, item, source_xml):
    """Run the unchanged legacy fill sequence without repacking static media.

    Group protocols consume only a filled roster row from document.xml. Their
    full header package still goes through the original DOCX renderer. These
    are the same document transformations and ordering used by legacy render;
    no layout, field, or serialization normalization is added here.
    """
    import generate_biot_card as legacy
    payload = legacy_payload(snapshot, item)
    prepared = prepare_reference_source({'word/document.xml': source_xml}, snapshot, item, payload)
    document = legacy.replace_fields(prepared['word/document.xml'], payload['fields'],
                                     payload.get('fieldStyleOverrides', {}))
    document = legacy.replace_literal_paragraphs(document, payload.get('textReplacements', []))
    document = legacy.replace_literal_text_nodes(document, payload.get('textReplacements', []))
    document = legacy.trim_trailing_empty_body_paragraphs(document)
    return freeze_reference_dates({'word/document.xml': document}, snapshot, item)['word/document.xml']


def render_reference_group_files(snapshot, template_path):
    """Fill the original roster rows; keep source widths and floating blocks."""
    from group_protocol import roster_table
    from request_limits import MAX_REQUEST_ROWS
    items = snapshot['items']
    if snapshot.get('groupEvent', {}).get('contractVersion') != 1 or not snapshot['templateId'].endswith('-protocol'):
        raise ValueError('GROUP_VERSION_UNKNOWN')
    if not 1 <= len(items) <= MAX_REQUEST_ROWS:
        raise ValueError('GROUP_ROW_LIMIT')
    if len({(item['id'], item['assignment']['eventId']) for item in items}) != len(items):
        raise ValueError('GROUP_DUPLICATE_MEMBER')
    items = [reference_group_item(item) for item in items]
    header_item = items[0]
    header = snapshot.get('groupHeaderWorkplace')
    if header is not None:
        if (snapshot['templateId'] not in ['biot-protocol', 'biot-itr-protocol', 'pb-protocol']
                or header.get('version') != 1 or not isinstance(header.get('workplaceRu'), str)
                or not isinstance(header.get('workplaceKz'), str)):
            raise ValueError('GROUP_HEADER_WORKPLACE_CONTRACT')
        header_item = {**header_item, 'workplaceRu': header['workplaceRu'], 'workplaceKz': header['workplaceKz']}
    files = freeze_reference_dates(render_reference_files(snapshot, header_item, template_path, source_values=True), snapshot, header_item)
    with ZipFile(template_path) as archive:
        source_xml = archive.read('word/document.xml')
    root = E.fromstring(files['word/document.xml']); roster = roster_table(root)
    header_count = 2 if snapshot['templateId'].startswith('biot-') else 1
    for row in roster.findall(W + 'tr')[header_count:]:
        roster.remove(row)
    for item in items:
        individual = render_reference_group_row_xml(snapshot, item, source_xml)
        filled = roster_table(E.fromstring(individual))
        roster.append(deepcopy(filled.findall(W + 'tr')[header_count]))
    files['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='utf-8')
    return files


def reference_opc_package(files):
    """Serialize rewritten OPC declarations for the pinned converter.

    The original helpers prefix these package roots with ns0 after adding a
    photo or merging a batch. LibreOffice 26.2.6.3 rejects that package. Restore their original
    default namespace serialization only; document.xml, all relationships and
    content types by QName/value, and every image byte remain unchanged.
    """
    result = files
    for name in ['[Content_Types].xml', 'word/_rels/document.xml.rels']:
        root = E.fromstring(files[name])
        namespace = E.QName(root).namespace
        if root.nsmap.get(None) == namespace:
            continue
        if result is files:
            result = dict(files)
        repaired = E.Element(root.tag, dict(root.attrib), nsmap={None: namespace})
        repaired.text = root.text
        for child in root:
            repaired.append(child)
        result[name] = E.tostring(repaired, xml_declaration=True, encoding='utf-8')
    return result


def reference_package_declarations(files, template_path):
    """Repair declarations only; retain every serialized element and value.

    Legacy ElementTree serialization drops namespace declarations referenced
    only by compatibility attributes. Restore those aliases from the pinned
    source package, and use the standard UTF-8 encoding name in XML declarations.
    No generic package, metadata, property-order or layout normalization runs.
    """
    from xml.sax.saxutils import quoteattr
    result = dict(files)
    with ZipFile(template_path) as archive:
        source_names = set(archive.namelist())
        for name, data in files.items():
            if not name.endswith(('.xml', '.rels')):
                continue
            updated = re.sub(rb'\A(<\?xml\b[^?]*\bencoding\s*=\s*[\'"])utf8([\'"])',
                             rb'\1UTF-8\2', data, count=1, flags=re.I)
            tree = E.fromstring(updated)
            missing = {prefix for node in tree.iter() for attribute, value in node.attrib.items()
                       if E.QName(attribute).localname in ['Ignorable', 'Requires']
                       for prefix in value.split() if prefix not in node.nsmap}
            if missing:
                if name not in source_names:
                    raise ValueError('REFERENCE_NAMESPACE_SOURCE_MISSING:' + name)
                original = E.fromstring(archive.read(name))
                aliases = dict(original.nsmap)
                for node in original.iter():
                    for prefix, uri in node.nsmap.items():
                        aliases.setdefault(prefix, uri)
                # PB/PS source document.xml already omits a few aliases used
                # by its Ignorable list; their other source parts declare them.
                # Accept only one unambiguous URI from this same pinned DOCX.
                unresolved = missing - set(aliases)
                if unresolved:
                    package_aliases = {prefix: set() for prefix in unresolved}
                    for source_name in source_names:
                        if not source_name.endswith(('.xml', '.rels')):
                            continue
                        source_tree = E.fromstring(archive.read(source_name))
                        for node in source_tree.iter():
                            for prefix in unresolved:
                                if prefix in node.nsmap:
                                    package_aliases[prefix].add(node.nsmap[prefix])
                    aliases.update({prefix: next(iter(values)) for prefix, values in package_aliases.items()
                                    if len(values) == 1})
                if any(prefix not in aliases for prefix in missing):
                    raise ValueError('REFERENCE_NAMESPACE_ALIAS_MISSING:' + name)
                opening = re.search(rb'<(?![!?])[A-Za-z_][\w:.-]*(?=[\s>/])', updated)
                if opening is None:
                    raise ValueError('REFERENCE_XML_ROOT_MISSING:' + name)
                declarations = ''.join(' xmlns:' + prefix + '=' + quoteattr(aliases[prefix])
                                       for prefix in sorted(missing)).encode('utf-8')
                updated = updated[:opening.end()] + declarations + updated[opening.end():]
            result[name] = updated
    return result


def render_reference_document(snapshot, output, template_path):
    """Use the reference renderer's single/batch path, before generic rewriting."""
    from request_limits import MAX_REQUEST_ROWS
    from sanitize_templates import deterministic_zip
    items = snapshot['items']
    if not 1 <= len(items) <= MAX_REQUEST_ROWS:
        raise ValueError('ROW_LIMIT')
    if snapshot.get('groupEvent'):
        files = render_reference_group_files(snapshot, template_path)
    else:
        documents = [freeze_reference_dates(render_reference_files(snapshot, item, template_path, source_values=True),
                                            snapshot, item) for item in items]
        files = documents[0] if len(documents) == 1 else combine_reference_files(documents)
    if snapshot.get('demoMode') or snapshot.get('mode') == 'draft-preview':
        from source_fidelity import add_floating_mark
        add_floating_mark(files, 'ДЕМО — НЕ ЯВЛЯЕТСЯ ВЫДАННЫМ ДОКУМЕНТОМ' if snapshot.get('demoMode') else
                          'ПРЕДПРОСМОТР — НЕ ЯВЛЯЕТСЯ ВЫДАННЫМ ДОКУМЕНТОМ')
    if snapshot.get('englishAppendix'):
        from english_appendix import append_english_pages
        files = append_english_pages(files, snapshot)
    deterministic_zip(output, reference_package_declarations(reference_opc_package(files), template_path))
