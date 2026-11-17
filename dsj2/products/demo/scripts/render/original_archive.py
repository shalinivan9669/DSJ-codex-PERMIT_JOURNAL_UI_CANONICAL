"""Route exact archive uploads by template ID and hash; fill only frozen issuance data."""
from functools import lru_cache
from io import BytesIO
from pathlib import Path
import hashlib
import json

from lxml import etree as E

from archive_forms import PART, _fill, _media, _serialize, _tokens, archive_fields, combine_archive_parts
from build_archive_templates import prepare_source
from english_appendix import append_english_pages, validate_english
from package_xml import normalize_package
from request_limits import MAX_REQUEST_ROWS
from sanitize_templates import deterministic_zip
from source_fidelity import add_floating_mark
from template_validation import inspect_package
import original_archive_protocols as protocols


POLICY = 'ORIGINAL_ARCHIVE_20261117'
CARD_IDS = frozenset({'biot-worker-card', 'pb-card', 'ptm-card', 'ps-card'})
CREDENTIAL_IDS = frozenset({'ps-witness', 'biot-itr-certificate'})
BLUEPRINT_PATH = Path(__file__).resolve().parents[2] / 'assets/templates/archive-20261109-blueprints.json'


@lru_cache(maxsize=1)
def _blueprints():
    from original_archive_slots import card_blueprint
    entries = json.loads(BLUEPRINT_PATH.read_text(encoding='utf8'))
    return {entry['id']: card_blueprint(entry['id'], entry) for entry in entries if entry['id'] in CARD_IDS}


def match_original(path, template_id):
    if template_id not in CARD_IDS | CREDENTIAL_IDS | protocols.IDS or Path(path).stat().st_size > 10 * 1024 * 1024:
        return False
    if template_id in CREDENTIAL_IDS:
        from original_archive_credentials import match_credential
        return match_credential(path, template_id)
    digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    if template_id in protocols.IDS:
        return (template_id, digest) in protocols.registry()
    return digest == _blueprints()[template_id]['sourceSha256']


@lru_cache(maxsize=8)
def _projection(data, template_id, attach_photo):
    """Every recipient gets a fresh copy of the unpersonalized projected parts."""
    from original_archive_slots import apply_original_card_slots
    if template_id not in CARD_IDS:
        raise ValueError('ARCHIVE_CARD_REQUIRED')
    blueprint = _blueprints()[template_id]
    # prepare_source checks the bytes' SHA-256 before opening the OOXML package.
    files, report = prepare_source(data, blueprint, original_card_slots=apply_original_card_slots,
                                   attach_frame_photo=attach_photo)
    package = BytesIO()
    deterministic_zip(package, files)
    package.seek(0)
    files = inspect_package(package)
    fields = set().union(*(_tokens(E.fromstring(blob)) for name, blob in files.items() if PART.fullmatch(name)))
    if not fields or fields != set(report['fields']):
        raise ValueError('ARCHIVE_FIELDS_MISMATCH')
    return files, report


def _source_bytes(path):
    path = Path(path)
    if path.stat().st_size > 10 * 1024 * 1024:
        raise ValueError('TEMPLATE_PACKAGE_LIMIT')
    return path.read_bytes()


def original_fields(path, template_id):
    if template_id in CREDENTIAL_IDS:
        from original_archive_credentials import credential_fields
        return credential_fields(path, template_id)
    _, report = (protocols.projection(_source_bytes(path), template_id) if template_id in protocols.IDS else
                 _projection(_source_bytes(path), template_id, False))
    return list(report['fields'])


def original_layout(path, template_id):
    if template_id in CREDENTIAL_IDS:
        from original_archive_credentials import credential_layout
        return credential_layout(path, template_id)
    files, report = (protocols.projection(_source_bytes(path), template_id) if template_id in protocols.IDS else
                     _projection(_source_bytes(path), template_id, False))
    has_photo = any(media['kind'] == 'PHOTO' for media in report['dynamicMedia'])
    document = E.fromstring(files['word/document.xml'])
    sections = [dict(page.attrib) for page in document.iter(
        '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}pgSz')]
    return has_photo, sections


def _render_card(snapshot, item, data):
    from original_archive_slots import original_card_fields
    template_id = snapshot['templateId']
    source, report = _projection(data, template_id, bool(item.get('photoAssetId')))
    files = dict(source)
    fields = original_card_fields(template_id, archive_fields(snapshot, item), item)
    for name, content in source.items():
        if PART.fullmatch(name):
            tree = E.fromstring(content)
            if _tokens(tree):
                _fill(tree, fields)
                files[name] = _serialize(tree)
    _media(files, report, snapshot, item)
    return files


def render_original_one(snapshot, item, path):
    if snapshot['templateId'] in protocols.IDS:
        return protocols.render_protocol(snapshot, path, item)
    if snapshot['templateId'] in CREDENTIAL_IDS:
        from original_archive_credentials import render_credential_one
        return render_credential_one(snapshot, item, path)
    return _render_card(snapshot, item, _source_bytes(path))


def render_original_group(snapshot, path):
    if snapshot['templateId'] in protocols.IDS:
        return protocols.render_protocol(snapshot, path)
    raise ValueError('ARCHIVE_GROUP_VERSION')


def render_original_document(snapshot, output, path):
    template_id = snapshot['templateId']
    if template_id in CREDENTIAL_IDS:
        from original_archive_credentials import render_credential_document
        return render_credential_document(snapshot, output, path)
    validate_english(snapshot)
    if not 1 <= len(snapshot['items']) <= MAX_REQUEST_ROWS:
        raise ValueError('ARCHIVE_ROW_LIMIT')
    if snapshot.get('groupEvent'):
        files = render_original_group(snapshot, path)
    else:
        documents = [render_original_one(snapshot, item, path) for item in snapshot['items']]
        files = documents[0] if len(documents) == 1 else combine_archive_parts(documents, same_original_card=template_id in CARD_IDS)
    if snapshot.get('demoMode') or snapshot.get('mode') == 'draft-preview':
        prefix = 'ДЕМО' if snapshot.get('demoMode') else 'ПРЕДПРОСМОТР'
        add_floating_mark(files, prefix + ' — НЕ ЯВЛЯЕТСЯ ВЫДАННЫМ ДОКУМЕНТОМ', encoding='utf-8')
    if snapshot.get('englishAppendix'):
        files = normalize_package(append_english_pages(files, snapshot))
    deterministic_zip(output, files)
