"""Inspect untrusted DOCX before previewing or registering an immutable form."""
import hashlib
import json
import re
from collections import Counter
from pathlib import Path, PurePosixPath
from posixpath import dirname, normpath
from zipfile import ZipFile, BadZipFile
from lxml import etree as E

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
ROOT = Path(__file__).resolve().parents[2]


def _archive_relationships(package):
    edges, references = {}, {}
    for part, data in package.items():
        if not part.endswith('.rels'):
            continue
        owner = '' if part == '_rels/.rels' else part.replace('/_rels/', '/').removesuffix('.rels')
        by_id = {}
        for node in E.fromstring(data):
            target = node.get('Target', '')
            resolved = target.lstrip('/') if target.startswith('/') else normpath(dirname(owner) + '/' + target).lstrip('/')
            if not target or resolved not in package or node.get('Id') in by_id:
                raise ValueError('TEMPLATE_RELATIONSHIPS_CHANGED')
            by_id[node.get('Id')] = (node.get('Type'), resolved)
        edges[owner] = Counter(by_id.values())
        references[owner] = by_id
    return edges, references


def _archive_editor_headers(files, original, source_trees, edited_trees):
    """Drop only inactive first-page header copies emitted by Office saving.

    Their content must equal the same section's default story. All active
    section/role bindings remain pinned, even when an editor renumbers rIds.
    """
    from archive_forms import R, CT
    _, source_refs = _archive_relationships(original)
    _, edited_refs = _archive_relationships(files)
    source_sections = list(source_trees['word/document.xml'].iter(W + 'sectPr'))
    edited_sections = list(edited_trees['word/document.xml'].iter(W + 'sectPr'))
    if len(source_sections) != len(edited_sections):
        raise ValueError('TEMPLATE_STRUCTURE_CHANGED')

    def enabled(section):
        node = section.find(W + 'titlePg')
        return node is not None and node.get(W + 'val', 'true') not in ('false', '0', 'off')

    def binding(node, references):
        edge = references.get('word/document.xml', {}).get(node.get(R + 'id'))
        if edge is None:
            raise ValueError('TEMPLATE_RELATIONSHIPS_CHANGED')
        return edge

    def content(part):
        tree = edited_trees[part]
        return (''.join(node.text or '' for node in tree.iter(W + 't')),
                Counter(edited_refs.get(part, {}).values()))

    removed = set()
    for source_section, edited_section in zip(source_sections, edited_sections):
        if enabled(source_section) != enabled(edited_section):
            raise ValueError('TEMPLATE_STRUCTURE_CHANGED')
        expected = {(node.tag, node.get(W + 'type')): binding(node, source_refs)
                    for node in source_section if node.tag in (W + 'headerReference', W + 'footerReference')}
        seen = set()
        for node in list(edited_section):
            if node.tag not in (W + 'headerReference', W + 'footerReference'):
                continue
            key = (node.tag, node.get(W + 'type'))
            if key in seen:
                raise ValueError('TEMPLATE_STRUCTURE_CHANGED')
            seen.add(key)
            edge = binding(node, edited_refs)
            if key in expected:
                if edge != expected[key]:
                    raise ValueError('TEMPLATE_RELATIONSHIPS_CHANGED')
                continue
            default = expected.get((node.tag, 'default'))
            if (key[1] != 'first' or enabled(edited_section) or default is None
                    or edge[1] in original or edge[1] not in edited_trees
                    or default[1] not in edited_trees or content(edge[1]) != content(default[1])):
                raise ValueError('TEMPLATE_RELATIONSHIPS_CHANGED')
            removed.add(edge[1])
            edited_section.remove(node)
        if not expected.keys() <= seen:
            raise ValueError('TEMPLATE_RELATIONSHIPS_CHANGED')
    if set(edited_trees) - set(source_trees) != removed:
        raise ValueError('TEMPLATE_STRUCTURE_CHANGED')
    if not removed:
        return
    document = edited_trees['word/document.xml']
    used = {node.get(attribute) for node in document.iter()
            for attribute in (R + 'id', R + 'embed', R + 'link') if node.get(attribute)}
    relpart = 'word/_rels/document.xml.rels'
    rels = E.fromstring(files[relpart])
    for relation in list(rels):
        if edited_refs['word/document.xml'][relation.get('Id')][1] in removed:
            if relation.get('Id') in used:
                raise ValueError('TEMPLATE_RELATIONSHIPS_CHANGED')
            rels.remove(relation)
    for part in removed:
        files.pop(part)
        edited_trees.pop(part)
        files.pop(dirname(part) + '/_rels/' + PurePosixPath(part).name + '.rels', None)
    types = E.fromstring(files['[Content_Types].xml'])
    for node in list(types):
        if node.tag == CT + 'Override' and node.get('PartName', '').lstrip('/') in removed:
            types.remove(node)
    for part, tree in [('word/document.xml', document), (relpart, rels), ('[Content_Types].xml', types)]:
        files[part] = E.tostring(tree, encoding='utf-8', xml_declaration=True)


def _archive_editor_grid(source, edited):
    """Office can materialize a source row's omitted leading/trailing grid."""
    source_tables, edited_tables = list(source.iter(W + 'tbl')), list(edited.iter(W + 'tbl'))
    if len(source_tables) != len(edited_tables):
        return
    for source_table, edited_table in zip(source_tables, edited_tables):
        source_rows, edited_rows = source_table.findall(W + 'tr'), edited_table.findall(W + 'tr')
        if len(source_rows) != len(edited_rows):
            continue
        for source_row, edited_row in zip(source_rows, edited_rows):
            for key, leading in [('gridBefore', True), ('gridAfter', False)]:
                source_gap = source_row.find(W + 'trPr/' + W + key)
                if source_gap is None or edited_row.find(W + 'trPr/' + W + key) is not None:
                    continue
                gap = int(source_gap.get(W + 'val', '0'))
                cells = edited_row.findall(W + 'tc')
                removed, width = [], 0
                for cell in cells if leading else reversed(cells):
                    if width >= gap:
                        break
                    # Never discard a value, field, drawing, bookmark or reference.
                    if any((node.text or '').strip() for node in cell.iter(W + 't')) or any(
                            isinstance(node.tag, str) and E.QName(node).localname in
                            ('drawing', 'pict', 'tbl', 'bookmarkStart', 'bookmarkEnd', 'sdt') for node in cell.iter()):
                        break
                    span = cell.find(W + 'tcPr/' + W + 'gridSpan')
                    width += int(span.get(W + 'val', '1')) if span is not None else 1
                    removed.append(cell)
                if width != gap or len(cells) - len(removed) != len(source_row.findall(W + 'tc')):
                    continue
                for cell in removed:
                    edited_row.remove(cell)
                props = edited_row.find(W + 'trPr')
                if props is None:
                    props = E.Element(W + 'trPr'); edited_row.insert(0, props)
                E.SubElement(props, W + key, {W + 'val': str(gap)})


def _archive_derivative(files, original, template_id):
    # Import lazily: archive rendering itself uses inspect_package above.
    from archive_forms import MARKER, PART, MEDIA, TOKEN, R, _marker, _tokens, _paragraph_texts
    expected = _marker(original[MARKER], template_id)
    # Office editors may discard an unreferenced custom part when saving. The
    # selected, checksum-verified bundled source is the only recovery authority.
    marker = _marker(files[MARKER], template_id) if MARKER in files else expected
    if marker != expected:
        raise ValueError('TEMPLATE_IDENTITY_CHANGED')

    # A derivative may edit the form, not bring another mail-merge source or
    # hidden source document back into an already sanitized package.
    harmless_added = re.compile(r'(?:docProps/(?:core|app)\.xml|word/(?:styles(?:WithEffects)?|numbering|fontTable|settings|webSettings)\.xml|word/theme/theme[0-9]+\.xml)\Z')
    for part in files:
        if part.startswith(('customXml/', 'word/recipientData', 'word/comments', 'word/people', 'docProps/thumbnail')):
            raise ValueError('TEMPLATE_ACTIVE_CONTENT')
        editor_header = re.fullmatch(r'word/(?:_rels/)?(?:header|footer)[0-9]+\.xml(?:\.rels)?', part)
        if part not in original and part != 'demo/template-source.json' and not harmless_added.fullmatch(part) and not editor_header:
            raise ValueError('TEMPLATE_PACKAGE_CHANGED')

    def trees(package):
        result = {}
        for part, data in package.items():
            if not part.endswith('.xml'):
                continue
            tree = E.fromstring(data)
            if part.startswith('word/'):
                for node in tree.iter():
                    if not isinstance(node.tag, str):
                        continue
                    if E.QName(node).localname in ('mailMerge', 'docVars', 'binData', 'OLEObject',
                            'commentRangeStart', 'commentRangeEnd', 'commentReference', 'customXml', 'dataBinding'):
                        raise ValueError('TEMPLATE_ACTIVE_CONTENT')
                    if node.tag in (W + 'fldSimple', W + 'fldChar', W + 'instrText'):
                        raise ValueError('TEMPLATE_FIELDS_CHANGED')
            if PART.fullmatch(part):
                result[part] = tree
            elif _tokens(tree):
                raise ValueError('TEMPLATE_FIELDS_CHANGED')
        return result

    source_trees, edited_trees = trees(original), trees(files)
    _archive_editor_headers(files, original, source_trees, edited_trees)
    if source_trees.keys() != edited_trees.keys():
        raise ValueError('TEMPLATE_STRUCTURE_CHANGED')

    def tokens(tree):
        _tokens(tree)  # Reject malformed named fields as the renderer does.
        return Counter(match[1] for nodes in _paragraph_texts(tree)
                       for match in TOKEN.finditer(''.join(node.text or '' for node in nodes)))

    def structure(tree):
        values, bookmarks = [], Counter()
        for node in tree.iter():
            if not isinstance(node.tag, str) or E.QName(node).localname not in ('tbl', 'tr', 'tc', 'sdt', 'tag', 'bookmarkStart'):
                continue
            if node.tag == W + 'bookmarkStart':
                # Archive fields are named text tokens. Word's selection
                # bookmarks can move without changing any print field.
                bookmarks[(node.get(W + 'name'), node.get(W + 'val'))] += 1
                continue
            span = node.find(W + 'tcPr/' + W + 'gridSpan')
            merge = node.find(W + 'tcPr/' + W + 'vMerge')
            values.append((node.tag, node.get(W + 'name'), node.get(W + 'val'),
                           span.get(W + 'val', '1') if span is not None else '1',
                           merge.get(W + 'val', 'continue') if merge is not None else None))
        return values, bookmarks

    fields = set()
    for part, tree in edited_trees.items():
        _archive_editor_grid(source_trees[part], tree)
        found = tokens(tree)
        if found != tokens(source_trees[part]):
            raise ValueError('TEMPLATE_FIELDS_CHANGED')
        if structure(tree) != structure(source_trees[part]):
            raise ValueError('TEMPLATE_STRUCTURE_CHANGED')
        fields.update(found)
        files[part] = E.tostring(tree, encoding='utf-8', xml_declaration=True)
    if fields != set(marker['fields']):
        raise ValueError('TEMPLATE_FIELDS_CHANGED')

    # Row expansion is positional even though the fields themselves are named.
    # Keep each prototype cell's fields inside the same roster/signature scope.
    for roster in marker.get('rosters', [marker['roster']] if 'roster' in marker else []):
        prototypes = []
        for package_trees in (source_trees, edited_trees):
            tables = list(package_trees['word/document.xml'].iter(W + 'tbl'))
            index = roster['tableIndex']
            if index >= len(tables):
                raise ValueError('TEMPLATE_STRUCTURE_CHANGED')
            rows = tables[index].findall(W + 'tr')
            if len(rows) <= roster['headerRows']:
                raise ValueError('TEMPLATE_STRUCTURE_CHANGED')
            prototypes.append([tokens(cell) for cell in rows[roster['headerRows']].findall(W + 'tc')])
        if prototypes[0] != prototypes[1]:
            raise ValueError('TEMPLATE_FIELDS_CHANGED')

    source_edges, source_refs = _archive_relationships(original)
    edited_edges, edited_refs = _archive_relationships(files)
    # Editors may remove print-irrelevant web settings, embedded fonts, and
    # empty note separators. They may not add an alternative data source.
    optional_edges = {}
    used_numbering = any(node.get(W + 'val', '0') != '0'
        for part, data in original.items() if part.startswith('word/') and part.endswith('.xml')
        for node in E.fromstring(data).iter(W + 'numId'))
    for owner, counts in source_edges.items():
        optional_edges[owner] = Counter()
        for edge, count in counts.items():
            kind, target = edge[0].rsplit('/', 1)[-1], edge[1]
            optional = kind in ('font', 'webSettings') or (kind == 'numbering' and not used_numbering)
            if kind in ('footnotes', 'endnotes'):
                tree = E.fromstring(original[target])
                optional = not any((node.text or '').strip() for node in tree.iter(W + 't'))
                if optional and target in files and any((node.text or '').strip() for node in E.fromstring(files[target]).iter(W + 't')):
                    raise ValueError('TEMPLATE_PACKAGE_CHANGED')
            if optional:
                optional_edges[owner][edge] = count

    def retained_edges(edges):
        retained = {}
        for owner, counts in edges.items():
            keep = counts - optional_edges.get(owner, Counter())
            if keep:
                retained[owner] = keep
        return retained
    source_edges = retained_edges(source_edges)
    edited_edges = retained_edges(edited_edges)
    if source_edges != edited_edges:
        raise ValueError('TEMPLATE_RELATIONSHIPS_CHANGED')

    def picture_references(package_trees, references):
        found = Counter()
        for part, tree in package_trees.items():
            for node in tree.iter():
                for attribute in (R + 'id', R + 'embed', R + 'link'):
                    if attribute not in node.attrib:
                        continue
                    edge = references.get(part, {}).get(node.get(attribute))
                    if edge is None:
                        raise ValueError('TEMPLATE_RELATIONSHIPS_CHANGED')
                    found[(part, node.tag, attribute, edge)] += 1
        return found

    if picture_references(source_trees, source_refs) != picture_references(edited_trees, edited_refs):
        raise ValueError('TEMPLATE_RELATIONSHIPS_CHANGED')
    source_media = {part: data for part, data in original.items() if MEDIA.fullmatch(part)}
    edited_media = {part: data for part, data in files.items() if MEDIA.fullmatch(part)}
    if source_media != edited_media or any(entry['part'] not in files for entry in marker.get('dynamicMedia', [])):
        raise ValueError('TEMPLATE_MEDIA_CHANGED')
    if MARKER not in files:
        files[MARKER] = original[MARKER]
        from archive_forms import CT
        content_types = E.fromstring(files['[Content_Types].xml'])
        if not any(node.get('PartName') == '/' + MARKER for node in content_types):
            E.SubElement(content_types, CT + 'Override', PartName='/' + MARKER, ContentType='application/json')
        files['[Content_Types].xml'] = E.tostring(content_types, encoding='utf-8', xml_declaration=True)
    return sorted(fields)


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
    if 'demo/archive-form.json' in original:
        fields = _archive_derivative(files, original, template_id)
    elif 'demo/archive-form.json' in files:
        # Adding a new renderer policy to a legacy source is not a derivative.
        raise ValueError('TEMPLATE_IDENTITY_CHANGED')
    elif template_id.startswith('lms-'):
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
