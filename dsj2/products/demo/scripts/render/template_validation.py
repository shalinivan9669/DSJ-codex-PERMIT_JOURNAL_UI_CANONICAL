"""Inspect untrusted DOCX before previewing or registering an immutable form."""
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
from zipfile import ZipFile, BadZipFile
from lxml import etree as E

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
ROOT = Path(__file__).resolve().parents[2]


def inspect_package(path):
    try:
        with ZipFile(path) as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            if len(entries) > 1000 or len(set(names)) != len(names):
                raise ValueError('TEMPLATE_PACKAGE_LIMIT')
            if sum(entry.file_size for entry in entries) > 30 * 1024 * 1024:
                raise ValueError('TEMPLATE_PACKAGE_LIMIT')
            files = {}
            for entry in entries:
                name = entry.filename
                if PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts or '\\' in name or entry.flag_bits & 1:
                    raise ValueError('TEMPLATE_PACKAGE_UNSAFE')
                if any(part in name.lower() for part in ['vbaproject', 'activex/', 'embeddings/', 'externallinks/']):
                    raise ValueError('TEMPLATE_ACTIVE_CONTENT')
                files[name] = archive.read(name)
    except BadZipFile:
        raise ValueError('TEMPLATE_DOCX_REQUIRED')
    if '[Content_Types].xml' not in files or 'word/document.xml' not in files:
        raise ValueError('TEMPLATE_DOCX_REQUIRED')
    for name, data in files.items():
        if name.endswith(('.xml', '.rels')):
            if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
                raise ValueError('TEMPLATE_ACTIVE_CONTENT')
            root = E.fromstring(data, E.XMLParser(resolve_entities=False, no_network=True))
            for node in root.iter():
                if not isinstance(node.tag, str):
                    continue
                if node.get('TargetMode') == 'External':
                    raise ValueError('TEMPLATE_EXTERNAL_REFERENCE')
                if E.QName(node).localname in ['altChunk', 'object', 'control', 'attachedTemplate']:
                    raise ValueError('TEMPLATE_ACTIVE_CONTENT')
                if node.tag == W + 'instrText' and re.search(r'\b(DDE|INCLUDETEXT|INCLUDEPICTURE|LINK)\b', node.text or '', re.I):
                    raise ValueError('TEMPLATE_ACTIVE_CONTENT')
    return files


def validate_template(payload, out):
    files = inspect_package(payload['inputPath'])
    source = ROOT / 'assets/templates' / payload['sourceFile']
    if source.parent.resolve() != (ROOT / 'assets/templates').resolve():
        raise ValueError('TEMPLATE_SOURCE_INVALID')
    original = inspect_package(source)
    if hashlib.sha256(source.read_bytes()).hexdigest() != payload['sourceChecksum']:
        raise ValueError('TEMPLATE_SOURCE_HASH')
    template_id = payload['templateId']
    root = E.fromstring(files['word/document.xml'])
    source_root = E.fromstring(original['word/document.xml'])
    # Positional printing layouts require their cells/bookmarks and source slots.
    # LMS forms use named tokens and permit layout changes while retaining fields.
    if template_id.startswith('lms-'):
        marker = json.loads(files.get('demo/lms-form.json', b'{}'))
        expected_marker = json.loads(original.get('demo/lms-form.json', b'{}'))
        if marker != expected_marker:
            raise ValueError('TEMPLATE_IDENTITY_CHANGED')
        original_fields = set(re.findall(r'\{\{([A-Z_0-9]+)\}\}', ''.join(source_root.itertext())))
        nodes = [node.text or '' for node in root.iter(W + 't')]
        found = set(re.findall(r'\{\{([A-Z_0-9]+)\}\}', ''.join(nodes)))
        complete = set(field for text in nodes for field in re.findall(r'\{\{([A-Z_0-9]+)\}\}', text))
        if found != original_fields or complete != original_fields:
            raise ValueError('TEMPLATE_FIELDS_CHANGED')
        fields = sorted(found)
    else:
        # Ordinary layouts are checksum-addressed: their editable text slots
        # and structural tree must remain stable, while formatting can change.
        def structure(tree):
            return [(E.QName(node).localname, node.get(W + 'name'), node.get(W + 'val')) for node in tree.iter() if isinstance(node.tag, str) and E.QName(node).localname in ['tbl','tr','tc','sdt','tag','bookmarkStart']]
        if structure(root) != structure(source_root):
            raise ValueError('TEMPLATE_STRUCTURE_CHANGED')
        def slots(tree):
            return sorted(re.findall(r'⟦[^⟧]+⟧|\{\{[^}]+\}\}', ''.join(tree.itertext())))
        if slots(root) != slots(source_root):
            raise ValueError('TEMPLATE_FIELDS_CHANGED')
        fields = slots(root)
    if not template_id.startswith('lms-'):
        files['demo/template-source.json'] = json.dumps({'templateId': template_id, 'sourceChecksum': payload['sourceChecksum'], 'policy': 'VALIDATED_TEMPLATE_DERIVATIVE_V1'}).encode()
    from sanitize_templates import deterministic_zip
    deterministic_zip(out, files)
    result = {'validated': True, 'templateId': template_id, 'fields': fields, 'sourceChecksum': payload['sourceChecksum'], 'entries': len(files), 'version': 1}
    return result
