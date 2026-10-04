"""Derivatives of verified, immutable originals; no template re-rendering."""
import copy
import hashlib
import json
import posixpath
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree
from pypdf import PdfReader, PdfWriter

PART_BYTES = 64 * 1024 * 1024
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'http://schemas.openxmlformats.org/package/2006/content-types'

def verified_sources(payload):
    artifacts = payload.get('artifacts', [])
    if not artifacts:
        raise ValueError('EMPTY_PRINT_SET')
    root = Path(payload['artifactRoot']).resolve()
    result = []
    total = 0
    for artifact in artifacts:
        key = artifact['storageKey']
        target = (root / key).resolve()
        if not target.is_relative_to(root) or '..' in key or '\\' in key:
            raise ValueError('INVALID_STORAGE_KEY')
        size = target.stat().st_size
        if total + size > PART_BYTES:
            raise ValueError('PRINT_SET_PART_LIMIT')
        if 'size' in artifact and artifact['size'] != size:
            raise ValueError('ARTIFACT_SIZE_MISMATCH')
        content = target.read_bytes()
        if hashlib.sha256(content).hexdigest() != artifact['sha256']:
            raise ValueError('ARTIFACT_HASH_MISMATCH')
        total += len(content)
        if total > PART_BYTES:
            raise ValueError('PRINT_SET_PART_LIMIT')
        result.append((artifact, target))
    return result

def merge_pdf(payload, out):
    sources = verified_sources(payload)
    writer = PdfWriter()
    counts = []
    for artifact, path in sources:
        reader = PdfReader(str(path), strict=True)
        if reader.is_encrypted:
            raise ValueError('PDF_ENCRYPTED_REJECTED')
        if not reader.pages:
            raise ValueError('EMPTY_PDF')
        counts.append({'artifactId': artifact['id'], 'sha256': artifact['sha256'], 'pages': len(reader.pages)})
        # Copy pages in their original coordinate space, including rotation,
        # media/crop boxes, fonts, pictures and full text. No rescaling.
        for page in reader.pages:
            writer.add_page(page)
    writer.add_metadata({'/Title': 'DEMO — сохранённый печатный комплект', '/Subject': json.dumps(counts, ensure_ascii=True), '/Producer': 'DEMO immutable print set'})
    with open(out, 'wb') as stream:
        writer.write(stream)
    return {'pages': len(writer.pages), 'files': counts, 'scale': 1, 'originalsUnchanged': True}

def xml(data):
    return etree.fromstring(data, etree.XMLParser(resolve_entities=False, no_network=True))

def xml_bytes(root):
    return etree.tostring(root, encoding='UTF-8', xml_declaration=True, standalone=True)

def merge_docx(payload, out):
    sources = verified_sources(payload)
    if len({(a.get('templateId'), a.get('templateVersion')) for a, _ in sources}) != 1:
        raise ValueError('DOCX_MIXED_FORMS')
    with ZipFile(sources[0][1]) as first:
        content = {n: first.read(n) for n in first.namelist()}
    document = xml(content['word/document.xml'])
    body = document.find('{%s}body' % W)
    rels = xml(content['word/_rels/document.xml.rels'])
    types = xml(content['[Content_Types].xml'])
    for index, (_, path) in enumerate(sources[1:], 1):
        with ZipFile(path) as z:
            entries = {n: z.read(n) for n in z.namelist()}
        # Combining different style/numbering definitions would silently alter
        # the saved form. Same immutable template versions share these parts.
        for shared in ('word/styles.xml', 'word/numbering.xml'):
            if content.get(shared) != entries.get(shared):
                raise ValueError('DOCX_STYLE_MISMATCH')
        prefix = 'pack%d/' % index
        mapping = {n: prefix + n for n in entries if n not in ('[Content_Types].xml', 'word/document.xml', '_rels/.rels', 'word/_rels/document.xml.rels')}
        for name, destination in mapping.items():
            data = entries[name]
            if name.endswith('.rels'):
                tree = xml(data)
                for rel in tree:
                    if rel.get('TargetMode') == 'External':
                        continue
                    owner_dir = posixpath.dirname(posixpath.dirname(name))
                    target = posixpath.normpath(posixpath.join(owner_dir, rel.get('Target')))
                    # Entire dependency graph lives under its source prefix,
                    # so relative relationship targets remain unchanged.
                    if target not in mapping:
                        raise ValueError('DOCX_RELATIONSHIP_UNSUPPORTED')
                data = xml_bytes(tree)
            content[destination] = data
        incoming_types = xml(entries['[Content_Types].xml'])
        for entry in incoming_types:
            if entry.tag == '{%s}Default' % CT:
                if not any(t.tag == entry.tag and t.get('Extension') == entry.get('Extension') for t in types):
                    types.append(copy.deepcopy(entry))
            else:
                name = entry.get('PartName', '').lstrip('/')
                if name in mapping:
                    added = copy.deepcopy(entry)
                    added.set('PartName', '/' + mapping[name])
                    types.append(added)
        incoming = xml(entries['word/document.xml'])
        incoming_body = incoming.find('{%s}body' % W)
        # OOXML's section type describes the start of the section whose content
        # precedes it. Source cards contain continuous sections and page anchors;
        # forcing the previous section alone can overlay the next saved card.
        # Start the incoming card's first section on a fresh page. Keep every
        # internal section, page box, margin, drawing and font unchanged.
        first_incoming_section = next(incoming_body.iter('{%s}sectPr' % W), None)
        if first_incoming_section is not None:
            kind = first_incoming_section.find('{%s}type' % W)
            if kind is None:
                kind = etree.Element('{%s}type' % W)
                page_size = first_incoming_section.find('{%s}pgSz' % W)
                first_incoming_section.insert(first_incoming_section.index(page_size) if page_size is not None else 0, kind)
            kind.set('{%s}val' % W, 'nextPage')
        ids = {}
        for rel in xml(entries['word/_rels/document.xml.rels']):
            added = copy.deepcopy(rel)
            old_id = added.get('Id')
            new_id = 'pack%d_%s' % (index, old_id)
            added.set('Id', new_id)
            ids[old_id] = new_id
            if added.get('TargetMode') != 'External':
                target = posixpath.normpath(posixpath.join('word', added.get('Target')))
                if target not in mapping:
                    raise ValueError('DOCX_RELATIONSHIP_UNSUPPORTED')
                added.set('Target', posixpath.relpath(mapping[target], 'word'))
            rels.append(added)
        previous_section = body.find('{%s}sectPr' % W)
        if previous_section is not None:
            body.remove(previous_section)
            paragraph = etree.SubElement(body, '{%s}p' % W)
            props = etree.SubElement(paragraph, '{%s}pPr' % W)
            props.append(previous_section)
        else:
            paragraph = etree.SubElement(body, '{%s}p' % W)
            run = etree.SubElement(paragraph, '{%s}r' % W)
            br = etree.SubElement(run, '{%s}br' % W)
            br.set('{%s}type' % W, 'page')
        for element in incoming_body:
            element = copy.deepcopy(element)
            for node in element.iter():
                for key, value in list(node.attrib.items()):
                    if key.startswith('{%s}' % R) and value in ids:
                        node.set(key, ids[value])
            body.append(element)
    content['word/document.xml'] = xml_bytes(document)
    content['word/_rels/document.xml.rels'] = xml_bytes(rels)
    content['[Content_Types].xml'] = xml_bytes(types)
    with ZipFile(out, 'w', ZIP_DEFLATED) as z:
        for name, data in content.items():
            z.writestr(name, data)
    return {'files': [{'artifactId': a['id'], 'sha256': a['sha256']} for a, _ in sources], 'originalsUnchanged': True}
