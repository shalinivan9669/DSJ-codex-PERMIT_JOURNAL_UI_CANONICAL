"""Fill the private, SHA-pinned Word protocols without rebuilding the printed forms."""
from copy import deepcopy
from functools import lru_cache
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import re

from lxml import etree as E

from archive_forms import (PART, W, _fill, _media, _tokens, _serialize, _unique_ids, archive_fields,
                           combine_archive_parts, protocol_group_fields)
from build_archive_templates import NS, namespaces, prepare_source, put_text
from original_archive_slots import _replace, _runs
from sanitize_templates import deterministic_zip
from template_validation import inspect_package


IDS = frozenset({'biot-protocol', 'pb-protocol', 'ptm-protocol', 'ps-protocol'})
PLANS = Path(__file__).resolve().parents[2] / 'assets/templates/archive-20261109-blueprints.json'
DATE = r'«\d{1,2}»\s+[А-Яа-яЁёӘәӨөҰұҮүҚқҒғІіҢң]+\s+\d{4}'
DOC = 'word/document.xml'


@lru_cache(maxsize=1)
def registry():
    result = {}
    for plan in json.loads(PLANS.read_text(encoding='utf8')):
        if plan['id'] in IDS:
            result[(plan['id'], plan['sourceSha256'])] = (plan, None)
            for extra in plan.get('appendSources', []):
                if plan['id'] != 'ps-protocol':
                    raise ValueError('ORIGINAL_PROTOCOL_SECOND_SOURCE')
                result[(plan['id'], extra['sourceSha256'])] = ({**extra, 'id': plan['id']}, 'KZ')
    return result


def language(template_id, checksum):
    return registry()[(template_id, checksum)][1]


def _slots(plan, parts):
    tid = plan['id']
    roster = plan['roster']
    table = list(parts[DOC].iter(W + 'tbl'))[roster['tableIndex']]
    rows = table.findall(W + 'tr')
    if len(rows) != roster['headerRows'] + 1:
        raise ValueError('ORIGINAL_PROTOCOL_ROSTER')
    row = rows[-1]
    for slot in plan['paragraphSlots']:
        part = parts[slot['part']]
        nodes = part.xpath(slot['xpath'], namespaces=namespaces(part))
        if len(nodes) != 1:
            raise ValueError('ORIGINAL_PROTOCOL_SLOT')
        p, value = nodes[0], slot['value']
        if row in p.iterancestors():
            continue
        texts = _runs(p)
        original = ''.join(x.text or '' for x in texts)
        # Keep each separately formatted date, the gap between language columns,
        # all statutory wording and the run containing the original number.
        if tid in {'biot-protocol', 'pb-protocol', 'ptm-protocol'} and '{{PROTOCOL_DATE}}' in value:
            if _replace(texts, DATE, '{{PROTOCOL_DATE}}') != 2:
                raise ValueError('ORIGINAL_PROTOCOL_DATES')
        elif '{{HOURS}}' in value:
            if _replace(texts, r'(?<!\d)10(?=[-\s])', '{{HOURS}}') != 1:
                raise ValueError('ORIGINAL_PROTOCOL_HOURS')
        elif tid == 'biot-protocol' and 'REASON_KZ' in value:
            value = '{{APPROVAL_BASIS}} негiзiнде емтихан қабылдап, мынаны анықтады: {{REASON_KZ}}'
            put_text(p, value)
        elif tid == 'biot-protocol' and 'REASON_RU' in value:
            put_text(p, 'На основании {{APPROVAL_BASIS}} приняла экзамен и установила: {{REASON_RU}}')
        elif tid == 'ptm-protocol' and original.startswith('от «'):
            put_text(p, '{{APPROVAL_BASIS}} квалификационная комиссия в составе')
        elif tid == 'ptm-protocol' and 'бұйрығына' in original:
            put_text(p, '{{APPROVAL_BASIS}} сәйкес біліктілік комиссиясы мынадай құрамда:')
        else:
            put_text(p, value)

    cells = row.findall(W + 'tc')
    if len(cells) != len(roster['rowValues']):
        raise ValueError('ORIGINAL_PROTOCOL_COLUMNS')
    for i, (cell, value) in enumerate(zip(cells, roster['rowValues'])):
        paragraphs = cell.findall(W + 'p')
        if not paragraphs:
            raise ValueError('ORIGINAL_PROTOCOL_CELL')
        if i == 0:
            # All five originals already number the rows in Word. Retain their
            # list definition, indent and hanging punctuation; no second number.
            if not cell.xpath('w:p/w:pPr/w:numPr/w:numId', namespaces=NS):
                raise ValueError('ORIGINAL_PROTOCOL_NUMBERING')
            continue
        vals = [value] + [''] * (len(paragraphs) - 1)
        if value == '{{POSITION_BOTH}}' and len(vals) == 2:
            vals = ['{{POSITION_RU}}', '{{POSITION_KZ}}']
        for paragraph, value in zip(paragraphs, vals):
            put_text(paragraph, value)


@lru_cache(maxsize=5)
def projection(data, template_id):
    checksum = sha256(data).hexdigest()
    if (template_id, checksum) not in registry():
        raise ValueError('ORIGINAL_PROTOCOL_HASH')
    plan, _lang = registry()[(template_id, checksum)]
    files, report = prepare_source(data, plan, original_protocol_slots=_slots)
    stream = BytesIO()
    deterministic_zip(stream, files)
    stream.seek(0)
    files = inspect_package(stream)
    fields = set().union(*(_tokens(E.fromstring(blob)) for name, blob in files.items() if PART.fullmatch(name)))
    if not fields or fields != set(report['fields']):
        raise ValueError('ORIGINAL_PROTOCOL_FIELDS')
    return files, report


def _fields(fields):
    # A single value in both languages only needs printing once in a joint cell.
    fields = dict(fields)
    for key in ['FULL_NAME', 'POSITION', 'WORKPLACE', 'ISSUER']:
        fields[key + '_BOTH'] = ' / '.join(dict.fromkeys(fields[key + '_' + lang] for lang in ('RU', 'KZ')
                                                          if fields[key + '_' + lang]))
    return fields


def _form(data, template_id, snapshot, items, header, fields):
    plan, _lang = registry()[template_id, sha256(data).hexdigest()]
    source, report = projection(data, template_id)
    files = dict(source)
    trees = {name: E.fromstring(blob) for name, blob in source.items() if PART.fullmatch(name)}
    roster = plan['roster']
    table = list(trees[DOC].iter(W + 'tbl'))[roster['tableIndex']]
    prototype = table.findall(W + 'tr')[roster['headerRows']]
    pos = table.index(prototype)
    table.remove(prototype)
    if len(items) > 1:
        # Only the source captions repeat on following pages. PTM marked its
        # sole sample participant as another header in the original.
        for row in table.findall(W + 'tr'):
            props = row.find(W + 'trPr')
            if props is None:
                props = E.Element(W + 'trPr')
                row.insert(0, props)
            if props.find(W + 'tblHeader') is None:
                E.SubElement(props, W + 'tblHeader')
        props = prototype.find(W + 'trPr')
        for repeat in props.findall(W + 'tblHeader'):
            props.remove(repeat)
        if props.find(W + 'cantSplit') is None:
            props.insert(0, E.Element(W + 'cantSplit'))
    if template_id == 'pb-protocol' and len(items) >= 3:
        # This form puts two empty spacers between the roster and signature
        # table. Reclaim that space for extra people, keeping the row labels
        # beside their signature lines without moving columns or shrinking type.
        spacer = table.getnext()
        while (spacer is not None and spacer.tag == W + 'p'
               and not ''.join(spacer.itertext()).strip()
               and all(node.tag not in {W + 'pict', W + 'drawing', W + 'sectPr', W + 'br'}
                       for node in spacer.iter())):
            sibling = spacer.getnext()
            table.getparent().remove(spacer)
            spacer = sibling
    for tree in trees.values():
        _fill(tree, _fields(fields))
    for i, item in enumerate(items):
        row = deepcopy(prototype)
        _fill(row, _fields(archive_fields(snapshot, item, i + 1)))
        if i:
            _unique_ids(row, i)
        table.insert(pos + i, row)
    for name, tree in trees.items():
        files[name] = _serialize(tree)
    _media(files, report, snapshot, header)
    return files


def _sources(snapshot, path):
    tid = snapshot['templateId']
    primary = Path(path).read_bytes()
    key = (tid, sha256(primary).hexdigest())
    if key not in registry() or registry()[key][1] is not None:
        raise ValueError('ORIGINAL_PROTOCOL_PRIMARY_HASH')
    if tid != 'ps-protocol':
        return [primary]
    ref = snapshot.get('originalKazakhSource')
    if not isinstance(ref, dict) or not isinstance(ref.get('storageKey'), str) or (tid, ref.get('sha256')) not in registry() or language(tid, ref['sha256']) != 'KZ':
        raise ValueError('ORIGINAL_PROTOCOL_KZ_REQUIRED')
    store = Path(os.environ['DEMO_ARTIFACT_ROOT']).resolve()
    secondary = (store / ref['storageKey']).resolve()
    if not secondary.is_relative_to(store) or not secondary.is_file() or secondary.stat().st_size > 10 * 1024 * 1024:
        raise ValueError('ORIGINAL_PROTOCOL_KZ_PATH')
    data = secondary.read_bytes()
    if sha256(data).hexdigest() != ref['sha256']:
        raise ValueError('ORIGINAL_PROTOCOL_KZ_HASH')
    return [primary, data]


def render_protocol(snapshot, path, item=None):
    if item is None:
        header, fields = protocol_group_fields(snapshot)
        items = snapshot['items']
    else:
        header, fields = item, archive_fields(snapshot, item)
        items = [item]
    documents = [_form(data, snapshot['templateId'], snapshot, items, header, fields)
                 for data in _sources(snapshot, path)]
    return documents[0] if len(documents) == 1 else combine_archive_parts(documents)
