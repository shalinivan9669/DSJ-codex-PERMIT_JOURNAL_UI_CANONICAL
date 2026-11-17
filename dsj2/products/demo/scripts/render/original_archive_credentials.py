"""Personalize the archive certificate and print the supplied witness cover."""
from copy import deepcopy
from functools import lru_cache
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import re
from zipfile import ZipFile

from lxml import etree as E

from archive_forms import _fill, _serialize, archive_fields, combine_archive_parts
from build_archive_templates import W, prepare_source
from english_appendix import append_english_pages, validate_english
from package_xml import normalize_package
from request_limits import MAX_REQUEST_ROWS
from sanitize_templates import deterministic_zip
from source_fidelity import add_floating_mark
from template_validation import inspect_package

SOURCES = {
    'biot-itr-certificate': ('обычный серт.docx', '042b69ba6a23e2ad6a2e9570bdbbe2dcf4397ef86e3ce2375cdbbe0e0b00b7b2'),
    'ps-witness': ('ФОРМА СВИДЕТЕЛЬСТВА - А4 - ТИТУЛЬНЫЙ.docx', '9806954040e5e3b30abf1d5df70a3596b48a66162f6c641aa32979a93e806313'),
}
# This exact registered version supplies the personalized inside page missing from the RAR.
WITNESS_INSIDE = Path(__file__).resolve().parents[2] / 'assets/templates/ps-witness.v15.docx'
WITNESS_INSIDE_SHA256 = '4d6827fd5963c16894758da82f6a46cd7fcdccc490254be638ccbfecb39bda35'


def match_credential(path, template_id):
    return (template_id in SOURCES and Path(path).stat().st_size <= 10 * 1024 * 1024
            and sha256(Path(path).read_bytes()).hexdigest() == SOURCES[template_id][1])


def _slots(template_id, root):
    if template_id == 'ps-witness':
        return
    # Inclusive text-run ranges in the hash-pinned overprint sheet. Spacer runs
    # between dates and before the city/name are part of the form's positioning.
    ranges = {
        13: [(0, 4, '{{FULL_NAME_RU}}')],
        15: [(0, 2, '«{{SUBJECT_KZ}}»')],
        20: [(16, 16, '{{HEAD}}')],
        22: [(3, 3, '{{CITY_RU}}   ')],
        23: [(0, 1, '{{ISSUE_DAY}}'), (6, 6, '{{ISSUE_MONTH_RU}}'), (12, 13, '{{ISSUE_YEAR_SHORT}}')],
        27: [(3, 3, '«{{SUBJECT_RU}}»')],
        36: [(5, 8, '{{NUMBER}}')],
    }
    paragraphs = list(root.iter(W + 'p'))
    for index, slots in ranges.items():
        nodes = list(paragraphs[index].iter(W + 't'))
        for first, last, value in slots:
            nodes[first].text = value
            for node in nodes[first + 1:last + 1]:
                node.text = ''


@lru_cache(maxsize=2)
def _project(data, template_id):
    source, checksum = SOURCES[template_id]
    blueprint = {'source': source, 'sourceSha256': checksum, 'id': template_id, 'mergeFields': {}}
    files, report = prepare_source(data, blueprint, original_credential_slots=_slots)
    stream = BytesIO()
    deterministic_zip(stream, files)
    stream.seek(0)
    return inspect_package(stream), report


@lru_cache(maxsize=1)
def _inside_contract():
    if sha256(WITNESS_INSIDE.read_bytes()).hexdigest() != WITNESS_INSIDE_SHA256:
        raise ValueError('ARCHIVE_WITNESS_INSIDE_CHECKSUM')
    with ZipFile(WITNESS_INSIDE) as source:
        root = E.fromstring(source.read('word/document.xml'))
    fields = re.findall(r'\{\{([A-Z][A-Z0-9_]*)\}\}', ''.join(root.itertext()))
    return sorted(set(fields)), dict(next(root.iter(W + 'pgSz')).attrib)


def credential_fields(path, template_id):
    _, report = _project(Path(path).read_bytes(), template_id)
    # The cover is static. Its registered two-page form gets every variable
    # field from the pinned personalized insert.
    return list(_inside_contract()[0] if template_id == 'ps-witness' else report['fields'])


def credential_layout(path, template_id):
    files, _ = _project(Path(path).read_bytes(), template_id)
    sections = [dict(size.attrib) for size in E.fromstring(files['word/document.xml']).iter(W + 'pgSz')]
    if template_id == 'ps-witness':
        sections.append(dict(_inside_contract()[1]))
    return False, sections


def _witness_inside(snapshot, item):
    from neutral_forms import render_neutral_one
    if sha256(WITNESS_INSIDE.read_bytes()).hexdigest() != WITNESS_INSIDE_SHA256:
        raise ValueError('ARCHIVE_WITNESS_INSIDE_CHECKSUM')
    files = render_neutral_one(snapshot, item, WITNESS_INSIDE)
    document = E.fromstring(files['word/document.xml'])
    body = document.find(W + 'body')
    tables = [table for table in body.findall(W + 'tbl')
              if 'Кәсіптік білім даярлау туралы' in ''.join(table.itertext())]
    if len(tables) != 1:
        raise ValueError('ARCHIVE_WITNESS_INSIDE_LAYOUT')
    table = tables[0]
    section = next((section for sibling in table.itersiblings()
                    for section in sibling.iter(W + 'sectPr')), None)
    if section is None:
        raise ValueError('ARCHIVE_WITNESS_INSIDE_SECTION')
    # The previous booklet anchors this table as a float on its portrait page.
    # Make it inline at the start of the insert so Writer opens the portrait
    # section before laying out its participant and registration information.
    table_properties = table.find(W + 'tblPr')
    floating = table_properties.find(W + 'tblpPr')
    if floating is not None:
        table_properties.remove(floating)
    section = deepcopy(section)
    # The old floating table took its x-coordinate from the page. As an inline
    # table it uses the section margins, so center its existing two-column grid.
    width = int(table_properties.find(W + 'tblW').get(W + 'w'))
    page_width = int(section.find(W + 'pgSz').get(W + 'w'))
    margin = str((page_width - width) // 2)
    for side in ['left', 'right']:
        section.find(W + 'pgMar').set(W + side, margin)
    body[:] = [table, section]
    files['word/document.xml'] = _serialize(document)
    return files


def _pages(snapshot, item, path):
    template_id = snapshot['templateId']
    source, _ = _project(Path(path).read_bytes(), template_id)
    files = dict(source)
    if template_id == 'ps-witness':
        return [files, _witness_inside(snapshot, item)]
    fields = archive_fields(snapshot, item)
    for name in ['SUBJECT_KZ', 'SUBJECT_RU']:
        fields[name] = fields[name].strip('«»').upper()
    root = E.fromstring(files['word/document.xml'])
    _fill(root, fields)
    files['word/document.xml'] = _serialize(root)
    return [files]


def _combine(pages):
    if len(pages) == 1:
        return pages[0]
    files = combine_archive_parts(pages)
    # Neither source has a printed header. The blank headers used for section
    # isolation must occupy zero space, as on the original title sheet.
    root = E.fromstring(files['word/document.xml'])
    for margin in root.iter(W + 'pgMar'):
        margin.set(W + 'header', '0')
    files['word/document.xml'] = _serialize(root)
    return files


def render_credential_one(snapshot, item, path):
    return _combine(_pages(snapshot, item, path))


def render_credential_document(snapshot, output, path):
    validate_english(snapshot)
    if snapshot.get('groupEvent') or not 1 <= len(snapshot['items']) <= MAX_REQUEST_ROWS:
        raise ValueError('ARCHIVE_CREDENTIAL_ITEMS')
    pages = [page for item in snapshot['items'] for page in _pages(snapshot, item, path)]
    if snapshot['templateId'] == 'biot-itr-certificate' and len(pages) > 1:
        pages = [combine_archive_parts(pages, same_original_card=True)]
    if snapshot.get('demoMode') or snapshot.get('mode') == 'draft-preview':
        prefix = 'ДЕМО' if snapshot.get('demoMode') else 'ПРЕДПРОСМОТР'
        for page in pages:
            add_floating_mark(page, prefix + ' — НЕ ЯВЛЯЕТСЯ ВЫДАННЫМ ДОКУМЕНТОМ', encoding='utf-8')
    files = _combine(pages)
    if snapshot.get('englishAppendix'):
        files = normalize_package(append_english_pages(files, snapshot))
    deterministic_zip(output, files)
